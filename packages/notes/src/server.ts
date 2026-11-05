import { McpServerBuilder, type McpContext } from "@mcp-gateway/common"

import { GraphError } from "./client"
import { NotebookResourceRegistry } from "./resources"
import { notesTools } from "./tools"
import { ToolContext } from "./tools/tool-context"

/** One per request: builds a fresh MCP server over the request's context. */
export class NotesServer extends McpServerBuilder<ToolContext> {
  protected readonly name = "notes"
  protected readonly tools = notesTools
  protected override readonly resources: NotebookResourceRegistry

  public constructor(mcp: McpContext) {
    super(new ToolContext(mcp))
    this.resources = new NotebookResourceRegistry(this.context)
  }

  /** One short line: a raw Graph body never becomes a tool error. */
  protected override formatError(error: Error): string {
    if (error instanceof GraphError) {
      return `${error.code}: ${error.message}`.slice(0, 300)
    }
    const firstLine = error.message.split(/\r?\n/)[0]
    return (firstLine ?? "Tool call failed").slice(0, 300)
  }
}
