import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "db";
import {
  abilityTags,
  awards,
  leagueCoordinationEvents,
  notifications,
  studentProfiles,
  studentVolunteerEventClaims,
  volunteerRecords,
} from "db/schema";
import {
  BASIC_KEYS,
  mergeBasicI18n,
  parseBasicI18n,
  profileToJson,
  triPhoneEmailFromBasic,
} from "../lib/archive-profile-format.js";
import { broadcastNotification } from "../lib/notification-broadcast.js";
import { syncVolunteerRecordsForUser } from "../services/archive-volunteer-sync.js";
import { fetchStudentArchiveDetail } from "../services/student-archive-read.js";
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

const localeTriSchema = z
  .object({
    zh: z.string().optional(),
    en: z.string().optional(),
    ru: z.string().optional(),
  })
  .strict();

const basicI18nSchema = z
  .object({
    name: localeTriSchema.optional(),
    phone: localeTriSchema.optional(),
    wechat: localeTriSchema.optional(),
    email: localeTriSchema.optional(),
    github: localeTriSchema.optional(),
    weibo: localeTriSchema.optional(),
  })
  .strict();

const patchMeSchema = z
  .object({
    github: z.union([z.string(), z.null()]).optional(),
    weibo: z.union([z.string(), z.null()]).optional(),
    basicI18nDraft: basicI18nSchema.optional(),
    studentNo: z.union([z.string().min(1), z.null()]).optional(),
    volunteerNumber: z.union([z.string().min(1), z.null()]).optional(),
    nationality: z.union([z.string(), z.null()]).optional(),
    idNumber: z.union([z.string(), z.null()]).optional(),
    grade: z.union([z.string(), z.null()]).optional(),
    department: z.union([z.string(), z.null()]).optional(),
    major: z.union([z.string(), z.null()]).optional(),
    className: z.union([z.string(), z.null()]).optional(),
    idPhotoUrl: z.union([z.string(), z.null()]).optional(),
    portraitUrl: z.union([z.string(), z.null()]).optional(),
  })
  .strict();

