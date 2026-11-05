import { describe, expect, it } from "vitest"

import { AccessError, AccessVerifier } from "../../src/auth/access"
import type { Env } from "../../src/env"

// SAFETY: the verifier reads only these four bindings; the rest of `Env` is never touched here.
const production = {
  ENVIRONMENT: "production",
  CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
  CF_ACCESS_ADMIN_AUD: "admin-aud",
  CF_ACCESS_MCP_AUD: "mcp-aud"
} as Env

const development = { ...production, ENVIRONMENT: "development" }

describe("development auth bypass", () => {
  it("is unreachable when ENVIRONMENT is production, even on localhost", () => {
    expect(AccessVerifier.isDevBypass(production, "http://localhost:8787/admin")).toBe(false)
    expect(AccessVerifier.isDevBypass(production, "http://127.0.0.1:8787/admin")).toBe(false)
  })

  it("requires a localhost host as well as ENVIRONMENT=development", () => {
    expect(AccessVerifier.isDevBypass(development, "http://localhost:8787/admin")).toBe(true)
    expect(AccessVerifier.isDevBypass(development, "http://127.0.0.1:8787/admin")).toBe(true)
    expect(AccessVerifier.isDevBypass(development, "https://gateway.example.com/admin")).toBe(false)
  })

  it("refuses a request with no Access assertion in production", async () => {
    const request = new Request("https://gateway.example.com/admin")
    await expect(new AccessVerifier(production).verify(request, "admin")).rejects.toBeInstanceOf(AccessError)
  })
})
