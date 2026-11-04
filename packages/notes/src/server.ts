import { buildServer, type McpContext } from "@mcp-gateway/common"
import { McpServer } from "@modelcontextprotocol/server"

import { GraphError } from "./client"
import { NotebookResourceRegistry } from "./resources"
import { notesTools } from "./tools"
import { ToolContext } from "./tools/tool-context"

/** One short line: a raw Graph body never becomes a tool error. */
function toolErrorMessage(error: Error): string {
  if (error instanceof GraphError) {
    return `${error.code}: ${error.message}`.slice(0, 300)
  }
  const firstLine = error.message.split(/\r?\n/)[0]
  return (firstLine ?? "Tool call failed").slice(0, 300)
}

/** One per request: builds a fresh MCP server over the request's context. */
export class NotesServer {
  public constructor(private readonly ctx: McpContext) {}

  public build(): McpServer {
    const context = new ToolContext(this.ctx)
    return buildServer({
      name: "notes",
      tools: notesTools,
      context,
      formatError: toolErrorMessage,
      resources: new NotebookResourceRegistry(context)
    })
  }
}

export function createServer(ctx: McpContext): McpServer {
  return new NotesServer(ctx).build()
}
