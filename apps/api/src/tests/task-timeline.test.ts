import { describe, expect, it } from "vitest";
import { mergeTaskTimelineItems } from "../lib/task-timeline.js";

describe("mergeTaskTimelineItems", () => {
  it("merges status events and handoffs sorted by time", () => {
    const merged = mergeTaskTimelineItems(
      [
        {
          id: "s2",
          taskId: "t1",
          assignmentId: null,
          actorUserId: null,
          fromStatus: "read",
          toStatus: "in_progress",
          createdAt: new Date("2026-04-09T12:00:00.000Z"),
        },
        {
          id: "s1",
          taskId: "t1",
          assignmentId: null,
          actorUserId: null,
          fromStatus: "unread",
          toStatus: "read",
          createdAt: new Date("2026-04-09T10:00:00.000Z"),
        },
      ],
      [
        {
          id: "h1",
          taskId: "t1",
          fromUserId: "a",
          toUserId: "b",
          note: null,
          createdAt: new Date("2026-04-09T11:00:00.000Z"),
        },
      ],
    );

    expect(merged.map((e) => e.id)).toEqual(["s1", "h1", "s2"]);
    expect(merged.map((e) => e.type)).toEqual(["status", "handoff", "status"]);
  });
});
