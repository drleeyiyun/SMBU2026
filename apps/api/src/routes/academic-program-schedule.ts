import { and, eq, inArray, like } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { isValidFacultyMajorPair, isValidStudentGrade } from "academic-catalog";
import { db } from "db";
import { scheduleItemsCache, studentProfiles } from "db/schema";
import {
  ACADEMIC_PUBLISH_BATCH_LIKE,
  SCHEDULE_SOURCE_SCHOOL,
  academicPublishBatchId,
} from "../lib/schedule-source.js";
import { broadcastTimelineRefreshToUserIds } from "../lib/timeline-broadcast.js";
import type { AuthVariables } from "../middleware/session.js";
import { requireRoles } from "../middleware/rbac.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

const iso = z.string().datetime({ offset: true });

/** 防止单次请求体过大；周课表展开后由前端分批或控制周数。 */
const MAX_PUBLISH_ITEMS = 8000;

const publishSchema = z
  .object({
    department: z.string().min(1).max(120),
    major: z.string().min(1).max(120),
    /** 与档案 `student_profiles.grade` 一致；`null`/省略 = 不限年级 */
    grade: z.union([z.string().min(1).max(120), z.null()]).optional(),
    mode: z.enum(["append", "replace_cohort"]).default("append"),
    items: z
      .array(
        z
          .object({
            title: z.string().min(1).max(400),
            location: z.union([z.string().max(400), z.null()]).optional(),
            instructor: z.union([z.string().max(120), z.null()]).optional(),
            startsAt: iso,
            endsAt: iso,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

function parseJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | null> {
  return c.req.json().catch(() => null);
}

export const academicProgramScheduleRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware, requireUser, requireRoles("academic_admin"))
  .post("/publish", async (c) => {
    const raw = await parseJsonBody(c);
    if (raw === null || typeof raw !== "object") {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = publishSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "Invalid body", details: parsed.error.flatten() }, 400);
    }

    const { department, major, mode, items, grade: gradeRaw } = parsed.data;
    const dept = department.trim();
    const maj = major.trim();
    const gradeFilter = (gradeRaw ?? "").trim();
    if (gradeFilter !== "" && !isValidStudentGrade(gradeFilter)) {
      return c.json({ error: "年级不在学校目录中" }, 400);
    }
    if (!isValidFacultyMajorPair(dept, maj)) {
      return c.json({ error: "系别与专业不在学校目录中" }, 400);
    }

    const startsBeforeEnds = items.every((it) => new Date(it.startsAt) < new Date(it.endsAt));
    if (!startsBeforeEnds) {
      return c.json({ error: "每条课次开始时间须早于结束时间" }, 400);
    }

    if (items.length > MAX_PUBLISH_ITEMS) {
      return c.json(
        { error: `单次发布不得超过 ${MAX_PUBLISH_ITEMS} 条课次，请减少重复周数或课次后再试` },
        400,
      );
    }

    const cohortConds =
      gradeFilter === ""
        ? and(eq(studentProfiles.department, dept), eq(studentProfiles.major, maj))
        : and(
            eq(studentProfiles.department, dept),
            eq(studentProfiles.major, maj),
            eq(studentProfiles.grade, gradeFilter),
          );

    const studentRows = await db
      .select({ userId: studentProfiles.userId })
      .from(studentProfiles)
      .where(cohortConds);

    const recipientIds = studentRows.map((r) => r.userId);
    const batchId = academicPublishBatchId();
    const fetchedAt = new Date();

    if (recipientIds.length === 0) {
      return c.json({
        ok: true,
        batchId,
        recipientCount: 0,
        insertedRows: 0,
        warning:
          gradeFilter === ""
            ? "没有匹配该系别与专业的学生，未写入课表"
            : "没有匹配该系别、专业与年级的学生，未写入课表",
      });
    }

    if (mode === "replace_cohort") {
      /** 清空该 cohort 全部教务缓存（含教务下发与门户/Mock 同步行），再写入本次下发。 */
      await db
        .delete(scheduleItemsCache)
        .where(
          and(
            inArray(scheduleItemsCache.userId, recipientIds),
            eq(scheduleItemsCache.scheduleSource, SCHEDULE_SOURCE_SCHOOL),
          ),
        );
    }

    const rows: (typeof scheduleItemsCache.$inferInsert)[] = [];
    for (const uid of recipientIds) {
      for (const it of items) {
        const inst = it.instructor?.trim();
        rows.push({
          userId: uid,
          title: it.title.trim(),
          location: it.location?.trim() || null,
          instructor: inst && inst.length > 0 ? inst : null,
          startsAt: new Date(it.startsAt),
          endsAt: new Date(it.endsAt),
          batchId,
          fetchedAt,
          scheduleSource: SCHEDULE_SOURCE_SCHOOL,
        });
      }
    }

    await db.insert(scheduleItemsCache).values(rows);

    await broadcastTimelineRefreshToUserIds(recipientIds, {
      kind: "timeline_refresh",
      action: "upsert",
    });

    return c.json({
      ok: true,
      batchId,
      recipientCount: recipientIds.length,
      insertedRows: rows.length,
    });
  });
