# No `# syntax=docker/dockerfile:1` — avoids BuildKit pulling that image from Docker Hub (often blocked or slow on some networks).
# Override bases when docker.io is unreachable: NODE_IMAGE / NGINX_IMAGE (see docker-compose.yml / .env.example).
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY apps/web ./apps/web

# Empty VITE_API_URL → same-origin; nginx proxies API paths to backend
ENV VITE_API_URL=
RUN pnpm --filter web build

ARG NGINX_IMAGE=nginx:1.27-alpine
FROM ${NGINX_IMAGE}
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
