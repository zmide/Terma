#!/data/data/com.termux/files/usr/bin/sh
cd "$(dirname "$0")"
ROOT_DIR="$(pwd)"

# Terma names its runtime toggles with TERMA_. Keep the old names as a
# one-release compatibility input for existing launch scripts.
TERMA_LAN="${TERMA_LAN:-${TUNNELDESK_LAN:-}}"
TERMA_WEB_ONLY="${TERMA_WEB_ONLY:-${TUNNELDESK_WEB_ONLY:-}}"
TERMA_NO_BROWSER="${TERMA_NO_BROWSER:-${TUNNELDESK_NO_BROWSER:-}}"
export TERMA_LAN TERMA_WEB_ONLY TERMA_NO_BROWSER

TERMUX_ANDROID_NDK_PATH=""
if [ "$(uname -o 2>/dev/null)" = "Android" ] && [ -n "$PREFIX" ]; then
  TERMUX_ANDROID_NDK_PATH="${npm_config_android_ndk_path:-$PREFIX}"
fi

node_runtime_ok() {
  "$1" --no-warnings "$ROOT_DIR/scripts/node-runtime-check.js" >/dev/null 2>&1
}

select_node_runtime() {
  CURRENT_NODE="$(command -v node 2>/dev/null || true)"
  if [ -n "$CURRENT_NODE" ] && node_runtime_ok "$CURRENT_NODE"; then
    return 0
  fi

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
    node_runtime_ok "$NODE_DIR/node" || continue
    PATH="$NODE_DIR:$PATH"
    export PATH
    echo "Using $(node -v) from $NODE_DIR."
    return 0
  done

  if [ -n "$CURRENT_NODE" ]; then
    "$CURRENT_NODE" --no-warnings "$ROOT_DIR/scripts/node-runtime-check.js" 2>&1 || true
  else
    echo "Terma requires Node.js 22 or newer, but node was not found."
  fi
  case "$(uname -s 2>/dev/null)" in
    Darwin) echo "Install Node.js 22+ with Homebrew or add an existing Node.js installation to PATH." ;;
    Linux) echo "Install Node.js 22+ from nodejs.org or your distribution's current Node.js repository." ;;
    *) echo "Install Node.js 22+ and run this script again." ;;
  esac
  return 1
}

select_node_runtime || exit 1

npm_install() {
  if [ -n "$TERMUX_ANDROID_NDK_PATH" ]; then
    npm_config_android_ndk_path="$TERMUX_ANDROID_NDK_PATH" npm install --include=dev --no-audit --no-fund
  else
    npm install --include=dev --no-audit --no-fund
  fi
}

has_gui() {
  [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ] || { [ "$(uname 2>/dev/null)" = "Darwin" ] && [ -z "$SSH_CONNECTION" ] && [ -z "$SSH_TTY" ]; }
}

