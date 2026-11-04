import { CLIENT_CAPABILITIES_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { REQUIRED_SCOPES } from '@mcp-gateway/calendar';
import { encryptToken } from '../../src/auth/crypto';
import { createDb, nowSeconds } from '../../src/db/client';
import { insertAccount, updateAccount } from '../../src/db/queries';
import { TEST_ORIGIN, appFetch, mcpJwt } from '../support/access';
import { counters, resetProviderCounters } from '../support/providers';

const PROTOCOL_VERSION = '2026-07-28';

function envelope(body: Record<string, unknown>): Record<string, unknown> {
  const params = (body['params'] as Record<string, unknown> | undefined) ?? {};
  return {
    jsonrpc: '2.0',
    id: 1,
    ...body,
    params: {
      ...params,
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: PROTOCOL_VERSION,
        [CLIENT_CAPABILITIES_META_KEY]: {},
      },
    },
  };
}

async function rpc(
  body: Record<string, unknown>,
  slug = 'calendar',
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await appFetch(`${TEST_ORIGIN}/mcps/${slug}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Cf-Access-Jwt-Assertion': await mcpJwt(),
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      'Mcp-Method': String(body['method'] ?? ''),
      ...(typeof (body['params'] as Record<string, unknown> | undefined)?.['uri'] === 'string'
        ? { 'Mcp-Name': (body['params'] as Record<string, unknown>)['uri'] as string }
        : {}),
    },
    body: JSON.stringify(envelope(body)),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { text };
  }
  return { status: response.status, json };
}

async function seedAccount(
  state: 'active' | 'needs_reauth' = 'active',
  cacheEpoch = 0,
): Promise<string> {
  const id = crypto.randomUUID();
  await insertAccount(createDb(env), {
    id,
    mcp: 'calendar',
    slug: 'personal',
    provider: 'google',
    providerSubject: 'subject-1',
    email: 'operator@example.com',
    accessToken: await encryptToken(env.TOKEN_ENCRYPTION_KEY, 'ya29.access-one', id, 'access_token'),
    refreshToken: await encryptToken(env.TOKEN_ENCRYPTION_KEY, '1//refresh-one', id, 'refresh_token'),
    accessTokenExpiresAt: nowSeconds() + 3600,
    scopes: REQUIRED_SCOPES.join(' '),
    state,
    isDefault: 1,
    cacheEpoch,
    lastError: state === 'needs_reauth' ? 'invalid_grant' : null,
    createdAt: 0,
    updatedAt: 0,
  });
  return id;
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM oauth_states').run();
  await env.DB.prepare('DELETE FROM accounts').run();
  await env.CACHE.delete('v1:enum:calendar:personal:0');
  await env.CACHE.delete('v1:enum:calendar:personal:1');
});

describe('calendar resources', () => {
  it('returns an empty list, never an error, when there are no Accounts', async () => {
    const reply = await rpc({ method: 'resources/list', params: {} });
    const result = reply.json['result'] as { resources: unknown[]; resultType: string };
    expect(result.resources).toEqual([]);
    expect(result.resultType).toBe('complete');
  });

  it('lists one resource per calendar per usable Account', async () => {
    await seedAccount();
    const reply = await rpc({ method: 'resources/list', params: {} });
    const result = reply.json['result'] as {
      resources: { uri: string; name: string; mimeType: string }[];
      ttlMs: number;
      cacheScope: string;
    };

    const uris = result.resources.map((resource) => resource.uri);
    expect(uris).toContain('calendar://personal/calendars/primary');
    expect(uris).toContain('calendar://personal/calendars/team%40example.com');
    expect(result.resources.every((resource) => resource.mimeType === 'application/json')).toBe(true);
    expect(result.ttlMs).toBe(300_000);
    expect(result.cacheScope).toBe('private');
  });

  it('skips a sick Account, says so, and marks the listing uncacheable', async () => {
    await seedAccount('needs_reauth', 1);
    const reply = await rpc({ method: 'resources/list', params: {} });
    const result = reply.json['result'] as {
      resources: unknown[];
      ttlMs: number;
      _meta?: { 'mcp-gateway/skippedAccounts'?: string[] };
    };

    expect(result.resources).toEqual([]);
    expect(result.ttlMs).toBe(0);
    expect(result._meta?.['mcp-gateway/skippedAccounts']).toEqual(['personal']);
  });

  it('reads one calendar resource with a fixed one-week window', async () => {
    await seedAccount();
    const reply = await rpc({
      method: 'resources/read',
      params: { uri: 'calendar://personal/calendars/primary' },
    });
    const result = reply.json['result'] as {
      contents: { uri: string; mimeType: string; text: string }[];
      ttlMs: number;
    };

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]?.mimeType).toBe('application/json');
    const body = JSON.parse(result.contents[0]?.text ?? '{}') as {
      account: string;
      calendar: { id: string };
      window: { start: string; end: string };
      events: { summary?: string }[];
      truncated: boolean;
    };
    expect(body.account).toBe('personal');
    expect(body.calendar.id).toBe('primary');
    expect(Date.parse(body.window.end) - Date.parse(body.window.start)).toBe(7 * 24 * 3600 * 1000);
    expect(body.events[0]?.summary).toBe('Standup');
    expect(body.truncated).toBe(false);
    expect(result.ttlMs).toBe(30_000);
  });

  it('answers an unknown container with -32602 carrying data.uri', async () => {

    await seedAccount();
    const reply = await rpc({
      method: 'resources/read',
      params: { uri: 'calendar://personal/calendars/does-not-exist' },
    });
    const error = reply.json['error'] as { code: number; data?: { uri?: string } };
    expect(error.code).toBe(-32602);
    expect(error.data?.uri).toBe('calendar://personal/calendars/does-not-exist');
  });

  it('serves the second enumeration from KV and misses again after an epoch bump', async () => {
    const id = await seedAccount();
    await env.CACHE.delete('v1:enum:calendar:personal:0');
    resetProviderCounters();

    await rpc({ method: 'resources/list', params: {} });
    expect(counters.googleCalendarListRequests).toBe(1);

    await rpc({ method: 'resources/list', params: {} });
    expect(counters.googleCalendarListRequests).toBe(1);

    await updateAccount(createDb(env), id, { cacheEpoch: 1 });
    await rpc({ method: 'resources/list', params: {} });
    expect(counters.googleCalendarListRequests).toBe(2);
  });
});

