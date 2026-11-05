import type { McpServer, ReadResourceResult } from "@modelcontextprotocol/server"
import { ResourceTemplate } from "@modelcontextprotocol/server"

import { collectAcrossAccounts } from "./tools"
import type { ToolContext } from "./tools/context"

export interface ResourceItem {
  uri: string
  name: string
  mimeType: string
}

export interface ResourceListing {
  resources: ResourceItem[]
  skipped: string[]
  truncated: boolean
}

/** What a package's resource registry must expose so the server can list it. */
export interface ResourceSource {
  list(): Promise<ResourceListing>
  register(server: McpServer): void
}

/**
 * One resource per container per usable Account; a sick Account is skipped and named.
 * A package supplies the URI template and how to enumerate/read its containers.
 */
export abstract class AccountResourceRegistry<C extends ToolContext> implements ResourceSource {
  public constructor(protected readonly context: C) {}

  protected abstract readonly templateUri: string
  protected abstract readonly resourceName: string
  protected abstract readonly resourceTitle: string

  protected abstract enumerate(account: string): Promise<{ items: ResourceItem[]; truncated: boolean }>
  public abstract read(uri: string): Promise<ReadResourceResult>

  public async list(): Promise<ResourceListing> {
    const accounts = await this.context.listAccounts()
    const listing = await collectAcrossAccounts<ResourceItem>(accounts, async slug => {
      const result = await this.context.enumeration<ResourceItem>(slug, () => this.enumerate(slug))
      return { items: result.items, truncated: result.truncated }
    })
    return { resources: listing.items, skipped: listing.skipped, truncated: listing.truncated }
  }

  public register(server: McpServer): void {
    const template = new ResourceTemplate(this.templateUri, { list: undefined })

    server.registerResource(
      this.resourceName,
      template,
      { title: this.resourceTitle, mimeType: "application/json" },
      async uri => this.read(uri.href)
    )
  }
}
