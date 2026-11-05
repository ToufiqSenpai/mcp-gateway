import { SERVER_INFO_META_KEY } from "@modelcontextprotocol/server"
import { describe, expect, it } from "vitest"

import { TEST_ORIGIN, accessJwt, appFetch, mcpJwt } from "../support/access"
import { DiscoveryResult, ResourcesResult, TemplatesResult, ToolListResult, rpc } from "../support/rpc"

describe("MCP conformance on /mcps/notes", () => {
  it("answers server/discover with its own identity, resources and no prompts", async () => {
    const reply = await rpc({ method: "server/discover", params: {} }, { slug: "notes" })
    const result = DiscoveryResult.parse(reply.reply.result)

    expect(reply.status).toBe(200)
    expect(result.resultType).toBe("complete")
    expect(result._meta[SERVER_INFO_META_KEY]?.["name"]).toBe("notes")
    expect(result.capabilities["tools"]).toBeDefined()
    expect(result.capabilities["resources"]).toEqual({})
    expect(result.capabilities["prompts"]).toBeUndefined()
    expect(JSON.stringify(result.capabilities)).not.toContain("listChanged")
  })

  it("lists the eleven notes tools deterministically", async () => {
    const first = ToolListResult.parse(
      (await rpc({ method: "tools/list", params: {} }, { slug: "notes" })).reply.result
    )
    const names = first.tools.map(tool => tool.name)
    expect(names).toHaveLength(11)

    for (let run = 0; run < 20; run += 1) {
      const again = ToolListResult.parse(
        (await rpc({ method: "tools/list", params: {} }, { slug: "notes" })).reply.result
      )
      expect(again.tools.map(tool => tool.name)).toEqual(names)
    }
  })

  it("answers an unknown tool with -32602", async () => {
    const reply = await rpc(
      {
        method: "tools/call",
        params: { name: "list_section_groups", arguments: {} }
      },
      { slug: "notes" }
    )
    expect(reply.reply.error?.code).toBe(-32602)
  })

  it("refuses GET and DELETE with 405 and never sets HTTP cache headers", async () => {
    const token = await mcpJwt()
    for (const method of ["GET", "DELETE"]) {
      const response = await appFetch(`${TEST_ORIGIN}/mcps/notes`, {
        method,
        headers: { "Cf-Access-Jwt-Assertion": token }
      })
      expect(response.status).toBe(405)
      await response.body?.cancel()
    }

    const reply = await rpc({ method: "tools/list", params: {} }, { slug: "notes" })
    expect(reply.headers.get("mcp-session-id")).toBeNull()
    expect(reply.headers.get("cache-control")).toBeNull()
  })

  it("answers an unknown slug with 404 and a human credential with 403", async () => {
    const unknown = await rpc({ method: "server/discover", params: {} }, { slug: "mail" })
    expect(unknown.status).toBe(404)

    const human = await rpc({ method: "tools/list", params: {} }, { token: await accessJwt("admin") })
    expect(human.status).toBe(403)
  })

  it("lists resources without touching the Provider when there are no Accounts", async () => {
    const reply = await rpc({ method: "resources/list", params: {} }, { slug: "notes" })
    const result = ResourcesResult.parse(reply.reply.result)
    expect(result.resources).toEqual([])
    expect(reply.reply.result).toBeDefined()
  })

  it("returns an empty template list", async () => {
    const reply = await rpc({ method: "resources/templates/list", params: {} }, { slug: "notes" })
    const result = TemplatesResult.parse(reply.reply.result)
    expect(result.resourceTemplates).toEqual([])
  })
})
