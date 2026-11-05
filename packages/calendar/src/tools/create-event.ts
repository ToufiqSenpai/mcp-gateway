import type { calendar_v3 } from "@googleapis/calendar"
import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { toAttendeeList, toEvent } from "../map"
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
  visibilitySchema
} from "../schemas"
import type { ToolContext } from "./tool-context"

const guestPermissionsSchema = z.enum(["modify", "inviteOthers", "seeOtherInvites"])

function permissionsToBody(permissions: string[] | undefined): calendar_v3.Schema$Event {
  const body: calendar_v3.Schema$Event = {}
  if (!permissions) return body
  if (permissions.includes("modify")) body.guestsCanModify = true
  if (permissions.includes("inviteOthers")) body.guestsCanInviteOthers = true
  if (permissions.includes("seeOtherInvites")) body.guestsCanSeeOtherGuests = true
  return body
}

const inputSchema = z.object({
  account: accountSchema,
  summary: z.string(),
  startTime: dateTimeSchema,
  endTime: dateTimeSchema,
  calendarId: z.string().optional(),
  allDay: z.boolean().optional(),
  addGoogleMeetUrl: z.boolean().optional(),
  googleMeetUrl: z.string().optional(),
  attendees: z.array(attendeeSchema).optional(),
  attendeeEmails: z.array(z.email()).optional().describe("Deprecated. Use attendees."),
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
  workingLocationProperties: z.record(z.string(), z.unknown()).optional()
})

export const createEventTool = defineTool(
  "create_event",
  {
    title: "Create event",
    description:
      "Creates an event and returns the full Event. notificationLevel defaults to ALL, which emails guests; REST defaults to sending nothing.",
    inputSchema,
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const client = context.calendar(slug)

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

    const attendees = toAttendeeList(args.attendees) ?? args.attendeeEmails?.map(email => ({ email })) ?? undefined

    let conferenceData: calendar_v3.Schema$Event["conferenceData"] | undefined
    if (args.addGoogleMeetUrl || args.googleMeetUrl) {
      conferenceData = {}
      if (args.addGoogleMeetUrl) {
        conferenceData.createRequest = {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" }
        }
      }
      if (args.googleMeetUrl) {
        conferenceData.entryPoints = [{ entryPointType: "video", uri: args.googleMeetUrl }]
      }
    }

    const requestBody: calendar_v3.Schema$Event = { summary: args.summary, start, end }
    if (args.location) requestBody.location = args.location
    if (args.description) requestBody.description = args.description
    if (args.colorId) requestBody.colorId = args.colorId
    if (args.visibility) requestBody.visibility = args.visibility
    if (args.eventType) requestBody.eventType = args.eventType
    if (attendees) requestBody.attendees = attendees
    if (args.attachments) requestBody.attachments = args.attachments
    if (args.recurrenceData) requestBody.recurrence = args.recurrenceData
    if (args.overrideReminders) requestBody.reminders = { useDefault: false, overrides: args.overrideReminders }
    if (args.workingLocationProperties) requestBody.workingLocationProperties = args.workingLocationProperties
    if (args.availability === "AVAILABILITY_FREE") requestBody.transparency = "transparent"
    if (args.availability === "AVAILABILITY_BUSY") requestBody.transparency = "opaque"
    Object.assign(requestBody, permissionsToBody(args.guestPermissions))
    if (conferenceData) requestBody.conferenceData = conferenceData

    const params: calendar_v3.Params$Resource$Events$Insert = {
      calendarId: args.calendarId ?? "primary",
      sendUpdates: sendUpdatesFor(args.notificationLevel),
      requestBody
    }
    if (conferenceData) params.conferenceDataVersion = 1
    const response = await client.events.insert(params)

    return toEvent(response.data)
  }
)
