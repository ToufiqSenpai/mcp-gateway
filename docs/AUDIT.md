# Code audit — remaining findings

- **Date:** 2026-11-04
- **Scope:** the whole repo, audited in the working tree (including the uncommitted
  `packages/common` split), not at a commit.
- **Assumed load:** one operator, a handful of Accounts, a few MCP clients. Findings are
  judged against that, not against a multi-tenant service.
- **Status:** findings 1 and 2 are fixed. This file tracks the rest; IDs match the audit
  report and are not renumbered.

## Fixed during this audit

1. `packages/calendar/src/resources.ts` — `resources/read` no longer maps every failure to
   "not found". Only a Provider 404 is `-32602`; 401/403 is `-32603` naming the Account; an
   unusable Account or a 5xx is rethrown. The dead client `try/catch` is gone (also in
   `packages/notes/src/resources.ts`).
2. `packages/common/src/tools.ts`, `packages/common/src/tools/registry.ts` and the list tools
   — a skipped Account now reaches the client as
   `_meta["mcp-gateway/skippedAccounts"]` instead of only a generic `truncated: true`.
   Covered by two tests in `packages/web/test/integration/resources.test.ts`.

## Should fix

### 3. Dead code that can be deleted

**Where:** `packages/web/src/accounts/lifecycle.ts:L16,L73-75`;
`packages/calendar/src/index.ts:L10`; `packages/notes/src/index.ts:L10`;
`packages/calendar/src/client.ts:L10-13,L204-206,L209-216`;
`packages/common/src/context.ts:L20`; `packages/web/src/mcps/cache.ts:L9,L46`;
`packages/calendar/src/resources.ts:L137-146`; `packages/notes/src/resources.ts:L104-113`.

**Problem:** Nothing calls these: `AccountService.decryptAccessToken`, the
`UnusableAccountError`/`UnusableReason` re-export, `REQUIRED_SCOPE_STRING` (both packages),
`ProviderFailure` and its fallback in `providerErrorCode` (only `GoogleApiError` is ever
thrown there), the `googleCalendar()` wrapper, the `cached` result flag, `fetchedAt` in the
KV value, and the `list:` callback on both `ResourceTemplate`s — `buildServer` replaces the
SDK's `resources/list` handler, so those callbacks never run.

**Fix:** Delete them. `new ResourceTemplate(uri)` without options is enough.

**If skipped:** Readers chase code that cannot run, and the next change to the skipped-Account
warning gets made in the dead copy.

### 4. The calendar tool logic has no tests

**Where:** `packages/calendar/src/tools/suggest-time.ts`,
`packages/calendar/src/tools/update-event.ts`, `packages/calendar/src/map.ts`.

**Problem:** Calendar only has contract tests for tool names and schemas. `suggest_time` is
the most complex code in the repo (busy-interval merging, weekend/hour filters, time zones),
and `update_event`'s attendee/attachment deltas and duration preservation are equally
untested. Invert `busy.some(...)` to `busy.every(...)` at `suggest-time.ts:L130` and every
test still passes.

**Fix:** One unit test per behaviour with a stubbed client: a busy interval excludes
overlapping slots, `excludeWeekends` drops Saturday, only `startTime` keeps the old duration,
removing an attendee keeps the others.

**If skipped:** A scheduling bug ships silently.

### 5. `suggest_time` treats "cannot read attendee's calendar" as "free"

**Where:** `packages/calendar/src/tools/suggest-time.ts:L101-109`.

**Problem:** Only `calendars[*].busy` is read. When an attendee's calendar is not shareable,
Google returns a `calendars[email].errors` entry and no busy periods, so that slot is
proposed as free.

**Fix:** If any `calendars[*].errors` is non-empty, fail naming the email, or surface it as a
`_meta` warning. Never claim free on unknown data.

**If skipped:** The tool confidently suggests a time when someone is busy.

### 6. `Event` output is missing two documented fields

**Where:** `packages/calendar/src/map.ts:L37-62,L118-149`.

**Problem:** `toEvent` maps `transparency`, `visibility` and `overrideReminders`, but not
`availability` or `guestPermissions`, both listed on `Event` in SPEC §12.1. `create_event`
takes them as input and returns an Event without them, so the caller cannot confirm what was
set; it only sees `transparency`, which the spec calls deprecated.

**Fix:** Derive `availability` from `raw.transparency` (`transparent` → `AVAILABILITY_FREE`,
`opaque` → `AVAILABILITY_BUSY`) and `guestPermissions` from the three `guestsCan*` booleans.

**If skipped:** The published tool surface does not match the spec it claims to mirror.

### 7. Expired OAuth attempts are never deleted

**Where:** `packages/web/src/db/account-repository.ts:L159-161` (the only definition),
`packages/web/src/accounts/lifecycle-oauth.ts:L130` (where a flow starts).

**Problem:** `deleteExpiredOAuthStates` exists but nothing calls it, while SPEC §6 and
RUNBOOK §9 both say abandoned `oauth_states` rows are cleaned "at the next flow". Start a
flow, close the tab, repeat: rows accumulate forever.

**Fix:** Call `await repository.deleteExpiredOAuthStates()` at the top of
`OAuthFlowService.start`, or delete the method and the two doc claims.

**If skipped:** A table that only grows, and docs that describe behaviour that does not exist.

### 8. Exactly 1000 items is reported as truncated

**Where:** `packages/notes/src/client.ts:L124-132`.

