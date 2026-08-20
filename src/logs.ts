const fs = require("node:fs");
const path = require("node:path");
const { LOG_DIR } = require("./config");
const { listConnections } = require("./db");
const {
  enforceLogRetention,
  readLogSettings,
  resolveLogFile,
  readLogWindow: readLogWindowFromFile,
  rotateLogFile,
  writeLogSettings
} = require("./log-reader");

const TERMINAL_DIR = path.join(LOG_DIR, "terminals");
const BATCH_DIR = path.join(LOG_DIR, "batch");
const LOG_SETTINGS_FILE = path.join(LOG_DIR, "log-settings.json");
const logWriteQueues = new Map();
let currentLogSettings = readLogSettings(LOG_SETTINGS_FILE);
try {
  const stored = fs.existsSync(LOG_SETTINGS_FILE) ? JSON.parse(fs.readFileSync(LOG_SETTINGS_FILE, "utf8")) : null;
  if (!stored || Number(stored.schema_version || 0) < 3) currentLogSettings = writeLogSettings(LOG_SETTINGS_FILE, {});
} catch {}
let logDirectoriesReady = false;

function queueLogWrite(file, data) {
  const chunk = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  let state = logWriteQueues.get(file);
  if (!state) {
    state = { chunks: [], bytes: 0, timer: null, writing: null, lastRotationCheckAt: 0 };
    logWriteQueues.set(file, state);
  }
  state.chunks.push(chunk);
  state.bytes += chunk.length;
  if (state.bytes >= 64 * 1024) flushLogFile(file);
  else if (!state.timer) state.timer = setTimeout(() => flushLogFile(file), 50);
}

function flushLogFile(file) {
  const state = logWriteQueues.get(file);
  if (!state) return Promise.resolve();
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  if (state.writing) return state.writing;
  if (!state.chunks.length) {
    logWriteQueues.delete(file);
    return Promise.resolve();
  }
  const body = Buffer.concat(state.chunks, state.bytes);
  state.chunks = [];
  state.bytes = 0;
  const now = Date.now();
  if (now - Number(state.lastRotationCheckAt || 0) >= 1000) {
    state.lastRotationCheckAt = now;
    try { rotateLogFile(file, body.length, currentLogSettings); } catch {}
  }
  state.writing = fs.promises.appendFile(file, body).catch(() => {}).finally(() => {
    state.writing = null;
    if (state.chunks.length) flushLogFile(file);
    else logWriteQueues.delete(file);
  });
  return state.writing;
}

async function flushLogWrites() {
  await Promise.all([...logWriteQueues.keys()].map((file) => flushLogFile(file)));
}

process.once("beforeExit", flushLogWrites);

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateParts(date = new Date()) {
  const parts: any = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date).reduce((out, part) => {
    if (part.type !== "literal") out[part.type] = Number(part.value);
    return out;
  }, {});
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function dayName(date = new Date()) {
  const d = dateParts(date);
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

function zhDateTime(date = new Date()) {
  const d = dateParts(date);
  return `${d.year}年${d.month}月${d.day}日 ${pad(d.hour)}:${pad(d.minute)}:${pad(d.second)}`;
}

function safeName(value) {
  return String(value || "log").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, "_").slice(0, 80) || "log";
}

function terminalLogIdentity(value) {
  const match = String(value || "").match(/^(\d{13})-([A-Za-z0-9_-]{8,64})$/);
  if (!match) return null;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || timestamp < 946684800000 || timestamp > Date.now() + 24 * 60 * 60 * 1000) return null;
  return { startedAt: new Date(timestamp), suffix: match[2] };
}

function ensureLogDirs() {
  if (logDirectoriesReady) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(TERMINAL_DIR, { recursive: true });
  fs.mkdirSync(BATCH_DIR, { recursive: true });
  logDirectoriesReady = true;
}

function appendSystemLog(message) {
  ensureLogDirs();
  const line = `[${zhDateTime()}] ${message}\n`;
  queueLogWrite(path.join(LOG_DIR, `system-${dayName()}.log`), line);
}

