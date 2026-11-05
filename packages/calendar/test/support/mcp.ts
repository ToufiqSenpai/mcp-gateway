import { bindMcp } from "@mcp-gateway/test-support"

export * from "@mcp-gateway/test-support"

export const { call, modernRequest } = bindMcp("calendar")
