import { describe, expect, it } from 'vitest';
import { AccessError, isDevBypass, verifyAccess } from '../../src/auth/access';
import type { Env } from '../../src/env';

const production = {
  ENVIRONMENT: 'production',
  CF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com',
  CF_ACCESS_ADMIN_AUD: 'admin-aud',
  CF_ACCESS_MCP_AUD: 'mcp-aud',
} as Env;

const development = { ...production, ENVIRONMENT: 'development' } as Env;

describe('development auth bypass', () => {
  it('is unreachable when ENVIRONMENT is production, even on localhost', () => {
    expect(isDevBypass(production, 'http://localhost:8787/admin')).toBe(false);
    expect(isDevBypass(production, 'http://127.0.0.1:8787/admin')).toBe(false);
  });

  it('requires a localhost host as well as ENVIRONMENT=development', () => {
    expect(isDevBypass(development, 'http://localhost:8787/admin')).toBe(true);
    expect(isDevBypass(development, 'http://127.0.0.1:8787/admin')).toBe(true);
    expect(isDevBypass(development, 'https://gateway.example.com/admin')).toBe(false);
  });

  it('refuses a request with no Access assertion in production', async () => {
    const request = new Request('https://gateway.example.com/admin');
    await expect(verifyAccess(request, production, 'admin')).rejects.toBeInstanceOf(AccessError);
  });
});
