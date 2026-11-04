/**
 * AES-GCM for the two Credential columns. Fails closed: a missing or malformed key is a
 * generic 500, there is no plaintext fallback, and a ciphertext is bound to its row and
 * column through the AAD `<account_id>:<field>` (§9.1).
 */
const ALGORITHM = 'AES-GCM';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ENVELOPE = /^v1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)$/;
const STANDARD_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type TokenField = 'access_token' | 'refresh_token';

export class CryptoConfigError extends Error {
  readonly status = 500;
  constructor() {
    super('Credential encryption is not configured');
    this.name = 'CryptoConfigError';
  }
}

export class CredentialDecryptError extends Error {
  readonly status = 500;
  constructor() {
    super('Credential could not be decrypted');
    this.name = 'CredentialDecryptError';
  }
}

let cached: { raw: string; key: Promise<CryptoKey> } | undefined;

/** Imported and length-checked once per isolate; the rejection is cached too, so it stays closed. */
function importKey(rawKey: string): Promise<CryptoKey> {
  if (cached?.raw === rawKey) return cached.key;

  const key = (async () => {
    if (!rawKey || !STANDARD_BASE64.test(rawKey) || rawKey.length % 4 !== 0) {
      throw new CryptoConfigError();
    }
    const bytes = Uint8Array.from(atob(rawKey), (char) => char.charCodeAt(0));
    if (bytes.length !== KEY_BYTES) throw new CryptoConfigError();
    return crypto.subtle.importKey('raw', bytes, { name: ALGORITHM }, false, [
      'encrypt',
      'decrypt',
    ]);
  })();

  // Keep a rejected key from becoming an unhandled rejection when it is reused.
  key.catch(() => {});
  cached = { raw: rawKey, key };
  return key;
}

const encoder = new TextEncoder();

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function aad(accountId: string, field: TokenField): ArrayBuffer {
  return toBuffer(encoder.encode(`${accountId}:${field}`));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

export async function encryptToken(
  rawKey: string,
  plaintext: string,
  accountId: string,
  field: TokenField,
): Promise<string> {
  const key = await importKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: toBuffer(iv), additionalData: aad(accountId, field) },
    key,
    toBuffer(encoder.encode(plaintext)),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptToken(
  rawKey: string,
  envelope: string,
  accountId: string,
  field: TokenField,
): Promise<string> {
  const key = await importKey(rawKey);
  const match = ENVELOPE.exec(envelope);
  if (!match?.[1] || !match[2]) throw new CredentialDecryptError();

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: ALGORITHM,
        iv: toBuffer(fromBase64Url(match[1])),
        additionalData: aad(accountId, field),
      },
      key,
      toBuffer(fromBase64Url(match[2])),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    // Tampered ciphertext, wrong row, wrong column and a wrong key are all the same failure.
    throw new CredentialDecryptError();
  }
}
