import { Hono } from "hono";
import type { AuthVariables } from "../middleware/session.js";
import { sessionMiddleware } from "../middleware/session.js";
import { academicProgramScheduleRouter } from "./academic-program-schedule.js";

export const academicRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware)
  .route("/program-schedule", academicProgramScheduleRouter);
