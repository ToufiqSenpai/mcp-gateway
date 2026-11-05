import { Buffer } from "node:buffer"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

import { fromBase64Url, toBase64Url } from "../lib/base64url"

/**
 * AES-256-GCM for the two Credential columns. Fails closed: a missing or malformed key is a
 * generic 500, there is no plaintext fallback, and a ciphertext is bound to its row and
 * column through the AAD `<account_id>:<field>` (§9.1).
 */
const ALGORITHM = "aes-256-gcm"
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32
const ENVELOPE = /^v2\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)$/

export type TokenField = "access_token" | "refresh_token"

export class CryptoConfigError extends Error {
  public readonly status = 500
  public constructor() {
    super("Credential encryption is not configured")
    this.name = "CryptoConfigError"
  }
}

export class CredentialDecryptError extends Error {
  public readonly status = 500
  public constructor() {
    super("Credential could not be decrypted")
    this.name = "CredentialDecryptError"
  }
}

const encoder = new TextEncoder()

function aad(accountId: string, field: TokenField): Uint8Array {
  return encoder.encode(`${accountId}:${field}`)
}

/** Encrypts and decrypts one Credential column; the key is decoded once per isolate. */
export class TokenCipher {
  private static readonly keys = new Map<string, Buffer>()

  public constructor(private readonly rawKey: string) {}

  private key(): Buffer {
    const cached = TokenCipher.keys.get(this.rawKey)
    if (cached) return cached

    const bytes = Buffer.from(this.rawKey, "base64")
    // Buffer.from drops invalid characters silently, so only the round trip proves the key.
    if (bytes.length !== KEY_BYTES || bytes.toString("base64") !== this.rawKey) throw new CryptoConfigError()
    TokenCipher.keys.set(this.rawKey, bytes)
    return bytes
  }

  public async encrypt(plaintext: string, accountId: string, field: TokenField): Promise<string> {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv(ALGORITHM, this.key(), iv)
    cipher.setAAD(aad(accountId, field))
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()])
    return `v2.${toBase64Url(iv)}.${toBase64Url(body)}`
  }

  public async decrypt(envelope: string, accountId: string, field: TokenField): Promise<string> {
    const match = ENVELOPE.exec(envelope)
    if (!match?.[1] || !match[2]) throw new CredentialDecryptError()
    const iv = fromBase64Url(match[1])
    const body = Buffer.from(fromBase64Url(match[2]))
    if (body.length < TAG_BYTES) throw new CredentialDecryptError()

    // A malformed key is a configuration failure, never a decryption failure.
    const key = this.key()
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv)
      decipher.setAAD(aad(accountId, field))
      decipher.setAuthTag(body.subarray(body.length - TAG_BYTES))
      const plaintext = Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()])
      return plaintext.toString("utf8")
    } catch {
      // Tampered ciphertext, wrong row, wrong column and a wrong key are all the same failure.
      throw new CredentialDecryptError()
    }
  }
}
