import type { Env } from '../env';

/** Opaque cursor payload: `o` is the position state, `a` the usable-Account set it was issued under. */
export interface CursorPayload {
  o: unknown;
  a: string;
}

export interface CursorCodec {
  /** Stable hash of the usable-Account set, so a changed set invalidates old cursors. */
  accountSet(accounts: { slug: string }[]): Promise<string>;
  encode(payload: CursorPayload): Promise<string>;
  /** Verifies the signature and the Account-set binding; throws `InvalidCursorError`. */
  decode(cursor: string, accountSet: string): Promise<CursorPayload>;
}

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid page token');
    this.name = 'InvalidCursorError';
  }
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function hmac(rawKey: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(rawKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return toBase64Url(new Uint8Array(signature));
}

function sameSignature(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * HMAC-SHA256 over base64url JSON, no expiry, bound to the usable-Account set. A bad signature
 * or a changed set is refused, never silently restarted.
 */
export function createCursorCodec(env: Pick<Env, 'CURSOR_SIGNING_KEY'>): CursorCodec {
  return {
    async accountSet(accounts) {
      const slugs = accounts.map((account) => account.slug).sort().join('\n');
      const digest = await crypto.subtle.digest('SHA-256', encoder.encode(slugs));
      let hex = '';
      for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
      return hex.slice(0, 16);
    },

    async encode(payload) {
      const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
      return `${body}.${await hmac(env.CURSOR_SIGNING_KEY, body)}`;
    },

    async decode(cursor, accountSet) {
      const [body, signature] = cursor.split('.');
      if (!body || !signature) throw new InvalidCursorError();
      if (!sameSignature(signature, await hmac(env.CURSOR_SIGNING_KEY, body))) {
        throw new InvalidCursorError();
      }

      let payload: CursorPayload;
      try {
        payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as CursorPayload;
      } catch {
        throw new InvalidCursorError();
      }
      if (!payload || typeof payload !== 'object' || payload.a !== accountSet) {
        throw new InvalidCursorError();
      }
      return payload;
    },
  };
}

export const PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 250;
export const FETCH_CAP = 1000;
