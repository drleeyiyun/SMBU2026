# （三）学生个人档案中心 — 设计规格

**文档状态：** 已定稿（基础信息存储方案 **A：JSONB 三语**）  
**日期：** 2026-04-09  
**上位规格：** [`2026-04-01-campus-platform-design.md`](./2026-04-01-campus-platform-design.md)  
**关联模块：** [`2026-04-08-student-time-task-module-design.md`](./2026-04-08-student-time-task-module-design.md)（时间线/个人计划）、[`2026-04-09-org-oa-task-flow-design.md`](./2026-04-09-org-oa-task-flow-design.md)（团委角色、通知 SSE）

本文件落实赛题第三板块六项功能，与仓库现有 `student_profiles`、`ability_tags` 四类枚举、`awards`、`volunteer_records`、`archive` 路由、`notifications` + `broadcastNotification`（SSE）对齐，并补足：**三语基础信息**、**身份必填与材料**、**综合实践志愿数据链**、**学生端与团委端完整 UI**、**审核记录可查**、**审核结果实时可达学生端**。

---

## 1. 目标与验收口径

### 1.1 模块目标

| 功能项 | 目标 |
|--------|------|
| 基础信息管理 | 学生可维护**中/英/俄**三语文本字段（姓名、手机、微信、邮箱、GitHub、微博等）；**学号**为权威单值字段（不参与多语意差异）；支持**编辑后提交团委审核**；通过后生效展示。 |
| 身份信息 | 身份证照、人像、民族、证件号、志愿者号、年级、院系、专业、班级**全套必填**后方可视为档案「身份区完整」；缺项时 API 返回明确可解析错误；材料 URL 落库。 |
| 志愿者号关联 | **核心**：学生档案 `volunteer_number` 与 **综合实践/团委统筹志愿类活动** 产生的时长在 `volunteer_records` 中可追溯；与「时间线中出现的 `category = volunteer` 活动」通过 **认领表** 打通，避免未参加活动却累计时长。 |
| 能力标签管理 | **技术 / 谋划 / 管理 / 体育** 四模块分区展示与编辑；**禁止跨类混存**（沿用 PG enum + 后端校验）。 |
| 奖项荣誉 | 学生上传（材料 URL）；**仅 `approved` 对外展示**；团委审核；**拒绝须理由**；审核流水 **可按学生/时间/范围检索**。 |
| 档案审核 | 团委端对**基础信息送审**（及既有联系方式草稿若仍保留）做通过/驳回；**驳回必须 reason**；结果写入 `notifications` 并 **SSE 推送**（复用 `archive_audit`）。 |

### 1.2 三语约定

- 语言代码与全站一致：**`zh` | `en` | `ru`**（对应 `users.preferredLocale` / i18next）。
- **基础信息 JSON** 内各展示字段使用结构：`{ "zh"?: string, "en"?: string, "ru"?: string }`；允许部分语种暂空，但**送审时**实现计划需写明最低要求（建议：至少 `zh` 非空用于评委演示）。
- **学号**字段：`student_no` 单列（text，唯一索引，可空→逐步必填），**不**做三语分叉。

---

## 2. 现状差异与必做增量

| 项 | 现状 | 目标 |
|----|------|------|
| 基础信息三语 | 无；仅单值与少量草稿字段 | `basic_i18n_published` + `basic_i18n_draft`（JSONB）+ `basic_audit_*` |
| 学号 | 无 | `student_no` + API + 前端表单 |
| 身份必填 | 部分列可空 | 约束 + PATCH 校验 + seed 补全示例 URL |
| 志愿关联 | 仅按志愿者号读 `volunteer_records`；无写入口 | **认领表** + 幂等同步至 `volunteer_records`；**部分唯一索引** `(volunteer_number, external_ref)` |
| 学生端档案页 | 演示级 | 分区完整 UI、三语编辑、认领志愿、SSE 刷新审核状态 |
| 团委端 | 无档案集中审核页 | 待审核列表、单条审核、荣誉队列、**审核日志查询** |
| 荣誉展示 | API 返回全部状态 | 学生端「对外列表」仅 `approved`；「我的提交」含 pending/rejected |

