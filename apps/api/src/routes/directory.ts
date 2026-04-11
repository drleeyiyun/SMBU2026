import { and, asc, eq, ilike, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "db";
import { studentProfiles, userRoles, users } from "db/schema";
import type { AuthVariables } from "../middleware/session.js";
import { requireRoles } from "../middleware/rbac.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

export const directoryRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware)
  .get("/instructors", requireUser, requireRoles("org_president", "org_officer", "league_admin"), async (c) => {
    const browse = c.req.query("browse") === "1";
    const qRaw = c.req.query("q") ?? "";
    const q = qRaw.trim();
    if (!browse && q.length < 2) {
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

    const rows =
      q.length === 0 && browse
        ? await db
            .select({
              id: users.id,
              displayName: users.displayName,
              email: users.email,
            })
            .from(users)
            .innerJoin(userRoles, eq(userRoles.userId, users.id))
            .where(eq(userRoles.role, "instructor"))
            .orderBy(asc(users.displayName))
            .limit(limit)
        : await db
            .select({
              id: users.id,
              displayName: users.displayName,
              email: users.email,
            })
            .from(users)
            .innerJoin(userRoles, eq(userRoles.userId, users.id))
            .where(
              and(
                eq(userRoles.role, "instructor"),
                or(ilike(users.displayName, `%${q}%`), ilike(users.email, `%${q}%`)),
              ),
            )
            .orderBy(asc(users.displayName))
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
    const browse = c.req.query("browse") === "1";
    const qRaw = c.req.query("q") ?? "";
    const q = qRaw.trim();
    if (!browse && q.length < 2) {
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

    const rows =
      q.length === 0 && browse
        ? await db
            .select({
              id: users.id,
              displayName: users.displayName,
              email: users.email,
              volunteerNumber: studentProfiles.volunteerNumber,
            })
            .from(users)
            .innerJoin(userRoles, eq(userRoles.userId, users.id))
            .leftJoin(studentProfiles, eq(studentProfiles.userId, users.id))
            .where(eq(userRoles.role, "student"))
            .orderBy(asc(users.displayName))
            .limit(limit)
        : await db
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
              and(
                eq(userRoles.role, "student"),
                or(ilike(users.displayName, `%${q}%`), ilike(users.email, `%${q}%`)),
              ),
            )
            .orderBy(asc(users.displayName))
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
