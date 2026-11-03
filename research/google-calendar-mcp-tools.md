# Google Calendar MCP — tool surface reference

Research for the first-party `calendar` MCP in `mcp-gateway`. Goal: mirror Google's
`calendarmcp.googleapis.com` tool surface exactly.

Captured **2026-11-03**. Server is **Developer Preview**, available only through the
Google Workspace Developer Preview Program [S1][S2].

---

## 0. How this was sourced (read this first)

Google's documentation does **not** publish per-tool input/output schemas. The MCP
reference page lists only a toolset table with nine tool names, and explicitly tells
you to call `tools/list` to get the specifications [S1]. The configuration guide
likewise lists tool names only and states that no parameter definitions are documented
[S2].

Consequently:

| Source | What it gave us | Status |
|---|---|---|
| [S1] MCP reference page | Endpoint, toolset name, nine tool names, `tools/list` curl example | Published |
| [S2] Configure MCP server guide | 3 OAuth scopes, setup steps, client requirements | Published |
| [S3] Live `tools/list` JSON-RPC | **All input schemas, output schemas, descriptions, annotations** | Observed |
| [S4]–[S12] Calendar API v3 REST reference | Underlying method mapping, per-method scopes | Published |

The live endpoint **answers `tools/list` without authentication** (HTTP 200, full
schemas). It **rejects `tools/call` without auth**: HTTP 401 with an in-band JSON-RPC
error, `"Request is missing required authentication credential..."` [S3]. So schemas are
authoritative and publicly readable; behavior/return values beyond the declared
`outputSchema` are not verifiable without a Workspace Developer Preview account.

The API discovery document is also gated:
`https://calendarmcp.googleapis.com/$discovery/rest?version=v1` → HTTP 403
`"Method doesn't allow unregistered callers"` [S3]. There is no public discovery
metadata for this API, so per-tool scope metadata does not exist anywhere.

**All schema tables below are transcribed from [S3] unless marked otherwise.** Every
"Scopes" subsection is an *inference* from the REST method's own scope table — Google
publishes no per-tool scope mapping for the MCP server. That distinction is load-bearing;
see §10.

---

## 1. Server facts

| Property | Value | Source |
|---|---|---|
| Global endpoint | `https://calendarmcp.googleapis.com/mcp/v1` | [S1] |
| Toolset | `/mcp/v1` — "Public toolset for Google Calendar MCP" | [S1] |
| Transport | Streamable HTTP | [S2] |
| Auth | OAuth 2.0; client must have **"Use this client for an AI-powered agent"** selected | [S2] |
| Tool count | 9 | [S1][S3] |
| Refresh tokens | Requires `access_type=offline` on the authorization request; `offline_access` alone is insufficient. Add `prompt=consent` to re-issue | [S2] |
| APIs to enable | `calendar-json.googleapis.com` **and** `calendarmcp.googleapis.com` | [S2] |
| Rate limits / quotas | **Not documented** | [S1][S2] |

Known client redirect URIs published in the guide: `https://antigravity.google/oauth-callback`
and `https://claude.ai/api/mcp/auth_callback` [S2].

---

## 2. Cross-cutting divergences from the raw API

These apply to the whole surface and are the things most likely to bite an
implementation that "just forwards to REST".

1. **camelCase JSON, snake_case prose.** Every tool's field names are camelCase
   (`startTime`, `eventType`, `addGoogleMeetUrl`), but the descriptions refer to the
   same fields in snake_case (`start_time`, `event_type`, `add_google_meet_url`,
   `override_reminders`, `conference_data.video_entry_point.uri`) [S3]. Any doc or
   generated reference must pick one. The wire format is camelCase.
2. **Time strings are offset-less by design.** `startTime`/`endTime` must be passed as
   local wall-clock with *no* UTC offset and *no* trailing `Z`; the offset is only
   included if the user themselves stated one, and a named time zone goes in the
   top-level `timeZone` field instead [S3]. This is the opposite of REST `timeMin`/
   `timeMax`, which *require* an RFC3339 offset [S4].
3. **`timeZone` is deliberately optional.** Every tool documents the same rule: only set
   it if the user explicitly names a zone; otherwise leave unset and the server resolves
   the user's zone automatically [S3].
4. **Notification defaults are inverted vs REST.** MCP `notificationLevel` defaults to
   `ALL` ("Default. Treated as `ALL`") [S3], while REST `sendUpdates` defaults to
   `none`/`false` [S7][S8][S9].
5. **No `move` tool.** `events.move` exists in REST [S11] but has no MCP counterpart in
   the nine-tool set [S1][S3].
6. **No sync/pagination surface beyond `pageToken`.** `syncToken`, `nextSyncToken`,
   `showDeleted`, `singleEvents`, `iCalUID`, `updatedMin`, `extendedProperties` are all
   absent from the MCP schemas [S3] though present in `events.list` [S4].
7. **Tool annotations are published** and should be mirrored: `readOnlyHint`,
   `destructiveHint`, `idempotentHint`, `openWorldHint`, plus a `title` per tool [S3].

---

## 3. Common output shapes

Declared via `outputSchema` on each tool [S3]. Six of the nine tools return the same
`Event` object; it is defined once here and referenced below.

### 3.1 `Event`

