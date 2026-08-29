const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const net = require("node:net");
const os = require("node:os");
const dns = require("node:dns").promises;
const { spawn, spawnSync } = require("node:child_process");
const { SSH_BIN, SSH_DIR, USER_SSH_DIR, LOG_DIR, DATA_DIR } = require("./config");
const { all, getConnection, getForward, run, now, pidRunning } = require("./db");
const { notifyIssue, notifyRecovery } = require("./notifications");
const {
  connectSsh,
  ensureConnectionHostTrusted,
  normalizeSshTransportError,
  runPasswordCommand,
  shouldUseBuiltinSsh,
  startPasswordForward,
  decodeSshOutput
} = require("./ssh2-client");
const { effectiveExtraArgs, splitArgs } = require("./ssh-command");
const { proxyJumpArgument, sshDestinationArgs, structuredOpenSshArgs } = require("./ssh-connection");
const { diagnoseSshError } = require("./ssh-diagnostics");
const { buildRemoteStartupCommand } = require("./terminal-startup");
const { buildTerminalSessionCommand } = require("./terminal-session");
const { isHostTrustError, systemHostKeyArgs } = require("./ssh-host-trust");
const { allowedIdentityPath, assertAllowedIdentityPath, looksLikePrivateKeyData } = require("./identity-path");
const { ensurePrivateDirectory, ensurePrivateFile } = require("./storage-permissions");
const { formatRemoteEndpoint } = require("./remote-host");

const RESTORE_STATE_FILE = path.join(DATA_DIR, "forward-state.json");
let healthMonitorTimer: any = null;
let healthMonitorBusy = false;
let healthMonitorTask: Promise<any> | null = null;
const ssh2Forwards = new Map();
const forwardOperations = new Map();
const persistentSshCommandSessions = new Map();
const PERSISTENT_SSH_COMMAND_IDLE_MS = 60 * 1000;
const PERSISTENT_SSH_COMMAND_OUTPUT_LIMIT = 60000;

function persistentSshCommandSessionKey(connection) {
  const id = Number(connection?.id || 0);
  return Number.isSafeInteger(id) && id !== 0
    ? `id:${id}`
    : `endpoint:${String(connection?.ssh_user || "")}@${String(connection?.ssh_host || "")}:${Number(connection?.ssh_port || 22)}`;
}

function persistentSshCommandFingerprint(connection) {
  let identityRevision = "";
  const identityFile = String(connection?.identity_file || "").trim();
  if (identityFile) {
    try {
      const stat = fs.statSync(identityFile);
      identityRevision = `${stat.size}:${stat.mtimeMs}`;
    } catch {}
  }
  return crypto.createHash("sha256").update(JSON.stringify([
    connection?.ssh_host,
    Number(connection?.ssh_port || 22),
    connection?.ssh_user,
    connection?.auth_type || "key",
    identityFile,
    identityRevision,
    connection?.ssh_password || "",
    connection?.private_key_passphrase || "",
    connection?.ssh_agent_mode || "auto",
    Number(connection?.jump_connection_id || 0),
    connection?.extra_args || "",
    Number(connection?.connect_timeout_seconds || 10),
    Number(connection?.keepalive_interval_seconds ?? 60),
    Number(connection?.keepalive_count_max || 3)
  ])).digest("hex");
}

function closePersistentSshCommandEntry(entry) {
  if (!entry || entry.closed) return;
  entry.closed = true;
  clearTimeout(entry.idleTimer);
  entry.idleTimer = null;
  try { entry.client?.end(); } catch {}
}

function invalidatePersistentSshCommandEntry(key, entry) {
  if (persistentSshCommandSessions.get(key) === entry) persistentSshCommandSessions.delete(key);
  closePersistentSshCommandEntry(entry);
}

function schedulePersistentSshCommandIdleClose(key, entry) {
  clearTimeout(entry.idleTimer);
  if (entry.closed || entry.active > 0) return;
  entry.idleTimer = setTimeout(() => invalidatePersistentSshCommandEntry(key, entry), PERSISTENT_SSH_COMMAND_IDLE_MS);
  entry.idleTimer.unref?.();
}

async function persistentSshCommandEntry(connection) {
  const key = persistentSshCommandSessionKey(connection);
  const fingerprint = persistentSshCommandFingerprint(connection);
  let entry: any = persistentSshCommandSessions.get(key);
  if (entry && (entry.closed || entry.fingerprint !== fingerprint)) {
    invalidatePersistentSshCommandEntry(key, entry);
    entry = null;
  }
  if (!entry) {
    entry = {
      key,
      fingerprint,
      client:null,
      promise:null,
      active:0,
      idleTimer:null,
      closed:false
    };
    entry.promise = connectSsh(connection).then((client) => {
      if (entry.closed || persistentSshCommandSessions.get(key) !== entry) {
        try { client.end(); } catch {}
        throw new Error("SSH 剪贴板会话已取消");
      }
      entry.client = client;
      entry.promise = null;
      const invalidate = () => invalidatePersistentSshCommandEntry(key, entry);
      client.once("close", invalidate);
      client.once("end", invalidate);
      schedulePersistentSshCommandIdleClose(key, entry);
      return client;
    }).catch((error) => {
      if (persistentSshCommandSessions.get(key) === entry) persistentSshCommandSessions.delete(key);
      entry.closed = true;
      entry.promise = null;
      throw error;
    });
    persistentSshCommandSessions.set(key, entry);
  }
  clearTimeout(entry.idleTimer);
  entry.idleTimer = null;
  const client = entry.client || await entry.promise;
  entry.active += 1;
  let released = false;
  return {
    client,
    release() {
      if (released) return;
      released = true;
      entry.active = Math.max(0, entry.active - 1);
      schedulePersistentSshCommandIdleClose(key, entry);
    },
    invalidate() {
      invalidatePersistentSshCommandEntry(key, entry);
    }
  };
}

function appendSshOutputTail(current, chunk) {
  const next = Buffer.concat([current, Buffer.from(chunk)]);
  return next.length > PERSISTENT_SSH_COMMAND_OUTPUT_LIMIT
    ? next.subarray(next.length - PERSISTENT_SSH_COMMAND_OUTPUT_LIMIT)
    : next;
}

function runPersistentSshClientCommand(client, connection, command, timeoutMs, onChunk = null, options: any = {}) {
  return new Promise((resolve) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let channel: any = null;
    let settled = false;
    const finish = (status, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status,
        stdout:decodeSshOutput(stdout, connection?.terminal_encoding),
        stderr:decodeSshOutput(stderr, connection?.terminal_encoding),
        error
      });
    };
    const timer = setTimeout(() => {
      try { channel?.close(); } catch {}
      finish(null, new Error("SSH command timed out"));
    }, timeoutMs);
    client.exec(String(command || ""), (error, openedChannel) => {
      if (error) return finish(null, normalizeSshTransportError(error, connection));
      channel = openedChannel;
      openedChannel.on("data", (chunk) => {
        stdout = appendSshOutputTail(stdout, chunk);
        onChunk?.(chunk, "stdout");
      });
      openedChannel.stderr?.on("data", (chunk) => {
        stderr = appendSshOutputTail(stderr, chunk);
        onChunk?.(chunk, "stderr");
      });
      openedChannel.on("error", (channelError) => finish(null, normalizeSshTransportError(channelError, connection)));
      openedChannel.once("close", (code) => finish(code));
      if (options.input !== undefined && options.input !== null) openedChannel.end(options.input);
      else openedChannel.end();
    });
  });
}

function persistentSshRetryable(error) {
  return /not connected|connection (?:closed|lost)|socket (?:closed|disconnected)|no existing session|econnreset/i.test(String(error?.message || error || ""));
}

