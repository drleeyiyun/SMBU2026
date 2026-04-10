import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "db";
import { notifications, studentProfiles, users } from "db/schema";
import { parseBasicI18n } from "../lib/archive-profile-format.js";
import type { AuthVariables } from "../middleware/session.js";
import { requireRoles } from "../middleware/rbac.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";
import { fetchStudentArchiveDetail } from "../services/student-archive-read.js";

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
        profileAuditStatus: studentProfiles.profileAuditStatus,
      })
      .from(studentProfiles)
      .innerJoin(users, eq(studentProfiles.userId, users.id))
      .where(nameOrNo)
      .orderBy(asc(users.displayName));

    return c.json({ items: rows });
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

    return c.json({
      user: {
        id: urow.id,
        email: urow.email,
        displayName: urow.displayName,
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
        department: studentProfiles.department,
        major: studentProfiles.major,
        grade: studentProfiles.grade,
        basicAuditStatus: studentProfiles.basicAuditStatus,
        profileAuditStatus: studentProfiles.profileAuditStatus,
        basicI18nPublished: studentProfiles.basicI18nPublished,
        basicI18nDraft: studentProfiles.basicI18nDraft,
        phone: studentProfiles.phone,
        wechat: studentProfiles.wechat,
        profileDraftPhone: studentProfiles.profileDraftPhone,
        profileDraftWechat: studentProfiles.profileDraftWechat,
      })
      .from(studentProfiles)
      .innerJoin(users, eq(studentProfiles.userId, users.id))
      .where(
        or(
          eq(studentProfiles.basicAuditStatus, "pending"),
          eq(studentProfiles.profileAuditStatus, "pending"),
        ),
      )
      .orderBy(asc(users.displayName));

    return c.json({
      items: rows.map((r) => ({
        userId: r.userId,
        displayName: r.displayName,
        email: r.email,
        studentNo: r.studentNo,
        department: r.department,
        major: r.major,
        grade: r.grade,
        basicAuditStatus: r.basicAuditStatus,
        profileAuditStatus: r.profileAuditStatus,
        basicI18nPublished: parseBasicI18n(r.basicI18nPublished),
        basicI18nDraft:
          r.basicI18nDraft === null ? null : parseBasicI18n(r.basicI18nDraft),
        phone: r.phone,
        wechat: r.wechat,
        profileDraftPhone: r.profileDraftPhone,
        profileDraftWechat: r.profileDraftWechat,
      })),
    });
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
