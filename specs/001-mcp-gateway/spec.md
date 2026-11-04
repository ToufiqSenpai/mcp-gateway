# Feature Specification: MCP Gateway

**Feature Branch**: `001-mcp-gateway`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: "Rebuild the existing specification as a spec-kit feature specification. Source of record: `docs/SPEC.md` (MCP Gateway — a single-user gateway on Cloudflare Workers that hosts first-party MCP servers under `/mcps/*`, each against exactly one Provider, with several Accounts per MCP, an admin UI, and MCP resources and prompts)."

## Clarifications

### Session 2026-11-04

- Q: Ketika dokumentasi publik Google dan schema hasil capture `tools/list` berbeda, mana yang menjadi acuan kontrak `calendar`? → A: Dokumentasi publik Google menang; field dan format yang tidak ada di sana dihapus.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Authorize one Provider identity and use an MCP from a client (Priority: P1)

The single operator opens the admin area, adds an Account for the `calendar` MCP by typing a slug, completes the Provider's consent screen, and then calls the calendar tools from an MCP client using the gateway's client credential. The calls act on that identity's real calendars.

**Why this priority**: Without one working Account and a reachable MCP endpoint there is no product. Every other story depends on this slice.

**Independent Test**: With only this story implemented, add a Google Account through the browser, then list calendars and create an event from an MCP client. Both succeed and the event appears in that Google identity's calendar.

**Acceptance Scenarios**:

1. **Given** an operator with valid Provider client credentials and a fresh deployment, **When** they submit a new slug for the `calendar` MCP and approve consent, **Then** the Account appears as usable and becomes the MCP's default.
2. **Given** one usable Account, **When** a client calls a read tool naming no Account, **Then** the call runs against the default Account and returns its data.
3. **Given** one usable Account, **When** a client calls a write tool, **Then** the change is visible at the Provider and the tool returns the resulting object.
4. **Given** a client without the gateway's client credential, **When** it calls any MCP endpoint, **Then** the request is refused and no Provider data is returned.

---

### User Story 2 - Keep several Accounts per MCP and choose one per request (Priority: P2)

The operator adds a second identity to an MCP, marks one as default, and calls tools either without an Account (default) or with an explicit slug. A broken Account never silently borrows another Account's Credential.

**Why this priority**: The gateway exists to fan one MCP out to several identities; one Account is a demo, not the product.

**Independent Test**: With two usable Accounts, call a read tool once with no slug and once with the non-default slug; responses differ accordingly. Then break the default and confirm an unqualified call fails with a message naming the slug and the admin page, while an explicit call to the healthy Account still works.

**Acceptance Scenarios**:

1. **Given** two usable Accounts for one MCP, **When** the operator sets one as default, **Then** exactly one default exists for that MCP and unqualified calls use it.
2. **Given** a default Account that needs reauthorization, **When** a client calls a tool naming no Account, **Then** the call fails with an error naming the slug and the admin page rather than using another Account.
3. **Given** an Account slug that does not exist for the MCP, **When** a client names it, **Then** the call fails with an error listing the available slugs.
4. **Given** two Accounts and a paginated list, **When** the client pages through results, **Then** the listing spans both Accounts consistently and a stale page cursor is rejected rather than silently returning the wrong slice.

---

### User Story 3 - Host a second MCP against a different Provider (Priority: P3)

The operator adds a Microsoft identity to the `notes` MCP and works with OneNote notebooks, sections and pages from the same client setup, using the same Account model and the same admin flow.

**Why this priority**: It proves the gateway is generic across Providers rather than a one-off calendar server.

**Independent Test**: With the `notes` MCP available, add a Microsoft Account, then list notebooks, read a page, and create a notebook from a client. Each call succeeds against that identity's OneNote.

**Acceptance Scenarios**:

1. **Given** a Microsoft Account added to `notes`, **When** a client lists notebooks, **Then** it receives only notebooks visible to that identity.
2. **Given** a page in OneNote, **When** a client reads it, **Then** it receives the page's HTML content and metadata, capped and flagged if the content is too long.
3. **Given** a notebook resource address, **When** a client reads it, **Then** it receives a notebook outline listing that notebook's sections and section groups.
4. **Given** an Account from `calendar`, **When** it is referenced from `notes`, **Then** it is unknown: identities and Credentials are never shared across MCPs.

