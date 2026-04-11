/**
 * Demo seed for local development.
 *
 * Prerequisites: `DATABASE_URL` points at Postgres; run `pnpm --filter db migrate` first.
 * Idempotency: deletes application data in FK-safe order (does not touch Drizzle migration
 * metadata), then inserts demo rows in one transaction. Safe to re-run on a dev DB.
 */

import "./load-root-env.js";
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
    await tx.delete(schema.studentVolunteerEventClaims);
    await tx.delete(schema.scheduleItemsCache);
    await tx.delete(schema.abilityTags);
    await tx.delete(schema.awards);
    await tx.delete(schema.studentProfiles);
    await tx.delete(schema.personalPlans);
    await tx.delete(schema.notifications);
    await tx.delete(schema.leagueCoordinationEvents);
    await tx.delete(schema.organizations);
    await tx.delete(schema.userRoles);
    await tx.delete(schema.users);

    const [
      student,
      leader,
      league,
      instructor,
      studentAmy,
      studentBob,
      instructorChen,
      instructorDing,
      dataAdmin,
    ] = await tx
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
        {
          email: "student-amy@demo.school",
          passwordHash,
          displayName: "演示学生 Amy",
          preferredLocale: "zh",
        },
        {
          email: "student-bob@demo.school",
          passwordHash,
          displayName: "演示学生 Bob",
          preferredLocale: "zh",
        },
        {
          email: "instructor-chen@demo.school",
          passwordHash,
          displayName: "演示教师 陈老师",
          preferredLocale: "zh",
        },
        {
          email: "instructor-ding@demo.school",
          passwordHash,
          displayName: "演示教师 丁老师",
          preferredLocale: "zh",
        },
        {
          email: "dataadmin@demo.school",
          passwordHash,
          displayName: "Demo Data Admin",
          preferredLocale: "zh",
        },
      ])
      .returning();

    if (
      !student ||
      !leader ||
      !league ||
      !instructor ||
      !studentAmy ||
      !studentBob ||
      !instructorChen ||
      !instructorDing ||
      !dataAdmin
    ) {
      throw new Error("Failed to insert demo users");
    }

    await tx.insert(schema.userRoles).values([
      { userId: student.id, role: "student" },
      { userId: student.id, role: "org_member" },
      { userId: leader.id, role: "org_president" },
      { userId: leader.id, role: "org_officer" },
      { userId: league.id, role: "league_admin" },
      { userId: dataAdmin.id, role: "league_admin" },
      { userId: instructor.id, role: "instructor" },
      { userId: studentAmy.id, role: "student" },
      { userId: studentAmy.id, role: "org_member" },
      { userId: studentBob.id, role: "student" },
      { userId: instructorChen.id, role: "instructor" },
      { userId: instructorDing.id, role: "instructor" },
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
      { orgId: secondOrg.id, userId: studentAmy.id, title: "骨干" },
    ]);

    await tx.insert(schema.studentProfiles).values([
      {
        userId: student.id,
        studentNo: "2024001001",
        volunteerNumber: "V20260001",
        nationality: "中国",
        idNumber: "440300200501011234",
        grade: "2024级本科",
        department: "计算数学与控制系",
        major: "计算机科学与技术",
        className: "计科2024-1班",
        idPhotoUrl: "https://files.demo.school/seed/id-photo.png",
        portraitUrl: "https://files.demo.school/seed/portrait.png",
        phone: "13800138000",
        basicI18nPublished: {
          name: { zh: "演示学生", en: "Demo Student", ru: "Демо Студент" },
          phone: { zh: "13800138000", en: "13800138000", ru: "13800138000" },
          wechat: { zh: "demo_wx", en: "demo_wx", ru: "demo_wx" },
          email: {
            zh: "student@demo.school",
            en: "student@demo.school",
            ru: "student@demo.school",
          },
          github: { zh: "demo-student", en: "demo-student", ru: "demo-student" },
          weibo: { zh: "demo_weibo", en: "demo_weibo", ru: "demo_weibo" },
        },
      },
      {
        userId: studentAmy.id,
        studentNo: "2024001002",
        volunteerNumber: "V20260002",
        nationality: "中国",
        idNumber: "440300200502021234",
        grade: "2024级本科",
        department: "计算数学与控制系",
        major: "计算机科学与技术",
        className: "计科2024-2班",
        phone: "13800138001",
        basicI18nPublished: {
          name: { zh: "演示学生 Amy", en: "Amy Demo", ru: "Эми Демо" },
          phone: { zh: "13800138001", en: "13800138001", ru: "13800138001" },
          wechat: { zh: "amy_demo", en: "amy_demo", ru: "amy_demo" },
          email: {
            zh: "student-amy@demo.school",
            en: "student-amy@demo.school",
            ru: "student-amy@demo.school",
          },
          github: { zh: "", en: "", ru: "" },
          weibo: { zh: "", en: "", ru: "" },
        },
      },
      {
        userId: studentBob.id,
        studentNo: "2024001003",
        volunteerNumber: "V20260003",
        nationality: "中国",
        idNumber: "440300200503031234",
        grade: "2024级本科",
        department: "经济系",
        major: "国际经济与贸易",
        className: "国贸2024-1班",
        phone: "13800138002",
        basicI18nPublished: {
          name: { zh: "演示学生 Bob", en: "Bob Demo", ru: "Боб Демо" },
          phone: { zh: "13800138002", en: "13800138002", ru: "13800138002" },
          wechat: { zh: "bob_demo", en: "bob_demo", ru: "bob_demo" },
          email: {
            zh: "student-bob@demo.school",
            en: "student-bob@demo.school",
            ru: "student-bob@demo.school",
          },
          github: { zh: "", en: "", ru: "" },
          weibo: { zh: "", en: "", ru: "" },
        },
      },
    ]);

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

    const weekStart = new Date(now);
    const dow = weekStart.getUTCDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    weekStart.setUTCDate(weekStart.getUTCDate() + mondayOffset);
    weekStart.setUTCHours(0, 0, 0, 0);

    const practiceStart = new Date(weekStart);
    practiceStart.setUTCDate(practiceStart.getUTCDate() + 2);
    practiceStart.setUTCHours(16, 0, 0, 0);
    const practiceEnd = new Date(practiceStart);
    practiceEnd.setUTCHours(18, 0, 0, 0);

    const volunteerStart = new Date(weekStart);
    volunteerStart.setUTCDate(volunteerStart.getUTCDate() + 4);
    volunteerStart.setUTCHours(9, 30, 0, 0);
    const volunteerEnd = new Date(volunteerStart);
    volunteerEnd.setUTCHours(12, 0, 0, 0);

    await tx.insert(schema.leagueCoordinationEvents).values({
      title: "各社团代表队联合训练",
      description: "体育馆羽毛球场，请提前十分钟到场签到。",
      category: "practice",
      startsAt: practiceStart,
      endsAt: practiceEnd,
      createdByUserId: league.id,
    });

    const [volunteerCoordinationEvent] = await tx
      .insert(schema.leagueCoordinationEvents)
      .values({
        title: "校园志愿服务协调会",
        description: "汇总本周各组织志愿活动安排，避免时间冲突。",
        category: "volunteer",
        startsAt: volunteerStart,
        endsAt: volunteerEnd,
        createdByUserId: league.id,
      })
      .returning({ id: schema.leagueCoordinationEvents.id });

    if (volunteerCoordinationEvent) {
      await tx.insert(schema.studentVolunteerEventClaims).values({
        userId: student.id,
        coordinationEventId: volunteerCoordinationEvent.id,
      });
    }
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
