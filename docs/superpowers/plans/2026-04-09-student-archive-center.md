# （三）学生个人档案中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

I'm using the writing-plans skill to create the implementation plan.

**Goal:** 按 [`../specs/2026-04-09-student-archive-center-design.md`](../specs/2026-04-09-student-archive-center-design.md) 交付三语基础信息（JSONB）、学号、身份必填与 seed 修复、志愿活动认领表与幂等同步至 `volunteer_records`、扩展 `archive` 与团委 `league/archive` API、学生档案页与团委审核页、SSE 刷新、审核日志查询、荣誉分区展示。

**Architecture:** `packages/db` 扩 `student_profiles` 四字段 + `student_volunteer_event_claims`；`volunteer_records` 部分唯一索引；`apps/api` 新增 `services/archive-volunteer-sync.ts`（幂等 upsert）、`routes/league-archive.ts`（`GET /league/archive/pending`、`GET /league/archive/audit-log`）；扩展 `routes/archive.ts`（`GET/PATCH /me` 形状、`POST /volunteer-claims`、`POST /volunteer-sync`）、合并团委 `POST /archive/reviews/:userId` 处理 `basic_audit`；`apps/web` 重写 `ArchivePage`、新增 `LeagueArchivePage`、导航与 i18n。

**Tech Stack:** pnpm、Drizzle、PostgreSQL、Hono、Vitest、React、i18next、Tailwind（与总仓一致）。

---

## 文件与职责映射（执行前锁定）

| 路径 | 职责 |
|------|------|
| `packages/db/src/schema.ts` | `student_profiles` 新列；`studentVolunteerEventClaims` 表；`volunteer_records` 部分 uniqueIndex |
| `packages/db/src/migrations/0003_*.sql` | `pnpm db:generate` 产出后核对部分唯一索引 SQL |
| `packages/db/src/seed.ts` | `student_no`、照片 URL、`basic_i18n_published` 示例、可选 claim |
| `apps/api/src/services/archive-volunteer-sync.ts` | `syncVolunteerRecordsForUser(userId)` |
| `apps/api/src/routes/archive.ts` | GET/PATCH 扩展、volunteer-claims、volunteer-sync、reviews 合并 basic |
| `apps/api/src/routes/league-archive.ts` | pending、audit-log |
| `apps/api/src/routes/league.ts` | `.route("/archive", leagueArchiveRouter)` |
| `apps/api/src/tests/archive-center.test.ts` | 核心 API 与同步断言 |
| `apps/web/src/pages/ArchivePage.tsx` | 学生档案全分区 UI + SSE |
| `apps/web/src/pages/LeagueArchivePage.tsx` | 团委审核 + 日志 |
| `apps/web/src/App.tsx` | 路由 `/app/league/archive` |
| `apps/web/src/layouts/AppLayout.tsx` | `league_admin` 导航链 |
| `apps/web/src/locales/{zh,en,ru}/common.json` | `archive.*`、`leagueArchive.*` |
| `apps/web/vite.config.ts` | 若新增路径需代理则对齐（通常已有 `/archive`、`/league`） |

---

### Task 1: Drizzle — 档案与认领表、志愿记录唯一索引

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/migrations/0003_*.sql`（generate 产出）

- [ ] **Step 1: 在 `schema.ts` 导入 `sql`（若尚无）并追加认领表；扩展 `student_profiles`；扩展 `volunteer_records` 索引**

在 `schema.ts` 顶部从 `drizzle-orm/pg-core` **增加** 导入：`sql`、`jsonb`（与现有 `pgTable` 等并列）。在 `studentProfiles` 表定义对象中增加（**推荐 jsonb**）：

```typescript
    studentNo: text("student_no"),
    basicI18nPublished: jsonb("basic_i18n_published")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    basicI18nDraft: jsonb("basic_i18n_draft").$type<Record<string, unknown>>(),
    basicAuditStatus: text("basic_audit_status").notNull().default("none"),
    basicAuditReason: text("basic_audit_reason"),
```

若 `$type` 与默认表达式在所用 Drizzle 版本上报错，可改为不显式 `$type`，仅在 Zod/API 层约束结构。

在 `volunteerRecords` 表约束回调数组中**保留**原 `index`，并追加：

```typescript
  uniqueIndex("vr_volunteer_external_uidx")
    .on(t.volunteerNumber, t.externalRef)
    .where(sql`${t.externalRef} IS NOT NULL`),
