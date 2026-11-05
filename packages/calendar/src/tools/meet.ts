import type { calendar_v3 } from "@googleapis/calendar"

/** The Meet conference patch shared by create_event and update_event. */
export function meetConferenceData(input: {
  addGoogleMeetUrl?: boolean
  googleMeetUrl?: string
}): calendar_v3.Schema$ConferenceData | undefined {
  if (!input.addGoogleMeetUrl && !input.googleMeetUrl) return undefined
  const conferenceData: calendar_v3.Schema$ConferenceData = {}
  if (input.addGoogleMeetUrl) {
    conferenceData.createRequest = {
      requestId: crypto.randomUUID(),
      conferenceSolutionKey: { type: "hangoutsMeet" }
    }
  }
  if (input.googleMeetUrl) {
    conferenceData.entryPoints = [{ entryPointType: "video", uri: input.googleMeetUrl }]
  }
  return conferenceData
}
