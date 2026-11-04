import { Buffer } from "node:buffer"
import { createCipheriv, randomBytes } from "node:crypto"

import { describe, expect, it } from "vitest"

import { CredentialDecryptError, CryptoConfigError, TokenCipher, type TokenField } from "../../src/auth/crypto"
import { fromBase64Url, toBase64Url } from "../../src/lib/base64url"

const KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
const ACCOUNT = "11111111-1111-1111-1111-111111111111"
const cipher = new TokenCipher(KEY)

/**
 * The layout the v1 Web Crypto implementation wrote: 12-byte IV, then ciphertext with the
 * 16-byte GCM tag appended. GCM output is implementation-independent, so minting the bytes
 * here still proves the read path accepts what is already stored.
 */
function v1Envelope(plaintext: string, field: TokenField = "access_token"): string {
  const iv = randomBytes(12)
  const writer = createCipheriv("aes-256-gcm", Buffer.from(KEY, "base64"), iv)
  writer.setAAD(Buffer.from(`${ACCOUNT}:${field}`))
  const body = Buffer.concat([writer.update(plaintext, "utf8"), writer.final(), writer.getAuthTag()])
  return `v1.${toBase64Url(iv)}.${toBase64Url(body)}`
}

describe("credential encryption", () => {
  it("round-trips a token and uses a fresh IV per encryption", async () => {
    const first = await cipher.encrypt("ya29.secret", ACCOUNT, "access_token")
    const second = await cipher.encrypt("ya29.secret", ACCOUNT, "access_token")

    expect(first).toMatch(/^v2\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/)
    expect(first).not.toBe(second)
    expect(first).not.toContain("ya29.secret")
    await expect(cipher.decrypt(first, ACCOUNT, "access_token")).resolves.toBe("ya29.secret")
  })

  it("reads a v1 envelope written before the switch", async () => {
    await expect(cipher.decrypt(v1Envelope("ya29.legacy"), ACCOUNT, "access_token")).resolves.toBe("ya29.legacy")
    await expect(cipher.decrypt(v1Envelope("refresh-legacy", "refresh_token"), ACCOUNT, "refresh_token")).resolves.toBe(
      "refresh-legacy"
    )
  })

  it("rejects a tampered ciphertext", async () => {
    const envelope = await cipher.encrypt("ya29.secret", ACCOUNT, "access_token")
    const parts = envelope.split(".")
    const ciphertext = parts[2] ?? ""
    const flipped = (ciphertext[0] === "A" ? "B" : "A") + ciphertext.slice(1)
    await expect(cipher.decrypt(`v2.${parts[1]}.${flipped}`, ACCOUNT, "access_token")).rejects.toThrow(
      CredentialDecryptError
    )
  })

  it("rejects a tampered authentication tag", async () => {
    const envelope = await cipher.encrypt("ya29.secret", ACCOUNT, "access_token")
    const parts = envelope.split(".")
    const body = Buffer.from(fromBase64Url(parts[2] ?? ""))
    body[body.length - 1] = (body[body.length - 1] ?? 0) ^ 0x01
    await expect(cipher.decrypt(`v2.${parts[1]}.${toBase64Url(body)}`, ACCOUNT, "access_token")).rejects.toThrow(
      CredentialDecryptError
    )
  })

  it("rejects a ciphertext replayed into another row or column", async () => {
    const envelope = await cipher.encrypt("ya29.secret", ACCOUNT, "access_token")
    await expect(cipher.decrypt(envelope, "22222222-2222-2222-2222-222222222222", "access_token")).rejects.toThrow(
      CredentialDecryptError
    )
    await expect(cipher.decrypt(envelope, ACCOUNT, "refresh_token")).rejects.toThrow(CredentialDecryptError)
  })

  it("rejects a malformed envelope", async () => {
    await expect(cipher.decrypt("plaintext", ACCOUNT, "access_token")).rejects.toThrow(CredentialDecryptError)
    await expect(cipher.decrypt(`v1.${toBase64Url(randomBytes(12))}`, ACCOUNT, "access_token")).rejects.toThrow(
      CredentialDecryptError
    )
  })

  it("fails closed on a missing or malformed key", async () => {
    await expect(new TokenCipher("").encrypt("x", ACCOUNT, "access_token")).rejects.toThrow(CryptoConfigError)
    await expect(new TokenCipher("not-base64!").encrypt("x", ACCOUNT, "access_token")).rejects.toThrow(
      CryptoConfigError
    )
    await expect(new TokenCipher("c2hvcnQ=").encrypt("x", ACCOUNT, "access_token")).rejects.toThrow(CryptoConfigError)
    await expect(new TokenCipher("").decrypt(v1Envelope("ya29.legacy"), ACCOUNT, "access_token")).rejects.toThrow(
      CryptoConfigError
    )
  })
})
