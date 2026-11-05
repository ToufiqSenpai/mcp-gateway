import { definePrompt, type PromptDefinition } from "@mcp-gateway/common"
import { z } from "zod"

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
