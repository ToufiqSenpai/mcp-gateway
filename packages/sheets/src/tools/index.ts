import { listAccountsTool, type ToolDefinition } from "@mcp-gateway/common"

import { createSpreadsheetTool } from "./create-spreadsheet"
import { getSpreadsheetTool } from "./get-spreadsheet"
import { getValuesTool } from "./get-values"
import { insertDimensionTool } from "./insert-dimension"
import type { ToolContext } from "./tool-context"
import { updateFormulasTool } from "./update-formulas"
import { updateSpreadsheetTool } from "./update-spreadsheet"
import { updateValuesTool } from "./update-values"

export type SheetsTool = ToolDefinition<ToolContext>

/** Registration order is the `tools/list` order, matching the published surface. */
export const sheetsTools: readonly SheetsTool[] = [
  getValuesTool,
  getSpreadsheetTool,
  updateSpreadsheetTool,
  updateValuesTool,
  updateFormulasTool,
  insertDimensionTool,
  createSpreadsheetTool,
  listAccountsTool
]
