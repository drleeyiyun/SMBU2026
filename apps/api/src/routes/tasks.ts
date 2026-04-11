import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "db";
import {
  notifications,
  orgMemberships,
  organizations,
  orgTaskAssignments,
  orgTaskHandoffs,
  orgTaskInvolvedOrgs,
  orgTaskStatusEvents,
  orgTasks,
  userRoles,
  users,
} from "db/schema";
import { broadcastOrgTaskRefreshForTask } from "../lib/org-task-broadcast.js";
import { broadcastNotification } from "../lib/notification-broadcast.js";
import { mergeTaskTimelineItems } from "../lib/task-timeline.js";
import type { AuthVariables } from "../middleware/session.js";
import { requireRoles } from "../middleware/rbac.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

const ASSIGN_STATUSES = ["unread", "read", "in_progress", "done"] as const;
type AssignStatus = (typeof ASSIGN_STATUSES)[number];

function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | null> {
  return c.req.json().catch(() => null);
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

function nextAssignStatus(current: AssignStatus): AssignStatus | null {
  const i = ASSIGN_STATUSES.indexOf(current);
  if (i < 0 || i >= ASSIGN_STATUSES.length - 1) return null;
  return ASSIGN_STATUSES[i + 1]!;
}

function isValidTransition(from: AssignStatus, to: AssignStatus): boolean {
  return nextAssignStatus(from) === to;
}

const assignmentStatusSchema = z
  .object({
    status: z.enum(["unread", "read", "in_progress", "done"]),
  })
  .strict();

const handoffSchema = z
  .object({
    toUserId: z.string().uuid(),
    note: z.union([z.string(), z.null()]).optional(),
  })
  .strict();

const addAssigneesBodySchema = z
  .object({
    assigneeUserIds: z.array(z.string().uuid()).min(1).max(40),
  })
  .strict();

async function displayNameByUserId(userIds: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(userIds)];
  if (uniq.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, uniq));
  return new Map(rows.map((r) => [r.id, r.displayName]));
}

async function isLeagueAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.role, "league_admin")))
    .limit(1);
  return !!row;
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

async function canViewTaskTimeline(actorId: string, taskId: string): Promise<boolean> {
  if (await isLeagueAdmin(actorId)) return true;
  const [task] = await db.select().from(orgTasks).where(eq(orgTasks.id, taskId)).limit(1);
  if (!task) return false;
  if (task.createdByUserId === actorId) return true;
  const [asAssignee] = await db
    .select({ id: orgTaskAssignments.id })
    .from(orgTaskAssignments)
    .where(
      and(eq(orgTaskAssignments.taskId, taskId), eq(orgTaskAssignments.assigneeUserId, actorId)),
    )
    .limit(1);
  if (asAssignee) return true;

  const involvedRows = await db
    .select({ orgId: orgTaskInvolvedOrgs.orgId })
    .from(orgTaskInvolvedOrgs)
    .where(eq(orgTaskInvolvedOrgs.taskId, taskId));
  const orgIds = [...new Set([task.orgId, ...involvedRows.map((r) => r.orgId)])];
  if (orgIds.length === 0) return false;

  const officer = await db
    .select({ userId: orgMemberships.userId })
    .from(orgMemberships)
    .innerJoin(userRoles, eq(userRoles.userId, orgMemberships.userId))
    .where(
      and(
        inArray(orgMemberships.orgId, orgIds),
        eq(orgMemberships.userId, actorId),
        inArray(userRoles.role, ["org_president", "org_officer"] as const),
      ),
    )
    .limit(1);
  return officer.length > 0;
}

