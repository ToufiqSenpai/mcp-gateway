import { createMcpHonoApp } from "@modelcontextprotocol/hono"
import { createMcpHandler } from "@modelcontextprotocol/server"
import { env } from "cloudflare:workers"
import { Hono } from "hono"

import { createMcpContext } from "../accounts/lifecycle"
import type { Env } from "../env"
import { isMcpSlug, MCP_REGISTRY } from "../mcps/registry"

interface McpEnv {
  Bindings: Env
  Variables: { parsedBody?: unknown }
}

/**
 * One stateless handler per request, mounted on the Hono adapter so Host and Origin are checked
 * against the deployed hostname before dispatch. The adapter also parses the JSON body once and
 * hands it to the handler.
 */
const adapter = createMcpHonoApp({
  host: env.PUBLIC_HOSTNAME,
  allowedHosts: [env.PUBLIC_HOSTNAME],
  allowedOrigins: [env.PUBLIC_HOSTNAME]
})

/** Mounted at `/mcps`; the adapter's Host, Origin and body middleware come with its routes. */
export const mcpRoutes = new Hono<McpEnv>()
mcpRoutes.route("/", adapter)

mcpRoutes.post("/:slug", async c => {
  const slug = c.req.param("slug")
  if (!isMcpSlug(slug)) return c.text("Not found", 404)

  const { factory } = MCP_REGISTRY[slug]
  const handler = createMcpHandler(
    () => factory(createMcpContext(c.env, slug, promise => c.executionCtx.waitUntil(promise))),
    { legacy: "reject", responseMode: "json" }
  )
  return await handler.fetch(c.req.raw, { parsedBody: c.get("parsedBody") })
})

mcpRoutes.on(["GET", "DELETE", "PUT", "PATCH", "HEAD"], "/:slug", c =>
  c.text("Method Not Allowed", 405, { Allow: "POST" })
)
