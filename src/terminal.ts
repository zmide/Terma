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
const { consumeTerminalStartupTicket, inferredStartupPlatform, mergeTerminalStartup } = require("./terminal-startup");
const { filterTerminalSessionOutput, normalizeTerminalSession, persistentSessionRequested } = require("./terminal-session");
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
const detachedTerminalSessions = new Map<string, any>();
const TERMINAL_RECONNECT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;
const TERMINAL_RECONNECT_GRACE_MS = 5 * 60 * 1000;
const TERMINAL_RECONNECT_OUTPUT_LIMIT = 1024 * 1024;
const TERMINAL_ENCODINGS = new Set(["utf8", "gb18030", "gbk", "big5", "shift_jis", "euc-kr", "latin1"]);

function normalizeTerminalLanguage(value) {
  return String(value || "") === "en-US" ? "en-US" : "zh-CN";
}

function terminalUiText(language, chinese, english) {
  return normalizeTerminalLanguage(language) === "en-US" ? english : chinese;
}

function terminalSessionText(session, chinese, english) {
  return terminalUiText(session?.language, chinese, english);
}

function syncTerminalOutputFlow(session) {
  const paused = Boolean(session?.outputClientPaused || session?.outputSocketBackpressured);
  session?.outputSources?.forEach(source => {
    try {
      if (paused) source.pause?.();
      else source.resume?.();
    } catch {}
  });
}

function setTerminalOutputFlow(session, paused) {
  if (!session) return;
  session.outputClientPaused = Boolean(paused);
  syncTerminalOutputFlow(session);
}

function registerTerminalOutputSources(session, sources) {
  if (!session) return;
  session.outputSources = [...new Set((sources || []).filter(Boolean))];
  syncTerminalOutputFlow(session);
}

function terminalClosureReason(language, reason, fallbackChinese, fallbackEnglish) {
  const source = String(reason || "").trim();
  if (!source || source === fallbackChinese) return terminalUiText(language, fallbackChinese, fallbackEnglish);
  if (source === "Web 会话已退出") return terminalUiText(language, source, "The web session signed out");
  return source;
}

function releaseTerminalSession(session, options: any = {}) {
  sessions.delete(session);
  const token = String(session?.reconnectToken || "");
  if (session?.reconnectTimer) clearTimeout(session.reconnectTimer);
  session.reconnectTimer = null;
  if (token && options.retainReconnect && TERMINAL_RECONNECT_TOKEN_PATTERN.test(token)) {
    session.terminalEnded = true;
    session.reconnectExpiresAt = Date.now() + TERMINAL_RECONNECT_GRACE_MS;
    detachedTerminalSessions.set(token, session);
    session.reconnectTimer = setTimeout(() => {
      if (detachedTerminalSessions.get(token) !== session) return;
      detachedTerminalSessions.delete(token);
      session.reconnectExpiresAt = 0;
      session.reconnectTimer = null;
      session.reconnectToken = "";
    }, TERMINAL_RECONNECT_GRACE_MS);
    session.reconnectTimer.unref?.();
  } else if (token && detachedTerminalSessions.get(token) === session) {
    detachedTerminalSessions.delete(token);
  }
  if (session.desktopGrantExpiryTimer) clearTimeout(session.desktopGrantExpiryTimer);
  session.desktopGrantExpiryTimer = null;
}

function terminalSessionProcessActive(session) {
  if (!session) return false;
  if (session.ptyProcess) return !session.ptyProcess.killed && !session.ptyExited;
  if (session.child) return !session.child.killed && !session.childExited && session.child.exitCode === null;
  return !session.remotePtyExited && Boolean(session.ssh2Stream || session.ssh2Client || session.remotePty);
}

function clearTerminalReconnectTimer(session) {
  if (!session?.reconnectTimer) return;
  clearTimeout(session.reconnectTimer);
  session.reconnectTimer = null;
}

function detachedTerminalOutputBytes(value) {
  return Buffer.isBuffer(value) ? value.length : Buffer.byteLength(String(value || ""), "utf8");
}

