import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "db";
import {
  notifications,
  orgTaskAssignments,
  orgTaskHandoffs,
  orgTaskInvolvedOrgs,
  orgTaskStatusEvents,
  orgTasks,
  userRoles,
} from "db/schema";
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
    startsAt: t.startsAt?.toISOString() ?? null,
    endsAt: t.endsAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
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
    });
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
        await tx.insert(notifications).values({
          userId: uid,
          type: "task_status",
          payloadJson,
        });
      }
    });

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