---

### User Story 4 - Accounts stay healthy without operator intervention (Priority: P4)

An Account's access expires naturally. The gateway refreshes it in the background of a call, single-flight, so concurrent calls never corrupt a Credential. When refreshing is impossible, the Account is marked as needing reauthorization and the operator restores it through the admin flow.

**Why this priority**: An Account that silently rots is worse than one that reports it is broken; health is the difference between a usable gateway and a confusing one.

**Independent Test**: Put an Account's access credentials near expiry, issue concurrent calls, and confirm all of them succeed with one refresh performed. Then revoke consent at the Provider and confirm the next call marks the Account as needing reauthorization and names the admin page.

**Acceptance Scenarios**:

1. **Given** an Account whose access is about to expire, **When** several calls arrive at once, **Then** exactly one refresh happens and every call succeeds with the refreshed access.
2. **Given** a refresh response that rotates the refresh Credential, **When** the refresh completes, **Then** the new Credential replaces the old one and the Account stays usable.
3. **Given** a Provider rejecting the refresh as permanently invalid, **When** the next call runs, **Then** the Account is marked as needing reauthorization and the error names the slug and the admin page.
4. **Given** a transient Provider outage, **When** a refresh fails, **Then** the Account is not demoted, the failure is recorded, and the call fails with a retryable error.
5. **Given** an Account marked as needing reauthorization, **When** the operator reauthorizes the same identity, **Then** the Account becomes usable again with its slug unchanged.
6. **Given** an Account that no longer grants every permission its MCP requires, **When** it is used or refreshed, **Then** it is marked as needing reauthorization instead of failing later mid-operation.

---

### User Story 5 - Inspect and repair accounts from a browser (Priority: P5)

The operator opens the admin area to see each MCP, each Account's health, expiry, granted permissions and last error, and to add, reauthorize, revoke, set the default, or run one tool to check it works.

**Why this priority**: The operator is the only user; a clear read-out and a safe repair path turn failures into a one-minute fix.

**Independent Test**: From the admin area alone, add an Account, set it as default, run a read tool through the test panel, revoke the Account after a confirmation, and confirm the pages reflect each change.

**Acceptance Scenarios**:

1. **Given** an MCP with Accounts, **When** the operator opens its admin page, **Then** every Account's slug, email, display name, state, default flag, granted permissions, expiry and last error are shown.
2. **Given** an Account exists, **When** the operator revokes it, **Then** they must pass a confirmation page first, the Credential is destroyed, and the slug stays reserved.
3. **Given** an Account exists, **When** the operator changes another Account's default, **Then** the previous default is cleared and the new one is shown.
4. **Given** the test panel, **When** the operator runs a tool with JSON arguments, **Then** the exact result the client would receive is shown, including tool-level errors and duration.
5. **Given** any admin page, **When** it is rendered, **Then** it contains no access or refresh Credential, no Provider client secret, no encryption or signing key, no provider subject identifier and no raw Provider error body.

---

### User Story 6 - Discover and read content as resources, and use prompts (Priority: P6)

A client lists the content containers it can read through the gateway and receives one entry per calendar or notebook per usable Account. It can read an outline of each, and for calendar it can fetch four ready-made prompts that guide multi-step work.

**Why this priority**: Resources and prompts make the gateway feel native to MCP clients; tools alone would still be usable, so this is last.

**Independent Test**: From a client, list resources, read one calendar resource and one notebook resource, then fetch each calendar prompt. Every result is content the corresponding Account can actually see.

**Acceptance Scenarios**:

