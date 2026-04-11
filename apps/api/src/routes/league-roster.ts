import { randomBytes } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { isValidFacultyMajorPair, isValidStudentGrade } from "academic-catalog";
import { db } from "db";
import { studentProfiles, userRoles, users } from "db/schema";
import { hashPassword } from "../lib/auth.js";
import type { AuthVariables } from "../middleware/session.js";
import { requireRoles } from "../middleware/rbac.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

const rosterCreateSchema = z
  .object({
    email: z.string().email(),
    displayName: z.string().min(1).max(160),
    password: z.string().min(8).max(200),
    role: z.enum(["student", "instructor"]),
    volunteerNumber: z.string().min(1).max(64).optional(),
    studentNo: z.union([z.string().min(1).max(64), z.null()]).optional(),
    grade: z.string().min(1).max(80).optional(),
    department: z.string().max(120).optional(),
    major: z.string().max(120).optional(),
    className: z.string().min(1).max(120).optional(),
    nationality: z.string().min(1).max(80).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.role === "student") {
      const v = data.volunteerNumber?.trim();
      if (!v) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "volunteerNumber is required for students",
          path: ["volunteerNumber"],
        });
      }
      const d = data.department?.trim();
      const m = data.major?.trim();
      if (!d) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "department is required for students",
          path: ["department"],
        });
      }
      if (!m) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "major is required for students",
          path: ["major"],
        });
      }
      if (d && m && !isValidFacultyMajorPair(d, m)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "department and major must match the school catalog",
          path: ["major"],
        });
      }
    }
  });

function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | null> {
  return c.req.json().catch(() => null);
}

export const leagueRosterRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware, requireUser, requireRoles("league_admin"))
  .get("/users", async (c) => {
    const limitRaw = c.req.query("limit");
    let limit = 50;
    if (limitRaw !== undefined && limitRaw !== "") {
      const n = Number(limitRaw);
      if (!Number.isFinite(n) || n < 1) {
        return c.json({ error: "Invalid limit" }, 400);
      }
      limit = Math.min(100, Math.floor(n));
    }

    const userRows = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(limit);

    const ids = userRows.map((u) => u.id);
    if (ids.length === 0) {
      return c.json({ users: [] });
    }

    const roleRows = await db
      .select({ userId: userRoles.userId, role: userRoles.role })
      .from(userRoles)
      .where(inArray(userRoles.userId, ids));

    const rolesByUser = new Map<string, string[]>();
    for (const r of roleRows) {
      const list = rolesByUser.get(r.userId) ?? [];
      list.push(r.role);
      rolesByUser.set(r.userId, list);
    }

    return c.json({
      users: userRows.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        roles: rolesByUser.get(u.id) ?? [],
        createdAt: u.createdAt.toISOString(),
      })),
    });
  })
  .post("/users", async (c) => {
    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = rosterCreateSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }

    const {
      email,
      displayName,
      password,
      role,
      volunteerNumber: volRaw,
      studentNo,
      grade,
      department,
      major,
      className,
      nationality,
    } = parsed.data;

    const emailNorm = email.trim().toLowerCase();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, emailNorm)).limit(1);
    if (existing) {
      return c.json({ error: "Email already registered" }, 409);
    }

    const passwordHash = await hashPassword(password);

    if (role === "instructor") {
      const [created] = await db
        .insert(users)
        .values({
          email: emailNorm,
          displayName: displayName.trim(),
          passwordHash,
          preferredLocale: "zh",
        })
        .returning();
      if (!created) {
        return c.json({ error: "Failed to create user" }, 500);
      }
      await db.insert(userRoles).values({ userId: created.id, role: "instructor" });
      return c.json(
        {
          user: {
            id: created.id,
            email: created.email,
            displayName: created.displayName,
            roles: ["instructor"],
            createdAt: created.createdAt.toISOString(),
          },
        },
        201,
      );
    }

    const volunteerNumber = volRaw!.trim();
    const [volClash] = await db
      .select({ userId: studentProfiles.userId })
      .from(studentProfiles)
      .where(eq(studentProfiles.volunteerNumber, volunteerNumber))
      .limit(1);
    if (volClash) {
      return c.json({ error: "Volunteer number already in use" }, 409);
    }

    const sn = studentNo?.trim() ?? null;
    if (sn) {
      const [snClash] = await db
        .select({ userId: studentProfiles.userId })
        .from(studentProfiles)
        .where(eq(studentProfiles.studentNo, sn))
        .limit(1);
      if (snClash) {
        return c.json({ error: "Student number already in use" }, 409);
      }
    }

    const idNumber = `ROSTER-${randomBytes(12).toString("hex")}`;
    const nat = (nationality ?? "中国").trim();
    const gradeVal = grade!.trim();
    const deptVal = department!.trim();
    const majorVal = major!.trim();
    const classVal = (className ?? "待定").trim();

    const [created] = await db
      .insert(users)
      .values({
        email: emailNorm,
        displayName: displayName.trim(),
        passwordHash,
        preferredLocale: "zh",
      })
      .returning();
    if (!created) {
      return c.json({ error: "Failed to create user" }, 500);
    }

    await db.insert(userRoles).values({ userId: created.id, role: "student" });

    await db.insert(studentProfiles).values({
      userId: created.id,
      volunteerNumber,
      nationality: nat,
      idNumber,
      grade: gradeVal,
      department: deptVal,
      major: majorVal,
      className: classVal,
      studentNo: sn,
      phone: null,
      basicI18nPublished: {
        name: { zh: displayName.trim(), en: displayName.trim(), ru: displayName.trim() },
        phone: { zh: "", en: "", ru: "" },
        wechat: { zh: "", en: "", ru: "" },
        email: { zh: emailNorm, en: emailNorm, ru: emailNorm },
        github: { zh: "", en: "", ru: "" },
        weibo: { zh: "", en: "", ru: "" },
      },
    });

    return c.json(
      {
        user: {
          id: created.id,
          email: created.email,
          displayName: created.displayName,
          roles: ["student"],
          createdAt: created.createdAt.toISOString(),
        },
      },
      201,
    );
  });
