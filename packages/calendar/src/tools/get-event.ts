import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { toEvent } from "../map"
import { accountSchema } from "../schemas"
import type { ToolContext } from "./tool-context"

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
