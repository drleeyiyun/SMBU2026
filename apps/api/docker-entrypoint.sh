#!/bin/sh
set -e
cd /app
pnpm --filter db migrate
pnpm --filter db seed
exec node apps/api/dist/index.js
