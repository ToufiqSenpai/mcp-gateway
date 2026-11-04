# MCP Gateway — Specification

A single-user gateway on Cloudflare Workers that hosts first-party MCP servers under
`/mcps/*`, each against exactly one Provider, with several Accounts per MCP, an admin UI,
and MCP resources and prompts.

**Status:** design complete, nothing implemented. The decisions that are hard to reverse are
recorded in [`docs/adr/`](./docs/adr/).

---

## 1. Scope

**In scope for v1**

- Two MCPs: `calendar` (Google Calendar, read-write) and `notes` (Microsoft Graph
  OneNote, read-write).
- Multi-account per MCP, with a per-MCP Default Account and per-request Account
  selection.
- OAuth authorization-code flow with PKCE, refresh-token rotation and single-flight
  refresh, per Provider.
- Server-rendered admin UI: add, reauth, revoke, set default, inspect Account health,
  run a tool in-process.
- MCP tools, resources and prompts, protocol `2026-07-28`, stateless.

**Out of scope** — ruled out, not deferred:

- A plugin system or runtime registration of MCPs. An MCP is code; adding one is a
  deploy.
- Proxying or hosting third-party MCP servers.
- Non-OAuth MCPs (API key or static Credential).
- Multi-user, multi-tenant or per-user data isolation.
- Durable Object session state.
- Self-issued bearer tokens for MCP clients.

---

## 2. Architecture

One Worker, one deployable. A pnpm workspace splits the code into one Worker package and
one library per MCP.

```
Client ──CF-Access-Client-*──► /mcps/:slug ──► registry ──► createServer(ctx)
Browser ──Access session────► /admin*, /oauth/* ──► admin router
```

**Packages.**

| Package | Kind | Responsibility |
| --- | --- | --- |
| `packages/web` | Worker | Hono app, routes, D1, KV, Accounts, Credentials, refresh, Access verification, admin UI, registry |
| `packages/calendar` | library | `calendar` MCP: tools, resources, prompts, Google client seam |
| `packages/notes` | library | `notes` MCP: tools, resources, Microsoft Graph client seam |

**Package boundary.** An MCP package never imports D1, `arctic`, or the encryption
module. It receives:

```ts
interface McpContext {
  listAccounts(): Promise<{ slug: string; isDefault: boolean }[]>;
  getAccessToken(slug: string): Promise<string>;
  refreshAccessToken(slug: string): Promise<string>;
  cursors: CursorCodec;
  invalidateEnumeration(): Promise<void>;
  enumeration<T>(
    account: string,
    load: () => Promise<{ items: T[]; truncated: boolean }>,
  ): Promise<{ items: T[]; truncated: boolean; cached: boolean }>;
}
```

Accounts, Credentials, refresh and the registry stay in `packages/web`. This is what makes
an MCP package testable without a database (ADR-0006). The interface is the contract: the
Worker's `GatewayMcpContext` implements it without adding members, and each package mirrors
it exactly (asserted at compile time). `createServer(ctx)` is a thin adapter over
`CalendarServer` / `NotesServer`; internal collaborators are classes (ADR-0007).

**Registry.** `packages/web/src/mcps/registry.ts` is the only map from slug to factory;
`McpRegistry` is a lookup facade over that const, not a second map. A test asserts its keys
equal the `mcp` CHECK enum in the Drizzle schema, so adding an MCP without a migration fails
in CI rather than at runtime.

**Request flow for `/mcps/:slug`.**

1. Access JWT verified and classified as a service token (§7).
2. `:slug` resolved through the registry; unknown slug is `404`.
3. `createMcpHandler(factory, { legacy: 'reject', responseMode: 'json' })` handles the
   request; one server instance per request.
4. The MCP SDK validates `_meta`, `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`,
   answers `server/discover`, and maps protocol errors (§12).

`GET` and `DELETE` on `/mcps/:slug` answer `405`.

---

## 3. Stack and dependencies

`nodejs_compat` is **not** enabled: both Provider SDKs bundle and run on plain workerd.

| Dependency | Version | Why |
| --- | --- | --- |
| `typescript` | 7.0.2 | `tsc -b` project references; `--noEmit` for typecheck |
| `pnpm` | 12.16 | workspaces, one lockfile |
| `wrangler` | 4.157 | deploy, `--env-file`, D1 migrations |
| `hono` | 4.13 | routing for `/mcps/*`, `/admin`, `/oauth/*`; JSX for admin |
| `jose` | resolved at install | RS256 verification of `Cf-Access-Jwt-Assertion` against the team JWKS |
| `@modelcontextprotocol/server` | 2.4.0 | MCP `2026-07-28` server; `createMcpHandler` |
| `@modelcontextprotocol/hono` | 2.0.2 | Hono app for `/mcps/*`; Host/Origin validation and JSON body parsing |
| `@modelcontextprotocol/client` | 2.4.0 | in-process MCP client for the admin test panel |
| `@modelcontextprotocol/core` | 2.4.0 | transitive; schema types |
| `zod` | 4.6 | tool input schemas, env validation |
| `arctic` | 3.7 | OAuth authorize / exchange / refresh on Workers (ADR-0005) |
| `@googleapis/calendar` | 20.1.0 | type-only: request/response shapes |
| `gaxios` | 7.3.1 | installed by the Google client, not used at runtime |
| `@microsoft/msgraph-sdk` | 1.0.0-preview.92 | `GraphRequestAdapter` + `createGraphServiceClient`; all OneNote calls and paging |
| `@microsoft/msgraph-sdk-users` | 1.0.0-preview.92 | registers `me` / `users`, which is where OneNote lives |
| `@microsoft/kiota-abstractions` | 1.0.0-preview.112 | `AuthenticationProvider` and `RequestInformation` for the two raw calls the fluent API cannot type |
| `drizzle-orm` / `drizzle-kit` | 0.45 / 0.31 | D1 access and migration generation |
| `vitest` | ^4.1 | pinned to 4.x: the workerd pool peers on `^4.1.0`; move to 5 only when the pool declares `^5` (recheck at each pool release) |
| `@cloudflare/vitest-pool-workers` | 0.23 | workerd test pool, `applyD1Migrations`; the package is now published as `@cloudflare/vitest-plugin`, and one `workerd` version is forced through `pnpm.overrides` so tests run on the deploy runtime |
| `oxlint` / `oxfmt` | 1.91 / 0.76 | lint and format; no ESLint, no Prettier |

Every `@microsoft/kiota-*` package must resolve to one preview number; mixing two copies fails
the bundle with `No matching export … registerDefaultDeserializer`. `pnpm-workspace.yaml`
pins `@microsoft/kiota-abstractions` and `@microsoft/kiota-authentication-azure` to
`1.0.0-preview.112` because `@microsoft/msgraph-sdk-core` still asks for `^preview.82`.

