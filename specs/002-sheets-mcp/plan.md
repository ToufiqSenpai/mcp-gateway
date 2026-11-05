# Implementation Plan: Google Sheets MCP

**Branch**: `002-sheets-mcp` | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-sheets-mcp/spec.md`

## Summary

Add a third first-party MCP, `sheets`, at `/mcps/sheets`, against the existing Google Provider. It exposes the six Google-published tools (`get_values`, `get_spreadsheet`, `update_spreadsheet`, `update_values`, `update_formulas`, `insert_dimension`) with their published names and Input Schemas, plus two gateway conventions: the optional `account` selector on every tool, and `list_accounts`. One user-requested addition, `create_spreadsheet`, creates a file with the Sheets API alone, so no Google Drive scope is introduced. The implementation follows the calendar template: a new library package that calls Google over plain `fetch` with type-only SDK shapes, registered in `packages/web` with one generated D1 migration.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on workerd, `compatibility_date: 2026-11-01`, `nodejs_compat` disabled.

**Primary Dependencies**: new workspace package `@mcp-gateway/sheets`; `@googleapis/sheets` 18.1.2 **type-only** (`import type { sheets_v4 }`), matching how `packages/calendar` uses `@googleapis/calendar`; `@mcp-gateway/common`, zod 4.6 from the workspace root. No SDK runtime, no `gaxios`, no new HTTP client.

**Storage**: existing D1 tables only (`accounts`, `oauth_states`) — no new tables or columns. One generated migration widens the `mcp` CHECK enum and the provider pairing to include `sheets`/`google`. Credentials stay AES-GCM encrypted in-row; KV is untouched.

**Testing**: vitest 4.1.12. `packages/sheets` runs in Node: unit tests for argument validation and response shaping, contract tests that compare the published `tools/list` against a checked-in fixture of the six Google Input Schemas plus the two gateway tools. `packages/web` runs in workerd: registry/enum/migration tests and an add-account + call-tool integration test with `fetch` faked below the SDK. `LIVE=1` smoke tests never run in CI.

**Target Platform**: Cloudflare Workers, one Worker behind the existing two Cloudflare Access applications; no new hostname or route group.

**Project Type**: pnpm workspace, one deployable (`packages/web`) plus MCP library packages.

**Performance Goals**: bounded by Google latency; the Worker adds no pagination, caching or polling. Tool handlers do one Provider call each (the transport's single 401 retry aside).

**Constraints**: tool names and Input Schemas exactly as published (camelCase, enums, required flags, defaults); one extra `account` field and two extra tools; `spreadsheets` scope only, never a Drive scope; responses JSON-encoded as the other MCPs do; Worker request/memory limits apply to large `includeGridData` responses.

**Scale/Scope**: 3 MCPs, 8 `sheets` tools, 0 resources, 0 prompts, tens of Accounts, one operator.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
| --- | --- | --- |
| I. Access-Only Perimeter | No new route group or hostname; `/mcps/sheets` reuses the Access service-token path and the existing dev bypass rules | PASS — no auth code touched |
| II. Explicit Identity, Never Guessed | Every tool resolves the optional `account` slug or the MCP default; failures are `isError` naming slug + admin URL; no fallback; one default per MCP; the Required scope set is one constant in the package | PASS — same `ToolContext`/lifecycle as calendar; `REQUIRED_SCOPES` in `packages/sheets/src/index.ts` |
| III. Credentials Fail Closed and Never Render | Tokens stay in `packages/web`; the package only receives `McpContext`; errors are one line, no headers or bodies; no token reaches a tool result or log | PASS — package boundary unchanged; error mapping mirrors `GoogleApiError` |
| IV. MCPs Are Libraries; Requests Are Stateless | New package exports `createServer`-equivalent through `SheetsServer`; no D1/OAuth/crypto imports; one server per request; registry entry + `MCP_SLUGS` + migration kept in sync by the existing contract test | PASS — ADR-0006; registry test extended to `sheets` |
| V. The Spec and the Protocol Are the Contract | Published tool names, schemas, result shapes and annotations reproduced exactly; the two documented deviations are in the spec; failures are `isError` | PASS — contract test compares a checked-in schema fixture |

No violations; Complexity Tracking records the deliberate duplication and the migration rebuild. Re-checked after Phase 1 design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/002-sheets-mcp/
├── plan.md              # This file
├── research.md          # Phase 0: decisions, rationale, alternatives
├── data-model.md        # Phase 1: wire entities, validation, state
├── contracts/
│   └── mcp-sheets.md    # Phase 1: tool-by-tool contract and REST mapping
└── quickstart.md        # Phase 1: end-to-end validation guide
```

