import { afterEach, describe, expect, it } from "vitest"

import { ToolContext } from "../../src/tools/tool-context"
import { updateFormulasTool } from "../../src/tools/update-formulas"
import { stubContext } from "../support/mcp"
import { json, onlyRequest, serve } from "../support/provider"

const UPDATE_RESPONSE = {
  spreadsheetId: "sheet-1",
  updatedRange: "Sheet1!C1:C2",
  updatedRows: 2,
  updatedColumns: 1,
  updatedCells: 2
}

let current: ReturnType<typeof serve> | undefined

afterEach(() => {
  current?.restore()
  current = undefined
})

function context() {
  return new ToolContext(stubContext)
}

describe("update_formulas", () => {
  it("PUTs USER_ENTERED formulas in the values field and returns the envelope", async () => {
    current = serve(() => json(UPDATE_RESPONSE))

    const formulas = [["=A1+B1"], ["=A2+B2"]]
    const result = await updateFormulasTool.handler(
      { spreadsheetId: "sheet-1", range: "Sheet1!C1:C2", formulas },
      context()
    )

    const request = onlyRequest(current.seen)
    expect(request.url).toBe(
      "https://www.googleapis.com/v4/spreadsheets/sheet-1/values/Sheet1!C1%3AC2?valueInputOption=USER_ENTERED"
    )
    expect(request.method).toBe("PUT")
    expect(JSON.parse(request.body)).toEqual({ range: "Sheet1!C1:C2", values: formulas })
    expect(result).toEqual({ content: UPDATE_RESPONSE, status: "SUCCESS" })
  })
})
