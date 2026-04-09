import { and, eq, inArray } from "drizzle-orm";
import { db } from "db";
import {
  orgMemberships,
  orgTaskAssignments,
  orgTaskInvolvedOrgs,
  orgTasks,
  userRoles,
} from "db/schema";
import { sseHub } from "./sse-hub.js";

export async function collectOrgTaskRecipientUserIds(taskId: string): Promise<string[]> {
  const recipients = new Set<string>();

  const [task] = await db.select().from(orgTasks).where(eq(orgTasks.id, taskId)).limit(1);
  if (!task) return [];

  if (task.createdByUserId) {
    recipients.add(task.createdByUserId);
  }

  const assignments = await db
    .select({ assigneeUserId: orgTaskAssignments.assigneeUserId })
    .from(orgTaskAssignments)
    .where(eq(orgTaskAssignments.taskId, taskId));
  for (const a of assignments) {
    recipients.add(a.assigneeUserId);
  }

  const leagueRows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.role, "league_admin"));
  for (const r of leagueRows) {
    recipients.add(r.userId);
  }

  const involvedOrgIds = await db
    .select({ orgId: orgTaskInvolvedOrgs.orgId })
    .from(orgTaskInvolvedOrgs)
    .where(eq(orgTaskInvolvedOrgs.taskId, taskId));

  if (involvedOrgIds.length > 0) {
    const orgIds = involvedOrgIds.map((r) => r.orgId);
    const officerRows = await db
      .select({ userId: orgMemberships.userId })
      .from(orgMemberships)
      .innerJoin(userRoles, eq(userRoles.userId, orgMemberships.userId))
      .where(
        and(
          inArray(orgMemberships.orgId, orgIds),
          inArray(userRoles.role, ["org_president", "org_officer"] as const),
        ),
      );
    for (const r of officerRows) {
      recipients.add(r.userId);
    }
  }

  return [...recipients];
}

export function broadcastOrgTaskRefresh(taskId: string, recipients: string[]): void {
  const payload = { kind: "task_refresh" as const, taskId };
  for (const uid of recipients) {
    sseHub.broadcast(uid, "org_task", payload);
  }
}

export async function broadcastOrgTaskRefreshForTask(taskId: string): Promise<void> {
  const recipients = await collectOrgTaskRecipientUserIds(taskId);
  broadcastOrgTaskRefresh(taskId, recipients);
}
