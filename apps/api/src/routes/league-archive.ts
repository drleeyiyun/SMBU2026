import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "db";
import {
  awards,
  leagueCoordinationEvents,
  notifications,
  studentProfiles,
  studentVolunteerEventClaims,
  users,
} from "db/schema";
import {
  parseBasicI18n,
  parseIdentityDraft,
  resolveArchiveDisplayName,
} from "../lib/archive-profile-format.js";
import type { AuthVariables } from "../middleware/session.js";
import { requireRoles } from "../middleware/rbac.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";
import { fetchStudentArchiveDetail } from "../services/student-archive-read.js";
import {
  deleteVolunteerRecordForCoordination,
  resolveVolunteerHoursForClaim,
  syncVolunteerRecordsForUser,
} from "../services/archive-volunteer-sync.js";

const volunteerClaimReviewSchema = z
  .object({
    userId: z.string().uuid(),
    coordinationEventId: z.string().uuid(),
    action: z.enum(["approve", "reject"]),
    reason: z.string().optional(),
  })
  .strict();

async function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | null> {
  return c.req.json().catch(() => null);
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

export const leagueArchiveRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware)
  .get("/students", requireUser, requireRoles("league_admin"), async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    const nameOrNo =
      q.length > 0
        ? or(
            ilike(users.displayName, `%${q}%`),
            ilike(users.email, `%${q}%`),
            ilike(studentProfiles.studentNo, `%${q}%`),
          )
        : undefined;

    const rows = await db
      .select({
        userId: studentProfiles.userId,
        displayName: users.displayName,
        email: users.email,
        studentNo: studentProfiles.studentNo,
        department: studentProfiles.department,
        major: studentProfiles.major,
        grade: studentProfiles.grade,
        basicAuditStatus: studentProfiles.basicAuditStatus,
        basicI18nPublished: studentProfiles.basicI18nPublished,
        basicI18nDraft: studentProfiles.basicI18nDraft,
        identityAuditStatus: studentProfiles.identityAuditStatus,
        profileAuditStatus: studentProfiles.profileAuditStatus,
      })
      .from(studentProfiles)
      .innerJoin(users, eq(studentProfiles.userId, users.id))
      .where(nameOrNo)
      .orderBy(asc(users.displayName));

    const leagueNameOpts = { includePendingBasicDraft: false } as const;

    return c.json({
      items: rows.map((r) => ({
        userId: r.userId,
        displayName: resolveArchiveDisplayName(
          r.displayName,
          r.basicI18nPublished,
          r.basicI18nDraft,
          r.basicAuditStatus,
          leagueNameOpts,
        ),
        email: r.email,
        studentNo: r.studentNo,
        department: r.department,
        major: r.major,
        grade: r.grade,
        basicAuditStatus: r.basicAuditStatus,
        identityAuditStatus: r.identityAuditStatus,
        profileAuditStatus: r.profileAuditStatus,
      })),
    });
  })
  .get("/students/:userId", requireUser, requireRoles("league_admin"), async (c) => {
    const userId = c.req.param("userId");
    if (!isUuid(userId)) {
      return c.json({ error: "Invalid user id" }, 400);
    }

    const [urow] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!urow) {
      return c.json({ error: "User not found" }, 404);
    }

    const detail = await fetchStudentArchiveDetail(userId);
    if (!detail) {
      return c.json({ error: "Student profile not found" }, 404);
    }

    const resolvedName = resolveArchiveDisplayName(
      urow.displayName,
      detail.profile.basicI18nPublished,
      detail.profile.basicI18nDraft,
      detail.profile.basicAuditStatus,
      { includePendingBasicDraft: false },
    );

    return c.json({
      user: {
        id: urow.id,
        email: urow.email,
        displayName: resolvedName ?? urow.displayName,
      },
      ...detail,
    });
  })
  .get("/pending", requireUser, requireRoles("league_admin"), async (c) => {
    const rows = await db
      .select({
        userId: studentProfiles.userId,
        displayName: users.displayName,
        email: users.email,
        studentNo: studentProfiles.studentNo,
        studentNoDraft: studentProfiles.studentNoDraft,
        department: studentProfiles.department,
        major: studentProfiles.major,
        grade: studentProfiles.grade,
        basicAuditStatus: studentProfiles.basicAuditStatus,
        basicI18nPublished: studentProfiles.basicI18nPublished,
        basicI18nDraft: studentProfiles.basicI18nDraft,
      })
      .from(studentProfiles)
      .innerJoin(users, eq(studentProfiles.userId, users.id))
      .where(eq(studentProfiles.basicAuditStatus, "pending"))
      .orderBy(asc(users.displayName));

    return c.json({
           items: rows.map((r) => ({
        userId: r.userId,
        displayName: resolveArchiveDisplayName(
          r.displayName,
          r.basicI18nPublished,
          r.basicI18nDraft,
          r.basicAuditStatus,
          { includePendingBasicDraft: false },
        ),
        email: r.email,
        studentNo: r.studentNo,
        studentNoDraft: r.studentNoDraft,
        department: r.department,
        major: r.major,
        grade: r.grade,
        basicAuditStatus: r.basicAuditStatus,
        basicI18nPublished: parseBasicI18n(r.basicI18nPublished),
        basicI18nDraft:
          r.basicI18nDraft === null ? null : parseBasicI18n(r.basicI18nDraft),
      })),
    });
  })
  .get("/pending-identity", requireUser, requireRoles("league_admin"), async (c) => {
    const rows = await db
      .select({
        userId: studentProfiles.userId,
        displayName: users.displayName,
        email: users.email,
        studentNo: studentProfiles.studentNo,
        nationality: studentProfiles.nationality,
        idNumber: studentProfiles.idNumber,
        grade: studentProfiles.grade,
        department: studentProfiles.department,
        major: studentProfiles.major,
        className: studentProfiles.className,
        idPhotoUrl: studentProfiles.idPhotoUrl,
        portraitUrl: studentProfiles.portraitUrl,
        volunteerNumber: studentProfiles.volunteerNumber,
        identityDraft: studentProfiles.identityDraft,
        basicI18nPublished: studentProfiles.basicI18nPublished,
        basicI18nDraft: studentProfiles.basicI18nDraft,
        basicAuditStatus: studentProfiles.basicAuditStatus,
      })
      .from(studentProfiles)
      .innerJoin(users, eq(studentProfiles.userId, users.id))
      .where(eq(studentProfiles.identityAuditStatus, "pending"))
      .orderBy(asc(users.displayName));

    return c.json({
      items: rows.map((r) => ({
        userId: r.userId,
        displayName: resolveArchiveDisplayName(
          r.displayName,
          r.basicI18nPublished,
          r.basicI18nDraft,
          r.basicAuditStatus,
          { includePendingBasicDraft: false },
        ),
        email: r.email,
        studentNo: r.studentNo,
        identityPublished: {
          nationality: r.nationality,
          idNumber: r.idNumber,
          grade: r.grade,
          department: r.department,
          major: r.major,
          className: r.className,
          idPhotoUrl: r.idPhotoUrl && r.idPhotoUrl.trim() ? r.idPhotoUrl.trim() : null,
          portraitUrl: r.portraitUrl && r.portraitUrl.trim() ? r.portraitUrl.trim() : null,
          volunteerNumber: r.volunteerNumber,
        },
        identityDraft: parseIdentityDraft(r.identityDraft),
      })),
    });
  })
  .get("/awards/pending", requireUser, requireRoles("league_admin"), async (c) => {
    const rows = await db
      .select({
        id: awards.id,
        userId: awards.userId,
        title: awards.title,
        proofUrl: awards.proofUrl,
        createdAt: awards.createdAt,
        displayName: users.displayName,
        studentNo: studentProfiles.studentNo,
      })
      .from(awards)
      .innerJoin(users, eq(awards.userId, users.id))
      .innerJoin(studentProfiles, eq(studentProfiles.userId, awards.userId))
      .where(eq(awards.status, "pending"))
      .orderBy(desc(awards.createdAt));

    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        title: r.title,
        proofUrl: r.proofUrl,
        createdAt: r.createdAt.toISOString(),
        studentDisplayName: r.displayName,
        studentNo: r.studentNo,
      })),
    });
  })
  .get("/volunteer-claims/pending", requireUser, requireRoles("league_admin"), async (c) => {
    const rows = await db
      .select({
        userId: studentVolunteerEventClaims.userId,
        coordinationEventId: studentVolunteerEventClaims.coordinationEventId,
        claimedHours: studentVolunteerEventClaims.claimedHours,
        createdAt: studentVolunteerEventClaims.createdAt,
        eventTitle: leagueCoordinationEvents.title,
        eventStartsAt: leagueCoordinationEvents.startsAt,
        eventEndsAt: leagueCoordinationEvents.endsAt,
        defaultVolunteerHours: leagueCoordinationEvents.defaultVolunteerHours,
        displayName: users.displayName,
        studentNo: studentProfiles.studentNo,
        volunteerNumber: studentProfiles.volunteerNumber,
      })
      .from(studentVolunteerEventClaims)
      .innerJoin(
        leagueCoordinationEvents,
        eq(studentVolunteerEventClaims.coordinationEventId, leagueCoordinationEvents.id),
      )
      .innerJoin(users, eq(studentVolunteerEventClaims.userId, users.id))
      .innerJoin(studentProfiles, eq(studentProfiles.userId, studentVolunteerEventClaims.userId))
      .where(eq(studentVolunteerEventClaims.auditStatus, "pending"))
      .orderBy(desc(studentVolunteerEventClaims.createdAt));

    return c.json({
      items: rows.map((r) => ({
        userId: r.userId,
        coordinationEventId: r.coordinationEventId,
        eventTitle: r.eventTitle,
        claimedHours:
          r.claimedHours !== null && r.claimedHours !== undefined
            ? Number.parseFloat(String(r.claimedHours))
            : null,
        resolvedHours: resolveVolunteerHoursForClaim(r.claimedHours, {
          startsAt: r.eventStartsAt,
          endsAt: r.eventEndsAt,
          defaultVolunteerHours: r.defaultVolunteerHours,
        }),
        createdAt: r.createdAt.toISOString(),
        studentDisplayName: r.displayName,
        studentNo: r.studentNo,
        volunteerNumber: r.volunteerNumber,
      })),
    });
  })
  .post("/volunteer-claims/review", requireUser, requireRoles("league_admin"), async (c) => {
    const reviewerId = c.get("userId")!;
    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = volunteerClaimReviewSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }
    const { userId, coordinationEventId, action, reason } = parsed.data;
    const reasonTrim = reason?.trim() ?? "";
    if (action === "reject" && reasonTrim === "") {
      return c.json({ error: "reason is required when rejecting" }, 400);
    }

    const [claim] = await db
      .select()
      .from(studentVolunteerEventClaims)
      .where(
        and(
          eq(studentVolunteerEventClaims.userId, userId),
          eq(studentVolunteerEventClaims.coordinationEventId, coordinationEventId),
        ),
      )
      .limit(1);

    if (!claim) {
      return c.json({ error: "Claim not found" }, 404);
    }

    if (claim.auditStatus !== "pending") {
      return c.json({ error: "Claim is not pending" }, 400);
    }

    const [profile] = await db
      .select({ volunteerNumber: studentProfiles.volunteerNumber })
      .from(studentProfiles)
      .where(eq(studentProfiles.userId, userId))
      .limit(1);

    if (!profile) {
      return c.json({ error: "Student profile not found" }, 404);
    }

    const now = new Date();
    await db
      .update(studentVolunteerEventClaims)
      .set({
        auditStatus: action === "approve" ? "approved" : "rejected",
        reviewedAt: now,
        reviewerUserId: reviewerId,
        rejectReason: action === "reject" ? reasonTrim : null,
      })
      .where(
        and(
          eq(studentVolunteerEventClaims.userId, userId),
          eq(studentVolunteerEventClaims.coordinationEventId, coordinationEventId),
        ),
      );

    if (action === "reject") {
      await deleteVolunteerRecordForCoordination(profile.volunteerNumber.trim(), coordinationEventId);
      return c.json({ ok: true });
    }

    const { upserted } = await syncVolunteerRecordsForUser(userId);
    return c.json({ ok: true, upserted });
  })
  .get("/audit-log", requireUser, requireRoles("league_admin"), async (c) => {
    const userId = c.req.query("userId");
    const limitRaw = c.req.query("limit");
    const limit = Math.min(100, Math.max(1, Number.parseInt(limitRaw ?? "50", 10) || 50));
    const conds = [eq(notifications.type, "archive_audit")];
    if (userId && /^[0-9a-f-]{36}$/i.test(userId)) {
      conds.push(eq(notifications.userId, userId));
    }
    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conds))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);

    const studentIds = [...new Set(rows.map((r) => r.userId))];
    const nameById = new Map<string, string | null>();
    if (studentIds.length > 0) {
      const uprows = await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, studentIds));
      for (const u of uprows) {
        nameById.set(u.id, u.displayName);
      }
    }

    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        studentDisplayName: nameById.get(r.userId) ?? null,
        payload: JSON.parse(r.payloadJson) as unknown,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });
