# Tasks: Google Sheets MCP

**Input**: Design documents from `/specs/002-sheets-mcp/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/mcp-sheets.md

**Tests**: Included because the project's constitution (Principle V) and `AGENTS.md` require contract tests for every MCP and the plan names them as the verification for SC-002.

**Organization**: Tasks are grouped by user story so each story is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story from spec.md — US1 read (P1), US2 create (P2), US3 write values/formulas (P3), US4 batch/structural (P4)
- Every task names the exact file path

## Path Conventions

pnpm workspace: one library per MCP under `packages/`, one deployable at `packages/web`. Paths below are repository-relative.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the `packages/sheets` workspace package and wire it into the build.

- [X] T001 Create `packages/sheets/package.json` with `@mcp-gateway/common: workspace:*`, `@googleapis/sheets: 18.1.2` (type-only use), `"test": "vitest run"`, matching `packages/calendar/package.json`
- [X] T002 [P] Create `packages/sheets/tsconfig.json` (extends `../../tsconfig.base.json`, types `node`, outDir `dist/types`, references `../common`) and `packages/sheets/vitest.config.ts` (environment `node`, include `test/**/*.test.ts`, `passWithNoTests: true`)
- [X] T003 Add `{ "path": "packages/sheets" }` to `tsconfig.json` and `"@mcp-gateway/sheets": "workspace:*"` to `packages/web/package.json`, then run `pnpm install` and commit the lockfile change

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The transport, schemas, server wiring, database enum and test harness every story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Implement the Google transport in `packages/sheets/src/client.ts`: `GOOGLE_ROOT_URL = "https://www.googleapis.com/"`, `GoogleApiError(status, message)`, and `GoogleRequest` with bearer token from `McpContext`, `URL`/query builder for `string | number | boolean | string[]`, JSON body, exactly one forced-refresh-and-retry on `401`, and error text from `error.message` only (no body/headers)
- [X] T005 Add the Sheets resource classes in `packages/sheets/src/client.ts`: `spreadsheets.get`, `spreadsheets.create`, `spreadsheets.batchUpdate`, `values.get`, `values.update`, typed with `import type { sheets_v4 }`; encode the spreadsheet ID and range with `encodeURIComponent`
- [X] T006 [P] Create `packages/sheets/src/schemas.ts` with `accountSchema` (optional non-empty slug, "Account slug. Defaults to the Default Account for this MCP.") and the shared value rules: cells are `string | number | boolean | null`, formula rows are strings, batch entries are JSON objects (`z.record(z.string(), z.json())`)
- [X] T007 [P] Create `packages/sheets/src/tools/tool-context.ts` with `ToolContext extends CommonToolContext` and `sheets(slug): GoogleSheetsClient`, mirroring `packages/calendar/src/tools/tool-context.ts`
- [X] T008 [P] Create `packages/sheets/src/resources.ts` with `NoResources implements ResourceSource` — `list()` returns `{resources: [], skipped: [], truncated: false}`, `register()` is a no-op (the MCP has no resources)
- [X] T009 Create `packages/sheets/src/server.ts` (`SheetsServer extends McpServerBuilder<ToolContext>`, name `sheets`, tools `sheetsTools`, `NoResources`, one-line `formatError`) and `packages/sheets/src/index.ts` (`REQUIRED_SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile", "https://www.googleapis.com/auth/spreadsheets"]`, export `SheetsServer` and `McpContext`)
- [X] T010 Create `packages/sheets/src/tools/index.ts` exporting `sheetsTools: readonly SheetsTool[] = []` and the `SheetsTool` type; story phases append in the documented order
- [X] T011 [P] Update `packages/web/src/db/schema.ts`: add `"sheets"` to `MCP_SLUGS`, extend `accounts_mcp_enum` and `oauth_states_mcp_enum` literals, and extend `accounts_provider_pairing` with `(mcp = 'sheets' AND provider = 'google')`
- [X] T012 Run `pnpm db:generate` and review `packages/web/migrations/0001_*.sql`: the `accounts`/`oauth_states` rebuild must copy every existing row before dropping the old table
- [X] T013 [P] Register the MCP in `packages/web/src/mcps/registry.ts` (`sheets: { factory: ctx => new SheetsServer(ctx).build(), provider: "google" }`) and add the `sheets` branch in `packages/web/src/auth/scopes.ts`
- [X] T014 [P] Add the Google Sheets mark to `packages/web/src/views/icons.ts` (`ICONS` entry, external gstatic URL, label "Google Sheets")
- [X] T015 [P] Create `packages/sheets/test/fixtures/google-sheets-tools.json` holding the six published Input Schemas transcribed from the reference pages (field names, required flags, enum members, defaults)
- [X] T016 [P] Create `packages/sheets/test/support/mcp.ts` by adapting `packages/calendar/test/support/mcp.ts` (`stubContext`, `call`, `asReply`) for the sheets server

