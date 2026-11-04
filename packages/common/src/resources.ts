import type { McpServer } from "@modelcontextprotocol/server"

export interface ResourceListing {
  resources: { uri: string; name: string; mimeType: string }[]
  skipped: string[]
  truncated: boolean
}

/** What a package's resource registry must expose so the server can list it. */
export interface ResourceSource {
  list(): Promise<ResourceListing>
  register(server: McpServer): void
}
