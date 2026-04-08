# 学生时间与任务管理模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 [`../specs/2026-04-08-student-time-task-module-design.md`](../specs/2026-04-08-student-time-task-module-design.md) 交付时间轴多视图、三语文案、课表过滤与陈旧提示、个人计划全 CRUD 页、团委统筹事件 CRUD + 并入 `GET /timeline`、`timeline` SSE 刷新，以及（阶段 2）月视图。

**Architecture:** `packages/db` 新增 `league_coordination_events`；`mergeTimelineSources` 增加第四源；`GET /timeline` 查询统筹事件（与查询窗 overlap）；团委写操作后 `broadcastTimelineRefresh` 经扩展后的 `sseHub` 向所有 `student` 连接推送 `event: timeline`；前端时间轴页监听 `timeline` 并防抖重拉，失败则 10s 轮询；个人计划沿用 `POST/PATCH/DELETE /plans` 并新增 `GET /plans`。

**Tech Stack:** 与总仓一致：pnpm、Drizzle、PostgreSQL、Hono、Vitest、React、i18next、Tailwind、EventSource。

---

## 文件与职责映射（执行前锁定）

| 路径 | 职责 |
|------|------|
| `packages/db/src/schema.ts` | 新增 `coordination_category` enum、`league_coordination_events` 表 |
| `packages/db/src/migrations/*.sql` | `pnpm db:generate` 产出 |
| `packages/db/src/seed.ts` | 演示用 1～2 条统筹事件（`league@demo.school` 创建） |
| `apps/api/src/services/timeline.ts` | `mergeTimelineSources` 扩展 `leagueCoordination`；`MergedTimelineItem.sourceType` 含 `league_coordination` |
| `apps/api/src/routes/timeline.ts` | 查询统筹表并入 merge |
| `apps/api/src/lib/sse-hub.ts` | `broadcast(userId, eventName, data)` 三参数；`SseStreamWriter(eventName, data)` |
| `apps/api/src/lib/notification-broadcast.ts` | `sseHub.broadcast(userId, "notification", ...)` |
| `apps/api/src/routes/notifications.ts` | SSE writer 传入 `eventName` 到 `writeSSE` |
| `apps/api/src/lib/students.ts` | `listStudentUserIds()` 查询 `user_roles.role = student` |
| `apps/api/src/lib/timeline-broadcast.ts` | `broadcastTimelineRefresh(payload)` |
| `apps/api/src/routes/league-coordination.ts` | `/` CRUD（挂载到 `/league/coordination-events`） |
| `apps/api/src/routes/league.ts` | `.route("/coordination-events", coordinationRouter)` |
| `apps/api/src/routes/plans.ts` | 新增 `GET /` 列表 |
| `apps/api/src/tests/timeline.test.ts` | 统筹源排序与 meta |
| `apps/api/src/tests/sse-hub.test.ts` | 三参数 broadcast |
| `apps/web/src/locales/{zh,en,ru}/common.json` | `timeline`、`plans`、`leagueCoordination`、`nav.plans`、`nav.leagueCoordination` |
| `apps/web/src/pages/TimelinePage.tsx` | 日/周切换、图例、过滤、课表 stale、SSE `timeline`、快捷创建计划 |
| `apps/web/src/pages/PlansPage.tsx` | 计划列表与表单 CRUD |
| `apps/web/src/pages/LeagueCoordinationPage.tsx` | 团委统筹管理 |
| `apps/web/src/layouts/AppLayout.tsx` | 导航链（计划、团委入口按角色） |
| `apps/web/src/App.tsx` | 路由 `/app/plans`、`/app/league/coordination` |
| `apps/web/vite.config.ts` | 若新增 `/league` 前缀需代理（已有 `/notifications`；确认 `/league` 已存在 — **已有**） |

---

### Task 1: Drizzle — `league_coordination_events`

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/migrations/####...sql`（由 generate 产出）
- Modify: `packages/db/src/seed.ts`（演示数据）

- [ ] **Step 1: 在 `schema.ts` 增加枚举与表**（放在 `personalPlans` 表定义之前或之后均可，保持与现有 `pgEnum` 风格一致）