**Checkpoint**: The package builds, the registry lists `sheets`, the migration applies, and an empty tool list is served.

---

## Phase 3: User Story 1 — Read a spreadsheet's values and structure (Priority: P1) 🎯 MVP

**Goal**: An operator adds a Google Account for `sheets`, then `get_values` returns a range and `get_spreadsheet` returns metadata (or grid data on request).

**Independent Test**: With one Account, `get_values` on `Sheet1!A1:B10` returns the real block with trailing empty rows/columns omitted; `get_spreadsheet` returns titles and sheet IDs, and includes grid data only when `includeGridData` is true.

### Tests for User Story 1

- [X] T017 [P] [US1] Unit test `packages/sheets/test/unit/get-values.test.ts`: spreadsheet ID and `Sheet1!A1:B10` are path-encoded, no query is sent, the `ValueRange` is returned unwrapped
- [X] T018 [P] [US1] Unit test `packages/sheets/test/unit/get-spreadsheet.test.ts`: `fields[]` joins with `,`, `ranges[]` is repeated, `includeGridData`/`commentsIncluded` are omitted when unset, and the result is `{content}`

### Implementation for User Story 1

- [X] T019 [US1] Implement `get_values` in `packages/sheets/src/tools/get-values.ts`: input `{account?, spreadsheetId: string, range: string}` both required, title "Get values", description "Returns a range of values from a spreadsheet.", annotations read-only + idempotent + open-world, `GET /v4/spreadsheets/{id}/values/{range}`, return the `ValueRange` as-is
- [X] T020 [US1] Implement `get_spreadsheet` in `packages/sheets/src/tools/get-spreadsheet.ts`: input `{account?, spreadsheetId (required), includeGridData?, fields?: string[], commentsIncluded?, ranges?: string[]}`, annotations read-only + idempotent + open-world, `GET /v4/spreadsheets/{id}`, return `{content}`
- [X] T021 [US1] Register both tools in `packages/sheets/src/tools/index.ts` in order `get_values`, `get_spreadsheet`
- [X] T022 [US1] Add the read integration test `packages/web/test/integration/sheets-tools.test.ts` (fake `fetch` below the transport): add a Google Account for `sheets`, call `get_values`, assert the request URL, the bearer token and the tool result

**Checkpoint**: US1 is usable end-to-end and is the MVP.

---

## Phase 4: User Story 2 — Create a new spreadsheet file (Priority: P2)

**Goal**: A client creates a new spreadsheet with an optional title and receives its ID and URL.

**Independent Test**: `create_spreadsheet` with a title returns `{content: Spreadsheet, status: "SUCCESS"}` with `spreadsheetId` and `spreadsheetUrl`; the new ID is immediately readable and writable.

### Tests for User Story 2

- [X] T023 [P] [US2] Unit test `packages/sheets/test/unit/create-spreadsheet.test.ts`: a title becomes `{properties: {title}}`, an omitted or empty title sends `{}` (or no `properties`), and the envelope is `{content, status: "SUCCESS"}`

### Implementation for User Story 2

- [X] T024 [US2] Implement `create_spreadsheet` in `packages/sheets/src/tools/create-spreadsheet.ts`: input `{account?, title?: string}`, description "Creates a new spreadsheet in the Account's Drive.", annotations not read-only/not idempotent/open-world, `POST /v4/spreadsheets`, no Drive call
- [X] T025 [US2] Register `create_spreadsheet` in `packages/sheets/src/tools/index.ts` at position 7 (after `insert_dimension`, before `list_accounts`)
- [X] T026 [US2] Extend `packages/web/test/integration/sheets-tools.test.ts` with the create-then-read flow (SC-009) and assert the create request uses only the Sheets scope path

