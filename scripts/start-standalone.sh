#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f ".next/standalone/server.js" ]; then
  echo "Missing .next/standalone/server.js. Run: npm run build"
  exit 1
fi

mkdir -p ".next/standalone/.next"

if [ -d ".next/static" ]; then
  rm -rf ".next/standalone/.next/static"
  cp -R ".next/static" ".next/standalone/.next/static"
fi

if [ -d "public" ]; then
  rm -rf ".next/standalone/public"
  cp -R "public" ".next/standalone/public"
fi

exec env PORT="${PORT:-3000}" HOSTNAME="${HOSTNAME:-0.0.0.0}" node ".next/standalone/server.js"
