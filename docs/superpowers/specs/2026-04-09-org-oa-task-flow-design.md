# （二）组织 OA 与任务流转系统 — 设计规格

**文档状态：** 已定稿（工作流档位 **A / MVP**）  
**日期：** 2026-04-09  
**上位规格：** [`2026-04-01-campus-platform-design.md`](./2026-04-01-campus-platform-design.md)  
**关联模块一：** [`2026-04-08-student-time-task-module-design.md`](./2026-04-08-student-time-task-module-design.md)

本文件细化赛题第二板块七类功能项，与仓库现状（`organizations`、`organization_revisions`、`org_tasks`、任务四态、`org_task_status_events`、`org_task_handoffs`、`GET /league/tasks-overview`、SSE `sseHub`）对齐。**自定义任务流** 采用 **方案 A**：不引入可配置 BPMN/步骤模板；以 **负责人交接 + 状态推进 + 全链路可查询日志 + SSE 触发前端刷新** 满足赛题「流转留痕」与「实时」的演示口径。

---

## 1. 目标与验收口径

### 1.1 模块目标

- **组织 OA：** 基础信息维护（全称、简称、徽标、性质），变更经 **团委审批** 后生效；指导老师与社团负责人可从 **全校师生目录** 检索并指派，变更 **留痕**。
- **组织状态：** `pending` / `active` / `suspended` 由团委后台统一管控，**每次状态变更写入审计表**。
- **任务：** 四态（待查看 / 已查看 / 进行中 / 已完成）与后端 `unread` / `read` / `in_progress` / `done` 一一对应；负责人顺序推进，团委可覆盖；**状态变更 SSE 推送给相关用户**，前端防抖重拉（与模块一 `timeline` SSE 模式一致）。
- **任务类型：** 创建时指定 `single` | `cross` | `transfer`；跨部门任务 **多组织** 关联（沿用 `org_task_involved_orgs`）。
- **流转：** 交接（handoff）与状态事件均已落库；对外提供 **统一时间线 API**，满足「全程记录」。
- **团委全局视图：** 在现有 `GET /league/tasks-overview` 基础上增加 **类型/时间/关键词** 等筛选与列表信息补全（含社团简称）；**简单统计**（沿用 `byStatus` + 可选按 `kind` 聚合）。
- **三语：** 本模块 **所有** 用户可见 UI 文案走 i18next（zh / en / ru），与总规一致。

### 1.2 工作流档位（已定）

| 档位 | 说明 |
|------|------|
| **A（选定）** | 不实现「每社团可配置流程模板」；以 handoff + 状态机 + 审计表 + 时间线 API + SSE 刷新为主。 |
| B / C | 不在本迭代范围。 |

---

## 2. 现状差异与必修正缺陷

| 项 | 现状 | 目标 |
|----|------|------|
| 审批拒绝 | `reject` 时将 `organizations.lifecycle_status` 置为 `suspended` | **拒绝仅结束修订**，**不修改** 社团当前生命周期状态（新建未批准仍为 `pending`，已激活被拒绝修订仍为 `active`） |
| 组织列表 | `GET /orgs` 仅 `active` | 团委需要 **管理视角** 列表（见 §4） |
| 负责人/指导老师 | 表结构有，`orgs` 路由缺 CRUD + 履历 | 目录检索 + 指派 API + **履历表** |
| 组织状态审计 | 无表 | **新表** 记录每次 `lifecycle` 变更 |
| 任务实时 | 有通知 SSE，OA 页未订阅 | **任务变更** 向相关用户 fan-out **可命名 SSE 事件**（见 §5） |
| OA 前端 | `OaPage` 硬编码英文 | **三语** + 筛选 + 任务详情/状态操作（与 API 对齐） |

---

## 3. 数据模型

### 3.1 已有（保持）

- `organizations`、`organization_revisions`、`org_memberships`
- `org_tasks`、`org_task_kind`、`org_task_involved_orgs`、`org_task_assignments`、`task_assign_status`
- `org_task_status_events`、`org_task_handoffs`

### 3.2 新增：`org_lifecycle_events`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID PK | |
| `org_id` | UUID FK → organizations | ON DELETE cascade |
| `from_status` | `org_lifecycle` 可空 | 首次可从 `null` 表示「创建初始化」或写入旧值 |
| `to_status` | `org_lifecycle` | 新状态 |
| `actor_user_id` | UUID FK → users | 操作者（团委） |
| `reason` | text 可空 | 暂停等原因 |
| `created_at` | timestamptz | |

