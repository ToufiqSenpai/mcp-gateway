import type { JSONValue } from "@modelcontextprotocol/server"
import { describe, expect, it } from "vitest"

import { NotesServer } from "../../src/server"
import { listTools as readTools, stubContext, withClient } from "../support/mcp"

interface PropertySchema {
  type?: string
  description?: string
  pattern?: string
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
    properties?: Record<string, PropertySchema>
    required?: string[]
  }
  annotations?: Record<string, boolean>
}

function listTools(): Promise<ToolListing[]> {
  return readTools<ToolListing>(new NotesServer(stubContext).build())
}

function tool(tools: ToolListing[], name: string): ToolListing {
  const found = tools.find(entry => entry.name === name)
  if (!found) throw new Error(`tool ${name} is missing`)
  return found
}

function props(listing: ToolListing): Record<string, PropertySchema> {
  return listing.inputSchema.properties ?? {}
}

function* walkProperties(schema: { properties?: Record<string, PropertySchema> }): Generator<[string, PropertySchema]> {
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    yield [name, property]
    if (property.properties) yield* walkProperties(property)
    if (property.items?.properties) yield* walkProperties(property.items)
  }
}

describe("notes tool contract", () => {
  it("publishes the ten OneNote tools plus list_accounts", async () => {
    const names = (await listTools()).map(entry => entry.name)
    expect(names).toEqual([
      "list_notebooks",
      "list_sections",
      "list_pages",
      "get_page",
      "search_pages",
      "create_page",
      "update_page",
      "delete_page",
      "create_section",
      "create_notebook",
      "list_accounts"
    ])
  })

  it("orders tools/list deterministically over 20 runs", async () => {
    const first = JSON.stringify((await listTools()).map(entry => entry.name))
    for (let run = 0; run < 20; run += 1) {
      expect(JSON.stringify((await listTools()).map(entry => entry.name))).toBe(first)
    }
  })

  it("documents every input field", async () => {
    for (const listing of await listTools()) {
      for (const [name, property] of walkProperties(listing.inputSchema)) {
        expect(property.description, `${listing.name}.${name}`).toBeTruthy()
      }
    }
  })

  it("accepts optional parents on list_sections and requires one on create_section", async () => {
    const tools = await listTools()
    const listSections = props(tool(tools, "list_sections"))
    expect(listSections["notebookId"]).toBeDefined()
    expect(listSections["sectionGroupId"]).toBeDefined()
    expect(listSections["cursor"]).toBeDefined()

    const createSection = tool(tools, "create_section")
    expect(createSection.inputSchema.required).toContain("displayName")
    expect(createSection).toBeDefined()
  })

  it("keeps the documented get_page, search_pages and update_page arguments", async () => {
    const tools = await listTools()
    expect(props(tool(tools, "get_page"))["includeIds"]).toBeDefined()
    expect(props(tool(tools, "get_page"))["pageId"]).toBeDefined()

    expect(tool(tools, "search_pages").inputSchema.required).toContain("query")
    expect(props(tool(tools, "search_pages"))["sectionId"]).toBeDefined()

    const commands = props(tool(tools, "update_page"))["commands"]
    expect(commands?.items?.properties?.["action"]).toBeDefined()
    expect(commands?.items?.properties?.["target"]).toBeDefined()
    expect(commands?.items?.properties?.["position"]).toBeDefined()
  })

  it("publishes list tools with the gateway cursor and page size 100", async () => {
    const tools = await listTools()
    for (const name of ["list_notebooks", "list_sections", "list_pages", "search_pages"]) {
      expect(props(tool(tools, name))["cursor"]).toBeDefined()
      expect(props(tool(tools, name))["account"]).toBeDefined()
    }
  })

  it("marks delete_page destructive and the list tools read-only", async () => {
    const tools = await listTools()
    expect(tool(tools, "delete_page").annotations?.["destructiveHint"]).toBe(true)
    expect(tool(tools, "list_notebooks").annotations?.["readOnlyHint"]).toBe(true)
    expect(tool(tools, "create_page").annotations?.["readOnlyHint"]).toBeUndefined()
  })

  it("has no prompts and nothing subscribable", async () => {
    const { capabilities } = await withClient(new NotesServer(stubContext).build(), client => client.discover())
    expect(capabilities.prompts).toBeUndefined()
    expect(capabilities.resources).toEqual({})
    expect(JSON.stringify(capabilities)).not.toContain("listChanged")
  })
})
