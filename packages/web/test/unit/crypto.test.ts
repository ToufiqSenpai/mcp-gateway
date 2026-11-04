import { describe, expect, it } from 'vitest';
import {
  CredentialDecryptError,
  CryptoConfigError,
  decryptToken,
  encryptToken,
} from '../../src/auth/crypto';

const KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
const ACCOUNT = '11111111-1111-1111-1111-111111111111';

describe('credential encryption', () => {
  it('round-trips a token and uses a fresh IV per encryption', async () => {
    const first = await encryptToken(KEY, 'ya29.secret', ACCOUNT, 'access_token');
    const second = await encryptToken(KEY, 'ya29.secret', ACCOUNT, 'access_token');

    expect(first).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('ya29.secret');
    await expect(decryptToken(KEY, first, ACCOUNT, 'access_token')).resolves.toBe('ya29.secret');
  });

  it('rejects a tampered ciphertext', async () => {
    const envelope = await encryptToken(KEY, 'ya29.secret', ACCOUNT, 'access_token');
    const parts = envelope.split('.');
    const ciphertext = parts[2] ?? '';
    const flipped = (ciphertext[0] === 'A' ? 'B' : 'A') + ciphertext.slice(1);
    await expect(
      decryptToken(KEY, `v1.${parts[1]}.${flipped}`, ACCOUNT, 'access_token'),
    ).rejects.toThrow(CredentialDecryptError);
  });

  it('rejects a ciphertext replayed into another row or column', async () => {
    const envelope = await encryptToken(KEY, 'ya29.secret', ACCOUNT, 'access_token');
    await expect(
      decryptToken(KEY, envelope, '22222222-2222-2222-2222-222222222222', 'access_token'),
    ).rejects.toThrow(CredentialDecryptError);
    await expect(decryptToken(KEY, envelope, ACCOUNT, 'refresh_token')).rejects.toThrow(
      CredentialDecryptError,
    );
  });

  it('rejects a malformed envelope', async () => {
    await expect(decryptToken(KEY, 'plaintext', ACCOUNT, 'access_token')).rejects.toThrow(
      CredentialDecryptError,
    );
  });

  it('fails closed on a missing or malformed key', async () => {
    await expect(encryptToken('', 'x', ACCOUNT, 'access_token')).rejects.toThrow(CryptoConfigError);
    await expect(encryptToken('not-base64!', 'x', ACCOUNT, 'access_token')).rejects.toThrow(
      CryptoConfigError,
    );
    await expect(
      encryptToken('c2hvcnQ=', 'x', ACCOUNT, 'access_token'),
    ).rejects.toThrow(CryptoConfigError);
  });
});