**规则：** 仅当团委 **`PATCH` 生命周期** 成功提交时追加一行；普通「信息修订拒绝」**不写** 本表。

### 3.3 新增：`org_leadership_events`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID PK | |
| `org_id` | UUID FK | |
| `actor_user_id` | UUID FK | 操作者 |
| `change_kind` | enum | `advisor_updated` \| `member_added` \| `member_removed` \| `member_title_updated` |
| `payload_json` | text | JSON：如 `{ "advisorUserPrev": "...", "advisorUserNext": "..." }`、`{ "userId", "title" }` |
| `created_at` | timestamptz | |

### 3.4 任务流转与日志（逻辑）

- **状态：** 继续写入 `org_task_status_events`；**不允许** LEAGUE 以外角色随意跳步（已有顺序校验；团委可越权已由现网实现）。
- **交接：** 继续写入 `org_task_handoffs`；成功插入后触发 **与状态变更同类的 SSE**（见 §5），保证「实时」演示。
- **时间线：** 新 API 将 `org_task_status_events` 与 `org_task_handoffs` 按 `created_at` **合并排序** 返回（无需新表）。

---

## 4. API（REST）

**通用：** Session + RBAC；请求体 Zod；错误码与现有一致（400/403/404/409）。

### 4.1 审批与修订（修正行为）

- **`POST /orgs/revisions/:revisionId/decide`**（`league_admin`）  
  - `approve`：行为与现有一致（合并 payload 到 `organizations`，修订 `approved`，新组织 `active`）。  
  - **`reject`：** 仅将修订置 `rejected` 并记录 `review_reason` / `decided_at`；**不得** `UPDATE organizations.lifecycle_status`。

### 4.2 团委 — 组织管理与队列

- **`GET /league/orgs`**（`league_admin`）  
  - Query：`lifecycle` 可选 (`pending`|`active`|`suspended`)。  
  - 返回：`organizations` 全量或过滤 + 必要展示字段（含 `name_short`）。
- **`GET /league/org-revisions`**（`league_admin`，可选与实现计划合并）  
  - 待处理修订列表：`status = pending`，按 `created_at`，含 `org_id`、摘要 payload。
- **`PATCH /league/orgs/:orgId/lifecycle`**（`league_admin`）  
  - Body：`{ toStatus, reason?: string }`，校验合法迁移（例如 `pending → active` 也可用于「手工激活」时与实现计划统一规则）。  
  - 事务：`UPDATE organizations` + `INSERT org_lifecycle_events`。

### 4.3 目录检索（指导员 / 学生）

- **`GET /directory/instructors?q=`**（登录用户；若需收窄为干部角色可在实现计划写死：仅 `org_president` / `org_officer` / `league_admin`）  
  - 返回：`users` 中具有 `instructor` 角色、`display_name` 或 `email` ILIKE 的结果（limit 默认 20）。
- **`GET /directory/students?q=`**（同上权限收窄规则）  
  - 返回：具有 `student` 角色的用户（可选附 `volunteer_number` 便于展示）。

### 4.4 组织负责人与指导老师

- **`PATCH /orgs/:orgId/advisor`**  
  - 权限：`org_president` / `org_officer` / `league_admin`；且操作者属于该 org 或 league。  
  - Body：`{ advisorUserId: uuid | null }`；校验目标用户存在且具 `instructor` 角色（若非 null）。  
  - `UPDATE organizations` + `INSERT org_leadership_events`（`advisor_updated`）。

- **`POST /orgs/:orgId/members`** Body：`{ userId, title?: string | null }`  
- **`PATCH /orgs/:orgId/members/:userId`** Body：`{ title }`  
- **`DELETE /orgs/:orgId/members/:userId`**  
  - 权限：同上；**不可** 删除团委禁止的角色边界（实现计划列明：至少一名 president 等若需要可后续收紧）。  
  - 每次成功变更写 `org_leadership_events`。

- **`GET /orgs/:orgId/leadership-events`**（组织干部或 `league_admin`）  
  - 分页可选；按 `created_at` 倒序。

### 4.5 任务时间线 / 详情

- **`GET /tasks/:taskId/timeline`**（任务相关的 assignee / creator / `league_admin`；或与 `org` 成员关系一致的具体规则在实现计划锁死）  
  - 返回：`events: Array<{ type: "status" \| "handoff", at: ISO, ...fields }>` 合并排序。