1. **Given** Accounts across two MCPs, **When** a client lists resources on one MCP, **Then** it receives one entry per container for that MCP's usable Accounts only.
2. **Given** an Account that is not usable, **When** a client lists resources, **Then** that Account is skipped, healthy Accounts are still listed, and the response warns which Accounts were skipped.
3. **Given** a container that was deleted at the Provider, **When** a client reads its resource, **Then** the read fails with an unknown-resource error carrying the address, never an empty snapshot.
4. **Given** a calendar Account, **When** a client fetches a prompt and names no Account, **Then** the prompt's Account resolves to the default, and if there is no default the client is told to name one or set one.

---

### Edge Cases

- Two Accounts added for the same Provider identity in one MCP: the second is refused and the existing slug is reported.
- Reauthorization completes as a different Provider identity than the target Account: refused, existing Credential untouched.
- Reauthorization grants fewer permissions than the Account previously had: refused, the working Credential is never narrowed.
- Provider returns no refresh Credential during the initial exchange: the Account is not created at all.
- OAuth state value is reused, expired, or does not match the browser's flow cookie: refused with a state error and nothing written.
- A Worker dies mid-refresh: the Account must not stay locked; the lock expires and the next call can proceed.
- Two clients page the same list at once, or the set of usable Accounts changes between pages: the stale cursor is rejected rather than returning a mixed slice.
- Provider call returns a permission error while the Credential is valid: the error passes through and the Account is not demoted.
- Provider list result exceeds the per-Account cap: the result is truncated and marked as such.
- The deployment is missing or has a malformed encryption key: Account operations fail closed with a generic server error, never with plaintext storage.
- A client asks for `GET`/`DELETE` on an MCP endpoint, or speaks an older protocol version: refused explicitly.
- A request arrives for a host without the single-sign-on perimeter, or with a human session on a machine endpoint: refused.

## Requirements *(mandatory)*

### Functional Requirements

**Perimeter and access**

- **FR-001**: The gateway MUST host exactly two MCPs in v1 — `calendar` against Google Calendar (read-write) and `notes` against Microsoft OneNote (read-write) — each reachable at its own path.
- **FR-002**: The gateway MUST verify every request's perimeter credential inside the application, checking signature, issuer and the audience of the application that covers the path, rather than trusting the edge.
- **FR-003**: The gateway MUST accept only human sessions on admin and OAuth callback paths and only machine credentials on MCP paths, refusing a mismatch without detail.
- **FR-004**: The gateway MUST run entirely behind a single custom hostname; no deployment-specific preview or default hostname may serve it.
- **FR-005**: A development bypass MAY exist only when the environment is explicitly development and the host is local, MUST be visibly announced on every admin page, and MUST be proven unreachable in production by a test.

**Accounts and authorization**

- **FR-006**: The operator MUST be able to add an Account to an MCP by typing a slug matching `^[a-z0-9][a-z0-9-]{0,31}$`, unique within that MCP.
- **FR-007**: Authorization MUST use the authorization-code flow with proof-of-possession, and the request MUST be bound to the initiating browser by a single-use, short-lived, HTTP-only flow cookie.
- **FR-008**: An authorization attempt MUST expire after ten minutes and MUST be consumable exactly once.
- **FR-009**: The gateway MUST refuse to create an Account when the Provider issues no refresh Credential.
- **FR-010**: The gateway MUST record the Provider's stable subject, email and display name for the Account, and MUST refuse a second Account for the same subject within an MCP, naming the existing slug.
- **FR-011**: Reauthorizing an existing Account MUST require the same Provider subject as that Account and MUST leave the slug and subject unchanged.
- **FR-012**: The gateway MUST NOT share an Account or Credential across MCPs.
- **FR-013**: The gateway MUST reserve a revoked Account's slug and identity permanently; v1 offers no hard delete or rename.

**Account health and credentials**