**Problem:** `collect` stops when `items.length >= FETCH_CAP` and sets `truncated` from the
same count. If the last page brings the total to exactly 1000 and there is no
`odataNextLink`, the result says `truncated: true` even though nothing was cut.
`collectPages` in the calendar package gets this right.

**Fix:** Set `truncated` only when the cap stopped a page that had a next link, or compare
after slicing.

**If skipped:** Callers paginate forever or warn about data that is complete.

### 9. A bad client secret is treated as "reauth needed"

**Where:** `packages/web/src/accounts/refresh.ts:L23-26`.

**Problem:** `isPermanentRefreshFailure` includes `invalid_client`. That code means the
Worker's OAuth client id/secret is wrong or rotated; the Account is demoted to
`needs_reauth` and the admin is told to reauth, which fails the same way. SPEC §10 lists only
`invalid_grant` and Microsoft's `interaction_required`.

**Fix:** Remove `"invalid_client"` from the list. The failure then records `last_error` and
leaves the state alone, which points at the real problem.

**If skipped:** Every Account is demoted after a secret rotation and the documented repair
does not work.

### 10. Guest permissions are built by two near-copies

**Where:** `packages/calendar/src/tools/create-event.ts:L19-28`,
`packages/calendar/src/tools/update-event.ts:L18-26`.

**Problem:** `permissionsToBody` and `permissionPatch` map the same three enum values to
Google's `guestsCan*` fields, and `guestPermissionsSchema` is declared in both files. They
already differ (one always writes all three booleans, the other only writes `true`).

**Fix:** One exported `guestPermissionsSchema` and one `guestPermissions(perms)` helper used
by both tools.

**If skipped:** Two copies that must change together and do not.

### 11. The `account` argument is declared six times in `notes`

**Where:** `packages/notes/src/tools/lists.ts:L22-26` plus inline copies in
`create-page.ts:L38`, `get-page.ts:L29`, `update-page.ts:L34`, `writes.ts:L12,L28,L64`,
`search-pages.ts:L18`. The `cursor` schema is duplicated the same way.

**Problem:** Only `lists.ts` has the described `accountSchema`; the other tools use bare
`z.string().optional()`, so the wire schema differs by tool. The calendar package already
centralises this in `schemas.ts`.

**Fix:** Export `accountSchema` and `cursorSchema` from one notes module and use them
everywhere.

**If skipped:** Every schema description change misses several tools.

### 12. The "(write)" label keeps its own copy of tool metadata

**Where:** `packages/web/src/views/test-tool.tsx:L19-29,L57`.

**Problem:** A hardcoded `WRITE_TOOLS` set duplicates the `readOnlyHint` / `destructiveHint`
annotations the tool definitions already carry. A new write tool shows without "(write)" and
nothing fails.

**Fix:** Read `tool.annotations` instead of the set.

**If skipped:** A destructive tool looks like a read tool in the panel that runs it.

### 13. A prompt accepts an Account slug it never checks

**Where:** `packages/calendar/src/prompts.ts:L31-46`.

**Problem:** `PromptContext.resolve` returns any `account` string, while
`ToolContext.resolve` validates it against `listAccounts`. `plan_day` with
`account: "personl"` renders instructions for a non-existent Account.

**Fix:** Share the lookup: if the slug is not in `listAccounts()`, throw
`ProtocolError(InvalidParams, …)`. That also deletes the duplicated default lookup.

**If skipped:** Prompt output sends the model after an Account that cannot work.

## Nice to have

### 14. Resource URIs with bad percent-encoding answer -32603

**Where:** `packages/calendar/src/resources.ts:L25`,
`packages/notes/src/resources.ts:L32`.

**Problem:** `decodeURIComponent` is unguarded. `notes://personal/notebooks/%ZZ` throws
`URIError`, which the SDK turns into an internal error; SPEC says a bad URI is `-32602` with
`data.uri`.

**Fix:** Wrap the decode and throw `ProtocolError(InvalidParams, …)`.

### 15. `list_accounts` is written twice, byte for byte

**Where:** `packages/calendar/src/tools/list-accounts.ts:L7`,
`packages/notes/src/tools/lists.ts:L32-42`.

**Problem:** Same title, description, schema and handler. Changing the wording or shape
means two edits and two contract tests.

**Fix:** Export one tool factory from `@mcp-gateway/common` and spread it into both arrays.

### 16. SPEC describes files that no longer exist

**Where:** `docs/SPEC.md:L7,L167,L182,L187`.

**Problem:** The status line still says "nothing implemented"; the layout lists
`mcps/context.ts` (deleted, moved to `packages/common`) and `tools/registry.ts` inside each
package (it is in `common`).

**Fix:** Update those four lines.

### 17. `gaxios` is a direct dependency nothing imports

**Where:** `packages/calendar/package.json:L15`.

**Problem:** The only match for `gaxios` in the package is the dependency line itself.
`@googleapis/calendar` → `googleapis-common` already brings its own copy.

**Fix:** Remove it and run `pnpm typecheck && pnpm test` to confirm resolution still works.

## Not checked

Real Google and Graph APIs (all Provider I/O is stubbed); `specs/`, `docs/adr/`, the
2,000-line custom oxlint plugin, `test/support/providers.ts` in full, and `pnpm-lock.yaml`.
A few smaller nits are omitted.

**Lean:** about -90 lines and -1 dependency possible from findings 3, 10, 11, 12 and 15–17.
