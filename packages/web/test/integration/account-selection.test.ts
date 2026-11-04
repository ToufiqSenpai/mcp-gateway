import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it } from "vitest"

import { createMcpContext } from "../../src/accounts/lifecycle"
import { AccountRepository } from "../../src/db/account-repository"
import { createDb } from "../../src/db/client"
import type { NewAccount } from "../../src/db/schema"

let counter = 0

function account(overrides: Partial<NewAccount> = {}): NewAccount {
  counter += 1
  return {
    id: crypto.randomUUID(),
    mcp: "calendar",
    slug: `account-${counter}`,
    provider: "google",
    providerSubject: `subject-${counter}`,
    email: `operator-${counter}@example.com`,
    displayName: null,
    accessToken: "v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA",
    refreshToken: "v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA",
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    scopes: "openid email profile https://www.googleapis.com/auth/calendar",
    state: "active",
    isDefault: 0,
    cacheEpoch: 0,
    lastRefreshedAt: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

async function insert(row: NewAccount): Promise<void> {
  await new AccountRepository(createDb(env)).insert(row)
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM oauth_states").run()
  await env.DB.prepare("DELETE FROM accounts").run()
})

describe("Account selection", () => {
  it("lists every Account with its default flag and no state", async () => {
    await insert(account({ slug: "personal", isDefault: 1 }))
    await insert(account({ slug: "work" }))

    const ctx = createMcpContext(env, createDb(env), "calendar")
    const accounts = await ctx.listAccounts()
    expect(accounts).toEqual([
      { slug: "personal", isDefault: true },
      { slug: "work", isDefault: false }
    ])
    expect(JSON.stringify(accounts)).not.toContain("state")
  })

  it("fails on a broken Default Account instead of borrowing a healthy one", async () => {
    await insert(account({ slug: "personal", isDefault: 1, state: "needs_reauth" }))
    await insert(account({ slug: "work" }))

    const ctx = createMcpContext(env, createDb(env), "calendar")
    await expect(ctx.getAccessToken("personal")).rejects.toThrow(/personal/)
    await expect(ctx.getAccessToken("personal")).rejects.toThrow(/\/admin\/mcps\/calendar/)
    await expect(ctx.getAccessToken("personal")).rejects.toThrow(/needs_reauth/)
  })

  it("fails on an unknown slug and names it", async () => {
    await insert(account({ slug: "personal", isDefault: 1 }))
    const ctx = createMcpContext(env, createDb(env), "calendar")
    await expect(ctx.getAccessToken("ghost")).rejects.toThrow(/ghost/)
  })

  it("demotes an Account whose stored scopes no longer cover the Required set", async () => {
    await insert(account({ slug: "personal", isDefault: 1, scopes: "openid email profile" }))
    const db = createDb(env)
    const ctx = createMcpContext(env, db, "calendar")

    await expect(ctx.getAccessToken("personal")).rejects.toThrow(/missing_scope/)
    const row = await new AccountRepository(db).findBySlug("calendar", "personal")
    expect(row?.state).toBe("needs_reauth")
    expect(row?.lastError).toBe("missing_scope")
  })

  it("keeps exactly one default per MCP and moves it in one batch", async () => {
    await insert(account({ slug: "personal", isDefault: 1 }))
    await insert(account({ slug: "work" }))
    const db = createDb(env)
    const work = await new AccountRepository(db).findBySlug("calendar", "work")
    if (!work) throw new Error("missing")

    await new AccountRepository(db).setDefault("calendar", work.id)

    const personal = await new AccountRepository(db).findBySlug("calendar", "personal")
    expect(personal?.isDefault).toBe(0)
    expect((await new AccountRepository(db).findBySlug("calendar", "work"))?.isDefault).toBe(1)
  })

  it("reports per-state counts for the admin list", async () => {
    await insert(account({ slug: "a" }))
    await insert(account({ slug: "b", state: "needs_reauth" }))
    await insert(account({ slug: "c", state: "revoked" }))

    const counts = await new AccountRepository(createDb(env)).countByState("calendar")
    expect(counts).toEqual({ active: 1, needs_reauth: 1, revoked: 1 })
  })

  it("bumps cache_epoch on a state change", async () => {
    await insert(account({ slug: "a" }))
    const db = createDb(env)
    const row = await new AccountRepository(db).findBySlug("calendar", "a")
    if (!row) throw new Error("missing")

    await new AccountRepository(db).update(row.id, { state: "needs_reauth" })

    await new AccountRepository(db).bumpCacheEpoch(row.id)
    expect((await new AccountRepository(db).findBySlug("calendar", "a"))?.cacheEpoch).toBe(1)
  })
})
