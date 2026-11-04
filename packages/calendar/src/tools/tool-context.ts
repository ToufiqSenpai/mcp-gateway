import { ToolContext as CommonToolContext, paginate } from "@mcp-gateway/common"

import { googleCalendar } from "../client"

/** Page size the wire documents; a caller may ask for less, never more. */
function clampPageSize(requested: number | undefined): number {
  if (requested === undefined) return 100
  return Math.min(250, Math.max(1, Math.trunc(requested)))
}

/**
 * Per-request view over `McpContext`: Account selection, the Google client and the wire's
 * `pageToken`/`pageSize` naming over the common offset pagination.
 */
export class ToolContext extends CommonToolContext {
  public calendar(slug: string) {
    return googleCalendar(this.ctx, slug)
  }

  public async paginate<T>(options: {
    accounts: { slug: string }[]
    pageToken: string | undefined
    pageSize: number | undefined
    fetchAll: () => Promise<{ items: T[]; truncated?: boolean; skipped?: string[] }>
  }) {
    const page = await paginate<T>({
      ctx: this.ctx,
      accounts: options.accounts,
      offsetToken: options.pageToken,
      pageSize: clampPageSize(options.pageSize),
      fetchAll: options.fetchAll
    })
    return { items: page.items, nextPageToken: page.nextOffsetToken, truncated: page.truncated, skipped: page.skipped }
  }
}
