# Implementation Plan: MCP Gateway

**Branch**: `001-mcp-gateway` | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-mcp-gateway/spec.md`; behavioural source of record `docs/SPEC.md`.

## Summary

One Cloudflare Worker hosts two first-party MCP servers — `calendar` (Google Calendar) and `notes` (OneNote) — at `/mcps/<slug>`, each stateless and each against exactly one Provider, with several OAuth Accounts per MCP and a per-request Account choice. A single operator manages Accounts through a server-rendered admin area, and every request is authenticated by verifying the Cloudflare Access JWT inside the Worker. Accounts, Credentials, refresh locking, scope enforcement and the MCP registry live in `packages/web`; each MCP is a library that receives only `listAccounts()` and `getAccessToken(slug)`. The design is already settled in `docs/SPEC.md` and ADR-0001…0006; this plan restates it as an implementable structure and adds the artifacts needed to build and verify it.

## Technical Context

**Language/Version**: TypeScript 7.0.2, run on workerd with `compatibility_date: 2026-11-01`; `nodejs_compat` disabled.

**Primary Dependencies**: Hono 4.13 (routing + JSX), jose (Access JWT verification), `@modelcontextprotocol/server` 2.4.0 (MCP `2026-07-28`, `createMcpHandler`), `@modelcontextprotocol/hono` 2.0.2 (Host/Origin validation and body parsing), `@modelcontextprotocol/client` 2.4.0 (in-process test panel), zod 4.6, arctic 3.7 (OAuth authorize/exchange/refresh), `@googleapis/calendar` 20.1.0 with gaxios 7.1.3, `@microsoft/msgraph-sdk` + `-users` 1.0.0-preview.92 with `@microsoft/kiota-bundle` 1.0.0-preview.112, drizzle-orm 0.45 / drizzle-kit 0.31, Tailwind v4 CLI. pnpm 12.16 workspaces, wrangler 4.157.

**Storage**: Cloudflare D1 (`accounts`, `oauth_states`) through Drizzle, migrations applied with `wrangler d1 migrations apply`; KV (`CACHE`) for container enumeration only, keyed by a per-Account epoch; Credentials encrypted in-row with AES-GCM.

**Testing**: vitest ^4.1 — deliberately pinned to 4.x because the workerd pool (`@cloudflare/vitest-pool-workers` 0.23) peers on `^4.1.0`; the workspace upgrades to 5 in one move once that package declares `^5`, not package by package. `packages/web` runs in that pool (routes, OAuth flow, lifecycle, refresh locking, Access verification, MCP conformance via the official client SDK). `packages/calendar` and `packages/notes` run in plain Node. Providers are faked below the SDK at the HTTP base URL. Live smoke tests only with `LIVE=1`, never in CI.

**Target Platform**: Cloudflare Workers, one Worker on one custom hostname behind two Cloudflare Access applications (`workers_dev` and preview URLs off).

**Project Type**: web service (single Worker) plus two library packages in one pnpm workspace.

**Performance Goals**: admin pages render under 1 s for 20 Accounts (SC-009); MCP calls are bounded by Provider latency; refresh wait caps at ~2 s of 250 ms polls; per-Account container fetch caps at 1000 items.

**Constraints**: Workers CPU and memory limits (Google bundle 681 KiB / 133 KiB gzip, Graph 7.9 MiB / 770 KiB gzip); no sessions, no Durable Objects, no `nodejs_compat`; all `@microsoft/kiota-*` pinned to one preview number; request bodies and page content capped (4 MiB Graph document, 100 000-char page content).

**Scale/Scope**: one operator, one deployment, two MCPs, 9 + 10 tools, 4 prompts, resources per calendar/notebook, tens of Accounts.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
| --- | --- | --- |
| I. Access-Only Perimeter | Worker verifies the Access JWT (signature, `iss`, path `aud`); route-group pairing enforced; dev bypass gated on `ENVIRONMENT=development` + localhost, banner shown, test proves production unreachability; no self-issued tokens | PASS — §7, `auth/access.ts`, gate test in `packages/web` |
| II. Explicit Identity, Never Guessed | Account resolves from `account` slug or the MCP default; no fallback, no inference; `isError` (or `-32602` for prompts) names slug + admin URL; one default enforced by partial unique index; Required scope set constant per MCP | PASS — §8.3, §9.2, `accounts/lifecycle.ts`, schema index `accounts_default` |
| III. Credentials Fail Closed and Never Render | AES-GCM, fresh 12-byte IV, AAD `<account_id>:<field>`; no plaintext fallback; missing key = generic 500; single-use state; no half-usable Credential; no silent narrowing | PASS — §9.1, §9.3, `auth/crypto.ts`; redaction audit in M4 |
| IV. MCPs Are Libraries; Requests Are Stateless | `createServer(ctx)` only; no D1/arctic/crypto imports in MCP packages; registry is the only slug map, asserted against the `mcp` CHECK enum; one server per request; no session id; `405` on GET/DELETE | PASS — ADR-0006, §11; registry-enum test |
| V. The Spec and the Protocol Are the Contract | Tool names, schemas, result shapes and documented divergences reproduced exactly; conformance delegated to the SDK; no legacy/reserved codes; `isError` for execution failures; §1 out-of-scope and §20 open items not invented | PASS — §11–§13; contract tests per tool |

No violations; Complexity Tracking is empty. Re-checked after Phase 1 design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/001-mcp-gateway/
├── plan.md              # This file
├── research.md          # Phase 0: decisions, rationale, alternatives
├── data-model.md        # Phase 1: entities, validation, state transitions
├── contracts/           # Phase 1: external contracts
│   ├── http-surface.md      # routes, auth pairing, admin, OAuth callback
│   ├── mcp-calendar.md      # calendar tools, resources, prompts
│   └── mcp-notes.md         # notes tools, resources
└── quickstart.md        # Phase 1: end-to-end validation guide
```