const volunteerClaimSchema = z
  .object({
    coordinationEventId: z.string().uuid(),
    claimedHours: z.number().positive().optional(),
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

export const archiveRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware)
  .get("/me", requireUser, async (c) => {
    const userId = c.get("userId")!;
    const bundle = await fetchStudentArchiveDetail(userId);
    if (!bundle) {
      return c.json({ error: "Student profile not found" }, 404);
    }
    return c.json(bundle);
  })
  .patch("/me", requireUser, async (c) => {
    const userId = c.get("userId")!;

    const [existing] = await db
      .select()
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

    const updates: Record<string, unknown> = {};

    if (data.github !== undefined) {
      updates.github = data.github;
    }
    if (data.weibo !== undefined) {
      updates.weibo = data.weibo;
    }
    if (data.studentNo !== undefined) {
      updates.studentNo = data.studentNo;
    }
    if (data.volunteerNumber !== undefined) {
      updates.volunteerNumber = data.volunteerNumber;
    }
    if (data.nationality !== undefined) {
      updates.nationality = data.nationality;
    }
    if (data.idNumber !== undefined) {
      updates.idNumber = data.idNumber;
    }
    if (data.grade !== undefined) {
      updates.grade = data.grade;
    }
    if (data.department !== undefined) {
      updates.department = data.department;
    }
    if (data.major !== undefined) {
      updates.major = data.major;
    }
    if (data.className !== undefined) {
      updates.className = data.className;
    }
    if (data.idPhotoUrl !== undefined) {
      updates.idPhotoUrl = data.idPhotoUrl;
    }
    if (data.portraitUrl !== undefined) {
      updates.portraitUrl = data.portraitUrl;
    }

    if (data.basicI18nDraft !== undefined) {
      const published = parseBasicI18n(existing.basicI18nPublished);
      const priorDraft =
        existing.basicI18nDraft === null ? published : parseBasicI18n(existing.basicI18nDraft);
      const merged = mergeBasicI18n(priorDraft, parseBasicI18n(data.basicI18nDraft));
      const draftObj: Record<string, { zh?: string; en?: string; ru?: string }> = {};
      for (const k of BASIC_KEYS) {
        const t = merged[k];
        if (t) draftObj[k] = t;
      }
      updates.basicI18nDraft = draftObj;
      updates.basicAuditStatus = "pending";
      updates.basicAuditReason = null;
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    await db
      .update(studentProfiles)
      .set(updates as Partial<typeof existing>)
      .where(eq(studentProfiles.userId, userId));

    const [profile] = await db
      .select()
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId))
      .limit(1);

    return c.json({ profile: profileToJson(profile!) });
  })
  .post("/volunteer-claims", requireUser, async (c) => {
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

    const parsed = volunteerClaimSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }

    const { coordinationEventId, claimedHours } = parsed.data;

    const [event] = await db
      .select()
      .from(leagueCoordinationEvents)
      .where(eq(leagueCoordinationEvents.id, coordinationEventId))
      .limit(1);

    if (!event) {
      return c.json({ error: "Coordination event not found" }, 404);
    }

    if (event.category !== "volunteer") {
      return c.json({ error: "Event is not a volunteer activity" }, 400);
    }

    const hoursVal =
      claimedHours !== undefined ? claimedHours.toFixed(2) : null;

    await db
      .insert(studentVolunteerEventClaims)
      .values({
        userId,
        coordinationEventId,
        claimedHours: hoursVal,
      })
      .onConflictDoUpdate({
        target: [
          studentVolunteerEventClaims.userId,
          studentVolunteerEventClaims.coordinationEventId,
        ],
        set: {
          claimedHours:
            claimedHours !== undefined
              ? sql`excluded.claimed_hours`
              : sql`${studentVolunteerEventClaims.claimedHours}`,
        },
      });

    const { upserted } = await syncVolunteerRecordsForUser(userId);

    return c.json({ ok: true, upserted });
  })
  .post("/volunteer-sync", requireUser, async (c) => {
    const userId = c.get("userId")!;

    const [profile] = await db
      .select({ userId: studentProfiles.userId })
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId))
      .limit(1);

    if (!profile) {
      return c.json({ error: "Student profile not found" }, 404);
    }

    const { upserted } = await syncVolunteerRecordsForUser(userId);

    return c.json({ upserted });
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

    const basicPending = profile.basicAuditStatus === "pending";

    if (!basicPending) {
      return c.json({ error: "No pending profile change to review" }, 409);
    }

    const decidedAt = new Date();

    const notificationsOut: (typeof notifications.$inferSelect)[] = [];

    await db.transaction(async (tx) => {
      if (action === "approve") {
        const draftParsed =
          profile.basicI18nDraft === null
            ? parseBasicI18n(profile.basicI18nPublished)
            : parseBasicI18n(profile.basicI18nDraft);
        const draftObj: Record<string, { zh?: string; en?: string; ru?: string }> = {};
        for (const k of BASIC_KEYS) {
          const t = draftParsed[k];
          if (t) draftObj[k] = t;
        }
        const { phone: pubPhone, wechat: pubWechat } = triPhoneEmailFromBasic(draftParsed);
        await tx
          .update(studentProfiles)
          .set({
            basicI18nPublished: draftObj,
            basicI18nDraft: null,
            basicAuditStatus: "approved",
            basicAuditReason: null,
            phone: pubPhone ?? profile.phone,
            wechat: pubWechat ?? profile.wechat,
          })
          .where(eq(studentProfiles.userId, targetUserId));
      } else {
        await tx
          .update(studentProfiles)
          .set({
            basicAuditStatus: "rejected",
            basicAuditReason: reason!.trim(),
          })
          .where(eq(studentProfiles.userId, targetUserId));
      }

      const [row] = await tx
        .insert(notifications)
        .values({
          userId: targetUserId,
          type: "archive_audit",
          payloadJson: JSON.stringify({
            scope: "profile_basic",
            action,
            reason: action === "reject" ? reason!.trim() : null,
            reviewerUserId: reviewerId,
            decidedAt: decidedAt.toISOString(),
          }),
        })
        .returning();
      if (row) notificationsOut.push(row);
    });

    for (const n of notificationsOut) {
      broadcastNotification(n);
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
