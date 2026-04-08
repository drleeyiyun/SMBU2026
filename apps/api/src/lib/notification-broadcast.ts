import type { notifications } from "db/schema";
import { sseHub } from "./sse-hub.js";

export type NotificationRow = typeof notifications.$inferSelect;

export function notificationRowToEvent(row: NotificationRow): Record<string, unknown> {
  return {
    id: row.id,
    type: row.type,
    payload: JSON.parse(row.payloadJson) as unknown,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Call after a notification row is committed; fans out to SSE subscribers for that user. */
export function broadcastNotification(row: NotificationRow): void {
  sseHub.broadcast(row.userId, "notification", notificationRowToEvent(row));
}
