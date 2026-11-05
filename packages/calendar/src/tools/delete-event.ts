import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { toEvent } from "../map"
import { accountSchema, notificationLevelSchema, sendUpdatesFor } from "../schemas"
import type { ToolContext } from "./tool-context"

const inputSchema = z.object({
  account: accountSchema,
  eventId: z.string().describe("Required. The ID of the event to delete."),
  calendarId: z
    .string()
    .optional()
    .describe(
      "Optional. ID of the calendar containing the event. Email address - can be resolved using list_calendars. Default: primary calendar."
    ),
  notificationLevel: notificationLevelSchema
    .optional()
    .describe("Optional. Which email notification should be sent for this event update.")
})

export const deleteEventTool = defineTool(
  "delete_event",
  {
    title: "Delete event",
    description: "Deletes an event on the given calendar. Returns the event it removed.",
    inputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const client = context.calendar(slug)
    const calendarId = args.calendarId ?? "primary"

    const existing = (await client.getEvent({ calendarId, eventId: args.eventId })).data
    await client.deleteEvent({
      calendarId,
      eventId: args.eventId,
      sendUpdates: sendUpdatesFor(args.notificationLevel)
    })

    return toEvent(existing)
  }
)
