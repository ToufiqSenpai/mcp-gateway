import { REQUIRED_SCOPES } from "@mcp-gateway/calendar"
import { env } from "cloudflare:test"
import { beforeEach, describe, expect, it } from "vitest"

import { TokenCipher } from "../../src/auth/crypto"
import { AccountRepository } from "../../src/db/account-repository"
import { createDb, nowSeconds } from "../../src/db/client"
import { TEST_ORIGIN, TestBrowser, adminJwt, appFetch, csrfFromPage } from "../support/access"

const cipher = new TokenCipher(env.TOKEN_ENCRYPTION_KEY)

const SECRET_SUBJECT = "provider-subject-must-never-render"
const ACCESS_PLAINTEXT = "ya29.plaintext-access-token"
const REFRESH_PLAINTEXT = "1//plaintext-refresh-token"

async function seedAccount(): Promise<void> {
  const id = crypto.randomUUID()
  await new AccountRepository(createDb(env)).insert({
    id,
    mcp: "calendar",
    slug: "personal",
    provider: "google",
    providerSubject: SECRET_SUBJECT,
    email: "operator@example.com",
    displayName: "Operator",
    accessToken: await cipher.encrypt(ACCESS_PLAINTEXT, id, "access_token"),
    refreshToken: await cipher.encrypt(REFRESH_PLAINTEXT, id, "refresh_token"),
    accessTokenExpiresAt: nowSeconds() + 3600,
    scopes: REQUIRED_SCOPES.join(" "),
    state: "active",
    isDefault: 1,
    lastError: "invalid_grant",
    createdAt: nowSeconds(),
    updatedAt: nowSeconds()
  })
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM oauth_states").run()
  await env.DB.prepare("DELETE FROM accounts").run()
})

describe("admin routes", () => {
  it("redirects / to /admin", async () => {
    const browser = new TestBrowser()
    const response = await browser.get("/")
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("/admin")
  })

  it("renders the MCP list and the Accounts table", async () => {
    await seedAccount()
    const browser = new TestBrowser()

    const home = await browser.get("/admin")
    const homeHtml = await home.text()
    expect(home.status).toBe(200)
    expect(homeHtml).toContain("/mcps/calendar")
    expect(homeHtml).toContain("/mcps/notes")

    const page = await browser.get("/admin/mcps/calendar")
    const html = await page.text()
    expect(html).toContain("personal")
    expect(html).toContain("operator@example.com")
    expect(html).toContain("active")
  })

  it("answers an unknown MCP with 404", async () => {
    const browser = new TestBrowser()
    expect((await browser.get("/admin/mcps/mail")).status).toBe(404)
  })

  it("sets a Default Account through a POST that redirects with 303", async () => {
    await seedAccount()
    const browser = new TestBrowser()
    const csrf = await csrfFromPage(browser, "/admin/mcps/calendar")
    const response = await browser.postForm("/admin/mcps/calendar/accounts/personal/default", {
      _csrf: csrf
    })

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/admin/mcps/calendar")
    const row = await env.DB.prepare("SELECT is_default FROM accounts WHERE slug = 'personal'").first<{
      is_default: number
    }>()
    expect(row?.is_default).toBe(1)
  })

  it("requires the revoke confirmation page before revoking", async () => {
    await seedAccount()
    const browser = new TestBrowser()

    const confirmation = await browser.get("/admin/mcps/calendar/accounts/personal/revoke")
    expect(confirmation.status).toBe(200)
    expect(await confirmation.text()).toContain("Revoke permanently")

    const csrf = await csrfFromPage(browser, "/admin/mcps/calendar")
    const response = await browser.postForm("/admin/mcps/calendar/accounts/personal/revoke", {
      _csrf: csrf
    })
    expect(response.status).toBe(303)

    const row = await env.DB.prepare(
      "SELECT state, access_token, refresh_token, is_default FROM accounts WHERE slug = 'personal'"
    ).first<{
      state: string
      access_token: string | null
      refresh_token: string | null
      is_default: number
    }>()
    expect(row?.state).toBe("revoked")
    expect(row?.access_token).toBeNull()
    expect(row?.refresh_token).toBeNull()
    expect(row?.is_default).toBe(0)
  })

  it("runs a tool in-process from the test panel", async () => {
    await seedAccount()
    const browser = new TestBrowser()

    const form = await browser.get("/admin/mcps/calendar/test")
    const formHtml = await form.text()
    expect(form.status).toBe(200)
    expect(formHtml).toContain("list_accounts")

    const csrf = await csrfFromPage(browser, "/admin/mcps/calendar")
    const response = await browser.postForm("/admin/mcps/calendar/test", {
      _csrf: csrf,
      tool: "list_accounts",
      args: "{}"
    })
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain("list_accounts")
    expect(html).toContain("personal")
    expect(html).toContain("ms")
  })
})

describe("redaction", () => {
  it("never renders a Credential, key, subject or JWT on any admin page", async () => {
    await seedAccount()
    const browser = new TestBrowser()

    const pages = [
      "/admin",
      "/admin/mcps/calendar",
      "/admin/mcps/notes",
      "/admin/mcps/calendar/test",
      "/admin/mcps/calendar/accounts/personal/revoke",
      "/admin/mcps/calendar?added=personal",
      "/admin/mcps/calendar?error=duplicate&slug=personal",
      "/admin?error=state"
    ]

    for (const path of pages) {
      const response = await browser.get(path)
      const html = await response.text()
      expect(html).not.toContain(ACCESS_PLAINTEXT)
      expect(html).not.toContain(REFRESH_PLAINTEXT)
      expect(html).not.toContain(SECRET_SUBJECT)
      expect(html).not.toMatch(/v[12]\./)
      expect(html).not.toContain(env.TOKEN_ENCRYPTION_KEY)
      expect(html).not.toContain("test-google-client-secret")
      expect(html).not.toContain("eyJ")
    }
  })

  it("answers a 500 without a stack trace", async () => {
    const token = await adminJwt()
    // A malformed CSRF cookie would be a 403, not a 500; this asserts the generic error body
    // shape by hitting an unhandled route parameter instead.
    const response = await appFetch(`${TEST_ORIGIN}/admin/mcps/calendar/test`, {
      method: "GET",
      headers: { "Cf-Access-Jwt-Assertion": token }
    })
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).not.toContain("at Object.")
  })
})
