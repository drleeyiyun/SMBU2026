import { describe, expect, it } from "vitest";
import { hoursFromRange } from "../services/archive-volunteer-sync.js";

describe("archive volunteer sync", () => {
  it("hoursFromRange rounds to two decimals", () => {
    const start = new Date("2026-04-01T09:30:00.000Z");
    const end = new Date("2026-04-01T12:00:00.000Z");
    expect(hoursFromRange(start, end)).toBe(2.5);
  });
});
