import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { isValidFacultyMajorPair, isValidStudentGrade } from "academic-catalog";
import { db } from "db";
import {
  abilityTags,
  awards,
  leagueCoordinationEvents,
  notifications,
  studentProfiles,
  studentVolunteerEventClaims,
  users,
  volunteerRecords,
} from "db/schema";
import {
  BASIC_KEYS,
  basicI18nDeepEqual,
  IDENTITY_DRAFT_KEYS,
  type IdentityDraft,
  identityDraftFromProfileRow,
  identityDraftsEqual,
  mergeBasicI18n,
  normStudentNo,
  parseBasicI18n,
  parseIdentityDraft,
  profileToJson,
  triPhoneEmailFromBasic,
} from "../lib/archive-profile-format.js";
import { broadcastNotification } from "../lib/notification-broadcast.js";
import {
  deleteVolunteerRecordForCoordination,
  syncVolunteerRecordsForUser,
} from "../services/archive-volunteer-sync.js";
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
    studentNo: z.union([z.string(), z.null()]).optional(),
    volunteerNumber: z.union([z.string(), z.null()]).optional(),
    nationality: z.union([z.string(), z.null()]).optional(),
    idNumber: z.union([z.string(), z.null()]).optional(),
    grade: z.union([z.string(), z.null()]).optional(),
    department: z.union([z.string(), z.null()]).optional(),
    major: z.union([z.string(), z.null()]).optional(),
    className: z.union([z.string(), z.null()]).optional(),
    idPhotoUrl: z.union([z.string(), z.null()]).optional(),
    portraitUrl: z.union([z.string(), z.null()]).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.studentNo !== undefined && data.basicI18nDraft === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "studentNo must be submitted together with basicI18nDraft",
        path: ["studentNo"],
      });
    }
  });

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
    scope: z.enum(["profile_basic", "profile_identity"]).optional(),
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

    const identityTouched = IDENTITY_DRAFT_KEYS.some((k) => data[k] !== undefined);
    if (identityTouched) {
      for (const k of IDENTITY_DRAFT_KEYS) {
        if (data[k] === undefined) {
          return c.json(
            { error: "All identity fields are required to submit identity for review" },
            400,
          );
        }
      }
    }

    if (identityTouched && data.basicI18nDraft !== undefined) {
      return c.json(
        { error: "Submit basic and identity changes in separate requests" },
        400,
      );
    }

    const updates: Record<string, unknown> = {};

    if (data.github !== undefined) {
      updates.github = data.github;
    }
    if (data.weibo !== undefined) {
      updates.weibo = data.weibo;
    }

    if (identityTouched) {
      const urlOrNull = (v: unknown) => {
        if (v === null) return null;
        if (typeof v !== "string") return null;
        const t = v.trim();
        return t.length > 0 ? t : null;
      };
      const strReq = (v: unknown) => {
        if (typeof v !== "string" || !v.trim()) {
          throw new Error("invalid");
        }
        return v.trim();
      };
      try {
        const draft: IdentityDraft = {
          nationality: strReq(data.nationality),
          idNumber: strReq(data.idNumber),
          grade: strReq(data.grade),
          department: strReq(data.department),
          major: strReq(data.major),
          className: strReq(data.className),
          idPhotoUrl: urlOrNull(data.idPhotoUrl),
          portraitUrl: urlOrNull(data.portraitUrl),
          volunteerNumber: strReq(data.volunteerNumber),
        };
        if (!draft.idPhotoUrl?.trim() || !draft.portraitUrl?.trim()) {
          return c.json({ error: "Identity photos and volunteer number are required" }, 400);
        }
        if (!isValidFacultyMajorPair(draft.department, draft.major)) {
          return c.json({ error: "系别与专业必须从学校目录中选择" }, 400);
        }
        const publishedSnap = identityDraftFromProfileRow(existing);
        if (identityDraftsEqual(draft, publishedSnap)) {
          return c.json({ error: "No changes to submit for identity review" }, 400);
        }
        updates.identityDraft = draft;
        updates.identityAuditStatus = "pending";
        updates.identityAuditReason = null;
      } catch {
        return c.json({ error: "Invalid identity field values" }, 400);
      }
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
      const nextSnDraft =
        data.studentNo !== undefined
          ? normStudentNo(data.studentNo)
          : normStudentNo(existing.studentNoDraft ?? existing.studentNo);
      const publishedSn = normStudentNo(existing.studentNo);
      if (basicI18nDeepEqual(merged, published) && nextSnDraft === publishedSn) {
        return c.json({ error: "No changes to submit for basic information review" }, 400);
      }
      updates.basicI18nDraft = draftObj;
      updates.basicAuditStatus = "pending";
      updates.basicAuditReason = null;
      updates.studentNoDraft = nextSnDraft;
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
      .select({ userId: studentProfiles.userId, volunteerNumber: studentProfiles.volunteerNumber })
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId))
      .limit(1);

    if (!profile) {
      return c.json({ error: "Student profile not found" }, 404);
    }

    if (!profile.volunteerNumber.trim()) {
      return c.json(
        { error: "Volunteer number is required on your profile before claiming coordination hours" },
        400,
      );
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

    const [existingClaim] = await db
      .select({ auditStatus: studentVolunteerEventClaims.auditStatus })
      .from(studentVolunteerEventClaims)
      .where(
        and(
          eq(studentVolunteerEventClaims.userId, userId),
          eq(studentVolunteerEventClaims.coordinationEventId, coordinationEventId),
        ),
      )
      .limit(1);

    if (existingClaim?.auditStatus === "approved") {
      return c.json(
        {
          error:
            "Coordination claim for this activity is already approved; you cannot submit again.",
        },
        400,
      );
    }

    const hoursVal =
      claimedHours !== undefined ? claimedHours.toFixed(2) : null;

    await db
      .insert(studentVolunteerEventClaims)
      .values({
        userId,
        coordinationEventId,
        claimedHours: hoursVal,
        auditStatus: "pending",
      })
      .onConflictDoUpdate({
        target: [
          studentVolunteerEventClaims.userId,
          studentVolunteerEventClaims.coordinationEventId,
        ],
        set: {
          // Always take the incoming row's claimed_hours (NULL when optional field omitted) so a resubmit without hours clears a previous value.
          claimedHours: sql`excluded.claimed_hours`,
          auditStatus: sql`'pending'::volunteer_claim_audit_status`,
          reviewedAt: sql`NULL`,
          reviewerUserId: sql`NULL`,
          rejectReason: sql`NULL`,
        },
      });

    await deleteVolunteerRecordForCoordination(profile.volunteerNumber.trim(), coordinationEventId);

    return c.json({ ok: true, auditStatus: "pending" as const });
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

    const { action, reason, scope: scopeRaw } = parsed.data;
    const scope = scopeRaw ?? "profile_basic";
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

    if (scope === "profile_basic") {
      if (profile.basicAuditStatus !== "pending") {
        return c.json({ error: "No pending basic profile change to review" }, 409);
      }
    } else {
      if (profile.identityAuditStatus !== "pending") {
        return c.json({ error: "No pending identity change to review" }, 409);
      }
    }

    if (scope === "profile_identity" && action === "approve") {
      const idDraft = parseIdentityDraft(profile.identityDraft);
      if (!idDraft) {
        return c.json({ error: "Invalid identity draft" }, 400);
      }
      if (!isValidFacultyMajorPair(idDraft.department, idDraft.major)) {
        return c.json({ error: "系别与专业必须从学校目录中选择" }, 400);
      }
      if (!isValidStudentGrade(idDraft.grade)) {
        return c.json({ error: "年级必须从学校目录中选择" }, 400);
      }
    }

    const decidedAt = new Date();

    const notificationsOut: (typeof notifications.$inferSelect)[] = [];

    await db.transaction(async (tx) => {
      if (scope === "profile_basic") {
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
          const nextStudentNo =
            normStudentNo(profile.studentNoDraft) ?? profile.studentNo;
          const displayPick =
            draftParsed.name?.zh?.trim() ||
            draftParsed.name?.en?.trim() ||
            draftParsed.name?.ru?.trim() ||
            null;
          await tx
            .update(studentProfiles)
            .set({
              basicI18nPublished: draftObj,
              basicI18nDraft: null,
              basicAuditStatus: "approved",
              basicAuditReason: null,
              phone: pubPhone ?? profile.phone,
              wechat: pubWechat ?? profile.wechat,
              studentNo: nextStudentNo,
              studentNoDraft: null,
            })
            .where(eq(studentProfiles.userId, targetUserId));
          if (displayPick) {
            await tx
              .update(users)
              .set({ displayName: displayPick })
              .where(eq(users.id, targetUserId));
          }
        } else {
          await tx
            .update(studentProfiles)
            .set({
              basicAuditStatus: "rejected",
              basicAuditReason: reason!.trim(),
            })
            .where(eq(studentProfiles.userId, targetUserId));
        }
      } else if (action === "approve") {
        const id = parseIdentityDraft(profile.identityDraft)!;
        await tx
          .update(studentProfiles)
          .set({
            nationality: id.nationality,
            idNumber: id.idNumber,
            grade: id.grade,
            department: id.department,
            major: id.major,
            className: id.className,
            idPhotoUrl: id.idPhotoUrl,
            portraitUrl: id.portraitUrl,
            volunteerNumber: id.volunteerNumber,
            identityDraft: null,
            identityAuditStatus: "approved",
            identityAuditReason: null,
          })
          .where(eq(studentProfiles.userId, targetUserId));
      } else {
        await tx
          .update(studentProfiles)
          .set({
            identityAuditStatus: "rejected",
            identityAuditReason: reason!.trim(),
          })
          .where(eq(studentProfiles.userId, targetUserId));
      }

      const [row] = await tx
        .insert(notifications)
        .values({
          userId: targetUserId,
          type: "archive_audit",
          payloadJson: JSON.stringify({
            scope,
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

    if (scope === "profile_identity" && action === "approve") {
      await syncVolunteerRecordsForUser(targetUserId);
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
