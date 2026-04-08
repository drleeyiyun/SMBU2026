# 学生时间与任务管理模块 — 设计规格

**文档状态：** 已定稿  
**日期：** 2026-04-08  
**上位规格：** [`2026-04-01-campus-platform-design.md`](./2026-04-01-campus-platform-design.md)

本文件细化赛题「**（一）学生时间与任务管理模块**」六类功能项，并与仓库现状（`GET /timeline`、课表缓存、`personal_plans`、组织任务合并、i18next、SSE 通知）对齐。**不替代**总规格中的全局约束（Docker、三语、RBAC、`SchoolGateway` 等）。

---

## 1. 目标与验收口径

### 1.1 模块目标

为学生提供 **统一时间轴**：整合课表、个人计划、组织任务、团委统筹事务；支持 **日/周/月** 视图切换（实现顺序可在实现计划中分阶段）；**zh / en / ru** 全界面覆盖；课表经 **模拟校务 API** 同步；团委端 **发布统筹事件** 后学生时间轴 **可实时刷新**（SSE，失败降级轮询）。

### 1.2 与现状的差异（要实现什么）

| 功能项 | 目标行为 |
|--------|----------|
| 时间轴基础视图 | 可视化时间轴 + **日/周/月** 切换；展示多源合并项 |
| 课表信息整合 | 保持 `SchoolGateway` + 缓存；**过滤**、**过期/陈旧提醒**（基于 `fetched_at` 或批次） |
| 个人计划管理 | CRUD、完成态、优先级、**是否上时间轴**；与总规 `personal_plans` 一致 |
| 统筹信息同步 | **团委发布**的时间段事件进入 `GET /timeline`；**SSE** 推送刷新信号 |
| 组织任务同步 | 保持 `org_task` 合并；**来源可识别**（`sourceType` + `meta`） |
| 自主任务标记 | 在空闲时段 **快速创建个人计划**（与 `personal_plans` 同一模型，交互层差异） |

---

## 2. 架构原则

- **单一用户主键：** 所有业务表关联 `users.id`（与总规一致）。
- **时间轴合并：** 后端单次查询合并多源；每条返回 **`sourceType` + `sourceId` + `meta`**，满足「可识别来源」。
- **校务数据：** 课表仅经 `SchoolGateway`；缓存表 **`schedule_items_cache`** 仅存同步结果。
- **实时通道：** 复用现有 **进程内 `sseHub`** 与 **`GET /notifications/stream`**；新增 **SSE `event` 名**（见 §5），与 `notification` / `ping` 并列。多实例部署下与现通知 SSE 同为 **内存 fan-out** 限制（竞赛演示单实例可接受）。
- **三语：** 本模块 **所有** 用户可见字符串走 i18next；禁止时间轴/团委表单硬编码英文为主文案。

---

## 3. 数据模型

### 3.1 已有（保持）

- **`schedule_items_cache`：** `user_id`、`title`、`location`、`starts_at`、`ends_at`、`fetched_at`、`batch_id`。
- **`personal_plans`：** `priority`、`status`、`on_timeline`、时间窗等。
- **`org_tasks` / `org_task_assignments`：** 指派与时间窗；时间轴侧按现有 `effectiveOrgTaskWindow` 与重叠过滤。

### 3.2 新增：团委统筹事件

**表名（实现可定为）：** `league_coordination_events`

| 字段 | 说明 |
|------|------|
| `id` | UUID 主键 |
| `title` | 标题，非空 |
| `description` | 可选正文 |
| `category` | 枚举，与赛题表述对齐：`practice` \| `volunteer` \| `work_study` \| `general`（实现可用 DB enum） |
| `starts_at`, `ends_at` | 时间窗，约束 `starts_at < ends_at` |
| `created_by_user_id` | 团委操作者，FK → `users.id` |
| `created_at`, `updated_at` | 审计时间 |

**发布策略（V1 已定）：** **创建即发布**。不要求草稿状态；若未来要草稿，再增加 `published_at` 可空与发布动作。

**可见性（V1 已定）：** **全部学生**可见所有统筹事件（无院系/年级过滤）。后续若需过滤，另开规格增量。

**索引：** 至少支持按 `(starts_at, ends_at)` 与时间轴查询窗做高效 overlap 过滤（与 `schedule_items_cache` / `personal_plans` 查询模式一致）。

### 3.3 时间轴合并

扩展合并逻辑，增加第四类输入 **`league_coordination`**：

- `sourceType`: `"league_coordination"`
- `sourceId`: 事件 `id`
- `meta`: 至少含 `category`；可含 `description` 摘要或引用 id（由实现计划定以免载荷过大）

合并后按 `starts_at` 排序（与现 `mergeTimelineSources` 行为一致）。

---

## 4. API

### 4.1 学生 / 通用

- **`GET /timeline?from=&to=`**（已存在）：扩展查询统筹事件表，合并进响应列表。
- **课表：** 保持现有 **`POST /schedule/sync`**、列表/过滤接口（若过滤仅前端，规格允许；**过期提醒** 可由 API 返回 `fetched_at` / `stale` 标志或前端基于字段计算，实现计划择一并写死规则）。

### 4.2 团委端（`league_admin`）

