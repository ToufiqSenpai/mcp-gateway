# Contract: `calendar` MCP

Provider: Google Calendar, read-write. Endpoint `/mcps/calendar`. Protocol `2026-07-28`, stateless, one server instance per request. Behaviour source: `docs/SPEC.md` §11, §12.

## Server facts

- Own `server/discover` and `serverInfo`; no gateway-wide discovery document.
- Capabilities: tools, resources (`resources: {}`, no subscribe, no `listChanged`), prompts.
- `GET`/`DELETE` → `405`; unknown tool/prompt/resource → `-32602`; internal failure → `-32603`; tool failures → `isError: true` with a plain message.
- Every result is `resultType: "complete"`.

## Tools

- Every tool takes an optional `account` slug. Times are ISO 8601 exactly as Google documents them: `dateTime` carries an offset or trailing `Z` (for example `2019-11-20T08:19:06-07:00`), `date` is a midnight-UTC timestamp such as `2019-11-20T00:00:00Z`, and `timeZone` is set only when the user named a zone. `notificationLevel` defaults to `ALL` on create/update/delete/respond. `pageToken`/`nextPageToken` carry the gateway cursor, never Google's; `pageSize` defaults to 100 and caps at 250.

| Tool | Underlying call | Annotations |
| --- | --- | --- |
| `list_events` | `events.list` | readOnly, idempotent |
| `get_event` | `events.get` | readOnly, idempotent |
| `list_calendars` | `calendarList.list` | readOnly, idempotent |
| `suggest_time` | `freebusy.query` | readOnly, idempotent |
| `create_event` | `events.insert` | non-destructive |
| `update_event` | `events.patch` (read-modify-write) | idempotent |
| `delete_event` | `events.delete`, read first | destructive, idempotent |
| `respond_to_event` | targeted `events.patch` | idempotent |
| `search_events` | `events.list` with `q` | readOnly, idempotent |
| `list_accounts` | gateway | readOnly |

Signatures:

```text
list_events(calendarId?, startTime?, endTime?, fullText?, eventType[]?,
            eventTypeFilter[]? (deprecated), orderBy?, pageSize? = 100 (max 250),
            pageToken?, timeZone?)
  -> { summary, description, updated, timeZone, accessRole,
       defaultReminders[], events: Event[], nextPageToken? }
get_event(eventId, calendarId?) -> Event
list_calendars(pageSize? = 100 (max 250), pageToken?)
  -> { calendars: [{ id, summary, description, timeZone }], nextPageToken? }
suggest_time(attendeeEmails[], startTime, endTime, durationMinutes? = 30,
             timeZone?, preferences?)
  -> { timeSlots: [{ start: DateOrDateTime, end: DateOrDateTime,
                     startTime? (deprecated), endTime? (deprecated),
                     durationMinutes? (deprecated) }] }
     preferences: { startHour? "HH:mm", endHour? "HH:mm", excludeWeekends?,
                    pageSize? = 5 }
create_event(summary, startTime, endTime, calendarId?, allDay?, addGoogleMeetUrl?,
             googleMeetUrl?, attendees[]?, attendeeEmails[]? (deprecated),
             attachments[]?, availability?, colorId?, description?, eventType?,
             guestPermissions?, location?, notificationLevel?, overrideReminders[]?,
             recurrenceData[]?, timeZone?, visibility?, workingLocationProperties?)
  -> Event
update_event(eventId, calendarId?, summary?, description?, location?, startTime?,
             endTime?, allDay?, timeZone?, addedAttendees[]?,
             addedAttendeeEmails[]? (deprecated), removedAttendeeEmails[]?,
             addedAttachments[]?, removedAttachmentFileUrls[]?, availability?,
             colorId?, guestPermissions?, notificationLevel?, overrideReminders[]?,
             visibility?, addGoogleMeetUrl?, googleMeetUrl?)
  -> Event
delete_event(eventId, calendarId?, notificationLevel?) -> Event
respond_to_event(eventId, responseStatus, calendarId?, notificationLevel?,
                 responseComment?) -> Event
search_events(query, pageSize?, pageToken?) -> { events: Event[], nextPageToken? }
list_accounts() -> { accounts: [{ slug, isDefault }] }
```

