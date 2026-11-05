import type { sheets_v4 } from "@googleapis/sheets"
import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { accountSchema, batchRequestsSchema } from "../schemas"
import type { ToolContext } from "./tool-context"

const inputSchema = z.object({
  account: accountSchema,
  spreadsheetId: z.string().min(1).describe("The ID of the spreadsheet to update."),
  requests: batchRequestsSchema,
  writeControl: z
    .object({ requiredRevisionId: z.string().optional().describe("Rejects the write when the revision is stale.") })
    .optional()
    .describe("Controls how the write is applied; { requiredRevisionId?: string }.")
})

export const updateSpreadsheetTool = defineTool(
  "update_spreadsheet",
  {
    title: "Update spreadsheet",
    description: "Applies one or more updates to the spreadsheet.",
    inputSchema,
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    // SAFETY: `requests` is any documented batchUpdate JSON object, which is exactly Schema$Request's wire shape.
    const requests = args.requests as sheets_v4.Schema$Request[]
    const response = await context.sheets(slug).batchUpdate({
      spreadsheetId: args.spreadsheetId,
      requestBody: { requests, writeControl: args.writeControl }
    })
    return { content: response.data, status: "SUCCESS" }
  }
)
