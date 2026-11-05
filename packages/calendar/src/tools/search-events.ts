import type { calendar_v3 } from "@googleapis/calendar"
import { ToolResult, collectPages, defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { toEvent, type CalendarEvent } from "../map"
import { accountSchema, pageSizeSchema, pageTokenSchema } from "../schemas"
import type { ToolContext } from "./tool-context"

const inputSchema = z.object({
  account: accountSchema,
  query: z.string().min(1).describe("Required. Query string to search for events (case-insensitive)."),
  pageSize: pageSizeSchema.describe("Optional. Maximum number of entries returned on one result page."),
  pageToken: pageTokenSchema.describe("Optional. Token specifying which result page to return.")
})

interface EventSearchData {
  events: CalendarEvent[]
  nextPageToken?: string
}

export const searchEventsTool = defineTool(
  "search_events",
  {
    title: "Search events",
    description:
      "Searches events on the user's primary calendar by literal text, matching text rather than meaning. Takes no calendarId and no time bounds.",
    inputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const client = context.calendar(slug)
    const accounts = await context.listAccounts()

    const collected = await collectPages<CalendarEvent>(async pageToken => {
      const params: calendar_v3.Params$Resource$Events$List = {
        calendarId: "primary",
        q: args.query,
        singleEvents: true,
        maxResults: 250
      }
      if (pageToken) params.pageToken = pageToken
      const response = await client.events.list(params)
      return {
        items: (response.data.items ?? []).map(toEvent),
        nextPageToken: response.data.nextPageToken
      }
    })

    const page = await context.paginate<CalendarEvent>({
      accounts,
      pageToken: args.pageToken,
      pageSize: args.pageSize,
      fetchAll: async () => ({ items: collected.items, truncated: collected.truncated })
    })

    const data: EventSearchData = { events: page.items }
    if (page.nextPageToken) data.nextPageToken = page.nextPageToken
    return new ToolResult(data, { truncated: page.truncated, skipped: page.skipped })
  }
)