---

## 3. 数据模型

### 3.1 `student_profiles` 增量

| 字段 | 类型 | 说明 |
|------|------|------|
| `student_no` | text，可空 → 业务必填 | 学号；**唯一**（已存在志愿者号唯一，学号单独 uniqueIndex） |
| `basic_i18n_published` | jsonb，非空默认 `{}` | 已通过审的三语基础信息 |
| `basic_i18n_draft` | jsonb，可空 | 待审核草稿；非空且 `basic_audit_status = pending` |
| `basic_audit_status` | text，默认 `none` | `none` \| `pending` \| `approved` \| `rejected` |
| `basic_audit_reason` | text，可空 | 驳回理由 |

**JSON 键（V1 固定）：** `name`、`phone`、`wechat`、`email`、`github`、`weibo` — 每个值为 `{ zh?, en?, ru? }` 对象。

兼容：保留既有 `profile_draft_phone` / `profile_draft_wechat` / `profile_audit_*`；实现计划规定 **新前端优先 JSON**；合并读取时若 JSON 空则回退旧列（仅过渡期）。

### 3.2 身份必填列（约束策略）

以下列在 **业务规则** 上必填（数据库层：`NOT NULL` 或在 API 层统一校验二选一并写死；推荐：**迁移后 NOT NULL**，seed 补占位 URL）：

`nationality`、`id_number`、`grade`、`department`、`major`、`class_name`、`volunteer_number`、`id_photo_url`、`portrait_url`。

### 3.3 新表：`student_volunteer_event_claims`

| 字段 | 类型 | 说明 |
|------|------|------|
| `user_id` | UUID FK → users | |
| `coordination_event_id` | UUID FK → league_coordination_events | |
| `claimed_hours` | numeric(8,2)，可空 | 空则同步时用活动 `(ends_at - starts_at)` 折合小时 |
| `created_at` | timestamptz | |

**主键：** `(user_id, coordination_event_id)`。

**规则：** 仅当统筹活动 `category = volunteer` 时允许插入；活动必须存在。

### 3.4 `volunteer_records` 幂等

- 增加 **部分唯一索引**：`WHERE external_ref IS NOT NULL`，列 `(volunteer_number, external_ref)`。
- 同步写入：`source = 'coordination'`，`external_ref = coordination_event_id::text`（或 UUID 字符串，实现计划写死一种）。

### 3.5 审核流水（可检索）

**V1：** 不强制新表；提供 `GET /league/archive/audit-log`，查询 `notifications` 中 `type = archive_audit`，按 `created_at`、可选 `userId`、payload 内 `scope`（`profile` \| `award` \| 扩展）过滤；**分页** `limit`/`cursor` 由实现计划写死默认值。

---

## 4. API（REST）

**通用：** Session + RBAC；JSON + Zod；错误码 400/403/404/409。

### 4.1 学生 — 档案

- **`GET /archive/me`**  
  返回：`profile`（合并展示：含 `basicI18nDisplay`、`basicI18nDraft`、`basicAuditStatus`、身份字段、 github/weibo/phone/wechat 等）、`abilityTagsByCategory`、`awards`（分 `publicAwards` 仅 approved 与 `myAwardSubmissions` 全状态或等价结构）、`volunteerSummary`、`identityComplete` 布尔（服务端按必填项计算）。

- **`PATCH /archive/me`**  
  Body 允许：`basicI18nDraft`（部分深度合并）、`student_no`、`github`、`weibo`、以及 **身份区**字段（`nationality`、`id_number`、`grade`、`department`、`major`、`class_name`、`id_photo_url`、`portrait_url`）等；**任一基础信息草稿字段变更** → `basic_audit_status = pending`、`basic_audit_reason = null`。  
  （旧字段 `profileDraftPhone` 等若仍提交：保持兼容。）

- **`POST /archive/volunteer-claims`**  
  Body：`{ coordinationEventId: uuid, claimedHours?: number }`  
  校验：活动存在且 `category = volunteer`；幂等 PK。  
  成功后可触发 **同步**（见下条）或由学生按按钮触发。

