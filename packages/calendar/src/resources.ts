import {
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
  ResourceTemplate,
} from '@modelcontextprotocol/server';
import { googleCalendar } from './client';
import type { McpContext } from './context';
import { toEvent } from './map';

const URI_PATTERN = /^calendar:\/\/([^/]+)\/calendars\/(.+)$/;
const UNRESERVED_ESCAPE = /[!'()*]/g;

/** Percent-encodes everything outside RFC 3986 unreserved; calendar ids legally contain # and @. */
export function encodeCalendarId(id: string): string {
  return encodeURIComponent(id).replace(
    UNRESERVED_ESCAPE,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function decodeCalendarId(segment: string): string {
  const decoded = decodeURIComponent(segment);
  if (decoded.includes('/')) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Calendar id may not contain "/"');
  }
  return decoded;
}

export function calendarUri(account: string, calendarId: string): string {
  return `calendar://${account}/calendars/${encodeCalendarId(calendarId)}`;
}

function parseUri(uri: string): { account: string; calendarId: string } {
  const match = URI_PATTERN.exec(uri);
  if (!match?.[1] || !match[2]) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Unrecognised calendar resource URI');
  }
  return { account: match[1], calendarId: decodeCalendarId(match[2]) };
}

/**
 * One resource per Calendar per usable Account. A sick Account is skipped, never faked: the
 * listing stays complete for healthy Accounts and says which slugs were skipped.
 */
export interface ResourceListing {
  resources: { uri: string; name: string; mimeType: string }[];
  skipped: string[];
  truncated: boolean;
}

/**
 * One resource per Calendar per usable Account. A sick Account is skipped, never faked: the
 * listing stays complete for healthy Accounts and says which slugs were skipped.
 */
export async function listCalendarResources(ctx: McpContext): Promise<ResourceListing> {
  const accounts = await ctx.listAccounts();
  const resources: ResourceListing['resources'] = [];
  const skipped: string[] = [];
  let truncated = false;

  for (const account of accounts) {
    try {
      const listing = await ctx.enumeration<ResourceListing['resources'][number]>(
        account.slug,
        async () => {
          const client = googleCalendar(ctx, account.slug);
          const items: ResourceListing['resources'] = [];
          let pageToken: string | undefined;
          let hitCap = false;
          let fetched = 0;

          do {
            const response = await client.calendarList.list({
              maxResults: 250,
              ...(pageToken ? { pageToken } : {}),
            });
            for (const calendar of response.data.items ?? []) {
              if (!calendar.id) continue;
              items.push({
                uri: calendarUri(account.slug, calendar.id),
                name: calendar.summary ?? calendar.id,
                mimeType: 'application/json',
              });
            }
            fetched = items.length;
            hitCap = fetched >= 1000;
            pageToken = response.data.nextPageToken ?? undefined;
          } while (pageToken && !hitCap);

          return { items: items.slice(0, 1000), truncated: hitCap };
        },
      );
      resources.push(...listing.items);
      truncated ||= listing.truncated;
    } catch {
      skipped.push(account.slug);
    }
  }

  return { resources, skipped, truncated };
}

export function registerResources(server: McpServer, ctx: McpContext): void {
  const template = new ResourceTemplate('calendar://{account}/calendars/{calendarId}', {
    list: async () => {
      const listing = await listCalendarResources(ctx);
      return {
        resources: listing.resources,
        ...(listing.skipped.length > 0 ? { ttlMs: 0 } : {}),
        ...(listing.skipped.length > 0
          ? { _meta: { 'mcp-gateway/skippedAccounts': listing.skipped } }
          : {}),
      };
    },
  });

  server.registerResource(
    'calendar',
    template,
    { title: 'Calendar', mimeType: 'application/json' },
    async (uri) => {
      const { account, calendarId } = parseUri(uri.href);
      let client;
      try {
        client = googleCalendar(ctx, account);
      } catch {
        throw new ProtocolError(
          ProtocolErrorCode.InternalError,
          `Credentials for Account "${account}" are unusable.`,
        );
      }

      let calendar;
      try {
        calendar = (await client.calendarList.get({ calendarId })).data;
      } catch {
        throw new ResourceNotFoundError(uri.href);
      }

      const start = new Date();
      const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
      const events = await client.events.list({
        calendarId,
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      });

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              account,
              calendar,
              window: { start: start.toISOString(), end: end.toISOString() },
              events: (events.data.items ?? []).map(toEvent),
              truncated: Boolean(events.data.nextPageToken),
            }),
          },
        ],
      };
    },
  );
}

