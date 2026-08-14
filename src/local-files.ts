const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { makeRemoteDir, resolveRemoteUploadTarget } = require("./sftp");
const { startUploadJob } = require("./sftp-jobs");

const LOCAL_TRANSFER_TOP_LEVEL_LIMIT = 100;
const LOCAL_TRANSFER_ENTRY_LIMIT = 1000;

function normalizeLocalDirectory(value, fallback = "") {
  const requested = String(value || fallback || "").trim();
  if (!requested || !path.isAbsolute(requested) || requested.includes("\0")) {
    throw new Error("本地目录路径无效");
  }
  const resolved = path.resolve(requested);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) throw new Error("本地路径不是目录");
  return resolved;
}

function localEntryView(directory, entry) {
  const fullPath = path.join(directory, entry.name);
  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return null;
  }
  return {
    name:entry.name,
    path:fullPath,
    type:stat.isDirectory() ? "dir" : "file",
    size:stat.isFile() ? stat.size : 0,
    mtime:Math.floor(stat.mtimeMs / 1000),
    hidden:process.platform === "win32" ? false : entry.name.startsWith(".")
  };
}

function paginateLocalEntries(entries, options: any = {}) {
  const query = String(options.query || "").trim().toLocaleLowerCase();
  const sort = ["name", "size", "mtime"].includes(options.sort) ? options.sort : "name";
  const direction = options.dir === "desc" ? -1 : 1;
  const pageSize = Math.max(25, Math.min(200, Number(options.page_size || 50)));
  const page = Math.max(1, Number(options.page || 1));
  const filtered = entries.filter(entry => !query || entry.name.toLocaleLowerCase().includes(query));
  filtered.sort((left, right) => {
    if (left.type !== right.type) {
      const rank = value => value.type === "drive" ? 0 : value.type === "dir" ? 1 : 2;
      return rank(left) - rank(right);
    }
    if (left.type === "drive" && right.type === "drive" && sort === "name") {
      return direction * String(left.path || "").localeCompare(String(right.path || ""), undefined, {numeric:true, sensitivity:"base"});
    }
    if (sort === "size") return direction * (left.size - right.size || left.name.localeCompare(right.name, undefined, {numeric:true, sensitivity:"base"}));
    if (sort === "mtime") return direction * (left.mtime - right.mtime || left.name.localeCompare(right.name, undefined, {numeric:true, sensitivity:"base"}));
    return direction * left.name.localeCompare(right.name, undefined, {numeric:true, sensitivity:"base"});
  });
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * pageSize;
  return {
    entries:filtered.slice(offset, offset + pageSize),
    page:currentPage,
    page_size:pageSize,
    total,
    total_pages:totalPages
  };
}

function parseWindowsDriveRows(value) {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  return rows.map(row => {
    const device = String(row.Name || row.name || "").replace(/[\\/]+$/, "");
    if (!/^[A-Za-z]:$/.test(device)) return null;
    const label = String(row.VolumeLabel || row.volumeLabel || "").trim();
    const ready = row.IsReady !== false && row.isReady !== false;
    const size = ready ? Math.max(0, Number(row.TotalSize || row.totalSize || 0)) : 0;
    const free = ready ? Math.max(0, Number(row.AvailableFreeSpace || row.availableFreeSpace || 0)) : 0;
    return {
      name:label ? `${label} (${device.toUpperCase()})` : `本地磁盘 (${device.toUpperCase()})`,
      path:`${device.toUpperCase()}\\`,
      type:"drive",
      size,
      free,
      mtime:0,
      hidden:false,
      ready
    };
  }).filter(Boolean);
}

function queryWindowsDrives() {
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = "$utf8 = New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding = $utf8; $OutputEncoding = $utf8; [System.IO.DriveInfo]::GetDrives() | ForEach-Object { [pscustomobject]@{ Name=$_.Name; VolumeLabel=$(if ($_.IsReady) {$_.VolumeLabel} else {''}); IsReady=$_.IsReady; TotalSize=$(if ($_.IsReady) {$_.TotalSize} else {0}); AvailableFreeSpace=$(if ($_.IsReady) {$_.AvailableFreeSpace} else {0}) } } | ConvertTo-Json -Compress";
  try {
    const output = execFileSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      encoding:"utf8",
      timeout:3000,
      windowsHide:true,
      stdio:["ignore", "pipe", "ignore"]
    });
    return parseWindowsDriveRows(JSON.parse(String(output || "[]").replace(/^\uFEFF/, "")));
  } catch {
    const roots = new Set([
      process.env.SystemDrive ? `${process.env.SystemDrive}\\` : "",
      path.parse(require("node:os").homedir()).root,
      path.parse(require("node:os").tmpdir()).root
    ].filter(Boolean));
    return [...roots].map(root => ({Name:root, VolumeLabel:"", IsReady:true, TotalSize:0, AvailableFreeSpace:0})).flatMap(parseWindowsDriveRows);
  }
}

