import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import type { ToolContext } from "./tool-context"

const commandSchema = z.object({
  target: z.string().min(1).describe("#<data-id>, body, or title"),
  action: z.enum(["replace", "append", "prepend", "insert", "delete"]),
  content: z.string().optional(),
  position: z.enum(["after", "before"]).optional()
})

type Command = z.infer<typeof commandSchema>

export function validateCommands(commands: Command[]): void {
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
      'Forwards Graph patchContentCommand objects unchanged. There is no whole-page replace: target body supports append only, and replace needs a generated element id (except target "title").',
    inputSchema: z.object({
      account: z.string().optional(),
      pageId: z.string(),
      commands: z.array(commandSchema).min(1)
    }),
    annotations: { destructiveHint: false, idempotentHint: false }
  },
  async (args, context: ToolContext) => {
    validateCommands(args.commands)
    const slug = await context.resolve(args.account)

    await context.graph(slug).updatePage(args.pageId, args.commands)

    return { pageId: args.pageId, updated: true }
  }
)
