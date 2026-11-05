import type { McpContext } from "@mcp-gateway/common"
import { getPrompt, listPrompts as readPrompts, stubContext } from "@mcp-gateway/test"
import { describe, expect, it } from "vitest"

import { CalendarServer } from "../../src/server"

const noProviderContext: McpContext = {
  ...stubContext,
  async getAccessToken() {
    throw new Error("prompts must not touch the Provider")
  },
  async refreshAccessToken() {
    throw new Error("prompts must not touch the Provider")
  }
}

const noDefaultContext: McpContext = {
  ...noProviderContext,
  async listAccounts() {
    return []
  }
}

interface PromptArgument {
  name: string
  required?: boolean
}

interface PromptListing {
  name: string
  description?: string
  arguments?: PromptArgument[]
}

interface PromptMessage {
  role: string
  content: { type: string; text: string }
}

interface PromptGetResult {
  messages: PromptMessage[]
  cacheScope?: string
}

function listPrompts(ctx: McpContext = stubContext): Promise<PromptListing[]> {
  return readPrompts<PromptListing>(new CalendarServer(ctx).build())
}

describe("calendar prompts", () => {
  it("publishes the four documented prompts with their arguments", async () => {
    const prompts = await listPrompts()
    expect(prompts.map(prompt => prompt.name)).toEqual([
      "plan_day",
      "find_meeting_time",
      "summarize_week",
      "triage_invites"
    ])

    const byName = Object.fromEntries(prompts.map(prompt => [prompt.name, prompt]))
    expect(byName["plan_day"]?.arguments?.map(arg => arg.name)).toEqual(["date", "account"])

    const findMeeting = byName["find_meeting_time"]?.arguments ?? []
    expect(findMeeting.find(arg => arg.name === "attendees")?.required).toBe(true)
    expect(findMeeting.map(arg => arg.name)).toEqual([
      "attendees",
      "durationMinutes",
      "windowStart",
      "windowEnd",
      "account"
    ])
  })

  it("answers prompts/get without calling the Provider and resolves the Default Account", async () => {
    const result = await getPrompt<PromptGetResult>(new CalendarServer(noProviderContext).build(), "plan_day")

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.content.text).toContain("personal")
    expect(result.messages[0]?.content.text).toContain("list_events")
  })

  it("uses an explicit account without inventing one", async () => {
    const result = await getPrompt<PromptGetResult>(new CalendarServer(noProviderContext).build(), "triage_invites", {
      account: "work"
    })
    const text = result.messages[0]?.content.text
    expect(text).toContain("work")
  })

  it("answers -32602 when there is no Default Account and none was passed", async () => {
    await expect(getPrompt(new CalendarServer(noDefaultContext).build(), "plan_day")).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining("Default Account")
    })
  })

  it("answers -32602 when a required prompt argument is missing", async () => {
    await expect(getPrompt(new CalendarServer(noProviderContext).build(), "find_meeting_time")).rejects.toMatchObject({
      code: -32602
    })
  })
})
