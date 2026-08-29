const TERMINAL_SESSION_MODES = new Set(["none", "persistent"]);
const TERMINAL_SESSION_BACKENDS = new Set(["auto", "tmux", "screen"]);
const TERMINAL_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TERMINAL_SESSION_FILTERED_SEQUENCES = [
  "\x1b[?1049h",
  "\x1b[?1049l",
  "\x1b[?1047h",
  "\x1b[?1047l",
  "\x1b[?47h",
  "\x1b[?47l",
  "\x1b[3J"
];
const TERMINAL_SESSION_FILTERED_BUFFERS = TERMINAL_SESSION_FILTERED_SEQUENCES.map(value => Buffer.from(value, "ascii"));

function posixQuote(value: unknown): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function normalizeTerminalSession(value: any = {}) {
  const mode = TERMINAL_SESSION_MODES.has(String(value?.terminal_session_mode || "").trim().toLowerCase())
    ? String(value.terminal_session_mode).trim().toLowerCase()
    : "none";
  const backend = TERMINAL_SESSION_BACKENDS.has(String(value?.terminal_session_backend || "").trim().toLowerCase())
    ? String(value.terminal_session_backend).trim().toLowerCase()
    : "auto";
  const id = String(value?.terminal_session_id || "").trim();
  if (mode === "persistent" && !TERMINAL_SESSION_ID_PATTERN.test(id)) {
    throw new Error("可恢复终端会话 ID 无效");
  }
  if (mode !== "persistent") return {
    terminal_session_mode: "none",
    terminal_session_backend: "auto",
    terminal_session_id: ""
  };
  return {
    terminal_session_mode: "persistent",
    terminal_session_backend: backend,
    terminal_session_id: id
  };
}

function terminalSessionName(value: unknown): string {
  const id = String(value || "").trim();
  if (!TERMINAL_SESSION_ID_PATTERN.test(id)) throw new Error("可恢复终端会话 ID 无效");
  return `terma-${id}`;
}

function persistentSessionRequested(connection: any): boolean {
  return String(connection?.terminal_session_mode || "none") === "persistent"
    && Boolean(String(connection?.terminal_session_id || "").trim());
}

function terminalSessionStringCarryLength(value: string): number {
  const longest = Math.max(...TERMINAL_SESSION_FILTERED_SEQUENCES.map(item => item.length));
  for (let length = Math.min(value.length, longest - 1); length > 0; length -= 1) {
    const suffix = value.slice(-length);
    if (TERMINAL_SESSION_FILTERED_SEQUENCES.some(item => item.startsWith(suffix))) return length;
  }
  return 0;
}

function terminalSessionBufferCarryLength(value: Buffer): number {
  const longest = Math.max(...TERMINAL_SESSION_FILTERED_BUFFERS.map(item => item.length));
  for (let length = Math.min(value.length, longest - 1); length > 0; length -= 1) {
    const suffix = value.subarray(value.length - length);
    if (TERMINAL_SESSION_FILTERED_BUFFERS.some(item => item.subarray(0, length).equals(suffix))) return length;
  }
  return 0;
}

function filterTerminalSessionOutput(state: any, data: string | Buffer): string | Buffer {
  if (typeof data === "string") {
    const carry = typeof state?.terminalSessionOutputFilterCarry === "string" ? state.terminalSessionOutputFilterCarry : "";
    let value = carry + data;
    for (const sequence of TERMINAL_SESSION_FILTERED_SEQUENCES) value = value.split(sequence).join("");
    const carryLength = terminalSessionStringCarryLength(value);
    if (state) state.terminalSessionOutputFilterCarry = carryLength ? value.slice(-carryLength) : "";
    return carryLength ? value.slice(0, -carryLength) : value;
  }
  const source = Buffer.isBuffer(data) ? data : Buffer.from(data || "");
  const carry = Buffer.isBuffer(state?.terminalSessionOutputFilterCarry) ? state.terminalSessionOutputFilterCarry : Buffer.alloc(0);
  const value = carry.length ? Buffer.concat([carry, source]) : source;
  const output: number[] = [];
  for (let index = 0; index < value.length;) {
    const matched = TERMINAL_SESSION_FILTERED_BUFFERS.find(sequence => value.subarray(index, index + sequence.length).equals(sequence));
    if (matched) {
      index += matched.length;
      continue;
    }
    output.push(value[index]);
    index += 1;
  }
  let filtered = Buffer.from(output);
  const carryLength = terminalSessionBufferCarryLength(filtered);
  if (state) state.terminalSessionOutputFilterCarry = carryLength ? filtered.subarray(filtered.length - carryLength) : Buffer.alloc(0);
  if (carryLength) filtered = filtered.subarray(0, filtered.length - carryLength);
  return filtered;
}

