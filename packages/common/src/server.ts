import { McpServer } from "@modelcontextprotocol/server"

import type { ResourceSource } from "./resources"
import type { ToolDefinition } from "./tools"
import { ToolRegistry } from "./tools/registry"

export interface ServerOptions<C> {
  name: string
  tools: readonly ToolDefinition<C>[]
  context: C
  formatError: (error: Error) => string
  resources: ResourceSource
  prompts?: (server: McpServer) => void
}

/** One per request: the assembly both MCP packages share (ADR-0001: nothing subscribable). */
export function buildServer<C>(options: ServerOptions<C>): McpServer {
  const server = new McpServer(
    { name: options.name, version: "1.0.0" },
    {
      cacheHints: {
        "server/discover": { ttlMs: 3_600_000, cacheScope: "public" },
        "tools/list": { ttlMs: 3_600_000, cacheScope: "public" },
        "prompts/list": { ttlMs: 3_600_000, cacheScope: "public" },
        "resources/templates/list": { ttlMs: 3_600_000, cacheScope: "public" },
        "resources/list": { ttlMs: 300_000, cacheScope: "private" },
        "resources/read": { ttlMs: 30_000, cacheScope: "private" }
      }
    }
  )

  new ToolRegistry(options.tools, options.formatError).register(server, options.context)
  options.resources.register(server)
  options.prompts?.(server)

  // The SDK's own resources/list drops a partial listing's ttlMs/_meta, so serve it here.
  server.server.removeRequestHandler("resources/list")
  server.server.setRequestHandler("resources/list", async () => {
    const listing = await options.resources.list()
    const result = { resources: listing.resources }
    if (listing.skipped.length > 0 || listing.truncated) {
      Object.assign(result, { ttlMs: 0, _meta: { "mcp-gateway/skippedAccounts": listing.skipped } })
    }
    return result
  })

  // Containers are addressed by concrete URI, not a template: list nothing.
  server.server.removeRequestHandler("resources/templates/list")
  server.server.setRequestHandler("resources/templates/list", () => ({ resourceTemplates: [] }))

  // Nothing here is subscribable: no listChanged, no resources/subscribe (ADR-0001).
  const capabilities = server.server.getCapabilities()
  if (capabilities.tools) delete capabilities.tools.listChanged
  if (capabilities.prompts) delete capabilities.prompts.listChanged
  if (capabilities.resources) delete capabilities.resources.listChanged

  return server
}