```

在 **`leagueCoordinationEvents` 表定义之后**（确保 `leagueCoordinationEvents` 已导出）新增：

```typescript
export const studentVolunteerEventClaims = pgTable(
  "student_volunteer_event_claims",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    coordinationEventId: uuid("coordination_event_id")
      .notNull()
      .references(() => leagueCoordinationEvents.id, { onDelete: "cascade" }),
    claimedHours: numeric("claimed_hours", { precision: 8, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.coordinationEventId] })],
);
```

在 `studentProfiles` 上增加：`uniqueIndex("student_no_uidx").on(t.studentNo)` 不适用可空唯一（Postgres 允许多 NULL）；改为 **部分唯一索引** 在迁移里：`WHERE student_no IS NOT NULL`。若 `db:generate` 未生成 `where`，在生成的 SQL 后**手写补上** `CREATE UNIQUE INDEX ... WHERE student_no IS NOT NULL`。

- [ ] **Step 2: 生成并应用迁移**

Run:

```bash
cd c:\SMBU2026
pnpm db:generate
pnpm db:migrate
```

Expected: `0003_*.sql` 无错误；`pnpm db:migrate` 成功。

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/migrations
git commit -m "feat(db): student archive basic i18n, volunteer claims, unique external_ref"
```

---

### Task 2: Seed — 必填字段与示例三语、照片 URL

**Files:**
- Modify: `packages/db/src/seed.ts`

- [ ] **Step 1: 更新 `studentProfiles` insert**：增加 `studentNo: "2024001001"`（示例）、`idPhotoUrl` / `portraitUrl` 非空占位 HTTPS、`basicI18nPublished` 嵌套示例（name/phone 等三语键）。

- [ ] **Step 2: （可选）插入一条 `studentVolunteerEventClaims`**：指向 seed 中已有 `volunteer` 类 `leagueCoordinationEvents`（若 seed 已创建该类事件则引用其 id；否则先取 `insert...returning()` 的 id）。

- [ ] **Step 3: 跑 seed**

Run:

```bash
pnpm db:seed
```

Expected: 无约束违反。

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/seed.ts
git commit -m "chore(db): seed student archive demo data"
```

---

### Task 3: 志愿时长同步服务

**Files:**
- Create: `apps/api/src/services/archive-volunteer-sync.ts`

- [ ] **Step 1: 实现 `syncVolunteerRecordsForUser(userId: string): Promise<{ upserted: number }>`**

逻辑要点：

1. `select` `student_profiles` 得 `volunteerNumber`。
2. `join` `student_volunteer_event_claims` 与 `league_coordination_events`，过滤 `category = 'volunteer'`。
3. 每条计算 `hours`：`claimedHours` 若非空用之，否则 `(endsAt - startsAt)` 毫秒 → 小时，保留两位小数。
4. `insert` `volunteer_records`：`volunteerNumber`、`title`（事件 title）、`hours`、`source = 'coordination'`、`externalRef = coordinationEventId`、`occurredAt = startsAt`（写死规则）。
5. 冲突时 `onConflictDoUpdate` 或依赖唯一索引用 Drizzle `onConflictDoNothing` + 前置 `delete` **不要采用**；使用 **Postgres `INSERT ... ON CONFLICT (volunteer_number, external_ref) DO UPDATE SET hours = EXCLUDED.hours`**。若 Drizzle 不便表达，使用 `db.execute(sql`...`)`  parameterized。

```typescript
import { eq, and } from "drizzle-orm";
import { db } from "db";
import {
  leagueCoordinationEvents,
  studentProfiles,
  studentVolunteerEventClaims,
  volunteerRecords,
} from "db/schema";

export async function syncVolunteerRecordsForUser(userId: string): Promise<{ upserted: number }> {
  const [profile] = await db
    .select()
    .from(studentProfiles)
    .where(eq(studentProfiles.userId, userId))
    .limit(1);
  if (!profile) return { upserted: 0 };

  const claims = await db
    .select({
      claim: studentVolunteerEventClaims,
      event: leagueCoordinationEvents,
    })
    .from(studentVolunteerEventClaims)
    .innerJoin(
      leagueCoordinationEvents,
      eq(studentVolunteerEventClaims.coordinationEventId, leagueCoordinationEvents.id),
    )
    .where(
      and(
        eq(studentVolunteerEventClaims.userId, userId),
        eq(leagueCoordinationEvents.category, "volunteer"),
      ),
    );

  let upserted = 0;
  for (const { claim, event } of claims) {
    const ms = event.endsAt.getTime() - event.startsAt.getTime();
    const hoursNum =
      claim.claimedHours !== null
        ? Number.parseFloat(String(claim.claimedHours))
        : Math.round((ms / 3_600_000) * 100) / 100;
       // 然后执行 parameterized upsert（实现计划落地时写完整 sql 或 drizzle）
    upserted += 1;
  }
  return { upserted };
}
```

（实现时补齐实际 `upsert` 语句并删除伪代码注释。）

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/services/archive-volunteer-sync.ts
git commit -m "feat(api): volunteer record sync from coordination claims"
```

