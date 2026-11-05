import type { JsonRpcCall } from "@mcp-gateway/test-support"
import { bindMcp } from "@mcp-gateway/test-support"

export * from "@mcp-gateway/test-support"

const helpers = bindMcp("notes")

export const call = helpers.call

export function modernRequest(body: JsonRpcCall): Request {
  return helpers.modernRequest(body)
}