async function runPersistentSshCommand(connection, command, timeoutMs = 60000, onChunk = null, options: any = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const lease: any = await persistentSshCommandEntry(connection);
    try {
      const result: any = await runPersistentSshClientCommand(lease.client, connection, command, timeoutMs, onChunk, options);
      if (isHostTrustError(result.error)) throw result.error;
      if (attempt === 0 && result.error && persistentSshRetryable(result.error)) {
        lease.invalidate();
        continue;
      }
      return result;
    } finally {
      lease.release();
    }
  }
  return {status:null, stdout:"", stderr:"", error:new Error("SSH 连接已断开")};
}

function closePersistentSshCommandSessions() {
  for (const entry of persistentSshCommandSessions.values()) closePersistentSshCommandEntry(entry);
  persistentSshCommandSessions.clear();
}

function forwardFailureDetails(message: unknown, fallbackCode = "ssh_failed", preserveMessage = true) {
  const raw = String(message || "").trim();
  const diagnosis = diagnoseSshError(raw || fallbackCode);
  return {
    raw:preserveMessage ? raw : "",
    code:preserveMessage && raw ? diagnosis.reason_code || fallbackCode : fallbackCode,
    display:diagnosis.display,
    diagnosis
  };
}

function saveForwardFailure(id: number, message: unknown, fallbackCode = "ssh_failed", preserveMessage = true) {
  const details = forwardFailureDetails(message, fallbackCode, preserveMessage);
  run("UPDATE connection_forwards SET status='failed', pid=NULL, last_error=?, last_error_code=?, updated_at=? WHERE id=?", [details.raw || null, details.code, now(), Number(id)]);
  return details;
}

function clearForwardFailure(id: number) {
  run("UPDATE connection_forwards SET last_error=NULL, last_error_code=NULL WHERE id=?", [Number(id)]);
}

function ensureSshDirs() {
  ensurePrivateDirectory(SSH_DIR, { required:true });
}

function samePath(left, right) {
  const a = path.resolve(String(left || ""));
  const b = path.resolve(String(right || ""));
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function projectManagedIdentity(file) {
  return samePath(path.dirname(path.resolve(String(file || ""))), SSH_DIR);
}

function windowsAclPrincipals(output, file) {
  const target = path.resolve(String(file || ""));
  return String(output || "").split(/\r?\n/).map((line) => {
    let acl = line.trim();
    if (!acl) return "";
    if (acl.toLowerCase().startsWith(target.toLowerCase())) acl = acl.slice(target.length).trim();
    const match = acl.match(/^(.+?):(?:\([^)]+\))+/);
    return match ? match[1].trim() : "";
  }).filter(Boolean);
}

function windowsAllowedAclPrincipals() {
  const username = String(process.env.USERNAME || "").trim();
  const domain = String(process.env.USERDOMAIN || "").trim();
  const account = username ? (domain ? `${domain}\\${username}` : username) : "";
  return new Set([
    account,
    username,
    "nt authority\\system",
    "builtin\\administrators",
    "s-1-5-18",
    "s-1-5-32-544",
    "*s-1-5-18",
    "*s-1-5-32-544"
  ].map(item => item.toLowerCase()).filter(Boolean));
}

function unexpectedWindowsAclPrincipals(principals) {
  const allowed = windowsAllowedAclPrincipals();
  return principals.filter(principal => !allowed.has(principal.toLowerCase()));
}

function securePrivateKeyPermissions(file) {
  const allowed = assertAllowedIdentityPath(String(file || ""));
  file = allowed;
  if (!projectManagedIdentity(file)) return identityPermissionStatus(file);
  ensurePrivateDirectory(SSH_DIR, { required:true });
  ensurePrivateFile(file, { required:true });
  const status = identityPermissionStatus(file);
  if (!status.ok) {
    const error: any = new Error(`Terma 管理的 SSH 私钥权限不安全：${status.details || file}`);
    error.code = "INSECURE_IDENTITY_PERMISSIONS";
    error.path = file;
    error.status = status;
    throw error;
  }
  return status;
}

function identityPermissionStatus(file) {
  const item: any = {
    path: file,
    label: path.basename(String(file || "")),
    exists: false,
    ok: false,
    platform: process.platform,
    details: "",
    issues: []
  };
  try {
    const allowed = allowedIdentityPath(String(file || ""));
    if (!allowed) {
      item.details = "该文件不在允许的密钥目录中，或不是普通私钥文件";
      item.issues.push("not-allowed");
      return item;
    }
    file = allowed;
    if (!file || !fs.existsSync(file)) {
      item.details = "私钥文件不存在";
      item.issues.push("missing");
      return item;
    }
    item.exists = true;
    if (process.platform !== "win32") {
      const mode = fs.statSync(file).mode & 0o777;
      item.mode = `0${mode.toString(8)}`;
      item.ok = (mode & 0o077) === 0;
      item.details = item.ok ? `权限正常（${item.mode}）` : `权限过宽（${item.mode}），建议修复为 0600`;
      if (!item.ok) item.issues.push("mode");
      return item;
    }
    const result = spawnSync("icacls", [file], { encoding: "utf8" });
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    if (result.error || result.status !== 0 || !output) {
      item.details = `无法读取 Windows ACL${result.status != null ? `（退出码 ${result.status}）` : ""}`;
      item.issues.push("acl-read");
      return item;
    }
    const principals = windowsAclPrincipals(output, file);
    const unexpected = unexpectedWindowsAclPrincipals(principals);
    item.ok = principals.length > 0 && unexpected.length === 0;
    item.details = item.ok
      ? "权限正常：仅当前用户、SYSTEM 或 Administrators 等受限账户可访问"
      : unexpected.length
        ? `权限过宽或包含未识别账户：${unexpected.join("、")}`
        : "无法识别 Windows ACL 权限主体";
    if (!item.ok) item.issues.push("acl");
    return item;
  } catch (error) {
    item.details = error.message;
    item.issues.push("error");
    return item;
  }
}

function repairIdentityFile(file) {
  file = assertAllowedIdentityPath(String(file || ""));
  if (!file || !fs.existsSync(file)) throw new Error("私钥文件不存在");
  if (projectManagedIdentity(file)) return securePrivateKeyPermissions(file);
  ensurePrivateFile(file, { required:true });
  const status = identityPermissionStatus(file);
  if (!status.ok) throw new Error(`SSH 私钥权限修复后仍不安全：${status.details || file}`);
  return status;
}

function listIdentityFiles() {
  ensureSshDirs();
  const result = [];
  const seen = new Set();
  const roots = [
    { path: SSH_DIR, source: "project", source_label: "当前密钥目录" },
    { path: USER_SSH_DIR, source: "user", source_label: "用户 ~/.ssh" }
  ];
  for (const rootInfo of roots) {
    const root = rootInfo.path;
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root).sort()) {
      const file = path.join(root, name);
      const resolved = allowedIdentityPath(file);
      if (!resolved) continue;
      if (rootInfo.source === "project") securePrivateKeyPermissions(resolved);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      const status = identityPermissionStatus(resolved);
      result.push({
        label: `${name} - ${rootInfo.source_label}`,
        name,
        path: resolved,
        source: rootInfo.source,
        source_label: rootInfo.source_label,
        permission_ok: status.ok,
        permission_details: status.details
      });
    }
  }
  return result;
}

function identityFileMap() {
  const map = new Map();
  for (const item of listIdentityFiles()) {
    const name = path.basename(item.path);
    if (!map.has(name)) map.set(name, item.path);
    if ([".pem", ".key", ".txt"].includes(path.extname(name).toLowerCase())) {
      const stem = path.basename(name, path.extname(name));
      if (!map.has(stem)) map.set(stem, item.path);
    }
  }
  return map;
}

