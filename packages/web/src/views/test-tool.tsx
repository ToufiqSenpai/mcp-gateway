import type { Account } from '../db/schema';
import { Layout } from './layout';

export interface TestToolProps {
  mcp: string;
  tools: { name: string; title?: string; description?: string }[];
  accounts: Account[];
  csrf: string;
  devBypass: boolean;
  result?: {
    tool: string;
    body: string;
    isError: boolean;
    durationMs: number;
  };
  error?: string;
}

const WRITE_TOOLS = new Set([
  'create_event',
  'update_event',
  'delete_event',
  'respond_to_event',
  'create_page',
  'update_page',
  'delete_page',
  'create_section',
  'create_notebook',
]);

export function TestToolPage({
  mcp,
  tools,
  accounts,
  csrf,
  devBypass,
  result,
  error,
}: TestToolProps) {
  const defaultAccount = accounts.find((account) => account.isDefault === 1)?.slug;

  return (
    <Layout title={`Test a tool — ${mcp}`} devBypass={devBypass}>
      <nav class="mb-4 text-sm">
        <a class="text-blue-700 underline" href={`/admin/mcps/${mcp}`}>
          ← {mcp}
        </a>
      </nav>
      <h1 class="mb-4 text-2xl font-bold">Test a tool</h1>

      {error ? (
        <p class="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      ) : null}

      <form method="post" action={`/admin/mcps/${mcp}/test`} class="mb-8 space-y-3">
        <input type="hidden" name="_csrf" value={csrf} />
        <div>
          <label class="block text-sm font-medium" for="tool">
            Tool
          </label>
          <select id="tool" name="tool" class="rounded border border-slate-300 px-2 py-1 text-sm">
            {tools.map((tool) => (
              <option value={tool.name}>
                {tool.name}
                {WRITE_TOOLS.has(tool.name) ? ' (write)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium" for="account">
            Account
          </label>
          <select id="account" name="account" class="rounded border border-slate-300 px-2 py-1 text-sm">
            <option value="">Default Account{defaultAccount ? ` (${defaultAccount})` : ''}</option>
            {accounts.map((account) => (
              <option value={account.slug}>{account.slug}</option>
            ))}
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium" for="args">
            Arguments (JSON)
          </label>
          <textarea
            id="args"
            name="args"
            rows={8}
            class="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
          >
            {'{}'}
          </textarea>
        </div>
        <button class="rounded bg-slate-900 px-3 py-1 text-sm text-white" type="submit">
          Run
        </button>
      </form>

      {result ? (
        <section>
          <h2 class="mb-2 text-lg font-semibold">
            {result.tool} — {result.isError ? 'error' : 'ok'} in {result.durationMs} ms
          </h2>
          <pre class="overflow-auto rounded border border-slate-300 bg-white p-3 text-xs">
            {result.body}
          </pre>
        </section>
      ) : null}
    </Layout>
  );
}
