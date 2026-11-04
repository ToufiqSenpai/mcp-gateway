import type { ToolAnnotations } from "@modelcontextprotocol/server"
import type { z } from "zod"

import type { McpContext } from "./context"

/** Protocol metadata a tool may attach; values are JSON-serialisable. */
export type MetaValue = string | number | boolean | null | MetaValue[] | { [key: string]: MetaValue }

export type ToolMeta = Record<string, MetaValue>

/** The field record a `z.object` schema is built from. */
export type ObjectFields = Readonly<Record<string, z.ZodType>>

/** The JSON object the SDK hands a tool before its own schema narrows it. */
export type ToolArguments = Record<string, MetaValue>

/** A tool's serialisable return payload; the registry stringifies it once. */
export type ToolPayload = object

export interface ToolDefinition<C> {
  name: string
  config: {
    title: string
    description: string
    inputSchema: z.ZodObject<ObjectFields>
    annotations?: ToolAnnotations
  }
  handler(args: ToolArguments, context: C): Promise<ToolPayload>
}

/** Keeps each tool's handler typed from its own schema while the registry stays homogeneous. */
export function defineTool<C, S extends z.ZodObject<ObjectFields>>(
  name: string,
  config: { title: string; description: string; inputSchema: S; annotations?: ToolAnnotations },
  handler: (args: z.infer<S>, context: C) => Promise<ToolPayload>
): ToolDefinition<C> {
  // SAFETY: the SDK validates `args` against `config.inputSchema` before this wrapper runs.
  return { name, config, handler: (args, context) => handler(args as z.infer<S>, context) }
}

/**
 * Reads one Account at a time and keeps the healthy ones. A failed Account marks the listing
 * partial (`truncated`) and is named so the caller can report it.
 */
export async function collectAcrossAccounts<T>(
  accounts: { slug: string }[],
  load: (slug: string) => Promise<{ items: T[]; truncated: boolean }>
): Promise<{ items: T[]; truncated: boolean; skipped: string[] }> {
  const items: T[] = []
  const skipped: string[] = []
  let truncated = false

  for (const account of accounts) {
    try {
      const result = await load(account.slug)
      items.push(...result.items)
      truncated ||= result.truncated
    } catch {
      skipped.push(account.slug)
    }
  }

  return { items, truncated: truncated || skipped.length > 0, skipped }
}

/** Wraps a tool payload that needs protocol-level metadata (a partial listing). */
export class ToolResult<T extends object = object> {
  public constructor(
    public readonly data: T,
    public readonly options: { truncated?: boolean; skipped?: string[]; meta?: ToolMeta } = {}
  ) {}
}

/**
 * Slices locally and wraps the offset in a signed cursor bound to the usable-Account set.
 * Each package names the token on its own wire; this layer only moves offsets.
 */
export async function paginate<T>(options: {
  ctx: McpContext
  accounts: { slug: string }[]
  offsetToken: string | undefined
  pageSize: number
  fetchAll: () => Promise<{ items: T[]; truncated?: boolean; skipped?: string[] }>
}): Promise<{ items: T[]; nextOffsetToken?: string; truncated: boolean; skipped: string[] }> {
  const set = await options.ctx.cursors.accountSet(options.accounts)
  let offset = 0

  if (options.offsetToken) {
    const payload = await options.ctx.cursors.decode(options.offsetToken, set)
    const offsetValue = Number(payload.o)
    if (!Number.isInteger(offsetValue) || offsetValue < 0) {
      throw new Error("Invalid page token")
    }
    offset = offsetValue
  }

  const { items, truncated = false, skipped = [] } = await options.fetchAll()
  const page = items.slice(offset, offset + options.pageSize)
  const hasMore = offset + options.pageSize < items.length
  const nextOffsetToken = hasMore
    ? await options.ctx.cursors.encode({ o: offset + options.pageSize, a: set })
    : undefined

  return { items: page, nextOffsetToken, truncated, skipped }
}
