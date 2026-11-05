# One Google base class for calendar and sheets

**Context.** `packages/calendar` and `packages/sheets` both call Google over plain `fetch`
with the same ~60-line `GoogleRequest`/`GoogleApiError`/`providerErrorCode` code: URL
building, the bearer token from `McpContext`, exactly one forced refresh and retry on a 401,
and error mapping that never surfaces a raw Provider body. The plan for `002-sheets-mcp`
accepted that duplication as the price of ADR-0006, but every transport bug then had to be
fixed twice and SonarCloud's new-code duplication gate failed the Sheets PR.

**Decision.** Add `packages/google` (`@mcp-gateway/google`) containing the shared Google HTTP
transport as one base class, `Google`: `GOOGLE_ROOT_URL`, `QueryValue`, `RequestOptions`,
`GoogleApiError`, `Google` and `providerErrorCode`. It depends on `@mcp-gateway/common` for the
`McpContext` type and on nothing else. Each Google MCP derives its typed endpoint surface from
that class — `GoogleCalendar` and `GoogleSheets` add methods such as `listEvents` and
`getValues` — so there are no separate resource sub-clients. `calendar` and `sheets` import the
base and re-export it, so their existing imports keep working.

The shared MCP test harness lives in `packages/test` (`@mcp-gateway/test`) for the same reason,
from the other direction: MCP packages never import each other, so a test-only package both can
depend on is the only shared home that does not couple `calendar`, `notes` and `sheets`. It
drives each server through `@modelcontextprotocol/client` over `InMemoryTransport`, so a test
exercises the same handshake a real Host does instead of hand-rolling JSON-RPC.

**Consequences.** A transport fix lands once. The Provider-specific code is still isolated
from `common` (ADR-0008), which remains Provider-agnostic. The deliberate-duplication note in
`specs/002-sheets-mcp/plan.md` is superseded: the shared transport is not a violation, it is
the rule. Adding another Google MCP now means a new package with one class deriving `Google`,
not a third copy of the transport.
