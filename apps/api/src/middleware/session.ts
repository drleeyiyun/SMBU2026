import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { verifySession } from "../lib/auth.js";
import { SESSION_COOKIE } from "../lib/cookies.js";
import { loadEnv } from "../env.js";

export type AuthVariables = {
  userId?: string;
  roles?: import("./rbac.js").Role[];
};

export const sessionMiddleware: MiddlewareHandler<{ Variables: AuthVariables }> = async (
  c,
  next,
) => {
  const env = loadEnv();
  let token: string | undefined;
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    token = auth.slice("Bearer ".length).trim();
  }
  if (!token) {
    token = getCookie(c, SESSION_COOKIE);
  }
  if (token) {
    try {
      const { sub } = await verifySession(token, env.JWT_SECRET);
      c.set("userId", sub);
    } catch {
      // invalid or expired token — leave userId unset
    }
  }
  await next();
};

export const requireUser: MiddlewareHandler<{ Variables: AuthVariables }> = async (
  c,
  next,
) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};
