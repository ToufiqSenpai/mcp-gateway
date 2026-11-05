import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import type { ToolContext } from "../tool-context"

export const deletePageTool = defineTool(
  "delete_page",
  {
    title: "Delete page",
    description: "Deletes a page. Graph exposes no undo or trash step.",
    inputSchema: z.object({ account: z.string().optional(), pageId: z.string() }),
    annotations: { destructiveHint: true, idempotentHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    await context.graph(slug).deletePage(args.pageId)
    return { pageId: args.pageId, deleted: true }
  }
)
