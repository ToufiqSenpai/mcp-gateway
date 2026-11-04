import type { Account } from "../db/schema"
import { Layout } from "./layout"

export interface McpPageProps {
  mcp: string
  provider: string
  accounts: Account[]
  csrf: string
  devBypass: boolean
  notice?: string
  noticeKind?: "ok" | "error"
}

const ERROR_SENTENCES = new Map<string, string>([
  ["denied", "The Provider did not complete the authorization."],
  ["duplicate", "That Provider identity is already an Account on this MCP."],
  ["no_refresh_token", "The Provider issued no refresh token, so the Account would not be usable."],
  ["state", "That authorization attempt was invalid or had expired. Start again."],
  ["identity_mismatch", "The Provider identity differs from the Account you tried to reauthorize."],
  ["slug_taken", "That slug is already reserved for this MCP. Pick another."],
  ["missing_scope", "Not every required permission was granted, so nothing was changed."]
])

export function errorSentence(code: string): string {
  return ERROR_SENTENCES.get(code) ?? "The request could not be completed."
}

function expiry(value: number): string {
  return new Date(value * 1000).toISOString().replace("T", " ").slice(0, 19)
}

export function McpPage({ mcp, provider, accounts, csrf, devBypass, notice, noticeKind }: McpPageProps) {
  return (
    <Layout title={`${mcp} — MCP Gateway`} devBypass={devBypass}>
      <nav class="mb-4 text-sm">
        <a class="text-blue-700 underline" href="/admin">
          ← All MCPs
        </a>
      </nav>
      <h1 class="mb-1 text-2xl font-bold">{mcp}</h1>
      <p class="mb-6 text-sm text-slate-600">
        Provider: {provider} · endpoint <span class="font-mono">/mcps/{mcp}</span>
      </p>

      {notice ? (
        <p
          class={`mb-4 rounded border px-3 py-2 text-sm ${
            noticeKind === "ok"
              ? "border-green-300 bg-green-50 text-green-900"
              : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          {notice}
        </p>
      ) : null}

      <section class="mb-8">
        <h2 class="mb-2 text-lg font-semibold">Add an Account</h2>
        <form method="post" action={`/admin/mcps/${mcp}/accounts`} class="flex gap-2">
          <input type="hidden" name="_csrf" value={csrf} />
          <input
            name="slug"
            required
            pattern="[a-z0-9][a-z0-9-]{0,31}"
            placeholder="slug, e.g. personal"
            class="rounded border border-slate-300 px-2 py-1 font-mono text-sm"
          />
          <button class="rounded bg-slate-900 px-3 py-1 text-sm text-white" type="submit">
            Authorize
          </button>
        </form>
      </section>

      <section>
        <h2 class="mb-2 text-lg font-semibold">Accounts</h2>
        {accounts.length === 0 ? (
          <p class="text-sm text-slate-600">No Accounts yet.</p>
        ) : (
          <table class="w-full border-collapse text-left text-sm">
            <thead>
              <tr class="border-b border-slate-300">
                <th class="py-2">Slug</th>
                <th class="py-2">Email</th>
                <th class="py-2">Name</th>
                <th class="py-2">State</th>
                <th class="py-2">Default</th>
                <th class="py-2">Scopes</th>
                <th class="py-2">Access expiry</th>
                <th class="py-2">Last refreshed</th>
                <th class="py-2">Last error</th>
                <th class="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(account => (
                <tr class="border-b border-slate-200 align-top">
                  <td class="py-2 font-mono">{account.slug}</td>
                  <td class="py-2">{account.email}</td>
                  <td class="py-2">{account.displayName ?? "—"}</td>
                  <td class="py-2">{account.state}</td>
                  <td class="py-2">{account.isDefault === 1 ? "yes" : "—"}</td>
                  <td class="py-2 text-xs text-slate-600">{account.scopes}</td>
                  <td class="py-2">{expiry(account.accessTokenExpiresAt)}</td>
                  <td class="py-2">{account.lastRefreshedAt ? expiry(account.lastRefreshedAt) : "—"}</td>
                  <td class="py-2">{account.lastError ?? "—"}</td>
                  <td class="py-2">
                    <div class="flex flex-wrap gap-1">
                      <form method="post" action={`/admin/mcps/${mcp}/accounts/${account.slug}/reauth`}>
                        <input type="hidden" name="_csrf" value={csrf} />
                        <button class="rounded border border-slate-300 px-2 py-0.5 text-xs" type="submit">
                          Reauth
                        </button>
                      </form>
                      {account.state === "active" && account.isDefault === 0 ? (
                        <form method="post" action={`/admin/mcps/${mcp}/accounts/${account.slug}/default`}>
                          <input type="hidden" name="_csrf" value={csrf} />
                          <button class="rounded border border-slate-300 px-2 py-0.5 text-xs" type="submit">
                            Set default
                          </button>
                        </form>
                      ) : null}
                      {account.state !== "revoked" ? (
                        <a
                          class="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700"
                          href={`/admin/mcps/${mcp}/accounts/${account.slug}/revoke`}
                        >
                          Revoke
                        </a>
                      ) : (
                        <form method="post" action={`/admin/mcps/${mcp}/accounts/${account.slug}/reauth`}>
                          <input type="hidden" name="_csrf" value={csrf} />
                          <button class="rounded border border-slate-300 px-2 py-0.5 text-xs" type="submit">
                            Reauthorize
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Layout>
  )
}

export function RevokeConfirmationPage({
  mcp,
  slug,
  csrf,
  devBypass
}: {
  mcp: string
  slug: string
  csrf: string
  devBypass: boolean
}) {
  return (
    <Layout title={`Revoke ${slug} — MCP Gateway`} devBypass={devBypass}>
      <h1 class="mb-4 text-2xl font-bold">Revoke Account “{slug}”?</h1>
      <p class="mb-4 text-sm text-slate-700">
        Its Credentials are deleted, it stops being the Default Account, and the slug stays reserved. Reauthorizing the
        same identity is the only way back.
      </p>
      <form method="post" action={`/admin/mcps/${mcp}/accounts/${slug}/revoke`}>
        <input type="hidden" name="_csrf" value={csrf} />
        <button class="rounded bg-red-700 px-3 py-1 text-sm text-white" type="submit">
          Revoke permanently
        </button>
      </form>
      <p class="mt-4 text-sm">
        <a class="text-blue-700 underline" href={`/admin/mcps/${mcp}`}>
          Cancel
        </a>
      </p>
    </Layout>
  )
}
