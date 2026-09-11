const fs = require("node:fs");
const fsp = fs.promises;
const os = require("node:os");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { DATA_DIR } = require("./config");
const { notifyEvent } = require("./notifications");
const { getConnection } = require("./db");
const { deleteRemoteFile, listRemoteDir, makeRemoteDir, readRemoteBinaryFile, readRemoteFileMetadata, resolveRemoteUploadTarget } = require("./sftp");
const { startUploadJob, startDownloadJob, waitForSftpJob } = require("./sftp-jobs");
const repository = require("./sftp-automation-repository");

const MAX_FILES = 20000;
const MAX_RUN_DETAILS = 1000;
const CONTENT_HASH_LIMIT = 100 * 1024 * 1024;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
const running = new Set<string>();
const watchers = new Map<number, any>();
let schedulerTimer: any = null;
let schedulerStarted = false;
let schedulerTicking = false;

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }
function yieldWork() { return new Promise(resolve => setImmediate(resolve)); }
function recordRunDetail(summary: any, detail: any) {
  if (!Array.isArray(summary.details)) summary.details = [];
  if (summary.details.length < MAX_RUN_DETAILS) summary.details.push({
    path:String(detail?.path || "").slice(0, 4096),
    action:String(detail?.action || "skipped").slice(0, 40),
    reason:String(detail?.reason || "").slice(0, 240),
    bytes:Math.max(0, Number(detail?.bytes || 0))
  });
  else summary.details_omitted = Number(summary.details_omitted || 0) + 1;
}

