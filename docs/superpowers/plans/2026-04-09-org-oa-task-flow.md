# （二）组织 OA 与任务流转系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 [`../specs/2026-04-09-org-oa-task-flow-design.md`](../specs/2026-04-09-org-oa-task-flow-design.md) 交付：修订拒绝逻辑修复、组织生命周期与负责人审计表、团委组织管理/审批队列 API、师生目录检索、任务时间线 API、任务相关 SSE `org_task`、增强团委任务概览、OA 前端三语与筛选及实时刷新。

**Architecture:** `packages/db` 新增 `org_lifecycle_events`、`org_leadership_events` 及枚举；`apps/api` 新增 `directory` 路由、`org-task-broadcast` 封装收件人聚合 + `sseHub.broadcast(..., "org_task", ...)`；`tasks` 路由扩展 `GET /:taskId/timeline` 并在状态/交接写库后广播；`league` 路由扩展组织列表/修订队列/生命周期 `PATCH`；`orgs` 路由扩展 advisor/members 与履历只读；`OaPage` 接入 i18n + `EventSource` + 防抖重拉。

**Tech Stack:** 与总仓一致：pnpm、Drizzle、PostgreSQL、Hono、Vitest、React、i18next、Tailwind。

---

## 文件与职责映射（执行前锁定）

| 路径 | 职责 |
|------|------|
| `packages/db/src/schema.ts` | `org_leadership_change_kind` enum、`org_lifecycle_events`、`org_leadership_events` |
| `packages/db/src/migrations/*.sql` | `pnpm db:generate` 产出 |
| `apps/api/src/routes/orgs.ts` | 修复 `reject`；新增 advisor/members/leadership-events |
| `apps/api/src/routes/league.ts` | `GET /orgs`、`GET /org-revisions`、`PATCH /orgs/:orgId/lifecycle`；`tasks-overview` 增加 `kind`、`q`、`from`、`to` |
| `apps/api/src/routes/directory.ts` | `GET /instructors`、`GET /students` |
| `apps/api/src/routes/tasks.ts` | `GET /:taskId/timeline`；状态/handoff 后 `broadcastOrgTaskRefresh` |
| `apps/api/src/lib/org-task-broadcast.ts` | `collectOrgTaskRecipientUserIds`、`broadcastOrgTaskRefresh` |
| `apps/api/src/index.ts` | `app.route("/directory", directoryRouter)` |
| `apps/api/src/tests/org-oa.test.ts`（或拆分） | 修订拒绝、生命周期审计、timeline 合并排序 |
| `apps/web/vite.config.ts` | 代理前缀增加 `/directory` |
| `apps/web/src/locales/{zh,en,ru}/common.json` | `oa.*` 文案 |
| `apps/web/src/pages/OaPage.tsx` | 三语、团委筛选、`org_task` SSE、任务详情/状态 |
| `apps/web/src/App.tsx` / `AppLayout.tsx` | 如需「组织管理」子路由与导航 |

---

### Task 1: Drizzle — 审计表

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/migrations/0002_*.sql`（generate 产出）

- [ ] **Step 1: 在 `schema.ts` 的 `organizations` / `orgRevisions` 段落之后追加枚举与表**

```typescript
export const orgLeadershipChangeKindEnum = pgEnum("org_leadership_change_kind", [
  "advisor_updated",
  "member_added",
  "member_removed",
  "member_title_updated",
]);

