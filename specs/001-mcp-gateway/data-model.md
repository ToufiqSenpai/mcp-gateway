# Phase 1 Data Model: MCP Gateway

Derived from [spec.md](./spec.md) requirements and `docs/SPEC.md` §6, §8, §9, §14. Field names are the physical names the design already fixes; validation rules cite the requirement they satisfy. There is one schema: the Drizzle definition in `packages/web/src/db/schema.ts`, whose generated migrations are applied both locally and in tests (no parallel test schema).

## Entity: Account

One Provider identity authorized for exactly one MCP. The central record; everything else either supports it or is derived from it.

| Field | Type | Rules |
| --- | --- | --- |
| `id` | text, PK | UUID generated at insert; never reused |
| `mcp` | text | `calendar` \| `notes`; paired with `provider` by `CHECK` (FR-001, FR-012) |
| `slug` | text | `^[a-z0-9][a-z0-9-]{0,31}$`; unique per `(mcp, slug)` (FR-006) |
| `provider` | text | `google` \| `microsoft`; `calendar`↔`google`, `notes`↔`microsoft` (FR-001) |
| `provider_subject` | text | Provider's stable subject; unique per `(mcp, provider, provider_subject)` (FR-010); never rendered (FR-066) |
| `email` | text | from the Provider identity fetch; shown in admin |
| `display_name` | text, nullable | from the Provider identity fetch |
| `access_token` | text, nullable | envelope `v1.<iv>.<ct>`, AAD `<id>:access_token`; `NULL` when revoked (FR-020, FR-022) |
| `refresh_token` | text, nullable | envelope `v1.<iv>.<ct>`, AAD `<id>:refresh_token`; `NULL` when revoked |
| `access_token_expires_at` | integer | unix seconds; drives the 60 s pre-emptive refresh (FR-015) |
| `scopes` | text | space-delimited Granted scope set, as the Provider reports it (FR-024) |
| `state` | text | `active` \| `needs_reauth` \| `revoked` (FR-014) |
| `is_default` | integer | `0` \| `1`; partial unique index allows one `1` per `mcp` (FR-029) |
| `cache_epoch` | integer, default 0 | bumped on Account add/revoke/state change and on `create_notebook` (FR-060) |
| `refresh_lock_until` | integer, nullable | lease end, unix seconds; `NULL` = free (FR-016) |
| `refresh_lock_token` | text, nullable | CAS token for the persist step (FR-016, FR-019) |
| `last_refreshed_at` | integer, nullable | unix seconds |
| `last_error` | text, nullable | error code only, never a Credential or Provider body (FR-023) |
| `created_at` | integer | unix seconds |
| `updated_at` | integer | unix seconds |
| `revoked_at` | integer, nullable | set on revoke, cleared on reauth |

**Indexes and invariants**

- `UNIQUE (mcp, slug)` — one slug per MCP (FR-006).
- `UNIQUE (mcp, provider, provider_subject)` — one Provider identity per MCP (FR-010).
- `UNIQUE (mcp) WHERE is_default = 1` — at most one default (FR-029).
- `CHECK` pairing of `mcp` and `provider` (FR-012).
- No row with `state = 'active'` may hold a Credential that fails to decrypt or a scope set short of the Required set (FR-021, FR-026); the latter is enforced at call time, not by a constraint.

**Deliberately absent**: `token_type` (both Providers issue `Bearer` and nothing reads it); no hard-delete marker beyond `revoked_at` (FR-013); no per-MCP table (the MCP list is an enum, extended by migration).

### State transitions

| From | To | Trigger | Side effects |
| --- | --- | --- | --- |
| — | `active` | successful initial authorization with a refresh Credential and full Required scope set | row written, `cache_epoch` bumped; becomes default if the MCP has none (FR-030) |
| `active` | `needs_reauth` | `invalid_grant` on refresh (Microsoft: `invalid_grant` / `interaction_required`), or Granted set stops covering Required at refresh or call time | `last_error` set, lock released, `cache_epoch` bumped (FR-018, FR-026) |
| `needs_reauth` | `active` | successful reauth of the same subject | Credentials, `scopes`, expiry, `last_refreshed_at` overwritten; `revoked_at`, `last_error` cleared; `cache_epoch` bumped (FR-011, FR-020) |
| `active` / `needs_reauth` | `revoked` | operator revokes | best-effort Provider revoke, both ciphertexts `NULL`, `revoked_at` set, `is_default` cleared, `cache_epoch` bumped (FR-022) |
| `revoked` | `active` | successful reauth | as above |

