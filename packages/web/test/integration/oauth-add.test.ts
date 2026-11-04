import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { TEST_ORIGIN, TestBrowser, adminJwt, appFetch, csrfFromPage } from '../support/access';
import { CODE } from '../support/providers';

interface AccountRow {
  slug: string;
  state: string;
  is_default: number;
  email: string;
  access_token: string | null;
  refresh_token: string | null;
  provider_subject: string;
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM oauth_states').run();
  await env.DB.prepare('DELETE FROM accounts').run();
});

function locationPath(location: string): string {
  const url = new URL(location, TEST_ORIGIN);
  return `${url.pathname}${url.search}`;
}

async function startFlow(
  browser: TestBrowser,
  options: { slug: string; mcp?: string },
): Promise<URL> {
  const mcp = options.mcp ?? 'calendar';
  const csrf = await csrfFromPage(browser, `/admin/mcps/${mcp}`);
  const response = await browser.postForm(`/admin/mcps/${mcp}/accounts`, {
    _csrf: csrf,
    slug: options.slug,
  });
  expect(response.status).toBe(303);
  return new URL(response.headers.get('location') ?? '');
}

async function callback(browser: TestBrowser, state: string, code: string = CODE.googleOk) {
  return browser.get(`/oauth/callback/google?state=${encodeURIComponent(state)}&code=${code}`);
}

async function account(slug: string): Promise<AccountRow | null> {
  return env.DB.prepare('SELECT * FROM accounts WHERE slug = ?').bind(slug).first<AccountRow>();
}

describe('adding a Google Account', () => {
  it('runs the whole flow and stores encrypted, default, active Credentials', async () => {
    const browser = new TestBrowser();
    const authorize = await startFlow(browser, { slug: 'personal' });

    expect(authorize.origin).toBe('https://accounts.google.com');
    expect(authorize.searchParams.get('access_type')).toBe('offline');
    expect(authorize.searchParams.get('prompt')).toBe('consent');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('scope')).toContain(
      'https://www.googleapis.com/auth/calendar',
    );

    const state = authorize.searchParams.get('state') ?? '';
    const response = await callback(browser, state);
    expect(response.status).toBe(303);
    expect(locationPath(response.headers.get('location') ?? '')).toBe(
      '/admin/mcps/calendar?added=personal',
    );

    const row = await account('personal');
    expect(row?.state).toBe('active');
    expect(row?.is_default).toBe(1);
    expect(row?.email).toBe('operator@example.com');
    expect(row?.provider_subject).toBe('google-subject-1');
    expect(row?.access_token).toMatch(/^v1\.[A-Za-z0-9_-]{16}\./);
    expect(row?.access_token).not.toContain('ya29');
    expect(row?.refresh_token).not.toContain('refresh-one');

    // The state row is consumed in the statement that validates it.
    const remaining = await env.DB.prepare('SELECT count(*) AS count FROM oauth_states').first<{
      count: number;
    }>();
    expect(Number(remaining?.count)).toBe(0);
  });

  it('refuses a replayed state', async () => {
    const browser = new TestBrowser();
    const authorize = await startFlow(browser, { slug: 'personal' });
    const state = authorize.searchParams.get('state') ?? '';

    expect((await callback(browser, state)).status).toBe(303);
    const replay = await callback(browser, state);
    expect(locationPath(replay.headers.get('location') ?? '')).toContain('error=state');
  });

  it('refuses a callback whose state does not match the cookie', async () => {
    const browser = new TestBrowser();
    const authorize = await startFlow(browser, { slug: 'personal' });
    const state = authorize.searchParams.get('state') ?? '';

    const other = new TestBrowser();
    const response = await callback(other, state);
    expect(locationPath(response.headers.get('location') ?? '')).toBe('/admin?error=state');
    expect(await account('personal')).toBeNull();
  });

  it('refuses an account with no refresh token', async () => {
    const browser = new TestBrowser();
    const authorize = await startFlow(browser, { slug: 'personal' });

    const response = await callback(
      browser,
      authorize.searchParams.get('state') ?? '',
      CODE.googleNoRefresh,
    );
    expect(locationPath(response.headers.get('location') ?? '')).toBe(
      '/admin/mcps/calendar?error=no_refresh_token',
    );
    expect(await account('personal')).toBeNull();
  });

  it('refuses an Account that does not hold the Required scope set', async () => {
    const browser = new TestBrowser();
    const authorize = await startFlow(browser, { slug: 'personal' });

    const response = await callback(
      browser,
      authorize.searchParams.get('state') ?? '',
      CODE.googleNarrow,
    );
    expect(locationPath(response.headers.get('location') ?? '')).toBe(
      '/admin/mcps/calendar?error=missing_scope',
    );
    expect(await account('personal')).toBeNull();
  });

  it('refuses a duplicate Provider identity and names the existing slug', async () => {
    const browser = new TestBrowser();
    const first = await startFlow(browser, { slug: 'personal' });
    await callback(browser, first.searchParams.get('state') ?? '');

    const second = await startFlow(browser, { slug: 'work' });
    const response = await callback(
      browser,
      second.searchParams.get('state') ?? '',
      CODE.googleSecond,
    );
    expect(locationPath(response.headers.get('location') ?? '')).toBe(
      '/admin/mcps/calendar?added=work',
    );

    const third = await startFlow(browser, { slug: 'other' });
    const duplicate = await callback(
      browser,
      third.searchParams.get('state') ?? '',
      CODE.googleSecond,
    );
    expect(locationPath(duplicate.headers.get('location') ?? '')).toBe(
      '/admin/mcps/calendar?error=duplicate&slug=work',
    );
    expect(await account('other')).toBeNull();
  });

  it('refuses a slug that is already reserved', async () => {
    const browser = new TestBrowser();
    const first = await startFlow(browser, { slug: 'personal' });
    await callback(browser, first.searchParams.get('state') ?? '');

    const csrf = await csrfFromPage(browser, '/admin/mcps/calendar');
    const response = await browser.postForm('/admin/mcps/calendar/accounts', {
      _csrf: csrf,
      slug: 'personal',
    });
    expect(locationPath(response.headers.get('location') ?? '')).toBe(
      '/admin/mcps/calendar?error=slug_taken',
    );
  });

  it('maps a Provider access_denied to denied without writing', async () => {
    const browser = new TestBrowser();
    const authorize = await startFlow(browser, { slug: 'personal' });
    const state = authorize.searchParams.get('state') ?? '';

    const response = await browser.get(
      `/oauth/callback/google?state=${encodeURIComponent(state)}&error=access_denied`,
    );
    expect(locationPath(response.headers.get('location') ?? '')).toBe(
      '/admin/mcps/calendar?error=denied',
    );
    expect(await account('personal')).toBeNull();
  });

  it('refuses a mutation without the CSRF token or a matching Origin', async () => {
    const token = await adminJwt();
    const noCsrf = await appFetch(`${TEST_ORIGIN}/admin/mcps/calendar/accounts`, {
      method: 'POST',
      headers: {
        'Cf-Access-Jwt-Assertion': token,
        Origin: TEST_ORIGIN,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'slug=personal&_csrf=wrong',
      redirect: 'manual',
    });
    expect(noCsrf.status).toBe(403);

    const noOrigin = await appFetch(`${TEST_ORIGIN}/admin/mcps/calendar/accounts`, {
      method: 'POST',
      headers: {
        'Cf-Access-Jwt-Assertion': token,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'slug=personal&_csrf=anything',
      redirect: 'manual',
    });
    expect(noOrigin.status).toBe(403);
  });
});

