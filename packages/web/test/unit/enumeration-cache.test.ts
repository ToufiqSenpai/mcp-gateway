import { env } from "cloudflare:test"
import { describe, expect, it } from "vitest"

import { AccountRepository } from "../../src/db/account-repository"
import { createDb } from "../../src/db/client"
import { EnumerationCache } from "../../src/mcps/cache"

describe("enumeration cache", () => {
  it("keeps its binding when get is destructured from the cache", async () => {
    const cache = new EnumerationCache(env, new AccountRepository(createDb(env)), "calendar")
    const { get } = cache

    const result = await get("binding-test", async () => ({
      items: [{ id: "one" }],
      truncated: false
    }))

    expect(result.items).toEqual([{ id: "one" }])
    expect(result.truncated).toBe(false)
    expect(result.cached).toBe(false)
  })
})
