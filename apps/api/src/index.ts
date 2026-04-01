import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { loadEnv } from "./env.js";
import type { AuthVariables } from "./middleware/session.js";
import { requireUser, sessionMiddleware } from "./middleware/session.js";
import { archiveRouter } from "./routes/archive.js";
import { authRouter, me } from "./routes/auth.js";
import { leagueRouter } from "./routes/league.js";
import { notificationsRouter } from "./routes/notifications.js";
import { orgsRouter } from "./routes/orgs.js";
import { plansRouter } from "./routes/plans.js";
import { scheduleRouter } from "./routes/schedule.js";
import { tasksRouter } from "./routes/tasks.js";
import { timelineRouter } from "./routes/timeline.js";

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

app.route("/schedule", scheduleRouter);

app.route("/timeline", timelineRouter);

app.route("/plans", plansRouter);

app.route("/archive", archiveRouter);

app.route("/orgs", orgsRouter);
app.route("/tasks", tasksRouter);

app.route("/notifications", notificationsRouter);

app.route("/league", leagueRouter);

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
    hostname: "0.0.0.0",
  },
  (info) => {
    console.log(`Listening on http://${info.address}:${info.port}`);
  },
);
