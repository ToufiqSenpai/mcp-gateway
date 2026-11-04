# Runbook — MCP Gateway

Operator steps for a first deploy and for the routine repairs. Behaviour lives in
[`docs/SPEC.md`](./SPEC.md); this file is the checklist.

## 1. Prerequisites

- Cloudflare account with a zone for the chosen hostname (for example `gateway.example.com`).
- Google Cloud project with the Calendar API enabled and an OAuth client (Web application).
- Microsoft Entra app registration (tenant `common`) with a Web redirect URI.
- Node 22+ and pnpm 12.16.

## 2. Provision the Worker

```bash
pnpm install --frozen-lockfile
npx wrangler d1 create mcp-gateway      # copy database_id into wrangler.jsonc
npx wrangler kv namespace create CACHE  # copy id into wrangler.jsonc
```

Set the custom hostname in `routes`, keep `workers_dev: false` and `preview_urls: false`.
Access cannot protect `*.workers.dev`, so there is no preview deployment path.

## 3. Access applications

Create both applications in Zero Trust → Access → Applications.

| Application | Paths | Policy |
| --- | --- | --- |
| `mcp-gateway-admin` | `/`, `/admin*`, `/oauth/*` | Allow, Include → your email (One-time PIN) |
| `mcp-gateway-clients` | `/mcps/*` | Service Auth, one service token, strict |

Record the **Application Audience (AUD) tag** of each and the team domain
(`https://<team>.cloudflareaccess.com`).

## 4. Redirect URIs

Register both, in Google and in Entra:

- `https://<host>/oauth/callback/google`
- `https://<host>/oauth/callback/microsoft`
- `http://localhost:8787/oauth/callback/google` and `.../microsoft` for `pnpm dev`.

Add `<host>` as an authorized domain on the Google Branding page and **publish** the app.
While it sits in *Testing*, Google refresh tokens expire after seven days; that surfaces as
`invalid_grant` → `needs_reauth` → admin reauth.

## 5. Secrets

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put MICROSOFT_CLIENT_ID
npx wrangler secret put MICROSOFT_CLIENT_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY     # base64 of exactly 32 random bytes
npx wrangler secret put CURSOR_SIGNING_KEY       # long random string
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN    # https://<team>.cloudflareaccess.com
npx wrangler secret put CF_ACCESS_ADMIN_AUD
npx wrangler secret put CF_ACCESS_MCP_AUD
```

Generate the encryption key with `openssl rand -base64 32`. Losing it means every Account must
be reauthorized; changing it is the same operation.

For local development copy `.env.example` to `.env`, fill the same names, and keep
`ENVIRONMENT=development`. The dev bypass only activates on localhost and shows a banner.

## 6. Migrations and deploy

```bash
pnpm db:migrate:local     # local SQLite used by wrangler dev
pnpm db:migrate:remote    # D1
pnpm deploy               # tailwind build, then wrangler deploy
```

CI runs `typecheck`, `lint` and `test` on every push and PR; deploy is `workflow_dispatch`
only. The workflow needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## 7. First Accounts

1. Open `https://<host>/admin` (Access will ask for a one-time PIN).
2. Open `calendar`, type a slug such as `personal`, and approve consent for the operator's
   Google identity. The first Account to become active becomes the Default Account.
3. Open `notes` and repeat with the Microsoft identity.
4. Create a service token client in Access and call `/mcps/calendar` with
   `CF-Access-Client-Id` / `CF-Access-Client-Secret`.

## 8. Routine repairs

| Symptom | Action |
| --- | --- |
| Tool call says `needs_reauth` or `missing_scope` | Open the MCP in `/admin`, press **Reauth**, approve the same identity. |
| `invalid_grant` after a week | The Google app is still in *Testing*: publish the consent screen, then reauth. |
| Error names a slug and `/admin/mcps/<mcp>` | The Default Account is broken. Fix it, or pass `account` explicitly. |
| A refresh seems stuck | The lease is 30 s; retry after it expires. Nothing else to clear. |
| Revoke | Account page → **Revoke** → confirmation page. Credentials are deleted and the slug stays reserved. |

## 9. Operational notes

- **`notificationLevel` defaults to `ALL`** on `create_event`, `update_event`,
  `delete_event` and `respond_to_event`. That emails guests. Pass `NONE` or `EXTERNAL_ONLY`
  when a call must stay quiet.
- Enumeration is cached in KV for 300 s, keyed by `accounts.cache_epoch`. Account add,
  revoke, state change and `create_notebook` bump it; event, page and section writes do not.
- Logs redact Credentials; `last_error` stores an error code only.
- No cron runs. Expired `oauth_states` rows are cleaned opportunistically at the next flow.

## 10. Local smoke test

```bash
pnpm dev
```

Then exercise `/admin` (banner visible), add one Account per MCP, and run a read tool from
the admin **Test a tool** panel. `LIVE=1 pnpm test` is reserved for live smoke runs and must
never run in CI.
