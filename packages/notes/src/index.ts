export type { McpContext } from "@mcp-gateway/common"
export { createServer } from "./server"

/**
 * The Required scope set for the `notes` MCP. One constant for the authorize URL, the
 * callback check and the call-path check.
 */
export const REQUIRED_SCOPES = ["offline_access", "User.Read", "Notes.ReadWrite"] as const

export const REQUIRED_SCOPE_STRING = REQUIRED_SCOPES.join(" ")