`docs/SPEC.md` and `docs/adr/` stay the authoritative behaviour and decisions; these artifacts restate what is needed to plan tasks and do not override them. `tasks.md` is produced later by `/speckit.tasks`.

### Source Code (repository root)

```text
pnpm-workspace.yaml  package.json  tsconfig.base.json
oxlint.json  .oxfmtrc.json  drizzle.config.ts  wrangler.jsonc  .env.example

packages/web/
├── migrations/                     # generated SQL, applied locally and remotely
└── src/
    ├── index.ts                    # Worker entry: Hono app
    ├── routes/{mcps,admin,oauth}.ts
    ├── mcps/registry.ts            # slug -> factory, the only MCP list
    ├── db/{schema.ts,client.ts,queries.ts}
    ├── auth/{access.ts,arctic.ts,crypto.ts}
    ├── accounts/{lifecycle.ts,refresh.ts}
    ├── views/                      # server-rendered JSX
    └── admin/{app.css, app.generated.css}

packages/calendar/
└── src/{index.ts,server.ts,client.ts,tools/,resources.ts,prompts.ts}

packages/notes/
└── src/{index.ts,server.ts,client.ts,tools/,resources.ts}

packages/*/vitest.config.ts, tsconfig.json, package.json
```

**Structure Decision**: pnpm workspace with one deployable (`packages/web`) and one library per MCP (ADR-0006). The MCP package boundary is `createServer(ctx: McpContext)`; D1, arctic, crypto and the registry never cross it. Tailwind is compiled to `packages/web/src/admin/app.generated.css` (gitignored) and served as a Wrangler Text module — no Static Assets, no Vite.

## Phases

- **Phase 0 — Research**: [`research.md`](./research.md). Every technical unknown is already resolved by `docs/SPEC.md` and ADR-0001…0006; no `NEEDS CLARIFICATION` remains.
- **Phase 1 — Design**: [`data-model.md`](./data-model.md), [`contracts/`](./contracts/), [`quickstart.md`](./quickstart.md).
- **Phase 2 — Tasks**: `/speckit.tasks` (not produced here).

## Complexity Tracking

No constitution violations, so no entries. Deliberate complexity already justified elsewhere: two Provider SDKs instead of plain `fetch` (ADR-0005 keeps typed pagination), a KV enumeration cache (epoch-keyed, §14), and per-Account refresh locking (§10).
