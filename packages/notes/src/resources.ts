import { AccountResourceRegistry, type ResourceItem } from "@mcp-gateway/common"
import { ProtocolError, ProtocolErrorCode, ResourceNotFoundError } from "@modelcontextprotocol/server"

import { GraphError } from "./client"
import { toNotebook, toSection } from "./map"
import type { ToolContext } from "./tools/tool-context"

const URI_PATTERN = /^notes:\/\/([^/]+)\/notebooks\/(.+)$/

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
export class NotebookResourceRegistry extends AccountResourceRegistry<ToolContext> {
  protected readonly templateUri = "notes://{account}/notebooks/{notebookId}"
  protected readonly resourceName = "notebook"
  protected readonly resourceTitle = "Notebook"

  protected async enumerate(slug: string): Promise<{ items: ResourceItem[]; truncated: boolean }> {
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
}
