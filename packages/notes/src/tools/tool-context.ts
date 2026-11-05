import { ToolContext as CommonToolContext, paginate } from "@mcp-gateway/common"

import { GraphClient } from "../client"

const PAGE_SIZE = 100

/**
 * Per-request view over `McpContext`: Account selection, the Graph client and the wire's
 * `cursor` naming over the common offset pagination.
 */
export class ToolContext extends CommonToolContext {
  public graph(slug: string) {
    return new GraphClient(this.ctx, slug)
  }

  public async paginate<T>(options: {
    accounts: { slug: string }[]
    cursor: string | undefined
    fetchAll: () => Promise<{ items: T[]; truncated?: boolean; skipped?: string[] }>
  }) {
    const page = await paginate<T>({
      ctx: this.ctx,
      accounts: options.accounts,
      offsetToken: options.cursor,
      pageSize: PAGE_SIZE,
      fetchAll: options.fetchAll
    })
    return { items: page.items, nextCursor: page.nextOffsetToken, truncated: page.truncated, skipped: page.skipped }
  }
}
