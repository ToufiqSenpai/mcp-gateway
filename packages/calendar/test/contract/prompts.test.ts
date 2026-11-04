import { describe, expect, it } from 'vitest';
import { createServer } from '../../src/server';
import type { McpContext } from '../../src/context';
import { call, stubContext } from '../support/mcp';

const noProviderContext: McpContext = {
  ...stubContext,
  async getAccessToken() {
    throw new Error('prompts must not touch the Provider');
  },
  async refreshAccessToken() {
    throw new Error('prompts must not touch the Provider');
  },
};

const noDefaultContext: McpContext = {
  ...noProviderContext,
  async listAccounts() {
    return [];
  },
};

interface PromptShape {
  name: string;
  description?: string;
  arguments?: { name: string; required?: boolean }[];
}

async function listPrompts(ctx: McpContext = stubContext): Promise<PromptShape[]> {
  const reply = await call(createServer(ctx), { method: 'prompts/list', params: {} });
  return (reply.result?.['prompts'] as PromptShape[]) ?? [];
}

describe('calendar prompts', () => {
  it('publishes the four documented prompts with their arguments', async () => {
    const prompts = await listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual([
      'plan_day',
      'find_meeting_time',
      'summarize_week',
      'triage_invites',
    ]);

    const byName = Object.fromEntries(prompts.map((prompt) => [prompt.name, prompt]));
    expect(byName['plan_day']?.arguments?.map((arg) => arg.name)).toEqual(['date', 'account']);

    const findMeeting = byName['find_meeting_time']?.arguments ?? [];
    expect(findMeeting.find((arg) => arg.name === 'attendees')?.required).toBe(true);
    expect(findMeeting.map((arg) => arg.name)).toEqual([
      'attendees',
      'durationMinutes',
      'windowStart',
      'windowEnd',
      'account',
    ]);
  });

  it('answers prompts/get without calling the Provider and resolves the Default Account', async () => {
    const reply = await call(createServer(noProviderContext), {
      method: 'prompts/get',
      params: { name: 'plan_day', arguments: {} },
    });

    const result = reply.result as {
      messages: { role: string; content: { type: string; text: string } }[];
      cacheScope?: string;
    };
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content.text).toContain('personal');
    expect(result.messages[0]?.content.text).toContain('list_events');
  });

  it('uses an explicit account without inventing one', async () => {
    const reply = await call(createServer(noProviderContext), {
      method: 'prompts/get',
      params: { name: 'triage_invites', arguments: { account: 'work' } },
    });
    const text = (reply.result as { messages: { content: { text: string } }[] }).messages[0]
      ?.content.text;
    expect(text).toContain('work');
  });

  it('answers -32602 when there is no Default Account and none was passed', async () => {
    const reply = await call(createServer(noDefaultContext), {
      method: 'prompts/get',
      params: { name: 'plan_day', arguments: {} },
    });
    expect(reply.error?.code).toBe(-32602);
    expect(reply.error?.message).toContain('Default Account');
  });

  it('answers -32602 when a required prompt argument is missing', async () => {
    const reply = await call(createServer(noProviderContext), {
      method: 'prompts/get',
      params: { name: 'find_meeting_time', arguments: {} },
    });
    expect(reply.error?.code).toBe(-32602);
  });
});
