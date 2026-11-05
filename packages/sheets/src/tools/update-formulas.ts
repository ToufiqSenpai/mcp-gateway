import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { accountSchema, formulaRowsSchema } from "../schemas"
import type { ToolContext } from "./tool-context"

const inputSchema = z.object({
  account: accountSchema,
  spreadsheetId: z.string().min(1).describe("The ID of the spreadsheet to update."),
  range: z.string().min(1).describe("The A1 notation of the range to update, for example 'Sheet1!C1:C2'."),
  formulas: formulaRowsSchema
})

export const updateFormulasTool = defineTool(
  "update_formulas",
  {
    title: "Update formulas",
    description: "Sets formulas in a range of a spreadsheet.",
    inputSchema,
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const response = await context.sheets(slug).values.update({
      spreadsheetId: args.spreadsheetId,
      range: args.range,
      valueInputOption: "USER_ENTERED",
      requestBody: { range: args.range, values: args.formulas }
    })
    return { content: response.data, status: "SUCCESS" }
  }
)