function listLocalComputer(options: any = {}) {
  const platform = options.platform || process.platform;
  const entries = platform === "win32"
    ? (typeof options.driveProvider === "function" ? options.driveProvider() : queryWindowsDrives())
    : [{name:"文件系统 (/)", path:"/", type:"drive", size:0, free:0, mtime:0, hidden:false, ready:true}];
  return {
    kind:"computer",
    path:"",
    display_path:"此电脑",
    parent:"",
    parent_kind:"none",
    ...paginateLocalEntries(entries, options)
  };
}

function listLocalDirectory(requestedPath, options: any = {}) {
  if (options.location === "computer") return listLocalComputer(options);
  const directory = normalizeLocalDirectory(requestedPath, options.defaultDirectory);
  const entries = fs.readdirSync(directory, {withFileTypes:true})
    .map(entry => localEntryView(directory, entry))
    .filter(Boolean);
  const isWindowsRoot = (options.platform || process.platform) === "win32" && path.win32.parse(directory).root.toLocaleLowerCase() === directory.toLocaleLowerCase();
  return {
    kind:"directory",
    path:directory,
    display_path:directory,
    parent:isWindowsRoot ? "" : path.dirname(directory) === directory ? "" : path.dirname(directory),
    parent_kind:isWindowsRoot ? "computer" : path.dirname(directory) === directory ? "none" : "directory",
    ...paginateLocalEntries(entries, options)
  };
}

function normalizeLocalTransferPaths(values) {
  const source = Array.isArray(values) ? values : [];
  if (!source.length || source.length > LOCAL_TRANSFER_TOP_LEVEL_LIMIT) {
    throw new Error(`一次最多传输 ${LOCAL_TRANSFER_TOP_LEVEL_LIMIT} 个本地项目`);
  }
  const seen = new Set();
  const result = [];
  for (const value of source) {
    const requested = String(value || "").trim();
    if (!requested || !path.isAbsolute(requested) || requested.includes("\0")) throw new Error("本地文件路径无效");
    const resolved = path.resolve(requested);
    if (seen.has(resolved)) continue;
    const lstat = fs.lstatSync(resolved);
    if (lstat.isSymbolicLink()) throw new Error(`为避免递归越界，不能直接传输符号链接：${path.basename(resolved)}`);
    const stat = fs.statSync(resolved);
    if (!stat.isFile() && !stat.isDirectory()) throw new Error(`不支持传输此本地项目：${path.basename(resolved)}`);
    seen.add(resolved);
    result.push({path:resolved, stat});
  }
  if (!result.length) throw new Error("请选择要传输的本地文件或目录");
  return result;
}

function normalizeLocalEntryPath(value, options: any = {}) {
  const requested = String(value || "").trim();
  if (!requested || !path.isAbsolute(requested) || requested.includes("\0")) {
    throw new Error("本地文件路径无效");
  }
  const resolved = path.resolve(requested);
  if (!options.allowMissing) {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) throw new Error("不允许操作符号链接");
  }
  return resolved;
}

function validateLocalName(value) {
  const name = String(value || "").trim();
  if (!name || name === "." || name === ".." || name.includes("\0") || /[\\/]/.test(name)) {
    throw new Error("文件名无效");
  }
  return name;
}

function renameLocalPath(value, newName) {
  const source = normalizeLocalEntryPath(value);
  const name = validateLocalName(newName);
  const target = path.join(path.dirname(source), name);
  if (target === source) return {ok:true, path:target, name};
  if (fs.existsSync(target)) throw new Error(`目标名称已存在：${name}`);
  fs.renameSync(source, target);
  return {ok:true, path:target, name};
}

