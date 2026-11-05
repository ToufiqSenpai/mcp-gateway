import { defineTool } from "@mcp-gateway/common"
import { z } from "zod"

import { accountSchema, dateTimeSchema } from "../schemas"
import type { ToolContext } from "./tool-context"

interface Interval {
  start: number
  end: number
}

interface SlotBoundary {
  dateTime: string
  timeZone?: string
}

interface TimeSlot {
  start: SlotBoundary
  end: SlotBoundary
  startTime: string
  endTime: string
  durationMinutes: number
}

const preferencesSchema = z
  .object({
    startHour: z.iso.time({ precision: -1 }).optional().describe('Preferred start hour as "HH:mm" (24-hour format).'),
    endHour: z.iso.time({ precision: -1 }).optional().describe('Preferred end hour as "HH:mm" (24-hour format).'),
    excludeWeekends: z.boolean().optional().describe("Exclude weekends."),
    pageSize: z.number().int().min(1).max(50).optional().describe("Max number of slots to return. Default: 5.")
  })
  .describe("Preferences to find suggested time.")

type Preferences = z.infer<typeof preferencesSchema>

function mergeBusy(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((left, right) => left.start - right.start)
  const merged: Interval[] = []
  for (const interval of sorted) {
    const last = merged.at(-1)
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end)
    } else {
      merged.push({ ...interval })
    }
  }
  return merged
}

function localPart(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(date)
}

function localHour(date: Date, timeZone: string): number {
  return Number(localPart(date, timeZone, { hour: "2-digit", hour12: false }))
}

function isWeekend(date: Date, timeZone: string): boolean {
  const weekday = localPart(date, timeZone, { weekday: "short" })
  return weekday === "Sat" || weekday === "Sun"
}

function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(":").map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

const inputSchema = z.object({
  account: accountSchema,
  attendeeEmails: z.array(z.email()).min(1).describe("Required. Attendee emails to find free time for."),
  startTime: dateTimeSchema.describe("Required. Query interval start (ISO 8601)."),
  endTime: dateTimeSchema.describe("Required. Query interval end (ISO 8601)."),
  durationMinutes: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Optional. Min duration of free slot in minutes. Default: 30."),
  timeZone: z
    .string()
    .optional()
    .describe(
      "Optional. Time zone for search times (IANA ID, for example Europe/Zurich). Default: the offset of startTime, if none then the user's primary time zone."
    ),
  preferences: preferencesSchema.optional()
})

function slotAllowed(
  start: number,
  end: number,
  preferences: Preferences,
  timeZone: string,
  busy: Interval[]
): boolean {
  const startDate = new Date(start)
  const endDate = new Date(end)

  if (preferences.excludeWeekends && (isWeekend(startDate, timeZone) || isWeekend(endDate, timeZone))) {
    return false
  }
  if (preferences.startHour || preferences.endHour) {
    const startMinute =
      localHour(startDate, timeZone) * 60 + Number(localPart(startDate, timeZone, { minute: "2-digit" }))
    const endMinute = localHour(endDate, timeZone) * 60 + Number(localPart(endDate, timeZone, { minute: "2-digit" }))
    if (preferences.startHour && startMinute < minutesOfDay(preferences.startHour)) return false
    if (preferences.endHour && endMinute > minutesOfDay(preferences.endHour)) return false
  }
  return !busy.some(interval => start < interval.end && end > interval.start)
}

function toTimeSlot(start: number, end: number, durationMinutes: number, timeZone?: string): TimeSlot {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const slotStart: SlotBoundary = { dateTime: startDate.toISOString() }
  const slotEnd: SlotBoundary = { dateTime: endDate.toISOString() }
  if (timeZone) {
    slotStart.timeZone = timeZone
    slotEnd.timeZone = timeZone
  }
  return {
    start: slotStart,
    end: slotEnd,
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
    durationMinutes
  }
}

export const suggestTimeTool = defineTool(
  "suggest_time",
  {
    title: "Suggest a meeting time",
    description: "Suggests time periods across one or more calendars.",
    inputSchema,
    annotations: { readOnlyHint: true, idempotentHint: true }
  },
  async (args, context: ToolContext) => {
    const slug = await context.resolve(args.account)
    const client = context.calendar(slug)
    const timeZone = args.timeZone ?? "UTC"
    const durationMinutes = args.durationMinutes ?? 30
    const preferences = args.preferences ?? {}
    const slotCount = preferences.pageSize ?? 5
    const windowStart = Date.parse(args.startTime)
    const windowEnd = Date.parse(args.endTime)

    const response = await client.freebusy.query({
      requestBody: {
        timeMin: args.startTime,
        timeMax: args.endTime,
        timeZone,
        items: [{ id: "primary" }, ...args.attendeeEmails.map(email => ({ id: email }))]
      }
    })

    const busy = mergeBusy(
      Object.values(response.data.calendars ?? {}).flatMap(calendar =>
        (calendar.busy ?? []).flatMap(interval => {
          const start = interval.start ? Date.parse(interval.start) : Number.NaN
          const end = interval.end ? Date.parse(interval.end) : Number.NaN
          return Number.isFinite(start) && Number.isFinite(end) ? [{ start, end }] : []
        })
      )
    )

    const slots: TimeSlot[] = []

    const step = durationMinutes * 60_000
    for (let start = windowStart; start + step <= windowEnd && slots.length < slotCount; start += step) {
      const end = start + step
      if (!slotAllowed(start, end, preferences, timeZone, busy)) continue
      slots.push(toTimeSlot(start, end, durationMinutes, args.timeZone))
    }

    return { timeSlots: slots }
  }
)
