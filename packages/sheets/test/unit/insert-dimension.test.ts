import { stubContext } from "@mcp-gateway/test"
import { afterEach, describe, expect, it } from "vitest"

import { insertDimensionTool } from "../../src/tools/insert-dimension"
import { ToolContext } from "../../src/tools/tool-context"
import { json, onlyRequest, serve } from "../support/provider"

const BATCH_RESPONSE = { spreadsheetId: "sheet-1", replies: [{}] }

let current: ReturnType<typeof serve> | undefined

afterEach(() => {
  current?.restore()
  current = undefined
})

function context() {
  return new ToolContext(stubContext)
}

describe("insert_dimension", () => {
  it("posts exactly one insertDimension built from the fields", async () => {
    current = serve(() => json(BATCH_RESPONSE))

    const result = await insertDimensionTool.handler(
      { spreadsheetId: "sheet-1", sheetId: 0, dimension: "ROWS", startIndex: 2, endIndex: 4, inheritFromBefore: true },
      context()
    )

    const request = onlyRequest(current.seen)
    expect(request.url).toBe("https://www.googleapis.com/v4/spreadsheets/sheet-1:batchUpdate")
    expect(request.method).toBe("POST")

    const body = JSON.parse(request.body)
    expect(body.requests).toHaveLength(1)
    expect(body.requests[0]).toEqual({
      insertDimension: {
        range: { sheetId: 0, dimension: "ROWS", startIndex: 2, endIndex: 4 },
        inheritFromBefore: true
      }
    })
    expect(result).toEqual({ content: BATCH_RESPONSE, status: "SUCCESS" })
  })

  it("accepts DIMENSION_UNSPECIFIED and an omitted inheritFromBefore", async () => {
    current = serve(() => json(BATCH_RESPONSE))

    await insertDimensionTool.handler(
      { spreadsheetId: "sheet-1", sheetId: 0, dimension: "DIMENSION_UNSPECIFIED", startIndex: 0, endIndex: 1 },
      context()
    )

    const request = onlyRequest(current.seen)
    expect(JSON.parse(request.body).requests[0].insertDimension.range.dimension).toBe("DIMENSION_UNSPECIFIED")
    expect(insertDimensionTool.config.inputSchema.safeParse({ sheetId: 0, dimension: "ROWS" }).success).toBe(false)
    expect(
      insertDimensionTool.config.inputSchema.safeParse({
        spreadsheetId: "sheet-1",
        sheetId: 0,
        dimension: "ROWS",
        startIndex: 0,
        endIndex: 1
      }).success
    ).toBe(true)
  })
})
