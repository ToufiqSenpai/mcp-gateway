# Phase 0 — Research

All decisions below are settled; nothing is marked `NEEDS CLARIFICATION`. The published tool pages are the contract; the source pages were read on 2026-11-05.

## R1 — How to call Google

**Decision**: `packages/sheets/src/client.ts` speaks HTTP directly over `fetch`, with `sheets_v4.Params$Resource$*` and `Schema$*` imported **type-only** from `@googleapis/sheets` 18.1.2. One `GoogleRequest` class owns the token, the URL/query builder, the JSON body, the single 401 refresh-and-retry, and the error unwrapping — the same shape as `packages/calendar/src/client.ts`.

**Rationale**: The calendar package already established this seam. Tests can fake HTTP at `rootUrl` (`https://www.googleapis.com/`), the Worker bundle does not grow by an SDK runtime, and the exact wire schemas still come from Google's generated types.

**Alternatives considered**: (a) the `@googleapis/sheets` runtime client — pulls `googleapis-common`, `gaxios` and auth machinery into a Worker that already has a token; (b) hand-written interfaces — cannot be checked against Google and would drift; (c) importing the calendar transport — cross-MCP coupling, forbidden by ADR-0006.

## R2 — Tool surface and exactness

**Decision**: register, in this order, `get_values`, `get_spreadsheet`, `update_spreadsheet`, `update_values`, `update_formulas`, `insert_dimension`, `create_spreadsheet`, `list_accounts`. The six Google tools use the per-tool Input Schema field names (camelCase), types, required flags, enum members and defaults, plus the optional `account` field. `create_spreadsheet` is the only designed schema: `{ title?: string }`, camelCase like its neighbours.

**Rationale**: The reference page's summary table spells `spreadsheet_id`; each tool's structured Input Schema spells `spreadsheetId`. The structured schema is the actual tool contract, and camelCase matches both the REST JSON and the calendar package's conventions. The spec records this as a clarification.

