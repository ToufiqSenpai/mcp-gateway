import { z } from "zod"

export { accountSchema } from "@mcp-gateway/common"

export const cursorSchema = z
  .string()
  .optional()
  .describe("Opaque cursor from a previous response's nextCursor. Omit for the first page.")

export const notebookIdSchema = z.string().min(1).describe("The unique identifier of the notebook.")

export const sectionIdSchema = z.string().min(1).describe("The unique identifier of the section.")

export const sectionGroupIdSchema = z.string().min(1).describe("The unique identifier of the section group.")

export const pageIdSchema = z.string().min(1).describe("The unique identifier of the page.")

export const displayNameSchema = z.string().min(1).describe("The name of the notebook or section.")

export const titleSchema = z.string().describe("The title of the page.")

export const contentSchema = z
  .string()
  .describe(
    "The page body as an HTML fragment. The gateway wraps it in a full HTML document before sending it to Graph."
  )

export const includeIdsSchema = z
  .boolean()
  .optional()
  .describe("Optional. Include the generated element IDs in the returned HTML. Default: false.")

export const commandSchema = z.object({
  target: z
    .string()
    .min(1)
    .describe("Required. The element to update: #<data-id>, the generated <id>, or the body or title keyword."),
  action: z
    .enum(["replace", "append", "prepend", "insert", "delete"])
    .describe("Required. The action to perform on the target element."),
  content: z
    .string()
    .optional()
    .describe("A string of well-formed HTML to add. Required for every action except delete."),
  position: z
    .enum(["after", "before"])
    .optional()
    .describe("The location relative to the target. Accepted only with append and insert. Default: after.")
})

export type PatchCommand = z.infer<typeof commandSchema>
