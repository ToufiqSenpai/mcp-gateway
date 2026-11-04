import { z } from 'zod';
import { graphClient } from '../client';
import { accountSlug } from '../context';
import { PAGE_SELECT, toPage, type GraphPage } from '../map';
import { ToolResult, defineTool, paginate } from './helpers';

export const searchPagesTool = defineTool(
  'search_pages',
  {
    title: 'Search pages',
    description:
      'Case-insensitive substring match on the page title only. Graph has no page-content search endpoint.',
    inputSchema: z.object({
      account: z.string().optional(),
      query: z.string().min(1),
      sectionId: z.string().optional(),
      cursor: z.string().optional(),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (args, ctx) => {
    const slug = await accountSlug(ctx, args.account);
    const client = graphClient(ctx, slug);
    const path = args.sectionId
      ? `/me/onenote/sections/${encodeURIComponent(args.sectionId)}/pages`
      : '/me/onenote/pages';

    const collected = await client.collect<GraphPage>(
      `${path}?$select=${PAGE_SELECT}&$expand=parentSection&$top=100`,
    );
    const needle = args.query.toLowerCase();
    const matches = collected.items
      .map(toPage)
      .filter((page) => (page.title ?? '').toLowerCase().includes(needle));

    const page = await paginate<ReturnType<typeof toPage>>({
      ctx,
      accounts: [{ slug }],
      cursor: args.cursor,
      fetchAll: async () => ({ items: matches, truncated: collected.truncated }),
    });

    return new ToolResult(
      {
        pages: page.items,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      },
      { truncated: page.truncated },
    );
  },
);
