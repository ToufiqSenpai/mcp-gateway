import { ProtocolError } from "@modelcontextprotocol/server"
import { Hono } from "hono"
import { z } from "zod"

import { AccountSlug, RetryableContentionError, SlugTakenError, startAuthorization } from "../accounts/lifecycle-oauth"
import { isDevBypass } from "../auth/access"
import { callbackUri, providerClient } from "../auth/arctic"
import { ensureCsrfToken, isCsrfValid, isSameOrigin, setOAuthFlowCookie } from "../auth/cookies"
import { decryptToken } from "../auth/crypto"
import { AccountRepository } from "../db/account-repository"
import { createDb } from "../db/client"
import { nowSeconds } from "../db/client"
import type { Account } from "../db/schema"
import type { AppEnv } from "../index"
import { callTool, listTools } from "../mcps/in-process"
import { isMcpSlug, MCP_REGISTRY } from "../mcps/registry"
import { HomePage, loadMcpRows } from "../views/home"
import { McpPage, RevokeConfirmationPage, errorSentence } from "../views/mcp"
import { TestToolPage } from "../views/test-tool"

import appCss from "../admin/app.generated.css"

/** FNV-1a over the built stylesheet: stable per build, cheap per isolate. */
function buildHash(css: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < css.length; index += 1) {
    hash ^= css.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16)
}

const CSS_ETAG = `"${buildHash(appCss)}"`

/** Arguments come from a JSON textarea, so the page parses them into JSON before forwarding. */
const ToolArguments = z.record(z.string(), z.json())

/** Form fields arrive as `string | File`; these routes only ever read text fields. */
function textFields(body: Record<string, string | File>): Record<string, string> {
  return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, value instanceof File ? "" : value]))
}

async function revokeAccount(env: AppEnv["Bindings"], account: Account, requestUrl: string): Promise<void> {
  if (account.provider === "google" && account.refreshToken) {
    try {
      const token = await decryptToken(env.TOKEN_ENCRYPTION_KEY, account.refreshToken, account.id, "refresh_token")
      const client = providerClient(env, "google", callbackUri(requestUrl, "google"))
      if ("revokeToken" in client) await client.revokeToken(token)
    } catch {
      // Best effort: a Provider-side revoke failure must not block the local revoke.
    }
  }
}

export const adminRoutes = new Hono<AppEnv>()

/** Every admin form POST shares one origin+CSRF check and one parsed form. */
adminRoutes.use("/mcps/:mcp/*", async (c, next) => {
  if (c.req.method !== "POST") return next()
  const mcp = c.req.param("mcp")
  if (!isMcpSlug(mcp)) return c.text("Not found", 404)

  const form = textFields(await c.req.parseBody())
  if (!isSameOrigin(c.req.raw) || !isCsrfValid(c, form["_csrf"])) return c.text("Forbidden", 403)

  c.set("form", form)
  c.set("db", createDb(c.env))
  return next()
})

adminRoutes.get("/app.css", c => {
  const headers = {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "private, max-age=3600",
    ETag: CSS_ETAG
  }
  if (c.req.header("If-None-Match") === CSS_ETAG) return c.body(null, 304, headers)
  return c.body(appCss, 200, headers)
})

adminRoutes.get("/", async c => {
  ensureCsrfToken(c)
  const rows = await loadMcpRows(c.env)
  return c.html(<HomePage rows={rows} devBypass={isDevBypass(c.env, c.req.url)} />)
})

adminRoutes.get("/mcps/:mcp", async c => {
  const mcp = c.req.param("mcp")
  if (!isMcpSlug(mcp)) return c.text("Not found", 404)

  const db = createDb(c.env)
  const accounts = await new AccountRepository(db).listByMcp(mcp)
  const csrf = ensureCsrfToken(c)
  const added = c.req.query("added")
  const error = c.req.query("error")
  const notice = error ? errorSentence(error) : added ? `Account “${added}” is ready.` : undefined

  return c.html(
    <McpPage
      mcp={mcp}
      provider={MCP_REGISTRY[mcp].provider}
      accounts={accounts}
      csrf={csrf}
      devBypass={isDevBypass(c.env, c.req.url)}
      notice={notice}
      noticeKind={notice === undefined ? undefined : error ? "error" : "ok"}
    />
  )
})

adminRoutes.post("/mcps/:mcp/accounts", async c => {
  const mcp = c.req.param("mcp")
  if (!isMcpSlug(mcp)) return c.text("Not found", 404)

  const form = c.get("form")
  const slug = AccountSlug.safeParse(form["slug"] ?? "")
  if (!slug.success) return c.text("Account slug must be lowercase letters, digits and dashes.", 400)

  try {
    const started = await startAuthorization(c.env, c.get("db"), {
      mcp,
      provider: MCP_REGISTRY[mcp].provider,
      slug: slug.data,
      requestUrl: c.req.url
    })
    setOAuthFlowCookie(c, started.state)
    return c.redirect(started.authorizeUrl, 303)
  } catch (error) {
    if (error instanceof SlugTakenError) {
      return c.redirect(`/admin/mcps/${mcp}?error=slug_taken`, 303)
    }
    throw error
  }
})

