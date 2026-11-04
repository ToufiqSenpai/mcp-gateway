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
  const response = await appFetch(`${TEST_ORIGIN}/mcps/${options.slug ?? 'notes'}`, {
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
  return { status: response.status, headers: response.headers, json };
}

describe('MCP conformance on /mcps/notes', () => {
  it('answers server/discover with its own identity, resources and no prompts', async () => {
    const reply = await rpc({ method: 'server/discover', params: {} });
    const result = reply.json['result'] as Record<string, unknown>;
    const meta = result['_meta'] as Record<string, Record<string, unknown>>;

    expect(reply.status).toBe(200);
    expect(result['resultType']).toBe('complete');
    expect(meta[SERVER_INFO_META_KEY]?.['name']).toBe('notes');
    const capabilities = result['capabilities'] as Record<string, unknown>;
    expect(capabilities['tools']).toBeDefined();
    expect(capabilities['resources']).toEqual({});
    expect(capabilities['prompts']).toBeUndefined();
    expect(JSON.stringify(capabilities)).not.toContain('listChanged');
  });

  it('lists the eleven notes tools deterministically', async () => {
    const first = await rpc({ method: 'tools/list', params: {} });
    const names = (first.json['result'] as { tools: { name: string }[] }).tools.map(
      (tool) => tool.name,
    );
    expect(names).toHaveLength(11);

    for (let run = 0; run < 20; run += 1) {
      const again = await rpc({ method: 'tools/list', params: {} });
      expect(
        (again.json['result'] as { tools: { name: string }[] }).tools.map((tool) => tool.name),
      ).toEqual(names);
    }
  });

  it('answers an unknown tool with -32602', async () => {
    const reply = await rpc({
      method: 'tools/call',
      params: { name: 'list_section_groups', arguments: {} },
    });
    expect((reply.json['error'] as { code: number } | undefined)?.code).toBe(-32602);
  });

  it('refuses GET and DELETE with 405 and never sets HTTP cache headers', async () => {
    const token = await mcpJwt();
    for (const method of ['GET', 'DELETE']) {
      const response = await appFetch(`${TEST_ORIGIN}/mcps/notes`, {
        method,
        headers: { 'Cf-Access-Jwt-Assertion': token },
      });
      expect(response.status).toBe(405);
      await response.body?.cancel();
    }

    const reply = await rpc({ method: 'tools/list', params: {} });
    expect(reply.headers.get('mcp-session-id')).toBeNull();
    expect(reply.headers.get('cache-control')).toBeNull();
  });

  it('answers an unknown slug with 404 and a human credential with 403', async () => {
    const unknown = await rpc({ method: 'server/discover', params: {} }, { slug: 'mail' });
    expect(unknown.status).toBe(404);

    const human = await rpc(
      { method: 'tools/list', params: {} },
      { token: await accessJwt('admin') },
    );
    expect(human.status).toBe(403);
  });

  it('lists resources without touching the Provider when there are no Accounts', async () => {
    const reply = await rpc({ method: 'resources/list', params: {} });
    const result = reply.json['result'] as { resources: unknown[] };
    expect(result.resources).toEqual([]);
    expect((reply.json['result'] as Record<string, unknown>)['resultType']).toBe('complete');
  });

  it('returns an empty template list', async () => {
    const reply = await rpc({ method: 'resources/templates/list', params: {} });
    const result = reply.json['result'] as { resourceTemplates: unknown[] };
    expect(result.resourceTemplates).toEqual([]);
  });
});
