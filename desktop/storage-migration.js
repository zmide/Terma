const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const TRANSITION_VERSION = 1;
const MARKER_PREFIX = ".terma-storage-migration-";

function storageMigrationText(chinese, english, language = process.env.TERMA_INTERFACE_LANGUAGE) {
  return String(language || "").toLowerCase().startsWith("en") ? english : chinese;
}

function runtimeRoot(paths) {
  const dataDir = path.resolve(String(paths?.dataDir || ""));
  const sshDir = path.resolve(String(paths?.sshDir || ""));
  if (path.basename(dataDir) !== "data" || path.basename(sshDir) !== ".ssh") {
    throw new Error(storageMigrationText("数据迁移路径结构无效", "The data-migration path structure is invalid"));
  }
  const dataRoot = path.dirname(dataDir);
  const sshRoot = path.dirname(sshDir);
  if (dataRoot !== sshRoot) throw new Error(storageMigrationText("数据与密钥目录必须位于同一运行根目录", "The data and key directories must be under the same runtime root"));
  return dataRoot;
}

function pathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function transitionPaths(transition) {
  const id = String(transition?.id || "");
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error(storageMigrationText("数据迁移标识无效", "The data-migration identifier is invalid"));
  const sourceRoot = path.resolve(String(transition?.source_root || ""));
  const targetRoot = path.resolve(String(transition?.target_root || ""));
  if (!path.isAbsolute(sourceRoot) || !path.isAbsolute(targetRoot) || sourceRoot === targetRoot) {
    throw new Error(storageMigrationText("数据迁移源路径或目标路径无效", "The data-migration source or target path is invalid"));
  }
  if (pathInside(sourceRoot, targetRoot)) throw new Error(storageMigrationText("新数据目录不能位于当前数据目录内部", "The new data directory cannot be inside the current data directory"));
  return {
    id,
    sourceRoot,
    targetRoot,
    stageRoot:path.join(targetRoot, `${MARKER_PREFIX}${id}.staging`),
    markerFile:path.join(targetRoot, `${MARKER_PREFIX}${id}.json`)
  };
}

function readMarker(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}

function writeMarker(file, value) {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporary, file);
  } finally {
    try { fs.rmSync(temporary, {force:true}); } catch {}
  }
}

function assertDesktopStorageMigrationTarget(transition) {
  const paths = transitionPaths(transition);
  fs.mkdirSync(paths.targetRoot, {recursive:true});
  fs.accessSync(paths.targetRoot, fs.constants.R_OK | fs.constants.W_OK);
  const canonicalSource = fs.realpathSync.native(paths.sourceRoot);
  const canonicalTarget = fs.realpathSync.native(paths.targetRoot);
  if (canonicalSource === canonicalTarget || pathInside(canonicalSource, canonicalTarget)) {
    throw new Error(storageMigrationText("新数据目录不能位于当前数据目录内部", "The new data directory cannot be inside the current data directory"));
  }
  for (const name of ["data", ".ssh"]) {
    if (fs.existsSync(path.join(paths.targetRoot, name))) {
      throw new Error(storageMigrationText(
        `目标目录已经包含 ${name} 数据；立即迁移只允许使用没有现有 Terma 数据的目录`,
        `The target directory already contains ${name} data. Immediate migration requires a directory with no existing Terma data.`
      ));
    }
  }
  const otherMarkers = fs.readdirSync(paths.targetRoot)
    .filter(name => name.startsWith(MARKER_PREFIX) && name !== path.basename(paths.stageRoot) && name !== path.basename(paths.markerFile));
  if (otherMarkers.length) throw new Error(storageMigrationText(
    "目标目录存在未完成的数据迁移，请先恢复原路径或清理对应迁移提示",
    "The target directory contains an unfinished data migration. Restore the original path or clear the corresponding migration notice first."
  ));
  return paths;
}

function createDesktopStorageTransition(currentSettings, targetSettings, currentPaths, targetPaths) {
  const sourceRoot = runtimeRoot(currentPaths);
  const targetRoot = runtimeRoot(targetPaths);
  if (sourceRoot === targetRoot) return null;
  const transition = {
    version:TRANSITION_VERSION,
    id:crypto.randomBytes(16).toString("hex"),
    requested_at:new Date().toISOString(),
    source_root:sourceRoot,
    target_root:targetRoot,
    source_settings:{...currentSettings, pendingStorageMigration:undefined},
    target_settings:{...targetSettings, pendingStorageMigration:undefined}
  };
  delete transition.source_settings.pendingStorageMigration;
  delete transition.target_settings.pendingStorageMigration;
  assertDesktopStorageMigrationTarget(transition);
  return transition;
}

function runtimeManifest(root, ignoredDataEntries = []) {
  const ignored = new Set(ignoredDataEntries);
  const rows = [];
  const walk = (directory, prefix, dataRoot = false) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, {withFileTypes:true}).sort((left, right) => left.name.localeCompare(right.name))) {
      if (dataRoot && ignored.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      const relative = path.posix.join(prefix, entry.name);
      const stat = fs.lstatSync(fullPath);
      if (entry.isDirectory()) {
        rows.push(`d:${relative}`);
        walk(fullPath, relative, false);
      } else if (entry.isSymbolicLink()) {
        rows.push(`l:${relative}:${fs.readlinkSync(fullPath)}`);
      } else {
        rows.push(`f:${relative}:${stat.size}`);
      }
    }
  };
  walk(path.join(root, "data"), "data", true);
  walk(path.join(root, ".ssh"), ".ssh", false);
  return rows;
}

