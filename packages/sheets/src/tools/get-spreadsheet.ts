import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { accountSchema } from "../schemas"
import type { ToolContext } from "./tool-context"

const inputSchema = z.object({
  account: accountSchema,
  spreadsheetId: z.string().describe("The ID of the spreadsheet to request"),
  includeGridData: z.boolean().optional().describe("Return grid data; default false").meta({ default: false }),
  fields: z
    .array(z.string())
    .optional()
    .describe("Hierarchical field masks, e.g. sheets.properties.sheetId; joined with ,"),
  commentsIncluded: z.boolean().optional().describe("Include comments; default false").meta({ default: false }),
  ranges: z.array(z.string()).optional().describe("A1/R1C1 ranges; omitted means the whole spreadsheet")
})

export const getSpreadsheetTool = defineTool(
  "get_spreadsheet",
  {
    title: "Get spreadsheet",
    description: "Returns the spreadsheet content for the given spreadsheet.",
    inputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const response = await context.sheets(slug).spreadsheets.get({
      spreadsheetId: args.spreadsheetId,
      includeGridData: args.includeGridData,
      fields: args.fields?.join(","),
      commentsIncluded: args.commentsIncluded,
      ranges: args.ranges
    })
    return { content: response.data }
  }
)
