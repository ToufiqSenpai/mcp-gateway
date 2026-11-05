import { listAccountsTool } from "@mcp-gateway/common"
import type { JSONValue } from "@modelcontextprotocol/server"
import { describe, expect, it } from "vitest"

import { REQUIRED_SCOPES } from "../../src"
import { SheetsServer } from "../../src/server"
import reference from "../fixtures/google-sheets-tools.json" with { type: "json" }
import { listTools as readTools, stubContext } from "../support/mcp"

interface PropertySchema {
  type?: string | string[]
  enum?: string[]
  default?: JSONValue
  description?: string
  properties?: Record<string, PropertySchema>
  items?: PropertySchema
  required?: string[]
}

interface ReferenceTool {
  properties: Record<string, PropertySchema>
  required?: string[]
}

interface ToolListing {
  name: string
  title?: string
  description?: string
  inputSchema: {
    type?: string
    properties?: Record<string, PropertySchema>
    required?: string[]
  }
  annotations?: Record<string, boolean>
}

/** The six published Google tools plus the documented addition. */
const PROVIDER_TOOLS = [
  "get_values",
  "get_spreadsheet",
  "update_spreadsheet",
  "update_values",
  "update_formulas",
  "insert_dimension",
  "create_spreadsheet"
] as const

const READ_ONLY_TOOLS: readonly string[] = ["get_values", "get_spreadsheet"]
const WRITE_TOOLS: readonly string[] = [
  "update_spreadsheet",
  "update_values",
  "update_formulas",
  "insert_dimension",
  "create_spreadsheet"
]

/** Every field the contract pins; representations such as `anyOf` are not part of it. */
function contractFields(schema: PropertySchema): PropertySchema {
  const result: PropertySchema = {}
  if (schema.type !== undefined) result.type = Array.isArray(schema.type) ? [...schema.type] : schema.type
  if (schema.enum !== undefined) result.enum = [...schema.enum]
  if (schema.default !== undefined) result.default = schema.default
  if (schema.items !== undefined) result.items = contractFields(schema.items)
  if (schema.properties !== undefined) {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, child]) => [name, contractFields(child)])
    )
  }
  if (schema.required !== undefined) result.required = [...schema.required]
  return result
}

function listTools(server = new SheetsServer(stubContext).build()): Promise<ToolListing[]> {
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

function property(listing: ToolListing, name: string): PropertySchema {
  const found = props(listing)[name]
  if (!found) throw new Error(`tool ${listing.name} has no ${name} property`)
  return found
}

function firstSentence(description: string): string {
  return /^.*?[.!?](?=\s|$)/.exec(description)?.[0] ?? description
}

describe("sheets tool contract", () => {
  it("publishes exactly the eight documented tools in order", async () => {
    const names = (await listTools()).map(entry => entry.name)
    expect(names).toEqual([
      "get_values",
      "get_spreadsheet",
      "update_spreadsheet",
      "update_values",
      "update_formulas",
      "insert_dimension",
      "create_spreadsheet",
      "list_accounts"
    ])
  })

  it("puts an optional account string on every provider tool", async () => {
    const tools = await listTools()
    for (const name of PROVIDER_TOOLS) {
      const listing = tool(tools, name)
      const account = property(listing, "account")
      expect(account.type).toBe("string")
      expect(account.description).toContain("Account slug.")
      expect(listing.inputSchema.required ?? []).not.toContain("account")
    }
  })

  it("serves the shared list_accounts tool unchanged", async () => {
    const listing = tool(await listTools(), "list_accounts")
    expect(props(listing)).toEqual({})
    expect(listing.title).toBe(listAccountsTool.config.title)
    expect(listing.description).toBe(listAccountsTool.config.description)
    expect(listing.annotations).toEqual(listAccountsTool.config.annotations)
  })

  it("matches each published Input Schema field by field", async () => {
    const expectedTools: Record<string, ReferenceTool> = reference
    const tools = await listTools()

    for (const [name, expected] of Object.entries(expectedTools)) {
      const listing = tool(tools, name)
      const actual = props(listing)
      const providerFields = Object.keys(actual).filter(field => field !== "account")

      expect(providerFields).toEqual(Object.keys(expected.properties))
      expect(listing.inputSchema.required ?? []).toEqual(expected.required ?? [])

      for (const [field, expectedSchema] of Object.entries(expected.properties)) {
        expect(contractFields(property(listing, field))).toEqual(contractFields(expectedSchema))
      }
    }
  })

  it("offers exact defaults and enums for the documented inputs", async () => {
    const tools = await listTools()
    const spreadsheet = tool(tools, "get_spreadsheet")

    expect(property(spreadsheet, "includeGridData").default).toBe(false)
    expect(property(spreadsheet, "commentsIncluded").default).toBe(false)
    expect(property(tool(tools, "insert_dimension"), "dimension").enum).toEqual([
      "ROWS",
      "COLUMNS",
      "DIMENSION_UNSPECIFIED"
    ])
  })

  it("publishes the documented annotations without destructiveHint", async () => {
    const tools = await listTools()

    for (const name of READ_ONLY_TOOLS) {
      expect(tool(tools, name).annotations?.["readOnlyHint"]).toBe(true)
      expect(tool(tools, name).annotations?.["idempotentHint"]).toBe(true)
    }
    for (const name of WRITE_TOOLS) {
      expect(tool(tools, name).annotations?.["readOnlyHint"]).toBe(false)
      expect(tool(tools, name).annotations?.["idempotentHint"]).toBe(false)
    }
    for (const name of PROVIDER_TOOLS) {
      expect(tool(tools, name).annotations?.["openWorldHint"]).toBe(true)
      expect(tool(tools, name).annotations?.["destructiveHint"]).toBeUndefined()
    }
    expect(tool(tools, "list_accounts").annotations?.["destructiveHint"]).toBeUndefined()
  })

  it("keeps the documented first sentence of every description", async () => {
    const tools = await listTools()
    const sentences = {
      get_values: "Returns a range of values from a spreadsheet.",
      get_spreadsheet: "Returns the spreadsheet content for the given spreadsheet.",
      update_spreadsheet: "Applies one or more updates to the spreadsheet.",
      update_values: "Sets values in a range of a spreadsheet.",
      update_formulas: "Sets formulas in a range of a spreadsheet.",
      insert_dimension: "Inserts rows or columns in a sheet at a particular index.",
      create_spreadsheet: "Creates a new spreadsheet in the Account's Drive."
    } satisfies Record<string, string>

    for (const [name, sentence] of Object.entries(sentences)) {
      expect(firstSentence(tool(tools, name).description ?? "")).toBe(sentence)
    }
  })
})

describe("sheets scopes", () => {
  it("requests the Sheets scope and no Drive scope", () => {
    expect(REQUIRED_SCOPES).toContain("https://www.googleapis.com/auth/spreadsheets")
    for (const scope of ["drive", "drive.file", "drive.readonly"]) {
      expect(REQUIRED_SCOPES).not.toContain(`https://www.googleapis.com/auth/${scope}`)
    }
    expect(REQUIRED_SCOPES.some(scope => scope.includes("/auth/drive"))).toBe(false)
  })
})
