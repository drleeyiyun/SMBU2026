import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { loadEnv } from "./env.js";
import type { AuthVariables } from "./middleware/session.js";
import { requireRoles } from "./middleware/rbac.js";
import { requireUser, sessionMiddleware } from "./middleware/session.js";
import { authRouter, me } from "./routes/auth.js";

const env = loadEnv();

const app = new Hono<{ Variables: AuthVariables }>();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: env.CORS_ORIGIN ?? ((origin) => origin),
    credentials: true,
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

app.route("/auth", authRouter);

app.get("/me", sessionMiddleware, requireUser, me);

app.get("/league/health", sessionMiddleware, requireRoles("league_admin"), (c) =>
  c.json({ ok: true }),
);

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`Listening on http://localhost:${info.port}`);
  },
);
