# 校园综合智慧管理系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可 Docker Compose 一键部署的校园智慧平台（React + Hono + PostgreSQL/Drizzle），覆盖三语、档案（含志愿者号与能力标签）、组织 OA、统一时间轴与通知，并含可演示种子数据。

**Architecture:** `pnpm` monorepo：`apps/web`（Vite SPA + nginx 静态）、`apps/api`（Hono Node 运行时）、`packages/db`（Drizzle schema、迁移、**唯一**种子入口，不使用 `init-data/*.sql` 双源头）。业务仅经 `SchoolGateway` 访问校务 mock。

**Tech Stack:** Node 22 LTS、pnpm、TypeScript、Hono、Drizzle ORM、PostgreSQL 16、React 19 + Vite 6、Tailwind + shadcn/ui、i18next、bcrypt、jose（JWT）、Vitest（API 单元测试）。

---

## 文件与职责映射（执行前锁定）

| 路径 | 职责 |
|------|------|
| `pnpm-workspace.yaml` | 工作区包列表 |
| `package.json`（根） | 顶层脚本：`dev`、`build`、`test`、`db:migrate`、`db:seed`、`docker:up` |
| `docker-compose.yml` | 服务 `db`、`api`、`web`；卷 `postgres_data`、`uploads`；`api` 依赖 `db` 健康检查后执行 migrate+seed+start |
| `.env.example` | `DATABASE_URL`、`JWT_SECRET`、`SCHOOL_API_MODE=mock`、端口、**可用的默认演示值**（无真实密钥） |
| `apps/api/Dockerfile` | 多阶段：安装、构建、`drizzle-kit migrate` + `node seed` + `node dist/index.js` |
| `apps/web/Dockerfile` + `apps/web/nginx.conf` | 构建 SPA，`/` → `index.html`，`/api` **proxy_pass** 至 `http://api:3000`（或前端直连同 host 端口见 compose 端口映射说明） |
| `packages/db/drizzle.config.ts` | Drizzle Kit 配置 |
| `packages/db/src/schema.ts` | 全表定义与枚举 |
| `packages/db/src/migrations/` | `drizzle-kit generate` 产出 |
| `packages/db/src/seed.ts` | **唯一**初始化数据（演示账号、组织、任务、志愿者记录、课表缓存） |
| `packages/db/src/client.ts` | 导出 `db` 实例供 api import |
| `apps/api/src/index.ts` | Hono 挂载路由、CORS、错误处理 |
| `apps/api/src/lib/auth.ts` | 哈希、JWT 签发/校验、会话 cookie 名常量 |
| `apps/api/src/middleware/session.ts` | `getCurrentUser`、可选强制登录 |
| `apps/api/src/middleware/rbac.ts` | `requireRoles(...)` |
| `apps/api/src/services/school-gateway.ts` | 接口 `getSchedule(userId, from, to)`；`MockSchoolGateway` |
| `apps/api/src/services/timeline.ts` | `buildTimelineEvents(userId, range)` 纯函数（便于单测） |
| `apps/api/src/routes/*.ts` | 分模块路由 |
| `apps/web/src/i18n/config.ts` | i18next 初始化（zh/en/ru） |
| `apps/web/src/locales/{zh,en,ru}/*.json` | 文案 |
| `README.md` | 赛题要求：环境、步骤、访问地址、演示账号、常见问题 |

---

### Task 1: Monorepo 骨架与根脚本

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `apps/api/package.json`
- Create: `apps/web/package.json`
- Create: `packages/db/package.json`
- Create: `packages/shared/package.json`

- [ ] **Step 1: 写入工作区定义**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: 根 package.json**

```json
{
  "name": "campus-platform",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "dev": "pnpm run --parallel dev",
    "build": "pnpm -r build",
    "test": "pnpm --filter api test",
    "db:generate": "pnpm --filter db generate",
    "db:migrate": "pnpm --filter db migrate",
    "db:seed": "pnpm --filter db seed",
    "lint": "pnpm -r lint"
  }
}
```

- [ ] **Step 3: 安装依赖（在仓库根目录）**

Run: `pnpm install`  
Expected: 无错误；生成 `pnpm-lock.yaml`。

