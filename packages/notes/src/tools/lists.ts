import { ToolResult, collectAcrossAccounts } from "@mcp-gateway/common"
import { z } from "zod"

import { toNotebook, toPage, toSection } from "../map"
import { defineTool } from "./helpers"

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

const accountSchema = z
  .string()
  .min(1)
  .optional()
  .describe("Account slug. Defaults to the Default Account for this MCP.")
const cursorSchema = z
  .string()
  .optional()
  .describe("Opaque cursor from a previous response. Empty string means the first page.")

export const listNotebooksTool = defineTool(
  "list_notebooks",
  {
    title: "List notebooks",
    description: "Lists OneNote notebooks for the selected Accounts.",
    inputSchema: z.object({ account: accountSchema, cursor: cursorSchema }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (args, context) => {
    const accounts = await context.selectedAccounts(args.account)
    const page = await context.paginate<ReturnType<typeof toNotebook>>({
      accounts,
      cursor: args.cursor,
      fetchAll: async () =>
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
      "Lists sections. With notebookId, only sections directly in it; with sectionGroupId, sections in that group; with neither, every section including nested ones. Passing both is invalid.",
    inputSchema: z.object({
      account: accountSchema,
      notebookId: z.string().optional(),
      sectionGroupId: z.string().optional(),
      cursor: cursorSchema
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (args, context) => {
    if (args.notebookId && args.sectionGroupId) {
      throw new Error("Pass only one of notebookId or sectionGroupId, not both.")
    }

    const accounts = await context.selectedAccounts(args.account)
    const page = await context.paginate<ReturnType<typeof toSection>>({
      accounts,
      cursor: args.cursor,
      fetchAll: async () =>
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
    description: "Lists pages, across all notebooks when no sectionId is given. Lists carry no content.",
    inputSchema: z.object({
      account: accountSchema,
      sectionId: z.string().optional(),
      cursor: cursorSchema
    }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (args, context) => {
    const accounts = await context.selectedAccounts(args.account)

    const page = await context.paginate<ReturnType<typeof toPage>>({
      accounts,
      cursor: args.cursor,
      fetchAll: async () =>
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