### 4.6 团委任务概览（增强）

- **`GET /league/tasks-overview`**  
  - 新增 Query：`kind`、`q`（标题 ILIKE）、`from`、`to`（任务 `created_at` 或时间与现网 `starts_at` 二选一，**实现计划写死一种**）。  
  - 响应条目可含 **`nameShort`**（主组织 join）便于列表。

### 4.7 任务创建与现有路由

- 保持 **`POST /orgs/:orgId/tasks`**；前端创建表单展示 `kind`、跨社团 `involvedOrgIds` 多选（数据源 `GET /orgs` 或团委 `GET /league/orgs` 视角色而定）。

---

## 5. 实时推送（SSE）

### 5.1 事件名与载荷

- HTTP 仍 **`GET /notifications/stream`**（Cookie 会话）。
- **事件名：** `org_task`（与 `notification`、`ping`、`timeline` 并列）。
- **data（JSON）：** 至少 `{ "kind": "task_refresh", "taskId": "<uuid>" }`。

### 5.2 触发时机

- **`PATCH /tasks/assignments/:id/status`** 事务提交成功后（在现有 `broadcastNotification` 之外或合并策略由实现计划定：必须 **额外** 向「无通知行但需要刷列表的用户」推送时，统一走 `org_task`）。
- **`POST /tasks/:taskId/handoffs`** 插入成功后。

### 5.3 接收者集合（V1 最小充分集）

1. 任务 `created_by_user_id`（非空时）  
2. 该任务 **所有** `org_task_assignments.assignee_user_id`  
3. 所有 `user_roles.role = league_admin` 的用户  
4. （推荐）`org_task_involved_orgs` 涉及社团中，具备 `org_president` 或 `org_officer` 且 `org_memberships` 命中者  

去重后对每个 `user_id` 调用 `sseHub.broadcast(userId, "org_task", payload)`。

### 5.4 前端

- OA 页（及任务详情若独立）挂载 `EventSource`，监听 `org_task`；**防抖 300ms** 后重拉当前列表或单行（与 `TimelinePage` 模式一致）；SSE 失败时 **10s 轮询** 降级（复用已有实践）。

---

## 6. 前端（`apps/web`）

- **`OaPage`（`/app/oa`）：** 全量 i18n；Tab「我的任务」/「团委视图」；团委侧 **筛选**（组织、状态、`kind`、关键词）；列表展示 `kind`、主组织简称、涉及社团数；任务行进入 **详情或抽屉**：四态切换（权限允许时）、交接表单、`timeline` 展示。
- **组织管理页（可选独立路由或 OA 子页）：** 团长/团委：编辑并 **提交修订**（走现有 `PATCH /orgs/:id`）；团委：**生命周期**、**审批队列**、仅展示必要字段（实现计划按工期切分为「最小页」+「增强页」）。
- **导航：** 在不影响原有结构下，为 `league_admin` 增加指向「组织管理 / 审批」的入口（可与 OA 合并 Tab）。

---

## 7. 安全与 RBAC 摘要

- 目录接口：防止过度枚举 — **必须带 `q` 且长度 ≥ 2**（或实现计划写死），**limit** 上限 50。
- 所有组织写操作校验 **操作者-org 关系** 或 `league_admin`。
- SSE：未登录 **401**。

---

## 8. 测试要求

- **API：** `reject` 修订不修改 `lifecycle_status`；`PATCH /league/orgs/:id/lifecycle` 写入审计；目录接口权限与参数校验；`GET /tasks/:id/timeline` 合并顺序。
- **SSE（可选 mock）：** `broadcastOrgTaskRefresh`（或等价）对预期 userId 调用次数/去重。

---

## 9. 规格自检（2026-04-09）

| 检查项 | 结论 |
|--------|------|
| 占位符 | 无 TBD；筛选字段与时间字段在实现计划中二选一并写死 |
| 一致性 | 与总规三语、RBAC、`users.id`、模块一 SSE 模式一致 |
| 范围 | 工作流为 **A**；不含可配置步骤模板 |
| 歧义 | 「实时」= `org_task` SSE + 防抖重拉 + 轮询降级；「流转全程记录」= status_events + handoffs + timeline API |

---

## 10. 审阅与下一步

本文档经确认后，使用 **writing-plans** 生成 `docs/superpowers/plans/2026-04-09-org-oa-task-flow.md`，再进入 **subagent-driven-development** 或 **executing-plans** 执行。
