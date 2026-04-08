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
  for (const userId of ids) {
    sseHub.broadcast(userId, "timeline", payload);
  }
}
