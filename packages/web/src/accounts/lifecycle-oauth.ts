import { generateCodeVerifier, generateState, type OAuth2Tokens } from "arctic"
import { z } from "zod"

import { authorizeUrl, callbackUri, providerClient } from "../auth/arctic"
import { TokenCipher } from "../auth/crypto"
import { covers, grantedScopes, parseScopes, requiredScopes } from "../auth/scopes"
import { AccountRepository } from "../db/account-repository"
import type { Database } from "../db/client"
import { nowSeconds } from "../db/client"
import type { Account, McpSlug, Provider } from "../db/schema"
import type { Env } from "../env"

/** The slug a user types on the MCP's admin page (SPEC §8.1), unique per MCP. */
export const AccountSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/)

const STATE_TTL_SECONDS = 600

export class RetryableContentionError extends Error {
  public constructor() {
    super("A token refresh is in progress for this Account; retry shortly.")
    this.name = "RetryableContentionError"
  }
}

export class IdentityMismatchError extends Error {
  public constructor() {
    super("The Provider identity does not match the Account being reauthorized.")
    this.name = "IdentityMismatchError"
  }
}

export class SlugTakenError extends Error {
  public constructor() {
    super("That slug is already reserved for this MCP.")
    this.name = "SlugTakenError"
  }
}

export class NoRefreshTokenError extends Error {
  public constructor() {
    super("The Provider issued no refresh token, so the Account would not be usable.")
    this.name = "NoRefreshTokenError"
  }
}

export interface StartFlowInput {
  mcp: McpSlug
  provider: Provider
  slug: string
  targetAccountId?: string
  requestUrl: string
}

export interface StartedFlow {
  state: string
  authorizeUrl: string
}

export interface CallbackInput {
  provider: Provider
  state: string
  code: string
  requestUrl: string
}

export interface CallbackOutcome {
  mcp: McpSlug
  addedSlug?: string
  error?: "denied" | "duplicate" | "no_refresh_token" | "state" | "identity_mismatch" | "slug_taken" | "missing_scope"
  duplicateSlug?: string
}

/** The identity fields both Providers must supply before an Account is written. */
interface ProviderIdentity {
  subject: string
  email: string
  displayName?: string
}

const GoogleIdentity = z.object({
  sub: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional()
})

const MicrosoftIdentity = z.object({
  id: z.string().optional(),
  mail: z.string().nullish(),
  userPrincipalName: z.string().optional(),
  displayName: z.string().optional()
})

async function fetchIdentity(provider: Provider, accessToken: string): Promise<ProviderIdentity> {
  if (provider === "google") {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!response.ok) throw new Error("Google identity fetch failed")
    const data = GoogleIdentity.parse(await response.json())
    if (!data.sub || !data.email) throw new Error("Google identity is incomplete")
    const identity: ProviderIdentity = { subject: data.sub, email: data.email }
    if (data.name) identity.displayName = data.name
    return identity
  }

  const response = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!response.ok) throw new Error("Microsoft identity fetch failed")
  const data = MicrosoftIdentity.parse(await response.json())
  const email = data.mail ?? data.userPrincipalName
  if (!data.id || !email) throw new Error("Microsoft identity is incomplete")
  const identity: ProviderIdentity = { subject: data.id, email }
  if (data.displayName) identity.displayName = data.displayName
  return identity
}

/** Start and finish an OAuth authorization against one MCP's Provider. */
export class OAuthFlowService {
  private readonly cipher: TokenCipher

  public constructor(
    private readonly env: Env,
    private readonly repository: AccountRepository
  ) {
    this.cipher = new TokenCipher(env.TOKEN_ENCRYPTION_KEY)
  }

  /** Writes the single-use attempt and returns where to send the browser. */
  public async start(input: StartFlowInput): Promise<StartedFlow> {
    if (!AccountSlug.safeParse(input.slug).success) throw new Error("Invalid account slug")

    const existing = await this.repository.findBySlug(input.mcp, input.slug)
    if (!input.targetAccountId && existing) throw new SlugTakenError()

    const state = generateState()
    const codeVerifier = generateCodeVerifier()
    const now = nowSeconds()

    await this.repository.insertOAuthState({
      state,
      mcp: input.mcp,
      provider: input.provider,
      slug: input.slug,
      codeVerifier,
      targetAccountId: input.targetAccountId ?? null,
      createdAt: now,
      expiresAt: now + STATE_TTL_SECONDS
    })

    const client = providerClient(this.env, input.provider, callbackUri(input.requestUrl, input.provider))
    return {
      state,
      authorizeUrl: authorizeUrl(client, input.provider, state, codeVerifier, input.mcp).href
    }
  }

