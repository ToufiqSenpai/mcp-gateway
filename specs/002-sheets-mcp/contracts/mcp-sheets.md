# Contract — `sheets` MCP

Surface: `POST /mcps/sheets` (MCP streamable HTTP), service-token authenticated by the existing Cloudflare Access check. One server instance per request; no session id, no resources, no prompts.

## Tool order (`tools/list`)

1. `get_values`
2. `get_spreadsheet`
3. `update_spreadsheet`
4. `update_values`
5. `update_formulas`
6. `insert_dimension`
7. `create_spreadsheet`
8. `list_accounts`

Every tool also accepts `account?: string` — "Account slug. Defaults to the Default Account for this MCP." — and resolves it through the gateway's existing lifecycle. `list_accounts` is the shared common tool and returns `{slug, isDefault}` rows only.

Titles are not published by the reference; each tool uses a humanised title (`Get values`, `Get spreadsheet`, …). Names, descriptions, input schemas, annotations and output shapes are the contract.

## 1. `get_values`

**Description**: Returns a range of values from a spreadsheet.

**Input**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `spreadsheetId` | string | yes | The ID of the spreadsheet to retrieve data from |
| `range` | string | yes | A1 or R1C1 range, e.g. `Sheet1!A1:B10` |

**Provider call**: `GET /v4/spreadsheets/{spreadsheetId}/values/{range}` — both path segments encoded; no `valueRenderOption`.

**Output**: the `ValueRange` directly — `{range, values[][]}` — with empty trailing rows and columns omitted. No `content` wrapper.

**Annotations**: read-only, idempotent, open-world.

## 2. `get_spreadsheet`

**Description**: Returns the spreadsheet content for the given spreadsheet.

**Input**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `spreadsheetId` | string | yes | The ID of the spreadsheet to request |
| `includeGridData` | boolean | no | Return grid data; default false |
| `fields` | string[] | no | Hierarchical masks, e.g. `sheets.properties.sheetId`; joined with `,` |
| `commentsIncluded` | boolean | no | Include comments; default false |
| `ranges` | string[] | no | A1/R1C1 ranges; omitted means the whole spreadsheet |

**Provider call**: `GET /v4/spreadsheets/{spreadsheetId}?includeGridData=…&fields=…&commentsIncluded=…&ranges=…` (repeated `ranges`).

**Output**: `{ "content": Spreadsheet }` — the Sheets API `Spreadsheet` JSON.

**Annotations**: read-only, idempotent, open-world.

## 3. `update_spreadsheet`

**Description**: Applies one or more updates to the spreadsheet.

**Input**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `spreadsheetId` | string | yes | The ID of the spreadsheet to update |
| `requests` | object[] | yes | Any documented `spreadsheets.batchUpdate` `Request`; applied in order |
| `writeControl` | object | no | `{ requiredRevisionId?: string }` |

**Provider call**: `POST /v4/spreadsheets/{spreadsheetId}:batchUpdate` with body `{requests, writeControl?}`. One invalid request fails the whole batch (Google's atomicity).

**Output**: `{ "content": BatchUpdateSpreadsheetResponse, "status": "SUCCESS" }`.

**Annotations**: not read-only, not idempotent, open-world. `destructiveHint` omitted, as the reference publishes "destructive: no" even though this tool can delete sheets.

## 4. `update_values`

**Description**: Sets values in a range of a spreadsheet.

**Input**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `spreadsheetId` | string | yes | The ID of the spreadsheet to update |
| `range` | string | yes | A1 range, e.g. `Sheet1!A1:B2` |
| `values` | array[] | yes | Row-major; booleans, strings, numbers; `null` skipped; `""` clears |

**Provider call**: `PUT /v4/spreadsheets/{spreadsheetId}/values/{range}?valueInputOption=RAW`, body `{range, values}`.

**Output**: `{ "content": UpdateValuesResponse, "status": "SUCCESS" }`.

**Annotations**: not read-only, not idempotent, open-world.

## 5. `update_formulas`

**Description**: Sets formulas in a range of a spreadsheet.

**Input**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `spreadsheetId` | string | yes | The ID of the spreadsheet to update |
| `range` | string | yes | A1 range, e.g. `Sheet1!C1:C2` |
| `formulas` | string[][] | yes | Formula strings, e.g. `[["=A1+B1"], ["=A2+B2"]]` |

**Provider call**: `PUT /v4/spreadsheets/{spreadsheetId}/values/{range}?valueInputOption=USER_ENTERED`, body `{range, values: formulas}`.

**Output**: `{ "content": UpdateValuesResponse, "status": "SUCCESS" }`.

**Annotations**: not read-only, not idempotent, open-world.

## 6. `insert_dimension`

**Description**: Inserts rows or columns in a sheet at a particular index.

**Input**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `spreadsheetId` | string | yes | The ID of the spreadsheet to update |
| `sheetId` | integer | yes | The sheet to insert into |
| `dimension` | enum | yes | `ROWS`, `COLUMNS`, `DIMENSION_UNSPECIFIED` |
| `startIndex` | integer | yes | 0-based, inclusive |
| `endIndex` | integer | yes | 0-based, exclusive |
| `inheritFromBefore` | boolean | no | `true` requires `startIndex > 0` |

**Provider call**: `POST /v4/spreadsheets/{spreadsheetId}:batchUpdate` with one `insertDimension` request built from the fields.

**Output**: `{ "content": BatchUpdateSpreadsheetResponse, "status": "SUCCESS" }`.

**Annotations**: not read-only, not idempotent, open-world.

## 7. `create_spreadsheet` (addition, not in the reference)

**Description**: Creates a new spreadsheet in the Account's Drive.

**Input**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | no | File title; omitted or empty uses the provider default |

**Provider call**: `POST /v4/spreadsheets`, body `{properties: {title}}` (omitted when no title). No Drive call.

**Output**: `{ "content": Spreadsheet, "status": "SUCCESS" }` — the response carries `spreadsheetId` and `spreadsheetUrl`.

**Annotations**: not read-only, not idempotent, open-world.

**Scope**: `https://www.googleapis.com/auth/spreadsheets` — the same scope as the other tools.

## 8. `list_accounts`

**Description**: Lists the Accounts available to this MCP.

**Output**: `{slug, isDefault}[]`. Never state, credentials or provider subject.

## Errors

| Situation | Result |
| --- | --- |
| Unknown/disabled Account, missing default, `needs_reauth`, `revoked` | `isError` naming the slug and the admin URL; no fallback |
| Provider 400 (bad range, stale revision, invalid request) | `isError` with the provider message, first line, ≤300 chars |
| Provider 401 | one forced refresh and one retry; a second 401 is an error |
| Provider 403/404 (not shared, no access) | `isError` with the provider message; no partial write |
| Provider 429/5xx | `isError`; the write is not retried |

No tool result, log or admin page contains a token, authorization header, client secret or raw provider body.