async function localFileHash(file: string) {
  const handle = await fsp.open(file, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (!result.bytesRead) break;
      hash.update(buffer.subarray(0, result.bytesRead));
      await yieldWork();
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

async function remoteFileHash(connectionId: number, remotePath: string) {
  const {content} = await readRemoteBinaryFile(connectionId, remotePath, CONTENT_HASH_LIMIT);
  const hash = createHash("sha256");
  for (let offset = 0; offset < content.length; offset += 1024 * 1024) {
    hash.update(content.subarray(offset, offset + 1024 * 1024));
    await yieldWork();
  }
  return hash.digest("hex");
}

async function sameSyncContent(connectionId: number, local: any, remote: any, options: any) {
  if (!local || !remote || Number(local.size || 0) !== Number(remote.size || 0)) return false;
  if (options?.compare_content === false || Number(local.size || 0) > CONTENT_HASH_LIMIT) {
    return Math.abs(Number(local.mtime || 0) - Number(remote.mtime || 0)) <= 2;
  }
  const [localHash, remoteHash] = await Promise.all([localFileHash(local.local_path), remoteFileHash(connectionId, remote.remote_path)]);
  return localHash === remoteHash;
}
async function assertStableLocalFile(filePath: string, initial: any) {
  const before = await fsp.stat(filePath);
  if (before.size !== initial.size || Math.floor(before.mtimeMs / 1000) !== initial.mtime) throw new Error(`本机文件在扫描期间发生变化：${filePath}`);
  await new Promise(resolve => setTimeout(resolve, 120));
  const after = await fsp.stat(filePath);
  if (before.size !== after.size || Math.floor(before.mtimeMs / 1000) !== Math.floor(after.mtimeMs / 1000)) throw new Error(`本机文件仍在写入，已暂停同步：${filePath}`);
  return after;
}
function normalizeRelative(value: any) { return String(value || "").replace(/\\/g, "/").replace(/^\.\//, ""); }
function joinRemote(root: string, relative = "") {
  const base = String(root || ".").replace(/\\/g, "/").replace(/\/+$/, "") || ".";
  const child = normalizeRelative(relative);
  if (!child) return base;
  return base === "." ? child : base === "/" ? `/${child}` : `${base}/${child}`;
}
function excluded(relative: string, patterns: string) {
  const source = normalizeRelative(relative);
  return String(patterns || "").split(/[\r\n,]+/).map(item => item.trim()).filter(Boolean).some(pattern => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
    return new RegExp(`(?:^|/)${escaped}(?:$|/)`, "i").test(source);
  });
}
function hiddenName(name: string) { return String(name || "").startsWith("."); }
function shouldKeep(relative: string, name: string, options: any) {
  if (!options.include_hidden && hiddenName(name)) return false;
  if (/^(?:\.git|node_modules|\.DS_Store|Thumbs\.db|.*\.tmp|.*\.swp|.*~)$/.test(name)) return false;
  return !excluded(relative, options.excludes);
}

async function localTree(root: string, options: any) {
  const result = new Map<string, any>();
  const stat = await fsp.lstat(root);
  if (stat.isSymbolicLink()) throw new Error("自动化任务跳过符号链接，源路径本身不能是符号链接");
  if (stat.isFile()) {
    if (!options.max_file_size || stat.size <= options.max_file_size) result.set(path.basename(root), {relative:path.basename(root), local_path:root, size:stat.size, mtime:Math.floor(stat.mtimeMs / 1000)});
    return result;
  }
  if (!stat.isDirectory()) throw new Error("本机自动化源路径不是普通文件或目录");
  const pending = [{absolute:root, relative:""}];
  let count = 0;
  while (pending.length) {
    const current = pending.pop();
    const entries = await fsp.readdir(current.absolute, {withFileTypes:true});
    for (const entry of entries) {
      const relative = normalizeRelative(path.posix.join(current.relative, entry.name));
      if (!shouldKeep(relative, entry.name, options)) continue;
      const absolute = path.join(current.absolute, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push({absolute, relative});
      else if (entry.isFile()) {
        const entryStat = await fsp.stat(absolute);
        if (!options.max_file_size || entryStat.size <= options.max_file_size) result.set(relative, {relative, local_path:absolute, size:entryStat.size, mtime:Math.floor(entryStat.mtimeMs / 1000)});
        count += 1;
        if (count > MAX_FILES) throw new Error(`本机目录文件数量超过 ${MAX_FILES}，请增加排除规则`);
        if (count % 64 === 0) await yieldWork();
      }
    }
    await yieldWork();
  }
  return result;
}

async function remoteTree(connectionId: number, root: string, options: any) {
  const result = new Map<string, any>();
  const pending = [{remote:root, relative:""}];
  let count = 0;
  while (pending.length) {
    const current = pending.pop();
    let page = 1;
    while (true) {
      const listing = await listRemoteDir(connectionId, current.remote, {page, page_size:200, refresh:page === 1});
      for (const entry of listing.entries || []) {
        const name = String(entry.name || "");
        const relative = normalizeRelative(path.posix.join(current.relative, name));
        if (!name || name === "." || name === ".." || !shouldKeep(relative, name, options) || entry.is_symlink) continue;
        const remote = joinRemote(root, relative);
        if (entry.type === "dir") pending.push({remote, relative});
        else if (entry.type === "file") {
          const size = Math.max(0, Number(entry.size || 0));
          if (!options.max_file_size || size <= options.max_file_size) result.set(relative, {relative, remote_path:remote, size, mtime:Math.max(0, Number(entry.mtime || 0))});
          count += 1;
          if (count > MAX_FILES) throw new Error(`远程目录文件数量超过 ${MAX_FILES}，请增加排除规则`);
          if (count % 64 === 0) await yieldWork();
        }
      }
      if (page >= Number(listing.total_pages || 1)) break;
      page += 1;
    }
    await yieldWork();
  }
  return result;
}

function positiveInteger(value: any, fallback: number, maximum: number) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(1, Math.min(maximum, number)) : fallback;
}

function nextFromAnchor(anchorMs: number, periodMs: number, fromMs: number) {
  if (!Number.isFinite(anchorMs) || anchorMs <= 0) anchorMs = fromMs;
  if (anchorMs <= fromMs) anchorMs += Math.ceil((fromMs - anchorMs + 1) / periodMs) * periodMs;
  return Math.floor(anchorMs / 1000);
}

function timeOfDay(date: Date, schedule: any) {
  date.setHours(Math.max(0, Math.min(23, Number(schedule.hour) || 0)), Math.max(0, Math.min(59, Number(schedule.minute) || 0)), 0, 0);
  return date;
}

function scheduleStart(schedule: any, fromMs: number) {
  const value = Number(schedule?.start_at_ms || schedule?.at_ms || 0);
  return Number.isFinite(value) && value > 0 ? value : fromMs;
}

function cronFieldMatches(value: number, field: string, min: number, max: number) {
  const source = String(field || "*").trim();
  if (!source || source === "*") return true;
  return source.split(",").some(part => {
    const [rangeText, stepText] = part.split("/");
    const step = stepText ? Math.max(1, Number(stepText) || 1) : 1;
    if (rangeText === "*") return (value - min) % step === 0;
    const [leftText, rightText] = rangeText.split("-");
    const left = Number(leftText);
    const right = rightText === undefined ? left : Number(rightText);
    if (!Number.isInteger(left) || !Number.isInteger(right) || left < min || right > max || left > right) return false;
    return value >= left && value <= right && (value - left) % step === 0;
  });
}

function nextCronRun(expression: string, fromMs: number, startMs = 0) {
  const fields = String(expression || "").trim().split(/\s+/).filter(Boolean);
  if (fields.length !== 5 && fields.length !== 6) return null;
  const hasSeconds = fields.length === 6;
  const maxMs = fromMs + 366 * 24 * 60 * 60 * 1000;
  const stepMs = hasSeconds ? 1000 : 60 * 1000;
  let cursor = Math.floor(Math.max(fromMs + 1000, startMs || 0) / stepMs) * stepMs;
  if (cursor <= fromMs) cursor += stepMs;
  for (; cursor <= maxMs; cursor += stepMs) {
    const date = new Date(cursor);
    const offset = hasSeconds ? 0 : 1;
    if (hasSeconds && !cronFieldMatches(date.getSeconds(), fields[0], 0, 59)) continue;
    if (!cronFieldMatches(date.getMinutes(), fields[offset], 0, 59)) continue;
    if (!cronFieldMatches(date.getHours(), fields[offset + 1], 0, 23)) continue;
    if (!cronFieldMatches(date.getDate(), fields[offset + 2], 1, 31)) continue;
    if (!cronFieldMatches(date.getMonth() + 1, fields[offset + 3], 1, 12)) continue;
    if (!cronFieldMatches(date.getDay(), fields[offset + 4], 0, 7)) continue;
    return Math.floor(cursor / 1000);
  }
  return null;
}

function previewCronRuns(expression: string, fromMs = Date.now(), count = 3, startMs = 0) {
  const limit = Math.max(1, Math.min(5, Number(count) || 3));
  const result: number[] = [];
  let cursor = Number.isFinite(Number(fromMs)) ? Number(fromMs) : Date.now();
  const anchor = Number.isFinite(Number(startMs)) ? Number(startMs) : 0;
  for (let index = 0; index < limit; index += 1) {
    const next = nextCronRun(expression, cursor, anchor);
    if (!next) break;
    result.push(next * 1000);
    cursor = next * 1000;
  }
  return result;
}

function nextScheduledRun(schedule: any, fromMs = Date.now()) {
  const input = schedule || {};
  const frequency = String(input.frequency || "daily");
  const interval = positiveInteger(input.interval, 1, 10080);
  const startMs = Number(input.start_at_ms || input.at_ms || 0);
  if (frequency === "once" || frequency === "specified_time") {
    const at = startMs || Number(input.at_ms || 0);
    return at > fromMs ? Math.floor(at / 1000) : null;
  }
  if (frequency === "every_second") return nextFromAnchor(scheduleStart(input, fromMs), interval * 1000, fromMs);
  if (frequency === "every_minute") return nextFromAnchor(scheduleStart(input, fromMs), interval * 60 * 1000, fromMs);
  if (frequency === "every_hour") return nextFromAnchor(scheduleStart(input, fromMs), interval * 60 * 60 * 1000, fromMs);
  if (frequency === "countdown") {
    const countdownMs = positiveInteger(input.countdown_seconds, 60, 31 * 24 * 60 * 60) * 1000;
    const due = scheduleStart(input, fromMs) + countdownMs;
    return due > fromMs ? Math.floor(due / 1000) : (startMs ? null : Math.floor((fromMs + countdownMs) / 1000));
  }
  if (frequency === "cron") return nextCronRun(input.cron || input.cron_expression, fromMs, startMs);

  const hour = Math.max(0, Math.min(23, Number(input.hour) || 0));
  const minute = Math.max(0, Math.min(59, Number(input.minute) || 0));
  if (frequency === "half_hour") {
    if (Array.isArray(input.half_hour_slots) && input.half_hour_slots.length === 0) return null;
    const slots: number[] = Array.isArray(input.half_hour_slots) ? [...new Set(input.half_hour_slots.map((value: any) => Number(value)).filter((value: number) => Number.isInteger(value) && value >= 0 && value < 48))] as number[] : [];
    const anchor = startMs || (() => {
      const next = new Date(fromMs + 60 * 1000);
      next.setSeconds(0, 0);
      next.setMinutes(next.getMinutes() < 30 ? 30 : 0);
      if (next.getMinutes() === 0) next.setHours(next.getHours() + 1);
      return next.getTime();
    })();
    if (slots.length) {
      const lowerBound = Math.max(fromMs + 1000, anchor);
      const candidate = new Date(lowerBound);
      candidate.setSeconds(0, 0);
      if (candidate.getMinutes() < 30) candidate.setMinutes(30); else if (candidate.getMinutes() > 30) { candidate.setMinutes(0); candidate.setHours(candidate.getHours() + 1); }
      for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
        const day = new Date(candidate);
        day.setDate(candidate.getDate() + dayOffset);
        for (const slot of slots) {
          const slotDate = new Date(day);
          slotDate.setHours(Math.floor(slot / 2), slot % 2 ? 30 : 0, 0, 0);
          if (slotDate.getTime() >= lowerBound) return Math.floor(slotDate.getTime() / 1000);
        }
      }
      return null;
    }
    return nextFromAnchor(anchor, interval * 30 * 60 * 1000, fromMs);
  }
  if (frequency === "daily") {
    const candidate = timeOfDay(new Date(startMs || fromMs), input);
    if (!startMs) candidate.setDate(new Date(fromMs).getDate());
    return nextFromAnchor(candidate.getTime(), interval * 24 * 60 * 60 * 1000, fromMs);
  }
  if (frequency === "weekly") {
    const anchor = new Date(startMs || fromMs);
    timeOfDay(anchor, input);
    const weekdays: number[] = [...new Set((Array.isArray(input.weekdays) ? input.weekdays : [input.weekday]).map((value: any) => Number(value)).filter((value: number) => Number.isInteger(value) && value >= 0 && value <= 6))] as number[];
    weekdays.sort((a, b) => a - b);
    const selected: number[] = weekdays.length ? weekdays : [1];
    const anchorWeek = new Date(anchor);
    anchorWeek.setHours(0, 0, 0, 0);
    anchorWeek.setDate(anchorWeek.getDate() - anchorWeek.getDay());
    for (let week = 0; week < 104; week += interval) {
      for (const day of selected) {
        const candidate = new Date(anchorWeek);
        candidate.setDate(anchorWeek.getDate() + week * 7 + day);
        timeOfDay(candidate, input);
        if (candidate.getTime() > fromMs && candidate.getTime() >= (startMs || 0)) return Math.floor(candidate.getTime() / 1000);
      }
    }
    return null;
  }
  if (frequency === "monthly") {
    const anchor = new Date(startMs || fromMs);
    timeOfDay(anchor, input);
    const desiredDay = Math.max(1, Math.min(31, Number(input.day) || (startMs ? anchor.getDate() : 1)));
    const anchorMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1, anchor.getHours(), anchor.getMinutes());
    for (let offset = 0; offset < 120; offset += interval) {
      const candidate = new Date(anchorMonth);
      candidate.setMonth(anchorMonth.getMonth() + offset, 1);
      candidate.setDate(Math.min(desiredDay, new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate()));
      if (candidate.getTime() > fromMs && candidate.getTime() >= (startMs || 0)) return Math.floor(candidate.getTime() / 1000);
    }
    return null;
  }
  if (frequency === "yearly") {
    const anchor = new Date(startMs || fromMs);
    timeOfDay(anchor, input);
    const desiredMonth = Math.max(1, Math.min(12, Number(input.month) || anchor.getMonth() + 1));
    const desiredDay = Math.max(1, Math.min(31, Number(input.day) || anchor.getDate()));
    for (let yearOffset = 0; yearOffset < 20; yearOffset += interval) {
      const candidate = new Date(anchor.getFullYear() + yearOffset, desiredMonth - 1, 1, anchor.getHours(), anchor.getMinutes());
      candidate.setDate(Math.min(desiredDay, new Date(candidate.getFullYear(), desiredMonth, 0).getDate()));
      if (candidate.getTime() > fromMs && candidate.getTime() >= (startMs || 0)) return Math.floor(candidate.getTime() / 1000);
    }
    return null;
  }
  return nextFromAnchor(timeOfDay(new Date(fromMs), input).getTime(), 24 * 60 * 60 * 1000, fromMs);
}

function nextAutomationRun(automation: any, fromMs = Date.now()) {
  if (!automation?.enabled) return null;
  const mode = String(automation.trigger_mode || "manual");
  const frequency = String(automation.schedule?.frequency || "");
  if (mode === "continuous" || frequency === "realtime") {
    const startAt = Number(automation.schedule?.start_at_ms || 0);
    if (Number.isFinite(startAt) && startAt > fromMs) return Math.floor(startAt / 1000);
    return Math.floor((fromMs + 10 * 1000) / 1000);
  }
  if (automation.kind === "transfer" || mode === "schedule") return nextScheduledRun(automation.schedule, fromMs);
  if (mode === "interval") return Math.floor((fromMs + Math.max(1, Number(automation.options?.interval_minutes || 15)) * 60 * 1000) / 1000);
  return null;
}

function isRealtimeAutomation(automation: any, atMs = Date.now()) {
  if (automation?.kind !== "sync") return false;
  if (automation.trigger_mode !== "continuous" && automation.schedule?.frequency !== "realtime") return false;
  const startAt = Number(automation.schedule?.start_at_ms || 0);
  return !Number.isFinite(startAt) || startAt <= 0 || startAt <= atMs;
}

function isOneShotAutomation(automation: any) {
  return automation?.trigger_mode === "schedule" && ["once", "specified_time", "countdown"].includes(String(automation.schedule?.frequency || ""));
}

function localTarget(root: string, relative: string) {
  const target = path.resolve(root, relative);
  const rel = path.relative(path.resolve(root), target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("自动化任务本机目标路径越界");
  return target;
}

function availableLocalTarget(target: string) {
  if (!fs.existsSync(target)) return target;
  const parsed = path.parse(target);
  for (let index = 1; index < 10000; index += 1) {
    const next = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
    if (!fs.existsSync(next)) return next;
  }
  throw new Error("无法为自动化任务生成可用的本机文件名");
}

async function remoteExists(connectionId: number, remotePath: string) {
  try { await readRemoteFileMetadata(connectionId, remotePath); return true; } catch {
    try {
      const parent = path.posix.dirname(remotePath);
      const name = path.posix.basename(remotePath);
      const listing = await listRemoteDir(connectionId, parent, {page:1,page_size:200,query:name,refresh:true});
      return Boolean((listing.entries || []).find(item => String(item.name) === name));
    } catch { return false; }
  }
}

async function resolveRemoteTarget(connectionId: number, target: string, conflict: string) {
  if (!(await remoteExists(connectionId, target))) return {path:target, skipped:false};
  if (conflict === "skip") return {path:target, skipped:true};
  if (conflict === "rename") {
    return {path:(await resolveRemoteUploadTarget(connectionId, path.posix.dirname(target), path.posix.basename(target), "rename")).path, skipped:false};
  }
  return {path:target, skipped:false};
}

async function runUploadFile(connectionId: number, source: any, target: string, options: any, summary: any) {
  if (source.local_path) await assertStableLocalFile(source.local_path, source);
  await makeRemoteDir(connectionId, path.posix.dirname(target));
  const resolved = await resolveRemoteTarget(connectionId, target, options.conflict);
  if (resolved.skipped) { summary.skipped += 1; recordRunDetail(summary, {path:source.relative,action:"skipped",reason:"target_exists"}); return; }
  const result = startUploadJob(connectionId, source.local_path, resolved.path, source.size, {ownsLocalPath:false,silentNotifications:true,internalAutomation:true});
  await waitForSftpJob(result.id);
  summary.transferred += 1;
  summary.bytes += Number(source.size || 0);
  recordRunDetail(summary, {path:source.relative,action:"uploaded",bytes:source.size});
}

async function runDownloadFile(connectionId: number, source: any, target: string, options: any, runId: string, summary: any) {
  const existing = fs.existsSync(target);
  if (existing && options.conflict === "skip") { summary.skipped += 1; recordRunDetail(summary, {path:source.relative,action:"skipped",reason:"target_exists"}); return; }
  let finalTarget = target;
  if (existing && options.conflict === "rename") finalTarget = availableLocalTarget(target);
  if (existing && options.conflict === "overwrite") {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || stat.isDirectory()) throw new Error(`本机目标不是可覆盖的普通文件：${target}`);
  }
  // Keep the temporary download on the destination volume so the final move
  // remains atomic on Windows and other multi-volume installations.
  const staging = path.join(path.dirname(target), `.terma-automation-${runId}-${String(summary.processed || 0)}`);
  await fsp.mkdir(staging, {recursive:true});
  const atomic = `${finalTarget}.terma-${runId}.part`;
  try {
    const result = startDownloadJob(connectionId, source.remote_path, {deliveryMode:"desktop",autoSaveDirectory:staging,silentNotifications:true,internalAutomation:true});
    const job: any = await waitForSftpJob(result.id);
    if (!job.saved_path || !fs.existsSync(job.saved_path)) throw new Error(job.delivery_error || `下载任务未生成本机文件：${source.remote_path}`);
    await fsp.mkdir(path.dirname(finalTarget), {recursive:true});
    if (fs.existsSync(atomic)) fs.rmSync(atomic, {recursive:true,force:true});
    await fsp.rename(job.saved_path, atomic);
    if (existing && options.conflict === "overwrite") fs.rmSync(finalTarget, {recursive:true,force:true});
    await fsp.rename(atomic, finalTarget);
  } finally {
    try { if (fs.existsSync(atomic)) fs.rmSync(atomic, {recursive:true,force:true}); } catch {}
    try { if (fs.existsSync(staging)) fs.rmSync(staging, {recursive:true,force:true}); } catch {}
  }
  summary.transferred += 1;
  summary.bytes += Number(source.size || 0);
  recordRunDetail(summary, {path:source.relative,action:"downloaded",bytes:source.size});
}

async function deleteLocalSyncedFile(root: string, relative: string, summary: any) {
  const target = localTarget(root, relative);
  const stat = await fsp.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`本机目标不是可删除的普通文件：${target}`);
  await fsp.unlink(target);
  summary.deleted += 1;
  recordRunDetail(summary, {path:relative,action:"deleted_local"});
}

