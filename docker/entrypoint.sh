#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required"
  exit 1
fi

if [ -z "${CASINO_BOT_TOKEN:-}" ]; then
  echo "ERROR: CASINO_BOT_TOKEN is required"
  exit 1
fi

echo "Starting casino + admin bots on PORT=${PORT:-3000}…"
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