**Checkpoint**: US1 and US2 work independently; create introduces no Drive dependency.

---

## Phase 5: User Story 3 — Write values and formulas into a range (Priority: P3)

**Goal**: A client writes plain values and, separately, formulas; both are visible immediately.

**Independent Test**: `update_values` writes a 2×2 block (`null` skipped, `""` clears), `update_formulas` writes `=A1+B1`, and a re-read shows the values and the computed formula.

### Tests for User Story 3

- [X] T027 [P] [US3] Unit test `packages/sheets/test/unit/update-values.test.ts`: `valueInputOption=RAW`, body `{range, values}`, `null` preserved in the body for Google to skip, non-scalar cells rejected by Zod
- [X] T028 [P] [US3] Unit test `packages/sheets/test/unit/update-formulas.test.ts`: `valueInputOption=USER_ENTERED`, body `{range, values: formulas}`, `{content, status}` envelope

### Implementation for User Story 3

- [X] T029 [US3] Implement `update_values` in `packages/sheets/src/tools/update-values.ts`: input `{account?, spreadsheetId, range, values}`, description "Sets values in a range of a spreadsheet.", `PUT …/values/{range}?valueInputOption=RAW`
- [X] T030 [US3] Implement `update_formulas` in `packages/sheets/src/tools/update-formulas.ts`: input `{account?, spreadsheetId, range, formulas}`, description "Sets formulas in a range of a spreadsheet.", `PUT …/values/{range}?valueInputOption=USER_ENTERED`
- [X] T031 [US3] Register both tools in `packages/sheets/src/tools/index.ts` at positions 4 and 5
- [X] T032 [US3] Extend `packages/web/test/integration/sheets-tools.test.ts` with the write-then-read flow (SC-005)

**Checkpoint**: US1–US3 work independently; values and formulas stay distinct.

---

## Phase 6: User Story 4 — Apply structural and formatting changes in one batch (Priority: P4)

**Goal**: A client applies any documented batch request atomically and can insert rows/columns with a shortcut.

**Independent Test**: A batch of `addSheet` + `repeatCell` applies in order; one invalid entry leaves the sheet unchanged; `insert_dimension` adds rows at a 0-based index and rejects `inheritFromBefore: true` at index 0.

### Tests for User Story 4

- [X] T033 [P] [US4] Unit test `packages/sheets/test/unit/update-spreadsheet.test.ts`: `requests` pass through unchanged, `writeControl.requiredRevisionId` is forwarded, one POST per call, `{content, status}` envelope
- [X] T034 [P] [US4] Unit test `packages/sheets/test/unit/insert-dimension.test.ts`: the batch body contains exactly one `insertDimension` with `{range: {sheetId, dimension, startIndex, endIndex}, inheritFromBefore}`, `DIMENSION_UNSPECIFIED` is accepted by the schema

### Implementation for User Story 4

- [X] T035 [US4] Implement `update_spreadsheet` in `packages/sheets/src/tools/update-spreadsheet.ts`: input `{account?, spreadsheetId, requests, writeControl?}`, description "Applies one or more updates to the spreadsheet.", `POST :batchUpdate`, `SAFETY:` assertion to `Schema$Request[]`, annotations not read-only/not idempotent/open-world with `destructiveHint` omitted
- [X] T036 [US4] Implement `insert_dimension` in `packages/sheets/src/tools/insert-dimension.ts`: input `{account?, spreadsheetId, sheetId, dimension, startIndex, endIndex, inheritFromBefore?}`, `dimension` enum `ROWS | COLUMNS | DIMENSION_UNSPECIFIED`, 0-based indexes, `POST :batchUpdate`
- [X] T037 [US4] Register both tools in `packages/sheets/src/tools/index.ts` at positions 3 and 6
- [X] T038 [US4] Extend `packages/web/test/integration/sheets-tools.test.ts` with a batch call and an insert-dimension call (SC-006)

