# 校园平台 — 第二次总体细节优化

**日期:** 2026-04-11  

## 1. 去掉「联系方式草稿（旧版）」

- **前端：** `ArchivePage` 移除整段 legacy 区块；`LeagueArchivePage` 待审卡片移除联系方式对比表。
- **API：** `PATCH /archive/me` 不再接受 `profileDraftPhone` / `profileDraftWechat`；`POST /archive/reviews/:userId` 仅处理 `basicAuditStatus === pending`（移除 legacy 分支）。
- **GET `/league/archive/pending`：** 仅 `basicAuditStatus = pending`；响应中去掉 draft phone/wechat 字段。
- **`profileToJson`：** 不再输出 `profileDraft*`、`profileAudit*`（数据库列保留，兼容历史数据）。

## 2. 时间展示统一

- 新增 `apps/web/src/lib/format-date.ts`：`formatDisplayDateTime` → 本地时间 `YYYY-MM-DD HH:mm:ss`，无 `T` / `Z` / 毫秒。
- **应用页面：** 通知、团委档案审核日志、组织管理、团委统筹列表、时间轴条目、个人计划列表、OA 任务与时间线、档案内荣誉与志愿记录等凡面向用户展示的 ISO 时间均走该函数。

## 3. 荣誉上传 → 团委审核

- **数据：** 新建荣誉行已为 `status: pending`（维持不变）。
- **新增：** `GET /league/archive/awards/pending`（`league_admin`）：待审荣誉 + 学生姓名/学号。
- **前端：** `LeagueArchivePage` 增加「待审核荣誉」列表，调用已有 `POST /archive/awards/:id/review`。
- **学生端：** 提交成功后文案明确「已提交，等待团委审核」。

## 4. 身份信息保存校验

- **字段：** 与 `identityCompleteRow` 对齐的 9 项（含 **志愿者号**），全部带红色 `*`；缺项点击「保存身份信息」时不提交，标红对应输入框并提示补全。
- **API：** `PATCH /archive/me` 支持 `volunteerNumber` 更新。

## 5. 验收

- `pnpm --filter web build`、`pnpm --filter api build && pnpm --filter api test` 通过。
- 团委账号可看到待审荣誉并完成通过/驳回；学生端不再出现旧版联系方式区块。
