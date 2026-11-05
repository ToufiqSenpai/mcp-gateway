import type { calendar_v3 } from "@googleapis/calendar"
import { Google } from "@mcp-gateway/google"

export { GOOGLE_ROOT_URL, GoogleApiError, providerErrorCode } from "@mcp-gateway/google"

function pathSegment(value: string | undefined): string {
  return encodeURIComponent(value ?? "")
}

/** The typed Google Calendar surface for one Account; one instance per tool call, never shared. */
export class GoogleCalendar extends Google {
  public listCalendars(params: calendar_v3.Params$Resource$Calendarlist$List) {
    return this.call<calendar_v3.Schema$CalendarList>("calendar/v3/users/me/calendarList", {
      query: { maxResults: params.maxResults, pageToken: params.pageToken }
    })
  }

  public getCalendar(params: calendar_v3.Params$Resource$Calendarlist$Get) {
    return this.call<calendar_v3.Schema$CalendarListEntry>(
      `calendar/v3/users/me/calendarList/${pathSegment(params.calendarId)}`
    )
  }

  public listEvents(params: calendar_v3.Params$Resource$Events$List) {
    return this.call<calendar_v3.Schema$Events>(`calendar/v3/calendars/${pathSegment(params.calendarId)}/events`, {
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
    })
  }

  public getEvent(params: calendar_v3.Params$Resource$Events$Get) {
    return this.call<calendar_v3.Schema$Event>(
      `calendar/v3/calendars/${pathSegment(params.calendarId)}/events/${pathSegment(params.eventId)}`
    )
  }

  public insertEvent(params: calendar_v3.Params$Resource$Events$Insert) {
    return this.call<calendar_v3.Schema$Event>(`calendar/v3/calendars/${pathSegment(params.calendarId)}/events`, {
      method: "POST",
      body: params.requestBody,
      query: {
        sendUpdates: params.sendUpdates,
        conferenceDataVersion: params.conferenceDataVersion
      }
    })
  }

  public patchEvent(params: calendar_v3.Params$Resource$Events$Patch) {
    return this.call<calendar_v3.Schema$Event>(
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

  public deleteEvent(params: calendar_v3.Params$Resource$Events$Delete) {
    return this.call<object>(
      `calendar/v3/calendars/${pathSegment(params.calendarId)}/events/${pathSegment(params.eventId)}`,
      { method: "DELETE", query: { sendUpdates: params.sendUpdates } }
    )
  }

  public queryFreeBusy(params: calendar_v3.Params$Resource$Freebusy$Query) {
    return this.call<calendar_v3.Schema$FreeBusyResponse>("calendar/v3/freeBusy", {
      method: "POST",
      body: params.requestBody
    })
  }
}