async function deleteRemoteSyncedFile(connectionId: number, root: string, relative: string, summary: any) {
  await deleteRemoteFile(connectionId, joinRemote(root, relative));
  summary.deleted += 1;
  recordRunDetail(summary, {path:relative,action:"deleted_remote"});
}

function matchesAutomationSnapshot(value: any, snapshot: any) {
  return Boolean(value && snapshot && Number(value.size || 0) === Number(snapshot.size || 0) && Math.abs(Number(value.mtime || 0) - Number(snapshot.mtime || 0)) <= 2);
}

async function matchesDeletionSnapshot(connectionId: number, value: any, snapshot: any, side: "local" | "remote", options: any) {
  if (!matchesAutomationSnapshot(value, snapshot)) return false;
  if (options?.compare_content === false || Number(value.size || 0) > CONTENT_HASH_LIMIT) return true;
  const expected = String(snapshot?.sha256 || "");
  if (!/^[a-f0-9]{64}$/i.test(expected)) return false;
  const actual = side === "local" ? await localFileHash(value.local_path) : await remoteFileHash(connectionId, value.remote_path);
  return actual === expected;
}

async function remoteTargetMatchesSource(connectionId: number, target: string, source: any) {
  try {
    const metadata = await readRemoteFileMetadata(connectionId, target);
    return Number(metadata.size || 0) === Number(source.size || 0);
  } catch {
    return false;
  }
}

