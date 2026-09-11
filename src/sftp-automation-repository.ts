const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { all, get, getConnection, run, now } = require("./db");

const AUTOMATION_KINDS = new Set(["transfer", "sync"]);
const TRANSFER_DIRECTIONS = new Set(["upload", "download"]);
const SYNC_DIRECTIONS = new Set(["upload", "download", "bidirectional"]);
const TRIGGER_MODES = new Set(["schedule", "manual", "interval", "continuous"]);
const CONFLICT_MODES = new Set(["skip", "rename", "overwrite"]);
const SCHEDULE_FREQUENCIES = new Set([
  "once", "every_second", "every_minute", "every_hour", "daily", "weekly", "monthly",
  "yearly", "specified_time", "countdown", "half_hour", "cron", "realtime", "legacy_manual"
]);

function fail(message: string, code = "SFTP_AUTOMATION_INVALID") {
  const error: any = new Error(message);
  error.code = code;
  throw error;
}

function asObject(value: any, fallback: any = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return value;
}

function text(value: any, fallback = "", maximum = 4096) {
  return String(value ?? fallback).trim().slice(0, maximum);
}

function assertNoSymlinkParents(target: string) {
  let current = path.resolve(target);
  const missing: string[] = [];
  while (!fs.existsSync(current)) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const item of [current, ...missing.reverse()]) {
    try {
      if (fs.lstatSync(item).isSymbolicLink()) fail("本机路径不能经过符号链接", "SFTP_AUTOMATION_SYMLINK_PATH");
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function normalizeLocalPath(value: any) {
  const raw = text(value, "", 4096);
  if (!raw || !path.isAbsolute(raw) || raw.includes("\0")) fail("本机路径必须是绝对路径");
  const resolved = path.resolve(raw);
  if (resolved === path.parse(resolved).root) fail("不能把磁盘根目录作为自动化任务目录");
  assertNoSymlinkParents(resolved);
  try {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) fail("本机路径不能是符号链接", "SFTP_AUTOMATION_SYMLINK_PATH");
    if (!stat.isFile() && !stat.isDirectory()) fail("本机路径必须是文件或目录");
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
    const parent = path.dirname(resolved);
    if (!fs.existsSync(parent)) fail("本机路径的父目录不存在");
    if (!fs.statSync(parent).isDirectory()) fail("本机路径的父级不是目录");
  }
  return resolved;
}

function normalizeRemotePath(value: any) {
  const raw = text(value, ".", 4096).replace(/\\/g, "/");
  if (!raw || raw.includes("\0")) fail("远程路径无效");
  const normalized = path.posix.normalize(raw);
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("\0")) fail("远程路径不能越出连接目录");
  return normalized || ".";
}

