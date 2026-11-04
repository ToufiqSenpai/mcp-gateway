import { Hono } from 'hono';
import appCss from '../admin/app.generated.css';
import { isDevBypass } from '../auth/access';
import { callbackUri, providerClient } from '../auth/arctic';
import {
  ensureCsrfToken,
  isCsrfValid,
  isSameOrigin,
  setOAuthFlowCookie,
} from '../auth/cookies';
import { decryptToken } from '../auth/crypto';
import {
  bumpCacheEpoch,
  findAccountBySlug,
  listAccountsByMcp,
  setDefaultAccount,
  updateAccount,
} from '../db/queries';
import { createDb } from '../db/client';
import { nowSeconds } from '../db/client';
import type { Account } from '../db/schema';
import type { AppEnv } from '../index';
import { isMcpSlug, MCP_REGISTRY } from '../mcps/registry';
import {
  RetryableContentionError,
  SlugTakenError,
  startAuthorization,
} from '../accounts/lifecycle-oauth';
import { HomePage, loadMcpRows } from '../views/home';
import { McpPage, RevokeConfirmationPage, errorSentence } from '../views/mcp';
import { TestToolPage } from '../views/test-tool';
import { listToolNames, runInProcess } from '../mcps/in-process';

/** FNV-1a over the built stylesheet: stable per build, cheap per isolate. */
function buildHash(css: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < css.length; index += 1) {
    hash ^= css.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

const CSS_ETAG = `"${buildHash(appCss)}"`;

async function revokeAccount(
  env: AppEnv['Bindings'],
  account: Account,
  requestUrl: string,
): Promise<void> {
  if (account.provider === 'google' && account.refreshToken) {
    try {
      const token = await decryptToken(
        env.TOKEN_ENCRYPTION_KEY,
        account.refreshToken,
        account.id,
        'refresh_token',
      );
      const client = providerClient(env, 'google', callbackUri(requestUrl, 'google'));
      if ('revokeToken' in client) await client.revokeToken(token);
    } catch {
      // Best effort: a Provider-side revoke failure must not block the local revoke.
    }
  }
}

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get('/app.css', (c) => {
  const headers = {
    'Content-Type': 'text/css; charset=utf-8',
    'Cache-Control': 'private, max-age=3600',
    ETag: CSS_ETAG,
  };
  if (c.req.header('If-None-Match') === CSS_ETAG) return c.body(null, 304, headers);
  return c.body(appCss, 200, headers);
});

adminRoutes.get('/', async (c) => {
  ensureCsrfToken(c);
  const rows = await loadMcpRows(c.env);
  return c.html(<HomePage rows={rows} devBypass={isDevBypass(c.env, c.req.url)} />);
});

adminRoutes.get('/mcps/:mcp', async (c) => {
  const mcp = c.req.param('mcp');
  if (!isMcpSlug(mcp)) return c.text('Not found', 404);

  const db = createDb(c.env);
  const accounts = await listAccountsByMcp(db, mcp);
  const csrf = ensureCsrfToken(c);
  const added = c.req.query('added');
  const error = c.req.query('error');

  return c.html(
    <McpPage
      mcp={mcp}
      provider={MCP_REGISTRY[mcp].provider}
      accounts={accounts}
      csrf={csrf}
      devBypass={isDevBypass(c.env, c.req.url)}
      {...(error
        ? { notice: errorSentence(error), noticeKind: 'error' as const }
        : added
          ? { notice: `Account “${added}” is ready.`, noticeKind: 'ok' as const }
          : {})}
    />,
  );
});

adminRoutes.post('/mcps/:mcp/accounts', async (c) => {
  const mcp = c.req.param('mcp');
  if (!isMcpSlug(mcp)) return c.text('Not found', 404);

  const body = await c.req.parseBody();
  if (!isSameOrigin(c.req.raw) || !isCsrfValid(c, body['_csrf'])) {
    return c.text('Forbidden', 403);
  }

  const slug = typeof body['slug'] === 'string' ? body['slug'] : '';
  try {
    const started = await startAuthorization(c.env, createDb(c.env), {
      mcp,
      provider: MCP_REGISTRY[mcp].provider,
      slug,
      requestUrl: c.req.url,
    });
    setOAuthFlowCookie(c, started.state);
    return c.redirect(started.authorizeUrl, 303);
  } catch (error) {
    if (error instanceof SlugTakenError) {
      return c.redirect(`/admin/mcps/${mcp}?error=slug_taken`, 303);
    }
    throw error;
  }
});

adminRoutes.post('/mcps/:mcp/accounts/:slug/reauth', async (c) => {
  const mcp = c.req.param('mcp');
  const slug = c.req.param('slug');
  if (!isMcpSlug(mcp)) return c.text('Not found', 404);

  const body = await c.req.parseBody();
  if (!isSameOrigin(c.req.raw) || !isCsrfValid(c, body['_csrf'])) {
    return c.text('Forbidden', 403);
  }

  const db = createDb(c.env);
  const account = await findAccountBySlug(db, mcp, slug);
  if (!account) return c.text('Not found', 404);

  try {
    const started = await startAuthorization(c.env, db, {
      mcp,
      provider: MCP_REGISTRY[mcp].provider,
      slug,
      targetAccountId: account.id,
      requestUrl: c.req.url,
    });
    setOAuthFlowCookie(c, started.state);
    return c.redirect(started.authorizeUrl, 303);
  } catch (error) {
    if (error instanceof SlugTakenError || error instanceof RetryableContentionError) {
      return c.redirect(`/admin/mcps/${mcp}?error=state`, 303);
    }
    throw error;
  }
});

adminRoutes.post('/mcps/:mcp/accounts/:slug/default', async (c) => {
  const mcp = c.req.param('mcp');
  const slug = c.req.param('slug');
  if (!isMcpSlug(mcp)) return c.text('Not found', 404);

  const body = await c.req.parseBody();
  if (!isSameOrigin(c.req.raw) || !isCsrfValid(c, body['_csrf'])) {
    return c.text('Forbidden', 403);
  }

  const db = createDb(c.env);
  const account = await findAccountBySlug(db, mcp, slug);
  if (!account || account.state !== 'active') return c.text('Not found', 404);

  await setDefaultAccount(db, mcp, account.id);
  await bumpCacheEpoch(db, account.id);
  return c.redirect(`/admin/mcps/${mcp}`, 303);
});

adminRoutes.get('/mcps/:mcp/accounts/:slug/revoke', async (c) => {
  const mcp = c.req.param('mcp');
  const slug = c.req.param('slug');
  if (!isMcpSlug(mcp)) return c.text('Not found', 404);

  const account = await findAccountBySlug(createDb(c.env), mcp, slug);
  if (!account) return c.text('Not found', 404);

  return c.html(
    <RevokeConfirmationPage
      mcp={mcp}
      slug={slug}
      csrf={ensureCsrfToken(c)}
      devBypass={isDevBypass(c.env, c.req.url)}
    />,
  );
});

adminRoutes.post('/mcps/:mcp/accounts/:slug/revoke', async (c) => {
  const mcp = c.req.param('mcp');
  const slug = c.req.param('slug');
  if (!isMcpSlug(mcp)) return c.text('Not found', 404);

  const body = await c.req.parseBody();
  if (!isSameOrigin(c.req.raw) || !isCsrfValid(c, body['_csrf'])) {
    return c.text('Forbidden', 403);
  }

  const db = createDb(c.env);
  const account = await findAccountBySlug(db, mcp, slug);
  if (!account) return c.text('Not found', 404);

  await revokeAccount(c.env, account, c.req.url);
  await updateAccount(db, account.id, {
    accessToken: null,
    refreshToken: null,
    state: 'revoked',
    isDefault: 0,
    lastError: null,
    revokedAt: nowSeconds(),
  });
  await bumpCacheEpoch(db, account.id);
  return c.redirect(`/admin/mcps/${mcp}`, 303);
});

adminRoutes.get('/mcps/:mcp/test', async (c) => {
  const mcp = c.req.param('mcp');
  if (!isMcpSlug(mcp)) return c.text('Not found', 404);

  const db = createDb(c.env);
  const [tools, accounts] = await Promise.all([
    listToolNames(c.env, db, mcp),
    listAccountsByMcp(db, mcp),
  ]);

  return c.html(
    <TestToolPage
      mcp={mcp}
      tools={tools}
      accounts={accounts}
      csrf={ensureCsrfToken(c)}
      devBypass={isDevBypass(c.env, c.req.url)}
    />,
  );
});

adminRoutes.post('/mcps/:mcp/test', async (c) => {
  const mcp = c.req.param('mcp');
  if (!isMcpSlug(mcp)) return c.text('Not found', 404);

  const body = await c.req.parseBody();
  if (!isSameOrigin(c.req.raw) || !isCsrfValid(c, body['_csrf'])) {
    return c.text('Forbidden', 403);
  }

  const tool = typeof body['tool'] === 'string' ? body['tool'] : '';
  const account =
    typeof body['account'] === 'string' && body['account'] ? body['account'] : undefined;
  const rawArgs = typeof body['args'] === 'string' && body['args'] ? body['args'] : '{}';

  const db = createDb(c.env);
  const [tools, accounts] = await Promise.all([
    listToolNames(c.env, db, mcp),
    listAccountsByMcp(db, mcp),
  ]);

  const page = (notice: string | false) =>
    c.html(
      <TestToolPage
        mcp={mcp}
        tools={tools}
        accounts={accounts}
        csrf={ensureCsrfToken(c)}
        devBypass={isDevBypass(c.env, c.req.url)}
        {...(notice ? { error: notice } : {})}
      />,
    );

  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(rawArgs);
  } catch {
    return page('Arguments are not valid JSON.');
  }

  if (!tools.some((entry) => entry.name === tool)) {
    return page('That tool is not registered for this MCP.');
  }

  const started = Date.now();
  const reply = await runInProcess(c.env, db, mcp, {
    method: 'tools/call',
    params: {
      name: tool,
      arguments: {
        ...(account ? { account } : {}),
        ...(typeof parsedArgs === 'object' && parsedArgs !== null ? parsedArgs : {}),
      },
    },
  });
  const durationMs = Date.now() - started;

  const result = reply['result'] as { isError?: boolean } | undefined;
  const jsonRpcError = reply['error'];

  return c.html(
    <TestToolPage
      mcp={mcp}
      tools={tools}
      accounts={accounts}
      csrf={ensureCsrfToken(c)}
      devBypass={isDevBypass(c.env, c.req.url)}
      result={{
        tool,
        body: JSON.stringify(jsonRpcError ? { error: jsonRpcError } : result, null, 2),
        isError: Boolean(result?.isError ?? jsonRpcError),
        durationMs,
      }}
    />,
  );
});