function removeOwnedTargetEntries(paths, marker) {
  if (String(marker?.id || "") !== paths.id) return;
  const owned = new Set((Array.isArray(marker.promoted_entries) ? marker.promoted_entries : [])
    .filter(name => name === "data" || name === ".ssh"));
  if (["data", ".ssh"].includes(marker.moving_entry)
    && !fs.existsSync(path.join(paths.stageRoot, marker.moving_entry))) {
    owned.add(marker.moving_entry);
  }
  for (const name of owned) {
    try { fs.rmSync(path.join(paths.targetRoot, name), {recursive:true, force:true}); } catch {}
  }
}

function completeDesktopStorageTransition(transition, options = {}) {
  if (Number(transition?.version) !== TRANSITION_VERSION) throw new Error(storageMigrationText("数据迁移状态版本不受支持", "The data-migration state version is not supported"));
  if (typeof options.copyRuntimeDirectory !== "function") throw new Error(storageMigrationText("数据迁移复制器不可用", "The data-migration copier is unavailable"));
  const paths = transitionPaths(transition);
  fs.mkdirSync(paths.targetRoot, {recursive:true});
  const marker = readMarker(paths.markerFile);
  if (marker?.id === paths.id && marker?.state === "promoted") {
    const sourceManifest = runtimeManifest(paths.sourceRoot, options.ignoredDataEntries || []);
    const targetManifest = runtimeManifest(paths.targetRoot);
    if (JSON.stringify(sourceManifest) !== JSON.stringify(targetManifest)) throw new Error(storageMigrationText(
      "已迁移数据与原目录的文件清单不一致",
      "The migrated data manifest does not match the original directory"
    ));
    return paths;
  }
  if (marker && marker.id !== paths.id) throw new Error(storageMigrationText("目标目录属于另一项未完成的数据迁移", "The target directory belongs to another unfinished data migration"));
  if (marker?.id === paths.id) removeOwnedTargetEntries(paths, marker);
  try { fs.rmSync(paths.stageRoot, {recursive:true, force:true}); } catch {}
  try { fs.rmSync(paths.markerFile, {force:true}); } catch {}
  assertDesktopStorageMigrationTarget(transition);

  options.copyRuntimeDirectory(paths.sourceRoot, paths.stageRoot);
  const sourceManifest = runtimeManifest(paths.sourceRoot, options.ignoredDataEntries || []);
  const stagedManifest = runtimeManifest(paths.stageRoot);
  if (JSON.stringify(sourceManifest) !== JSON.stringify(stagedManifest)) {
    throw new Error(storageMigrationText("迁移后的文件清单与原数据不一致", "The migrated file manifest does not match the original data"));
  }

  assertDesktopStorageMigrationTarget(transition);
  const promotion = {
    version:TRANSITION_VERSION,
    id:paths.id,
    state:"promoting",
    source_root:paths.sourceRoot,
    target_root:paths.targetRoot,
    promoted_entries:[],
    moving_entry:""
  };
  writeMarker(paths.markerFile, promotion);
  for (const name of ["data", ".ssh"]) {
    const destination = path.join(paths.targetRoot, name);
    const staged = path.join(paths.stageRoot, name);
    promotion.moving_entry = name;
    writeMarker(paths.markerFile, promotion);
    if (fs.existsSync(destination)) throw new Error(storageMigrationText(
      `目标目录在迁移期间出现了 ${name} 数据，已停止以避免覆盖`,
      `${name} data appeared in the target directory during migration. The operation was stopped to avoid overwriting it.`
    ));
    if (fs.existsSync(staged)) fs.renameSync(staged, destination);
    else fs.mkdirSync(destination, {recursive:true});
    promotion.promoted_entries.push(name);
    promotion.moving_entry = "";
    writeMarker(paths.markerFile, promotion);
  }
  fs.rmSync(paths.stageRoot, {recursive:true, force:true});
  promotion.state = "promoted";
  writeMarker(paths.markerFile, promotion);
  return paths;
}

function finalizeDesktopStorageTransition(transition) {
  const paths = transitionPaths(transition);
  const marker = readMarker(paths.markerFile);
  if (marker?.id === paths.id) fs.rmSync(paths.markerFile, {force:true});
  fs.rmSync(paths.stageRoot, {recursive:true, force:true});
}

function rollbackDesktopStorageTransition(transition) {
  const paths = transitionPaths(transition);
  const marker = readMarker(paths.markerFile);
  removeOwnedTargetEntries(paths, marker);
  try { fs.rmSync(paths.stageRoot, {recursive:true, force:true}); } catch {}
  if (marker?.id === paths.id) {
    try { fs.rmSync(paths.markerFile, {force:true}); } catch {}
  }
}

module.exports = {
  runtimeRoot,
  createDesktopStorageTransition,
  assertDesktopStorageMigrationTarget,
  completeDesktopStorageTransition,
  finalizeDesktopStorageTransition,
  rollbackDesktopStorageTransition
};
