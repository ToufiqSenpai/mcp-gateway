import type { McpSlug } from "../db/schema"

export type UnusableReason = "missing" | "no_default" | "needs_reauth" | "revoked" | "missing_scope" | "no_credentials"

/** The one error shape a tool turns into `isError`: the slug plus where to fix it. */
export class UnusableAccountError extends Error {
  public constructor(
    public readonly mcp: McpSlug,
    public readonly slug: string,
    public readonly reason: UnusableReason
  ) {
    super(`Account "${slug}" is not usable (${reason}). Fix it at /admin/mcps/${mcp}.`)
    this.name = "UnusableAccountError"
  }
}