function saveUploadedKey(filename, data) {
  ensureSshDirs();
  if (!data.length) throw new Error("上传文件为空");
  if (data.length > 1024 * 1024) throw new Error("私钥文件不能超过 1MB");
  const safe = path.basename(filename || "uploaded_key").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^[._]+|[._]+$/g, "") || "uploaded_key";
  if (safe.toLowerCase().endsWith(".pub")) throw new Error("请选择私钥文件，不要上传 .pub 公钥");
  if (!looksLikePrivateKeyData(safe, data)) throw new Error("文件看起来不是 SSH 私钥");
  let target = path.join(SSH_DIR, safe);
  const ext = path.extname(safe);
  const stem = path.basename(safe, ext);
  for (let i = 1; fs.existsSync(target); i += 1) target = path.join(SSH_DIR, `${stem}-${i}${ext}`);
  fs.writeFileSync(target, data, { mode: 0o600, flag: "wx" });
  try {
    target = assertAllowedIdentityPath(target);
    securePrivateKeyPermissions(target);
    return { label: path.basename(target), path: target, directory: SSH_DIR };
  } catch (error) {
    try { fs.rmSync(target, { force: true }); } catch {}
    throw error;
  }
}

function readRestoreState() {
  try {
    const data = JSON.parse(fs.readFileSync(RESTORE_STATE_FILE, "utf8"));
    return new Set((data.connection_ids || []).map((id) => Number(id)).filter(Boolean));
  } catch {
    return new Set();
  }
}

function writeRestoreState(ids) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RESTORE_STATE_FILE, JSON.stringify({ connection_ids: [...ids].sort((a, b) => a - b), updated_at: Date.now() }, null, 2));
}

function setRestoreConnection(connectionId, enabled) {
  const ids = readRestoreState();
  if (enabled) ids.add(Number(connectionId));
  else ids.delete(Number(connectionId));
  writeRestoreState(ids);
}

function restoreStateSummary() {
  const ids = readRestoreState();
  return { connection_ids: [...ids] };
}

function buildForwardCommand(connection, forward) {
  const args = ["-N", "-T", ...systemConnectionArgs(connection), "-o", "ExitOnForwardFailure=yes", "-p", String(connection.ssh_port)];
  if (connection.identity_file) {
    securePrivateKeyPermissions(connection.identity_file);
    args.push("-i", connection.identity_file);
  }
  args.push(...effectiveExtraArgs(connection.extra_args, connection));
  if (forward.mode === "local") args.push("-L", `${forward.bind_host}:${forward.bind_port}:${forward.target_host}:${forward.target_port}`);
  else if (forward.mode === "remote") args.push("-R", `${forward.bind_host}:${forward.bind_port}:${forward.target_host}:${forward.target_port}`);
  else args.push("-D", `${forward.bind_host}:${forward.bind_port}`);
  args.push(...sshDestinationArgs(connection));
  return args;
}

function appendForwardArgs(args, forward) {
  if (forward.mode === "local") args.push("-L", `${forward.bind_host}:${forward.bind_port}:${forward.target_host}:${forward.target_port}`);
  else if (forward.mode === "remote") args.push("-R", `${forward.bind_host}:${forward.bind_port}:${forward.target_host}:${forward.target_port}`);
  else args.push("-D", `${forward.bind_host}:${forward.bind_port}`);
}

function buildConnectionCommand(connection, forwards) {
  const args = ["-N", "-T", ...systemConnectionArgs(connection), "-o", "ExitOnForwardFailure=yes", "-p", String(connection.ssh_port)];
  if (connection.identity_file) {
    securePrivateKeyPermissions(connection.identity_file);
    args.push("-i", connection.identity_file);
  }
  args.push(...effectiveExtraArgs(connection.extra_args, connection));
  for (const forward of forwards) appendForwardArgs(args, forward);
  args.push(...sshDestinationArgs(connection));
  return args;
}

function forwardNotifyLabel(connection, forward) {
  const rule = forward.mode === "socks"
    ? `${forward.bind_host}:${forward.bind_port}`
    : `${forward.bind_host}:${forward.bind_port} -> ${forward.target_host}:${forward.target_port}`;
  return `${connection.name} / ${forward.service_name || rule}`;
}

function buildTerminalCommand(connection) {
  const interactivePassword = connection.auth_type === "password" && ["untrusted", "trusted"].includes(String(connection.x11_mode || "off"));
  const args = ["-tt", ...systemConnectionArgs(connection), "-o", `BatchMode=${interactivePassword ? "no" : "yes"}`, "-p", String(connection.ssh_port)];
  args.push("-o", "SendEnv=-*");
  const xauthLocation = process.env.TERMA_XAUTH || process.env.TUNNELDESK_XAUTH;
  if (["untrusted", "trusted"].includes(String(connection.x11_mode || "off")) && xauthLocation) {
    args.push("-o", `XAuthLocation=${xauthLocation}`);
  }
  if (connection.x11_mode === "trusted") args.push("-Y");
  else if (connection.x11_mode === "untrusted") args.push("-X");
  if (connection.identity_file) {
    securePrivateKeyPermissions(connection.identity_file);
    args.push("-i", connection.identity_file);
  }
  const startupCommand = buildRemoteStartupCommand(connection);
  const terminalCommand = buildTerminalSessionCommand(connection, startupCommand);
  if (terminalCommand) args.push("-o", "RemoteCommand=none");
  args.push(...effectiveExtraArgs(connection.extra_args, connection));
  args.push(...sshDestinationArgs(connection));
  if (terminalCommand) args.push(terminalCommand);
  return args;
}

function systemConnectionArgs(connection) {
  const jump = connection?.jump_connection_id ? getConnection(Number(connection.jump_connection_id)) : null;
  const args = [
    ...systemHostKeyArgs(connection, { additionalConnections:jump ? [jump] : [] }),
    ...structuredOpenSshArgs(connection)
  ];
  if (jump) args.push("-J", proxyJumpArgument(jump));
  return args;
}

function portAvailable(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(Number(port), host);
  });
}

function normalizeListenHost(host) {
  return ["0.0.0.0", "::", ""].includes(String(host || "")) ? "127.0.0.1" : String(host || "127.0.0.1");
}

function parseJsonOutput(text, fallback) {
  try {
    if (!String(text || "").trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function runProcess(command, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (status, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr, error });
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish(null, new Error("命令执行超时"));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout = `${stdout}${chunk.toString()}`.slice(-12000); });
    child.stderr?.on("data", (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-12000); });
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code));
  });
}

function processInfo(pid) {
  const id = Number(pid);
  if (!Number.isSafeInteger(id) || id <= 1) return null;
  if (process.platform === "win32") {
    const script = `Get-Process -Id ${id} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Path | ConvertTo-Json -Compress`;
    const out = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" });
    const item = parseJsonOutput(out.stdout, null);
    if (item) return { pid: Number(item.Id || id), name: item.ProcessName || `PID ${id}`, path: item.Path || "" };
  } else {
    const out = spawnSync("ps", ["-p", String(id), "-o", "pid=,comm=,args="], { encoding: "utf8" });
    const line = String(out.stdout || "").trim();
    if (line) {
      const match = line.match(/^\s*(\d+)\s+(\S+)\s*(.*)$/);
      if (match) return { pid: Number(match[1]), name: match[2], path: match[3] || "" };
    }
  }
  return { pid: id, name: `PID ${id}`, path: "" };
}