function deleteLocalPaths(values) {
  const source = Array.isArray(values) ? values : [];
  if (!source.length || source.length > LOCAL_TRANSFER_TOP_LEVEL_LIMIT) {
    throw new Error(`一次最多删除 ${LOCAL_TRANSFER_TOP_LEVEL_LIMIT} 个本地项目`);
  }
  const removed = [];
  for (const value of source) {
    const target = normalizeLocalEntryPath(value);
    const stat = fs.lstatSync(target);
    if (stat.isDirectory() && path.dirname(target) === target) throw new Error("不能删除文件系统根目录");
    fs.rmSync(target, {recursive:stat.isDirectory(), force:false});
    removed.push(target);
  }
  return {ok:true, paths:removed};
}

function createLocalEntry(directoryValue, nameValue, typeValue = "file") {
  const directory = normalizeLocalDirectory(directoryValue);
  const name = validateLocalName(nameValue);
  const target = path.join(directory, name);
  if (fs.existsSync(target)) throw new Error(`目标名称已存在：${name}`);
  if (String(typeValue) === "dir" || String(typeValue) === "directory") fs.mkdirSync(target);
  else fs.writeFileSync(target, "", {flag:"wx"});
  return {ok:true, path:target, name, type:String(typeValue) === "dir" || String(typeValue) === "directory" ? "dir" : "file"};
}

function chmodLocalPath(value, modeValue) {
  if (process.platform === "win32") throw new Error("Windows 不支持 POSIX 权限设置");
  const target = normalizeLocalEntryPath(value);
  const mode = String(modeValue || "").trim();
  if (!/^[0-7]{3,4}$/.test(mode)) throw new Error("权限格式应为 644、755 等八进制值");
  fs.chmodSync(target, parseInt(mode, 8));
  return {ok:true, path:target, mode};
}

function localCopyTargetPath(directoryValue, nameValue, conflict = "error", reservedTargets = new Set<string>()) {
  const directory = normalizeLocalDirectory(directoryValue);
  const name = validateLocalName(nameValue);
  const initial = path.join(directory, name);
  const reserved = candidate => reservedTargets.has(path.resolve(candidate));
  const initialExists = fs.existsSync(initial);
  if (!initialExists && !reserved(initial)) return {path:initial, exists:false, name};
  if (conflict === "overwrite") return {path:initial, exists:initialExists, name};
  if (conflict !== "rename") return {path:initial, exists:initialExists, name};
  const extension = path.extname(name);
  const base = extension ? name.slice(0, -extension.length) : name;
  for (let index = 2; index <= 10000; index += 1) {
    const renamed = `${base} (${index})${extension}`;
    const candidate = path.join(directory, renamed);
    if (!fs.existsSync(candidate) && !reserved(candidate)) return {path:candidate, exists:false, name:renamed};
  }
  throw new Error(`无法为本地项目生成可用名称：${name}`);
}

function planLocalPathCopy(values, targetDirectory, conflict = "error") {
  const sources = normalizeLocalTransferPaths(values);
  const target = normalizeLocalDirectory(targetDirectory);
  const mode = ["overwrite", "rename"].includes(String(conflict || "")) ? String(conflict) : "error";
  const sourcePaths = new Set(sources.map(item => path.resolve(item.path)));
  const plannedTargets = new Set<string>();
  return {
    items:sources.map(item => {
      const source = path.resolve(item.path);
      if (path.resolve(path.dirname(source)) === target) throw new Error(`来源与目标目录相同：${path.basename(source)}`);
      if (item.stat.isDirectory()) {
        // Validate before any target is removed so a nested symbolic link can
        // never leave a partially overwritten destination behind.
        collectLocalTree(source);
        if (target === source || target.startsWith(`${source}${path.sep}`)) {
          throw new Error(`不能将目录复制到自身或其子目录：${path.basename(source)}`);
        }
      }
      const destination = localCopyTargetPath(target, path.basename(source), mode, plannedTargets);
      const destinationKey = path.resolve(destination.path);
      if (plannedTargets.has(destinationKey)) throw new Error(`本次传输存在同名目标项目：${destination.name}`);
      plannedTargets.add(destinationKey);
      if (destination.exists && sourcePaths.has(destinationKey)) throw new Error(`不能覆盖本次传输的来源项目：${destination.name}`);
      if (destination.exists) {
        const existing = fs.lstatSync(destination.path);
        if (existing.isSymbolicLink()) throw new Error(`目标目录中的同名项目是符号链接：${destination.name}`);
      }
      return {path:source, name:destination.name, exists:destination.exists, target:destination.path};
    })
  };
}

