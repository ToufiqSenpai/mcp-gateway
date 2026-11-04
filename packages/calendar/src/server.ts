import { McpServer } from '@modelcontextprotocol/server';
import { providerErrorCode } from './client';
import type { McpContext } from './context';
import { registerPrompts } from './prompts';
import { registerResources, listCalendarResources } from './resources';
import { calendarTools } from './tools';
import { ToolResult } from './tools/helpers';

/** One short line: a Provider body never becomes a tool error. */
function toolErrorMessage(error: unknown): string {
  const code = providerErrorCode(error);
  const message = error instanceof Error ? error.message.split('\n')[0] ?? '' : 'Tool call failed';
  const trimmed = message.slice(0, 300);
  return code && !trimmed.includes(code) ? `${code}: ${trimmed}` : trimmed;
}

export function createServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: 'calendar', version: '1.0.0' },
    {
      cacheHints: {
        'server/discover': { ttlMs: 3_600_000, cacheScope: 'public' },
        'tools/list': { ttlMs: 3_600_000, cacheScope: 'public' },
        'prompts/list': { ttlMs: 3_600_000, cacheScope: 'public' },
        'resources/templates/list': { ttlMs: 3_600_000, cacheScope: 'public' },
        'resources/list': { ttlMs: 300_000, cacheScope: 'private' },
        'resources/read': { ttlMs: 30_000, cacheScope: 'private' },
      },
    },
  );

  for (const tool of calendarTools) {
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
  registerPrompts(server, ctx);

  // The SDK's own resources/list drops a partial listing's ttlMs/_meta, so serve it here.
  server.server.removeRequestHandler('resources/list');
  server.server.setRequestHandler('resources/list', async () => {
    const listing = await listCalendarResources(ctx);
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

  // Nothing here is subscribable: no listChanged, no resources/subscribe (ADR-0001).
  const capabilities = server.server.getCapabilities();
  if (capabilities.tools) delete capabilities.tools.listChanged;
  if (capabilities.prompts) delete capabilities.prompts.listChanged;
  if (capabilities.resources) delete capabilities.resources.listChanged;

  return server;
}


