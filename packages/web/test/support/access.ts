import { SELF } from 'cloudflare:test';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

export const TEST_ORIGIN = 'https://gateway.example.com';

/** The Worker under test, as it is deployed. */
export const appFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  SELF.fetch(input as RequestInfo, init);
export const TEAM_DOMAIN = 'https://test.cloudflareaccess.com';
const KID = 'test-access-key';

let material: Promise<{ privateKey: CryptoKey; jwks: JsonWebKey[] }> | undefined;

/**
 * A throwaway signing key for real Access assertions. The public half is served by the test
 * fetch router, so `jose` verifies exactly the way it does in production — the dev bypass is
 * never used.
 */
export function accessKeys(): Promise<{ privateKey: CryptoKey; jwks: JsonWebKey[] }> {
  material ??= (async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
    return { privateKey, jwks: [jwk as JsonWebKey] };
  })();
  return material;
}

export async function accessJwt(group: 'admin' | 'mcp'): Promise<string> {
  const { privateKey } = await accessKeys();
  const audience = group === 'admin' ? 'test-admin-aud' : 'test-mcp-aud';
  const claims =
    group === 'admin'
      ? { sub: crypto.randomUUID(), email: 'operator@example.com' }
      : { sub: '', common_name: 'test-mcp-client' };

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(TEAM_DOMAIN)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

/** A browser-shaped client that keeps cookies and sends an admin Access assertion. */
export class TestBrowser {
  private readonly cookies = new Map<string, string>();

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Cf-Access-Jwt-Assertion', await accessJwt('admin'));
    headers.set('Origin', TEST_ORIGIN);
    if (this.cookies.size > 0) {
      headers.set(
        'Cookie',
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    }

    const response = await appFetch(`${TEST_ORIGIN}${path}`, {
      ...init,
      headers,
      redirect: 'manual',
    });

    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const index = pair?.indexOf('=') ?? -1;
      if (!pair || index < 0) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }

    return response;
  }

  async get(path: string): Promise<Response> {
    return this.fetch(path);
  }

  async postForm(path: string, fields: Record<string, string>): Promise<Response> {
    return this.fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
  }

  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

/** Reads the double-submit token out of a rendered admin page. */
export async function csrfFromPage(browser: TestBrowser, path: string): Promise<string> {
  const response = await browser.get(path);
  const html = await response.text();
  const match = /name="_csrf" value="([^"]+)"/.exec(html);
  if (!match?.[1]) throw new Error('no CSRF field on the page');
  return match[1];
}

export async function adminJwt(): Promise<string> {
  return accessJwt('admin');
}

export async function mcpJwt(): Promise<string> {
  return accessJwt('mcp');
}
