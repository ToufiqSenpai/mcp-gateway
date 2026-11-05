import type { sheets_v4 } from "@googleapis/sheets"
import type { McpContext } from "@mcp-gateway/common"
import { GOOGLE_ROOT_URL, GoogleRequest } from "@mcp-gateway/google-api"

export { GOOGLE_ROOT_URL, GoogleApiError, providerErrorCode } from "@mcp-gateway/google-api"

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
