# Tasks: MCP Gateway

**Input**: Design documents from `/specs/001-mcp-gateway/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included for every security, credential, refresh, scope, cursor and contract path — the constitution's "Tests accompany risk" rule makes them mandatory here even though the task template treats tests as optional.

**Organization**: Tasks are grouped by user story. Each story is an independently testable increment; the P1 story alone is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: `US1`…`US6`, matching [spec.md](./spec.md)
- Every task names the exact file it creates or changes.

## Path Conventions

pnpm workspace, one deployable and two libraries ([plan.md](./plan.md)):

- `packages/web/` — Worker, routes, D1, KV, auth, accounts, views, tests
- `packages/calendar/` — `calendar` MCP library
- `packages/notes/` — `notes` MCP library

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Workspace, toolchain and deploy configuration. No behaviour yet.

- [X] T001 Create the pnpm workspace skeleton: `pnpm-workspace.yaml`, root `package.json` with scripts `dev`, `build`, `test`, `typecheck`, `lint`, `format`, `db:generate`, `db:migrate:local`, `db:migrate:remote`, and `packages/{web,calendar,notes}/package.json`
- [X] T002 [P] Add `tsconfig.base.json` (`strict`, `noEmit`, project references) plus `packages/*/tsconfig.json` wired to the root `tsc -b` build
- [X] T003 [P] Configure `oxlint.json` and `.oxfmtrc.json`, and add `.gitignore` entries for `node_modules`, `.env`, `.wrangler`, and `packages/web/src/admin/app.generated.css`
- [X] T004 [P] Add `tailwindcss` and `@tailwindcss/cli`; write `packages/web/src/admin/app.css` with `@import "tailwindcss";` and `@source` globs over the view templates; wire `predev`/`predeploy` to build `packages/web/src/admin/app.generated.css`
- [X] T005 Create `wrangler.jsonc` per [plan.md](./plan.md) and `docs/SPEC.md` §5: `main` = `packages/web/src/index.ts`, `compatibility_date` `2026-11-01`, `workers_dev: false`, `preview_urls: false`, D1 binding `DB`, KV binding `CACHE`, `Text` rule for `**/*.css`, no `nodejs_compat`, no `env` blocks
- [X] T006 [P] Add `.env.example` with every variable from `docs/SPEC.md` §5 (empty values) and confirm `.env` stays ignored
- [X] T007 [P] Add `drizzle.config.ts` pointing at `packages/web/src/db/schema.ts` and `packages/web/migrations`
- [X] T008 [P] Add `packages/web/vitest.config.ts` using `@cloudflare/vitest-pool-workers` 0.23 with `applyD1Migrations` (D1 binding `DB`), and plain-Node configs in `packages/calendar/vitest.config.ts` and `packages/notes/vitest.config.ts` — all on vitest `^4.1` (pinned; see [research.md](./research.md) R15)
- [X] T009 [P] Create the CI workflow running `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test` on push and PR, and a separate `workflow_dispatch`-only deploy job
- [X] T010 [P] Add dependency `@modelcontextprotocol/server@2.4.0` and `zod@4.6` to `packages/web/package.json`; document in `packages/web/src/mcps/registry.ts` that every MCP is a library (no separate Worker)

**Checkpoint**: `pnpm typecheck`, `pnpm lint` and the empty `pnpm test` run green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, encryption, perimeter authentication, registry and request plumbing. Completing this phase lets every story start; **no story work may begin before it**.

- [X] T011 Create the Drizzle schema for `accounts` in `packages/web/src/db/schema.ts` exactly as [data-model.md](./data-model.md): `slug` matches `^[a-z0-9][a-z0-9-]{0,31}$`; `state` is `active|needs_reauth|revoked`; `mcp` is `calendar|notes`; `CHECK ((mcp = 'calendar' AND provider = 'google') OR (mcp = 'notes' AND provider = 'microsoft'))`; `UNIQUE (mcp, slug)`; `UNIQUE (mcp, provider, provider_subject)`; `UNIQUE (mcp) WHERE is_default = 1`; `cache_epoch` default 0; nullable `refresh_lock_until`, `refresh_lock_token`, `last_error`, `revoked_at`
- [X] T012 Create the Drizzle schema for `oauth_states` in `packages/web/src/db/schema.ts`: `state` PK, `mcp`, `provider`, `slug`, `code_verifier`, nullable `target_account_id` FK, `created_at`, `expires_at` (= `created_at + 600`); no `token_type` column anywhere
- [X] T013 [P] Generate and commit the first migration in `packages/web/migrations/`; add a test in `packages/web/test/db/migrations.test.ts` asserting both unique indexes and both `CHECK` constraints reject the cases in [data-model.md](./data-model.md)
- [X] T014 [P] Implement the D1 client in `packages/web/src/db/client.ts` and typed query helpers in `packages/web/src/db/queries.ts` (find by slug, find by identity, list by MCP, claim/release refresh lock, bump `cache_epoch`)
- [X] T015 Implement AES-GCM encryption in `packages/web/src/auth/crypto.ts`: base64 key of exactly 32 bytes validated once per isolate, 12-byte random IV, envelope `v1.<iv>.<ct>` base64url, AAD `"<account_id>:<field>"` for `access_token`/`refresh_token`, generic `500` on missing/malformed key, no plaintext fallback; test tampered ciphertext, wrong row and wrong column in `packages/web/test/unit/crypto.test.ts`
- [X] T016 Implement Access JWT verification in `packages/web/src/auth/access.ts`: RS256 against `https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs` (JWKS cached per isolate), `iss` = team domain, `aud` = `CF_ACCESS_ADMIN_AUD` for `/`, `/admin*`, `/oauth/*` and `CF_ACCESS_MCP_AUD` for `/mcps/*`; classify `sub === ""` + `common_name` as service, `email` + UUID `sub` as human; mismatch is `403` with no detail
- [X] T017 Add the development bypass to `packages/web/src/auth/access.ts`: active only when `ENVIRONMENT=development` and the host is localhost; inject a fake human identity; test in `packages/web/test/unit/access-production.test.ts` that the bypass is unreachable when `ENVIRONMENT=production`
- [X] T018 [P] Build the Hono entry in `packages/web/src/index.ts`: mount `/mcps/:slug`, `/admin*`, `/oauth/*`, `/admin/app.css`, redirect `/` → `/admin`, `404` elsewhere, `405` for non-POST on MCP paths, generic error handler with no stack traces
- [X] T019 [P] Implement the registry in `packages/web/src/mcps/registry.ts` as the only slug→factory map, and a test in `packages/web/test/contract/registry.test.ts` asserting its keys equal the `mcp` CHECK enum values
- [X] T020 [P] Define `McpContext` (`listAccounts()`, `getAccessToken(slug)`) in `packages/web/src/mcps/context.ts`; every MCP package may import only this type, never D1, `arctic` or `auth/crypto.ts`
- [X] T021 Create shared cookie and CSRF helpers in `packages/web/src/auth/cookies.ts`: `HttpOnly`, `Secure`, `SameSite=Lax`; 32-byte random `admin_csrf`; `Origin`/`Sec-Fetch-Site` check
- [X] T022 [P] Create the server-rendered layout in `packages/web/src/views/layout.tsx` with the dev-bypass banner and `GET /admin/app.css` serving the Text module with `Cache-Control: private, max-age=3600` and a build-hash `ETag`
- [X] T023 [P] Create the Vitest fake-Provider harness in `packages/web/test/support/providers.ts` (Google via `calendar({ rootUrl })`, Graph via `adapter.baseUrl`), plus `packages/calendar/test/support/` and `packages/notes/test/support/` equivalents; no SDK method stubbing

**Checkpoint**: migrations apply in tests, crypto and Access verification tests pass, `/admin` renders behind the bypass, `405`/`404` behave.

---

## Phase 3: User Story 1 — Authorize one Provider identity and use the `calendar` MCP (Priority: P1) — MVP

**Goal**: The operator adds one Google Account through the browser and an MCP client can list calendars and create an event with it.

**Independent Test**: From a fresh deployment, add `personal`, then call `list_calendars` and `create_event` from a client with the service credential; the event exists in that Google identity's calendar. Without the service credential, both calls are refused.

### Tests for User Story 1

- [X] T024 [P] [US1] Integration test for the full add-Account flow in `packages/web/test/integration/oauth-add.test.ts`: state row, flow cookie binding, single-use `DELETE … RETURNING`, `error` mapping, `no_refresh_token` refusal, duplicate identity with existing slug
- [X] T025 [P] [US1] Contract test for the nine calendar tool schemas in `packages/calendar/test/contract/tools.test.ts` against `contracts/mcp-calendar.md`, including ISO 8601 `dateTime` with offset, midnight-UTC `date`, `pageSize` max 250, deprecated `attendeeEmails`/`eventTypeFilter`, and absence of `useDefaultReminders`/`label`/`conferenceData`
- [X] T026 [P] [US1] Contract test for MCP conformance on `/mcps/calendar` in `packages/web/test/contract/mcp-calendar.test.ts`: `server/discover` shape, `_meta`/header validation, `GET`/`DELETE` → `405`, `-32602` for unknown tool, `resultType: "complete"`, deterministic `tools/list` over 20 runs

### Implementation for User Story 1

- [X] T027 [US1] Implement the OAuth provider configuration in `packages/web/src/auth/arctic.ts`; patch Google's authorize URL with `access_type=offline` and `prompt=consent` on every flow, and include `offline_access` in Microsoft's scope list
- [X] T028 [US1] Implement `GET/POST` start of flow in `packages/web/src/routes/oauth.ts` and `packages/web/src/accounts/lifecycle.ts`: write the `oauth_states` row (32-byte base64url `state`, `expires_at` = +10 min), set the 10-minute `oauth_flow` cookie, `302` to the Provider
- [X] T029 [US1] Implement `/oauth/callback/:provider` in `packages/web/src/routes/oauth.ts`: provider from the path only, `mcp`/`slug`/`target_account_id` from the state row, cookie === state, unexpired, single-use delete, exchange the code, fetch identity once (`/userinfo` on Google), reject `no_refresh_token`, reject duplicate `(mcp, provider, provider_subject)`, always `302` with `?added=` or `?error=` and never tokens/emails in the URL
- [X] T030 [US1] Persist a new Account in `packages/web/src/accounts/lifecycle.ts` with encrypted Credentials, the Granted scope set from the token response, `state = active`, and automatic default when the MCP has none; bump `cache_epoch`
- [X] T031 [P] [US1] Define the `calendar` Required scope set constant in `packages/calendar/src/index.ts`: `openid email profile https://www.googleapis.com/auth/calendar`
- [X] T032 [US1] Implement `getAccessToken(slug)` in `packages/web/src/mcps/context.ts`: load by `(mcp, slug)`, require `state = 'active'`, decrypt, throw a typed unusable-Account error naming the slug and admin URL
- [X] T033 [US1] Implement the Google client seam in `packages/calendar/src/client.ts`: `globalThis.window = globalThis` shim and a `request(opts)` auth adapter backed by `getAccessToken`
- [X] T034 [US1] Implement `list_accounts` in `packages/calendar/src/server.ts`: `{ accounts: [{ slug, isDefault }] }` for the mounted MCP only; empty array when none; never state, Credentials or subject
- [X] T035 [US1] Implement `list_events`, `get_event`, `list_calendars` and `search_events` in `packages/calendar/src/tools/` mapping to the document shapes, with `fullText` matching title/description/location/attendees case-insensitively as an AND search, and default event types excluding `WORKING_LOCATION` and `BIRTHDAY`
- [X] T036 [US1] Implement `create_event`, `update_event`, `delete_event` and `respond_to_event` in `packages/calendar/src/tools/`: `delete_event` reads before deleting and returns the full `Event`; `update_event` applies `added*`/`removed*` deltas and preserves duration when only `startTime` is given; `respond_to_event` patches a single self attendee with `attendeesOmitted=true`; `notificationLevel` defaults to `ALL`
- [X] T037 [US1] Implement `suggest_time` in `packages/calendar/src/tools/suggest-time.ts`: invert `freebusy.query` busy intervals into free slots, apply `durationMinutes` and `preferences` (`startHour`/`endHour` as `"HH:mm"`, `excludeWeekends`, `pageSize` default 5), and return `TimeSlot.start`/`end` as `DateOrDateTime` with the deprecated fields marked
- [X] T038 [US1] Wire `createServer(ctx)` and `createMcpHandler(factory, { legacy: 'reject', responseMode: 'json' })` in `packages/calendar/src/server.ts`, register it in `packages/web/src/mcps/registry.ts`, and map tool execution failures to `isError: true` results
- [X] T039 [US1] Enforce the perimeter pairing on `/mcps/calendar` in `packages/web/src/routes/mcps.ts`: service tokens only, unknown slug `404`, no `Mcp-Session-Id`, no HTTP caching headers
- [X] T040 [US1] Add result cache hints from `contracts/mcp-calendar.md` in `packages/calendar/src/server.ts`: discovery/tools/prompts/templates `3600000`/`public`, resource-derived `private`, `tools/call` uncacheable

**Checkpoint**: US1 fully works — one Account, nine tools, conformance probes green on `/mcps/calendar`.

---

## Phase 4: User Story 2 — Several Accounts per MCP, explicit selection, no fallback (Priority: P2)

**Goal**: Two usable Accounts, one default, explicit per-request selection, and a broken default that fails loudly instead of borrowing another Credential.

**Independent Test**: Add a second Account, set it as default, call a read tool without a slug and with an explicit slug — responses differ. Break the default: the unqualified call fails naming the slug and admin URL; the explicit call to the healthy Account still works.

### Tests for User Story 2

- [X] T041 [P] [US2] Integration test in `packages/web/test/integration/account-selection.test.ts`: default resolution, explicit slug, unknown slug lists available slugs, no fallback when the default is `needs_reauth`/`revoked`, exactly one default per MCP
- [X] T042 [P] [US2] Unit test in `packages/web/test/unit/cursor.test.ts`: signed `{o,h}` payload, `""` maps to first page, absent cursor ends the list, tampered signature and changed Account set both `-32602`

### Implementation for User Story 2

- [X] T043 [US2] Implement Account selection in `packages/web/src/accounts/lifecycle.ts`: explicit `account` slug otherwise the Default Account; `isError` result naming the slug and `/admin/mcps/<mcp>` when missing/`needs_reauth`/`revoked`; never fall back or infer
- [X] T044 [US2] Enforce the default invariant in `packages/web/src/db/queries.ts`: first Account to reach `active` becomes default when none exists; setting a default clears the previous one in the same transaction
- [X] T045 [P] [US2] Implement the signed cursor helper in `packages/web/src/mcps/pagination.ts`: base64url JSON `{o,h}`, HMAC-SHA256 under `CURSOR_SIGNING_KEY`, no expiry, bound to the usable-Account set, page size 100, per-Account fetch cap 1000 with `truncated: true` and a `_meta` warning
- [X] T046 [US2] Apply cursor pagination in `packages/calendar/src/tools/list-events.ts` and `list-calendars.ts`: Provider fetches complete per Account then slice locally; `nextPageToken` omitted when exhausted; Provider tokens never surface
- [X] T047 [US2] Add the optional `account` argument to every calendar tool and to `list_accounts`' caller resolution path in `packages/calendar/src/server.ts`
- [X] T048 [US2] Bump `cache_epoch` on Account add, revoke and state change in `packages/web/src/accounts/lifecycle.ts` so enumeration invalidates immediately

**Checkpoint**: US1 and US2 both work; multi-Account paging and stale-cursor rejection covered.

---

## Phase 5: User Story 3 — Second MCP against Microsoft (`notes`) (Priority: P3)

**Goal**: The same Account model and admin flow drive a OneNote MCP with ten tools and notebook resources.

**Independent Test**: Add a Microsoft Account to `notes`, then list notebooks, read a page, create a notebook and read a notebook resource from a client. A `calendar` slug is unknown on `notes`.

### Tests for User Story 3

- [X] T049 [P] [US3] Contract test for the ten notes tools and return shapes in `packages/notes/test/contract/tools.test.ts` against `contracts/mcp-notes.md`, including `parentSectionGroup?`, dropped Graph fields and the 100 000-char page cap
- [X] T050 [P] [US3] Contract test for MCP conformance on `/mcps/notes` in `packages/web/test/contract/mcp-notes.test.ts` (discovery, `405`, `-32602`, deterministic `tools/list`, no `listChanged`)
- [X] T051 [P] [US3] Unit test for `create_page` document wrapping and size rejection in `packages/notes/test/unit/create-page.test.ts` (over 4 MB → `-32602` with `data.maxBytes: 4194304`)

### Implementation for User Story 3

- [X] T052 [US3] Add `@microsoft/msgraph-sdk`, `@microsoft/msgraph-sdk-users` and `@microsoft/kiota-abstractions` to `packages/notes/package.json`; pin every kiota package to one preview number in `pnpm-workspace.yaml`
- [X] T053 [P] [US3] Define the `notes` Required scope set constant in `packages/notes/src/index.ts`: `offline_access User.Read Notes.ReadWrite`
- [X] T054 [US3] Implement the Graph client in `packages/notes/src/client.ts`: `GraphRequestAdapter` + `createGraphServiceClient`, a `McpContext`-backed `AuthenticationProvider`, `adapter.baseUrl`, `me.onenote` registration, `odataNextLink` paging, and `GraphError` translated from `ODataError`
- [X] T055 [US3] Implement `list_notebooks`, `list_sections` (exactly one parent, else `-32602`; `notebookId` = direct sections only; no parent = all including nested) and `list_pages` in `packages/notes/src/tools/`, with the shared cursor
- [X] T056 [US3] Implement `get_page` in `packages/notes/src/tools/get-page.ts`: HTML verbatim, optional `includeIds`, content capped at 100 000 chars cut at the last complete tag boundary, `contentLength` full length, `truncated` flag
- [X] T057 [US3] Implement `search_pages` in `packages/notes/src/tools/search-pages.ts`: non-empty query, case-insensitive substring on the page title only
- [X] T058 [US3] Implement `create_page` in `packages/notes/src/tools/create-page.ts`: wrap as `<!DOCTYPE html><html><head><title>{escaped title}</title></head><body>{content}</body></html>`, send `text/html; charset=utf-8`, reject > 4 MB with `data.maxBytes`
- [X] T059 [US3] Implement `update_page` in `packages/notes/src/tools/update-page.ts`: forward `patchContentCommand[]` unchanged, validate `content`/`position`/`target` rules, map Graph `204` to `{ pageId, updated: true }`, no whole-page replace
- [X] T060 [US3] Implement `delete_page`, `create_section` (exactly one parent) and `create_notebook` in `packages/notes/src/tools/`, normalising responses to the documented shape with a follow-up `GET` when a parent is omitted; bump `cache_epoch` on `create_notebook`
- [X] T061 [US3] Implement `notes` resources in `packages/notes/src/resources.ts`: one resource per notebook per usable Account at `notes://<account>/notebooks/<id>`; read returns `{ account, notebook, sections, sectionGroups, truncated }` from `$expand=sections,sectionGroups`; unknown notebook `-32602` with `data.uri`, credential failure `-32603` naming the Account
- [X] T062 [US3] Register `notes` in `packages/web/src/mcps/registry.ts`, add the `mcp` enum migration `notes`, and keep the registry/enum test green

**Checkpoint**: Both MCPs answer independently with their own Account sets.

---

## Phase 6: User Story 4 — Accounts stay healthy without operator intervention (Priority: P4)

**Goal**: Refresh is single-flight and invisible to clients; permanent failures demote loudly; scope loss is detected before it corrupts data.

**Independent Test**: With access near expiry, concurrent calls all succeed with one refresh. Revoke consent at the Provider: the next call demotes the Account to `needs_reauth` naming the admin page; reauth restores it with the same slug.

### Tests for User Story 4

- [X] T063 [P] [US4] Concurrency test in `packages/web/test/integration/refresh-lock.test.ts`: two simultaneous calls produce one refresh; lock lease 30 s expires so a dead Worker cannot freeze the Account; persist is conditional on `refresh_lock_token`
- [X] T064 [P] [US4] Failure-mapping test in `packages/web/test/unit/refresh-errors.test.ts`: `invalid_grant`/`interaction_required` → `needs_reauth`; 5xx/`ArcticFetchError`/timeout → `last_error` only; Provider 401 after refresh and 403 leave `state` untouched
- [X] T065 [P] [US4] Scope test in `packages/web/test/unit/scope-enforcement.test.ts`: missing scope at callback writes nothing; narrower reauth leaves the row untouched; refresh `scope` replaces the Granted set; absent `scope` means unchanged; widened Required set demotes at call time with `last_error = 'missing_scope'`

### Implementation for User Story 4

- [X] T066 [US4] Implement pre-emptive and reactive refresh in `packages/web/src/accounts/refresh.ts`: refresh when expiry − now < 60 s; on Provider 401 force one refresh and retry once; reuse a cached token with > 60 s left
- [X] T067 [US4] Implement the lock claim and persist in `packages/web/src/accounts/refresh.ts`: conditional `UPDATE … refresh_lock_until = now+30, refresh_lock_token = uuid`; waiters poll ~2 s in 250 ms steps; persist the rotated refresh token when returned, keep the old one when omitted; CAS on the lock token
- [X] T068 [US4] Implement state transitions in `packages/web/src/accounts/lifecycle.ts`: `active→needs_reauth` on permanent refresh failure or scope loss, `needs_reauth→active` on reauth, revoke clearing Credentials and default, `revoked→active` on reauth; clear `last_error`/`revoked_at` on success
- [X] T069 [US4] Implement reauth in `packages/web/src/accounts/lifecycle.ts` and `routes/oauth.ts`: same `provider_subject` required (`identity_mismatch`), overwrite Credentials/scopes/expiry/`last_refreshed_at`, keep slug and subject, take the same refresh lock and return retryable contention if held
- [X] T070 [US4] Enforce the Required scope set in `packages/web/src/accounts/lifecycle.ts` at callback, at refresh and at call time, using the single constant exported by each MCP package; no per-tool scope gating
- [X] T071 [US4] Implement revoke in `packages/web/src/accounts/lifecycle.ts`: best-effort Google `revokeToken()`, both ciphertexts `NULL`, `revoked_at` set, `is_default` cleared, slug reserved permanently

**Checkpoint**: Accounts survive expiry, report permanent failure, and recover by reauth with no slug drift.

---

## Phase 7: User Story 5 — Inspect and repair Accounts from the browser (Priority: P5)

**Goal**: A server-rendered admin area with the Accounts table, add/reauth/revoke/default actions, and an in-process tool test panel — with nothing sensitive rendered.

**Independent Test**: From the browser only, add an Account, set it as default, run a read tool through the test panel, revoke after confirmation, and confirm every page reflects the change and leaks no Credential.

### Tests for User Story 5

- [X] T072 [P] [US5] Route test in `packages/web/test/integration/admin-routes.test.ts`: `GET /` redirects, MCP list and Accounts table render, mutations are `POST` + `303`, missing `Origin`/`Sec-Fetch-Site` or CSRF token is refused, revoke requires the confirmation page
- [X] T073 [P] [US5] Redaction test in `packages/web/test/integration/admin-redaction.test.ts`: render every page and error path and assert zero occurrences of Credentials, client secrets, keys, `provider_subject`, JWTs, OAuth attempt contents or raw Provider bodies

### Implementation for User Story 5

- [X] T074 [US5] Implement `packages/web/src/routes/admin.ts`: `GET /admin` (MCP list, Account counts per state, default), `GET /admin/mcps/:mcp` (Accounts table: slug, email, display name, state, default flag, scopes, access expiry, last refreshed, last error code)
- [X] T075 [P] [US5] Implement the account action views in `packages/web/src/views/accounts.tsx`: add with typed slug (show `slug_taken`), reauth, default, and a revoke confirmation page; no `confirm()`
- [X] T076 [US5] Implement the mutation handlers in `packages/web/src/routes/admin.ts` calling `accounts/lifecycle.ts`, each returning `303`, guarded by CSRF, with errors rendered as a code plus one plain sentence
- [X] T077 [US5] Implement the test-a-tool panel in `packages/web/src/routes/admin.ts` and `packages/web/src/views/test-tool.tsx`: tool picker from the registry, `account` selector defaulting to the Default Account, JSON args textarea, in-process execution through the same handler as `/mcps/*`, result plus `isError` and duration, write tools labelled
- [X] T078 [US5] Style the admin area in `packages/web/src/admin/app.css` and the views so the Tailwind build covers every class; verify `GET /admin/app.css` serves the built file with `max-age=3600`

**Checkpoint**: All admin actions work end to end and the redaction test is green.

---

## Phase 8: User Story 6 — Discover and read content as resources, and use prompts (Priority: P6)

**Goal**: One resource per container per usable Account, a notebook/calendar outline on read, four calendar prompts, and honest partial listings for sick Accounts.

**Independent Test**: From a client, list resources on `calendar`, read one calendar resource, list resources on `notes`, read one notebook resource, and fetch all four prompts; every result reflects a usable Account only, and a demoted Account is reported in `_meta`.

### Tests for User Story 6

- [X] T079 [P] [US6] Resource test in `packages/web/test/integration/resources.test.ts`: one entry per container per usable Account; sick Account skipped with `ttlMs: 0` and a `_meta` warning; no Accounts active returns an empty list plus the warning, not an error; unknown container `-32602` with `data.uri`
- [X] T080 [P] [US6] Prompt test in `packages/calendar/test/contract/prompts.test.ts`: four prompt names/arguments; no Provider call at `prompts/get`; `account` resolves to the Default Account only; no default → `-32602` telling the caller to pass `account` or set one; `cacheScope: "public"`

### Implementation for User Story 6

- [X] T081 [US6] Implement `calendar` resources in `packages/calendar/src/resources.ts`: URI `<account>/calendars/<pct-encoded-id>` with RFC 3986 unreserved encoding, single decode, reject decoded `/`, no `primary` alias; read returns `{ account, calendar, window, events, truncated }` with `timeMin=now`, `timeMax=now+7d`, `singleEvents=true`, `orderBy=startTime`, `maxResults=50`; `templates/list` → `[]`
- [X] T082 [US6] Implement the four calendar prompts in `packages/calendar/src/prompts.ts` (`plan_day`, `find_meeting_time`, `summarize_week`, `triage_invites`) with the documented arguments and instructions only
- [X] T083 [US6] Implement the enumeration cache in `packages/web/src/mcps/cache.ts`: KV key `v1:enum:<mcp>:<account>:<epoch>`, value `{ resources, fetchedAt, truncated }`, TTL 300 s, write-through with `ctx.waitUntil`, failed puts logged and ignored, no single-flight, no partial writes, epoch read from D1 every time
- [X] T084 [US6] Wire `resources/list` in `packages/web/src/routes/mcps.ts` and the MCP packages to the cache, applying the `_meta` warning and `ttlMs: 0` for partial listings, and never answering reads from KV
- [X] T085 [US6] Apply the cache-hint table from `contracts/` in both MCP servers: `resources/list` 300 000/`private` (0 when partial), `resources/read` 30 000/`private`, `prompts/*` 3 600 000/`public`

**Checkpoint**: All six stories are independently functional; conformance and quickstart scenarios pass.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Hardening, deploy readiness and documented verification.

- [X] T086 [P] Run the full conformance probe suite from [quickstart.md](./quickstart.md) scenario 11 and record results in `specs/001-mcp-gateway/quickstart.md`
- [X] T087 [P] Audit redaction across `packages/web/src/**` (views, error handler, logs) and remove any path that could render a Credential, secret, JWT, `provider_subject` or raw Provider body
- [X] T088 [P] Verify bundle sizes on `wrangler deploy --dry-run` stay within Workers limits (Google ≈ 681 KiB / 133 KiB gzip, Graph ≈ 7.9 MiB / 770 KiB gzip) and record findings in `docs/SPEC.md` §3 if they moved
- [X] T089 [P] Add the deployment runbook `docs/RUNBOOK.md`: custom hostname, both Access applications, redirect URIs, Google consent publish, secrets, migrations, `workflow_dispatch` deploy, and the `notificationLevel=ALL` email warning
- [X] T090 Update `docs/SPEC.md` for any behaviour drift found during implementation, per the constitution's "Docs move with behaviour" rule
- [ ] T091 Run [quickstart.md](./quickstart.md) scenarios 1–13 against a local deployment and tick the ones that pass in the file
- [X] T092 Confirm the vitest pin: `pnpm why vitest` resolves one `^4.1` version; recheck `@cloudflare/vitest-pool-workers` for a `^5` peer before any upgrade, and do it in one workspace-wide change

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; **blocks every story** (T011–T023).
- **US1 (Phase 3)**: after Foundational. MVP.
- **US2 (Phase 4)**: after Foundational; builds on US1's Account and tool plumbing but its own tests use two Accounts.
- **US3 (Phase 5)**: after Foundational; independent of US1/US2 code paths except shared `McpContext`, `list_accounts` and cursor helper (T020, T034, T045).
- **US4 (Phase 6)**: after Foundational; needed in practice by US1–US3 but testable on one Account.
- **US5 (Phase 7)**: after US1 (needs the add/reauth/revoke actions) and US4 (health fields).
- **US6 (Phase 8)**: after US1 (calendar resources/prompts) and US3 (notes resources); cache (T083) is shared.
- **Polish (Phase 9)**: after all stories.

### Story Dependency Graph

```text
Setup → Foundational → US1 → US2
                          ├──→ US3 → US6
                          ├──→ US4 → US5
                          └──→ US6
```

US3 can start as soon as Foundational plus the shared `McpContext`/cursor helper exist; it does not import `packages/calendar`.

### Within Each Story

Tests are written first and must fail. Then models/queries → services → routes → integration. A story is complete only when its independent test passes without the other stories' code paths.

### Parallel Opportunities

- T002–T004, T006–T010 (Setup) are independent files.
- T013–T014, T018–T019, T022–T023 (Foundational) are independent.
- Test tasks within a story (T024–T026, T041–T042, T049–T051, T063–T065, T072–T073, T079–T080) run in parallel.
- T031/T053 (scope constants) are one-file tasks and can run alongside their story's tests.
- After US1, US2 and US3 can be staffed in parallel; US4/US5 and US6 form two other parallel tracks.

### Parallel Example: User Story 1

```text
T024 integration OAuth add flow      → packages/web/test/integration/oauth-add.test.ts
T025 calendar tool contract          → packages/calendar/test/contract/tools.test.ts
T026 MCP conformance on /mcps/calendar → packages/web/test/contract/mcp-calendar.test.ts
```

### Parallel Example: User Story 3

```text
T049 notes tool contract     → packages/notes/test/contract/tools.test.ts
T050 notes MCP conformance   → packages/web/test/contract/mcp-notes.test.ts
T051 create_page wrapping    → packages/notes/test/unit/create-page.test.ts
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup, Phase 2 Foundational.
2. Phase 3 US1: one Google Account, nine calendar tools, conformance green.
3. **STOP and validate**: [quickstart.md](./quickstart.md) scenarios 1–3.
4. Deploy/demo if ready.

### Incremental Delivery

1. US1 → calendar MVP.
2. US2 → multiple Accounts with safe selection.
3. US4 → health and refresh (needed before real long-lived use).
4. US5 → browser manageability.
5. US3 → `notes` MCP.
6. US6 → resources/prompts and cache.
7. Phase 9 polish and deploy.

Each step leaves earlier stories working; no story changes another story's contract.

---

## Notes

- `[P]` means different files and no dependency on an incomplete task; the same file never appears twice in one parallel batch.
- Tests are mandatory here for: crypto, Access verification, OAuth state, refresh locking, scope enforcement, cursor signing, pagination, and every contract shape.
- Constraints quoted from [data-model.md](./data-model.md) and `docs/SPEC.md` are authoritative — do not relax a `CHECK`, unique index, cap or timeout at implementation time.
- `docs/SPEC.md` remains the behavioural source of record; a drift found while implementing is a spec update plus a test, not a silent change.