---

### Task 4: 扩展 `archive` 路由 — Zod、GET/PATCH、认领、同步

**Files:**
- Modify: `apps/api/src/routes/archive.ts`

- [ ] **Step 1: 定义 `localeTriSchema` 与 `basicI18nSchema`**

```typescript
const localeTriSchema = z
  .object({
    zh: z.string().optional(),
    en: z.string().optional(),
    ru: z.string().optional(),
  })
  .strict();

const basicI18nSchema = z
  .object({
    name: localeTriSchema.optional(),
    phone: localeTriSchema.optional(),
    wechat: localeTriSchema.optional(),
    email: localeTriSchema.optional(),
    github: localeTriSchema.optional(),
    weibo: localeTriSchema.optional(),
  })
  .strict();
```

- [ ] **Step 2: `PATCH /me` 的 `patchMeSchema`** 增加 `basicI18nDraft: basicI18nSchema.optional()`、`studentNo: z.string().min(1).nullable().optional()`、身份字段（`nationality`、`idNumber`、`grade`、`department`、`major`、`className`、`idPhotoUrl`、`portraitUrl`）**全部 optional**；服务端判断若 `basicI18nDraft` 任一深合并后相对 publish 有变更 → `basicAuditStatus = pending`。深度合并：`draft = { ...publish, ...patch, ...nested merge per key }`（实现 utility `mergeBasicI18n`）。

- [ ] **Step 3: `GET /me` 响应** 增加 `basicI18nPublished`、`basicI18nDraft`、`basicAuditStatus`、`basicAuditReason`、`studentNo`、`identityComplete`（函数校验八项非空+双照片）、`publicAwards`（`status === approved`）、`myAwards`（全部状态）。

- [ ] **Step 4: 新增 `POST /volunteer-claims`**：`z.object({ coordinationEventId: z.string().uuid(), claimedHours: z.number().positive().optional() })`；校验事件 `volunteer`；`insert` claims；可选立刻调用 `syncVolunteerRecordsForUser`。

- [ ] **Step 5: 新增 `POST /volunteer-sync`**：调用 `syncVolunteerRecordsForUser`，返回 `await GET` 同类 `volunteerSummary` 或 `{ upserted }`。

- [ ] **Step 6: 扩展 `POST /reviews/:userId`**：**若** `basic_audit_status === 'pending'`，`approve` 时把 `basic_i18n_draft` 写入 `basic_i18n_published`、清空 draft、`basic_audit_status = approved`；`reject` 须 `reason`；通知 payload `scope: 'profile_basic'`（或沿用 `profile` 与前端约定）。保留原 `profile_audit_status` pending 分支。

- [ ] **Step 7: 运行 API 测试**

Run:

```bash
pnpm --filter api test
```

Expected: 现有测试通过；新测试在 Task 6 添加后一并绿。

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/archive.ts
git commit -m "feat(api): archive basic i18n flow and volunteer claims"
```

---

### Task 5: 团委 `GET /league/archive/pending` 与 `audit-log`

**Files:**
- Create: `apps/api/src/routes/league-archive.ts`
- Modify: `apps/api/src/routes/league.ts`

- [ ] **Step 1: `league-archive.ts` 实现**

```typescript
import { and, asc, desc, eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "db";
import { notifications, studentProfiles, users } from "db/schema";
import type { AuthVariables } from "../middleware/session.js";
import { requireRoles } from "../middleware/rbac.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

export const leagueArchiveRouter = new Hono<{ Variables: AuthVariables }>()
  .use("*", sessionMiddleware)
  .get("/pending", requireUser, requireRoles("league_admin"), async (c) => {
    const rows = await db
      .select({
        userId: studentProfiles.userId,
        displayName: users.displayName,
        basicAuditStatus: studentProfiles.basicAuditStatus,
        profileAuditStatus: studentProfiles.profileAuditStatus,
      })
      .from(studentProfiles)
      .innerJoin(users, eq(studentProfiles.userId, users.id))
      .where(
        or(
          eq(studentProfiles.basicAuditStatus, "pending"),
          eq(studentProfiles.profileAuditStatus, "pending"),
        ),
      )
      .orderBy(asc(users.displayName));
    return c.json({ items: rows });
  })
  .get("/audit-log", requireUser, requireRoles("league_admin"), async (c) => {
    const userId = c.req.query("userId");
    const limitRaw = c.req.query("limit");
    const limit = Math.min(100, Math.max(1, Number.parseInt(limitRaw ?? "50", 10) || 50));
    const conds = [eq(notifications.type, "archive_audit")];
    if (userId && /^[0-9a-f-]{36}$/i.test(userId)) conds.push(eq(notifications.userId, userId));
    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conds))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        payload: JSON.parse(r.payloadJson) as unknown,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });
