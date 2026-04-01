# 校园社团数字化平台 · Campus Platform

赛题向说明：本仓库为 monorepo（`apps/web` 前端、`apps/api` 后端、`packages/db` 数据层），支持 **Docker Compose 一键启动** 与可选的本地 `pnpm` 开发。

## Prerequisites / 环境要求

- [Docker](https://docs.docker.com/get-docker/) 与 [Docker Compose](https://docs.docker.com/compose/)（Docker Desktop 已包含 Compose）
- 可选本地开发：[Node.js 22+](https://nodejs.org/)、[pnpm](https://pnpm.io/)（推荐 `corepack enable` 后使用仓库指定的 pnpm 版本）

---

## Quick start with Docker / 使用 Docker 快速启动

```bash
git clone <repository-url>
cd campus-platform
cp .env.example .env
docker compose up -d --build
```

在浏览器打开：**http://localhost:8080**（若修改了 `.env` 中的 `WEB_PORT`，请改用对应端口）。

Compose 服务说明：

| 服务 | 说明 |
|------|------|
| `db` | PostgreSQL 16，库名 `campus` |
| `api` | Hono API，容器内执行迁移、种子数据后启动；默认映射宿主机 `3000` |
| `web` | 构建后的 SPA，由 Nginx 提供静态资源，并将与 Vite 开发代理一致的后端路径转发到 `api` |

若 `docker compose build` 因网络或机器资源失败，可查看下文「手动构建与排错」。

---

## Demo accounts / 演示账号

密码均为 **`Demo#2026`**。

| 角色 Role | 邮箱 Email |
|-----------|------------|
| 学生 Student | `student@demo.school` |
| 社团负责人 Org leader | `leader@demo.school` |
| 团委/联盟管理员 League admin | `league@demo.school` |
| 指导老师 Instructor | `instructor@demo.school` |

---

## Optional: local dev with Postgres / 可选：本地 Postgres + pnpm 开发

1. 启动本机 PostgreSQL，并创建库（例如 `campus`），`DATABASE_URL` 指向 `localhost`。
2. 安装依赖并执行迁移、种子：

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

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

若本机已安装 PostgreSQL 并占用 **5432**，而你在 `docker-compose.yml` 中为 `db` 增加了 `ports: - "5432:5432"`，会导致映射失败。默认 compose **未** 将数据库端口暴露到宿主机，一般无冲突；若需从宿主机连容器数据库，可将映射改为例如 `"5433:5432"`。

### 宿主机 3000 端口被占用

若本机已有进程监听 **3000**（例如本地跑的 API），`docker compose up` 会报端口绑定失败。在 `.env` 中将 `API_PORT` 改为空闲端口（例如 `3001`）；**容器内** API 仍监听 `3000`，Nginx 通过 Docker 网络访问 `api:3000`，无需改 `nginx.conf`。

### `docker compose build` 失败

- 检查 Docker 是否有足够磁盘与内存。
- 企业网络下 `pnpm install` 拉包失败时，可配置 npm/pnpm 镜像后重试。
- 仍失败时，可在安装好 Node 与 pnpm 的机器上本地执行 `pnpm install`、`pnpm --filter api build`、`pnpm --filter web build`，再按需自行编写简化镜像或仅运行 `db` + 本地进程。

### API 无法连接数据库

Compose 环境下请确保 `DATABASE_URL` 使用主机名 **`db`**（见 `.env.example`），不要使用 `localhost`（在容器内 `localhost` 指向容器自身）。

### CORS 或 Cookie

通过 **http://localhost:8080** 访问前端时，请将 `.env` 中 `CORS_ORIGIN` 设为该地址（与 `.env.example` 一致即可）。生产环境请改为真实站点域名。

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