function localTargetMatchesSource(target: string, source: any) {
  try {
    const stat = fs.lstatSync(target);
    return stat.isFile() && !stat.isSymbolicLink() && Number(stat.size || 0) === Number(source.size || 0);
  } catch {
    return false;
  }
}

async function executeTransfer(automation: any, runId: string) {
  const options = automation.options || {};
  const summary: any = {files:0,transferred:0,deleted:0,skipped:0,conflicts:0,failed:0,bytes:0,processed:0,details:[]};
  const storedBaseline = repository.getBaseline(automation.id);
  const baseline = !storedBaseline?.corrupted && automationFingerprintMatches(storedBaseline?.state?.meta?.fingerprint, automation) ? storedBaseline : null;
  const localStat = await fsp.lstat(automation.local_path);
  const upload = automation.direction === "upload";
  let sourceLocal = new Map<string, any>();
  let sourceRemote = new Map<string, any>();
  if (upload) {
    const local = await localTree(automation.local_path, options);
    sourceLocal = local;
    for (const source of local.values()) {
      const relative = localStat.isDirectory() ? source.relative : "";
      const target = localStat.isDirectory() ? joinRemote(automation.remote_path, relative) : automation.remote_path;
      summary.files += 1; summary.processed += 1;
      if (matchesAutomationSnapshot(source, baseline?.state?.local?.[source.relative]) && await remoteTargetMatchesSource(automation.connection_id, target, source)) { summary.skipped += 1; recordRunDetail(summary, {path:source.relative,action:"skipped",reason:"unchanged"}); continue; }
      await runUploadFile(automation.connection_id, source, target, options, summary);
      if (summary.processed % 8 === 0) await yieldWork();
    }
  } else {
    let remote: Map<string, any>;
    let remoteIsFile = true;
    try { const metadata = await readRemoteFileMetadata(automation.connection_id, automation.remote_path); remote = new Map([[path.posix.basename(automation.remote_path), {relative:path.posix.basename(automation.remote_path),remote_path:automation.remote_path,size:metadata.size,mtime:metadata.mtime}]]); }
    catch { remoteIsFile = false; remote = await remoteTree(automation.connection_id, automation.remote_path, options); }
    sourceRemote = remote;
    const targetStat = fs.existsSync(automation.local_path) ? fs.lstatSync(automation.local_path) : null;
    for (const source of remote.values()) {
      const relative = remoteIsFile && targetStat?.isFile() ? "" : source.relative;
      const target = relative ? localTarget(automation.local_path, relative) : automation.local_path;
      summary.files += 1; summary.processed += 1;
      if (matchesAutomationSnapshot(source, baseline?.state?.remote?.[source.relative]) && localTargetMatchesSource(target, source)) { summary.skipped += 1; recordRunDetail(summary, {path:source.relative,action:"skipped",reason:"unchanged"}); continue; }
      await runDownloadFile(automation.connection_id, source, target, options, runId, summary);
      if (summary.processed % 8 === 0) await yieldWork();
    }
  }
  const state = baselineState(sourceLocal, sourceRemote);
  state.meta = {fingerprint:automationFingerprint(automation),fingerprint_version:2,version:1,source_only:true};
  repository.saveBaseline(automation.id, state, baselineChecksum(state));
  summary.baseline = "saved";
  return summary;
}

