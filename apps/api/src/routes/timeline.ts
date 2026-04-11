import { and, asc, eq, exists, gte, lte, notInArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "db";
import {
  leagueCoordinationEvents,
  organizations,
  orgMemberships,
  orgTaskAssignments,
  orgTaskInvolvedOrgs,
  orgTasks,
  orgTimelineEvents,
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
import type { TimelineOrgPublishedInput } from "../services/timeline.js";

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

    const orgTimelineRangeOverlap = and(
      lte(orgTimelineEvents.startsAt, to),
      gte(orgTimelineEvents.endsAt, from),
    );

    const memberOfInvolvedExists = exists(
      db
        .select({ v: sql`1` })
        .from(orgTaskInvolvedOrgs)
        .innerJoin(
          orgMemberships,
          and(
            eq(orgMemberships.orgId, orgTaskInvolvedOrgs.orgId),
            eq(orgMemberships.userId, userId),
          ),
        )
        .where(eq(orgTaskInvolvedOrgs.taskId, orgTasks.id)),
    );

    const [scheduleRows, planRows, assignmentRows, coordinationRows, orgTimelineRows] =
      await Promise.all([
        db
          .select({
            id: scheduleItemsCache.id,
            title: scheduleItemsCache.title,
            location: scheduleItemsCache.location,
            instructor: scheduleItemsCache.instructor,
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
            priority: personalPlans.priority,
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
        db
          .select({
            id: orgTimelineEvents.id,
            orgId: orgTimelineEvents.orgId,
            kind: orgTimelineEvents.kind,
            title: orgTimelineEvents.title,
            description: orgTimelineEvents.description,
            startsAt: orgTimelineEvents.startsAt,
            endsAt: orgTimelineEvents.endsAt,
            orgNameShort: organizations.nameShort,
          })
          .from(orgTimelineEvents)
          .innerJoin(organizations, eq(organizations.id, orgTimelineEvents.orgId))
          .where(and(eq(organizations.lifecycleStatus, "active"), orgTimelineRangeOverlap))
          .orderBy(asc(orgTimelineEvents.startsAt)),
      ]);

    const now = new Date();
    const assignedTaskIds = [...new Set(assignmentRows.map((r) => r.task.id))];

    const orgMemberConds = [
      eq(orgTasks.timelineAudience, "org_members"),
      eq(organizations.lifecycleStatus, "active"),
      memberOfInvolvedExists,
    ];
    if (assignedTaskIds.length > 0) {
      orgMemberConds.push(notInArray(orgTasks.id, assignedTaskIds));
    }

    const orgMemberTaskRows = await db
      .select({
        task: orgTasks,
        orgNameShort: organizations.nameShort,
      })
      .from(orgTasks)
      .innerJoin(organizations, eq(organizations.id, orgTasks.orgId))
      .where(and(...orgMemberConds));

    const orgTaskMergeById = new Map<
      string,
      {
        id: string;
        title: string;
        startsAt: Date;
        endsAt: Date;
        sourceMeta: unknown;
      }
    >();

    for (const { assignment, task } of assignmentRows) {
      const w = effectiveOrgTaskWindow(task.startsAt, task.endsAt, now);
      if (!intervalsOverlap(w.startsAt, w.endsAt, from, to)) {
        continue;
      }
      orgTaskMergeById.set(task.id, {
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
      });
    }

    for (const row of orgMemberTaskRows) {
      const { task } = row;
      if (orgTaskMergeById.has(task.id)) {
        continue;
      }
      const w = effectiveOrgTaskWindow(task.startsAt, task.endsAt, now);
      if (!intervalsOverlap(w.startsAt, w.endsAt, from, to)) {
        continue;
      }
      orgTaskMergeById.set(task.id, {
        id: task.id,
        title: task.title,
        startsAt: w.startsAt,
        endsAt: w.endsAt,
        sourceMeta: {
          taskId: task.id,
          orgId: task.orgId,
          orgMemberView: true,
        },
      });
    }

    const coveredForPublic = new Set(orgTaskMergeById.keys());
    const publicConds = [
      eq(orgTasks.timelineAudience, "all_students"),
      eq(organizations.lifecycleStatus, "active"),
    ];
    if (coveredForPublic.size > 0) {
      publicConds.push(notInArray(orgTasks.id, [...coveredForPublic]));
    }

    const publicTaskRows = await db
      .select({
        task: orgTasks,
        orgNameShort: organizations.nameShort,
      })
      .from(orgTasks)
      .innerJoin(organizations, eq(organizations.id, orgTasks.orgId))
      .where(and(...publicConds));

    const orgActivityInputs: TimelineOrgPublishedInput[] = [
      ...orgTimelineRows.map((r) => ({
        id: r.id,
        orgId: r.orgId,
        orgNameShort: r.orgNameShort,
        kind: r.kind as string,
        title: r.title,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        description: r.description,
      })),
    ];

    for (const row of publicTaskRows) {
      const { task, orgNameShort } = row;
      const w = effectiveOrgTaskWindow(task.startsAt, task.endsAt, now);
      if (!intervalsOverlap(w.startsAt, w.endsAt, from, to)) {
        continue;
      }
      orgActivityInputs.push({
        id: task.id,
        orgId: task.orgId,
        orgNameShort,
        kind: "activity",
        title: task.title,
        startsAt: w.startsAt,
        endsAt: w.endsAt,
        description: task.description,
      });
    }

    const merged = mergeTimelineSources({
      schedule: scheduleRows.map((r) => ({
        id: r.id,
        title: r.title,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        location: r.location,
        instructor: r.instructor,
      })),
      plans: planRows.map((r) => ({
        id: r.id,
        title: r.title,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        priority: r.priority,
      })),
      orgTasks: [...orgTaskMergeById.values()],
      leagueCoordination: coordinationRows.map((r) => ({
        id: r.id,
        title: r.title,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        category: r.category,
        description: r.description,
      })),
      orgActivities: orgActivityInputs,
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
