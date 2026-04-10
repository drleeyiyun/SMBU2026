# 团委端与通用体验 — 第一次总体细节优化

**日期:** 2026-04-10  
**范围:** 登出、团委学生档案浏览与审核对比、组织管理信息展示、通知可读 UI

## 1. 目标

1. 学生/管理员可 **安全退出登录**（清理会话 Cookie）。
2. 团委在 **档案审核** 场景可 **按学生浏览**：卡片式简要列表 → 弹层查看完整档案（与 `GET /archive/me` 同构数据）。
3. **待审核** 处展示 **具体字段级变更**（多语基础信息：生效值 vs 草稿；legacy 联系方式：当前 vs 草稿）。
4. **组织管理** 中团委不仅做生命周期操作，还能看到 **徽标、类型、创建时间、指导教师** 等摘要。
5. **通知** 从裸 JSON 改为 **结构化卡片**（类型徽章、审核结果、理由、任务状态迁移等），支持 **标为已读**。

## 2. API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/logout` | 已有，前端补齐调用 |
| GET | `/league/archive/students` | `q` 可选；简要列表 |
| GET | `/league/archive/students/:userId` | 完整档案 bundle（复用 `fetchStudentArchiveDetail`） |
| GET | `/league/archive/pending` | 扩展：email、学号、院系、多语 published/draft、legacy 草稿字段 |
| GET | `/league/archive/audit-log` | 扩展：`studentDisplayName`（批量查 `users`） |

内部：`fetchStudentArchiveDetail` 抽至 `apps/api/src/services/student-archive-read.ts`，档案 JSON 格式化抽至 `apps/api/src/lib/archive-profile-format.ts`。

## 3. 前端

- **AppLayout:** 展示当前用户简称 + **退出登录**。
- **SessionProvider:** `logout()` → `POST /auth/logout` 后 `setUser(null)`。
- **LeagueArchivePage:** 学生目录网格、详情模态层、待审 diff 表、审核日志列优化。
- **OrgManagePage:** 团委社团列表改为 **双列卡片**，含摘要字段与管理操作区。
- **NotificationsPage:** `summarizeNotification` + i18n；**PATCH `/notifications/:id/read`**。

## 4. 三语

新增文案落在 `apps/web/src/locales/{zh,en,ru}/common.json`（`nav.logout`、`leagueArchive.*`、`notifications.*`、`orgManage.createdAtLabel` 等）。

## 5. 验收

- 团委账号可检索学生、打开详情、在待审中看到变更表；通过后列表刷新。
- 组织页卡片展示摘要信息与原审批操作。
- 通知页为卡片 UI，未知类型仍降级为 JSON。
- `pnpm --filter api test`、`pnpm --filter api build`、`pnpm --filter web build` 通过。
