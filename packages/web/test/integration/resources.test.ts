import { REQUIRED_SCOPES } from "@mcp-gateway/calendar"
import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { TokenCipher } from "../../src/auth/crypto"
import { AccountRepository } from "../../src/db/account-repository"
import { nowSeconds } from "../../src/db/client"
import { counters, resetProviderCounters } from "../support/providers"
import { rpc } from "../support/rpc"

const cipher = new TokenCipher(env.TOKEN_ENCRYPTION_KEY)

const Resource = z.object({ uri: z.string(), name: z.string(), mimeType: z.string() }).loose()

const ListResult = z
  .object({
    resultType: z.string().optional(),
    resources: z.array(Resource),
    ttlMs: z.number().optional(),
    cacheScope: z.string().optional(),
    _meta: z.record(z.string(), z.json()).optional()
  })
  .loose()

const ReadResult = z
  .object({
    contents: z.array(z.object({ uri: z.string(), mimeType: z.string(), text: z.string().optional() }).loose()),
    ttlMs: z.number().optional()
  })
  .loose()

const CalendarBody = z
  .object({
    account: z.string(),
    calendar: z.object({ id: z.string() }).loose(),
    window: z.object({ start: z.string(), end: z.string() }).loose(),
    events: z.array(z.object({ summary: z.string().optional() }).loose()),
    truncated: z.boolean()
  })
  .loose()

const ErrorReply = z
  .object({
    code: z.number(),
    message: z.string().optional(),
    data: z.object({ uri: z.string().optional() }).loose().optional()
  })
  .loose()

const ToolCallResult = z
  .object({
    isError: z.boolean().optional(),
    content: z.array(z.object({ text: z.string().optional() }).loose()).optional(),
    _meta: z.record(z.string(), z.json()).optional()
  })
  .loose()

const CalendarListBody = z.object({ calendars: z.array(z.object({ summary: z.string().optional() }).loose()) }).loose()

async function seedAccount(
  state: "active" | "needs_reauth" = "active",
  cacheEpoch = 0,
  slug = "personal",
  providerSubject = "subject-1",
  isDefault = 1
): Promise<string> {
  const id = crypto.randomUUID()
  await new AccountRepository(env).insert({
    id,
    mcp: "calendar",
    slug,
    provider: "google",
    providerSubject,
    email: "operator@example.com",
    accessToken: await cipher.encrypt("ya29.access-one", id, "access_token"),
    refreshToken: await cipher.encrypt("1//refresh-one", id, "refresh_token"),
    accessTokenExpiresAt: nowSeconds() + 3600,
    scopes: REQUIRED_SCOPES.join(" "),
    state,
    isDefault,
    cacheEpoch,
    lastError: state === "needs_reauth" ? "invalid_grant" : null,
    createdAt: 0,
    updatedAt: 0
  })
  return id
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM oauth_states").run()
  await env.DB.prepare("DELETE FROM accounts").run()
  await env.CACHE.delete("v1:enum:calendar:personal:0")
  await env.CACHE.delete("v1:enum:calendar:personal:1")
})

describe("calendar resources", () => {
  it("returns an empty list, never an error, when there are no Accounts", async () => {
    const reply = await rpc({ method: "resources/list", params: {} })
    const result = ListResult.parse(reply.reply.result)
    expect(result.resources).toEqual([])
    expect(result.resultType).toBe("complete")
  })

  it("lists one resource per calendar per usable Account", async () => {
    await seedAccount()
    const reply = await rpc({ method: "resources/list", params: {} })
    const result = ListResult.parse(reply.reply.result)

    const uris = result.resources.map(resource => resource.uri)
    expect(uris).toContain("calendar://personal/calendars/primary")
    expect(uris).toContain("calendar://personal/calendars/team%40example.com")
    expect(result.resources.every(resource => resource.mimeType === "application/json")).toBe(true)
    expect(result.ttlMs).toBe(300_000)
    expect(result.cacheScope).toBe("private")
  })

  it("skips a sick Account, says so, and marks the listing uncacheable", async () => {
    await seedAccount("needs_reauth", 1)
    const reply = await rpc({ method: "resources/list", params: {} })
    const result = ListResult.parse(reply.reply.result)

    expect(result.resources).toEqual([])
    expect(result.ttlMs).toBe(0)
    expect(result._meta?.["mcp-gateway/skippedAccounts"]).toEqual(["personal"])
  })

  it("reads one calendar resource with a fixed one-week window", async () => {
    await seedAccount()
    const reply = await rpc({
      method: "resources/read",
      params: { uri: "calendar://personal/calendars/primary" }
    })
    const result = ReadResult.parse(reply.reply.result)

    expect(result.contents).toHaveLength(1)
    expect(result.contents[0]?.mimeType).toBe("application/json")
    const body = CalendarBody.parse(JSON.parse(result.contents[0]?.text ?? "{}"))
    expect(body.account).toBe("personal")
    expect(body.calendar.id).toBe("primary")
    expect(Date.parse(body.window.end) - Date.parse(body.window.start)).toBe(7 * 24 * 3600 * 1000)
    expect(body.events[0]?.summary).toBe("Standup")
    expect(body.truncated).toBe(false)
    expect(result.ttlMs).toBe(30_000)
  })

  it("answers an unknown container with -32602 carrying data.uri", async () => {
    await seedAccount()
    const reply = await rpc({
      method: "resources/read",
      params: { uri: "calendar://personal/calendars/does-not-exist" }
    })
    const error = ErrorReply.parse(reply.reply.error)

    expect(error.code).toBe(-32602)
    expect(error.data?.uri).toBe("calendar://personal/calendars/does-not-exist")
  })

  it("answers a sick Account with -32603 naming it, not a not-found", async () => {
    await seedAccount()
    await seedAccount("needs_reauth", 0, "work", "subject-2", 0)
    const reply = await rpc({
      method: "resources/read",
      params: { uri: "calendar://work/calendars/primary" }
    })
    const error = ErrorReply.parse(reply.reply.error)

    expect(error.code).toBe(-32603)
    expect(error.message).toContain("work")
  })

  it("names the skipped Account in a list_calendars tool result", async () => {
    await seedAccount()
    await seedAccount("needs_reauth", 0, "work", "subject-2", 0)
    const reply = await rpc({
      method: "tools/call",
      params: { name: "list_calendars", arguments: {} }
    })
    const result = ToolCallResult.parse(reply.reply.result)

    expect(result.isError).toBeUndefined()
    expect(result._meta?.["mcp-gateway/skippedAccounts"]).toEqual(["work"])
    const body = CalendarListBody.parse(JSON.parse(result.content?.[0]?.text ?? "{}"))
    expect(body.calendars.map(calendar => calendar.summary)).toContain("Primary")
  })

  it("serves the second enumeration from KV and misses again after an epoch bump", async () => {
    const id = await seedAccount()
    await env.CACHE.delete("v1:enum:calendar:personal:0")
    resetProviderCounters()

    await rpc({ method: "resources/list", params: {} })
    expect(counters.googleCalendarListRequests).toBe(1)

    await rpc({ method: "resources/list", params: {} })
    expect(counters.googleCalendarListRequests).toBe(1)

    await new AccountRepository(env).update(id, { cacheEpoch: 1 })
    await rpc({ method: "resources/list", params: {} })
    expect(counters.googleCalendarListRequests).toBe(2)
  })
})