function createTerminalLog(connection, title, logId = "") {
  ensureLogDirs();
  const identity = terminalLogIdentity(logId);
  const startedAt = identity?.startedAt || new Date();
  const label = title || `${connection.name} · 终端`;
  const suffix = identity ? `-${identity.suffix}` : "";
  const filename = `${safeName(label)}-${dayName(startedAt)}-${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}${pad(startedAt.getSeconds())}${suffix}.log`;
  const fullPath = path.join(TERMINAL_DIR, filename);
  if (fs.existsSync(fullPath)) {
    fs.appendFileSync(fullPath, `\n# 重新连接时间：${zhDateTime()}\n\n`, "utf8");
  } else {
    fs.appendFileSync(fullPath, `# ${label}\n# ${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}\n# 开始时间：${zhDateTime(startedAt)}\n\n`, "utf8");
  }
  return { fullPath, label, startedAt };
}

function appendTerminalLog(logFile, data) {
  if (!logFile) return;
  ensureLogDirs();
  queueLogWrite(logFile, data);
}

function createBatchCommandLog(command, count) {
  ensureLogDirs();
  const startedAt = new Date();
  const filename = `batch-${dayName(startedAt)}-${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}${pad(startedAt.getSeconds())}.log`;
  const fullPath = path.join(BATCH_DIR, filename);
  const label = `批量执行-${Number(dateParts(startedAt).month)}月${Number(dateParts(startedAt).day)}日 ${pad(startedAt.getHours())}:${pad(startedAt.getMinutes())}:${pad(startedAt.getSeconds())}`;
  fs.appendFileSync(fullPath, `# ${label}\n# 目标数量：${count}\n# 开始时间：${zhDateTime(startedAt)}\n# 命令：${command}\n\n`, "utf8");
  return { fullPath, label, startedAt };
}

function appendBatchCommandLog(logFile, data) {
  if (!logFile) return;
  ensureLogDirs();
  queueLogWrite(logFile, data);
}

function relativeLogPath(fullPath) {
  return path.relative(LOG_DIR, fullPath).replace(/\\/g, "/");
}

function parseTerminalFilename(name) {
  const rotation = Number(name.match(/\.log\.(\d+)$/i)?.[1] || 0);
  const stem = name.replace(/\.log(?:\.\d+)?$/i, "");
  const match = stem.match(/^(.*)-(\d{4})-(\d{2})-(\d{2})-(\d{6})(?:-[A-Za-z0-9_-]{8,64})?$/);
  if (!match) return { label: stem, time: 0 };
  const title = match[1].replace(/_/g, " ");
  const time = new Date(`${match[2]}-${match[3]}-${match[4]}T${match[5].slice(0, 2)}:${match[5].slice(2, 4)}:${match[5].slice(4, 6)}`).getTime();
  return { label: `${title}-${Number(match[2])}年${Number(match[3])}月${Number(match[4])}日 ${match[5].slice(0, 2)}:${match[5].slice(2, 4)}:${match[5].slice(4, 6)}${rotation ? `（轮转 ${rotation}）` : ""}`, time };
}