export const tasksRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware)
  .get("/mine", requireUser, async (c) => {
    const userId = c.get("userId")!;

    const rows = await db
      .select({
        assignment: orgTaskAssignments,
        task: orgTasks,
      })
      .from(orgTaskAssignments)
      .innerJoin(orgTasks, eq(orgTaskAssignments.taskId, orgTasks.id))
      .where(eq(orgTaskAssignments.assigneeUserId, userId))
      .orderBy(asc(orgTaskAssignments.updatedAt));

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

    const assigneeIds = rows.map((r) => r.assignment.assigneeUserId);
    const nameMap = await displayNameByUserId(assigneeIds);

    return c.json({
      items: rows.map((r) => ({
        assignment: {
          id: r.assignment.id,
          taskId: r.assignment.taskId,
          assigneeUserId: r.assignment.assigneeUserId,
          assigneeDisplayName: nameMap.get(r.assignment.assigneeUserId) ?? null,
          status: r.assignment.status,
          updatedAt: r.assignment.updatedAt.toISOString(),
        },
        task: taskToJson(r.task),
        involvedOrgIds: involvedByTask.get(r.task.id) ?? [],
      })),
    });
  })
  .get("/coordination", requireUser, async (c) => {
    const userId = c.get("userId")!;

    const officerOrgRows = await db
      .select({ orgId: orgMemberships.orgId })
      .from(orgMemberships)
      .innerJoin(userRoles, eq(userRoles.userId, orgMemberships.userId))
      .where(
        and(
          eq(orgMemberships.userId, userId),
          inArray(userRoles.role, ["org_president", "org_officer"] as const),
        ),
      );

    const officerOrgIds = [...new Set(officerOrgRows.map((r) => r.orgId))];
    if (officerOrgIds.length === 0) {
      return c.json({ items: [] });
    }

    const fromPrimary = await db
      .select({ id: orgTasks.id })
      .from(orgTasks)
      .where(inArray(orgTasks.orgId, officerOrgIds));
    const fromInvolved = await db
      .select({ taskId: orgTaskInvolvedOrgs.taskId })
      .from(orgTaskInvolvedOrgs)
      .where(inArray(orgTaskInvolvedOrgs.orgId, officerOrgIds));

    const taskIdSet = new Set<string>([
      ...fromPrimary.map((r) => r.id),
      ...fromInvolved.map((r) => r.taskId),
    ]);
    const taskIds = [...taskIdSet];

    if (taskIds.length === 0) {
      return c.json({ items: [] });
    }

    const tasksWithOrg = await db
      .select({
        task: orgTasks,
        primaryOrgNameShort: organizations.nameShort,
      })
      .from(orgTasks)
      .innerJoin(organizations, eq(organizations.id, orgTasks.orgId))
      .where(inArray(orgTasks.id, taskIds))
      .orderBy(asc(orgTasks.createdAt));

    const allAssignments = await db
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

    const involvedRows = await db
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

    const allAssigneeIds = allAssignments.map((a) => a.assigneeUserId);
    const nameMap = await displayNameByUserId(allAssigneeIds);

    const items = tasksWithOrg.map((row) => {
      const assigns = assignByTask.get(row.task.id) ?? [];
      return {
        task: taskToJson(row.task),
        primaryOrgNameShort: row.primaryOrgNameShort,
        involvedOrgIds: involvedByTask.get(row.task.id) ?? [],
        assignments: assigns.map((a) => ({
          id: a.id,
          assigneeUserId: a.assigneeUserId,
          assigneeDisplayName: nameMap.get(a.assigneeUserId) ?? null,
          status: a.status,
          updatedAt: a.updatedAt.toISOString(),
        })),
      };
    });

    return c.json({ items });
  })
  .get("/:taskId/timeline", requireUser, async (c) => {
    const taskId = c.req.param("taskId");
    if (!isUuid(taskId)) {
      return c.json({ error: "Invalid task id" }, 400);
    }
    const userId = c.get("userId")!;
    if (!(await canViewTaskTimeline(userId, taskId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [task] = await db.select().from(orgTasks).where(eq(orgTasks.id, taskId)).limit(1);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    const statusRows = await db
      .select()
      .from(orgTaskStatusEvents)
      .where(eq(orgTaskStatusEvents.taskId, taskId));
    const handoffRows = await db.select().from(orgTaskHandoffs).where(eq(orgTaskHandoffs.taskId, taskId));

    const events = mergeTaskTimelineItems(statusRows, handoffRows);

    return c.json({ taskId, events });
  })
  .post("/:taskId/assignments", requireUser, async (c) => {
    const taskId = c.req.param("taskId");
    if (!isUuid(taskId)) {
      return c.json({ error: "Invalid task id" }, 400);
    }
    const actorId = c.get("userId")!;

    if (!(await canViewTaskTimeline(actorId, taskId))) {
      return c.json({ error: "forbidden" }, 403);
    }

    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = addAssigneesBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }

    const requested = [...new Set(parsed.data.assigneeUserIds)];

    const [task] = await db.select().from(orgTasks).where(eq(orgTasks.id, taskId)).limit(1);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    const existing = await db
      .select({ assigneeUserId: orgTaskAssignments.assigneeUserId })
      .from(orgTaskAssignments)
      .where(eq(orgTaskAssignments.taskId, taskId));
    const existingSet = new Set(existing.map((e) => e.assigneeUserId));
    const toAdd = requested.filter((id) => !existingSet.has(id));

    if (toAdd.length === 0) {
      return c.json({ added: [] });
    }

    const userRows = await db.select({ id: users.id }).from(users).where(inArray(users.id, toAdd));
    if (userRows.length !== toAdd.length) {
      return c.json({ error: "One or more users do not exist" }, 400);
    }

    const now = new Date();
    const inserted = await db
      .insert(orgTaskAssignments)
      .values(
        toAdd.map((assigneeUserId) => ({
          taskId,
          assigneeUserId,
          status: "unread" as const,
          updatedAt: now,
        })),
      )
      .returning();

    const nameMap = await displayNameByUserId(inserted.map((r) => r.assigneeUserId));

    await broadcastOrgTaskRefreshForTask(taskId);

    return c.json(
      {
        added: inserted.map((r) => ({
          id: r.id,
          taskId: r.taskId,
          assigneeUserId: r.assigneeUserId,
          assigneeDisplayName: nameMap.get(r.assigneeUserId) ?? null,
          status: r.status,
          updatedAt: r.updatedAt.toISOString(),
        })),
      },
      201,
    );
  })
  .patch("/assignments/:assignmentId/status", requireUser, async (c) => {
    const assignmentId = c.req.param("assignmentId");
    if (!isUuid(assignmentId)) {
      return c.json({ error: "Invalid assignment id" }, 400);
    }
    const actorId = c.get("userId")!;

    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = assignmentStatusSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }
    const targetStatus = parsed.data.status as AssignStatus;

    const [row] = await db
      .select({
        assignment: orgTaskAssignments,
        task: orgTasks,
      })
      .from(orgTaskAssignments)
      .innerJoin(orgTasks, eq(orgTaskAssignments.taskId, orgTasks.id))
      .where(eq(orgTaskAssignments.id, assignmentId))
      .limit(1);

    if (!row) {
      return c.json({ error: "Assignment not found" }, 404);
    }

    const league = await isLeagueAdmin(actorId);
    const isAssignee = row.assignment.assigneeUserId === actorId;

    if (!isAssignee && !league) {
      return c.json({ error: "forbidden" }, 403);
    }

    const fromStatus = row.assignment.status as AssignStatus;
    if (!league && !isValidTransition(fromStatus, targetStatus)) {
      return c.json({ error: "Invalid status transition" }, 400);
    }

    if (fromStatus === targetStatus) {
      return c.json({
        assignment: {
          id: row.assignment.id,
          taskId: row.assignment.taskId,
          assigneeUserId: row.assignment.assigneeUserId,
          status: row.assignment.status,
          updatedAt: row.assignment.updatedAt.toISOString(),
        },
      });
    }

    const now = new Date();
    const creatorId = row.task.createdByUserId;
    const assigneeId = row.assignment.assigneeUserId;

    const notifyUserIds = new Set<string>();
    if (creatorId && creatorId !== actorId) notifyUserIds.add(creatorId);
    if (assigneeId && assigneeId !== actorId) notifyUserIds.add(assigneeId);

    const insertedNotifications: (typeof notifications.$inferSelect)[] = [];

    await db.transaction(async (tx) => {
      await tx
        .update(orgTaskAssignments)
        .set({ status: targetStatus, updatedAt: now })
        .where(eq(orgTaskAssignments.id, assignmentId));

      await tx.insert(orgTaskStatusEvents).values({
        taskId: row.task.id,
        assignmentId,
        actorUserId: actorId,
        fromStatus,
        toStatus: targetStatus,
      });

      const payload = {
        taskId: row.task.id,
        assignmentId,
        fromStatus,
        toStatus: targetStatus,
        actorUserId: actorId,
        at: now.toISOString(),
      };
      const payloadJson = JSON.stringify(payload);

      for (const uid of notifyUserIds) {
        const [n] = await tx
          .insert(notifications)
          .values({
            userId: uid,
            type: "task_status",
            payloadJson,
          })
          .returning();
        if (n) insertedNotifications.push(n);
      }
    });

    for (const n of insertedNotifications) {
      broadcastNotification(n);
    }

    await broadcastOrgTaskRefreshForTask(row.task.id);

    const [updated] = await db
      .select()
      .from(orgTaskAssignments)
      .where(eq(orgTaskAssignments.id, assignmentId))
      .limit(1);

    return c.json({
      assignment: {
        id: updated!.id,
        taskId: updated!.taskId,
        assigneeUserId: updated!.assigneeUserId,
        status: updated!.status,
        updatedAt: updated!.updatedAt.toISOString(),
      },
    });
  })
  .post("/:taskId/handoffs", requireUser, async (c) => {
    const taskId = c.req.param("taskId");
    if (!isUuid(taskId)) {
      return c.json({ error: "Invalid task id" }, 400);
    }
    const fromUserId = c.get("userId")!;

    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = handoffSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }

    const [task] = await db.select().from(orgTasks).where(eq(orgTasks.id, taskId)).limit(1);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    const league = await isLeagueAdmin(fromUserId);
    const isCreator = task.createdByUserId === fromUserId;
    const [asAssignee] = await db
      .select({ id: orgTaskAssignments.id })
      .from(orgTaskAssignments)
      .where(
        and(eq(orgTaskAssignments.taskId, taskId), eq(orgTaskAssignments.assigneeUserId, fromUserId)),
      )
      .limit(1);

    if (!league && !isCreator && !asAssignee) {
      return c.json({ error: "forbidden" }, 403);
    }

    const [handoff] = await db
      .insert(orgTaskHandoffs)
      .values({
        taskId,
        fromUserId,
        toUserId: parsed.data.toUserId,
        note: parsed.data.note === undefined ? null : parsed.data.note,
      })
      .returning();

    await broadcastOrgTaskRefreshForTask(taskId);

    return c.json(
      {
        handoff: {
          id: handoff!.id,
          taskId: handoff!.taskId,
          fromUserId: handoff!.fromUserId,
          toUserId: handoff!.toUserId,
          note: handoff!.note,
          createdAt: handoff!.createdAt.toISOString(),
        },
      },
      201,
    );
  });