function bufferDetachedTerminalOutput(session, data, opcode = 1) {
  if (!session || session.persistentSession || !session.reconnectToken) return;
  const value = Buffer.isBuffer(data) ? Buffer.from(data) : String(data || "");
  const bytes = detachedTerminalOutputBytes(value);
  if (!bytes) return;
  if (bytes > TERMINAL_RECONNECT_OUTPUT_LIMIT) {
    session.detachedOutput = [];
    session.detachedOutputBytes = 0;
    session.detachedOutputTruncated = true;
    return;
  }
  session.detachedOutput ||= [];
  session.detachedOutputBytes = Number(session.detachedOutputBytes || 0);
  while (session.detachedOutput.length && session.detachedOutputBytes + bytes > TERMINAL_RECONNECT_OUTPUT_LIMIT) {
    const removed = session.detachedOutput.shift();
    session.detachedOutputBytes = Math.max(0, session.detachedOutputBytes - Number(removed?.bytes || detachedTerminalOutputBytes(removed?.data)));
    session.detachedOutputTruncated = true;
  }
  session.detachedOutput.push({data:value, opcode, bytes});
  session.detachedOutputBytes += bytes;
}

function replayDetachedTerminalOutput(session, socket) {
  if (!session || !socket) return;
  if (session.detachedOutputTruncated) {
    sendWebSocketFrame(socket, terminalSessionText(session, "\r\n[连接中断期间的部分输出未保留]\r\n", "\r\n[Some output produced while disconnected was not retained]\r\n"));
  }
  for (const item of session.detachedOutput || []) sendWebSocketFrame(socket, item.data, item.opcode);
  session.detachedOutput = [];
  session.detachedOutputBytes = 0;
  session.detachedOutputTruncated = false;
}

function detachTerminalSession(session, socket) {
  if (!session || session.socket !== socket || !sessions.has(session)) return;
  if (session.persistentSession || session.explicitCloseRequested || !TERMINAL_RECONNECT_TOKEN_PATTERN.test(String(session.reconnectToken || "")) || !terminalSessionProcessActive(session)) {
    closeTerminalSession(session);
    return;
  }
  session.socket = null;
  session.detachedAt = Date.now();
  session.reconnectExpiresAt = session.detachedAt + TERMINAL_RECONNECT_GRACE_MS;
  session.outputClientPaused = false;
  session.outputSocketBackpressured = false;
  syncTerminalOutputFlow(session);
  clearTerminalReconnectTimer(session);
  detachedTerminalSessions.set(session.reconnectToken, session);
  session.reconnectTimer = setTimeout(() => {
    if (detachedTerminalSessions.get(session.reconnectToken) !== session) return;
    detachedTerminalSessions.delete(session.reconnectToken);
    session.reconnectExpiresAt = 0;
    closeTerminalSession(session);
  }, TERMINAL_RECONNECT_GRACE_MS);
  session.reconnectTimer.unref?.();
  appendSystemLog(`普通终端已暂时分离，等待重连：${session.reconnectToken.slice(0, 8)}`);
}

function terminalSessionConnectionMatches(session, connection) {
  if (!session || !connection) return false;
  return Number(session.connectionId || 0) === Number(connection.id || 0)
    && String(session.connectionHost || "") === String(connection.ssh_host || "")
    && Number(session.connectionPort || 22) === Number(connection.ssh_port || 22)
    && String(session.connectionUser || "") === String(connection.ssh_user || "")
    && Number(session.jumpConnectionId || 0) === Number(connection.jump_connection_id || 0);
}

function sendTerminalControl(socket, value) {
  if (!socket || !value) return false;
  return sendWebSocketFrame(socket, `\0TERMA:${JSON.stringify(value)}`);
}

function sendTerminalSessionEndedControl(session) {
  if (!session?.socket || !session.reconnectToken) return;
  sendTerminalControl(session.socket, {type:"terminal-session", state:"ended"});
}

