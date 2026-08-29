#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="connxn.ui"
HOST="${HOST:-127.0.0.1}"
START_PORT="${PORT:-4173}"
PORT="$START_PORT"

clear
echo "Starting $APP_NAME..."
echo "Project: $SCRIPT_DIR"

# Best-effort cleanup for macOS quarantine attributes. This cannot bypass the
# very first Gatekeeper prompt if macOS blocks the script before it runs.
if command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$SCRIPT_DIR" "$0" >/dev/null 2>&1 || true
fi
chmod +x "$0" >/dev/null 2>&1 || true

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node.js was not found. Install Node.js 20+ first:"
  echo "https://nodejs.org/"
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo ""
  echo "npm was not found. Reinstall Node.js 20+ from:"
  echo "https://nodejs.org/"
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

port_is_busy() {
  nc -z "$HOST" "$1" >/dev/null 2>&1
}

while port_is_busy "$PORT"; do
  PORT=$((PORT + 1))
done

URL="http://$HOST:$PORT"
echo "Opening $URL"
echo ""
echo "Keep this Terminal window open while using $APP_NAME."
echo "Close it or press Ctrl+C to stop the server."
echo ""

PORT="$PORT" npm run start &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

for _ in {1..80}; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 || true
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.25
done

echo ""
echo "Server did not become ready. Last URL tried: $URL"
echo "Check the log above for details."
wait "$SERVER_PID"
