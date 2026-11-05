import type { sheets_v4 } from "@googleapis/sheets"
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
 * Google is called over plain `fetch` with the typed shapes from `@googleapis/sheets`
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

function pathSegment(value: string): string {
  return encodeURIComponent(value)
}

export interface SpreadsheetsGetParams extends sheets_v4.Params$Resource$Spreadsheets$Get {
  spreadsheetId: string
  commentsIncluded?: boolean
}

/** The create body is deliberately only the title; every other property is a Provider default. */
export interface SpreadsheetTitleBody {
  properties?: { title?: string }
}

export interface SpreadsheetsCreateParams {
  requestBody?: SpreadsheetTitleBody
}

export interface SpreadsheetsBatchUpdateParams {
  spreadsheetId: string
  requestBody: {
    requests: sheets_v4.Schema$Request[]
    writeControl?: { requiredRevisionId?: string }
  }
}

export interface ValuesGetParams extends sheets_v4.Params$Resource$Spreadsheets$Values$Get {
  spreadsheetId: string
  range: string
}

export interface ValuesUpdateParams extends sheets_v4.Params$Resource$Spreadsheets$Values$Update {
  spreadsheetId: string
  range: string
  valueInputOption: string
  requestBody: sheets_v4.Schema$ValueRange
}

export class SpreadsheetsResource {
  public constructor(private readonly request: GoogleRequest) {}

  public get(params: SpreadsheetsGetParams) {
    return this.request.call<sheets_v4.Schema$Spreadsheet>(`v4/spreadsheets/${pathSegment(params.spreadsheetId)}`, {
      query: {
        includeGridData: params.includeGridData,
        ranges: params.ranges,
        fields: params.fields,
        commentsIncluded: params.commentsIncluded
      }
    })
  }

  public create(params: SpreadsheetsCreateParams = {}) {
    return this.request.call<sheets_v4.Schema$Spreadsheet>("v4/spreadsheets", {
      method: "POST",
      body: params.requestBody
    })
  }

  public batchUpdate(params: SpreadsheetsBatchUpdateParams) {
    return this.request.call<sheets_v4.Schema$BatchUpdateSpreadsheetResponse>(
      `v4/spreadsheets/${pathSegment(params.spreadsheetId)}:batchUpdate`,
      { method: "POST", body: params.requestBody }
    )
  }
}

export class ValuesResource {
  public constructor(private readonly request: GoogleRequest) {}

  public get(params: ValuesGetParams) {
    return this.request.call<sheets_v4.Schema$ValueRange>(
      `v4/spreadsheets/${pathSegment(params.spreadsheetId)}/values/${pathSegment(params.range)}`
    )
  }

  public update(params: ValuesUpdateParams) {
    return this.request.call<sheets_v4.Schema$UpdateValuesResponse>(
      `v4/spreadsheets/${pathSegment(params.spreadsheetId)}/values/${pathSegment(params.range)}`,
      {
        method: "PUT",
        query: { valueInputOption: params.valueInputOption },
        body: params.requestBody
      }
    )
  }
}

/** The typed Google surface for one Account; one instance per tool call, never shared. */
export class GoogleSheetsClient {
  public readonly spreadsheets: SpreadsheetsResource
  public readonly values: ValuesResource

  public constructor(ctx: McpContext, slug: string, rootUrl: string = GOOGLE_ROOT_URL) {
    const request = new GoogleRequest(ctx, slug, rootUrl)
    this.spreadsheets = new SpreadsheetsResource(request)
    this.values = new ValuesResource(request)
  }
}

/** Reads the Provider error status without ever returning a raw body. */
export function providerErrorCode(error: Error): string | undefined {
  return error instanceof GoogleApiError ? String(error.status) : undefined
}
