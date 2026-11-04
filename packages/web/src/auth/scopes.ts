import { REQUIRED_SCOPES as CALENDAR_SCOPES } from "@mcp-gateway/calendar"
import { REQUIRED_SCOPES as NOTES_SCOPES } from "@mcp-gateway/notes"
import type { OAuth2Tokens } from "arctic"

import type { McpSlug } from "../db/schema"

/** The Required scope set for an MCP: one constant in the MCP's own module (SPEC §9.2). */
export function requiredScopes(mcp: McpSlug): readonly string[] {
  return mcp === "calendar" ? CALENDAR_SCOPES : NOTES_SCOPES
}

/** Space-delimited `accounts.scopes` as a list. */
export function parseScopes(scopes: string): string[] {
  return scopes.split(/\s+/).filter(Boolean)
}

/** The Granted scope set a token response carries; absent means empty, never "unchanged". */
export function grantedScopes(tokens: OAuth2Tokens): string[] {
  return tokens.hasScopes() ? tokens.scopes() : []
}

/** True when every Required scope is in the Granted set. */
export function covers(granted: readonly string[], required: readonly string[]): boolean {
  const grantedSet = new Set(granted)
  return required.every(scope => grantedSet.has(scope))
}
