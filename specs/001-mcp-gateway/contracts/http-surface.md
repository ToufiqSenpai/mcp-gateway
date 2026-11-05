# Contract: HTTP surface

External interfaces: the MCP endpoints consumed by clients, the admin and OAuth routes consumed by the operator's browser, and the stylesheet route. Behaviour source: `docs/SPEC.md` §2, §7, §8, §15. All paths are on the single custom hostname.

## Authentication pairing

| Route group | Perimeter credential | On missing/invalid |
| --- | --- | --- |
| `/`, `/admin*`, `/oauth/*` | human session (Access JWT with `email` and UUID `sub`) | `401`/`403`, never a redirect from the Worker |
| `/mcps/*` | service token (Access JWT with empty `sub` and `common_name`) | `401`/`403`, never a login redirect |

Any other path is unprotected at the edge and answers `404` in the Worker. Every request is verified in the Worker: signature against the team JWKS, `iss` = team domain, `aud` = the application covering that path; a credential valid for the other group is `403` with no detail. `ENVIRONMENT=development` on localhost skips verification and injects a fake human identity, with a banner on every admin page.

## MCP endpoints

`POST /mcps/calendar` and `POST /mcps/notes`.

| Case | Response |
| --- | --- |
| Valid JSON-RPC request | `200` with one JSON body |
| `GET` / `DELETE` on the path | `405` |
| Unknown slug | `404` |
| Invalid service credential | `401`/`403` |
| Legacy protocol traffic (`legacy: 'reject'`) | refused by the handler, not served |
| `Mcp-Session-Id` | never minted or echoed |
| `Cache-Control` / `ETag` | never set |

## Admin and OAuth routes

| Method | Path | Purpose | Success |
| --- | --- | --- | --- |
| GET | `/` | entry | `302` → `/admin` |
| GET | `/admin` | MCP list: slug, endpoint, Provider, Accounts per state, default | `200` HTML |
| GET | `/admin/mcps/:mcp` | Accounts table and actions | `200` HTML; unknown MCP `404` |
| POST | `/admin/mcps/:mcp/accounts` | start add flow with typed slug | `303` to the Provider's consent URL |
| POST | `/admin/mcps/:mcp/accounts/:slug/reauth` | start reauth | `303` to the Provider's consent URL |
| POST | `/admin/mcps/:mcp/accounts/:slug/revoke` | revoke after confirmation | `303` → `/admin/mcps/:mcp` |
| POST | `/admin/mcps/:mcp/accounts/:slug/default` | set default | `303` → `/admin/mcps/:mcp` |
| GET | `/admin/mcps/:mcp/test` | tool picker, Account selector, JSON args | `200` HTML |
| POST | `/admin/mcps/:mcp/test` | run one tool in-process | `200` HTML with JSON-RPC result + duration |
| GET | `/admin/app.css` | built stylesheet | `200` `text/css`, `Cache-Control: private, max-age=3600`, build-hash `ETag` |
| GET | `/oauth/callback/:provider` | authorization callback | `302` to the MCP's admin page, outcome in query |

**Mutation discipline**: every mutation is `POST` returning `303` (POST-redirect-GET), requiring `Origin`/`Sec-Fetch-Site` to match the hostname and a double-submit `admin_csrf` cookie whose value equals the hidden field. Revoke requires a confirmation page; no `confirm()`.

**Callback outcomes** (query on the admin page): `?added=<slug>` or `?error=` one of `denied`, `duplicate` (plus `slug=<existing>`), `no_refresh_token`, `state`, `identity_mismatch`, `slug_taken`, `missing_scope`. The callback never renders HTML and never puts tokens or emails in the URL.

**Redaction**: no response body, URL, log line or rendered page may contain access/refresh Credentials (ciphertext or plaintext), Provider client secrets, `provider_subject`, `TOKEN_ENCRYPTION_KEY`, `CURSOR_SIGNING_KEY`, any JWT, OAuth attempt contents, or raw Provider response bodies. Errors show a code plus one sentence; `500` carries no stack trace.

## Deployment preconditions (not application routes)

Custom hostname with `workers_dev: false` and `preview_urls: false`; two Access applications with the path coverage above; redirect addresses `https://<host>/oauth/callback/{google,microsoft}` registered in both consoles plus `http://localhost:8787/...` for local development; Google consent screen published; all secrets set with `wrangler secret put`; remote migrations applied.
