import { z } from "zod"

import { defineTool } from "../tools"
import type { ToolContext } from "./context"

/** The one tool both packages publish verbatim; it only reads the account list. */
export const listAccountsTool = defineTool(
  "list_accounts",
  {
    title: "List accounts",
    description:
      "Lists the Accounts available to this MCP as { slug, isDefault }. Never returns state, Credentials or provider subjects. An empty array means no Accounts are configured.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (_args, context: ToolContext) => ({ accounts: await context.listAccounts() })
)
