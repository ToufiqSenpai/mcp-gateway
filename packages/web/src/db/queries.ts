import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database } from './client';
import { nowSeconds } from './client';
import {
  accounts,
  oauthStates,
  type Account,
  type McpSlug,
  type NewAccount,
  type NewOAuthAttempt,
  type OAuthAttempt,
  type Provider,
} from './schema';

export function findAccountBySlug(
  db: Database,
  mcp: McpSlug,
  slug: string,
): Promise<Account | undefined> {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.mcp, mcp), eq(accounts.slug, slug)))
    .get();
}

export function findAccountById(db: Database, id: string): Promise<Account | undefined> {
  return db.select().from(accounts).where(eq(accounts.id, id)).get();
}

export function findAccountByIdentity(
  db: Database,
  mcp: McpSlug,
  provider: Provider,
  providerSubject: string,
): Promise<Account | undefined> {
  return db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.mcp, mcp),
        eq(accounts.provider, provider),
        eq(accounts.providerSubject, providerSubject),
      ),
    )
    .get();
}

export function listAccountsByMcp(db: Database, mcp: McpSlug): Promise<Account[]> {
  return db.select().from(accounts).where(eq(accounts.mcp, mcp)).orderBy(asc(accounts.createdAt)).all();
}

export function findDefaultAccount(
  db: Database,
  mcp: McpSlug,
): Promise<Account | undefined> {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.mcp, mcp), eq(accounts.isDefault, 1)))
    .get();
}

export async function insertAccount(db: Database, account: NewAccount): Promise<void> {
  await db.insert(accounts).values(account);
}

export async function updateAccount(
  db: Database,
  id: string,
  values: Partial<NewAccount>,
): Promise<void> {
  await db
    .update(accounts)
    .set({ ...values, updatedAt: nowSeconds() })
    .where(eq(accounts.id, id));
}

/** `true` when this caller now owns the refresh lease. */
export async function claimRefreshLock(
  db: Database,
  id: string,
  token: string,
  leaseSeconds = 30,
): Promise<boolean> {
  const now = nowSeconds();
  const result = await db
    .update(accounts)
    .set({ refreshLockUntil: now + leaseSeconds, refreshLockToken: token, updatedAt: now })
    .where(
      and(
        eq(accounts.id, id),
        or(isNull(accounts.refreshLockUntil), lt(accounts.refreshLockUntil, now)),
      ),
    );
  return result.meta.changes === 1;
}

/** Releases the lease only while this caller still owns it. */
export async function releaseRefreshLock(
  db: Database,
  id: string,
  token: string,
): Promise<boolean> {
  const result = await db
    .update(accounts)
    .set({ refreshLockUntil: null, refreshLockToken: null, updatedAt: nowSeconds() })
    .where(and(eq(accounts.id, id), eq(accounts.refreshLockToken, token)));
  return result.meta.changes === 1;
}

/**
 * Persists rotated Credentials in one statement conditioned on the lease token, releasing
 * the lease in the same write. Compare-and-set is on the token, never on ciphertext:
 * AES-GCM output is non-deterministic.
 */
export async function persistRefreshedTokens(
  db: Database,
  id: string,
  lockToken: string,
  values: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: number;
    lastRefreshedAt: number;
    scopes?: string;
  },
): Promise<boolean> {
  const result = await db
    .update(accounts)
    .set({
      ...values,
      refreshLockUntil: null,
      refreshLockToken: null,
      updatedAt: nowSeconds(),
    })
    .where(and(eq(accounts.id, id), eq(accounts.refreshLockToken, lockToken)));
  return result.meta.changes === 1;
}

export async function bumpCacheEpoch(db: Database, id: string): Promise<void> {
  await db
    .update(accounts)
    .set({ cacheEpoch: sql`${accounts.cacheEpoch} + 1`, updatedAt: nowSeconds() })
    .where(eq(accounts.id, id));
}

/**
 * The first Account to reach `active` for an MCP with no default becomes the default.
 * The partial unique index makes a concurrent double-set fail rather than win silently.
 */
export async function makeDefaultIfNone(db: Database, account: Account): Promise<void> {
  const current = await findDefaultAccount(db, account.mcp);
  if (current) return;
  await updateAccount(db, account.id, { isDefault: 1 });
}

/** Clears the previous default and sets the new one in one D1 batch (one round trip). */
export async function setDefaultAccount(
  db: Database,
  mcp: McpSlug,
  id: string,
): Promise<void> {
  const now = nowSeconds();
  await db.batch([
    db
      .update(accounts)
      .set({ isDefault: 0, updatedAt: now })
      .where(and(eq(accounts.mcp, mcp), eq(accounts.isDefault, 1))),
    db.update(accounts).set({ isDefault: 1, updatedAt: now }).where(eq(accounts.id, id)),
  ]);
}

export async function countAccountsByState(
  db: Database,
  mcp: McpSlug,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ state: accounts.state, count: sql<number>`count(*)` })
    .from(accounts)
    .where(eq(accounts.mcp, mcp))
    .groupBy(accounts.state)
    .all();
  return Object.fromEntries(rows.map((row) => [row.state, Number(row.count)]));
}

export async function insertOAuthState(
  db: Database,
  attempt: NewOAuthAttempt,
): Promise<void> {
  await db.insert(oauthStates).values(attempt);
}

/** Single-use consumption: `DELETE … RETURNING` in one statement. */
export async function takeOAuthState(
  db: Database,
  state: string,
): Promise<OAuthAttempt | undefined> {
  const rows = await db.delete(oauthStates).where(eq(oauthStates.state, state)).returning();
  return rows[0];
}

export async function deleteExpiredOAuthStates(db: Database, now = nowSeconds()): Promise<void> {
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, now));
}
