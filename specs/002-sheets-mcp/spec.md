# Feature Specification: Google Sheets MCP

**Feature Branch**: `002-sheets-mcp`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "saya ingin menambahkan MCP sheets di project ini berdasarkan referensi di MCP google ini https://developers.google.com/workspace/sheets/api/reference/mcp — Tool dan schemanya harus sama persis"

## Clarifications

### Session 2026-11-05

- Q: The reference page documents two spellings for the same inputs — snake_case in the summary table (`spreadsheet_id`) and camelCase in each tool's Input Schema (`spreadsheetId`). Which one is the contract? → A: The per-tool Input Schema section wins, because it is the structured schema of that tool; the summary table is prose. Field names, types, requiredness, enum values and defaults follow the per-tool Input Schema exactly.
- Q: The reference tools have no account selector, while the gateway requires one on every tool. Is `account` an allowed addition? → A: Yes, one optional `account` parameter per tool plus the gateway's `list_accounts` tool. Apart from `create_spreadsheet` (see below), no other parameter, tool or behavior is added, removed or renamed.
- Q: `tools/list` against the published endpoint is not reachable (Developer Preview), so no captured schema exists. What is the source of record? → A: The published Google Workspace documentation for the six tools is the source of record.
- Q: The reference has no tool that creates a new spreadsheet file. Should the MCP add one, and may it use Google Drive? → A: Add `create_spreadsheet` as a deliberate, documented extra, implemented with the Sheets API alone (`spreadsheets.create`) so the required scope set stays `spreadsheets` and no Drive scope is requested. Renaming a file stays inside `update_spreadsheet`; file delete, move, copy, listing and sharing remain out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read a spreadsheet's values and structure (Priority: P1)

The operator adds a Google Account to the new `sheets` MCP through the existing admin flow, then from an MCP client reads a range of values from a spreadsheet and reads the spreadsheet's metadata (title, sheet names, grid properties). The data comes from that Google identity's own spreadsheets.

**Why this priority**: Reading is the minimum useful product and proves the new MCP is wired to the right identity, scope set and endpoint.

**Independent Test**: With only this story implemented, add a Google Account for `sheets`, then call `get_values` for `Sheet1!A1:B10` and `get_spreadsheet` for the same spreadsheet ID. Both return that identity's real data, and the second returns sheet titles and IDs.

**Acceptance Scenarios**:

1. **Given** a fresh deployment and valid Google client credentials, **When** the operator authorizes a new Account for `sheets`, **Then** the Account becomes usable and the MCP's default, and the consent screen requests the Sheets write scope.
2. **Given** one usable Account, **When** a client calls `get_values` with a spreadsheet ID and an A1 or R1C1 range, **Then** the response carries the range and a row-major 2D array of values with empty trailing rows and columns omitted.
3. **Given** one usable Account, **When** a client calls `get_spreadsheet` naming no ranges and no grid data, **Then** the response carries the spreadsheet's metadata but not its cell data.
4. **Given** `includeGridData` is true, **When** `get_spreadsheet` is called, **Then** cell data is returned for the requested ranges (or the whole spreadsheet when no range is named).
5. **Given** a request without the gateway's service credential, **When** it reaches `/mcps/sheets`, **Then** it is refused and no spreadsheet data is returned.

---

### User Story 2 - Create a new spreadsheet file (Priority: P2)

The operator's client asks the MCP to create a brand-new spreadsheet, optionally with a title, and receives its spreadsheet ID and URL. The new file belongs to that Google identity and immediately accepts reads and writes through the other tools.

**Why this priority**: It closes the gap the reference leaves open — without it, a client can only work on files a human created first.

**Independent Test**: Call `create_spreadsheet` with a title, then call `get_spreadsheet` and `update_values` with the returned ID. The new file is visible and writable.

**Acceptance Scenarios**:

1. **Given** a usable Account, **When** `create_spreadsheet` is called with a title, **Then** a new spreadsheet exists with that title and the response carries its ID and URL.
2. **Given** `create_spreadsheet` is called with no title, **When** the call succeeds, **Then** the file is created with the provider's default title.
3. **Given** the ID returned by a create call, **When** the client immediately reads or writes through the other tools, **Then** the new file is usable with no extra step.
4. **Given** an Account without the Sheets write scope, **When** `create_spreadsheet` is called, **Then** the usual reauthorization error is returned and no file is created.

---

### User Story 3 - Write values and formulas into a range (Priority: P3)

