import type { ResourceListing, ResourceSource } from "@mcp-gateway/common"
import type { McpServer } from "@modelcontextprotocol/server"

/** The `sheets` spec publishes no resources; this source keeps the server contract empty. */
export class NoResources implements ResourceSource {
  public list(): Promise<ResourceListing> {
    return Promise.resolve({ resources: [], skipped: [], truncated: false })
  }

  public register(_server: McpServer): void {
    // No resources, no templates: nothing to register.
  }
}