function normalizeListenerAddress(value, familyHint = "") {
  let address = String(value || "").trim();
  if (!address) return "";
  if (address.startsWith("[") && address.includes("]")) address = address.slice(1, address.indexOf("]"));
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  const lower = address.toLowerCase();
  if (lower === "*" || lower === "+") {
    return String(familyHint).toLowerCase().includes("6") ? "::" : "0.0.0.0";
  }
  if (lower === "0.0.0.0") return "0.0.0.0";
  if (lower === "::") return "::";
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(address)) return address.slice(7);
  return address.toLowerCase();
}

function addressFamily(address, familyHint = "") {
  const literal = net.isIP(address);
  if (literal) return literal;
  const hint = String(familyHint || "").toLowerCase();
  if (hint.includes("6") || hint === "ipv6") return 6;
  if (hint.includes("4") || hint === "ipv4") return 4;
  return 0;
}

function parseListenEndpoint(value, familyHint = "") {
  let endpoint = String(value || "").trim();
  if (!endpoint) return null;
  let port = null;
  if (endpoint.startsWith("[") && endpoint.includes("]")) {
    const suffix = endpoint.slice(endpoint.indexOf("]") + 1);
    if (/^:\d+$/.test(suffix)) port = Number(suffix.slice(1));
    endpoint = endpoint.slice(0, endpoint.indexOf("]") + 1);
  } else {
    const colon = endpoint.lastIndexOf(":");
    if (colon > -1 && /^\d+$/.test(endpoint.slice(colon + 1))) {
      port = Number(endpoint.slice(colon + 1));
      endpoint = endpoint.slice(0, colon);
    }
  }
  const address = normalizeListenerAddress(endpoint, familyHint);
  if (!address) return null;
  return { address, family: addressFamily(address, familyHint), port };
}

function uniqueProcesses(items) {
  const map = new Map();
  for (const item of items || []) {
    const pid = Number(item?.pid);
    if (!Number.isSafeInteger(pid) || pid <= 1) continue;
    const normalizedAddress = item.address ? normalizeListenerAddress(item.address, item.address_family || item.family) : "";
    const listener = item.local_address
      ? parseListenEndpoint(item.local_address, item.address_family || item.family)
      : normalizedAddress
        ? {address:normalizedAddress, family:addressFamily(normalizedAddress, item.address_family || item.family), port:Number(item.port) || null}
        : null;
    if (!map.has(pid)) map.set(pid, { pid, name: item.name || `PID ${pid}`, path: item.path || "", listeners: [] });
    const current = map.get(pid);
    if (!current.name || current.name === `PID ${pid}`) current.name = item.name || current.name;
    if (!current.path) current.path = item.path || "";
    if (listener?.address && !current.listeners.some((entry) => entry.address === listener.address && entry.family === listener.family)) {
      current.listeners.push(listener);
    }
  }
  return [...map.values()];
}

function isLocalListenAddress(value) {
  const address = normalizeListenerAddress(value);
  if (["0.0.0.0", "::", "::1"].includes(address) || address.startsWith("127.")) return true;
  const interfaces: any[] = Object.values(os.networkInterfaces()).flat() as any[];
  return interfaces.some((item) => normalizeListenerAddress(item?.address) === address);
}

async function resolveListenHost(host) {
  const value = normalizePortHost(host);
  const stripped = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  if (["", "0.0.0.0"].includes(stripped)) return [{address:"0.0.0.0", family:4}];
  if (stripped === "::") return [{address:"::", family:6}];
  const literalFamily = net.isIP(stripped);
  if (literalFamily) {
    const address = normalizeListenerAddress(stripped);
    return isLocalListenAddress(address) ? [{address, family:literalFamily}] : [];
  }
  try {
    const record: any = await dns.lookup(stripped, {verbatim:true});
    const address = normalizeListenerAddress(record.address);
    return isLocalListenAddress(address) ? [{address, family:record.family}] : [];
  } catch {
    return [];
  }
}

function listenerConflictsWithHost(owner, targetAddresses) {
  if (!targetAddresses.length || !owner?.listeners?.length) return false;
  return owner.listeners.some((listener) => targetAddresses.some((target) => {
    if (!listener.family || !target.family || listener.family !== target.family) return false;
    if (listener.address === target.address) return true;
    if (listener.family === 4 && (listener.address === "0.0.0.0" || target.address === "0.0.0.0")) return true;
    if (listener.family === 6 && (listener.address === "::" || target.address === "::")) return true;
    return false;
  }));
}

function parseLsofListeners(text) {
  const records = [];
  let current = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (line.startsWith("p")) {
      current = {pid:Number(line.slice(1))};
    } else if (current) {
      if (line.startsWith("c")) current.name = line.slice(1);
      else if (line.startsWith("t")) current.family = line.slice(1);
      else if (line.startsWith("n")) records.push({...current, local_address:line.slice(1)});
    }
  }
  return records;
}

async function inspectPortOwner(port, host = "127.0.0.1") {
  const targetPort = Number(port);
  if (!targetPort) return [];
  const targetAddresses = await resolveListenHost(host);
  if (!targetAddresses.length) return [];
  let records = [];
  if (process.platform === "win32") {
    const script = [
      `$items = @(Get-NetTCPConnection -LocalPort ${targetPort} -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,AddressFamily,OwningProcess)`,
      `$items | ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; [pscustomobject]@{Id=$_.OwningProcess;ProcessName=$p.ProcessName;Path=$p.Path;LocalAddress=$_.LocalAddress;AddressFamily=$_.AddressFamily} } | ConvertTo-Json -Compress`
    ].join("; ");
    const out: any = await runProcess("powershell.exe", ["-NoProfile", "-Command", script], 5000);
    const data = parseJsonOutput(out.stdout, []);
    records = (Array.isArray(data) ? data : [data]).filter(Boolean).map((item) => ({
      pid: item.Id,
      name: item.ProcessName,
      path: item.Path,
      address: item.LocalAddress,
      address_family: item.AddressFamily,
      port:targetPort
    }));
  } else {
    const lsof: any = await runProcess("lsof", ["-nP", "-FpcfntT", "-a", `-iTCP:${targetPort}`, "-sTCP:LISTEN"], 4000);
    if (lsof.status === 0 && lsof.stdout) {
      records = parseLsofListeners(lsof.stdout);
    }
    if (!records.length) {
      const ssResults: any[] = await Promise.all([4, 6].map((family) => runProcess("ss", ["-H", `-${family}`, "-ltnp", `sport = :${targetPort}`], 4000)));
      for (let index = 0; index < ssResults.length; index += 1) {
        const result = ssResults[index];
        if (result.status !== 0 || !result.stdout) continue;
        for (const line of String(result.stdout).split(/\r?\n/)) {
          const endpoint = line.match(/^\S+\s+\d+\s+\d+\s+(\S+)/)?.[1];
          const local = parseListenEndpoint(endpoint, index === 0 ? "IPv4" : "IPv6");
          if (!local) continue;
          for (const match of line.matchAll(/pid=(\d+)/g)) records.push({pid:Number(match[1]), address:local.address, address_family:local.family, port:local.port});
        }
      }
    }
    if (!records.length) {
      const netstat: any = await runProcess("netstat", ["-ltnp"], 4000);
      if (netstat.status === 0 && netstat.stdout) {
        records = String(netstat.stdout).split(/\r?\n/).map((line) => {
          const parts = line.trim().split(/\s+/);
          const local = parseListenEndpoint(parts[3], parts[0]);
          const match = parts.find((part) => /^(\d+)\/[^\s]+$/.test(part));
          return local?.port === targetPort && match
            ? {pid:Number(match.split("/")[0]), address:local.address, address_family:local.family, port:local.port, name:match.split("/")[1]}
            : null;
        }).filter(Boolean);
      }
    }
  }
  const owners = uniqueProcesses(records);
  return owners.filter((owner) => listenerConflictsWithHost(owner, targetAddresses));
}