```typescript
export const coordinationCategoryEnum = pgEnum("coordination_category", [
  "practice",
  "volunteer",
  "work_study",
  "general",
]);

export const leagueCoordinationEvents = pgTable(
  "league_coordination_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    category: coordinationCategoryEnum("category").notNull().default("general"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("league_coordination_range_idx").on(t.startsAt, t.endsAt),
  ],
);
```

- [ ] **Step 2: 生成并应用迁移**

Run:

```bash
cd c:\SMBU2026
pnpm db:generate
pnpm db:migrate
```

Expected: 新迁移文件出现且无 SQL 错误；本地/容器 DB 应用成功。

- [ ] **Step 3: 在 `seed.ts` 插入示例统筹事件**  
  使用已存在的 league 用户 id（与现有 seed 中 `league` 变量一致），`starts_at`/`ends_at` 取演示周内，category 任选 `practice`。

- [ ] **Step 4: 重跑种子（开发环境）**

Run: `pnpm db:seed`  
Expected: 无报错；`league_coordination_events` 有行。

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/migrations packages/db/src/seed.ts
git commit -m "feat(db): add league_coordination_events and seed sample"
```

---

### Task 2: `mergeTimelineSources` 与单元测试

**Files:**
- Modify: `apps/api/src/services/timeline.ts`
- Modify: `apps/api/src/tests/timeline.test.ts`

- [ ] **Step 1: 扩展类型与合并逻辑**

在 `timeline.ts` 中新增：

```typescript
export type TimelineCoordinationInput = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  category: string;
  description?: string | null;
};

export type MergeTimelineSourcesInput = {
  schedule: TimelineScheduleInput[];
  plans: TimelinePlanInput[];
  orgTasks: TimelineOrgTaskInput[];
  leagueCoordination: TimelineCoordinationInput[];
};

export type MergedTimelineItem = {
  sourceType: "schedule" | "plan" | "org_task" | "league_coordination";
  sourceId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  meta?: unknown;
};
```

在 `mergeTimelineSources` 末尾排序前增加对 `input.leagueCoordination` 的循环，`sourceType: "league_coordination"`，`meta: { category, description }`（`description` 若无则省略或 `null` 由你统一一种写法）。

- [ ] **Step 2: 写失败测试（TDD）**

在 `timeline.test.ts` 现有 `mergeTimelineSources` 调用处**全部**增加 `leagueCoordination: []`。

新增用例：

```typescript
it("includes league_coordination with meta.category and sorts with other sources", () => {
  const merged = mergeTimelineSources({
    schedule: [],
    plans: [
      {
        id: "p1",
        title: "Plan",
        startsAt: new Date("2026-04-02T15:00:00.000Z"),
        endsAt: new Date("2026-04-02T16:00:00.000Z"),
      },
    ],
    orgTasks: [],
    leagueCoordination: [
      {
        id: "c1",
        title: "Volunteer drive",
        startsAt: new Date("2026-04-02T09:00:00.000Z"),
        endsAt: new Date("2026-04-02T10:00:00.000Z"),
        category: "volunteer",
        description: "Hall",
      },
    ],
  });
  expect(merged.map((m) => m.sourceType)).toEqual([
    "league_coordination",
    "plan",
  ]);
  const row = merged.find((m) => m.sourceType === "league_coordination")!;
  expect(row.meta).toMatchObject({ category: "volunteer" });
});
```

- [ ] **Step 3: 运行测试**

Run: `pnpm --filter api test`  
Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/timeline.ts apps/api/src/tests/timeline.test.ts
git commit -m "feat(api): merge league_coordination into timeline"
```

---

### Task 3: `GET /timeline` 查询统筹事件

**Files:**
- Modify: `apps/api/src/routes/timeline.ts`

- [ ] **Step 1: import `leagueCoordinationEvents`**

- [ ] **Step 2: 在并行查询中增加 `coordinationRows`**  
  条件：`starts_at <= :to AND ends_at >= :from`（与 `schedule_itemsCache` / `personalPlans` overlap 「左端 ≤ to 且右端 ≥ from」一致）。

- [ ] **Step 3: 传给 `mergeTimelineSources`**

