# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
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

FROM node:22-alpine AS runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY --from=build /app /app
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
# Use /bin/sh explicitly so CRLF in the script on Windows build hosts does not break the shebang.
ENTRYPOINT ["/bin/sh", "/usr/local/bin/docker-entrypoint.sh"]
