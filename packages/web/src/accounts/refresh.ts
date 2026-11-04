import { OAuth2RequestError, type Google, type MicrosoftEntraId, type OAuth2Tokens } from 'arctic';
import { callbackUri, providerClient, requiredScopesFor } from '../auth/arctic';
import { decryptToken, encryptToken } from '../auth/crypto';
import type { Database } from '../db/client';
import { nowSeconds } from '../db/client';
import {
  bumpCacheEpoch,
  claimRefreshLock,
  findAccountById,
  persistRefreshedTokens,
  releaseRefreshLock,
  updateAccount,
} from '../db/queries';
import type { Account } from '../db/schema';
import type { Env } from '../env';
import { UnusableAccountError } from './lifecycle';

const REFRESH_WINDOW_SECONDS = 60;
const LOCK_LEASE_SECONDS = 30;
const LOCK_WAIT_MS = 2000;
const LOCK_POLL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function covers(granted: readonly string[], required: readonly string[]): boolean {
  const set = new Set(granted);
  return required.every((scope) => set.has(scope));
}

/** Permanent failures demote; everything else only records `last_error`. */
function isPermanentRefreshFailure(error: unknown): boolean {
  if (!(error instanceof OAuth2RequestError)) return false;
  return ['invalid_grant', 'interaction_required', 'invalid_client'].includes(error.code);
}

function providerErrorCode(error: unknown): string {
  if (error instanceof OAuth2RequestError) return error.code;
  if (error instanceof Error && error.name !== 'Error') return error.name;
  return 'refresh_failed';
}

async function demote(
  db: Database,
  account: Account,
  reason: 'needs_reauth' | 'missing_scope',
  lastError: string,
): Promise<never> {
  await updateAccount(db, account.id, {
    state: 'needs_reauth',
    lastError,
  });
  await releaseRefreshLock(db, account.id, account.refreshLockToken ?? '');
  await bumpCacheEpoch(db, account.id);
  throw new UnusableAccountError(account.mcp, account.slug, reason);
}

async function currentAccessToken(env: Env, account: Account): Promise<string> {
  if (!account.accessToken) throw new UnusableAccountError(account.mcp, account.slug, 'no_credentials');
  return decryptToken(env.TOKEN_ENCRYPTION_KEY, account.accessToken, account.id, 'access_token');
}

async function waitForOtherWriter(
  env: Env,
  db: Database,
  account: Account,
  deadline: number,
): Promise<string | undefined> {
  while (Date.now() < deadline) {
    await sleep(LOCK_POLL_MS);
    const fresh = await findAccountById(db, account.id);
    if (!fresh) throw new UnusableAccountError(account.mcp, account.slug, 'missing');
    if (fresh.accessTokenExpiresAt > account.accessTokenExpiresAt) {
      return currentAccessToken(env, fresh);
    }
    if (!fresh.refreshLockUntil || fresh.refreshLockUntil < nowSeconds()) {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Single-flight refresh: one write lease on the Account row, CAS on the lease token, and a
 * 30 s expiry so a Worker dying mid-refresh cannot freeze the Account (§10).
 */
export async function refreshAccount(
  env: Env,
  db: Database,
  account: Account,
): Promise<string> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  const lockToken = crypto.randomUUID();
  let claimed = await claimRefreshLock(db, account.id, lockToken, LOCK_LEASE_SECONDS);

  if (!claimed) {
    const advanced = await waitForOtherWriter(env, db, account, deadline);
    if (advanced) return advanced;
    claimed = await claimRefreshLock(db, account.id, lockToken, LOCK_LEASE_SECONDS);
  }

  if (!claimed) {
    // Still contended at the deadline: use the current token while it is valid, else retry.
    if (account.accessTokenExpiresAt > nowSeconds()) return currentAccessToken(env, account);
    throw new Error(`Account "${account.slug}" is being refreshed; retry shortly.`);
  }

  const fresh = (await findAccountById(db, account.id)) ?? account;
  if (!fresh.refreshToken) {
    await releaseRefreshLock(db, account.id, lockToken);
    throw new UnusableAccountError(account.mcp, account.slug, 'no_credentials');
  }

  let tokens: OAuth2Tokens;
  try {
    const refreshToken = await decryptToken(
      env.TOKEN_ENCRYPTION_KEY,
      fresh.refreshToken,
      fresh.id,
      'refresh_token',
    );
    const client = providerClient(
      env,
      fresh.provider,
      callbackUri('https://placeholder.invalid/', fresh.provider),
    );
    tokens =
      fresh.provider === 'microsoft'
        ? await (client as MicrosoftEntraId).refreshAccessToken(refreshToken, [
            ...requiredScopesFor(fresh.mcp),
          ])
        : await (client as Google).refreshAccessToken(refreshToken);
  } catch (error) {
    await releaseRefreshLock(db, account.id, lockToken);
    if (isPermanentRefreshFailure(error)) {
      const code = error instanceof OAuth2RequestError ? error.code : 'invalid_grant';
      await demote(db, account, 'needs_reauth', code);
    }
    await updateAccount(db, account.id, { lastError: providerErrorCode(error) });
    // A pre-emptive failure with a still-valid token proceeds with the old token.
    if (account.accessTokenExpiresAt > nowSeconds()) return currentAccessToken(env, account);
    throw new Error(`Account "${account.slug}" could not be refreshed; retry shortly.`);
  }

  const required = requiredScopesFor(fresh.mcp);
  // An absent scope field means unchanged, never empty (Microsoft may omit it).
  const granted = tokens.hasScopes() ? tokens.scopes() : fresh.scopes.split(/\s+/).filter(Boolean);
  if (!covers(granted, required)) {
    await demote(db, fresh, 'missing_scope', 'missing_scope');
  }

  const refreshToken = tokens.hasRefreshToken()
    ? await encryptToken(env.TOKEN_ENCRYPTION_KEY, tokens.refreshToken(), fresh.id, 'refresh_token')
    : (fresh.refreshToken as string);

  const persisted = await persistRefreshedTokens(db, fresh.id, lockToken, {
    accessToken: await encryptToken(
      env.TOKEN_ENCRYPTION_KEY,
      tokens.accessToken(),
      fresh.id,
      'access_token',
    ),
    refreshToken,
    accessTokenExpiresAt: Math.floor(tokens.accessTokenExpiresAt().getTime() / 1000),
    lastRefreshedAt: nowSeconds(),
    scopes: granted.join(' '),
  });

  if (!persisted) {
    // Another writer won the lease; use what is stored now.
    const winner = await findAccountById(db, fresh.id);
    if (winner) return currentAccessToken(env, winner);
  }

  return tokens.accessToken();
}

/**
 * Returns a token with more than 60 s of life, refreshing pre-emptively when needed.
 * `force` is the reactive path after a Provider 401.
 */
export async function usableAccessToken(
  env: Env,
  db: Database,
  account: Account,
  force = false,
): Promise<string> {
  if (!force && account.accessTokenExpiresAt - nowSeconds() > REFRESH_WINDOW_SECONDS) {
    return currentAccessToken(env, account);
  }
  return refreshAccount(env, db, account);
}
