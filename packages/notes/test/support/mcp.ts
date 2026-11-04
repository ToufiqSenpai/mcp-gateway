import { createMcpHandler, CLIENT_CAPABILITIES_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';
import type { McpServer } from '@modelcontextprotocol/server';
import type { McpContext } from '../../src/context';

export const PROTOCOL_VERSION = '2026-07-28';

export const stubContext: McpContext = {
  async listAccounts() {
    return [{ slug: 'personal', isDefault: true }];
  },
  async getAccessToken() {
    return 'test-access-token';
  },
  async refreshAccessToken() {
    return 'test-access-token';
  },
  cursors: {
    async accountSet() {
      return 'test-set';
    },
    async encode() {
      return 'next-cursor';
    },
    async decode() {
      return { o: 0, a: 'test-set' };
    },
  },
  async invalidateEnumeration() {},
  async enumeration<T>(
    _account: string,
    load: () => Promise<{ items: T[]; truncated: boolean }>,
  ) {
    const fresh = await load();
    return { ...fresh, cached: false };
  },
};

export function modernRequest(body: Record<string, unknown>): Request {
  const params = (body['params'] as Record<string, unknown> | undefined) ?? {};
  const method = typeof body['method'] === 'string' ? body['method'] : '';
  const name = typeof params['name'] === 'string' ? params['name'] : undefined;
  return new Request('http://localhost/mcps/notes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      'Mcp-Method': method,
      ...(name ? { 'Mcp-Name': name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      ...body,
      params: {
        ...params,
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: PROTOCOL_VERSION,
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      },
    }),
  });
}

export interface JsonRpcReply {
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

export async function call(server: McpServer, body: Record<string, unknown>): Promise<JsonRpcReply> {
  const handler = createMcpHandler(() => server, { legacy: 'reject', responseMode: 'json' });
  const response = await handler.fetch(modernRequest(body));
  return (await response.json()) as JsonRpcReply;
}



