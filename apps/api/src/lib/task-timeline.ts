import type { orgTaskHandoffs, orgTaskStatusEvents } from "db/schema";

type StatusRow = typeof orgTaskStatusEvents.$inferSelect;
type HandoffRow = typeof orgTaskHandoffs.$inferSelect;

export type TaskTimelineItem =
  | {
      type: "status";
      id: string;
      at: string;
      fromStatus: string | null;
      toStatus: string;
      assignmentId: string | null;
      actorUserId: string | null;
    }
  | {
      type: "handoff";
      id: string;
      at: string;
      fromUserId: string | null;
      toUserId: string | null;
      note: string | null;
    };

export function mergeTaskTimelineItems(
  statusRows: StatusRow[],
  handoffRows: HandoffRow[],
): TaskTimelineItem[] {
  const items: TaskTimelineItem[] = [];
  for (const s of statusRows) {
    items.push({
      type: "status",
      id: s.id,
      at: s.createdAt.toISOString(),
      fromStatus: s.fromStatus,
      toStatus: s.toStatus,
      assignmentId: s.assignmentId,
      actorUserId: s.actorUserId,
    });
  }
  for (const h of handoffRows) {
    items.push({
      type: "handoff",
      id: h.id,
      at: h.createdAt.toISOString(),
      fromUserId: h.fromUserId,
      toUserId: h.toUserId,
      note: h.note,
    });
  }
  items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return items;
}
