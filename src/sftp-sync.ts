const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { invalidateRemoteDirectoryCache, listRemoteDir, readRemoteBinaryFile, setRemoteFileMtime, writeRemoteFile } = require("./sftp");
const { getSftpConnection } = require("./sftp-session");

const plans = new Map();
const jobs = new Map();
const DEFAULT_EXCLUDES = [".git", "node_modules", ".DS_Store", "Thumbs.db", "*.tmp", "*.swp", "*~"];
const MAX_FILES = 20000;

function normalizeRemoteRoot(value) {
  const root = path.posix.normalize(String(value || ".").replace(/\\/g, "/"));
  if (!root || root.includes("\0") || root.startsWith("../")) throw new Error("远程同步目录无效");
  return root;
}

function normalizeLocalRoot(value) {
  const root = path.resolve(String(value || ""));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("本地同步目录不存在或不是目录");
  return root;
}

function globRegex(pattern) {
  const escaped = String(pattern || "").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
  return new RegExp(`(?:^|/)${escaped}(?:$|/)`, "i");
}

function exclusionMatchers(value) {
  const patterns = [...DEFAULT_EXCLUDES, ...String(value || "").split(/[\r\n,]+/).map(item => item.trim()).filter(Boolean)];
  return [...new Set(patterns)].map(globRegex);
}

function excluded(relative, matchers) {
  return matchers.some(regex => regex.test(relative.replace(/\\/g, "/")));
}

function assertSyncActive(shouldCancel) {
  if (shouldCancel?.()) {
    const error: any = new Error("目录同步已取消");
    error.code = "SYNC_CANCELLED";
    throw error;
  }
}

function localTree(root, matchers, shouldCancel: any = null) {
  const items = new Map();
  const pending = [""];
  while (pending.length) {
    assertSyncActive(shouldCancel);
    const relativeDirectory = pending.pop();
    const directory = path.join(root, relativeDirectory);
    for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
      assertSyncActive(shouldCancel);
      const relative = path.join(relativeDirectory, entry.name).replace(/\\/g, "/");
      if (excluded(relative, matchers)) continue;
      if (entry.isDirectory()) pending.push(relative);
      else if (entry.isFile()) {
        const stat = fs.statSync(path.join(root, relative));
        items.set(relative, {relative, size:stat.size, mtime:Math.floor(stat.mtimeMs / 1000), local_path:path.join(root, relative)});
        if (items.size > MAX_FILES) throw new Error(`目录文件数量超过 ${MAX_FILES}，请增加排除规则后重试`);
      }
    }
  }
  return items;
}

async function remoteTree(connectionId, root, matchers, shouldCancel: any = null) {
  const items = new Map();
  const pending = [{relative:"", remote:root}];
  while (pending.length) {
    assertSyncActive(shouldCancel);
    const current = pending.pop();
    let page = 1;
    do {
      const listing = await listRemoteDir(connectionId, current.remote, {page, pageSize:500, refresh:true});
      for (const entry of listing.entries || []) {
        assertSyncActive(shouldCancel);
        const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
        if (excluded(relative, matchers)) continue;
        const remotePath = path.posix.join(root, relative);
        if (entry.type === "dir") pending.push({relative, remote:remotePath});
        else {
          items.set(relative, {relative, size:Number(entry.size || 0), mtime:Number(entry.mtime || 0), remote_path:remotePath});
          if (items.size > MAX_FILES) throw new Error(`远程目录文件数量超过 ${MAX_FILES}，请增加排除规则后重试`);
        }
      }
      page += 1;
      if (page > Number(listing.totalPages || 1)) break;
    } while (true);
  }
  return items;
}

function fileHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function remoteHash(connectionId, remotePath) {
  const {content} = await readRemoteBinaryFile(connectionId, remotePath, 100 * 1024 * 1024);
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function compareEntry(connectionId, local, remote, useHash) {
  if (!local || !remote) return {same:false};
  if (local.size !== remote.size) return {same:false};
  if (Math.abs(local.mtime - remote.mtime) <= 2 && !useHash) return {same:true};
  if (!useHash) return {same:false};
  if (local.size > 100 * 1024 * 1024) return {same:false, hash_skipped:true};
  return {same:fileHash(local.local_path) === await remoteHash(connectionId, remote.remote_path)};
}

async function createSyncPlan(connectionId, data: any = {}, control: any = {}) {
  getSftpConnection(Number(connectionId));
  const localRoot = normalizeLocalRoot(data.local_path);
  const remoteRoot = normalizeRemoteRoot(data.remote_path);
  const mode = new Set(["upload", "download", "bidirectional"]).has(data.mode) ? data.mode : "bidirectional";
  const useHash = Boolean(data.use_hash);
  const matchers = exclusionMatchers(data.excludes);
  const shouldCancel = typeof control.shouldCancel === "function" ? control.shouldCancel : null;
  const [localItems, remoteItems] = await Promise.all([localTree(localRoot, matchers, shouldCancel), remoteTree(Number(connectionId), remoteRoot, matchers, shouldCancel)]);
  const relatives = [...new Set([...localItems.keys(), ...remoteItems.keys()])].sort((left, right) => left.localeCompare(right));
  const actions = [];
  for (const relative of relatives) {
    assertSyncActive(shouldCancel);
    const local = localItems.get(relative);
    const remote = remoteItems.get(relative);
    const comparison = await compareEntry(Number(connectionId), local, remote, useHash);
    if (comparison.same) continue;
    let action = "conflict";
    let reason = "两端内容不同";
    if (mode === "upload") {
      if (local) { action = "upload"; reason = remote ? "本地与远程不同" : "远程缺少文件"; }
      else continue;
    } else if (mode === "download") {
      if (remote) { action = "download"; reason = local ? "本地与远程不同" : "本地缺少文件"; }
      else continue;
    } else if (!local) {
      action = "download"; reason = "本地缺少文件";
    } else if (!remote) {
      action = "upload"; reason = "远程缺少文件";
    } else if (local.mtime > remote.mtime + 2) {
      action = "upload"; reason = "本地文件较新";
    } else if (remote.mtime > local.mtime + 2) {
      action = "download"; reason = "远程文件较新";
    }
    actions.push({
      index:actions.length,
      relative,
      action,
      reason,
      selected:action !== "conflict",
      local_size:local?.size ?? null,
      local_mtime:local?.mtime ?? null,
      remote_size:remote?.size ?? null,
      remote_mtime:remote?.mtime ?? null
    });
  }
  const id = crypto.randomUUID();
  const plan = {id, connectionId:Number(connectionId), localRoot, remoteRoot, mode, useHash, actions, createdAt:Date.now()};
  plans.set(id, plan);
  return {id, mode, use_hash:useHash, local_path:localRoot, remote_path:remoteRoot, actions, totals:{upload:actions.filter(item => item.action === "upload").length, download:actions.filter(item => item.action === "download").length, conflict:actions.filter(item => item.action === "conflict").length}};
}

function checkedLocalTarget(root, relative) {
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("同步目标路径越界");
  return target;
}

async function executeAction(plan, action) {
  const localPath = checkedLocalTarget(plan.localRoot, action.relative);
  const remotePath = path.posix.join(plan.remoteRoot, action.relative);
  if (action.action === "upload") {
    const content = fs.readFileSync(localPath);
    await writeRemoteFile(plan.connectionId, remotePath, content, {backup:Boolean(action.remote_size !== null)});
    await setRemoteFileMtime(plan.connectionId, remotePath, action.local_mtime);
    invalidateRemoteDirectoryCache(plan.connectionId);
  } else if (action.action === "download") {
    const {content} = await readRemoteBinaryFile(plan.connectionId, remotePath, 100 * 1024 * 1024);
    fs.mkdirSync(path.dirname(localPath), {recursive:true});
    fs.writeFileSync(localPath, content);
    if (action.remote_mtime) fs.utimesSync(localPath, action.remote_mtime, action.remote_mtime);
  } else throw new Error("冲突项目必须先明确选择上传或下载方向");
}

function jobView(job) {
  return {...job, selected:undefined};
}

function startSyncPlanningJob(connectionId, data: any = {}) {
  getSftpConnection(Number(connectionId));
  const id = crypto.randomUUID();
  const job: any = {
    id,
    connection_id:Number(connectionId),
    type:"sync-scan",
    status:"running",
    total:0,
    completed:0,
    failed:0,
    current:String(data.remote_path || "."),
    errors:[],
    created_at:Date.now(),
    updated_at:Date.now(),
    cancel_requested:false,
    plan_result:null
  };
  jobs.set(id, job);
  setImmediate(async () => {
    try {
      if (job.cancel_requested) return;
      job.plan_result = await createSyncPlan(connectionId, data, {shouldCancel:() => job.cancel_requested});
      job.total = job.plan_result.actions.length;
      job.completed = job.total;
      job.status = job.cancel_requested ? "cancelled" : "completed";
    } catch (error) {
      if (job.cancel_requested || error?.code === "SYNC_CANCELLED") {
        job.status = "cancelled";
        return;
      }
      job.failed = 1;
      job.errors = [{relative:"", error:error.message || String(error)}];
      job.status = "failed";
    } finally {
      job.current = "";
      job.updated_at = Date.now();
    }
  });
  return jobView(job);
}

function startSyncJob(planId, selectedIndexes, overrides: any = {}) {
  const plan = plans.get(String(planId || ""));
  if (!plan || Date.now() - plan.createdAt > 30 * 60 * 1000) throw new Error("同步预览已过期，请重新生成");
  const selected = new Set((selectedIndexes || []).map(Number));
  const actions = plan.actions.filter(item => selected.has(item.index)).map(item => {
    const override = overrides?.[item.index];
    if (item.action !== "conflict" || !["upload", "download"].includes(override)) return item;
    return {...item, action:override, reason:`冲突：已选择${override === "upload" ? "上传本地文件" : "下载远程文件"}`};
  });
  if (actions.some(item => item.action === "conflict")) throw new Error("冲突项目必须先选择上传或下载方向");
  if (!actions.length) throw new Error("请选择至少一个同步项目");
  const id = crypto.randomUUID();
  const job = {id, plan_id:plan.id, connection_id:plan.connectionId, type:"sync", status:"running", total:actions.length, completed:0, failed:0, current:"", errors:[], selected:[...selected], created_at:Date.now(), updated_at:Date.now(), cancel_requested:false};
  jobs.set(id, job);
  queueMicrotask(async () => {
    for (const action of actions) {
      if (job.cancel_requested) break;
      job.current = action.relative;
      job.updated_at = Date.now();
      try { await executeAction(plan, action); }
      catch (error) { job.failed += 1; job.errors.push({relative:action.relative, error:error.message || String(error)}); }
      job.completed += 1;
      job.updated_at = Date.now();
    }
    job.status = job.cancel_requested ? "cancelled" : job.failed ? "failed" : "completed";
    job.current = "";
    job.updated_at = Date.now();
  });
  return jobView(job);
}

function retrySyncJob(id) {
  const job: any = jobs.get(String(id || ""));
  if (!job || job.type !== "sync" || job.status !== "failed") throw new Error("只有失败的目录同步任务可以重试");
  const plan: any = plans.get(String(job.plan_id || ""));
  if (!plan) throw new Error("同步预览已过期，请重新生成预览");
  const failedPaths = new Set((job.errors || []).map(item => item.relative));
  const indexes = plan.actions.filter(item => failedPaths.has(item.relative)).map(item => item.index);
  if (!indexes.length) throw new Error("没有可重试的失败项目");
  return startSyncJob(plan.id, indexes);
}

function deleteSyncJob(id) {
  const job: any = jobs.get(String(id || ""));
  if (!job) throw new Error("同步任务不存在");
  if (job.status === "running") throw new Error("请先取消正在运行的同步任务");
  jobs.delete(String(id));
  return {ok:true};
}

function clearFinishedSyncJobs() {
  let removed = 0;
  for (const [id, job] of jobs) {
    if (!["completed", "cancelled"].includes(job.status)) continue;
    jobs.delete(id);
    removed += 1;
  }
  return {removed};
}

function listSyncJobs() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, job] of jobs) if (job.status !== "running" && job.updated_at < cutoff) jobs.delete(id);
  const planCutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, plan] of plans) if (plan.createdAt < planCutoff) plans.delete(id);
  return [...jobs.values()].map(jobView).sort((left, right) => right.created_at - left.created_at);
}

function getSyncJob(id) {
  const job = jobs.get(String(id || ""));
  if (!job) throw new Error("同步任务不存在");
  return jobView(job);
}

function cancelSyncJob(id) {
  const job = jobs.get(String(id || ""));
  if (!job) throw new Error("同步任务不存在");
  if (job.status === "running") job.cancel_requested = true;
  return jobView(job);
}

module.exports = {
  cancelSyncJob,
  clearFinishedSyncJobs,
  createSyncPlan,
  deleteSyncJob,
  getSyncJob,
  listSyncJobs,
  retrySyncJob,
  startSyncPlanningJob,
  startSyncJob,
  syncTestHelpers:{checkedLocalTarget, exclusionMatchers, localTree}
};
