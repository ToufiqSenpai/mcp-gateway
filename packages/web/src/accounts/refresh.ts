import { TokenCipher } from "../auth/crypto"
import { OAuthProvider, OAuthTokenError, type OAuthTokens } from "../auth/oauth"
import { covers, parseScopes, requiredScopes } from "../auth/scopes"
import { AccountRepository } from "../db/account-repository"
import { nowSeconds } from "../db/client"
import type { Account } from "../db/schema"
import type { Env } from "../env"
import { UnusableAccountError } from "./errors"
import { demoteAccount, readAccessToken } from "./unusable"

const REFRESH_WINDOW_SECONDS = 60
const LOCK_LEASE_SECONDS = 30
const LOCK_WAIT_MS = 2000
const LOCK_POLL_MS = 250

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Permanent failures demote; everything else only records `last_error`. */
function isPermanentRefreshFailure(error: Error | undefined): boolean {
  if (!(error instanceof OAuthTokenError)) return false
  return ["invalid_grant", "interaction_required", "invalid_client"].includes(error.code)
}

function providerErrorCode(error: Error | undefined): string {
  if (error instanceof OAuthTokenError) return error.code
  if (error instanceof Error && error.name !== "Error") return error.name
  return "refresh_failed"
}

/**
 * Single-flight refresh: one write lease on the Account row, CAS on the lease token, and a
 * 30 s expiry so a Worker dying mid-refresh cannot freeze the Account (§10).
 */
export class RefreshService {
  private readonly cipher: TokenCipher

  public constructor(
    private readonly env: Env,
    private readonly repository: AccountRepository
  ) {
    this.cipher = new TokenCipher(env.TOKEN_ENCRYPTION_KEY)
  }

  /**
   * Returns a token with more than 60 s of life, refreshing pre-emptively when needed.
   * `force` is the reactive path after a Provider 401.
   */
  public async usable(account: Account, force = false): Promise<string> {
    if (!force && account.accessTokenExpiresAt - nowSeconds() > REFRESH_WINDOW_SECONDS) {
      return this.currentAccessToken(account)
    }
    return this.refresh(account)
  }

  public async refresh(account: Account): Promise<string> {
    const deadline = Date.now() + LOCK_WAIT_MS
    const lockToken = crypto.randomUUID()
    let claimed = await this.repository.claimRefreshLock(account.id, lockToken, LOCK_LEASE_SECONDS)

    if (!claimed) {
      const advanced = await this.waitForOtherWriter(account, deadline)
      if (advanced) return advanced
      claimed = await this.repository.claimRefreshLock(account.id, lockToken, LOCK_LEASE_SECONDS)
    }

    if (!claimed) {
      // Still contended at the deadline: use the current token while it is valid, else retry.
      if (account.accessTokenExpiresAt > nowSeconds()) return this.currentAccessToken(account)
      throw new Error(`Account "${account.slug}" is being refreshed; retry shortly.`)
    }

    const fresh = (await this.repository.findById(account.id)) ?? account
    if (!fresh.refreshToken) {
      await this.repository.releaseRefreshLock(account.id, lockToken)
      throw new UnusableAccountError(account.mcp, account.slug, "no_credentials")
    }

    let tokens: OAuthTokens
    try {
      const refreshToken = await this.cipher.decrypt(fresh.refreshToken, fresh.id, "refresh_token")
      tokens = await OAuthProvider.for(this.env, fresh.provider).refreshTokens({
        refreshToken,
        scopes: requiredScopes(fresh.mcp)
      })
    } catch (thrown) {
      // A throw that is not an Error carries no provider signal; treat it as an unnamed failure.
      const error = thrown instanceof Error ? thrown : undefined
      await this.repository.releaseRefreshLock(account.id, lockToken)
      if (isPermanentRefreshFailure(error)) {
        const code = error instanceof OAuthTokenError ? error.code : "invalid_grant"
        await demoteAccount(this.repository, account, "needs_reauth", code)
      }
      await this.repository.update(account.id, { lastError: providerErrorCode(error) })
      // A pre-emptive failure with a still-valid token proceeds with the old token.
      if (account.accessTokenExpiresAt > nowSeconds()) return this.currentAccessToken(account)
      throw new Error(`Account "${account.slug}" could not be refreshed; retry shortly.`)
    }

    const required = requiredScopes(fresh.mcp)
    // An absent scope field means unchanged, never empty (Microsoft may omit it).
    const granted = tokens.scopes ?? parseScopes(fresh.scopes)
    if (!covers(granted, required)) {
      await demoteAccount(this.repository, fresh, "missing_scope")
    }

    const refreshToken = tokens.refreshToken
      ? await this.cipher.encrypt(tokens.refreshToken, fresh.id, "refresh_token")
      : fresh.refreshToken

    const persisted = await this.repository.persistRefreshedTokens(fresh.id, lockToken, {
      accessToken: await this.cipher.encrypt(tokens.accessToken, fresh.id, "access_token"),
      refreshToken,
      accessTokenExpiresAt: tokens.expiresAt,
      lastRefreshedAt: nowSeconds(),
      scopes: granted.join(" ")
    })

    if (!persisted) {
      // Another writer won the lease; use what is stored now.
      const winner = await this.repository.findById(fresh.id)
      if (winner) return this.currentAccessToken(winner)
    }

    return tokens.accessToken
  }

  private async currentAccessToken(account: Account): Promise<string> {
    return readAccessToken(this.cipher, account)
  }

  private async waitForOtherWriter(account: Account, deadline: number): Promise<string | undefined> {
    while (Date.now() < deadline) {
      await sleep(LOCK_POLL_MS)
      const fresh = await this.repository.findById(account.id)
      if (!fresh) throw new UnusableAccountError(account.mcp, account.slug, "missing")
      if (fresh.accessTokenExpiresAt > account.accessTokenExpiresAt) {
        return this.currentAccessToken(fresh)
      }
      if (!fresh.refreshLockUntil || fresh.refreshLockUntil < nowSeconds()) {
        return undefined
      }
    }
    return undefined
  }
}
