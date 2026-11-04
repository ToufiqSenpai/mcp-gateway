import { z } from 'zod';
import type { calendar_v3 } from '@googleapis/calendar';
import { googleCalendar } from '../client';
import { accountSlug } from '../context';
import { toEvent } from '../map';
import {
  accountSchema,
  attachmentSchema,
  attendeeSchema,
  availabilitySchema,
  dateTimeSchema,
  notificationLevelSchema,
  reminderSchema,
  sendUpdatesFor,
  visibilitySchema,
} from '../schemas';
import { defineTool } from './helpers';

const guestPermissionsSchema = z.enum(['modify', 'inviteOthers', 'seeOtherInvites']);

function permissionPatch(permissions: string[]): calendar_v3.Schema$Event {
  return {
    guestsCanModify: permissions.includes('modify'),
    guestsCanInviteOthers: permissions.includes('inviteOthers'),
    guestsCanSeeOtherGuests: permissions.includes('seeOtherInvites'),
  };
}

function asMillis(value: calendar_v3.Schema$EventDateTime | null | undefined): number | undefined {
  const raw = value?.dateTime ?? (value?.date ? `${value.date}T00:00:00Z` : undefined);
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const updateEventTool = defineTool(
  'update_event',
  {
    title: 'Update event',
    description:
      'Updates an event. Applies added*/removed* attendee and attachment deltas itself and preserves duration when only startTime is given. notificationLevel defaults to ALL.',
    inputSchema: z.object({
      account: accountSchema,
      eventId: z.string(),
      calendarId: z.string().optional(),
      summary: z.string().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      startTime: dateTimeSchema.optional(),
      endTime: dateTimeSchema.optional(),
      allDay: z.boolean().optional(),
      timeZone: z.string().optional(),
      addedAttendees: z.array(attendeeSchema).optional(),
      addedAttendeeEmails: z
        .array(z.string())
        .optional()
        .describe('Deprecated. Use addedAttendees.'),
      removedAttendeeEmails: z.array(z.string()).optional(),
      addedAttachments: z.array(attachmentSchema).optional(),
      removedAttachmentFileUrls: z.array(z.string()).optional(),
      availability: availabilitySchema.optional(),
      colorId: z.string().optional(),
      guestPermissions: z.array(guestPermissionsSchema).optional(),
      notificationLevel: notificationLevelSchema.optional(),
      overrideReminders: z.array(reminderSchema).optional(),
      visibility: visibilitySchema.optional(),
      addGoogleMeetUrl: z.boolean().optional(),
      googleMeetUrl: z.string().optional(),
    }),
    annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: true },
  },
  async (args, ctx) => {
    const slug = await accountSlug(ctx, args.account);
    const client = googleCalendar(ctx, slug);
    const calendarId = args.calendarId ?? 'primary';

    const current = (
      await client.events.get({ calendarId, eventId: args.eventId })
    ).data;

    const patch: calendar_v3.Schema$Event = {};
    if (args.summary !== undefined) patch.summary = args.summary;
    if (args.description !== undefined) patch.description = args.description;
    if (args.location !== undefined) patch.location = args.location;
    if (args.colorId !== undefined) patch.colorId = args.colorId;
    if (args.visibility !== undefined) patch.visibility = args.visibility;
    if (args.guestPermissions !== undefined) {
      Object.assign(patch, permissionPatch(args.guestPermissions));
    }
    if (args.overrideReminders !== undefined) {
      patch.reminders = { useDefault: false, overrides: args.overrideReminders };
    }
    if (args.availability === 'AVAILABILITY_FREE') patch.transparency = 'transparent';
    if (args.availability === 'AVAILABILITY_BUSY') patch.transparency = 'opaque';

    const zone = args.timeZone ? { timeZone: args.timeZone } : {};
    if (args.startTime) {
      patch.start = args.allDay
        ? { date: args.startTime.slice(0, 10) }
        : { dateTime: args.startTime, ...zone };
    }
    if (args.endTime) {
      patch.end = args.allDay
        ? { date: args.endTime.slice(0, 10) }
        : { dateTime: args.endTime, ...zone };
    } else if (args.startTime) {
      // Preserve the existing duration when only the start moved.
      const oldStart = asMillis(current.start);
      const oldEnd = asMillis(current.end);
      const newStart = asMillis(patch.start);
      if (oldStart !== undefined && oldEnd !== undefined && newStart !== undefined) {
        const newEnd = new Date(newStart + (oldEnd - oldStart)).toISOString();
        patch.end = args.allDay
          ? { date: newEnd.slice(0, 10) }
          : { dateTime: newEnd, ...zone };
      }
    }

    const hasAttendeeDelta =
      args.addedAttendees !== undefined ||
      args.addedAttendeeEmails !== undefined ||
      args.removedAttendeeEmails !== undefined;
    if (hasAttendeeDelta) {
      const removed = new Set((args.removedAttendeeEmails ?? []).map((email) => email.toLowerCase()));
      const merged = (current.attendees ?? []).filter(
        (attendee) => !attendee.email || !removed.has(attendee.email.toLowerCase()),
      );
      const added: { email?: string; optional?: boolean; displayName?: string }[] = [
        ...(args.addedAttendees ?? []),
        ...(args.addedAttendeeEmails ?? []).map((email) => ({ email })),
      ];
      for (const attendee of added) {
        if (!attendee.email) continue;
        if (merged.some((existing) => existing.email?.toLowerCase() === attendee.email?.toLowerCase())) {
          continue;
        }
        merged.push({
          email: attendee.email,
          ...(attendee.optional !== undefined ? { optional: attendee.optional } : {}),
          ...(attendee.displayName ? { displayName: attendee.displayName } : {}),
        });
      }
      patch.attendees = merged;
    }

    const hasAttachmentDelta =
      args.addedAttachments !== undefined || args.removedAttachmentFileUrls !== undefined;
    if (hasAttachmentDelta) {
      const removed = new Set(args.removedAttachmentFileUrls ?? []);
      const merged = (current.attachments ?? []).filter(
        (attachment) => !attachment.fileUrl || !removed.has(attachment.fileUrl),
      );
      for (const attachment of args.addedAttachments ?? []) {
        if (!merged.some((existing) => existing.fileUrl === attachment.fileUrl)) {
          merged.push(attachment);
        }
      }
      patch.attachments = merged;
    }

    if (args.addGoogleMeetUrl || args.googleMeetUrl) {
      patch.conferenceData = {
        ...(args.addGoogleMeetUrl
          ? {
              createRequest: {
                requestId: crypto.randomUUID(),
                conferenceSolutionKey: { type: 'hangoutsMeet' },
              },
            }
          : {}),
        ...(args.googleMeetUrl
          ? { entryPoints: [{ entryPointType: 'video', uri: args.googleMeetUrl }] }
          : {}),
      };
    }

    const response = await client.events.patch({
      calendarId,
      eventId: args.eventId,
      sendUpdates: sendUpdatesFor(args.notificationLevel),
      ...(patch.conferenceData ? { conferenceDataVersion: 1 } : {}),
      requestBody: patch,
    });

    return toEvent(response.data);
  },
);
