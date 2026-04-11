import { sseHub } from "./sse-hub.js";
import { listStudentUserIds } from "./students.js";

export type TimelineRefreshPayload = {
  kind: "timeline_refresh";
  action?: "upsert" | "delete";
  coordinationEventId?: string;
};

export async function broadcastTimelineRefresh(
  payload: TimelineRefreshPayload,
): Promise<void> {
  const ids = await listStudentUserIds();
  await broadcastTimelineRefreshToUserIds(ids, payload);
}

export async function broadcastTimelineRefreshToUserIds(
  userIds: string[],
  payload: TimelineRefreshPayload,
): Promise<void> {
  for (const userId of userIds) {
    sseHub.broadcast(userId, "timeline", payload);
  }
}
