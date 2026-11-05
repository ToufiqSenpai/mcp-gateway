import { afterEach, describe, expect, it } from "vitest"

import { getSpreadsheetTool } from "../../src/tools/get-spreadsheet"
import { ToolContext } from "../../src/tools/tool-context"
import { stubContext } from "../support/mcp"
import { json, onlyRequest, serve } from "../support/provider"

const SPREADSHEET = {
  spreadsheetId: "sheet-1",
  properties: { title: "Ledger", locale: "en_US" },
  sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }]
}

let current: ReturnType<typeof serve> | undefined

afterEach(() => {
  current?.restore()
  current = undefined
})

function context() {
  return new ToolContext(stubContext)
}

describe("get_spreadsheet", () => {
  it("joins fields with a comma and repeats every range", async () => {
    current = serve(() => json(SPREADSHEET))

    const result = await getSpreadsheetTool.handler(
      {
        spreadsheetId: "sheet-1",
        includeGridData: true,
        fields: ["sheets.properties.sheetId", "properties.title"],
        commentsIncluded: true,
        ranges: ["Sheet1!A1:B10", "Sheet2!A1:A2"]
      },
      context()
    )

    const url = new URL(onlyRequest(current.seen).url)
    expect(url.pathname).toBe("/v4/spreadsheets/sheet-1")
    expect(url.searchParams.get("fields")).toBe("sheets.properties.sheetId,properties.title")
    expect(url.searchParams.getAll("ranges")).toEqual(["Sheet1!A1:B10", "Sheet2!A1:A2"])
    expect(url.searchParams.get("includeGridData")).toBe("true")
    expect(url.searchParams.get("commentsIncluded")).toBe("true")
    expect(result).toEqual({ content: SPREADSHEET })
  })

  it("omits the optional query parameters when they are unset", async () => {
    current = serve(() => json(SPREADSHEET))

    const result = await getSpreadsheetTool.handler({ spreadsheetId: "sheet-1" }, context())

    const url = new URL(onlyRequest(current.seen).url)
    expect(url.search).toBe("")
    expect(url.searchParams.has("includeGridData")).toBe(false)
    expect(url.searchParams.has("commentsIncluded")).toBe(false)
    expect(url.searchParams.has("fields")).toBe(false)
    expect(url.searchParams.has("ranges")).toBe(false)
    expect(result).toEqual({ content: SPREADSHEET })
  })
})