function normalizeSchedule(value: any, existing: any = {}) {
  const input = {...asObject(existing), ...asObject(value)};
  const frequency = SCHEDULE_FREQUENCIES.has(String(input.frequency || "")) ? String(input.frequency) : "daily";
  const hour = Number(input.hour);
  const minute = Number(input.minute);
  const intervalValue = Number(input.interval ?? input.interval_value ?? 1);
  const intervalLimits: Record<string, [number, number, number]> = {
    every_second:[1, 86400, 1], every_minute:[1, 10080, 1], every_hour:[1, 8760, 1], daily:[1, 365, 1],
    weekly:[1, 52, 1], monthly:[1, 12, 1], yearly:[1, 10, 1], half_hour:[1, 48, 1]
  };
  const [intervalMin, intervalMax, intervalDefault] = intervalLimits[frequency] || [1, 1, 1];
  const interval = Number.isSafeInteger(intervalValue) ? Math.max(intervalMin, Math.min(intervalMax, intervalValue)) : intervalDefault;
  const weekdaysInput = Array.isArray(input.weekdays) ? input.weekdays : [input.weekday];
  const weekdays: number[] = [...new Set(weekdaysInput.map(item => Number(item)).filter(item => Number.isInteger(item) && item >= 0 && item <= 6))] as number[];
  weekdays.sort((a, b) => a - b);
  const startAt = Number(input.start_at_ms ?? input.startAtMs ?? 0);
  const atMs = Number(input.at_ms);
  const startAtMs = Number.isSafeInteger(startAt) && startAt > 0 ? startAt : 0;
  const normalizedAtMs = Number.isSafeInteger(atMs) && atMs > 0 ? atMs : 0;
  const month = Number(input.month);
  const countdown = Number(input.countdown_seconds ?? input.countdown ?? 60);
  const halfHourSlots: number[] = Array.isArray(input.half_hour_slots) ? [...new Set(input.half_hour_slots.map(item => Number(item)).filter(item => Number.isInteger(item) && item >= 0 && item < 48))] as number[] : [];
  halfHourSlots.sort((a, b) => a - b);
  const normalized: any = {
    frequency,
    hour:Number.isInteger(hour) ? Math.max(0, Math.min(23, hour)) : 0,
    minute:Number.isInteger(minute) ? Math.max(0, Math.min(59, minute)) : 0,
    interval,
    weekday:Number.isInteger(Number(input.weekday)) ? Math.max(0, Math.min(6, Number(input.weekday))) : (weekdays[0] ?? 1),
    weekdays:weekdays.length ? weekdays : [Number.isInteger(Number(input.weekday)) ? Math.max(0, Math.min(6, Number(input.weekday))) : 1],
    day:Number.isInteger(Number(input.day)) ? Math.max(1, Math.min(31, Number(input.day))) : 1,
    month:Number.isInteger(month) ? Math.max(1, Math.min(12, month)) : 1,
    start_at_ms:startAtMs,
    at_ms:normalizedAtMs,
    countdown_seconds:Number.isSafeInteger(countdown) ? Math.max(1, Math.min(31 * 24 * 60 * 60, countdown)) : 60,
    half_hour_slots:halfHourSlots,
    cron:text(input.cron || input.cron_expression, "", 120)
  };
  if ((frequency === "once" || frequency === "specified_time") && !normalized.start_at_ms && !normalized.at_ms) {
    const candidate = new Date();
    candidate.setSeconds(0, 0);
    candidate.setHours(normalized.hour, normalized.minute, 0, 0);
    if (candidate.getTime() <= Date.now()) candidate.setDate(candidate.getDate() + 1);
    normalized.at_ms = candidate.getTime();
  }
  if ((frequency === "once" || frequency === "specified_time") && !normalized.start_at_ms) normalized.start_at_ms = normalized.at_ms;
  return normalized;
}

function normalizeOptions(value: any, kind: string, existing: any = {}) {
  const input = {...asObject(existing), ...asObject(value)};
  const conflict = CONFLICT_MODES.has(String(input.conflict || "")) ? String(input.conflict) : "skip";
  if (input.delete_local || input.delete_remote || input.mirror) fail("删除传播和镜像模式尚未开放，任务已拒绝保存", "SFTP_AUTOMATION_DELETE_DISABLED");
  const excludes = [...new Set(String(input.excludes || "").split(/[\r\n,]+/).map(item => item.trim()).filter(Boolean).slice(0, 100))].join("\n");
  const maxFileSize = Number(input.max_file_size || 0);
  const interval = Number(input.interval_minutes || 15);
  const historyLimit = Number(input.history_limit ?? existing.history_limit ?? 300);
  return {
    conflict,
    excludes,
    max_file_size:Number.isSafeInteger(maxFileSize) && maxFileSize > 0 ? Math.min(maxFileSize, 1024 * 1024 * 1024 * 4) : 0,
    include_hidden:Boolean(input.include_hidden),
    use_hash:Boolean(input.use_hash),
    compare_content:input.compare_content === undefined ? (existing.compare_content === undefined ? true : Boolean(existing.compare_content)) : Boolean(input.compare_content),
    notify:input.notify === undefined ? (existing.notify === undefined ? kind === "transfer" : Boolean(existing.notify)) : Boolean(input.notify),
    interval_minutes:Number.isSafeInteger(interval) ? Math.max(1, Math.min(7 * 24 * 60, interval)) : 15,
    history_limit:Number.isSafeInteger(historyLimit) ? Math.max(100, Math.min(5000, historyLimit)) : 300,
    propagate_deletes:Boolean(input.propagate_deletes),
    delete_local:false,
    delete_remote:false,
    mirror:false,
    conflict_copy:Boolean(input.conflict_copy !== false)
  };
}

