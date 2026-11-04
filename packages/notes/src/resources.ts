import {
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  ResourceTemplate,
} from '@modelcontextprotocol/server';
import { graphClient, GraphError } from './client';
import type { McpContext } from './context';
import {
  NOTEBOOK_SELECT,
  SECTION_SELECT,
  toNotebook,
  toSection,
  type GraphNotebook,
  type GraphSection,
} from './map';

const URI_PATTERN = /^notes:\/\/([^/]+)\/notebooks\/(.+)$/;

export function notebookUri(account: string, id: string): string {
  return `notes://${account}/notebooks/${encodeURIComponent(id)}`;
}

function parseUri(uri: string): { account: string; notebookId: string } {
  const match = URI_PATTERN.exec(uri);
  if (!match?.[1] || !match[2]) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Unrecognised notebook resource URI');
  }
  return { account: match[1], notebookId: decodeURIComponent(match[2]) };
}

export interface ResourceListing {
  resources: { uri: string; name: string; mimeType: string }[];
  skipped: string[];
  truncated: boolean;
}

/** One resource per notebook per usable Account; a sick Account is skipped and named. */
export async function listNotebookResources(ctx: McpContext): Promise<ResourceListing> {
  const accounts = await ctx.listAccounts();
  const resources: ResourceListing['resources'] = [];
  const skipped: string[] = [];
  let truncated = false;

  for (const account of accounts) {
    try {
      const listing = await ctx.enumeration<ResourceListing['resources'][number]>(
        account.slug,
        async () => {
          const result = await graphClient(ctx, account.slug).collect<GraphNotebook>(
            `/me/onenote/notebooks?$select=${NOTEBOOK_SELECT}&$top=100`,
          );
          return {
            items: result.items.flatMap((notebook) =>
              notebook.id
                ? [
                    {
                      uri: notebookUri(account.slug, notebook.id),
                      name: notebook.displayName ?? notebook.id,
                      mimeType: 'application/json',
                    },
                  ]
                : [],
            ),
            truncated: result.truncated,
          };
        },
      );
      resources.push(...listing.items);
      truncated ||= listing.truncated;
    } catch {
      skipped.push(account.slug);
    }
  }

  return { resources, skipped, truncated };
}

export function registerResources(server: McpServer, ctx: McpContext): void {
  const template = new ResourceTemplate('notes://{account}/notebooks/{notebookId}', {
    list: async () => {
      const listing = await listNotebookResources(ctx);
      return {
        resources: listing.resources,
        ...(listing.skipped.length > 0 ? { ttlMs: 0 } : {}),
        ...(listing.skipped.length > 0
          ? { _meta: { 'mcp-gateway/skippedAccounts': listing.skipped } }
          : {}),
      };
    },
  });

  server.registerResource(
    'notebook',
    template,
    { title: 'Notebook', mimeType: 'application/json' },
    async (uri) => {
      const { account, notebookId } = parseUri(uri.href);
      let client;
      try {
        client = graphClient(ctx, account);
      } catch {
        throw new ProtocolError(
          ProtocolErrorCode.InternalError,
          `Credentials for Account "${account}" are unusable.`,
        );
      }

      try {
        const response = await client.request(
          `/me/onenote/notebooks/${encodeURIComponent(notebookId)}?$select=${NOTEBOOK_SELECT}&$expand=sections,sectionGroups`,
        );
        const notebook = response.data as GraphNotebook & {
          sections?: GraphSection[];
          sectionGroups?: { id?: string; displayName?: string }[];
        };

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({
                account,
                notebook: toNotebook(notebook),
                sections: (notebook.sections ?? []).map((section) => {
                  void SECTION_SELECT;
                  return toSection(section);
                }),
                sectionGroups: (notebook.sectionGroups ?? []).flatMap((group) =>
                  group.id ? [{ id: group.id, ...(group.displayName ? { displayName: group.displayName } : {}) }] : [],
                ),
                truncated: false,
              }),
            },
          ],
        };
      } catch (error) {
        if (error instanceof GraphError && error.status === 404) {
          throw new ResourceNotFoundError(uri.href);
        }
        if (error instanceof GraphError && (error.status === 401 || error.status === 403)) {
          throw new ProtocolError(
            ProtocolErrorCode.InternalError,
            `Credentials for Account "${account}" were refused by the Provider.`,
          );
        }
        throw error;
      }
    },
  );
}