async function executeSync(automation: any, runId: string) {
  const options = automation.options || {};
  const summary: any = {files:0,transferred:0,deleted:0,skipped:0,conflicts:0,failed:0,bytes:0,processed:0,details:[]};
  const [local, remote] = await Promise.all([localTree(automation.local_path, options), remoteTree(automation.connection_id, automation.remote_path, options)]);
  const storedBaseline = repository.getBaseline(automation.id);
  // A transfer snapshot only describes its source. When a former transfer is
  // promoted to safe sync, start with a fresh two-sided baseline instead of
  // treating that source-only snapshot as synchronization history.
  const compatibleBaseline = storedBaseline?.state?.meta?.source_only
    || !automationFingerprintMatches(storedBaseline?.state?.meta?.fingerprint, automation)
    ? null
    : storedBaseline;
  const baseline = compatibleBaseline;
  summary.baseline = storedBaseline?.corrupted ? "corrupted_repreview" : storedBaseline && !baseline ? "rules_changed_preview" : baseline ? "loaded" : "initial_preview";
  summary.baseline_version = baseline?.version || 1;
  if (storedBaseline?.corrupted) throw new Error("同步基线校验失败，已暂停并回到首次非破坏式预览");
  const direction = automation.direction;
  const baselineLocal = baseline?.state?.local || {};
  const baselineRemote = baseline?.state?.remote || {};
  const relatives = [...new Set([...local.keys(), ...remote.keys()])].sort((a,b) => a.localeCompare(b));
  const localRootStat = await fsp.lstat(automation.local_path);
  for (const relative of relatives) {
    const left = local.get(relative); const right = remote.get(relative);
    summary.files += 1; summary.processed += 1;
    try {
      if (!left && right) {
        const trackedPair = Boolean(baselineLocal[relative] && baselineRemote[relative]);
        const mayDeleteRemote = Boolean(options.propagate_deletes && trackedPair && (direction === "upload" || direction === "bidirectional"));
        if (mayDeleteRemote) {
          if (await matchesDeletionSnapshot(automation.connection_id, right, baselineRemote[relative], "remote", options)) await deleteRemoteSyncedFile(automation.connection_id, automation.remote_path, relative, summary);
          else { summary.conflicts += 1; recordRunDetail(summary, {path:relative,action:"delete_conflict",reason:"remote_changed"}); }
          continue;
        }
        if (direction === "upload") { summary.skipped += 1; recordRunDetail(summary, {path:relative,action:"skipped",reason:"remote_only"}); continue; }
        await runDownloadFile(automation.connection_id, right, localTarget(automation.local_path, relative), options, runId, summary);
      } else if (left && !right) {
        const trackedPair = Boolean(baselineLocal[relative] && baselineRemote[relative]);
        const mayDeleteLocal = Boolean(options.propagate_deletes && trackedPair && (direction === "download" || direction === "bidirectional"));
        if (mayDeleteLocal) {
          if (await matchesDeletionSnapshot(automation.connection_id, left, baselineLocal[relative], "local", options)) await deleteLocalSyncedFile(automation.local_path, relative, summary);
          else { summary.conflicts += 1; recordRunDetail(summary, {path:relative,action:"delete_conflict",reason:"local_changed"}); }
          continue;
        }
        if (direction === "download") { summary.skipped += 1; recordRunDetail(summary, {path:relative,action:"skipped",reason:"local_only"}); continue; }
        await runUploadFile(automation.connection_id, left, joinRemote(automation.remote_path, relative), options, summary);
      } else if (left && right) {
        const hasBaseline = Boolean(baselineLocal[relative] || baselineRemote[relative]);
        const localChanged = hasBaseline ? !matchesAutomationSnapshot(left, baselineLocal[relative]) : true;
        const remoteChanged = hasBaseline ? !matchesAutomationSnapshot(right, baselineRemote[relative]) : true;
        if (hasBaseline && !localChanged && !remoteChanged) { summary.skipped += 1; recordRunDetail(summary, {path:relative,action:"skipped",reason:"unchanged"}); continue; }
        const same = await sameSyncContent(automation.connection_id, left, right, options);
        if (same) { summary.skipped += 1; recordRunDetail(summary, {path:relative,action:"skipped",reason:"same_content"}); continue; }
        if (direction === "upload" || (direction === "bidirectional" && localChanged && !remoteChanged)) await runUploadFile(automation.connection_id, left, joinRemote(automation.remote_path, relative), {...options,conflict:"overwrite"}, summary);
        else if (direction === "download" || (direction === "bidirectional" && remoteChanged && !localChanged)) await runDownloadFile(automation.connection_id, right, localTarget(automation.local_path, relative), {...options,conflict:"overwrite"}, runId, summary);
        else if (direction === "bidirectional") {
          summary.conflicts += 1;
          recordRunDetail(summary, {path:relative,action:"conflict",reason:"both_changed"});
          const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
          const localConflict = localTarget(automation.local_path, `${relative}.terma-conflict-${os.hostname()}-${stamp}`);
          const remoteConflict = `${joinRemote(automation.remote_path, relative)}.terma-conflict-${os.hostname()}-${stamp}`;
          await fsp.mkdir(path.dirname(localConflict), {recursive:true});
          await fsp.copyFile(left.local_path, localConflict);
          await runDownloadFile(automation.connection_id, right, localConflict.replace(/\.terma-conflict-.+$/, `.remote-conflict-${stamp}`), {...options,conflict:"rename"}, runId, summary);
          await runUploadFile(automation.connection_id, left, remoteConflict, {...options,conflict:"rename"}, summary);
        } else { summary.skipped += 1; recordRunDetail(summary, {path:relative,action:"skipped",reason:"direction"}); }
      }
    } catch (error) {
      summary.failed += 1;
      summary.last_error = error.message || String(error);
      recordRunDetail(summary, {path:relative,action:"failed",reason:summary.last_error});
    }
    if (summary.processed % 8 === 0) await yieldWork();
  }
  if (!localRootStat.isDirectory()) throw new Error("文件夹同步的本机路径必须是目录");
  return summary;
}