function parseBatchFilename(name) {
  const rotation = Number(name.match(/\.log\.(\d+)$/i)?.[1] || 0);
  const stem = name.replace(/\.log(?:\.\d+)?$/i, "");
  const match = stem.match(/^batch-(\d{4})-(\d{2})-(\d{2})-(\d{6})$/);
  if (!match) return { label: stem, time: 0 };
  const time = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4].slice(0, 2)}:${match[4].slice(2, 4)}:${match[4].slice(4, 6)}`).getTime();
  return {
    label: `批量执行-${Number(match[2])}月${Number(match[3])}日 ${match[4].slice(0, 2)}:${match[4].slice(2, 4)}:${match[4].slice(4, 6)}${rotation ? `（轮转 ${rotation}）` : ""}`,
    time
  };
}

function addFileStats(fullPath, item) {
  try {
    const stat = fs.statSync(fullPath);
    return { ...item, size_bytes: stat.size, modified_at: stat.mtimeMs };
  } catch {
    return { ...item, size_bytes: 0, modified_at: 0 };
  }
}

function sumLogBytes(logs) {
  return (logs || []).reduce((sum, item) => sum + Number(item.size_bytes || 0), 0);
}

function listLogs() {
  ensureLogDirs();
  const system = fs.readdirSync(LOG_DIR)
    .filter((name) => /^system-\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/.test(name))
    .map((name) => {
      const match = name.match(/^system-(\d{4})-(\d{2})-(\d{2})\.log(?:\.(\d+))?$/);
      return addFileStats(path.join(LOG_DIR, name), {
        label: `system-${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日${match[4] ? `（轮转 ${match[4]}）` : ""}`,
        path: name,
        time: new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`).getTime()
      });
    })
    .sort((a, b) => b.time - a.time);

  const terminalFiles = fs.existsSync(TERMINAL_DIR) ? fs.readdirSync(TERMINAL_DIR).filter((name) => /\.log(?:\.\d+)?$/i.test(name)) : [];
  const batch = (fs.existsSync(BATCH_DIR) ? fs.readdirSync(BATCH_DIR).filter((name) => /\.log(?:\.\d+)?$/i.test(name)) : [])
    .map((name) => {
      const parsed = parseBatchFilename(name);
      return addFileStats(path.join(BATCH_DIR, name), { label: parsed.label, path: relativeLogPath(path.join(BATCH_DIR, name)), time: parsed.time });
    })
    .sort((a, b) => b.time - a.time);
  const byServer: Map<string, any> = new Map(listConnections().map((connection) => [connection.name, { id: connection.id, name: connection.name, logs: [] }]));
  for (const name of terminalFiles) {
    const parsed = parseTerminalFilename(name);
    const serverName = parsed.label.split(" · ")[0].replace(/-\d{4}年.*$/, "");
    if (!byServer.has(serverName)) byServer.set(serverName, { id: null, name: serverName, logs: [] });
    byServer.get(serverName).logs.push(addFileStats(path.join(TERMINAL_DIR, name), { label: parsed.label, path: relativeLogPath(path.join(TERMINAL_DIR, name)), time: parsed.time }));
  }
  const connections = [...byServer.values()]
    .map((item) => ({ ...item, logs: item.logs.sort((a, b) => b.time - a.time), size_bytes: sumLogBytes(item.logs) }))
    .filter((item) => item.logs.length)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  return { system, batch, connections, total_size_bytes: sumLogBytes(system) + sumLogBytes(batch) + connections.reduce((sum, item) => sum + Number(item.size_bytes || 0), 0) };
}

async function searchLogs(query) {
  const value = String(query || "").trim().slice(0, 200);
  if (!value) return [];
  const listed = listLogs();
  const entries = [
    ...(listed.system || []).map(log => ({...log, category:"system", group_name:"system"})),
    ...(listed.batch || []).map(log => ({...log, category:"batch", group_name:"batch"})),
    ...(listed.connections || []).flatMap(server => (server.logs || []).map(log => ({...log, category:"connection", group_name:"connection", server_name:server.name})))
  ];
  const results = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const index = cursor++;
      const entry = entries[index];
      try {
        const result = await readLogWindow(entry.path, {query:value, limitBytes:4096, contextLines:1, maxMatches:3});
        if (result.matches?.length) {
          results[index] = {...entry, matches:result.matches.slice(0, 3), matches_truncated:Boolean(result.matches_truncated)};
        }
      } catch {}
    }
  };
  await Promise.all(Array.from({length:Math.min(4, Math.max(1, entries.length))}, () => worker()));
  return results.filter(Boolean);
}

function readLog(relPath) {
  return stripAnsi(readRawLog(relPath));
}

