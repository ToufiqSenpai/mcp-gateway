import type { McpContext } from "@mcp-gateway/common"
import { afterEach, describe, expect, it } from "vitest"

import { GraphClient, GraphError } from "../../src/client"

const BASE = "https://graph.test/v1.0"

interface Seen {
  url: string
  method: string
  authorization: string | null
  contentType: string | null
  body: string
}

function stubContext(refreshed = "refreshed-token") {
  const state = { refreshes: 0 }
  const ctx: McpContext = {
    async listAccounts() {
      return [{ slug: "personal", isDefault: true }]
    },
    async getAccessToken() {
      return "access-token"
    },
    async refreshAccessToken() {
      state.refreshes += 1
      return refreshed
    },
    cursors: {
      async accountSet() {
        return "test-set"
      },
      async encode() {
        return "next-cursor"
      },
      async decode() {
        return { o: 0, a: "test-set" }
      }
    },
    async invalidateEnumeration() {},
    async enumeration<T>(_account: string, load: () => Promise<{ items: T[]; truncated: boolean }>) {
      return { ...(await load()), cached: false }
    }
  }
  return { ctx, state }
}

interface GraphBody {
  value?: { id: string; displayName?: string }[]
  "@odata.nextLink"?: string
  error?: { code: string; message: string }
  id?: string
}

function json(status: number, body: GraphBody): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

/** Fakes HTTP below the SDK, so the SDK's own pipeline is what the test exercises. */
function serve(handler: (request: Request) => Response) {
  const seen: Seen[] = []
  const original = globalThis.fetch

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    seen.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get("authorization"),
      contentType: request.headers.get("content-type"),
      body: await request.text()
    })
    return handler(request)
  }

  return { seen, restore: () => void (globalThis.fetch = original) }
}

let current: ReturnType<typeof serve> | undefined

afterEach(() => {
  current?.restore()
  current = undefined
})

describe("GraphClient", () => {
  it("calls /me through the SDK with one bearer header", async () => {
    current = serve(() => json(200, { value: [] }))
    const { ctx } = stubContext()

    const result = await new GraphClient(ctx, "personal", BASE).notebooks()

    expect(result).toEqual({ items: [], truncated: false })
    expect(current.seen[0]?.url).toContain(`${BASE}/me/onenote/notebooks`)
    expect(current.seen[0]?.method).toBe("GET")
    expect(current.seen[0]?.authorization).toBe("Bearer access-token")
  })

  it("follows the next link and maps pages", async () => {
    let call = 0
    current = serve(() => {
      call += 1
      return call === 1
        ? json(200, {
            value: [{ id: "nb1", displayName: "One" }],
            "@odata.nextLink": `${BASE}/me/onenote/notebooks?$skiptoken=2`
          })
        : json(200, { value: [{ id: "nb2", displayName: "Two" }] })
    })

    const { ctx } = stubContext()
    const result = await new GraphClient(ctx, "personal", BASE).notebooks()

    expect(result.items.map(item => item.id)).toEqual(["nb1", "nb2"])
    expect(current.seen).toHaveLength(2)
  })

  it("rotates the token once after a 401 and retries", async () => {
    let call = 0
    current = serve(() => {
      call += 1
      return call === 1
        ? json(401, { error: { code: "InvalidAuthenticationToken", message: "expired" } })
        : json(200, { value: [] })
    })

    const { ctx, state } = stubContext()
    const result = await new GraphClient(ctx, "personal", BASE).notebooks()

    expect(result.items).toEqual([])
    expect(state.refreshes).toBe(1)
    expect(current.seen.map(seen => seen.authorization)).toEqual(["Bearer access-token", "Bearer refreshed-token"])
  })

  it("turns an OData error into GraphError", async () => {
    current = serve(() => json(404, { error: { code: "itemNotFound", message: "The requested item is not found." } }))
    const { ctx } = stubContext()

    let error: GraphError | undefined
    try {
      await new GraphClient(ctx, "personal", BASE).page("missing")
    } catch (caught) {
      if (caught instanceof GraphError) error = caught
    }

    expect(error).toBeInstanceOf(GraphError)
    expect(error).toMatchObject({
      status: 404,
      code: "itemNotFound",
      message: "The requested item is not found."
    })
  })

  it("adds includeIDs to the media read", async () => {
    current = serve(() => new Response("<html/>", { headers: { "content-type": "text/html" } }))
    const { ctx } = stubContext()

    const content = await new GraphClient(ctx, "personal", BASE).pageContent("p1", true)

    expect(content).toBe("<html/>")
    expect(current.seen[0]?.url).toBe(`${BASE}/me/onenote/pages/p1/content?includeIDs=true`)
  })

  it("creates a page as a text/html document", async () => {
    current = serve(() => json(201, { id: "p1" }))
    const { ctx } = stubContext()
    const document = "<!DOCTYPE html><html><body>hi</body></html>"

    await new GraphClient(ctx, "personal", BASE).createPage("s1", document)

    expect(current.seen[0]?.method).toBe("POST")
    expect(current.seen[0]?.contentType).toBe("text/html; charset=utf-8")
    expect(current.seen[0]?.body).toBe(document)
  })
})
