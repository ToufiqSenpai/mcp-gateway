import { describe, expect, it } from "vitest"

import { toAttendeeList, toEvent, toWorkingLocationPropertiesInput } from "../../src/map"

describe("calendar map", () => {
  it("maps the REST attendee fields to the tool surface", () => {
    const event = toEvent({
      attendees: [{ id: "1", email: "a@example.com", optional: true, resource: true, additionalGuests: 2 }]
    })

    expect(event.attendees?.[0]).toEqual({
      id: "1",
      email: "a@example.com",
      optionalAttendee: true,
      resource: true,
      additionalGuests: 2
    })
  })

  it("maps tool-surface attendees back to REST", () => {
    expect(
      toAttendeeList([{ email: "a@example.com", optionalAttendee: true, resource: true, additionalGuests: 2 }])
    ).toEqual([{ email: "a@example.com", optional: true, resource: true, additionalGuests: 2 }])
  })

  it("maps guest permissions and working location in both directions", () => {
    const event = toEvent({
      guestsCanInviteOthers: true,
      guestsCanModify: false,
      guestsCanSeeOtherGuests: false,
      workingLocationProperties: { type: "customLocation", customLocation: { label: "Cafe" } }
    })

    expect(event.guestPermissions).toEqual({
      guestsCanInviteOthers: true,
      guestsCanModify: false,
      guestsCanSeeGuests: false
    })
    expect(event.workingLocationProperties).toEqual({ type: "CUSTOM_LOCATION", customLocationLabel: "Cafe" })
    expect(toWorkingLocationPropertiesInput(event.workingLocationProperties ?? {})).toEqual({
      type: "customLocation",
      customLocation: { label: "Cafe" }
    })
  })
})