Returned by `get_event`, `create_event`, `update_event`, `delete_event`,
`respond_to_event`, and as the element type of `list_events.events[]` /
`search_events.events[]`.

| Field | Type | Notes (from schema description) |
|---|---|---|
| `id` | string | Unique identifier |
| `summary` | string | Title |
| `description` | string | May contain HTML |
| `location` | string | Location |
| `start` | DateOrDateTime | Start, inclusive; first instance for recurring events |
| `end` | DateOrDateTime | End, exclusive; first instance for recurring events |
| `originalStartTime` | DateOrDateTime | Original start of a recurring instance |
| `status` | string | `confirmed` (default) / `tentative` / `cancelled` |
| `eventType` | string | Same enum as input |
| `recurrence` | array\<string\> | `RRULE`/`EXRULE`/`RDATE`/`EXDATE`; omitted for single events |
| `recurringEventId` | string | Parent event ID for instances |
| `attendees` | array\<Attendee\> | See 3.3 |
| `organizer` | Principal | Also appears in `attendees` if attending |
| `creator` | Principal | Output only |
| `attachments` | array\<Attachment\> | `fileUrl` (required), `title` |
| `conferenceData` | EventConferenceData | See 3.5 |
| `conferenceUrl` | string | **Deprecated**; use `conferenceData.videoEntryPoint.uri` |
| `guestPermissions` | GuestPermissions | `guestsCanInviteOthers`, `guestsCanModify`, `guestsCanSeeGuests` |
| `overrideReminders` | array\<Reminder\> | `method` (`email`\|`popup`) + `minutes`; affects acting user's view only |
| `useDefaultReminders` | boolean | If false and no overrides, event has no reminders |
| `availability` | string | `AVAILABILITY_UNSPECIFIED` / `AVAILABILITY_BUSY` / `AVAILABILITY_FREE` |
| `visibility` | string | `default` / `public` / `private` |
| `transparency` | string | **Deprecated**; use `availability` |
| `colorId` | string | `'1'`–`'11'` palette entry, with named colours documented |
| `label` | Label | `backgroundColor` (required), `displayName` (max 50 chars), `id` |
| `workingLocationProperties` | WorkingLocationProperties | Only when `eventType` is `WORKING_LOCATION` |
| `htmlLink` | string | Absolute link to the event in the Calendar web UI |
| `created` | string | Output only, ISO 8601 |
| `updated` | string | Output only, ISO 8601 |

**Absent vs the REST `Events` resource [S12]:** `kind`, `etag`, `iCalUID`, `sequence`,
`hangoutLink`, `anyoneCanAddSelf`, `guestsCanInviteOthers`/`guestsCanModify`/
`guestsCanSeeGuests` (moved into `guestPermissions`), `reminders` (flattened into
`useDefaultReminders` + `overrideReminders`), `extendedProperties`, `source`, `gadget`,
`privateCopy`, `locked`, `attendeesOmitted`, `eventLabelId` (replaced by `label`),
`smartDefaultReminders`, `workingLocationProperties.timeZone` is present but read-only.

### 3.2 `DateOrDateTime`

"Set `date` or `dateTime`, but not both."

| Field | Type | Notes |
|---|---|---|
| `date` | string | ISO 8601 date at midnight UTC, e.g. `2019-11-20T00:00:00Z` |
| `dateTime` | string | ISO 8601 timestamp, e.g. `2019-11-20T08:19:06-07:00` |
| `timeZone` | string | Original IANA zone; returned `dateTime` may be in a different display zone |

### 3.3 `Attendee`

| Field | Type | Req | Notes |
|---|---|---|---|
| `email` | string | **yes** | Attendee's email |
| `displayName` | string | no | Name |
| `optionalAttendee` | boolean | no | Default `false` |
| `resource` | boolean | no | Room/resource; immutable, set only on add. Default `false` |
| `additionalGuests` | integer (int32) | no | Default `0` |
| `responseStatus` | string | no | `needsAction` / `declined` / `tentative` / `accepted` |
| `comment` | string | no | Output only in this schema; response comment |
| `id` | string | no | Output only; profile ID |
| `organizer` | boolean | no | Output only; default `false` |
| `self` | boolean | no | Output only; default `false` |

### 3.4 `Principal`

`displayName` (string), `email` (string), `self` (boolean, output only, default `false`).

### 3.5 `EventConferenceData`

`joiningNotesText` (string), `solutionName` (string), `videoEntryPoint` (EntryPoint),
`sipEntryPoint` (EntryPoint), `moreDetailsEntryPoint` (EntryPoint),
`phoneEntryPoints` (array\<PhoneEntryPoint\>).

- `EntryPoint`: `uri` (string), `codes` (array\<Code\>).
- `Code`: `codeType` (`CODE_TYPE_UNSPECIFIED`/`ACCESS_CODE`/`PASSCODE`/`PASSWORD`/`MEETING_CODE`/`PIN`), `value` (string).
- `PhoneEntryPoint`: `phoneNumber`, `regionCode`, `isTollNumber` (boolean), `codes` (array\<Code\>).

### 3.6 `Reminder`

`method` (string, **required**, `email`\|`popup`), `minutes` (integer, **required**, 0–40320 per REST).

---

## 4. `list_events`

