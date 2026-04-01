# 校园综合智慧管理系统 — 技术设计规格

**文档状态：** 草案已定稿（三节设计评审已通过，待书面稿最终确认）  
**日期：** 2026-04-01  
**里程碑：** 可交付版本目标 **2026-04-11**；正式截止 **2026-04-12**

---

## 1. 目标与约束

### 1.1 项目目标

交付符合赛题《校园综合智慧管理系统 / 校园智慧平台》的 **可日常使用的 Web 系统**（非空壳演示）：统一入口、打破信息孤岛，支撑 **学生时间轴与任务管理**、**组织 OA 与工作流**、**学生个人档案中心**，并满足 **Docker Compose 一键部署**、**中/英/俄三语**、**模拟校务 API 与可替换适配层**、**模块间数据互联**（尤其 **志愿者号 ↔ 志愿/实践时长**）。

### 1.2 官方与硬性约束（摘要）

- **部署：** 根目录 `docker-compose.yml`；流程 `git clone` → `cd` → `cp .env.example .env`（**复制后即可运行，无需再改**）→ `docker compose up -d`。配套 `Dockerfile(s)`、`.env.example`、`README.md`（及赛题要求的说明结构）。
- **初始化数据：** 必选；数据库脚本或种子，保证评委开箱有可演示账号与互联数据。
- **一票否决相关：** 三语全覆盖；一键部署；**能力标签分模块（四类）**；**志愿者号关联** 实践/志愿数据。
- **数据对接：** 校务真实接口缺失时，**自研 mock + 向前兼容**：业务仅依赖抽象的 `SchoolGateway`，切换环境变量即可对接未来真实 URL。

### 1.3 时间策略

采用 **「基座 + D5–D6 强制模块联通验收」** 的迭代节奏（见下文里程碑），在 **4.11** 优先保证 **稳定部署 + 硬条文 + 端到端可讲**，对非硬功能主动收缩。

---

## 2. 技术架构（第一节设计）

### 2.1 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 前端 | React (Vite)、Tailwind CSS、shadcn/ui | SPA；路由与表单深度接入 **i18next**（zh / en / ru） |
| 后端 | Hono、TypeScript | **首版运行在 Compose 内 Node（或 Bun）容器**；不与 Cloudflare Workers 绑定 |
| 数据 | PostgreSQL、Drizzle ORM | 关系与外键表达跨模块关联；迁移与种子自动化 |
| 交付 | Docker、Docker Compose | 前端静态资源由 Nginx 容器提供；API 独立服务；PostgreSQL 独立服务 |

### 2.2 架构原则

- **单一用户主键：** 全系统业务表关联 **`users.id`**，禁止各模块重复定义互不相通的学生主键。
- **校务数据隔离：** 所有外部课表等访问经 **`SchoolGateway`**；默认实现调用 mock；表 **`schedule_items_cache`** 仅存同步结果，便于过期与提醒的最低实现。
- **目录与交付物：** 根目录保留 `docker-compose.yml`、`.env.example`、`README.md`；初始化数据置于 **`init-data/`** 与/或 `packages/db/seed`（**实现计划阶段二选一、避免双源头**，本文档约定以实现计划为准）。

### 2.3 十日里程碑（方案 3）

| 阶段 | 时间（建议） | 内容 |
|------|----------------|------|
| 基座 | D1–D2 | Monorepo（如 `apps/web` + `apps/api`）、Compose、Drizzle 迁移与种子、三语基础设施、认证与角色、`SchoolGateway` mock |
| 档案中心 MVP | D3–D4 | 档案、审核、**志愿者号与 `volunteer_records` 硬联动**、**能力标签四类**、奖项审核 |
| OA + 联通 | D5–D6 | 组织与审批模型、任务四态与日志、跨部门关联、团委全局视图；**OA 任务进入时间轴聚合的首条真实链路** |
| 时间轴 | D7–D8 | 课表缓存 + 个人计划 + 组织任务多源合并；视图可先 **日/周或按日分组列表**，月视图与动效可后补 |
| 收口 | D9–D10 | README、演示账号、通知 SSE/降级轮询、稳定性与演示路径固化 |

---

## 3. 核心领域模型（第二节设计）

### 3.1 身份与权限

- **`users`：** 登录标识、凭证（首版可邮箱+密码哈希）、`preferred_locale`、`created_at` 等。
- **`user_roles`：** `user_id` + 角色枚举（如 `student`、`org_member`、`org_officer`、`org_president`、`league_admin`、`instructor`）；支持一人多角。

### 3.2 学生档案

- **`student_profiles`：** 与 `users` 1:1；**`volunteer_number` 唯一**；赛题必填身份信息（国籍、证件号、年级、院系、专业、班级、证件照等）；联系方式等可审字段。
- **`profile_field_audits`（或泛化 submissions）：** 待审/通过/驳回+原因；驱动通知。
- **`ability_tags`：** `user_id` + **`category` ∈ { technical, planning, management, sports }** + `label`；DB 层约束分类，UI 分栏防混类。
- **`awards`：** 奖项内容、佐证存储路径、审核状态、审计可查。

### 3.3 志愿者与实践（硬联动）

- **`volunteer_records`：** **`volunteer_number`** 关联至 `student_profiles`（或通过唯一约束保证可 JOIN 至 `user_id`）；活动说明、`hours`、`source`（如 `mock_gateway` / `seed`）、`external_ref` 预留。

