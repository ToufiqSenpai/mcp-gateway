import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

const CSRF_COOKIE = 'admin_csrf';
const CSRF_MAX_AGE = 60 * 60 * 8;
const ADMIN_COOKIE = { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' } as const;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Double-submit CSRF: the token lives in an HttpOnly cookie and is echoed in a hidden form
 * field. It is created on the first GET and reused for the session.
 */
export function ensureCsrfToken(c: Context): string {
  const existing = getCookie(c, CSRF_COOKIE);
  if (existing) return existing;
  const token = randomToken();
  setCookie(c, CSRF_COOKIE, token, { ...ADMIN_COOKIE, maxAge: CSRF_MAX_AGE });
  return token;
}

export function setOAuthFlowCookie(c: Context, state: string): void {
  setCookie(c, 'oauth_flow', state, { ...ADMIN_COOKIE, maxAge: 600 });
}

export function clearOAuthFlowCookie(c: Context): void {
  setCookie(c, 'oauth_flow', '', { ...ADMIN_COOKIE, maxAge: 0 });
}

/** `Origin`, when present, must equal this host; otherwise `Sec-Fetch-Site` must say so. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

export function isCsrfValid(c: Context, submitted: unknown): boolean {
  const cookie = getCookie(c, CSRF_COOKIE);
  return (
    typeof cookie === 'string' &&
    cookie.length > 0 &&
    typeof submitted === 'string' &&
    submitted === cookie
  );
}
