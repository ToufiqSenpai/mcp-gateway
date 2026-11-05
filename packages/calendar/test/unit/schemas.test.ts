import { describe, expect, it } from "vitest"

import { googleEventType } from "../../src/schemas"

describe("googleEventType", () => {
  it("maps the tool enum to the REST spelling", () => {
    expect(googleEventType("OUT_OF_OFFICE")).toBe("outOfOffice")
    expect(googleEventType("FOCUS_TIME")).toBe("focusTime")
    expect(googleEventType("FROM_GMAIL")).toBe("fromGmail")
    expect(googleEventType("WORKING_LOCATION")).toBe("workingLocation")
    expect(googleEventType("BIRTHDAY")).toBe("birthday")
    expect(googleEventType("DEFAULT")).toBe("default")
  })
})
