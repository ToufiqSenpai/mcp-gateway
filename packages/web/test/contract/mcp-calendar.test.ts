import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
} from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { TEST_ORIGIN, accessJwt, appFetch, mcpJwt } from '../support/access';

const PROTOCOL_VERSION = '2026-07-28';

function envelope(body: Record<string, unknown>): Record<string, unknown> {
  const params = (body['params'] as Record<string, unknown> | undefined) ?? {};
  return {
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
  };
}

async function rpc(
  body: Record<string, unknown>,
  options: { slug?: string; token?: string } = {},
): Promise<{ status: number; headers: Headers; json: Record<string, unknown> }> {
  const method = String(body['method'] ?? '');
  const name = (body['params'] as Record<string, unknown> | undefined)?.['name'];
  const token = options.token ?? (await mcpJwt());
  const response = await appFetch(`${TEST_ORIGIN}/mcps/${options.slug ?? 'calendar'}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Cf-Access-Jwt-Assertion': token,
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      'Mcp-Method': method,
      ...(typeof name === 'string' ? { 'Mcp-Name': name } : {}),
    },
    body: JSON.stringify(envelope(body)),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { text };
  }
  return {
    status: response.status,
    headers: response.headers,
    json,
  };
}

describe('MCP conformance on /mcps/calendar', () => {
  it('answers server/discover with its own server identity and capabilities', async () => {
    const reply = await rpc({ method: 'server/discover', params: {} });
    const result = reply.json['result'] as Record<string, unknown>;

    expect(reply.status).toBe(200);
    expect(result['resultType']).toBe('complete');
    const meta = result['_meta'] as Record<string, Record<string, unknown>>;
    expect(meta[SERVER_INFO_META_KEY]?.['name']).toBe('calendar');
    expect(result['supportedVersions']).toContain('2026-07-28');
    const capabilities = result['capabilities'] as Record<string, unknown>;
    expect(capabilities['tools']).toBeDefined();
    expect(capabilities['prompts']).toBeDefined();
    expect(capabilities['resources']).toEqual({});
    expect(JSON.stringify(capabilities)).not.toContain('listChanged');
  });

  it('lists the ten tools deterministically and marks results complete', async () => {
    const first = await rpc({ method: 'tools/list', params: {} });
    const names = (first.json['result'] as { tools: { name: string }[] }).tools.map(
      (tool) => tool.name,
    );
    expect(names).toHaveLength(10);
    expect((first.json['result'] as Record<string, unknown>)['resultType']).toBe('complete');

    for (let run = 0; run < 20; run += 1) {
      const again = await rpc({ method: 'tools/list', params: {} });
      const againNames = (again.json['result'] as { tools: { name: string }[] }).tools.map(
        (tool) => tool.name,
      );
      expect(againNames).toEqual(names);
    }
  });

  it('calls list_accounts without touching the Provider', async () => {
    const reply = await rpc({
      method: 'tools/call',
      params: { name: 'list_accounts', arguments: {} },
    });
    const result = reply.json['result'] as Record<string, unknown>;
    expect(result['isError']).toBeUndefined();

    const payload = JSON.parse((result['content'] as { text: string }[])[0]?.text ?? '{}') as {
      accounts: unknown[];
    };
    expect(payload.accounts).toEqual([]);
  });

  it('answers an unknown tool with -32602', async () => {
    const reply = await rpc({
      method: 'tools/call',
      params: { name: 'drop_everything', arguments: {} },
    });
    expect((reply.json['error'] as { code: number } | undefined)?.code).toBe(-32602);
  });

  it('refuses GET and DELETE with 405', async () => {
    const token = await mcpJwt();
    for (const method of ['GET', 'DELETE']) {
      const response = await appFetch(`${TEST_ORIGIN}/mcps/calendar`, {
        method,
        headers: { 'Cf-Access-Jwt-Assertion': token },
      });
      expect(response.status).toBe(405);
      await response.body?.cancel();
    }
  });

  it('answers an unknown slug with 404', async () => {
    const reply = await rpc({ method: 'server/discover', params: {} }, { slug: 'mail' });
    expect(reply.status).toBe(404);
  });

  it('never mints a session id or sets HTTP cache headers', async () => {
    const reply = await rpc({ method: 'tools/list', params: {} });
    expect(reply.headers.get('mcp-session-id')).toBeNull();
    expect(reply.headers.get('cache-control')).toBeNull();
    expect(reply.headers.get('etag')).toBeNull();
  });

  it('enforces the route-group pairing', async () => {
    const human = await accessJwt('admin');
    const adminOnMcp = await appFetch(`${TEST_ORIGIN}/mcps/calendar`, {
      method: 'POST',
      headers: { 'Cf-Access-Jwt-Assertion': human, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(adminOnMcp.status).toBe(403);

    const serviceOnAdmin = await appFetch(`${TEST_ORIGIN}/admin`, {
      headers: { 'Cf-Access-Jwt-Assertion': await mcpJwt() },
    });
    expect(serviceOnAdmin.status).toBe(403);

    const anonymous = await appFetch(`${TEST_ORIGIN}/mcps/calendar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(anonymous.status).toBe(401);
  });
});