`tasks.md` is produced later by `/speckit.tasks`. The spec is the behavioural source; these artifacts add only what planning needs.

### Source Code (repository root)

```text
packages/sheets/
├── package.json                      # @mcp-gateway/sheets, @googleapis/sheets type-only
├── vitest.config.ts  tsconfig.json
├── src/
│   ├── index.ts                      # REQUIRED_SCOPES, exports
│   ├── server.ts                     # SheetsServer extends McpServerBuilder
│   ├── client.ts                     # Google Sheets transport over fetch
│   ├── schemas.ts                    # account + exact tool input schemas
│   ├── map.ts                        # response envelopes and error mapping
│   ├── resources.ts                  # NoResources (spec has none)
│   └── tools/
│       ├── index.ts                  # registration order
│       ├── tool-context.ts           # account resolution + client factory
│       ├── get-values.ts  get-spreadsheet.ts
│       ├── update-spreadsheet.ts  update-values.ts
│       ├── update-formulas.ts  insert-dimension.ts
│       └── create-spreadsheet.ts
└── test/
    ├── contract/tools.test.ts        # exact schema + annotations + order
    ├── unit/{client,map}.test.ts
    ├── fixtures/google-sheets-tools.json
    └── support/mcp.ts

packages/web/
├── migrations/0001_*.sql             # generated: mcp enum + provider pairing
└── src/
    ├── db/schema.ts                  # MCP_SLUGS + CHECK strings
    ├── mcps/registry.ts              # sheets -> SheetsServer, provider "google"
    ├── auth/scopes.ts                # sheets REQUIRED_SCOPES
    └── views/icons.ts                # Google Sheets product mark
```

**Structure Decision**: one library package per MCP (ADR-0006). `packages/common` is untouched: a `NoResources` implementation of the already-exported `ResourceSource` lives in `packages/sheets` because only this MCP has no resources, and moving it into the framework would be preemptive. The Google transport is duplicated from `packages/calendar` deliberately: MCP packages do not import each other, and moving the transport into `common` would put a Provider-specific client in the provider-agnostic framework.

## Phases

- **Phase 0 — Research**: [`research.md`](./research.md). All technical unknowns resolved; no `NEEDS CLARIFICATION` remains.
- **Phase 1 — Design**: [`data-model.md`](./data-model.md), [`contracts/mcp-sheets.md`](./contracts/mcp-sheets.md), [`quickstart.md`](./quickstart.md).
- **Phase 2 — Tasks**: `/speckit.tasks` (not produced here).

## Complexity Tracking

| Item | Why needed | Alternative rejected |
| --- | --- | --- |
| Shared Google transport in `packages/google` | Calendar and Sheets call Google identically; one copy keeps the 401 refresh, error mapping and token handling in one place | Duplicating ~60 lines per MCP (fails the duplication gate); move `Google` to `common` (violates ADR-0008 boundary); import from `calendar` (couples two MCPs) |
| One type-only SDK dependency (`@googleapis/sheets`) | The exact Schemas and enums are the feature; hand-written types would drift | Local structural types (unverifiable), SDK runtime (larger bundle than needed) |
| Generated migration rebuilding `accounts` | SQLite cannot alter a CHECK constraint in place; the enum and pairing must change | New table or a second accounts table (breaks the single-Account model) |
| `create_spreadsheet` outside the reference | User decision, recorded in spec Clarifications; no Drive scope | Omitting it (user asked for file creation), Drive API (scope escalation) |