  /**
   * Everything after the state row is validated: exchange, identity, duplicate and scope checks,
   * then the write. Any refusal leaves the database untouched.
   */
  public async complete(input: CallbackInput): Promise<CallbackOutcome> {
    const attempt = await this.repository.takeOAuthState(input.state)
    if (!attempt || attempt.expiresAt < nowSeconds() || attempt.provider !== input.provider) {
      return { mcp: attempt?.mcp ?? "calendar", error: "state" }
    }

    const mcp = attempt.mcp
    const required = requiredScopes(mcp)
    const client = providerClient(this.env, attempt.provider, callbackUri(input.requestUrl, input.provider))

    let tokens: OAuth2Tokens
    try {
      tokens = await client.validateAuthorizationCode(input.code, attempt.codeVerifier)
    } catch {
      return { mcp, error: "denied" }
    }

    if (!tokens.hasRefreshToken()) return { mcp, error: "no_refresh_token" }

    const scopes = grantedScopes(tokens)
    if (!covers(scopes, required)) return { mcp, error: "missing_scope" }

    let identity: ProviderIdentity
    try {
      identity = await fetchIdentity(attempt.provider, tokens.accessToken())
    } catch {
      return { mcp, error: "denied" }
    }

    const duplicate = await this.repository.findByIdentity(mcp, attempt.provider, identity.subject)
    if (duplicate && duplicate.id !== attempt.targetAccountId) {
      return { mcp, error: "duplicate", duplicateSlug: duplicate.slug }
    }

    if (attempt.targetAccountId) {
      const target = await this.repository.findById(attempt.targetAccountId)
      if (!target) return { mcp, error: "state" }
      // A reauth must never narrow a working Credential.
      if (!covers(scopes, required) || !covers(parseScopes(target.scopes), scopes)) {
        return { mcp, error: "missing_scope" }
      }
      try {
        await this.applyReauth(target, identity, tokens, scopes)
      } catch (error) {
        if (error instanceof IdentityMismatchError) return { mcp, error: "identity_mismatch" }
        if (error instanceof RetryableContentionError) return { mcp, error: "state" }
        return { mcp, error: "denied" }
      }
      return { mcp, addedSlug: target.slug }
    }

    const slugTaken = await this.repository.findBySlug(mcp, attempt.slug)
    if (slugTaken) return { mcp, error: "slug_taken" }

    try {
      await this.persistNewAccount({
        mcp,
        slug: attempt.slug,
        provider: attempt.provider,
        identity,
        tokens,
        scopes
      })
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) {
        return { mcp, error: "duplicate" }
      }
      return { mcp, error: "denied" }
    }

    return { mcp, addedSlug: attempt.slug }
  }

  private async persistNewAccount(input: {
    mcp: McpSlug
    slug: string
    provider: Provider
    identity: ProviderIdentity
    tokens: OAuth2Tokens
    scopes: string[]
  }): Promise<void> {
    const id = crypto.randomUUID()
    const now = nowSeconds()
    const [accessToken, refreshToken] = await Promise.all([
      this.cipher.encrypt(input.tokens.accessToken(), id, "access_token"),
      this.cipher.encrypt(input.tokens.refreshToken(), id, "refresh_token")
    ])

    await this.repository.insert({
      id,
      mcp: input.mcp,
      slug: input.slug,
      provider: input.provider,
      providerSubject: input.identity.subject,
      email: input.identity.email,
      displayName: input.identity.displayName ?? null,
      accessToken,
      refreshToken,
      accessTokenExpiresAt: Math.floor(input.tokens.accessTokenExpiresAt().getTime() / 1000),
      scopes: input.scopes.join(" "),
      state: "active",
      isDefault: 0,
      cacheEpoch: 0,
      lastRefreshedAt: now,
      createdAt: now,
      updatedAt: now
    })

    await this.repository.makeDefaultIfNone({ id, mcp: input.mcp })
    await this.repository.bumpCacheEpoch(id)
  }

  private async applyReauth(
    account: Account,
    identity: { subject: string },
    tokens: OAuth2Tokens,
    scopes: string[]
  ): Promise<void> {
    if (identity.subject !== account.providerSubject) throw new IdentityMismatchError()

    // The same lease the refresh path uses, so a reauth can never overwrite a token mid-rotation.
    const lockToken = crypto.randomUUID()
    if (!(await this.repository.claimRefreshLock(account.id, lockToken))) {
      throw new RetryableContentionError()
    }

    try {
      const [accessToken, refreshToken] = await Promise.all([
        this.cipher.encrypt(tokens.accessToken(), account.id, "access_token"),
        this.cipher.encrypt(tokens.refreshToken(), account.id, "refresh_token")
      ])
      await this.repository.update(account.id, {
        accessToken,
        refreshToken,
        accessTokenExpiresAt: Math.floor(tokens.accessTokenExpiresAt().getTime() / 1000),
        scopes: scopes.join(" "),
        state: "active",
        lastRefreshedAt: nowSeconds(),
        lastError: null,
        revokedAt: null
      })
      await this.repository.releaseRefreshLock(account.id, lockToken)
      await this.repository.bumpCacheEpoch(account.id)
    } catch (error) {
      await this.repository.releaseRefreshLock(account.id, lockToken)
      throw error
    }
  }
}

export function startAuthorization(env: Env, db: Database, input: StartFlowInput): Promise<StartedFlow> {
  return new OAuthFlowService(env, new AccountRepository(db)).start(input)
}

export function completeAuthorization(env: Env, db: Database, input: CallbackInput): Promise<CallbackOutcome> {
  return new OAuthFlowService(env, new AccountRepository(db)).complete(input)
}
