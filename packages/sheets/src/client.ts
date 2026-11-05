import type { sheets_v4 } from "@googleapis/sheets"
import { Google } from "@mcp-gateway/google"

export { GOOGLE_ROOT_URL, GoogleApiError, providerErrorCode } from "@mcp-gateway/google"

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

/** The typed Google Sheets surface for one Account; one instance per tool call, never shared. */
export class GoogleSheets extends Google {
  public getSpreadsheet(params: SpreadsheetsGetParams) {
    return this.call<sheets_v4.Schema$Spreadsheet>(`v4/spreadsheets/${pathSegment(params.spreadsheetId)}`, {
      query: {
        includeGridData: params.includeGridData,
        ranges: params.ranges,
        fields: params.fields,
        commentsIncluded: params.commentsIncluded
      }
    })
  }

  public createSpreadsheet(params: SpreadsheetsCreateParams = {}) {
    return this.call<sheets_v4.Schema$Spreadsheet>("v4/spreadsheets", {
      method: "POST",
      body: params.requestBody
    })
  }

  public batchUpdate(params: SpreadsheetsBatchUpdateParams) {
    return this.call<sheets_v4.Schema$BatchUpdateSpreadsheetResponse>(
      `v4/spreadsheets/${pathSegment(params.spreadsheetId)}:batchUpdate`,
      { method: "POST", body: params.requestBody }
    )
  }

  public getValues(params: ValuesGetParams) {
    return this.call<sheets_v4.Schema$ValueRange>(
      `v4/spreadsheets/${pathSegment(params.spreadsheetId)}/values/${pathSegment(params.range)}`
    )
  }

  public updateValues(params: ValuesUpdateParams) {
    return this.call<sheets_v4.Schema$UpdateValuesResponse>(
      `v4/spreadsheets/${pathSegment(params.spreadsheetId)}/values/${pathSegment(params.range)}`,
      {
        method: "PUT",
        query: { valueInputOption: params.valueInputOption },
        body: params.requestBody
      }
    )
  }
}
