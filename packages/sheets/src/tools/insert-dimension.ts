import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { accountSchema } from "../schemas"
import type { ToolContext } from "./tool-context"

const inputSchema = z.object({
  account: accountSchema,
  spreadsheetId: z.string().min(1).describe("The ID of the spreadsheet to update."),
  sheetId: z.number().int().describe("The sheet to insert into."),
  dimension: z
    .enum(["ROWS", "COLUMNS", "DIMENSION_UNSPECIFIED"])
    .describe("The dimension to insert: ROWS, COLUMNS or DIMENSION_UNSPECIFIED."),
  startIndex: z.number().int().describe("0-based index of the first row or column to insert, inclusive."),
  endIndex: z.number().int().describe("0-based index of the last row or column to insert, exclusive."),
  inheritFromBefore: z
    .boolean()
    .optional()
    .describe("Whether to inherit from the row or column before; true requires startIndex > 0.")
})

export const insertDimensionTool = defineTool(
  "insert_dimension",
  {
    title: "Insert dimension",
    description: "Inserts rows or columns in a sheet at a particular index.",
    inputSchema,
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const response = await context.sheets(slug).spreadsheets.batchUpdate({
      spreadsheetId: args.spreadsheetId,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: {
                sheetId: args.sheetId,
                dimension: args.dimension,
                startIndex: args.startIndex,
                endIndex: args.endIndex
              },
              inheritFromBefore: args.inheritFromBefore
            }
          }
        ]
      }
    })
    return { content: response.data, status: "SUCCESS" }
  }
)
