import { buildServer, type McpContext } from "@mcp-gateway/common"
import { McpServer } from "@modelcontextprotocol/server"

import { providerErrorCode } from "./client"
import { CalendarPromptRegistry, PromptContext } from "./prompts"
import { CalendarResourceRegistry } from "./resources"
import { calendarTools } from "./tools"
import { ToolContext } from "./tools/tool-context"

/** One short line: a Provider body never becomes a tool error. */
function toolErrorMessage(error: Error): string {
  const code = providerErrorCode(error)
  const message = error.message.split("\n")[0] ?? ""
  const trimmed = message.slice(0, 300)
  return code && !trimmed.includes(code) ? `${code}: ${trimmed}` : trimmed
}

/** One per request: builds a fresh MCP server over the request's context. */
export class CalendarServer {
  public constructor(private readonly ctx: McpContext) {}

  public build(): McpServer {
    const context = new ToolContext(this.ctx)
    return buildServer({
      name: "calendar",
      tools: calendarTools,
      context,
      formatError: toolErrorMessage,
      resources: new CalendarResourceRegistry(context),
      prompts: server => new CalendarPromptRegistry().register(server, new PromptContext(this.ctx))
    })
  }
}

export function createServer(ctx: McpContext): McpServer {
  return new CalendarServer(ctx).build()
}
