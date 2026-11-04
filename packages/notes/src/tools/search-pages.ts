import { ToolResult } from "@mcp-gateway/common"
import { z } from "zod"

import { toPage } from "../map"
import { defineTool } from "./helpers"

interface PageSearchData {
  pages: ReturnType<typeof toPage>[]
  nextCursor?: string
}

export const searchPagesTool = defineTool(
  "search_pages",
  {
    title: "Search pages",
    description: "Case-insensitive substring match on the page title only. Graph has no page-content search endpoint.",
    inputSchema: z.object({
      account: z.string().optional(),
      query: z.string().min(1),
      sectionId: z.string().optional(),
      cursor: z.string().optional()
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (args, context) => {
    const slug = await context.resolve(args.account)
    const collected = await context.graph(slug).pages(args.sectionId)
    const needle = args.query.toLowerCase()
    const matches = collected.items.map(toPage).filter(page => (page.title ?? "").toLowerCase().includes(needle))

    const page = await context.paginate<ReturnType<typeof toPage>>({
      accounts: [{ slug }],
      cursor: args.cursor,
      fetchAll: async () => ({ items: matches, truncated: collected.truncated })
    })

    const data: PageSearchData = { pages: page.items }
    if (page.nextCursor) data.nextCursor = page.nextCursor
    return new ToolResult(data, { truncated: page.truncated, skipped: page.skipped })
  }
)