function bindTerminalSocket(session, socket, connection, cols, rows, language, options: any = {}) {
  if (!session || !socket) return;
  clearTerminalReconnectTimer(session);
  if (session.reconnectToken) detachedTerminalSessions.delete(session.reconnectToken);
  session.reconnectExpiresAt = 0;
  if (!options.ended) session.terminalEnded = false;
  session.socket = socket;
  session.language = normalizeTerminalLanguage(language || session.language);
  session.outputClientPaused = false;
  session.outputSocketBackpressured = false;
  syncTerminalOutputFlow(session);
  socket.setNoDelay?.(true);
  socket.on("drain", () => {
    if (!sessions.has(session) || session.socket !== socket) return;
    session.outputSocketBackpressured = false;
    syncTerminalOutputFlow(session);
  });
  if (options.ended) {
    sendTerminalControl(socket, {type:"terminal-session", state:"ended"});
    replayDetachedTerminalOutput(session, socket);
    sendWebSocketFrame(socket, terminalSessionText(session, "[普通 Shell 已结束]\r\n", "[The regular shell has ended]\r\n"));
    closeWebSocket(socket);
    releaseTerminalSession(session);
    return;
  }
  if (options.reconnected) {
    sendTerminalControl(socket, {type:"terminal-session", state:"reconnected"});
    replayDetachedTerminalOutput(session, socket);
  } else if (session.reconnectToken) {
    sendTerminalControl(socket, {type:"terminal-session", state:"created"});
  }
  const endpoint = `${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}`;
  const startupProfile = connection.terminal_profile_name || connection.terminal_program_path;
  const startupLabel = connection.terminal_startup_mode === "program"
    ? terminalUiText(language, `，启动 ${startupProfile}`, `, starting ${startupProfile}`)
    : "";
  const ptyLabel = session.ptyProcess || session.remotePty ? terminalUiText(language, "（PTY）", " (PTY)") : "";
  const connectedMessage = options.reconnected
    ? terminalUiText(language, "[普通 Shell 连接已恢复，原进程继续运行]\r\n", "[Regular shell connection restored; the original process is still running]\r\n")
    : `${terminalUiText(language, `连接到 ${endpoint}`, `Connected to ${endpoint}`)}${ptyLabel}${startupLabel}\r\n`;
  sendWebSocketFrame(socket, connectedMessage);
  const parser = new WebSocketFrameParser({ maxFrameSize: 1024 * 1024, maxMessageSize: 2 * 1024 * 1024 });
  socket.on("data", (chunk) => {
    try {
      parser.push(chunk, (opcode, payload) => {
        if (opcode === 8) return closeTerminalSession(session);
        if (opcode === 9) return sendWebSocketFrame(socket, payload, 10);
        if (opcode === 1 || opcode === 2) writeTerminalInput(session, payload);
      });
    } catch (error) {
      sendWebSocketFrame(socket, `\r\n${terminalUiText(language, "WebSocket 错误", "WebSocket error")}: ${error.message}\r\n`);
      closeTerminalSession(session);
    }
  });
  socket.on("close", () => {
    if (session.socket !== socket) return;
    if (session.explicitCloseRequested) closeTerminalSession(session);
    else detachTerminalSession(session, socket);
  });
  socket.on("error", () => {
    if (session.socket !== socket) return;
    if (session.explicitCloseRequested) closeTerminalSession(session);
    else detachTerminalSession(session, socket);
  });
}

