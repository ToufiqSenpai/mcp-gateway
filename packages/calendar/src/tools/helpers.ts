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

export const FETCH_CAP = 1000

/** Follows Provider pagination to the cap; Provider tokens stay inside this function. */
export async function collectPages<T>(
  fetchPage: (pageToken?: string) => Promise<{ items: T[]; nextPageToken?: string | null }>,
  cap = FETCH_CAP
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = []
  let pageToken: string | undefined

  do {
    const page = await fetchPage(pageToken)
    items.push(...page.items)
    pageToken = page.nextPageToken ?? undefined
    if (!pageToken) return { items, truncated: false }
  } while (items.length < cap)

  return { items: items.slice(0, cap), truncated: true }
}
