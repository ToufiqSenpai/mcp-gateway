import { z } from 'zod';
import type { calendar_v3 } from '@googleapis/calendar';
import { googleCalendar } from '../client';
import { accountSlug } from '../context';
import { toEvent, type CalendarEvent } from '../map';
import {
  accountSchema,
  dateTimeSchema,
  eventTypeSchema,
  orderBySchema,
  pageSizeSchema,
  pageTokenSchema,
} from '../schemas';
import { ToolResult, clampPageSize, collectPages, defineTool, paginate } from './helpers';

const DEFAULT_EVENT_TYPES = [
  'DEFAULT',
  'OUT_OF_OFFICE',
  'FOCUS_TIME',
  'FROM_GMAIL',
] as const;

function isoSecurityWindow(startTime: string | undefined, endTime: string | undefined) {
  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    timeMin: startTime ?? now.toISOString(),
    timeMax: endTime ?? weekAhead.toISOString(),
  };
}

function matchesFullText(event: CalendarEvent, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [
    event.summary ?? '',
    event.description ?? '',
    event.location ?? '',
    ...(event.attendees ?? []).flatMap((attendee) => [attendee.email ?? '', attendee.displayName ?? '']),
  ]
    .join('\n')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export const listEventsTool = defineTool(
  'list_events',
  {
    title: 'List events',
    description:
      'Lists events from one calendar, defaulting to now through the next 7 days. Hides WORKING_LOCATION and BIRTHDAY unless requested. fullText matches title, description, location or attendees case-insensitively; every term must match.',
    inputSchema: z.object({
      account: accountSchema,
      calendarId: z.string().optional(),
      startTime: dateTimeSchema.optional(),
      endTime: dateTimeSchema.optional(),
      fullText: z.string().optional(),
      eventType: z.array(eventTypeSchema).optional(),
      eventTypeFilter: z
        .array(eventTypeSchema)
        .optional()
        .describe('Deprecated. Use eventType.'),
      orderBy: orderBySchema.optional(),
      pageSize: pageSizeSchema,
      pageToken: pageTokenSchema,
      timeZone: z.string().optional(),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (args, ctx) => {
    const slug = await accountSlug(ctx, args.account);
    const client = googleCalendar(ctx, slug);
    const calendarId = args.calendarId ?? 'primary';
    const { timeMin, timeMax } = isoSecurityWindow(args.startTime, args.endTime);
    const eventTypes = args.eventType ?? args.eventTypeFilter ?? [...DEFAULT_EVENT_TYPES];
    const accounts = await ctx.listAccounts();

    let meta: calendar_v3.Schema$Events | undefined;
    const collected = await collectPages<CalendarEvent>(async (pageToken) => {
      const response = await client.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        maxResults: 250,
        eventTypes,
        ...(args.orderBy ? { orderBy: args.orderBy } : {}),
        ...(args.timeZone ? { timeZone: args.timeZone } : {}),
        ...(pageToken ? { pageToken } : {}),
      });
      meta ??= response.data;
      return {
        items: (response.data.items ?? []).map(toEvent),
        nextPageToken: response.data.nextPageToken,
      };
    });

    const filtered = args.fullText
      ? collected.items.filter((event) => matchesFullText(event, args.fullText as string))
      : collected.items;

    const page = await paginate<CalendarEvent>({
      ctx,
      accounts,
      pageToken: args.pageToken,
      pageSize: clampPageSize(args.pageSize),
      fetchAll: async () => ({ items: filtered, truncated: collected.truncated }),
    });

    return new ToolResult(
      {
        summary: meta?.summary,
        description: meta?.description,
        updated: meta?.updated,
        timeZone: meta?.timeZone,
        accessRole: meta?.accessRole,
        defaultReminders: meta?.defaultReminders ?? [],
        events: page.items,
        ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
      },
      { truncated: page.truncated },
    );
  },
);

