#!/usr/bin/env bash
# Fresh-clone smoke test (PLAN Phase 9, criterion 9.1).
# `npm ci && npm run build` must succeed; `npm run dev` must then serve / with
# HTTP 200 within 30 s and print no error output. Offline fixture mode, so no
# network is needed after `npm ci`. Usage: bash scripts/smoke.sh  (from the repo root)
set -euo pipefail
PORT="${GR_SMOKE_PORT:-3131}"
LOG="$(mktemp)"
DB="$(mktemp -d)/smoke.db"

npm ci
npm run build

GR_OFFLINE_FIXTURES=1 GR_DB_PATH="$DB" NEXT_TELEMETRY_DISABLED=1 setsid npm run dev -- -p "$PORT" -H 127.0.0.1 >"$LOG" 2>&1 &
PID=$!
cleanup() { kill -- -"$PID" 2>/dev/null || true; }
trap cleanup EXIT

code=000
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)"
  [ "$code" = 200 ] && break
  sleep 1
done
cat "$LOG"
if [ "$code" != 200 ]; then
  echo "smoke: FAIL: / answered $code within 30 s" >&2
  exit 1
fi
if grep -Eiq '(^|[^a-z])(error|unhandled|failed to compile)' "$LOG"; then
  echo "smoke: FAIL: error output from npm run dev" >&2
  exit 1
fi
echo "smoke: OK (/ answered 200)"