**Client implementation.** `packages/notes/src/client.ts` builds the SDK client the way the
package README does: implement `AuthenticationProvider` against `McpContext`
(`headers.add("Authorization", …)` — `Headers` is `Map<string, Set<string>>`, so `set` would
spread the token into characters), then `new GraphRequestAdapter(auth)`,
`adapter.baseUrl = …`, `createGraphServiceClient(adapter)`, and
`import "@microsoft/msgraph-sdk-users"` for `me`. Tools call typed builders
(`client.me.onenote.notebooks.get({ queryParameters: … })`), paging follows
`odataNextLink`, and `GraphError` is translated from the SDK's `ODataError` at that seam.
`kiota-bundle` is transitive through `msgraph-sdk-core`; it is not a direct dependency.

Two calls stay on `RequestInformation` because the generated v1 metadata does not match the
documented endpoints: creating a page needs a `text/html` body (the builder types JSON) and
`update_page` needs `PATCH …/pages/{id}/content` (the builder only exposes the
`onenotePatchContent` action). Both still go through the SDK adapter, so auth, retries and
error mapping are unchanged.

Verified bundle size after the change: 10 167 KiB / 1 176 KiB gzip for the Worker (was
1 715 KiB / 317 KiB gzip with plain `fetch` for both Providers).

**Why the v2 MCP SDK.** The official v1 line (`@modelcontextprotocol/sdk@1.32.2`) stops at
protocol `2025-11-25`. `@modelcontextprotocol/server@2` implements `2026-07-28` with a
per-request stateless HTTP handler.

---

## 4. Repository layout

```
pnpm-workspace.yaml   package.json   tsconfig.base.json
oxlint.json  .oxfmtrc.json  drizzle.config.ts  wrangler.jsonc  .env.example
packages/
  web/
    package.json  tsconfig.json  vitest.config.ts  migrations/
    src/
      index.ts                 # Worker entry: Hono app
      routes/{mcps,oauth}.ts
      routes/admin.tsx         # server-rendered routes need JSX
      mcps/registry.ts         # slug -> factory, the only MCP list + McpRegistry facade
      mcps/{context,pagination,cache,in-process}.ts
                               # interface + HmacCursorCodec, EnumerationCache, InProcessRunner
      db/{schema.ts,client.ts,queries.ts,account-repository.ts}
      auth/{access.ts,arctic.ts,crypto.ts,scopes.ts}
                               # AccessVerifier, TokenCipher, Required scope sets + coverage
      lib/base64url.ts         # shared base64url codec: envelope, cursor, CSRF token
      accounts/{lifecycle.ts,refresh.ts,lifecycle-oauth.ts,errors.ts,gateway-context.ts}
                               # AccountService, RefreshService, OAuthFlowService
      admin/{app.css, app.generated.css}   # generated file is gitignored
      views/                   # server-rendered JSX
  calendar/
    package.json  tsconfig.json  vitest.config.ts
    src/{index.ts,server.ts,client.ts,tools/,resources.ts,prompts.ts}
      server.ts                # CalendarServer + createServer adapter
      client.ts                # GoogleCalendarClient + resource classes
      tools/{index,helpers,tool-context,registry}.ts
  notes/
    package.json  tsconfig.json  vitest.config.ts
    src/{index.ts,server.ts,client.ts,tools/,resources.ts}
      server.ts                # NotesServer + createServer adapter
      tools/{index,helpers,tool-context,registry}.ts
```

No Workers Static Assets. Tailwind is compiled to `packages/web/src/admin/app.generated.css`
and served from `GET /admin/app.css` as a Wrangler Text module (§15).

---

## 5. Configuration

```jsonc
// wrangler.jsonc
{
  "name": "mcp-gateway",
  "main": "packages/web/src/index.ts",
  "compatibility_date": "2026-11-01",
  "workers_dev": false,
  "preview_urls": false,
  "routes": [{ "pattern": "gateway.<zone>", "custom_domain": true }],
  "vars": { "ENVIRONMENT": "production" },
  "d1_databases": [{ "binding": "DB", "database_name": "mcp-gateway", "database_id": "<deploy-time>" }],
  "kv_namespaces": [{ "binding": "CACHE", "id": "<deploy-time>" }],
  "rules": [{ "type": "Text", "globs": ["**/*.css"] }]
}
```

One deployment, one set of secrets: no `env` blocks.

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Entra app registration; tenant is `common` |
| `TOKEN_ENCRYPTION_KEY` | base64 of exactly 32 bytes; AES-GCM key for Credentials |
| `CURSOR_SIGNING_KEY` | HMAC-SHA256 key for opaque pagination cursors |
| `CF_ACCESS_TEAM_DOMAIN` | `https://<team>.cloudflareaccess.com`; `iss` and JWKS base |
| `CF_ACCESS_ADMIN_AUD` | AUD of the human Access application |
| `CF_ACCESS_MCP_AUD` | AUD of the service-token Access application |
| `ENVIRONMENT` | `development` enables the local auth bypass (§7) |

Local development runs `wrangler dev --env-file .env`; `.env.example` is committed with
empty values and `.env` stays ignored. Production uses `wrangler secret put <NAME>`.

---

## 6. Data model

D1, Drizzle schema in `packages/web/src/db/schema.ts`, migrations generated into
`packages/web/migrations` and applied with `wrangler d1 migrations apply DB`. Tests apply
the same files through `applyD1Migrations` — no parallel test schema.

```sql
CREATE TABLE accounts (
  id                     TEXT PRIMARY KEY,            -- crypto.randomUUID()
  mcp                    TEXT NOT NULL CHECK (mcp IN ('calendar','notes')),
  slug                   TEXT NOT NULL,               -- ^[a-z0-9][a-z0-9-]{0,31}$
  provider               TEXT NOT NULL CHECK (provider IN ('google','microsoft')),
  provider_subject       TEXT NOT NULL,
  email                  TEXT NOT NULL,
  display_name           TEXT,
  access_token           TEXT,                        -- v2.<iv>.<ct||tag>, NULL when revoked
  refresh_token          TEXT,
  access_token_expires_at INTEGER NOT NULL,           -- unix seconds
  scopes                 TEXT NOT NULL,               -- space-delimited, as returned by the Provider
  state                  TEXT NOT NULL CHECK (state IN ('active','needs_reauth','revoked')),
  is_default             INTEGER NOT NULL DEFAULT 0,
  cache_epoch            INTEGER NOT NULL DEFAULT 0,  -- bumped on any change that invalidates enumeration
  refresh_lock_until     INTEGER,
  refresh_lock_token     TEXT,
  last_refreshed_at      INTEGER,
  last_error             TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  revoked_at             INTEGER,
  CHECK ((mcp = 'calendar' AND provider = 'google')
      OR (mcp = 'notes'    AND provider = 'microsoft'))
);
CREATE UNIQUE INDEX accounts_mcp_slug ON accounts(mcp, slug);
CREATE UNIQUE INDEX accounts_identity ON accounts(mcp, provider, provider_subject);
CREATE UNIQUE INDEX accounts_default  ON accounts(mcp) WHERE is_default = 1;

CREATE TABLE oauth_states (
  state             TEXT PRIMARY KEY,                 -- 32 random bytes, base64url
  mcp               TEXT NOT NULL CHECK (mcp IN ('calendar','notes')),
  provider          TEXT NOT NULL CHECK (provider IN ('google','microsoft')),
  slug              TEXT NOT NULL,
  code_verifier     TEXT NOT NULL,
  target_account_id TEXT REFERENCES accounts(id),
  created_at        INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL                  -- created_at + 10 min
);
```

