import { z } from "zod"

import { GraphError } from "../client"
import { toPage } from "../map"
import { defineTool } from "./helpers"

export const CONTENT_CAP = 100_000

export interface CappedContent {
  content: string
  truncated: boolean
}

/** Cut at the last complete tag boundary at or before the cap. */
export function capContent(html: string, cap = CONTENT_CAP): CappedContent {
  if (html.length <= cap) return { content: html, truncated: false }
  const slice = html.slice(0, cap)
  const boundary = slice.lastIndexOf(">")
  return { content: boundary >= 0 ? slice.slice(0, boundary + 1) : "", truncated: true }
}

export const getPageTool = defineTool(
  "get_page",
  {
    title: "Get page",
    description:
      "Returns one page with its HTML content verbatim. content is capped at 100 000 characters at the last complete tag; contentLength is the full length.",
    inputSchema: z.object({
      account: z.string().optional(),
      pageId: z.string(),
      includeIds: z.boolean().optional()
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (args, context) => {
    const slug = await context.resolve(args.account)
    const client = context.graph(slug)

    const [metadata, content] = await Promise.all([
      client.page(args.pageId),
      client.pageContent(args.pageId, args.includeIds)
    ])
    if (!metadata) throw new GraphError(404, "itemNotFound", "Page not found.")

    const { content: body, truncated } = capContent(content)
    return {
      ...toPage(metadata),
      content: body,
      contentLength: content.length,
      truncated
    }
  }
)