is_windows_shell() {
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

pid_is_running() {
  PID_TO_CHECK="$1"
  if is_windows_shell && command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "try { Get-Process -Id $PID_TO_CHECK -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }" >/dev/null 2>&1
  else
    kill -0 "$PID_TO_CHECK" 2>/dev/null
  fi
}

process_command() {
  PID_TO_CHECK="$1"
  if is_windows_shell && command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "try { \$p=Get-CimInstance Win32_Process -Filter 'ProcessId=$PID_TO_CHECK' -ErrorAction Stop; Write-Output ((\$p.Name + ' ' + \$p.CommandLine).Trim()) } catch {}" 2>/dev/null
  else
    ps -p "$PID_TO_CHECK" -o command= 2>/dev/null || true
  fi
}

resolve_runtime_dir() {
  MODE="$1"
  if [ "$MODE" = "desktop" ]; then
    RUNTIME_DIR="$(node scripts/source-runtime-path.js --desktop-data-dir 2>/dev/null || true)"
  else
    RUNTIME_DIR="$(node scripts/source-runtime-path.js --web-data-dir 2>/dev/null || true)"
  fi
  [ -n "$RUNTIME_DIR" ] || RUNTIME_DIR="$ROOT_DIR/data"
  printf '%s' "$RUNTIME_DIR"
}

DESKTOP_DATA_DIR="$(resolve_runtime_dir desktop)"
WEB_DATA_DIR="$(resolve_runtime_dir web)"
PROJECT_DATA_DIR="$ROOT_DIR/data"

set_runtime_files() {
  RUNTIME_DATA_DIR="$1"
  URL_FILE="$RUNTIME_DATA_DIR/web.url"
  INFO_FILE="$RUNTIME_DATA_DIR/web.json"
  PID_FILE="$RUNTIME_DATA_DIR/web.pid"
  TOKEN_FILE="$RUNTIME_DATA_DIR/shutdown.token"
  STATUS_FILE="$RUNTIME_DATA_DIR/startup-status.json"
  mkdir -p "$RUNTIME_DATA_DIR" "$PROJECT_DATA_DIR"
}

print_runtime_urls() {
  INFO_TO_PRINT="$1"
  if [ -f "$INFO_TO_PRINT" ]; then
    node -e "try{const data=require('fs').readFileSync(process.argv[1],'utf8'); const urls=JSON.parse(data).lan_urls||[]; if(urls.length){ console.log('LAN access:'); for(const url of urls) console.log('  '+url)}}catch{}" "$INFO_TO_PRINT"
  fi
}

bring_existing_desktop_to_front() {
  [ "$TERMA_WEB_ONLY" = "1" ] && return 1
  has_gui || return 1
  [ -x node_modules/.bin/electron ] || return 1
  EXTRA_ARGS=""
  if [ "$(uname -s 2>/dev/null)" = "Linux" ] && [ "$(id -u 2>/dev/null)" = "0" ]; then
    EXTRA_ARGS="--no-sandbox"
  fi
  TERMA_DATA_DIR="$DESKTOP_DATA_DIR" node scripts/start-detached.js desktop $EXTRA_ARGS >/dev/null 2>&1
}

check_existing_instance() {
  SEEN_DIRS=""
  for DATA_CANDIDATE in "$@"; do
    [ -n "$DATA_CANDIDATE" ] || continue
    case "|$SEEN_DIRS|" in *"|$DATA_CANDIDATE|"*) continue ;; esac
    SEEN_DIRS="$SEEN_DIRS|$DATA_CANDIDATE"
    CANDIDATE_PID_FILE="$DATA_CANDIDATE/web.pid"
    [ -f "$CANDIDATE_PID_FILE" ] || continue
    EXISTING_PID="$(cat "$CANDIDATE_PID_FILE" 2>/dev/null || true)"
    case "$EXISTING_PID" in ''|*[!0-9]*) rm -f "$CANDIDATE_PID_FILE" "$DATA_CANDIDATE/web.url" "$DATA_CANDIDATE/web.json" "$DATA_CANDIDATE/shutdown.token" ;; *)
      if ! pid_is_running "$EXISTING_PID"; then
        rm -f "$DATA_CANDIDATE/web.pid" "$DATA_CANDIDATE/web.url" "$DATA_CANDIDATE/web.json" "$DATA_CANDIDATE/shutdown.token"
        continue
      fi
      PROCESS_COMMAND="$(process_command "$EXISTING_PID")"
      if [ -n "$PROCESS_COMMAND" ] && ! printf '%s' "$PROCESS_COMMAND" | grep -Fq "$ROOT_DIR"; then
        if printf '%s' "$PROCESS_COMMAND" | grep -Eiq '(terma|tunneldesk|dist/server\.js|electron)'; then
          echo "Another Terma installation is already using this runtime, pid=$EXISTING_PID."
          EXISTING_URL="$(cat "$DATA_CANDIDATE/web.url" 2>/dev/null || true)"
          [ -n "$EXISTING_URL" ] && echo "Open $EXISTING_URL"
          return 0
        fi
        echo "Ignoring a stale Terma PID file that now belongs to pid=$EXISTING_PID."
        rm -f "$DATA_CANDIDATE/web.pid" "$DATA_CANDIDATE/web.url" "$DATA_CANDIDATE/web.json" "$DATA_CANDIDATE/shutdown.token"
        continue
      fi
      echo "Terma is already running, pid=$EXISTING_PID"
      EXISTING_URL="$(cat "$DATA_CANDIDATE/web.url" 2>/dev/null || true)"
      [ -n "$EXISTING_URL" ] && echo "Open $EXISTING_URL"
      print_runtime_urls "$DATA_CANDIDATE/web.json"
      if printf '%s' "$PROCESS_COMMAND" | grep -Eiq '(electron|terma|tunneldesk)'; then
        if bring_existing_desktop_to_front; then
          echo "The existing desktop window has been brought to the foreground."
        else
          echo "The existing desktop process remains active; no second process was started."
        fi
      else
        echo "The existing Web service remains active; no second process was started."
      fi
      return 0
      ;;
    esac
  done
  return 1
}

