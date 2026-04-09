import { and, eq, ilike, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "db";
import { studentProfiles, userRoles, users } from "db/schema";
import type { AuthVariables } from "../middleware/session.js";
import { requireRoles } from "../middleware/rbac.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

export const directoryRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware)
  .get("/instructors", requireUser, requireRoles("org_president", "org_officer", "league_admin"), async (c) => {
    const qRaw = c.req.query("q") ?? "";
    const q = qRaw.trim();
    if (q.length < 2) {
      return c.json({ error: "q must be at least 2 characters" }, 400);
    }
    const limitRaw = c.req.query("limit");
    let limit = 20;
    if (limitRaw !== undefined && limitRaw !== "") {
      const n = Number(limitRaw);
      if (!Number.isFinite(n) || n < 1) {
        return c.json({ error: "Invalid limit" }, 400);
      }
      limit = Math.min(50, Math.floor(n));
    }

    const pattern = `%${q}%`;
    const rows = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(and(eq(userRoles.role, "instructor"), or(ilike(users.displayName, pattern), ilike(users.email, pattern))))
      .limit(limit);

    const seen = new Set<string>();
    const uniq = rows.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    return c.json({
      users: uniq.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        email: r.email,
      })),
    });
  })
  .get("/students", requireUser, requireRoles("org_president", "org_officer", "league_admin"), async (c) => {
    const qRaw = c.req.query("q") ?? "";
    const q = qRaw.trim();
    if (q.length < 2) {
      return c.json({ error: "q must be at least 2 characters" }, 400);
    }
    const limitRaw = c.req.query("limit");
    let limit = 20;
    if (limitRaw !== undefined && limitRaw !== "") {
      const n = Number(limitRaw);
      if (!Number.isFinite(n) || n < 1) {
        return c.json({ error: "Invalid limit" }, 400);
      }
      limit = Math.min(50, Math.floor(n));
    }

    const pattern = `%${q}%`;
    const rows = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        volunteerNumber: studentProfiles.volunteerNumber,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(studentProfiles, eq(studentProfiles.userId, users.id))
      .where(
        and(eq(userRoles.role, "student"), or(ilike(users.displayName, pattern), ilike(users.email, pattern))),
      )
      .limit(limit);

    const seen = new Set<string>();
    const uniq = rows.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });

    return c.json({
      users: uniq.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        email: r.email,
        volunteerNumber: r.volunteerNumber,
      })),
    });
  });
