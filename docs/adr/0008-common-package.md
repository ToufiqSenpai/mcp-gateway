# A shared common package for the MCP framework

`calendar` and `notes` duplicated the same tool framework: the `McpContext`/`CursorCodec`
contract, `defineTool`, `ToolResult`, offset pagination, `ToolRegistry`, the per-account
listing loop, and the server assembly (cache hints, the `resources/list` override, stripping
`listChanged`). `web` mirrored the context interface only so a contract test could prove the
two sides had not drifted. ADR-0006 and ADR-0007 accepted that duplication to keep the
packages independent; the cost was fixing every framework bug twice.

**Decision.** Add `packages/common` (`@mcp-gateway/common`). It owns:

- `McpContext`, `CursorPayload`, `CursorCodec`
- `defineTool`, `ToolResult`, `paginate`, `collectAcrossAccounts` and their types
- `ToolContext`, the base carrying account resolution, selection and enumeration
- `ToolRegistry`
- `McpServerBuilder` plus the `ResourceListing` / `ResourceSource` contract

It owns nothing Provider-specific: clients, mappers, Zod schemas, prompts, resource
registries, OAuth and D1 all stay in their packages. `common` imports only `zod` and
`@modelcontextprotocol/server`, so it runs unchanged in workerd and Node.

Packages extend the base and keep their own wire vocabulary: `calendar` exposes
`pageToken`/`pageSize`, `notes` exposes `cursor`. The shared paginator moves offsets and
knows neither name.

**Consequences.** `web` imports the context contract from `common`, so the mirrored-interface
assertion in `registry.test.ts` is deleted and the boundary is checked by the compiler.
One behavior changed deliberately: an explicit Account slug the MCP does not have is an
error instead of a silent empty listing. Tool names, JSON payloads, scopes and the schema are
unchanged. The "a shared kit would couple the packages" consequence of ADR-0006/0007 is
superseded: the two packages now change together by design.
