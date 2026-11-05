import { stubContext } from "@mcp-gateway/test"
import { afterEach, describe, expect, it } from "vitest"

import { getValuesTool } from "../../src/tools/get-values"
import { ToolContext } from "../../src/tools/tool-context"
import { json, onlyRequest, serve } from "../support/provider"

const VALUE_RANGE = {
  range: "Sheet1!A1:B10",
  majorDimension: "ROWS",
  values: [
    ["Item", "Qty"],
    ["Widget", 2]
  ]
}

let current: ReturnType<typeof serve> | undefined

afterEach(() => {
  current?.restore()
  current = undefined
})

describe("get_values", () => {
  it("encodes both path segments, sends no query and returns the ValueRange unwrapped", async () => {
    current = serve(() => json(VALUE_RANGE))

    const result = await getValuesTool.handler(
      { spreadsheetId: "id/with+chars", range: "Sheet1!A1:B10" },
      new ToolContext(stubContext)
    )

    const request = onlyRequest(current.seen)
    expect(request.url).toBe("https://www.googleapis.com/v4/spreadsheets/id%2Fwith%2Bchars/values/Sheet1!A1%3AB10")
    expect(request.method).toBe("GET")
    expect(new URL(request.url).search).toBe("")
    expect(request.authorization).toBe("Bearer test-access-token")
    expect(result).toEqual(VALUE_RANGE)
  })
})