if [ "$TERMA_WEB_ONLY" = "1" ]; then
  check_existing_instance "$WEB_DATA_DIR" "$PROJECT_DATA_DIR" && exit 0
else
  check_existing_instance "$DESKTOP_DATA_DIR" "$WEB_DATA_DIR" "$PROJECT_DATA_DIR" && exit 0
fi

if ! node scripts/dependency-state.js >/dev/null 2>&1; then
  echo "Dependencies changed or are incomplete. Running npm install..."
  npm_install || exit 1
  node scripts/dependency-state.js --write || exit 1
fi
if [ "$TERMA_WEB_ONLY" != "1" ] && [ ! -x node_modules/.bin/electron ]; then
  echo "Electron is not installed. Installing desktop dependencies..."
  npm_install || exit 1
  node scripts/dependency-state.js --write || exit 1
fi

echo "Building Terma..."
npm run build >/dev/null || exit 1

SERVER_ARGS="$*"
SHOW_LAN_URLS=""
parse_server_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --host)
        TUNNEL_WEB_HOST="$2"
        [ "$2" = "0.0.0.0" ] && SHOW_LAN_URLS=1
        shift 2
        ;;
      --port)
        TUNNEL_WEB_PORT="$2"
        shift 2
        ;;
      *) shift ;;
    esac
  done
  export TUNNEL_WEB_HOST TUNNEL_WEB_PORT
}
parse_server_args "$@"
case " $SERVER_ARGS " in
  *" --host 0.0.0.0 "*) SHOW_LAN_URLS=1 ;;
esac
if [ "$TERMA_LAN" = "1" ]; then
  SERVER_ARGS="--host 0.0.0.0 $SERVER_ARGS"
  TUNNEL_WEB_HOST="0.0.0.0"
  export TUNNEL_WEB_HOST
  SHOW_LAN_URLS=1
fi

open_url() {
  [ "$TERMA_NO_BROWSER" = "1" ] && return 0
  if command -v termux-open-url >/dev/null 2>&1; then termux-open-url "$1" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then open "$1" >/dev/null 2>&1 &
  fi
}

check_web_api() {
  API_URL="${1%/}/api/auth/status"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 "$API_URL" >/dev/null 2>&1 && { echo "Web API OK."; return 0; }
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 3 -O /dev/null "$API_URL" >/dev/null 2>&1 && { echo "Web API OK."; return 0; }
  else
    return 0
  fi
  echo "Web API health check warning: $API_URL is not ready yet."
  return 0
}

print_startup_diagnostics() {
  echo "Terma failed before the web URL became ready."
  for LOG_FILE in "$PROJECT_DATA_DIR/desktop-error.log" "$PROJECT_DATA_DIR/web.log" "$STATUS_FILE"; do
    [ -f "$LOG_FILE" ] || continue
    echo "--- $LOG_FILE ---"
    tail -n 80 "$LOG_FILE" 2>/dev/null || cat "$LOG_FILE"
  done
}