function baselineState(local: Map<string, any>, remote: Map<string, any>) {
  const state: any = {local:{},remote:{}};
  for (const [key, value] of local) state.local[key] = {size:Number(value.size || 0),mtime:Number(value.mtime || 0)};
  for (const [key, value] of remote) state.remote[key] = {size:Number(value.size || 0),mtime:Number(value.mtime || 0)};
  return state;
}

async function baselineStateWithDeletionHashes(connectionId: number, local: Map<string, any>, remote: Map<string, any>, options: any) {
  const state = baselineState(local, remote);
  if (!options?.propagate_deletes || options?.compare_content === false) return state;
  for (const [key, left] of local) {
    const right = remote.get(key);
    if (!right || Number(left.size || 0) > CONTENT_HASH_LIMIT) continue;
    const [localHash, remoteHash] = await Promise.all([localFileHash(left.local_path), remoteFileHash(connectionId, right.remote_path)]);
    const [localAfter, remoteAfter] = await Promise.all([fsp.stat(left.local_path), readRemoteFileMetadata(connectionId, right.remote_path)]);
    if (Number(localAfter.size || 0) !== Number(left.size || 0) || Math.floor(Number(localAfter.mtimeMs || 0) / 1000) !== Number(left.mtime || 0)
      || Number(remoteAfter.size || 0) !== Number(right.size || 0) || Math.abs(Number(remoteAfter.mtime || 0) - Number(right.mtime || 0)) > 2) {
      throw new Error(`建立删除保护基线时文件发生变化：${left.local_path}`);
    }
    if (localHash !== remoteHash) throw new Error(`建立删除保护基线时两侧内容不一致：${key}`);
    state.local[key].sha256 = localHash;
    state.remote[key].sha256 = localHash;
    await yieldWork();
  }
  return state;
}

