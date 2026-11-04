import { z } from 'zod';
import { googleCalendar } from '../client';
import { accountSlug } from '../context';
import { toEvent, type CalendarEvent } from '../map';
import { accountSchema, pageSizeSchema, pageTokenSchema } from '../schemas';
import { ToolResult, clampPageSize, collectPages, defineTool, paginate } from './helpers';

export const searchEventsTool = defineTool(
  'search_events',
  {
    title: 'Search events',
    description:
      'Literal text search over the primary calendar, matching text rather than meaning. Takes no calendarId and no time bounds.',
    inputSchema: z.object({
      account: accountSchema,
      query: z.string().min(1),
      pageSize: pageSizeSchema,
      pageToken: pageTokenSchema,
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (args, ctx) => {
    const slug = await accountSlug(ctx, args.account);
    const client = googleCalendar(ctx, slug);
    const accounts = await ctx.listAccounts();

    const collected = await collectPages<CalendarEvent>(async (pageToken) => {
      const response = await client.events.list({
        calendarId: 'primary',
        q: args.query,
        singleEvents: true,
        maxResults: 250,
        ...(pageToken ? { pageToken } : {}),
      });
      return {
        items: (response.data.items ?? []).map(toEvent),
        nextPageToken: response.data.nextPageToken,
      };
    });

    const page = await paginate<CalendarEvent>({
      ctx,
      accounts,
      pageToken: args.pageToken,
      pageSize: clampPageSize(args.pageSize),
      fetchAll: async () => ({ items: collected.items, truncated: collected.truncated }),
    });

    return new ToolResult(
      {
        events: page.items,
        ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
      },
      { truncated: page.truncated },
    );
  },
);

