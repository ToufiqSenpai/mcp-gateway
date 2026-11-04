import { REQUIRED_SCOPES as CALENDAR_SCOPES } from "@mcp-gateway/calendar"
import { REQUIRED_SCOPES as NOTES_SCOPES } from "@mcp-gateway/notes"

/**
 * Provider and Access endpoints are faked below the SDK at their real URLs. The Worker's
 * `fetch` is replaced for the test isolate, so `arctic`, the identity fetch and `jose` all
 * take the same path they take in production; nothing is stubbed at an SDK seam.
 */
export const ACCESS_TEAM_DOMAIN = "https://test.cloudflareaccess.com"

/** One code per behaviour a test needs to force. */
export const CODE = {
  googleOk: "google-code-ok",
  googleSecond: "google-code-second",
  googleNoRefresh: "google-code-norefresh",
  googleNarrow: "google-code-narrow",
  googleDenied: "google-code-denied",
  microsoftOk: "microsoft-code-ok",
  microsoftSecond: "microsoft-code-second"
} as const

export const REFRESH_TOKEN = {
  googleOk: "1//refresh-one",
  googleSecond: "1//refresh-two",
  microsoftOk: "microsoft-refresh-one",
  microsoftSecond: "microsoft-refresh-two",
  /** Presence of these forces one facet of the refresh behaviour. */
  invalid: "refresh-invalid",
  serverError: "refresh-server-error",
  narrowScope: "refresh-narrow-scope",
  noScope: "refresh-no-scope"
} as const

/** Counters for concurrency assertions; reset with `resetProviderCounters()`. */
export const counters = {
  googleTokenRequests: 0,
  googleRefreshRequests: 0,
  microsoftRefreshRequests: 0,
  googleCalendarListRequests: 0
}

export function resetProviderCounters(): void {
  counters.googleTokenRequests = 0
  counters.googleRefreshRequests = 0
  counters.microsoftRefreshRequests = 0
  counters.googleCalendarListRequests = 0
}

export const ACCESS_TOKEN = {
  googleOk: "ya29.access-one",
  googleSecond: "ya29.access-two",
  microsoftOk: "graph.access-one",
  microsoftSecond: "graph.access-two"
} as const

interface Identity {
  subject: string
  email: string
  name: string
  accessToken: string
  refreshToken: string
  scopes: string[]
}

const GOOGLE_IDENTITIES = new Map<string, Identity>([
  [
    ACCESS_TOKEN.googleOk,
    {
      subject: "google-subject-1",
      email: "operator@example.com",
      name: "Operator One",
      accessToken: ACCESS_TOKEN.googleOk,
      refreshToken: REFRESH_TOKEN.googleOk,
      scopes: [...CALENDAR_SCOPES]
    }
  ],
  [
    ACCESS_TOKEN.googleSecond,
    {
      subject: "google-subject-2",
      email: "second@example.com",
      name: "Operator Two",
      accessToken: ACCESS_TOKEN.googleSecond,
      refreshToken: REFRESH_TOKEN.googleSecond,
      scopes: [...CALENDAR_SCOPES]
    }
  ]
])

const MICROSOFT_IDENTITIES = new Map<string, Identity>([
  [
    ACCESS_TOKEN.microsoftOk,
    {
      subject: "microsoft-subject-1",
      email: "operator@example.com",
      name: "Operator One",
      accessToken: ACCESS_TOKEN.microsoftOk,
      refreshToken: REFRESH_TOKEN.microsoftOk,
      scopes: [...NOTES_SCOPES]
    }
  ],
  [
    ACCESS_TOKEN.microsoftSecond,
    {
      subject: "microsoft-subject-2",
      email: "second@example.com",
      name: "Operator Two",
      accessToken: ACCESS_TOKEN.microsoftSecond,
      refreshToken: REFRESH_TOKEN.microsoftSecond,
      scopes: [...NOTES_SCOPES]
    }
  ]
])

/** Fixtures address identities by a token the test already knows exists. */
function fixtureIdentity(table: Map<string, Identity>, token: string): Identity {
  const identity = table.get(token)
  if (!identity) throw new Error(`No fixture identity for token ${token}`)
  return identity
}