**Checkpoint**: All four stories work independently; the eight-tool surface is complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Prove exactness, migration safety, redaction and the documented gates.

- [X] T039 [P] Contract test `packages/sheets/test/contract/tools.test.ts`: exactly eight tools in order, each input schema compared field-by-field with `packages/sheets/test/fixtures/google-sheets-tools.json`, `account` present on every tool, enum members and defaults match, annotations match (`get_values`/`get_spreadsheet` read-only + idempotent, all open-world, `destructiveHint` omitted)
- [X] T040 Assert in `packages/sheets/test/contract/tools.test.ts` (same file as T039) that `REQUIRED_SCOPES` contains no `drive`, `drive.file` or `drive.readonly` scope
- [X] T041 [P] Migration test `packages/web/test/integration/migration.test.ts`: seed `calendar` and `notes` rows, apply `0001_*.sql`, assert rows survive; `(mcp='sheets', provider='google')` is accepted and `(mcp='sheets', provider='microsoft')` is rejected
- [X] T042 [P] Extend `packages/web/test/integration/admin-routes.test.ts` redaction and registry/enum assertions to include `sheets`
- [X] T043 Run `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` and fix every failure
- [X] T044 Execute the automated parts of `specs/002-sheets-mcp/quickstart.md` (scenarios 1–13) and record any live-only gaps
- [ ] T045 Update the MCP list in `AGENTS.md` (`calendar`, `notes` → `calendar`, `notes`, `sheets`) only if that file has no uncommitted user edits at the time

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001–T003)**: no dependencies; T002 and T003 can run after T001
- **Foundational (T004–T016)**: depends on Setup; T004 blocks T005–T007, T009 blocks T010, T011 blocks T012
- **User Stories**: depend on Foundational only
  - US1 (T017–T022) is the MVP
  - US2 (T023–T026), US3 (T027–T032), US4 (T033–T038) each need Foundational; they do not depend on US1
  - `packages/sheets/src/tools/index.ts` is shared: T021, T025, T031, T037 must land one after another (no `[P]`), in the documented order
  - `packages/web/test/integration/sheets-tools.test.ts` is shared by T022, T026, T032, T038
- **Polish (T039–T045)**: depends on all stories

### Within Each Story

- Tests first, then implementation, then registration, then the web integration slice
- A story is complete when its unit tests and its integration slice pass

### Parallel Opportunities

- Setup: T002 alongside T001 after the package name is fixed
- Foundational: T006, T007, T008, T013, T014, T015, T016 are independent files; T011 is independent of T013
- Stories: after Foundational, US1–US4 can run in parallel across four developers; within a story, paired tests (T017/T018, T027/T028, T033/T034) run in parallel
- Polish: T039/T040 share the contract file, so run them in order; T041 and T042 touch different files and run in parallel

---

## Parallel Example: User Story 3

```bash
# Write both unit tests together:
Task: "Unit test valueInputOption=RAW in packages/sheets/test/unit/update-values.test.ts"
Task: "Unit test valueInputOption=USER_ENTERED in packages/sheets/test/unit/update-formulas.test.ts"

# Then both tools in parallel files:
Task: "Implement update_values in packages/sheets/src/tools/update-values.ts"
Task: "Implement update_formulas in packages/sheets/src/tools/update-formulas.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. T001–T016 (Setup + Foundational)
2. T017–T022 (US1)
3. **STOP and VALIDATE**: add a real Google Account, read a range and a spreadsheet; run the contract test skeleton
4. Deploy/demo if ready — the read-only MCP is useful on its own

### Incremental Delivery

1. Foundation → empty `sheets` MCP listed in admin
2. US1 → read tools (MVP)
3. US2 → create (no Drive scope added)
4. US3 → write values/formulas
5. US4 → batch and insert dimension
6. Polish → exactness, migration, redaction, gates

### Notes

- [P] means different files with no incomplete dependency
- `packages/sheets/src/tools/index.ts` and the web integration file are the only shared writes; serialize them
- Never hand-edit the generated migration; regenerate with `pnpm db:generate`
- The `status: "SUCCESS"` literal and the pass-through `commentsIncluded` are deliberate; do not invent provider codes or client-side comment handling