- **FR-014**: Each Account MUST be in exactly one of three states: usable, needs reauthorization, or revoked.
- **FR-015**: The gateway MUST refresh access credentials automatically before a Provider call when the current one is within 60 seconds of expiry, and MUST retry a call once after a Provider authentication rejection.
- **FR-016**: Concurrent calls MUST trigger at most one refresh per Account, with a bounded lease so a failed process cannot leave the Account permanently locked.
- **FR-017**: A refresh that rotates the refresh Credential MUST replace the stored one; a refresh that omits it MUST keep the existing one.
- **FR-018**: A permanent refresh rejection MUST mark the Account as needing reauthorization; a transient failure MUST NOT change its state.
- **FR-019**: Reauthorization and refresh MUST not overwrite each other; if a refresh is in flight, reauthorization MUST report retryable contention instead of proceeding.
- **FR-020**: Access and refresh Credentials MUST be encrypted at rest with authenticated encryption, a fresh nonce per encryption, and associated data binding each ciphertext to its Account and field.
- **FR-021**: A missing or malformed encryption key MUST make every Account operation fail closed with a generic server error; there MUST be no plaintext fallback and no runtime-generated key.
- **FR-022**: Revocation MUST make a best-effort Provider-side revoke, destroy both stored Credentials, and clear the default flag.
- **FR-023**: The gateway MUST record a last-error code per Account without ever recording a Credential.

**Scope enforcement**

- **FR-024**: Each MCP MUST declare one Required scope set as a single constant used by the authorization request, the callback check and the call-time check.
- **FR-025**: An authorization or reauthorization that does not grant every required scope MUST be refused without writing; an existing working Credential MUST NOT be narrowed.
- **FR-026**: An Account whose granted scopes stop covering the Required set — detected on refresh or at call time — MUST be marked as needing reauthorization, with its refresh lock released.
- **FR-027**: The gateway MUST NOT gate individual tools on individual scopes.

**Selection and default**

- **FR-028**: Every tool, resource read and prompt MUST resolve an Account per request: the explicitly named slug, otherwise the MCP's Default Account.
- **FR-029**: At most one Default Account per MCP MUST exist, enforced by the data store.
- **FR-030**: The first Account to become usable for an MCP with no default MUST become the default automatically; later defaults are set by the operator.
- **FR-031**: If the selected Account is missing, needs reauthorization or is revoked, the call MUST fail with an Account-unusable result naming the slug and the admin page; the gateway MUST NOT fall back to another Account.
- **FR-032**: An Account-unusable condition MUST surface as a tool-level error result, not a protocol error; protocol errors are reserved for malformed requests and internal failures.

**MCP protocol**

- **FR-033**: Each MCP path MUST be its own server with its own discovery document, identity and tool set; there MUST be no gateway-wide discovery document.
- **FR-034**: Every MCP request MUST be self-contained: one server instance per request, no session, no server-side session state, no session identifier.
- **FR-035**: The gateway MUST refuse older protocol traffic explicitly, answer `GET` and `DELETE` on MCP paths with `405`, and answer queries without a single JSON body.
- **FR-036**: The gateway MUST NOT advertise change notifications or resource subscriptions, MUST NOT send unsolicited log notifications without a per-request level, MUST NOT emit legacy or reserved protocol error codes, and MUST NOT send server-initiated requests.
- **FR-037**: Every successful result MUST be marked complete; tool execution failures MUST be tool-level errors; an unknown tool, prompt or resource MUST be an invalid-params error.
- **FR-038**: The gateway MUST NOT set HTTP caching headers on MCP responses.
- **FR-039**: Cache hints in MCP results MUST mark Credential-derived content private; discovery, tool listings, prompt listings and resource-template listings are public, and tool execution is uncacheable.
- **FR-040**: Pagination MUST use MCP cursors only; Provider pagination tokens MUST never reach the client.
- **FR-041**: A cursor MUST be opaque, signed, and bound to the set of usable Accounts; a bad signature or changed Account set MUST be rejected as invalid params.
- **FR-042**: A missing cursor MUST mean end of list, an empty cursor MUST mean the first page, and page size is chosen by the gateway.
- **FR-043**: Provider fetches MUST complete per Account and be sliced locally, with a per-Account cap that marks results truncated when exceeded.
- **FR-044**: Resource templates and prompt listings MUST be single-page.

**Calendar MCP**

