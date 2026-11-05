import { SERVER_INFO_META_KEY } from "@modelcontextprotocol/server"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { TEST_ORIGIN, accessJwt, appFetch, mcpJwt } from "../support/access"
import { DiscoveryResult, ToolCallResult, ToolListResult, rpc } from "../support/rpc"

const AccountsPayload = z.object({ accounts: z.array(z.json()) }).loose()

describe("MCP conformance on /mcps/calendar", () => {
  it("answers server/discover with its own server identity and capabilities", async () => {
    const reply = await rpc({ method: "server/discover", params: {} })
    const result = DiscoveryResult.parse(reply.reply.result)

    expect(reply.status).toBe(200)
    expect(result.resultType).toBe("complete")
    expect(result._meta[SERVER_INFO_META_KEY]?.["name"]).toBe("calendar")
    expect(result.supportedVersions).toContain("2026-07-28")
    expect(result.capabilities["tools"]).toBeDefined()
    expect(result.capabilities["prompts"]).toBeDefined()
    expect(result.capabilities["resources"]).toEqual({})
    expect(JSON.stringify(result.capabilities)).not.toContain("listChanged")
  })

  it("lists the ten tools deterministically and marks results complete", async () => {
    const first = ToolListResult.parse((await rpc({ method: "tools/list", params: {} })).reply.result)
    const names = first.tools.map(tool => tool.name)
    expect(names).toHaveLength(10)
    expect(first.resultType).toBe("complete")

    for (let run = 0; run < 20; run += 1) {
      const again = ToolListResult.parse((await rpc({ method: "tools/list", params: {} })).reply.result)
      expect(again.tools.map(tool => tool.name)).toEqual(names)
    }
  })

  it("calls list_accounts without touching the Provider", async () => {
    const reply = await rpc({
      method: "tools/call",
      params: { name: "list_accounts", arguments: {} }
    })
    const result = ToolCallResult.parse(reply.reply.result)
    expect(result.isError).toBeUndefined()

    const payload = AccountsPayload.parse(JSON.parse(result.content?.[0]?.text ?? "{}"))
    expect(payload.accounts).toEqual([])
  })

  it("answers an unknown tool with -32602", async () => {
    const reply = await rpc({
      method: "tools/call",
      params: { name: "drop_everything", arguments: {} }
    })
    expect(reply.reply.error?.code).toBe(-32602)
  })

  it("refuses GET and DELETE with 405", async () => {
    const token = await mcpJwt()
    for (const method of ["GET", "DELETE"]) {
      const response = await appFetch(`${TEST_ORIGIN}/mcps/calendar`, {
        method,
        headers: { "Cf-Access-Jwt-Assertion": token }
      })
      expect(response.status).toBe(405)
      await response.body?.cancel()
    }
  })

  it("answers an unknown slug with 404", async () => {
    const reply = await rpc({ method: "server/discover", params: {} }, { slug: "mail" })
    expect(reply.status).toBe(404)
  })

  it("rejects a foreign Host before dispatch", async () => {
    const reply = await rpc({ method: "tools/list", params: {} }, { origin: "https://evil.example.com" })
    expect(reply.status).toBe(403)
    expect(reply.reply.error?.code).toBe(-32000)
  })

  it("never mints a session id or sets HTTP cache headers", async () => {
    const reply = await rpc({ method: "tools/list", params: {} })
    expect(reply.headers.get("mcp-session-id")).toBeNull()
    expect(reply.headers.get("cache-control")).toBeNull()
    expect(reply.headers.get("etag")).toBeNull()
  })

  it("enforces the route-group pairing", async () => {
    const human = await accessJwt("admin")
    const adminOnMcp = await appFetch(`${TEST_ORIGIN}/mcps/calendar`, {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": human, "content-type": "application/json" },
      body: "{}"
    })
    expect(adminOnMcp.status).toBe(403)

    const serviceOnAdmin = await appFetch(`${TEST_ORIGIN}/admin`, {
      headers: { "Cf-Access-Jwt-Assertion": await mcpJwt() }
    })
    expect(serviceOnAdmin.status).toBe(403)

    const anonymous = await appFetch(`${TEST_ORIGIN}/mcps/calendar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    })
    expect(anonymous.status).toBe(401)
  })
})
