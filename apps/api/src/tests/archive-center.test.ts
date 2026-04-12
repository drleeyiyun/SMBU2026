import { describe, expect, it } from "vitest";
import {
  hoursFromRange,
  resolveVolunteerBaseHoursForEvent,
  resolveVolunteerHoursForClaim,
} from "../services/archive-volunteer-sync.js";

const rangeEvent = {
  startsAt: new Date("2026-04-01T09:30:00.000Z"),
  endsAt: new Date("2026-04-01T12:00:00.000Z"),
  defaultVolunteerHours: null as string | null,
};

describe("archive volunteer sync", () => {
  it("hoursFromRange rounds to two decimals", () => {
    const start = new Date("2026-04-01T09:30:00.000Z");
    const end = new Date("2026-04-01T12:00:00.000Z");
    expect(hoursFromRange(start, end)).toBe(2.5);
  });

  it("resolveVolunteerHoursForClaim prefers explicit claim hours", () => {
    expect(resolveVolunteerHoursForClaim("1.25", rangeEvent)).toBe(1.25);
  });

  it("resolveVolunteerHoursForClaim uses event default before range", () => {
    expect(
      resolveVolunteerHoursForClaim(null, {
        ...rangeEvent,
        defaultVolunteerHours: "4",
      }),
    ).toBe(4);
  });

  it("resolveVolunteerHoursForClaim falls back to duration", () => {
    expect(resolveVolunteerHoursForClaim(null, rangeEvent)).toBe(2.5);
  });

  it("resolveVolunteerBaseHoursForEvent ignores claim and matches default or range", () => {
    expect(
      resolveVolunteerBaseHoursForEvent({
        ...rangeEvent,
        defaultVolunteerHours: "3",
      }),
    ).toBe(3);
    expect(resolveVolunteerBaseHoursForEvent(rangeEvent)).toBe(2.5);
  });
});
