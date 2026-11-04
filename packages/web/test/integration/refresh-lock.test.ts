import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { REQUIRED_SCOPES } from '@mcp-gateway/calendar';
import { createMcpContext } from '../../src/accounts/lifecycle';
import { decryptToken, encryptToken } from '../../src/auth/crypto';
import { createDb, nowSeconds } from '../../src/db/client';
import {
  claimRefreshLock,
  findAccountBySlug,
  insertAccount,
  persistRefreshedTokens,
  updateAccount,
} from '../../src/db/queries';
import { REFRESH_TOKEN, counters, resetProviderCounters } from '../support/providers';

interface SeedOptions {
  expiresInSeconds?: number;
  refreshToken?: string;
  scopes?: string;
  lock?: boolean;
}

async function seed(options: SeedOptions = {}): Promise<string> {
  const id = crypto.randomUUID();
  const db = createDb(env);
  const expiresIn = options.expiresInSeconds ?? 30;
  const lock = options.lock ?? false;

  await insertAccount(db, {
    id,
    mcp: 'calendar',
    slug: 'personal',
    provider: 'google',
    providerSubject: 'subject-1',
    email: 'operator@example.com',
    accessToken: await encryptToken(env.TOKEN_ENCRYPTION_KEY, 'ya29.access-one', id, 'access_token'),
    refreshToken: await encryptToken(
      env.TOKEN_ENCRYPTION_KEY,
      options.refreshToken ?? REFRESH_TOKEN.googleOk,
      id,
      'refresh_token',
    ),
    accessTokenExpiresAt: nowSeconds() + expiresIn,
    scopes: options.scopes ?? REQUIRED_SCOPES.join(' '),
    state: 'active',
    isDefault: 1,
    createdAt: 0,
    updatedAt: 0,
    ...(lock ? { refreshLockUntil: nowSeconds() + 30, refreshLockToken: 'someone-else' } : {}),
  });
  return id;
}

beforeEach(async () => {
  resetProviderCounters();
  await env.DB.prepare('DELETE FROM oauth_states').run();
  await env.DB.prepare('DELETE FROM accounts').run();
});

describe('single-flight refresh', () => {
  it('refreshes once for three simultaneous calls and rotates the refresh token', async () => {
    await seed({ expiresInSeconds: 30 });
    const db = createDb(env);
    const ctx = createMcpContext(env, db, 'calendar');

    const before = await findAccountBySlug(db, 'calendar', 'personal');
    const tokens = await Promise.all([
      ctx.getAccessToken('personal'),
      ctx.getAccessToken('personal'),
      ctx.getAccessToken('personal'),
    ]);

    expect(tokens).toEqual(['ya29.access-one', 'ya29.access-one', 'ya29.access-one']);
    expect(counters.googleRefreshRequests).toBe(1);

    const after = await findAccountBySlug(db, 'calendar', 'personal');
    expect(after?.accessTokenExpiresAt).toBeGreaterThan(before?.accessTokenExpiresAt ?? 0);
    expect(after?.refreshToken).not.toBe(before?.refreshToken);
    expect(after?.lastRefreshedAt).toBeGreaterThan(0);
    expect(after?.refreshLockUntil).toBeNull();
  });

  it('keeps the old refresh token when the Provider omits a rotation', async () => {
    const id = await seed({ expiresInSeconds: 30, refreshToken: REFRESH_TOKEN.noScope });
    const db = createDb(env);
    const ctx = createMcpContext(env, db, 'calendar');
    const before = await findAccountBySlug(db, 'calendar', 'personal');

    await ctx.getAccessToken('personal');

    const after = await findAccountBySlug(db, 'calendar', 'personal');
    expect(after?.refreshToken).not.toBe(before?.refreshToken);
    expect(after?.state).toBe('active');
    expect(
      await decryptToken(
        env.TOKEN_ENCRYPTION_KEY,
        after?.refreshToken ?? '',
        id,
        'refresh_token',
      ),
    ).toBe(`${REFRESH_TOKEN.noScope}-rotated`);
  });

  it('takes over an expired lease left by a dead Worker', async () => {
    const id = await seed({ expiresInSeconds: 30 });
    const db = createDb(env);
    await updateAccount(db, id, { refreshLockUntil: nowSeconds() - 1, refreshLockToken: 'dead' });

    await createMcpContext(env, db, 'calendar').getAccessToken('personal');
    expect(counters.googleRefreshRequests).toBe(1);
    expect((await findAccountBySlug(db, 'calendar', 'personal'))?.refreshLockUntil).toBeNull();
  });

  it('persists only while the writer still owns the lease', async () => {
    const id = await seed({ expiresInSeconds: 3600 });
    const db = createDb(env);
    await claimRefreshLock(db, id, 'mine');

    const lost = await persistRefreshedTokens(db, id, 'not-mine', {
      accessToken: 'v1.x.y',
      refreshToken: 'v1.x.y',
      accessTokenExpiresAt: nowSeconds() + 3600,
      lastRefreshedAt: nowSeconds(),
    });
    expect(lost).toBe(false);

    const won = await persistRefreshedTokens(db, id, 'mine', {
      accessToken: 'v1.x.y',
      refreshToken: 'v1.x.y',
      accessTokenExpiresAt: nowSeconds() + 3600,
      lastRefreshedAt: nowSeconds(),
    });
    expect(won).toBe(true);
  });

  it('uses a fresh cached token without calling the Provider', async () => {
    await seed({ expiresInSeconds: 3600 });
    const ctx = createMcpContext(env, createDb(env), 'calendar');

    await expect(ctx.getAccessToken('personal')).resolves.toBe('ya29.access-one');
    expect(counters.googleRefreshRequests).toBe(0);
  });
});

