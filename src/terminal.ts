const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const iconv = require("iconv-lite");
const { SSH_BIN } = require("./config");
const { getConnection } = require("./db");
const { buildTerminalCommand } = require("./ssh");
const { appendSystemLog, appendTerminalLog, createTerminalLog } = require("./logs");
const { normalizeSshTransportError, openSshShell, shouldUseBuiltinSsh } = require("./ssh2-client");
const { loadNodePty } = require("./pty-runtime");
const { WebSocketFrameParser, closeWebSocket, sendWebSocketFrame, validateWebSocketUpgrade, websocketAccept } = require("./websocket");
const { consumeTerminalStartupTicket, mergeTerminalStartup } = require("./terminal-startup");
const { consumeQuickTerminalTicket } = require("./quick-terminal");
const { requireEncryptionUnlocked } = require("./crypto-store");
const { terminalX11Environment } = require("./x11");

let pty = null;
let ptyLoadError = "";
try {
  pty = loadNodePty();
} catch (error) {
  ptyLoadError = error.message || String(error);
}

const sessions = new Set<any>();
const TERMINAL_ENCODINGS = new Set(["utf8", "gb18030", "gbk", "big5", "shift_jis", "euc-kr", "latin1"]);

function releaseTerminalSession(session) {
  sessions.delete(session);
  if (session.desktopGrantExpiryTimer) clearTimeout(session.desktopGrantExpiryTimer);
  session.desktopGrantExpiryTimer = null;
}

function scheduleDesktopGrantExpiry(session, expiresAtValue) {
  if (session.desktopGrantExpiryTimer) clearTimeout(session.desktopGrantExpiryTimer);
  session.desktopGrantExpiryTimer = null;
  const expiresAt = Number(expiresAtValue || 0);
  if (!expiresAt) return true;
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) {
    sendTerminalOutput(session, "\r\n[X11] 桌面集成授权已到期，本次 X11 终端已关闭。\r\n");
    closeTerminalSession(session);
    return false;
  }
  session.desktopGrantExpiryTimer = setTimeout(() => {
    if (!sessions.has(session)) return;
    sendTerminalOutput(session, "\r\n[X11] 桌面集成授权已到期，本次 X11 终端已关闭。\r\n");
    closeTerminalSession(session);
  }, remaining);
  session.desktopGrantExpiryTimer.unref?.();
  return true;
}

function bindDesktopBrowserGrant(session, authorization: any = {}) {
  const grantId = String(authorization.grantId || "").trim();
  if (!grantId || authorization.nativeDesktop || !["trusted", "untrusted"].includes(String(session.x11Mode || ""))) return;
  session.desktopBrowserGrantId = grantId;
  scheduleDesktopGrantExpiry(session, authorization.expiresAt);
}

function setSessionEncoding(session, value) {
  const encoding = String(value || "utf8").toLowerCase();
  if (!TERMINAL_ENCODINGS.has(encoding)) throw new Error("不支持的终端编码");
  flushSessionOutputDecoder(session);
  session.terminalEncoding = encoding;
  session.outputDecoder = session.binaryMode || encoding === "utf8" ? null : iconv.getDecoder(encoding);
}

function setSessionBinaryMode(session, enabled) {
  const next = Boolean(enabled);
  if (session.binaryMode === next) return;
  if (next) {
    flushSessionOutputDecoder(session);
    session.binaryMode = true;
    session.outputDecoder = null;
    return;
  }
  session.binaryMode = false;
  session.outputDecoder = session.terminalEncoding === "utf8"
    ? null
    : iconv.getDecoder(session.terminalEncoding);
}

let resolvedTerminalBin = "";

function resolveTerminalBin() {
  if (resolvedTerminalBin) return resolvedTerminalBin;
  if (path.isAbsolute(SSH_BIN)) return SSH_BIN;
  const command = process.platform === "win32" ? "where" : "which";
  const args = [SSH_BIN];
  const result = spawnSync(command, args, { encoding: "utf8" });
  const found = String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  resolvedTerminalBin = found || SSH_BIN;
  return resolvedTerminalBin;
}