function readLogWindow(relPath, options = {}) {
  return readLogWindowFromFile(LOG_DIR, relPath, options);
}

function readRawLog(relPath) {
  const resolved = resolveLogFile(LOG_DIR, String(relPath || ""));
  return fs.readFileSync(resolved, "utf8");
}

function resolveLogPath(relPath) {
  return resolveLogFile(LOG_DIR, String(relPath || ""));
}

function deleteLogs(paths) {
  ensureLogDirs();
  const deleted = [];
  const errors = [];
  for (const item of paths || []) {
    try {
      const resolved = resolveLogPath(item);
      const queued = logWriteQueues.get(resolved);
      if (queued?.timer) clearTimeout(queued.timer);
      logWriteQueues.delete(resolved);
      fs.unlinkSync(resolved);
      deleted.push(String(item));
    } catch (error) {
      errors.push({ path: String(item), error: error.message });
    }
  }
  return { deleted, errors };
}

function cleanupCandidates(days) {
  const age = Number(days);
  if (!Number.isFinite(age) || age <= 0) throw new Error("days must be a positive number");
  const cutoff = Date.now() - age * 24 * 60 * 60 * 1000;
  const listed = listLogs();
  const entries = [
    ...(listed.system || []),
    ...(listed.batch || []),
    ...(listed.connections || []).flatMap(group => group.logs || [])
  ];
  const writing = new Set([...logWriteQueues.keys()].map(file => path.resolve(file)));
  return entries.filter(item => {
    if (!item?.path || writing.has(path.resolve(resolveLogPath(item.path)))) return false;
    const modified = Number(item.modified_at || 0);
    return modified > 0 && modified < cutoff;
  }).map(item => ({path:item.path, bytes:Number(item.size_bytes || 0), modified_at:Number(item.modified_at || 0)}));
}

function previewLogsOlderThan(days) {
  const candidates = cleanupCandidates(days);
  return {days:Number(days), files:candidates.length, bytes:candidates.reduce((sum, item) => sum + item.bytes, 0), freed_bytes:candidates.reduce((sum, item) => sum + item.bytes, 0)};
}

function deleteLogsOlderThan(days) {
  const candidates = cleanupCandidates(days);
  const result = deleteLogs(candidates.map(item => item.path));
  return {...result, days:Number(days), files:candidates.length, bytes:candidates.filter(item => result.deleted.includes(item.path)).reduce((sum, item) => sum + item.bytes, 0), freed_bytes:candidates.filter(item => result.deleted.includes(item.path)).reduce((sum, item) => sum + item.bytes, 0)};
}

function getLogSettings() {
  return { ...currentLogSettings };
}

function updateLogSettings(value) {
  currentLogSettings = writeLogSettings(LOG_SETTINGS_FILE, value || {});
  const cleanup = enforceConfiguredLogRetention();
  return { ...currentLogSettings, cleanup };
}

function enforceConfiguredLogRetention() {
  ensureLogDirs();
  return enforceLogRetention(LOG_DIR, currentLogSettings, new Set([...logWriteQueues.keys()].map(file => path.resolve(file))));
}

const logRetentionTimer = setInterval(() => {
  try { enforceConfiguredLogRetention(); } catch {}
}, 6 * 60 * 60 * 1000);
logRetentionTimer.unref?.();
setTimeout(() => {
  try { enforceConfiguredLogRetention(); } catch {}
}, 1000).unref?.();

function stripAnsi(text) {
  return String(text || "")
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|[PX^_][\s\S]*?\x1B\\)/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

module.exports = {
  appendSystemLog,
  createTerminalLog,
  appendTerminalLog,
  createBatchCommandLog,
  appendBatchCommandLog,
  listLogs,
  getLogSettings,
  updateLogSettings,
  enforceConfiguredLogRetention,
  readLogWindow,
  searchLogs,
  readLog,
  readRawLog,
  deleteLogs
  ,previewLogsOlderThan, deleteLogsOlderThan, resolveLogPath
};
