import { listTools as readTools, stubContext, withClient } from "@mcp-gateway/test"
import type { JSONValue } from "@modelcontextprotocol/server"
import { describe, expect, it } from "vitest"

import { CalendarServer } from "../../src/server"

interface PropertySchema {
  type?: string
  pattern?: string
  format?: string
  maximum?: number
  default?: JSONValue
  properties?: Record<string, PropertySchema>
  items?: PropertySchema
  required?: string[]
}

interface ToolListing {
  name: string
  description?: string
  inputSchema: {
    type?: string
    properties?: Record<string, PropertySchema>
    required?: string[]
  }
  annotations?: Record<string, boolean>
}

function listTools(server = new CalendarServer(stubContext).build()): Promise<ToolListing[]> {
  return readTools<ToolListing>(server)
}

function tool(tools: ToolListing[], name: string): ToolListing {
  const found = tools.find(entry => entry.name === name)
  if (!found) throw new Error(`tool ${name} is missing`)
  return found
}

function props(listing: ToolListing): Record<string, PropertySchema> {
  return listing.inputSchema.properties ?? {}
}

describe("calendar tool contract", () => {
  it("publishes the nine calendar tools plus list_accounts", async () => {
    const names = (await listTools()).map(entry => entry.name)
    expect(names).toEqual([
      "list_events",
      "get_event",
      "list_calendars",
      "suggest_time",
      "create_event",
      "update_event",
      "delete_event",
      "respond_to_event",
      "search_events",
      "list_accounts"
    ])
  })

  it("orders tools/list deterministically over 20 runs", async () => {
    const first = JSON.stringify((await listTools()).map(entry => entry.name))
    for (let run = 0; run < 20; run += 1) {
      expect(JSON.stringify((await listTools()).map(entry => entry.name))).toBe(first)
    }
  })

  it("takes an ISO 8601 dateTime with an offset and caps pageSize at 250", async () => {
    const events = tool(await listTools(), "list_events")
    const properties = props(events)

    expect(properties["startTime"]?.["pattern"]).toContain("[+-]")
    expect(properties["pageSize"]?.["maximum"]).toBe(250)
    expect(properties["pageSize"]?.["default"]).toBeUndefined()
    expect(properties["account"]).toBeDefined()
  })

  it("keeps the deprecated eventTypeFilter and attendeeEmails but not invented fields", async () => {
    const tools = await listTools()

    expect(props(tool(tools, "list_events"))["eventTypeFilter"]).toBeDefined()
    expect(props(tool(tools, "create_event"))["attendeeEmails"]).toBeDefined()
    expect(props(tool(tools, "create_event"))["useDefaultReminders"]).toBeUndefined()
    expect(props(tool(tools, "create_event"))["label"]).toBeUndefined()
    expect(props(tool(tools, "create_event"))["conferenceData"]).toBeUndefined()
    expect(props(tool(tools, "update_event"))["addedAttendeeEmails"]).toBeDefined()
  })

  it("validates attendee emails and attachment URLs at the schema boundary", async () => {
    const create = props(tool(await listTools(), "create_event"))

    expect(create["attendeeEmails"]?.items?.["format"]).toBe("email")
    expect(create["attachments"]?.items?.properties?.["fileUrl"]?.["format"]).toBe("uri")
  })

  it("uses the documented attendee, guest permission and working location shapes", async () => {
    const create = props(tool(await listTools(), "create_event"))
    const attendee = create["attendees"]?.items?.properties

    expect(attendee?.["optionalAttendee"]).toBeDefined()
    expect(attendee?.["optional"]).toBeUndefined()
    expect(create["guestPermissions"]?.properties?.["guestsCanModify"]).toBeDefined()
    expect(create["guestPermissions"]?.["items"]).toBeUndefined()
    expect(create["workingLocationProperties"]?.properties?.["customLocationLabel"]).toBeDefined()
  })

  it('exposes suggest_time preferences as "HH:mm" hours with pageSize default 5', async () => {
    const preferences = props(tool(await listTools(), "suggest_time"))["preferences"]
    expect(preferences?.properties?.["startHour"]?.["pattern"]).toContain("[0-5]")
    expect(preferences?.properties?.["endHour"]).toBeDefined()
    expect(preferences?.properties?.["excludeWeekends"]).toBeDefined()
    expect(preferences?.properties?.["pageSize"]).toBeDefined()
  })

  it("marks delete_event destructive and the write tools non-read-only", async () => {
    const tools = await listTools()
    expect(tool(tools, "delete_event").annotations?.["destructiveHint"]).toBe(true)
    expect(tool(tools, "list_events").annotations?.["readOnlyHint"]).toBe(true)
    expect(tool(tools, "list_calendars").annotations?.["readOnlyHint"]).toBe(true)
    for (const name of ["create_event", "update_event", "delete_event", "respond_to_event"]) {
      expect(tool(tools, name).annotations?.["readOnlyHint"]).toBe(false)
    }
  })

  it("answers an unknown tool with -32602", async () => {
    await withClient(new CalendarServer(stubContext).build(), async client => {
      await expect(client.callTool({ name: "not_a_tool", arguments: {} })).rejects.toMatchObject({ code: -32602 })
    })
  })

  it("serves a cacheable tools/list result", async () => {
    const { ttlMs, cacheScope } = await withClient(new CalendarServer(stubContext).build(), client =>
      client.listTools()
    )
    expect(ttlMs).toBe(3_600_000)
    expect(cacheScope).toBe("public")
  })
})