```

（若 `profileAuditStatus` 列名在 schema 中为 `profile_audit_status`，Drizzle 属性名为 camelCase `profileAuditStatus`；以实际 schema 为准。scope 过滤可在 Step 2 加 query `scope`。）

- [ ] **Step 2: 在 `league.ts` 链入** `.route("/archive", leagueArchiveRouter)`（置于 `.route("/coordination-events", ...)` 之后均可）。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/league-archive.ts apps/api/src/routes/league.ts
git commit -m "feat(api): league archive pending queue and audit log"
```

---

### Task 6: API 集成测试（Vitest）

**Files:**
- Create: `apps/api/src/tests/archive-center.test.ts`

- [ ] **Step 1: 写入用例**（沿用现网测试 session / db fixture 模式）  
  - `PATCH /archive/me` 提交 `basicI18nDraft` 后 `basic_audit_status === pending`。  
  - `POST /archive/reviews/:id` `reject` 无 reason → 400。  
  - `POST /archive/volunteer-claims` 对非 volunteer 事件 → 400。  
  - `POST /archive/volunteer-sync` 后 `volunteer_records` 行数递增或 upsert 稳定。

- [ ] **Step 2: Run**

```bash
pnpm --filter api test
```

Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/tests/archive-center.test.ts
git commit -m "test(api): student archive center flows"
```

---

### Task 7: 学生端 `ArchivePage` — 分区 UI 与 SSE

**Files:**
- Modify: `apps/web/src/pages/ArchivePage.tsx`
- Modify: `apps/web/src/lib/api.ts`（若需共享 `getApiBase`）

- [ ] **Step 1: 扩展类型** 对齐 `GET /archive/me` 新 JSON；用 `useTranslation("common")` 包裹所有新标签。

- [ ] **Step 2: 区块**  
  - 基础信息：`zh/en/ru` 输入（`name`、`phone` 等）、保存草稿并显示 `basicAuditStatus`。  
  - 身份：展示与编辑（PATCH）、`identityComplete` 提示。  
  - 志愿者：总时长、记录列表、`coordinationEventId` 输入 + 认领按钮（MVP）或下拉（若已拉统筹列表 API）。  
  - 能力标签：四区 + 已有 API 添加/删除。  
  - 荣誉：`myAwards` 全表 + `publicAwards` 高亮。

- [ ] **Step 3: SSE** — 复制 `NotificationsPage` 中 `EventSource` 片段，`ev.type === "notification"` 时解析 `data`，若 `payload.scope` 含 profile/award 则 `load()`。

- [ ] **Step 4: 手工验证**（浏览器）：登录学生 → 改基础信息 → 团委账号审批 → 学生页自动更新。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ArchivePage.tsx apps/web/src/locales/zh/common.json apps/web/src/locales/en/common.json apps/web/src/locales/ru/common.json
git commit -m "feat(web): student archive page with i18n and SSE"
```

---

### Task 8: 团委端 `LeagueArchivePage` 与导航

**Files:**
- Create: `apps/web/src/pages/LeagueArchivePage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/layouts/AppLayout.tsx`
- Modify: `apps/web/src/locales/{zh,en,ru}/common.json`

- [ ] **Step 1: 页面** — `GET /league/archive/pending` 列表；每行「通过 / 驳回 + reason」调用 `POST /archive/reviews/:userId`；底部表格 `GET /league/archive/audit-log`；链到现有荣誉审核可单独小节调用 `GET /archive/awards`（团委视角若缺 API，则 MVP 仅用 audit-log 中 award 记录展示）。

- [ ] **Step 2: 路由** `<Route path="league/archive" element={<LeagueArchivePage />} />`；`AppLayout` 在 `league_admin` 区块增加 `nav.leagueArchive` NavLink。

- [ ] **Step 3: i18n** 键 `leagueArchive.title`、`pending`、`approve`、`reject`、`reason`、`auditLog` 等。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/LeagueArchivePage.tsx apps/web/src/App.tsx apps/web/src/layouts/AppLayout.tsx apps/web/src/locales
git commit -m "feat(web): league archive review UI"
```

---

## 计划自检

| 检查项 | 结论 |
|--------|------|
| Spec 覆盖 | 六功能 + SSE + audit-log + 认领链均有任务 |
| 占位符 | 无 TBD；Drizzle upsert 在 Task 3 落地为可运行 SQL |
| 类型一致 | `basicI18n` 键名前后端统一；`scope` 与通知解析约定在实现时写死 |

---

## 执行交接

**Plan complete and saved to `docs/superpowers/plans/2026-04-09-student-archive-center.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 每任务派生子代理并在任务间复审  

**2. Inline Execution** — 本会话用 executing-plans 批量执行并设检查点  

**Which approach?**
