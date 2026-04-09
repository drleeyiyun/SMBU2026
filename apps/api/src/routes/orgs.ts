import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "db";
import {
  orgLeadershipEvents,
  orgMemberships,
  organizations,
  orgRevisions,
  orgTaskInvolvedOrgs,
  orgTasks,
  orgTaskAssignments,
  userRoles,
  users,
} from "db/schema";
import type { AuthVariables } from "../middleware/session.js";
import { requireRoles } from "../middleware/rbac.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";
function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | null> {
  return c.req.json().catch(() => null);
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

const orgCreateSchema = z
  .object({
    nameFull: z.string().min(1),
    nameShort: z.string().min(1),
    orgType: z.string().min(1),
    logoUrl: z.union([z.string().max(2048), z.null()]).optional(),
  })
  .strict();

const orgRevisionPayloadSchema = z
  .object({
    nameFull: z.string().min(1).optional(),
    nameShort: z.string().min(1).optional(),
    orgType: z.string().min(1).optional(),
    logoUrl: z.union([z.string().max(2048), z.null()]).optional(),
  })
  .strict();

const revisionDecideSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    reason: z.string().optional(),
  })
  .strict();

const taskCreateSchema = z
  .object({
    kind: z.enum(["single", "cross", "transfer"]),
    title: z.string().min(1),
    description: z.union([z.string(), z.null()]).optional(),
    startsAt: z.union([z.string().datetime(), z.null()]).optional(),
    endsAt: z.union([z.string().datetime(), z.null()]).optional(),
    involvedOrgIds: z.array(z.string().uuid()).min(1),
    assigneeUserIds: z.array(z.string().uuid()).optional(),
  })
  .strict();

function orgToJson(o: typeof organizations.$inferSelect) {
  return {
    id: o.id,
    nameFull: o.nameFull,
    nameShort: o.nameShort,
    logoUrl: o.logoUrl,
    orgType: o.orgType,
    lifecycleStatus: o.lifecycleStatus,
    advisorUserId: o.advisorUserId,
    createdAt: o.createdAt.toISOString(),
  };
}

async function isLeagueAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.role, "league_admin")))
    .limit(1);
  return !!row;
}

async function userInOrg(userId: string, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ orgId: orgMemberships.orgId })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.userId, userId), eq(orgMemberships.orgId, orgId)))
    .limit(1);
  return !!row;
}

async function canSubmitOrgRevision(userId: string, orgId: string): Promise<boolean> {
  if (await isLeagueAdmin(userId)) return true;
  const inOrg = await userInOrg(userId, orgId);
  if (!inOrg) return false;
  const leadership = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, userId),
        inArray(userRoles.role, ["org_president", "org_officer"] as const),
      ),
    )
    .limit(1);
  return leadership.length > 0;
}

async function canCreateTaskForOrg(userId: string, orgId: string): Promise<boolean> {
  if (await isLeagueAdmin(userId)) return true;
  return userInOrg(userId, orgId);
}

async function hasPendingRevisionForOrg(orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: orgRevisions.id })
    .from(orgRevisions)
    .where(and(eq(orgRevisions.orgId, orgId), eq(orgRevisions.status, "pending")))
    .limit(1);
  return !!row;
}

async function canManageOrgRoster(userId: string, orgId: string): Promise<boolean> {
  if (await isLeagueAdmin(userId)) return true;
  const inOrg = await userInOrg(userId, orgId);
  if (!inOrg) return false;
  const leadership = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, userId),
        inArray(userRoles.role, ["org_president", "org_officer"] as const),
      ),
    )
    .limit(1);
  return leadership.length > 0;
}

async function userHasInstructorRole(uid: string): Promise<boolean> {
  const [row] = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(and(eq(userRoles.userId, uid), eq(userRoles.role, "instructor")))
    .limit(1);
  return !!row;
}

const advisorPatchSchema = z
  .object({
    advisorUserId: z.union([z.string().uuid(), z.null()]),
  })
  .strict();

const memberPostSchema = z
  .object({
    userId: z.string().uuid(),
    title: z.union([z.string(), z.null()]).optional(),
  })
  .strict();

const memberPatchSchema = z
  .object({
    title: z.union([z.string(), z.null()]),
  })
  .strict();