```typescript
leagueCoordination: coordinationRows.map((r) => ({
  id: r.id,
  title: r.title,
  startsAt: r.startsAt,
  endsAt: r.endsAt,
  category: r.category,
  description: r.description,
})),
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter api test`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/timeline.ts
git commit -m "feat(api): include league coordination events in timeline API"
```

---

### Task 4: SSE Hub 三参数（`event` 名 + data）

**Files:**
- Modify: `apps/api/src/lib/sse-hub.ts`
- Modify: `apps/api/src/lib/notification-broadcast.ts`
- Modify: `apps/api/src/routes/notifications.ts`
- Modify: `apps/api/src/tests/sse-hub.test.ts`

- [ ] **Step 1: 修改 `SseStreamWriter` 与 `broadcast`**

```typescript
export type SseStreamWriter = (
  eventName: string,
  data: Record<string, unknown>,
) => void | Promise<void>;

broadcast(userId: string, eventName: string, data: Record<string, unknown>): void {
  // ...
  const out = writer(eventName, data);
  // ...
}
```

订阅处传入的 `writer` 必须兼容上述签名。

- [ ] **Step 2: `notification-broadcast.ts`**

```typescript
export function broadcastNotification(row: NotificationRow): void {
  sseHub.broadcast(row.userId, "notification", notificationRowToEvent(row));
}
```

- [ ] **Step 3: `notifications.ts` 内 writer**

```typescript
const writer: SseStreamWriter = async (eventName, data) => {
  await stream.writeSSE({
    event: eventName,
    data: JSON.stringify(data),
  });
};
```

- [ ] **Step 4: 更新 `sse-hub.test.ts` 所有 `broadcast` / `toHaveBeenCalledWith`**

示例：`hub.broadcast("user-1", "notification", { hello: "world" });`、`expect(writer).toHaveBeenCalledWith("notification", { hello: "world" });`

- [ ] **Step 5: 运行测试**

Run: `pnpm --filter api test`  
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/sse-hub.ts apps/api/src/lib/notification-broadcast.ts apps/api/src/routes/notifications.ts apps/api/src/tests/sse-hub.test.ts
git commit -m "refactor(api): SSE hub supports named events for timeline"
```

---

### Task 5: `listStudentUserIds` 与 `broadcastTimelineRefresh`

**Files:**
- Create: `apps/api/src/lib/students.ts`
- Create: `apps/api/src/lib/timeline-broadcast.ts`

- [ ] **Step 1: `students.ts`**

```typescript
import { eq } from "drizzle-orm";
import { db } from "db";
import { userRoles } from "db/schema";

export async function listStudentUserIds(): Promise<string[]> {
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.role, "student"));
  return rows.map((r) => r.userId);
}
```

- [ ] **Step 2: `timeline-broadcast.ts`**

```typescript
import { sseHub } from "./sse-hub.js";
import { listStudentUserIds } from "./students.js";

export type TimelineRefreshPayload = {
  kind: "timeline_refresh";
  action?: "upsert" | "delete";
  coordinationEventId?: string;
};

export async function broadcastTimelineRefresh(
  payload: TimelineRefreshPayload,
): Promise<void> {
  const ids = await listStudentUserIds();
  for (const userId of ids) {
    sseHub.broadcast(userId, "timeline", payload);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/students.ts apps/api/src/lib/timeline-broadcast.ts
git commit -m "feat(api): broadcast timeline_refresh SSE to all students"
```

---

### Task 6: 团委统筹 CRUD 路由

**Files:**
- Create: `apps/api/src/routes/league-coordination.ts`
- Modify: `apps/api/src/routes/league.ts`

- [ ] **Step 1: 新建 `league-coordination.ts`**  
  - `use("*", sessionMiddleware, requireUser)`  
  - **所有写路由**再包 `requireRoles("league_admin")`；`GET /` 同样需要 league_admin（管理列表，与学生读时间轴分离）。  
  - Zod：`category` enum `practice | volunteer | work_study | general`；`startsAt`/`endsAt` ISO；`startsAt < endsAt` 否则 400。  
  - `POST /`：`insert` 后 `await broadcastTimelineRefresh({ kind: "timeline_refresh", action: "upsert", coordinationEventId: row.id })`  
  - `PATCH /:id`：404 若无；成功后同上 `upsert`  
  - `DELETE /:id`：成功后 `broadcastTimelineRefresh({ kind: "timeline_refresh", action: "delete", coordinationEventId: id })`

- [ ] **Step 2: 在 `league.ts` 链上增加挂载**（置于现有 `.get("/health", …)` 之前或之后均可，但勿打断中间件）

