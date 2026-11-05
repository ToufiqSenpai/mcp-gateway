import type { calendar_v3 } from "@googleapis/calendar"
import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { toAttendeeList, toEvent, toGuestPermissionsInput, toWorkingLocationPropertiesInput } from "../map"
import {
  accountSchema,
  attachmentSchema,
  attendeeSchema,
  availabilitySchema,
  dateTimeSchema,
  eventTypeSchema,
  googleEventType,
  guestPermissionsSchema,
  notificationLevelSchema,
  reminderSchema,
  sendUpdatesFor,
  visibilitySchema,
  workingLocationPropertiesSchema
} from "../schemas"
import { meetConferenceData } from "./meet"
import type { ToolContext } from "./tool-context"

const inputSchema = z.object({
  account: accountSchema,
  summary: z.string().describe("Required. Title."),
  startTime: dateTimeSchema.describe("Required. Start time (ISO 8601, for example '2026-04-30T10:00:00Z')."),
  endTime: dateTimeSchema.describe("Required. End time (ISO 8601, for example '2026-04-30T11:00:00Z')."),
  calendarId: z
    .string()
    .optional()
    .describe(
      "Optional. ID of the calendar to create the event on. Email address - can be resolved using list_calendars. Default: primary calendar."
    ),
  allDay: z
    .boolean()
    .optional()
    .describe("Optional. Whether the event spans the entire day. If true, start/end times are treated as midnight."),
  addGoogleMeetUrl: z.boolean().optional().describe("Optional. Create and add a Google Meet URL. Default: false."),
  googleMeetUrl: z
    .string()
    .optional()
    .describe("Optional. Specific Google Meet URL or meeting ID. Overrides addGoogleMeetUrl."),
  attendees: z
    .array(attendeeSchema)
    .optional()
    .describe(
      "Optional. Attendees of the event. For events created on the primary calendar with at least one other attendee, the current user is added automatically if not already included."
    ),
  attendeeEmails: z.array(z.email()).optional().describe("Deprecated. Use attendees."),
  attachments: z.array(attachmentSchema).optional().describe("Optional. File attachments."),
  availability: availabilitySchema.optional().describe("Optional. Availability setting."),
  colorId: z
    .string()
    .optional()
    .describe("Optional. The color of the event. It is an ID from the calendar color palette ('1'-'11')."),
  description: z.string().optional().describe("Optional. Description. Can contain HTML."),
  eventType: eventTypeSchema.optional().describe("Optional. Type of the event."),
  guestPermissions: guestPermissionsSchema.optional().describe("Optional. Guest permissions."),
  location: z.string().optional().describe("Optional. Location."),
  notificationLevel: notificationLevelSchema
    .optional()
    .describe("Optional. Which email notification should be sent for this event update. Default: ALL."),
  overrideReminders: z.array(reminderSchema).optional().describe("Optional. Reminders override calendar defaults."),
  recurrenceData: z
    .array(z.string())
    .optional()
    .describe("Optional. Recurrence rules as RRULE, RDATE, or EXDATE strings (per RFC 5545)."),
  timeZone: z
    .string()
    .optional()
    .describe(
      "Optional. IANA Time Zone Database name (for example, America/Los_Angeles). Default: the user's primary time zone. Overrides offsets in startTime and endTime."
    ),
  visibility: visibilitySchema.optional().describe("Optional. Visibility of the event."),
  workingLocationProperties: workingLocationPropertiesSchema
    .optional()
    .describe("Optional. Working location properties (if eventType is WORKING_LOCATION).")
})

type CreateInput = z.infer<typeof inputSchema>

function eventTimes(args: CreateInput) {
  const start: calendar_v3.Schema$EventDateTime = args.allDay
    ? { date: args.startTime.slice(0, 10) }
    : { dateTime: args.startTime }
  const end: calendar_v3.Schema$EventDateTime = args.allDay
    ? { date: args.endTime.slice(0, 10) }
    : { dateTime: args.endTime }
  if (!args.allDay && args.timeZone) {
    start.timeZone = args.timeZone
    end.timeZone = args.timeZone
  }
  return { start, end }
}

function eventBody(
  args: CreateInput,
  times: { start: calendar_v3.Schema$EventDateTime; end: calendar_v3.Schema$EventDateTime },
  attendees: calendar_v3.Schema$EventAttendee[] | undefined,
  conferenceData: calendar_v3.Schema$ConferenceData | undefined
): calendar_v3.Schema$Event {
  const body: calendar_v3.Schema$Event = { summary: args.summary, ...times }
  if (args.location) body.location = args.location
  if (args.description) body.description = args.description
  if (args.colorId) body.colorId = args.colorId
  if (args.visibility) body.visibility = args.visibility
  if (args.eventType) body.eventType = googleEventType(args.eventType)
  if (attendees) body.attendees = attendees
  if (args.attachments) body.attachments = args.attachments
  if (args.recurrenceData) body.recurrence = args.recurrenceData
  if (args.overrideReminders) body.reminders = { useDefault: false, overrides: args.overrideReminders }
  if (args.workingLocationProperties) {
    body.workingLocationProperties = toWorkingLocationPropertiesInput(args.workingLocationProperties)
  }
  if (args.availability === "AVAILABILITY_FREE") body.transparency = "transparent"
  if (args.availability === "AVAILABILITY_BUSY") body.transparency = "opaque"
  Object.assign(body, toGuestPermissionsInput(args.guestPermissions))
  if (conferenceData) body.conferenceData = conferenceData
  return body
}

export const createEventTool = defineTool(
  "create_event",
  {
    title: "Create event",
    description:
      "Creates an event on the given calendar. notificationLevel defaults to ALL, which emails guests; REST defaults to sending nothing.",
    inputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const client = context.calendar(slug)

    const attendees = toAttendeeList(args.attendees) ?? args.attendeeEmails?.map(email => ({ email })) ?? undefined
    const conferenceData = meetConferenceData(args)
    const requestBody = eventBody(args, eventTimes(args), attendees, conferenceData)

    const params: calendar_v3.Params$Resource$Events$Insert = {
      calendarId: args.calendarId ?? "primary",
      sendUpdates: sendUpdatesFor(args.notificationLevel),
      requestBody
    }
    if (conferenceData) params.conferenceDataVersion = 1
    const response = await client.insertEvent(params)

    return toEvent(response.data)
  }
)