在现有 `app.route("/league", leagueRouter)` 下增加子路径（路径名实现计划写死，例如 **`/league/coordination-events`**）：

| 方法 | 行为 |
|------|------|
| `GET /` | 列表（团委管理用，可按时间排序） |
| `POST /` | 创建（**创建即发布**） |
| `PATCH /:id` | 更新 |
| `DELETE /:id` | 删除（**硬删除**；若实现改为软删须在实现计划中说明并加列） |

**权限：** 非 `league_admin` → **403**。学生 **无写** 统筹事件接口。

---

## 5. 实时推送（统筹信息 · 端到端 A）

### 5.1 触发时机

在统筹事件的 **创建 / 更新 / 删除** 成功提交数据库后，向所有 **`student` 角色**用户推送一条 **时间轴刷新信号**。

### 5.2 用户集合

查询具有角色 **`student`** 的 `user_id` 列表（与 `user_roles` 种子及注册逻辑一致）；对每个 id 调用现有 **`sseHub.broadcast(userId, payload)`**，或封装 **`broadcastTimelineRefresh(studentUserIds: string[])`** 避免重复代码。

### 5.3 SSE 载荷与事件名

- **HTTP：** 仍使用 **`GET /notifications/stream`**（Cookie 会话与现通知页一致）。
- **SSE `event` 名：** 新增 **`timeline`**（与现有 `notification`、`ping` 区分）。
- **data（JSON 字符串）：** 至少 `{"kind":"timeline_refresh"}`；可选带 `coordinationEventId`、`action:"upsert"|"delete"` 供前端精细化调试（非必需）。

### 5.4 前端行为

- 时间轴页面（或共享 hook）监听 **`timeline`**：收到后 **防抖**（例如 300ms）调用现有 **`load()` / `/timeline` 重拉**。
- **降级：** 与 `NotificationsPage` 一致，SSE 不可用时 **短周期轮询**；间隔在实现计划中写死（如 10s）。

### 5.5 与通知收件箱的关系（V1）

**不强制** 为每个学生插入 `notifications` 行（避免 N 用户 × 每次发布会话写放大）。若后续需要铃铛未读，再增量规格：例如仅 `POST` 时写一条轻量通知或摘要。

---

## 6. 前端

### 6.1 路由与入口

- **学生时间轴：** 增强现有 **`/app/timeline`**（或当前路由）：日/周/月切换 + 合并展示 + 三语。
- **团委管理：** 新增页面（例如 **`/app/league/coordination`**），仅在 `user.roles.includes("league_admin")` 时显示导航入口；表单字段与 §3.2 对齐。

### 6.2 视图（时间轴）

- **日视图：** 当日时间格或列表，事件按来源配色/图例（`schedule` / `plan` / `org_task` / `league_coordination`）。
- **周视图：** 周一～周日列或条带（实现计划可选库或自绘，总规允许先用「按日分组列表」再迭代）。
- **月视图：** 月历格 + 密度提示；若工期紧，可遵循总规「月视图可后补」，在实现计划中标注 **阶段 2**。

### 6.3 课表 UX

- **同步：** 保留「从校务拉取」动作；展示最近同步时间；**陈旧**时提示（文案三语）。
- **过滤：** 按周/关键词/地点等（具体字段实现计划列清）。

### 6.4 个人计划与自主标记

- 全功能 CRUD 与完成态、优先级；**`on_timeline`** 开关。
- **自主任务：** 在时间轴空白时段提供 **快捷创建计划**（预填建议起止时间，用户可改）。

---

## 7. 安全与错误处理

- 所有写接口 **session + RBAC**；参数 **Zod**（或与现有一致）校验；时间窗非法 **400**。
- 统筹事件 **学生只读**；仅团委可改。
- SSE **未登录** → **401**（与现 `/notifications/stream` 一致）。

---

## 8. 测试要求

- **单元：** `mergeTimelineSources`（或等价模块）覆盖 `league_coordination` 的排序与字段。
- **API：** 团委 CRUD 权限；发布后学生在时间窗内 `GET /timeline` 可见；删除后不可见。
- **SSE（可选集成）：** 发布事件后在线客户端收到 `timeline` 事件（或在单测中 mock `sseHub`）。

---

## 9. 规格自检（2026-04-08）

| 检查项 | 结论 |
|--------|------|
| 占位符 | 无 TBD：表名允许实现微调但语义已锁；删除策略已定 **硬删除** |
| 一致性 | 与总规 `users.id`、时间轴多源合并、`SchoolGateway`、三语、SSE+轮询降级一致 |
| 范围 | 本文件覆盖模块一六类功能；月视图/高级动效允许分阶段（与总规 §5 收缩一致） |
| 歧义 | **发布** = 创建即发布；**可见** = 全体学生；**实时** = `timeline` SSE + 重拉 `/timeline` |

---

## 10. 审阅与下一步

本文档经 **阅读 `docs/superpowers/specs/2026-04-08-student-time-task-module-design.md` 并确认无修改** 后，使用 **writing-plans** 生成 `docs/superpowers/plans/2026-04-08-student-time-task-module.md`（勾选任务、含验证命令与文件路径），再进入执行阶段（subagent-driven-development 或 executing-plans）。