wait_for_url() {
  OPEN_BROWSER="$1"
  STARTED_PID="$2"
  WAIT_COUNT=0
  while [ "$WAIT_COUNT" -lt 60 ]; do
    if [ -f "$URL_FILE" ]; then
      WEB_URL="$(cat "$URL_FILE")"
      echo "Open $WEB_URL"
      check_web_api "$WEB_URL"
      print_runtime_urls "$INFO_FILE"
      [ "$OPEN_BROWSER" = "open_browser" ] && open_url "$WEB_URL"
      echo "Use ./stop.sh to stop Terma and SSH tunnels."
      return 0
    fi
    if [ "$WAIT_COUNT" -ge 1 ] && [ -n "$STARTED_PID" ] && ! pid_is_running "$STARTED_PID"; then
      print_startup_diagnostics
      return 1
    fi
    WAIT_COUNT=$((WAIT_COUNT + 1))
    sleep 1
  done
  echo "Terma started, but the web URL file is not ready yet."
  print_startup_diagnostics
  echo "The configured port may have moved automatically when it was occupied."
  echo "Use ./stop.sh to stop Terma and SSH tunnels."
  return 1
}

if [ "$1" = "--foreground" ]; then
  shift
  set_runtime_files "$WEB_DATA_DIR"
  rm -f "$URL_FILE" "$INFO_FILE" "$TOKEN_FILE"
  TERMA_DATA_DIR="$WEB_DATA_DIR" node dist/server.js "$@"
  exit $?
fi

electron_ready() {
  node -e "try{const fs=require('fs'); const electron=require('electron'); process.exit(typeof electron==='string' && fs.existsSync(electron) ? 0 : 1)}catch{process.exit(1)}" >/dev/null 2>&1
}

if [ "$TERMA_WEB_ONLY" != "1" ] && has_gui && [ -x node_modules/.bin/electron ]; then
  if ! electron_ready; then
    echo "Downloading Electron binary..."
    npx install-electron --no || true
    if ! electron_ready; then
      echo "Default Electron download failed. Trying mirror: https://npmmirror.com/mirrors/electron/"
      ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}" npx install-electron --no || true
    fi
  fi
  if electron_ready; then
    npm run native:build:if-needed || echo "Native SFTP drag build failed; desktop mode will use the available fallback."
    set_runtime_files "$DESKTOP_DATA_DIR"
    rm -f "$URL_FILE" "$INFO_FILE" "$TOKEN_FILE"
    DESKTOP_ARGS=""
    if [ "$(uname -s 2>/dev/null)" = "Linux" ] && [ "$(id -u 2>/dev/null)" = "0" ]; then
      DESKTOP_ARGS="--no-sandbox $DESKTOP_ARGS"
    fi
    if [ -n "$DESKTOP_ARGS" ]; then
      STARTED_PID="$(TERMA_DATA_DIR="$DESKTOP_DATA_DIR" TERMA_START_PRINT_PID=1 node scripts/start-detached.js desktop $DESKTOP_ARGS "$@")"
    else
      STARTED_PID="$(TERMA_DATA_DIR="$DESKTOP_DATA_DIR" TERMA_START_PRINT_PID=1 node scripts/start-detached.js desktop "$@")"
    fi
    if [ -n "$STARTED_PID" ]; then
      echo "Terma desktop is starting, pid=$STARTED_PID."
      echo "Mode: desktop. Logs: data/web.log and data/desktop-error.log"
      echo "Set TERMA_WEB_ONLY=1 to force background Web mode."
      wait_for_url "" "$STARTED_PID"
      exit $?
    fi
    echo "Electron failed to launch. Started Web mode instead."
  else
    echo "Electron binary download failed. Started Web mode instead."
  fi
fi

set_runtime_files "$WEB_DATA_DIR"
rm -f "$URL_FILE" "$INFO_FILE" "$TOKEN_FILE"
STARTED_PID="$(TERMA_DATA_DIR="$WEB_DATA_DIR" TERMA_START_PRINT_PID=1 node scripts/start-detached.js web "$@")"
if [ -z "$STARTED_PID" ]; then
  print_startup_diagnostics
  exit 1
fi

echo "Terma is starting in the background, pid=$STARTED_PID."
if [ "$TERMA_WEB_ONLY" = "1" ]; then
  echo "Mode: Web-only requested by TERMA_WEB_ONLY=1."
else
  echo "Mode: Web fallback or headless environment."
fi
echo "Web log: data/web.log"
wait_for_url open_browser "$STARTED_PID"
