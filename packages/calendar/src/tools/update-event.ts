import type { calendar_v3 } from "@googleapis/calendar"
import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { toAttendeeEntry, toEvent, toGuestPermissionsInput } from "../map"
import {
  accountSchema,
  attachmentSchema,
  attendeeSchema,
  availabilitySchema,
  dateTimeSchema,
  guestPermissionsSchema,
  notificationLevelSchema,
  reminderSchema,
  sendUpdatesFor,
  visibilitySchema
} from "../schemas"
import { meetConferenceData } from "./meet"
import type { ToolContext } from "./tool-context"

function asMillis(value: calendar_v3.Schema$EventDateTime | null | undefined): number | undefined {
  const raw = value?.dateTime ?? (value?.date ? value.date + "T00:00:00Z" : undefined)
  if (!raw) return undefined
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

const inputSchema = z.object({
  account: accountSchema,
  eventId: z.string().describe("Required. Event ID."),
  calendarId: z
    .string()
    .optional()
    .describe(
      "Optional. ID of the calendar containing the event. Email address - can be resolved using list_calendars. Default: primary calendar."
    ),
  summary: z.string().optional().describe("Optional. New title."),
  description: z.string().optional().describe("Optional. New description. Can contain HTML."),
  location: z.string().optional().describe("Optional. New location."),
  startTime: dateTimeSchema
    .optional()
    .describe("Optional. New start time (ISO 8601). Preserves duration if updating only start."),
  endTime: dateTimeSchema.optional().describe("Optional. New end time (ISO 8601)."),
  allDay: z
    .boolean()
    .optional()
    .describe("Optional. Changes the event to all-day. If set, startTime and endTime must also be provided."),
  timeZone: z
    .string()
    .optional()
    .describe(
      "Optional. IANA Time Zone Database name (for example, America/Los_Angeles). Default: the user's primary time zone. Overrides offsets in startTime and endTime."
    ),
  addedAttendees: z.array(attendeeSchema).optional().describe("Optional. Attendees to add to the event."),
  addedAttendeeEmails: z.array(z.email()).optional().describe("Deprecated. Use addedAttendees."),
  removedAttendeeEmails: z
    .array(z.email())
    .optional()
    .describe("Optional. The attendees of the event to remove, as email addresses."),
  addedAttachments: z.array(attachmentSchema).optional().describe("Optional. File attachments to add to the event."),
  removedAttachmentFileUrls: z
    .array(z.url())
    .optional()
    .describe("Optional. File attachments to remove from the event."),
  availability: availabilitySchema.optional().describe("Optional. Whether the event blocks time on the calendar."),
  colorId: z.string().optional().describe("Optional. New color of the event. An ID from the calendar color palette."),
  guestPermissions: guestPermissionsSchema.optional().describe("Optional. Guest permission settings for this event."),
  notificationLevel: notificationLevelSchema
    .optional()
    .describe("Optional. Email notification to send for this event update. Default: ALL."),
  overrideReminders: z
    .array(reminderSchema)
    .optional()
    .describe("Optional. If set, replaces all existing reminders for the event."),
  visibility: visibilitySchema.optional().describe("Optional. New visibility of the event."),
  addGoogleMeetUrl: z
    .boolean()
    .optional()
    .describe("Optional. If true, creates or updates a Google Meet URL for the event. Ignored if Meet is disabled."),
  googleMeetUrl: z
    .string()
    .optional()
    .describe("Optional. Attach an existing Google Meet URL or meeting ID to the event. Overrides addGoogleMeetUrl.")
})

type UpdateInput = z.infer<typeof inputSchema>

function simpleFieldPatch(args: UpdateInput): calendar_v3.Schema$Event {
  const patch: calendar_v3.Schema$Event = {}
  if (args.summary !== undefined) patch.summary = args.summary
  if (args.description !== undefined) patch.description = args.description
  if (args.location !== undefined) patch.location = args.location
  if (args.colorId !== undefined) patch.colorId = args.colorId
  if (args.visibility !== undefined) patch.visibility = args.visibility
  if (args.availability === "AVAILABILITY_FREE") patch.transparency = "transparent"
  if (args.availability === "AVAILABILITY_BUSY") patch.transparency = "opaque"
  return patch
}

function timePatch(args: UpdateInput, current: calendar_v3.Schema$Event): calendar_v3.Schema$Event {
  const patch: calendar_v3.Schema$Event = {}
  const zone = args.timeZone ? { timeZone: args.timeZone } : {}
  if (args.startTime) {
    patch.start = args.allDay ? { date: args.startTime.slice(0, 10) } : { dateTime: args.startTime, ...zone }
  }
  if (args.endTime) {
    patch.end = args.allDay ? { date: args.endTime.slice(0, 10) } : { dateTime: args.endTime, ...zone }
    return patch
  }
  if (!args.startTime) return patch
  // Preserve the existing duration when only the start moved.
  const oldStart = asMillis(current.start)
  const oldEnd = asMillis(current.end)
  const newStart = asMillis(patch.start)
  if (oldStart !== undefined && oldEnd !== undefined && newStart !== undefined) {
    const newEnd = new Date(newStart + (oldEnd - oldStart)).toISOString()
    patch.end = args.allDay ? { date: newEnd.slice(0, 10) } : { dateTime: newEnd, ...zone }
  }
  return patch
}

function mergeAttendees(current: calendar_v3.Schema$Event, args: UpdateInput): calendar_v3.Schema$EventAttendee[] {
  const removed = new Set((args.removedAttendeeEmails ?? []).map(email => email.toLowerCase()))
  const merged = (current.attendees ?? []).filter(
    attendee => !attendee.email || !removed.has(attendee.email.toLowerCase())
  )
  const added = [...(args.addedAttendees ?? []), ...(args.addedAttendeeEmails ?? []).map(email => ({ email }))]
  for (const attendee of added) {
    if (!attendee.email) continue
    if (merged.some(existing => existing.email?.toLowerCase() === attendee.email.toLowerCase())) continue
    merged.push(toAttendeeEntry({ ...attendee, email: attendee.email }))
  }
  return merged
}

function mergeAttachments(current: calendar_v3.Schema$Event, args: UpdateInput): calendar_v3.Schema$EventAttachment[] {
  const removed = new Set(args.removedAttachmentFileUrls ?? [])
  const merged = (current.attachments ?? []).filter(
    attachment => !attachment.fileUrl || !removed.has(attachment.fileUrl)
  )
  for (const attachment of args.addedAttachments ?? []) {
    if (!merged.some(existing => existing.fileUrl === attachment.fileUrl)) merged.push(attachment)
  }
  return merged
}

export const updateEventTool = defineTool(
  "update_event",
  {
    title: "Update event",
    description:
      "Updates an event on the given calendar. Fields that are not set will not be updated. Applies added*/removed* attendee and attachment deltas itself and preserves duration when only startTime is given. notificationLevel defaults to ALL.",
    inputSchema,
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const client = context.calendar(slug)
    const calendarId = args.calendarId ?? "primary"

    const current = (await client.getEvent({ calendarId, eventId: args.eventId })).data

    const patch: calendar_v3.Schema$Event = { ...simpleFieldPatch(args), ...timePatch(args, current) }
    if (args.guestPermissions !== undefined) {
      Object.assign(patch, toGuestPermissionsInput(args.guestPermissions))
    }
    if (args.overrideReminders !== undefined) {
      patch.reminders = { useDefault: false, overrides: args.overrideReminders }
    }
    if (
      args.addedAttendees !== undefined ||
      args.addedAttendeeEmails !== undefined ||
      args.removedAttendeeEmails !== undefined
    ) {
      patch.attendees = mergeAttendees(current, args)
    }
    if (args.addedAttachments !== undefined || args.removedAttachmentFileUrls !== undefined) {
      patch.attachments = mergeAttachments(current, args)
    }
    const conferenceData = meetConferenceData(args)
    if (conferenceData) patch.conferenceData = conferenceData

    const params: calendar_v3.Params$Resource$Events$Patch = {
      calendarId,
      eventId: args.eventId,
      sendUpdates: sendUpdatesFor(args.notificationLevel),
      requestBody: patch
    }
    if (patch.conferenceData) params.conferenceDataVersion = 1
    const response = await client.patchEvent(params)

    return toEvent(response.data)
  }
)