adminRoutes.post("/mcps/:mcp/accounts/:slug/reauth", async c => {
  const mcp = c.req.param("mcp")
  const slug = c.req.param("slug")
  if (!isMcpSlug(mcp)) return c.text("Not found", 404)

  const db = c.get("db")
  const account = await new AccountRepository(db).findBySlug(mcp, slug)
  if (!account) return c.text("Not found", 404)

  try {
    const started = await startAuthorization(c.env, db, {
      mcp,
      provider: MCP_REGISTRY[mcp].provider,
      slug,
      targetAccountId: account.id,
      requestUrl: c.req.url
    })
    setOAuthFlowCookie(c, started.state)
    return c.redirect(started.authorizeUrl, 303)
  } catch (error) {
    if (error instanceof SlugTakenError || error instanceof RetryableContentionError) {
      return c.redirect(`/admin/mcps/${mcp}?error=state`, 303)
    }
    throw error
  }
})

adminRoutes.post("/mcps/:mcp/accounts/:slug/default", async c => {
  const mcp = c.req.param("mcp")
  const slug = c.req.param("slug")
  if (!isMcpSlug(mcp)) return c.text("Not found", 404)

  const db = c.get("db")
  const repository = new AccountRepository(db)
  const account = await repository.findBySlug(mcp, slug)
  if (!account || account.state !== "active") return c.text("Not found", 404)

  await repository.setDefault(mcp, account.id)
  await repository.bumpCacheEpoch(account.id)
  return c.redirect(`/admin/mcps/${mcp}`, 303)
})

adminRoutes.get("/mcps/:mcp/accounts/:slug/revoke", async c => {
  const mcp = c.req.param("mcp")
  const slug = c.req.param("slug")
  if (!isMcpSlug(mcp)) return c.text("Not found", 404)

  const account = await new AccountRepository(createDb(c.env)).findBySlug(mcp, slug)
  if (!account) return c.text("Not found", 404)

  return c.html(
    <RevokeConfirmationPage mcp={mcp} slug={slug} csrf={ensureCsrfToken(c)} devBypass={isDevBypass(c.env, c.req.url)} />
  )
})

adminRoutes.post("/mcps/:mcp/accounts/:slug/revoke", async c => {
  const mcp = c.req.param("mcp")
  const slug = c.req.param("slug")
  if (!isMcpSlug(mcp)) return c.text("Not found", 404)

  const db = c.get("db")
  const repository = new AccountRepository(db)
  const account = await repository.findBySlug(mcp, slug)
  if (!account) return c.text("Not found", 404)

  await revokeAccount(c.env, account, c.req.url)
  await repository.update(account.id, {
    accessToken: null,
    refreshToken: null,
    state: "revoked",
    isDefault: 0,
    lastError: null,
    revokedAt: nowSeconds()
  })
  await repository.bumpCacheEpoch(account.id)
  return c.redirect(`/admin/mcps/${mcp}`, 303)
})

adminRoutes.get("/mcps/:mcp/test", async c => {
  const mcp = c.req.param("mcp")
  if (!isMcpSlug(mcp)) return c.text("Not found", 404)

  const db = createDb(c.env)
  const [tools, accounts] = await Promise.all([listTools(c.env, db, mcp), new AccountRepository(db).listByMcp(mcp)])

  return c.html(
    <TestToolPage
      mcp={mcp}
      tools={tools}
      accounts={accounts}
      csrf={ensureCsrfToken(c)}
      devBypass={isDevBypass(c.env, c.req.url)}
    />
  )
})

adminRoutes.post("/mcps/:mcp/test", async c => {
  const mcp = c.req.param("mcp")
  if (!isMcpSlug(mcp)) return c.text("Not found", 404)

  const form = c.get("form")
  const tool = form["tool"] ?? ""
  const account = form["account"] ?? ""
  const rawArgs = form["args"] || "{}"

  const db = c.get("db")
  const [tools, accounts] = await Promise.all([listTools(c.env, db, mcp), new AccountRepository(db).listByMcp(mcp)])

  const page = (notice: string | undefined) =>
    c.html(
      <TestToolPage
        mcp={mcp}
        tools={tools}
        accounts={accounts}
        csrf={ensureCsrfToken(c)}
        devBypass={isDevBypass(c.env, c.req.url)}
        error={notice}
      />
    )

  let decoded: unknown
  try {
    decoded = JSON.parse(rawArgs)
  } catch {
    return page("Arguments are not valid JSON.")
  }

  const parsedArgs = ToolArguments.safeParse(decoded)
  if (!parsedArgs.success) return page("Arguments must be a JSON object.")

  if (!tools.some(entry => entry.name === tool)) {
    return page("That tool is not registered for this MCP.")
  }

  const started = Date.now()
  const args = { ...parsedArgs.data }
  if (account) args["account"] = account

  let body: string
  let isError: boolean
  try {
    const reply = await callTool(c.env, db, mcp, tool, args)
    body = JSON.stringify(reply, null, 2)
    isError = reply.isError === true
  } catch (error) {
    const code = error instanceof ProtocolError ? error.code : undefined
    const message = error instanceof Error ? error.message : "Tool call failed"
    body = JSON.stringify({ error: { code, message } }, null, 2)
    isError = true
  }
  const durationMs = Date.now() - started

  return c.html(
    <TestToolPage
      mcp={mcp}
      tools={tools}
      accounts={accounts}
      csrf={ensureCsrfToken(c)}
      devBypass={isDevBypass(c.env, c.req.url)}
      result={{ tool, body, isError, durationMs }}
    />
  )
})
