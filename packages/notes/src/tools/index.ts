import type { ToolDefinition } from './helpers';
import { createPageTool } from './create-page';
import { getPageTool } from './get-page';
import {
  listAccountsTool,
  listNotebooksTool,
  listPagesTool,
  listSectionsTool,
} from './lists';
import { searchPagesTool } from './search-pages';
import { updatePageTool } from './update-page';
import { createNotebookTool, createSectionTool, deletePageTool } from './writes';

/** Registration order is the `tools/list` order, which is deterministic run to run. */
export const notesTools: ToolDefinition[] = [
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
  listAccountsTool,
];
