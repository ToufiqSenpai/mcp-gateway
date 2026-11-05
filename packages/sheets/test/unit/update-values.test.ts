import { afterEach, describe, expect, it } from "vitest"

import { valueRowsSchema } from "../../src/schemas"
import { ToolContext } from "../../src/tools/tool-context"
import { updateValuesTool } from "../../src/tools/update-values"
import { stubContext } from "../support/mcp"
import { json, onlyRequest, serve } from "../support/provider"

const UPDATE_RESPONSE = {
  spreadsheetId: "sheet-1",
  updatedRange: "Sheet1!A1:B2",
  updatedRows: 2,
  updatedColumns: 2,
  updatedCells: 4
}

let current: ReturnType<typeof serve> | undefined

afterEach(() => {
  current?.restore()
  current = undefined
})

function context() {
  return new ToolContext(stubContext)
}

describe("update_values", () => {
  it("PUTs RAW values with null preserved for Google to skip", async () => {
    current = serve(() => json(UPDATE_RESPONSE))

    const values = [
      ["Widget", 2],
      [null, ""]
    ]
    const result = await updateValuesTool.handler(
      { spreadsheetId: "sheet-1", range: "Sheet1!A1:B2", values },
      context()
    )

    const request = onlyRequest(current.seen)
    expect(request.url).toBe(
      "https://www.googleapis.com/v4/spreadsheets/sheet-1/values/Sheet1!A1%3AB2?valueInputOption=RAW"
    )
    expect(request.method).toBe("PUT")
    expect(request.authorization).toBe("Bearer test-access-token")
    expect(JSON.parse(request.body)).toEqual({ range: "Sheet1!A1:B2", values })
    expect(result).toEqual({ content: UPDATE_RESPONSE, status: "SUCCESS" })
  })

  it("rejects non-scalar cells in the schema", () => {
    expect(valueRowsSchema.safeParse([["ok", 1, true, null]]).success).toBe(true)
    expect(valueRowsSchema.safeParse([[{ nested: true }]]).success).toBe(false)
    expect(valueRowsSchema.safeParse([[[1, 2]]]).success).toBe(false)
  })
})
