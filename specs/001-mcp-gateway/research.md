# Phase 0 Research: MCP Gateway

All technical unknowns were resolved before this plan by `docs/SPEC.md` and ADR-0001…0006. This file records each decision with its rationale and the alternatives that were rejected, so tasks can be traced to a reason. No `NEEDS CLARIFICATION` remains.

## R1 — MCP server library and protocol version

- **Decision**: `@modelcontextprotocol/server@2.4.0` with `createMcpHandler(factory, { legacy: 'reject', responseMode: 'json' })`, targeting protocol `2026-07-28`.
- **Rationale**: the v1 line (`@modelcontextprotocol/sdk@1.32.2`) stops at `2025-11-25` and the v2 handler is per-request by design, which matches the stateless requirement. Protocol validation (`_meta`, `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, `server/discover`, the `-3202x` ladder) stays in the SDK.
- **Alternatives considered**: v1 SDK (no `2026-07-28`); hand-rolled JSON-RPC (violates Principle V).

## R2 — No session state

- **Decision**: one server instance per request; no Durable Object, no KV session, no `Mcp-Session-Id`, no `listChanged`, no `resources/subscribe`, no MRTR.
- **Rationale**: single client class over one user's data; nothing worth keeping between requests, and a DO would add placement/billing/migration cost for a signal `ttlMs` already covers (ADR-0001).
- **Alternatives considered**: DO per endpoint with listener fan-out — makes `listChanged` honest, rejected as unnecessary surface.

## R3 — Gateway authentication

- **Decision**: two Cloudflare Access applications (human OTP for `/`, `/admin*`, `/oauth/*`; service token, strict mode, for `/mcps/*`). The Worker verifies `Cf-Access-Jwt-Assertion` itself against the team JWKS, checks `iss` and the path's `aud`, then classifies service (`sub` empty + `common_name`) vs human (`email` + UUID `sub`) and enforces the pairing.
- **Rationale**: self-issued bearer tokens would mean owning issuance, storage and rotation for one user; header-presence trust would expose the path if an Access application went missing (ADR-0002).
- **Alternatives considered**: self-issued OAuth tokens (portable, too much to own); trusting the edge only (fails Principle I).

## R4 — OAuth lifecycle owner

- **Decision**: `arctic@3.7` performs authorize, code exchange and refresh for both Providers; vendor SDKs only make API calls with an externally supplied access token.
- **Rationale**: `@azure/identity` keeps the refresh token in a memory cache `getToken()` never exposes and an isolate cannot outlive; `google-auth-library` overwrites a rotated refresh token with the stale one, silently destroying the Credential (ADR-0005).
- **Consequences to implement**: patch Google's authorize URL with `access_type=offline` and `prompt=consent`; include `offline_access` in Microsoft's scope list; `globalThis.window = globalThis` before loading gaxios; a `request(opts)` auth adapter instead of a string `auth`.

## R5 — Provider SDKs and their seams

- **Decision**: `@googleapis/calendar` with a `rootUrl` seam; Microsoft Graph through `@microsoft/msgraph-sdk` + `-users` with `adapter.baseUrl` as the seam.
- **Rationale**: typed request building and Provider pagination come for free; the seams let tests fake HTTP below the SDK instead of stubbing SDK methods. Graph requires implementing `AuthenticationProvider` over `McpContext`, importing `@microsoft/msgraph-sdk-users` to register `me.onenote`, and one kiota preview number for the whole resolution (`pnpm-workspace.yaml` overrides) or the bundle fails with `No matching export … registerDefaultDeserializer`.
- **Alternatives considered**: plain `fetch` for both — saves ~860 KiB gzip, loses typed calls and pagination models. Fallback only for Google if its SDK breaks; Graph stays on its SDK.

## R6 — Account selection

- **Decision**: explicit `account` slug, otherwise the MCP's Default Account; at most one default (partial unique index); first Account to become usable becomes the default; no fallback, no inference; unusable selection is an `isError` tool result (or `-32602` for prompts) naming slug + admin URL.
- **Rationale**: silently writing to another identity is worse than a readable error (ADR-0004).
- **Alternatives considered**: "the only active Account" fallback and request-time default inference — both rejected.

## R7 — One Provider per MCP

- **Decision**: `mcp` and `provider` are paired `CHECK` enums; `(mcp, provider, provider_subject)` unique; Accounts never cross MCPs.
- **Rationale**: the tool surface is the security boundary and must not reach a Credential it never asked for; scope sets stay minimal (ADR-0003).
- **Alternatives considered**: one shared Provider identity across MCPs — rejected for scope union and shared revocation blast radius.

## R8 — Credential storage

- **Decision**: AES-GCM under `TOKEN_ENCRYPTION_KEY` (base64, exactly 32 bytes), 12-byte random IV, envelope `v1.<iv>.<ct>` base64url, AAD `<account_id>:<field>`; missing/malformed key fails closed with a generic 500; only `access_token` and `refresh_token` are encrypted.
- **Rationale**: a replayed ciphertext must be useless in another row or column; no plaintext fallback, no runtime key (Principle III).
- **Alternatives considered**: KV secrets or per-row random keys — no benefit for one user and more moving parts.

## R9 — Refresh concurrency

- **Decision**: single-writer lease on the Account row (`refresh_lock_until = now+30`, `refresh_lock_token = uuid`), claim via conditional `UPDATE`, waiters poll ~2 s in 250 ms steps, persist conditioned on the lock token; reauth takes the same lock.
- **Rationale**: AES-GCM output is non-deterministic, so CAS must be on the lock token, not the ciphertext; a 30 s lease survives a Worker dying mid-refresh. A reauth must never overwrite a token mid-rotation.
- **Alternatives considered**: DO-based mutex (banned by Principle IV); optimistic retry without a lock (duplicate refreshes, rotated-token loss).

## R10 — Scope enforcement

- **Decision**: one Required scope set constant per MCP, used by authorize URL, callback check and call-time check; `scope` from the token response is the Granted set; missing/narrowed scopes are refused without writing; post-hoc loss demotes to `needs_reauth` with `last_error = 'missing_scope'`.
- **Rationale**: no per-tool mapping exists for either Provider; a per-tool table would be invented (Principle V).
- **Alternatives considered**: per-tool gating — rejected; authorize-only scopes — rejected to keep one constant.

## R11 — Cursor pagination

- **Decision**: MCP cursors only; opaque base64url `{o, h}` JSON signed with HMAC-SHA256 under `CURSOR_SIGNING_KEY`, no expiry; bound to the usable-Account set; missing cursor = end, `""` = first page; Provider fetches complete per Account then slice locally (cap 1000, `truncated` + `_meta` warning).
- **Rationale**: Provider tokens (`nextPageToken`, `@odata.nextLink`) must not leak; a signature plus Account-set binding stops stale or forged pages (Principle V, FR-041).
- **Alternatives considered**: unsigned cursors (forgeable), Provider tokens (unstable across Accounts), offset cursors (break under concurrent writes).

## R12 — Enumeration cache

- **Decision**: KV `v1:enum:<mcp>:<account>:<epoch>` holding `{ resources, fetchedAt, truncated }`, TTL 300 s, write-through with `ctx.waitUntil`, epoch read from D1 on every enumeration and bumped on Account add/revoke/state change and on `create_notebook`; partial results never cached; no reads from HTTP cache headers.
- **Rationale**: a fixed-length key fits KV's 512-byte limit; the epoch gives immediate global invalidation without a KV delete; container writes that don't change the container list must not bump it (§14).
- **Alternatives considered**: KV delete on change (race-prone), DO cache (banned).

## R13 — Admin surface

- **Decision**: server-rendered JSX via Hono, no client script; every mutation is `POST` + `303`; CSRF via `Origin`/`Sec-Fetch-Site` plus a double-submit `admin_csrf` cookie; revoke behind a confirmation page; test-a-tool runs in-process through an in-memory MCP client session against the same server factory.
- **Rationale**: no service token is stored in the Worker for self-`fetch`, and no client bundle is needed for one operator (Principle III, §15).
- **Alternatives considered**: SPA (unnecessary build and auth surface); server `fetch` to own MCP endpoint (needs a service token in the Worker).

## R14 — Styling delivery

- **Decision**: Tailwind v4 CLI builds `src/admin/app.css` (with `@source` globs) to a gitignored `app.generated.css`, served as a Wrangler Text module at `GET /admin/app.css` with `Cache-Control: private, max-age=3600` and a build-hash ETag.
- **Rationale**: no Static Assets, no PostCSS, no Vite; one deployable.
- **Alternatives considered**: Workers Static Assets (extra config for one file); inline critical CSS (unmaintainable).

## R15 — Testing strategy

- **Decision**: `packages/web` in the workerd pool with `applyD1Migrations` over the same generated migrations; MCP packages in plain Node; Providers faked at the HTTP base URL; conformance probes through the official client SDK; live smoke only with `LIVE=1`.
- **Test runner pin**: one vitest version across the workspace, currently `^4.1`. `@cloudflare/vitest-pool-workers@0.23.0` (still the latest on 2026-11-04) declares peers `vitest`, `@vitest/runner` and `@vitest/snapshot` all at `^4.1.0`, so vitest 5 cannot be adopted yet. Upgrade the whole workspace in one change when the pool declares `^5`; do not split majors across packages or override the peer range.
- **Rationale**: no parallel test schema; the MCP packages stay database-free and fast (Principle IV, Development Workflow); a single runner version keeps one lockfile resolution and one config shape.
- **Alternatives considered**: stubbing SDK methods (hides the wire shape); a separate test schema (drifts); vitest 5 only in the Node packages (two majors, two configs, root `test` script ambiguous); vitest 5 everywhere with a peer override or a hand-rolled Miniflare harness (unsupported and more wiring than the workerd pool it replaces).

## R16 — Deploy and CI

- **Decision**: one Worker, one custom hostname, `workers_dev: false`, `preview_urls: false`; CI runs `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test`; deploy is `workflow_dispatch` only.
- **Rationale**: Access cannot protect `*.workers.dev`; a single-user gateway does not need push-to-deploy (Principle I, Development Workflow).
- **Alternatives considered**: preview deployments per PR — Access cannot cover them.

## Open items carried forward

`docs/SPEC.md` §20 lists five items that are in scope but undecided (destructive-tool confirmation, media proxy, rate limits/backoff, observability redaction, key rotation). They are **not** researched or decided here; they stay tickets and must not be implemented speculatively (Principle V).