function resolveTerminalCwd() {
  const candidates = [
    process.env.HOME,
    process.env.USERPROFILE,
    process.cwd()
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {}
  }
  return undefined;
}

function handleTerminalUpgrade(req, socket, options: any = {}) {
  let upgraded = false;
  try {
    const key = validateWebSocketUpgrade(req);
    const url = new URL(req.url, "http://terma.invalid");
    const id = Number(url.searchParams.get("id"));
    const quickToken = url.searchParams.get("quick_token") || "";
    if (!id && !quickToken) throw new Error("缺少连接 ID 或快速连接凭据");
    const storedConnection = quickToken
      ? consumeQuickTerminalTicket(quickToken, options.requestBinding)
      : getConnection(id);
    if (quickToken && storedConnection.auth_type === "key") requireEncryptionUnlocked();
    const quickX11Mode = String(url.searchParams.get("x11_mode") || "off");
    if (quickToken) {
      if (!["off", "trusted", "untrusted"].includes(quickX11Mode)) throw new Error("快速连接的 X11 模式无效");
      storedConnection.x11_mode = quickX11Mode;
    } else if (url.searchParams.has("x11_mode")) {
      throw new Error("保存的连接不能通过快速连接参数覆盖 X11 模式");
    }
    const startupToken = url.searchParams.get("startup_token") || "";
    if (quickToken && startupToken) throw new Error("快速连接不能使用已保存的终端启动配置");
    const startupOverride = startupToken ? consumeTerminalStartupTicket(startupToken, id) : null;
    const connection = mergeTerminalStartup(storedConnection, startupOverride);
    const x11Mode = String(connection.x11_mode || "off");
    if (["trusted", "untrusted"].includes(x11Mode) && !options.x11Authorized) {
      throw new Error("当前浏览器没有 X11 桌面集成授权，请重新申请授权后再打开 X11 终端");
    }
    const requestedEncoding = String(url.searchParams.get("encoding") || "").toLowerCase();
    if (requestedEncoding) {
      if (!TERMINAL_ENCODINGS.has(requestedEncoding)) throw new Error("不支持的终端编码");
      connection.terminal_encoding = requestedEncoding;
    }
    const accept = websocketAccept(key);
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      ""
    ].join("\r\n"));
    socket.setNoDelay?.(true);
    upgraded = true;

    const cols = Number(url.searchParams.get("cols") || 80);
    const rows = Number(url.searchParams.get("rows") || 24);
    const title = url.searchParams.get("title") || "";
    const logId = url.searchParams.get("log_id") || "";
    const session: any = startTerminalProcess(connection, socket, cols, rows, title, logId);
    session.connectionId = Number(connection.id || 0);
    session.quickConnection = Boolean(quickToken);
    session.x11Mode = x11Mode;
    sessions.add(session);
    bindDesktopBrowserGrant(session, options);
    const startupLabel = connection.terminal_startup_mode === "program"
      ? `，启动 ${connection.terminal_profile_name || connection.terminal_program_path}`
      : "";
    sendWebSocketFrame(socket, `连接到 ${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}${session.ptyProcess || session.remotePty ? "（PTY）" : ""}${startupLabel}\r\n`);

    const parser = new WebSocketFrameParser({ maxFrameSize: 1024 * 1024, maxMessageSize: 2 * 1024 * 1024 });
    socket.on("data", (chunk) => {
      try {
        parser.push(chunk, (opcode, payload) => {
          if (opcode === 8) return closeTerminalSession(session);
          if (opcode === 9) return sendWebSocketFrame(socket, payload, 10);
          if (opcode === 1 || opcode === 2) writeTerminalInput(session, payload);
        });
      } catch (error) {
        sendWebSocketFrame(socket, `\r\nWebSocket 错误：${error.message}\r\n`);
        closeTerminalSession(session);
      }
    });
    socket.on("close", () => closeTerminalSession(session));
    socket.on("error", () => closeTerminalSession(session));
  } catch (error) {
    appendSystemLog(`终端 WebSocket 启动失败：${error.message}`);
    try {
      if (upgraded) {
        sendWebSocketFrame(socket, `\r\n终端启动失败：${error.message}\r\n`);
        closeWebSocket(socket, 1011, "终端启动失败");
      } else {
        socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        socket.end(error.message);
      }
    } catch {}
  }
}

