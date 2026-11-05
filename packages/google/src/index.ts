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
 * Google is called over plain `fetch` with the typed shapes from the Provider's type-only SDK
 * (nothing from the SDK is bundled). The seam is `rootUrl`, so tests fake HTTP where
 * production calls it. The token still comes from `McpContext`, and a Provider 401 triggers
 * exactly one forced refresh and one retry.
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

/**
 * One Account's authenticated Google transport: token at the edge, one refresh-and-retry on
 * 401. Each MCP derives its typed endpoint surface from this class.
 */
export class Google {
  private token?: string

  public constructor(
    private readonly ctx: McpContext,
    private readonly slug: string,
    private readonly rootUrl: string = GOOGLE_ROOT_URL
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

  /** Memoized per instance; each instance belongs to one Account and one tool call. */
  private async accessToken(force = false): Promise<string> {
    if (!force && this.token) return this.token
    this.token = force ? await this.ctx.refreshAccessToken(this.slug) : await this.ctx.getAccessToken(this.slug)
    return this.token
  }

  public async call<T>(path: string, options: RequestOptions = {}): Promise<{ data: T }> {
    let response = await this.send(await this.accessToken(), path, options)
    if (response.status === 401) {
      // Reactive refresh: one forced rotation and one retry.
      response = await this.send(await this.accessToken(true), path, options)
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

/** Reads the Provider error status without ever returning a raw body. */
export function googleStatus(error: Error): string | undefined {
  return error instanceof GoogleApiError ? String(error.status) : undefined
}
