# One Google transport for calendar and sheets

**Context.** `packages/calendar` and `packages/sheets` both call Google over plain `fetch`
with the same ~60-line `GoogleRequest`/`GoogleApiError`/`providerErrorCode` code: URL
building, the bearer token from `McpContext`, exactly one forced refresh and retry on a 401,
and error mapping that never surfaces a raw Provider body. The plan for `002-sheets-mcp`
accepted that duplication as the price of ADR-0006, but every transport bug then had to be
fixed twice and SonarCloud's new-code duplication gate failed the Sheets PR.

**Decision.** Add `packages/google-api` (`@mcp-gateway/google-api`) containing only the
shared Google HTTP transport: `GOOGLE_ROOT_URL`, `QueryValue`, `RequestOptions`,
`GoogleApiError`, `GoogleRequest` and `providerErrorCode`. It depends on
`@mcp-gateway/common` for the `McpContext` type and on nothing else. Endpoint resource
classes (`CalendarListResource`, `EventsResource`, `SpreadsheetsResource`, `ValuesResource`,
`GoogleCalendarClient`, `GoogleSheetsClient`) stay in their MCP packages, because those are
the Provider surface each MCP owns. `calendar` and `sheets` import the transport and
re-export it, so their existing imports keep working.

The shared MCP test harness lives in `packages/test-support` for the same reason, from the
other direction: MCP packages never import each other, so a test-only package both can
depend on is the only shared home that does not couple `calendar`, `notes` and `sheets`.

**Consequences.** A transport fix lands once. The Provider-specific code is still isolated
from `common` (ADR-0008), which remains Provider-agnostic. The deliberate-duplication note in
`specs/002-sheets-mcp/plan.md` is superseded: the shared transport is not a violation, it is
the rule. Adding another Google MCP now means a new package plus endpoint classes, not a
third copy of the transport.
