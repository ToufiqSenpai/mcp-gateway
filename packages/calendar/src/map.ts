import type { calendar_v3 } from "@googleapis/calendar"

/** A tool-surface attendee; REST-only members never leave this package. */
export interface CalendarAttendee {
  email?: string
  displayName?: string
  optional?: boolean
  responseStatus?: string
  comment?: string
  self?: boolean
  organizer?: boolean
  resource?: boolean
}

export interface CalendarAttachment {
  fileUrl?: string
  title?: string
  mimeType?: string
}

export interface CalendarPerson {
  email?: string
  displayName?: string
  self?: boolean
}

export interface CalendarReminder {
  method?: string
  minutes?: number
}

/**
 * The tool surface's `Event`, not the REST resource: REST-only fields (`kind`, `etag`,
 * `iCalUID`, `sequence`, `hangoutLink`, `extendedProperties`) are deliberately absent, and
 * `conferenceUrl` replaces `conferenceData`.
 */
export interface CalendarEvent {
  id?: string
  summary?: string
  description?: string
  location?: string
  start?: DateOrDateTime
  end?: DateOrDateTime
  originalStartTime?: DateOrDateTime
  status?: string
  eventType?: string
  recurrence?: string[]
  recurringEventId?: string
  attendees?: CalendarAttendee[]
  organizer?: CalendarPerson
  creator?: CalendarPerson
  attachments?: CalendarAttachment[]
  conferenceUrl?: string
  overrideReminders?: CalendarReminder[]
  visibility?: string
  transparency?: string
  colorId?: string
  workingLocationProperties?: calendar_v3.Schema$EventWorkingLocationProperties
  htmlLink?: string
  created?: string
  updated?: string
}

export interface DateOrDateTime {
  date?: string
  dateTime?: string
  timeZone?: string
}

function toDateOrDateTime(value: calendar_v3.Schema$EventDateTime | null | undefined): DateOrDateTime | undefined {
  if (!value) return undefined
  const result: DateOrDateTime = {}
  if (value.date) result.date = value.date
  if (value.dateTime) result.dateTime = value.dateTime
  if (value.timeZone) result.timeZone = value.timeZone
  return result
}

export function toDateOrDateTimeInput(
  value: { date?: string; dateTime?: string; timeZone?: string } | undefined
): calendar_v3.Schema$EventDateTime | undefined {
  if (!value) return undefined
  const result: calendar_v3.Schema$EventDateTime = {}
  if (value.date) result.date = value.date.slice(0, 10)
  if (value.dateTime) result.dateTime = value.dateTime
  if (value.timeZone) result.timeZone = value.timeZone
  return result
}

function toAttendee(raw: calendar_v3.Schema$EventAttendee): CalendarAttendee {
  const attendee: CalendarAttendee = {}
  if (raw.email) attendee.email = raw.email
  if (raw.displayName) attendee.displayName = raw.displayName
  if (raw.optional !== undefined && raw.optional !== null) attendee.optional = raw.optional
  if (raw.responseStatus) attendee.responseStatus = raw.responseStatus
  if (raw.comment) attendee.comment = raw.comment
  if (raw.self !== undefined && raw.self !== null) attendee.self = raw.self
  if (raw.organizer !== undefined && raw.organizer !== null) attendee.organizer = raw.organizer
  if (raw.resource !== undefined && raw.resource !== null) attendee.resource = raw.resource
  return attendee
}

function toAttachment(raw: calendar_v3.Schema$EventAttachment): CalendarAttachment {
  const attachment: CalendarAttachment = {}
  if (raw.fileUrl) attachment.fileUrl = raw.fileUrl
  if (raw.title) attachment.title = raw.title
  if (raw.mimeType) attachment.mimeType = raw.mimeType
  return attachment
}

function toReminder(raw: calendar_v3.Schema$EventReminder): CalendarReminder {
  const reminder: CalendarReminder = {}
  if (raw.method) reminder.method = raw.method
  if (raw.minutes !== undefined && raw.minutes !== null) reminder.minutes = raw.minutes
  return reminder
}

export function toEvent(raw: calendar_v3.Schema$Event): CalendarEvent {
  const event: CalendarEvent = {}
  if (raw.id) event.id = raw.id
  if (raw.summary) event.summary = raw.summary
  if (raw.description) event.description = raw.description
  if (raw.location) event.location = raw.location
  if (raw.start) event.start = toDateOrDateTime(raw.start)
  if (raw.end) event.end = toDateOrDateTime(raw.end)
  if (raw.originalStartTime) event.originalStartTime = toDateOrDateTime(raw.originalStartTime)
  if (raw.status) event.status = raw.status
  if (raw.eventType) event.eventType = raw.eventType
  if (raw.recurrence) event.recurrence = raw.recurrence
  if (raw.recurringEventId) event.recurringEventId = raw.recurringEventId
  if (raw.attendees) event.attendees = raw.attendees.map(toAttendee)
  if (raw.organizer) event.organizer = raw.organizer
  if (raw.creator) event.creator = raw.creator
  if (raw.attachments) event.attachments = raw.attachments.map(toAttachment)
  const conferenceUrl = videoEntryPoint(raw)
  if (conferenceUrl !== undefined) event.conferenceUrl = conferenceUrl
  if (raw.reminders?.overrides) {
    event.overrideReminders = raw.reminders.overrides.flatMap(reminder =>
      reminder.method ? [toReminder(reminder)] : []
    )
  }
  if (raw.visibility) event.visibility = raw.visibility
  if (raw.transparency) event.transparency = raw.transparency
  if (raw.colorId) event.colorId = raw.colorId
  if (raw.workingLocationProperties) event.workingLocationProperties = raw.workingLocationProperties
  if (raw.htmlLink) event.htmlLink = raw.htmlLink
  if (raw.created) event.created = raw.created
  if (raw.updated) event.updated = raw.updated
  return event
}

function videoEntryPoint(raw: calendar_v3.Schema$Event): string | undefined {
  return (
    raw.conferenceData?.entryPoints?.find(entryPoint => entryPoint.entryPointType === "video" && entryPoint.uri)?.uri ??
    undefined
  )
}

export function toAttendeeList(
  attendees: { email?: string; optional?: boolean; displayName?: string }[] | undefined
): calendar_v3.Schema$EventAttendee[] | undefined {
  if (!attendees?.length) return undefined
  const result: calendar_v3.Schema$EventAttendee[] = []
  for (const attendee of attendees) {
    if (!attendee.email) continue
    const entry: calendar_v3.Schema$EventAttendee = { email: attendee.email }
    if (attendee.optional !== undefined) entry.optional = attendee.optional
    if (attendee.displayName) entry.displayName = attendee.displayName
    result.push(entry)
  }
  return result
}