export const orgsRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware)
  .post("/", requireUser, requireRoles("org_president", "league_admin"), async (c) => {
    const userId = c.get("userId")!;
    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = orgCreateSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }
    const { nameFull, nameShort, orgType, logoUrl } = parsed.data;
    const payload = {
      nameFull,
      nameShort,
      orgType,
      ...(logoUrl !== undefined ? { logoUrl } : {}),
    };

    const roles = c.get("roles") ?? [];
    const isPresident = roles.includes("org_president");

    const result = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          nameFull,
          nameShort,
          orgType,
          logoUrl: logoUrl === undefined ? null : logoUrl,
          lifecycleStatus: "pending",
        })
        .returning();

      const [rev] = await tx
        .insert(orgRevisions)
        .values({
          orgId: org!.id,
          payloadJson: JSON.stringify(payload),
          status: "pending",
        })
        .returning({ id: orgRevisions.id });

      if (isPresident) {
        await tx.insert(orgMemberships).values({
          orgId: org!.id,
          userId,
          title: "President",
        });
      }

      return { org: org!, revisionId: rev!.id };
    });

    return c.json(
      {
        organization: orgToJson(result.org),
        revisionId: result.revisionId,
      },
      201,
    );
  })
  .get("/", requireUser, async (c) => {
    const rows = await db
      .select()
      .from(organizations)
      .where(eq(organizations.lifecycleStatus, "active"))
      .orderBy(asc(organizations.nameShort));

    return c.json({ organizations: rows.map(orgToJson) });
  })
  .patch("/:orgId", requireUser, async (c) => {
    const orgId = c.req.param("orgId");
    if (!isUuid(orgId)) {
      return c.json({ error: "Invalid org id" }, 400);
    }
    const userId = c.get("userId")!;

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) {
      return c.json({ error: "Organization not found" }, 404);
    }

    if (!(await canSubmitOrgRevision(userId, orgId))) {
      return c.json({ error: "forbidden" }, 403);
    }

    if (await hasPendingRevisionForOrg(orgId)) {
      return c.json({ error: "A pending revision already exists for this organization" }, 409);
    }

    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = orgRevisionPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }
    const keys = Object.keys(parsed.data);
    if (keys.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    const [rev] = await db
      .insert(orgRevisions)
      .values({
        orgId,
        payloadJson: JSON.stringify(parsed.data),
        status: "pending",
      })
      .returning({
        id: orgRevisions.id,
        createdAt: orgRevisions.createdAt,
      });

    return c.json({
      revision: {
        id: rev!.id,
        orgId,
        status: "pending",
        createdAt: rev!.createdAt.toISOString(),
      },
    });
  })
  .post("/revisions/:revisionId/decide", requireUser, requireRoles("league_admin"), async (c) => {
    const revisionId = c.req.param("revisionId");
    if (!isUuid(revisionId)) {
      return c.json({ error: "Invalid revision id" }, 400);
    }

    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = revisionDecideSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }

    const { action, reason } = parsed.data;
    if (action === "reject" && (reason === undefined || reason.trim() === "")) {
      return c.json({ error: "reason is required when rejecting" }, 400);
    }

    const reviewerId = c.get("userId")!;
    const decidedAt = new Date();

    const [revision] = await db
      .select()
      .from(orgRevisions)
      .where(eq(orgRevisions.id, revisionId))
      .limit(1);

    if (!revision) {
      return c.json({ error: "Revision not found" }, 404);
    }
    if (revision.status !== "pending") {
      return c.json({ error: "Revision is not pending" }, 409);
    }

    let payload: z.infer<typeof orgRevisionPayloadSchema>;
    try {
      const p = JSON.parse(revision.payloadJson) as unknown;
      const pr = orgRevisionPayloadSchema.safeParse(p);
      if (!pr.success) {
        return c.json({ error: "Stored revision payload is invalid" }, 500);
      }
      payload = pr.data;
    } catch {
      return c.json({ error: "Stored revision payload is invalid" }, 500);
    }

    await db.transaction(async (tx) => {
      if (action === "approve") {
        const updates: Partial<typeof organizations.$inferInsert> = {
          lifecycleStatus: "active",
        };
        if (payload.nameFull !== undefined) updates.nameFull = payload.nameFull;
        if (payload.nameShort !== undefined) updates.nameShort = payload.nameShort;
        if (payload.orgType !== undefined) updates.orgType = payload.orgType;
        if (payload.logoUrl !== undefined) updates.logoUrl = payload.logoUrl;

        await tx
          .update(organizations)
          .set(updates)
          .where(eq(organizations.id, revision.orgId));

        await tx
          .update(orgRevisions)
          .set({
            status: "approved",
            reviewerUserId: reviewerId,
            reviewReason: null,
            decidedAt,
          })
          .where(eq(orgRevisions.id, revisionId));
      } else {
        await tx
          .update(orgRevisions)
          .set({
            status: "rejected",
            reviewerUserId: reviewerId,
            reviewReason: reason!.trim(),
            decidedAt,
          })
          .where(eq(orgRevisions.id, revisionId));
      }
    });

    const [updatedOrg] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, revision.orgId))
      .limit(1);

    const [updatedRev] = await db
      .select()
      .from(orgRevisions)
      .where(eq(orgRevisions.id, revisionId))
      .limit(1);

    return c.json({
      organization: orgToJson(updatedOrg!),
      revision: {
        id: updatedRev!.id,
        orgId: updatedRev!.orgId,
        status: updatedRev!.status,
        reviewReason: updatedRev!.reviewReason,
        decidedAt: updatedRev!.decidedAt?.toISOString() ?? null,
      },
    });
  })
  .patch("/:orgId/advisor", requireUser, async (c) => {
    const orgId = c.req.param("orgId");
    if (!isUuid(orgId)) {
      return c.json({ error: "Invalid org id" }, 400);
    }
    const actorId = c.get("userId")!;
    if (!(await canManageOrgRoster(actorId, orgId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) {
      return c.json({ error: "Organization not found" }, 404);
    }
    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = advisorPatchSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }
    const { advisorUserId } = parsed.data;
    if (advisorUserId !== null) {
      const [advUser] = await db.select().from(users).where(eq(users.id, advisorUserId)).limit(1);
      if (!advUser) {
        return c.json({ error: "Advisor user not found" }, 400);
      }
      if (!(await userHasInstructorRole(advisorUserId))) {
        return c.json({ error: "Advisor must be a user with instructor role" }, 400);
      }
    }
    const prevAdvisorId = org.advisorUserId;
    if (prevAdvisorId === advisorUserId || (prevAdvisorId === null && advisorUserId === null)) {
      return c.json({ organization: orgToJson(org) });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(organizations)
        .set({ advisorUserId })
        .where(eq(organizations.id, orgId));
      await tx.insert(orgLeadershipEvents).values({
        orgId,
        actorUserId: actorId,
        changeKind: "advisor_updated",
        payloadJson: JSON.stringify({
          advisorUserPrev: prevAdvisorId,
          advisorUserNext: advisorUserId,
        }),
      });
    });

    const [updated] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    return c.json({ organization: orgToJson(updated!) });
  })
  .get("/:orgId/leadership-events", requireUser, async (c) => {
    const orgId = c.req.param("orgId");
    if (!isUuid(orgId)) {
      return c.json({ error: "Invalid org id" }, 400);
    }
    const userId = c.get("userId")!;
    if (!(await canManageOrgRoster(userId, orgId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const rows = await db
      .select()
      .from(orgLeadershipEvents)
      .where(eq(orgLeadershipEvents.orgId, orgId))
      .orderBy(desc(orgLeadershipEvents.createdAt))
      .limit(100);

    return c.json({
      events: rows.map((e) => ({
        id: e.id,
        orgId: e.orgId,
        actorUserId: e.actorUserId,
        changeKind: e.changeKind,
        payload: JSON.parse(e.payloadJson) as unknown,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  })
  .post("/:orgId/members", requireUser, async (c) => {
    const orgId = c.req.param("orgId");
    if (!isUuid(orgId)) {
      return c.json({ error: "Invalid org id" }, 400);
    }
    const actorId = c.get("userId")!;
    if (!(await canManageOrgRoster(actorId, orgId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) {
      return c.json({ error: "Organization not found" }, 404);
    }
    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = memberPostSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }
    const { userId: memberUserId, title } = parsed.data;
    const [u] = await db.select().from(users).where(eq(users.id, memberUserId)).limit(1);
    if (!u) {
      return c.json({ error: "User not found" }, 400);
    }
    const [existing] = await db
      .select()
      .from(orgMemberships)
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, memberUserId)))
      .limit(1);
    if (existing) {
      return c.json({ error: "User is already a member of this organization" }, 409);
    }

    const titleVal = title === undefined ? null : title;
    await db.transaction(async (tx) => {
      await tx.insert(orgMemberships).values({
        orgId,
        userId: memberUserId,
        title: titleVal,
      });
      await tx.insert(orgLeadershipEvents).values({
        orgId,
        actorUserId: actorId,
        changeKind: "member_added",
        payloadJson: JSON.stringify({ userId: memberUserId, title: titleVal }),
      });
    });

    return c.json(
      {
        membership: { orgId, userId: memberUserId, title: titleVal },
      },
      201,
    );
  })
  .patch("/:orgId/members/:memberUserId", requireUser, async (c) => {
    const orgId = c.req.param("orgId");
    const memberUserId = c.req.param("memberUserId");
    if (!isUuid(orgId) || !isUuid(memberUserId)) {
      return c.json({ error: "Invalid id" }, 400);
    }
    const actorId = c.get("userId")!;
    if (!(await canManageOrgRoster(actorId, orgId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = memberPatchSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }
    const { title } = parsed.data;
    const [row] = await db
      .select()
      .from(orgMemberships)
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, memberUserId)))
      .limit(1);
    if (!row) {
      return c.json({ error: "Membership not found" }, 404);
    }
    const prevTitle = row.title;
    if (prevTitle === title) {
      return c.json({ membership: { orgId, userId: memberUserId, title } });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(orgMemberships)
        .set({ title })
        .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, memberUserId)));
      await tx.insert(orgLeadershipEvents).values({
        orgId,
        actorUserId: actorId,
        changeKind: "member_title_updated",
        payloadJson: JSON.stringify({
          userId: memberUserId,
          titlePrev: prevTitle,
          titleNext: title,
        }),
      });
    });

    return c.json({ membership: { orgId, userId: memberUserId, title } });
  })
  .delete("/:orgId/members/:memberUserId", requireUser, async (c) => {
    const orgId = c.req.param("orgId");
    const memberUserId = c.req.param("memberUserId");
    if (!isUuid(orgId) || !isUuid(memberUserId)) {
      return c.json({ error: "Invalid id" }, 400);
    }
    const actorId = c.get("userId")!;
    if (!(await canManageOrgRoster(actorId, orgId))) {
      return c.json({ error: "forbidden" }, 403);
    }
    const [row] = await db
      .select()
      .from(orgMemberships)
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, memberUserId)))
      .limit(1);
    if (!row) {
      return c.json({ error: "Membership not found" }, 404);
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(orgMemberships)
        .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, memberUserId)));
      await tx.insert(orgLeadershipEvents).values({
        orgId,
        actorUserId: actorId,
        changeKind: "member_removed",
        payloadJson: JSON.stringify({ userId: memberUserId, title: row.title }),
      });
    });

    return c.json({ ok: true });
  })
  .post("/:orgId/tasks", requireUser, async (c) => {
    const orgId = c.req.param("orgId");
    if (!isUuid(orgId)) {
      return c.json({ error: "Invalid org id" }, 400);
    }
    const userId = c.get("userId")!;

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) {
      return c.json({ error: "Organization not found" }, 404);
    }

    if (!(await canCreateTaskForOrg(userId, orgId))) {
      return c.json({ error: "forbidden" }, 403);
    }

    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = taskCreateSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }

    const { kind, title, description, startsAt, endsAt, involvedOrgIds, assigneeUserIds } =
      parsed.data;

    if (!involvedOrgIds.includes(orgId)) {
      return c.json({ error: "involvedOrgIds must include the primary organization" }, 400);
    }
    if (kind === "cross" && involvedOrgIds.length < 2) {
      return c.json({ error: "cross tasks require at least two involved organizations" }, 400);
    }

    const uniqueInvolved = [...new Set(involvedOrgIds)];
    const orgRows = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(inArray(organizations.id, uniqueInvolved));
    if (orgRows.length !== uniqueInvolved.length) {
      return c.json({ error: "One or more involved organizations do not exist" }, 400);
    }

    const starts = startsAt === undefined || startsAt === null ? null : new Date(startsAt);
    const ends = endsAt === undefined || endsAt === null ? null : new Date(endsAt);

    const result = await db.transaction(async (tx) => {
      const [task] = await tx
        .insert(orgTasks)
        .values({
          orgId,
          title,
          description: description === undefined ? null : description,
          kind,
          createdByUserId: userId,
          startsAt: starts,
          endsAt: ends,
        })
        .returning();

      await tx.insert(orgTaskInvolvedOrgs).values(
        uniqueInvolved.map((oid) => ({ taskId: task!.id, orgId: oid })),
      );

      if (assigneeUserIds?.length) {
        const uniqueAssignees = [...new Set(assigneeUserIds)];
        await tx.insert(orgTaskAssignments).values(
          uniqueAssignees.map((aid) => ({
            taskId: task!.id,
            assigneeUserId: aid,
            status: "unread" as const,
          })),
        );
      }

      return task!;
    });

    return c.json(
      {
        task: {
          id: result.id,
          orgId: result.orgId,
          title: result.title,
          description: result.description,
          kind: result.kind,
          createdByUserId: result.createdByUserId,
          leagueVisible: result.leagueVisible,
          startsAt: result.startsAt?.toISOString() ?? null,
          endsAt: result.endsAt?.toISOString() ?? null,
          createdAt: result.createdAt.toISOString(),
          involvedOrgIds: uniqueInvolved,
        },
      },
      201,
    );
  });
