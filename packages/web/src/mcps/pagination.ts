import { timingSafeEqual } from "node:crypto"

import type { CursorCodec, CursorPayload } from "@mcp-gateway/common"
import { z } from "zod"

import { fromBase64Url, toBase64Url } from "../lib/base64url"

export class InvalidCursorError extends Error {
  public constructor() {
    super("Invalid page token")
    this.name = "InvalidCursorError"
  }
}

const CursorPayloadSchema = z.object({ o: z.unknown(), a: z.string() })

const encoder = new TextEncoder()

async function hmac(rawKey: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(rawKey), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign"
  ])
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data))
  return toBase64Url(new Uint8Array(signature))
}

function sameSignature(left: string, right: string): boolean {
  return left.length === right.length && timingSafeEqual(encoder.encode(left), encoder.encode(right))
}

/**
 * HMAC-SHA256 over base64url JSON, no expiry, bound to the usable-Account set. A bad signature
 * or a changed set is refused, never silently restarted.
 */
export class HmacCursorCodec implements CursorCodec {
  public constructor(private readonly signingKey: string) {}

  public async accountSet(accounts: { slug: string }[]): Promise<string> {
    const slugs = accounts
      .map(account => account.slug)
      .sort()
      .join("\n")
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(slugs))
    let hex = ""
    for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0")
    return hex.slice(0, 16)
  }

  public async encode(payload: CursorPayload): Promise<string> {
    const body = toBase64Url(encoder.encode(JSON.stringify(payload)))
    return `${body}.${await hmac(this.signingKey, body)}`
  }

  public async decode(cursor: string, accountSet: string): Promise<CursorPayload> {
    const [body, signature] = cursor.split(".")
    if (!body || !signature) throw new InvalidCursorError()
    if (!sameSignature(signature, await hmac(this.signingKey, body))) {
      throw new InvalidCursorError()
    }

    let decoded: unknown
    try {
      decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(body)))
    } catch {
      throw new InvalidCursorError()
    }

    const payload = CursorPayloadSchema.safeParse(decoded)
    if (!payload.success || payload.data.a !== accountSet) throw new InvalidCursorError()
    return payload.data
  }
}
