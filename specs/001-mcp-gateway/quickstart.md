# Quickstart: validate the MCP Gateway

A run and verification guide, not an implementation guide. It assumes the packages exist as laid out in [plan.md](./plan.md); details of behaviour live in [spec.md](./spec.md), [data-model.md](./data-model.md) and [contracts/](./contracts/).

## Prerequisites

- Node with pnpm 12.16, workerd via wrangler 4.157; `tsc` 7, `oxlint`, `oxfmt`, Tailwind v4 CLI.
- A Cloudflare account with a zone for the custom hostname, D1 and KV.
- Two OAuth applications: Google (Calendar API enabled, consent screen published, redirect `https://<host>/oauth/callback/google`) and Microsoft Entra (`common` tenant, redirect `https://<host>/oauth/callback/microsoft`). Local `http://localhost:8787/oauth/callback/<provider>` registered in both.
- Two Access applications: `mcp-gateway-admin` (One-time PIN over `/`, `/admin*`, `/oauth/*`) and `mcp-gateway-clients` (Service Auth, strict, over `/mcps/*`). Record both AUDs and the team domain.
- Secrets: `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`, `TOKEN_ENCRYPTION_KEY` (base64 of exactly 32 bytes), `CURSOR_SIGNING_KEY`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_ADMIN_AUD`, `CF_ACCESS_MCP_AUD`.

## Local setup

```bash
pnpm install --frozen-lockfile
cp .env.example .env            # fill values; .env stays gitignored
pnpm db:migrate:local           # applies generated D1 migrations
pnpm dev                        # tailwind build, then wrangler dev --env-file .env
```

Local development runs with `ENVIRONMENT=development` on localhost, so the Access check is bypassed for both route groups and a fake human identity is injected; every admin page must show the dev-bypass banner.

## Gates

```bash
pnpm typecheck   # tsc -b over project references
pnpm lint        # oxlint
pnpm test        # vitest: workerd pool + plain Node packages
```

All three must be green on every push and PR. `LIVE=1 pnpm test` runs live smoke tests and must never run in CI.

## Validation scenarios

Run these in order; each maps to a success criterion.

1. **Perimeter (SC-002).** Without a service credential, `POST /mcps/calendar` and `GET /admin` are refused. With a human session on `/mcps/calendar` and a service token on `/admin`, both are `403`. A production-mode test asserts the dev bypass cannot activate.
2. **Add an Account (SC-001, SC-010).** Open `/admin/mcps/calendar`, submit `personal`, approve consent. Expect a `302` back with `?added=personal`, the row `active`, and `is_default = 1` because the MCP had none. Repeat at the Provider to confirm a duplicate identity is refused with the existing slug.
3. **Use the tools (SC-008).** From an MCP client, `tools/list` on `/mcps/calendar` returns the nine calendar tools plus `list_accounts`, deterministically ordered over 20 calls. Call `list_calendars`, `create_event`, `get_event`, `update_event` (change only `startTime`, confirm duration kept), `delete_event` (confirm the deleted `Event` is returned), `respond_to_event`, `suggest_time`, `search_events` (literal match).
4. **Refresh (SC-004).** Move `access_token_expires_at` to now + 30 s and fire five concurrent tool calls. All succeed; exactly one refresh row update occurs; `last_refreshed_at` advances once.
5. **Broken default (SC-005).** Set the default Account to `needs_reauth` in D1, call a tool with no `account`. Expect an `isError` result naming `personal` and the admin URL; no other Account is used. Name the healthy slug explicitly and it works.
6. **Reauth (SC-010).** Start reauth for `personal`, approve the same identity. Expect `active` again, slug and subject unchanged. Approve a different identity instead and expect `identity_mismatch` with the row untouched. Uncheck a permission and expect `missing_scope` with the working Credential intact.
7. **Revoke.** Revoke via the confirmation page. Both Credentials become `NULL`, `state = revoked`, `is_default = 0`, and calls naming it fail as unusable. The slug cannot be reused for a new Account.
8. **Scope loss after deploy.** Widen the Required set in code, redeploy, call a tool: the Account demotes to `needs_reauth` with `last_error = missing_scope`, and the refresh lock is released.
9. **Second MCP (SC-008).** Repeat 2–3 for `/mcps/notes` with a Microsoft Account: `list_notebooks`, `list_sections` (exactly one parent), `list_pages`, `get_page` (HTML, 100 000-char cap), `search_pages` (title substring), `create_notebook`, `create_section`, `create_page`, `update_page`, `delete_page`. Cross-MCP slug from `calendar` must be unknown.
10. **Resources (SC-007).** `resources/list` returns one entry per calendar/notebook for usable Accounts only; with one Account demoted, the list still returns healthy entries plus a `_meta` warning and `ttlMs: 0`. Read one resource of each kind. Page to the end of a two-Account list, change the Account set, reuse the cursor — expect `-32602`.
11. **Protocol conformance (SC-006).** Run the probe suite: `server/discover` shape, `_meta`/header validation, `405` on `GET`/`DELETE`, `-32602` for unknown tool/prompt/resource, `isError` for execution failures, no `listChanged`, no subscription events, `resultType: "complete"` on successes.
12. **Admin safety (SC-003).** Fetch every admin page and error path, then grep the rendered HTML, responses and logs for any Credential, client secret, key, `provider_subject`, JWT or raw Provider body. Expect zero hits. Confirm mutations are `POST` + `303`, `Origin`/`Sec-Fetch-Site` and the CSRF token are required, and revoke needs the confirmation page.
13. **Cache (FR-060).** List resources twice within 5 minutes: the second is served from cache. Add an Account or create a notebook: the epoch bump makes the next list reflect it immediately.

## Automated coverage (recorded 2026-11-04)

The scenarios above are executable as tests except where a real Provider or deployment is
required. Mapping:

| Scenario | Where it is exercised |
| --- | --- |
| 1 Perimeter | `packages/web/test/contract/mcp-calendar.test.ts`, `test/unit/access-production.test.ts` |
| 2 Add an Account | `test/integration/oauth-add.test.ts` |
| 3 Use the tools | `packages/calendar/test/contract/tools.test.ts` (schemas, annotations, ordering) |
| 4 Refresh | `test/integration/refresh-lock.test.ts` |
| 5 Broken default | `test/integration/account-selection.test.ts` |
| 6 Reauth | `packages/web/src/accounts/lifecycle-oauth.ts` + `test/integration/oauth-add.test.ts` (scope and duplicate paths) |
| 7 Revoke | `test/integration/admin-routes.test.ts` |
| 8 Scope loss after deploy | `test/integration/account-selection.test.ts`, `test/integration/refresh-lock.test.ts` |
| 9 Second MCP | `packages/notes/test/contract/tools.test.ts`, `test/contract/mcp-notes.test.ts` |
| 10 Resources | `test/integration/resources.test.ts` |
| 11 Protocol conformance | `test/contract/mcp-calendar.test.ts`, `test/contract/mcp-notes.test.ts` |
| 12 Admin safety | `test/integration/admin-routes.test.ts` (redaction) |
| 13 Cache | `test/integration/resources.test.ts` (second list served from KV, epoch bump re-misses) |

Conformance probe results: `server/discover` shape, `_meta`/header validation, `405` on
`GET`/`DELETE`, `-32602` for unknown tool, deterministic `tools/list` over 20 runs,
`resultType: "complete"`, no `listChanged`, no `Mcp-Session-Id`, no HTTP cache headers — all
pass for both MCPs.

Scenarios that still need a live run: the real Google/Microsoft consent screens, the
seven-day Google refresh-token expiry, and every step in the deploy checklist below.

## Deploy checklist

1. Set the route and `workers_dev: false`, `preview_urls: false`.
2. Create both Access applications and record AUDs; set the team domain.
3. Register both redirect addresses; publish the Google consent screen (while in *Testing*, refresh tokens expire after seven days and surface as `needs_reauth`).
4. `wrangler secret put` for every secret.
5. `pnpm db:migrate:remote`.
6. Deploy by `workflow_dispatch`; add one real Account per MCP and run scenarios 3, 9, 10 against the deployed host.

