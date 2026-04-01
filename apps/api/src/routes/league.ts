import { and, asc, eq, exists, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "db";
import {
  orgTaskAssignments,
  orgTaskInvolvedOrgs,
  orgTasks,
} from "db/schema";
import type { AuthVariables } from "../middleware/session.js";
import { requireRoles } from "../middleware/rbac.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

const STATUS_VALUES = ["unread", "read", "in_progress", "done"] as const;

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

function taskToJson(t: typeof orgTasks.$inferSelect) {
  return {
    id: t.id,
    orgId: t.orgId,
    title: t.title,
    description: t.description,
    kind: t.kind,
    createdByUserId: t.createdByUserId,
    leagueVisible: t.leagueVisible,
    startsAt: t.startsAt?.toISOString() ?? null,
    endsAt: t.endsAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

export const leagueRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware)
  .get("/health", requireUser, requireRoles("league_admin"), (c) => c.json({ ok: true }))
  .get("/tasks-overview", requireUser, requireRoles("league_admin"), async (c) => {
    const orgIdRaw = c.req.query("orgId");
    const statusRaw = c.req.query("status");

    if (orgIdRaw !== undefined && orgIdRaw !== "" && !isUuid(orgIdRaw)) {
      return c.json({ error: "Invalid orgId" }, 400);
    }
    if (
      statusRaw !== undefined &&
      statusRaw !== "" &&
      !STATUS_VALUES.includes(statusRaw as (typeof STATUS_VALUES)[number])
    ) {
      return c.json({ error: "Invalid status" }, 400);
    }

    const orgId = orgIdRaw && orgIdRaw !== "" ? orgIdRaw : null;
    const status = statusRaw && statusRaw !== "" ? statusRaw : null;

    const orgMatch =
      orgId === null
        ? undefined
        : or(
            eq(orgTasks.orgId, orgId),
            exists(
              db
                .select()
                .from(orgTaskInvolvedOrgs)
                .where(
                  and(
                    eq(orgTaskInvolvedOrgs.taskId, orgTasks.id),
                    eq(orgTaskInvolvedOrgs.orgId, orgId),
                  ),
                ),
            ),
          );

    const baseConds = [eq(orgTasks.leagueVisible, true)];
    if (orgMatch) baseConds.push(orgMatch);
    const taskFilter = and(...baseConds);

    const assignConds = [...baseConds];
    if (status) {
      assignConds.push(eq(orgTaskAssignments.status, status as (typeof STATUS_VALUES)[number]));
    }
    const assignFilter = and(...assignConds);

    const rows = await db
      .select({
        assignment: orgTaskAssignments,
        task: orgTasks,
      })
      .from(orgTaskAssignments)
      .innerJoin(orgTasks, eq(orgTaskAssignments.taskId, orgTasks.id))
      .where(assignFilter!)
      .orderBy(asc(orgTasks.createdAt), asc(orgTaskAssignments.id));

    const taskIds = [...new Set(rows.map((r) => r.task.id))];
    const involved: { taskId: string; orgId: string }[] =
      taskIds.length === 0
        ? []
        : await db
            .select({
              taskId: orgTaskInvolvedOrgs.taskId,
              orgId: orgTaskInvolvedOrgs.orgId,
            })
            .from(orgTaskInvolvedOrgs)
            .where(inArray(orgTaskInvolvedOrgs.taskId, taskIds));

    const involvedByTask = new Map<string, string[]>();
    for (const row of involved) {
      const list = involvedByTask.get(row.taskId) ?? [];
      list.push(row.orgId);
      involvedByTask.set(row.taskId, list);
    }

    const countRows = await db
      .select({
        status: orgTaskAssignments.status,
        n: sql<number>`count(*)::int`,
      })
      .from(orgTaskAssignments)
      .innerJoin(orgTasks, eq(orgTaskAssignments.taskId, orgTasks.id))
      .where(taskFilter!)
      .groupBy(orgTaskAssignments.status);

    const byStatus: Record<(typeof STATUS_VALUES)[number], number> = {
      unread: 0,
      read: 0,
      in_progress: 0,
      done: 0,
    };
    for (const cr of countRows) {
      const s = cr.status as (typeof STATUS_VALUES)[number];
      if (byStatus[s] !== undefined) byStatus[s] = cr.n;
    }

    return c.json({
      items: rows.map((r) => ({
        assignment: {
          id: r.assignment.id,
          taskId: r.assignment.taskId,
          assigneeUserId: r.assignment.assigneeUserId,
          status: r.assignment.status,
          updatedAt: r.assignment.updatedAt.toISOString(),
        },
        task: taskToJson(r.task),
        involvedOrgIds: involvedByTask.get(r.task.id) ?? [],
      })),
      byStatus,
    });
  });
