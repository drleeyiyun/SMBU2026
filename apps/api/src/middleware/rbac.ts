import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { db } from "db";
import { userRoles } from "db/schema";
import type { AuthVariables } from "./session.js";

export type Role =
  | "student"
  | "org_member"
  | "org_officer"
  | "org_president"
  | "league_admin"
  | "academic_admin"
  | "instructor";

const allowedSet = (allowed: readonly Role[]) => new Set(allowed);

export function requireRoles(
  ...allowed: Role[]
): MiddlewareHandler<{ Variables: AuthVariables }> {
  const ok = allowedSet(allowed);
  return async (c, next) => {
    const userId = c.get("userId");
    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const rows = await db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));

    const userRolesList = rows.map((r) => r.role as Role);
    const hasAccess = userRolesList.some((r) => ok.has(r));
    if (!hasAccess) {
      return c.json({ error: "forbidden" }, 403);
    }

    c.set("roles", userRolesList);
    await next();
  };
}
