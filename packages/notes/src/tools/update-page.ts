import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { accountSchema, commandSchema, pageIdSchema, type PatchCommand } from "../schemas"
import type { ToolContext } from "./tool-context"

export function validateCommands(commands: PatchCommand[]): void {
  if (commands.length === 0) throw new Error("commands must contain at least one command.")

  for (const command of commands) {
    if (command.action !== "delete" && command.content === undefined) {
      throw new Error(`A "${command.action}" command requires content.`)
    }
    if (command.position !== undefined && command.action !== "append" && command.action !== "insert") {
      throw new Error("position is only accepted with append or insert.")
    }
  }
}

export const updatePageTool = defineTool(
  "update_page",
  {
    title: "Update page",
    description:
      'Updates the content of a page with Graph patchContentCommand objects. There is no whole-page replace: target body supports append only, and replace needs a generated element id (except target "title").',
    inputSchema: z.object({
      account: accountSchema,
      pageId: pageIdSchema,
      commands: z.array(commandSchema).min(1).describe("Required. The patch commands to apply to the page content.")
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
  },
  async (args, context: ToolContext) => {
    validateCommands(args.commands)
    const slug = await context.resolve(args.account)

    await context.graph(slug).updatePage(args.pageId, args.commands)

    return { pageId: args.pageId, updated: true }
  }
)
