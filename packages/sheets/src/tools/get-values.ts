import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { accountSchema } from "../schemas"
import type { ToolContext } from "./tool-context"

const inputSchema = z.object({
  account: accountSchema,
  spreadsheetId: z.string().min(1).describe("The ID of the spreadsheet to retrieve data from."),
  range: z
    .string()
    .min(1)
    .describe("The A1 notation or R1C1 notation of the range to retrieve values from, for example 'Sheet1!A1:B10'.")
})

export const getValuesTool = defineTool(
  "get_values",
  {
    title: "Get values",
    description: "Returns a range of values from a spreadsheet.",
    inputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const response = await context.sheets(slug).getValues({
      spreadsheetId: args.spreadsheetId,
      range: args.range
    })
    return response.data
  }
)
