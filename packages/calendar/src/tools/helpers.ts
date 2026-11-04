import type { ToolAnnotations } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { McpContext } from '../context';

export interface ToolDefinition {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: z.ZodObject<z.ZodRawShape>;
    annotations?: ToolAnnotations;
  };
  handler(args: unknown, ctx: McpContext): Promise<unknown>;
}

/** Keeps each tool's handler typed from its own schema while the registry stays homogeneous. */
export function defineTool<S extends z.ZodObject<z.ZodRawShape>>(
  name: string,
  config: { title: string; description: string; inputSchema: S; annotations?: ToolAnnotations },
  handler: (args: z.infer<S>, ctx: McpContext) => Promise<unknown>,
): ToolDefinition {
  return {
    name,
    config,
    handler: (args, ctx) => handler(args as z.infer<S>, ctx),
  };
}

export function clampPageSize(requested: number | undefined): number {
  if (requested === undefined) return 100;
  return Math.min(250, Math.max(1, Math.trunc(requested)));
}

export const FETCH_CAP = 1000;

/** Wraps a tool payload that needs protocol-level metadata (a truncated listing). */
export class ToolResult {
  constructor(
    readonly data: unknown,
    readonly options: { truncated?: boolean; meta?: Record<string, unknown> } = {},
  ) {}
}

/** Follows Provider pagination to the cap; Provider tokens stay inside this function. */
export async function collectPages<T>(
  fetchPage: (pageToken?: string) => Promise<{ items: T[]; nextPageToken?: string | null }>,
  cap = FETCH_CAP,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let pageToken: string | undefined;

  do {
    const page = await fetchPage(pageToken);
    items.push(...page.items);
    pageToken = page.nextPageToken ?? undefined;
    if (!pageToken) return { items, truncated: false };
  } while (items.length < cap);

  return { items: items.slice(0, cap), truncated: true };
}

/**
 * Slices locally and wraps the offset in a signed cursor bound to the usable-Account set.
 * Page size is server-chosen; `pageToken: ""` is the first page, absence ends the list.
 */
export async function paginate<T>(options: {
  ctx: McpContext;
  accounts: { slug: string }[];
  pageToken: string | undefined;
  pageSize: number;
  fetchAll: () => Promise<{ items: T[]; truncated?: boolean }>;
}): Promise<{ items: T[]; nextPageToken?: string; truncated: boolean }> {
  const set = await options.ctx.cursors.accountSet(options.accounts);
  let offset = 0;

  if (options.pageToken) {
    const payload = await options.ctx.cursors.decode(options.pageToken, set);
    if (typeof payload.o !== 'number' || !Number.isInteger(payload.o) || payload.o < 0) {
      throw new Error('Invalid page token');
    }
    offset = payload.o;
  }

  const { items, truncated = false } = await options.fetchAll();
  const page = items.slice(offset, offset + options.pageSize);
  const hasMore = offset + options.pageSize < items.length;
  const nextPageToken = hasMore
    ? await options.ctx.cursors.encode({ o: offset + options.pageSize, a: set })
    : undefined;

  return { items: page, nextPageToken, truncated };
}
