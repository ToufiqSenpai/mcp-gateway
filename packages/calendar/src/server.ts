import { McpServerBuilder, PromptContext, PromptRegistry, type McpContext } from "@mcp-gateway/common"
import type { McpServer } from "@modelcontextprotocol/server"

import { googleStatus } from "./client"
import { calendarPrompts } from "./prompts"
import { CalendarResourceRegistry } from "./resources"
import { calendarTools } from "./tools"
import { ToolContext } from "./tools/tool-context"

/** One per request: builds a fresh MCP server over the request's context. */
export class CalendarServer extends McpServerBuilder<ToolContext> {
  protected readonly name = "calendar"
  protected readonly tools = calendarTools
  protected override readonly resources: CalendarResourceRegistry

  public constructor(private readonly mcp: McpContext) {
    super(new ToolContext(mcp))
    this.resources = new CalendarResourceRegistry(this.context)
  }

  /** One short line: a Provider body never becomes a tool error. */
  protected override errorCode(error: Error): string | undefined {
    return googleStatus(error)
  }

  protected override registerPrompts(server: McpServer): void {
    new PromptRegistry(calendarPrompts).register(server, new PromptContext(this.mcp))
  }
}
