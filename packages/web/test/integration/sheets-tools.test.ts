import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { TestBrowser, csrfFromPage } from "../support/access"
import { ACCESS_TOKEN, CODE, lastSheetsRequest } from "../support/providers"
import { ToolCallResult, rpc, type RpcRequest } from "../support/rpc"

const ValueRange = z
  .object({
    range: z.string(),
    values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
  })
  .loose()

const Spreadsheet = z
  .object({
    spreadsheetId: z.string(),
    spreadsheetUrl: z.string().optional(),
    properties: z.object({ title: z.string() }).loose().optional()
  })
  .loose()

const ContentEnvelope = z.object({ content: Spreadsheet, status: z.literal("SUCCESS") }).loose()

const UpdateValuesResponse = z
  .object({
    spreadsheetId: z.string(),
    updatedRange: z.string(),
    updatedRows: z.number(),
    updatedColumns: z.number(),
    updatedCells: z.number()
  })
  .loose()

const BatchUpdateResponse = z.object({ spreadsheetId: z.string(), replies: z.array(z.object({}).loose()) }).loose()

/** The tool arguments as a JSON-RPC request carries them. */
type ToolArguments = NonNullable<RpcRequest["params"]>["arguments"]

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM oauth_states").run()
  await env.DB.prepare("DELETE FROM accounts").run()
})

/** The admin OAuth flow, exactly as an operator runs it, for a `sheets` Account. */
async function addSheetsAccount(slug = "personal"): Promise<void> {
  const browser = new TestBrowser()
  const csrf = await csrfFromPage(browser, "/admin/mcps/sheets")
  const start = await browser.postForm("/admin/mcps/sheets/accounts", { _csrf: csrf, slug })
  expect(start.status).toBe(303)

  const authorize = new URL(start.headers.get("location") ?? "")
  expect(authorize.origin).toBe("https://accounts.google.com")
  expect(authorize.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/spreadsheets")
  expect(authorize.searchParams.get("scope")).not.toContain("/auth/drive")

  const state = authorize.searchParams.get("state") ?? ""
  const callback = await browser.get(`/oauth/callback/google?state=${encodeURIComponent(state)}&code=${CODE.googleOk}`)
  expect(callback.status).toBe(303)
  expect(new URL(callback.headers.get("location") ?? "", "https://gateway.example.com").pathname).toBe(
    "/admin/mcps/sheets"
  )
}

async function callTool(name: string, args: ToolArguments): Promise<z.infer<typeof ToolCallResult>> {
  const reply = await rpc({ method: "tools/call", params: { name, arguments: args } }, { slug: "sheets" })
  expect(reply.status).toBe(200)
  return ToolCallResult.parse(reply.reply.result)
}

function body<T extends z.ZodType>(result: z.infer<typeof ToolCallResult>, schema: T): z.infer<T> {
  const text = result.content?.[0]?.text ?? "{}"
  return schema.parse(JSON.parse(text))
}

describe("sheets tools", () => {
  it("reads a range through the Account's bearer token", async () => {
    await addSheetsAccount()

    const result = await callTool("get_values", { spreadsheetId: "sheet-1", range: "Sheet1!A1:B10" })

    expect(result.isError).toBeUndefined()
    const valueRange = body(result, ValueRange)
    expect(valueRange.range).toBe("Sheet1!A1:B10")
    expect(valueRange.values).toEqual([
      ["Item", "Qty"],
      ["Widget", 2]
    ])

    expect(lastSheetsRequest.url).toBe("https://www.googleapis.com/v4/spreadsheets/sheet-1/values/Sheet1!A1%3AB10")
    expect(lastSheetsRequest.method).toBe("GET")
    expect(lastSheetsRequest.authorization).toBe(`Bearer ${ACCESS_TOKEN.googleOk}`)
  })

  it("creates a spreadsheet and immediately reads it back", async () => {
    await addSheetsAccount()

    const created = await callTool("create_spreadsheet", { title: "Ledger" })
    expect(created.isError).toBeUndefined()
    const envelope = body(created, ContentEnvelope)

    expect(lastSheetsRequest.url).toBe("https://www.googleapis.com/v4/spreadsheets")
    expect(lastSheetsRequest.method).toBe("POST")
    expect(lastSheetsRequest.url).not.toContain("/drive/")
    expect(JSON.parse(lastSheetsRequest.body)).toEqual({ properties: { title: "Ledger" } })

    const read = await callTool("get_spreadsheet", {
      spreadsheetId: envelope.content.spreadsheetId
    })

    expect(read.isError).toBeUndefined()
    const spreadsheet = body(read, z.object({ content: Spreadsheet }).loose())
    expect(spreadsheet.content.spreadsheetId).toBe(envelope.content.spreadsheetId)
  })

  it("writes values and reads the range back", async () => {
    await addSheetsAccount()

    const values = [
      ["Widget", 2],
      [null, ""]
    ]
    const updated = await callTool("update_values", { spreadsheetId: "sheet-1", range: "Sheet1!A1:B2", values })
    expect(updated.isError).toBeUndefined()
    const envelope = body(updated, z.object({ content: UpdateValuesResponse, status: z.literal("SUCCESS") }).loose())
    expect(envelope.content.updatedCells).toBe(4)

    const write = { ...lastSheetsRequest }
    expect(write.url).toBe(
      "https://www.googleapis.com/v4/spreadsheets/sheet-1/values/Sheet1!A1%3AB2?valueInputOption=RAW"
    )
    expect(write.method).toBe("PUT")
    expect(write.authorization).toBe(`Bearer ${ACCESS_TOKEN.googleOk}`)
    expect(JSON.parse(write.body)).toEqual({ range: "Sheet1!A1:B2", values })

    const read = await callTool("get_values", { spreadsheetId: "sheet-1", range: "Sheet1!A1:B2" })
    expect(read.isError).toBeUndefined()
    expect(lastSheetsRequest.method).toBe("GET")
    expect(body(read, ValueRange).range).toBe("Sheet1!A1:B10")
  })

  it("applies a batch update and inserts a dimension", async () => {
    await addSheetsAccount()

    const requests = [{ addSheet: { properties: { title: "Archive" } } }]
    const batch = await callTool("update_spreadsheet", {
      spreadsheetId: "sheet-1",
      requests,
      writeControl: { requiredRevisionId: "rev-7" }
    })
    expect(batch.isError).toBeUndefined()
    const envelope = body(batch, z.object({ content: BatchUpdateResponse, status: z.literal("SUCCESS") }).loose())
    expect(envelope.content.replies).toEqual([{}])
    expect(lastSheetsRequest.url).toBe("https://www.googleapis.com/v4/spreadsheets/sheet-1:batchUpdate")
    expect(lastSheetsRequest.method).toBe("POST")
    expect(JSON.parse(lastSheetsRequest.body)).toEqual({
      requests,
      writeControl: { requiredRevisionId: "rev-7" }
    })

    const inserted = await callTool("insert_dimension", {
      spreadsheetId: "sheet-1",
      sheetId: 0,
      dimension: "ROWS",
      startIndex: 2,
      endIndex: 4
    })
    expect(inserted.isError).toBeUndefined()
    expect(body(inserted, z.object({ content: BatchUpdateResponse }).loose()).content.replies).toEqual([{}])
    expect(lastSheetsRequest.url).toBe("https://www.googleapis.com/v4/spreadsheets/sheet-1:batchUpdate")
    expect(JSON.parse(lastSheetsRequest.body)).toEqual({
      requests: [{ insertDimension: { range: { sheetId: 0, dimension: "ROWS", startIndex: 2, endIndex: 4 } } }]
    })
  })
})
