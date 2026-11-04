import type { McpContext } from "../context"

/**
 * Per-request view over `McpContext`: Account selection and enumeration. Each package extends
 * this with its own Provider client and keeps its wire-level pagination names.
 */
export class ToolContext {
  public constructor(protected readonly ctx: McpContext) {}

  public listAccounts() {
    return this.ctx.listAccounts()
  }

  /** Explicit slug, otherwise the Default Account. Never another Account as a fallback. */
  public async resolve(requested: string | undefined): Promise<string> {
    const accounts = await this.ctx.listAccounts()
    if (requested) {
      if (!accounts.some(account => account.slug === requested)) throw unknownAccount(requested)
      return requested
    }
    const fallback = accounts.find(account => account.isDefault)
    if (!fallback) {
      throw new Error('No Default Account is set. Pass "account" or set one in the admin area.')
    }
    return fallback.slug
  }

  /** Accounts to read from: one explicit Account, or every Account of this MCP. */
  public async selectedAccounts(requested: string | undefined) {
    const accounts = await this.ctx.listAccounts()
    if (!requested) return accounts
    const selected = accounts.filter(account => account.slug === requested)
    if (selected.length === 0) throw unknownAccount(requested)
    return selected
  }

  public enumeration<T>(account: string, load: () => Promise<{ items: T[]; truncated: boolean }>) {
    return this.ctx.enumeration(account, load)
  }

  public invalidateEnumeration() {
    return this.ctx.invalidateEnumeration()
  }
}

/** A slug the caller named but the Worker never handed to this MCP is a hard error. */
function unknownAccount(slug: string): Error {
  return new Error(`Account "${slug}" is not configured for this MCP.`)
}