**Alternatives considered**: snake_case from the summary table (contradicts every tool page and the gateway's existing Google tools).

## R3 — Value input semantics

**Decision**: `update_values` sends `valueInputOption=RAW`; `update_formulas` sends `valueInputOption=USER_ENTERED` with the formula strings in `values`.

**Rationale**: The reference splits values and formulas into separate tools. With `RAW`, a string that happens to start with `=` stays text; with `USER_ENTERED`, `=A1+B1` becomes a live formula. Either option alone would make one of the two tools behave like the other.

**Alternatives considered**: `USER_ENTERED` for both (values would silently become formulas); exposing `valueInputOption` as a parameter (not in the reference schema; forbidden by FR-007).

## R4 — `update_spreadsheet.requests`

**Decision**: validate the argument with `z.array(z.record(z.string(), z.json()))` and pass it through as the batch body after a `SAFETY:`-commented assertion to `sheets_v4.Schema$Request[]`. `writeControl` is `{ requiredRevisionId?: string }`. The whole batch is one `POST :batchUpdate`.

**Rationale**: The reference accepts any documented `Request` object as a JSON struct; enumerating ~50 request types in Zod would duplicate Google's schema and still miss new fields. Atomicity is Google's: one invalid request fails the batch with nothing applied.

**Alternatives considered**: a Zod union of every request type (large, brittle); one tool per request type (changes the published surface).

## R5 — Result envelopes

**Decision**: `get_values` returns the `ValueRange` object directly (`{range, values}`). `get_spreadsheet`, `update_spreadsheet`, `update_values`, `update_formulas`, `insert_dimension` and `create_spreadsheet` return `{ content: <Sheets JSON>, status: "SUCCESS" }`. Failures are `isError` with a one-line message and no envelope.

**Rationale**: The per-tool output schemas show a bare `ValueRange` for `get_values` and a `content` wrapper for the rest; write outputs add a `status`. The reference does not publish the `status` enum, so the gateway uses one explicit success value rather than fabricating per-provider codes.

**Alternatives considered**: omitting `status` (spec FR-015 requires it); echoing the HTTP status (the response is already 2xx by the time the tool succeeds).

## R6 — Query and path construction

**Decision**: path-encode the spreadsheet ID and the range (`encodeURIComponent`); join `fields[]` with `,`; append each `ranges[]` as a repeated query parameter; send `includeGridData` and `commentsIncluded` as booleans and `valueInputOption` as an enum string.

**Rationale**: Matches Google's REST encoding for A1 ranges containing `!`, `:`, spaces, and quotes, and keeps repeated ranges intact (a comma join would corrupt ranges that themselves contain commas in quoted sheet names).

**Alternatives considered**: a single comma-joined `ranges` value (breaks quoted sheet names).

## R7 — `commentsIncluded` is a pass-through

**Decision**: send `commentsIncluded` when the caller sets it and otherwise omit it; do not fail when the provider ignores it.

**Rationale**: The reference tool documents the field, but the public Sheets v4 `spreadsheets.get` reference does not list it — it is part of the Developer Preview surface. Passing it through keeps the schema exact without inventing client-side behaviour.

**Risk**: On a deployment without preview access the field may be ignored, so comments may be absent from the response. Recorded in the quickstart as a live-check item.

## R8 — Accounts, scopes and pairing

**Decision**: `REQUIRED_SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile", "https://www.googleapis.com/auth/spreadsheets"]`. Registry entry `sheets: { factory, provider: "google" }`. No Drive scope anywhere.

**Rationale**: Every tool, including `create_spreadsheet`, works with the Sheets scope; the read-only tools also accept `spreadsheets.readonly`, but a single write scope set keeps one Account usable for all tools, as with calendar.

**Alternatives considered**: requesting `drive` (unnecessary escalation), splitting read/write Accounts (contradicts one Required scope set per MCP).

## R9 — Database change

**Decision**: add `"sheets"` to `MCP_SLUGS`, update the two literal CHECK strings (`accounts_mcp_enum`, `oauth_states_mcp_enum`), and extend `accounts_provider_pairing` with `(mcp = 'sheets' AND provider = 'google')`. Generate the migration with `pnpm db:generate`; never hand-edit SQL.

**Rationale**: SQLite cannot alter a CHECK constraint, so Drizzle rebuilds the table. The generated SQL must be reviewed for the copy step that preserves existing `calendar`/`notes` rows.

**Verification**: a `packages/web` migration test inserts a row into the old shape, applies the migration, and asserts the row survives and `sheets`/`google` is now accepted.

## R10 — Tool annotations

**Decision**: `get_values` and `get_spreadsheet` are `readOnlyHint: true, idempotentHint: true`; the four writes and `create_spreadsheet` are `readOnlyHint: false, idempotentHint: false`; all are `openWorldHint: true` and omit `destructiveHint`, matching the reference's "destructive: no" for the six Google tools. `create_spreadsheet` follows the same non-destructive shape.

**Rationale**: The reference publishes exactly these hints per tool, including the surprising non-destructive marking on `update_spreadsheet`.

**Risk**: `update_spreadsheet` can delete sheets and data while advertising `destructiveHint: false`. Kept for exactness and flagged in the quickstart's manual check.

## R11 — Errors

**Decision**: reuse the calendar pattern: `GoogleApiError(status, message)`; `formatError` returns the provider `error.message` first line, prefixed with the status when absent, sliced to 300 characters. Never include the response body, headers or token.

**Rationale**: Satisfies FR-017 and the constitution's "never render credentials" rule; account-state failures already come from `ToolContext` in the same wording as the other MCPs.

## R12 — Testing strategy

**Decision**:
- Contract fixtures: `test/fixtures/google-sheets-tools.json` holds the six Input Schemas transcribed from the published pages; the contract test compares property names, required arrays, enum members and defaults, and asserts the full tool order.
- Unit: query/path building, envelope shaping, `RAW` vs `USER_ENTERED`, empty-title handling.
- Web integration: add a `sheets` Account with a Google code, then call `get_values` with `fetch` faked for `www.googleapis.com`; assert the request URL, the bearer token, and the tool result.
- Migration: old-row survival and the widened pairing CHECK.

**Rationale**: SC-002 requires a schema comparison, and the fixture keeps the comparison readable and reviewable. Faking below the transport matches the existing provider-fake convention.

**Alternatives considered**: hitting the live MCP endpoint in CI (preview-only, no credentials), snapshot tests of generated JSON Schema (noisy and unreadable).
