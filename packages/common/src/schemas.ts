import { z } from "zod"

/** The input every MCP tool takes to choose an Account; the description is part of the wire contract. */
export const accountSchema = z
  .string()
  .min(1)
  .optional()
  .describe("Account slug. Defaults to the Default Account for this MCP.")
