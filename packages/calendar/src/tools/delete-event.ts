import { z } from 'zod';
import { googleCalendar } from '../client';
import { accountSlug } from '../context';
import { toEvent } from '../map';
import { accountSchema, notificationLevelSchema, sendUpdatesFor } from '../schemas';
import { defineTool } from './helpers';

export const deleteEventTool = defineTool(
  'delete_event',
  {
    title: 'Delete event',
    description:
      'Deletes an event and returns the full Event it removed. events.delete returns an empty body, so the event is read first.',
    inputSchema: z.object({
      account: accountSchema,
      eventId: z.string(),
      calendarId: z.string().optional(),
      notificationLevel: notificationLevelSchema.optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  async (args, ctx) => {
    const slug = await accountSlug(ctx, args.account);
    const client = googleCalendar(ctx, slug);
    const calendarId = args.calendarId ?? 'primary';

    const existing = (await client.events.get({ calendarId, eventId: args.eventId })).data;
    await client.events.delete({
      calendarId,
      eventId: args.eventId,
      sendUpdates: sendUpdatesFor(args.notificationLevel),
    });

    return toEvent(existing);
  },
);
