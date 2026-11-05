# MCP Gateway

A single-user gateway on Cloudflare Workers that hosts first-party MCP servers under
`/mcps/<slug>`. Two MCPs ship today: `calendar` (Google Calendar) and `notes`
(Microsoft Graph OneNote). Each MCP supports several accounts, a per-MCP Default Account
and per-request account selection, plus MCP resources and prompts.

**Status:** v1 implemented. The decisions that are hard to reverse are recorded in
[docs/adr/](docs/adr/).

## What it does

- **Multiple accounts per MCP** — pick one with `account=<slug>`, or fall back to the
  MCP's Default Account.
- **OAuth with PKCE** for Google and Microsoft, refresh-token rotation, and a
  single-writer refresh lock so concurrent calls cannot clobber a token.
- **Credentials encrypted at rest** in D1 (AES-256-GCM), never rendered by the admin UI.
- **MCP `2026-07-28`, stateless** — one server instance per request, no Durable Objects.
- **Cloudflare Access in front of everything** — service tokens for `/mcps/*`, a human
  session for `/admin*` and `/oauth/*`. The Worker verifies the JWT itself.
- **Server-rendered admin UI** — add, reauth, revoke, set default, inspect account health,
  and run any tool in-process.

## Architecture

```
MCP client ──service token──► /mcps/:slug ──► registry ──► CalendarServer / NotesServer
Browser    ──Access session─► /admin*, /oauth/* ──► admin router + OAuth callbacks
```

One Worker, one deployable. A pnpm workspace splits the code into the Worker
(`packages/web`, which owns D1, KV, accounts, credentials and refresh) and one library per
MCP (`packages/calendar`, `packages/notes`). MCP packages never touch D1 or the OAuth
client — they receive an `McpContext` with token and cursor access
([ADR-0006](docs/adr/0006-mcp-servers-as-libraries.md)).

## Requirements

- Node.js 26+
- pnpm 12.16
- A Cloudflare account with a zone (deploy only)
- A Google OAuth client and a Microsoft Entra app registration

## Local development

```bash
pnpm install
cp .env.example .env     # fill in provider credentials and local keys
pnpm db:migrate:local
pnpm dev
```

Open <http://localhost:8787/admin>. With `ENVIRONMENT=development` on localhost, Cloudflare
Access is bypassed and a fake operator identity is injected; every admin page shows a
banner. Provider credentials are still required to add an account. Environment variables are
listed in [`.env.example`](.env.example).

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Tailwind watcher + `wrangler dev` with live reload |
| `pnpm test` | Run every package's tests |
| `pnpm typecheck` | `tsc -b` across project references |
| `pnpm lint` / `pnpm format` | oxlint / oxfmt (no ESLint, no Prettier) |
| `pnpm db:generate` | Generate a Drizzle migration |
| `pnpm db:migrate:local` / `db:migrate:remote` | Apply migrations to local SQLite / D1 |
| `pnpm deploy` | Build CSS, then `wrangler deploy` |

## Deploy

```bash
pnpm install --frozen-lockfile
npx wrangler d1 create mcp-gateway        # put database_id into wrangler.jsonc
npx wrangler kv namespace create CACHE    # put id into wrangler.jsonc
```

Set `routes[0].pattern` and `vars.PUBLIC_HOSTNAME` to the same hostname (no scheme or
port). Keep `workers_dev` and `preview_urls` off — Access cannot protect `*.workers.dev`.

Create both applications in Zero Trust → Access → Applications, then record their AUD tags
and the team domain:

| Application | Paths | Policy |
| --- | --- | --- |
| `mcp-gateway-admin` | `/`, `/admin*`, `/oauth/*` | Allow, Include → your email (One-time PIN) |
| `mcp-gateway-clients` | `/mcps/*` | Service Auth, one service token, strict |

Register these redirect URIs with Google and Entra:

- `https://<host>/oauth/callback/google`
- `https://<host>/oauth/callback/microsoft`

Add `<host>` as an authorized domain on the Google Branding page and **publish** the app.
While it sits in *Testing*, Google refresh tokens expire after seven days, which surfaces as
`invalid_grant` → `needs_reauth`.

Set the secrets, then migrate and deploy:

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

pnpm db:migrate:remote
pnpm deploy
```

Generate the encryption key with `openssl rand -base64 32`. Losing or changing it means
every Account must be reauthorized. A push to `main` runs the same migrate-and-deploy
workflow (`.github/workflows/ci.yml`) with the `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` repository secrets; `workflow_dispatch` redeploys.

Open `https://<host>/admin`, add one Account per MCP (the first Account to become active
becomes the Default Account), then call `/mcps/calendar` with `CF-Access-Client-Id` and
`CF-Access-Client-Secret` from the service token.

### Routine repairs

| Symptom | Action |
| --- | --- |
| `needs_reauth` or `missing_scope` | Open the MCP in `/admin`, press **Reauth**, approve the same identity. |
| `invalid_grant` after a week | The Google app is still in *Testing*: publish the consent screen, then reauth. |
| Error names a slug and `/admin/mcps/<mcp>` | The Default Account is broken. Fix it, or pass `account` explicitly. |
| A refresh seems stuck | The lease is 30 s; retry after it expires. |
| Revoke | Account page → **Revoke** → confirmation. Credentials are deleted; the slug stays reserved. |

`notificationLevel` defaults to `ALL` on `create_event`, `update_event`, `delete_event` and
`respond_to_event`, so those calls email guests. Pass `NONE` or `EXTERNAL_ONLY` when a call
must stay quiet.

## Documentation

- [docs/adr/](docs/adr/) — decisions that are hard to reverse

## License

[AGPL-3.0-only](LICENSE).

If you run a modified version of this gateway as a network service, section 13 of the
license requires you to offer its source to the people using it. The source lives at
<https://github.com/ToufiqSenpai/mcp-gateway>; open an issue there if you need the source
in another form.