function scheduleDesktopGrantExpiry(session, expiresAtValue) {
  if (session.desktopGrantExpiryTimer) clearTimeout(session.desktopGrantExpiryTimer);
  session.desktopGrantExpiryTimer = null;
  const expiresAt = Number(expiresAtValue || 0);
  if (!expiresAt) return true;
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) {
    sendTerminalOutput(session, `\r\n${terminalSessionText(session, "[X11] 桌面集成授权已到期，本次 X11 终端已关闭。", "[X11] Desktop integration authorization expired. This X11 terminal has been closed.")}\r\n`);
    closeTerminalSession(session);
    return false;
  }
  session.desktopGrantExpiryTimer = setTimeout(() => {
    if (!sessions.has(session)) return;
    sendTerminalOutput(session, `\r\n${terminalSessionText(session, "[X11] 桌面集成授权已到期，本次 X11 终端已关闭。", "[X11] Desktop integration authorization expired. This X11 terminal has been closed.")}\r\n`);
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
  if (!TERMINAL_ENCODINGS.has(encoding)) throw new Error(terminalSessionText(session, "不支持的终端编码", "Unsupported terminal encoding"));
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
  let language = "zh-CN";
  try {
    const key = validateWebSocketUpgrade(req);
    const url = new URL(req.url, "http://terma.invalid");
    language = normalizeTerminalLanguage(url.searchParams.get("language"));
    const id = Number(url.searchParams.get("id"));
    const quickToken = url.searchParams.get("quick_token") || "";
    const reconnectToken = String(url.searchParams.get("reconnect_token") || "");
    if (reconnectToken && !TERMINAL_RECONNECT_TOKEN_PATTERN.test(reconnectToken)) {
      throw new Error(terminalUiText(language, "普通终端重连凭据无效", "The regular terminal reconnect credential is invalid"));
    }
    if (!id && !quickToken) throw new Error(terminalUiText(language, "缺少连接 ID 或快速连接凭据", "A connection ID or quick-connect credential is required"));
    const storedConnection = quickToken
      ? consumeQuickTerminalTicket(quickToken, options.requestBinding)
      : getConnection(id);
    if (quickToken && storedConnection.auth_type === "key") requireEncryptionUnlocked();
    const quickX11Mode = String(url.searchParams.get("x11_mode") || "off");
    if (quickToken) {
      if (!["off", "trusted", "untrusted"].includes(quickX11Mode)) throw new Error(terminalUiText(language, "快速连接的 X11 模式无效", "The quick-connect X11 mode is invalid"));
      storedConnection.x11_mode = quickX11Mode;
    } else if (url.searchParams.has("x11_mode")) {
      throw new Error(terminalUiText(language, "保存的连接不能通过快速连接参数覆盖 X11 模式", "A saved connection cannot override its X11 mode through quick-connect parameters"));
    }
    const startupToken = url.searchParams.get("startup_token") || "";
    if (quickToken && startupToken) throw new Error(terminalUiText(language, "快速连接不能使用已保存的终端启动配置", "Quick connect cannot use a saved terminal startup configuration"));
    const startupOverride = startupToken ? consumeTerminalStartupTicket(startupToken, id) : null;
    const connection = mergeTerminalStartup(storedConnection, startupOverride);
    if (quickToken && url.searchParams.get("session_mode")) {
      throw new Error(terminalUiText(language, "快速连接不能使用可恢复终端会话", "Quick connect cannot use a recoverable terminal session"));
    }
    const sessionConfig = normalizeTerminalSession({
      terminal_session_mode:url.searchParams.get("session_mode") || "none",
      terminal_session_backend:url.searchParams.get("session_backend") || "auto",
      terminal_session_id:url.searchParams.get("session_id") || ""
    });
    Object.assign(connection, sessionConfig);
    if (sessionConfig.terminal_session_mode === "persistent"
      && connection.terminal_startup_mode === "program"
      && inferredStartupPlatform(connection) === "windows") {
      throw new Error(terminalUiText(language, "Windows OpenSSH 暂不支持 tmux/screen 可恢复会话，请改用普通终端", "Recoverable tmux/screen sessions are not supported for Windows OpenSSH yet; use a regular terminal"));
    }
    connection.terminal_session_replay = url.searchParams.get("session_replay") !== "0";
    const replayLines = Number(url.searchParams.get("session_replay_lines") || 2000);
    connection.terminal_session_replay_lines = Number.isFinite(replayLines) ? Math.max(100, Math.min(10000, Math.floor(replayLines))) : 2000;
    const x11Mode = String(connection.x11_mode || "off");
    if (["trusted", "untrusted"].includes(x11Mode) && !options.x11Authorized) {
      throw new Error(terminalUiText(language, "当前浏览器没有 X11 桌面集成授权，请重新申请授权后再打开 X11 终端", "This browser is not authorized for X11 desktop integration. Request authorization again before opening an X11 terminal"));
    }
    const requestedEncoding = String(url.searchParams.get("encoding") || "").toLowerCase();
    if (requestedEncoding) {
      if (!TERMINAL_ENCODINGS.has(requestedEncoding)) throw new Error(terminalUiText(language, "不支持的终端编码", "Unsupported terminal encoding"));
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
    const persistent = persistentSessionRequested(connection);
    let session: any = null;
    let detached = !quickToken && !persistent && reconnectToken
      ? detachedTerminalSessions.get(reconnectToken)
      : null;
    if (detached) {
      if (detached.reconnectExpiresAt && detached.reconnectExpiresAt <= Date.now()) {
        closeTerminalSession(detached);
        detached = null;
      } else if (!terminalSessionConnectionMatches(detached, connection)) {
        throw new Error(terminalUiText(language, "普通终端重连凭据与当前连接不匹配", "The regular terminal reconnect credential does not match this connection"));
      } else {
        session = detached;
      }
    }
    if (!session) {
      session = startTerminalProcess(connection, socket, cols, rows, title, logId, language);
      session.connectionId = Number(connection.id || 0);
      session.connectionHost = String(connection.ssh_host || "");
      session.connectionPort = Number(connection.ssh_port || 22);
      session.connectionUser = String(connection.ssh_user || "");
      session.jumpConnectionId = Number(connection.jump_connection_id || 0);
      session.quickConnection = Boolean(quickToken);
      session.persistentSession = persistent;
      session.terminalSessionBackend = connection.terminal_session_backend;
      session.terminalSessionId = connection.terminal_session_id;
      session.x11Mode = x11Mode;
      session.reconnectToken = !quickToken && !persistent ? reconnectToken : "";
      sessions.add(session);
      bindDesktopBrowserGrant(session, options);
    }
    bindTerminalSocket(session, socket, connection, cols, rows, language, {reconnected:Boolean(detached && !detached.terminalEnded), ended:Boolean(detached?.terminalEnded)});
  } catch (error) {
    appendSystemLog(`终端 WebSocket 启动失败：${error.message}`);
    try {
      if (upgraded) {
        sendWebSocketFrame(socket, `\r\n${terminalUiText(language, "终端启动失败", "Terminal startup failed")}: ${error.message}\r\n`);
        closeWebSocket(socket, 1011, terminalUiText(language, "终端启动失败", "Terminal startup failed"));
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
  const output = session.persistentSession && !session.binaryMode
    ? filterTerminalSessionOutput(session, data)
    : data;
  if (!output?.length) return;
  if (!session.socket || session.socket.destroyed || session.socket.writableEnded || session.socket.writableDestroyed) {
    bufferDetachedTerminalOutput(session, output, opcode);
    return;
  }
  const accepted = sendWebSocketFrame(session.socket, output, opcode);
  if (!accepted && session.socket && !session.socket.destroyed) {
    session.outputSocketBackpressured = true;
    syncTerminalOutputFlow(session);
  }
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
  registerTerminalOutputSources(session, [child.stdout, child.stderr]);
  child.stdout.on("data", (chunk) => sendTerminalOutput(session, chunk));
  child.stderr.on("data", (chunk) => sendTerminalOutput(session, chunk));
  child.on("error", (error) => {
    appendSystemLog(`普通终端启动失败：${error.message}`);
    sendTerminalOutput(session, `\r\n${terminalSessionText(session, "终端启动失败", "Terminal startup failed")}: ${error.message}\r\n`);
  });
  child.on("exit", (code, signal) => {
    session.childExited = true;
    if (session.terminalClosing) return;
    const detail = signal
      ? terminalSessionText(session, `，信号 ${signal}`, `, signal ${signal}`)
      : terminalSessionText(session, `，退出码 ${code ?? ""}`, `, exit code ${code ?? ""}`);
    sendTerminalOutput(session, `\r\n${terminalSessionText(session, "SSH 会话已结束", "SSH session ended")}${detail}\r\n`);
    sendTerminalSessionEndedControl(session);
    releaseTerminalSession(session, {retainReconnect:!session.socket});
    if (session.socket) closeWebSocket(session.socket);
  });
  appendSystemLog(`终端已启动（普通）：${log.label}`);
  return session;
}

function startRemotePty(connection, socket, cols, rows, log, fallback = null, language = "zh-CN") {
  const encoding = String(connection.terminal_encoding || "utf8");
  const session: any = {
    socket,
    remotePty: true,
    ssh2Client: null,
    ssh2Stream: null,
    pendingInput: [],
    language:normalizeTerminalLanguage(language),
    logFile: log.fullPath,
    terminalEncoding: encoding,
    persistentSession:persistentSessionRequested(connection),
    terminalSessionBackend:String(connection.terminal_session_backend || "auto"),
    terminalSessionId:String(connection.terminal_session_id || ""),
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
    client.on("error", (error) => sendTerminalOutput(session, `\r\n${terminalSessionText(session, "SSH 连接错误", "SSH connection error")}: ${normalizeSshTransportError(error, connection).message}\r\n`));
    stream.on("data", (chunk) => sendTerminalOutput(session, chunk));
    stream.stderr?.on("data", (chunk) => sendTerminalOutput(session, chunk));
    registerTerminalOutputSources(session, [stream, stream.stderr]);
    stream.on("error", (error) => sendTerminalOutput(session, `\r\n${terminalSessionText(session, "终端错误", "Terminal error")}: ${normalizeSshTransportError(error, connection).message}\r\n`));
    stream.on("close", (code, signal) => {
      session.remotePtyExited = true;
      if (session.terminalClosing) return;
      const detail = signal
        ? terminalSessionText(session, `，信号 ${signal}`, `, signal ${signal}`)
        : terminalSessionText(session, `，退出码 ${code ?? ""}`, `, exit code ${code ?? ""}`);
      sendTerminalOutput(session, `\r\n${terminalSessionText(session, "SSH 会话已结束", "SSH session ended")}${detail}\r\n`);
      sendTerminalSessionEndedControl(session);
      releaseTerminalSession(session, {retainReconnect:!session.socket});
      try { client.end(); } catch {}
      if (session.socket) closeWebSocket(session.socket);
    });
    if (["trusted", "untrusted"].includes(String(connection.x11_mode || ""))) {
      const rawReason = String(x11Diagnostics?.reason || "");
      const normalizedReason = /Unable to request X11|X11 forwarding request failed|administratively prohibited/i.test(rawReason)
        ? terminalSessionText(session, "远端 SSH 服务未开启或拒绝了 X11 转发", "The remote SSH service has not enabled or has rejected X11 forwarding")
        : rawReason || terminalSessionText(session, "远端没有分配 DISPLAY", "The remote host did not assign DISPLAY");
      const x11Message = x11Diagnostics?.available
        // DISPLAY is the authoritative end-to-end signal here.  Some remote
        // login shells hide xauth from the probe even though sshd already
        // created the forwarding cookie and GUI applications work.
        ? `\r\n${terminalUiText(session.language, `[X11] 转发已建立：${x11Diagnostics.display}`, `[X11] Forwarding established: ${x11Diagnostics.display}`)}\r\n`
        : `\r\n${terminalSessionText(session,
          `[X11] 转发未建立：${normalizedReason}。本次已自动降级为普通 SSH 终端，命令行仍可正常使用；图形程序不会显示。请在 X Server 管理中检查 X11Forwarding 和远端 xauth/XQuartz。`,
          `[X11] Forwarding was not established: ${normalizedReason}. This session automatically fell back to a regular SSH terminal; command-line access still works, but graphical applications will not appear. Check X11Forwarding and remote xauth/XQuartz in X Server Management.`
        )}\r\n`;
      sendTerminalOutput(session, x11Message);
    }
    for (const pending of session.pendingInput.splice(0)) stream.write(pending);
    appendSystemLog(`终端已启动（内置 SSH PTY）：${log.label}`);
  }).catch((error) => {
    if (session.terminalClosing || !sessions.has(session)) return;
    session.remotePty = false;
    appendSystemLog(`内置 SSH PTY 启动失败：${error.message}`);
    if (fallback && sessions.has(session)) {
      sendTerminalOutput(session, `\r\n${terminalSessionText(session, "内置 SSH PTY 启动失败，已切换普通终端", "The built-in SSH PTY failed to start; switched to a regular terminal")}: ${error.message}\r\n`);
      for (const pending of session.pendingInput.splice(0)) fallback.input.push(pending);
      startPlainTerminal(session, connection, fallback.args, fallback.cwd, log);
      for (const pending of fallback.input) session.child?.stdin.write(pending);
      return;
    }
    sendTerminalOutput(session, `\r\n${terminalSessionText(session, "终端启动失败", "Terminal startup failed")}: ${error.message}\r\n`);
    releaseTerminalSession(session);
    closeWebSocket(socket);
  });
  return session;
}

function startTerminalProcess(connection, socket, cols, rows, title = "", logId = "", language = "zh-CN") {
  const log = createTerminalLog(connection, title, logId);
  if (shouldUseBuiltinSsh(connection)) {
    return startRemotePty(connection, socket, cols, rows, log, null, language);
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
      const session: any = { socket, ptyProcess, logFile: log.fullPath, language:normalizeTerminalLanguage(language), persistentSession:persistentSessionRequested(connection), terminalSessionBackend:String(connection.terminal_session_backend || "auto"), terminalSessionId:String(connection.terminal_session_id || "") };
      registerTerminalOutputSources(session, [ptyProcess]);
      setSessionEncoding(session, connection.terminal_encoding);
      ptyProcess.onData((data) => sendTerminalOutput(session, data));
      ptyProcess.onExit(({ exitCode, signal }) => {
        session.ptyExited = true;
        if (session.terminalClosing) return;
        const detail = signal
          ? terminalSessionText(session, `，信号 ${signal}`, `, signal ${signal}`)
          : terminalSessionText(session, `，退出码 ${exitCode ?? ""}`, `, exit code ${exitCode ?? ""}`);
        sendTerminalOutput(session, `\r\n${terminalSessionText(session, "SSH 会话已结束", "SSH session ended")}${detail}\r\n`);
        sendTerminalSessionEndedControl(session);
        releaseTerminalSession(session, {retainReconnect:!session.socket});
        if (session.socket) closeWebSocket(session.socket);
      });
      appendSystemLog(`终端已启动（PTY）：${log.label}`);
      return session;
    } catch (error) {
      appendSystemLog(`PTY 启动失败，已退回普通终端：${error.message}`);
      if (process.platform === "darwin") {
        sendWebSocketFrame(socket, `${terminalUiText(language, "PTY 启动失败，正在尝试内置 SSH PTY", "PTY startup failed; trying the built-in SSH PTY")}: ${error.message}\r\n`);
        return startRemotePty(connection, socket, cols, rows, log, { args, cwd, input: [] }, language);
      }
      sendWebSocketFrame(socket, `${terminalUiText(language, "PTY 启动失败，已自动切换普通终端", "PTY startup failed; automatically switched to a regular terminal")}: ${error.message}\r\n`);
    }
  } else if (process.platform === "darwin") {
    const reason = ptyLoadError || terminalUiText(language, "node-pty 未安装", "node-pty is not installed");
    sendWebSocketFrame(socket, `${terminalUiText(language, "PTY 组件不可用，正在尝试内置 SSH PTY", "The PTY component is unavailable; trying the built-in SSH PTY")}: ${reason}\r\n`);
    return startRemotePty(connection, socket, cols, rows, log, { args, cwd, input: [] }, language);
  }

  const session: any = { socket, child: null, logFile: log.fullPath, language:normalizeTerminalLanguage(language), persistentSession:persistentSessionRequested(connection), terminalSessionBackend:String(connection.terminal_session_backend || "auto"), terminalSessionId:String(connection.terminal_session_id || "") };
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
      if (message?.type === "terminal-output-flow") {
        setTerminalOutputFlow(session, message.paused === true);
        return;
      }
      if (message?.type === "terminal-detach") {
        session.explicitCloseRequested = true;
        closeTerminalSession(session);
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
  session.terminalClosing = true;
  const preserveRemoteSession = Boolean(session.persistentSession);
  releaseTerminalSession(session);
  if (!preserveRemoteSession) flushSessionOutputDecoder(session);
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
    const localizedReason = terminalClosureReason(session.language, reason, "桌面集成授权已撤销", "Desktop integration authorization was revoked");
    sendTerminalOutput(session, `\r\n${terminalSessionText(session, `[X11] ${localizedReason}，本次 X11 终端已关闭。`, `[X11] ${localizedReason}. This X11 terminal has been closed.`)}\r\n`);
    closeTerminalSession(session);
    closed += 1;
  }
  return closed;
}

function closeQuickConnectionTerminals(connectionId, reason = "临时连接已撤销") {
  const id = Number(connectionId);
  for (const session of [...sessions]) {
    if (!session.quickConnection || Number(session.connectionId) !== id) continue;
    const localizedReason = terminalClosureReason(session.language, reason, "临时连接已撤销", "The temporary connection was revoked");
    try { sendTerminalOutput(session, `\r\n[${localizedReason}]\r\n`); } catch {}
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
