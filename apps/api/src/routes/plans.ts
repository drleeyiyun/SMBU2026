import { and, asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "db";
import { personalPlans } from "db/schema";
import type { AuthVariables } from "../middleware/session.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

const isoDate = z.string().datetime({ offset: true }).transform((s) => new Date(s));

const createPlanSchema = z
  .object({
    title: z.string().min(1),
    startsAt: isoDate,
    endsAt: isoDate,
    priority: z.number().int().optional(),
    status: z.string().min(1).optional(),
    onTimeline: z.boolean().optional(),
  })
  .strict();

const patchPlanSchema = z
  .object({
    title: z.string().min(1).optional(),
    startsAt: isoDate.optional(),
    endsAt: isoDate.optional(),
    priority: z.number().int().optional(),
    status: z.string().min(1).optional(),
    onTimeline: z.boolean().optional(),
  })
  .strict();

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

function planToJson(row: typeof personalPlans.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    priority: row.priority,
    status: row.status,
    onTimeline: row.onTimeline,
    createdAt: row.createdAt.toISOString(),
  };
}

async function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | null> {
  return c.req.json().catch(() => null);
}

export const plansRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware, requireUser)
  .get("/", async (c) => {
    const userId = c.get("userId")!;
    const sort = c.req.query("sort");
    const order =
      sort === "priority"
        ? [desc(personalPlans.priority), asc(personalPlans.startsAt)]
        : [asc(personalPlans.startsAt)];
    const rows = await db
      .select()
      .from(personalPlans)
      .where(eq(personalPlans.userId, userId))
      .orderBy(...order);
    return c.json({ plans: rows.map(planToJson) });
  })
  .post("/", async (c) => {
    const userId = c.get("userId")!;
    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = createPlanSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }
    const { title, startsAt, endsAt, priority, status, onTimeline } = parsed.data;
    if (startsAt >= endsAt) {
      return c.json({ error: "startsAt must be before endsAt" }, 400);
    }

    const [row] = await db
      .insert(personalPlans)
      .values({
        userId,
        title,
        startsAt,
        endsAt,
        priority: priority ?? 1,
        status: status ?? "planned",
        onTimeline: onTimeline ?? true,
      })
      .returning();

    return c.json({ plan: planToJson(row!) }, 201);
  })
  .patch("/:planId", async (c) => {
    const userId = c.get("userId")!;
    const planId = c.req.param("planId");
    if (!isUuid(planId)) {
      return c.json({ error: "Invalid plan id" }, 400);
    }

    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = patchPlanSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }
    const patch = parsed.data;
    if (Object.keys(patch).length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    const [existing] = await db
      .select()
      .from(personalPlans)
      .where(and(eq(personalPlans.id, planId), eq(personalPlans.userId, userId)))
      .limit(1);
    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }

    const nextStarts = patch.startsAt ?? existing.startsAt;
    const nextEnds = patch.endsAt ?? existing.endsAt;
    if (nextStarts >= nextEnds) {
      return c.json({ error: "startsAt must be before endsAt" }, 400);
    }

    const set: {
      title?: string;
      startsAt?: Date;
      endsAt?: Date;
      priority?: number;
      status?: string;
      onTimeline?: boolean;
    } = {};
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.startsAt !== undefined) set.startsAt = patch.startsAt;
    if (patch.endsAt !== undefined) set.endsAt = patch.endsAt;
    if (patch.priority !== undefined) set.priority = patch.priority;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.onTimeline !== undefined) set.onTimeline = patch.onTimeline;

    const [updated] = await db
      .update(personalPlans)
      .set(set)
      .where(and(eq(personalPlans.id, planId), eq(personalPlans.userId, userId)))
      .returning();

    return c.json({ plan: planToJson(updated!) });
  })
  .delete("/:planId", async (c) => {
    const userId = c.get("userId")!;
    const planId = c.req.param("planId");
    if (!isUuid(planId)) {
      return c.json({ error: "Invalid plan id" }, 400);
    }

    const deleted = await db
      .delete(personalPlans)
      .where(and(eq(personalPlans.id, planId), eq(personalPlans.userId, userId)))
      .returning({ id: personalPlans.id });

    if (deleted.length === 0) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.json({ ok: true });
  });
