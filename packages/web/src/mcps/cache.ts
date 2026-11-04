import type { Database } from '../db/client';
import { findAccountBySlug } from '../db/queries';
import type { Env } from '../env';
import type { McpSlug } from '../db/schema';

const TTL_SECONDS = 300;

interface CacheValue<T> {
  resources: T[];
  fetchedAt: number;
  truncated: boolean;
}

export interface EnumerationCache {
  /**
   * KV read-through for one Account's container enumeration, keyed by its `cache_epoch`.
   * Partial results are never written; a failed put is logged and ignored.
   */
  get<T>(
    account: string,
    load: () => Promise<{ items: T[]; truncated: boolean }>,
  ): Promise<{ items: T[]; truncated: boolean; cached: boolean }>;
}

export function createEnumerationCache(
  env: Env,
  db: Database,
  mcp: McpSlug,
  waitUntil?: (promise: Promise<unknown>) => void,
): EnumerationCache {
  return {
    async get<T>(slug: string, load: () => Promise<{ items: T[]; truncated: boolean }>) {
      // The epoch is read from D1 on every enumeration, so a bump is visible immediately.
      const account = await findAccountBySlug(db, mcp, slug);
      const epoch = account?.cacheEpoch ?? 0;
      const key = `v1:enum:${mcp}:${slug}:${epoch}`;

      const cached = await env.CACHE.get<CacheValue<T>>(key, 'json');
      if (cached) {
        return { items: cached.resources, truncated: cached.truncated, cached: true };
      }

      const fresh = await load();
      if (!fresh.truncated) {
        const put = env.CACHE.put(
          key,
          JSON.stringify({
            resources: fresh.items,
            fetchedAt: Date.now(),
            truncated: false,
          } satisfies CacheValue<T>),
          { expirationTtl: TTL_SECONDS },
        ).catch(() => {
          // A failed write is not a failed request.
        });
        if (waitUntil) waitUntil(put);
        else await put;
      }

      return { items: fresh.items, truncated: fresh.truncated, cached: false };
    },
  };
}
