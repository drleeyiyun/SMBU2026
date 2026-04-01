/**
 * Demo seed for local development.
 *
 * Prerequisites: `DATABASE_URL` points at Postgres; run `pnpm --filter db migrate` first.
 * Idempotency: deletes application data in FK-safe order (does not touch Drizzle migration
 * metadata), then inserts demo rows in one transaction. Safe to re-run on a dev DB.
 */

import bcrypt from "bcryptjs";
import { db } from "./client.js";
import * as schema from "./schema.js";

function hashDemoPassword(): Promise<string> {
  return new Promise((resolve, reject) => {
    bcrypt.hash("Demo#2026", 10, (err, hash) => {
      if (err) {
        reject(err);
      } else {
        resolve(hash);
      }
    });
  });
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const passwordHash = await hashDemoPassword();

  await db.transaction(async (tx) => {
    await tx.delete(schema.orgTaskStatusEvents);
    await tx.delete(schema.orgTaskHandoffs);
    await tx.delete(schema.orgTaskAssignments);
    await tx.delete(schema.orgTaskInvolvedOrgs);
    await tx.delete(schema.orgTasks);
    await tx.delete(schema.orgRevisions);
    await tx.delete(schema.orgMemberships);
    await tx.delete(schema.volunteerRecords);
    await tx.delete(schema.scheduleItemsCache);
    await tx.delete(schema.abilityTags);
    await tx.delete(schema.awards);
    await tx.delete(schema.studentProfiles);
    await tx.delete(schema.personalPlans);
    await tx.delete(schema.notifications);
    await tx.delete(schema.organizations);
    await tx.delete(schema.userRoles);
    await tx.delete(schema.users);

    const [student, leader, league, instructor] = await tx
      .insert(schema.users)
      .values([
        {
          email: "student@demo.school",
          passwordHash,
          displayName: "Demo Student",
          preferredLocale: "zh",
        },
        {
          email: "leader@demo.school",
          passwordHash,
          displayName: "Demo Org Leader",
          preferredLocale: "zh",
        },
        {
          email: "league@demo.school",
          passwordHash,
          displayName: "Demo League Admin",
          preferredLocale: "zh",
        },
        {
          email: "instructor@demo.school",
          passwordHash,
          displayName: "Demo Instructor",
          preferredLocale: "zh",
        },
      ])
      .returning();

    if (!student || !leader || !league || !instructor) {
      throw new Error("Failed to insert demo users");
    }

    await tx.insert(schema.userRoles).values([
      { userId: student.id, role: "student" },
      { userId: student.id, role: "org_member" },
      { userId: leader.id, role: "org_president" },
      { userId: leader.id, role: "org_officer" },
      { userId: league.id, role: "league_admin" },
      { userId: instructor.id, role: "instructor" },
    ]);

    const [primaryOrg, secondOrg] = await tx
      .insert(schema.organizations)
      .values([
        {
          nameFull: "深圳北理莫斯科大学计算机学生会",
          nameShort: "计科学生会",
          orgType: "student_union",
          lifecycleStatus: "active",
          advisorUserId: instructor.id,
        },
        {
          nameFull: "深圳北理莫斯科大学青年志愿者协会",
          nameShort: "青协",
          orgType: "volunteer",
          lifecycleStatus: "active",
        },
      ])
      .returning();

    if (!primaryOrg || !secondOrg) {
      throw new Error("Failed to insert demo organizations");
    }

    await tx.insert(schema.orgMemberships).values([
      { orgId: primaryOrg.id, userId: leader.id, title: "主席" },
      { orgId: primaryOrg.id, userId: student.id, title: "部员" },
    ]);

    await tx.insert(schema.studentProfiles).values({
      userId: student.id,
      volunteerNumber: "V20260001",
      nationality: "中国",
      idNumber: "440300200501011234",
      grade: "2024级本科",
      department: "计算数学与控制系",
      major: "计算机科学与技术",
      className: "计科2024-1班",
    });

    await tx.insert(schema.volunteerRecords).values([
      {
        volunteerNumber: "V20260001",
        title: "校园开放日引导服务",
        hours: "6.00",
        source: "seed",
        occurredAt: new Date("2026-03-10T09:00:00Z"),
      },
      {
        volunteerNumber: "V20260001",
        title: "图书馆整理志愿活动",
        hours: "3.50",
        source: "seed",
        occurredAt: new Date("2026-03-18T14:00:00Z"),
      },
    ]);

    const [crossTask] = await tx
      .insert(schema.orgTasks)
      .values({
        orgId: primaryOrg.id,
        title: "跨社团联合迎新活动",
        description: "两个组织协作完成场地布置与志愿者调度。",
        kind: "cross",
        createdByUserId: league.id,
        startsAt: new Date("2026-05-01T08:00:00Z"),
        endsAt: new Date("2026-05-01T18:00:00Z"),
      })
      .returning();

    if (!crossTask) {
      throw new Error("Failed to insert cross org task");
    }

    await tx.insert(schema.orgTaskInvolvedOrgs).values([
      { taskId: crossTask.id, orgId: primaryOrg.id },
      { taskId: crossTask.id, orgId: secondOrg.id },
    ]);

    const [singleTask] = await tx
      .insert(schema.orgTasks)
      .values({
        orgId: primaryOrg.id,
        title: "提交学期活动计划表",
        description: "请于本周内在系统中完成并上传。",
        kind: "single",
        createdByUserId: leader.id,
      })
      .returning();

    if (!singleTask) {
      throw new Error("Failed to insert single org task");
    }

    await tx.insert(schema.orgTaskAssignments).values({
      taskId: singleTask.id,
      assigneeUserId: student.id,
      status: "unread",
    });

    const now = new Date();
    const pastStart = new Date(now);
    pastStart.setUTCDate(pastStart.getUTCDate() - 7);
    pastStart.setUTCHours(9, 0, 0, 0);
    const pastEnd = new Date(pastStart);
    pastEnd.setUTCHours(10, 30, 0, 0);

    const futureStart = new Date(now);
    futureStart.setUTCDate(futureStart.getUTCDate() + 7);
    futureStart.setUTCHours(13, 0, 0, 0);
    const futureEnd = new Date(futureStart);
    futureEnd.setUTCHours(15, 0, 0, 0);

    await tx.insert(schema.scheduleItemsCache).values([
      {
        userId: student.id,
        title: "高等数学（已结束）",
        location: "教学楼 A101",
        startsAt: pastStart,
        endsAt: pastEnd,
        batchId: "seed-past",
      },
      {
        userId: student.id,
        title: "程序设计实验",
        location: "实验楼 B203",
        startsAt: futureStart,
        endsAt: futureEnd,
        batchId: "seed-future",
      },
    ]);

    await tx.insert(schema.abilityTags).values([
      { userId: student.id, category: "technical", label: "Python" },
      { userId: student.id, category: "planning", label: "活动策划" },
      { userId: student.id, category: "management", label: "团队协作" },
      { userId: student.id, category: "sports", label: "羽毛球" },
    ]);
  });

  console.log("seed done");
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
