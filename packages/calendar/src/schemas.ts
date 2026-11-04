import { z } from 'zod';

/**
 * Times are exactly as Google documents them: `dateTime` carries an offset or trailing `Z`,
 * `date` is a midnight-UTC timestamp, and a named zone goes in `timeZone` only when the user
 * named one.
 */
export const dateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/,
    'Must be an ISO 8601 dateTime with an offset or trailing Z, e.g. 2019-11-20T08:19:06-07:00',
  );

export const dateSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/,
    'Must be a midnight-UTC timestamp, e.g. 2019-11-20T00:00:00Z',
  );

export const dateOrDateTimeSchema = z.object({
  date: dateSchema.optional(),
  dateTime: dateTimeSchema.optional(),
  timeZone: z.string().optional(),
});

export const accountSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Account slug. Defaults to the Default Account for this MCP.');

export const pageSizeSchema = z
  .number()
  .int()
  .min(1)
  .max(250)
  .optional()
  .describe('Page size, default 100, maximum 250.');

export const pageTokenSchema = z
  .string()
  .optional()
  .describe('Opaque cursor from a previous response. Empty string means the first page.');

export const attendeeSchema = z.object({
  email: z.string(),
  optional: z.boolean().optional(),
  responseStatus: z.string().optional(),
  comment: z.string().optional(),
  additionalGuests: z.number().int().optional(),
  displayName: z.string().optional(),
});

export const attachmentSchema = z.object({
  fileUrl: z.string(),
  title: z.string().optional(),
  mimeType: z.string().optional(),
});

export const reminderSchema = z.object({
  method: z.enum(['email', 'popup']),
  minutes: z.number().int(),
});

export const eventTypeSchema = z.enum([
  'EVENT_TYPE_UNSPECIFIED',
  'DEFAULT',
  'OUT_OF_OFFICE',
  'FOCUS_TIME',
  'WORKING_LOCATION',
  'BIRTHDAY',
  'FROM_GMAIL',
]);

export const orderBySchema = z.enum(['default', 'startTime', 'startTimeDesc', 'lastModified']);

export const notificationLevelSchema = z.enum([
  'NOTIFICATION_LEVEL_UNSPECIFIED',
  'NONE',
  'EXTERNAL_ONLY',
  'ALL',
]);

export const availabilitySchema = z.enum([
  'AVAILABILITY_UNSPECIFIED',
  'AVAILABILITY_BUSY',
  'AVAILABILITY_FREE',
]);

export const visibilitySchema = z.enum(['default', 'public', 'private']);

export const responseStatusSchema = z.enum(['declined', 'tentative', 'accepted']);

export type EventType = z.infer<typeof eventTypeSchema>;
export type OrderBy = z.infer<typeof orderBySchema>;
export type NotificationLevel = z.infer<typeof notificationLevelSchema>;
export type ResponseStatus = z.infer<typeof responseStatusSchema>;

/** `ALL` is the documented default of the tool surface, while REST defaults to sending nothing. */
export function sendUpdatesFor(level: NotificationLevel | undefined): string {
  switch (level) {
    case 'NONE':
      return 'none';
    case 'EXTERNAL_ONLY':
      return 'externalOnly';
    default:
      return 'all';
  }
}