function byCode(code: string | null): Identity | undefined {
  switch (code) {
    case CODE.googleOk:
      return GOOGLE_IDENTITIES.get(ACCESS_TOKEN.googleOk)
    case CODE.googleSecond:
      return GOOGLE_IDENTITIES.get(ACCESS_TOKEN.googleSecond)
    case CODE.microsoftOk:
      return MICROSOFT_IDENTITIES.get(ACCESS_TOKEN.microsoftOk)
    case CODE.microsoftSecond:
      return MICROSOFT_IDENTITIES.get(ACCESS_TOKEN.microsoftSecond)
    default:
      return undefined
  }
}

/** Fixture responses are always JSON-serialisable; each router branch builds its own body. */
function json<T extends object>(status: number, body: T): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  })
}

function tokenResponse(identity: Identity, refreshToken: string | null): Response {
  const body = {
    access_token: identity.accessToken,
    expires_in: 3600,
    token_type: "Bearer",
    scope: identity.scopes.join(" ")
  }
  return json(200, refreshToken ? { ...body, refresh_token: refreshToken } : body)
}

function exchangeGoogle(body: URLSearchParams): Response {
  const code = body.get("code")
  if (code === CODE.googleDenied) {
    return json(400, { error: "invalid_grant", error_description: "The code was rejected." })
  }
  if (code === CODE.googleNoRefresh) {
    return tokenResponse(fixtureIdentity(GOOGLE_IDENTITIES, ACCESS_TOKEN.googleOk), null)
  }
  if (code === CODE.googleNarrow) {
    const identity = fixtureIdentity(GOOGLE_IDENTITIES, ACCESS_TOKEN.googleOk)
    return json(200, {
      access_token: identity.accessToken,
      refresh_token: identity.refreshToken,
      expires_in: 3600,
      token_type: "Bearer",
      scope: "openid email"
    })
  }

  const identity = byCode(code)
  if (!identity) return json(400, { error: "invalid_grant" })
  return tokenResponse(identity, identity.refreshToken)
}

function exchangeMicrosoft(body: URLSearchParams): Response {
  const code = body.get("code")
  if (code === CODE.microsoftOk) {
    const identity = fixtureIdentity(MICROSOFT_IDENTITIES, ACCESS_TOKEN.microsoftOk)
    return tokenResponse(identity, identity.refreshToken)
  }
  if (code === CODE.microsoftSecond) {
    const identity = fixtureIdentity(MICROSOFT_IDENTITIES, ACCESS_TOKEN.microsoftSecond)
    return tokenResponse(identity, identity.refreshToken)
  }
  return json(400, { error: "invalid_grant" })
}

function refresh(body: URLSearchParams, microsoftProvider: boolean): Response {
  const refreshToken = body.get("refresh_token") ?? ""
  if (microsoftProvider) counters.microsoftRefreshRequests += 1
  else counters.googleRefreshRequests += 1

  if (refreshToken === REFRESH_TOKEN.invalid) {
    return json(400, { error: "invalid_grant", error_description: "Revoked." })
  }
  if (refreshToken === REFRESH_TOKEN.serverError) {
    return json(503, { error: "temporarily_unavailable" })
  }

  const table = microsoftProvider ? MICROSOFT_IDENTITIES : GOOGLE_IDENTITIES
  const identity =
    [...table.values()].find(entry => entry.refreshToken === refreshToken) ??
    (microsoftProvider
      ? MICROSOFT_IDENTITIES.get(ACCESS_TOKEN.microsoftOk)
      : GOOGLE_IDENTITIES.get(ACCESS_TOKEN.googleOk))
  if (!identity) return json(400, { error: "invalid_grant" })

  const rotatedRefreshToken = refreshToken.startsWith("refresh-")
    ? `${refreshToken}-rotated`
    : `${identity.refreshToken}-rotated`

  if (refreshToken === REFRESH_TOKEN.noScope) {
    return json(200, {
      access_token: identity.accessToken,
      refresh_token: rotatedRefreshToken,
      expires_in: 3600,
      token_type: "Bearer"
    })
  }

  return json(200, {
    access_token: identity.accessToken,
    refresh_token: rotatedRefreshToken,
    expires_in: 3600,
    token_type: "Bearer",
    scope: refreshToken === REFRESH_TOKEN.narrowScope ? "openid email" : identity.scopes.join(" ")
  })
}