function terminalEnv() {
  const env: any = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.TERM = "xterm-256color";
  Object.assign(env, terminalX11Environment());
  return env;
}

function emitTerminalOutput(session, data, opcode = 1) {
  if (!session.binaryMode) appendTerminalLog(session.logFile, data);
  sendWebSocketFrame(session.socket, data, opcode);
}

function flushSessionOutputDecoder(session) {
  const decoder = session.outputDecoder;
  session.outputDecoder = null;
  if (!decoder) return;
  try {
    const trailing = decoder.end();
    if (trailing) emitTerminalOutput(session, trailing, 1);
  } catch {}
}

function sendTerminalOutput(session, data) {
  if (Buffer.isBuffer(data) && session.outputDecoder) {
    const decoded = session.outputDecoder.write(data);
    if (decoded) emitTerminalOutput(session, decoded, 1);
    return;
  }
  emitTerminalOutput(session, data, Buffer.isBuffer(data) ? 2 : 1);
}

function startPlainTerminal(session, connection, args, cwd, log) {
  const child = spawn(SSH_BIN, args, { stdio: ["pipe", "pipe", "pipe"], cwd, env:terminalEnv() });
  session.child = child;
  child.stdout.on("data", (chunk) => sendTerminalOutput(session, chunk));
  child.stderr.on("data", (chunk) => sendTerminalOutput(session, chunk));
  child.on("error", (error) => {
    appendSystemLog(`普通终端启动失败：${error.message}`);
    sendTerminalOutput(session, `\r\n终端启动失败：${error.message}\r\n`);
  });
  child.on("exit", (code, signal) => {
    sendTerminalOutput(session, `\r\nSSH 会话已结束${signal ? `，信号 ${signal}` : `，退出码 ${code ?? ""}`}\r\n`);
    releaseTerminalSession(session);
    closeWebSocket(session.socket);
  });
  appendSystemLog(`终端已启动（普通）：${log.label}`);
  return session;
}

