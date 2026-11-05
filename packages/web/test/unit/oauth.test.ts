import { describe, expect, it } from "vitest"

import { OAuthProvider } from "../../src/auth/oauth"

const env = {
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  MICROSOFT_CLIENT_ID: "microsoft-id",
  MICROSOFT_CLIENT_SECRET: "microsoft-secret"
}

const input = {
  state: "state",
  codeChallenge: "challenge",
  redirectUri: "http://localhost:8787/oauth/callback/microsoft",
  scopes: ["User.Read", "Notes.ReadWrite"]
}

describe("OAuthProvider.authorizeUrl", () => {
  it("requests offline_access for Microsoft without adding it to the scope list", () => {
    const url = new URL(OAuthProvider.for(env, "microsoft").authorizeUrl(input))

    expect(url.searchParams.get("scope")).toBe("User.Read Notes.ReadWrite offline_access")
  })

  it("keeps the Google scope list untouched", () => {
    const url = new URL(OAuthProvider.for(env, "google").authorizeUrl({ ...input, scopes: ["openid", "email"] }))

    expect(url.searchParams.get("scope")).toBe("openid email")
  })
})
