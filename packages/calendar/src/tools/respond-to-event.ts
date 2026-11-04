import { z } from 'zod';
import type { calendar_v3 } from '@googleapis/calendar';
import { googleCalendar } from '../client';
import { accountSlug } from '../context';
import { toEvent } from '../map';
import {
  accountSchema,
  notificationLevelSchema,
  responseStatusSchema,
  sendUpdatesFor,
} from '../schemas';
import { defineTool } from './helpers';

export const respondToEventTool = defineTool(
  'respond_to_event',
  {
    title: 'Respond to event',
    description:
      'Responds to an invitation with a targeted patch: attendeesOmitted=true and a single attendee entry for the current user. notificationLevel defaults to ALL.',
    inputSchema: z.object({
      account: accountSchema,
      eventId: z.string(),
      responseStatus: responseStatusSchema,
      calendarId: z.string().optional(),
      notificationLevel: notificationLevelSchema.optional(),
      responseComment: z.string().optional(),
    }),
    annotations: { idempotentHint: true, destructiveHint: false },
  },
  async (args, ctx) => {
    const slug = await accountSlug(ctx, args.account);
    const client = googleCalendar(ctx, slug);
    const calendarId = args.calendarId ?? 'primary';

    const current = (await client.events.get({ calendarId, eventId: args.eventId })).data;
    const self = current.attendees?.find((attendee) => attendee.self === true);
    if (!self?.email) {
      throw new Error(
        `Event "${args.eventId}" has no attendee representing the current user, so there is nothing to respond to.`,
      );
    }

    const requestBody = {
      attendeesOmitted: true,
      attendees: [
        {
          email: self.email,
          responseStatus: args.responseStatus,
          ...(args.responseComment ? { comment: args.responseComment } : {}),
        },
      ],
    } as calendar_v3.Schema$Event;

    const response = await client.events.patch({
      calendarId,
      eventId: args.eventId,
      sendUpdates: sendUpdatesFor(args.notificationLevel),
      requestBody,
    });

    return toEvent(response.data);
  },
);
