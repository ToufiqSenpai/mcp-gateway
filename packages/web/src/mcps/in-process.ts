import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  createMcpHandler,
} from '@modelcontextprotocol/server';
import { createMcpContext } from '../accounts/lifecycle';
import type { Database } from '../db/client';
import type { McpSlug } from '../db/schema';
import type { Env } from '../env';
import { MCP_REGISTRY } from './registry';

const PROTOCOL_VERSION = '2026-07-28';

/**
 * Runs one JSON-RPC exchange through the same handler `/mcps/*` uses. No self-fetch, so the
 * Worker never needs to store a service token for itself.
 */
export async function runInProcess(
  env: Env,
  db: Database,
  mcp: McpSlug,
  body: { method: string; params?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const handler = createMcpHandler(
    () => MCP_REGISTRY[mcp].factory(createMcpContext(env, db, mcp)),
    { legacy: 'reject', responseMode: 'json' },
  );

  const name = body.params?.['name'];
  const request = new Request(`http://internal/mcps/${mcp}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      'Mcp-Method': body.method,
      ...(typeof name === 'string' ? { 'Mcp-Name': name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: body.method,
      params: {
        ...body.params,
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: PROTOCOL_VERSION,
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    }),
  });

  const response = await handler.fetch(request);
  return (await response.json()) as Record<string, unknown>;
}

export async function listToolNames(
  env: Env,
  db: Database,
  mcp: McpSlug,
): Promise<{ name: string; title?: string; description?: string }[]> {
  const reply = await runInProcess(env, db, mcp, { method: 'tools/list', params: {} });
  const result = reply['result'] as { tools?: { name: string; title?: string; description?: string }[] };
  return result.tools ?? [];
}

