import { listAccountsTool, type ToolDefinition } from "@mcp-gateway/common"

import { createPageTool } from "./create-page"
import { getPageTool } from "./get-page"
import { listNotebooksTool, listPagesTool, listSectionsTool } from "./lists"
import { searchPagesTool } from "./search-pages"
import type { ToolContext } from "./tool-context"
import { updatePageTool } from "./update-page"
import { createNotebookTool, createSectionTool, deletePageTool } from "./writes"

export type NotesTool = ToolDefinition<ToolContext>

/** Registration order is the `tools/list` order, which is deterministic run to run. */
export const notesTools: readonly NotesTool[] = [
  listNotebooksTool,
  listSectionsTool,
  listPagesTool,
  getPageTool,
  searchPagesTool,
  createPageTool,
  updatePageTool,
  deletePageTool,
  createSectionTool,
  createNotebookTool,
  listAccountsTool
]
