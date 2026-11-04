import { z } from 'zod';
import { googleCalendar } from '../client';
import { accountSchema, pageSizeSchema, pageTokenSchema } from '../schemas';
import { ToolResult, clampPageSize, collectPages, defineTool, paginate } from './helpers';

interface CalendarRow {
  id?: string;
  summary?: string;
  description?: string;
  timeZone?: string;
}

export const listCalendarsTool = defineTool(
  'list_calendars',
  {
    title: 'List calendars',
    description:
      "Lists the calendars visible to each usable Account. Returns id, summary, description and timeZone; pageToken is the gateway's opaque cursor.",
    inputSchema: z.object({
      account: accountSchema,
      pageSize: pageSizeSchema,
      pageToken: pageTokenSchema,
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (args, ctx) => {
    const accounts = await ctx.listAccounts();
    const selected = args.account
      ? accounts.filter((account) => account.slug === args.account)
      : accounts;

    const page = await paginate<CalendarRow>({
      ctx,
      accounts: selected,
      pageToken: args.pageToken,
      pageSize: clampPageSize(args.pageSize),
      fetchAll: async () => {
        const rows: CalendarRow[] = [];
        let truncated = false;
        const skipped: string[] = [];

        for (const account of selected) {
          try {
            const client = googleCalendar(ctx, account.slug);
            const result = await collectPages(async (pageToken) => {
              const response = await client.calendarList.list({
                maxResults: 250,
                ...(pageToken ? { pageToken } : {}),
              });
              return {
                items: (response.data.items ?? []).map((item) => ({
                  ...(item.id ? { id: item.id } : {}),
                  ...(item.summary ? { summary: item.summary } : {}),
                  ...(item.description ? { description: item.description } : {}),
                  ...(item.timeZone ? { timeZone: item.timeZone } : {}),
                })),
                nextPageToken: response.data.nextPageToken,
              };
            });
            rows.push(...result.items);
            truncated ||= result.truncated;
          } catch {
            // A sick Account is skipped and reported, never faked.
            skipped.push(account.slug);
          }
        }

        return {
          items: rows,
          truncated: truncated || skipped.length > 0,
          ...(skipped.length > 0 ? { skipped } : {}),
        };
      },
    });

    return new ToolResult(
      {
        calendars: page.items,
        ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
      },
      { truncated: page.truncated },
    );
  },
);
