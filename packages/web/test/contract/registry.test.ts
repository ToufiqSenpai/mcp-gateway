import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { McpContext as CalendarContext } from '@mcp-gateway/calendar';
import type { McpContext as NotesContext } from '@mcp-gateway/notes';
import type { McpContext as WebContext } from '../../src/mcps/context';
import { MCP_REGISTRY, MCP_SLUGS } from '../../src/mcps/registry';

type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// The MCP packages may not import the Worker, so their interfaces are mirrored; these fail to
// compile if either side drifts.
export type CalendarContextMatchesWeb = Assert<Same<CalendarContext, WebContext>>;
export type NotesContextMatchesWeb = Assert<Same<NotesContext, WebContext>>;

async function mcpEnumFromDatabase(): Promise<string[]> {
  const row = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounts'",
  ).first<{ sql: string }>();
  if (!row) throw new Error('accounts table is missing');

  const clause = /"mcp" IN \(([^)]*)\)/.exec(row.sql);
  if (!clause?.[1]) throw new Error('no mcp CHECK clause found');
  return [...clause[1].matchAll(/'([^']+)'/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

describe('registry', () => {
  it('has exactly the MCPs the schema CHECK enum allows', async () => {
    expect(Object.keys(MCP_REGISTRY).sort()).toEqual([...MCP_SLUGS].sort());
    expect((await mcpEnumFromDatabase()).sort()).toEqual(Object.keys(MCP_REGISTRY).sort());
  });

  it('pairs each MCP with its one Provider', () => {
    expect(MCP_REGISTRY.calendar.provider).toBe('google');
    expect(MCP_REGISTRY.notes.provider).toBe('microsoft');
  });
});
