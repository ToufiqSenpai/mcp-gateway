import { Hono } from 'hono';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createMcpContext } from '../accounts/lifecycle';
import { createDb } from '../db/client';
import type { AppEnv } from '../index';
import { isMcpSlug, MCP_REGISTRY } from '../mcps/registry';

export const mcpRoutes = new Hono<AppEnv>();

mcpRoutes.post('/:slug', async (c) => {
  const slug = c.req.param('slug');
  if (!isMcpSlug(slug)) return c.text('Not found', 404);

  const { factory } = MCP_REGISTRY[slug];
  const handler = createMcpHandler(
    () =>
      factory(
        createMcpContext(c.env, createDb(c.env), slug, (promise) =>
          c.executionCtx.waitUntil(promise),
        ),
      ),
    { legacy: 'reject', responseMode: 'json' },
  );
  return handler.fetch(c.req.raw);
});

mcpRoutes.on(['GET', 'DELETE', 'PUT', 'PATCH', 'HEAD'], '/:slug', (c) =>
  c.text('Method Not Allowed', 405, { Allow: 'POST' }),
);
