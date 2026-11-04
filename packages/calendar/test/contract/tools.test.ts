import { describe, expect, it } from 'vitest';
import { createServer } from '../../src/server';
import { call, stubContext } from '../support/mcp';

interface ToolShape {
  name: string;
  description?: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  annotations?: Record<string, unknown>;
}

async function listTools(server = createServer(stubContext)): Promise<ToolShape[]> {
  const reply = await call(server, { method: 'tools/list', params: {} });
  return (reply.result?.['tools'] as ToolShape[]) ?? [];
}

function tool(tools: ToolShape[], name: string): ToolShape {
  const found = tools.find((entry) => entry.name === name);
  if (!found) throw new Error(`tool ${name} is missing`);
  return found;
}

function props(shape: ToolShape): Record<string, Record<string, unknown>> {
  return shape.inputSchema.properties ?? {};
}

describe('calendar tool contract', () => {
  it('publishes the nine calendar tools plus list_accounts', async () => {
    const names = (await listTools()).map((entry) => entry.name);
    expect(names).toEqual([
      'list_events',
      'get_event',
      'list_calendars',
      'suggest_time',
      'create_event',
      'update_event',
      'delete_event',
      'respond_to_event',
      'search_events',
      'list_accounts',
    ]);
  });

  it('orders tools/list deterministically over 20 runs', async () => {
    const first = JSON.stringify((await listTools()).map((entry) => entry.name));
    for (let run = 0; run < 20; run += 1) {
      expect(JSON.stringify((await listTools()).map((entry) => entry.name))).toBe(first);
    }
  });

  it('takes an ISO 8601 dateTime with an offset and caps pageSize at 250', async () => {
    const events = tool(await listTools(), 'list_events');
    const properties = props(events);

    expect(properties['startTime']?.['pattern']).toContain('[+-]');
    expect(properties['pageSize']?.['maximum']).toBe(250);
    expect(properties['pageSize']?.['default']).toBeUndefined();
    expect(properties['account']).toBeDefined();
  });

  it('keeps the deprecated eventTypeFilter and attendeeEmails but not invented fields', async () => {
    const tools = await listTools();

    expect(props(tool(tools, 'list_events'))['eventTypeFilter']).toBeDefined();
    expect(props(tool(tools, 'create_event'))['attendeeEmails']).toBeDefined();
    expect(props(tool(tools, 'create_event'))['useDefaultReminders']).toBeUndefined();
    expect(props(tool(tools, 'create_event'))['label']).toBeUndefined();
    expect(props(tool(tools, 'create_event'))['conferenceData']).toBeUndefined();
    expect(props(tool(tools, 'update_event'))['addedAttendeeEmails']).toBeDefined();
  });

  it('exposes suggest_time preferences as "HH:mm" hours with pageSize default 5', async () => {
    const preferences = props(tool(await listTools(), 'suggest_time'))['preferences'] as
      | { properties?: Record<string, Record<string, unknown>> }
      | undefined;
    expect(preferences?.properties?.['startHour']?.['pattern']).toContain('[0-5]');
    expect(preferences?.properties?.['endHour']).toBeDefined();
    expect(preferences?.properties?.['excludeWeekends']).toBeDefined();
    expect(preferences?.properties?.['pageSize']).toBeDefined();
  });

  it('marks delete_event destructive and the read tools read-only', async () => {
    const tools = await listTools();
    expect(tool(tools, 'delete_event').annotations?.['destructiveHint']).toBe(true);
    expect(tool(tools, 'list_events').annotations?.['readOnlyHint']).toBe(true);
    expect(tool(tools, 'list_calendars').annotations?.['readOnlyHint']).toBe(true);
  });

  it('answers an unknown tool with -32602', async () => {
    const reply = await call(createServer(stubContext), {
      method: 'tools/call',
      params: { name: 'not_a_tool', arguments: {} },
    });
    expect(reply.error?.code).toBe(-32602);
  });

  it('returns every successful result as resultType "complete" with cache hints', async () => {
    const reply = await call(createServer(stubContext), { method: 'tools/list', params: {} });
    expect(reply.result?.['resultType']).toBe('complete');
    expect(reply.result?.['ttlMs']).toBe(3_600_000);
    expect(reply.result?.['cacheScope']).toBe('public');
  });
});