- **FR-045**: `calendar` MUST expose nine tools — list events, get event, list calendars, suggest a time, create event, update event, delete event, respond to an invitation, and search events — plus the shared Account listing tool.
- **FR-046**: Every calendar tool MUST accept an optional Account slug and MUST reproduce the published result shapes and documented behavioural differences from the Provider's REST API, including returning the deleted event, delta-style attendee and attachment updates, preserved duration when only a start time is given, and inverted availability for time suggestion.
- **FR-047**: Calendar times MUST be ISO 8601 as the Provider publishes them — `dateTime` with an offset or `Z`, `date` at midnight UTC — with `timeZone` set only when the user names a zone; event types that are not asked for MUST be hidden.
- **FR-048**: `calendar` MUST list one resource per calendar per usable Account; no event resources and no resource templates.
- **FR-049**: A calendar resource read MUST return one JSON document holding the calendar, a fixed seven-day window and its events, and MUST fail with an invalid-params error carrying the address when the calendar is unknown.
- **FR-050**: `calendar` MUST offer four static prompts — plan a day, find a meeting time, summarize a week, triage invitations — that call no Provider and use the default Account when none is named.

**Notes MCP**

- **FR-051**: `notes` MUST expose ten tools — list notebooks, list sections, list pages, get page, search pages, create page, update page, delete page, create section, create notebook — plus the shared Account listing tool.
- **FR-052**: Section listing and section creation MUST require exactly one parent, a notebook or a section group; neither or both is an invalid-params error.
- **FR-053**: Page search MUST be a case-insensitive substring match on page titles only.
- **FR-054**: Creating a page MUST wrap the supplied fragment in a complete HTML document and MUST reject documents over the Provider's size limit with an invalid-params error stating that limit.
- **FR-055**: Page updates MUST forward the supplied content commands unchanged, and there MUST be no whole-page replace.
- **FR-056**: Page content read MUST return HTML verbatim, capped at 100 000 characters cut at a tag boundary, with the full length and a truncation flag reported.
- **FR-057**: `notes` MUST list one resource per notebook per usable Account and return a notebook outline — sections and section groups, names and ids only — on read.
- **FR-058**: `notes` MUST NOT offer prompts, navigate section groups, or offer delete for notebooks and sections, renaming, section-group creation, body-text search, whole-page replace, or image proxying.

**Shared Account listing**

- **FR-059**: The shared Account listing tool MUST return only slug and default flag for the MCP it is mounted on — never state, Credentials or subject — and MUST return an empty list rather than an error when the MCP has no Accounts.

**Enumeration cache**

- **FR-060**: Container enumeration MAY be cached per Account for 300 seconds, keyed by a per-Account epoch that changes whenever that Account's enumerable containers change.
- **FR-061**: The cache MUST be bypassed when an Account's enumeration changed, MUST NOT store partial results, and MUST NOT be used to answer resource reads.

**Admin**

- **FR-062**: The admin area MUST list MCPs with their endpoints, Provider, Account counts per state and default Account, and per-MCP Account tables with health and expiry.
- **FR-063**: The admin area MUST support adding, reauthorizing, revoking, setting the default, and running one tool in-process.
- **FR-064**: Every admin mutation MUST be a POST that redirects to a GET, guarded by same-origin checks and a double-submit token, and destructive actions MUST pass a confirmation page.
- **FR-065**: The admin area MUST render on the server with no client-side script.
- **FR-066**: The admin area MUST never render Credentials, client secrets, keys, subject identifiers, JWTs, authorization-attempt contents or raw Provider bodies; errors MUST show a code and one plain sentence, and server errors MUST not expose stack traces.
- **FR-067**: The tool test panel MUST run the selected tool through the same path clients use, from inside the application, and show the result, its error flag and its duration without persisting history.

### Key Entities

