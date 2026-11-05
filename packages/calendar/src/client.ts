import type { calendar_v3 } from "@googleapis/calendar"
import type { McpContext } from "@mcp-gateway/common"

export const GOOGLE_ROOT_URL = "https://www.googleapis.com/"

/** Query values the Provider endpoints accept; objects never reach the URL builder. */
export type QueryValue = string | number | boolean | string[] | undefined

interface RequestOptions {
  method?: string
  query?: Record<string, QueryValue>
  body?: object
  contentType?: string
}

/**
 * Google is called over plain `fetch` with the typed shapes from `@googleapis/calendar`
 * (type-only: nothing from the SDK is bundled). The seam is `rootUrl`, so tests fake HTTP
 * where production calls it. The token still comes from `McpContext`, and a Provider 401
 * triggers exactly one forced refresh and one retry.
 */
export class GoogleApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
    this.name = "GoogleApiError"
  }
}

/** One Account's authenticated transport: token at the edge, one refresh-and-retry on 401. */
export class GoogleRequest {
  public constructor(
    private readonly ctx: McpContext,
    private readonly slug: string,
    private readonly rootUrl: string
  ) {}

  private send(token: string, path: string, options: RequestOptions): Promise<Response> {
    const url = new URL(path, this.rootUrl)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined) continue
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, item)
      } else {
        url.searchParams.set(key, String(value))
      }
    }

    const headers = new Headers({
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    })
    const init: RequestInit = { method: options.method ?? "GET", headers }
    if (options.body !== undefined) {
      headers.set("Content-Type", options.contentType ?? "application/json")
      init.body = JSON.stringify(options.body)
    }

    return fetch(url, init)
  }

  public async call<T>(path: string, options: RequestOptions = {}): Promise<{ data: T }> {
    let response = await this.send(await this.ctx.getAccessToken(this.slug), path, options)
    if (response.status === 401) {
      // Reactive refresh: one forced rotation and one retry.
      response = await this.send(await this.ctx.refreshAccessToken(this.slug), path, options)
    }

    const text = await response.text()
    if (!response.ok) {
      let message = `Google request failed (${response.status})`
      try {
        // SAFETY: a Provider error body is JSON with an optional error.message string.
        const body = JSON.parse(text) as { error?: { message?: string } }
        if (body.error?.message) message = body.error.message
      } catch {
        // Keep the generic message: a raw Provider body never surfaces.
      }
      throw new GoogleApiError(response.status, message)
    }

    // SAFETY: the caller's T describes the documented Provider response for this path.
    return { data: (text ? JSON.parse(text) : {}) as T }
  }
}

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

/** Reads the Provider error status without ever returning a raw body. */
export function providerErrorCode(error: Error): string | undefined {
  return error instanceof GoogleApiError ? String(error.status) : undefined
}
