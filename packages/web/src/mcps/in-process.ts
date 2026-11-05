import { Client } from "@modelcontextprotocol/client"
import { InMemoryTransport, type CallToolResult, type JSONValue, type Tool } from "@modelcontextprotocol/server"

import { createMcpContext } from "../accounts/lifecycle"
import type { McpSlug } from "../db/schema"
import type { Env } from "../env"
import { MCP_REGISTRY } from "./registry"

/** Tool arguments as the admin textarea supplies them: a JSON object. */
type ToolArguments = Record<string, JSONValue>

/**
 * Runs a tool through an in-memory MCP client session against the same server factory `/mcps/*`
 * uses. No self-fetch, so the Worker never needs to store a service token for itself.
 */
export class InProcessRunner {
  public constructor(private readonly env: Env) {}

  public listTools(mcp: McpSlug): Promise<Tool[]> {
    return this.withClient(mcp, async client => (await client.listTools()).tools)
  }

  public callTool(mcp: McpSlug, name: string, args: ToolArguments): Promise<CallToolResult> {
    return this.withClient(mcp, client => client.callTool({ name, arguments: args }))
  }

  private async withClient<T>(mcp: McpSlug, run: (client: Client) => Promise<T>): Promise<T> {
    const server = MCP_REGISTRY[mcp].factory(createMcpContext(this.env, mcp))
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)

    const client = new Client({ name: "mcp-gateway-admin", version: "1.0.0" })
    await client.connect(clientTransport)
    try {
      return await run(client)
    } finally {
      await client.close()
      await server.close()
    }
  }
}
