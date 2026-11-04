import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

let counter = 0;

function baseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  counter += 1;
  return {
    id: crypto.randomUUID(),
    mcp: 'calendar',
    slug: `acct-${counter}`,
    provider: 'google',
    provider_subject: `subject-${counter}`,
    email: 'operator@example.com',
    display_name: null,
    access_token: null,
    refresh_token: null,
    access_token_expires_at: 0,
    scopes: '',
    state: 'active',
    is_default: 0,
    cache_epoch: 0,
    refresh_lock_until: null,
    refresh_lock_token: null,
    last_refreshed_at: null,
    last_error: null,
    created_at: 0,
    updated_at: 0,
    revoked_at: null,
    ...overrides,
  };
}

async function insert(row: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(row);
  await env.DB.prepare(
    `INSERT INTO accounts (${columns.map((name) => `"${name}"`).join(', ')}) VALUES (${columns
      .map(() => '?')
      .join(', ')})`,
  )
    .bind(...Object.values(row))
    .run();
}

describe('accounts constraints', () => {
  it('rejects a duplicate slug within one MCP', async () => {
    await insert(baseRow({ slug: 'personal' }));
    await expect(insert(baseRow({ slug: 'personal' }))).rejects.toThrow(/UNIQUE/i);
  });

  it('allows the same slug under a different MCP', async () => {
    await insert(baseRow({ slug: 'shared', mcp: 'calendar', provider: 'google' }));
    await insert(baseRow({ slug: 'shared', mcp: 'notes', provider: 'microsoft' }));
  });

  it('rejects one Provider identity twice in the same MCP', async () => {
    await insert(baseRow({ provider_subject: 'subject-a' }));
    await expect(insert(baseRow({ provider_subject: 'subject-a' }))).rejects.toThrow(/UNIQUE/i);
  });

  it('rejects a second default Account for one MCP', async () => {
    await insert(baseRow({ slug: 'first', is_default: 1 }));
    await expect(insert(baseRow({ slug: 'second', is_default: 1 }))).rejects.toThrow(/UNIQUE/i);
  });

  it('rejects an MCP/provider pairing that does not exist', async () => {
    await expect(
      insert(baseRow({ mcp: 'calendar', provider: 'microsoft' })),
    ).rejects.toThrow(/CHECK/i);
    await expect(insert(baseRow({ mcp: 'notes', provider: 'google' }))).rejects.toThrow(/CHECK/i);
  });

  it('rejects an unknown MCP, provider or state', async () => {
    await expect(insert(baseRow({ mcp: 'mail' }))).rejects.toThrow(/CHECK/i);
    await expect(insert(baseRow({ provider: 'yahoo' }))).rejects.toThrow(/CHECK/i);
    await expect(insert(baseRow({ state: 'expired' }))).rejects.toThrow(/CHECK/i);
  });

  it('rejects a slug that does not start with a lowercase letter or digit', async () => {
    await expect(insert(baseRow({ slug: 'Personal' }))).rejects.toThrow(/CHECK/i);
    await expect(insert(baseRow({ slug: 'personal_1' }))).rejects.toThrow(/CHECK/i);
  });
});

describe('oauth_states', () => {
  it('rejects an unknown MCP on the state row', async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO oauth_states (state, mcp, provider, slug, code_verifier, created_at, expires_at)
         VALUES (?, 'mail', 'google', 'personal', 'verifier', 0, 600)`,
      )
        .bind(crypto.randomUUID())
        .run(),
    ).rejects.toThrow(/CHECK/i);
  });
});
