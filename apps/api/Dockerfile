# No `# syntax=docker/dockerfile:1` — avoids BuildKit pulling that image from Docker Hub (often blocked or slow on some networks).
# Override base when docker.io is unreachable: build-arg NODE_IMAGE (see docker-compose.yml / .env.example).
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/

RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages/db ./packages/db

RUN pnpm --filter api build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY --from=build /app /app

EXPOSE 3000
# Inline shell: avoids CRLF in docker-entrypoint.sh on Windows build hosts breaking `set -e` (ash: illegal option -).
ENTRYPOINT ["/bin/sh", "-c", "cd /app && pnpm --filter db migrate && pnpm --filter db seed && exec node apps/api/dist/index.js"]
