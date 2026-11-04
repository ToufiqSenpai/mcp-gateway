import { z } from 'zod';
import type { calendar_v3 } from '@googleapis/calendar';
import { googleCalendar } from '../client';
import { accountSlug } from '../context';
import { toAttendeeList, toEvent } from '../map';
import {
  accountSchema,
  attachmentSchema,
  attendeeSchema,
  availabilitySchema,
  dateTimeSchema,
  eventTypeSchema,
  notificationLevelSchema,
  reminderSchema,
  sendUpdatesFor,
  visibilitySchema,
} from '../schemas';
import { defineTool } from './helpers';

const guestPermissionsSchema = z.enum(['modify', 'inviteOthers', 'seeOtherInvites']);

function permissionsToBody(permissions: string[] | undefined): calendar_v3.Schema$Event {
  if (!permissions) return {};
  return {
    ...(permissions.includes('modify') ? { guestsCanModify: true } : {}),
    ...(permissions.includes('inviteOthers') ? { guestsCanInviteOthers: true } : {}),
    ...(permissions.includes('seeOtherInvites') ? { guestsCanSeeOtherGuests: true } : {}),
  };
}

export const createEventTool = defineTool(
  'create_event',
  {
    title: 'Create event',
    description:
      'Creates an event and returns the full Event. notificationLevel defaults to ALL, which emails guests; REST defaults to sending nothing.',
    inputSchema: z.object({
      account: accountSchema,
      summary: z.string(),
      startTime: dateTimeSchema,
      endTime: dateTimeSchema,
      calendarId: z.string().optional(),
      allDay: z.boolean().optional(),
      addGoogleMeetUrl: z.boolean().optional(),
      googleMeetUrl: z.string().optional(),
      attendees: z.array(attendeeSchema).optional(),
      attendeeEmails: z
        .array(z.string())
        .optional()
        .describe('Deprecated. Use attendees.'),
      attachments: z.array(attachmentSchema).optional(),
      availability: availabilitySchema.optional(),
      colorId: z.string().optional(),
      description: z.string().optional(),
      eventType: eventTypeSchema.optional(),
      guestPermissions: z.array(guestPermissionsSchema).optional(),
      location: z.string().optional(),
      notificationLevel: notificationLevelSchema.optional(),
      overrideReminders: z.array(reminderSchema).optional(),
      recurrenceData: z.array(z.string()).optional(),
      timeZone: z.string().optional(),
      visibility: visibilitySchema.optional(),
      workingLocationProperties: z.record(z.string(), z.unknown()).optional(),
    }),
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  async (args, ctx) => {
    const slug = await accountSlug(ctx, args.account);
    const client = googleCalendar(ctx, slug);

    const start = args.allDay
      ? { date: args.startTime.slice(0, 10) }
      : { dateTime: args.startTime, ...(args.timeZone ? { timeZone: args.timeZone } : {}) };
    const end = args.allDay
      ? { date: args.endTime.slice(0, 10) }
      : { dateTime: args.endTime, ...(args.timeZone ? { timeZone: args.timeZone } : {}) };

    const attendees =
      toAttendeeList(args.attendees) ??
      args.attendeeEmails?.map((email) => ({ email })) ??
      undefined;

    const conferenceData =
      args.addGoogleMeetUrl || args.googleMeetUrl
        ? {
            ...(args.addGoogleMeetUrl
              ? {
                  createRequest: {
                    requestId: crypto.randomUUID(),
                    conferenceSolutionKey: { type: 'hangoutsMeet' },
                  },
                }
              : {}),
            ...(args.googleMeetUrl
              ? {
                  entryPoints: [
                    { entryPointType: 'video', uri: args.googleMeetUrl },
                  ],
                }
              : {}),
          }
        : undefined;

    const requestBody: calendar_v3.Schema$Event = {
      summary: args.summary,
      start,
      end,
      ...(args.calendarId ? {} : {}),
      ...(args.location ? { location: args.location } : {}),
      ...(args.description ? { description: args.description } : {}),
      ...(args.colorId ? { colorId: args.colorId } : {}),
      ...(args.visibility ? { visibility: args.visibility } : {}),
      ...(args.eventType ? { eventType: args.eventType } : {}),
      ...(attendees ? { attendees } : {}),
      ...(args.attachments ? { attachments: args.attachments } : {}),
      ...(args.recurrenceData ? { recurrence: args.recurrenceData } : {}),
      ...(args.overrideReminders
        ? { reminders: { useDefault: false, overrides: args.overrideReminders } }
        : {}),
      ...(args.workingLocationProperties
        ? {
            workingLocationProperties:
              args.workingLocationProperties as calendar_v3.Schema$EventWorkingLocationProperties,
          }
        : {}),
      ...(args.availability === 'AVAILABILITY_FREE'
        ? { transparency: 'transparent' }
        : args.availability === 'AVAILABILITY_BUSY'
          ? { transparency: 'opaque' }
          : {}),
      ...permissionsToBody(args.guestPermissions),
      ...(conferenceData ? { conferenceData } : {}),
    };

    const response = await client.events.insert({
      calendarId: args.calendarId ?? 'primary',
      sendUpdates: sendUpdatesFor(args.notificationLevel),
      ...(conferenceData ? { conferenceDataVersion: 1 } : {}),
      requestBody,
    });

    return toEvent(response.data);
  },
);