- **Provider**: An external service whose API an MCP exposes and whose authorization an Account holds. Two in v1: Google and Microsoft.
- **MCP**: A first-party server hosted at its own path, exposing tools, resources and prompts against exactly one Provider.
- **Account**: One Provider identity authorized for one MCP, addressed by a slug unique within that MCP. Holds state, default flag, granted scopes, timestamps and last error.
- **Credential**: The access and refresh material belonging to one Account, encrypted at rest and never displayed.
- **Default Account**: The Account an MCP uses when a request names none. At most one per MCP; a broken default never falls back.
- **Account state**: Usable, needs reauthorization, or revoked.
- **Required scope set**: The Provider permissions an MCP's whole tool surface needs. **Granted scope set**: the permissions the operator actually consented to; it may exceed the required set while usable.
- **Authorization attempt**: A single-use, ten-minute record binding a browser flow to an MCP, slug, Provider and optional target Account.
- **Cursor**: An opaque, signed position in a paginated MCP list, valid only for the Account set it was issued under.
- **Resource**: An addressable content container — a calendar or a notebook — enumerated per Account.
- **Prompt**: A reusable instruction template with declared arguments.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator who already holds Provider credentials can add a working Account and complete a first calendar tool call in under 5 minutes.
- **SC-002**: 100% of requests without a valid perimeter credential are refused with no Provider data in the response; a probe suite covering both route groups returns zero successes in an unauthenticated run.
- **SC-003**: Zero Credentials, client secrets, keys, subject identifiers or raw Provider bodies appear in any admin page, URL, log line or tool result, verified by an audit over every rendered page and every error path.
- **SC-004**: A client never observes an expiry failure while the refresh Credential is valid: 100 consecutive calls spanning at least one access expiry complete with zero client-visible failures, and concurrent-call tests show exactly one refresh.
- **SC-005**: When the default Account is broken, 100% of unqualified calls fail with an error naming the slug and the admin page, and zero calls silently use another Account.
- **SC-006**: 100% of protocol conformance probes pass for both MCPs: discovery shape, header and metadata validation, `405` on unsupported methods, invalid-params for unknown tools, prompts and resources, tool-level errors for execution failures, no change notifications, and deterministic tool ordering across 20 repeated listings.
- **SC-007**: An MCP list spanning both Accounts returns every container the Accounts can see, with no duplicate or missing entries relative to a direct Provider listing, and a stale cursor is rejected 100% of the time.
- **SC-008**: Every documented tool of both MCPs can be exercised end to end against a faked Provider and returns the documented result shape: 9 calendar tools plus 10 notes tools plus the shared Account listing tool.
- **SC-009**: The admin area's busiest page renders in under 1 second for 20 Accounts on one MCP, measured server-side.
- **SC-010**: A revoked or reauthorization-pending Account is restored to usable by one reauthorization round trip, with its slug and subject unchanged.

## Assumptions

- **Single operator.** One human administers the gateway; there are no roles, invitations or per-user data isolation. Multi-user is explicitly out of scope.
- **Two MCPs in v1.** `calendar` (Google Calendar) and `notes` (OneNote). Adding an MCP is a code change and a deployment, not a configuration or plugin action.
- **Existing perimeter.** The operator already runs a single-sign-on perimeter that issues verifiable assertions and a machine credential for clients; the gateway consumes it and does not mint its own tokens.
- **Provider applications already registered.** OAuth clients for Google and Microsoft exist, with redirect addresses registered and any required consent published. Provider-side setup is a deployment prerequisite, not feature logic.
- **Managed data store and cache** are available to the deployment; the feature does not prescribe which.
- **Secrets are supplied by the deployment environment.** No secret is committed, generated at runtime, or editable through the admin area.
- **Out of scope by decision, not deferral**: plugin system or runtime MCP registration, proxy or hosting of third-party MCP servers, non-OAuth MCPs, multi-user isolation, server-side session state, self-issued client tokens.
- **Open questions stay open.** Destructive-tool confirmation beyond annotations, proxying provider-authenticated media, rate limits and backoff, observability redaction, and encryption-key rotation are tracked separately and are not decided here.
- **English documentation.** Code, docs and the admin interface are in English, with domain terms capitalized as defined in `docs/SPEC.md` — `Account`, `Provider`, `MCP`, `Credential`, `Default Account`, `Required scope set`, `Granted scope set`.
- **Source of record.** `docs/SPEC.md` remains the authoritative behavioural specification; this document restates it in feature form and does not override it.