- **`POST /archive/volunteer-sync`**  
  对当前用户：根据 `student_volunteer_event_claims` 幂等 upsert `volunteer_records`；返回更新条数摘要。

### 4.2 团委 — 审核与查询

- **`GET /league/archive/pending`**（`league_admin`）  
  列表：`basic_audit_status = pending` 的学生摘要（userId、displayName、submittedAt 可选）。

- **`POST /archive/reviews/:userId`**（扩展）  
  当 `basic_audit_status === 'pending'`：通过则将 `basic_i18n_draft` 合并入 `basic_i18n_published`、清空 draft、置 `approved`；驳回则 `rejected` + `reason` 必填；**写 `notifications` + `broadcastNotification`**（payload 含 `scope: profile` 或细分子 scope）。  
  保留对旧 `profile_audit_status` pending 的处理分支（实现计划列明合并策略）。

- **`GET /league/archive/audit-log`**（`league_admin`）  
  Query：`userId?`、`scope?`、`from?`、`to?`、`limit?`  

- **荣誉** 沿用 `POST /archive/awards/:id/review`；流水归入同一 audit-log（`scope: award`）。

### 4.3 能力标签与荣誉

- 保持现有路径；实现计划补充：**PATCH/PUT 标签**若未实现则新增 **标签重命名**（可选 V1 仅用 delete+create）。

---

## 5. 实时推送（SSE）

- 继续 **`GET /notifications/stream`**；事件名 **`notification`**（与现网一致）。
- **学生档案页** 挂载 `EventSource`：收到 `type === archive_audit` 且与本人相关时 **防抖刷新 `GET /archive/me`**（可与 `NotificationsPage` 同一工具函数）。
- SSE 不可用时 **10s 轮询降级**（与 OA / Timeline 实践一致）。

---

## 6. 前端（`apps/web`）

- **`ArchivePage`：** 分区 — 基础信息（三语表单 + 送审状态）、身份信息（必填校验提示）、志愿者摘要 + **认领按钮**（对接统筹活动列表或内嵌从时间线跳转 deep link 可选）、四模块能力标签 + 增删、荣誉提交与列表、监听 SSE。
- **新页 `LeagueArchivePage`（或等价路由）：** 待审队列、单条通过/驳回（理由）、荣誉审核入口跳转或内嵌、审核日志表（调 `audit-log`）。
- **导航：** `league_admin` 显示「档案审核」链到上述路由。
- **i18n：** 所有新增 UI 文案进 `zh` / `en` / `ru` 的 `common.json`（或其它命名空间与模块二一致）。

---

## 7. 安全与 RBAC

- 学生仅能改本人档案；认领仅本人 `user_id`。
- 团委接口 **`league_admin`**；审核日志仅团委。
- 目录暴破：审核列表不在此模块放宽枚举；audit-log **必须**限制 `limit` 上限。

---

## 8. 测试要求

- **API：** 基础信息送审/通过/驳回（reason 必填）、身份 PATCH 缺项 400、`volunteer-claims` 非 volunteer 活动 400、同步幂等（双次同步无重复行）、`GET /archive/me` awards 分区逻辑。
- **DB：** 迁移可应用；seed 与 NOT NULL 一致。

---

## 9. 规格自检（2026-04-09）

| 检查项 | 结论 |
|--------|------|
| 占位符 | 无 TBD； externes 由实现计划写死 |
| 与总规 | 三语 zh/en/ru；志愿者号与综合实践通过认领+`volunteer_records` 演示互联 |
| 范围 | V1 不含团委改志愿号 BPM；不含 OCR 证照真伪 |
| 歧义 | 「实时」= 通知 SSE + 档案页防抖刷新 + 轮询降级 |

---

## 10. 审阅与下一步

本文档经确认后，使用 **writing-plans** 生成 `docs/superpowers/plans/2026-04-09-student-archive-center.md`，再进入 **subagent-driven-development** 或 **executing-plans** 执行。
