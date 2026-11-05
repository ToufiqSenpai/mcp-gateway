import type { calendar_v3 } from "@googleapis/calendar"
import type { McpContext } from "@mcp-gateway/common"
import { GOOGLE_ROOT_URL, GoogleRequest } from "@mcp-gateway/google-api"

export { GOOGLE_ROOT_URL, GoogleApiError, providerErrorCode } from "@mcp-gateway/google-api"

function pathSegment(value: string | undefined): string {
  return encodeURIComponent(value ?? "")
}

export class CalendarListResource {
  public constructor(private readonly request: GoogleRequest) {}

  public list(params: calendar_v3.Params$Resource$Calendarlist$List) {
    return this.request.call<calendar_v3.Schema$CalendarList>("calendar/v3/users/me/calendarList", {
      query: { maxResults: params.maxResults, pageToken: params.pageToken }
    })
  }

  public get(params: calendar_v3.Params$Resource$Calendarlist$Get) {
    return this.request.call<calendar_v3.Schema$CalendarListEntry>(
      `calendar/v3/users/me/calendarList/${pathSegment(params.calendarId)}`
    )
  }
}

export class EventsResource {
  public constructor(private readonly request: GoogleRequest) {}

  public list(params: calendar_v3.Params$Resource$Events$List) {
    return this.request.call<calendar_v3.Schema$Events>(
      `calendar/v3/calendars/${pathSegment(params.calendarId)}/events`,
      {
        query: {
          timeMin: params.timeMin,
          timeMax: params.timeMax,
          singleEvents: params.singleEvents,
          orderBy: params.orderBy,
          maxResults: params.maxResults,
          pageToken: params.pageToken,
          eventTypes: params.eventTypes,
          q: params.q,
          timeZone: params.timeZone
        }
      }
    )
  }

  public get(params: calendar_v3.Params$Resource$Events$Get) {
    return this.request.call<calendar_v3.Schema$Event>(
      `calendar/v3/calendars/${pathSegment(params.calendarId)}/events/${pathSegment(params.eventId)}`
    )
  }

  public insert(params: calendar_v3.Params$Resource$Events$Insert) {
    return this.request.call<calendar_v3.Schema$Event>(
      `calendar/v3/calendars/${pathSegment(params.calendarId)}/events`,
      {
        method: "POST",
        body: params.requestBody,
        query: {
          sendUpdates: params.sendUpdates,
          conferenceDataVersion: params.conferenceDataVersion
        }
      }
    )
  }

  public patch(params: calendar_v3.Params$Resource$Events$Patch) {
    return this.request.call<calendar_v3.Schema$Event>(
      `calendar/v3/calendars/${pathSegment(params.calendarId)}/events/${pathSegment(params.eventId)}`,
      {
        method: "PATCH",
        body: params.requestBody,
        query: {
          sendUpdates: params.sendUpdates,
          conferenceDataVersion: params.conferenceDataVersion
        }
      }
    )
  }

  public delete(params: calendar_v3.Params$Resource$Events$Delete) {
    return this.request.call<object>(
      `calendar/v3/calendars/${pathSegment(params.calendarId)}/events/${pathSegment(params.eventId)}`,
      { method: "DELETE", query: { sendUpdates: params.sendUpdates } }
    )
  }
}

export class FreeBusyResource {
  public constructor(private readonly request: GoogleRequest) {}

  public query(params: calendar_v3.Params$Resource$Freebusy$Query) {
    return this.request.call<calendar_v3.Schema$FreeBusyResponse>("calendar/v3/freeBusy", {
      method: "POST",
      body: params.requestBody
    })
  }
}

/** The typed Google surface for one Account; one instance per tool call, never shared. */
export class GoogleCalendarClient {
  public readonly calendarList: CalendarListResource
  public readonly events: EventsResource
  public readonly freebusy: FreeBusyResource

  public constructor(ctx: McpContext, slug: string, rootUrl: string = GOOGLE_ROOT_URL) {
    const request = new GoogleRequest(ctx, slug, rootUrl)
    this.calendarList = new CalendarListResource(request)
    this.events = new EventsResource(request)
    this.freebusy = new FreeBusyResource(request)
  }
}