- [ ] **Step 4: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json .gitignore apps/api/package.json apps/web/package.json packages/db/package.json packages/shared/package.json pnpm-lock.yaml
git commit -m "chore: monorepo skeleton"
```

---

### Task 2: `packages/db` — Drizzle schema 与客户端

**Files:**
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/package.json`（补充 scripts）

- [ ] **Step 1: `packages/db/package.json` scripts**

```json
{
  "name": "db",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "generate": "drizzle-kit generate",
    "migrate": "drizzle-kit migrate",
    "seed": "tsx src/seed.ts",
    "studio": "drizzle-kit studio"
  },
  "dependencies": {
    "drizzle-orm": "^0.40.0",
    "postgres": "^3.4.5"
  },
  "devDependencies": {
    "drizzle-kit": "^0.30.5",
    "tsx": "^4.19.3",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 2: `drizzle.config.ts`**

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 3: `src/client.ts`**

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);
export const db = drizzle(client, { schema });
export type DB = typeof db;
```

- [ ] **Step 4: `src/schema.ts`（全表；与 design spec 一致）**

以下单文件放置（可在实现时拆分为 `schema/users.ts` 等；**首版单文件降低漂移**）。枚举与表名保持与计划一致。

```typescript
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const localeEnum = pgEnum("locale", ["zh", "en", "ru"]);
export const userRoleEnum = pgEnum("user_role", [
  "student",
  "org_member",
  "org_officer",
  "org_president",
  "league_admin",
  "instructor",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  preferredLocale: localeEnum("preferred_locale").notNull().default("zh"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })]
);

export const orgLifecycleEnum = pgEnum("org_lifecycle", ["pending", "active", "suspended"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  nameFull: text("name_full").notNull(),
  nameShort: text("name_short").notNull(),
  logoUrl: text("logo_url"),
  orgType: text("org_type").notNull(),
  lifecycleStatus: orgLifecycleEnum("lifecycle_status").notNull().default("pending"),
  advisorUserId: uuid("advisor_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgRevisions = pgTable("organization_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  payloadJson: text("payload_json").notNull(),
  status: text("status").notNull().default("pending"),
  reviewerUserId: uuid("reviewer_user_id").references(() => users.id),
  reviewReason: text("review_reason"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgMemberships = pgTable(
  "org_memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })]
);

export const taskKindEnum = pgEnum("org_task_kind", ["single", "cross", "transfer"]);
export const taskAssignStatusEnum = pgEnum("task_assign_status", [
  "unread",
  "read",
  "in_progress",
  "done",
]);

export const orgTasks = pgTable("org_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  kind: taskKindEnum("kind").notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  leagueVisible: boolean("league_visible").notNull().default(true),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgTaskInvolvedOrgs = pgTable(
  "org_task_involved_orgs",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => orgTasks.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.orgId] })]
);

export const orgTaskAssignments = pgTable("org_task_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => orgTasks.id, { onDelete: "cascade" }),
  assigneeUserId: uuid("assignee_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: taskAssignStatusEnum("status").notNull().default("unread"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgTaskStatusEvents = pgTable("org_task_status_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => orgTasks.id, { onDelete: "cascade" }),
  assignmentId: uuid("assignment_id").references(() => orgTaskAssignments.id),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  fromStatus: taskAssignStatusEnum("from_status"),
  toStatus: taskAssignStatusEnum("to_status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgTaskHandoffs = pgTable("org_task_handoffs", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => orgTasks.id, { onDelete: "cascade" }),
  fromUserId: uuid("from_user_id").references(() => users.id),
  toUserId: uuid("to_user_id").references(() => users.id),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const studentProfiles = pgTable(
  "student_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    volunteerNumber: text("volunteer_number").notNull(),
    nationality: text("nationality").notNull(),
    idNumber: text("id_number").notNull(),
    grade: text("grade").notNull(),
    department: text("department").notNull(),
    major: text("major").notNull(),
    className: text("class_name").notNull(),
    idPhotoUrl: text("id_photo_url"),
    portraitUrl: text("portrait_url"),
    phone: text("phone"),
    wechat: text("wechat"),
    github: text("github"),
    weibo: text("weibo"),
    profileDraftPhone: text("profile_draft_phone"),
    profileDraftWechat: text("profile_draft_wechat"),
    profileAuditStatus: text("profile_audit_status").notNull().default("none"),
    profileAuditReason: text("profile_audit_reason"),
  },
  (t) => [uniqueIndex("volunteer_number_uidx").on(t.volunteerNumber)]
);

export const abilityTagCategoryEnum = pgEnum("ability_tag_category", [
  "technical",
  "planning",
  "management",
  "sports",
]);

export const abilityTags = pgTable("ability_tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  category: abilityTagCategoryEnum("category").notNull(),
  label: text("label").notNull(),
});

export const awardStatusEnum = pgEnum("award_status", ["pending", "approved", "rejected"]);

export const awards = pgTable("awards", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  proofUrl: text("proof_url"),
  status: awardStatusEnum("status").notNull().default("pending"),
  reviewerUserId: uuid("reviewer_user_id").references(() => users.id),
  reason: text("reason"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const volunteerRecords = pgTable(
  "volunteer_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    volunteerNumber: text("volunteer_number").notNull(),
    title: text("title").notNull(),
    hours: numeric("hours", { precision: 8, scale: 2 }).notNull(),
    source: text("source").notNull(),
    externalRef: text("external_ref"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("vr_volunteer_number_idx").on(t.volunteerNumber)]
);

export const personalPlans = pgTable("personal_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  priority: integer("priority").notNull().default(1),
  status: text("status").notNull().default("planned"),
  onTimeline: boolean("on_timeline").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scheduleItemsCache = pgTable(
  "schedule_items_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    location: text("location"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    batchId: text("batch_id"),
  },
  (t) => [index("schedule_user_starts_idx").on(t.userId, t.startsAt)]
);

export const notificationTypeEnum = pgEnum("notification_type", [
  "archive_audit",
  "task_status",
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  payloadJson: text("payload_json").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 5: 生成迁移（本地需 Postgres 或 `DATABASE_URL` 指向临时库）**

Run: `cd c:\SMBU2026 && pnpm install`  
Run: `pnpm --filter db generate`（先 `set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/campus` 于 PowerShell 可用 `$env:DATABASE_URL="..."`）  
Expected: `packages/db/src/migrations` 下新增 SQL 迁移文件。

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): drizzle schema and migrations"
```