function automationFingerprint(automation: any) {
  return repository.automationRuleFingerprint(automation);
}

function automationFingerprintMatches(fingerprint: any, automation: any) {
  return !fingerprint || fingerprint === automationFingerprint(automation) || fingerprint === repository.automationLegacyFingerprint(automation);
}

function baselineChecksum(state: any) {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

async function executeAutomation(automation: any, runId: string) {
  return automation.kind === "transfer" ? executeTransfer(automation, runId) : executeSync(automation, runId);
}

function scheduleTimer() {
  clearTimeout(schedulerTimer);
  schedulerTimer = null;
  if (!schedulerStarted) return;
  const due = repository.listAutomations().filter(item => item.enabled && item.next_run_at).map(item => Number(item.next_run_at)).filter(Number.isFinite).sort((a,b) => a-b)[0];
  if (!due) {
    schedulerTimer = setTimeout(() => void schedulerTick(), 60000);
  } else {
    schedulerTimer = setTimeout(() => void schedulerTick(), Math.max(250, Math.min(60000, due * 1000 - Date.now())));
  }
  schedulerTimer.unref?.();
}

async function schedulerTick() {
  if (!schedulerStarted || schedulerTicking) return;
  schedulerTicking = true;
  try {
    const due = repository.listDue(Math.floor(Date.now() / 1000));
    for (const automation of due) {
      const next = nextAutomationRun(automation, Date.now());
      repository.setScheduleState(automation.id, {next_run_at:next});
      void runAutomation(automation.id, {reason:"schedule"});
    }
    refreshContinuousWatchers();
  } finally {
    schedulerTicking = false;
    scheduleTimer();
  }
}

async function runAutomation(id: any, options: any = {}) {
  const automation = repository.getAutomation(id);
  if (!automation) throw new Error("自动化任务不存在");
  const reason = String(options.reason || "manual");
  if (reason !== "manual" && !automation.enabled) return {ok:false, skipped:true, reason:"disabled"};
  if (running.has(String(automation.id))) return {ok:false, skipped:true, reason:"already_running"};
  running.add(String(automation.id));
  const runId = repository.createRun(automation.id, reason);
  let attempt = 0;
  try {
    while (true) {
      try {
        const summary = await executeAutomation(automation, runId);
        const status = Number(summary.failed || 0) ? "failed" : "done";
        if (automation.kind === "sync" && status === "done" && !summary.conflicts && !summary.failed) {
          const [local, remote] = await Promise.all([localTree(automation.local_path, automation.options || {}), remoteTree(automation.connection_id, automation.remote_path, automation.options || {})]);
          const state = await baselineStateWithDeletionHashes(automation.connection_id, local, remote, automation.options || {});
          state.meta = {fingerprint:automationFingerprint(automation), fingerprint_version:2, version:1};
          repository.saveBaseline(automation.id, state, baselineChecksum(state));
          summary.baseline = "saved";
        }
        repository.finishRun(runId, status, summary, summary.last_error || "");
        repository.setScheduleState(automation.id, {last_status:status,last_error:summary.last_error || ""});
        const hasUserVisibleChange = Number(summary.transferred || 0) > 0 || Number(summary.deleted || 0) > 0 || Number(summary.conflicts || 0) > 0;
        if (automation.options?.notify && (status !== "done" || hasUserVisibleChange)) {
          const taskType = automation.kind === "sync" ? "同步任务" : "传输任务";
          const counts = `处理 ${Number(summary.processed || summary.files || 0)} 项 · 传输 ${Number(summary.transferred || 0)} 项 · 删除 ${Number(summary.deleted || 0)} 项 · 跳过 ${Number(summary.skipped || 0)} 项 · 冲突 ${Number(summary.conflicts || 0)} 项 · 失败 ${Number(summary.failed || 0)} 项`;
          notifyEvent({type:"sftp-automation",level:status === "done" ? "success" : "error",title:`${taskType}${status === "done" ? "已完成" : "失败"}`,message:`${automation.name}\n${counts}${summary.last_error ? `\n${summary.last_error}` : ""}`,action:{view:"sftp-automations",automation_id:automation.id}}, {cooldown_ms:0});
        }
        if (isOneShotAutomation(automation)) repository.setScheduleState(automation.id, {enabled:false,next_run_at:null});
        return {ok:status === "done",run_id:runId,summary};
      } catch (error) {
        if (String(error?.message || error).includes("基线") || String(error?.message || error).includes("规则已变化")) throw error;
        if (attempt >= MAX_RETRIES - 1) throw error;
        await sleep(RETRY_DELAYS[attempt]);
        attempt += 1;
      }
    }
  } catch (error) {
    const message = error.message || String(error);
    repository.finishRun(runId, "failed", {attempts:attempt + 1}, message);
    repository.setScheduleState(automation.id, {last_status:"needs_attention",last_error:message});
    if (automation.options?.notify) notifyEvent({type:"sftp-automation",level:"error",title:`${automation.kind === "sync" ? "同步任务" : "传输任务"}失败`,message:`${automation.name}\n${message}`,action:{view:"sftp-automations",automation_id:automation.id}}, {cooldown_ms:0});
    return {ok:false,run_id:runId,error:message};
  } finally {
    running.delete(String(automation.id));
    refreshContinuousWatchers();
    scheduleTimer();
  }
}

function refreshContinuousWatchers() {
  const active: Map<number, any> = new Map(repository.listAutomations().filter(item => item.enabled && isRealtimeAutomation(item)).map(item => [Number(item.id), item] as [number, any]));
  for (const [id, watcher] of watchers) {
    if (active.has(id)) continue;
    try { watcher.close(); } catch {}
    watchers.delete(id);
  }
  for (const [id, automation] of active) {
    if (watchers.has(id)) continue;
    try {
      const watcher = fs.watch(automation.local_path, {recursive:true}, () => {
        clearTimeout(watcher.debounce);
        watcher.debounce = setTimeout(() => void runAutomation(id, {reason:"change"}), 2000);
        watcher.debounce.unref?.();
      });
      watchers.set(id, watcher);
    } catch {
      // Platforms without recursive fs.watch still get the bounded remote
      // and local scan created by the real-time scheduler.
    }
  }
}

function syncAutomationSchedule(id: any, force = false) {
  const automation = repository.getAutomation(id);
  if (!automation) return null;
  const next = !automation.enabled ? null : (!force && automation.next_run_at && Number(automation.next_run_at) > Math.floor(Date.now() / 1000) ? automation.next_run_at : nextAutomationRun(automation));
  const result = repository.setScheduleState(id, {next_run_at:next});
  refreshContinuousWatchers();
  scheduleTimer();
  return result;
}

function handleMissedAutomation(automation: any, nowMs = Date.now()) {
  if (!automation?.enabled || !automation.next_run_at) return false;
  const dueAt = Number(automation.next_run_at) * 1000;
  if (!Number.isFinite(dueAt) || dueAt > nowMs) return false;
  const policy = automation.missed_policy === "skip" ? "skip" : "run_once";
  const oneShot = isOneShotAutomation(automation);
  if (policy === "skip" && oneShot) {
    repository.setScheduleState(automation.id, {enabled:false,next_run_at:null,last_status:"paused",last_error:"Terma 重启时已错过一次性执行时间，任务已跳过"});
    return true;
  }
  const next = oneShot ? null : nextAutomationRun(automation, nowMs);
  repository.setScheduleState(automation.id, {next_run_at:next,last_status:"idle",last_error:policy === "skip" ? "Terma 重启时已跳过错过的执行" : ""});
  if (policy === "run_once") void runAutomation(automation.id, {reason:"missed"});
  return true;
}

function startSftpAutomationScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  repository.recoverRunningRuns();
  for (const automation of repository.listAutomations()) {
    if (!automation.enabled) continue;
    if (automation.next_run_at && Number(automation.next_run_at) * 1000 <= Date.now()) handleMissedAutomation(automation);
    else if (!automation.next_run_at) syncAutomationSchedule(automation.id, true);
  }
  refreshContinuousWatchers();
  void schedulerTick();
}

