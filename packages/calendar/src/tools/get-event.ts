import { z } from 'zod';
import { googleCalendar } from '../client';
import { accountSlug } from '../context';
import { toEvent } from '../map';
import { accountSchema } from '../schemas';
import { defineTool } from './helpers';

export const getEventTool = defineTool(
  'get_event',
  {
    title: 'Get event',
    description: 'Returns one event from a calendar, defaulting to the primary calendar.',
    inputSchema: z.object({
      account: accountSchema,
      eventId: z.string(),
      calendarId: z.string().optional(),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (args, ctx) => {
    const slug = await accountSlug(ctx, args.account);
    const client = googleCalendar(ctx, slug);
    const response = await client.events.get({
      calendarId: args.calendarId ?? 'primary',
      eventId: args.eventId,
    });
    return toEvent(response.data);
  },
);
