import { generateCodeVerifier, generateState, type OAuth2Tokens } from 'arctic';
import { authorizeUrl, callbackUri, providerClient, requiredScopesFor } from '../auth/arctic';
import { encryptToken } from '../auth/crypto';
import type { Database } from '../db/client';
import { nowSeconds } from '../db/client';
import {
  bumpCacheEpoch,
  claimRefreshLock,
  findAccountById,
  findAccountByIdentity,
  findAccountBySlug,
  insertAccount,
  insertOAuthState,
  makeDefaultIfNone,
  releaseRefreshLock,
  takeOAuthState,
  updateAccount,
} from '../db/queries';
import type { Account, McpSlug, Provider } from '../db/schema';
import type { Env } from '../env';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const STATE_TTL_SECONDS = 600;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export class RetryableContentionError extends Error {
  constructor() {
    super('A token refresh is in progress for this Account; retry shortly.');
    this.name = 'RetryableContentionError';
  }
}

export class IdentityMismatchError extends Error {
  constructor() {
    super('The Provider identity does not match the Account being reauthorized.');
    this.name = 'IdentityMismatchError';
  }
}

export class SlugTakenError extends Error {
  constructor() {
    super('That slug is already reserved for this MCP.');
    this.name = 'SlugTakenError';
  }
}

export class NoRefreshTokenError extends Error {
  constructor() {
    super('The Provider issued no refresh token, so the Account would not be usable.');
    this.name = 'NoRefreshTokenError';
  }
}

export interface StartFlowInput {
  mcp: McpSlug;
  provider: Provider;
  slug: string;
  targetAccountId?: string;
  requestUrl: string;
}

export interface StartedFlow {
  state: string;
  authorizeUrl: string;
}

/** Writes the single-use attempt and returns where to send the browser. */
export async function startAuthorization(
  env: Env,
  db: Database,
  input: StartFlowInput,
): Promise<StartedFlow> {
  if (!isValidSlug(input.slug)) throw new SlugTakenError();

  const existing = await findAccountBySlug(db, input.mcp, input.slug);
  if (!input.targetAccountId && existing) throw new SlugTakenError();

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const now = nowSeconds();

  await insertOAuthState(db, {
    state,
    mcp: input.mcp,
    provider: input.provider,
    slug: input.slug,
    codeVerifier,
    targetAccountId: input.targetAccountId ?? null,
    createdAt: now,
    expiresAt: now + STATE_TTL_SECONDS,
  });

  const client = providerClient(env, input.provider, callbackUri(input.requestUrl, input.provider));
  return { state, authorizeUrl: authorizeUrl(client, input.provider, state, codeVerifier, input.mcp).href };
}

export interface CallbackInput {
  provider: Provider;
  state: string;
  code: string;
  requestUrl: string;
}

export interface CallbackOutcome {
  mcp: McpSlug;
  addedSlug?: string;
  error?:
    | 'denied'
    | 'duplicate'
    | 'no_refresh_token'
    | 'state'
    | 'identity_mismatch'
    | 'slug_taken'
    | 'missing_scope';
  duplicateSlug?: string;
}

export function grantedScopes(tokens: OAuth2Tokens): string[] {
  return tokens.hasScopes() ? tokens.scopes() : [];
}

export function covers(granted: readonly string[], required: readonly string[]): boolean {
  const set = new Set(granted);
  return required.every((scope) => set.has(scope));
}

async function fetchIdentity(
  provider: Provider,
  accessToken: string,
): Promise<{ subject: string; email: string; displayName?: string }> {
  if (provider === 'google') {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error('Google identity fetch failed');
    const data = (await response.json()) as { sub?: string; email?: string; name?: string };
    if (!data.sub || !data.email) throw new Error('Google identity is incomplete');
    return {
      subject: data.sub,
      email: data.email,
      ...(data.name ? { displayName: data.name } : {}),
    };
  }

  const response = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('Microsoft identity fetch failed');
  const data = (await response.json()) as {
    id?: string;
    mail?: string | null;
    userPrincipalName?: string;
    displayName?: string;
  };
  const email = data.mail ?? data.userPrincipalName;
  if (!data.id || !email) throw new Error('Microsoft identity is incomplete');
  return {
    subject: data.id,
    email,
    ...(data.displayName ? { displayName: data.displayName } : {}),
  };
}