**`mcp` is a hardcoded enum**, exactly like `provider`: one row shape, values added by
migration when an MCP is born, and the value is the slug used in `/mcps/<slug>`. Not a
table per MCP. The `mcp`/`provider` pairing is enforced because each MCP is first-party
against exactly one Provider.

No `token_type` column: every Provider here issues `Bearer` and nothing reads it.

`cache_epoch` lives on `accounts` rather than in a separate `cache_epochs` table. The
enumeration cache is keyed per Account, so an Account's own row is the natural place for
its epoch, and there is no "MCP with no Accounts" row to create.

Expired `oauth_states` rows are deleted opportunistically at the start of each new flow;
consumed rows are deleted at the callback. No cron.

---

## 7. Gateway authentication

One custom hostname, `gateway.<zone>`; the literal is a deploy-time input. `workers_dev`
and preview URLs are off because Access cannot protect `*.workers.dev`.

| Application | Paths | Policy | Purpose |
| --- | --- | --- | --- |
| `mcp-gateway-admin` | `/`, `/admin*`, `/oauth/*` | **Allow**, Include → email = the single operator | Human admin and the OAuth callback |
| `mcp-gateway-clients` | `/mcps/*` | **Service Auth**, Include → one service token | MCP clients |

Strict service-token authentication is ON: a missing or invalid token gets `401`/`403`,
never a login redirect. Human login is One-time PIN; no external IdP in v1. Paths outside
those two applications are unprotected at the edge and `404` in the Worker.

**The Worker verifies every request rather than trusting the edge.**

