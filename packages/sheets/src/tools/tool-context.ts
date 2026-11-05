import { ToolContext as CommonToolContext } from "@mcp-gateway/common"

import { GoogleSheetsClient } from "../client"

/** Per-request view over `McpContext`: Account selection and the Google Sheets client. */
export class ToolContext extends CommonToolContext {
  public sheets(slug: string) {
    return new GoogleSheetsClient(this.ctx, slug)
  }
}