The operator's client writes a 2D block of plain values into a range and, separately, writes formulas into another range. The sheet reflects both immediately and the response is the provider's own update result.

**Why this priority**: Writing turns the MCP from a viewer into a working tool, while still staying inside the six documented tools.

**Independent Test**: With one usable Account, call `update_values` with a 2×2 block, then `update_formulas` with `=A1+B1` in a cell. Re-read both ranges with `get_values` and see the written values and the computed formula result.

**Acceptance Scenarios**:

1. **Given** a valid range, **When** `update_values` receives booleans, strings and numbers, **Then** each cell holds the supplied value and the response reports the provider's update result.
2. **Given** a cell value of `null` in the 2D array, **When** `update_values` runs, **Then** that cell is skipped; an empty string writes an empty value.
3. **Given** formula strings such as `=A1+B1`, **When** `update_formulas` runs, **Then** the cells hold formulas that the spreadsheet evaluates, not literal text.
4. **Given** a range that does not exist in the spreadsheet, **When** either write tool runs, **Then** the tool returns an error naming the provider's reason and the sheet is unchanged.

---

### User Story 4 - Apply structural and formatting changes in one batch (Priority: P4)

The operator's client applies one or more spreadsheet updates in a single call: adding or deleting a sheet, resizing or hiding rows and columns, formatting cells, merging, sorting, filters, charts, comments and the rest of the documented request list. A separate shortcut inserts rows or columns at an index.

**Why this priority**: This is the long tail of Sheets work; it makes the MCP match Google's tool surface instead of a hand-picked subset.

**Independent Test**: With one usable Account, call `update_spreadsheet` with an `addSheet` request and a `repeatCell` request in one batch, then read the spreadsheet and see both effects. Call `insert_dimension` to add two rows above row 1 and see the gap in the grid.

**Acceptance Scenarios**:

1. **Given** a batch with several valid requests, **When** `update_spreadsheet` runs, **Then** the requests are applied in the order given and the response is the provider's batch result.
2. **Given** a batch where one request is invalid, **When** `update_spreadsheet` runs, **Then** no request in that batch is applied and the tool returns an error.
3. **Given** `writeControl.requiredRevisionId` names an older revision, **When** the batch runs, **Then** the write is rejected and the sheet is unchanged.
4. **Given** a sheet ID, dimension, and a 0-based start/end index, **When** `insert_dimension` runs, **Then** the requested rows or columns are inserted and `inheritFromBefore: true` is rejected when the start index is 0.
5. **Given** a request for a spreadsheet or sheet the Account cannot access, **When** any write tool runs, **Then** the tool returns the provider's reason and no partial change is visible.

---

### Edge Cases

- **Account unusable**: the named Account (or the default) is missing, revoked or needs reauthorization — the call fails with an error naming the slug and the admin page; another Account is never used instead.
- **Unknown account slug**: the error lists the available slugs for `sheets`.
- **Spreadsheet not found or not shared**: the provider's not-found/forbidden reason is surfaced, without tokens, headers or raw provider bodies.
- **Range outside the grid**: `get_values`/`update_values` with an impossible A1 range fails with the provider's range error.
- **Malformed values**: values that are not booleans, strings or numbers, or a jagged 2D array, are rejected before any write.
- **Empty batch**: `update_spreadsheet` with an empty `requests` array is a no-op or a provider-validated error, never a silent destructive call.
- **Large grid dump**: `includeGridData: true` on a big spreadsheet returns a large response; the gateway adds no pagination or silent truncation the reference tools do not have.
- **Field masks**: hierarchical masks such as `sheets.properties.sheetId` are passed through; an unknown field produces the provider's error.
- **Scope drift**: an existing Google Account for `calendar` cannot be reused for `sheets`; a `sheets` Account granted only readonly scopes is reported as unusable and is never written through.
- **Create placement**: a new file lands in the Account's My Drive root. Placing it in a folder, moving, copying, trashing, listing or sharing files is out of scope and MUST NOT trigger a Drive scope request.
- **Create collisions**: a duplicate title creates a separate file and never overwrites an existing one; an empty title is treated as omitted.
- **Create without scope**: an Account lacking the Sheets write scope fails before any call and no partial file is left behind.
- **Existing MCPs**: adding `sheets` does not change the tool names, accounts or behavior of `calendar` and `notes`.

## Requirements *(mandatory)*

### Functional Requirements

**Availability and identity**

