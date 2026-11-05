import type { McpServer } from "@modelcontextprotocol/server"

import { ToolResult, type ToolArguments, type ToolDefinition, type ToolMeta } from "../tools"

/** Registers tools in array order — that order is the wire `tools/list` order. */
export class ToolRegistry<C> {
  public constructor(
    private readonly tools: readonly ToolDefinition<C>[],
    private readonly formatError: (error: Error) => string
  ) {}

  public register(server: McpServer, context: C): void {
    for (const tool of this.tools) {
      server.registerTool(tool.name, tool.config, async args => {
        try {
          // SAFETY: the SDK validated `args` against this tool's inputSchema before the call.
          const output = await tool.handler(args as ToolArguments, context)
          const data = output instanceof ToolResult ? output.data : output
          const meta: ToolMeta = {}
          if (output instanceof ToolResult) {
            if (output.options.truncated) meta["mcp-gateway/truncated"] = true
            if (output.options.skipped?.length) meta["mcp-gateway/skippedAccounts"] = output.options.skipped
            Object.assign(meta, output.options.meta)
          }
          const content = [{ type: "text" as const, text: JSON.stringify(data) }]
          if (Object.keys(meta).length > 0) return { content, _meta: meta }
          return { content }
        } catch (error) {
          const failure = error instanceof Error ? error : new Error("Tool call failed")
          return {
            content: [{ type: "text" as const, text: this.formatError(failure) }],
            isError: true
          }
        }
      })
    }
  }
}