---

### Task 3: 种子数据 `packages/db/src/seed.ts`

**Files:**
- Create: `packages/db/src/seed.ts`
- Modify: `packages/db/package.json`（增加 `bcryptjs` 依赖）

- [ ] **Step 1: 实现种子**

约束：演示用户明文密码 **`Demo#2026`**（入库 bcrypt）。必须包含：

- `student@demo.school`：`student` + `org_member`；`volunteer_number=V20260001`；≥2 条 `volunteer_records`。
- `leader@demo.school`：`org_president`；创建 `org_tasks` 并 **assign** 给 student。
- `league@demo.school`：`league_admin`。
- `instructor@demo.school`：`instructor`；写入某组织 `advisorUserId`。
- 一组织 `active`；一条 `kind=cross` 任务且 `org_task_involved_orgs` 至少两行。
- `schedule_items_cache` 为 student ≥2 条。
- `ability_tags` 为 student 每类 ≥1。

（实现时将 Task 2 中 seed 骨架补全为完整 `transaction` 插入。）

- [ ] **Step 2: 运行**

Run: `pnpm --filter db migrate`  
Run: `pnpm --filter db seed`  
Expected: `seed done`。

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/seed.ts packages/db/package.json pnpm-lock.yaml
git commit -m "feat(db): demo seed data"
```

---

### Task 4: `apps/api` — Hono 壳、配置、健康检查

**Files:**
- Create: `apps/api/src/index.ts`、`src/env.ts`、`package.json`、`tsconfig.json`、`vitest.config.ts`

- [ ] **Step 1–4** 同计划正文：加载 `env`、`GET /health`、本地 `curl` 期望 `{"ok":true}`。

- [ ] **Step 5: Commit** `feat(api): hono shell and health`

---

### Task 5: 认证（bcrypt + jose）、Vitest、`/auth/login`

**Files:**
- `apps/api/src/lib/auth.ts`、`lib/cookies.ts`、`routes/auth.ts`、`middleware/session.ts`、`src/tests/auth.test.ts`

- [ ] **Step 1–4**：`signSession` 测试先红后绿（代码块见前文）。

- [ ] **Step 5: `POST /auth/login`** 设 `HttpOnly` cookie `session`。

- [ ] **Step 6: Commit** `feat(api): auth login and session`

---

### Task 6: RBAC `requireRoles`

**Files:**
- `apps/api/src/middleware/rbac.ts`
- `packages/db/package.json` 增加 `"exports"` 字段暴露 `db/client` 与 `db/schema`，`apps/api/tsconfig` `paths` 对齐。

- [ ] **Step 1: `Role` 类型** 使用字面量联合：

```typescript
export type Role =
  | "student"
  | "org_member"
  | "org_officer"
  | "org_president"
  | "league_admin"
  | "instructor";