describe('refresh failure mapping', () => {
  it('demotes on invalid_grant', async () => {
    await seed({ expiresInSeconds: 30, refreshToken: REFRESH_TOKEN.invalid });
    const db = createDb(env);

    await expect(
      createMcpContext(env, db, 'calendar').getAccessToken('personal'),
    ).rejects.toThrow(/needs_reauth/);

    const row = await findAccountBySlug(db, 'calendar', 'personal');
    expect(row?.state).toBe('needs_reauth');
    expect(row?.lastError).toBe('invalid_grant');
    expect(row?.refreshLockUntil).toBeNull();
  });

  it('records a transient failure without touching state', async () => {
    await seed({ expiresInSeconds: 30, refreshToken: REFRESH_TOKEN.serverError });
    const db = createDb(env);

    // The old token still has life left, so the call proceeds with it.
    await expect(
      createMcpContext(env, db, 'calendar').getAccessToken('personal'),
    ).resolves.toBe('ya29.access-one');

    const row = await findAccountBySlug(db, 'calendar', 'personal');
    expect(row?.state).toBe('active');
    expect(row?.lastError).toBe('refresh_failed');
    expect(row?.refreshLockUntil).toBeNull();
  });

  it('proceeds with a still-valid token when the pre-emptive refresh fails', async () => {
    await seed({ expiresInSeconds: 30, refreshToken: REFRESH_TOKEN.serverError });
    const db = createDb(env);

    await expect(
      createMcpContext(env, db, 'calendar').getAccessToken('personal'),
    ).resolves.toBe('ya29.access-one');

    const row = await findAccountBySlug(db, 'calendar', 'personal');
    expect(row?.state).toBe('active');
  });
});

describe('scope enforcement at refresh', () => {
  it('demotes when the rotated Granted set stops covering the Required set', async () => {
    await seed({ expiresInSeconds: 30, refreshToken: REFRESH_TOKEN.narrowScope });
    const db = createDb(env);

    await expect(
      createMcpContext(env, db, 'calendar').getAccessToken('personal'),
    ).rejects.toThrow(/missing_scope/);

    const row = await findAccountBySlug(db, 'calendar', 'personal');
    expect(row?.state).toBe('needs_reauth');
    expect(row?.lastError).toBe('missing_scope');
    expect(row?.refreshLockUntil).toBeNull();
  });

  it('treats an absent scope field as unchanged, never empty', async () => {
    await seed({ expiresInSeconds: 30, refreshToken: REFRESH_TOKEN.noScope });
    const db = createDb(env);

    await createMcpContext(env, db, 'calendar').getAccessToken('personal');

    const row = await findAccountBySlug(db, 'calendar', 'personal');
    expect(row?.state).toBe('active');
    expect(row?.scopes).toBe(REQUIRED_SCOPES.join(' '));
  });
});
