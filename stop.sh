#!/data/data/com.termux/files/usr/bin/sh
cd "$(dirname "$0")"
ROOT_DIR="$(pwd)"

select_node_path() {
  if command -v node >/dev/null 2>&1; then return 0; fi
  for NODE_DIR in \
    "$HOME/.local/bin" \
    "$HOME/.local/opt/node-current/bin" \
    "/opt/terma-test-toolchain/current/bin" \
    "$HOME/.volta/bin" \
    "/opt/homebrew/bin" \
    "/usr/local/bin" \
    "$HOME"/.local/opt/node-v*/bin \
    "$HOME"/.local/node-v*/bin \
    "$HOME"/.nvm/versions/node/v*/bin \
    /opt/node-v*/bin \
    /usr/local/lib/nodejs/node-v*/bin
  do
    [ -x "$NODE_DIR/node" ] || continue
    PATH="$NODE_DIR:$PATH"
    export PATH
    return 0
  done
  return 1
}

resolve_runtime_dir() {
  MODE="$1"
  RUNTIME_DIR=""
  if select_node_path; then
    if [ "$MODE" = "desktop" ]; then
      RUNTIME_DIR="$(node scripts/source-runtime-path.js --desktop-data-dir 2>/dev/null || true)"
    else
      RUNTIME_DIR="$(node scripts/source-runtime-path.js --web-data-dir 2>/dev/null || true)"
    fi
  fi
  [ -n "$RUNTIME_DIR" ] || RUNTIME_DIR="$ROOT_DIR/data"
  printf '%s' "$RUNTIME_DIR"
}

DESKTOP_DATA_DIR="$(resolve_runtime_dir desktop)"
WEB_DATA_DIR="$(resolve_runtime_dir web)"
PROJECT_DATA_DIR="$ROOT_DIR/data"

process_command() {
  ps -p "$1" -o command= 2>/dev/null || true
}

source_process() {
  PROCESS_COMMAND="$1"
  printf '%s' "$PROCESS_COMMAND" | grep -Fq "$ROOT_DIR/dist/server.js" && return 0
  printf '%s' "$PROCESS_COMMAND" | grep -Fq "$ROOT_DIR/node_modules/electron" && return 0
  return 1
}

looks_like_terma() {
  printf '%s' "$1" | grep -Eiq '(terma|tunneldesk|dist/server\.js|electron)'
}

wait_for_exit() {
  WAIT_PID="$1"
  WAIT_COUNT=0
  while [ "$WAIT_COUNT" -lt 10 ]; do
    kill -0 "$WAIT_PID" 2>/dev/null || return 0
    WAIT_COUNT=$((WAIT_COUNT + 1))
    sleep 1
  done
  return 1
}

request_shutdown() {
  SHUTDOWN_URL="$1"
  [ -n "$SHUTDOWN_URL" ] || return 1
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 5 -X POST "${SHUTDOWN_URL%/}/api/shutdown" >/dev/null 2>&1
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 5 --method=POST -O /dev/null "${SHUTDOWN_URL%/}/api/shutdown" >/dev/null 2>&1
  elif select_node_path; then
    node -e "fetch(process.argv[1] + '/api/shutdown', {method:'POST'}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "${SHUTDOWN_URL%/}"
  else
    return 1
  fi
}

cleanup_runtime_files() {
  DATA_DIRECTORY="$1"
  rm -f "$DATA_DIRECTORY/web.pid" "$DATA_DIRECTORY/web.url" "$DATA_DIRECTORY/web.json"
}

stop_runtime() {
  DATA_DIRECTORY="$1"
  [ -n "$DATA_DIRECTORY" ] || return 0
  case "|$SEEN_DIRS|" in *"|$DATA_DIRECTORY|"*) return 0 ;; esac
  SEEN_DIRS="$SEEN_DIRS|$DATA_DIRECTORY"

  RUNTIME_PID_FILE="$DATA_DIRECTORY/web.pid"
  [ -f "$RUNTIME_PID_FILE" ] || return 0
  RUNTIME_PID="$(cat "$RUNTIME_PID_FILE" 2>/dev/null || true)"
  case "$RUNTIME_PID" in
    ''|*[!0-9]*) cleanup_runtime_files "$DATA_DIRECTORY"; return 0 ;;
  esac

  if ! kill -0 "$RUNTIME_PID" 2>/dev/null; then
    cleanup_runtime_files "$DATA_DIRECTORY"
    return 0
  fi

  PROCESS_COMMAND="$(process_command "$RUNTIME_PID")"
  if ! source_process "$PROCESS_COMMAND"; then
    if looks_like_terma "$PROCESS_COMMAND"; then
      echo "Skipped another Terma installation, pid=$RUNTIME_PID."
    else
      echo "Removed a stale Terma PID file that now belongs to pid=$RUNTIME_PID."
      cleanup_runtime_files "$DATA_DIRECTORY"
    fi
    return 0
  fi

  RUNTIME_URL="$(cat "$DATA_DIRECTORY/web.url" 2>/dev/null || true)"
  request_shutdown "$RUNTIME_URL" || true
  if ! wait_for_exit "$RUNTIME_PID"; then
    CURRENT_COMMAND="$(process_command "$RUNTIME_PID")"
    if source_process "$CURRENT_COMMAND"; then
      kill "$RUNTIME_PID" 2>/dev/null || true
      wait_for_exit "$RUNTIME_PID" || true
    fi
  fi
  cleanup_runtime_files "$DATA_DIRECTORY"
  STOPPED_COUNT=$((STOPPED_COUNT + 1))
  echo "Stopped Terma source process, pid=$RUNTIME_PID."
}

SEEN_DIRS=""
STOPPED_COUNT=0
if [ -n "$1" ]; then
  stop_runtime "$(dirname "$1")"
else
  stop_runtime "$DESKTOP_DATA_DIR"
  stop_runtime "$WEB_DATA_DIR"
  stop_runtime "$PROJECT_DATA_DIR"
fi

if command -v pgrep >/dev/null 2>&1; then
  for PATTERN in "$ROOT_DIR/dist/server.js" "$ROOT_DIR/node_modules/electron"; do
    for RUNTIME_PID in $(pgrep -f "$PATTERN" 2>/dev/null); do
      [ "$RUNTIME_PID" = "$$" ] && continue
      PROCESS_COMMAND="$(process_command "$RUNTIME_PID")"
      source_process "$PROCESS_COMMAND" || continue
      kill "$RUNTIME_PID" 2>/dev/null || true
    done
  done
fi

if [ "$STOPPED_COUNT" -eq 0 ]; then
  echo "No running Terma source process was found."
fi
