import { z } from "zod"

import type { Provider } from "../db/schema"
import type { Env } from "../env"
import { toBase64Url } from "../lib/base64url"

const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
const GOOGLE_REVOKE = "https://oauth2.googleapis.com/revoke"
const MICROSOFT_AUTHORIZE = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
const MICROSOFT_TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token"

/** A Provider token response, normalised to what the gateway stores. */
export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  scopes?: string[]
  /** Epoch seconds. */
  expiresAt: number
}

/** A token-endpoint refusal; `code` is the Provider's `error` value. */
export class OAuthTokenError extends Error {
  public constructor(
    public readonly code: string,
    public readonly status: number
  ) {
    super(code)
    this.name = "OAuthTokenError"
  }
}

const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
  scope: z.string().optional()
})

const ErrorResponse = z.object({ error: z.string().optional() })

/** The state and PKCE verifier of one authorization attempt. */
export class OAuthAttempt {
  private constructor(
    public readonly state: string,
    public readonly codeVerifier: string
  ) {}

  public static create(): OAuthAttempt {
    return new OAuthAttempt(randomToken(), randomToken())
  }

  /** S256 challenge for the authorize URL. */
  public async challenge(): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(this.codeVerifier))
    return toBase64Url(new Uint8Array(digest))
  }
}

/** PKCE and OAuth state are both 32 random bytes, base64url. */
function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

/** The authorize, exchange, refresh and revoke surface every Provider shares. */
export abstract class OAuthProvider {
  protected constructor(
    private readonly clientId: string,
    private readonly clientSecret: string
  ) {}

  protected abstract readonly authorizeEndpoint: string
  protected abstract readonly tokenEndpoint: string

  public static for(
    env: Pick<Env, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "MICROSOFT_CLIENT_ID" | "MICROSOFT_CLIENT_SECRET">,
    provider: Provider
  ): OAuthProvider {
    return provider === "google"
      ? new GoogleOAuthProvider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET)
      : new MicrosoftOAuthProvider(env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET)
  }

  public authorizeUrl(input: {
    state: string
    codeChallenge: string
    redirectUri: string
    scopes: readonly string[]
  }): URL {
    const url = new URL(this.authorizeEndpoint)
    url.searchParams.set("client_id", this.clientId)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("redirect_uri", input.redirectUri)
    url.searchParams.set("scope", input.scopes.join(" "))
    url.searchParams.set("state", input.state)
    url.searchParams.set("code_challenge", input.codeChallenge)
    url.searchParams.set("code_challenge_method", "S256")
    for (const [key, value] of this.authorizationParams(input.scopes)) {
      url.searchParams.set(key, value)
    }
    return url
  }

  public exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code_verifier: input.codeVerifier
    })
    return this.requestTokens(body)
  }

  public refreshTokens(input: { refreshToken: string; scopes: readonly string[] }): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret
    })
    for (const [key, value] of this.refreshParams(input.scopes)) {
      body.set(key, value)
    }
    return this.requestTokens(body)
  }

  /** Providers without a revocation endpoint change nothing. */
  public async revoke(_token: string): Promise<void> {}

  protected authorizationParams(_scopes: readonly string[]): ReadonlyMap<string, string> {
    return new Map()
  }

  protected refreshParams(_scopes: readonly string[]): ReadonlyMap<string, string> {
    return new Map()
  }

  private async requestTokens(body: URLSearchParams): Promise<OAuthTokens> {
    const response = await fetch(this.tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body
    })

    const text = await response.text()
    let payload: unknown
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      throw new OAuthTokenError("invalid_response", response.status)
    }

    if (!response.ok) {
      const failure = ErrorResponse.safeParse(payload)
      const code = failure.success ? failure.data.error : undefined
      throw new OAuthTokenError(code ?? "token_request_failed", response.status)
    }

    const tokens = TokenResponse.safeParse(payload)
    if (!tokens.success) throw new OAuthTokenError("invalid_response", response.status)
    return {
      accessToken: tokens.data.access_token,
      refreshToken: tokens.data.refresh_token,
      scopes: tokens.data.scope?.split(/\s+/).filter(Boolean),
      expiresAt: Math.floor(Date.now() / 1000) + tokens.data.expires_in
    }
  }
}

class GoogleOAuthProvider extends OAuthProvider {
  protected readonly authorizeEndpoint = GOOGLE_AUTHORIZE
  protected readonly tokenEndpoint = GOOGLE_TOKEN

  /** Without `access_type=offline` Google issues no refresh token; consent repeats it on reauth. */
  protected override authorizationParams(_scopes: readonly string[]): ReadonlyMap<string, string> {
    return new Map([
      ["access_type", "offline"],
      ["prompt", "consent"]
    ])
  }

  public override async revoke(token: string): Promise<void> {
    await fetch(GOOGLE_REVOKE, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token })
    })
  }
}

class MicrosoftOAuthProvider extends OAuthProvider {
  protected readonly authorizeEndpoint = MICROSOFT_AUTHORIZE
  protected readonly tokenEndpoint = MICROSOFT_TOKEN

  /**
   * `offline_access` must be requested to receive a refresh token. Microsoft does not list it
   * in the granted `scope` of the token response, so it is added here, not to REQUIRED_SCOPES.
   */
  protected override authorizationParams(scopes: readonly string[]): ReadonlyMap<string, string> {
    return new Map([["scope", [...scopes, "offline_access"].join(" ")]])
  }

  /** Microsoft requires the scope list on refresh; Google rejects it. */
  protected override refreshParams(scopes: readonly string[]): ReadonlyMap<string, string> {
    return new Map([["scope", scopes.join(" ")]])
  }
}

export function callbackUri(requestUrl: string, provider: Provider): string {
  return new URL(`/oauth/callback/${provider}`, requestUrl).toString()
}
