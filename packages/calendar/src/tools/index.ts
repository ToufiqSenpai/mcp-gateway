import { createEventTool } from './create-event';
import { deleteEventTool } from './delete-event';
import { getEventTool } from './get-event';
import { listAccountsTool } from './list-accounts';
import { listCalendarsTool } from './list-calendars';
import { listEventsTool } from './list-events';
import { respondToEventTool } from './respond-to-event';
import { searchEventsTool } from './search-events';
import { suggestTimeTool } from './suggest-time';
import { updateEventTool } from './update-event';
import type { ToolDefinition } from './helpers';

/** Registration order is the `tools/list` order, which is deterministic run to run. */
export const calendarTools: ToolDefinition[] = [
  listEventsTool,
  getEventTool,
  listCalendarsTool,
  suggestTimeTool,
  createEventTool,
  updateEventTool,
  deleteEventTool,
  respondToEventTool,
  searchEventsTool,
  listAccountsTool,
];