Transient refresh failures (5xx, fetch errors, timeout) never change `state`; they only write `last_error` (FR-018). A Provider `401` after a successful refresh and any Provider `403` at call time leave `state` untouched.

## Entity: OAuth attempt

A single-use, ten-minute binding between a browser flow and the authorization being started.

| Field | Type | Rules |
| --- | --- | --- |
| `state` | text, PK | 32 random bytes, base64url; must equal the `oauth_flow` cookie (FR-007) |
| `mcp` | text | copied from the admin action, never from the callback path (FR-007) |
| `provider` | text | `google` \| `microsoft` |
| `slug` | text | the slug being added or reauthorized |
| `code_verifier` | text | PKCE verifier from `arctic.generateCodeVerifier()` |
| `target_account_id` | text, nullable, FK → `accounts.id` | set only for reauth |
| `created_at` | integer | unix seconds |
| `expires_at` | integer | `created_at + 600` (FR-008) |

Consumed rows are deleted at the callback with `DELETE … RETURNING` (single use); expired rows are deleted opportunistically when the next flow starts. No cron. Contents are never rendered or logged (FR-066).

## Entity: Cursor

Not stored. An opaque value carried by the client.

- Payload `{ o, h }`: `o` = offset/position state, `h` = HMAC-SHA256 under `CURSOR_SIGNING_KEY`; base64url.
- Valid only for the usable-Account set it was issued under; a changed set or a bad signature is `-32602` (FR-041).
- `""` is valid and means the first page; absence means the list is exhausted (FR-042).
- No expiry; Provider pagination tokens never appear in it (FR-040).

## Entity: Cache entry (KV)

- Key `v1:enum:<mcp>:<account>:<epoch>` — fixed length, under KV's 512-byte key limit.
- Value `{ resources, fetchedAt, truncated }`.
- TTL 300 s; write-through with `ctx.waitUntil`; failed writes logged and ignored; no single-flight; never written for partial results (FR-060, FR-061).
- Invalidated by reading `cache_epoch` from the Account row on every enumeration, not by a KV delete.

## Read models (not persisted)

- **Account summary** (`list_accounts`): `{ accounts: [{ slug, isDefault }] }` for the mounted MCP only; empty array when none; never state, Credentials or subject (FR-059).
- **Admin row**: slug, email, display name, state, default flag, granted scopes, access expiry, last refreshed, last error code (FR-062).
- **Resource descriptor**: URI (`calendar://<account>/calendars/<pct-encoded-id>`, `notes://<account>/notebooks/<id>`) plus name/description; one per container per usable Account (FR-048, FR-057).

## Relationships

```text
MCP (enum: calendar|notes) 1 ── * Account * ── 1 Provider (enum: google|microsoft)
Account 1 ── * OAuth attempt (target_account_id, reauth only)
Account * ── 1 Default Account (per MCP, ≤ 1)
Account 1 ── * resource (derived: calendars or notebooks)
Account 1 ── 1 cache epoch ── * KV entries (derived)
```

## Validation rules collected

| Rule | Where enforced | Requirement |
| --- | --- | --- |
| slug pattern and per-MCP uniqueness | admin form + unique index | FR-006 |
| one Provider identity per MCP | unique index; duplicate reported with existing slug | FR-010 |
| one default per MCP | partial unique index | FR-029 |
| full Required scope set at authorize and at call time | callback check + call-path guard | FR-024, FR-025, FR-026 |
| refresh Credential present before create | callback | FR-009 |
| same subject on reauth | callback | FR-011 |
| encrypted at rest, AAD-bound | crypto module on every write/read | FR-020, FR-021 |
| lock token matches on persist | conditional `UPDATE` | FR-016, FR-019 |
| cursor signature and Account-set binding | pagination helper | FR-041 |
| exactly one parent for section list/create | tool input validation | FR-052 |
| page content cap and document size limit | tool handler | FR-054, FR-056 |
