import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "db";
import {
  abilityTags,
  awards,
  notifications,
  studentProfiles,
  volunteerRecords,
} from "db/schema";
import { broadcastNotification } from "../lib/notification-broadcast.js";
import type { AuthVariables } from "../middleware/session.js";
import { requireRoles } from "../middleware/rbac.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

const abilityCategorySchema = z.enum([
  "technical",
  "planning",
  "management",
  "sports",
]);

function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | null> {
  return c.req.json().catch(() => null);
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

const patchMeSchema = z
  .object({
    profileDraftPhone: z.union([z.string(), z.null()]).optional(),
    profileDraftWechat: z.union([z.string(), z.null()]).optional(),
    github: z.union([z.string(), z.null()]).optional(),
    weibo: z.union([z.string(), z.null()]).optional(),
  })
  .strict();

const profileReviewSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    reason: z.string().optional(),
  })
  .strict();

const awardCreateSchema = z
  .object({
    title: z.string().min(1),
    proofUrl: z.union([z.string().max(2048), z.null()]).optional(),
  })
  .strict();

const awardReviewSchema = z
  .object({
    action: z.enum(["approve", "reject"]),
    reason: z.string().optional(),
  })
  .strict();

const abilityCreateSchema = z
  .object({
    category: abilityCategorySchema,
    label: z.string().min(1),
  })
  .strict();

type ProfileRow = typeof studentProfiles.$inferSelect;

function profileToJson(p: ProfileRow) {
  return {
    userId: p.userId,
    volunteerNumber: p.volunteerNumber,
    nationality: p.nationality,
    idNumber: p.idNumber,
    grade: p.grade,
    department: p.department,
    major: p.major,
    className: p.className,
    idPhotoUrl: p.idPhotoUrl,
    portraitUrl: p.portraitUrl,
    phone: p.phone,
    wechat: p.wechat,
    github: p.github,
    weibo: p.weibo,
    profileDraftPhone: p.profileDraftPhone,
    profileDraftWechat: p.profileDraftWechat,
    profileAuditStatus: p.profileAuditStatus,
    profileAuditReason: p.profileAuditReason,
  };
}

const ABILITY_CATEGORIES = [
  "technical",
  "planning",
  "management",
  "sports",
] as const;

function groupAbilityTags(
  rows: { id: string; category: string; label: string }[],
): Record<(typeof ABILITY_CATEGORIES)[number], { id: string; label: string }[]> {
  const empty: Record<(typeof ABILITY_CATEGORIES)[number], { id: string; label: string }[]> = {
    technical: [],
    planning: [],
    management: [],
    sports: [],
  };
  for (const r of rows) {
    const cat = r.category as (typeof ABILITY_CATEGORIES)[number];
    if (empty[cat]) {
      empty[cat].push({ id: r.id, label: r.label });
    }
  }
  return empty;
}

function sumVolunteerHours(
  records: { hours: string | number }[],
): number {
  return records.reduce((acc, r) => acc + Number.parseFloat(String(r.hours)), 0);
}

