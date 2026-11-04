import { z } from 'zod';
import { defineTool } from './helpers';

export const listAccountsTool = defineTool(
  'list_accounts',
  {
    title: 'List accounts',
    description:
      'Lists the Accounts available to this MCP as { slug, isDefault }. Never returns state, Credentials or provider subjects. An empty array means no Accounts are configured.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (_args, ctx) => ({ accounts: await ctx.listAccounts() }),
);
