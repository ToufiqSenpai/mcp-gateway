import type { McpContext } from '@mcp-gateway/calendar';
import { REQUIRED_SCOPES as CALENDAR_SCOPES } from '@mcp-gateway/calendar';
import { REQUIRED_SCOPES as NOTES_SCOPES } from '@mcp-gateway/notes';
import { createCursorCodec } from '../mcps/pagination';
import { createEnumerationCache } from '../mcps/cache';
import type { Account, McpSlug } from '../db/schema';
import type { Database } from '../db/client';
import {
  bumpCacheEpoch,
  findAccountBySlug,
  findDefaultAccount,
  listAccountsByMcp,
  releaseRefreshLock,
  updateAccount,
} from '../db/queries';
import type { Env } from '../env';
import { decryptToken } from '../auth/crypto';
import { usableAccessToken } from './refresh';

export type UnusableReason =
  | 'missing'
  | 'no_default'
  | 'needs_reauth'
  | 'revoked'
  | 'missing_scope'
  | 'no_credentials';

/** The one error shape a tool turns into `isError`: the slug plus where to fix it. */
export class UnusableAccountError extends Error {
  constructor(
    readonly mcp: McpSlug,
    readonly slug: string,
    readonly reason: UnusableReason,
  ) {
    super(
      `Account "${slug}" is not usable (${reason}). Fix it at /admin/mcps/${mcp}.`,
    );
    this.name = 'UnusableAccountError';
  }
}

export function requiredScopes(mcp: McpSlug): readonly string[] {
  return mcp === 'calendar' ? CALENDAR_SCOPES : NOTES_SCOPES;
}

export function scopesCover(granted: string, required: readonly string[]): boolean {
  const grantedSet = new Set(granted.split(/\s+/).filter(Boolean));
  return required.every((scope) => grantedSet.has(scope));
}

/**
 * Explicit slug, otherwise the MCP's Default Account. Never falls back to another Account and
 * never infers a default at request time.
 */
export async function resolveAccount(
  db: Database,
  mcp: McpSlug,
  requestedSlug: string | undefined,
): Promise<Account> {
  if (requestedSlug) {
    const account = await findAccountBySlug(db, mcp, requestedSlug);
    if (!account) throw new UnusableAccountError(mcp, requestedSlug, 'missing');
    return account;
  }

  const fallback = await findDefaultAccount(db, mcp);
  if (!fallback) throw new UnusableAccountError(mcp, '(none)', 'no_default');
  return fallback;
}

/**
 * Demotes on lost scope coverage — the only detector for a Required set widened after a
 * deploy, where both stored and Provider scopes are unchanged.
 */
async function demoteForScope(db: Database, account: Account): Promise<never> {
  await updateAccount(db, account.id, { state: 'needs_reauth', lastError: 'missing_scope' });
  await releaseRefreshLock(db, account.id, account.refreshLockToken ?? '');
  await bumpCacheEpoch(db, account.id);
  throw new UnusableAccountError(account.mcp, account.slug, 'missing_scope');
}

async function assertUsable(db: Database, account: Account): Promise<void> {
  if (account.state === 'revoked') {
    throw new UnusableAccountError(account.mcp, account.slug, 'revoked');
  }
  if (account.state === 'needs_reauth') {
    const reason = account.lastError === 'missing_scope' ? 'missing_scope' : 'needs_reauth';
    throw new UnusableAccountError(account.mcp, account.slug, reason);
  }
  if (!account.accessToken || !account.refreshToken) {
    throw new UnusableAccountError(account.mcp, account.slug, 'no_credentials');
  }
  if (!scopesCover(account.scopes, requiredScopes(account.mcp))) {
    await demoteForScope(db, account);
  }
}

export async function accessTokenForAccount(
  env: Env,
  db: Database,
  account: Account,
): Promise<string> {
  await assertUsable(db, account);
  const token = await usableAccessToken(env, db, account);
  return token;
}

/** The narrow `McpContext` an MCP package receives. It never sees D1, arctic or the key. */
export function createMcpContext(
  env: Env,
  db: Database,
  mcp: McpSlug,
  waitUntil?: (promise: Promise<unknown>) => void,
): McpContext {
  const cache = createEnumerationCache(env, db, mcp, waitUntil);
  return {
    cursors: createCursorCodec(env),
    async invalidateEnumeration() {
      const rows = await listAccountsByMcp(db, mcp);
      await Promise.all(rows.map((row) => bumpCacheEpoch(db, row.id)));
    },
    enumeration: cache.get.bind(cache),
    async listAccounts() {
      const rows = await listAccountsByMcp(db, mcp);
      // Every Account is listed, broken ones included: selection must be able to say
      // precisely that the Default Account is unusable, never that there is no default.
      return rows.map((row) => ({ slug: row.slug, isDefault: row.isDefault === 1 }));
    },
    async getAccessToken(slug: string) {
      const account = await resolveAccount(db, mcp, slug);
      return accessTokenForAccount(env, db, account);
    },
    async refreshAccessToken(slug: string) {
      const account = await resolveAccount(db, mcp, slug);
      return usableAccessToken(env, db, account, true);
    },
  };
}

export async function decryptAccessToken(env: Env, account: Account): Promise<string> {
  if (!account.accessToken) {
    throw new UnusableAccountError(account.mcp, account.slug, 'no_credentials');
  }
  return decryptToken(env.TOKEN_ENCRYPTION_KEY, account.accessToken, account.id, 'access_token');
}
