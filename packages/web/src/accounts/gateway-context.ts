import type { CursorCodec, McpContext } from "@mcp-gateway/common"

import type { EnumerationCache } from "../mcps/cache"
import type { AccountService } from "./lifecycle"

/**
 * The Worker's implementation of the package boundary. It adds no members; `common` owns the
 * interface, so the compiler checks the contract.
 */
export class GatewayMcpContext implements McpContext {
  public readonly cursors: CursorCodec

  public constructor(
    private readonly accounts: AccountService,
    cursors: CursorCodec,
    private readonly cache: EnumerationCache
  ) {
    this.cursors = cursors
  }

  public listAccounts() {
    return this.accounts.listAccounts()
  }

  public getAccessToken(slug: string) {
    return this.accounts.getAccessToken(slug)
  }

  public refreshAccessToken(slug: string) {
    return this.accounts.refreshAccessToken(slug)
  }

  public invalidateEnumeration() {
    return this.accounts.invalidateEnumeration()
  }

  public enumeration<T>(account: string, load: () => Promise<{ items: T[]; truncated: boolean }>) {
    return this.cache.get(account, load)
  }
}
