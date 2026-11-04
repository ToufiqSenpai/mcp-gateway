import { z } from "zod"

import { defineTool } from "./helpers"

const inputSchema = z.object({})

export const listAccountsTool = defineTool(
  "list_accounts",
  {
    title: "List accounts",
    description:
      "Lists the Accounts available to this MCP as { slug, isDefault }. Never returns state, Credentials or provider subjects. An empty array means no Accounts are configured.",
    inputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (_args, context) => {
    return { accounts: await context.listAccounts() }
  }
)
