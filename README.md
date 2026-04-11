# 校园社团数字化平台 · Campus Platform

赛题向说明：本仓库为 monorepo（`apps/web` 前端、`apps/api` 后端、`packages/db` 数据层），支持 **Docker Compose 一键启动** 与可选的本地 `pnpm` 开发。

## Prerequisites / 环境要求

- [Docker](https://docs.docker.com/get-docker/) 与 [Docker Compose](https://docs.docker.com/compose/)（Docker Desktop 已包含 Compose）
- 可选本地开发：[Node.js 22+](https://nodejs.org/)、[pnpm](https://pnpm.io/)（推荐 `corepack enable` 后使用仓库指定的 pnpm 版本）

---

## Quick start with Docker / 使用 Docker 快速启动

```bash
git clone https://github.com/drleeyiyun/SMBU2026.git
cd campus-platform
cp .env.example .env
docker compose up -d --build
```

在浏览器打开：http://localhost:8080
（若修改了 `.env` 中的 `WEB_PORT`，请改用对应端口）。

Compose 服务说明：

| 服务 | 说明 |
|------|------|
| `db` | PostgreSQL 16，库名 `campus` |
| `api` | Hono API，容器内执行迁移、种子数据后启动；默认映射宿主机 `3000` |
| `web` | 构建后的 SPA，由 Nginx 提供静态资源，并将与 Vite 开发代理一致的后端路径转发到 `api` |

若 `docker compose build` 因网络或机器资源失败，可查看下文「手动构建与排错」。

---

## Demo accounts / 演示账号

密码均为 **`Demo#2026`**（师生录入创建的新账号由管理员自行设定初始密码）。

| 角色 Role | 邮箱 Email |
|-----------|------------|
| 学生 Student | `student@demo.school` |
| 社团负责人 Org leader | `leader@demo.school` |
| 团委/联盟管理员 League admin | `league@demo.school` |
| **数据管理员（仅团委权限，用于师生录入演示）** | `dataadmin@demo.school` |
| 指导老师 Instructor | `instructor@demo.school` |
| 额外学生（青协骨干，可登录） | `student-amy@demo.school` |
| 额外学生（仅学生角色、未加入社团，便于测试指派检索） | `student-bob@demo.school` |
| 额外指导老师 | `instructor-chen@demo.school`、`instructor-ding@demo.school` |

登录 `dataadmin@demo.school` 或 `league@demo.school` 后，导航中可见 **「师生录入」**，可在表单中新增教师或学生账号（学生需填写唯一志愿者号等档案字段）。

---

## API integration & data entry / API 接入与数据录入

- **前端如何连 API：** `apps/web` 在开发模式下用 Vite 将一组前缀（`/auth`、`/me`、`/tasks`、`/league` 等，见 `apps/web/vite.config.ts`）**代理**到后端，默认目标为 `http://localhost:3000`。生产或 Docker 下由 **Nginx** 把相同路径转发到 `api` 容器。浏览器始终访问**同源**路径（如 `/auth/login`），不手写完整 API 域名。
- **认证：** `POST /auth/login`（JSON：`email`、`password`），成功后在 **HttpOnly Cookie** 中写入会话；后续 `fetch` 需 `credentials: "include"`（前端封装已处理）。`GET /me` 返回当前用户与角色。
- **如何录入数据：**
  - **演示库重置：** 配置好 `DATABASE_URL` 后执行 `pnpm db:migrate`，再执行 **`pnpm db:seed`**。种子脚本会清空业务表并写入演示用户、社团、任务、时间轴缓存等（可反复执行，**仅适用于开发库**）。
  - **日常增量：** 使用各页面功能（注册流程若未开放则依赖种子用户登录后操作），或直接调用对应 REST接口（需携带会话 Cookie或后续若开放的服务端密钥）。
**种子用户（seed users）** 不是另一种登录方式，而是 `pnpm db:seed` 写入数据库的一批**普通用户记录**。登录方式与所有人相同：`POST /auth/login` + 邮箱、密码；系统**没有**开放自助注册，因此演示或开发环境里新账号要么来自种子，要么由**团委管理员**在 **「师生录入」** 页面（`/app/league/roster`，需 `league_admin` 角色）创建。
---

## Optional: local dev with Postgres / 可选：本地 Postgres + pnpm 开发

1. 启动本机 PostgreSQL，并创建库（例如 `campus`）。将 **仓库根目录** `.env` 中的 `DATABASE_URL` 配成本机（**不要**使用仅适用于 Docker 的主机名 `db`），例如：  
   `postgresql://postgres:postgres@localhost:5432/campus`  
   迁移与种子会从该文件读取连接串（`packages/db` 内命令无需再单独导出环境变量）。
2. 安装依赖并执行迁移、种子：

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

在 **Windows** 上若提示 **`pnpm` 不是内部或外部命令**：根脚本已改为通过 `npx pnpm@9.15.0` 调用子包，可直接再试 `pnpm db:migrate`；或全程使用 `corepack pnpm db:migrate` / `corepack pnpm --filter db migrate`。

前端开发服务器会使用 `vite.config.ts` 中的代理将 `/auth`、`/me`、`/timeline` 等路径转发到 API（默认 `http://localhost:3000`）。

未全局安装 pnpm 时，可使用：

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
```

或使用：`npx pnpm@9.15.0 install`（与仓库 `packageManager` 版本保持一致更佳）。

---

## Troubleshooting / 常见问题

### Windows 上 5432 端口冲突

若本机已安装 PostgreSQL 并占用 **5432**，而你在 `docker-compose.yml` 中为 `db` 增加了 `ports: - "5432:5432"`，会导致映射失败。默认 compose **未** 将数据库端口暴露到宿主机，一般无冲突；若需从宿主机连容器数据库，Compose 默认映射为 **`15432:5432`**（因 Windows 上 **5433** 等端口常落入系统保留段导致绑定失败）；仍冲突时可设环境变量 **`DB_PUBLISH_PORT`**。

### 宿主机 3000 端口被占用

若本机已有进程监听 **3000**（例如本地跑的 API），`docker compose up` 会报端口绑定失败。在 `.env` 中将 `API_PORT` 改为空闲端口（例如 `3001`）；**容器内** API 仍监听 `3000`，Nginx 通过 Docker 网络访问 `api:3000`，无需改 `nginx.conf`。

### `docker compose build` 失败

- 检查 Docker 是否有足够磁盘与内存。
- 企业网络下 `pnpm install` 拉包失败时，可配置 npm/pnpm 镜像后重试。
- 仍失败时，可在安装好 Node 与 pnpm 的机器上本地执行 `pnpm install`、`pnpm --filter api build`、`pnpm --filter web build`，再按需自行编写简化镜像或仅运行 `db` + 本地进程。

### API 无法连接数据库

- **容器内 `api`：** `docker-compose.yml` 已为 `api` 写入 `DATABASE_URL=...@db:5432`，与根目录 `.env` 无关。
- **宿主机 `pnpm db:migrate`：** 根目录 `.env` 的 `DATABASE_URL` 须指向 **映射端口**，默认 **`127.0.0.1:15432`**（与 `DB_PUBLISH_PORT` 一致），不要用 `localhost:5432`（宿主机 5432 通常无库或未映射）。

### CORS 或 Cookie

通过 **http://localhost:8080** 访问前端时，请将 `.env` 中 `CORS_ORIGIN` 设为该地址（与 `.env.example` 一致即可）。生产环境请改为真实站点域名。

### 浏览器对 `/me`、`/auth/login` 返回 `502`（API 日志正常）

Nginx 配置里若使用 **`proxy_pass $变量`**，通常需要配置 **`resolver`**（例如 Docker 内置 DNS `127.0.0.11`），否则可能无法解析 `api` 主机名并统一返回 **502**。当前仓库已改为 **`proxy_pass http://api:3000`** 字面量；请 **`docker compose build web`** 后 **`docker compose up -d`**。同时 API 在容器内需监听 **`0.0.0.0`**（代码中已对 `@hono/node-server` 设置）。

### 浏览器 `502 Bad Gateway` 且 `api` 日志含 `set: illegal option -`

原因多为 **`docker-entrypoint.sh` 在 Windows 上使用 CRLF 行尾**，Alpine 内 `/bin/sh` 会把 `set -e` 解析坏。当前镜像已改为 **Dockerfile 内联 ENTRYPOINT**，不依赖该脚本。请拉取最新代码后执行 **`docker compose build api --no-cache`** 再 **`docker compose up -d`**。若仍见旧日志，可先 **`docker compose down`** 再重建。

---

## Project layout / 目录结构（摘要）

- `apps/web` — React + Vite + Tailwind
- `apps/api` — Hono + Node
- `packages/db` — Drizzle ORM、迁移与种子
- `docker-compose.yml` — 编排 `db`、`api`、`web`

---

## License

See repository license if applicable.
