import { McpServerBuilder, type McpContext } from "@mcp-gateway/common"
import type { McpServer } from "@modelcontextprotocol/server"

import { providerErrorCode } from "./client"
import { CalendarPromptRegistry, PromptContext } from "./prompts"
import { CalendarResourceRegistry } from "./resources"
import { calendarTools } from "./tools"
import { ToolContext } from "./tools/tool-context"

/** One per request: builds a fresh MCP server over the request's context. */
export class CalendarServer extends McpServerBuilder<ToolContext> {
  protected readonly name = "calendar"
  protected readonly tools = calendarTools
  protected readonly resources: CalendarResourceRegistry

  public constructor(private readonly mcp: McpContext) {
    super(new ToolContext(mcp))
    this.resources = new CalendarResourceRegistry(this.context)
  }

  /** One short line: a Provider body never becomes a tool error. */
  protected formatError(error: Error): string {
    const code = providerErrorCode(error)
    const message = error.message.split("\n")[0] ?? ""
    const trimmed = message.slice(0, 300)
    return code && !trimmed.includes(code) ? `${code}: ${trimmed}` : trimmed
  }

  protected override registerPrompts(server: McpServer): void {
    new CalendarPromptRegistry().register(server, new PromptContext(this.mcp))
  }
}
