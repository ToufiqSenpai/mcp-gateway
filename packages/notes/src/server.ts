import { McpServer } from '@modelcontextprotocol/server';
import { GraphError } from './client';
import type { McpContext } from './context';
import { registerResources, listNotebookResources } from './resources';
import { notesTools } from './tools';
import { ToolResult } from './tools/helpers';

/** One short line: a raw Graph body never becomes a tool error. */
function toolErrorMessage(error: unknown): string {
  if (error instanceof GraphError) {
    return `${error.code}: ${error.message}`.slice(0, 300);
  }
  const firstLine = error instanceof Error ? error.message.split(/\r?\n/)[0] : undefined;
  return (firstLine ?? 'Tool call failed').slice(0, 300);
}

export function createServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: 'notes', version: '1.0.0' },
    {
      cacheHints: {
        'server/discover': { ttlMs: 3_600_000, cacheScope: 'public' },
        'tools/list': { ttlMs: 3_600_000, cacheScope: 'public' },
        'resources/templates/list': { ttlMs: 3_600_000, cacheScope: 'public' },
        'resources/list': { ttlMs: 300_000, cacheScope: 'private' },
        'resources/read': { ttlMs: 30_000, cacheScope: 'private' },
      },
    },
  );

  for (const tool of notesTools) {
    server.registerTool(tool.name, tool.config, async (args) => {
      try {
        const output = await tool.handler(args, ctx);
        const data = output instanceof ToolResult ? output.data : output;
        const meta =
          output instanceof ToolResult
            ? {
                ...(output.options.truncated ? { 'mcp-gateway/truncated': true } : {}),
                ...output.options.meta,
              }
            : {};
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data) }],
          ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: toolErrorMessage(error) }],
          isError: true,
        };
      }
    });
  }

  registerResources(server, ctx);

  // The SDK's own resources/list drops a partial listing's ttlMs/_meta, so serve it here.
  server.server.removeRequestHandler('resources/list');
  server.server.setRequestHandler('resources/list', async () => {
    const listing = await listNotebookResources(ctx);
    return {
      resources: listing.resources,
      ...(listing.skipped.length > 0 || listing.truncated
        ? { ttlMs: 0, _meta: { 'mcp-gateway/skippedAccounts': listing.skipped } }
        : {}),
    } as { resources: { uri: string; name: string; mimeType: string }[] };
  });

  // Containers are addressed by concrete URI, not a template: list nothing.
  server.server.removeRequestHandler('resources/templates/list');
  server.server.setRequestHandler('resources/templates/list', () => ({ resourceTemplates: [] }));

  // No prompts, nothing subscribable: no listChanged, no resources/subscribe (ADR-0001).
  const capabilities = server.server.getCapabilities();
  if (capabilities.tools) delete capabilities.tools.listChanged;
  if (capabilities.resources) delete capabilities.resources.listChanged;

  return server;
}


