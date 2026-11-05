import type { McpServer } from "@modelcontextprotocol/server"
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server"
import type { z } from "zod"

import type { McpContext } from "./context"

interface PromptReply {
  messages: { role: "user"; content: { type: "text"; text: string } }[]
}

export interface PromptDefinition {
  readonly name: string
  register(server: McpServer, context: PromptContext): void
}

/** Keeps each prompt's arguments typed from its own schema while the registry stays homogeneous. */
export function definePrompt<S extends z.ZodObject>(
  name: string,
  config: { title: string; description: string; argsSchema: S },
  render: (args: z.infer<S>, context: PromptContext) => Promise<PromptReply>
): PromptDefinition {
  return {
    name,
    register(server, context) {
      // SAFETY: the SDK's overloads cannot be resolved through the generic alias, and the
      // runtime contract is exactly this schema plus this render callback.
      server.registerPrompt(name, config as never, ((args: z.infer<S>) => render(args, context)) as never)
    }
  }
}

/** Prompt account selection is a protocol error, never a tool error. */
export class PromptContext {
  public constructor(private readonly ctx: McpContext) {}

  public async resolve(requested: string | undefined): Promise<string> {
    if (requested) return requested
    const accounts = await this.ctx.listAccounts()
    const fallback = accounts.find(account => account.isDefault)
    if (!fallback) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        'No Default Account is set. Pass "account" or set a Default Account in the admin area.'
      )
    }
    return fallback.slug
  }
}

/** Registers prompts in array order — that order is the wire `prompts/list` order. */
export class PromptRegistry {
  public constructor(private readonly prompts: readonly PromptDefinition[]) {}

  public register(server: McpServer, context: PromptContext): void {
    for (const prompt of this.prompts) prompt.register(server, context)
  }
}
