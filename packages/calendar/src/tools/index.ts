import { listAccountsTool, type ToolDefinition } from "@mcp-gateway/common"

import { createEventTool } from "./create-event"
import { deleteEventTool } from "./delete-event"
import { getEventTool } from "./get-event"
import { listCalendarsTool } from "./list-calendars"
import { listEventsTool } from "./list-events"
import { respondToEventTool } from "./respond-to-event"
import { searchEventsTool } from "./search-events"
import { suggestTimeTool } from "./suggest-time"
import type { ToolContext } from "./tool-context"
import { updateEventTool } from "./update-event"

export type CalendarTool = ToolDefinition<ToolContext>

/** Registration order is the `tools/list` order, which is deterministic run to run. */
export const calendarTools: readonly CalendarTool[] = [
  listEventsTool,
  getEventTool,
  listCalendarsTool,
  suggestTimeTool,
  createEventTool,
  updateEventTool,
  deleteEventTool,
  respondToEventTool,
  searchEventsTool,
  listAccountsTool
]
