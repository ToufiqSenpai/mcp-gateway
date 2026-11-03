# MCP servers are libraries, not Workers

`packages/calendar` and `packages/notes` export `createServer(ctx)` and are never deployed on their own. They receive a narrow `McpContext` — `listAccounts()` and `getAccessToken(slug)` — and import no D1 binding, no `arctic`, and no encryption code. Accounts, Credentials, refresh and the MCP registry all live in `packages/web`, the single Worker entry.

**Consequences.** Each MCP package is testable in a plain Node pool with no database and no network, which is where tool-handler and response-mapping tests live. The registry (`packages/web/src/mcps/registry.ts`) is the only list of MCPs, and a test asserts its keys equal the `mcp` CHECK enum so adding an MCP without a migration fails in CI. Adding an MCP is a deploy of the one Worker, never a second deployment.

**Considered Options.** One Worker per MCP would isolate blast radius and let each MCP scale independently, but it would duplicate the account, credential and admin machinery or force a shared service between Workers. Rejected for a single-user gateway: the boundary that matters is the package interface, not the deployable.
