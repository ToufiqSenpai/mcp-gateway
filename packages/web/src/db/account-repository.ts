import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm"

import type { Database } from "./client"
import { nowSeconds } from "./client"
import {
  accounts,
  oauthStates,
  type Account,
  type McpSlug,
  type NewAccount,
  type NewOAuthAttempt,
  type OAuthAttempt,
  type Provider
} from "./schema"

/** Every Account and OAuth-state statement the Worker makes, over one D1 handle. */
export class AccountRepository {
  public constructor(private readonly db: Database) {}

  public findBySlug(mcp: McpSlug, slug: string): Promise<Account | undefined> {
    return this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.mcp, mcp), eq(accounts.slug, slug)))
      .get()
  }

  public findById(id: string): Promise<Account | undefined> {
    return this.db.select().from(accounts).where(eq(accounts.id, id)).get()
  }

  public findByIdentity(mcp: McpSlug, provider: Provider, providerSubject: string): Promise<Account | undefined> {
    return this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.mcp, mcp), eq(accounts.provider, provider), eq(accounts.providerSubject, providerSubject)))
      .get()
  }

  public listByMcp(mcp: McpSlug): Promise<Account[]> {
    return this.db.select().from(accounts).where(eq(accounts.mcp, mcp)).orderBy(asc(accounts.createdAt)).all()
  }

  public findDefault(mcp: McpSlug): Promise<Account | undefined> {
    return this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.mcp, mcp), eq(accounts.isDefault, 1)))
      .get()
  }

  public async insert(account: NewAccount): Promise<void> {
    await this.db.insert(accounts).values(account)
  }

  public async update(id: string, values: Partial<NewAccount>): Promise<void> {
    await this.db
      .update(accounts)
      .set({ ...values, updatedAt: nowSeconds() })
      .where(eq(accounts.id, id))
  }

  /** `true` when this caller now owns the refresh lease. */
  public async claimRefreshLock(id: string, token: string, leaseSeconds = 30): Promise<boolean> {
    const now = nowSeconds()
    const result = await this.db
      .update(accounts)
      .set({ refreshLockUntil: now + leaseSeconds, refreshLockToken: token, updatedAt: now })
      .where(and(eq(accounts.id, id), or(isNull(accounts.refreshLockUntil), lt(accounts.refreshLockUntil, now))))
    return result.meta.changes === 1
  }

  /** Releases the lease only while this caller still owns it. */
  public async releaseRefreshLock(id: string, token: string): Promise<boolean> {
    const result = await this.db
      .update(accounts)
      .set({ refreshLockUntil: null, refreshLockToken: null, updatedAt: nowSeconds() })
      .where(and(eq(accounts.id, id), eq(accounts.refreshLockToken, token)))
    return result.meta.changes === 1
  }

  /**
   * Persists rotated Credentials in one statement conditioned on the lease token, releasing
   * the lease in the same write. Compare-and-set is on the token, never on ciphertext:
   * AES-GCM output is non-deterministic.
   */
  public async persistRefreshedTokens(
    id: string,
    lockToken: string,
    values: {
      accessToken: string
      refreshToken: string
      accessTokenExpiresAt: number
      lastRefreshedAt: number
      scopes?: string
    }
  ): Promise<boolean> {
    const result = await this.db
      .update(accounts)
      .set({
        ...values,
        refreshLockUntil: null,
        refreshLockToken: null,
        updatedAt: nowSeconds()
      })
      .where(and(eq(accounts.id, id), eq(accounts.refreshLockToken, lockToken)))
    return result.meta.changes === 1
  }

  public async bumpCacheEpoch(id: string): Promise<void> {
    await this.db
      .update(accounts)
      .set({ cacheEpoch: sql`${accounts.cacheEpoch} + 1`, updatedAt: nowSeconds() })
      .where(eq(accounts.id, id))
  }

  /**
   * The first Account to reach `active` for an MCP with no default becomes the default.
   * The partial unique index makes a concurrent double-set fail rather than win silently.
   */
  public async makeDefaultIfNone(account: Pick<Account, "id" | "mcp">): Promise<void> {
    const current = await this.findDefault(account.mcp)
    if (current) return
    await this.update(account.id, { isDefault: 1 })
  }

  /** Clears the previous default and sets the new one in one D1 batch (one round trip). */
  public async setDefault(mcp: McpSlug, id: string): Promise<void> {
    const now = nowSeconds()
    await this.db.batch([
      this.db
        .update(accounts)
        .set({ isDefault: 0, updatedAt: now })
        .where(and(eq(accounts.mcp, mcp), eq(accounts.isDefault, 1))),
      this.db.update(accounts).set({ isDefault: 1, updatedAt: now }).where(eq(accounts.id, id))
    ])
  }

  public async countByState(mcp: McpSlug): Promise<Record<string, number>> {
    const rows = await this.db
      .select({ state: accounts.state, count: sql<number>`count(*)` })
      .from(accounts)
      .where(eq(accounts.mcp, mcp))
      .groupBy(accounts.state)
      .all()
    return Object.fromEntries(rows.map(row => [row.state, row.count]))
  }

  public async insertOAuthState(attempt: NewOAuthAttempt): Promise<void> {
    await this.db.insert(oauthStates).values(attempt)
  }

  /** Single-use consumption: `DELETE … RETURNING` in one statement. */
  public async takeOAuthState(state: string): Promise<OAuthAttempt | undefined> {
    const rows = await this.db.delete(oauthStates).where(eq(oauthStates.state, state)).returning()
    return rows[0]
  }

  public async deleteExpiredOAuthStates(now = nowSeconds()): Promise<void> {
    await this.db.delete(oauthStates).where(lt(oauthStates.expiresAt, now))
  }
}
