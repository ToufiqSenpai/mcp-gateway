import type { McpContext } from "@mcp-gateway/common"

import { TokenCipher } from "../auth/crypto"
import { covers, parseScopes, requiredScopes } from "../auth/scopes"
import { AccountRepository } from "../db/account-repository"
import type { Database } from "../db/client"
import type { Account, McpSlug } from "../db/schema"
import type { Env } from "../env"
import { EnumerationCache } from "../mcps/cache"
import { HmacCursorCodec } from "../mcps/pagination"
import { UnusableAccountError, type UnusableReason } from "./errors"
import { GatewayMcpContext } from "./gateway-context"
import { RefreshService } from "./refresh"
import { demoteAccount, readAccessToken } from "./unusable"

export { UnusableAccountError, type UnusableReason }

/** Account selection and Credential use for one MCP, over one D1 handle. */
export class AccountService {
  private readonly cipher: TokenCipher
  private readonly refresh: RefreshService

  public constructor(
    env: Env,
    private readonly repository: AccountRepository,
    private readonly mcp: McpSlug
  ) {
    this.cipher = new TokenCipher(env.TOKEN_ENCRYPTION_KEY)
    this.refresh = new RefreshService(env, repository)
  }

  public async listAccounts(): Promise<{ slug: string; isDefault: boolean }[]> {
    const rows = await this.repository.listByMcp(this.mcp)
    // Every Account is listed, broken ones included: selection must be able to say
    // precisely that the Default Account is unusable, never that there is no default.
    return rows.map(row => ({ slug: row.slug, isDefault: row.isDefault === 1 }))
  }

  /**
   * Explicit slug, otherwise the MCP's Default Account. Never falls back to another Account and
   * never infers a default at request time.
   */
  public async resolve(requestedSlug: string | undefined): Promise<Account> {
    if (requestedSlug) {
      const account = await this.repository.findBySlug(this.mcp, requestedSlug)
      if (!account) throw new UnusableAccountError(this.mcp, requestedSlug, "missing")
      return account
    }

    const fallback = await this.repository.findDefault(this.mcp)
    if (!fallback) throw new UnusableAccountError(this.mcp, "(none)", "no_default")
    return fallback
  }

  public async getAccessToken(slug: string): Promise<string> {
    return this.accessTokenFor(await this.resolve(slug))
  }

  public async refreshAccessToken(slug: string): Promise<string> {
    return this.refresh.usable(await this.resolve(slug), true)
  }

  public async accessTokenFor(account: Account): Promise<string> {
    await this.assertUsable(account)
    return this.refresh.usable(account)
  }

  public async invalidateEnumeration(): Promise<void> {
    const rows = await this.repository.listByMcp(this.mcp)
    await Promise.all(rows.map(row => this.repository.bumpCacheEpoch(row.id)))
  }

  public async decryptAccessToken(account: Account): Promise<string> {
    return readAccessToken(this.cipher, account)
  }

  private async assertUsable(account: Account): Promise<void> {
    if (account.state === "revoked") {
      throw new UnusableAccountError(account.mcp, account.slug, "revoked")
    }
    if (account.state === "needs_reauth") {
      const reason = account.lastError === "missing_scope" ? "missing_scope" : "needs_reauth"
      throw new UnusableAccountError(account.mcp, account.slug, reason)
    }
    if (!account.accessToken || !account.refreshToken) {
      throw new UnusableAccountError(account.mcp, account.slug, "no_credentials")
    }
    if (!covers(parseScopes(account.scopes), requiredScopes(account.mcp))) {
      await this.demoteForScope(account)
    }
  }

  /**
   * Demotes on lost scope coverage �? the only detector for a Required set widened after a
   * deploy, where both stored and Provider scopes are unchanged.
   */
  private async demoteForScope(account: Account): Promise<never> {
    return demoteAccount(this.repository, account, "missing_scope")
  }
}

/** The narrow `McpContext` an MCP package receives. It never sees D1, arctic or the key. */
export function createMcpContext(
  env: Env,
  db: Database,
  mcp: McpSlug,
  waitUntil?: (promise: Promise<unknown>) => void
): McpContext {
  const repository = new AccountRepository(db)
  return new GatewayMcpContext(
    new AccountService(env, repository, mcp),
    new HmacCursorCodec(env.CURSOR_SIGNING_KEY),
    new EnumerationCache(env, repository, mcp, waitUntil)
  )
}
