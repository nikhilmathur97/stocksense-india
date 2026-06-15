#!/bin/bash
# StockSense India — One-command local startup
# Usage: ./scripts/start.sh

set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)

echo "🚀 Starting StockSense India..."

# ── Infrastructure ────────────────────────────────────────────────────────────
brew services start redis 2>/dev/null || true
brew services start postgresql@16 2>/dev/null || true
sleep 1

# ── Kill any old processes ────────────────────────────────────────────────────
[ -f logs/backend.pid ]  && kill -9 "$(cat logs/backend.pid)"  2>/dev/null || true
[ -f logs/frontend.pid ] && kill -9 "$(cat logs/frontend.pid)" 2>/dev/null || true
[ -f logs/watchdog.pid ] && kill -9 "$(cat logs/watchdog.pid)" 2>/dev/null || true
lsof -ti :8000 | xargs kill -9 2>/dev/null || true
lsof -ti :3001 | xargs kill -9 2>/dev/null || true
mkdir -p logs

# ── Backend start function ────────────────────────────────────────────────────
start_backend() {
  DATABASE_URL="postgresql+asyncpg://$(whoami)@localhost:5432/stockdb" \
  PYTHONPATH="$ROOT" \
  nohup "$ROOT/venv/bin/python" -m uvicorn backend.main:app \
    --host 0.0.0.0 --port 8000 --reload \
    >> logs/backend.log 2>&1 &
  echo $! > logs/backend.pid
}

# ── Backend ───────────────────────────────────────────────────────────────────
echo "▶  Starting backend on :8000..."
start_backend

# ── Frontend ──────────────────────────────────────────────────────────────────
echo "▶  Starting frontend on :3001..."
cd frontend
NEXT_PUBLIC_API_URL=http://localhost:8000 \
NEXT_PUBLIC_WS_URL=ws://localhost:8000 \
nohup npm run dev -- --port 3001 \
  > "$ROOT/logs/frontend.log" 2>&1 &
echo $! > "$ROOT/logs/frontend.pid"
cd ..

# ── Wait for ready ────────────────────────────────────────────────────────────
echo "⏳ Waiting for services..."
for i in $(seq 1 20); do
  if curl -s http://localhost:8000/health >/dev/null 2>&1; then break; fi
  sleep 1
done

# ── Backend Watchdog (auto-restart on crash) ──────────────────────────────────
echo "▶  Starting backend watchdog..."
(
  while true; do
    sleep 15
    if ! curl -s http://localhost:8000/health >/dev/null 2>&1; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] Backend down — restarting..." >> "$ROOT/logs/backend.log"
      # Kill stale process if any
      [ -f "$ROOT/logs/backend.pid" ] && kill -9 "$(cat "$ROOT/logs/backend.pid")" 2>/dev/null || true
      lsof -ti :8000 | xargs kill -9 2>/dev/null || true
      sleep 2
      cd "$ROOT"
      DATABASE_URL="postgresql+asyncpg://$(whoami)@localhost:5432/stockdb" \
      PYTHONPATH="$ROOT" \
      nohup "$ROOT/venv/bin/python" -m uvicorn backend.main:app \
        --host 0.0.0.0 --port 8000 --reload \
        >> "$ROOT/logs/backend.log" 2>&1 &
      echo $! > "$ROOT/logs/backend.pid"
      echo "$(date '+%Y-%m-%d %H:%M:%S') [WATCHDOG] Backend restarted (PID $!)" >> "$ROOT/logs/backend.log"
    fi
  done
) &
echo $! > logs/watchdog.pid

echo ""
echo "✅ StockSense India is running!"
echo ""
echo "  Dashboard   →  http://localhost:3001"
echo "  AI Screener →  http://localhost:3001/screener"
echo "  Options     →  http://localhost:3001/options"
echo "  Backend API →  http://localhost:8000/docs"
echo ""
echo "  Logs: tail -f logs/backend.log  |  tail -f logs/frontend.log"
echo "  Stop: kill \$(cat logs/backend.pid) \$(cat logs/frontend.pid) \$(cat logs/watchdog.pid)"