function startRemotePty(connection, socket, cols, rows, log, fallback = null) {
  const encoding = String(connection.terminal_encoding || "utf8");
  const session: any = {
    socket,
    remotePty: true,
    ssh2Client: null,
    ssh2Stream: null,
    pendingInput: [],
    logFile: log.fullPath,
    terminalEncoding: encoding,
    outputDecoder: encoding === "utf8" ? null : iconv.getDecoder(encoding)
  };
  openSshShell(connection, { term: "xterm-256color", cols, rows }).then(({ client, stream, x11Diagnostics }: any) => {
    if (!sessions.has(session)) {
      try { stream.close(); } catch {}
      try { client.end(); } catch {}
      return;
    }
    session.ssh2Client = client;
    session.ssh2Stream = stream;
    session.x11Diagnostics = x11Diagnostics || null;
    client.on("error", (error) => sendTerminalOutput(session, `\r\nSSH 连接错误：${normalizeSshTransportError(error, connection).message}\r\n`));
    stream.on("data", (chunk) => sendTerminalOutput(session, chunk));
    stream.stderr?.on("data", (chunk) => sendTerminalOutput(session, chunk));
    stream.on("error", (error) => sendTerminalOutput(session, `\r\n终端错误：${normalizeSshTransportError(error, connection).message}\r\n`));
    stream.on("close", (code, signal) => {
      sendTerminalOutput(session, `\r\nSSH 会话已结束${signal ? `，信号 ${signal}` : `，退出码 ${code ?? ""}`}\r\n`);
      releaseTerminalSession(session);
      try { client.end(); } catch {}
      closeWebSocket(socket);
    });
    if (["trusted", "untrusted"].includes(String(connection.x11_mode || ""))) {
      const rawReason = String(x11Diagnostics?.reason || "");
      const normalizedReason = /Unable to request X11|X11 forwarding request failed|administratively prohibited/i.test(rawReason)
        ? "远端 SSH 服务未开启或拒绝了 X11 转发"
        : rawReason || "远端没有分配 DISPLAY";
      const x11Message = x11Diagnostics?.available
        // DISPLAY is the authoritative end-to-end signal here.  Some remote
        // login shells hide xauth from the probe even though sshd already
        // created the forwarding cookie and GUI applications work.
        ? `\r\n[X11] 转发已建立：${x11Diagnostics.display}\r\n`
        : `\r\n[X11] 转发未建立：${normalizedReason}。本次已自动降级为普通 SSH 终端，命令行仍可正常使用；图形程序不会显示。请在 X Server 管理中检查 X11Forwarding 和远端 xauth/XQuartz。\r\n`;
      sendTerminalOutput(session, x11Message);
    }
    for (const pending of session.pendingInput.splice(0)) stream.write(pending);
    appendSystemLog(`终端已启动（内置 SSH PTY）：${log.label}`);
  }).catch((error) => {
    session.remotePty = false;
    appendSystemLog(`内置 SSH PTY 启动失败：${error.message}`);
    if (fallback && sessions.has(session)) {
      sendTerminalOutput(session, `\r\n内置 SSH PTY 启动失败，已切换普通终端：${error.message}\r\n`);
      for (const pending of session.pendingInput.splice(0)) fallback.input.push(pending);
      startPlainTerminal(session, connection, fallback.args, fallback.cwd, log);
      for (const pending of fallback.input) session.child?.stdin.write(pending);
      return;
    }
    sendTerminalOutput(session, `\r\n终端启动失败：${error.message}\r\n`);
    releaseTerminalSession(session);
    closeWebSocket(socket);
  });
  return session;
}

function startTerminalProcess(connection, socket, cols, rows, title = "", logId = "") {
  const log = createTerminalLog(connection, title, logId);
  if (shouldUseBuiltinSsh(connection)) {
    return startRemotePty(connection, socket, cols, rows, log);
  }

  const args = buildTerminalCommand(connection);
  const cwd = resolveTerminalCwd();
  if (pty) {
    try {
      const ptyOptions: any = {
        name: "xterm-256color",
        cols: Math.max(2, cols || 80),
        rows: Math.max(1, rows || 24),
        env: terminalEnv(),
        encoding: null
      };
      if (cwd) ptyOptions.cwd = cwd;
      const ptyProcess = pty.spawn(resolveTerminalBin(), args, ptyOptions);
      const session: any = { socket, ptyProcess, logFile: log.fullPath };
      setSessionEncoding(session, connection.terminal_encoding);
      ptyProcess.onData((data) => sendTerminalOutput(session, data));
      ptyProcess.onExit(({ exitCode, signal }) => {
        sendTerminalOutput(session, `\r\nSSH 会话已结束${signal ? `，信号 ${signal}` : `，退出码 ${exitCode ?? ""}`}\r\n`);
        releaseTerminalSession(session);
        closeWebSocket(socket);
      });
      appendSystemLog(`终端已启动（PTY）：${log.label}`);
      return session;
    } catch (error) {
      appendSystemLog(`PTY 启动失败，已退回普通终端：${error.message}`);
      if (process.platform === "darwin") {
        sendWebSocketFrame(socket, `PTY 启动失败，正在尝试内置 SSH PTY：${error.message}\r\n`);
        return startRemotePty(connection, socket, cols, rows, log, { args, cwd, input: [] });
      }
      sendWebSocketFrame(socket, `PTY 启动失败，已自动切换普通终端：${error.message}\r\n`);
    }
  } else if (process.platform === "darwin") {
    sendWebSocketFrame(socket, `PTY 组件不可用，正在尝试内置 SSH PTY：${ptyLoadError || "node-pty 未安装"}\r\n`);
    return startRemotePty(connection, socket, cols, rows, log, { args, cwd, input: [] });
  }

  const session: any = { socket, child: null, logFile: log.fullPath };
  setSessionEncoding(session, connection.terminal_encoding);
  return startPlainTerminal(session, connection, args, cwd, log);
}