export const orgLifecycleEvents = pgTable("org_lifecycle_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  fromStatus: orgLifecycleEnum("from_status"),
  toStatus: orgLifecycleEnum("to_status").notNull(),
  actorUserId: uuid("actor_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgLeadershipEvents = pgTable("org_leadership_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  changeKind: orgLeadershipChangeKindEnum("change_kind").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: 生成并应用迁移**

Run:

```bash
cd c:\SMBU2026
pnpm db:generate
pnpm db:migrate
```

Expected: 新迁移 `0002_*.sql`；无 SQL 错误。

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/migrations
git commit -m "feat(db): org lifecycle and leadership audit tables"
```

---

### Task 2: 修复团委拒绝修订误伤生命周期

**Files:**
- Modify: `apps/api/src/routes/orgs.ts`（`reject` 分支）

- [ ] **Step 1: 在 `POST /revisions/:revisionId/decide` 的 `else`（reject）分支中，删除对 `organizations` 的 `lifecycleStatus: "suspended"` 更新**  
  仅执行 `org_revisions` 的 `status: "rejected"`、`reviewer_user_id`、`review_reason`、`decided_at`。

- [ ] **Step 2: 回归：`approve` 分支仍更新组织字段并 `lifecycleStatus: "active"`**（保持不变）。

- [ ] **Step 3: API 测试**（见 Task 10 可先写失败用例再实现，或本步末尾加最小测试）

Run: `pnpm --filter api test`  
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/orgs.ts
git commit -m "fix(api): rejecting org revision no longer suspends organization"
```

---

### Task 3: `org-task-broadcast` 收件人与广播

**Files:**
- Create: `apps/api/src/lib/org-task-broadcast.ts`

- [ ] **Step 1: 实现 `collectOrgTaskRecipientUserIds(taskId: string): Promise<string[]>`**  
  查询：`org_tasks` 行（`created_by_user_id`）、`org_task_assignments` 全部 `assignee_user_id`、`user_roles` 全部 `league_admin` 的 `user_id`、`org_task_involved_orgs` 涉及 `org_id` 下在 `org_memberships` 且角色为 `org_president` 或 `org_officer` 的用户。合并 **Set 去重**。

- [ ] **Step 2: 实现 `broadcastOrgTaskRefresh(taskId: string): void`**  
  `const payload = { kind: "task_refresh", taskId };`，对每个 recipient 调用 `sseHub.broadcast(uid, "org_task", payload)`（与 `notification-broadcast` 相同 import 路径风格）。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/org-task-broadcast.ts
git commit -m "feat(api): broadcast org task refresh to related SSE subscribers"
```

---

### Task 4: 任务状态与交接后触发 SSE

**Files:**
- Modify: `apps/api/src/routes/tasks.ts`

- [ ] **Step 1: 在 `PATCH .../status` 事务成功、`broadcastNotification` 循环之后调用 `broadcastOrgTaskRefresh(row.task.id)`**（传入 task id 变量名与现有一致）。

- [ ] **Step 2: 在 `POST .../handoffs` 成功 `insert` 并返回前调用 `broadcastOrgTaskRefresh(taskId)`**。

- [ ] **Step 3: Run** `pnpm --filter api test`  
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/tasks.ts
git commit -m "feat(api): emit org_task SSE on assignment and handoff"
```

---

### Task 5: `GET /tasks/:taskId/timeline`

**Files:**
- Modify: `apps/api/src/routes/tasks.ts`

- [ ] **Step 1: 新增路由 `GET /:taskId/timeline`，置于 `/mine` 等具体路径之后**（避免 `mine` 被解析为 uuid — 若当前顺序有风险，将 `mine` 保持在前、`/:taskId/timeline` 用 `param` 校验 uuid）。

- [ ] **Step 2: 权限函数 `canViewTaskTimeline(userId, taskId)`**  
  满足任一：`league_admin`；任务 `created_by_user_id`；某条 assignment 的 assignee；`task.orgId` 或任一 involved org 上具备 `org_president`/`org_officer` 且 `org_memberships` 命中。

- [ ] **Step 3: 查询 `org_task_status_events`（where taskId）与 `org_task_handoffs`（where taskId）**，映射为统一结构并 **按 `createdAt` 升序** 排序：

```typescript
// 元素示例
{ type: "status", id, at, fromStatus, toStatus, assignmentId, actorUserId }
{ type: "handoff", id, at, fromUserId, toUserId, note }
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/tasks.ts
git commit -m "feat(api): task timeline merges status events and handoffs"
```

---

### Task 6: 团委 — 组织列表、修订队列、生命周期

**Files:**
- Modify: `apps/api/src/routes/league.ts`

- [ ] **Step 1: `GET /orgs`**  
  Query：`lifecycle` 可选枚举。`select` `organizations`，`where` 条件按需，`orderBy` `name_short`。仅 `league_admin`。

- [ ] **Step 2: `GET /org-revisions`**  
  `org_revisions` where `status = 'pending'`，join `organizations` 取 `name_short`，按 `created_at` 升序。仅 `league_admin`。

- [ ] **Step 3: `PATCH /orgs/:orgId/lifecycle`**  
  Body: `{ toStatus: z.enum(["pending","active","suspended"]), reason: z.string().optional() }`。读取当前组织；若 `toStatus` 与现值相同 200 空变更；否则事务：`update organizations` + `insert org_lifecycle_events`（`from_status` / `to_status` / `actor_user_id` / `reason`）。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/league.ts
git commit -m "feat(api): league org directory, revision queue, lifecycle audit"
```

---

### Task 7: 目录检索 `GET /directory/*`

**Files:**
- Create: `apps/api/src/routes/directory.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: `directoryRouter` 挂载 `sessionMiddleware`**；**`GET /instructors`**、**`GET /students`**：`q` query **必填**、trim 后长度 ≥ 2、`limit` 默认 20、最大 50。

- [ ] **Step 2: 权限** `requireUser` + `requireRoles("org_president", "org_officer", "league_admin")`（与规格「可调收窄」一致）。

- [ ] **Step 3: SQL**：`users` join `user_roles`，`role` 分别为 `instructor` / `student`，`display_name` 或 `email` **ilike** `%q%`，`limit`。

- [ ] **Step 4: `app.route("/directory", directoryRouter)`**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/directory.ts apps/api/src/index.ts
git commit -m "feat(api): directory search for instructors and students"
```

---

### Task 8: 组织 advisor / members / 履历

**Files:**
- Modify: `apps/api/src/routes/orgs.ts`

- [ ] **Step 1: 辅助函数** `canManageOrgRoster(userId, orgId)`：`league_admin` 或（`userInOrg` 且 president/officer）。

- [ ] **Step 2: `PATCH /:orgId/advisor`**  
  Body: `{ advisorUserId: z.string().uuid().nullable() }`。若 non-null：校验用户存在且具备 `instructor` 角色。更新 `organizations.advisor_user_id`；`insert org_leadership_events` `advisor_updated`，`payload_json` 含前后 id。

- [ ] **Step 3: `POST /:orgId/members`** `{ userId, title? }`、`PATCH /:orgId/members/:userId` `{ title }`、`DELETE /:orgId/members/:userId`**  
  每次写对应 `org_leadership_events`；`member_*` kind。

- [ ] **Step 4: `GET /:orgId/leadership-events`**  
  `canManageOrgRoster` 或 `league_admin`；倒序 `created_at`，limit 100。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/orgs.ts
git commit -m "feat(api): org advisor, membership roster, and leadership audit log"
```

---

### Task 9: 增强 `GET /league/tasks-overview`

**Files:**
- Modify: `apps/api/src/routes/league.ts`

- [ ] **Step 1: 新增 Query** `kind`（`org_task_kind`）、`q`（`org_tasks.title` ilike）、`from`/`to`（过滤 `org_tasks.created_at` 闭区间，含端点语义与 Zod/datetime 解析写清）。

- [ ] **Step 2: `select` 增加 join `organizations`（on `org_tasks.org_id`）**，响应每 item 增加 `primaryOrgNameShort`（或规格中的 `nameShort` 字段名前后端统一）。

- [ ] **Step 3: `byKind` 可选**：在内存中对当前过滤结果 tasks 计数，或单独 `groupBy` — 规格要求简单统计则 **`byKind: { single, cross, transfer }`** 与 `byStatus` 并列。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/league.ts
git commit -m "feat(api): league task overview filters and org name short"
```

---

### Task 10: API 自动化测试

**Files:**
- Create: `apps/api/src/tests/org-oa.test.ts`（若项目用 vitest 合并配置则跟随现有）

- [ ] **Step 1: 拒绝修订** — mock 或直接 DB：组织 `active`，创建修订，`reject` 后 **`lifecycle_status` 仍为 `active`**。

- [ ] **Step 2: `PATCH` 生命周期** — 断言 `org_lifecycle_events` 新增一行 `from`/`to`。

- [ ] **Step 3: `timeline`** — 插入一条 status event 与一条 handoff，**GET** 断言顺序按时间。

- [ ] **Step 4: Run** `pnpm --filter api test`  
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tests/org-oa.test.ts
git commit -m "test(api): org OA revision reject, lifecycle audit, task timeline"
```

---

### Task 11: 前端 — 代理、i18n、OaPage

**Files:**
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/src/locales/zh/common.json`、`en/common.json`、`ru/common.json`
- Modify: `apps/web/src/pages/OaPage.tsx`

- [ ] **Step 1: `API_PREFIXES` 增加 `/directory`**

- [ ] **Step 2: 三语增加 `oa.title`、`oa.tabs.mine`、`oa.tabs.league`、`oa.loading`、`oa.error`、`oa.empty`、`oa.status.*`（映射 unread/read/in_progress/done）、`oa.filters.*`、`oa.timeline.*`、`oa.actions.*` 等，**禁止**页面硬编码英文句柄。

- [ ] **Step 3: OaPage**  
  - 团委 Tab：调用 `GET /league/tasks-overview` 带 query state（组织可选自 `GET /league/orgs`）；展示 `byStatus` / `byKind`。  
  - `EventSource` `/notifications/stream`，监听 **`org_task`**，`setTimeout` 防抖 300ms 调 `loadMine`/`loadOverview`；参考 `TimelinePage`/`NotificationsPage`。失败或未连接时 **10s** `setInterval` 轮询（与模块一一致）。  
  - 任务行展开：拉 `GET /tasks/:id/timeline`；负责人 **`PATCH /tasks/assignments/:id/status`**（仅顺序步进；团委可走满格若后端已支持）。  
  - 最小可行：若工期紧，**交接表单**可第二子提交再补，但规格要求 handoff 已后端存在 — 至少保留「查看时间与交接记录」于 timeline。

- [ ] **Step 4: Run** `pnpm --filter web build`  
Expected: 成功。

- [ ] **Step 5: Commit**

```bash
git add apps/web/vite.config.ts apps/web/src/locales apps/web/src/pages/OaPage.tsx
git commit -m "feat(web): OA page i18n, league filters, org_task SSE refresh"
```

---

### Task 12: （可选）组织管理最小 UI

**Files:**
- Create: `apps/web/src/pages/OrgManagePage.tsx`（或内嵌 OA）
- Modify: `apps/web/src/App.tsx`、`AppLayout.tsx`

- [ ] **Step 1: 团委「组织」子页**：列表 `GET /league/orgs`；修订队列 `GET /league/org-revisions` 链到审批（跳转团委已有流程或使用 `POST /orgs/revisions/:id/decide` 简易弹窗）；生命周期 `PATCH /league/orgs/:id/lifecycle`。  
  **团长侧**：`PATCH /orgs/:id` 提交修订；`PATCH advisor`、成员编辑 — 若工期不足，本 Task 可标为 **阶段 2**，但在 spec 中已列 API，建议在 **Task 11** 后与用户确认是否本迭代必须。

- [ ] **Step 2: Commit**（若实现）

```bash
git add apps/web/src/pages/OrgManagePage.tsx apps/web/src/App.tsx apps/web/src/layouts/AppLayout.tsx
git commit -m "feat(web): minimal league org admin and roster UI"
```

---

## 计划自检

- [x] 规格§1–§8 均有对应任务（Task 12 为组织管理 UI 增强，API 已覆盖）。
- [x] 无 TBD 步骤；时间过滤选定 **`org_tasks.created_at`**（Task 9 写死）。
- [x] 类型命名 `primaryOrgNameShort` 若在前端使用，全链路统一。

---

## 执行交接

**Plan 已保存至** `docs/superpowers/plans/2026-04-09-org-oa-task-flow.md`。

**执行方式二选一：**

1. **Subagent-Driven（推荐）** — 每任务派生子代理，任务间审查。须遵循 **superpowers:subagent-driven-development**。  
2. **Inline Execution** — 本会话用 **superpowers:executing-plans** 批量执行并设检查点。

如需我 **在本会话直接开始 Task 1–2 的实现**，请回复 **「开始执行」** 或指定任务编号。
