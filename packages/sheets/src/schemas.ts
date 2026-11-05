import { z } from "zod"

export { accountSchema } from "@mcp-gateway/common"

/** A cell Google accepts on write; `null` is skipped and an empty string clears the cell. */
export const cellValueSchema = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .describe("A cell value: string, number, boolean or null.")

export const valueRowsSchema = z
  .array(z.array(cellValueSchema))
  .describe("Row-major values; nested arrays and objects are rejected.")

export const formulaRowsSchema = z
  .array(z.array(z.string()))
  .describe("Row-major formula strings, for example [['=A1+B1'], ['=A2+B2']].")

/** Any documented batchUpdate request object; Google validates each one atomically. */
export const batchRequestsSchema = z
  .array(z.record(z.string(), z.json()))
  .describe("One or more documented spreadsheets.batchUpdate requests, applied in order.")
