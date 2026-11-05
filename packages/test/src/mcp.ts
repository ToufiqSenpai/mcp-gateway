import type { McpContext } from "@mcp-gateway/common"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { createMcpHandler } from "@modelcontextprotocol/server"
import type { McpServer } from "@modelcontextprotocol/server"

export const stubContext: McpContext = {
  listAccounts() {
    return Promise.resolve([{ slug: "personal", isDefault: true }])
  },
  getAccessToken() {
    return Promise.resolve("test-access-token")
  },
  refreshAccessToken() {
    return Promise.resolve("test-access-token")
  },
  cursors: {
    accountSet() {
      return Promise.resolve("test-set")
    },
    encode() {
      return Promise.resolve("next-cursor")
    },
    decode() {
      return Promise.resolve({ o: 0, a: "test-set" })
    }
  },
  async invalidateEnumeration() {},
  async enumeration<T>(_account: string, load: () => Promise<{ items: T[]; truncated: boolean }>) {
    return load()
  }
}

/**
 * Runs `run` against a real Client session over the Worker's own HTTP handler, so tests speak
 * the same protocol era a Host does. `fetch` never leaves the process.
 */
export async function withClient<T>(server: McpServer, run: (client: Client) => Promise<T>): Promise<T> {
  const handler = createMcpHandler(() => server, { legacy: "reject", responseMode: "json" })
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcps/test"), {
    fetch: (input, init) => handler.fetch(new Request(input, init))
  })

  const client = new Client({ name: "mcp-gateway-test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } })
  await client.connect(transport)
  try {
    return await run(client)
  } finally {
    await client.close()
    await server.close()
  }
}

/** Reads the tool listing as the shape the test asserts; the SDK's `Tool` is wider. */
export function listTools<T>(server: McpServer): Promise<T[]> {
  return withClient(server, async client => {
    const { tools } = await client.listTools()
    // SAFETY: each caller declares only the documented listing fields it asserts.
    return tools as T[]
  })
}

/** Reads the prompt listing as the shape the test asserts. */
export function listPrompts<T>(server: McpServer): Promise<T[]> {
  return withClient(server, async client => {
    const { prompts } = await client.listPrompts()
    // SAFETY: each caller declares only the documented listing fields it asserts.
    return prompts as T[]
  })
}

/** Resolves one prompt as the shape the test asserts. */
export function getPrompt<T>(server: McpServer, name: string, args: Record<string, string> = {}): Promise<T> {
  return withClient(server, async client => {
    const result = await client.getPrompt({ name, arguments: args })
    // SAFETY: each caller declares only the documented prompt fields it asserts.
    return result as T
  })
}
