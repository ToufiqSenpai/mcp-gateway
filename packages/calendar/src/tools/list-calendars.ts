import type { calendar_v3 } from "@googleapis/calendar"
import { ToolResult, collectAcrossAccounts, collectPages, defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { accountSchema, pageSizeSchema, pageTokenSchema } from "../schemas"
import type { ToolContext } from "./tool-context"

interface CalendarRow {
  id?: string
  summary?: string
  description?: string
  timeZone?: string
}

interface CalendarListData {
  calendars: CalendarRow[]
  nextPageToken?: string
}

function toCalendarRow(item: calendar_v3.Schema$CalendarListEntry): CalendarRow {
  const row: CalendarRow = {}
  if (item.id) row.id = item.id
  if (item.summary) row.summary = item.summary
  if (item.description) row.description = item.description
  if (item.timeZone) row.timeZone = item.timeZone
  return row
}

const inputSchema = z.object({
  account: accountSchema,
  pageSize: pageSizeSchema,
  pageToken: pageTokenSchema
})

export const listCalendarsTool = defineTool(
  "list_calendars",
  {
    title: "List calendars",
    description:
      "Lists the calendars visible to each usable Account. Returns id, summary, description and timeZone; pageToken is the gateway's opaque cursor.",
    inputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (args, context: ToolContext) => {
    const selected = await context.selectedAccounts(args.account)

    const page = await context.paginate<CalendarRow>({
      accounts: selected,
      pageToken: args.pageToken,
      pageSize: args.pageSize,
      fetchAll: async () =>
        collectAcrossAccounts(selected, async slug => {
          const client = context.calendar(slug)
          return collectPages(async pageToken => {
            const params: calendar_v3.Params$Resource$Calendarlist$List = { maxResults: 250 }
            if (pageToken) params.pageToken = pageToken
            const response = await client.calendarList.list(params)
            return {
              items: (response.data.items ?? []).map(toCalendarRow),
              nextPageToken: response.data.nextPageToken
            }
          })
        })
    })

    const data: CalendarListData = { calendars: page.items }
    if (page.nextPageToken) data.nextPageToken = page.nextPageToken
    return new ToolResult(data, { truncated: page.truncated, skipped: page.skipped })
  }
)