function stopSftpAutomationScheduler() {
  schedulerStarted = false;
  clearTimeout(schedulerTimer);
  schedulerTimer = null;
  for (const watcher of watchers.values()) { try { clearTimeout(watcher.debounce); watcher.close(); } catch {} }
  watchers.clear();
}

function listAutomationRuns(id: any, limit = 100) { return repository.listRuns(id, limit); }
function listAutomationRunsPage(id: any, page = 1) { return repository.listRunsPage(id, page); }

module.exports = {
  deleteAutomation:repository.deleteAutomation,
  clearAutomationRuns:repository.clearRuns,
  finishRun:repository.finishRun,
  getAutomation:repository.getAutomation,
  listAutomationRuns,
  listAutomationRunsPage,
  listAutomations:repository.listAutomations,
  nextAutomationRun,
  nextScheduledRun,
  previewCronRuns,
  reorderAutomations:repository.reorderAutomations,
  runAutomation,
  saveAutomation:repository.saveAutomation,
  setAutomationHistoryLimit:repository.setHistoryLimit,
  setScheduleState:repository.setScheduleState,
  startSftpAutomationScheduler,
  stopSftpAutomationScheduler,
  syncAutomationSchedule,
  __test:{assertStableLocalFile,excluded,handleMissedAutomation,localTarget,nextAutomationRun,normalizeRelative,previewCronRuns,shouldKeep}
};
