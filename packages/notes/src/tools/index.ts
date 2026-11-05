import { listAccountsTool, type ToolDefinition } from "@mcp-gateway/common"

import { createNotebookTool } from "./create-notebook"
import { createPageTool } from "./create-page"
import { createSectionTool } from "./create-section"
import { deletePageTool } from "./delete-page"
import { getPageTool } from "./get-page"
import { listNotebooksTool, listPagesTool, listSectionsTool } from "./lists"
import { searchPagesTool } from "./search-pages"
import type { ToolContext } from "./tool-context"
import { updatePageTool } from "./update-page"

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