> "Returns events on the given calendar matching all specified constraints. Time
> constraints should not be specified unless requested by the user. For open-ended
> keyword or topic-based searches on the primary calendar, the `search_events` tool must
> be used instead." [S3]

Annotations: readOnly ✓, idempotent ✓, destructive ✗, openWorld ✗.
Title: "Lists calendar events in a given calendar." [S3]

**Signature**
`list_events(calendarId?, startTime?, endTime?, fullText?, eventType[]?, eventTypeFilter[]?, orderBy?, pageSize?, pageToken?, timeZone?)`

**Input schema** — `"Request message for ListEvents."`; **no `required` array at all**,
so every field is optional [S3].

| Field | Type | Req | Default | Notes |
|---|---|---|---|---|
| `calendarId` | string | no | primary calendar | Email address; resolve via `list_calendars` |
| `startTime` | string | no | now | ISO 8601, < `endTime`; no offset, no `Z` |
| `endTime` | string | no | `startTime` + 7 days | ISO 8601, > `startTime`; same offset rules |
| `fullText` | string | no | — | Case-insensitive; matches title, description, location, attendees; **all terms, AND** |
| `eventType` | array\<enum\> | no | `DEFAULT`, `OUT_OF_OFFICE`, `FOCUS_TIME`, `FROM_GMAIL` | Enum: `EVENT_TYPE_UNSPECIFIED`, `DEFAULT`, `OUT_OF_OFFICE`, `FOCUS_TIME`, `WORKING_LOCATION`, `BIRTHDAY`, `FROM_GMAIL` |
| `eventTypeFilter` | array\<string\> | no | — | **Deprecated**: use `eventType` |
| `orderBy` | string | no | `default` | `default` / `startTime` / `startTimeDesc` / `lastModified` |
| `pageSize` | integer (int32) | no | `100` (max `250`) | Recommended: `10` |
| `pageToken` | string | no | — | From previous `nextPageToken` |
| `timeZone` | string | no | resolved by server | IANA ID |

**Output**

| Field | Type |
|---|---|
| `summary` | string |
| `description` | string |
| `updated` | string |
| `timeZone` | string |
| `accessRole` | string (`none`/`freeBusyReader`/`reader`/`writerWithoutPrivateAccess`/`writer`/`owner`) |
| `defaultReminders` | array\<Reminder\> |
| `events` | array\<Event\> |
| `nextPageToken` | string |

This is a trimmed `events.list` collection response: `kind`, `etag`, `nextSyncToken`
and `items` are gone, `items` renamed to `events` [S4].

**Underlying REST method:** `events.list` — `GET https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events` [S4].

**Field mapping** (inferred from semantics, not documented as a mapping): `calendarId`→path `calendarId`, `startTime`→`timeMin`, `endTime`→`timeMax`, `fullText`→`q`, `eventType`→`eventTypes`, `orderBy`→`orderBy`, `pageSize`→`maxResults`, `pageToken`→`pageToken`, `timeZone`→`timeZone`.

**Scopes.** REST method accepts `calendar.readonly`, `calendar`, `calendar.events.readonly`, `calendar.events`, `calendar.app.created`, `calendar.events.freebusy`, `calendar.events.owned`, `calendar.events.owned.readonly`, `calendar.events.public.readonly` [S4]. Of the documented MCP set, `calendar.events.readonly` covers it.

**Divergences from `events.list`:**
- `pageSize` default `100` / max `250` vs REST default `250` / max `2500` [S4].
- `orderBy` adds `startTimeDesc` and `lastModified`; REST only has `startTime` and `updated` [S4]. `startTimeDesc` has no REST equivalent at all. REST `startTime` ordering additionally requires `singleEvents=true`, which is not exposed here [S4].
- `startTime` is a "lower bound of a time range" with default *now*; REST `timeMin` is an exclusive lower bound on the event's **end** time with default *no filter* [S4]. Semantics differ at the boundary.
- `eventType` default is an explicit four-type set; REST `eventTypes` unset returns **all** types [S4]. So the MCP hides `WORKING_LOCATION` and `BIRTHDAY` unless asked for.
- No `singleEvents`, so recurring events are not expanded — behaviour under that mode is **not documented**.
- `fullText` matches attendees and does an AND over all terms; REST `q` is documented as free-text with a broader field list including organizer and working-location sub-fields [S4]. Whether `fullText` also matches organizer is **not documented**.

---

## 5. `get_event`

> "Returns a single event on the given calendar." [S3]

Annotations: readOnly ✓, idempotent ✓, destructive ✗, openWorld ✗.
Title: "Returns a single event on the specified calendar." [S3]

**Signature** `get_event(eventId, calendarId?)`

**Input schema** — `"Request message for GetEvent."`

| Field | Type | Req | Default | Notes |
|---|---|---|---|---|
| `eventId` | string | **yes** | — | Resolve via `list_events` or `search_events` |
| `calendarId` | string | no | primary calendar | Email address |

**Output:** a bare `Event` (§3.1) — not wrapped [S3].

**Underlying REST method:** `events.get` — `GET .../calendars/{calendarId}/events/{eventId}` [S5].

**Scopes.** REST accepts the same nine as `events.list` [S5]; `calendar.events.readonly` covers it.

