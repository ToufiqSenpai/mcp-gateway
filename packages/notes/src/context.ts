/**
 * The only surface an MCP package may use. Mirrors `packages/web/src/mcps/context.ts`; the
 * package boundary forbids importing the Worker module.
 */
export interface McpContext {
  /** Accounts of the MCP this server is mounted on. Never includes state or Credentials. */
  listAccounts(): Promise<{ slug: string; isDefault: boolean }[]>;
  /** A usable access token for the slug, refreshing when needed; throws when unusable. */
  getAccessToken(slug: string): Promise<string>;
  /** Forces one refresh after a Provider 401 and returns the new token. */
  refreshAccessToken(slug: string): Promise<string>;
  /** Opaque page tokens: signed in the Worker, so an MCP package never sees the signing key. */
  cursors: CursorCodec;
  /** The container list changed (for example a new notebook): drop cached enumerations. */
  invalidateEnumeration(): Promise<void>;
  /** KV read-through for one Account's container enumeration, keyed by its epoch. */
  enumeration<T>(
    account: string,
    load: () => Promise<{ items: T[]; truncated: boolean }>,
  ): Promise<{ items: T[]; truncated: boolean; cached: boolean }>;
}

export interface CursorPayload {
  o: unknown;
  a: string;
}

export interface CursorCodec {
  accountSet(accounts: { slug: string }[]): Promise<string>;
  encode(payload: CursorPayload): Promise<string>;
  decode(cursor: string, accountSet: string): Promise<CursorPayload>;
}

/** Accounts this MCP can use, in a stable order. */
export async function usableAccounts(ctx: McpContext): Promise<{ slug: string; isDefault: boolean }[]> {
  return ctx.listAccounts();
}

/** Explicit slug, otherwise the Default Account. Never another Account as a fallback. */
export async function accountSlug(ctx: McpContext, requested: string | undefined): Promise<string> {
  if (requested) return requested;
  const accounts = await ctx.listAccounts();
  const fallback = accounts.find((account) => account.isDefault);
  if (!fallback) throw new Error('No Default Account is set. Pass "account" or set one in the admin area.');
  return fallback.slug;
}