function writeTerminalInput(session, payload) {
  const text = payload.toString("utf8");
  if (text.startsWith("{")) {
    try {
      const message = JSON.parse(text);
      if (message?.type === "resize") {
        if (session.ptyProcess) session.ptyProcess.resize(Math.max(2, Number(message.cols) || 80), Math.max(1, Number(message.rows) || 24));
        else if (session.ssh2Stream?.setWindow) session.ssh2Stream.setWindow(Math.max(1, Number(message.rows) || 24), Math.max(2, Number(message.cols) || 80), 0, 0);
        return;
      }
      if (message?.type === "terminal-encoding") {
        setSessionEncoding(session, message.encoding);
        return;
      }
      if (message?.type === "terminal-binary-mode") {
        setSessionBinaryMode(session, message.enabled);
        return;
      }
    } catch {}
  }
  const outgoing = !session.binaryMode && session.terminalEncoding && session.terminalEncoding !== "utf8"
    ? iconv.encode(text, session.terminalEncoding)
    : payload;
  if (session.ptyProcess) session.ptyProcess.write(outgoing);
  else if (session.ssh2Stream) session.ssh2Stream.write(outgoing);
  else if (session.remotePty) session.pendingInput.push(Buffer.from(outgoing));
  else session.child?.stdin.write(outgoing);
}

function closeTerminalSession(session) {
  if (!sessions.has(session)) return;
  releaseTerminalSession(session);
  flushSessionOutputDecoder(session);
  try { session.ptyProcess?.kill(); } catch {}
  try { session.child?.kill(); } catch {}
  try { session.ssh2Stream?.close(); } catch {}
  try { session.ssh2Client?.end(); } catch {}
  try { session.socket.destroy(); } catch {}
}

function closeAllTerminals() {
  for (const session of [...sessions]) closeTerminalSession(session);
}

function closeDesktopBrowserGrantTerminals(grantId, reason = "桌面集成授权已撤销") {
  const requestedGrantId = String(grantId || "").trim();
  if (!requestedGrantId) return 0;
  let closed = 0;
  for (const session of [...sessions]) {
    if (session.desktopBrowserGrantId !== requestedGrantId) continue;
    sendTerminalOutput(session, `\r\n[X11] ${reason}，本次 X11 终端已关闭。\r\n`);
    closeTerminalSession(session);
    closed += 1;
  }
  return closed;
}

function closeQuickConnectionTerminals(connectionId, reason = "临时连接已撤销") {
  const id = Number(connectionId);
  for (const session of [...sessions]) {
    if (!session.quickConnection || Number(session.connectionId) !== id) continue;
    try { sendTerminalOutput(session, `\r\n[${reason}]\r\n`); } catch {}
    closeTerminalSession(session);
  }
}

function refreshDesktopBrowserGrantTerminals(grantId, expiresAt) {
  const requestedGrantId = String(grantId || "").trim();
  if (!requestedGrantId) return 0;
  let refreshed = 0;
  for (const session of [...sessions]) {
    if (session.desktopBrowserGrantId !== requestedGrantId) continue;
    if (scheduleDesktopGrantExpiry(session, expiresAt)) refreshed += 1;
  }
  return refreshed;
}

module.exports = {
  handleTerminalUpgrade,
  closeAllTerminals,
  closeDesktopBrowserGrantTerminals,
  closeQuickConnectionTerminals,
  refreshDesktopBrowserGrantTerminals
};
