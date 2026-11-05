import { McpServerBuilder, type McpContext } from "@mcp-gateway/common"

import { googleStatus } from "./client"
import { sheetsTools } from "./tools"
import { ToolContext } from "./tools/tool-context"

/** One per request: builds a fresh MCP server over the request's context. */
export class SheetsServer extends McpServerBuilder<ToolContext> {
  protected readonly name = "sheets"
  protected readonly tools = sheetsTools

  public constructor(mcp: McpContext) {
    super(new ToolContext(mcp))
  }

  /** One short line: a Provider body never becomes a tool error. */
  protected override errorCode(error: Error): string | undefined {
    return googleStatus(error)
  }
}
