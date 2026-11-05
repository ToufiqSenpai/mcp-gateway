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
  pageSize: pageSizeSchema.describe("Optional. Max results per page. Default 100, max 250."),
  pageToken: pageTokenSchema.describe("Optional. Token specifying which result page to return.")
})

export const listCalendarsTool = defineTool(
  "list_calendars",
  {
    title: "List calendars",
    description:
      "Returns the calendars this user has access to (their calendar list). Use this tool to resolve calendar identifying data (for example, 'my family calendar') into its corresponding calendarId. Lists every usable Account when account is omitted.",
    inputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (args, context: ToolContext) => {
    const selected = await context.selectedAccounts(args.account)

    const page = await context.paginate<CalendarRow>({
      accounts: selected,
      pageToken: args.pageToken,
      pageSize: args.pageSize,
      fetchAll: () =>
        collectAcrossAccounts(selected, slug => {
          const client = context.calendar(slug)
          return collectPages(async pageToken => {
            const params: calendar_v3.Params$Resource$Calendarlist$List = { maxResults: 250 }
            if (pageToken) params.pageToken = pageToken
            const response = await client.listCalendars(params)
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
