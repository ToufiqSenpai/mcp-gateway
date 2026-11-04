/** Bindings and configuration, as configured in `wrangler.jsonc` and by `wrangler secret put`. */
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;

  ENVIRONMENT: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  MICROSOFT_CLIENT_ID: string;
  MICROSOFT_CLIENT_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  CURSOR_SIGNING_KEY: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_ADMIN_AUD: string;
  CF_ACCESS_MCP_AUD: string;
}
