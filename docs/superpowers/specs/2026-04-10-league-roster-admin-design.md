# 师生录入（团委数据管理）设计 · 2026-04-10

## 背景

- **种子用户**：由 `pnpm db:seed` 写入数据库的演示账号，**不是**「特殊登录协议」；与普通用户一样走 `POST /auth/login`，只是邮箱/密码在 README 中事先约定。
- 当前无公开注册；新增真实师生依赖种子或手工 SQL。需要**可视化录入**能力。

## 目标

- 提供 **团委管理员**（沿用现有角色 `league_admin`）可用的表单页面，创建 **学生**（`student` + `student_profiles`）或 **教师**（`instructor`）。
- 演示环境增加 **仅担任 `league_admin`** 的账号，便于与「团委业务」账号区分（可选登录体验）。

## 非目标

- 不新增 `user_admin` 等 DB 枚举（减少迁移）。
- 不实现批量 CSV导入（可后续迭代）。
- 不自动发邮件通知新用户密码。

## API

- `POST /league/roster/users` — `requireRoles("league_admin")`  
  - **教师**：`email`, `displayName`, `password`（≥8）, `role: "instructor"`  
  - **学生**：同上 + `volunteerNumber`（唯一）、`studentNo`（可选）、`grade`, `department`, `major`, `className`；`nationality` 默认 `中国`；`idNumber` 服务端生成 `ROSTER-{hex}` 以满足非空与隐私占位。
- `GET /league/roster/users?limit=` — 最近创建用户列表（id、email、displayName、roles），用于页面核对。

## 前端

- 路由：`/app/league/roster`，导航仅 `league_admin` 可见。
- 表单：角色切换、公共字段 + 学生扩展字段；提交结果与错误展示。

## 验收

- `dataadmin@demo.school`（或 `league@demo.school`）登录后可见「师生录入」，创建学生/教师后可在 `GET /league/roster/users` 与登录流程中验证。
