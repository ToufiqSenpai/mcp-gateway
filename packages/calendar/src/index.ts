export type { McpContext } from "@mcp-gateway/common"
export { CalendarServer } from "./server"

/**
 * The Required scope set for the `calendar` MCP. One constant for the authorize URL, the
 * callback check and the call-path check. Google returns these scopes in their canonical
 * userinfo-URL form, so the request uses that form too.
 */
export const REQUIRED_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/calendar"
] as const
