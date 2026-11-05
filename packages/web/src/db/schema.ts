import { sql } from "drizzle-orm"
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

/** The MCP enum. Adding an MCP means a migration; the registry test keeps the two in step. */
export const MCP_SLUGS = ["calendar", "notes", "sheets"] as const
export type McpSlug = (typeof MCP_SLUGS)[number]

export const PROVIDERS = ["google", "microsoft"] as const
export type Provider = (typeof PROVIDERS)[number]

export const ACCOUNT_STATES = ["active", "needs_reauth", "revoked"] as const
export type AccountState = (typeof ACCOUNT_STATES)[number]

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    mcp: text("mcp", { enum: MCP_SLUGS }).notNull(),
    slug: text("slug").notNull(),
    provider: text("provider", { enum: PROVIDERS }).notNull(),
    providerSubject: text("provider_subject").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: integer("access_token_expires_at").notNull(),
    scopes: text("scopes").notNull(),
    state: text("state", { enum: ACCOUNT_STATES }).notNull(),
    isDefault: integer("is_default").notNull().default(0),
    cacheEpoch: integer("cache_epoch").notNull().default(0),
    refreshLockUntil: integer("refresh_lock_until"),
    refreshLockToken: text("refresh_lock_token"),
    lastRefreshedAt: integer("last_refreshed_at"),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    revokedAt: integer("revoked_at")
  },
  t => [
    uniqueIndex("accounts_mcp_slug").on(t.mcp, t.slug),
    uniqueIndex("accounts_identity").on(t.mcp, t.provider, t.providerSubject),
    uniqueIndex("accounts_default")
      .on(t.mcp)
      .where(sql`${t.isDefault} = 1`),
    check("accounts_mcp_enum", sql`${t.mcp} IN ('calendar', 'notes', 'sheets')`),
    check("accounts_provider_enum", sql`${t.provider} IN ('google', 'microsoft')`),
    check("accounts_state_enum", sql`${t.state} IN ('active', 'needs_reauth', 'revoked')`),
    check(
      "accounts_slug_format",
      sql`${t.slug} GLOB '[a-z0-9]*' AND ${t.slug} NOT GLOB '*[^a-z0-9-]*' AND length(${t.slug}) <= 32`
    ),
    check(
      "accounts_provider_pairing",
      sql`((${t.mcp} = 'calendar' AND ${t.provider} = 'google') OR (${t.mcp} = 'notes' AND ${t.provider} = 'microsoft') OR (${t.mcp} = 'sheets' AND ${t.provider} = 'google'))`
    )
  ]
)

export const oauthStates = sqliteTable(
  "oauth_states",
  {
    state: text("state").primaryKey(),
    mcp: text("mcp", { enum: MCP_SLUGS }).notNull(),
    provider: text("provider", { enum: PROVIDERS }).notNull(),
    slug: text("slug").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    targetAccountId: text("target_account_id").references(() => accounts.id),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull()
  },
  t => [
    check("oauth_states_mcp_enum", sql`${t.mcp} IN ('calendar', 'notes', 'sheets')`),
    check("oauth_states_provider_enum", sql`${t.provider} IN ('google', 'microsoft')`)
  ]
)

export type Account = typeof accounts.$inferSelect
export type NewAccount = typeof accounts.$inferInsert
export type OAuthAttempt = typeof oauthStates.$inferSelect
export type NewOAuthAttempt = typeof oauthStates.$inferInsert
