import { stubContext } from "@mcp-gateway/test"
import { afterEach, describe, expect, it } from "vitest"

import { createSpreadsheetTool } from "../../src/tools/create-spreadsheet"
import { ToolContext } from "../../src/tools/tool-context"
import { json, onlyRequest, serve } from "../support/provider"

const SPREADSHEET = {
  spreadsheetId: "created-sheet",
  spreadsheetUrl: "https://docs.google.com/spreadsheets/d/created-sheet/edit",
  properties: { title: "Ledger" }
}

let current: ReturnType<typeof serve> | undefined

afterEach(() => {
  current?.restore()
  current = undefined
})

function context() {
  return new ToolContext(stubContext)
}

describe("create_spreadsheet", () => {
  it("posts the title as properties.title and returns the content envelope", async () => {
    current = serve(() => json(SPREADSHEET))

    const result = await createSpreadsheetTool.handler({ title: "Ledger" }, context())

    const request = onlyRequest(current.seen)
    expect(request.url).toBe("https://www.googleapis.com/v4/spreadsheets")
    expect(request.method).toBe("POST")
    expect(JSON.parse(request.body)).toEqual({ properties: { title: "Ledger" } })
    expect(result).toEqual({ content: SPREADSHEET, status: "SUCCESS" })
  })

  it("sends no properties for an empty or omitted title", async () => {
    current = serve(() => json(SPREADSHEET))

    await createSpreadsheetTool.handler({ title: "" }, context())
    await createSpreadsheetTool.handler({}, context())

    expect(current.seen.map(request => JSON.parse(request.body))).toEqual([{}, {}])
  })
})
