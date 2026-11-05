import type { calendar_v3 } from "@googleapis/calendar"

import type { AttendeeInput, GuestPermissions, WorkingLocationProperties } from "./schemas"

/** A tool-surface attendee; REST-only members never leave this package. */
export interface CalendarAttendee {
  id?: string
  email?: string
  displayName?: string
  optionalAttendee?: boolean
  resource?: boolean
  responseStatus?: string
  comment?: string
  additionalGuests?: number
  self?: boolean
  organizer?: boolean
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
  workingLocationProperties?: WorkingLocationProperties
  guestPermissions?: GuestPermissions
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
  if (raw.id) attendee.id = raw.id
  if (raw.email) attendee.email = raw.email
  if (raw.displayName) attendee.displayName = raw.displayName
  if (raw.optional !== undefined && raw.optional !== null) attendee.optionalAttendee = raw.optional
  if (raw.resource !== undefined && raw.resource !== null) attendee.resource = raw.resource
  if (raw.responseStatus) attendee.responseStatus = raw.responseStatus
  if (raw.comment) attendee.comment = raw.comment
  if (raw.additionalGuests !== undefined && raw.additionalGuests !== null) {
    attendee.additionalGuests = raw.additionalGuests
  }
  if (raw.self !== undefined && raw.self !== null) attendee.self = raw.self
  if (raw.organizer !== undefined && raw.organizer !== null) attendee.organizer = raw.organizer
  return attendee
}

function toWorkingLocationProperties(
  raw: calendar_v3.Schema$EventWorkingLocationProperties
): WorkingLocationProperties {
  const properties: WorkingLocationProperties = {}
  let type: WorkingLocationProperties["type"]
  if (raw.type === "homeOffice") type = "HOME_OFFICE"
  else if (raw.type === "customLocation") type = "CUSTOM_LOCATION"
  if (type) properties.type = type
  if (raw.customLocation?.label) properties.customLocationLabel = raw.customLocation.label
  return properties
}

/** The tool surface keeps protobuf-style names; REST spells the same values in camelCase. */
export function toWorkingLocationPropertiesInput(
  properties: WorkingLocationProperties
): calendar_v3.Schema$EventWorkingLocationProperties {
  if (properties.type === "CUSTOM_LOCATION") {
    return { type: "customLocation", customLocation: { label: properties.customLocationLabel } }
  }
  return { type: "homeOffice" }
}

/** The three guest fields shared by create and update, including the REST rename. */
export function toGuestPermissionsInput(permissions: GuestPermissions | undefined): calendar_v3.Schema$Event {
  const body: calendar_v3.Schema$Event = {}
  if (!permissions) return body
  if (permissions.guestsCanModify !== undefined) body.guestsCanModify = permissions.guestsCanModify
  if (permissions.guestsCanInviteOthers !== undefined) body.guestsCanInviteOthers = permissions.guestsCanInviteOthers
  if (permissions.guestsCanSeeGuests !== undefined) body.guestsCanSeeOtherGuests = permissions.guestsCanSeeGuests
  return body
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

function applyEventBasics(event: CalendarEvent, raw: calendar_v3.Schema$Event): void {
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
}

function applyEventPeople(event: CalendarEvent, raw: calendar_v3.Schema$Event): void {
  if (raw.attendees) event.attendees = raw.attendees.map(toAttendee)
  if (raw.organizer) event.organizer = raw.organizer
  if (raw.creator) event.creator = raw.creator
}

function toGuestPermissions(raw: calendar_v3.Schema$Event): GuestPermissions | undefined {
  if (
    raw.guestsCanInviteOthers === undefined &&
    raw.guestsCanModify === undefined &&
    raw.guestsCanSeeOtherGuests === undefined
  ) {
    return undefined
  }
  const permissions: GuestPermissions = {}
  if (raw.guestsCanInviteOthers !== undefined && raw.guestsCanInviteOthers !== null) {
    permissions.guestsCanInviteOthers = raw.guestsCanInviteOthers
  }
  if (raw.guestsCanModify !== undefined && raw.guestsCanModify !== null) {
    permissions.guestsCanModify = raw.guestsCanModify
  }
  if (raw.guestsCanSeeOtherGuests !== undefined && raw.guestsCanSeeOtherGuests !== null) {
    permissions.guestsCanSeeGuests = raw.guestsCanSeeOtherGuests
  }
  return permissions
}

function applyEventExtras(event: CalendarEvent, raw: calendar_v3.Schema$Event): void {
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
  if (raw.workingLocationProperties) {
    event.workingLocationProperties = toWorkingLocationProperties(raw.workingLocationProperties)
  }
  const guestPermissions = toGuestPermissions(raw)
  if (guestPermissions) event.guestPermissions = guestPermissions
  if (raw.htmlLink) event.htmlLink = raw.htmlLink
  if (raw.created) event.created = raw.created
  if (raw.updated) event.updated = raw.updated
}

export function toEvent(raw: calendar_v3.Schema$Event): CalendarEvent {
  const event: CalendarEvent = {}
  applyEventBasics(event, raw)
  applyEventPeople(event, raw)
  applyEventExtras(event, raw)
  return event
}

function videoEntryPoint(raw: calendar_v3.Schema$Event): string | undefined {
  return (
    raw.conferenceData?.entryPoints?.find(entryPoint => entryPoint.entryPointType === "video" && entryPoint.uri)?.uri ??
    undefined
  )
}

export function toAttendeeEntry(attendee: AttendeeInput): calendar_v3.Schema$EventAttendee {
  const entry: calendar_v3.Schema$EventAttendee = { email: attendee.email }
  if (attendee.optionalAttendee !== undefined) entry.optional = attendee.optionalAttendee
  if (attendee.resource !== undefined) entry.resource = attendee.resource
  if (attendee.displayName) entry.displayName = attendee.displayName
  if (attendee.responseStatus) entry.responseStatus = attendee.responseStatus
  if (attendee.additionalGuests !== undefined) entry.additionalGuests = attendee.additionalGuests
  return entry
}

export function toAttendeeList(attendees: AttendeeInput[] | undefined): calendar_v3.Schema$EventAttendee[] | undefined {
  if (!attendees?.length) return undefined
  return attendees.map(toAttendeeEntry)
}
