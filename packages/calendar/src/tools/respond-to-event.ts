import type { calendar_v3 } from "@googleapis/calendar"
import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { toEvent } from "../map"
import { accountSchema, notificationLevelSchema, responseStatusSchema, sendUpdatesFor } from "../schemas"
import type { ToolContext } from "./tool-context"

const inputSchema = z.object({
  account: accountSchema,
  eventId: z.string(),
  responseStatus: responseStatusSchema,
  calendarId: z.string().optional(),
  notificationLevel: notificationLevelSchema.optional(),
  responseComment: z.string().optional()
})

export const respondToEventTool = defineTool(
  "respond_to_event",
  {
    title: "Respond to event",
    description:
      "Responds to an invitation with a targeted patch: attendeesOmitted=true and a single attendee entry for the current user. notificationLevel defaults to ALL.",
    inputSchema,
    annotations: { idempotentHint: true, destructiveHint: false }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const client = context.calendar(slug)
    const calendarId = args.calendarId ?? "primary"

    const current = (await client.events.get({ calendarId, eventId: args.eventId })).data
    const self = current.attendees?.find(attendee => attendee.self === true)
    if (!self?.email) {
      throw new Error(
        'Event "' + args.eventId + '" has no attendee representing the current user, so there is nothing to respond to.'
      )
    }

    const attendee: calendar_v3.Schema$EventAttendee = {
      email: self.email,
      responseStatus: args.responseStatus
    }
    if (args.responseComment) attendee.comment = args.responseComment
    const requestBody: calendar_v3.Schema$Event = {
      attendeesOmitted: true,
      attendees: [attendee]
    }

    const response = await client.events.patch({
      calendarId,
      eventId: args.eventId,
      sendUpdates: sendUpdatesFor(args.notificationLevel),
      requestBody
    })

    return toEvent(response.data)
  }
)
