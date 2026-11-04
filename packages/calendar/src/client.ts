import type { calendar_v3 } from '@googleapis/calendar';
import type { McpContext } from './context';

export const GOOGLE_ROOT_URL = 'https://www.googleapis.com/';

/**
 * Google is called over plain `fetch` with the typed shapes from `@googleapis/calendar`
 * (type-only: nothing from the SDK is bundled). The seam is `rootUrl`, so tests fake HTTP
 * where production calls it. The token still comes from `McpContext`, and a Provider 401
 * triggers exactly one forced refresh and one retry.
 */
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

export interface CalendarApi {
  calendarList: {
    list(params: calendar_v3.Params$Resource$Calendarlist$List): Promise<{
      data: calendar_v3.Schema$CalendarList;
    }>;
    get(params: calendar_v3.Params$Resource$Calendarlist$Get): Promise<{
      data: calendar_v3.Schema$CalendarListEntry;
    }>;
  };
  events: {
    list(params: calendar_v3.Params$Resource$Events$List): Promise<{
      data: calendar_v3.Schema$Events;
    }>;
    get(params: calendar_v3.Params$Resource$Events$Get): Promise<{
      data: calendar_v3.Schema$Event;
    }>;
    insert(params: calendar_v3.Params$Resource$Events$Insert): Promise<{
      data: calendar_v3.Schema$Event;
    }>;
    patch(params: calendar_v3.Params$Resource$Events$Patch): Promise<{
      data: calendar_v3.Schema$Event;
    }>;
    delete(params: calendar_v3.Params$Resource$Events$Delete): Promise<{ data: unknown }>;
  };
  freebusy: {
    query(params: calendar_v3.Params$Resource$Freebusy$Query): Promise<{
      data: calendar_v3.Schema$FreeBusyResponse;
    }>;
  };
}

class GoogleRequest {
  constructor(
    private readonly ctx: McpContext,
    private readonly slug: string,
    private readonly rootUrl: string,
  ) {}

  private async send(
    token: string,
    path: string,
    options: {
      method?: string;
      query?: Record<string, unknown>;
      body?: unknown;
      contentType?: string;
    },
  ): Promise<Response> {
    const url = new URL(path, this.rootUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    return fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(options.body !== undefined
          ? { 'Content-Type': options.contentType ?? 'application/json' }
          : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  }

  async call<T>(
    path: string,
    options: {
      method?: string;
      query?: Record<string, unknown>;
      body?: unknown;
      contentType?: string;
    } = {},
  ): Promise<{ data: T }> {
    let response = await this.send(await this.ctx.getAccessToken(this.slug), path, options);
    if (response.status === 401) {
      // Reactive refresh: one forced rotation and one retry.
      response = await this.send(await this.ctx.refreshAccessToken(this.slug), path, options);
    }

    const text = await response.text();
    if (!response.ok) {
      let message = `Google request failed (${response.status})`;
      try {
        const body = JSON.parse(text) as { error?: { message?: string } };
        if (body.error?.message) message = body.error.message;
      } catch {
        // Keep the generic message: a raw Provider body never surfaces.
      }
      throw new GoogleApiError(response.status, message);
    }

    return { data: (text ? JSON.parse(text) : {}) as T };
  }
}

function pathSegment(value: string | undefined): string {
  return encodeURIComponent(value ?? '');
}

export function googleCalendar(
  ctx: McpContext,
  slug: string,
  rootUrl: string = GOOGLE_ROOT_URL,
): CalendarApi {
  const request = new GoogleRequest(ctx, slug, rootUrl);
  const base = 'calendar/v3';

  return {
    calendarList: {
      list: (params) =>
        request.call<calendar_v3.Schema$CalendarList>(`${base}/users/me/calendarList`, {
          query: { maxResults: params.maxResults, pageToken: params.pageToken },
        }),
      get: (params) =>
        request.call<calendar_v3.Schema$CalendarListEntry>(
          `${base}/users/me/calendarList/${pathSegment(params.calendarId)}`,
        ),
    },
    events: {
      list: (params) =>
        request.call<calendar_v3.Schema$Events>(
          `${base}/calendars/${pathSegment(params.calendarId)}/events`,
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
              timeZone: params.timeZone,
            },
          },
        ),
      get: (params) =>
        request.call<calendar_v3.Schema$Event>(
          `${base}/calendars/${pathSegment(params.calendarId)}/events/${pathSegment(params.eventId)}`,
        ),
      insert: (params) =>
        request.call<calendar_v3.Schema$Event>(
          `${base}/calendars/${pathSegment(params.calendarId)}/events`,
          {
            method: 'POST',
            body: params.requestBody,
            query: {
              sendUpdates: params.sendUpdates,
              conferenceDataVersion: params.conferenceDataVersion,
            },
          },
        ),
      patch: (params) =>
        request.call<calendar_v3.Schema$Event>(
          `${base}/calendars/${pathSegment(params.calendarId)}/events/${pathSegment(params.eventId)}`,
          {
            method: 'PATCH',
            body: params.requestBody,
            query: {
              sendUpdates: params.sendUpdates,
              conferenceDataVersion: params.conferenceDataVersion,
            },
          },
        ),
      delete: (params) =>
        request.call<unknown>(
          `${base}/calendars/${pathSegment(params.calendarId)}/events/${pathSegment(params.eventId)}`,
          { method: 'DELETE', query: { sendUpdates: params.sendUpdates } },
        ),
    },
    freebusy: {
      query: (params) =>
        request.call<calendar_v3.Schema$FreeBusyResponse>(`${base}/freeBusy`, {
          method: 'POST',
          body: params.requestBody,
        }),
    },
  };
}

/** Reads the Provider error status without ever returning a raw body. */
export function providerErrorCode(error: unknown): string | undefined {
  if (error instanceof GoogleApiError) return String(error.status);
  const maybe = error as { code?: unknown; response?: { status?: unknown } };
  if (typeof maybe.code === 'string' || typeof maybe.code === 'number') return String(maybe.code);
  if (typeof maybe.response?.status === 'number') return String(maybe.response.status);
  return undefined;
}
