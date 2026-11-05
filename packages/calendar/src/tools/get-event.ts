import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { toEvent } from "../map"
import { accountSchema } from "../schemas"
import type { ToolContext } from "./tool-context"

const inputSchema = z.object({
  account: accountSchema,
  eventId: z.string().describe("Required. Event ID."),
  calendarId: z
    .string()
    .optional()
    .describe(
      "Optional. ID of the calendar containing the event. Email address - can be resolved using list_calendars. Default: primary calendar."
    )
})

export const getEventTool = defineTool(
  "get_event",
  {
    title: "Get event",
    description: "Returns a single event on the given calendar.",
    inputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const client = context.calendar(slug)
    const response = await client.events.get({
      calendarId: args.calendarId ?? "primary",
      eventId: args.eventId
    })
    return toEvent(response.data)
  }
)
