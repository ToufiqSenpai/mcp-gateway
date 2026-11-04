/**
 * The only map from slug to MCP server factory (ADR-0006). Every MCP is a library in this
 * workspace — there is no Worker per MCP — so this file is the entire MCP list. Adding an
 * MCP means a new package, an entry here, and a migration on the `mcp` CHECK enum; a test
 * asserts the keys and the enum agree.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import { createServer as createCalendarServer } from '@mcp-gateway/calendar';
import { createServer as createNotesServer } from '@mcp-gateway/notes';
import { MCP_SLUGS, type McpSlug, type Provider } from '../db/schema';
import type { McpContext } from './context';

export { MCP_SLUGS, type McpSlug };

export type McpFactory = (ctx: McpContext) => McpServer | Promise<McpServer>;

export interface McpDefinition {
  factory: McpFactory;
  provider: Provider;
}

export const MCP_REGISTRY: Record<McpSlug, McpDefinition> = {
  calendar: { factory: createCalendarServer, provider: 'google' },
  notes: { factory: createNotesServer, provider: 'microsoft' },
};

export function isMcpSlug(value: string): value is McpSlug {
  return (MCP_SLUGS as readonly string[]).includes(value);
}
