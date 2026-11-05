import { ToolResult, collectAcrossAccounts, defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { toNotebook, toPage, toSection } from "../map"
import { accountSchema, cursorSchema, notebookIdSchema, sectionGroupIdSchema, sectionIdSchema } from "../schemas"
import type { ToolContext } from "./tool-context"

interface NotebookListData {
  notebooks: ReturnType<typeof toNotebook>[]
  nextCursor?: string
}

interface SectionListData {
  sections: ReturnType<typeof toSection>[]
  nextCursor?: string
}

interface PageListData {
  pages: ReturnType<typeof toPage>[]
  nextCursor?: string
}

export const listNotebooksTool = defineTool(
  "list_notebooks",
  {
    title: "List notebooks",
    description: "Retrieves the list of notebooks the user has access to across the selected Accounts.",
    inputSchema: z.object({ account: accountSchema, cursor: cursorSchema }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (args, context: ToolContext) => {
    const accounts = await context.selectedAccounts(args.account)
    const page = await context.paginate<ReturnType<typeof toNotebook>>({
      accounts,
      cursor: args.cursor,
      fetchAll: () =>
        collectAcrossAccounts(accounts, async slug => {
          const result = await context.graph(slug).notebooks()
          return { items: result.items.map(toNotebook), truncated: result.truncated }
        })
    })

    const data: NotebookListData = { notebooks: page.items }
    if (page.nextCursor) data.nextCursor = page.nextCursor
    return new ToolResult(data, { truncated: page.truncated, skipped: page.skipped })
  }
)

export const listSectionsTool = defineTool(
  "list_sections",
  {
    title: "List sections",
    description:
      "Retrieves a list of sections. With notebookId, only sections directly in that notebook; with sectionGroupId, sections in that group; with neither, every section including nested ones. Passing both is invalid.",
    inputSchema: z.object({
      account: accountSchema,
      notebookId: notebookIdSchema.optional(),
      sectionGroupId: sectionGroupIdSchema.optional(),
      cursor: cursorSchema
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (args, context: ToolContext) => {
    if (args.notebookId && args.sectionGroupId) {
      throw new Error("Pass only one of notebookId or sectionGroupId, not both.")
    }

    const accounts = await context.selectedAccounts(args.account)
    const page = await context.paginate<ReturnType<typeof toSection>>({
      accounts,
      cursor: args.cursor,
      fetchAll: () =>
        collectAcrossAccounts(accounts, async slug => {
          const result = await context
            .graph(slug)
            .sections({ notebookId: args.notebookId, sectionGroupId: args.sectionGroupId })
          return { items: result.items.map(toSection), truncated: result.truncated }
        })
    })

    const data: SectionListData = { sections: page.items }
    if (page.nextCursor) data.nextCursor = page.nextCursor
    return new ToolResult(data, { truncated: page.truncated, skipped: page.skipped })
  }
)

export const listPagesTool = defineTool(
  "list_pages",
  {
    title: "List pages",
    description:
      "Retrieves a list of pages. With sectionId, pages in that section; with neither, pages across all notebooks. Page lists carry no content.",
    inputSchema: z.object({
      account: accountSchema,
      sectionId: sectionIdSchema.optional(),
      cursor: cursorSchema
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (args, context: ToolContext) => {
    const accounts = await context.selectedAccounts(args.account)

    const page = await context.paginate<ReturnType<typeof toPage>>({
      accounts,
      cursor: args.cursor,
      fetchAll: () =>
        collectAcrossAccounts(accounts, async slug => {
          const result = await context.graph(slug).pages(args.sectionId)
          return { items: result.items.map(toPage), truncated: result.truncated }
        })
    })

    const data: PageListData = { pages: page.items }
    if (page.nextCursor) data.nextCursor = page.nextCursor
    return new ToolResult(data, { truncated: page.truncated, skipped: page.skipped })
  }
)