### 3.4 组织 OA

- **`organizations`：** 全称、简称、徽标、类型、`lifecycle_status`（启用/暂停等）。
- **变更需团委批准：** `organization_revisions`（或等价：pending JSON + 审批人 + 生效时间）；仅批准后可作为对外展示来源。
- **`org_memberships`：** `org_id`、`user_id`、任职信息。
- **`org_tasks`：** 类型枚举 **单部门 / 跨部门协同 / 上下级传导**；可见性与创建方；团委可全局查询。
- **`org_task_involved_orgs`：** 跨部门任务多组织 **N:N**。
- **`org_task_assignments`：** `task_id`、`assignee_user_id`；状态 **unread / read / in_progress / done**（存储枚举，展示 i18n）。
- **`org_task_status_events`：** 每次状态变化一条（操作者、时间、from、to）。
- **`org_task_handoffs`：** 转办流水（from、to、备注、时间）；首版不设可视化流程设计器，但流水完整。

### 3.5 时间轴与校务缓存

- **`personal_plans`：** `user_id`、时间段、优先级、状态、是否进入时间轴。
- **`schedule_items_cache`：** `SchoolGateway` 同步结果；含同步批次或时间，支撑过滤与过期提醒的最低实现。

### 3.6 统一时间轴聚合

后端提供 **单次查询** 合并：**课表缓存 ∪ 个人计划 ∪ 指派给当前用户的组织任务（元数据含 `source_type`、`source_id`）∪（可选）志愿活动区间**。每条必须可区分来源，满足组织任务「可识别来源」的赛题要求。

### 3.7 通知与实时

- **`notifications`：** `user_id`、类型（档案审核结果、任务状态变更等）、payload、`read_at`。
- **通道：** 首版 **SSE 推荐**，失败时前端 **短轮询** 降级。

---

## 4. 关键流程、安全与验证（第三节设计）

### 4.1 档案流程

1. 学生补全必填项并提交可审字段 → `pending` → 团委 **通过/驳回（原因必填）** → 写 **`notifications`**。  
2. 能力标签仅在四类下维护；奖项经审核后公开展示。  
3. **`volunteer_records`** 按志愿者号聚合；档案页 **总时长 + 明细** 与种子一致。

### 4.2 OA 流程

1. 组织新建/变更进入 pending → 团委批准 → 对外信息生效。  
2. 创建任务时标注类型；跨部门写入 **`org_task_involved_orgs`**。  
3. 被指派人驱动四态迁移；每次迁移 **`org_task_status_events` + `notifications`**（同事务优先）。  
4. 转办写入 **`org_task_handoffs`**。  
5. 团委全局视图：**筛选 + 基于真实表的统计**（禁止纯前端假数据）。

### 4.3 时间轴流程

课表经 `SchoolGateway` 写入缓存；个人计划 CRUD；组织任务因指派自动进入聚合 API；返回统一「时间段事件」列表供前端日/周/列表视图消费。

### 4.4 安全底线

- 所有写接口 **RBAC**；密码 **安全哈希**；**`.env.example` 无真实秘密**；Drizzle 参数化；上传 **大小与 MIME 限制**；实时通道 **可降级**。

### 4.5 4.11 可交付最小验证清单

| 项 | 通过标准 |
|----|----------|
| 一键部署 | 按 README：`cp .env.example .env` + `docker compose up -d` 无额外手工依赖 |
| 三语 | 主路径（登录、导航、档案、OA、时间轴）切换 **zh/en/ru** 无裸露键名 |
| 志愿者号 | 种子用户志愿者号与 **`volunteer_records` 汇总** 一致 |
| 能力标签 | 四类分栏/约束 + DB `category` 枚举 |
| OA | 四态、历史可查、跨部门多组织、团委筛选与简单统计 |
| 时间轴 | 同期展示 **课表率 + 个人计划 + 组织任务** 且任务带 **来源标识** |
| 审核推送 | 通过/驳回在 **通知列表** 中立即可见（强实时为加分非阻断） |

---

## 5. 明确收缩范围（4.11）

以下不阻断交付，若时间不足可降级或省略：

- OpenAPI/Swagger 文档（可选加分项）。
- 复杂工作流可视化编排器；固定状态机 + 日志即可。
- 时间轴 **月视图** 高级动效；优先日/周或按日分组列表。
- 生产级对象存储；竞赛可用 **Docker volume + 小文件**。
- WebSocket 集群；**SSE + 轮询** 满足演示即可。

---

## 6. 规格自检记录

| 检查项 | 结论 |
|--------|------|
| 占位符 | 无 TBD/TODO；种子与 `init-data` 二选一在实施计划中锁定单一路径 |
| 一致性 | 用户主键统一 `users.id`；志愿者号唯一并驱动 `volunteer_records`；时间轴来源字段与 OA 指派一致 |
| 范围 | 单规格覆盖三模块 + 部署 + 三语 + mock；未展开具体 UI 线框（由实现计划与组件分解承担） |
| 歧义 | 「 Instructor」录入可走 `users` + `teachers` 扩展表或 `user_roles`+档案字段；**实现计划首版选定一种并写入迁移** |

---

## 7. 下一步

经 **产品/队长书面确认本 spec** 后，使用 **writing-plans** 产出 `docs/superpowers/plans/2026-04-01-campus-platform-plan.md`（按任务粒度、可勾选、含验证命令），再进入 subagent-driven-development 或 executing-plans 执行阶段。
