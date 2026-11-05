import { Hono } from "hono"

import { AccessError, verifyAccess, type AccessIdentity } from "./auth/access"
import type { Env } from "./env"
import { adminRoutes } from "./routes/admin"
import { mcpRoutes } from "./routes/mcps"
import { oauthRoutes } from "./routes/oauth"

export interface AppEnv {
  Bindings: Env
  Variables: { identity: AccessIdentity; form: Record<string, string> }
}

type RouteGroup = "admin" | "mcp"

function groupFor(path: string): RouteGroup | undefined {
  if (path === "/" || path.startsWith("/admin") || path.startsWith("/oauth/")) return "admin"
  if (path.startsWith("/mcps/")) return "mcp"
  return undefined
}

const app = new Hono<AppEnv>()

// Every deployed request is verified in the Worker, not merely trusted from the edge, and the
// route-group credential pairing is enforced here.
app.use("*", async (c, next) => {
  const group = groupFor(new URL(c.req.url).pathname)
  if (!group) return c.text("Not found", 404)

  try {
    c.set("identity", await verifyAccess(c.req.raw, c.env, group))
  } catch (error) {
    if (error instanceof AccessError) return c.text(error.message, error.status)
    throw error
  }
  await next()
})

app.get("/", c => c.redirect("/admin"))
app.route("/admin", adminRoutes)
app.route("/mcps", mcpRoutes)
app.route("/oauth", oauthRoutes)

app.notFound(c => c.text("Not found", 404))

// A code plus one plain sentence; detail stays in the log and never includes a Credential.
app.onError((error, c) => {
  console.error("unhandled error", error instanceof Error ? error.name : "unknown")
  return c.text("Internal error", 500)
})

export default app
