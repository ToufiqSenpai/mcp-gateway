import { REQUIRED_SCOPES as CALENDAR_SCOPES } from "@mcp-gateway/calendar"
import { REQUIRED_SCOPES as NOTES_SCOPES } from "@mcp-gateway/notes"

import type { McpSlug } from "../db/schema"

/** The Required scope set for an MCP: one constant in the MCP's own module (SPEC §9.2). */
export function requiredScopes(mcp: McpSlug): readonly string[] {
  return mcp === "calendar" ? CALENDAR_SCOPES : NOTES_SCOPES
}

/** Space-delimited `accounts.scopes` as a list. */
export function parseScopes(scopes: string): string[] {
  return scopes.split(/\s+/).filter(Boolean)
}

/** Google returns the userinfo URLs; older rows may still carry the short aliases. */
const SCOPE_ALIASES = new Map([
  ["email", "https://www.googleapis.com/auth/userinfo.email"],
  ["profile", "https://www.googleapis.com/auth/userinfo.profile"]
])

function canonicalScope(scope: string): string {
  const lower = scope.toLowerCase()
  return SCOPE_ALIASES.get(lower) ?? lower
}

/** True when every Required scope is in the Granted set; comparison is case-insensitive. */
export function covers(granted: readonly string[], required: readonly string[]): boolean {
  const grantedSet = new Set(granted.map(canonicalScope))
  return required.every(scope => grantedSet.has(canonicalScope(scope)))
}
