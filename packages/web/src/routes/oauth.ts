import { Hono } from "hono"
import { getCookie } from "hono/cookie"

import { OAuthFlowService } from "../accounts/lifecycle-oauth"
import { clearOAuthFlowCookie } from "../auth/cookies"
import { OAuthStateRepository } from "../db/oauth-state-repository"
import type { AppEnv } from "../index"

export const oauthRoutes = new Hono<AppEnv>()

oauthRoutes.get("/callback/:provider", async c => {
  const provider = c.req.param("provider")
  if (provider !== "google" && provider !== "microsoft") return c.text("Not found", 404)

  const state = c.req.query("state") ?? ""
  const cookie = getCookie(c, "oauth_flow")
  clearOAuthFlowCookie(c)

  // The cookie is the login-CSRF binding; Access is not this defence.
  if (!state || !cookie || cookie !== state) return c.redirect("/admin?error=state", 303)

  const providerError = c.req.query("error")
  if (providerError) {
    const attempt = await new OAuthStateRepository(c.env).take(state)
    return c.redirect(`/admin/mcps/${attempt?.mcp ?? "calendar"}?error=denied`, 303)
  }

  const code = c.req.query("code")
  if (!code) return c.redirect("/admin?error=state", 303)

  const outcome = await new OAuthFlowService(c.env).complete({
    provider,
    state,
    code,
    requestUrl: c.req.url
  })

  const params = new URLSearchParams()
  if (outcome.error) {
    params.set("error", outcome.error)
    if (outcome.duplicateSlug) params.set("slug", outcome.duplicateSlug)
  } else if (outcome.addedSlug) {
    params.set("added", outcome.addedSlug)
  }

  return c.redirect(`/admin/mcps/${outcome.mcp}?${params.toString()}`, 303)
})
