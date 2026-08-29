const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readFrontendDomain } = require("./frontend-source");

const {
  buildTerminalSessionCommand,
  filterTerminalSessionOutput,
  normalizeTerminalSession,
  terminalSessionTerminateCommand
} = require("../dist/terminal-session");
const { parseTerminalSessionComponentDetection } = require("../dist/services/terminal-session-management-service");

const persistent = {
  terminal_session_mode:"persistent",
  terminal_session_backend:"tmux",
  terminal_session_id:"work-main_1"
};
assert.deepEqual(normalizeTerminalSession(persistent), persistent);
assert.throws(() => normalizeTerminalSession({...persistent, terminal_session_id:"bad id; rm -rf"}), /会话 ID 无效/);
const command = buildTerminalSessionCommand(persistent, "cd -- '/srv/app' && exec '/bin/zsh' -l");
assert.match(command, /tmux has-session/);
assert.match(command, /display-message -p/);
assert.match(command, /capture-pane -p -J -S "-\$terma_history" -E -1/);
assert.doesNotMatch(command, /capture-pane -e -p -S -2000/, "tmux reconnect should replay history only, not duplicate the visible pane");
assert.match(command, /new-session -d -s 'terma-work-main_1'/);
assert.match(command, /set-option -t 'terma-work-main_1' status off/);
assert.match(command, /set-option -t 'terma-work-main_1' mouse off/);
assert.match(command, /attach-session -t 'terma-work-main_1'/);
assert.match(command, /sh -lc/);
assert.match(terminalSessionTerminateCommand(persistent), /tmux kill-session -t 'terma-work-main_1'/);
assert.throws(() => terminalSessionTerminateCommand({...persistent, terminal_session_id:"x'"}), /会话 ID 无效/);
const screenCommand = buildTerminalSessionCommand({...persistent, terminal_session_backend:"screen", terminal_session_replay_lines:3200}, "exec /bin/sh -il");
assert.match(screenCommand, /hardcopy -h/);
assert.match(screenCommand, /screen -h 3200 -dmS 'terma-work-main_1'/);
assert.match(screenCommand, /rm -f \"\$terma_screen_dump\"/);
const screenHotReconnectCommand = buildTerminalSessionCommand({...persistent, terminal_session_backend:"screen", terminal_session_replay:false}, "exec /bin/sh -il");
assert.doesNotMatch(screenHotReconnectCommand, /hardcopy -h/);

const outputFilter = {};
assert.equal(filterTerminalSessionOutput(outputFilter, Buffer.from("before\x1b[?10")).toString(), "before");
assert.equal(filterTerminalSessionOutput(outputFilter, Buffer.from("49hafter\x1b[3J")).toString(), "after");
assert.equal(filterTerminalSessionOutput(outputFilter, "one\x1b[?1049htwo\x1b[?1049lthree"), "onetwothree");

const detected = parseTerminalSessionComponentDetection([
  "TERMA_SESSION_PLATFORM=linux",
  "TERMA_SESSION_PACKAGE_MANAGER=apt",
  "TERMA_SESSION_ROOT=false",
  "TERMA_SESSION_TMUX_INSTALLED=true",
  "TERMA_SESSION_TMUX_VERSION=tmux 3.4",
  "TERMA_SESSION_TMUX_ACTIVE=3",
  "TERMA_SESSION_TMUX_TERMA_ACTIVE=2",
  "TERMA_SESSION_SCREEN_INSTALLED=false",
  "TERMA_SESSION_SCREEN_VERSION="
].join("\n"), {id:7,name:"test",ssh_host:"example.test",ssh_user:"root"});
assert.equal(detected.components.tmux.installed, true);
assert.equal(detected.components.tmux.active_sessions, 3);
assert.equal(detected.components.tmux.terma_active_sessions, 2);
assert.equal(detected.components.screen.installed, false);
assert.equal(detected.components.screen.install_plan.online.available, true);
assert.equal(detected.components.screen.install_plan.offline.available, true);
assert.equal(detected.components.screen.install_plan.local_offline.available, true);
assert.equal(detected.components.tmux.uninstall_plan.available, true);

const terminalSource = readFrontendDomain(path.join(__dirname, ".."), "terminal");
const terminalServerSource = fs.readFileSync(path.join(__dirname, "..", "src", "terminal.ts"), "utf8");
const dockingSource = fs.readFileSync(path.join(__dirname, "..", "public", "app-docking.js"), "utf8");
const productivitySource = fs.readFileSync(path.join(__dirname, "..", "public", "app-terminal-productivity.js"), "utf8");
const terminalCss = fs.readFileSync(path.join(__dirname, "..", "public", "app.css"), "utf8");
const terminalZh = fs.readFileSync(path.join(__dirname, "..", "public", "locales", "zh-CN", "terminal.json"), "utf8");
const terminalEn = fs.readFileSync(path.join(__dirname, "..", "public", "locales", "en-US", "terminal.json"), "utf8");
assert.match(terminalSource, /if \(!enabled\) return terminateTerminalPersistence\(key\);/, "disabling persistence must explicitly terminate the remote session");
assert.match(terminalSource, /enableTerminalPersistentWheelScroll/, "persistent terminals must keep an explicit wheel-scroll path");
assert.match(terminalSource, /terminal-persistent/, "persistent terminals must mark their mount for dedicated scroll styling");
assert.match(terminalSource, /shellModeBadge/, "every terminal must render a shell mode status badge");
assert.match(terminalSource, /shell_\$\{shellMode\}/, "shell mode status must use translated mode-specific text");
assert.match(terminalZh, /"shell_normal"\s*:\s*"普通 Shell"/, "Chinese resources must expose a normal-shell status");
assert.match(terminalZh, /"shell_persistent"\s*:\s*"保活 Shell"/, "Chinese resources must expose a persistent-shell status");
assert.match(terminalEn, /"shell_normal"\s*:\s*"Normal Shell"/, "English resources must expose a normal-shell status");
assert.match(terminalEn, /"shell_persistent"\s*:\s*"Persistent Shell"/, "English resources must expose a persistent-shell status");
assert.match(terminalSource, /badge\.className = .*terminal-session-badge/, "shell mode status must refresh when persistence changes");
assert.match(terminalSource, /terminal-session-button[^`]*icon\("archive-restore"\)/, "persistent-session toolbar must use a dedicated restore-session icon");
assert.match(terminalSource, /button\.innerHTML = `\$\{icon\("archive-restore"\)\}/, "session toolbar refresh must keep the dedicated restore-session icon");
assert.match(terminalCss, /terminal-box\.terminal-persistent[^{]*\.xterm-scrollable-element[^{]*\.scrollbar\.vertical/, "persistent terminals must keep the xterm scrollbar visible");
assert.match(terminalCss, /terminal-session-badge\.normal/, "normal shell status must use a distinct neutral style");
assert.match(terminalCss, /terminal-session-badge\.persistent/, "persistent shell status must use a distinct accent style");
assert.match(terminalCss, /\.terminal-actions \.terminal-session-button \{ box-sizing:border-box; gap:0; overflow:hidden; \}/, "compact persistent-session control must contain its icon");
assert.match(terminalCss, /terminal-session-button > svg:last-child \{ display:none; \}/, "compact persistent-session control must hide the redundant menu arrow");
assert.match(dockingSource, /persistent_tab_one/, "closing a persistent tab must explain that the remote session continues");
assert.match(dockingSource, /recoverable_session_continues/, "mixed tab-close confirmation must identify persistent sessions");
assert.match(dockingSource, /terminate_persistent_close/, "persistent tab close must offer remote-session termination");
assert.match(dockingSource, /choice === "terminate"/, "persistent tab close must terminate before removing the tab");
assert.match(productivitySource, /openTerminalSessionManager/, "global recoverable-session manager must be available");
assert.match(productivitySource, /removeClosedRecoverableTerminalRecord/, "restoring or terminating a closed session must update recovery history");
assert.match(terminalServerSource, /detachedTerminalSessions/, "regular terminals must have a server-side detached-session registry");
assert.match(terminalServerSource, /TERMINAL_RECONNECT_GRACE_MS = 5 \* 60 \* 1000/, "regular terminal reconnects must use a bounded grace period");
assert.match(terminalServerSource, /TERMINAL_RECONNECT_OUTPUT_LIMIT = 1024 \* 1024/, "detached terminal output must have a bounded memory limit");
assert.match(terminalServerSource, /TERMINAL_RECONNECT_TOKEN_PATTERN/, "reconnect credentials must be validated server-side");
assert.match(terminalServerSource, /terminal-detach/, "explicit terminal close must be distinguishable from an unexpected socket close");
assert.match(terminalServerSource, /session\.terminalClosing = true/, "explicit terminal close must not recreate a reconnect tombstone from a late process-exit event");
assert.match(terminalServerSource, /if \(session\.terminalClosing\) return;/, "late PTY/SSH exit events must not revive an explicitly closed terminal");
assert.match(terminalServerSource, /terminal-session.*reconnected/, "regular terminal reattach must emit an explicit state marker");
assert.match(terminalSource, /terminalReconnectTokenForKey/, "regular terminals must keep a reload-scoped reconnect credential");
assert.match(terminalSource, /scheduleTerminalAutoReconnect/, "regular terminals must retry short-lived disconnects automatically");
assert.match(terminalSource, /prepareTerminalSessionClose/, "explicit terminal close must cancel automatic reconnect");
assert.match(terminalSource, /terminal:system\.reconnect_expired/, "replaced regular sessions must be visible to the user");
assert.match(terminalZh, /"reconnecting"\s*:\s*"重连中"/, "Chinese terminal state must expose reconnecting");
assert.match(terminalEn, /"reconnecting"\s*:\s*"Reconnecting"/, "English terminal state must expose reconnecting");
console.log("终端可恢复会话检查通过：安全命名、历史回放命令、组件管理和标签分离语义");