- **FR-001**: The gateway MUST expose a third MCP at `/mcps/sheets`, using the Google Provider that already serves `calendar`.
- **FR-002**: A `sheets` Account MUST be a Google identity that granted the Sheets write scope plus the identity scopes needed to label the Account; a readonly-only grant MUST NOT be stored as usable.
- **FR-003**: Every `sheets` tool MUST accept an optional `account` slug and otherwise use the MCP's Default Account, with the failure behavior and error wording the other MCPs already use.
- **FR-004**: The provider/MCP pairing MUST allow `sheets` with Google only, and the existing `calendar`/Google and `notes`/Microsoft pairings MUST keep working.
- **FR-005**: The admin area MUST list, add, reauthorize, set-default and revoke `sheets` Accounts exactly as it does for the other MCPs.

**Tool surface**

- **FR-006**: `tools/list` for `sheets` MUST contain exactly these tool names in this order: `get_values`, `get_spreadsheet`, `update_spreadsheet`, `update_values`, `update_formulas`, `insert_dimension`, `create_spreadsheet`, `list_accounts`. No other tool, resource or prompt is added.
- **FR-007**: Each of the six Google tools' input schema MUST match the reference Input Schema exactly: the same field names (camelCase), types, required flags, enum members (including `DIMENSION_UNSPECIFIED`) and documented defaults. The only permitted addition is the optional `account` field from FR-003.
- **FR-008**: `get_values` MUST require `spreadsheetId` and `range` and return the range plus a row-major 2D array, omitting empty trailing rows and columns.
- **FR-009**: `get_spreadsheet` MUST require `spreadsheetId` and support `includeGridData` (default false), `fields` (hierarchical field masks), `ranges` and `commentsIncluded` (default false); with no ranges it MUST return the whole spreadsheet.
- **FR-010**: `update_spreadsheet` MUST require `spreadsheetId` and `requests`, accept any documented spreadsheets.batchUpdate request object in `requests`, accept optional `writeControl.requiredRevisionId`, apply requests in order, and apply none when any request is invalid.
- **FR-011**: `update_values` MUST require `spreadsheetId`, `range` and a 2D `values` array, accept booleans, strings and numbers, skip `null` cells and treat an empty string as an empty value.
- **FR-012**: `update_formulas` MUST require `spreadsheetId`, `range` and a 2D `formulas` array of formula strings that the spreadsheet evaluates as formulas.
- **FR-013**: `insert_dimension` MUST require `spreadsheetId`, `sheetId`, `dimension`, `startIndex` and `endIndex`, and accept optional `inheritFromBefore`, using 0-based, end-exclusive indexes.
- **FR-014**: Tool annotations (read-only, idempotent, destructive, open-world) MUST be reported exactly as the reference documents them for each of the six tools.
- **FR-015**: Tool results MUST use the reference output shape: `get_values` returns the provider's `ValueRange` directly; the other tools wrap the provider's Sheets JSON in a `content` object, and write responses add the `status` field the reference mentions, JSON-encoded as the other MCPs already do.
- **FR-021**: `create_spreadsheet` — the one tool deliberately outside the reference — MUST accept only an optional `title` and create a new spreadsheet through the Sheets API alone, returning the new `spreadsheetId` and `spreadsheetUrl` in the same `content` envelope.
- **FR-022**: `create_spreadsheet` MUST work with the `spreadsheets` scope already required by FR-002; the gateway MUST NOT request, store or depend on a Google Drive scope, and renaming a spreadsheet's title MUST stay covered by `update_spreadsheet` rather than a separate tool.

**Safety and behavior**

- **FR-016**: A write tool MUST NOT report success unless the provider accepted the write, and MUST NOT retry a non-idempotent write in a way that could duplicate it.
- **FR-017**: Provider error text returned to a client MUST be a short single-line summary that never includes tokens, authorization headers, client secrets or full provider response bodies.
- **FR-018**: Credentials for `sheets` Accounts MUST be encrypted at rest and handled under the same rules as every other Account, and MUST never be readable by the spreadsheet tool code or by an admin page.
- **FR-019**: Read tools MUST NOT mutate spreadsheet content or metadata; `get_spreadsheet` with `commentsIncluded` only reads.
- **FR-020**: Existing `calendar` and `notes` behavior, stored Accounts and admin flows MUST be unchanged, and the gateway's list of advertised MCPs MUST stay consistent with the MCPs it can actually serve.

### Tool Contract (reference surface plus one addition)

