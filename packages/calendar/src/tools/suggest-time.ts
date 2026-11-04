import { z } from 'zod';
import { googleCalendar } from '../client';
import { accountSlug } from '../context';
import { accountSchema, dateTimeSchema } from '../schemas';
import { defineTool } from './helpers';

interface Interval {
  start: number;
  end: number;
}

const preferencesSchema = z.object({
  startHour: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional()
    .describe('Earliest local start of a slot, "HH:mm".'),
  endHour: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional()
    .describe('Latest local end of a slot, "HH:mm".'),
  excludeWeekends: z.boolean().optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
});

function mergeBusy(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((left, right) => left.start - right.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function localPart(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, ...options }).format(date);
}

function localHour(date: Date, timeZone: string): number {
  return Number(localPart(date, timeZone, { hour: '2-digit', hour12: false }));
}

function isWeekend(date: Date, timeZone: string): boolean {
  const weekday = localPart(date, timeZone, { weekday: 'short' });
  return weekday === 'Sat' || weekday === 'Sun';
}

function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export const suggestTimeTool = defineTool(
  'suggest_time',
  {
    title: 'Suggest a meeting time',
    description:
      'Inverts free/busy busy intervals into free slots, applying durationMinutes and preferences. Returns TimeSlot.start and TimeSlot.end plus deprecated startTime/endTime/durationMinutes.',
    inputSchema: z.object({
      account: accountSchema,
      attendeeEmails: z.array(z.string()).min(1),
      startTime: dateTimeSchema,
      endTime: dateTimeSchema,
      durationMinutes: z.number().int().min(1).optional(),
      timeZone: z.string().optional(),
      preferences: preferencesSchema.optional(),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (args, ctx) => {
    const slug = await accountSlug(ctx, args.account);
    const client = googleCalendar(ctx, slug);
    const timeZone = args.timeZone ?? 'UTC';
    const durationMinutes = args.durationMinutes ?? 30;
    const preferences = args.preferences ?? {};
    const slotCount = preferences.pageSize ?? 5;
    const windowStart = Date.parse(args.startTime);
    const windowEnd = Date.parse(args.endTime);

    const response = await client.freebusy.query({
      requestBody: {
        timeMin: args.startTime,
        timeMax: args.endTime,
        timeZone,
        items: [
          { id: 'primary' },
          ...args.attendeeEmails.map((email) => ({ id: email })),
        ],
      },
    });

    const busy = mergeBusy(
      Object.values(response.data.calendars ?? {}).flatMap((calendar) =>
        (calendar?.busy ?? []).flatMap((interval) => {
          const start = interval.start ? Date.parse(interval.start) : Number.NaN;
          const end = interval.end ? Date.parse(interval.end) : Number.NaN;
          return Number.isFinite(start) && Number.isFinite(end) ? [{ start, end }] : [];
        }),
      ),
    );

    const slots: {
      start: { dateTime: string; timeZone?: string };
      end: { dateTime: string; timeZone?: string };
      startTime: string;
      endTime: string;
      durationMinutes: number;
    }[] = [];

    const step = durationMinutes * 60_000;
    for (let start = windowStart; start + step <= windowEnd && slots.length < slotCount; start += step) {
      const end = start + step;
      const startDate = new Date(start);
      const endDate = new Date(end);

      if (preferences.excludeWeekends && (isWeekend(startDate, timeZone) || isWeekend(endDate, timeZone))) {
        continue;
      }
      if (preferences.startHour || preferences.endHour) {
        const startMinute = localHour(startDate, timeZone) * 60 + Number(localPart(startDate, timeZone, { minute: '2-digit' }));
        const endMinute = localHour(endDate, timeZone) * 60 + Number(localPart(endDate, timeZone, { minute: '2-digit' }));
        if (preferences.startHour && startMinute < minutesOfDay(preferences.startHour)) continue;
        if (preferences.endHour && endMinute > minutesOfDay(preferences.endHour)) continue;
      }
      if (busy.some((interval) => start < interval.end && end > interval.start)) continue;

      const iso = (date: Date) => date.toISOString();
      slots.push({
        start: { dateTime: iso(startDate), ...(args.timeZone ? { timeZone } : {}) },
        end: { dateTime: iso(endDate), ...(args.timeZone ? { timeZone } : {}) },
        startTime: iso(startDate),
        endTime: iso(endDate),
        durationMinutes,
      });
    }

    return { timeSlots: slots };
  },
);
