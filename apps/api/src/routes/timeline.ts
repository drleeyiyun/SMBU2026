import { and, asc, eq, gte, lte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "db";
import {
  leagueCoordinationEvents,
  orgTaskAssignments,
  orgTasks,
  personalPlans,
  scheduleItemsCache,
} from "db/schema";
import type { AuthVariables } from "../middleware/session.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";
import {
  effectiveOrgTaskWindow,
  intervalsOverlap,
  mergeTimelineSources,
} from "../services/timeline.js";

const timelineQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .transform((q) => ({
    from: new Date(q.from),
    to: new Date(q.to),
  }));

export const timelineRouter = new Hono<{ Variables: AuthVariables }>().get(
  "/",
  sessionMiddleware,
  requireUser,
  async (c) => {
    const userId = c.get("userId")!;

    const parsed = timelineQuerySchema.safeParse({
      from: c.req.query("from") ?? undefined,
      to: c.req.query("to") ?? undefined,
    });
    if (!parsed.success) {
      return c.json({ error: "Invalid query", details: parsed.error.flatten() }, 400);
    }

    const { from, to } = parsed.data;
    if (from >= to) {
      return c.json({ error: "from must be before to" }, 400);
    }

    const rangeOverlap = and(
      lte(scheduleItemsCache.startsAt, to),
      gte(scheduleItemsCache.endsAt, from),
    );

    const coordinationRangeOverlap = and(
      lte(leagueCoordinationEvents.startsAt, to),
      gte(leagueCoordinationEvents.endsAt, from),
    );

    const [scheduleRows, planRows, assignmentRows, coordinationRows] = await Promise.all([
      db
        .select({
          id: scheduleItemsCache.id,
          title: scheduleItemsCache.title,
          location: scheduleItemsCache.location,
          startsAt: scheduleItemsCache.startsAt,
          endsAt: scheduleItemsCache.endsAt,
        })
        .from(scheduleItemsCache)
        .where(and(eq(scheduleItemsCache.userId, userId), rangeOverlap))
        .orderBy(asc(scheduleItemsCache.startsAt)),
      db
        .select({
          id: personalPlans.id,
          title: personalPlans.title,
          startsAt: personalPlans.startsAt,
          endsAt: personalPlans.endsAt,
        })
        .from(personalPlans)
        .where(
          and(
            eq(personalPlans.userId, userId),
            eq(personalPlans.onTimeline, true),
            lte(personalPlans.startsAt, to),
            gte(personalPlans.endsAt, from),
          ),
        )
        .orderBy(asc(personalPlans.startsAt)),
      db
        .select({
          assignment: orgTaskAssignments,
          task: orgTasks,
        })
        .from(orgTaskAssignments)
        .innerJoin(orgTasks, eq(orgTaskAssignments.taskId, orgTasks.id))
        .where(eq(orgTaskAssignments.assigneeUserId, userId)),
      db
        .select({
          id: leagueCoordinationEvents.id,
          title: leagueCoordinationEvents.title,
          startsAt: leagueCoordinationEvents.startsAt,
          endsAt: leagueCoordinationEvents.endsAt,
          category: leagueCoordinationEvents.category,
          description: leagueCoordinationEvents.description,
        })
        .from(leagueCoordinationEvents)
        .where(coordinationRangeOverlap)
        .orderBy(asc(leagueCoordinationEvents.startsAt)),
    ]);

    const now = new Date();
    const orgTasksForMerge = assignmentRows
      .map(({ assignment, task }) => {
        const w = effectiveOrgTaskWindow(task.startsAt, task.endsAt, now);
        if (!intervalsOverlap(w.startsAt, w.endsAt, from, to)) {
          return null;
        }
        return {
          id: task.id,
          title: task.title,
          startsAt: w.startsAt,
          endsAt: w.endsAt,
          sourceMeta: {
            assignmentId: assignment.id,
            taskId: task.id,
            orgId: task.orgId,
            status: assignment.status,
          },
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const merged = mergeTimelineSources({
      schedule: scheduleRows.map((r) => ({
        id: r.id,
        title: r.title,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        location: r.location,
      })),
      plans: planRows.map((r) => ({
        id: r.id,
        title: r.title,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
      })),
      orgTasks: orgTasksForMerge,
      leagueCoordination: coordinationRows.map((r) => ({
        id: r.id,
        title: r.title,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        category: r.category,
        description: r.description,
      })),
    });

    return c.json({
      items: merged.map((item) => ({
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        title: item.title,
        startsAt: item.startsAt.toISOString(),
        endsAt: item.endsAt.toISOString(),
        meta: item.meta,
      })),
    });
  },
);
