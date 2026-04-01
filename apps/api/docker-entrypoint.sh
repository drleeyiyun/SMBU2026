#!/bin/sh
# Kept for optional local use. The API Docker image uses an inlined ENTRYPOINT in Dockerfile
# so Windows CRLF in this file cannot break container startup (`set: illegal option -`).
set -e
cd /app
pnpm --filter db migrate
pnpm --filter db seed
exec node apps/api/dist/index.js
