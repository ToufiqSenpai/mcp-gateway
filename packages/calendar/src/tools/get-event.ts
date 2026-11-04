import { z } from "zod"

import { toEvent } from "../map"
import { accountSchema } from "../schemas"
import { defineTool } from "./helpers"

const inputSchema = z.object({
  account: accountSchema,
  eventId: z.string(),
  calendarId: z.string().optional()
})

export const getEventTool = defineTool(
  "get_event",
  {
    title: "Get event",
    description: "Returns one event from a calendar, defaulting to the primary calendar.",
    inputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (args, context) => {
    const slug = await context.resolve(args.account)
    const client = context.calendar(slug)
    const response = await client.events.get({
      calendarId: args.calendarId ?? "primary",
      eventId: args.eventId
    })
    return toEvent(response.data)
  }
)
