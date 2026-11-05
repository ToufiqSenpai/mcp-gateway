import { McpServerBuilder, type McpContext } from "@mcp-gateway/common"

import { providerErrorCode } from "./client"
import { NoResources } from "./resources"
import { sheetsTools } from "./tools"
import { ToolContext } from "./tools/tool-context"

/** One per request: builds a fresh MCP server over the request's context. */
export class SheetsServer extends McpServerBuilder<ToolContext> {
  protected readonly name = "sheets"
  protected readonly tools = sheetsTools
  protected readonly resources = new NoResources()

  public constructor(mcp: McpContext) {
    super(new ToolContext(mcp))
  }

  /** One short line: a Provider body never becomes a tool error. */
  protected formatError(error: Error): string {
    const code = providerErrorCode(error)
    const message = error.message.split("\n")[0] ?? ""
    const trimmed = message.slice(0, 300)
    return code && !trimmed.includes(code) ? `${code}: ${trimmed}` : trimmed
  }
}
