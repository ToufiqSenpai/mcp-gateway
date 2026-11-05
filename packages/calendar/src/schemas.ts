import { z } from "zod"

/**
 * Times are exactly as Google documents them: `dateTime` carries an offset or trailing `Z`,
 * `date` is a midnight-UTC timestamp, and a named zone goes in `timeZone` only when the user
 * named one.
 */
export const dateTimeSchema = z.iso
  .datetime({
    offset: true,
    error: "Must be an ISO 8601 dateTime with an offset or trailing Z, e.g. 2019-11-20T08:19:06-07:00"
  })
  .describe("ISO 8601 timestamp with an offset or trailing Z, for example '2019-11-20T08:19:06-07:00'.")

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/, "Must be a midnight-UTC timestamp, e.g. 2019-11-20T00:00:00Z")
  .describe("ISO 8601 date at midnight UTC, for example '2019-11-20T00:00:00Z'.")

export const dateOrDateTimeSchema = z
  .object({
    date: dateSchema.optional(),
    dateTime: dateTimeSchema.optional(),
    timeZone: z.string().optional().describe("TZDB timezone name, for example 'Asia/Jakarta'.")
  })
  .describe("A date or a date-time, with an optional timezone name.")

export const accountSchema = z
  .string()
  .min(1)
  .optional()
  .describe("Account slug. Defaults to the Default Account for this MCP.")

export const pageSizeSchema = z
  .number()
  .int()
  .min(1)
  .max(250)
  .optional()
  .describe("Max results per page. Default 100, max 250.")

export const pageTokenSchema = z
  .string()
  .optional()
  .describe("Opaque cursor from a previous response's nextPageToken. Omit for the first page.")

export const attendeeSchema = z.object({
  email: z.email().describe("Required. Attendee's email address."),
  displayName: z.string().optional().describe("Optional. Name."),
  optionalAttendee: z.boolean().optional().describe("Optional. Whether the attendee is optional. Default: false."),
  resource: z
    .boolean()
    .optional()
    .describe("Optional. Whether the attendee is a resource (for example, a room). Immutable after creation."),
  responseStatus: z.string().optional().describe("Optional. needsAction, declined, tentative, or accepted."),
  comment: z.string().optional().describe("Optional. Response comment."),
  additionalGuests: z.number().int().optional().describe("Optional. Number of additional guests. Default: 0.")
})

export const attachmentSchema = z.object({
  fileUrl: z.url().describe("Required. URL link to the attachment."),
  title: z.string().optional().describe("Optional. Attachment title."),
  mimeType: z.string().optional().describe("Optional. MIME type of the attachment.")
})

export const reminderSchema = z.object({
  method: z.enum(["email", "popup"]).describe("Required. Delivery method: email or popup."),
  minutes: z.number().int().describe("Required. Minutes in advance that the reminder is triggered.")
})

export const guestPermissionsSchema = z.object({
  guestsCanInviteOthers: z.boolean().optional().describe("Optional. Whether guests can invite others."),
  guestsCanModify: z.boolean().optional().describe("Optional. Whether guests can modify the event."),
  guestsCanSeeGuests: z.boolean().optional().describe("Optional. Whether guests can see other guests.")
})

export const eventTypeSchema = z
  .enum([
    "EVENT_TYPE_UNSPECIFIED",
    "DEFAULT",
    "OUT_OF_OFFICE",
    "FOCUS_TIME",
    "WORKING_LOCATION",
    "BIRTHDAY",
    "FROM_GMAIL"
  ])
  .describe(
    "Event type. Immutable after creation. EVENT_TYPE_UNSPECIFIED is treated as DEFAULT; FROM_GMAIL cannot be created."
  )

export const orderBySchema = z
  .enum(["default", "startTime", "startTimeDesc", "lastModified"])
  .describe("Order of returned events: default, startTime ascending, startTimeDesc, or lastModified.")

export const notificationLevelSchema = z
  .enum(["NOTIFICATION_LEVEL_UNSPECIFIED", "NONE", "EXTERNAL_ONLY", "ALL"])
  .describe("Email notification level: NOTIFICATION_LEVEL_UNSPECIFIED (treated as ALL), NONE, EXTERNAL_ONLY, or ALL.")

export const availabilitySchema = z
  .enum(["AVAILABILITY_UNSPECIFIED", "AVAILABILITY_BUSY", "AVAILABILITY_FREE"])
  .describe(
    "Availability: AVAILABILITY_UNSPECIFIED (treated as BUSY), AVAILABILITY_BUSY blocks time, AVAILABILITY_FREE does not."
  )

export const visibilitySchema = z
  .enum(["default", "public", "private"])
  .describe("Visibility: default, public, or private.")

export const responseStatusSchema = z
  .enum(["declined", "tentative", "accepted"])
  .describe("The user's response: declined, tentative, or accepted.")

export const workingLocationTypeSchema = z
  .enum(["WORKING_LOCATION_TYPE_UNSPECIFIED", "HOME_OFFICE", "CUSTOM_LOCATION"])
  .describe("Type of working location. WORKING_LOCATION_TYPE_UNSPECIFIED is treated as HOME_OFFICE.")

export const workingLocationPropertiesSchema = z
  .object({
    type: workingLocationTypeSchema.optional(),
    customLocationLabel: z
      .string()
      .optional()
      .describe("Optional. The label for a custom location. Required when type is CUSTOM_LOCATION.")
  })
  .refine(value => value.type !== "CUSTOM_LOCATION" || value.customLocationLabel !== undefined, {
    message: "customLocationLabel is required when type is CUSTOM_LOCATION",
    path: ["customLocationLabel"]
  })

export type EventType = z.infer<typeof eventTypeSchema>

/** The REST API spells event types in camelCase; the tool surface keeps the protobuf-style enum. */
const GOOGLE_EVENT_TYPE = {
  EVENT_TYPE_UNSPECIFIED: "default",
  DEFAULT: "default",
  OUT_OF_OFFICE: "outOfOffice",
  FOCUS_TIME: "focusTime",
  WORKING_LOCATION: "workingLocation",
  BIRTHDAY: "birthday",
  FROM_GMAIL: "fromGmail"
} as const satisfies Record<EventType, string>

export function googleEventType(type: EventType): string {
  return GOOGLE_EVENT_TYPE[type]
}
export type OrderBy = z.infer<typeof orderBySchema>
export type NotificationLevel = z.infer<typeof notificationLevelSchema>
export type ResponseStatus = z.infer<typeof responseStatusSchema>
export type GuestPermissions = z.infer<typeof guestPermissionsSchema>
export type WorkingLocationType = z.infer<typeof workingLocationTypeSchema>
export type WorkingLocationProperties = z.infer<typeof workingLocationPropertiesSchema>

/** `ALL` is the documented default of the tool surface, while REST defaults to sending nothing. */
export function sendUpdatesFor(level: NotificationLevel | undefined): string {
  switch (level) {
    case "NONE":
      return "none"
    case "EXTERNAL_ONLY":
      return "externalOnly"
    default:
      return "all"
  }
}