function copyLocalPaths(values, targetDirectory, conflict = "error") {
  const sources = normalizeLocalTransferPaths(values);
  const target = normalizeLocalDirectory(targetDirectory);
  const sourcePaths = new Set(sources.map(item => path.resolve(item.path)));
  const mode = ["overwrite", "rename"].includes(String(conflict || "")) ? String(conflict) : "error";
  const plan = planLocalPathCopy(values, target, mode);
  if (mode === "error" && plan.items.some(item => item.exists)) {
    const conflictItem = plan.items.find(item => item.exists);
    throw new Error(`目标目录已存在同名项目：${conflictItem.name}`);
  }
  const copied = [];
  for (const [index, item] of sources.entries()) {
    const source = path.resolve(item.path);
    const planned = plan.items[index];
    const destinationPath = planned.target;
    if (planned.exists && sourcePaths.has(path.resolve(destinationPath))) throw new Error(`不能覆盖本次传输的来源项目：${planned.name}`);
    if (planned.exists) {
      const existing = fs.lstatSync(destinationPath);
      fs.rmSync(destinationPath, {recursive:existing.isDirectory(), force:false});
    }
    fs.cpSync(source, destinationPath, {recursive:item.stat.isDirectory(), dereference:false, errorOnExist:false, force:false});
    copied.push({path:destinationPath, name:planned.name});
  }
  return {ok:true, count:copied.length, items:copied};
}

function collectLocalTree(root, relative = "", result: any[] = []) {
  if (result.length >= LOCAL_TRANSFER_ENTRY_LIMIT) throw new Error(`单次本地传输最多包含 ${LOCAL_TRANSFER_ENTRY_LIMIT} 个文件和目录`);
  const current = relative ? path.join(root, relative) : root;
  const lstat = fs.lstatSync(current);
  if (lstat.isSymbolicLink()) throw new Error(`为避免递归越界，不能传输目录中的符号链接：${relative || path.basename(root)}`);
  const stat = fs.statSync(current);
  result.push({path:current, relative, type:stat.isDirectory() ? "dir" : "file", size:stat.isFile() ? stat.size : 0});
  if (!stat.isDirectory()) return result;
  for (const entry of fs.readdirSync(current, {withFileTypes:true})) {
    collectLocalTree(root, path.join(relative, entry.name), result);
  }
  return result;
}

async function ensureRemoteDirectory(connectionId, remotePath) {
  try {
    await makeRemoteDir(connectionId, remotePath);
  } catch (error) {
    if (!/exist|已存在/i.test(String(error?.message || ""))) throw error;
  }
}

async function uploadLocalPaths(connectionId, values, remoteDirectory = ".", conflict = "error") {
  const localItems = normalizeLocalTransferPaths(values);
  const mode = ["overwrite", "rename"].includes(conflict) ? conflict : "error";
  const jobs = [];
  for (const item of localItems) {
    const name = path.basename(item.path);
    const target = await resolveRemoteUploadTarget(connectionId, remoteDirectory, name, mode);
    if (target.exists && mode === "error") {
      const error: any = new Error(`目标目录已存在同名项目：${name}`);
      error.conflict = true;
      throw error;
    }
    if (item.stat.isFile()) {
      jobs.push(startUploadJob(connectionId, item.path, target.path, item.stat.size, {ownsLocalPath:false}));
      continue;
    }
    const tree = collectLocalTree(item.path);
    await ensureRemoteDirectory(connectionId, target.path);
    for (const entry of tree.slice(1)) {
      const relative = entry.relative.split(path.sep).join("/");
      const remotePath = path.posix.join(target.path, relative);
      if (entry.type === "dir") await ensureRemoteDirectory(connectionId, remotePath);
      else jobs.push(startUploadJob(connectionId, entry.path, remotePath, entry.size, {ownsLocalPath:false}));
    }
  }
  return {ok:true, jobs, count:jobs.length};
}

module.exports = {
  __collectLocalTree: collectLocalTree,
  __parseWindowsDriveRows: parseWindowsDriveRows,
  listLocalComputer,
  listLocalDirectory,
  normalizeLocalDirectory,
  normalizeLocalEntryPath,
  normalizeLocalTransferPaths,
  renameLocalPath,
  deleteLocalPaths,
  createLocalEntry,
  chmodLocalPath,
  planLocalPathCopy,
  copyLocalPaths,
  uploadLocalPaths
};