async function diagnosePortUsage(host, port) {
  const occupied = !(await portAvailable(host, port));
  const processes = occupied ? await inspectPortOwner(port, host) : [];
  return {
    host,
    port: Number(port),
    occupied,
    processes
  };
}

async function recommendPort(host, port, excludeId = 0) {
  const start = Math.max(1, Math.min(Number(port) || 1, 65535));
  const configured = new Set(all("SELECT bind_port FROM connection_forwards WHERE mode IN ('local','socks') AND id<>?", [Number(excludeId || 0)]).map((row) => Number(row.bind_port)));
  for (let current = start; current <= 65535; current += 1) {
    if (configured.has(current)) continue;
    if (await portAvailable(host, current)) return { host, requested_port: Number(port), recommended_port: current };
  }
  throw new Error("没有找到可用端口");
}

function configuredPortOwner(port, excludeId = 0) {
  const row = all(
    `SELECT f.id, f.bind_host, f.bind_port, c.name AS connection_name
     FROM connection_forwards f
     JOIN connections c ON c.id=f.connection_id
     WHERE f.mode IN ('local','socks') AND f.bind_port=? AND f.id<>?
     LIMIT 1`,
    [Number(port), Number(excludeId || 0)]
  )[0];
  return row || null;
}

function normalizeProcessId(value) {
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") {
    throw new Error("PID 必须是大于 1 的安全整数");
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 1) throw new Error("PID 必须是大于 1 的安全整数");
  return id;
}

function normalizePortNumber(value) {
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") {
    throw new Error("端口必须是 1-65535 之间的整数");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("端口必须是 1-65535 之间的整数");
  return port;
}

function normalizePortHost(value) {
  if (typeof value !== "string") throw new Error("监听地址无效");
  const host = value.trim();
  if (!host || host.length > 255 || !/^[A-Za-z0-9:._-]+$/.test(host)) throw new Error("监听地址无效");
  return host;
}

async function killPortOwner(pid, port, host) {
  const id = normalizeProcessId(pid);
  const targetPort = normalizePortNumber(port);
  const targetHost = normalizePortHost(host);
  if (id === process.pid) throw new Error("不能关闭当前 Terma 进程");
  const usage = await diagnosePortUsage(targetHost, targetPort);
  const owner = (usage.processes || []).find(item => Number(item?.pid) === id);
  if (!owner) {
    if (!pidRunning(id)) return { ok: true, already_stopped: true, port: targetPort, process: processInfo(id) };
    const error: any = new Error("端口占用状态已变化，请重新诊断后再试");
    error.statusCode = 409;
    throw error;
  }
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(id), "/T", "/F"], { encoding: "utf8" });
    if (result.status !== 0) {
      if (!pidRunning(id)) return { ok: true, already_stopped: true, port: targetPort, process: owner };
      throw new Error((result.stderr || result.stdout || "关闭进程失败").trim());
    }
  } else {
    try {
      process.kill(id, "SIGTERM");
    } catch (error) {
      if (error?.code === "ESRCH" || !pidRunning(id)) return { ok: true, already_stopped: true, port: targetPort, process: owner };
      throw new Error(error.message);
    }
  }
  return { ok: true, port: targetPort, process: owner };
}

async function startForward(id) {
  return startForwardInternal(id, {});
}

async function startForwardInternal(id, options: any = {}) {
  return enqueueForwardOperation(id, () => performStartForwardInternal(id, options));
}

async function performStartForwardInternal(id, options: any = {}) {
  const forward = getForward(id);
  const connection = getConnection(forward.connection_id);
  await stopForwardRuntime(id, { preserveRestoreState: true });
  if (["local", "socks"].includes(forward.mode)) {
    let usage = await diagnosePortUsage(forward.bind_host, forward.bind_port);
    if (usage.occupied && options.cleanupSshPortOwner) {
      const sshOwners = (usage.processes || []).filter((item) => /(^|[\\/])ssh(?:\.exe)?$/i.test(item.path || "") || /^ssh(?:\.exe)?$/i.test(item.name || ""));
      if (sshOwners.length && sshOwners.length === (usage.processes || []).length) {
        for (const owner of sshOwners) {
          try {
            stopPid(Number(owner.pid));
            fs.mkdirSync(LOG_DIR, { recursive: true });
            fs.appendFileSync(path.join(LOG_DIR, `forward-${id}.log`), `cleanup old ssh port owner: ${owner.name} PID ${owner.pid}\n`);
          } catch {}
        }
        await new Promise((resolve) => setTimeout(resolve, 600));
        usage = await diagnosePortUsage(forward.bind_host, forward.bind_port);
      }
    }
    if (usage.occupied) {
      const details = usage.processes.length
        ? usage.processes.map((item) => `${item.name} PID ${item.pid}${item.path ? `\n${item.path}` : ""}`).join("\n")
        : "未能识别占用进程";
      const display = diagnoseSshError(`Address already in use: ${formatRemoteEndpoint(usage.host, usage.port)}\n${details}`).display;
      notifyIssue(`forward:${Number(id)}:down`, {
        type: "forward",
        level: "error",
        title: "转发启动失败",
        message: `${forwardNotifyLabel(connection, forward)}\n${display}`,
        action: { view: "forwards", connection_id: connection.id, forward_id: Number(id) }
      });
      throw new Error(display);
    }
  }
  if (shouldUseBuiltinSsh(connection)) {
    let managed;
    try {
      managed = await startPasswordForward(connection, forward, {
        onError: (error) => {
          if (ssh2Forwards.get(Number(id)) !== managed) return;
          const message = diagnoseSshError(error.message || "内置 SSH 转发连接已断开").display;
          run("UPDATE connection_forwards SET status='failed', pid=NULL, last_error=?, updated_at=? WHERE id=?", [message, now(), Number(id)]);
          notifyIssue(`forward:${Number(id)}:down`, {
            type: "forward",
            level: "error",
            title: "转发连接异常",
            message: `${forwardNotifyLabel(connection, forward)}\n${message}`,
            action: { view: "forwards", connection_id: connection.id, forward_id: Number(id) }
          });
        },
        onClose: () => {
          if (ssh2Forwards.get(Number(id)) !== managed) return;
          ssh2Forwards.delete(Number(id));
          run("UPDATE connection_forwards SET status='failed', pid=NULL, last_error=?, updated_at=? WHERE id=?", ["内置 SSH 连接已关闭", now(), Number(id)]);
        }
      });
      ssh2Forwards.set(Number(id), managed);
      run("UPDATE connection_forwards SET pid=NULL, status='running', restore=1, started_at=?, reconnect_count=0, last_error=NULL, updated_at=? WHERE id=?", [now(), now(), Number(id)]);
      setRestoreConnection(forward.connection_id, true);
      notifyRecovery(`forward:${Number(id)}:down`, {
        type: "forward",
        title: "转发已启动",
        message: forwardNotifyLabel(connection, forward),
        action: { view: "forwards", connection_id: connection.id, forward_id: Number(id) }
      });
      return;
    } catch (error) {
      try { await managed?.close(); } catch {}
      if (isHostTrustError(error)) throw error;
      const display = diagnoseSshError(error.message || "内置 SSH 转发启动失败").display;
      run("UPDATE connection_forwards SET status='failed', pid=NULL, last_error=?, updated_at=? WHERE id=?", [display, now(), Number(id)]);
      notifyIssue(`forward:${Number(id)}:down`, {
        type: "forward",
        level: "error",
        title: "转发启动失败",
        message: `${forwardNotifyLabel(connection, forward)}\n${display}`,
        action: { view: "forwards", connection_id: connection.id, forward_id: Number(id) }
      });
      throw new Error(display);
    }
  }
  await ensureConnectionHostTrusted(connection);
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logPath = path.join(LOG_DIR, `forward-${id}.log`);
  const log = fs.openSync(logPath, "a");
  fs.writeSync(log, `\n--- start ${new Date().toISOString()} ---\n`);
  const child = spawn(SSH_BIN, buildForwardCommand(connection, forward), { detached: true, stdio: ["ignore", log, log] });
  child.unref();
  await new Promise((resolve) => setTimeout(resolve, 900));
  const running = pidRunning(child.pid);
  run(
    "UPDATE connection_forwards SET pid=?, status=?, restore=?, started_at=?, reconnect_count=?, last_error=NULL, updated_at=? WHERE id=?",
    [running ? child.pid : null, running ? "running" : "failed", running ? 1 : Number(forward.restore || 0), running ? now() : null, running ? 0 : Number(forward.reconnect_count || 0), now(), Number(id)]
  );
  if (running) setRestoreConnection(forward.connection_id, true);
  if (running) {
    notifyRecovery(`forward:${Number(id)}:down`, {
      type: "forward",
      title: "转发已恢复",
      message: forwardNotifyLabel(connection, forward),
      action: { view: "forwards", connection_id: connection.id, forward_id: Number(id) }
    });
  }
  if (!running) {
    let logText = "";
    try { logText = fs.readFileSync(logPath, "utf8").slice(-4000); } catch {}
    const display = diagnoseSshError(logText || "转发启动失败，请查看日志").display;
    run("UPDATE connection_forwards SET last_error=?, updated_at=? WHERE id=?", [display, now(), Number(id)]);
    notifyIssue(`forward:${Number(id)}:down`, {
      type: "forward",
      level: "error",
      title: "转发启动失败",
      message: `${forwardNotifyLabel(connection, forward)}\n${display}`,
      action: { view: "forwards", connection_id: connection.id, forward_id: Number(id) }
    });
    throw new Error(display);
  }
}

