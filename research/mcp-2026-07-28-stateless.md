# MCP `2026-07-28` — Stateless Server Conformance Checklist

**Target:** stateless MCP server on Cloudflare Workers, no session state, no Durable Object.
**Endpoints:** `/mcps/calendar`, `/mcps/onenote` — each is a **separate MCP endpoint** and therefore a separate MCP *server* for discovery purposes.
**Source of truth:** `https://github.com/modelcontextprotocol/specification/blob/main/schema/2026-07-28/schema.ts`. Prose pages are cited per item; where prose and schema disagree, the schema wins.

Legend: `MUST` / `MUST NOT` are normative per BCP 14 ([spec overview](https://modelcontextprotocol.io/specification/2026-07-28/)). Items marked **⚠** are ambiguous or unachievable for a stateless deployment — see §14.

---

## 0. Baseline: what changed from 2025-11-25

- [ ] **0.1** No `initialize` / `notifications/initialized` handshake exists. Version, identity, and capabilities are per-request. — [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog#major-changes)
- [ ] **0.2** No protocol-level sessions, no `Mcp-Session-Id`, no HTTP `GET` stream, no `Last-Event-ID` resumability. — [streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [ ] **0.3** No server-initiated JSON-RPC requests, ever. Sampling / elicitation / roots go through MRTR only. — [patterns](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns)
- [ ] **0.4** `ping`, `logging/setLevel`, `notifications/roots/list_changed`, `resources/subscribe`, `resources/unsubscribe` do not exist. Unknown methods ⇒ `404` + `-32601`. — [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog#major-changes)
- [ ] **0.5** Every result carries a required `resultType`. — [basic/index#responses](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#responses)

---

## 1. `server/discover` and capability advertisement

Reference: [server/discover](https://modelcontextprotocol.io/specification/2026-07-28/server/discover), [schema#discoverresult](https://modelcontextprotocol.io/specification/2026-07-28/schema#discoverresult), [schema#servercapabilities](https://modelcontextprotocol.io/specification/2026-07-28/schema#servercapabilities).

- [ ] **A1** `server/discover` is implemented and answers on **every** endpoint. Servers **MUST** implement it. — [versioning#protocol-version-negotiation](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning#protocol-version-negotiation)
- [ ] **A2** Request is accepted with `params` containing only `_meta`. No other params. — [discover#request](https://modelcontextprotocol.io/specification/2026-07-28/server/discover#request)
- [ ] **A3** Response has `resultType: "complete"`. — [schema#result](https://modelcontextprotocol.io/specification/2026-07-28/schema#result)
- [ ] **A4** `supportedVersions` is present and includes `"2026-07-28"`. If the gateway is modern-only, it is exactly `["2026-07-28"]`. — [schema#discoverresult](https://modelcontextprotocol.io/specification/2026-07-28/schema#discoverresult)
- [ ] **A5** `capabilities` is present and is an object (`{}` is valid when nothing is offered). — [schema#discoverresult](https://modelcontextprotocol.io/specification/2026-07-28/schema#discoverresult)
- [ ] **A6** `ttlMs` is present and `>= 0`. **Required**, inherited from `CacheableResult`. — [schema#cacheableresult](https://modelcontextprotocol.io/specification/2026-07-28/schema#cacheableresult)
- [ ] **A7** `cacheScope` is present and is `"public"` or `"private"`. **Required.** Use `"public"` only if the advertised capability set is identical for every caller. — [caching#cache-scope-field](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching#cache-scope-field)
- [ ] **A8** `_meta["io.modelcontextprotocol/serverInfo"]` is present (`{name, version}`). **SHOULD**, not MUST — but a gateway should always emit it. — [discover#discoverresult](https://modelcontextprotocol.io/specification/2026-07-28/server/discover#discoverresult)
- [ ] **A9** `instructions` is optional; if present it is natural-language guidance, not a place to hide normative rules. — [discover#discoverresult](https://modelcontextprotocol.io/specification/2026-07-28/server/discover#discoverresult)

### Capability shape

- [ ] **A10** `tools` is advertised as `{}` (or `{"listChanged": false}`) if the endpoint exposes tools. `listChanged` **MUST** be truthful — see §8. — [server/tools#capabilities](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#capabilities)
- [ ] **A11** `prompts` is advertised as `{}` (or `{"listChanged": false}`) if the endpoint exposes prompts. — [server/prompts#capabilities](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts#capabilities)
- [ ] **A12** `resources` is advertised as `{}` (no `subscribe`, no `listChanged`) unless §8 is genuinely implemented. — [server/resources#capabilities](https://modelcontextprotocol.io/specification/2026-07-28/server/resources#capabilities)
- [ ] **A13** `logging` is **not** advertised. It is deprecated and requires per-request `logLevel` opt-in. — [changelog#deprecated](https://modelcontextprotocol.io/specification/2026-07-28/changelog#deprecated)
- [ ] **A14** `completions` is advertised only if `completion/complete` is actually implemented. — [schema#servercapabilities](https://modelcontextprotocol.io/specification/2026-07-28/schema#servercapabilities)
- [ ] **A15** `extensions` is omitted or contains only extension identifiers the gateway truly supports. Keys **MUST** follow `_meta` key naming rules (mandatory prefix). — [versioning#extension-negotiation](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning#extension-negotiation)
- [ ] **A16** Declaring `tools`/`prompts`/`resources` obliges the endpoint to answer the corresponding `*/list` with the set available to *that caller*. An empty array is legal; silence is not. — [server/tools#capabilities](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#capabilities)
- [ ] **A17** The advertised set **MUST NOT** vary per-connection or as a side effect of another request. It **MAY** vary by the authorization presented on the request. — [server/tools#capabilities](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#capabilities)
- [ ] **A18** `/mcps/calendar` and `/mcps/onenote` return **different** `DiscoverResult`s (different tools, different `serverInfo.name`). There is no "gateway-wide" discovery document in the spec.

---

## 2. Per-request `_meta`

Reference: [basic/index#meta](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta), [schema](https://modelcontextprotocol.io/specification/2026-07-28/schema).

- [ ] **B1** Every request carries `params._meta` as an **object**. `RequestParams` declares `_meta` as required. — [schema](https://modelcontextprotocol.io/specification/2026-07-28/schema)
- [ ] **B2** `_meta["io.modelcontextprotocol/protocolVersion"]` is a string. **Required.** — [basic/index#meta](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta)
- [ ] **B3** `_meta["io.modelcontextprotocol/clientCapabilities"]` is an object. **Required**, even when empty (`{}`). — [basic/index#meta](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta)
- [ ] **B4** `_meta["io.modelcontextprotocol/clientInfo"]` is **optional**. Clients **SHOULD** send it; the server **MUST NOT** require it. *(Premise correction: only `protocolVersion` and `clientCapabilities` are mandatory.)* — [basic/index#meta](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta)
- [ ] **B5** Missing any required `_meta` field ⇒ JSON-RPC `-32602` (Invalid params) **and** HTTP `400 Bad Request`. — [basic/index#meta](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta)
- [ ] **B6** Unsupported `protocolVersion` ⇒ `-32022` with `data: { supported: string[], requested: string }`, HTTP `400`. — [versioning#protocol-version-negotiation](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning#protocol-version-negotiation)
- [ ] **B7** The server **MUST NOT** infer capabilities from any prior request. `clientCapabilities` is re-read on every request. — [schema#requestmetaobject](https://modelcontextprotocol.io/specification/2026-07-28/schema)
- [ ] **B8** The server **MUST NOT** rely on a capability the client did not declare. If one is genuinely required ⇒ `-32021` with `data.requiredCapabilities`, HTTP `400`. — [basic/index#meta](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta)
- [ ] **B9** `clientInfo` **MUST NOT** drive behavior or security decisions; it is self-reported and unverified. — [basic/index#meta](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta)
- [ ] **B10** Every result's `_meta` includes `io.modelcontextprotocol/serverInfo` (**SHOULD**). — [basic/index#meta](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta)
- [ ] **B11** `_meta["io.modelcontextprotocol/logLevel"]` is optional; if absent the server **MUST NOT** emit `notifications/message` for that request. — [schema#requestmetaobject](https://modelcontextprotocol.io/specification/2026-07-28/schema)
- [ ] **B12** `progressToken` (optional) opts the request into `notifications/progress`; the receiver is not obliged to emit any. — [schema#requestmetaobject](https://modelcontextprotocol.io/specification/2026-07-28/schema)
- [ ] **B13** `traceparent` / `tracestate` / `baggage` are accepted as reserved keys and passed through, not rejected by the key-name validator. — [basic/index#meta](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta)
- [ ] **B14** Gateway-specific `_meta` keys use a reverse-DNS prefix and avoid the reserved prefixes `*.modelcontextprotocol/*` and `*.mcp/*`. — [basic/index#meta](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta)
- [ ] **B15** `_meta` is **not** echoed into cache keys. Only method + result-affecting params form the cache key. — [caching#cache-key](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching#cache-key)

---

## 3. JSON-RPC envelope

Reference: [basic/index#messages](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#messages).

- [ ] **C1** `jsonrpc` is exactly `"2.0"` on every message.
- [ ] **C2** Request `id` is a string or integer and **MUST NOT** be `null`. — [basic/index#requests](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#requests)
- [ ] **C3** The server does not reuse an id for an in-flight request; responses echo the request id. — [basic/index#responses](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#responses)
- [ ] **C4** Error responses echo the id, except when the id could not be read (parse / invalid request). — [basic/index#error-responses](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#error-responses)
- [ ] **C5** Notifications carry no `id`. The server never replies to a notification. — [basic/index#notifications](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#notifications)
- [ ] **C6** Every successful result includes `resultType: "complete"` (or `"input_required"` for MRTR). Servers implementing this revision **MUST** include it. — [schema#result](https://modelcontextprotocol.io/specification/2026-07-28/schema#result)
- [ ] **C7** `resultType` values are drawn from the core set plus only those extensions advertised in `capabilities`. An unrecognized value is a client-side hard error, so inventing one breaks clients. — [basic/index#resulttype](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#resulttype)
- [ ] **C8** A request body containing a JSON-RPC **batch** is rejected: the transport requires exactly one message per POST. Return `-32600`. — [streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [ ] **C9** Error codes are integers; `message` is a concise single sentence. — [basic/index#error-responses](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#error-responses)

---

## 4. Streamable HTTP in a stateless deployment

Reference: [basic/transports/streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).

### Endpoint shape

- [ ] **D1** One MCP endpoint path per server, accepting `POST`. Here: one path per prefix, e.g. `/mcps/calendar` and `/mcps/onenote`. — [streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [ ] **D2** `GET` and `DELETE` on the MCP endpoint return `405 Method Not Allowed`. Do **not** serve a health check on the MCP path. — [streamable-http#backward-compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#backward-compatibility)
- [ ] **D3** No session ids are minted or echoed. An inbound `Mcp-Session-Id` is ignored. — [streamable-http#backward-compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#backward-compatibility)
- [ ] **D4** `Last-Event-ID` is ignored; streams are not resumable. A dropped stream loses the request. — [streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [ ] **D5** `Origin` is validated. If present and invalid ⇒ `403 Forbidden`. Absent `Origin` (server-to-server) is not an error. — [streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)

### Required request headers

- [ ] **D6** `MCP-Protocol-Version` is present on every POST. If absent ⇒ `400` + `-32020`. (The "treat missing as `2025-03-26`" allowance only applies to servers that still support pre-`2025-06-18` clients.) — [streamable-http#protocol-version-header](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#protocol-version-header)
- [ ] **D7** `MCP-Protocol-Version` **exactly matches** `_meta["io.modelcontextprotocol/protocolVersion"]`. Mismatch ⇒ `400` + `-32020`. — [streamable-http#protocol-version-header](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#protocol-version-header)
- [ ] **D8** `Mcp-Method` is present on every request and equals the body `method`. Required for compliance. — [streamable-http#request-metadata](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#request-metadata)
- [ ] **D9** `Mcp-Name` is present and matches the body for `tools/call` (`params.name`), `prompts/get` (`params.name`), `resources/read` (`params.uri`). — [streamable-http#request-metadata](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#request-metadata)
- [ ] **D10** `Mcp-Name` / `Mcp-Param-*` values in the `=?base64?…?=` sentinel form are decoded **before** comparison with the body. — [streamable-http#custom-headers-from-tool-parameters](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#custom-headers-from-tool-parameters)
- [ ] **D11** Header **names** compare case-insensitively; header **values** compare case-sensitively (except integers, compared numerically: `42.0` == `42`). — [streamable-http#server-validation](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#server-validation)
- [ ] **D12** Any header-validation failure ⇒ `400` + `-32020` `HeaderMismatch`. — [streamable-http#server-validation](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#server-validation)
- [ ] **D13** Unknown RPC method ⇒ HTTP `404 Not Found` + `-32601`. This includes `initialize`, `ping`, `logging/setLevel`, `resources/subscribe`. — [streamable-http#protocol-version-header](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#protocol-version-header)

### Bodies, `Accept`, streaming

- [ ] **D14** Request body is `Content-Type: application/json`, UTF-8, a single request or notification. — [basic/transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [ ] **D15** Clients send `Accept: application/json, text/event-stream`; the server **MUST** answer with one of `application/json` or `text/event-stream`. JSON-only is fully conformant and is the right default for this gateway. — [streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [ ] **D16** If an SSE stream is used, it carries only notifications **related to that request**, then the final response, which **SHOULD** terminate the stream. — [streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [ ] **D17** The server **MUST NOT** send an independent JSON-RPC request on any stream. — [streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [ ] **D18** When opening SSE, send `X-Accel-Buffering: no` (**SHOULD**). — [streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [ ] **D19** Closing the SSE stream is cancellation. The server **SHOULD** stop work and **MUST NOT** send further messages for that request. — [streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [ ] **D20** A notification POST that is accepted ⇒ `202 Accepted` with an empty body; if refused ⇒ `4xx` (body **MAY** be an id-less JSON-RPC error). — [streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)

### Cloudflare-specific consequences (non-normative)

- [ ] **D21** Every request is self-contained: auth, capabilities, and version come from that request only. Nothing may be memoized in module scope keyed by connection, isolate, or client.
- [ ] **D22** SSE responses need a `TransformStream` + `ReadableStream`; do not buffer the whole body before flushing.
- [ ] **D23** `subscriptions/listen` pins an isolate for the stream's lifetime. See §8 for why this is the main design hazard.

---

## 5. Caching: `ttlMs` and `cacheScope`

Reference: [server/utilities/caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching).

- [ ] **E1** `ttlMs` and `cacheScope` are present on **every** `resultType: "complete"` result of: `server/discover`, `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, `resources/read`. — [caching#cacheable-results](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching#cacheable-results)
- [ ] **E2** `ttlMs` is an integer `>= 0`. Negative values are non-conformant (clients clamp to 0). — [caching#time-to-live-ttl-field](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching#time-to-live-ttl-field)
- [ ] **E3** `ttlMs: 0` means "immediately stale" and is a legal, honest answer when the gateway cannot guarantee freshness. Prefer `0` over a fabricated TTL.
- [ ] **E4** `cacheScope` is `"public"` only when the payload contains no user-specific data and is byte-identical for every caller. — [caching#cache-scope-field](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching#cache-scope-field)
- [ ] **E5** `cacheScope` is `"private"` for any `resources/read` result derived from the caller's credentials (calendar events, OneNote pages). **`public` here is a data-leak bug**, not merely a spec violation. — [caching#security-considerations](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching#security-considerations)
- [ ] **E6** List results filtered by scope/token are `"private"`, not `"public"`. — [caching#choosing-a-cache-scope](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching#choosing-a-cache-scope)
- [ ] **E7** All pages of one paginated list use the **same** `cacheScope`. — [caching#interaction-with-pagination](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching#interaction-with-pagination)
- [ ] **E8** `ttlMs` is a freshness hint, not a promise; the server may change data earlier. Never use TTL to justify serving stale authorization-sensitive data. — [caching#time-to-live-ttl-field](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching#time-to-live-ttl-field)
- [ ] **E9** `input_required` results carry **no** caching hints. — [caching#cacheable-results](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching#cacheable-results)
- [ ] **E10** Results of an MRTR retry (request carrying `inputResponses` / `requestState`) are not cacheable. Emit `ttlMs: 0` and `cacheScope: "private"` on those. — [caching#cache-key](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching#cache-key)
- [ ] **E11** The gateway does not set HTTP `Cache-Control`/`ETag` on MCP responses as a substitute; MCP caching is expressed only in the result body. — [caching#cacheable-model](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching#cacheable-model)

---

## 6. Pagination

Reference: [server/utilities/pagination](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination).

- [ ] **F1** `nextCursor` is omitted when the result set is exhausted; its absence is the only end-of-list signal. — [pagination#response-format](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination#response-format)
- [ ] **F2** Cursors are opaque to clients. The gateway may use base64 JSON, but must not require clients to parse it. — [pagination#pagination-model](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination#pagination-model)
- [ ] **F3** A cursor that is syntactically invalid or no longer valid ⇒ `-32602` (**SHOULD**). — [pagination#error-handling](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination#error-handling)
- [ ] **F4** An empty-string cursor is a valid cursor, not end-of-list. Do not special-case it as "no cursor". — [pagination#implementation-guidelines](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination#implementation-guidelines)
- [ ] **F5** Pagination applies to `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list` only. — [pagination#operations-supporting-pagination](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination#operations-supporting-pagination)
- [ ] **F6** Returning everything in one page (no `nextCursor`) is conformant. The gateway may skip pagination entirely, but must still tolerate a `cursor` param and reject bad ones.
- [ ] **F7** Cursors are stateless: encode the offset/snapshot in the cursor itself (signed), since no server-side cursor store exists.

---

## 7. Multi Round-Trip Requests (`InputRequiredResult`)

Reference: [basic/patterns/mrtr](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr), [schema#inputrequiredresult](https://modelcontextprotocol.io/specification/2026-07-28/schema#inputrequiredresult).

- [ ] **G1** `InputRequiredResult` is only legal on `tools/call`, `prompts/get`, `resources/read`. On any other method it is forbidden. — [mrtr#supported-requests](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#supported-requests)
- [ ] **G2** `resultType` is `"input_required"`, and at least one of `inputRequests` / `requestState` is present. — [schema#inputrequiredresult](https://modelcontextprotocol.io/specification/2026-07-28/schema#inputrequiredresult)
- [ ] **G3** `inputRequests` keys are unique within the request and server-assigned. — [mrtr#server-requirements-basic-workflow](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#server-requirements-basic-workflow)
- [ ] **G4** Each `inputRequests` value is exactly one of `ElicitRequest`, `CreateMessageRequest`, `ListRootsRequest`. — [mrtr#server-requirements-basic-workflow](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#server-requirements-basic-workflow)
- [ ] **G5** No `inputRequests` type is sent that the client did not declare in `clientCapabilities` (e.g. no `elicitation/create` without `capabilities.elicitation`). — [mrtr#server-requirements-basic-workflow](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#server-requirements-basic-workflow)
- [ ] **G6** If the required capability is absent, prefer `-32021` over sending an unfulfillable `inputRequests`. — [basic/index#meta](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta)
- [ ] **G7** `requestState` is treated as attacker-controlled input. If it influences authorization, resource selection, or business logic it **MUST** be integrity-protected (HMAC/AEAD) and rejected on verification failure. — [mrtr#server-requirements-basic-workflow](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#server-requirements-basic-workflow)
- [ ] **G8** Protected state **SHOULD** embed: the authenticated principal, a short expiry, and a digest of method + salient params. — [mrtr#server-requirements-basic-workflow](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#server-requirements-basic-workflow)
- [ ] **G9** State that must be redeemed at most once **MUST** be enforced server-side. See **⚠ X8** — impossible without shared storage. — [mrtr#server-requirements-basic-workflow](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#server-requirements-basic-workflow)
- [ ] **G10** The server **MUST NOT** assume the client will fulfil or retry; it may return `InputRequiredResult` again on a later attempt. — [mrtr#server-requirements-basic-workflow](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#server-requirements-basic-workflow)
- [ ] **G11** On retry, `inputResponses` and `requestState` are top-level `params` siblings of `arguments`, not nested inside `arguments`. — [server/tools#input-required-tool-results](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#input-required-tool-results)
- [ ] **G12** The retry uses a **different** JSON-RPC `id` from the original request. — [mrtr#client-requirements-basic-workflow](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#client-requirements-basic-workflow)
- [ ] **G13** Unrecognized `inputResponses` entries are ignored, not rejected. — [mrtr#error-handling](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#error-handling)
- [ ] **G14** Missing-but-necessary information ⇒ a new `InputRequiredResult` (**SHOULD**), not an error. — [mrtr#error-handling](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#error-handling)
- [ ] **G15** A stateless gateway that never needs client input simply never emits `InputRequiredResult`. That is conformant: MRTR is `MAY` for servers. — [mrtr#server-requirements-basic-workflow](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#server-requirements-basic-workflow)

---

## 8. `subscriptions/listen` and `listChanged`

Reference: [basic/patterns/subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions).

- [ ] **H1** If `subscriptions/listen` is supported, the **first** message on the stream is `notifications/subscriptions/acknowledged`, carrying `_meta["io.modelcontextprotocol/subscriptionId"]` equal to the `subscriptions/listen` request's JSON-RPC `id`. No notification may precede it. — [subscriptions#acknowledgment](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions#acknowledgment)
- [ ] **H2** The ack's `notifications` object is the **subset** the server agreed to honor; unsupported types are omitted. `{}` is legal. — [subscriptions#acknowledgment](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions#acknowledgment)
- [ ] **H3** The server **MUST NOT** send a notification type the client did not request. — [subscriptions#opening-a-stream](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions#opening-a-stream)
- [ ] **H4** Every notification on the stream carries `_meta["io.modelcontextprotocol/subscriptionId"]`. — [subscriptions#receiving-notifications](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions#receiving-notifications)
- [ ] **H5** Filter fields are `toolsListChanged`, `promptsListChanged`, `resourcesListChanged`, `resourceSubscriptions` (string[] of URIs). All optional; omitted = not subscribed. — [subscriptions#notification-filter](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions#notification-filter)
- [ ] **H6** `notifications/resources/updated` carries `params.uri` plus the subscription id. — [server/resources#subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/server/resources#subscriptions)
- [ ] **H7** Server-initiated teardown **SHOULD** be preceded by a successful `subscriptions/listen` result (graceful closure), then stream close. — [subscriptions#graceful-closure](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions#graceful-closure)
- [ ] **H8** Client cancellation on HTTP = close the SSE stream. `notifications/cancelled` is stdio-only. — [subscriptions#cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions#cancellation)
- [ ] **H9** No subscription state survives a dropped connection; the client re-issues `subscriptions/listen`. The server holds nothing across reconnects. — [subscriptions#graceful-closure](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions#graceful-closure)
- [ ] **H10** Request-scoped notifications (`notifications/progress`, `notifications/message`) are **never** delivered on the listen stream. — [streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [ ] **H11** `listChanged: true` is advertised **only** if the server can actually observe and emit the change. — [server/tools#list-changed-notification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#list-changed-notification)
- [ ] **H12** The gateway's default posture is: no `listChanged`, no `subscribe`, `ttlMs` used for freshness, and `subscriptions/listen` answered with an empty ack. See **⚠ X2–X4**.

---

## 9. Tools

Reference: [server/tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

- [ ] **I1** `tools/list` returns `{ resultType, tools, ttlMs, cacheScope }`, optionally `nextCursor`. — [schema#listtoolsresult](https://modelcontextprotocol.io/specification/2026-07-28/schema#listtoolsresult)
- [ ] **I2** Each `Tool` has `name` and `inputSchema`; `inputSchema` is an object whose root `type` is `"object"`. `null` is invalid. — [schema#tool](https://modelcontextprotocol.io/specification/2026-07-28/schema#tool)
- [ ] **I3** Zero-parameter tools use `{"type":"object","additionalProperties":false}` (recommended) or `{"type":"object"}`. — [server/tools#schema-examples](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#schema-examples)
- [ ] **I4** `inputSchema` validates as JSON Schema 2020-12 when `$schema` is absent; an unsupported dialect is rejected with an appropriate error, not silently ignored. — [basic/index#json-schema-usage](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#json-schema-usage)
- [ ] **I5** `outputSchema`, if present, is honoured: every `structuredContent` **MUST** conform to it. — [server/tools#output-schema](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#output-schema)
- [ ] **I6** When returning `structuredContent`, also include the serialized JSON in a `TextContent` block (**SHOULD**, backward compat). — [server/tools#structured-content](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#structured-content)
- [ ] **I7** `tools/call` success returns `{ resultType, content: [...] }`; `isError` defaults to `false`. — [schema#calltoolresult](https://modelcontextprotocol.io/specification/2026-07-28/schema#calltoolresult)
- [ ] **I8** Tool **execution** failures (API error, invalid argument value, business rule) are `isError: true` inside a successful result — not JSON-RPC errors. — [server/tools#error-handling](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#error-handling)
- [ ] **I9** Unknown tool name ⇒ `-32602`. Malformed `tools/call` params ⇒ `-32602`. — [server/tools#error-handling](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#error-handling)
- [ ] **I10** `tools/list` order is deterministic across requests when the set is unchanged (**SHOULD**) — needed for client caching and prompt-cache hits. — [server/tools#capabilities](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#capabilities)
- [ ] **I11** Tool names are 1–128 chars, `[A-Za-z0-9_.-]`, unique within the endpoint (**SHOULD**). — [server/tools#tool-names](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#tool-names)
- [ ] **I12** `x-mcp-header` annotations, if used, satisfy every constraint (primitive types, statically reachable via `properties` only, unique, RFC 9110 token). Otherwise conforming clients silently drop the tool. — [server/tools#x-mcp-header](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#x-mcp-header)
- [ ] **I13** Cross-call state uses an explicit opaque handle passed as an ordinary argument; no protocol session exists. — [server/tools#stateful-tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#stateful-tools)
- [ ] **I14** Inputs are validated, outputs sanitized, invocations rate-limited, access controlled. — [server/tools#security-considerations](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#security-considerations)

---

## 10. Prompts

Reference: [server/prompts](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts).

- [ ] **J1** `prompts/list` returns `{ resultType, prompts, ttlMs, cacheScope }`, optionally `nextCursor`. — [schema#listpromptsresult](https://modelcontextprotocol.io/specification/2026-07-28/schema#listpromptsresult)
- [ ] **J2** Each `Prompt` has `name`; `arguments[]` entries have `name`, optional `description`, optional `required`. — [server/prompts#data-types](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts#data-types)
- [ ] **J3** `prompts/get` returns `{ resultType, messages: [{role, content}] }`, optional `description`. — [schema#getpromptresult](https://modelcontextprotocol.io/specification/2026-07-28/schema#getpromptresult)
- [ ] **J4** `role` is `"user"` or `"assistant"` only.
- [ ] **J5** Image/audio content is base64 with a valid `mimeType`. — [server/prompts#image-content](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts#image-content)
- [ ] **J6** Unknown prompt name ⇒ `-32602`. Missing required argument ⇒ `-32602`. Internal failure ⇒ `-32603`. — [server/prompts#error-handling](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts#error-handling)
- [ ] **J7** `prompts/get` may return `InputRequiredResult` (§7). — [server/prompts#getting-a-prompt](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts#getting-a-prompt)
- [ ] **J8** Prompt arguments are validated before rendering (no template injection into downstream calls). — [server/prompts#security](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts#security)

---

## 11. Resources

Reference: [server/resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources).

- [ ] **K1** `resources/list` returns `{ resultType, resources, ttlMs, cacheScope }`, optionally `nextCursor`. — [schema#listresourcesresult](https://modelcontextprotocol.io/specification/2026-07-28/schema#listresourcesresult)
- [ ] **K2** Each `Resource` has `name` and `uri`; `uri` is a valid RFC 3986 URI. — [schema#resource](https://modelcontextprotocol.io/specification/2026-07-28/schema#resource)
- [ ] **K3** `resources/read` returns `{ resultType, contents: [...], ttlMs, cacheScope }`; each content item has `uri` plus exactly one of `text` or `blob`. — [schema#readresourceresult](https://modelcontextprotocol.io/specification/2026-07-28/schema#readresourceresult)
- [ ] **K4** Multiple contents in one read are legal (e.g. a directory). — [server/resources#reading-resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources#reading-resources)
- [ ] **K5** A non-existent resource ⇒ `-32602` with `data.uri`. **Never** an empty `contents: []`. — [server/resources#error-handling](https://modelcontextprotocol.io/specification/2026-07-28/server/resources#error-handling)
- [ ] **K6** `-32002` is **never emitted** by this revision. (Clients should still accept it from old servers; that is a client rule.) — [basic/index#error-codes](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#error-codes)
- [ ] **K7** Internal failures ⇒ `-32603`. — [server/resources#error-handling](https://modelcontextprotocol.io/specification/2026-07-28/server/resources#error-handling)
- [ ] **K8** `resources/templates/list` returns `{ resultType, resourceTemplates, ttlMs, cacheScope }`, optionally `nextCursor`. — [server/resources#resource-templates](https://modelcontextprotocol.io/specification/2026-07-28/server/resources#resource-templates)
- [ ] **K9** `resources/read` may return `InputRequiredResult` (§7). — [server/resources#reading-resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources#reading-resources)
- [ ] **K10** URIs are validated; `file://` paths are sanitized against traversal. — [server/resources#security-considerations](https://modelcontextprotocol.io/specification/2026-07-28/server/resources#security-considerations)
- [ ] **K11** Custom URI schemes are RFC 3986-conformant; `https://` is used only when the client can fetch directly. — [server/resources#common-uri-schemes](https://modelcontextprotocol.io/specification/2026-07-28/server/resources#common-uri-schemes)
- [ ] **K12** Resource URIs returned inside tool results are not required to appear in `resources/list`. — [server/tools#resource-links](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#resource-links)

---

## 12. Error codes

Reference: [basic/index#error-codes](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#error-codes), [schema](https://modelcontextprotocol.io/specification/2026-07-28/schema).

| Code | Name | When | HTTP |
|---|---|---|---|
| `-32700` | Parse error | Body is not valid JSON | 200 (unspecified) |
| `-32600` | Invalid request | Not a single valid JSON-RPC message / batch | 200 (unspecified) |
| `-32601` | Method not found | Unknown method, incl. `initialize`, `ping`, `resources/subscribe` | **404** |
| `-32602` | Invalid params | Unknown tool / prompt / resource; bad cursor; malformed params; **missing required `_meta`** | **400** when caused by missing `_meta`; otherwise unspecified |
| `-32603` | Internal error | Unhandled server failure | 200 (unspecified) |
| `-32020` | `HeaderMismatch` | Required header missing/malformed or ≠ body | **400** |
| `-32021` | `MissingRequiredClientCapability` | Request needs an undeclared client capability | **400** |
| `-32022` | `UnsupportedProtocolVersion` | Version unknown or unsupported | **400** |

- [ ] **L1** `-32602` is used for unknown tool, unknown prompt, unknown resource, and invalid cursors. — [server/tools#error-handling](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#error-handling)
- [ ] **L2** `-32603` is used for internal failures, not for user-correctable input. — [server/prompts#error-handling](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts#error-handling)
- [ ] **L3** `-32022` always carries `data.supported` (array) and `data.requested` (string). — [schema#unsupportedprotocolversionerror](https://modelcontextprotocol.io/specification/2026-07-28/schema#unsupportedprotocolversionerror)
- [ ] **L4** `-32021` always carries `data.requiredCapabilities` as a `ClientCapabilities` object. — [schema#missingrequiredclientcapabilityerror](https://modelcontextprotocol.io/specification/2026-07-28/schema#missingrequiredclientcapabilityerror)
- [ ] **L5** `-32020` is emitted for every header/body divergence, including a decoded `Mcp-Name` mismatch. — [schema#headermismatcherror](https://modelcontextprotocol.io/specification/2026-07-28/schema#headermismatcherror)
- [ ] **L6** No code from `-32020`–`-32099` is emitted unless this spec defines it. — [basic/index#error-codes](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#error-codes)
- [ ] **L7** No code from `-32000`–`-32019` is emitted at all (legacy range; new implementations **SHOULD NOT** use it). — [basic/index#error-codes](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#error-codes)
- [ ] **L8** `-32002` and `-32042` are never emitted. — [basic/index#error-codes](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#error-codes)
- [ ] **L9** Application-specific codes live **outside** `-32768..-32000`. — [basic/index#error-codes](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#error-codes)
- [ ] **L10** Tool *execution* errors are **not** JSON-RPC errors; they are `isError: true` results. — [server/tools#error-handling](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#error-handling)

---

## 13. Test matrix (drop-in probes)

| # | Request | Expect |
|---|---|---|
| T1 | `POST /mcps/calendar` `server/discover`, valid headers | `200`, `resultType:"complete"`, `supportedVersions`, `capabilities`, `ttlMs`, `cacheScope`, `_meta.serverInfo` |
| T2 | Same, `MCP-Protocol-Version: 2025-06-18` | `400` + `-32022`, `data.supported` includes `2026-07-28` |
| T3 | Same, header `2026-07-28` but body `_meta.protocolVersion: "2025-11-25"` | `400` + `-32020` |
| T4 | Same, omit `Mcp-Method` | `400` + `-32020` |
| T5 | Same, omit `params._meta.clientCapabilities` | `400` + `-32602` |
| T6 | `tools/call` with `Mcp-Name` ≠ `params.name` | `400` + `-32020` |
| T7 | `tools/call` for a nonexistent tool | `-32602`, message names the tool |
| T8 | `tools/call` where the upstream API fails | `resultType:"complete"`, `isError:true`, `content:[...]` — **not** a JSON-RPC error |
| T9 | `prompts/get` for a nonexistent prompt | `-32602` |
| T10 | `resources/read` for a nonexistent URI | `-32602`, `data.uri`, no `contents: []` |
| T11 | `resources/read` with a cursor-like garbage param | `-32602` |
| T12 | `initialize` | `404` + `-32601` |
| T13 | `ping` | `404` + `-32601` |
| T14 | `GET /mcps/calendar` | `405` |
| T15 | `DELETE /mcps/calendar` | `405` |
| T16 | `POST` with `Mcp-Session-Id: abc` | Normal `200`; no session id echoed |
| T17 | `POST` with `Origin: https://evil.example` | `403` |
| T18 | `POST` `subscriptions/listen` `{notifications:{}}` | SSE (or immediate result) whose first frame is `notifications/subscriptions/acknowledged` with `subscriptionId` = request id, `notifications: {}` |
| T19 | `subscriptions/listen` requesting `toolsListChanged:true` on a server with no `listChanged` | Ack omits `toolsListChanged`; no `notifications/tools/list_changed` ever sent |
| T20 | `tools/list` twice, unchanged config | Identical bytes except any `ttlMs` recency; same order |
| T21 | `tools/list` with `Accept: application/json` only | `200` JSON — no spec rule requires rejection |
| T22 | Batch `[{...},{...}]` | `-32600` |

---

## 14. Ambiguities and stateless non-conformance

### ⚠ Premise corrections

- **X1 — `clientInfo` is not required.** The brief says every request must carry `protocolVersion`, `clientInfo`, `clientCapabilities`. The spec makes `clientInfo` a **SHOULD**; only `protocolVersion` and `clientCapabilities` are `MUST`. Enforcing `clientInfo` will reject conforming clients. — [basic/index#meta](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta)

### ⚠ Stateless by construction

- **X2 — `listChanged: true` cannot be honoured across isolates.** A stateless Worker has no registry of listeners, and instance A cannot push to a stream held by instance B. Advertising `listChanged: true` is only honest if the listen handler polls a shared store (KV/D1) inside the stream and diffs it. Otherwise omit the flag and rely on `ttlMs`. — [server/tools#list-changed-notification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#list-changed-notification)
- **X3 — `resources.subscribe` is the same problem**, per-URI. Do not advertise it. — [server/resources#capabilities](https://modelcontextprotocol.io/specification/2026-07-28/server/resources#capabilities)
- **X4 — Is `subscriptions/listen` itself mandatory?** [basic/index](https://modelcontextprotocol.io/specification/2026-07-28/basic/index) says all implementations **MUST** support the message patterns, which include subscribe-and-notify. But nothing says a server with zero notification types must keep the stream open. The spec never states that ack-with-`{}` followed by immediate graceful closure is non-conformant, nor that it is conformant. Safest reading: implement the method, ack `{}`, and keep the stream open with keep-alive comments; treat "reject with `-32601`" as non-conformant. — [basic/patterns](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns), [subscriptions#acknowledgment](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions#acknowledgment)
- **X5 — An open listen stream pins a Worker isolate** for its lifetime. Combined with X4 this is the single most expensive conformance requirement in this revision. No `Last-Event-ID` means the client must re-issue on disconnect, so a short server-side lifetime is not itself a violation. — [streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- **X6 — Single-use `requestState` is unenforceable.** The spec requires server-side enforcement of at-most-once redemption for state that must be consumed once. A stateless gateway has nowhere to record consumption without KV/DO. Options: never issue such state, or accept the gap explicitly. — [mrtr#server-requirements-basic-workflow](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#server-requirements-basic-workflow)
- **X7 — `requestState` still needs a signing key.** Without a stable HMAC/AEAD key across isolates (a Worker secret), integrity protection is impossible and MRTR becomes unsafe for anything authorization-adjacent. — [mrtr#security-considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#security-considerations)

### ⚠ Genuine spec gaps

- **X8 — HTTP status for ordinary JSON-RPC errors is unspecified.** Only four cases mandate `400` (`-32602` from missing `_meta`, `-32020`, `-32021`, `-32022`), plus `404` for `-32601`. What status accompanies `-32602` for an unknown tool, or `-32603`? Unstated. Recommendation: `200` for body-level errors, `400` only for the four mandated cases. — [streamable-http#protocol-version-header](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#protocol-version-header)
- **X9 — Client→server notifications over HTTP are undefined.** The transport defines `202` for an accepted notification, then states this revision defines no client→server notifications. `notifications/cancelled` is stdio-only. So: `202` for a syntactically valid notification, `400` for garbage; do not act on it. Header requirements for notification POSTs are explicitly "not defined by this revision". — [streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- **X10 — `Accept` is not server-validated.** Clients **MUST** send both media types, but no rule lets a server reject a request that omits `text/event-stream`. A JSON-only server is conformant; do not add a hard `406`. — [streamable-http](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- **X11 — `ttlMs` on MRTR retries is contradictory.** `ReadResourceResult` requires `ttlMs`, but retry results **MUST NOT** be cached. Emit `ttlMs: 0` (and `cacheScope: "private"`), which satisfies both. — [caching#cache-key](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching#cache-key)
- **X12 — Multi-endpoint identity.** The spec models one server per endpoint. A gateway with `/mcps/calendar` and `/mcps/onenote` has two `serverInfo`s and two `DiscoverResult`s; there is no aggregate discovery document. Clients that expect one will be surprised. — [server/discover](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
- **X13 — `resources/templates/list` capability gating is implicit.** No sentence says declaring `resources` obliges answering `resources/templates/list` (unlike `resources/list`). Returning an empty list is the safe choice. — [server/resources#capabilities](https://modelcontextprotocol.io/specification/2026-07-28/server/resources#capabilities)
- **X14 — `params` is optional in `JSONRPCRequest` but `_meta` is required in `RequestParams`.** The envelope schema permits a request with no `params`; `RequestParams` then requires `_meta` inside it. In practice every core request must have `params._meta`. — [schema](https://modelcontextprotocol.io/specification/2026-07-28/schema)

---

## 15. Minimum viable conformance (if you build nothing else)

1. `server/discover` on each endpoint with `supportedVersions`, `capabilities`, `ttlMs`, `cacheScope`, `_meta.serverInfo`.
2. Validate `_meta.protocolVersion` + `_meta.clientCapabilities`; `-32602`/`400` when absent, `-32022` when unsupported.
3. Validate `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`; `-32020`/`400` on any mismatch.
4. `resultType: "complete"` on every result.
5. `ttlMs` + `cacheScope` on all six cacheable operations; `private` for anything user-scoped.
6. `405` on `GET`/`DELETE`; ignore `Mcp-Session-Id`; no `initialize`, no `ping`.
7. `-32602` for unknown tool/prompt/resource; `-32603` for internal; `isError: true` for tool execution failures.
8. Deterministic `tools/list` ordering.
9. Never send server-initiated requests; never emit `notifications/message` without `logLevel`.
10. `subscriptions/listen` → ack `{}`, keep-alive comments, no `listChanged` advertisement.
