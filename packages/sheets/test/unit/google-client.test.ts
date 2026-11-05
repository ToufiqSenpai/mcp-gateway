import type { McpContext } from "@mcp-gateway/common"
import { stubContext } from "@mcp-gateway/test"
import { afterEach, describe, expect, it } from "vitest"

import { GoogleSheets } from "../../src/client"
import { json, serve } from "../support/provider"

let current: ReturnType<typeof serve> | undefined

afterEach(() => {
  current?.restore()
  current = undefined
})

function countingContext() {
  let accessTokens = 0
  let refreshes = 0
  const ctx: McpContext = {
    ...stubContext,
    getAccessToken() {
      accessTokens += 1
      return Promise.resolve("expired-token")
    },
    refreshAccessToken() {
      refreshes += 1
      return Promise.resolve("fresh-token")
    }
  }
  return { ctx, accessTokens: () => accessTokens, refreshes: () => refreshes }
}

describe("Google token reuse", () => {
  it("reads one token per instance and keeps the refreshed token", async () => {
    current = serve(request =>
      request.headers.get("authorization") === "Bearer expired-token"
        ? json({ error: { message: "expired" } }, 401)
        : json({ values: [] })
    )
    const tokens = countingContext()
    const client = new GoogleSheets(tokens.ctx, "personal")

    await client.getValues({ spreadsheetId: "sheet-1", range: "Sheet1!A1" })
    await client.getValues({ spreadsheetId: "sheet-1", range: "Sheet1!A1" })

    expect(tokens.accessTokens()).toBe(1)
    expect(tokens.refreshes()).toBe(1)
    expect(current.seen.map(request => request.authorization)).toEqual([
      "Bearer expired-token",
      "Bearer fresh-token",
      "Bearer fresh-token"
    ])
  })
})