Enums: `eventType` = `EVENT_TYPE_UNSPECIFIED|DEFAULT|OUT_OF_OFFICE|FOCUS_TIME|WORKING_LOCATION|BIRTHDAY|FROM_GMAIL`; `orderBy` = `default|startTime|startTimeDesc|lastModified`; `notificationLevel` = `NOTIFICATION_LEVEL_UNSPECIFIED|NONE|EXTERNAL_ONLY|ALL`; `availability` = `AVAILABILITY_UNSPECIFIED|AVAILABILITY_BUSY|AVAILABILITY_FREE`; `visibility` = `default|public|private`; `responseStatus` = `declined|tentative|accepted` (no `needsAction`).

`Event` = `id, summary, description, location, start, end, originalStartTime, status, eventType, recurrence, recurringEventId, attendees, organizer, creator, attachments, conferenceUrl, guestPermissions, overrideReminders, availability, visibility, transparency (deprecated), colorId, workingLocationProperties, htmlLink, created, updated`. `start`/`end` = `{ date, dateTime, timeZone }` with exactly one of `date`/`dateTime`; `date` is a midnight-UTC timestamp and `dateTime` carries its offset. REST-only fields (`kind`, `etag`, `iCalUID`, `sequence`, `hangoutLink`, `extendedProperties`) are absent.

## Required behaviours

1. `delete_event` reads the event before deleting and returns the full `Event`.
2. `respond_to_event` patches with `attendeesOmitted=true` and a single attendee entry for the current user.
3. `update_event` applies `added*`/`removed*` deltas itself; duration is preserved when only `startTime` is given.
4. `suggest_time` inverts busy intervals into free slots and applies `durationMinutes` and `preferences`.
5. `search_events` is literal `q` search on the primary calendar; no `calendarId`, no time bounds; its description says text, not meaning.
6. `list_events` hides `WORKING_LOCATION` and `BIRTHDAY` unless requested; default window now → now + 7 days.
7. `fullText` matches title, description, location or attendees; case-insensitive, and every query term must match (AND).

## Resources

- `resources/list`: one resource per calendar per usable Account. URI `calendar://<account>/calendars/<pct-encoded-id>`; percent-encode everything outside RFC 3986 unreserved, decode exactly once, reject a decoded `/`; never a `primary` alias.
- `resources/read`: one `text` item, `mimeType: application/json`, body `{ account, calendar, window: { start, end }, events[], truncated }`; window fixed at now → now + 7 days, `singleEvents=true`, `orderBy=startTime`, `maxResults=50`, `orderBy`-consistent event shapes.
- Unknown/deleted calendar → `-32602` with `data.uri`. Credential failure → `-32603` naming the Account. Never `contents: []`, never a fabricated snapshot.
- `resources/templates/list` → `[]`.

## Prompts

Static, no Provider calls, `cacheScope: "public"`.

| Name | Arguments |
| --- | --- |
| `plan_day` | `date?`, `account?` |
| `find_meeting_time` | `attendees` (required), `durationMinutes?`, `windowStart?`, `windowEnd?`, `account?` |
| `summarize_week` | `weekOf?`, `account?` |
| `triage_invites` | `account?` |

`account` omitted resolves to the Default Account only; if none exists, `prompts/get` returns `-32602` telling the caller to pass `account` or set a default.

## Caching

| Operation | `ttlMs` | `cacheScope` |
| --- | --- | --- |
| `server/discover`, `tools/list`, `prompts/list`, `prompts/get`, `resources/templates/list` | 3 600 000 | `public` |
| `resources/list` complete / partial | 300 000 / 0 | `private` |
| `resources/read` | 30 000 | `private` |

`tools/call` results are not cacheable. All pages of one list share the same scope. No HTTP caching headers.
