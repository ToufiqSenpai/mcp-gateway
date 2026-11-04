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

export function defineTool<S extends z.ZodObject<z.ZodRawShape>>(
  name: string,
  config: { title: string; description: string; inputSchema: S; annotations?: ToolAnnotations },
  handler: (args: z.infer<S>, ctx: McpContext) => Promise<unknown>,
): ToolDefinition {
  return { name, config, handler: (args, ctx) => handler(args as z.infer<S>, ctx) };
}

export const PAGE_SIZE = 100;
export const FETCH_CAP = 1000;

/** Wraps a payload that needs protocol-level metadata (a truncated or partial listing). */
export class ToolResult {
  constructor(
    readonly data: unknown,
    readonly options: { truncated?: boolean; meta?: Record<string, unknown> } = {},
  ) {}
}

/**
 * Slices locally and wraps the offset in a signed cursor bound to the usable-Account set.
 * `cursor: ""` is the first page; an absent `nextCursor` is the only end-of-list signal.
 */
export async function paginate<T>(options: {
  ctx: McpContext;
  accounts: { slug: string }[];
  cursor: string | undefined;
  fetchAll: () => Promise<{ items: T[]; truncated?: boolean }>;
}): Promise<{ items: T[]; nextCursor?: string; truncated: boolean }> {
  const set = await options.ctx.cursors.accountSet(options.accounts);
  let offset = 0;

  if (options.cursor) {
    const payload = await options.ctx.cursors.decode(options.cursor, set);
    if (typeof payload.o !== 'number' || !Number.isInteger(payload.o) || payload.o < 0) {
      throw new Error('Invalid cursor');
    }
    offset = payload.o;
  }

  const { items, truncated = false } = await options.fetchAll();
  const page = items.slice(offset, offset + PAGE_SIZE);
  const nextCursor =
    offset + PAGE_SIZE < items.length
      ? await options.ctx.cursors.encode({ o: offset + PAGE_SIZE, a: set })
      : undefined;

  return { items: page, nextCursor, truncated };
}
