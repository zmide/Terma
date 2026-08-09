const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DATA_DIR } = require("./config");
const { exportConfigSnapshot, restoreConfigSnapshot } = require("./db");
const { readSecuritySettings } = require("./security");
const { ensurePrivateDirectory, ensurePrivateFile } = require("./storage-permissions");

const SNAPSHOT_DIR = path.join(DATA_DIR, "snapshots");
const MAX_SNAPSHOTS = 20;

function safeId(value) {
  const id = String(value || "");
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error("快照 ID 无效");
  return id;
}

function readSnapshotFile(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return data;
}

function scanConfigSnapshots() {
  ensurePrivateDirectory(SNAPSHOT_DIR);
  return fs.readdirSync(SNAPSHOT_DIR).filter(name => name.endsWith(".json")).map(name => {
    try {
      const id = safeId(name.slice(0, -5));
      const data = readSnapshotFile(path.join(SNAPSHOT_DIR, name));
      if (data.id && data.id !== id) return null;
      return { id, reason:data.reason, created_at:data.created_at, counts:data.counts };
    } catch { return null; }
  }).filter(Boolean).sort((a,b) => b.created_at - a.created_at);
}

function listConfigSnapshots() {
  return scanConfigSnapshots().slice(0, MAX_SNAPSHOTS);
}

function createConfigSnapshot(reason="手动快照") {
  ensurePrivateDirectory(SNAPSHOT_DIR);
  const security = readSecuritySettings();
  if (["enabling", "disabling"].includes(String(security.encryption_state || ""))) {
    const error: any = new Error("配置加密切换尚未完成，暂时不能创建配置快照");
    error.code = "ENCRYPTION_TRANSITION_PENDING";
    error.statusCode = 423;
    throw error;
  }
  const snapshot = exportConfigSnapshot();
  const id = crypto.randomUUID();
  const payload = {
    id,
    reason:String(reason || "手动快照").slice(0,120),
    created_at:Date.now(),
    encryption_enabled:Boolean(security.encryption_enabled),
    encryption_state:security.encryption_state || (security.encryption_enabled ? "enabled" : "disabled"),
    encryption_version:Number(security.encryption_version || (security.encryption_enabled ? 1 : 2)),
    counts:{connections:snapshot.connections.length,forwards:snapshot.forwards.length,templates:snapshot.forward_templates.length},
    snapshot
  };
  const file = path.join(SNAPSHOT_DIR, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), {encoding:"utf8", mode:0o600});
  ensurePrivateFile(file);
  for (const old of scanConfigSnapshots().slice(MAX_SNAPSHOTS)) try { fs.unlinkSync(path.join(SNAPSHOT_DIR, `${old.id}.json`)); } catch {}
  return { id:payload.id, reason:payload.reason, created_at:payload.created_at, counts:payload.counts };
}

function snapshotCompatibleWithCurrentEncryption(payload) {
  const settings = readSecuritySettings();
  const enabled = Boolean(settings.encryption_enabled);
  if (enabled) {
    return payload?.encryption_enabled === true
      && String(payload?.encryption_state || "enabled") === "enabled"
      && Number(payload?.encryption_version || 1) === Number(settings.encryption_version || 1);
  }
  return payload?.encryption_enabled !== true;
}

function pruneConfigSnapshotsForCurrentEncryption() {
  ensurePrivateDirectory(SNAPSHOT_DIR);
  let removed = 0;
  for (const name of fs.readdirSync(SNAPSHOT_DIR).filter(item => item.endsWith(".json"))) {
    const file = path.join(SNAPSHOT_DIR, name);
    try {
      if (snapshotCompatibleWithCurrentEncryption(readSnapshotFile(file))) continue;
      fs.unlinkSync(file);
      removed += 1;
    } catch {
      try { fs.unlinkSync(file); removed += 1; } catch {}
    }
  }
  return removed;
}

function clearConfigSnapshots() {
  ensurePrivateDirectory(SNAPSHOT_DIR);
  let removed = 0;
  for (const name of fs.readdirSync(SNAPSHOT_DIR).filter(item => item.endsWith(".json"))) {
    try {
      fs.unlinkSync(path.join(SNAPSHOT_DIR, name));
      removed += 1;
    } catch {}
  }
  return removed;
}

function restoreConfigSnapshotById(id) {
  const file = path.join(SNAPSHOT_DIR, `${safeId(id)}.json`);
  const payload = readSnapshotFile(file);
  if (!snapshotCompatibleWithCurrentEncryption(payload)) {
    try { fs.unlinkSync(file); } catch {}
    throw new Error("该快照不符合当前配置加密状态，已安全清理，请使用新的配置快照");
  }
  return restoreConfigSnapshot(payload.snapshot);
}

function deleteConfigSnapshot(id) {
  const file = path.join(SNAPSHOT_DIR, `${safeId(id)}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return {ok:true};
}

module.exports = { clearConfigSnapshots, createConfigSnapshot, deleteConfigSnapshot, listConfigSnapshots, pruneConfigSnapshotsForCurrentEncryption, restoreConfigSnapshotById };
