import { AccountRepository } from "../db/account-repository"
import type { Env } from "../env"
import { MCP_REGISTRY, MCP_SLUGS } from "../mcps/registry"
import { productIcon } from "./icons"
import { Layout } from "./layout"

export interface McpRow {
  slug: string
  provider: string
  counts: Record<string, number>
  defaultSlug?: string
}

export async function loadMcpRows(env: Env): Promise<McpRow[]> {
  const repository = new AccountRepository(env)
  return Promise.all(
    MCP_SLUGS.map(async slug => {
      const [counts, defaultAccount] = await Promise.all([repository.countByState(slug), repository.findDefault(slug)])
      return {
        slug,
        provider: MCP_REGISTRY[slug].provider,
        counts,
        defaultSlug: defaultAccount?.slug
      }
    })
  )
}

export function HomePage({ rows, devBypass }: { rows: McpRow[]; devBypass: boolean }) {
  return (
    <Layout title="MCP Gateway" devBypass={devBypass}>
      <h1 class="mb-6 text-2xl font-bold">MCPs</h1>
      <div class="grid gap-4 sm:grid-cols-2">
        {rows.map(row => {
          const icon = productIcon(row.slug)
          return (
            <a
              key={row.slug}
              href={`/admin/mcps/${row.slug}`}
              class="group block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow"
            >
              <div class="flex items-center gap-2">
                {icon ? <img src={icon.src} alt="" width="24" height="24" class="h-6 w-6" /> : null}
                <h2 class="text-lg font-semibold group-hover:text-blue-700">{row.slug}</h2>
                <span class="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{row.provider}</span>
              </div>
              <p class="mt-2 font-mono text-xs text-slate-500">/mcps/{row.slug}</p>
              <p class="mt-3 text-sm text-slate-600">
                {row.counts.active ?? 0} active · {row.counts.needs_reauth ?? 0} reauth · {row.counts.revoked ?? 0}{" "}
                revoked
              </p>
              <p class="mt-1 text-xs text-slate-600">
                Default: <span class="font-mono">{row.defaultSlug ?? "—"}</span>
              </p>
            </a>
          )
        })}
      </div>
    </Layout>
  )
}
