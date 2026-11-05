import { CalendarServer } from "@mcp-gateway/calendar"
import type { McpContext } from "@mcp-gateway/common"
import { NotesServer } from "@mcp-gateway/notes"
/** The only map from slug to MCP server factory (ADR-0006). Every MCP is a library in this
 * workspace — there is no Worker per MCP — so this file is the entire MCP list. Adding an
 * MCP means a new package, an entry here, and a migration on the `mcp` CHECK enum; a test
 * asserts the keys and the enum agree.
 */
import type { McpServer } from "@modelcontextprotocol/server"

import { MCP_SLUGS, type McpSlug, type Provider } from "../db/schema"

export { MCP_SLUGS, type McpSlug }

export type McpFactory = (ctx: McpContext) => McpServer | Promise<McpServer>

export interface McpDefinition {
  factory: McpFactory
  provider: Provider
}

export const MCP_REGISTRY = {
  calendar: { factory: ctx => new CalendarServer(ctx).build(), provider: "google" },
  notes: { factory: ctx => new NotesServer(ctx).build(), provider: "microsoft" }
} satisfies Record<McpSlug, McpDefinition>

export function isMcpSlug(value: string): value is McpSlug {
  return MCP_SLUGS.some(slug => slug === value)
}