function tmuxCommand(connection: any, startupCommand: string, name: string): string {
  const replayLines = Math.max(100, Math.min(10000, Math.floor(Number(connection?.terminal_session_replay_lines || 2000) || 2000)));
  const replay = connection?.terminal_session_replay === false || String(connection?.terminal_session_replay || "") === "0"
    ? ""
    : `if tmux has-session -t ${posixQuote(name)} 2>/dev/null; then terma_history=$(tmux display-message -p -t ${posixQuote(name)} '#{history_size}' 2>/dev/null || printf 0); case "$terma_history" in ''|*[!0-9]*) terma_history=0;; esac; [ "$terma_history" -gt ${replayLines} ] && terma_history=${replayLines}; if [ "$terma_history" -gt 0 ]; then tmux capture-pane -p -J -S "-$terma_history" -E -1 -t ${posixQuote(name)} 2>/dev/null | while IFS= read -r terma_line; do printf '%s\\r\\n' "$terma_line"; done; fi; fi; `;
  const base = String(startupCommand || "").trim();
  const create = base
    ? `tmux new-session -d -s ${posixQuote(name)} -- sh -lc ${posixQuote(base)}`
    : `tmux new-session -d -s ${posixQuote(name)}`;
  // A tmux status bar reserves a scrolling region and can make xterm's normal
  // scrollback appear empty. Keep the Terma-managed pane as a plain terminal;
  // the application provides its own session controls and wheel scrolling.
  const configure = `tmux set-option -t ${posixQuote(name)} status off 2>/dev/null || true; tmux set-option -t ${posixQuote(name)} mouse off 2>/dev/null || true; `;
  const attach = `tmux attach-session -t ${posixQuote(name)}`;
  return `if tmux has-session -t ${posixQuote(name)} 2>/dev/null; then ${configure}${replay}${attach}; else ${create}; ${configure}${attach}; fi`;
}

function screenCommand(connection: any, startupCommand: string, name: string): string {
  const replayLines = Math.max(100, Math.min(10000, Math.floor(Number(connection?.terminal_session_replay_lines || 2000) || 2000)));
  const replay = connection?.terminal_session_replay === false || String(connection?.terminal_session_replay || "") === "0"
    ? ""
    : `terma_screen_dump=$(mktemp "\${TMPDIR:-/tmp}/terma-screen.XXXXXX") || exit 1; screen -S ${posixQuote(name)} -X hardcopy -h "$terma_screen_dump" 2>/dev/null || true; if [ -s "$terma_screen_dump" ]; then while IFS= read -r terma_line || [ -n "$terma_line" ]; do printf '%s\\r\\n' "$terma_line"; done < "$terma_screen_dump"; fi; rm -f "$terma_screen_dump"; `;
  const base = String(startupCommand || "").trim() || `exec "${"${SHELL:-/bin/sh}"}" -il`;
  const sessionCheck = `screen -ls 2>/dev/null | grep -Fq ${posixQuote(`.${name}`)}`;
  return `if ${sessionCheck}; then ${replay}screen -xRR ${posixQuote(name)}; else screen -h ${replayLines} -dmS ${posixQuote(name)} sh -lc ${posixQuote(base)}; screen -xRR ${posixQuote(name)}; fi`;
}

function buildTerminalSessionCommand(connection: any, startupCommand = ""): string {
  if (!persistentSessionRequested(connection)) return String(startupCommand || "").trim();
  const config = normalizeTerminalSession(connection);
  const name = terminalSessionName(config.terminal_session_id);
  const tmux = tmuxCommand(connection, startupCommand, name);
  const screen = screenCommand(connection, startupCommand, name);
  if (config.terminal_session_backend === "tmux") return tmux;
  if (config.terminal_session_backend === "screen") return screen;
  return `if command -v tmux >/dev/null 2>&1; then ${tmux}; elif command -v screen >/dev/null 2>&1; then ${screen}; else printf '%s\\n' 'Terma recoverable sessions require tmux or screen; install one from Terminal settings.' >&2; exit 127; fi`;
}

function terminalSessionTerminateCommand(value: any = {}) {
  const config = normalizeTerminalSession({
    terminal_session_mode: "persistent",
    terminal_session_backend: value?.terminal_session_backend,
    terminal_session_id: value?.terminal_session_id
  });
  const name = terminalSessionName(config.terminal_session_id);
  if (config.terminal_session_backend === "screen") return `screen -S ${posixQuote(name)} -X quit`;
  if (config.terminal_session_backend === "tmux") return `tmux kill-session -t ${posixQuote(name)} 2>/dev/null || true`;
  return `if command -v tmux >/dev/null 2>&1; then tmux kill-session -t ${posixQuote(name)} 2>/dev/null || true; fi; if command -v screen >/dev/null 2>&1; then screen -S ${posixQuote(name)} -X quit 2>/dev/null || true; fi`;
}

module.exports = {
  TERMINAL_SESSION_ID_PATTERN,
  buildTerminalSessionCommand,
  filterTerminalSessionOutput,
  normalizeTerminalSession,
  persistentSessionRequested,
  terminalSessionName,
  terminalSessionTerminateCommand
};
