import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { db } from "db";
import { notifications } from "db/schema";
import { notificationRowToEvent } from "../lib/notification-broadcast.js";
import { sseHub } from "../lib/sse-hub.js";
import type { AuthVariables } from "../middleware/session.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

export const notificationsRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware)
  .get("/", requireUser, async (c) => {
    const userId = c.get("userId")!;

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(100);

    return c.json({
      notifications: rows.map((row) => notificationRowToEvent(row)),
    });
  })
  .patch("/:id/read", requireUser, async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) {
      return c.json({ error: "Invalid notification id" }, 400);
    }
    const userId = c.get("userId")!;
    const now = new Date();

    const [updated] = await db
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning();

    if (!updated) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.json({ notification: notificationRowToEvent(updated) });
  })
  .get("/stream", async (c) => {
    const userId = c.get("userId");
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    return streamSSE(c, async (stream) => {
      const writer: (event: object) => Promise<void> = async (event) => {
        await stream.writeSSE({
          event: "notification",
          data: JSON.stringify(event),
        });
      };

      const unsubscribe = sseHub.subscribe(userId, writer);
      stream.onAbort(() => {
        unsubscribe();
      });

      const PING_MS = 30_000;

      try {
        while (!stream.aborted) {
          await stream.sleep(PING_MS);
          if (stream.aborted) break;
          await stream.writeSSE({
            event: "ping",
            data: "{}",
          });
        }
      } finally {
        unsubscribe();
      }
    });
  });
