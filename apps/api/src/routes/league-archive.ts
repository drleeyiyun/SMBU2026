import { and, asc, desc, eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "db";
import { notifications, studentProfiles, users } from "db/schema";
import type { AuthVariables } from "../middleware/session.js";
import { requireRoles } from "../middleware/rbac.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

export const leagueArchiveRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware)
  .get("/pending", requireUser, requireRoles("league_admin"), async (c) => {
    const rows = await db
      .select({
        userId: studentProfiles.userId,
        displayName: users.displayName,
        basicAuditStatus: studentProfiles.basicAuditStatus,
        profileAuditStatus: studentProfiles.profileAuditStatus,
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

    return c.json({ items: rows });
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

    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        payload: JSON.parse(r.payloadJson) as unknown,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });
