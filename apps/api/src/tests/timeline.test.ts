import { describe, expect, it } from "vitest";
import {
  effectiveOrgTaskWindow,
  intervalsOverlap,
  mergeTimelineSources,
} from "../services/timeline.js";

describe("mergeTimelineSources", () => {
  it("maps schedule rows with sourceType schedule and stable sourceId", () => {
    const scheduleId = "0192a000-0000-7000-8000-0000000000aa";
    const merged = mergeTimelineSources({
      schedule: [
        {
          id: scheduleId,
          title: "Lecture",
          startsAt: new Date("2026-04-02T10:00:00.000Z"),
          endsAt: new Date("2026-04-02T11:00:00.000Z"),
          location: "Hall A",
        },
      ],
      plans: [],
      orgTasks: [],
      leagueCoordination: [],
    });

    expect(merged).toHaveLength(1);
    const row = merged[0]!;
    expect(row.sourceType).toBe("schedule");
    expect(row.sourceId).toBe(scheduleId);
    expect(row.title).toBe("Lecture");
    expect(row.meta).toEqual({ location: "Hall A" });
  });

  it("sorts by startsAt ascending across sources", () => {
    const merged = mergeTimelineSources({
      schedule: [
        {
          id: "s1",
          title: "Late",
          startsAt: new Date("2026-04-02T12:00:00.000Z"),
          endsAt: new Date("2026-04-02T13:00:00.000Z"),
        },
      ],
      plans: [
        {
          id: "p1",
          title: "Early",
          startsAt: new Date("2026-04-02T09:00:00.000Z"),
          endsAt: new Date("2026-04-02T09:30:00.000Z"),
        },
      ],
      orgTasks: [
        {
          id: "t1",
          title: "Mid",
          startsAt: new Date("2026-04-02T11:00:00.000Z"),
          endsAt: new Date("2026-04-02T11:30:00.000Z"),
          sourceMeta: { assignmentId: "a1" },
        },
      ],
      leagueCoordination: [],
    });

    expect(merged.map((m) => m.title)).toEqual(["Early", "Mid", "Late"]);
  });

  it("includes league_coordination with meta.category and sorts with other sources", () => {
    const merged = mergeTimelineSources({
      schedule: [],
      plans: [
        {
          id: "p1",
          title: "Plan",
          startsAt: new Date("2026-04-02T15:00:00.000Z"),
          endsAt: new Date("2026-04-02T16:00:00.000Z"),
        },
      ],
      orgTasks: [],
      leagueCoordination: [
        {
          id: "c1",
          title: "Volunteer drive",
          startsAt: new Date("2026-04-02T09:00:00.000Z"),
          endsAt: new Date("2026-04-02T10:00:00.000Z"),
          category: "volunteer",
          description: "Hall",
        },
      ],
    });
    expect(merged.map((m) => m.sourceType)).toEqual([
      "league_coordination",
      "plan",
    ]);
    const row = merged.find((m) => m.sourceType === "league_coordination")!;
    expect(row.meta).toMatchObject({ category: "volunteer" });
  });
});

describe("intervalsOverlap", () => {
  it("detects overlap", () => {
    const a0 = new Date("2026-01-01T00:00:00.000Z");
    const a1 = new Date("2026-01-02T00:00:00.000Z");
    const b0 = new Date("2026-01-01T12:00:00.000Z");
    const b1 = new Date("2026-01-03T00:00:00.000Z");
    expect(intervalsOverlap(a0, a1, b0, b1)).toBe(true);
  });
});

describe("effectiveOrgTaskWindow", () => {
  it("uses now when bounds are missing", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const w = effectiveOrgTaskWindow(null, null, now);
    expect(w.startsAt.getTime()).toBe(now.getTime());
    expect(w.endsAt.getTime()).toBe(now.getTime());
  });
});