```

与 `user_roles.role` 数据库枚举保持一致；`requireRoles` 查询 `user_roles` 后判定。

- [ ] **Step 2: Commit** `feat(api): RBAC middleware`

---

### Task 7: `SchoolGateway` mock + `POST /schedule/sync`

**Files:**
- `apps/api/src/services/school-gateway.ts`
- `apps/api/src/routes/schedule.ts`

- [ ] **Step 1–3** mock 实现、登录用户同步写入 `schedule_items_cache`。

- [ ] **Step 4: Commit** `feat(api): school gateway mock and schedule sync`

---

### Task 8: 档案 API

**Files:**
- `apps/api/src/routes/archive.ts`

- [ ] **GET `/archive/me`、PATCH 提交审核、团委审、awards CRUD**；通知入库 `archive_audit`。

- [ ] **Commit** `feat(api): student archive and audits`

---

### Task 9: 组织 OA API

**Files:**
- `apps/api/src/routes/orgs.ts`、`routes/tasks.ts`

- [ ] 组织修订、任务、involved orgs、assignment 状态机+事件+通知、handoffs、`GET /league/tasks-overview` 聚合。

- [ ] **Commit** `feat(api): organization OA and league overview`

---

### Task 10: 时间轴 `mergeTimelineSources` + `GET /timeline`

**Files:**
- `apps/api/src/services/timeline.ts`、`routes/timeline.ts`、`src/tests/timeline.test.ts`

- [ ] Vitest 校验 `sourceType`/`sourceId`；路由查询 DB  merge。

- [ ] **Commit** `feat(api): unified timeline`

---

### Task 11: `notifications` + SSE hub

**Files:**
- `apps/api/src/routes/notifications.ts`、`lib/sse-hub.ts`

- [ ] `GET /notifications/stream`、`broadcast` 在审核与任务状态更新后调用。

- [ ] **Commit** `feat(api): notifications and SSE`

---

### Task 12: `apps/web` — Vite、Tailwind、shadcn、i18n

- [ ] 初始化、三份 `locales/*/common.json`、**Commit** `feat(web): vite tailwind shadcn i18n`

---

### Task 13: 前端 API、Session、页面

- [ ] `lib/api.ts`、`state/session.tsx`、Login/Layout/Archive/OA/Timeline；SSE+轮询降级。

- [ ] **Commit** `feat(web): pages wired to api`

---

### Task 14: Docker、`.env.example`、README

- [ ] `docker-compose.yml`、双 Dockerfile、`nginx.conf`、README（演示账号与排障）。

- [ ] **验证** `docker compose up -d` 后健康检查与登录路径。

- [ ] **Commit** `chore: docker compose and deployment docs`

---

## 计划自检（对照 spec）

| Spec 要求 | Task |
|-----------|------|
| Compose + `.env.example` | 14 |
| 三语 | 12–13 |
| `SchoolGateway` mock | 7 |
| 志愿者号 + `volunteer_records` | 2–3, 8 |
| 能力标签四类 | 2, 8 |
| OA 四态/日志/跨部门/团委视图 | 2, 9 |
| 时间轴多源 + source | 7, 10 |
| 审核通知 | 8, 11 |
| 唯一种子 | 3 |

**占位符：** 无 TBD；Task 3 须在实现中写满种子 SQL/insert。

**类型名一致：** `task_assign_status` ↔ API body；`org_task_kind` `single|cross|transfer` 对应赛题三类任务。

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-01-campus-platform-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 每任务派生子代理执行，任务间评审  
**2. Inline Execution** — 本会话用 executing-plans 分批执行并设检查点  

你更倾向哪一种？