**Divergences:** `maxAttendees`, `alwaysIncludeEmail` and `timeZone` (response zone) are not exposed [S5]. REST documents `timeZone` as "time zone used in the response" [S5]; the MCP tool has no such parameter, so the response zone is server-decided and **not documented**.

---

## 6. `list_calendars`

> "Returns the calendars this user owns or has subscribed to. These are the calendars
> that show up in the calendar list if the user opens Google Calendar. This tool returns
> a subset of all accessible calendars; other calendars shared with the user can be
> accessed directly by their `calendar_id` (email identifier) without subscribing to
> them first. Use this tool to resolve calendar identifying data (for example, 'my
> family calendar') into its corresponding `calendar_id`." [S3]

Annotations: readOnly ✓, idempotent ✓, destructive ✗, openWorld ✗.
Title: "Returns the calendars this user owns or has subscribed to (their calendar list)." [S3]

**Signature** `list_calendars(pageSize?, pageToken?)`

**Input schema** — `"Request message for ListCalendars."`

| Field | Type | Req | Default | Notes |
|---|---|---|---|---|
| `pageSize` | integer (int32) | no | `100` (max `250`) | Max results per page |
| `pageToken` | string | no | — | Token for the result page |

**Output**

| Field | Type |
|---|---|
| `calendars` | array\<CalendarListItem\> |
| `nextPageToken` | string |

`CalendarListItem` has exactly four fields [S3]:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Email address of the calendar (marked `x-google-identifier`) |
| `summary` | string | Output only; title |
| `description` | string | Output only |
| `timeZone` | string | Output only |

**Underlying REST method:** `calendarList.list` — `GET https://www.googleapis.com/calendar/v3/users/me/calendarList` [S6].

**Scopes.** REST accepts `calendar.readonly`, `calendar`, `calendar.calendarlist`, `calendar.calendarlist.readonly` [S6]. Of the documented MCP set, `calendar.calendarlist.readonly` covers it — and is the *only* one of the three that does.

**Divergences:**
- `pageSize` default 100 / max 250 matches REST `maxResults` exactly [S6].
- `minAccessRole`, `showDeleted`, `showHidden`, `showOwnOrganizationOnly`, `syncToken` are all dropped [S6].
- The response is dramatically narrower than `CalendarListEntry`: no `accessRole`, `primary`, `selected`, `hidden`, `backgroundColor`, `foregroundColor`, `colorId`, `defaultReminders`, `conferenceProperties`, `notificationSettings`, `summaryOverride`, `location`, `deleted` [S6]. An agent cannot tell which calendar is `primary` from this response — it must rely on the implicit "default: primary calendar" convention.
- The tool description explicitly frames the result as a *subset* of accessible calendars [S3], which is a documented divergence in behaviour from the REST method's contract.

---

## 7. `suggest_time`

> "Suggests time periods across one or more calendars." [S3]

Annotations: readOnly ✓, idempotent ✓, destructive ✗, openWorld ✗.
Title: "Suggests time periods across one or more calendars." [S3]

**Signature** `suggest_time(attendeeEmails[], startTime, endTime, durationMinutes?, timeZone?, preferences?)`

**Input schema** — `"Request message for SuggestTime."`

| Field | Type | Req | Default | Notes |
|---|---|---|---|---|
| `attendeeEmails` | array\<string\> | **yes** | — | Attendee emails to find free time for |
| `startTime` | string | **yes** | — | Query interval start, ISO 8601; no offset, no `Z` |
| `endTime` | string | **yes** | — | Query interval end, ISO 8601; same rules as `startTime` |
| `durationMinutes` | integer (int32) | no | `30` | Min duration of a free slot |
| `timeZone` | string | no | resolved by server | IANA ID the search times are interpreted in |
| `preferences` | `Preferences` | no | — | See below |

`Preferences` [S3]:

| Field | Type | Req | Default | Notes |
|---|---|---|---|---|
| `startHour` | string | no | — | `"HH:mm"`, 24-hour |
| `endHour` | string | no | — | `"HH:mm"`, 24-hour |
| `excludeWeekends` | boolean | no | — | Exclude weekends |
| `pageSize` | integer (int32) | no | `5` | Max number of **slots** to return |

**Output**

| Field | Type |
|---|---|
| `timeSlots` | array\<TimeSlot\> |

`TimeSlot` [S3]:

| Field | Type | Notes |
|---|---|---|
| `start` | DateOrDateTime | Start of the slot |
| `end` | DateOrDateTime | End of the slot |
| `startTime` | string | **Deprecated**: use `start` |
| `endTime` | string | **Deprecated**: use `end` |
| `durationMinutes` | integer | **Deprecated**: compute from `start`/`end` |

**Underlying REST method:** `freebusy.query` — `POST https://www.googleapis.com/calendar/v3/freeBusy` [S10]. This is a **composite** mapping, not a thin wrapper.

**Scopes.** REST accepts `calendar.readonly`, `calendar`, `calendar.events.freebusy`, `calendar.freebusy` [S10]. Of the documented MCP set, `calendar.events.freebusy` covers it.

**Divergences:**
- `freebusy.query` returns *busy* intervals keyed by calendar; `suggest_time` returns *free* slots. The inversion, slot selection and ranking algorithm are **not documented**.
- `durationMinutes` (default 30) and all of `preferences` have **no REST equivalent** — `freeBusy` has no slot length, working-hours window, weekend filter or slot-count parameter [S10].
- `pageSize` here means number of **slots** (default 5), while `pageSize` on every other tool means page size — an overloaded name worth mirroring carefully.
- `freeBusy` requires an RFC3339 offset in `timeMin`/`timeMax` [S10]; `suggest_time` requires the opposite (§2.2).
- `groupExpansionMax`, `calendarExpansionMax` are not exposed [S10].
- `attendeeEmails` is a flat string array, whereas `freeBusy` takes `items[].id` [S10] — so groups and resource calendars presumably cannot be targeted, though this is **not documented**.

---

## 8. `create_event`

> "Creates an event on the given calendar." [S3]

Annotations: readOnly ✗, destructive ✗, idempotent ✗, openWorld ✗.
Title: "Creates a calendar event." [S3]

**Signature**
`create_event(summary, startTime, endTime, calendarId?, allDay?, addGoogleMeetUrl?, googleMeetUrl?, attendees[]?, attendeeEmails[]?, attachments[]?, availability?, colorId?, description?, eventType?, guestPermissions?, location?, notificationLevel?, overrideReminders[]?, recurrenceData[]?, timeZone?, useDefaultReminders?, visibility?, workingLocationProperties?)`

**Input schema** — `"Request message for CreateEvent."`

| Field | Type | Req | Default | Notes |
|---|---|---|---|---|
| `summary` | string | **yes** | — | Title |
| `startTime` | string | **yes** | — | ISO 8601; no offset, no `Z` |
| `endTime` | string | **yes** | — | ISO 8601; same rules |
| `calendarId` | string | no | primary calendar | Target calendar |
| `allDay` | boolean | no | — | If true, start/end are treated as midnight |
| `addGoogleMeetUrl` | boolean | no | `false` | Create and add a Meet URL |
| `googleMeetUrl` | string | no | — | Specific Meet URL/ID; **overrides `addGoogleMeetUrl`** |
| `attendees` | array\<Attendee\> | no | — | On the primary calendar with ≥1 other attendee, the user is auto-added if absent |
| `attendeeEmails` | array\<string\> | no | — | **Deprecated**: use `attendees` |
| `attachments` | array\<Attachment\> | no | — | `fileUrl` required, `title` optional |
| `availability` | string | no | `AVAILABILITY_UNSPECIFIED` → treated as `BUSY` | `AVAILABILITY_BUSY` / `AVAILABILITY_FREE` |
| `colorId` | string | no | — | Event colour ID per the Event resource |
| `description` | string | no | — | May contain HTML |
| `eventType` | string | no | — | Same 7-value enum; `FROM_GMAIL` cannot be created |
| `guestPermissions` | GuestPermissions | no | — | `guestsCanInviteOthers`, `guestsCanModify`, `guestsCanSeeGuests` |
| `location` | string | no | — | Location |
| `notificationLevel` | string | no | `ALL` | `NOTIFICATION_LEVEL_UNSPECIFIED` / `NONE` / `EXTERNAL_ONLY` / `ALL` |
| `overrideReminders` | array\<Reminder\> | no | — | Overrides calendar defaults |
| `recurrenceData` | array\<string\> | no | — | `RRULE`, `RDATE`, `EXDATE` per RFC 5545 |
| `timeZone` | string | no | resolved by server | IANA ID |
| `useDefaultReminders` | boolean | no | `false` if `overrideReminders` set, else `true` | Cannot be `true` together with `overrideReminders` |
| `visibility` | string | no | `default` | `default` / `public` / `private` |
| `workingLocationProperties` | WorkingLocationProperties | no | — | Used when `eventType` is `WORKING_LOCATION` |

`WorkingLocationProperties` [S3]: `type` (`WORKING_LOCATION_TYPE_UNSPECIFIED`→treated as `HOME_OFFICE`, `HOME_OFFICE`, `CUSTOM_LOCATION`, `OFFICE_LOCATION`), `customLocationLabel` (required if type is `CUSTOM_LOCATION`, mutually exclusive with `officeLocation`), `officeLocation` (`buildingId`, `deskId`, `floorId`, `floorSectionId`, `label`), `timeZone` (output only).

**Output:** `Event` (§3.1) [S3].

**Underlying REST method:** `events.insert` — `POST .../calendars/{calendarId}/events` [S7].

**Scopes.** REST accepts `calendar`, `calendar.events`, `calendar.app.created`, `calendar.events.owned` [S7]. **None of the three documented MCP scopes appear in this list** — see §10.

**Divergences:**
- `summary` + `startTime` + `endTime` are required, vs REST which requires a full `start`/`end` resource [S7]. Flattening start/end into two strings plus `timeZone` is an MCP-only convenience.
- `allDay` has no REST field; presumably maps to `start.date`/`end.date`, but the mapping is **not documented**.
- `addGoogleMeetUrl` / `googleMeetUrl` have no REST field — REST needs `conferenceData.createRequest` **and** `conferenceDataVersion=1` [S7], and `conferenceDataVersion` is not exposed at all. How the MCP enables conferences is **not documented**.
- `availability` vs REST `transparency` (`opaque`/`transparent`): an enum rename and a value-set change [S12].
- `notificationLevel` default `ALL` vs REST `sendUpdates` default `false`/`none` [S7]. The string values also differ in case (`EXTERNAL_ONLY` vs `externalOnly`).
- `recurrenceData` vs REST `recurrence` — field rename [S12].
- `useDefaultReminders` + `overrideReminders` replace the nested `reminders` object, with an explicit mutual-exclusion rule that REST does not state [S12].
- `attendeeEmails` is deprecated in favour of `attendees`; REST has no such deprecated alias [S7].
- `eventType` accepts `BIRTHDAY` and `FROM_GMAIL` in the enum but the schema says `FROM_GMAIL` cannot be created; REST also forbids creating `birthday` [S12]. `BIRTHDAY` handling is **not documented**.

---

## 9. `update_event`

> "Updates an event on the given calendar." [S3]

Annotations: readOnly ✗, destructive ✗, idempotent ✓, openWorld ✗.
Title: "Updates a calendar event." [S3]

Schema description: `"Request message for UpdateEvent. Fields that are not set will not be updated."` [S3]

**Signature**
`update_event(eventId, calendarId?, summary?, description?, location?, startTime?, endTime?, allDay?, timeZone?, addedAttendees[]?, addedAttendeeEmails[]?, removedAttendeeEmails[]?, addedAttachments[]?, removedAttachmentFileUrls[]?, availability?, colorId?, guestPermissions?, notificationLevel?, overrideReminders[]?, useDefaultReminders?, visibility?, addGoogleMeetUrl?, googleMeetUrl?)`

Note: there is no `eventType` input — an event's type cannot be changed by this tool.

**Input schema** — only `eventId` is required.

| Field | Type | Req | Default | Notes |
|---|---|---|---|---|
| `eventId` | string | **yes** | — | Event to update |
| `calendarId` | string | no | primary calendar | Calendar containing the event |
| `summary` | string | no | — | New title |
| `description` | string | no | — | New description, may contain HTML |
| `location` | string | no | — | New location |
| `startTime` | string | no | — | New start; **preserves duration if only start is updated** |
| `endTime` | string | no | — | New end |
| `allDay` | boolean | no | — | Changes to all-day; if set, `startTime`/`endTime` must also be provided |
| `timeZone` | string | no | resolved by server | IANA ID |
| `addedAttendees` | array\<Attendee\> | no | — | Attendees to add |
| `addedAttendeeEmails` | array\<string\> | no | — | **Deprecated**: use `addedAttendees` |
| `removedAttendeeEmails` | array\<string\> | no | — | Attendees to remove, by email |
| `addedAttachments` | array\<Attachment\> | no | — | Attachments to add |
| `removedAttachmentFileUrls` | array\<string\> | no | — | Attachments to remove, by URL |
| `availability` | string | no | — | Whether the event blocks time |
| `colorId` | string | no | — | New colour |
| `guestPermissions` | GuestPermissions | no | — | Guest permission settings |
| `notificationLevel` | string | no | `ALL` | Notification to send |
| `overrideReminders` | array\<Reminder\> | no | — | **Replaces all** existing reminders |
| `useDefaultReminders` | boolean | no | — | `true` clears overrides; `false` with empty overrides removes all reminders |
| `visibility` | string | no | `default` | `default` / `public` / `private` |
| `addGoogleMeetUrl` | boolean | no | — | Creates/updates a Meet URL; ignored if Meet is disabled |
| `googleMeetUrl` | string | no | — | Attach existing Meet URL; overrides `addGoogleMeetUrl` |

**Output:** `Event` (§3.1) [S3].

**Underlying REST method:** `events.patch` — `PATCH .../calendars/{calendarId}/events/{eventId}` [S8].

**Scopes.** REST accepts `calendar`, `calendar.events`, `calendar.app.created`, `calendar.events.owned` [S8]. Again, **none of the documented MCP scopes apply** — see §10.

**Divergences:**
- `events.patch` overwrites array fields wholesale — "Array fields, if specified, overwrite the existing arrays; this discards any previous array elements" [S8]. The MCP schema replaces this with explicit `added*` / `removed*` deltas, implying a read-modify-write. That is a genuine semantic change and the mechanism is **not documented**.
- "Preserves duration if updating only start" is a computed behaviour with no REST equivalent [S8].
- `events.patch` costs 3 quota units and Google recommends `get` + `update` instead [S8]; whether the MCP does this is **not documented**.
- `useDefaultReminders` / `overrideReminders` replace the nested `reminders` object with stated mutual-exclusion semantics that REST does not define [S12].
- `notificationLevel` default `ALL` vs `sendUpdates` default `none` [S8].
- `allDay` requires `startTime`/`endTime` alongside it — a constraint with no REST analogue [S8].
- No `eventType` field, so an event's type cannot be changed. REST does not document type mutation either, so this is consistent-by-omission rather than a documented decision.
- `conferenceDataVersion`, `eventLabelVersion`, `supportsAttachments`, `maxAttendees` are not exposed [S8].

---

## 10. `delete_event`

> "Deletes an event on the given calendar." [S3]

Annotations: readOnly ✗, **destructive ✓**, idempotent ✓, openWorld ✗.
Title: "Deletes a calendar event." [S3]

**Signature** `delete_event(eventId, calendarId?, notificationLevel?)`

**Input schema** — `"Request message for DeleteEvent."`

| Field | Type | Req | Default | Notes |
|---|---|---|---|---|
| `eventId` | string | **yes** | — | ID of the event to delete |
| `calendarId` | string | no | primary calendar | Calendar containing the event |
| `notificationLevel` | string | no | `ALL` | `NOTIFICATION_LEVEL_UNSPECIFIED` / `NONE` / `EXTERNAL_ONLY` / `ALL` |

**Output:** the full `Event` object (§3.1) — the same schema as `get_event` [S3].

**Underlying REST method:** `events.delete` — `DELETE .../calendars/{calendarId}/events/{eventId}` [S9].

**Scopes.** REST accepts `calendar`, `calendar.events`, `calendar.app.created`, `calendar.events.owned` [S9]. Documented MCP scopes do not cover it.

**Divergences:**
- **Biggest one in the set:** `events.delete` "returns an empty response body" [S9], but `delete_event` declares a full `Event` output. The tool must `get` before deleting (or synthesise from cache). Mechanism **not documented**.
- `notificationLevel` default `ALL` vs REST `sendUpdates` default `none` [S9]. A default `ALL` means a naive delete sends cancellation mail to every guest.
- Only three fields, so deletion of a whole recurring series vs a single instance is not expressible. REST has no separate flag either, but MCP also drops the ability to target an instance by `originalStartTime` — behaviour **not documented**.

---

## 11. `respond_to_event`

> "Responds to an event on a calendar." [S3]

Annotations: readOnly ✗, destructive ✗, idempotent ✓, openWorld ✗.
Title: "Responds to an event." [S3]

**Signature** `respond_to_event(eventId, responseStatus, calendarId?, notificationLevel?, responseComment?)`

**Input schema** — `"Request message for RespondToEvent."`

| Field | Type | Req | Default | Notes |
|---|---|---|---|---|
| `eventId` | string | **yes** | — | Event to respond to |
| `responseStatus` | string | **yes** | — | `declined` / `tentative` / `accepted` — **`needsAction` is not listed** |
| `calendarId` | string | no | primary calendar | Calendar containing the event |
| `notificationLevel` | string | no | `ALL` | Notification to send |
| `responseComment` | string | no | — | User's comment attached to the response |

**Output:** `Event` (§3.1) [S3].

**Underlying REST method:** **none — there is no dedicated RSVP method.** The Calendar API v3 `Events` method list is `delete`, `get`, `import`, `insert`, `instances`, `list`, `move`, `patch`, `quickAdd`, `update`, `watch`; there is no `respond`/`rsvp` [S12].

The canonical REST mechanism is `events.patch` (or `get` + `update`) with `attendeesOmitted=true` and a single `attendees[]` entry for the current user carrying `responseStatus` and `comment` — `attendeesOmitted` exists precisely to "only update the participant's response" [S12]. Both fields are writable [S12].

**Scopes.** No REST method to inherit from; `events.patch` requires `calendar`, `calendar.events`, `calendar.app.created` or `calendar.events.owned` [S8]. Documented MCP scopes do not cover it.

**Divergences:**
- `respond_to_event` is a **purpose-built tool with no REST counterpart** — the single largest structural divergence in the surface. It must be implemented as a targeted patch, and how the server identifies "self" is **not documented**.
- `responseStatus` deliberately excludes `needsAction`, which is a valid REST value [S12] — you cannot un-RSVP.
- `responseComment` maps to `attendees[].comment`, which is writable in REST [S12] but declared `readOnly` in the MCP `Attendee` *output* schema [S3]. Input/output asymmetry to mirror.
- REST warns that responses may be reset to `needsAction` for certain "Add invitations to my calendar" settings, and that response status is not propagated above 200 guests [S12]. Whether the MCP tool surfaces these caveats is **not documented**.

---

## 12. `search_events`

> "Searches events on the user's primary calendar using semantic search." [S3]

Annotations: readOnly ✓, idempotent ✓, destructive ✗, openWorld ✗.
Title: `"Searches for events on the user's primary calendar.\n."` [S3] (note the stray newline and period — verbatim).

**Signature** `search_events(query, pageSize?, pageToken?)`

**Input schema** — `"Request message for SearchEvents."`

| Field | Type | Req | Default | Notes |
|---|---|---|---|---|
| `query` | string | **yes** | — | Query string, case-insensitive |
| `pageSize` | integer (int32) | no | — | Max entries per page — **no default or max documented** |
| `pageToken` | string | no | — | Token for the result page |

**Output**

| Field | Type |
|---|---|
| `events` | array\<Event\> |
| `nextPageToken` | string |

No calendar metadata wrapper, unlike `list_events` [S3].

**Underlying REST method:** **none.** Semantic search over the primary calendar has no
equivalent in Calendar API v3. The nearest REST method is `events.list` with `q`
[S4], but `q` is documented as literal free-text matching over named fields, not
semantic similarity, and `events.list` requires an explicit `calendarId` path segment
[S4].

**Scopes.** Not derivable. If implemented over `events.list` + `q`, it would need one of
the nine read scopes on that method [S4]; if it uses a separate semantic index, the
scope is **not documented** anywhere.

**Divergences:**
- Primary calendar only — there is **no `calendarId` parameter**, unlike every other
  read tool [S3].
- No time filtering at all: no `startTime`, `endTime`, `timeZone`, `eventType`,
  `orderBy` [S3].
- `pageSize` has no documented default or maximum, unlike the `100`/`250` pair
  everywhere else [S3].
- "Semantic search" implies a ranking model; the ranking, index freshness and whether
  results are relevance- or time-ordered are **not documented**.
- This is the tool that `list_events`'s description points users to for "open-ended
  keyword or topic-based searches on the primary calendar" [S3], so the two must not
  overlap in implementation.

---

## 13. Scope set

### 13.1 What Google publishes

The configuration guide instructs developers to manually add **exactly three** scopes [S2]:

```
https://www.googleapis.com/auth/calendar.calendarlist.readonly
https://www.googleapis.com/auth/calendar.events.freebusy
https://www.googleapis.com/auth/calendar.events.readonly
```

All three are read-only or free/busy. There is **no write scope anywhere on the page**,
and no statement that scopes are granted at runtime [S2].

### 13.2 The contradiction

The same guide advertises "Take action: Create, update, and delete events" and lists
`create_event`, `update_event`, `delete_event`, `respond_to_event` [S2]. The underlying
REST methods for those four accept only:

```
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/calendar.app.created
https://www.googleapis.com/auth/calendar.events.owned
```

[S7][S8][S9] — **none of which is in the documented MCP scope set.** A token carrying
only the three published scopes cannot authorize `events.insert`, `events.patch` or
`events.delete`. Either the guide is incomplete, or write access is obtained by a
mechanism that is **not documented**. Do not assume the published three are sufficient.

### 13.3 Minimal coherent set (inference — not published)

If we need all nine tools against REST:

| Scope | Covers | Source |
|---|---|---|
| `calendar.events` | `events.list`, `events.get`, `events.insert`, `events.patch`, `events.delete` (read+write events) | [S4][S5][S7][S8][S9] |
| `calendar.calendarlist.readonly` | `calendarList.list` | [S6] |
| `calendar.events.freebusy` | `freebusy.query` | [S10] |

Alternatively `https://www.googleapis.com/auth/calendar` alone covers every method above
plus `events.move` [S4]–[S11], at the cost of full-calendar consent.

Note that `calendar.events` is *not* accepted by `calendarList.list` [S6] and
`calendar.events.freebusy` is *not* accepted by the event methods [S4][S5], so a
three-scope combination is genuinely needed unless we take the blanket `calendar` scope.

### 13.4 Unresolved scope questions

- Per-tool scope mapping: **not documented**. Google publishes one toolset, not
  per-tool requirements [S1].
- `search_events` scope: **not documented** (no REST equivalent).
- Whether the MCP server requests scopes incrementally or up-front: the guide frames it
  as manual, up-front configuration [S2]; incremental authorization is **not documented**.
- Quotas / rate limits per scope: **not documented** [S1][S2].

---

## 14. Gaps to flag before implementing

1. **Schemas are only available from the live endpoint.** There is no versioned,
   citable document for them. Pin the capture date (2026-11-03) and re-run `tools/list`
   before freezing our surface.
2. **Write scopes are undocumented.** This is the one item that can block the whole
   project. Resolve against a real Developer Preview project before designing consent.
3. **`search_events` cannot be implemented by forwarding to REST.** It needs either a
   semantic index or an accepted behavioural downgrade to `events.list?q=`. That is a
   product decision, not an implementation detail.
4. **`respond_to_event` and `delete_event` both deviate structurally** from the REST
   methods they sit on (no RSVP method; delete returning a full event). Both need
   read-before-write.
5. **`notificationLevel` defaulting to `ALL`** across create/update/delete/respond is
   the highest-risk behavioural difference from REST: it will email guests by default.
6. **Time handling is inverted from REST** (offset-less input, server-resolved zone).
   Getting this wrong is a silent correctness bug, not an error.
7. **No `move`, no sync tokens, no `singleEvents`, no recurrence expansion control.**
   Confirm these omissions are acceptable for our gateway.

---

## Sources

| Ref | URL |
|---|---|
| S1 | https://developers.google.com/workspace/calendar/api/v3/reference/mcp |
| S2 | https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server |
| S3 | `POST https://calendarmcp.googleapis.com/mcp/v1` with `{"method":"tools/list","jsonrpc":"2.0","id":1}`, captured 2026-11-03 (unauthenticated; 9 tools; `tools/call` returns HTTP 401) |
| S4 | https://developers.google.com/workspace/calendar/api/v3/reference/events/list |
| S5 | https://developers.google.com/workspace/calendar/api/v3/reference/events/get |
| S6 | https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list |
| S7 | https://developers.google.com/workspace/calendar/api/v3/reference/events/insert |
| S8 | https://developers.google.com/workspace/calendar/api/v3/reference/events/patch |
| S9 | https://developers.google.com/workspace/calendar/api/v3/reference/events/delete |
| S10 | https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query |
| S11 | https://developers.google.com/workspace/calendar/api/v3/reference/events/move |
| S12 | https://developers.google.com/workspace/calendar/api/v3/reference/events |
