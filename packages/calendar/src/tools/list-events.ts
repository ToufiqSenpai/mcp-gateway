import type { calendar_v3 } from "@googleapis/calendar"
import { ToolResult, collectPages, defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { toEvent, type CalendarEvent } from "../map"
import {
  accountSchema,
  dateTimeSchema,
  eventTypeSchema,
  googleEventType,
  orderBySchema,
  pageSizeSchema,
  pageTokenSchema
} from "../schemas"
import type { ToolContext } from "./tool-context"

const DEFAULT_EVENT_TYPES = ["DEFAULT", "OUT_OF_OFFICE", "FOCUS_TIME", "FROM_GMAIL"] as const

interface EventListData {
  summary?: string
  description?: string
  updated?: string
  timeZone?: string
  accessRole?: string
  defaultReminders: calendar_v3.Schema$EventReminder[]
  events: CalendarEvent[]
  nextPageToken?: string
}

function isoSecurityWindow(startTime: string | undefined, endTime: string | undefined) {
  const now = new Date()
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  return {
    timeMin: startTime ?? now.toISOString(),
    timeMax: endTime ?? weekAhead.toISOString()
  }
}

function matchesFullText(event: CalendarEvent, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const haystack = [
    event.summary ?? "",
    event.description ?? "",
    event.location ?? "",
    ...(event.attendees ?? []).flatMap(attendee => [attendee.email ?? "", attendee.displayName ?? ""])
  ]
    .join("\n")
    .toLowerCase()
  return terms.every(term => haystack.includes(term))
}

const inputSchema = z.object({
  account: accountSchema,
  calendarId: z
    .string()
    .optional()
    .describe(
      "Optional. ID of the calendar containing the events. Email address - can be resolved using list_calendars. Default: primary calendar."
    ),
  startTime: dateTimeSchema
    .optional()
    .describe(
      "Optional. The lower bound of a time range. Must only be set when a specific timeframe is requested by the user. Must be an ISO 8601 timestamp less than endTime. Default: now."
    ),
  endTime: dateTimeSchema
    .optional()
    .describe(
      "Optional. The upper bound of a time range. Must only be set when a specific timeframe or a time in the past is requested by the user. Must be an ISO 8601 timestamp greater than startTime. Default: 7 days after startTime."
    ),
  fullText: z
    .string()
    .optional()
    .describe(
      "Optional. Free-form case-insensitive search matching title, description, location, or attendees. Matches events containing all query terms verbatim (AND search)."
    ),
  eventType: z
    .array(eventTypeSchema)
    .optional()
    .describe(
      "Optional. The event types to return. If empty, only DEFAULT, OUT_OF_OFFICE, FOCUS_TIME, and FROM_GMAIL are returned."
    ),
  eventTypeFilter: z.array(eventTypeSchema).optional().describe("Deprecated. Use eventType."),
  orderBy: orderBySchema.optional(),
  pageSize: pageSizeSchema.describe("Optional. Max events per page (default 100, max 250). Recommended: 10."),
  pageToken: pageTokenSchema.describe(
    "Optional. Next page token. Use the value from the previous page's nextPageToken."
  ),
  timeZone: z
    .string()
    .optional()
    .describe(
      "Optional. Time zone (IANA ID, for example Europe/Zurich) used to resolve timezone-less dates. Default: calendar's timezone."
    )
})

export const listEventsTool = defineTool(
  "list_events",
  {
    title: "List events",
    description:
      "Returns events on the given calendar matching all specified constraints. Time constraints should not be specified unless requested by the user. For open-ended keyword or topic-based searches on the primary calendar, use search_events. Without a time range, defaults to now through the next 7 days.",
    inputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const client = context.calendar(slug)
    const calendarId = args.calendarId ?? "primary"
    const { timeMin, timeMax } = isoSecurityWindow(args.startTime, args.endTime)
    const eventTypes = (args.eventType ?? args.eventTypeFilter ?? [...DEFAULT_EVENT_TYPES]).map(googleEventType)
    const accounts = await context.listAccounts()

    let meta: calendar_v3.Schema$Events | undefined
    const collected = await collectPages<CalendarEvent>(async pageToken => {
      const params: calendar_v3.Params$Resource$Events$List = {
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        maxResults: 250,
        eventTypes
      }
      if (args.orderBy) params.orderBy = args.orderBy
      if (args.timeZone) params.timeZone = args.timeZone
      if (pageToken) params.pageToken = pageToken
      const response = await client.events.list(params)
      meta ??= response.data
      return {
        items: (response.data.items ?? []).map(toEvent),
        nextPageToken: response.data.nextPageToken
      }
    })

    const fullText = args.fullText
    const filtered = fullText ? collected.items.filter(event => matchesFullText(event, fullText)) : collected.items

    const page = await context.paginate<CalendarEvent>({
      accounts,
      pageToken: args.pageToken,
      pageSize: args.pageSize,
      fetchAll: async () => ({ items: filtered, truncated: collected.truncated })
    })

    const data: EventListData = {
      summary: meta?.summary ?? undefined,
      description: meta?.description ?? undefined,
      updated: meta?.updated ?? undefined,
      timeZone: meta?.timeZone ?? undefined,
      accessRole: meta?.accessRole ?? undefined,
      defaultReminders: meta?.defaultReminders ?? [],
      events: page.items
    }
    if (page.nextPageToken) data.nextPageToken = page.nextPageToken
    return new ToolResult(data, { truncated: page.truncated, skipped: page.skipped })
  }
)