function stopPid(pid) {
  if (pid && pidRunning(pid)) {
    try {
      if (process.platform === "win32") process.kill(pid);
      else process.kill(-pid, "SIGTERM");
    } catch {}
  }
}

function connectionForwards(connectionId) {
  return all("SELECT * FROM connection_forwards WHERE connection_id=? ORDER BY id", [Number(connectionId)]);
}

async function startConnectionForwards(connectionId, options: any = {}) {
  const forwards = connectionForwards(connectionId);
  if (!forwards.length) throw new Error("该连接没有转发配置");
  await stopConnectionForwards(connectionId, { preserveRestoreState: true });
  const errors = [];
  for (const forward of forwards) {
    try {
      await startForwardInternal(forward.id, options);
    } catch (error) {
      if (isHostTrustError(error)) throw error;
      errors.push(`${forward.mode} ${forward.bind_host}:${forward.bind_port}：${error.message}`);
    }
  }
  const running = connectionForwards(connectionId).filter((forward) => ssh2Forwards.has(Number(forward.id)) || (forward.pid && pidRunning(forward.pid)));
  if (running.length && options.recordState !== false) setRestoreConnection(connectionId, true);
  if (errors.length) {
    if (!running.length) setRestoreConnection(connectionId, false);
    throw new Error(errors.join("\n\n"));
  }
}

async function enqueueForwardOperation(id, operation) {
  const key = Number(id);
  const previous = forwardOperations.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  forwardOperations.set(key, current);
  try {
    return await current;
  } finally {
    if (forwardOperations.get(key) === current) forwardOperations.delete(key);
  }
}

async function stopForwardRuntime(id, options: any = {}) {
  const forward = getForward(id);
  const managed = ssh2Forwards.get(Number(id));
  if (managed) {
    ssh2Forwards.delete(Number(id));
    try { await managed.close(); } catch {}
  }
  const pid = Number(forward.pid || 0);
  if (pid) stopPid(pid);
  const restore = options.preserveRestoreState ? Number(forward.restore || 0) : 0;
  run("UPDATE connection_forwards SET pid=NULL, status='stopped', restore=?, reconnect_count=0, started_at=NULL, updated_at=? WHERE id=?", [restore, now(), Number(id)]);
  if (pid) run("UPDATE connection_forwards SET pid=NULL, status='stopped', restore=0, reconnect_count=0, started_at=NULL, updated_at=? WHERE pid=? AND id<>?", [now(), pid, Number(id)]);
  if (!options.preserveRestoreState && !connectionRunning(forward.connection_id)) setRestoreConnection(forward.connection_id, false);
}

async function stopForward(id, options: any = {}) {
  return enqueueForwardOperation(id, () => stopForwardRuntime(id, options));
}

async function reconfigureForwardRuntime(id, applyConfiguration, restoreConfiguration) {
  return enqueueForwardOperation(id, async () => {
    const before = getForward(id);
    const wasRunning = ["running", "reconnecting"].includes(String(before?.status || ""))
      || Boolean(Number(before?.pid || 0));
    if (!wasRunning) {
      applyConfiguration();
      return {ok:true, was_running:false, restarted:false, rolled_back:false};
    }

    await stopForwardRuntime(id, {preserveRestoreState:true});
    let updated = false;
    try {
      applyConfiguration();
      updated = true;
      await performStartForwardInternal(id, {});
      return {ok:true, was_running:true, restarted:true, rolled_back:false};
    } catch (error) {
      const applyError = error?.message || String(error);
      let rollbackError = "";
      try {
        if (updated) restoreConfiguration();
        await performStartForwardInternal(id, {});
      } catch (rollbackFailure) {
        rollbackError = rollbackFailure?.message || String(rollbackFailure);
      }
      const message = rollbackError
        ? `新配置启动失败，旧配置也未能恢复：${applyError}\n恢复失败：${rollbackError}`
        : `新配置启动失败，已恢复并重新启动旧配置：${applyError}`;
      const reconfigurationError: any = new Error(message);
      reconfigurationError.statusCode = 409;
      reconfigurationError.code = rollbackError ? "FORWARD_RECONFIGURE_ROLLBACK_FAILED" : "FORWARD_RECONFIGURE_ROLLED_BACK";
      throw reconfigurationError;
    }
  });
}

async function stopConnectionForwards(connectionId, options: any = {}) {
  const forwards = connectionForwards(connectionId);
  await Promise.all(forwards.map((forward) => stopForward(forward.id, options)));
}

async function stopAllForwards(options: any = {}) {
  const rows = all("SELECT DISTINCT connection_id FROM connection_forwards WHERE pid IS NOT NULL OR status = 'running'");
  const connectionIds = new Set(rows.map((row) => Number(row.connection_id)));
  for (const id of ssh2Forwards.keys()) {
    try { connectionIds.add(Number(getForward(id).connection_id)); } catch {}
  }
  await Promise.all([...connectionIds].map((connectionId) => stopConnectionForwards(connectionId, options)));
}

async function autostartConnections() {
  const rows = all("SELECT id, name FROM connections WHERE autostart_forwards=1 ORDER BY id");
  const result = { ok:0, failed:0, errors:[] };
  for (const row of rows) {
    try {
      await startConnectionForwards(row.id, { cleanupSshPortOwner: true });
      result.ok++;
    } catch (error) {
      result.failed++;
      result.errors.push({id:row.id,name:row.name,error:error.message});
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.appendFileSync(path.join(LOG_DIR, `connection-${row.id}.log`), `autostart failed: ${error.message}\n`);
    }
  }
  return result;
}

