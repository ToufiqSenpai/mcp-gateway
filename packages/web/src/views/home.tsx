import type { Env } from '../env';
import { countAccountsByState, findDefaultAccount } from '../db/queries';
import { createDb } from '../db/client';
import { MCP_REGISTRY, MCP_SLUGS } from '../mcps/registry';
import { Layout } from '../views/layout';

export interface McpRow {
  slug: string;
  provider: string;
  counts: Record<string, number>;
  defaultSlug?: string;
}

export async function loadMcpRows(env: Env): Promise<McpRow[]> {
  const db = createDb(env);
  return Promise.all(
    MCP_SLUGS.map(async (slug) => {
      const [counts, defaultAccount] = await Promise.all([
        countAccountsByState(db, slug),
        findDefaultAccount(db, slug),
      ]);
      return {
        slug,
        provider: MCP_REGISTRY[slug].provider,
        counts,
        defaultSlug: defaultAccount?.slug,
      };
    }),
  );
}

export function HomePage({ rows, devBypass }: { rows: McpRow[]; devBypass: boolean }) {
  return (
    <Layout title="MCP Gateway" devBypass={devBypass}>
      <h1 class="mb-6 text-2xl font-bold">MCPs</h1>
      <table class="w-full border-collapse text-left text-sm">
        <thead>
          <tr class="border-b border-slate-300">
            <th class="py-2">MCP</th>
            <th class="py-2">Endpoint</th>
            <th class="py-2">Provider</th>
            <th class="py-2">Accounts</th>
            <th class="py-2">Default</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr class="border-b border-slate-200">
              <td class="py-2 font-medium">
                <a class="text-blue-700 underline" href={`/admin/mcps/${row.slug}`}>
                  {row.slug}
                </a>
              </td>
              <td class="py-2 font-mono text-xs">/mcps/{row.slug}</td>
              <td class="py-2">{row.provider}</td>
              <td class="py-2">
                {row.counts.active ?? 0} active, {row.counts.needs_reauth ?? 0} reauth,{' '}
                {row.counts.revoked ?? 0} revoked
              </td>
              <td class="py-2">{row.defaultSlug ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Layout>
  );
}
