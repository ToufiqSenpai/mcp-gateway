import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { accountSchema, valueRowsSchema } from "../schemas"
import type { ToolContext } from "./tool-context"

const inputSchema = z.object({
  account: accountSchema,
  spreadsheetId: z.string().min(1).describe("The ID of the spreadsheet to update."),
  range: z.string().min(1).describe("The A1 notation of the range to update, for example 'Sheet1!A1:B2'."),
  values: valueRowsSchema
})

export const updateValuesTool = defineTool(
  "update_values",
  {
    title: "Update values",
    description: "Sets values in a range of a spreadsheet.",
    inputSchema,
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const response = await context.sheets(slug).values.update({
      spreadsheetId: args.spreadsheetId,
      range: args.range,
      valueInputOption: "RAW",
      requestBody: { range: args.range, values: args.values }
    })
    return { content: response.data, status: "SUCCESS" }
  }
)
