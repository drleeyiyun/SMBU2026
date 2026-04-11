import { and, asc, eq, exists, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "db";
import {
  orgLifecycleEvents,
  organizations,
  orgRevisions,
  orgTaskAssignments,
  orgTaskInvolvedOrgs,
  orgTasks,
  users,
} from "db/schema";
import type { AuthVariables } from "../middleware/session.js";
import { requireRoles } from "../middleware/rbac.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";
import { advisorDisplayNameByUserIds } from "../lib/org-advisor-names.js";
import { leagueArchiveRouter } from "./league-archive.js";
import { coordinationRouter } from "./league-coordination.js";
import { leagueProgramScheduleRouter } from "./league-program-schedule.js";
import { leagueRosterRouter } from "./league-roster.js";

const STATUS_VALUES = ["unread", "read", "in_progress", "done"] as const;
const TASK_OVERVIEW_STATUS_VALUES = [...STATUS_VALUES, "unassigned"] as const;
const KIND_VALUES = ["single", "cross", "transfer"] as const;
const LIFECYCLE_VALUES = ["pending", "active", "suspended"] as const;

const lifecyclePatchSchema = z
  .object({
    toStatus: z.enum(["pending", "active", "suspended"]),
    reason: z.string().optional(),
  })
  .strict();

function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | null> {
  return c.req.json().catch(() => null);
}

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
    timelineAudience: t.timelineAudience,
    startsAt: t.startsAt?.toISOString() ?? null,
    endsAt: t.endsAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

export const leagueRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware)
  .route("/archive", leagueArchiveRouter)
  .route("/coordination-events", coordinationRouter)
  .route("/roster", leagueRosterRouter)
  .route("/program-schedule", leagueProgramScheduleRouter)
  .get("/health", requireUser, requireRoles("league_admin"), (c) => c.json({ ok: true }))
  .get("/orgs", requireUser, requireRoles("league_admin"), async (c) => {
    const lifecycleRaw = c.req.query("lifecycle");
    if (
      lifecycleRaw !== undefined &&
      lifecycleRaw !== "" &&
      !LIFECYCLE_VALUES.includes(lifecycleRaw as (typeof LIFECYCLE_VALUES)[number])
    ) {
      return c.json({ error: "Invalid lifecycle" }, 400);
    }
    const lifecycle =
      lifecycleRaw && lifecycleRaw !== ""
        ? (lifecycleRaw as (typeof LIFECYCLE_VALUES)[number])
        : null;

    const conds = lifecycle ? [eq(organizations.lifecycleStatus, lifecycle)] : [];
    const rows = await db
      .select()
      .from(organizations)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(organizations.nameShort));

    const advMap = await advisorDisplayNameByUserIds(rows.map((r) => r.advisorUserId));

    return c.json({
      organizations: rows.map((o) => ({
        id: o.id,
        nameFull: o.nameFull,
        nameShort: o.nameShort,
        logoUrl: o.logoUrl,
        orgType: o.orgType,
        lifecycleStatus: o.lifecycleStatus,
        advisorUserId: o.advisorUserId,
        advisorDisplayName: o.advisorUserId ? advMap.get(o.advisorUserId) ?? null : null,
        createdAt: o.createdAt.toISOString(),
      })),
    });
  })
  .get("/org-revisions", requireUser, requireRoles("league_admin"), async (c) => {
    const rows = await db
      .select({
        revision: orgRevisions,
        orgNameShort: organizations.nameShort,
        orgNameFull: organizations.nameFull,
        orgType: organizations.orgType,
        orgLogoUrl: organizations.logoUrl,
      })
      .from(orgRevisions)
      .innerJoin(organizations, eq(organizations.id, orgRevisions.orgId))
      .where(eq(orgRevisions.status, "pending"))
      .orderBy(asc(orgRevisions.createdAt));

    return c.json({
      revisions: rows.map((r) => ({
        id: r.revision.id,
        orgId: r.revision.orgId,
        orgNameShort: r.orgNameShort,
        organizationBefore: {
          nameFull: r.orgNameFull,
          nameShort: r.orgNameShort,
          orgType: r.orgType,
          logoUrl: r.orgLogoUrl,
        },
        status: r.revision.status,
        payload: JSON.parse(r.revision.payloadJson) as unknown,
        createdAt: r.revision.createdAt.toISOString(),
      })),
    });
  })
  .patch("/orgs/:orgId/lifecycle", requireUser, requireRoles("league_admin"), async (c) => {
    const orgId = c.req.param("orgId");
    if (!isUuid(orgId)) {
      return c.json({ error: "Invalid org id" }, 400);
    }
    const actorId = c.get("userId")!;
    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = lifecyclePatchSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }
    const { toStatus, reason } = parsed.data;

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) {
      return c.json({ error: "Organization not found" }, 404);
    }
    if (org.lifecycleStatus === toStatus) {
      return c.json({
        organization: {
          id: org.id,
          lifecycleStatus: org.lifecycleStatus,
        },
        unchanged: true,
      });
    }

    const fromStatus = org.lifecycleStatus;
    const decidedAt = new Date();

    await db.transaction(async (tx) => {
      await tx
        .update(organizations)
        .set({ lifecycleStatus: toStatus })
        .where(eq(organizations.id, orgId));
      await tx.insert(orgLifecycleEvents).values({
        orgId,
        fromStatus,
        toStatus,
        actorUserId: actorId,
        reason: reason?.trim() ?? null,
        createdAt: decidedAt,
      });
    });

    const [updated] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    return c.json({
      organization: {
        id: updated!.id,
        lifecycleStatus: updated!.lifecycleStatus,
      },
    });
  })
  .get("/tasks-overview", requireUser, requireRoles("league_admin"), async (c) => {
    const orgIdRaw = c.req.query("orgId");
    const statusRaw = c.req.query("status");
    const kindRaw = c.req.query("kind");
    const qRaw = c.req.query("q");
    const fromRaw = c.req.query("from");
    const toRaw = c.req.query("to");

    if (orgIdRaw !== undefined && orgIdRaw !== "" && !isUuid(orgIdRaw)) {
      return c.json({ error: "Invalid orgId" }, 400);
    }
    if (
      statusRaw !== undefined &&
      statusRaw !== "" &&
      !TASK_OVERVIEW_STATUS_VALUES.includes(statusRaw as (typeof TASK_OVERVIEW_STATUS_VALUES)[number])
    ) {
      return c.json({ error: "Invalid status" }, 400);
    }
    if (
      kindRaw !== undefined &&
      kindRaw !== "" &&
      !KIND_VALUES.includes(kindRaw as (typeof KIND_VALUES)[number])
    ) {
      return c.json({ error: "Invalid kind" }, 400);
    }

    let fromDt: Date | null = null;
    let toDt: Date | null = null;
    if (fromRaw !== undefined && fromRaw !== "") {
      fromDt = new Date(fromRaw);
      if (Number.isNaN(fromDt.getTime())) {
        return c.json({ error: "Invalid from" }, 400);
      }
    }
    if (toRaw !== undefined && toRaw !== "") {
      toDt = new Date(toRaw);
      if (Number.isNaN(toDt.getTime())) {
        return c.json({ error: "Invalid to" }, 400);
      }
    }

    const orgId = orgIdRaw && orgIdRaw !== "" ? orgIdRaw : null;
    const status = statusRaw && statusRaw !== "" ? statusRaw : null;
    const kind = kindRaw && kindRaw !== "" ? kindRaw : null;
    const q = qRaw && qRaw.trim() !== "" ? qRaw.trim() : null;

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

    const baseConds = [];
    if (orgMatch) baseConds.push(orgMatch);
    if (kind) {
      baseConds.push(eq(orgTasks.kind, kind as (typeof KIND_VALUES)[number]));
    }
    if (q) {
      baseConds.push(ilike(orgTasks.title, `%${q}%`));
    }
    if (fromDt) {
      baseConds.push(gte(orgTasks.createdAt, fromDt));
    }
    if (toDt) {
      baseConds.push(lte(orgTasks.createdAt, toDt));
    }
    const taskFilter = baseConds.length ? and(...baseConds) : undefined;

    const tasksRows = await db
      .select({
        task: orgTasks,
        primaryOrgNameShort: organizations.nameShort,
      })
      .from(orgTasks)
      .innerJoin(organizations, eq(organizations.id, orgTasks.orgId))
      .where(taskFilter)
      .orderBy(asc(orgTasks.createdAt));

    const taskIds = tasksRows.map((r) => r.task.id);

    const allAssignments =
      taskIds.length === 0
        ? []
        : await db
            .select()
            .from(orgTaskAssignments)
            .where(inArray(orgTaskAssignments.taskId, taskIds));

    const assignByTask = new Map<string, (typeof orgTaskAssignments.$inferSelect)[]>();
    for (const a of allAssignments) {
      const list = assignByTask.get(a.taskId) ?? [];
      list.push(a);
      assignByTask.set(a.taskId, list);
    }
    for (const [, list] of assignByTask) {
      list.sort((x, y) => x.id.localeCompare(y.id));
    }

    const involvedRows =
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
    for (const row of involvedRows) {
      const list = involvedByTask.get(row.taskId) ?? [];
      list.push(row.orgId);
      involvedByTask.set(row.taskId, list);
    }

    type OverviewItem = {
      assignment: {
        id: string;
        taskId: string;
        assigneeUserId: string | null;
        assigneeDisplayName: string | null;
        status: string;
        updatedAt: string;
      };
      task: ReturnType<typeof taskToJson>;
      primaryOrgNameShort: string | null;
      involvedOrgIds: string[];
    };

    const items: OverviewItem[] = [];

    for (const tr of tasksRows) {
      const assigns = assignByTask.get(tr.task.id) ?? [];
      const involvedOrgIds = involvedByTask.get(tr.task.id) ?? [];
      const tj = taskToJson(tr.task);

      if (assigns.length === 0) {
        if (status && status !== "unassigned") continue;
        items.push({
          assignment: {
            id: `unassigned:${tr.task.id}`,
            taskId: tr.task.id,
            assigneeUserId: null,
            assigneeDisplayName: null,
            status: "unassigned",
            updatedAt: tr.task.createdAt.toISOString(),
          },
          task: tj,
          primaryOrgNameShort: tr.primaryOrgNameShort,
          involvedOrgIds,
        });
        continue;
      }

      if (status === "unassigned") continue;

      for (const a of assigns) {
        if (status && a.status !== status) continue;
        items.push({
          assignment: {
            id: a.id,
            taskId: a.taskId,
            assigneeUserId: a.assigneeUserId,
            assigneeDisplayName: null,
            status: a.status,
            updatedAt: a.updatedAt.toISOString(),
          },
          task: tj,
          primaryOrgNameShort: tr.primaryOrgNameShort,
          involvedOrgIds,
        });
      }
    }

    const assigneeNameIds = [
      ...new Set(
        items
          .map((i) => i.assignment.assigneeUserId)
          .filter((id): id is string => id != null && id !== ""),
      ),
    ];
    const nameByUserId = new Map<string, string>();
    if (assigneeNameIds.length > 0) {
      const nameRows = await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, assigneeNameIds));
      for (const nr of nameRows) {
        nameByUserId.set(nr.id, nr.displayName);
      }
    }
    for (const it of items) {
      const uid = it.assignment.assigneeUserId;
      if (uid) {
        it.assignment.assigneeDisplayName = nameByUserId.get(uid) ?? null;
      }
    }

    const countRows =
      taskIds.length === 0
        ? []
        : await db
            .select({
              status: orgTaskAssignments.status,
              n: sql<number>`count(*)::int`,
            })
            .from(orgTaskAssignments)
            .innerJoin(orgTasks, eq(orgTaskAssignments.taskId, orgTasks.id))
            .where(taskFilter)
            .groupBy(orgTaskAssignments.status);

    const byStatus: Record<(typeof STATUS_VALUES)[number] | "unassigned", number> = {
      unread: 0,
      read: 0,
      in_progress: 0,
      done: 0,
      unassigned: 0,
    };
    for (const cr of countRows) {
      const s = cr.status as (typeof STATUS_VALUES)[number];
      if (byStatus[s] !== undefined) byStatus[s] = cr.n;
    }
    for (const tr of tasksRows) {
      if ((assignByTask.get(tr.task.id) ?? []).length === 0) {
        byStatus.unassigned++;
      }
    }

    const kindRows = await db
      .select({
        kind: orgTasks.kind,
        n: sql<number>`count(distinct ${orgTasks.id})::int`,
      })
      .from(orgTasks)
      .where(taskFilter)
      .groupBy(orgTasks.kind);

    const byKind: Record<(typeof KIND_VALUES)[number], number> = {
      single: 0,
      cross: 0,
      transfer: 0,
    };
    for (const kr of kindRows) {
      const k = kr.kind as (typeof KIND_VALUES)[number];
      if (byKind[k] !== undefined) byKind[k] = kr.n;
    }

    return c.json({
      items,
      byStatus,
      byKind,
    });
  });
