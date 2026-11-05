/** Bindings and configuration, as configured in `wrangler.jsonc` and by `wrangler secret put`. */
interface Bindings {
  DB: D1Database
  CACHE: KVNamespace

  ENVIRONMENT: string
  PUBLIC_HOSTNAME: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  MICROSOFT_CLIENT_ID: string
  MICROSOFT_CLIENT_SECRET: string
  TOKEN_ENCRYPTION_KEY: string
  CURSOR_SIGNING_KEY: string
  CF_ACCESS_TEAM_DOMAIN: string
  CF_ACCESS_ADMIN_AUD: string
  CF_ACCESS_MCP_AUD: string
}

export type Env = Bindings

// `cloudflare:workers` types `env` as `Cloudflare.Env`. Mirror the Worker bindings there so the
// module-scope MCP Hono app sees the same fields the request handlers do.
declare global {
  namespace Cloudflare {
    // oxlint-disable-next-line typescript/no-empty-object-type -- declaration merging requires an empty body
    interface Env extends Bindings {}
  }
}
