#!/usr/bin/env bash
# ==============================================================================
# RescueOS — Emergency Command Line Control Utility (Linux)
# "Boot. Connect. Rescue."
# ==============================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$DIR/backend"
PID_FILE="$BACKEND_DIR/rescueos.pid"
LOG_FILE="$BACKEND_DIR/rescueos.log"

case "$1" in
  start)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "⚠️  RescueOS is already running (PID: $(cat "$PID_FILE"))"
      exit 0
    fi
    echo "🚨 Booting RescueOS Emergency Station..."
    cd "$BACKEND_DIR"
    nohup node server.js > "$LOG_FILE" 2>&1 &
    PID=$!
    echo "$PID" > "$PID_FILE"
    sleep 1
    if kill -0 "$PID" 2>/dev/null; then
      echo "✅ RescueOS started successfully (PID: $PID)"
      echo "📡 Access at: http://localhost:8080"
      echo "📋 Logs: $LOG_FILE"
    else
      echo "❌ Failed to start RescueOS. Check $LOG_FILE"
      exit 1
    fi
    ;;

  stop)
    if [ -f "$PID_FILE" ]; then
      PID="$(cat "$PID_FILE")"
      echo "🛑 Stopping RescueOS (PID: $PID)..."
      kill "$PID" 2>/dev/null || true
      rm -f "$PID_FILE"
      echo "✅ RescueOS stopped."
    else
      # Fallback: check for any node server.js running in backend
      PIDS=$(pgrep -f "node.*server.js" || true)
      if [ -n "$PIDS" ]; then
        echo "🛑 Terminating RescueOS node processes: $PIDS"
        kill $PIDS 2>/dev/null || true
        echo "✅ RescueOS stopped."
      else
        echo "ℹ️  RescueOS is not currently running."
      fi
    fi
    ;;

  restart)
    $0 stop
    sleep 2
    $0 start
    ;;

  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      PID="$(cat "$PID_FILE")"
      echo "✅ RescueOS is ACTIVE and RUNNING (PID: $PID)"
      echo "📡 Local: http://localhost:8080"
      if command -v curl >/dev/null 2>&1; then
        echo "📊 State Check: $(curl -s http://127.0.0.1:8080/api/network | grep -o '\"activeClients\":[0-9]*')"
      fi
    else
      echo "⭕ RescueOS is STOPPED / OFFLINE"
      exit 1
    fi
    ;;

  logs)
    tail -f "$LOG_FILE"
    ;;

  test)
    echo "🧪 Running RescueOS test suite..."
    cd "$BACKEND_DIR"
    node tests/api.test.js
    ;;

  *)
    echo "Usage: $0 {start|stop|restart|status|logs|test}"
    exit 1
    ;;
esac
