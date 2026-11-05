import { z } from "zod"

import { TokenCipher } from "../auth/crypto"
import { callbackUri, OAuthAttempt, OAuthProvider, type OAuthTokens } from "../auth/oauth"
import { covers, parseScopes, requiredScopes } from "../auth/scopes"
import { AccountRepository } from "../db/account-repository"
import { nowSeconds } from "../db/client"
import { OAuthStateRepository } from "../db/oauth-state-repository"
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
  private readonly accounts: AccountRepository
  private readonly states: OAuthStateRepository

  public constructor(private readonly env: Env) {
    this.cipher = new TokenCipher(env.TOKEN_ENCRYPTION_KEY)
    this.accounts = new AccountRepository(env)
    this.states = new OAuthStateRepository(env)
  }

  /** Writes the single-use attempt and returns where to send the browser. */
  public async start(input: StartFlowInput): Promise<StartedFlow> {
    if (!AccountSlug.safeParse(input.slug).success) throw new Error("Invalid account slug")

    const existing = await this.accounts.findBySlug(input.mcp, input.slug)
    if (!input.targetAccountId && existing) throw new SlugTakenError()

    const attempt = OAuthAttempt.create()
    const now = nowSeconds()

    await this.states.insert({
      state: attempt.state,
      mcp: input.mcp,
      provider: input.provider,
      slug: input.slug,
      codeVerifier: attempt.codeVerifier,
      targetAccountId: input.targetAccountId ?? null,
      createdAt: now,
      expiresAt: now + STATE_TTL_SECONDS
    })

    const url = OAuthProvider.for(this.env, input.provider).authorizeUrl({
      state: attempt.state,
      codeChallenge: await attempt.challenge(),
      redirectUri: callbackUri(input.requestUrl, input.provider),
      scopes: requiredScopes(input.mcp)
    })
    return { state: attempt.state, authorizeUrl: url.href }
  }

  /**
   * Everything after the state row is validated: exchange, identity, duplicate and scope checks,
   * then the write. Any refusal leaves the database untouched.
   */
  public async complete(input: CallbackInput): Promise<CallbackOutcome> {
    const attempt = await this.states.take(input.state)
    if (!attempt || attempt.expiresAt < nowSeconds() || attempt.provider !== input.provider) {
      return { mcp: attempt?.mcp ?? "calendar", error: "state" }
    }

    const mcp = attempt.mcp
    const required = requiredScopes(mcp)

    let tokens: OAuthTokens
    try {
      tokens = await OAuthProvider.for(this.env, attempt.provider).exchangeCode({
        code: input.code,
        codeVerifier: attempt.codeVerifier,
        redirectUri: callbackUri(input.requestUrl, input.provider)
      })
    } catch {
      return { mcp, error: "denied" }
    }

    const refreshToken = tokens.refreshToken
    if (refreshToken === undefined) return { mcp, error: "no_refresh_token" }

    const scopes = tokens.scopes ?? []
    if (!covers(scopes, required)) return { mcp, error: "missing_scope" }

    let identity: ProviderIdentity
    try {
      identity = await fetchIdentity(attempt.provider, tokens.accessToken)
    } catch {
      return { mcp, error: "denied" }
    }

    const duplicate = await this.accounts.findByIdentity(mcp, attempt.provider, identity.subject)
    if (duplicate && duplicate.id !== attempt.targetAccountId) {
      return { mcp, error: "duplicate", duplicateSlug: duplicate.slug }
    }

    if (attempt.targetAccountId) {
      const target = await this.accounts.findById(attempt.targetAccountId)
      if (!target) return { mcp, error: "state" }
      // A reauth must never narrow a working Credential.
      if (!covers(scopes, required) || !covers(parseScopes(target.scopes), scopes)) {
        return { mcp, error: "missing_scope" }
      }
      try {
        await this.applyReauth(target, identity, tokens, scopes, refreshToken)
      } catch (error) {
        if (error instanceof IdentityMismatchError) return { mcp, error: "identity_mismatch" }
        if (error instanceof RetryableContentionError) return { mcp, error: "state" }
        return { mcp, error: "denied" }
      }
      return { mcp, addedSlug: target.slug }
    }

    const slugTaken = await this.accounts.findBySlug(mcp, attempt.slug)
    if (slugTaken) return { mcp, error: "slug_taken" }

    try {
      await this.persistNewAccount({
        mcp,
        slug: attempt.slug,
        provider: attempt.provider,
        identity,
        tokens,
        scopes,
        refreshToken
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
    tokens: OAuthTokens
    scopes: string[]
    refreshToken: string
  }): Promise<void> {
    const id = crypto.randomUUID()
    const now = nowSeconds()
    const [accessToken, refreshToken] = await Promise.all([
      this.cipher.encrypt(input.tokens.accessToken, id, "access_token"),
      this.cipher.encrypt(input.refreshToken, id, "refresh_token")
    ])

    await this.accounts.insert({
      id,
      mcp: input.mcp,
      slug: input.slug,
      provider: input.provider,
      providerSubject: input.identity.subject,
      email: input.identity.email,
      displayName: input.identity.displayName ?? null,
      accessToken,
      refreshToken,
      accessTokenExpiresAt: input.tokens.expiresAt,
      scopes: input.scopes.join(" "),
      state: "active",
      isDefault: 0,
      cacheEpoch: 0,
      lastRefreshedAt: now,
      createdAt: now,
      updatedAt: now
    })

    await this.accounts.makeDefaultIfNone({ id, mcp: input.mcp })
    await this.accounts.bumpCacheEpoch(id)
  }

  private async applyReauth(
    account: Account,
    identity: { subject: string },
    tokens: OAuthTokens,
    scopes: string[],
    newRefreshToken: string
  ): Promise<void> {
    if (identity.subject !== account.providerSubject) throw new IdentityMismatchError()

    // The same lease the refresh path uses, so a reauth can never overwrite a token mid-rotation.
    const lockToken = crypto.randomUUID()
    if (!(await this.accounts.claimRefreshLock(account.id, lockToken))) {
      throw new RetryableContentionError()
    }

    try {
      const [accessToken, encryptedRefreshToken] = await Promise.all([
        this.cipher.encrypt(tokens.accessToken, account.id, "access_token"),
        this.cipher.encrypt(newRefreshToken, account.id, "refresh_token")
      ])
      await this.accounts.update(account.id, {
        accessToken,
        refreshToken: encryptedRefreshToken,
        accessTokenExpiresAt: tokens.expiresAt,
        scopes: scopes.join(" "),
        state: "active",
        lastRefreshedAt: nowSeconds(),
        lastError: null,
        revokedAt: null
      })
      await this.accounts.releaseRefreshLock(account.id, lockToken)
      await this.accounts.bumpCacheEpoch(account.id)
    } catch (error) {
      await this.accounts.releaseRefreshLock(account.id, lockToken)
      throw error
    }
  }
}
