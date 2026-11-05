import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { GraphError } from "../../client"
import { toSection } from "../../map"
import type { ToolContext } from "../tool-context"

export const createSectionTool = defineTool(
  "create_section",
  {
    title: "Create section",
    description: "Creates a section. Exactly one parent is required: notebookId or sectionGroupId.",
    inputSchema: z.object({
      account: z.string().optional(),
      displayName: z.string().min(1),
      notebookId: z.string().optional(),
      sectionGroupId: z.string().optional()
    }),
    annotations: { destructiveHint: false, idempotentHint: false }
  },
  async (args, context: ToolContext) => {
    const hasNotebook = Boolean(args.notebookId)
    const hasGroup = Boolean(args.sectionGroupId)
    if (hasNotebook === hasGroup) {
      throw new Error("Pass exactly one of notebookId or sectionGroupId.")
    }

    const slug = await context.resolve(args.account)
    const client = context.graph(slug)
    const created = await client.createSection(
      { notebookId: args.notebookId, sectionGroupId: args.sectionGroupId },
      args.displayName
    )
    if (!created) throw new GraphError(500, "unknown", "Graph returned no section.")
    if (created.parentNotebook?.id || created.parentSectionGroup?.id || !created.id) {
      return toSection(created)
    }

    const followUp = await client.section(created.id)
    if (!followUp) throw new GraphError(404, "itemNotFound", "Section not found.")
    return toSection(followUp)
  }
)
