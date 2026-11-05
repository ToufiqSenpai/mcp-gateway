export type { McpContext } from "@mcp-gateway/common"
export { NotesServer } from "./server"

/**
 * The Required scope set for the `notes` MCP. `offline_access` is a request directive the
 * Microsoft provider adds to the authorize URL; it is not part of the granted access-token
 * scope set the token endpoint returns, so it must not be validated here.
 */
export const REQUIRED_SCOPES = ["User.Read", "Notes.ReadWrite"] as const
