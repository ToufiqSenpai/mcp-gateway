import { describe, expect, it } from "vitest"

import type { McpContext } from "../src/context"
import { ToolContext, paginate } from "../src/index"

function stub(overrides: Partial<McpContext> = {}): McpContext {
  return {
    async listAccounts() {
      return [
        { slug: "personal", isDefault: true },
        { slug: "work", isDefault: false }
      ]
    },
    async getAccessToken() {
      return "test-access-token"
    },
    async refreshAccessToken() {
      return "test-access-token"
    },
    cursors: {
      async accountSet() {
        return "test-set"
      },
      async encode(payload) {
        return `next:${String(payload.o)}`
      },
      async decode() {
        return { o: 2, a: "test-set" }
      }
    },
    async invalidateEnumeration() {},
    async enumeration<T>(_account: string, load: () => Promise<{ items: T[]; truncated: boolean }>) {
      return load()
    },
    ...overrides
  }
}

describe("paginate", () => {
  const items = [1, 2, 3, 4, 5]

  it("returns the first page and a cursor for the rest", async () => {
    const page = await paginate<number>({
      ctx: stub(),
      accounts: [{ slug: "personal" }],
      offsetToken: undefined,
      pageSize: 2,
      fetchAll: async () => ({ items })
    })
    expect(page.items).toEqual([1, 2])
    expect(page.nextOffsetToken).toBe("next:2")
    expect(page.truncated).toBe(false)
  })

  it("continues from the cursor offset", async () => {
    const page = await paginate<number>({
      ctx: stub(),
      accounts: [{ slug: "personal" }],
      offsetToken: "cursor",
      pageSize: 2,
      fetchAll: async () => ({ items })
    })
    expect(page.items).toEqual([3, 4])
    expect(page.nextOffsetToken).toBe("next:4")
  })

  it("omits the cursor on the last page", async () => {
    const page = await paginate<number>({
      ctx: stub(),
      accounts: [{ slug: "personal" }],
      offsetToken: undefined,
      pageSize: 5,
      fetchAll: async () => ({ items })
    })
    expect(page.items).toEqual(items)
    expect(page.nextOffsetToken).toBeUndefined()
  })

  it("passes truncation through", async () => {
    const page = await paginate<number>({
      ctx: stub(),
      accounts: [{ slug: "personal" }],
      offsetToken: undefined,
      pageSize: 5,
      fetchAll: async () => ({ items, truncated: true })
    })
    expect(page.truncated).toBe(true)
  })

  it("refuses a cursor whose offset is not a natural number", async () => {
    const bad = stub({
      cursors: {
        async accountSet() {
          return "test-set"
        },
        async encode() {
          return "next"
        },
        async decode() {
          return { o: -1, a: "test-set" }
        }
      }
    })
    await expect(
      paginate<number>({
        ctx: bad,
        accounts: [{ slug: "personal" }],
        offsetToken: "cursor",
        pageSize: 2,
        fetchAll: async () => ({ items })
      })
    ).rejects.toThrow("Invalid page token")
  })
})

describe("ToolContext", () => {
  it("keeps an explicit Account slug", async () => {
    await expect(new ToolContext(stub()).resolve("work")).resolves.toBe("work")
  })

  it("falls back to the Default Account", async () => {
    await expect(new ToolContext(stub()).resolve(undefined)).resolves.toBe("personal")
  })

  it("refuses an Account this MCP does not have", async () => {
    await expect(new ToolContext(stub()).resolve("missing")).rejects.toThrow('Account "missing" is not configured')
    await expect(new ToolContext(stub()).selectedAccounts("missing")).rejects.toThrow(
      'Account "missing" is not configured'
    )
  })

  it("refuses when no Default Account exists, never picking another Account", async () => {
    const noDefault = stub({
      async listAccounts() {
        return [{ slug: "work", isDefault: false }]
      }
    })
    await expect(new ToolContext(noDefault).resolve(undefined)).rejects.toThrow("No Default Account is set")
  })

  it("selects only the explicit Account, or every Account otherwise", async () => {
    const context = new ToolContext(stub())
    await expect(context.selectedAccounts("work")).resolves.toEqual([{ slug: "work", isDefault: false }])
    await expect(context.selectedAccounts(undefined)).resolves.toHaveLength(2)
  })
})
