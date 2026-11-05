import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { GraphError } from "../client"
import { toNotebook } from "../map"
import { accountSchema, displayNameSchema } from "../schemas"
import type { ToolContext } from "./tool-context"

export const createNotebookTool = defineTool(
  "create_notebook",
  {
    title: "Create notebook",
    description: "Creates a notebook. The gateway invalidates its enumeration cache after the write.",
    inputSchema: z.object({ account: accountSchema, displayName: displayNameSchema }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const client = context.graph(slug)
    const created = await client.createNotebook(args.displayName)

    await context.invalidateEnumeration()

    if (!created) throw new GraphError(500, "unknown", "Graph returned no notebook.")
    if (created.id && !created.links) {
      const followUp = await client.notebook(created.id)
      if (!followUp) throw new GraphError(404, "itemNotFound", "Notebook not found.")
      return toNotebook(followUp)
    }
    return toNotebook(created)
  }
)