function automationRuleFingerprint(automation: any) {
  const options = asObject(automation?.options);
  return createHash("sha256").update(JSON.stringify({
    kind:String(automation?.kind || ""),
    connection_id:Number(automation?.connection_id || 0),
    local_path:String(automation?.local_path || ""),
    remote_path:String(automation?.remote_path || ""),
    direction:String(automation?.direction || ""),
    options:{
      conflict:String(options.conflict || "skip"),
      excludes:String(options.excludes || ""),
      max_file_size:Number(options.max_file_size || 0),
      include_hidden:Boolean(options.include_hidden),
      use_hash:Boolean(options.use_hash),
      ...(options.propagate_deletes ? {propagate_deletes:true,compare_content:Boolean(options.compare_content !== false)} : {}),
      delete_local:Boolean(options.delete_local),
      delete_remote:Boolean(options.delete_remote),
      mirror:Boolean(options.mirror),
      conflict_copy:Boolean(options.conflict_copy !== false)
    }
  })).digest("hex");
}

function automationLegacyFingerprint(automation: any) {
  return createHash("sha256").update(JSON.stringify({
    local_path:automation?.local_path,
    remote_path:automation?.remote_path,
    direction:automation?.direction,
    options:automation?.options || {}
  })).digest("hex");
}

function isWithin(parent: string, child: string) {
  const normalize = value => process.platform === "win32" ? String(value).toLowerCase() : String(value);
  const base = normalize(path.resolve(parent));
  const target = normalize(path.resolve(child));
  const relative = path.relative(base, target);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertNoLocalOverlap(item: any, id = 0) {
  const rows = all("SELECT id,local_path,kind,enabled FROM sftp_automations WHERE id<>?", [Number(id || 0)]);
  for (const row of rows) {
    if (String(row.kind) !== String(item.kind) || !Number(row.enabled)) continue;
    if (isWithin(row.local_path, item.local_path) || isWithin(item.local_path, row.local_path)) {
      fail("本机目录与已有启用的同类任务重叠，请改用不同目录", "SFTP_AUTOMATION_LOCAL_OVERLAP");
    }
  }
}

function parseRow(row: any) {
  if (!row) return null;
  let schedule = {};
  let options = {};
  try { schedule = JSON.parse(row.schedule_json || "{}"); } catch {}
  try { options = JSON.parse(row.options_json || "{}"); } catch {}
  return {
    ...row,
    id:Number(row.id),
    connection_id:Number(row.connection_id),
    sort_order:Number(row.sort_order || 0),
    enabled:Boolean(row.enabled),
    schedule,
    options,
    connection_name:String(row.connection_name || ""),
    next_run_at:row.next_run_at ? Number(row.next_run_at) : null,
    last_run_at:row.last_run_at ? Number(row.last_run_at) : null
  };
}

function inferAutomationKind(input: any, existing: any = null) {
  const requested = String(input.kind || "");
  if (requested && requested !== "auto") {
    if (!AUTOMATION_KINDS.has(requested)) fail("自动化任务类型无效");
    return requested;
  }
  const direction = String(input.direction || existing?.direction || "upload");
  const schedule = asObject(input.schedule, asObject(existing?.schedule));
  const frequency = String(schedule.frequency || "");
  const options = asObject(input.options, asObject(existing?.options));
  // Existing safe-sync rows never downgrade automatically: retaining their
  // kind keeps the established three-way baseline and conflict semantics.
  if (existing?.kind === "sync") return "sync";
  return direction === "bidirectional" || frequency === "realtime" || Boolean(options.propagate_deletes) ? "sync" : "transfer";
}

function listAutomations() {
  return all(`SELECT a.*, c.name AS connection_name
    FROM sftp_automations a LEFT JOIN connections c ON c.id=a.connection_id
    ORDER BY CASE WHEN a.sort_order>0 THEN 0 ELSE 1 END,a.sort_order,a.created_at,a.id`).map(parseRow);
}

function getAutomation(id: any) {
  return parseRow(get(`SELECT a.*, c.name AS connection_name
    FROM sftp_automations a LEFT JOIN connections c ON c.id=a.connection_id WHERE a.id=?`, [Number(id)]));
}

function validateInput(data: any, existing: any = null) {
  const input = asObject(data);
  const kind = inferAutomationKind(input, existing);
  const connectionId = Number(input.connection_id ?? existing?.connection_id);
  if (!Number.isSafeInteger(connectionId) || connectionId <= 0) fail("必须选择已保存的 SSH 连接");
  const connection = getConnection(connectionId);
  if (!connection || !connection.id) fail("SSH 连接不存在");
  const localPath = normalizeLocalPath(input.local_path ?? existing?.local_path);
  const remotePath = normalizeRemotePath(input.remote_path ?? existing?.remote_path);
  const direction = String(input.direction || existing?.direction || (kind === "transfer" ? "upload" : "bidirectional"));
  if (!(kind === "transfer" ? TRANSFER_DIRECTIONS : SYNC_DIRECTIONS).has(direction)) fail("自动化任务方向无效");
  const name = text(input.name ?? existing?.name, "未命名任务", 120) || "未命名任务";
  const options = normalizeOptions(input.options ?? existing?.options, kind, existing?.options);
  const schedule = normalizeSchedule(input.schedule ?? existing?.schedule, existing?.schedule);
  const requestedTrigger = String(input.trigger_mode || existing?.trigger_mode || "");
  const triggerMode = kind === "transfer"
    ? "schedule"
    : schedule.frequency === "realtime"
      ? "continuous"
      : TRIGGER_MODES.has(requestedTrigger)
        ? requestedTrigger
        : "schedule";
  const enabled = input.enabled === undefined ? (existing ? Boolean(existing.enabled) : true) : Boolean(input.enabled);
  const missedPolicy = ["run_once", "skip"].includes(String(input.missed_policy || existing?.missed_policy || "run_once")) ? String(input.missed_policy || existing?.missed_policy) : "run_once";
  const item = {kind,name,connection_id:connectionId,local_path:localPath,remote_path:remotePath,direction,trigger_mode:triggerMode,schedule,options,enabled,missed_policy:missedPolicy};
  if (kind === "sync") {
    try { if (!fs.lstatSync(localPath).isDirectory()) fail("文件夹同步的本机路径必须是目录"); }
    catch (error: any) { if (error?.code !== "ENOENT") throw error; fail("文件夹同步的本机目录必须已经存在"); }
  }
  assertNoLocalOverlap(item, existing?.id || 0);
  return item;
}

function saveAutomation(data: any, id: any = 0) {
  const existing = id ? getAutomation(id) : null;
  if (id && !existing) fail("自动化任务不存在", "SFTP_AUTOMATION_NOT_FOUND");
  const item = validateInput(data, existing);
  const timestamp = now();
  if (existing) {
    const rulesUnchanged = automationRuleFingerprint(existing) === automationRuleFingerprint(item);
    run(`UPDATE sftp_automations SET kind=?,name=?,connection_id=?,local_path=?,remote_path=?,direction=?,trigger_mode=?,schedule_json=?,options_json=?,enabled=?,missed_policy=?,updated_at=? WHERE id=?`, [item.kind,item.name,item.connection_id,item.local_path,item.remote_path,item.direction,item.trigger_mode,JSON.stringify(item.schedule),JSON.stringify(item.options),item.enabled ? 1 : 0,item.missed_policy,timestamp,Number(id)]);
    const baseline = rulesUnchanged ? getBaseline(id) : null;
    if (baseline && !baseline.corrupted) {
      const state = baseline.state || {};
      state.meta = {...(state.meta || {}), fingerprint:automationRuleFingerprint(item), fingerprint_version:2};
      saveBaseline(id, state, createHash("sha256").update(JSON.stringify(state)).digest("hex"));
    }
    trimRuns(id, item.options.history_limit);
    return getAutomation(id);
  }
  const sortOrder = Number(get("SELECT COALESCE(MAX(sort_order),0)+1 AS value FROM sftp_automations")?.value || 1);
  const result = run(`INSERT INTO sftp_automations(kind,name,connection_id,local_path,remote_path,direction,trigger_mode,schedule_json,options_json,enabled,missed_policy,next_run_at,last_run_at,last_status,last_error,sort_order,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,'idle','',?,?,?)`, [item.kind,item.name,item.connection_id,item.local_path,item.remote_path,item.direction,item.trigger_mode,JSON.stringify(item.schedule),JSON.stringify(item.options),item.enabled ? 1 : 0,item.missed_policy,sortOrder,timestamp,timestamp]);
  return getAutomation(result.lastInsertRowid);
}

function reorderAutomations(ids: any) {
  const requested = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
  if (!requested.length || requested.length > 1000) fail("任务顺序必须包含 1-1000 个任务", "SFTP_AUTOMATION_ORDER_INVALID");
  const active = listAutomations().map(item => Number(item.id));
  if (requested.length !== active.length || active.some(id => !requested.includes(id))) fail("任务列表已变化，请刷新后重试", "SFTP_AUTOMATION_ORDER_CHANGED");
  run("BEGIN IMMEDIATE");
  try {
    const changedAt = now();
    requested.forEach((id, index) => run("UPDATE sftp_automations SET sort_order=?,updated_at=? WHERE id=?", [index + 1,changedAt,id]));
    run("COMMIT");
  } catch (error) {
    try { run("ROLLBACK"); } catch {}
    throw error;
  }
  return {ok:true,ids:requested};
}

function setScheduleState(id: any, values: any = {}) {
  const current = getAutomation(id);
  if (!current) return null;
  const nextRunAt = values.next_run_at === undefined ? current.next_run_at : values.next_run_at === null ? null : Number(values.next_run_at || 0) || null;
  const enabled = values.enabled === undefined ? current.enabled : Boolean(values.enabled);
  const status = values.last_status === undefined ? current.last_status : String(values.last_status || "idle");
  const error = values.last_error === undefined ? current.last_error : String(values.last_error || "").slice(0, 4000);
  const lastRun = values.last_run_at === null ? null : values.last_run_at === undefined ? current.last_run_at : Number(values.last_run_at || 0) || null;
  run("UPDATE sftp_automations SET enabled=?,next_run_at=?,last_run_at=?,last_status=?,last_error=?,updated_at=? WHERE id=?", [enabled ? 1 : 0,nextRunAt,lastRun,status,error,now(),Number(id)]);
  return getAutomation(id);
}

function deleteAutomation(id: any) {
  const result = run("DELETE FROM sftp_automations WHERE id=?", [Number(id)]);
  if (!result.changes) fail("自动化任务不存在", "SFTP_AUTOMATION_NOT_FOUND");
  return {ok:true};
}

function getBaseline(automationId: any) {
  const row = get("SELECT * FROM sftp_automation_baselines WHERE automation_id=?", [Number(automationId)]);
  if (!row) return null;
  let state = {};
  try { state = JSON.parse(row.state_json || "{}"); } catch { return {...row, automation_id:Number(row.automation_id), version:Number(row.version || 1), state:null, corrupted:true}; }
  const checksum = createHash("sha256").update(JSON.stringify(state)).digest("hex");
  if (row.checksum && String(row.checksum) !== checksum) return {...row, automation_id:Number(row.automation_id), version:Number(row.version || 1), state:null, corrupted:true};
  return {...row, automation_id:Number(row.automation_id), version:Number(row.version || 1), state, corrupted:false};
}

function saveBaseline(automationId: any, state: any, checksum = "") {
  const safeState = state && typeof state === "object" ? state : {};
  const payload = JSON.stringify(safeState);
  run(`INSERT INTO sftp_automation_baselines(automation_id,version,state_json,checksum,updated_at)
    VALUES(?,?,?,?,?) ON CONFLICT(automation_id) DO UPDATE SET version=excluded.version,state_json=excluded.state_json,checksum=excluded.checksum,updated_at=excluded.updated_at`,
    [Number(automationId),1,payload,String(checksum || "").slice(0,128),now()]);
  return getBaseline(automationId);
}

function deleteBaseline(automationId: any) {
  run("DELETE FROM sftp_automation_baselines WHERE automation_id=?", [Number(automationId)]);
}

function createRun(automationId: any, reason = "manual") {
  const runId = randomUUID();
  run("INSERT INTO sftp_automation_runs(run_id,automation_id,status,reason,started_at,finished_at,summary_json,error) VALUES(?,?,?, ?,?,NULL,'{}','')", [runId,Number(automationId),"running",text(reason,"manual",40),now()]);
  setScheduleState(automationId, {last_status:"running",last_error:"",last_run_at:now()});
  return runId;
}

function parseRunSummary(row: any) {
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.summary_json || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function normalizedNoChangeStreak(value: any) {
  const streak = Number(value);
  return Number.isSafeInteger(streak) && streak > 0 ? Math.min(streak, 1000000000) : 1;
}

function isNoChangeRun(row: any, summary: any = parseRunSummary(row)) {
  const hasKnownMetrics = ["processed","files","transferred","deleted","skipped","conflicts","failed"]
    .some(key => Object.prototype.hasOwnProperty.call(summary, key));
  return String(row?.status || "") === "done"
    && !String(row?.error || "")
    && hasKnownMetrics
    && Number(summary?.transferred || 0) === 0
    && Number(summary?.deleted || 0) === 0
    && Number(summary?.conflicts || 0) === 0
    && Number(summary?.failed || 0) === 0;
}

/**
 * Keep the most recent row for each contiguous run of successful no-change
 * checks. Real transfers, deletes, conflicts, and failures deliberately break
 * the run so an audit trail still shows meaningful changes in order.
 */
function compactNoChangeRuns(automationId: any) {
  const id = Number(automationId);
  if (!Number.isSafeInteger(id) || id <= 0) return {deleted:0,updated:0};
  let previous: any = null;
  let deleted = 0;
  let updated = 0;
  run("BEGIN IMMEDIATE");
  try {
    const rows = all("SELECT rowid,run_id,status,reason,started_at,finished_at,summary_json,error FROM sftp_automation_runs WHERE automation_id=? AND status<>'running' ORDER BY started_at ASC,rowid ASC", [id]);
    for (const row of rows) {
      const summary = parseRunSummary(row);
      if (!isNoChangeRun(row, summary)) {
        previous = null;
        continue;
      }
      const streak = normalizedNoChangeStreak(summary.no_change_streak);
      if (previous) {
        const previousSummary = parseRunSummary(previous);
        const mergedSummary = {
          ...summary,
          no_change_streak:Math.min(1000000000, normalizedNoChangeStreak(previousSummary.no_change_streak) + streak)
        };
        run("DELETE FROM sftp_automation_runs WHERE run_id=?", [String(previous.run_id)]);
        run("UPDATE sftp_automation_runs SET summary_json=? WHERE run_id=?", [JSON.stringify(mergedSummary),String(row.run_id)]);
        deleted += 1;
        updated += 1;
        previous = {...row,summary_json:JSON.stringify(mergedSummary)};
      } else {
        const normalizedSummary = {...summary,no_change_streak:streak};
        if (String(row.summary_json || "") !== JSON.stringify(normalizedSummary)) {
          run("UPDATE sftp_automation_runs SET summary_json=? WHERE run_id=?", [JSON.stringify(normalizedSummary),String(row.run_id)]);
          updated += 1;
        }
        previous = {...row,summary_json:JSON.stringify(normalizedSummary)};
      }
    }
    run("COMMIT");
  } catch (error) {
    try { run("ROLLBACK"); } catch {}
    throw error;
  }
  return {deleted,updated};
}

function finishRun(runId: string, status: string, summary: any = {}, error = "") {
  run("UPDATE sftp_automation_runs SET status=?,finished_at=?,summary_json=?,error=? WHERE run_id=?", [String(status || "failed"),now(),JSON.stringify(summary || {}),String(error || "").slice(0, 4000),String(runId)]);
  const completed = getRun(runId);
  if (completed?.automation_id) compactNoChangeRuns(completed.automation_id);
  const compacted = getRun(runId);
  if (compacted?.automation_id) trimRuns(compacted.automation_id, getAutomation(compacted.automation_id)?.options?.history_limit);
  return compacted;
}

function getRun(runId: string) {
  const row = get(`SELECT r.*, a.name AS automation_name, a.kind, a.connection_id
    FROM sftp_automation_runs r JOIN sftp_automations a ON a.id=r.automation_id WHERE r.run_id=?`, [String(runId)]);
  if (!row) return null;
  const summary = parseRunSummary(row);
  return {...row,summary};
}

function listRuns(automationId: any = 0, limit = 100) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  if (automationId) compactNoChangeRuns(automationId);
  else all("SELECT id FROM sftp_automations").forEach(item => compactNoChangeRuns(item.id));
  const rows = automationId
    ? all("SELECT r.*, a.name AS automation_name, a.kind, a.connection_id FROM sftp_automation_runs r JOIN sftp_automations a ON a.id=r.automation_id WHERE r.automation_id=? ORDER BY r.started_at DESC LIMIT ?", [Number(automationId),safeLimit])
    : all("SELECT r.*, a.name AS automation_name, a.kind, a.connection_id FROM sftp_automation_runs r JOIN sftp_automations a ON a.id=r.automation_id ORDER BY r.started_at DESC LIMIT ?", [safeLimit]);
  return rows.map(row => ({...row,summary:parseRunSummary(row)}));
}

function normalizedHistoryLimit(value: any) {
  const limit = Number(value ?? 300);
  return Number.isSafeInteger(limit) ? Math.max(100, Math.min(5000, limit)) : 300;
}

function trimRuns(automationId: any, limit: any = 300) {
  const id = Number(automationId);
  const safeLimit = normalizedHistoryLimit(limit);
  if (!Number.isSafeInteger(id) || id <= 0) return {deleted:0,limit:safeLimit};
  const result = run(`DELETE FROM sftp_automation_runs WHERE automation_id=? AND status<>'running' AND run_id IN (
    SELECT run_id FROM sftp_automation_runs WHERE automation_id=? AND status<>'running' ORDER BY started_at DESC,rowid DESC LIMIT -1 OFFSET ?
  )`, [id,id,safeLimit]);
  return {deleted:Number(result.changes || 0),limit:safeLimit};
}

function listRunsPage(automationId: any, page: any = 1) {
  const id = Number(automationId);
  if (!Number.isSafeInteger(id) || id <= 0) fail("自动化任务 ID 无效");
  const item = getAutomation(id);
  if (!item) fail("自动化任务不存在", "SFTP_AUTOMATION_NOT_FOUND");
  compactNoChangeRuns(id);
  const pageSize = 100;
  const total = Number(get("SELECT COUNT(*) AS count FROM sftp_automation_runs WHERE automation_id=?", [id])?.count || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.max(1, Math.min(totalPages, Number.isSafeInteger(Number(page)) ? Number(page) : 1));
  const rows = all(`SELECT r.*, a.name AS automation_name, a.kind, a.connection_id
    FROM sftp_automation_runs r JOIN sftp_automations a ON a.id=r.automation_id
    WHERE r.automation_id=? ORDER BY r.started_at DESC,r.rowid DESC LIMIT ? OFFSET ?`, [id,pageSize,(safePage - 1) * pageSize]);
  const items = rows.map(row => ({...row,summary:parseRunSummary(row)}));
  return {items,total,page:safePage,page_size:pageSize,total_pages:totalPages,history_limit:normalizedHistoryLimit(item.options?.history_limit)};
}

function setHistoryLimit(automationId: any, value: any) {
  const item = getAutomation(automationId);
  if (!item) fail("自动化任务不存在", "SFTP_AUTOMATION_NOT_FOUND");
  const historyLimit = normalizedHistoryLimit(value);
  const options = {...asObject(item.options),history_limit:historyLimit};
  run("UPDATE sftp_automations SET options_json=?,updated_at=? WHERE id=?", [JSON.stringify(options),now(),Number(item.id)]);
  const trimmed = trimRuns(item.id, historyLimit);
  return {ok:true,history_limit:historyLimit,deleted:trimmed.deleted};
}

function clearRuns(automationId: any) {
  const item = getAutomation(automationId);
  if (!item) fail("自动化任务不存在", "SFTP_AUTOMATION_NOT_FOUND");
  const result = run("DELETE FROM sftp_automation_runs WHERE automation_id=? AND status<>'running'", [Number(item.id)]);
  return {ok:true,deleted:Number(result.changes || 0)};
}

function listDue(nowSeconds = Math.floor(Date.now() / 1000)) {
  return all(`SELECT a.*, c.name AS connection_name FROM sftp_automations a LEFT JOIN connections c ON c.id=a.connection_id
    WHERE a.enabled=1 AND a.next_run_at IS NOT NULL AND a.next_run_at<=? ORDER BY a.next_run_at,a.id`, [Number(nowSeconds)]).map(parseRow);
}

function recoverRunningRuns() {
  const result = run("UPDATE sftp_automation_runs SET status='failed',finished_at=?,error=? WHERE status='running'", [now(), "Terma 上次退出时任务仍在运行，已停止；请手动重试"]);
  all("SELECT DISTINCT automation_id FROM sftp_automation_runs WHERE status='failed' AND error=?", ["Terma 上次退出时任务仍在运行，已停止；请手动重试"]).forEach(row => setScheduleState(row.automation_id, {last_status:"needs_attention",last_error:"Terma 上次退出时任务仍在运行，已停止；请手动重试"}));
  return Number(result.changes || 0);
}

module.exports = { assertNoLocalOverlap, automationLegacyFingerprint, automationRuleFingerprint, compactNoChangeRuns, getAutomation, getRun, inferAutomationKind, listAutomations, listDue, listRuns, listRunsPage, normalizeLocalPath, normalizeRemotePath, normalizeOptions, normalizeSchedule, parseRow, reorderAutomations, saveAutomation, setScheduleState, setHistoryLimit, deleteAutomation, clearRuns, createRun, finishRun, recoverRunningRuns, getBaseline, saveBaseline, deleteBaseline, trimRuns };