在文件顶部：`import { coordinationRouter } from "./league-coordination.js";`

在 `export const leagueRouter = new Hono<...>()` 链式调用中增加一行：

```typescript
.route("/coordination-events", coordinationRouter)
```

这样子应用内 `GET /`、`POST /`、`PATCH /:id`、`DELETE /:id` 的完整 URL 为 **`/league/coordination-events`**、`/league/coordination-events/:id`。子路由内每个 handler 仍需 **`requireUser` + `requireRoles("league_admin")`**（与 `/league/health` 一致）。

`PATCH` 时更新 `updated_at = now()`（Drizzle 可用 `.set({ ..., updatedAt: new Date() })`）。

- [ ] **Step 3: 手动 curls（可选）或用 Vitest `app.request`**

用 league 演示账号 cookie 测 `POST /league/coordination-events`。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/league-coordination.ts apps/api/src/routes/league.ts
git commit -m "feat(api): league coordination-events CRUD with timeline SSE"
```

---

### Task 7: `GET /plans` 列表

**Files:**
- Modify: `apps/api/src/routes/plans.ts`

- [ ] **Step 1: 在链式路由中 `.get("/", ...)` 插入到 `.post` 之前**

查询当前用户全部计划，`orderBy(asc(personalPlans.startsAt))`，JSON 形状与 `planToJson` 一致。

- [ ] **Step 2: 运行 API 测试 / 手动验证**

Run: `pnpm --filter api test`

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/plans.ts
git commit -m "feat(api): list personal plans for current user"
```

---

### Task 8: i18n 文案（common）

**Files:**
- Modify: `apps/web/src/locales/zh/common.json`
- Modify: `apps/web/src/locales/en/common.json`
- Modify: `apps/web/src/locales/ru/common.json`

- [ ] **Step 1: 增加命名空间键**（示例结构，译文需完整三语）

```json
{
  "nav": {
    "plans": "…",
    "leagueCoordination": "…"
  },
  "timeline": {
    "title": "…",
    "day": "…",
    "week": "…",
    "month": "…",
    "sourceSchedule": "…",
    "sourcePlan": "…",
    "sourceOrgTask": "…",
    "sourceLeague": "…",
    "filterPlaceholder": "…",
    "syncSchedule": "…",
    "staleWarning": "…",
    "quickAddPlan": "…"
  },
  "plans": { "title": "…", "create": "…", "status": "…", "priority": "…", "onTimeline": "…" },
  "leagueCoordination": { "title": "…", "category": "…", "save": "…" }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/locales/zh/common.json apps/web/src/locales/en/common.json apps/web/src/locales/ru/common.json
git commit -m "feat(web): i18n for timeline, plans, league coordination"
```

---

### Task 9: `PlansPage` 与导航

**Files:**
- Create: `apps/web/src/pages/PlansPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/layouts/AppLayout.tsx`

- [ ] **Step 1: `PlansPage`**  
  - `GET /plans` 列表；表单：`POST` 新建、`PATCH` 更新、`DELETE`；字段 `title`、`startsAt`、`endsAt`、`priority`、`status`、`onTimeline`。  
  - 使用 `useTranslation("common")`，所有标签用 `t("plans....")`。

- [ ] **Step 2: 路由** `<Route path="plans" element={<PlansPage />} />`