export const archiveRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware)
  .get("/me", requireUser, async (c) => {
    const userId = c.get("userId")!;

    const [profile] = await db
      .select()
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId))
      .limit(1);

    if (!profile) {
      return c.json({ error: "Student profile not found" }, 404);
    }

    const tags = await db
      .select({
        id: abilityTags.id,
        category: abilityTags.category,
        label: abilityTags.label,
      })
      .from(abilityTags)
      .where(eq(abilityTags.userId, userId));

    const awardRows = await db
      .select({
        id: awards.id,
        title: awards.title,
        proofUrl: awards.proofUrl,
        status: awards.status,
        reason: awards.reason,
        decidedAt: awards.decidedAt,
        createdAt: awards.createdAt,
      })
      .from(awards)
      .where(eq(awards.userId, userId))
      .orderBy(asc(awards.createdAt));

    const vr = await db
      .select({
        id: volunteerRecords.id,
        title: volunteerRecords.title,
        hours: volunteerRecords.hours,
        source: volunteerRecords.source,
        externalRef: volunteerRecords.externalRef,
        occurredAt: volunteerRecords.occurredAt,
      })
      .from(volunteerRecords)
      .where(eq(volunteerRecords.volunteerNumber, profile.volunteerNumber))
      .orderBy(asc(volunteerRecords.occurredAt));

    const volunteerRecordsOut = vr.map((r) => ({
      id: r.id,
      title: r.title,
      hours: Number.parseFloat(String(r.hours)),
      source: r.source,
      externalRef: r.externalRef,
      occurredAt: r.occurredAt.toISOString(),
    }));

    return c.json({
      profile: profileToJson(profile),
      abilityTags: tags.map((t) => ({
        id: t.id,
        category: t.category,
        label: t.label,
      })),
      abilityTagsByCategory: groupAbilityTags(tags),
      awards: awardRows.map((a) => ({
        id: a.id,
        title: a.title,
        proofUrl: a.proofUrl,
        status: a.status,
        reason: a.reason,
        decidedAt: a.decidedAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
      volunteerSummary: {
        totalHours: sumVolunteerHours(vr),
        records: volunteerRecordsOut,
      },
    });
  })
  .patch("/me", requireUser, async (c) => {
    const userId = c.get("userId")!;

    const [existing] = await db
      .select({ userId: studentProfiles.userId })
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId))
      .limit(1);

    if (!existing) {
      return c.json({ error: "Student profile not found" }, 404);
    }

    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const parsed = patchMeSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }

    const data = parsed.data;
    const keys = Object.keys(data) as (keyof typeof data)[];
    if (keys.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    const draftTouched =
      Object.prototype.hasOwnProperty.call(data, "profileDraftPhone") ||
      Object.prototype.hasOwnProperty.call(data, "profileDraftWechat");

    const updates: Partial<{
      profileDraftPhone: string | null;
      profileDraftWechat: string | null;
      github: string | null;
      weibo: string | null;
      profileAuditStatus: string;
      profileAuditReason: null;
    }> = {};

    if (data.profileDraftPhone !== undefined) {
      updates.profileDraftPhone = data.profileDraftPhone;
    }
    if (data.profileDraftWechat !== undefined) {
      updates.profileDraftWechat = data.profileDraftWechat;
    }
    if (data.github !== undefined) {
      updates.github = data.github;
    }
    if (data.weibo !== undefined) {
      updates.weibo = data.weibo;
    }

    if (draftTouched) {
      updates.profileAuditStatus = "pending";
      updates.profileAuditReason = null;
    }

    await db.update(studentProfiles).set(updates).where(eq(studentProfiles.userId, userId));

    const [profile] = await db
      .select()
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId))
      .limit(1);

    return c.json({ profile: profileToJson(profile!) });
  })
  .post("/reviews/:userId", requireUser, requireRoles("league_admin"), async (c) => {
    const targetUserId = c.req.param("userId");
    if (!isUuid(targetUserId)) {
      return c.json({ error: "Invalid user id" }, 400);
    }

    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const parsed = profileReviewSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }

    const { action, reason } = parsed.data;
    if (action === "reject" && (reason === undefined || reason.trim() === "")) {
      return c.json({ error: "reason is required when rejecting" }, 400);
    }

    const reviewerId = c.get("userId")!;

    const [profile] = await db
      .select()
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, targetUserId))
      .limit(1);

    if (!profile) {
      return c.json({ error: "Student profile not found" }, 404);
    }

    if (profile.profileAuditStatus !== "pending") {
      return c.json({ error: "No pending profile change to review" }, 409);
    }

    const decidedAt = new Date();

    let insertedNotification: (typeof notifications.$inferSelect) | undefined;

    await db.transaction(async (tx) => {
      if (action === "approve") {
        const nextPhone =
          profile.profileDraftPhone !== null ? profile.profileDraftPhone : profile.phone;
        const nextWechat =
          profile.profileDraftWechat !== null ? profile.profileDraftWechat : profile.wechat;

        await tx
          .update(studentProfiles)
          .set({
            phone: nextPhone,
            wechat: nextWechat,
            profileDraftPhone: null,
            profileDraftWechat: null,
            profileAuditStatus: "approved",
            profileAuditReason: null,
          })
          .where(eq(studentProfiles.userId, targetUserId));
      } else {
        await tx
          .update(studentProfiles)
          .set({
            profileAuditStatus: "rejected",
            profileAuditReason: reason!.trim(),
          })
          .where(eq(studentProfiles.userId, targetUserId));
      }

      const [row] = await tx
        .insert(notifications)
        .values({
          userId: targetUserId,
          type: "archive_audit",
          payloadJson: JSON.stringify({
            scope: "profile",
            action,
            reason: action === "reject" ? reason!.trim() : null,
            reviewerUserId: reviewerId,
            decidedAt: decidedAt.toISOString(),
          }),
        })
        .returning();
      insertedNotification = row;
    });

    if (insertedNotification) {
      broadcastNotification(insertedNotification);
    }

    const [updated] = await db
      .select()
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, targetUserId))
      .limit(1);

    return c.json({ profile: profileToJson(updated!) });
  })
  .get("/awards", requireUser, async (c) => {
    const userId = c.get("userId")!;

    const [profile] = await db
      .select({ userId: studentProfiles.userId })
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId))
      .limit(1);

    if (!profile) {
      return c.json({ error: "Student profile not found" }, 404);
    }

    const awardRows = await db
      .select({
        id: awards.id,
        title: awards.title,
        proofUrl: awards.proofUrl,
        status: awards.status,
        reason: awards.reason,
        decidedAt: awards.decidedAt,
        createdAt: awards.createdAt,
      })
      .from(awards)
      .where(eq(awards.userId, userId))
      .orderBy(asc(awards.createdAt));

    return c.json({
      awards: awardRows.map((a) => ({
        id: a.id,
        title: a.title,
        proofUrl: a.proofUrl,
        status: a.status,
        reason: a.reason,
        decidedAt: a.decidedAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  })
  .post("/awards", requireUser, async (c) => {
    const userId = c.get("userId")!;

    const [profile] = await db
      .select({ userId: studentProfiles.userId })
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId))
      .limit(1);

    if (!profile) {
      return c.json({ error: "Student profile not found" }, 404);
    }

    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const parsed = awardCreateSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }

    let proofUrl: string | null = null;
    if (parsed.data.proofUrl !== undefined && parsed.data.proofUrl !== null) {
      const u = parsed.data.proofUrl;
      proofUrl = u.length === 0 ? null : u;
    }

    const [row] = await db
      .insert(awards)
      .values({
        userId,
        title: parsed.data.title,
        proofUrl,
        status: "pending",
      })
      .returning({
        id: awards.id,
        title: awards.title,
        proofUrl: awards.proofUrl,
        status: awards.status,
        createdAt: awards.createdAt,
      });

    return c.json(
      {
        award: {
          id: row!.id,
          title: row!.title,
          proofUrl: row!.proofUrl,
          status: row!.status,
          createdAt: row!.createdAt.toISOString(),
        },
      },
      201,
    );
  })
  .post("/awards/:id/review", requireUser, requireRoles("league_admin"), async (c) => {
    const awardId = c.req.param("id");
    if (!isUuid(awardId)) {
      return c.json({ error: "Invalid award id" }, 400);
    }

    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const parsed = awardReviewSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }

    const { action, reason } = parsed.data;
    if (action === "reject" && (reason === undefined || reason.trim() === "")) {
      return c.json({ error: "reason is required when rejecting" }, 400);
    }

    const reviewerId = c.get("userId")!;

    const [award] = await db.select().from(awards).where(eq(awards.id, awardId)).limit(1);

    if (!award) {
      return c.json({ error: "Award not found" }, 404);
    }

    if (award.status !== "pending") {
      return c.json({ error: "Award is not pending review" }, 409);
    }

    const decidedAt = new Date();
    const nextStatus = action === "approve" ? "approved" : "rejected";

    let insertedAwardNotification: (typeof notifications.$inferSelect) | undefined;

    await db.transaction(async (tx) => {
      await tx
        .update(awards)
        .set({
          status: nextStatus,
          reviewerUserId: reviewerId,
          reason: action === "reject" ? reason!.trim() : null,
          decidedAt,
        })
        .where(eq(awards.id, awardId));

      const [row] = await tx
        .insert(notifications)
        .values({
          userId: award.userId,
          type: "archive_audit",
          payloadJson: JSON.stringify({
            scope: "award",
            awardId,
            action,
            reason: action === "reject" ? reason!.trim() : null,
            reviewerUserId: reviewerId,
            decidedAt: decidedAt.toISOString(),
          }),
        })
        .returning();
      insertedAwardNotification = row;
    });

    if (insertedAwardNotification) {
      broadcastNotification(insertedAwardNotification);
    }

    const [updated] = await db.select().from(awards).where(eq(awards.id, awardId)).limit(1);

    return c.json({
      award: {
        id: updated!.id,
        title: updated!.title,
        proofUrl: updated!.proofUrl,
        status: updated!.status,
        reason: updated!.reason,
        decidedAt: updated!.decidedAt?.toISOString() ?? null,
        createdAt: updated!.createdAt.toISOString(),
      },
    });
  })
  .get("/ability-tags", requireUser, async (c) => {
    const userId = c.get("userId")!;

    const [profile] = await db
      .select({ userId: studentProfiles.userId })
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId))
      .limit(1);

    if (!profile) {
      return c.json({ error: "Student profile not found" }, 404);
    }

    const tags = await db
      .select({
        id: abilityTags.id,
        category: abilityTags.category,
        label: abilityTags.label,
      })
      .from(abilityTags)
      .where(eq(abilityTags.userId, userId));

    return c.json({ tags });
  })
  .post("/ability-tags", requireUser, async (c) => {
    const userId = c.get("userId")!;

    const [profile] = await db
      .select({ userId: studentProfiles.userId })
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId))
      .limit(1);

    if (!profile) {
      return c.json({ error: "Student profile not found" }, 404);
    }

    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const parsed = abilityCreateSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }

    const [row] = await db
      .insert(abilityTags)
      .values({
        userId,
        category: parsed.data.category,
        label: parsed.data.label,
      })
      .returning({
        id: abilityTags.id,
        category: abilityTags.category,
        label: abilityTags.label,
      });

    return c.json({ tag: row! }, 201);
  })
  .delete("/ability-tags/:id", requireUser, async (c) => {
    const userId = c.get("userId")!;
    const tagId = c.req.param("id");
    if (!isUuid(tagId)) {
      return c.json({ error: "Invalid tag id" }, 400);
    }

    const [tag] = await db
      .select({ id: abilityTags.id })
      .from(abilityTags)
      .where(and(eq(abilityTags.id, tagId), eq(abilityTags.userId, userId)))
      .limit(1);

    if (!tag) {
      return c.json({ error: "Not found" }, 404);
    }

    await db.delete(abilityTags).where(eq(abilityTags.id, tagId));

    return c.json({ ok: true });
  });
