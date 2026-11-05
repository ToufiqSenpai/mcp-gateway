import type { MetaValue } from "@mcp-gateway/common"
import { afterEach, describe, expect, it } from "vitest"

import { ToolContext } from "../../src/tools/tool-context"
import { updateSpreadsheetTool } from "../../src/tools/update-spreadsheet"
import { stubContext } from "../support/mcp"
import { json, onlyRequest, serve } from "../support/provider"

const BATCH_RESPONSE = { spreadsheetId: "sheet-1", replies: [{}, {}] }

const REQUESTS: MetaValue[] = [
  { addSheet: { properties: { title: "Archive" } } },
  { repeatCell: { range: { sheetId: 0 }, cell: { userEnteredFormat: { textFormat: { bold: true } } } } }
]

let current: ReturnType<typeof serve> | undefined

afterEach(() => {
  current?.restore()
  current = undefined
})

function context() {
  return new ToolContext(stubContext)
}

describe("update_spreadsheet", () => {
  it("posts the requests unchanged with writeControl and returns the envelope", async () => {
    current = serve(() => json(BATCH_RESPONSE))

    const result = await updateSpreadsheetTool.handler(
      { spreadsheetId: "sheet-1", requests: REQUESTS, writeControl: { requiredRevisionId: "rev-7" } },
      context()
    )

    const request = onlyRequest(current.seen)
    expect(request.url).toBe("https://www.googleapis.com/v4/spreadsheets/sheet-1:batchUpdate")
    expect(request.method).toBe("POST")
    expect(JSON.parse(request.body)).toEqual({ requests: REQUESTS, writeControl: { requiredRevisionId: "rev-7" } })
    expect(result).toEqual({ content: BATCH_RESPONSE, status: "SUCCESS" })
  })

  it("omits writeControl when the caller does not set it", async () => {
    current = serve(() => json(BATCH_RESPONSE))

    await updateSpreadsheetTool.handler({ spreadsheetId: "sheet-1", requests: REQUESTS }, context())

    expect(JSON.parse(onlyRequest(current.seen).body)).toEqual({ requests: REQUESTS })
  })
})