async function restorePreviousForwards() {
  const ids = readRestoreState();
  const result = { ok: 0, failed: 0, errors: [] };
  const forwardRows = all("SELECT id FROM connection_forwards WHERE restore=1 ORDER BY connection_id, id");
  if (forwardRows.length) {
    for (const row of forwardRows) {
      try {
        await startForwardInternal(row.id, { cleanupSshPortOwner: true });
        result.ok++;
      } catch (error) {
        result.failed++;
        result.errors.push({ id: row.id, error: error.message });
      }
    }
    return result;
  }
  for (const id of ids) {
    try {
      await startConnectionForwards(id, { recordState: true, cleanupSshPortOwner: true });
      result.ok++;
    } catch (error) {
      result.failed++;
      result.errors.push({ id, error: error.message });
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.appendFileSync(path.join(LOG_DIR, `connection-${id}.log`), `restore failed: ${error.message}\n`);
    }
  }
  return result;
}

function connectionRunning(connectionId) {
  return connectionForwards(connectionId).some((forward) => ssh2Forwards.has(Number(forward.id)) || (forward.pid && pidRunning(forward.pid)));
}

const connectionHealthCache = new Map();
const CONNECTION_HEALTH_TTL_MS = 30000;

function clearConnectionHealthCache(connectionId = null) {
  if (connectionId === null) connectionHealthCache.clear();
  else connectionHealthCache.delete(Number(connectionId));
}

async function connectionHealth(connectionId, options: any = {}) {
  const id = Number(connectionId);
  const cached = connectionHealthCache.get(id);
  if (!options.force && cached && Date.now() - cached.checked_at < CONNECTION_HEALTH_TTL_MS) return {...cached, cached:true, cache_age_ms:Date.now() - cached.checked_at};
  const connection = getConnection(connectionId);
  const forwards = connectionForwards(connectionId);
  let ssh;
  try {
    ssh = await testSsh(connection);
  } catch (error) {
    const message = String(error?.message || "SSH 健康检查无法完成");
    const issues = Array.isArray(error?.details?.issues)
      ? error.details.issues
      : Array.isArray(error?.issues)
        ? error.issues
        : [];
    ssh = {
      ok:false,
      elapsed_ms:0,
      output:message,
      raw_output:"",
      preserve_raw_output:false,
      diagnosis:diagnoseSshError(message),
      issues
    };
  }
  const forwardChecks = [];
  for (const forward of forwards) {
    const running = Boolean(ssh2Forwards.has(Number(forward.id)) || (forward.pid && pidRunning(forward.pid)));
    let reachable: any = null;
    let port_usage: any = null;
    if (["local", "socks"].includes(forward.mode)) {
      const usage = await diagnosePortUsage(forward.bind_host, forward.bind_port);
      if (running) reachable = usage.occupied;
      else port_usage = usage;
    }
    forwardChecks.push({
      id:forward.id,
      mode:forward.mode,
      bind_host:forward.bind_host,
      bind_port:Number(forward.bind_port || 0),
      target_host:forward.target_host,
      target_port:Number(forward.target_port || 0),
      running,
      reachable,
      status:running ? "running" : (forward.status || "stopped"),
      port_usage,
      last_error:forward.last_error || ""
    });
  }
  const ok = ssh.ok && forwardChecks.every((item) => item.reachable !== false);
  const result = {
    id: Number(connectionId),
    name: connection.name,
    group_name:connection.group_name,
    ssh_user:connection.ssh_user,
    ssh_host:connection.ssh_host,
    ssh_port:Number(connection.ssh_port || 22),
    ok,
    status: ok ? "正常" : "异常",
    ssh,
    forwards: forwardChecks,
    checked_at: Date.now(),
    cached: false,
    cache_ttl_ms: CONNECTION_HEALTH_TTL_MS
  };
  connectionHealthCache.set(id, result);
  return result;
}

async function allConnectionsHealth(options: any = {}) {
  const rows = all("SELECT id FROM connections ORDER BY group_name, name, id");
  return mapLimit(rows, 4, (row) => connectionHealth(row.id, options));
}

async function mapLimit(items, limit, mapper) {
  const result = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      result[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

function startForwardHealthMonitor() {
  if (healthMonitorTimer) return;
  healthMonitorTimer = setInterval(() => {
    if (healthMonitorBusy) return;
    healthMonitorBusy = true;
    healthMonitorTask = (async () => {
      try {
        const forwardRows = all("SELECT id, pid, restore FROM connection_forwards WHERE restore=1 OR status='running'");
        for (const row of forwardRows) {
          try {
            const running = ssh2Forwards.has(Number(row.id)) || (row.pid && pidRunning(row.pid));
            if (row.restore && !running) {
              run("UPDATE connection_forwards SET status='reconnecting', reconnect_count=reconnect_count+1, updated_at=? WHERE id=?", [now(), row.id]);
              await startForwardInternal(row.id, { cleanupSshPortOwner: true });
            }
          } catch (error) {
            run("UPDATE connection_forwards SET status='failed', pid=NULL, last_error=?, updated_at=? WHERE id=?", [error.message, now(), row.id]);
            fs.mkdirSync(LOG_DIR, { recursive: true });
            fs.appendFileSync(path.join(LOG_DIR, `forward-${row.id}.log`), `auto reconnect failed: ${error.message}\n`);
            try {
              const forward = getForward(row.id);
              const connection = getConnection(forward.connection_id);
              notifyIssue(`forward:${Number(row.id)}:down`, {
                type: "forward",
                level: "error",
                title: "转发自动重连失败",
                message: `${forwardNotifyLabel(connection, forward)}\n${error.message}`,
                action: { view: "forwards", connection_id: connection.id, forward_id: Number(row.id) }
              });
            } catch {}
          }
        }
        const ids = readRestoreState();
        for (const id of ids) {
          try {
            if (!connectionRunning(id)) await startConnectionForwards(id, { recordState: true });
          } catch (error) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
            fs.appendFileSync(path.join(LOG_DIR, `connection-${id}.log`), `auto reconnect failed: ${error.message}\n`);
          }
        }
      } finally {
        healthMonitorBusy = false;
        healthMonitorTask = null;
      }
    })();
  }, 30000);
  healthMonitorTimer.unref?.();
}

async function stopForwardHealthMonitor() {
  if (healthMonitorTimer) clearInterval(healthMonitorTimer);
  healthMonitorTimer = null;
  const task = healthMonitorTask;
  if (task) await task.catch(() => {});
}

function runSshTest(args, timeoutMs = 15000, encoding = "utf8") {
  return new Promise((resolve) => {
    const child = spawn(SSH_BIN, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (status, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status,
        stdout:decodeSshOutput(Buffer.concat(stdout).slice(-12000), encoding),
        stderr:decodeSshOutput(Buffer.concat(stderr).slice(-12000), encoding),
        error
      });
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      finish(null, new Error("SSH 测试超时"));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout.push(Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      stderr.push(Buffer.from(chunk));
    });
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code));
    try {
      child.stdin?.end();
    } catch {}
  });
}

