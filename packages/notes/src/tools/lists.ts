import { z } from 'zod';
import { graphClient } from '../client';
import { accountSlug } from '../context';
import {
  NOTEBOOK_SELECT,
  PAGE_SELECT,
  SECTION_SELECT,
  toNotebook,
  toPage,
  toSection,
  type GraphNotebook,
  type GraphPage,
  type GraphSection,
} from '../map';
import { ToolResult, defineTool, paginate } from './helpers';

const accountSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Account slug. Defaults to the Default Account for this MCP.');
const cursorSchema = z
  .string()
  .optional()
  .describe('Opaque cursor from a previous response. Empty string means the first page.');

async function selectedAccounts(ctx: Parameters<typeof accountSlug>[0], account?: string) {
  if (account) return [{ slug: account }];
  return ctx.listAccounts();
}

export const listAccountsTool = defineTool(
  'list_accounts',
  {
    title: 'List accounts',
    description:
      'Lists the Accounts available to this MCP as { slug, isDefault }. Never returns state, Credentials or provider subjects.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (_args, ctx) => ({ accounts: await ctx.listAccounts() }),
);

export const listNotebooksTool = defineTool(
  'list_notebooks',
  {
    title: 'List notebooks',
    description: 'Lists OneNote notebooks for the selected Accounts.',
    inputSchema: z.object({ account: accountSchema, cursor: cursorSchema }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (args, ctx) => {
    const accounts = await selectedAccounts(ctx, args.account);
    const page = await paginate<ReturnType<typeof toNotebook>>({
      ctx,
      accounts,
      cursor: args.cursor,
      fetchAll: async () => {
        const collected: ReturnType<typeof toNotebook>[] = [];
        let truncated = false;
        const skipped: string[] = [];

        for (const account of accounts) {
          try {
            const result = await graphClient(ctx, account.slug).collect<GraphNotebook>(
              `/me/onenote/notebooks?$select=${NOTEBOOK_SELECT}&$top=100`,
            );
            collected.push(...result.items.map(toNotebook));
            truncated ||= result.truncated;
          } catch {
            skipped.push(account.slug);
          }
        }

        return { items: collected, truncated: truncated || skipped.length > 0 };
      },
    });

    return new ToolResult(
      {
        notebooks: page.items,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      },
      { truncated: page.truncated },
    );
  },
);

export const listSectionsTool = defineTool(
  'list_sections',
  {
    title: 'List sections',
    description:
      'Lists sections. With notebookId, only sections directly in it; with sectionGroupId, sections in that group; with neither, every section including nested ones. Passing both is invalid.',
    inputSchema: z.object({
      account: accountSchema,
      notebookId: z.string().optional(),
      sectionGroupId: z.string().optional(),
      cursor: cursorSchema,
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (args, ctx) => {
    if (args.notebookId && args.sectionGroupId) {
      throw new Error('Pass only one of notebookId or sectionGroupId, not both.');
    }

    const path = args.notebookId
      ? `/me/onenote/notebooks/${encodeURIComponent(args.notebookId)}/sections`
      : args.sectionGroupId
        ? `/me/onenote/sectionGroups/${encodeURIComponent(args.sectionGroupId)}/sections`
        : '/me/onenote/sections';

    const accounts = await selectedAccounts(ctx, args.account);
    const page = await paginate<ReturnType<typeof toSection>>({
      ctx,
      accounts,
      cursor: args.cursor,
      fetchAll: async () => {
        const collected: ReturnType<typeof toSection>[] = [];
        let truncated = false;
        const skipped: string[] = [];

        for (const account of accounts) {
          try {
            const result = await graphClient(ctx, account.slug).collect<GraphSection>(
              `${path}?$select=${SECTION_SELECT}&$expand=parentNotebook,parentSectionGroup&$top=100`,
            );
            collected.push(...result.items.map(toSection));
            truncated ||= result.truncated;
          } catch {
            skipped.push(account.slug);
          }
        }

        return { items: collected, truncated: truncated || skipped.length > 0 };
      },
    });

    return new ToolResult(
      {
        sections: page.items,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      },
      { truncated: page.truncated },
    );
  },
);

export const listPagesTool = defineTool(
  'list_pages',
  {
    title: 'List pages',
    description: 'Lists pages, across all notebooks when no sectionId is given. Lists carry no content.',
    inputSchema: z.object({
      account: accountSchema,
      sectionId: z.string().optional(),
      cursor: cursorSchema,
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (args, ctx) => {
    const path = args.sectionId
      ? `/me/onenote/sections/${encodeURIComponent(args.sectionId)}/pages`
      : '/me/onenote/pages';
    const accounts = await selectedAccounts(ctx, args.account);

    const page = await paginate<ReturnType<typeof toPage>>({
      ctx,
      accounts,
      cursor: args.cursor,
      fetchAll: async () => {
        const collected: ReturnType<typeof toPage>[] = [];
        let truncated = false;
        const skipped: string[] = [];

        for (const account of accounts) {
          try {
            const result = await graphClient(ctx, account.slug).collect<GraphPage>(
              `${path}?$select=${PAGE_SELECT}&$expand=parentSection&$top=100`,
            );
            collected.push(...result.items.map(toPage));
            truncated ||= result.truncated;
          } catch {
            skipped.push(account.slug);
          }
        }

        return { items: collected, truncated: truncated || skipped.length > 0 };
      },
    });

    return new ToolResult(
      {
        pages: page.items,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      },
      { truncated: page.truncated },
    );
  },
);

export { accountSlug };