| Tool | Required input | Optional input | Read-only / idempotent |
|------|----------------|----------------|------------------------|
| `get_values` | `spreadsheetId`, `range` | — | yes / yes |
| `get_spreadsheet` | `spreadsheetId` | `includeGridData`, `fields[]`, `ranges[]`, `commentsIncluded` | yes / yes |
| `update_spreadsheet` | `spreadsheetId`, `requests[]` | `writeControl.requiredRevisionId` | no / no |
| `update_values` | `spreadsheetId`, `range`, `values[][]` | — | no / no |
| `update_formulas` | `spreadsheetId`, `range`, `formulas[][]` | — | no / no |
| `insert_dimension` | `spreadsheetId`, `sheetId`, `dimension`, `startIndex`, `endIndex` | `inheritFromBefore` | no / no |
| `create_spreadsheet` (addition) | — | `title` | no / no |

The six Google tools are open-world; only `get_values` and `get_spreadsheet` are read-only and idempotent. `dimension` is `ROWS`, `COLUMNS` or `DIMENSION_UNSPECIFIED`. `create_spreadsheet` follows the same camelCase naming and `content` envelope as the Google tools, and creates a file through the Sheets API only.

### Key Entities *(include if data involved)*

- **Sheets Account**: A Google identity authorized for the `sheets` MCP's required scope set, with a slug, a usability state and a default flag; belongs to exactly one MCP.
- **Spreadsheet**: A Google spreadsheet addressed by its ID; has a title, sheets and grid properties, and may have cell data and comments. A spreadsheet is created by `create_spreadsheet` or outside the gateway.
- **Sheet**: A tab inside a spreadsheet, addressed by a numeric sheet ID, with a title, index, grid and display properties.
- **Range**: An A1 or R1C1 range string for value operations, or a grid/dimension range object (sheet ID plus 0-based start/end indexes) for structural operations.
- **Batch update request**: One documented spreadsheets.batchUpdate request object (properties, dimensions, cells, merges, filters, charts, comments, data sources, tables, developer metadata and the rest), applied in list order as one atomic batch.
- **Value block / formula block**: A row-major 2D array written into a range; values are booleans, strings or numbers, formulas are formula strings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can authorize a Google Account for `sheets` and complete a first successful read in under 2 minutes, with no new setup step beyond the existing Google credentials.
- **SC-002**: 100% of the six tools' names, required fields, optional fields, enum members and defaults match the published reference Input Schemas, verified by a schema comparison in the test suite.
- **SC-003**: A client listing tools sees exactly the eight expected tools, in the documented order, with no extras.
- **SC-004**: A range read returns the same values as the spreadsheet shows, including the omitted trailing empty rows/columns rule, in one call.
- **SC-005**: A written value or formula block is visible on the next read of the same range, with no extra refresh step.
- **SC-006**: A batch containing one invalid request leaves the spreadsheet byte-for-byte unchanged, observed by a read after the failure.
- **SC-007**: Every unusable-Account and provider-permission failure returns an actionable one-line message; zero credential values appear in any tool result or log.
- **SC-008**: Existing `calendar` and `notes` accounts and tool calls continue to pass their current tests unchanged.
- **SC-009**: A create call returns an ID and URL, and the new file is readable and writable through the other tools within the same client session.

## Assumptions

- The six published tool pages are the contract; the Developer Preview `tools/list` endpoint is not reachable without preview access, so no captured schema is available.
- The per-tool Input Schema (camelCase) is authoritative over the summary table's snake_case, per the clarification above.
- The gateway's optional `account` field, its `list_accounts` tool and `create_spreadsheet` are the only deviations from the reference; `create_spreadsheet` exists because the user asked for file creation, which the reference does not offer.
- `update_spreadsheet.requests[]` items are passed through as provider request objects, so the full documented request list is supported without one tool per request type.
- The `status` field in write responses is whatever the provider supplies; the reference does not publish its enum, so the gateway does not invent one.
- Only the `https://www.googleapis.com/auth/spreadsheets` scope is requested for Sheets access; Drive scopes are not added, because every tool including `create_spreadsheet` works with the Sheets scope alone.
- `create_spreadsheet` sets only the title; locale, time zone, initial tabs and folder placement are provider defaults, and the gateway does not add fields for them.
- The readonly-only access mode is out of scope for v1: the MCP asks for write access so every tool works, matching the other MCPs' single required scope set.
- No pagination, caching or response truncation is added, because the reference tools define none.
- The single-operator, Cloudflare Access perimeter and existing admin UI are reused unchanged.
