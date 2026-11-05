import { McpServer } from "@modelcontextprotocol/server"

import type { ResourceSource } from "./resources"
import type { ToolDefinition } from "./tools"
import { ToolRegistry } from "./tools/registry"

/**
 * One server per request: the assembly every MCP package shares (ADR-0001, ADR-0007).
 * A package supplies its name, tools, resources and error text; nothing here knows about
 * Providers or Accounts.
 */
export abstract class McpServerBuilder<C> {
  public constructor(protected readonly context: C) {}

  protected abstract readonly name: string
  protected abstract readonly tools: readonly ToolDefinition<C>[]
  protected readonly resources?: ResourceSource

  /** An optional short Provider status to prefix to an error message. */
  protected errorCode(_error: Error): string | undefined {
    return undefined
  }

  /** One short line: a Provider body never becomes a tool error. */
  protected formatError(error: Error): string {
    const code = this.errorCode(error)
    const message = error.message.split("\n")[0] ?? ""
    const trimmed = message.slice(0, 300)
    return code && !trimmed.includes(code) ? `${code}: ${trimmed}` : trimmed
  }

  protected registerPrompts?(server: McpServer): void

  public build(): McpServer {
    const server = new McpServer(
      { name: this.name, version: "1.0.0" },
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

    new ToolRegistry(this.tools, error => this.formatError(error)).register(server, this.context)
    const resources = this.resources
    resources?.register(server)
    this.registerPrompts?.(server)

    // A server that registered no resources must not advertise them: installing the handlers
    // requires the capability, and an empty list is not the same as "not supported".
    if (resources && server.server.getCapabilities().resources) {
      // The SDK's own resources/list drops a partial listing's ttlMs/_meta, so serve it here.
      server.server.removeRequestHandler("resources/list")
      server.server.setRequestHandler("resources/list", async () => {
        const listing = await resources.list()
        const result = { resources: listing.resources }
        if (listing.skipped.length > 0 || listing.truncated) {
          Object.assign(result, { ttlMs: 0, _meta: { "mcp-gateway/skippedAccounts": listing.skipped } })
        }
        return result
      })

      // Containers are addressed by concrete URI, not a template: list nothing.
      server.server.removeRequestHandler("resources/templates/list")
      server.server.setRequestHandler("resources/templates/list", () => ({ resourceTemplates: [] }))
    }

    // Nothing here is subscribable: no listChanged, no resources/subscribe (ADR-0001).
    const capabilities = server.server.getCapabilities()
    if (capabilities.tools) delete capabilities.tools.listChanged
    if (capabilities.prompts) delete capabilities.prompts.listChanged
    if (capabilities.resources) delete capabilities.resources.listChanged

    return server
  }
}
