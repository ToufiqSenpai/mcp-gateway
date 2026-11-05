/**
 * The only surface an MCP package may use (ADR-0006). Accounts, Credentials, refresh, the
 * encryption key and the cursor signing key stay on the Worker side of the boundary.
 */
export interface McpContext {
  /** Accounts of the MCP this server is mounted on. Never includes state or Credentials. */
  listAccounts(): Promise<{ slug: string; isDefault: boolean }[]>
  /** A usable access token for the slug, refreshing when needed; throws when unusable. */
  getAccessToken(slug: string): Promise<string>
  /** Forces one refresh after a Provider 401 and returns the new token. */
  refreshAccessToken(slug: string): Promise<string>
  /** Opaque page tokens: signed in the Worker, so an MCP package never sees the signing key. */
  cursors: CursorCodec
  /** The container list changed (for example a new notebook): drop cached enumerations. */
  invalidateEnumeration(): Promise<void>
  /** KV read-through for one Account's container enumeration, keyed by its epoch. */
  enumeration<T>(
    account: string,
    load: () => Promise<{ items: T[]; truncated: boolean }>
  ): Promise<{
    items: T[]
    truncated: boolean
  }>
}

export interface CursorPayload {
  o: unknown
  a: string
}

export interface CursorCodec {
  accountSet(accounts: { slug: string }[]): Promise<string>
  encode(payload: CursorPayload): Promise<string>
  decode(cursor: string, accountSet: string): Promise<CursorPayload>
}
