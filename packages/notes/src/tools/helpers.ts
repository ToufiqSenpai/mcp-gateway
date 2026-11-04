import {
  defineTool as defineCommonTool,
  type ObjectFields,
  type ToolDefinition,
  type ToolPayload
} from "@mcp-gateway/common"
import type { ToolAnnotations } from "@modelcontextprotocol/server"
import type { z } from "zod"

import type { ToolContext } from "./tool-context"

/** Binds the common tool builder to this package's `ToolContext`. */
export function defineTool<S extends z.ZodObject<ObjectFields>>(
  name: string,
  config: { title: string; description: string; inputSchema: S; annotations?: ToolAnnotations },
  handler: (args: z.infer<S>, context: ToolContext) => Promise<ToolPayload>
): ToolDefinition<ToolContext> {
  return defineCommonTool<ToolContext, S>(name, config, handler)
}