async function persistNewAccount(
  env: Env,
  db: Database,
  input: {
    mcp: McpSlug;
    slug: string;
    provider: Provider;
    identity: { subject: string; email: string; displayName?: string };
    tokens: OAuth2Tokens;
    scopes: string[];
  },
): Promise<Account> {
  const id = crypto.randomUUID();
  const now = nowSeconds();
  const [accessToken, refreshToken] = await Promise.all([
    encryptToken(env.TOKEN_ENCRYPTION_KEY, input.tokens.accessToken(), id, 'access_token'),
    encryptToken(env.TOKEN_ENCRYPTION_KEY, input.tokens.refreshToken(), id, 'refresh_token'),
  ]);

  await insertAccount(db, {
    id,
    mcp: input.mcp,
    slug: input.slug,
    provider: input.provider,
    providerSubject: input.identity.subject,
    email: input.identity.email,
    displayName: input.identity.displayName ?? null,
    accessToken,
    refreshToken,
    accessTokenExpiresAt: Math.floor(input.tokens.accessTokenExpiresAt().getTime() / 1000),
    scopes: input.scopes.join(' '),
    state: 'active',
    isDefault: 0,
    cacheEpoch: 0,
    lastRefreshedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  const account = await findAccountById(db, id);
  if (!account) throw new Error('Account insert did not persist');
  await makeDefaultIfNone(db, account);
  await bumpCacheEpoch(db, id);
  return (await findAccountById(db, id)) ?? account;
}

async function applyReauth(
  env: Env,
  db: Database,
  account: Account,
  identity: { subject: string },
  tokens: OAuth2Tokens,
  scopes: string[],
): Promise<void> {
  if (identity.subject !== account.providerSubject) throw new IdentityMismatchError();

  // The same lease the refresh path uses, so a reauth can never overwrite a token mid-rotation.
  const lockToken = crypto.randomUUID();
  if (!(await claimRefreshLock(db, account.id, lockToken))) throw new RetryableContentionError();

  try {
    const [accessToken, refreshToken] = await Promise.all([
      encryptToken(env.TOKEN_ENCRYPTION_KEY, tokens.accessToken(), account.id, 'access_token'),
      encryptToken(env.TOKEN_ENCRYPTION_KEY, tokens.refreshToken(), account.id, 'refresh_token'),
    ]);
    await updateAccount(db, account.id, {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: Math.floor(tokens.accessTokenExpiresAt().getTime() / 1000),
      scopes: scopes.join(' '),
      state: 'active',
      lastRefreshedAt: nowSeconds(),
      lastError: null,
      revokedAt: null,
    });
    await releaseRefreshLock(db, account.id, lockToken);
    await bumpCacheEpoch(db, account.id);
  } catch (error) {
    await releaseRefreshLock(db, account.id, lockToken);
    throw error;
  }
}

/**
 * Everything after the state row is validated: exchange, identity, duplicate and scope checks,
 * then the write. Any refusal leaves the database untouched.
 */
export async function completeAuthorization(
  env: Env,
  db: Database,
  input: CallbackInput,
): Promise<CallbackOutcome> {
  const attempt = await takeOAuthState(db, input.state);
  if (!attempt || attempt.expiresAt < nowSeconds() || attempt.provider !== input.provider) {
    return { mcp: attempt?.mcp ?? 'calendar', error: 'state' };
  }

  const mcp = attempt.mcp;
  const required = requiredScopesFor(mcp);
  const client = providerClient(env, attempt.provider, callbackUri(input.requestUrl, input.provider));

  let tokens: OAuth2Tokens;
  try {
    tokens = await client.validateAuthorizationCode(input.code, attempt.codeVerifier);
  } catch {
    return { mcp, error: 'denied' };
  }

  if (!tokens.hasRefreshToken()) return { mcp, error: 'no_refresh_token' };

  const scopes = grantedScopes(tokens);
  if (covers(scopes, required) === false) return { mcp, error: 'missing_scope' };

  let identity: { subject: string; email: string; displayName?: string };
  try {
    identity = await fetchIdentity(attempt.provider, tokens.accessToken());
  } catch {
    return { mcp, error: 'denied' };
  }

  const duplicate = await findAccountByIdentity(
    db,
    mcp,
    attempt.provider,
    identity.subject,
  );
  if (duplicate && duplicate.id !== attempt.targetAccountId) {
    return { mcp, error: 'duplicate', duplicateSlug: duplicate.slug };
  }

  if (attempt.targetAccountId) {
    const target = await findAccountById(db, attempt.targetAccountId);
    if (!target) return { mcp, error: 'state' };
    // A reauth must never narrow a working Credential.
    if (!covers(scopes, required) || !covers(target.scopes.split(/\s+/).filter(Boolean), scopes)) {
      return { mcp, error: 'missing_scope' };
    }
    try {
      await applyReauth(env, db, target, identity, tokens, scopes);
    } catch (error) {
      if (error instanceof IdentityMismatchError) return { mcp, error: 'identity_mismatch' };
      if (error instanceof RetryableContentionError) return { mcp, error: 'state' };
      return { mcp, error: 'denied' };
    }
    return { mcp, addedSlug: target.slug };
  }

  const slugTaken = await findAccountBySlug(db, mcp, attempt.slug);
  if (slugTaken) return { mcp, error: 'slug_taken' };

  try {
    await persistNewAccount(env, db, {
      mcp,
      slug: attempt.slug,
      provider: attempt.provider,
      identity,
      tokens,
      scopes,
    });
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return { mcp, error: 'duplicate' };
    }
    return { mcp, error: 'denied' };
  }

  return { mcp, addedSlug: attempt.slug };
}
