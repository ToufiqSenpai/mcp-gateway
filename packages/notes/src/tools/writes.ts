import { z } from "zod"

import { GraphError } from "../client"
import { toNotebook, toSection } from "../map"
import { defineTool } from "./helpers"

export const deletePageTool = defineTool(
  "delete_page",
  {
    title: "Delete page",
    description: "Deletes a page. Graph exposes no undo or trash step.",
    inputSchema: z.object({ account: z.string().optional(), pageId: z.string() }),
    annotations: { destructiveHint: true, idempotentHint: true }
  },
  async (args, context) => {
    const slug = await context.resolve(args.account)
    await context.graph(slug).deletePage(args.pageId)
    return { pageId: args.pageId, deleted: true }
  }
)

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
  async (args, context) => {
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

export const createNotebookTool = defineTool(
  "create_notebook",
  {
    title: "Create notebook",
    description: "Creates a notebook. This changes the container list, so the enumeration cache is invalidated.",
    inputSchema: z.object({ account: z.string().optional(), displayName: z.string().min(1) }),
    annotations: { destructiveHint: false, idempotentHint: false }
  },
  async (args, context) => {
    const slug = await context.resolve(args.account)
    const client = context.graph(slug)
    const created = await client.createNotebook(args.displayName)

    await context.invalidateEnumeration()

    if (!created) throw new GraphError(500, "unknown", "Graph returned no notebook.")
    if (created.id && !created.links) {
      const followUp = await client.notebook(created.id)
      if (!followUp) throw new GraphError(404, "itemNotFound", "Notebook not found.")
      return toNotebook(followUp)
    }
    return toNotebook(created)
  }
)