1. Read `Cf-Access-Jwt-Assertion`.
2. Verify the RS256 signature against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`
   (JWKS cached per isolate), `iss` = the team domain, `aud` = the AUD of the application
   that should cover the path (`CF_ACCESS_ADMIN_AUD` or `CF_ACCESS_MCP_AUD`).
3. Classify: `sub === ""` with `common_name` present → service token; `email` present with
   a UUID `sub` → human. mTLS is not configured, so `common_name` appears only on service
   tokens.
4. Enforce the pairing: `/admin*` and `/oauth/*` accept human tokens only; `/mcps/*`
   accepts service tokens only. A mismatch is `403` with no detail.

**Local development.** When `ENVIRONMENT=development` and the host is localhost, JWT
verification is skipped for both route groups and a fake human identity is injected. Every
admin page shows a "dev auth bypass" banner. A test asserts the bypass is unreachable when
`ENVIRONMENT=production`.

---

## 8. OAuth flows and Account lifecycle

### 8.1 Add an Account

1. The admin starts the flow from the MCP's admin page with a slug they type:
   `^[a-z0-9][a-z0-9-]{0,31}$`, unique per MCP. `?account=<slug>` turns the same flow into
   a reauth of an existing Account.
2. The gateway writes an `oauth_states` row (`state` = 32 random bytes base64url,
   `code_verifier` from `arctic.generateCodeVerifier()`, `mcp`, `provider`, `slug`,
   `target_account_id`, `created_at`, `expires_at` = +10 min) and sets an `oauth_flow`
   cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, 10-minute lifetime, value = `state`. The
   cookie is the login-CSRF binding.
3. Redirect to the `arctic` authorize URL, **patched before redirect**:
   - Google: `access_type=offline` always and `prompt=consent` always (also on reauth).
     `arctic@3.7` adds neither; without `access_type=offline` Google issues no refresh
     token at all.
   - Microsoft: the scope list always includes `offline_access`.
4. Callback: `/oauth/callback/<provider>`. The Provider comes from the path segment;
   `mcp`, `slug` and `target_account_id` come from the state row, never from the path.
5. Validate: cookie `oauth_flow` === `state` query param; state row exists and is
   unexpired; then `DELETE … RETURNING` it (single use). Any miss → `?error=state`.
6. `error=access_denied` or any other `error` param → `?error=denied`, nothing written.
7. Exchange `code` + `code_verifier` via `arctic.validateAuthorizationCode()`. **No refresh
   token in the response → reject** (`?error=no_refresh_token`); never store a
   half-usable Account.
8. Fetch the Provider identity once: Google `/userinfo` (`sub`, `email`, `name`),
   Microsoft Graph `/me` (`id`, `mail`/`userPrincipalName`, `displayName`). Stored as
   `provider_subject`.
9. Duplicate `(mcp, provider, provider_subject)` → `?error=duplicate&slug=<existing>`. One
   Provider identity is one Account per MCP.
10. Reauth: the identity from step 8 must equal the target Account's `provider_subject`,
    else `?error=identity_mismatch`. On success the row's tokens, `scopes`,
    `access_token_expires_at` and `last_refreshed_at` are overwritten, `state` becomes
    `active`, `revoked_at` and `last_error` are cleared. Slug and identity never change.
11. The flow always ends in a `302` to the MCP's admin page with the outcome in the query:
    `?added=<slug>` or `?error=denied|duplicate|no_refresh_token|state|identity_mismatch|slug_taken|missing_scope`.
    The callback never renders HTML and never puts tokens or emails in the URL.

The callback sits under the human Access application, so it only runs for a browser that
already holds an Access session. The `oauth_flow` cookie remains the binding between flow
and callback; Access is not the login-CSRF defence.

### 8.2 States

`active`, `needs_reauth`, `revoked`.

| Transition | Trigger |
| --- | --- |
| `active → needs_reauth` | `OAuth2RequestError` with `invalid_grant` (Microsoft: `invalid_grant` / `interaction_required`), or the Granted scope set losing coverage (§9) |
| `needs_reauth → active` | successful reauth |
| `active \| needs_reauth → revoked` | admin action |
| `revoked → active` | successful reauth |

Revoking is best-effort `revokeToken()` at the Provider (Google only; `arctic` has no
Microsoft equivalent), sets both ciphertexts to `NULL`, sets `revoked_at` and clears
`is_default`. The row, slug and Provider identity stay reserved. There is no hard delete in
v1.

Transient refresh failures (5xx, `ArcticFetchError`, timeout) never change `state`; they
record `last_error` and leave the Account `active`. A `401` from the Provider **after** a
successful refresh is a scope/permission problem, not a dead refresh token: `state` stays
`active` and the error passes through.

### 8.3 Default Account

- At most one per MCP, enforced by the partial unique index.
- The first Account to reach `active` for an MCP with no default becomes the default
  automatically. Later defaults are chosen by the admin.
- A request without `account` uses the default. If the default is missing, `needs_reauth`
  or `revoked`, the call fails — **never falling back to another active Account**. The
  error names the broken default and lists the available slugs.
- Revoking the default clears `is_default`; the MCP then has no default until the admin
  picks one.

### 8.4 Error surface

Unusable-Account conditions (unknown slug, `needs_reauth`, `revoked`, no default, duplicate
slug) are **tool results** with `isError: true`, naming the slug plus the admin URL to fix
it. JSON-RPC errors stay reserved for protocol faults.

`list_accounts` returns `{ accounts: [{ slug, isDefault }] }` for the MCP it is mounted on —
nothing else: no state, no tokens, no `provider_subject`. An empty array when the MCP has no
Accounts, never an error. It lists **every** Account, including ones that are
`needs_reauth` or `revoked`, so an unqualified call can name the broken Default Account
instead of claiming there is no default (drift recorded during build).

---

## 9. Credentials at rest and scope enforcement

### 9.1 Encryption

- Key: `TOKEN_ENCRYPTION_KEY`, base64 of exactly 32 bytes, per environment. Validated once
  per isolate; absent or wrong length makes every Account operation fail closed with a
  generic `500` (detail only in logs). Never a plaintext fallback, never a runtime-generated
  key.
- AES-256-GCM via `node:crypto`, 12-byte random IV per encryption, envelope
  `v2.<iv>.<ciphertext||tag>` with base64url segments. A `v1` envelope written by the
  earlier Web Crypto implementation stays readable until a refresh rewrites the row.
- AAD = `"<account_id>:<field>"`, `field` ∈ `access_token` | `refresh_token`, so a
  ciphertext cannot be replayed into another row or column.
- Encrypted: `access_token`, `refresh_token`. Plaintext: expiry, scopes, email, state and
  everything else.

### 9.2 Required scope sets

| MCP | Provider | Required scope set |
| --- | --- | --- |
| `calendar` | Google | `openid email profile https://www.googleapis.com/auth/calendar` |
| `notes` | Microsoft | `offline_access User.Read Notes.ReadWrite` |

The set is a constant in the MCP's own module and is the single source used by the authorize
URL, the callback check and the call-path check.

**Google uses the blanket `calendar` scope.** The narrower three-scope set the reference
server publishes is read-only and cannot authorize its four write tools, Google publishes
no per-tool mapping, and both choices are sensitive, so the verification burden is
identical. `openid email profile` are load-bearing: the callback's identity fetch hits
`/userinfo`, which needs `openid`, and the email and display name come from `email` and
`profile`. They are non-sensitive and need no review.

**Microsoft keeps `User.Read` on both legs.** One constant for the authorize URL and the
refresh request, rather than an authorize-only scope; admin consent already covers it, so it
costs no prompt. `Notes.ReadWrite` covers every call in the `notes` surface, including
notebook and section creation — `Notes.Create` is not needed, because Graph's operation
pages list `Notes.ReadWrite` as sufficient.

### 9.3 Enforcement

The token response's `scope` field is the **Granted scope set** — what the user actually
consented to. It is compared against the Required scope set before anything is written.

- Missing any required scope → `?error=missing_scope`. New Account: no row written.
  Reauth: the existing row, its tokens and its `scopes` are untouched, `state` unchanged.
- A reauth granting **fewer** scopes than the Account previously held is rejected the same
  way. A working Credential is never silently narrowed. Consequence: an Account already in
  `needs_reauth` whose owner re-consents with a box unchecked stays in `needs_reauth`.
- No per-tool scope gating. Google publishes no per-tool mapping, `search_events` has no
  REST equivalent, and Microsoft's `Notes.ReadWrite` is one coarse permission covering
  every OneNote call — a per-tool table would be invented, not derived.

**Coverage lost after the fact** follows one rule: `state = 'needs_reauth'`,
`last_error = 'missing_scope'`, refresh lock released, and the call fails with the
Account-unusable tool result. Two detectors apply it:

1. **At refresh.** The refresh response's `scope`, when present, replaces the stored
   Granted scope set. If it no longer covers the Required scope set, demote. A missing
   `scope` field — Microsoft may omit it — means *unchanged*, never *empty*.
2. **At call time.** The guard that checks `state = 'active'` also checks the stored
   Granted scope set covers the Required scope set. This is the only detector for a
   widened Required scope set after a deploy, where both stored and Provider scopes are
   unchanged.

`missing_scope` clears on a successful reauth. A Provider `403` at call time passes
through and leaves `state` untouched: it can be a per-calendar ACL problem that reauth
cannot fix.

---

## 10. Token refresh

Trigger, on the same path for both Providers:

- **Pre-emptive**: before a Provider call, if `access_token_expires_at - now < 60` s,
  refresh.
- **Reactive**: on a Provider `401`, force a refresh and retry the call **once**.

Algorithm:

1. If a fresh access token is cached (`> 60` s left), decrypt and use it.
2. Claim the lock:
   `UPDATE accounts SET refresh_lock_until = :now+30, refresh_lock_token = :uuid WHERE id = :id AND (refresh_lock_until IS NULL OR refresh_lock_until < :now)`.
   `meta.changes = 1` means we own it.
3. Lock not acquired: poll up to ~2 s in 250 ms steps, re-reading the row. If
   `access_token_expires_at` advanced, use the new token. If the lock is gone but nothing
   advanced, try to claim it. If still locked at the deadline, use the current token while
   it is still valid, else return a retryable error.
4. With the lock: `arctic.refreshAccessToken(decrypt(refresh_token))`. A returned refresh
   token **replaces** the stored one; when the Provider omits it, the old one is kept.
5. Persist in one statement, conditioned on the lock token, which also releases the lock:
   `UPDATE accounts SET access_token = ?, refresh_token = ?, access_token_expires_at = ?, last_refreshed_at = ?, refresh_lock_until = NULL, refresh_lock_token = NULL WHERE id = ? AND refresh_lock_token = ?`.
   The CAS is on the lock token, not the ciphertext: AES-GCM output is non-deterministic, so
   ciphertext comparison cannot work.
6. `invalid_grant` → `state = 'needs_reauth'`, `last_error` set, lock released. Everything
   else → `last_error` set, lock released, `state` untouched.
7. A pre-emptive failure with a still-valid token proceeds with the old token and lets the
   Provider decide.

The lock is the **single** writer path: reauth takes the same lock and returns "refresh in
progress, retry" if it is held, so a reauth can never overwrite a token mid-rotation. The
30-second lease means a Worker dying mid-refresh cannot freeze the Account.

---

## 11. MCP protocol conformance

Target: MCP `2026-07-28`, stateless Streamable HTTP. Each `/mcps/<slug>` is a **separate
MCP server** with its own `server/discover`, its own `serverInfo`, and its own tool set.
There is no gateway-wide discovery document.

```ts
createMcpHandler(factory, { legacy: 'reject', responseMode: 'json' })
```

Each handler is mounted on `createMcpHonoApp({ host, allowedHosts, allowedOrigins })`, so
`Host` and `Origin` are validated against `PUBLIC_HOSTNAME` before dispatch.

- One server instance per HTTP request; no session, no Durable Object.
- `legacy: 'reject'` refuses 2025-era traffic rather than silently serving it.
- `responseMode: 'json'` returns a single JSON body. SSE remains available for
  `subscriptions/listen`, which this gateway never advertises.
- `server/discover`, `_meta` validation, `Mcp-Method` / `Mcp-Name` checks and the `-3202x`
  ladder are the SDK's job, not hand-written.

**What the gateway must not do:**

- Advertise `listChanged` or `resources/subscribe` (ADR-0001). `subscriptions/listen` is
  answered with an empty acknowledgement (`notifications: {}`) and emits nothing.
- Emit `notifications/message` without a per-request `logLevel`.
- Emit `-32002` or `-32042`, or any code in the legacy `-32000`–`-32019` range.
- Serve `GET`/`DELETE` on an MCP path, or mint/echo `Mcp-Session-Id`.
- Set HTTP `Cache-Control` / `ETag` on MCP responses; MCP caching lives only in the body.
- Send a server-initiated JSON-RPC request. The gateway never uses MRTR.

**Result shape.** Every successful result carries `resultType: "complete"`. Tool execution
failures are `isError: true` results, never JSON-RPC errors. Unknown tool, prompt or
resource is `-32602`; internal failures are `-32603`.

**Argument validation detail (drift recorded during build).** The SDK's `tools/call` handler
converts everything thrown inside a tool, including its own input-schema failures, into an
`isError` result. `-32602` is therefore produced for unknown tools, malformed requests and
prompt arguments, but a bad tool argument or cursor arrives as an `isError` result with a
plain message. Resource reads keep `-32602` (unknown container, with `data.uri`).

### 11.1 Caching

| Operation | `ttlMs` | `cacheScope` |
| --- | --- | --- |
| `server/discover` | 3 600 000 | `public` |
| `tools/list` | 3 600 000 | `public` |
| `prompts/list`, `prompts/get` | 3 600 000 | `public` |
| `resources/templates/list` | 3 600 000 | `public` |
| `resources/list`, complete | 300 000 | `private` |
| `resources/list`, partial (sick Account) | 0 | `private` |
| `resources/read` | 30 000 | `private` |

Anything derived from a Credential is `private`; `public` here would be a data-leak bug.
All pages of one paginated list share the same `cacheScope`. `tools/call` results are not
cacheable. The SDK's own `resources/list` result drops per-call fields, so the gateway's
MCP servers answer that method themselves in order to emit `ttlMs: 0` and the `_meta`
skipped-Account warning for a partial listing.

### 11.2 Pagination

MCP cursor pagination only; Provider pagination (`nextPageToken`, `@odata.nextLink`) stays
internal and is never surfaced.

- `nextCursor` is omitted when exhausted; its absence is the only end-of-list signal.
- `cursor: ""` is a valid cursor and maps to the first page, never end-of-list.
- Page size is server-chosen (100); clients must not assume it.
- A cursor is an opaque base64url JSON `{o, h}` signed with HMAC-SHA256 under
  `CURSOR_SIGNING_KEY`, with no expiry. A bad signature or a changed active-Account set is
  `-32602`.
- Provider fetches complete per Account (calendarList `maxResults=250` following
  `nextPageToken`; Graph `$top=100` following `@odata.nextLink`), then are sliced locally.
  A per-Account fetch cap of 1000 sets `truncated: true` plus a `_meta` warning.
- `resources/templates/list` and `prompts/list` are single-page.

---

## 12. The `calendar` MCP

Provider: Google Calendar. Read-write, with resources and prompts. Nine tools mirroring
Google's `calendarmcp.googleapis.com` surface, plus the gateway-wide `list_accounts`.

Google publishes no per-tool schemas; the schemas below were captured from the live
`tools/list` on 2026-11-03. Field names are camelCase on the wire, even though Google's
descriptions use snake_case.

**Common rules**

- Every tool takes an optional `account` slug in addition to the fields below.
- Times are ISO 8601 timestamps exactly as Google documents them: `dateTime` carries an
  offset or trailing `Z` (for example `2019-11-20T08:19:06-07:00`), and `date` is a
  midnight-UTC timestamp (for example `2019-11-20T00:00:00Z`), not a bare date. A named zone
  goes in `timeZone`, and only when the user named one.
- `notificationLevel` defaults to `ALL` on create, update, delete and respond, while REST
  defaults to none. This will email guests by default; it mirrors the reference surface and
  is called out in the runbook.
- Google's `pageToken` / `nextPageToken` field names are kept, but the token value is the
  gateway cursor from §11.2, never Google's.

### 12.1 Tools

| Tool | Underlying call | Annotations |
| --- | --- | --- |
| `list_events` | `events.list` | readOnly, idempotent |
| `get_event` | `events.get` | readOnly, idempotent |
| `list_calendars` | `calendarList.list` | readOnly, idempotent |
| `suggest_time` | `freebusy.query` | readOnly, idempotent |
| `create_event` | `events.insert` | non-destructive |
| `update_event` | `events.patch` | idempotent |
| `delete_event` | `events.delete` | destructive, idempotent |
| `respond_to_event` | targeted `events.patch` | idempotent |
| `search_events` | `events.list` with `q` | readOnly, idempotent |

```
list_events(calendarId?, startTime?, endTime?, fullText?, eventType[]?,
            eventTypeFilter[]?, orderBy?, pageSize? = 100 (max 250), pageToken?, timeZone?)
  -> { summary, description, updated, timeZone, accessRole,
       defaultReminders[], events: Event[], nextPageToken? }

get_event(eventId, calendarId?) -> Event

list_calendars(pageSize? = 100 (max 250), pageToken?)
  -> { calendars: [{ id, summary, description, timeZone }], nextPageToken? }

suggest_time(attendeeEmails[], startTime, endTime, durationMinutes? = 30,
             timeZone?, preferences?)
  -> { timeSlots: [{ start, end, startTime? (deprecated), endTime? (deprecated),
                     durationMinutes? (deprecated) }] }
     start/end: DateOrDateTime; preferences: { startHour? "HH:mm", endHour? "HH:mm",
     excludeWeekends?, pageSize? = 5 }

create_event(summary, startTime, endTime, calendarId?, allDay?, addGoogleMeetUrl?,
             googleMeetUrl?, attendees[]?, attendeeEmails[]? (deprecated), attachments[]?,
             availability?, colorId?, description?, eventType?, guestPermissions?,
             location?, notificationLevel?, overrideReminders[]?, recurrenceData[]?,
             timeZone?, visibility?, workingLocationProperties?)
  -> Event

update_event(eventId, calendarId?, summary?, description?, location?, startTime?,
             endTime?, allDay?, timeZone?, addedAttendees[]?, addedAttendeeEmails[]? (deprecated),
             removedAttendeeEmails[]?, addedAttachments[]?,
             removedAttachmentFileUrls[]?, availability?, colorId?, guestPermissions?,
             notificationLevel?, overrideReminders[]?,
             visibility?, addGoogleMeetUrl?, googleMeetUrl?)
  -> Event

delete_event(eventId, calendarId?, notificationLevel?) -> Event

respond_to_event(eventId, responseStatus, calendarId?, notificationLevel?,
                 responseComment?) -> Event

search_events(query, pageSize?, pageToken?)
  -> { events: Event[], nextPageToken? }
```

**Enums.** `eventType`: `EVENT_TYPE_UNSPECIFIED`, `DEFAULT`, `OUT_OF_OFFICE`,
`FOCUS_TIME`, `WORKING_LOCATION`, `BIRTHDAY`, `FROM_GMAIL`. `orderBy`: `default`,
`startTime`, `startTimeDesc`, `lastModified`. `notificationLevel`:
`NOTIFICATION_LEVEL_UNSPECIFIED`, `NONE`, `EXTERNAL_ONLY`, `ALL`. `availability`:
`AVAILABILITY_UNSPECIFIED`, `AVAILABILITY_BUSY`, `AVAILABILITY_FREE`. `visibility`:
`default`, `public`, `private`. `respond_to_event.responseStatus`: `declined`, `tentative`,
`accepted` — `needsAction` is deliberately absent.

**`Event`** carries `id`, `summary`, `description`, `location`, `start`, `end`,
`originalStartTime`, `status`, `eventType`, `recurrence`, `recurringEventId`, `attendees`,
`organizer`, `creator`, `attachments`, `conferenceUrl`, `guestPermissions`,
`overrideReminders`, `availability`, `visibility`, `transparency` (deprecated), `colorId`,
`workingLocationProperties`, `htmlLink`, `created`, `updated`. `start`/`end` are
`{ date, dateTime, timeZone }` with exactly one of `date` or `dateTime` set; `date` is a
midnight-UTC timestamp and `dateTime` carries its offset. REST fields
such as `kind`, `etag`, `iCalUID`, `sequence`, `hangoutLink` and `extendedProperties` are
absent.

**Behavioural divergences from REST that the implementation must reproduce**, because the
tool surface is the contract:

- `delete_event` returns the full `Event`, while `events.delete` returns an empty body. The
  implementation reads before deleting.
- `respond_to_event` has no REST method. It is a targeted `events.patch` with
  `attendeesOmitted=true` and a single attendee entry for the current user carrying
  `responseStatus` and `comment`.
- `update_event` takes explicit `added*` / `removed*` deltas, where `events.patch`
  overwrites arrays wholesale; the implementation does a read-modify-write.
- `update_event` preserves duration when only `startTime` is given.
- `suggest_time` inverts `freebusy.query`'s busy intervals into free slots and applies
  `durationMinutes` and `preferences`, none of which exist in REST.
- `search_events` is **literal** search over the primary calendar via `events.list?q=`, not
  the semantic search the reference server advertises. No semantic index exists, and
  omitting the tool would break the mirrored surface. Its description says it matches text,
  not meaning. It takes no `calendarId` and no time bounds, as in the reference.
- `list_events` hides `WORKING_LOCATION` and `BIRTHDAY` unless asked for, and defaults the
  window to now → now + 7 days.

### 12.2 Resources

`resources/list` enumerates one Resource per Calendar per `active` Account — nothing else.
No event resources, no per-calendar views. `resources/templates/list` returns `[]`; the
`resources` capability is advertised as `{}`.

URI: `calendar://<account>/calendars/<pct-encoded-id>`. The Account slug is the authority;
the Provider id is one path segment, percent-encoded against everything outside RFC 3986
unreserved — calendar ids legally contain `#` and `@`. Decode exactly once before calling
the Provider; reject a decoded `/`. No `primary` alias: always the concrete id
`calendarList.list` returns.

`resources/read` returns exactly one `text` content item, `mimeType: application/json`:

```json
{ "account": "…", "calendar": { … }, "window": { "start": "…", "end": "…" },
  "events": [ … ], "truncated": false }
```

Metadata from `calendarList.get`; events from `events.list` with `timeMin=now`,
`timeMax=now+7d`, `singleEvents=true`, `orderBy=startTime`, `maxResults=50`. Event objects
keep Google's shape (ISO 8601 `dateTime` with offset). The difference from `list_events`: a fixed
window and a metadata+events composite, where the tool is parameterized and returns one
collection.

Unknown or deleted calendar → `-32602` with `data.uri`, never `contents: []`. Credential
failure on that Account → `-32603` naming the Account, never a fabricated empty snapshot.
No `blob`, no HTML or Markdown rendering.

### 12.3 Prompts

Four static prompts; no Provider calls at `prompts/get`; instructions only.

| Name | Arguments |
| --- | --- |
| `plan_day` | `date?`, `account?` |
| `find_meeting_time` | `attendees` (required), `durationMinutes?`, `windowStart?`, `windowEnd?`, `account?` |
| `summarize_week` | `weekOf?`, `account?` |
| `triage_invites` | `account?` |

`account` resolves to the Default Account when omitted — explicit, never inferred from "the
only active Account". With no default configured, `prompts/get` returns `-32602` telling the
caller to pass `account` or set a default. Because no Credentials are touched,
`prompts/list` and `prompts/get` are `cacheScope: "public"`.

---

## 13. The `notes` MCP

Provider: Microsoft Graph (OneNote). Read-write, resources, no prompts. Ten tools plus
`list_accounts`. Graph publishes no MCP server to mirror, so shapes stay Graph-native.

**Common rules**

- Every tool takes an optional `account` slug.
- Graph-native camelCase field names, dates as the ISO 8601 strings Graph sends.
- All four list tools use the cursor from §11.2 with page size 100.

### 13.1 Tools

| Tool | Graph call | readOnly | destructive | idempotent |
| --- | --- | --- | --- | --- |
| `list_notebooks` | `GET /me/onenote/notebooks` | ✓ | ✗ | ✓ |
| `list_sections` | `GET /me/onenote/sections` \| `/notebooks/{id}/sections` \| `/sectionGroups/{id}/sections` | ✓ | ✗ | ✓ |
| `list_pages` | `GET /me/onenote/pages` \| `/sections/{id}/pages` | ✓ | ✗ | ✓ |
| `get_page` | `GET /me/onenote/pages/{id}` + `/content` | ✓ | ✗ | ✓ |
| `search_pages` | pages list, filtered in the gateway | ✓ | ✗ | ✓ |
| `create_page` | `POST /me/onenote/sections/{id}/pages` | ✗ | ✗ | ✗ |
| `update_page` | `PATCH /me/onenote/pages/{id}/content` | ✗ | ✗ | ✗ |
| `delete_page` | `DELETE /me/onenote/pages/{id}` | ✗ | ✓ | ✓ |
| `create_section` | `POST /me/onenote/notebooks/{id}/sections` \| `/sectionGroups/{id}/sections` | ✗ | ✗ | ✗ |
| `create_notebook` | `POST /me/onenote/notebooks` | ✗ | ✗ | ✗ |

```
list_notebooks({ account?, cursor? })                       -> { notebooks: Notebook[], nextCursor? }
list_sections({ account?, notebookId?, sectionGroupId?, cursor? }) -> { sections: Section[], nextCursor? }
list_pages({ account?, sectionId?, cursor? })               -> { pages: Page[], nextCursor? }
get_page({ account?, pageId, includeIds? = false })         -> PageContent
search_pages({ account?, query, sectionId?, cursor? })      -> { pages: Page[], nextCursor? }
create_page({ account?, sectionId, title, content })        -> Page
update_page({ account?, pageId, commands })                 -> { pageId, updated: true }
delete_page({ account?, pageId })                           -> { pageId, deleted: true }
create_section({ account?, displayName, notebookId?, sectionGroupId? }) -> Section
create_notebook({ account?, displayName })                  -> Notebook
```

- `list_sections` and `create_section` require **exactly one** parent: `notebookId` or
  `sectionGroupId`. Neither or both → `-32602`.
- `list_sections` with `notebookId` returns only sections directly in that notebook; with
  neither parent it returns every section, nested ones included. (Drift recorded during
  build: for `list_sections` a zero-parent call is valid and means "all", as the endpoint
  table and this bullet require; passing both parents is refused. `create_section` still
  requires exactly one.)
- `list_pages` with no `sectionId` returns pages across all notebooks.
- `search_pages.query` is a non-empty string; matching is case-insensitive substring on the
  page **title only**. Graph has no `$search` and no content-search endpoint.
- `create_page.content` is a body HTML fragment, wrapped by the gateway as
  `<!DOCTYPE html><html><head><title>{escaped title}</title></head><body>{content}</body></html>`
  and sent as `Content-Type: text/html; charset=utf-8`. A wrapped document over Graph's
  4 MB limit → `-32602` with `data.maxBytes: 4194304`.
- `update_page.commands` is a non-empty array of Graph `patchContentCommand` objects:
  `{ target, action: "replace"|"append"|"prepend"|"insert"|"delete", content?, position? }`.
  `content` is required for every action except `delete`; `position` is accepted only with
  `append` and `insert`; `target` is `#<data-id>`, `body`, or `title`.

**Return shapes.**

```
Notebook { id, displayName, isDefault, createdDateTime, lastModifiedDateTime,
           links: { oneNoteWebUrl, oneNoteClientUrl } }

Section  { id, displayName, createdDateTime, lastModifiedDateTime,
           links: { oneNoteWebUrl, oneNoteClientUrl },
           parentNotebook: { id, displayName }, parentSectionGroup?: { id, displayName } }

Page     { id, title, createdDateTime, lastModifiedDateTime,
           links: { oneNoteWebUrl, oneNoteClientUrl },
           parentSection: { id, displayName } }

PageContent extends Page { content, contentLength, truncated }
```

List results carry no `content`; only `get_page` does. `self`, `createdByAppId`,
`userRole`, `sectionsUrl`, `sectionGroupsUrl`, `pagesUrl`, `level`, `order` and `contentUrl`
are dropped. `parentSectionGroup` is populated by `$expand=parentSectionGroup`; the write
tools normalise their responses to the same shape with a follow-up `GET` when Graph omits a
parent.

**Page content.** HTML only, verbatim from `/content` — Graph's wrapper divs, inline
styles, and with `includeIds=true` the generated `id` / `data-id` attributes. No text
extraction, no Markdown, no sanitising. `content` is capped at **100 000 characters**, cut
at the last complete tag boundary at or before the cap; `contentLength` is the full length
and `truncated` says whether the cap was hit. Embedded images and files appear as Graph
resource URLs under `/me/onenote/resources/{id}/$value` that require the bearer token; the
gateway returns the HTML as-is and does not proxy them.

**Update semantics.** The command array is forwarded unchanged; Graph answers `204` and the
tool returns `{ pageId, updated: true }`. There is **no whole-page replace**: `body` supports
`append` only, and `replace` needs a generated element id (except `target: "title"`).
Rewriting a page means `delete_page` then `create_page`, with a new id and URL. Images in
`content` cannot be `www` links; v1 sends JSON only, so image replacement is out of reach.

**Errors.**

| Condition | Surface |
| --- | --- |
| Graph 404 (`20102`, `20112`, `20113`) | `isError`, naming the id and the Graph code |
| Graph 400 / 413 / 429 / 5xx | `isError`, pass-through `error.code` and `error.message` |
| Graph 401 / 403 | `isError`, pass-through; Account state untouched |
| Account unusable | `isError`, slug + admin URL |
| Bad arguments, cursor, parent params, size | `-32602` |

OneNote's error body is `{ error: { code, message, innerError } }` with a numeric-string
`code`; general Graph throttling uses a named code. Parsing is defensive.

### 13.2 Resources

`resources/list` enumerates one Resource per Notebook per `active` Account. `resources/read`
returns one `text` content item, `mimeType: application/json`:

```json
{ "account": "…", "notebook": { … }, "sections": [ … ], "sectionGroups": [ … ],
  "truncated": false }
```

From `GET /me/onenote/notebooks/{id}?$expand=sections,sectionGroups` — names and ids only,
no recursion into section groups, no Pages. The difference from tools: an outline, where a
tool would return a parameterized page listing. URI:
`notes://<account>/notebooks/<id>`.

Unknown or deleted notebook → `-32602` with `data.uri`. Credential failure → `-32603`
naming the Account.

### 13.3 Section groups and non-goals

Section groups are not navigable: there is no `list_section_groups` and nothing is addressed
by path. `list_sections` and `create_section` accept a `sectionGroupId` for targeting, and
section groups appear only in the `notes://` notebook outline. Nested sections are addressed
by their global section id.

Not in v1: delete for notebooks or sections (Graph exposes no endpoint); rename of
notebooks, sections or section groups; section-group creation; body-text search; whole-page
replace; image proxy.

---

## 14. Enumeration cache

KV caches container enumeration only — the `resources/list` payload — keyed
`v1:enum:<mcp>:<account>:<epoch>`, value `{ resources, fetchedAt, truncated }`.
Fixed-length keys avoid KV's 512-byte key limit.

`<epoch>` is `accounts.cache_epoch`, read from D1 on every enumeration, so a bump is
globally visible immediately, unlike a KV delete. It is bumped on Account add, revoke or
state change, and on `create_notebook`; **not** on event, page or section writes — none of
those change the container list the cache holds.

TTL 300 s. Write-through with `ctx.waitUntil`; a failed `put` is logged and ignored; no
single-flight. Reads are never KV-cached. No HTTP `Cache-Control` / `ETag`.

**A sick Account.** `resources/list` skips Accounts that are not `active`, returns the
healthy Accounts' resources, and attaches a `_meta` warning listing the skipped slugs, with
`ttlMs: 0`. If no Account is active it returns an empty list plus the same warning — not a
JSON-RPC error. Partial results are never written to KV. `list_accounts` is where Account
health is reported.

---

## 15. Admin UI

Server-rendered JSX through Hono. No client-side JavaScript anywhere.

| Route | Purpose |
| --- | --- |
| `GET /` | `302` to `/admin` |
| `GET /admin` | MCP list: slug, endpoint, Provider, Accounts per state, default Account |
| `GET /admin/mcps/:mcp` | Accounts table and actions |
| `POST /admin/mcps/:mcp/accounts` | Start the add flow with a typed slug |
| `POST /admin/mcps/:mcp/accounts/:slug/reauth` | Start reauth |
| `POST /admin/mcps/:mcp/accounts/:slug/revoke` | Revoke, after a confirmation page |
| `POST /admin/mcps/:mcp/accounts/:slug/default` | Set the Default Account |
| `GET /admin/mcps/:mcp/test` | Test-a-tool form |
| `POST /admin/mcps/:mcp/test` | Run one tool in-process |
| `GET /admin/app.css` | Built stylesheet |

Accounts table columns: slug, email, display name, state, default flag, scopes,
access-token expiry, last refreshed, last error code. Revoke is the only removal.

**Not in v1:** hard delete, slug rename, scope editing, raw token reveal, audit log, metrics
or charts, search or pagination, multi-user roles, editing Provider client credentials, an
MCP schema browser, dark mode, Account import/export.

**Mutations.** Every mutation is a `POST` returning `303` back to the page
(POST-redirect-GET). CSRF: `Origin` / `Sec-Fetch-Site` must match the hostname, plus a
double-submit token — an `admin_csrf` cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, 32 random
bytes) whose value must equal the hidden form field. Revoke goes through a confirmation
page; no `confirm()`.

**Test-a-tool panel.** A tool picker from the in-code registry, an `account` selector
defaulting to the Default Account, a JSON args textarea, and a `POST` that runs the tool
**in-process** through an in-memory MCP client session against the same server factory — no
self-`fetch`, so no service token is stored in the Worker. It renders the result including
`isError`, plus duration. No history, no persistence. Write tools are callable and labelled as
writes.

**Redaction.** Shown: email, display name, slug, state, default flag, scopes, expiry and
refresh timestamps, `last_error` as a code. Never rendered: access or refresh token
ciphertext or plaintext, Provider client secrets, `provider_subject`, `TOKEN_ENCRYPTION_KEY`,
any JWT, `oauth_states` contents, raw Provider response bodies.

**Errors.** A code plus one plain sentence. Detail goes to `console.error` with tokens and
emails redacted. `500` pages carry no stack trace.

**Tailwind.** Tailwind v4 with `tailwindcss` + `@tailwindcss/cli`. `src/admin/app.css` holds
`@import "tailwindcss";` plus `@source` globs over the TS templates. Built with
`tailwindcss -i packages/web/src/admin/app.css -o packages/web/src/admin/app.generated.css --minify`
before dev and deploy; the generated file is gitignored. Served as a Wrangler **Text module**
from `GET /admin/app.css` with `Cache-Control: private, max-age=3600` and an ETag derived
from the build hash. No Static Assets, no PostCSS, no Vite.

---

## 16. Testing

| Package | Pool | Covers |
| --- | --- | --- |
| `packages/web` | `@cloudflare/vitest-pool-workers` | routes, the full OAuth flow, Account lifecycle, refresh locking, Access verification, MCP conformance through the official client SDK |
| `packages/calendar` | plain Node | tool handlers, response mapping, schema shapes |
| `packages/notes` | plain Node | tool handlers, response mapping, schema shapes |

Providers are faked **below** the SDK, at the HTTP base URL — Google via
`GoogleCalendarClient`'s `rootUrl`, Graph via `GraphClient`'s `baseUrl` — not by stubbing
SDK methods. Live smoke tests run only when `LIVE=1`, never in CI.

Contract tests also pin the package boundary: each package's `McpContext` must be
structurally identical to the Worker's, and `tools/list` order must match the top-level
declaration order in `tools/index.ts`.

The MCP layer is tested against the conformance probes: `server/discover` shape,
`_meta` and header validation, `405` on `GET`/`DELETE`, `-32602` for unknown
tool/prompt/resource, `isError` for tool failures, `listChanged` absent, deterministic
`tools/list` ordering.

---

## 17. Scripts, lint and CI

Root scripts: `dev`, `build`, `test`, `typecheck`, `lint`, `format`, `db:generate`,
`db:migrate:local`, `db:migrate:remote`.

- `typecheck`: `tsc -b` over project references.
- `lint`: `oxlint`. `format`: `oxfmt`. No ESLint, no Prettier.
- `predev` / `predeploy`: the Tailwind build.
- CI on every push and PR: `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test`.
- Deploy is `workflow_dispatch` only. No push-to-deploy in v1.

---

## 18. Deploy prerequisites

Provider-side work that must happen before the gateway can be used in production. None of
it is gateway logic.

1. **Custom domain.** Pick `gateway.<zone>`; set the route, `workers_dev: false`,
   `preview_urls: false`.
2. **Access applications.** Create `mcp-gateway-admin` (One-time PIN, include the operator's
   email) over `/`, `/admin*`, `/oauth/*`; create `mcp-gateway-clients` (Service Auth, one
   token, strict mode) over `/mcps/*`. Record both AUDs and the team domain as secrets.
3. **Redirect URIs.** Register `https://<host>/oauth/callback/google` and
   `https://<host>/oauth/callback/microsoft` in both consoles. The local
   `http://localhost:8787/oauth/callback/<provider>` URIs stay for `wrangler dev`.
4. **Google consent screen.** Add `<host>` as an authorized domain on the Branding page,
   then **publish** the app. While it sits in *Testing*, Google refresh tokens expire after
   seven days; that surfaces as `invalid_grant` → `needs_reauth` → admin reauth.
5. **Secrets.** `wrangler secret put` for every secret in §5 — the four Provider
   credentials, the two keys, and the three Access values.
6. **Migrations.** `pnpm db:migrate:remote`.

---

## 19. Milestones

**M0 — Skeleton.** Workspace, `wrangler.jsonc`, D1 and KV bindings, Hono app, Access
verification with the dev bypass, Drizzle schema and first migration, oxlint/oxfmt/tsc, CI.
*Exit:* `typecheck`, `lint` and `test` green; `/admin` renders behind the dev bypass.

**M1 — Accounts.** Add, reauth, revoke, set default. Encryption, single-flight refresh,
scope enforcement, `list_accounts`. Admin pages for the Accounts table and actions.
*Exit:* an Account can be added, refreshed past expiry, demoted to `needs_reauth` and
restored; refresh races are covered by tests.

**M2 — `calendar`.** Google client seam (`window` shim, `request()` auth adapter), nine
tools, resources, prompts, cursor pagination, enumeration cache.
*Exit:* the MCP conformance probes pass on `/mcps/calendar`, and each tool is exercised
against a faked `rootUrl`.

**M3 — `notes`.** Graph client (`GraphRequestAdapter` + `msgraph-sdk-users`), ten tools,
resources, cursor pagination including `search_pages`' extra cursor state.
*Exit:* conformance probes pass on `/mcps/notes`, and every tool is exercised against a
faked `adapter.baseUrl`.

**M4 — Hardening.** Test-a-tool panel, redaction audit, error-surface review, Access
production configuration, runbook.
*Exit:* no token, secret or `provider_subject` can be rendered by any admin page.

**M5 — Deploy.** Custom domain, redirect URIs, Google publish, remote migrations, live
smoke.
*Exit:* both MCPs answer a real client through Access, with a real Account each.

---

## 20. Open decisions

These are in scope and not yet settled; each is a ticket on the wayfinder map (issue #1)
rather than a decision here. The spec above is buildable without them, but not final.

- [#13](https://github.com/ToufiqSenpai/mcp-gateway/issues/13) — destructive tool
  confirmation and dry-run affordances beyond the `destructiveHint` annotation.
- [#14](https://github.com/ToufiqSenpai/mcp-gateway/issues/14) — whether the gateway
  proxies Graph-authenticated `/resources/{id}/$value` URLs so `notes` page media is
  viewable.
- [#15](https://github.com/ToufiqSenpai/mcp-gateway/issues/15) — rate limits, quota
  handling, retry and backoff per Provider.
- [#16](https://github.com/ToufiqSenpai/mcp-gateway/issues/16) — observability: log shape
  and token/PII redaction.
- [#17](https://github.com/ToufiqSenpai/mcp-gateway/issues/17) — encryption key rotation
  for stored Credentials.