async function testSsh(data) {
  sshDestinationArgs(data);
  const marker = "__TERMA_SSH_OK__";
  const probe = `echo ${marker}`;
  if (shouldUseBuiltinSsh(data)) {
    const start = Date.now();
    const result: any = await runPasswordCommand({ ...data, ssh_password: String(data.ssh_password || "") }, probe, null, 15000);
    if (isHostTrustError(result.error)) throw result.error;
    const preservedOutput = String(result.stdout || result.stderr || "").trim();
    const rawOutput = (preservedOutput || (result.error ? result.error.message : "") || (result.status === 0 ? "SSH 连接成功（退出码 0）" : `SSH 退出码 ${result.status}`)).trim();
    const diagnosis = diagnoseSshError(rawOutput);
    return { ok: result.status === 0, elapsed_ms: Date.now() - start, output: result.status === 0 ? "SSH 连接成功" : diagnosis.display, raw_output:rawOutput, preserve_raw_output:Boolean(preservedOutput), diagnosis };
  }
  await ensureConnectionHostTrusted(data);
  const args = ["-T", ...systemConnectionArgs(data), "-o", "BatchMode=yes", "-p", String(data.ssh_port || 22)];
  if (data.identity_file) {
    securePrivateKeyPermissions(data.identity_file);
    args.push("-i", data.identity_file);
  }
  args.push(...effectiveExtraArgs(data.extra_args, data));
  args.push(...sshDestinationArgs(data), probe);
  const start = Date.now();
  const result: any = await runSshTest(args, 15000, data.terminal_encoding);
  const ok = result.status === 0;
  const preservedOutput = String(result.stdout || result.stderr || "").trim();
  const rawOutput = (preservedOutput || (result.error ? result.error.message : "") || (ok ? "SSH 连接成功（退出码 0）" : `SSH 退出码 ${result.status}`)).trim();
  const diagnosis = diagnoseSshError(rawOutput);
  return {
    ok,
    elapsed_ms: Date.now() - start,
    output: ok ? "SSH 连接成功" : diagnosis.display,
    raw_output: rawOutput,
    preserve_raw_output:Boolean(preservedOutput),
    diagnosis
  };
}

async function runSshCommandForConnection(connection, command, timeoutMs = 60000) {
  if (shouldUseBuiltinSsh(connection)) {
    const result: any = await runPasswordCommand(connection, command, null, timeoutMs);
    if (isHostTrustError(result.error)) throw result.error;
    return result;
  }
  await ensureConnectionHostTrusted(connection);
  const args = ["-T", ...systemConnectionArgs(connection), "-o", "BatchMode=yes", "-p", String(connection.ssh_port || 22)];
  if (connection.identity_file) {
    securePrivateKeyPermissions(connection.identity_file);
    args.push("-i", connection.identity_file);
  }
  args.push(...effectiveExtraArgs(connection.extra_args, connection));
  args.push(...sshDestinationArgs(connection), String(command || ""));
  return new Promise((resolve) => {
    const child = spawn(SSH_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (status, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status,
        stdout:decodeSshOutput(Buffer.concat(stdout).slice(-60000), connection.terminal_encoding),
        stderr:decodeSshOutput(Buffer.concat(stderr).slice(-60000), connection.terminal_encoding),
        error
      });
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish(null, new Error("命令执行超时"));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout.push(Buffer.from(chunk)); });
    child.stderr?.on("data", (chunk) => { stderr.push(Buffer.from(chunk)); });
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code));
  });
}

async function runSshCommandForConnectionStreaming(connection, command, timeoutMs = 60000, onChunk = null, options: any = {}) {
  const x11Mode = ["untrusted", "trusted"].includes(String(options.x11Mode || ""))
    ? String(options.x11Mode)
    : "";
  if (shouldUseBuiltinSsh(connection)) {
    const result: any = await runPasswordCommand(connection, command, options.input ?? null, timeoutMs, onChunk, {x11Mode});
    if (isHostTrustError(result.error)) throw result.error;
    return result;
  }
  await ensureConnectionHostTrusted(connection);
  const args = ["-T", ...systemConnectionArgs(connection), "-o", "BatchMode=yes", "-p", String(connection.ssh_port || 22)];
  const xauthLocation = process.env.TERMA_XAUTH || process.env.TUNNELDESK_XAUTH;
  if (x11Mode && xauthLocation) args.push("-o", `XAuthLocation=${xauthLocation}`);
  if (x11Mode === "trusted") args.push("-Y");
  else if (x11Mode === "untrusted") args.push("-X");
  if (connection.identity_file) {
    securePrivateKeyPermissions(connection.identity_file);
    args.push("-i", connection.identity_file);
  }
  args.push(...effectiveExtraArgs(connection.extra_args, connection));
  args.push(...sshDestinationArgs(connection), String(command || ""));
  return new Promise((resolve) => {
    const child = spawn(SSH_BIN, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (status, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status,
        stdout:decodeSshOutput(Buffer.concat(stdout).slice(-60000), connection.terminal_encoding),
        stderr:decodeSshOutput(Buffer.concat(stderr).slice(-60000), connection.terminal_encoding),
        error
      });
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish(null, new Error("SSH command timed out"));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout.push(Buffer.from(chunk)); onChunk?.(chunk, "stdout"); });
    child.stderr?.on("data", (chunk) => { stderr.push(Buffer.from(chunk)); onChunk?.(chunk, "stderr"); });
    child.stdin?.on("error", () => {});
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => finish(code));
    if (options.input !== undefined && options.input !== null) child.stdin?.end(options.input);
    else child.stdin?.end();
  });
}

async function runPersistentSshCommandForConnection(connection, command, timeoutMs = 60000) {
  if (!shouldUseBuiltinSsh(connection)) return runSshCommandForConnection(connection, command, timeoutMs);
  return runPersistentSshCommand(connection, command, timeoutMs);
}

async function runPersistentSshCommandForConnectionStreaming(connection, command, timeoutMs = 60000, onChunk = null, options: any = {}) {
  if (!shouldUseBuiltinSsh(connection)) return runSshCommandForConnectionStreaming(connection, command, timeoutMs, onChunk, options);
  return runPersistentSshCommand(connection, command, timeoutMs, onChunk, options);
}

async function batchRunCommands(ids, command, options: any = {}) {
  const cleanIds = [...new Set((ids || []).map(Number).filter(Boolean))];
  const text = String(command || "").trim();
  if (!cleanIds.length) throw new Error("请选择 SSH 连接");
  if (!text) throw new Error("请输入要执行的命令");
  const requestedTimeoutMs = Number(options.timeout_ms);
  const timeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.max(5000, Math.min(requestedTimeoutMs, 10 * 60 * 1000))
    : 60000;
  const rows = cleanIds.map((id) => getConnection(id));
  const missingIndex = rows.findIndex((connection) => !connection);
  if (missingIndex >= 0) throw new Error(`SSH 连接不存在：${cleanIds[missingIndex]}`);
  const results = await mapLimit(rows, 4, async (connection) => {
    const started = Date.now();
    const result: any = await runSshCommandForConnection(connection, text, timeoutMs);
    const ok = result.status === 0;
    const output = `${result.stdout || ""}${result.stderr || ""}${result.error ? result.error.message : ""}`.trim();
    return {
      id: connection.id,
      name: connection.name,
      ok,
      exit_code: result.status,
      elapsed_ms: Date.now() - started,
      output: output || (ok ? "命令执行完成，无输出" : `命令退出码 ${result.status}`)
    };
  });
  return {
    total: results.length,
    ok: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results
  };
}

module.exports = {
  splitArgs,
  effectiveExtraArgs,
  listIdentityFiles,
  securePrivateKeyPermissions,
  identityPermissionStatus,
  repairIdentityFile,
  identityFileMap,
  saveUploadedKey,
  diagnoseSshError,
  buildForwardCommand,
  buildConnectionCommand,
  buildTerminalCommand,
  startForward,
  stopForward,
  reconfigureForwardRuntime,
  startConnectionForwards,
  stopConnectionForwards,
  stopAllForwards,
  autostartConnections,
  restorePreviousForwards,
  restoreStateSummary,
  diagnosePortUsage,
  recommendPort,
  configuredPortOwner,
  killPortOwner,
  connectionHealth,
  allConnectionsHealth,
  clearConnectionHealthCache,
  startForwardHealthMonitor,
  stopForwardHealthMonitor,
  testSsh,
  batchRunCommands,
  closePersistentSshCommandSessions,
  runSshCommandForConnection,
  runSshCommandForConnectionStreaming,
  runPersistentSshCommandForConnection,
  runPersistentSshCommandForConnectionStreaming
};
