import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "db";
import { leagueCoordinationEvents } from "db/schema";
import { broadcastTimelineRefresh } from "../lib/timeline-broadcast.js";
import { requireRoles } from "../middleware/rbac.js";
import type { AuthVariables } from "../middleware/session.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

const isoDate = z.string().datetime({ offset: true }).transform((s) => new Date(s));

const categoryEnum = z.enum(["practice", "volunteer", "work_study", "general"]);

const createCoordinationSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    category: categoryEnum,
    startsAt: isoDate,
    endsAt: isoDate,
  })
  .strict();

const patchCoordinationSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    category: categoryEnum.optional(),
    startsAt: isoDate.optional(),
    endsAt: isoDate.optional(),
  })
  .strict();

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

function rowToItem(row: typeof leagueCoordinationEvents.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    category: row.category as string,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | null> {
  return c.req.json().catch(() => null);
}

export const coordinationRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware, requireUser, requireRoles("league_admin"))
  .get("/", async (c) => {
    const rows = await db
      .select()
      .from(leagueCoordinationEvents)
      .orderBy(asc(leagueCoordinationEvents.startsAt));
    return c.json({ items: rows.map(rowToItem) });
  })
  .post("/", async (c) => {
    const userId = c.get("userId")!;
    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = createCoordinationSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }
    const { title, description, category, startsAt, endsAt } = parsed.data;
    if (startsAt >= endsAt) {
      return c.json({ error: "startsAt must be before endsAt" }, 400);
    }

    const [row] = await db
      .insert(leagueCoordinationEvents)
      .values({
        title,
        description: description ?? null,
        category,
        startsAt,
        endsAt,
        createdByUserId: userId,
      })
      .returning();

    await broadcastTimelineRefresh({
      kind: "timeline_refresh",
      action: "upsert",
      coordinationEventId: row!.id,
    });

    return c.json({ item: rowToItem(row!) }, 201);
  })
  .patch("/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = patchCoordinationSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }
    const patch = parsed.data;
    if (Object.keys(patch).length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    const [existing] = await db
      .select()
      .from(leagueCoordinationEvents)
      .where(eq(leagueCoordinationEvents.id, id))
      .limit(1);
    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }

    const nextStarts = patch.startsAt ?? existing.startsAt;
    const nextEnds = patch.endsAt ?? existing.endsAt;
    if (nextStarts >= nextEnds) {
      return c.json({ error: "startsAt must be before endsAt" }, 400);
    }

    const updateValues: Partial<typeof leagueCoordinationEvents.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (patch.title !== undefined) updateValues.title = patch.title;
    if (patch.description !== undefined) updateValues.description = patch.description ?? null;
    if (patch.category !== undefined) updateValues.category = patch.category;
    if (patch.startsAt !== undefined) updateValues.startsAt = patch.startsAt;
    if (patch.endsAt !== undefined) updateValues.endsAt = patch.endsAt;

    const [row] = await db
      .update(leagueCoordinationEvents)
      .set(updateValues)
      .where(eq(leagueCoordinationEvents.id, id))
      .returning();

    await broadcastTimelineRefresh({
      kind: "timeline_refresh",
      action: "upsert",
      coordinationEventId: row!.id,
    });

    return c.json({ item: rowToItem(row!) });
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (!isUuid(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const deleted = await db
      .delete(leagueCoordinationEvents)
      .where(eq(leagueCoordinationEvents.id, id))
      .returning({ id: leagueCoordinationEvents.id });

    if (deleted.length === 0) {
      return c.json({ error: "Not found" }, 404);
    }

    await broadcastTimelineRefresh({
      kind: "timeline_refresh",
      action: "delete",
      coordinationEventId: id,
    });

    return c.body(null, 204);
  });
