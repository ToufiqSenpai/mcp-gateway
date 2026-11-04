import { Google, MicrosoftEntraId } from "arctic"

import type { McpSlug, Provider } from "../db/schema"
import type { Env } from "../env"
import { requiredScopes } from "./scopes"

export type ProviderClient = Google | MicrosoftEntraId

/**
 * One Provider per MCP, and `arctic` owns authorize, exchange and refresh for both (ADR-0005).
 * Vendor SDKs only ever receive an already-obtained access token.
 */
export function providerClient(env: Env, provider: Provider, redirectUri: string): ProviderClient {
  return provider === "google"
    ? new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri)
    : new MicrosoftEntraId("common", env.MICROSOFT_CLIENT_ID, env.MICROSOFT_CLIENT_SECRET, redirectUri)
}

/**
 * Google is patched before the redirect: without `access_type=offline` it issues no refresh
 * token at all, and `prompt=consent` is what produces one on reauth too.
 */
export function authorizeUrl(
  client: ProviderClient,
  provider: Provider,
  state: string,
  codeVerifier: string,
  mcp: McpSlug
): URL {
  const url = client.createAuthorizationURL(state, codeVerifier, [...requiredScopes(mcp)])
  if (provider === "google") {
    url.searchParams.set("access_type", "offline")
    url.searchParams.set("prompt", "consent")
  }
  return url
}

export function callbackUri(requestUrl: string, provider: Provider): string {
  return new URL(`/oauth/callback/${provider}`, requestUrl).toString()
}
