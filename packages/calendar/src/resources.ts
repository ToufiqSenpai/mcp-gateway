import type { calendar_v3 } from "@googleapis/calendar"
import { AccountResourceRegistry, collectPages, type ResourceItem } from "@mcp-gateway/common"
import { ProtocolError, ProtocolErrorCode, ResourceNotFoundError } from "@modelcontextprotocol/server"

import { GoogleApiError } from "./client"
import { toEvent } from "./map"
import type { ToolContext } from "./tools/tool-context"

const URI_PATTERN = /^calendar:\/\/([^/]+)\/calendars\/(.+)$/
const UNRESERVED_ESCAPE = /[!'()*]/g

/** Percent-encodes everything outside RFC 3986 unreserved; calendar ids legally contain # and @. */
export function encodeCalendarId(id: string): string {
  return encodeURIComponent(id).replace(
    UNRESERVED_ESCAPE,
    char => `%${char.codePointAt(0)!.toString(16).toUpperCase()}`
  )
}

export function decodeCalendarId(segment: string): string {
  const decoded = decodeURIComponent(segment)
  if (decoded.includes("/")) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Calendar id may not contain "/"')
  }
  return decoded
}

export function calendarUri(account: string, calendarId: string): string {
  return `calendar://${account}/calendars/${encodeCalendarId(calendarId)}`
}

interface ParsedCalendarUri {
  account: string
  calendarId: string
}

function parseUri(uri: string): ParsedCalendarUri {
  const match = URI_PATTERN.exec(uri)
  if (!match?.[1] || !match[2]) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, "Unrecognised calendar resource URI")
  }
  return { account: match[1], calendarId: decodeCalendarId(match[2]) }
}

/** One resource per Calendar per usable Account; a sick Account is skipped and named. */
export class CalendarResourceRegistry extends AccountResourceRegistry<ToolContext> {
  protected readonly templateUri = "calendar://{account}/calendars/{calendarId}"
  protected readonly resourceName = "calendar"
  protected readonly resourceTitle = "Calendar"

  protected enumerate(slug: string): Promise<{ items: ResourceItem[]; truncated: boolean }> {
    const client = this.context.calendar(slug)
    return collectPages(async pageToken => {
      const params: calendar_v3.Params$Resource$Calendarlist$List = { maxResults: 250 }
      if (pageToken) params.pageToken = pageToken
      const response = await client.calendarList.list(params)
      return {
        items: (response.data.items ?? []).flatMap(calendar =>
          calendar.id
            ? [
                {
                  uri: calendarUri(slug, calendar.id),
                  name: calendar.summary ?? calendar.id,
                  mimeType: "application/json"
                }
              ]
            : []
        ),
        nextPageToken: response.data.nextPageToken
      }
    })
  }

  public async read(uri: string) {
    const { account, calendarId } = parseUri(uri)
    const client = this.context.calendar(account)

    let calendar
    try {
      calendar = (await client.calendarList.get({ calendarId })).data
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 404) {
        throw new ResourceNotFoundError(uri)
      }
      if (error instanceof GoogleApiError && (error.status === 401 || error.status === 403)) {
        throw new ProtocolError(
          ProtocolErrorCode.InternalError,
          `Credentials for Account "${account}" were refused by the Provider.`
        )
      }
      throw error
    }

    const start = new Date()
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)
    const events = await client.events.list({
      calendarId,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50
    })

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({
            account,
            calendar,
            window: { start: start.toISOString(), end: end.toISOString() },
            events: (events.data.items ?? []).map(toEvent),
            truncated: Boolean(events.data.nextPageToken)
          })
        }
      ]
    }
  }
}
