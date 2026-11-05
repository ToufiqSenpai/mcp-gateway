import { REQUIRED_SCOPES } from "@mcp-gateway/calendar"
import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it } from "vitest"

import { createMcpContext } from "../../src/accounts/lifecycle"
import { TokenCipher } from "../../src/auth/crypto"
import { AccountRepository } from "../../src/db/account-repository"
import { nowSeconds } from "../../src/db/client"
import type { NewAccount } from "../../src/db/schema"
import { REFRESH_TOKEN, counters, lastTokenRequest, resetProviderCounters } from "../support/providers"

const cipher = new TokenCipher(env.TOKEN_ENCRYPTION_KEY)

interface SeedOptions {
  expiresInSeconds?: number
  refreshToken?: string
  scopes?: string
  lock?: boolean
}

async function seed(options: SeedOptions = {}): Promise<string> {
  const id = crypto.randomUUID()
  const expiresIn = options.expiresInSeconds ?? 30
  const lock = options.lock ?? false

  const account: NewAccount = {
    id,
    mcp: "calendar",
    slug: "personal",
    provider: "google",
    providerSubject: "subject-1",
    email: "operator@example.com",
    accessToken: await cipher.encrypt("ya29.access-one", id, "access_token"),
    refreshToken: await cipher.encrypt(options.refreshToken ?? REFRESH_TOKEN.googleOk, id, "refresh_token"),
    accessTokenExpiresAt: nowSeconds() + expiresIn,
    scopes: options.scopes ?? REQUIRED_SCOPES.join(" "),
    state: "active",
    isDefault: 1,
    createdAt: 0,
    updatedAt: 0
  }
  if (lock) {
    account.refreshLockUntil = nowSeconds() + 30
    account.refreshLockToken = "someone-else"
  }
  await new AccountRepository(env).insert(account)
  return id
}

beforeEach(async () => {
  resetProviderCounters()
  await env.DB.prepare("DELETE FROM oauth_states").run()
  await env.DB.prepare("DELETE FROM accounts").run()
})

describe("single-flight refresh", () => {
  it("refreshes once for three simultaneous calls and rotates the refresh token", async () => {
    await seed({ expiresInSeconds: 30 })
    const ctx = createMcpContext(env, "calendar")

    const before = await new AccountRepository(env).findBySlug("calendar", "personal")
    const tokens = await Promise.all([
      ctx.getAccessToken("personal"),
      ctx.getAccessToken("personal"),
      ctx.getAccessToken("personal")
    ])

    expect(tokens).toEqual(["ya29.access-one", "ya29.access-one", "ya29.access-one"])
    expect(counters.googleRefreshRequests).toBe(1)
    expect(lastTokenRequest.body?.get("grant_type")).toBe("refresh_token")
    expect(lastTokenRequest.body?.get("refresh_token")).toBe(REFRESH_TOKEN.googleOk)

    const after = await new AccountRepository(env).findBySlug("calendar", "personal")
    expect(after?.accessTokenExpiresAt).toBeGreaterThan(before?.accessTokenExpiresAt ?? 0)
    expect(after?.refreshToken).not.toBe(before?.refreshToken)
    expect(after?.lastRefreshedAt).toBeGreaterThan(0)
    expect(after?.refreshLockUntil).toBeNull()
  })

  it("keeps the old refresh token when the Provider omits a rotation", async () => {
    const id = await seed({ expiresInSeconds: 30, refreshToken: REFRESH_TOKEN.noScope })
    const ctx = createMcpContext(env, "calendar")
    const before = await new AccountRepository(env).findBySlug("calendar", "personal")

    await ctx.getAccessToken("personal")

    const after = await new AccountRepository(env).findBySlug("calendar", "personal")
    expect(after?.refreshToken).not.toBe(before?.refreshToken)
    expect(after?.state).toBe("active")
    expect(await cipher.decrypt(after?.refreshToken ?? "", id, "refresh_token")).toBe(
      `${REFRESH_TOKEN.noScope}-rotated`
    )
  })

  it("takes over an expired lease left by a dead Worker", async () => {
    const id = await seed({ expiresInSeconds: 30 })
    await new AccountRepository(env).update(id, { refreshLockUntil: nowSeconds() - 1, refreshLockToken: "dead" })

    await createMcpContext(env, "calendar").getAccessToken("personal")
    expect(counters.googleRefreshRequests).toBe(1)
    expect((await new AccountRepository(env).findBySlug("calendar", "personal"))?.refreshLockUntil).toBeNull()
  })

  it("persists only while the writer still owns the lease", async () => {
    const id = await seed({ expiresInSeconds: 3600 })
    await new AccountRepository(env).claimRefreshLock(id, "mine")

    const lost = await new AccountRepository(env).persistRefreshedTokens(id, "not-mine", {
      accessToken: "v1.x.y",
      refreshToken: "v1.x.y",
      accessTokenExpiresAt: nowSeconds() + 3600,
      lastRefreshedAt: nowSeconds()
    })
    expect(lost).toBe(false)

    const won = await new AccountRepository(env).persistRefreshedTokens(id, "mine", {
      accessToken: "v1.x.y",
      refreshToken: "v1.x.y",
      accessTokenExpiresAt: nowSeconds() + 3600,
      lastRefreshedAt: nowSeconds()
    })
    expect(won).toBe(true)
  })

  it("uses a fresh cached token without calling the Provider", async () => {
    await seed({ expiresInSeconds: 3600 })
    const ctx = createMcpContext(env, "calendar")

    await expect(ctx.getAccessToken("personal")).resolves.toBe("ya29.access-one")
    expect(counters.googleRefreshRequests).toBe(0)
  })
})

