import { collectAcrossAccounts, type ResourceListing } from "@mcp-gateway/common"
import {
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  ResourceTemplate
} from "@modelcontextprotocol/server"

import { GraphError } from "./client"
import { toNotebook, toSection } from "./map"
import type { ToolContext } from "./tools/tool-context"

const URI_PATTERN = /^notes:\/\/([^/]+)\/notebooks\/(.+)$/

type ResourceItem = ResourceListing["resources"][number]

export function notebookUri(account: string, id: string): string {
  return `notes://${account}/notebooks/${encodeURIComponent(id)}`
}

interface ParsedNotebookUri {
  account: string
  notebookId: string
}

function parseUri(uri: string): ParsedNotebookUri {
  const match = URI_PATTERN.exec(uri)
  if (!match?.[1] || !match[2]) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Unrecognised notebook resource URI")
  }
  return { account: match[1], notebookId: decodeURIComponent(match[2]) }
}

/** One resource per notebook per usable Account; a sick Account is skipped and named. */
export class NotebookResourceRegistry {
  public constructor(private readonly context: ToolContext) {}

  public async list(): Promise<ResourceListing> {
    const accounts = await this.context.listAccounts()
    const listing = await collectAcrossAccounts<ResourceItem>(accounts, async slug => {
      const enumeration = await this.context.enumeration<ResourceItem>(slug, async () => {
        const result = await this.context.graph(slug).notebooks()
        return {
          items: result.items.flatMap(notebook =>
            notebook.id
              ? [
                  {
                    uri: notebookUri(slug, notebook.id),
                    name: notebook.displayName ?? notebook.id,
                    mimeType: "application/json"
                  }
                ]
              : []
          ),
          truncated: result.truncated
        }
      })
      return { items: enumeration.items, truncated: enumeration.truncated }
    })
    return { resources: listing.items, skipped: listing.skipped, truncated: listing.truncated }
  }

  public async read(uri: string) {
    const { account, notebookId } = parseUri(uri)
    const client = this.context.graph(account)

    try {
      const notebook = await client.notebook(notebookId)
      if (!notebook) throw new ResourceNotFoundError(uri)

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({
              account,
              notebook: toNotebook(notebook),
              sections: (notebook.sections ?? []).map(toSection),
              sectionGroups: (notebook.sectionGroups ?? []).flatMap(group =>
                group.id ? [{ id: group.id, displayName: group.displayName }] : []
              ),
              truncated: false
            })
          }
        ]
      }
    } catch (error) {
      if (error instanceof GraphError && error.status === 404) {
        throw new ResourceNotFoundError(uri)
      }
      if (error instanceof GraphError && (error.status === 401 || error.status === 403)) {
        throw new ProtocolError(
          ProtocolErrorCode.InternalError,
          `Credentials for Account "${account}" were refused by the Provider.`
        )
      }
      throw error
    }
  }

  public register(server: McpServer): void {
    const template = new ResourceTemplate("notes://{account}/notebooks/{notebookId}", { list: undefined })

    server.registerResource("notebook", template, { title: "Notebook", mimeType: "application/json" }, async uri =>
      this.read(uri.href)
    )
  }
}
