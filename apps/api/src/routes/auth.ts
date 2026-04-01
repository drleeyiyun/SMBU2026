import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { z } from "zod";
import { db } from "db";
import { userRoles, users } from "db/schema";
import { signSession, verifyPassword } from "../lib/auth.js";
import { SESSION_COOKIE } from "../lib/cookies.js";
import { loadEnv } from "../env.js";
import type { AuthVariables } from "../middleware/session.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export const authRouter = new Hono()
  .post("/login", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }
    const { email, password } = parsed.data;
    const env = loadEnv();

    const [user] = await db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const unauthorized = () => c.json({ error: "Invalid email or password" }, 401);

    if (!user) {
      return unauthorized();
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return unauthorized();
    }

    const token = await signSession({ sub: user.id }, env.JWT_SECRET);
    setCookie(c, SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      maxAge: SESSION_MAX_AGE,
    });
    return c.json({ ok: true });
  })
  .post("/logout", (c) => {
    setCookie(c, SESSION_COOKIE, "", {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      maxAge: 0,
    });
    return c.json({ ok: true });
  });

export async function me(c: Context<{ Variables: AuthVariables }>) {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const roleRows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));

  return c.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roles: roleRows.map((r) => r.role),
  });
}
