import { and, asc, eq, gte, lte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "db";
import { scheduleItemsCache } from "db/schema";
import { loadEnv } from "../env.js";
import type { AuthVariables } from "../middleware/session.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";
import { createSchoolGateway } from "../services/school-gateway.js";

const isoOptional = z
  .string()
  .datetime({ offset: true })
  .optional()
  .transform((s) => (s === undefined ? undefined : new Date(s)));

const syncBodySchema = z.object({
  from: isoOptional,
  to: isoOptional,
});

const queryRangeSchema = z.object({
  from: isoOptional,
  to: isoOptional,
});

function defaultSyncRange(): { from: Date; to: Date } {
  const from = new Date();
  const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { from, to };
}

export const scheduleRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware, requireUser)
  .post("/sync", async (c) => {
    const userId = c.get("userId")!;

    let raw: unknown = {};
    try {
      const text = await c.req.text();
      if (text.trim() !== "") {
        raw = JSON.parse(text) as unknown;
      }
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const parsed = syncBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }

    let { from, to } = parsed.data;
    if (from === undefined && to === undefined) {
      const d = defaultSyncRange();
      from = d.from;
      to = d.to;
    } else if (from === undefined || to === undefined) {
      return c.json({ error: "from and to must both be set or both omitted" }, 400);
    }

    if (from >= to) {
      return c.json({ error: "from must be before to" }, 400);
    }

    const env = loadEnv();
    const gateway = createSchoolGateway(env);

    let items;
    try {
      items = await gateway.getSchedule({ userId, from, to });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Schedule fetch failed";
      return c.json({ error: message }, 501);
    }

    const batchId = crypto.randomUUID();
    const fetchedAt = new Date();

    await db.delete(scheduleItemsCache).where(eq(scheduleItemsCache.userId, userId));

    if (items.length > 0) {
      await db.insert(scheduleItemsCache).values(
        items.map((row) => ({
          userId,
          title: row.title,
          location: row.location,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          batchId,
          fetchedAt,
        })),
      );
    }

    return c.json({
      ok: true,
      batchId,
      fetchedAt: fetchedAt.toISOString(),
      count: items.length,
    });
  })
  .get("/", async (c) => {
    const userId = c.get("userId")!;

    const q = queryRangeSchema.safeParse({
      from: c.req.query("from") ?? undefined,
      to: c.req.query("to") ?? undefined,
    });
    if (!q.success) {
      return c.json({ error: "Invalid query", details: q.error.flatten() }, 400);
    }

    const { from, to } = q.data;
    if ((from === undefined) !== (to === undefined)) {
      return c.json({ error: "from and to must both be set or both omitted" }, 400);
    }
    if (from !== undefined && to !== undefined && from >= to) {
      return c.json({ error: "from must be before to" }, 400);
    }

    const conditions = [eq(scheduleItemsCache.userId, userId)];
    if (from !== undefined && to !== undefined) {
      conditions.push(gte(scheduleItemsCache.startsAt, from));
      conditions.push(lte(scheduleItemsCache.startsAt, to));
    }

    const rows = await db
      .select({
        id: scheduleItemsCache.id,
        title: scheduleItemsCache.title,
        location: scheduleItemsCache.location,
        startsAt: scheduleItemsCache.startsAt,
        endsAt: scheduleItemsCache.endsAt,
        batchId: scheduleItemsCache.batchId,
        fetchedAt: scheduleItemsCache.fetchedAt,
      })
      .from(scheduleItemsCache)
      .where(and(...conditions))
      .orderBy(asc(scheduleItemsCache.startsAt));

    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        location: r.location,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        batchId: r.batchId,
        fetchedAt: r.fetchedAt.toISOString(),
      })),
    });
  });
