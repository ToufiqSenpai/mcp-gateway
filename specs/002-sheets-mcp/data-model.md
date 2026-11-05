# Phase 1 — Data Model

Two kinds of data: the persisted Account rows the gateway already owns, and the Google wire entities the tools pass through. No new tables or columns are introduced.

## Persisted: Cloudflare D1

### Account (existing table, one allowed value widened)

| Field | Type | Rule |
| --- | --- | --- |
| `id` | text (uuid) | primary key |
| `mcp` | text enum | now `calendar`, `notes`, **`sheets`**; CHECK widened by migration |
| `slug` | text | unique per `mcp`; `[a-z0-9-]`, max 32; supplied by the operator |
| `provider` | text enum | `google` for `sheets`; pairing CHECK becomes `sheets`+`google` |
| `providerSubject` | text | identity from Google userinfo; unique per `(mcp, provider, subject)` |
| `email`, `displayName` | text | display only; never a credential |
| `accessToken`, `refreshToken` | text | AES-GCM ciphertext, fresh IV, AAD `<account_id>:<field>` |
| `accessTokenExpiresAt` | integer | epoch ms; drives refresh |
| `scopes` | text | space-delimited granted scopes; must cover `REQUIRED_SCOPES` |
| `state` | text enum | `active`, `needs_reauth`, `revoked` |
| `isDefault` | integer | at most one `1` per `mcp` (partial unique index) |
| `cacheEpoch`, refresh-lock and timestamp fields | integer/text | unchanged; unused by `sheets` except the standard lifecycle |

**Relationships**: one Account belongs to exactly one MCP (and therefore one Provider); no cross-MCP sharing. `oauth_states.mcp` gains the same `sheets` enum value.

**Identity and uniqueness**: `(mcp, slug)` and `(mcp, provider, providerSubject)` unique; one default per MCP; the operator cannot reuse a `calendar` Google Account for `sheets` because identity is scoped by `mcp`.

**State transitions**: unchanged — `active` → `needs_reauth` on a failed refresh or a revoked grant; `needs_reauth` → `active` after reauthorization; either → `revoked` on operator action. A `sheets` Account that is not `active` and scope-complete never serves a call.

### Migration

One generated migration (`pnpm db:generate`) rebuilds `accounts` and `oauth_states` because SQLite cannot alter a CHECK constraint. The copy step must preserve every existing row; a web test asserts survival.

## Wire entities (passed through, never stored)

| Entity | Shape | Notes |
| --- | --- | --- |
| Spreadsheet | `spreadsheetId`, `properties{title, locale, timeZone}`, `sheets[]`, `spreadsheetUrl`, optional `data` | Response body of `get_spreadsheet`/`create_spreadsheet` |
| Sheet | `properties{sheetId, title, index, gridProperties, hidden, tabColorStyle}` | Addressed by numeric `sheetId` |
| Grid range | `{sheetId, startRowIndex?, endRowIndex?, startColumnIndex?, endColumnIndex?}` | 0-based, end-exclusive; provider-validated |
| Dimension range | `{sheetId, dimension, startIndex, endIndex}` | `dimension` ∈ `ROWS`, `COLUMNS`, `DIMENSION_UNSPECIFIED` |
| Value range | `{range, values[][]}` | `values` is row-major; empty trailing rows/columns omitted on read |
| Batch request | any documented `spreadsheets.batchUpdate` `Request` object | Applied in list order, atomically |
| Write control | `{requiredRevisionId}` | Rejects the write when the revision is stale |
| Cell value | string, number, boolean, or `null` | `null` skipped on write; `""` clears |

## Validation rules at the boundary

Zod validates every tool argument before the Provider is called:

- `spreadsheetId`, `range`: non-empty strings. Range syntax (A1/R1C1) is validated by Google, which returns a precise error.
- `fields[]`, `ranges[]`: arrays of strings. `fields` is joined with `,`; `ranges` is repeated in the query.
- `values[][]`: array of arrays of string, number, boolean or `null`. Nested arrays/objects are rejected (FR-011).
- `formulas[][]`: array of arrays of strings; sent with `valueInputOption=USER_ENTERED`.
- `requests[]`: array of JSON objects. Each is a documented batch request; an invalid one fails the whole batch at Google.
- `sheetId`, `startIndex`, `endIndex`: integers, 0 or greater. `endIndex > startIndex` and `inheritFromBefore` requiring `startIndex > 0` are Provider-validated.
- `title`: optional string; an empty string is treated as omitted.
- `account`: optional slug; resolution and unusable-Account errors follow the existing lifecycle.

No client-side validation duplicates Google's grid, revision or permission rules — those errors are surfaced, not pre-empted.