function userinfo(accessToken: string): Response {
  const identity = GOOGLE_IDENTITIES.get(accessToken)
  if (!identity) return json(401, { error: "invalid_token" })
  return json(200, { sub: identity.subject, email: identity.email, name: identity.name })
}

function graphMe(accessToken: string): Response {
  const identity = MICROSOFT_IDENTITIES.get(accessToken)
  if (!identity) return json(401, { error: { code: "InvalidAuthenticationToken", message: "no" } })
  return json(200, {
    id: identity.subject,
    mail: identity.email,
    userPrincipalName: identity.email,
    displayName: identity.name
  })
}

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const raw = await request.clone().arrayBuffer()
  const body = new URLSearchParams(new TextDecoder().decode(raw))
  const authorization = request.headers.get("Authorization") ?? ""
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""

  switch (url.origin) {
    case "https://oauth2.googleapis.com":
      if (url.pathname === "/token" && request.method === "POST") {
        counters.googleTokenRequests += 1
        return body.get("grant_type") === "refresh_token" ? refresh(body, false) : exchangeGoogle(body)
      }
      if (url.pathname === "/revoke") return json(200, {})
      return json(404, { error: "not_found" })

    case "https://openidconnect.googleapis.com":
      if (url.pathname === "/v1/userinfo") return userinfo(bearer)
      return json(404, { error: "not_found" })

    case "https://login.microsoftonline.com":
      if (url.pathname.endsWith("/oauth2/v2.0/token") && request.method === "POST") {
        return body.get("grant_type") === "refresh_token" ? refresh(body, true) : exchangeMicrosoft(body)
      }
      return json(404, { error: "not_found" })

    case "https://graph.microsoft.com":
      if (url.pathname === "/v1.0/me") return graphMe(bearer)
      return json(404, { error: { code: "itemNotFound", message: "not found" } })

    case "https://www.googleapis.com": {
      if (url.pathname === "/calendar/v3/users/me/calendarList") {
        counters.googleCalendarListRequests += 1
        return json(200, {
          items: [
            { id: "primary", summary: "Primary", timeZone: "UTC" },
            { id: "team@example.com", summary: "Team", timeZone: "UTC" }
          ]
        })
      }
      if (url.pathname.startsWith("/calendar/v3/users/me/calendarList/")) {
        const id = decodeURIComponent(url.pathname.slice("/calendar/v3/users/me/calendarList/".length))
        if (id === "primary" || id === "team@example.com") {
          return json(200, { id, summary: id === "primary" ? "Primary" : "Team", timeZone: "UTC" })
        }
        return json(404, { error: { code: 404, message: "Not Found" } })
      }
      if (url.pathname.includes("/events")) {
        return json(200, {
          summary: "Primary",
          timeZone: "UTC",
          accessRole: "owner",
          defaultReminders: [],
          items: [
            {
              id: "event-1",
              summary: "Standup",
              start: { dateTime: "2026-11-05T09:00:00Z" },
              end: { dateTime: "2026-11-05T09:15:00Z" }
            }
          ]
        })
      }
      return json(404, { error: { code: 404, message: "not found" } })
    }

    default:
      return json(599, { error: "unmocked_outbound_request", url: request.url })
  }
}

let installed = false

/**
 * Replaces the isolate's `fetch` with the router above. The Access JWKS is served from the
 * same place so `jose` never reaches the network.
 */
export function installFetchRouter(accessJwks: () => Promise<JsonWebKey[]>): void {
  if (installed) return
  installed = true

  const realFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)

    if (request.url === `${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
      return json(200, { keys: await accessJwks() })
    }

    const mocked = await route(request)
    if (mocked.status !== 599) return mocked
    // Unmocked origins fail loudly instead of reaching the network.
    void realFetch
    return mocked
  }
}
