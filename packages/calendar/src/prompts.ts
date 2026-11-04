import type { McpContext } from "@mcp-gateway/common"
import { McpServer, ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server"
import { z } from "zod"

interface PromptReply {
  messages: { role: "user"; content: { type: "text"; text: string } }[]
}

export interface PromptDefinition {
  readonly name: string
  register(server: McpServer, context: PromptContext): void
}

/** Keeps each prompt's arguments typed from its own schema while the registry stays homogeneous. */
function definePrompt<S extends z.ZodObject>(
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

/**
 * Four static prompts: instructions only, no Provider call. `account` resolves to the Default
 * Account and nothing else; with no default, the caller is told how to fix it.
 */
export const calendarPrompts: readonly PromptDefinition[] = [
  definePrompt(
    "plan_day",
    {
      title: "Plan the day",
      description: "Plan a day around the events already on the calendar.",
      argsSchema: z.object({ date: z.string().optional(), account: z.string().optional() })
    },
    async ({ date, account }, context) => {
      const slug = await context.resolve(account)
      const day = date ?? "today"
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Plan ${day} using the calendar Account "${slug}". Start with list_events for that day, then propose a realistic order for the day, protect focus blocks, and flag conflicts. Do not create or change events unless I ask.`
            }
          }
        ]
      }
    }
  ),
  definePrompt(
    "find_meeting_time",
    {
      title: "Find a meeting time",
      description: "Find an open slot that suits the given attendees.",
      argsSchema: z.object({
        attendees: z.string(),
        durationMinutes: z.number().optional(),
        windowStart: z.string().optional(),
        windowEnd: z.string().optional(),
        account: z.string().optional()
      })
    },
    async ({ attendees, durationMinutes, windowStart, windowEnd, account }, context) => {
      const slug = await context.resolve(account)
      const attendeesList = attendees
        .split(",")
        .map(email => email.trim())
        .filter(Boolean)
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Find a meeting time on the calendar Account "${slug}" for ${attendeesList.join(", ")}. Use suggest_time with ${durationMinutes ?? 30} minutes${windowStart ? ` from ${windowStart}` : ""}${windowEnd ? ` to ${windowEnd}` : ""}, then summarise the best slots and why.`
            }
          }
        ]
      }
    }
  ),
  definePrompt(
    "summarize_week",
    {
      title: "Summarise the week",
      description: "Summarise a week of events: load, themes and load-bearing conflicts.",
      argsSchema: z.object({ weekOf: z.string().optional(), account: z.string().optional() })
    },
    async ({ weekOf, account }, context) => {
      const slug = await context.resolve(account)
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Summarise the week${weekOf ? ` of ${weekOf}` : ""} for the calendar Account "${slug}". Call list_events across that window, then report the shape of the week, recurring commitments, and anything overloaded. Do not change any event.`
            }
          }
        ]
      }
    }
  ),
  definePrompt(
    "triage_invites",
    {
      title: "Triage invitations",
      description: "Sort pending invitations into accept, decline and needs-a-question.",
      argsSchema: z.object({ account: z.string().optional() })
    },
    async ({ account }, context) => {
      const slug = await context.resolve(account)
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Triage pending invitations for the calendar Account "${slug}". Use list_events and search_events to see what each invitation collides with, then propose accept, decline or clarify for each. Only call respond_to_event if I explicitly approve it.`
            }
          }
        ]
      }
    }
  )
]

/** Registers prompts in array order — that order is the wire `prompts/list` order. */
export class CalendarPromptRegistry {
  public constructor(private readonly prompts: readonly PromptDefinition[] = calendarPrompts) {}

  public register(server: McpServer, context: PromptContext): void {
    for (const prompt of this.prompts) prompt.register(server, context)
  }
}
