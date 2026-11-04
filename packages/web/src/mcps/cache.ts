import { AccountRepository } from "../db/account-repository"
import type { McpSlug } from "../db/schema"
import type { Env } from "../env"

const TTL_SECONDS = 300

interface CacheValue<T> {
  resources: T[]
  fetchedAt: number
  truncated: boolean
}

/**
 * KV read-through for one Account's container enumeration, keyed by its `cache_epoch`.
 * Partial results are never written; a failed put is logged and ignored.
 */
export class EnumerationCache {
  public constructor(
    private readonly env: Env,
    private readonly repository: AccountRepository,
    private readonly mcp: McpSlug,
    private readonly waitUntil?: (promise: Promise<unknown>) => void
  ) {}

  /** Arrow field: safe to destructure as `enumeration` without losing `this`. */
  public readonly get = async <T>(
    slug: string,
    load: () => Promise<{ items: T[]; truncated: boolean }>
  ): Promise<{ items: T[]; truncated: boolean; cached: boolean }> => {
    // The epoch is read from D1 on every enumeration, so a bump is visible immediately.
    const account = await this.repository.findBySlug(this.mcp, slug)
    const epoch = account?.cacheEpoch ?? 0
    const key = `v1:enum:${this.mcp}:${slug}:${epoch}`

    const cached = await this.env.CACHE.get<CacheValue<T>>(key, "json")
    if (cached) {
      return { items: cached.resources, truncated: cached.truncated, cached: true }
    }

    const fresh = await load()
    if (!fresh.truncated) {
      const put = this.env.CACHE.put(
        key,
        JSON.stringify({
          resources: fresh.items,
          fetchedAt: Date.now(),
          truncated: false
        } satisfies CacheValue<T>),
        { expirationTtl: TTL_SECONDS }
      ).catch(() => {
        // A failed write is not a failed request.
      })
      if (this.waitUntil) this.waitUntil(put)
      else await put
    }

    return { items: fresh.items, truncated: fresh.truncated, cached: false }
  }
}
