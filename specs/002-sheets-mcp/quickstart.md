# Quickstart: validate the `sheets` MCP

A run and verification guide. Behaviour lives in [spec.md](./spec.md), shapes in [data-model.md](./data-model.md) and per-tool detail in [contracts/mcp-sheets.md](./contracts/mcp-sheets.md).

## Prerequisites

- Everything the gateway already needs (see `specs/001-mcp-gateway/quickstart.md`): Node 26, pnpm 12.16.1, wrangler 4.157, the two Cloudflare Access applications, and `TOKEN_ENCRYPTION_KEY`, `CURSOR_SIGNING_KEY`, `GOOGLE_CLIENT_ID/SECRET`.
- **Google Cloud**: the Sheets API enabled on the same OAuth client used by `calendar`. No Drive API enablement and no Drive scope are required.
- The Google consent screen lists `https://www.googleapis.com/auth/spreadsheets` in addition to the identity scopes.
- A Google account with at least one spreadsheet, and a second Google account that does not have access to it (for the forbidden case).

## Local setup

```bash
pnpm install --frozen-lockfile
pnpm db:generate                 # only when the schema change is made; review the generated SQL
pnpm db:migrate:local
pnpm dev                         # tailwind build, then wrangler dev --env-file .env
```

`ENVIRONMENT=development` on localhost bypasses Access for both route groups and shows the dev-bypass banner, as today.

## Gates

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
```

`LIVE=1 pnpm test` runs the live smoke test (real Google, real token) and never runs in CI.

## Validation scenarios

Each maps to a success criterion in the spec.

1. **Migration (SC-008).** Start from a database with `calendar` and `notes` Accounts. Apply the migration. Both rows survive unchanged, the admin home still lists all three MCPs, and inserting `(mcp='sheets', provider='google')` succeeds while `(mcp='sheets', provider='microsoft')` is rejected by the CHECK.
2. **Add an Account (SC-001).** Open `/admin/mcps/sheets`, submit `work`, approve consent. Expect `302 ?added=work`, state `active`, `is_default = 1`, and a granted scope string containing `.../auth/spreadsheets`. The consent screen must not mention Drive.
3. **Tool listing (SC-002, SC-003).** `tools/list` returns exactly eight tools in the documented order. Compare each input schema — field names, required flags, enums, defaults — against the published pages; the contract test does this against `test/fixtures/google-sheets-tools.json`. Confirm `account` is the only extra property and that `insert_dimension.dimension` includes `DIMENSION_UNSPECIFIED`.
4. **Read (SC-004).** `get_values` with `Sheet1!A1:B10` returns the same block the spreadsheet shows, with no trailing empty rows/columns. `get_spreadsheet` without ranges returns metadata only; with `includeGridData: true` it returns cell data; with `fields: ["sheets.properties.sheetId","sheets.properties.title"]` it returns only those.
5. **Write values (SC-005).** `update_values` a 2×2 block containing a boolean, a number, a string and a `null`; re-read: the `null` cell is untouched, the rest match. Send `""` to clear a cell.
6. **Write formulas (SC-005).** `update_formulas` writes `=A1+B1`; re-read shows the computed value, and `get_spreadsheet` with `includeGridData` shows the formula text.
7. **Structural batch (SC-006).** `update_spreadsheet` with `addSheet` + `repeatCell` + `updateSheetProperties` applies all in order; read back to confirm. Send one invalid request alongside valid ones: the call is an error and the spreadsheet is unchanged.
8. **Revision guard.** Read the current revision (`get_spreadsheet` with `fields: ["spreadsheetId","properties"]` plus the batch response's `spreadsheetId`; capture a stale `requiredRevisionId` in a fixture), then send a batch with that stale ID. Expect a `400`-class error and no change.
9. **Insert dimensions (SC-006).** `insert_dimension` inserts two rows above row 1 (`startIndex: 0`, `endIndex: 2`, `inheritFromBefore: false`). With `inheritFromBefore: true` and `startIndex: 0`, expect the provider's error.
10. **Create (SC-009).** `create_spreadsheet` with a title returns a `content` with `spreadsheetId` and `spreadsheetUrl`; the file exists in that identity's Drive root. Call `get_values` and `update_values` with the returned ID immediately. Repeat without a title: the default title is used. The editor opens the new file and shows it in My Drive.
11. **Identity rules (SC-007).** Call with `account: "work"` while the default is another Account: the named one is used. Demote the default to `needs_reauth`, call with no `account`: `isError` naming the slug and admin URL. Name a slug that does not exist: the error lists available slugs. A `calendar` Google Account slug must be unknown to `sheets`.
12. **Redaction (SC-007).** Grep tool results, Worker logs and admin HTML for the access token, refresh token, client secret, encryption key and raw Google body. Expect zero hits.
13. **No Drive scope.** Inspect the authorize URL and the stored `accounts.scopes`: only identity + `spreadsheets`. There must be no `drive`, `drive.file` or `drive.readonly`.

## Live checks that automation cannot prove

- `commentsIncluded: true` on `get_spreadsheet` against a preview-enabled Google project. The public REST reference does not list this parameter; if comments are absent, record it as a Preview-only limitation rather than a gateway bug.
- The reference marks `update_spreadsheet` as non-destructive although it can delete sheets. Confirm the published annotation is what the gateway sends, and decide separately whether clients need a warning (not a spec change).
- Very large `includeGridData` responses: confirm the Worker returns the provider body within its memory limit or fails with a provider/gateway error, never a silently truncated payload.

## Automated coverage (to be produced by `/speckit.tasks`)

| Scenario | Where it should be exercised |
| --- | --- |
| 1 Migration | `packages/web/test/integration/migration.test.ts` |
| 2 Add an Account | `packages/web/test/integration/oauth-add.test.ts` (sheets case) |
| 3 Tool listing | `packages/sheets/test/contract/tools.test.ts` |
| 4–6 Read/write | `packages/sheets/test/unit/*` + `packages/web/test/integration/sheets-tools.test.ts` with faked `fetch` |
| 7–9 Batch, revision, dimensions | `packages/sheets/test/unit/update-spreadsheet.test.ts`, `insert-dimension.test.ts` |
| 10 Create | `packages/sheets/test/unit/create-spreadsheet.test.ts` |
| 11 Identity rules | `packages/web/test/integration/account-selection.test.ts` |
| 12 Redaction | `packages/web/test/integration/admin-routes.test.ts` |
| 13 No Drive scope | `packages/sheets/test/contract/tools.test.ts` + `oauth-add.test.ts` |
