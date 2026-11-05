import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { accountSchema } from "../schemas"
import type { ToolContext } from "./tool-context"

const inputSchema = z.object({
  account: accountSchema,
  title: z.string().optional().describe("File title; omitted or empty uses the provider default")
})

export const createSpreadsheetTool = defineTool(
  "create_spreadsheet",
  {
    title: "Create spreadsheet",
    description: "Creates a new spreadsheet in the Account's Drive.",
    inputSchema,
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const requestBody = args.title?.length ? { properties: { title: args.title } } : {}
    const response = await context.sheets(slug).createSpreadsheet({ requestBody })
    return { content: response.data, status: "SUCCESS" }
  }
)