- [ ] **Step 3: `AppLayout` 增加 `nav.plans` 链接**

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/PlansPage.tsx apps/web/src/App.tsx apps/web/src/layouts/AppLayout.tsx
git commit -m "feat(web): personal plans CRUD page"
```

---

### Task 10: `TimelinePage` — 日/周视图、过滤、stale、SSE、快捷计划

**Files:**
- Modify: `apps/web/src/pages/TimelinePage.tsx`

- [ ] **Step 1: 状态**  
  - `viewMode: "day" | "week"`（月视图见 Task 11）  
  - `anchorDate: Date`（周视图为该日所在周）  
  - `filterText: string`（对 `title` / `meta.location` 字符串包含过滤，不区分大小写）

- [ ] **Step 2: 根据 `viewMode` + `anchorDate` 计算 `from`/`to` ISO**  
  - **日**：当天 00:00～次日 00:00（本地时区）。  
  - **周**：周一至周日（本地化 `getDay` 与白皮算法写进代码注释）。

- [ ] **Step 3: `GET /timeline` 与现有一致；另调 `GET /schedule?from=&to=`（与同窗）**  
  取返回项中 **最大** `fetchedAt`：若距 `Date.now()` 大于 **48 小时**，显示 `t("timeline.staleWarning")` 横幅（规格选定单一规则并写死 48h）。

- [ ] **Step 4: UI**  
  - 图例四色区分 `sourceType`。  
  - `league_coordination` 显示 `meta.category`（可做 i18n 映射小表）。  
  - 周视图可用「按日分组的 `div` 列表」满足总规「按日分组列表」。

- [ ] **Step 5: SSE**  
  复制 `NotificationsPage` 模式：`EventSource` → `addEventListener("timeline", ...)` → `JSON.parse` → `debounce(300ms)` 调用 `load()`。`onerror` 时关闭并 `setInterval(load, 10000)`。

- [ ] **Step 6: 快捷创建**  
  在当日无事项的一格（或页脚按钮）打开极简表单：调用 `POST /plans`，成功后 `load()`。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/TimelinePage.tsx
git commit -m "feat(web): timeline day/week views, filters, SSE refresh, schedule stale"
```

---

### Task 11: `LeagueCoordinationPage` 与团委导航

**Files:**
- Create: `apps/web/src/pages/LeagueCoordinationPage.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/layouts/AppLayout.tsx`

- [ ] **Step 1: 页面内 `GET /me`**，若无 `league_admin` 则 `Navigate` 到 `/app/timeline` 或只读提示。

- [ ] **Step 2: CRUD 调 `/league/coordination-events`**

- [ ] **Step 3: `AppLayout` 中 `user.roles.includes("league_admin")` 时显示 `nav.leagueCoordination`**  
  需从后端拉 `/me`：在 layout 用 `useEffect` + context 或小 hook（避免重复请求可接受）。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/LeagueCoordinationPage.tsx apps/web/src/App.tsx apps/web/src/layouts/AppLayout.tsx
git commit -m "feat(web): league coordination admin UI"
```

---

### Task 12（阶段 2）: 月视图

**Files:**
- Modify: `apps/web/src/pages/TimelinePage.tsx`
- Modify: `apps/web/src/locales/*/common.json`

- [ ] **Step 1: 增加 `viewMode === "month"`**  
  月历栅格 + 每日事件密度点或数字；点击某日将 `anchorDate` 设为该日并切到日视图（推荐）。

- [ ] **Step 2: 三语文案 `timeline.month`**

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/TimelinePage.tsx apps/web/src/locales/zh/common.json apps/web/src/locales/en/common.json apps/web/src/locales/ru/common.json
git commit -m "feat(web): timeline month view (phase 2)"
```

---

## Plan self-review

**1. Spec coverage（对照 `2026-04-08-student-time-task-module-design.md`）**

| 规格章节 | 任务 |
|----------|------|
| §1 时间轴多视图 | Task 10 日/周；Task 12 月 |
| §1 三语 | Task 8 + 各页 `t()` |
| §1 课表过滤与陈旧 | Task 10 过滤文本 + 48h stale |
| §1 个人计划 CRUD | Task 7 + 9 |
| §1 统筹 + SSE | Task 1–6 + Task 10 |
| §1 组织任务来源 | 已有 `org_task` + Task 10 图例 |
| §1 自主任务 | Task 10 快捷 `POST /plans` |
| §3.2 表结构 | Task 1 |
| §4–5 API 与 SSE | Task 3–6 |
| §8 测试 | Task 2 + Task 4（sse-hub） |

**2. Placeholder scan**  
无 TBD/TODO/「适当处理」类步骤；删除策略与 specs 一致（硬删除）。

**3. Type consistency**  
`sourceType` 使用字面量 `league_coordination`；`merge` 输入键名 `leagueCoordination`；SSE 事件名 `timeline`；与规格 §5.3 一致。

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-08-student-time-task-module.md`. Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration (**REQUIRED SUB-SKILL:** superpowers:subagent-driven-development).

2. **Inline Execution** — Run tasks in this session with checkpoints (**REQUIRED SUB-SKILL:** superpowers:executing-plans).

Which approach?