describe("refresh failure mapping", () => {
  it("demotes on invalid_grant", async () => {
    await seed({ expiresInSeconds: 30, refreshToken: REFRESH_TOKEN.invalid })

    await expect(createMcpContext(env, "calendar").getAccessToken("personal")).rejects.toThrow(/needs_reauth/)

    const row = await new AccountRepository(env).findBySlug("calendar", "personal")
    expect(row?.state).toBe("needs_reauth")
    expect(row?.lastError).toBe("invalid_grant")
    expect(row?.refreshLockUntil).toBeNull()
  })

  it("records a transient failure without touching state", async () => {
    await seed({ expiresInSeconds: 30, refreshToken: REFRESH_TOKEN.serverError })

    // The old token still has life left, so the call proceeds with it.
    await expect(createMcpContext(env, "calendar").getAccessToken("personal")).resolves.toBe("ya29.access-one")

    const row = await new AccountRepository(env).findBySlug("calendar", "personal")
    expect(row?.state).toBe("active")
    expect(row?.lastError).toBe("temporarily_unavailable")
    expect(row?.refreshLockUntil).toBeNull()
  })

  it("proceeds with a still-valid token when the pre-emptive refresh fails", async () => {
    await seed({ expiresInSeconds: 30, refreshToken: REFRESH_TOKEN.serverError })

    await expect(createMcpContext(env, "calendar").getAccessToken("personal")).resolves.toBe("ya29.access-one")

    const row = await new AccountRepository(env).findBySlug("calendar", "personal")
    expect(row?.state).toBe("active")
  })
})

describe("scope enforcement at refresh", () => {
  it("demotes when the rotated Granted set stops covering the Required set", async () => {
    await seed({ expiresInSeconds: 30, refreshToken: REFRESH_TOKEN.narrowScope })

    await expect(createMcpContext(env, "calendar").getAccessToken("personal")).rejects.toThrow(/missing_scope/)

    const row = await new AccountRepository(env).findBySlug("calendar", "personal")
    expect(row?.state).toBe("needs_reauth")
    expect(row?.lastError).toBe("missing_scope")
    expect(row?.refreshLockUntil).toBeNull()
  })

  it("treats an absent scope field as unchanged, never empty", async () => {
    await seed({ expiresInSeconds: 30, refreshToken: REFRESH_TOKEN.noScope })

    await createMcpContext(env, "calendar").getAccessToken("personal")

    const row = await new AccountRepository(env).findBySlug("calendar", "personal")
    expect(row?.state).toBe("active")
    expect(row?.scopes).toBe(REQUIRED_SCOPES.join(" "))
  })
})
