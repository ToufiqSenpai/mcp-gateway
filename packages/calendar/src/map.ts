import type { calendar_v3 } from '@googleapis/calendar';

/**
 * The tool surface's `Event`, not the REST resource: REST-only fields (`kind`, `etag`,
 * `iCalUID`, `sequence`, `hangoutLink`, `extendedProperties`) are deliberately absent, and
 * `conferenceUrl` replaces `conferenceData`.
 */
export interface CalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: DateOrDateTime;
  end?: DateOrDateTime;
  originalStartTime?: DateOrDateTime;
  status?: string;
  eventType?: string;
  recurrence?: string[];
  recurringEventId?: string;
  attendees?: {
    email?: string;
    displayName?: string;
    optional?: boolean;
    responseStatus?: string;
    comment?: string;
    self?: boolean;
    organizer?: boolean;
    resource?: boolean;
  }[];
  organizer?: { email?: string; displayName?: string; self?: boolean };
  creator?: { email?: string; displayName?: string; self?: boolean };
  attachments?: { fileUrl?: string; title?: string; mimeType?: string }[];
  conferenceUrl?: string;
  overrideReminders?: { method?: string; minutes?: number }[];
  visibility?: string;
  transparency?: string;
  colorId?: string;
  workingLocationProperties?: calendar_v3.Schema$EventWorkingLocationProperties;
  htmlLink?: string;
  created?: string;
  updated?: string;
}

export interface DateOrDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

function toDateOrDateTime(
  value: calendar_v3.Schema$EventDateTime | null | undefined,
): DateOrDateTime | undefined {
  if (!value) return undefined;
  return {
    ...(value.date ? { date: value.date } : {}),
    ...(value.dateTime ? { dateTime: value.dateTime } : {}),
    ...(value.timeZone ? { timeZone: value.timeZone } : {}),
  };
}

export function toDateOrDateTimeInput(
  value: { date?: string; dateTime?: string; timeZone?: string } | undefined,
): calendar_v3.Schema$EventDateTime | undefined {
  if (!value) return undefined;
  return {
    ...(value.date ? { date: value.date.slice(0, 10) } : {}),
    ...(value.dateTime ? { dateTime: value.dateTime } : {}),
    ...(value.timeZone ? { timeZone: value.timeZone } : {}),
  };
}

export function toEvent(raw: calendar_v3.Schema$Event): CalendarEvent {
  return {
    ...(raw.id ? { id: raw.id } : {}),
    ...(raw.summary ? { summary: raw.summary } : {}),
    ...(raw.description ? { description: raw.description } : {}),
    ...(raw.location ? { location: raw.location } : {}),
    ...(raw.start ? { start: toDateOrDateTime(raw.start) } : {}),
    ...(raw.end ? { end: toDateOrDateTime(raw.end) } : {}),
    ...(raw.originalStartTime
      ? { originalStartTime: toDateOrDateTime(raw.originalStartTime) }
      : {}),
    ...(raw.status ? { status: raw.status } : {}),
    ...(raw.eventType ? { eventType: raw.eventType } : {}),
    ...(raw.recurrence ? { recurrence: raw.recurrence } : {}),
    ...(raw.recurringEventId ? { recurringEventId: raw.recurringEventId } : {}),
    ...(raw.attendees
      ? {
          attendees: raw.attendees.map((attendee) => ({
            ...(attendee.email ? { email: attendee.email } : {}),
            ...(attendee.displayName ? { displayName: attendee.displayName } : {}),
            ...(attendee.optional !== undefined && attendee.optional !== null
              ? { optional: attendee.optional }
              : {}),
            ...(attendee.responseStatus ? { responseStatus: attendee.responseStatus } : {}),
            ...(attendee.comment ? { comment: attendee.comment } : {}),
            ...(attendee.self !== undefined && attendee.self !== null
              ? { self: attendee.self }
              : {}),
            ...(attendee.organizer !== undefined && attendee.organizer !== null
              ? { organizer: attendee.organizer }
              : {}),
            ...(attendee.resource !== undefined && attendee.resource !== null
              ? { resource: attendee.resource }
              : {}),
          })),
        }
      : {}),
    ...(raw.organizer ? { organizer: raw.organizer } : {}),
    ...(raw.creator ? { creator: raw.creator } : {}),
    ...(raw.attachments
      ? {
          attachments: raw.attachments.map((attachment) => ({
            ...(attachment.fileUrl ? { fileUrl: attachment.fileUrl } : {}),
            ...(attachment.title ? { title: attachment.title } : {}),
            ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
          })),
        }
      : {}),
    ...(videoEntryPoint(raw)
      ? { conferenceUrl: videoEntryPoint(raw) as string }
      : {}),
    ...(raw.reminders?.overrides
      ? {
          overrideReminders: raw.reminders.overrides.flatMap((reminder) =>
            reminder.method ? [{ method: reminder.method, ...(reminder.minutes !== undefined && reminder.minutes !== null ? { minutes: reminder.minutes } : {}) }] : [],
          ),
        }
      : {}),
    ...(raw.visibility ? { visibility: raw.visibility } : {}),
    ...(raw.transparency ? { transparency: raw.transparency } : {}),
    ...(raw.colorId ? { colorId: raw.colorId } : {}),
    ...(raw.workingLocationProperties
      ? { workingLocationProperties: raw.workingLocationProperties }
      : {}),
    ...(raw.htmlLink ? { htmlLink: raw.htmlLink } : {}),
    ...(raw.created ? { created: raw.created } : {}),
    ...(raw.updated ? { updated: raw.updated } : {}),
  };
}

function videoEntryPoint(raw: calendar_v3.Schema$Event): string | undefined {
  return raw.conferenceData?.entryPoints?.find(
    (entryPoint) => entryPoint.entryPointType === 'video' && entryPoint.uri,
  )?.uri ?? undefined;
}

export function toAttendeeList(
  attendees: { email?: string; optional?: boolean; displayName?: string }[] | undefined,
): calendar_v3.Schema$EventAttendee[] | undefined {
  if (!attendees?.length) return undefined;
  return attendees.flatMap((attendee) =>
    attendee.email
      ? [
          {
            email: attendee.email,
            ...(attendee.optional !== undefined ? { optional: attendee.optional } : {}),
            ...(attendee.displayName ? { displayName: attendee.displayName } : {}),
          },
        ]
      : [],
  );
}
