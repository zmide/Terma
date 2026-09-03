const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const securedWindowsPaths = new Set();
const permissionFailures = new Map();
const windowsSddlAliases = new Map([
  ["SY", "S-1-5-18"],
  ["BA", "S-1-5-32-544"],
  ["AU", "S-1-5-11"],
  ["BU", "S-1-5-32-545"],
  ["WD", "S-1-1-0"]
]);

function storagePermissionFailureKind(detail, platform = process.platform) {
  const text = String(detail || "").trim();
  if (platform !== "win32") return "permission-error";
  if (/does not support|not supported|unsupported|incorrect function|access control lists?.*not|file system.*acl|文件系统.*不支持.*(?:ACL|访问控制)|不支持.*(?:ACL|访问控制)|功能不受支持/i.test(text)) {
    return "unsupported-acl";
  }
  if (/access is denied|access denied|permission denied|eacces|拒绝访问|权限不足/i.test(text)) return "access-denied";
  if (/无法识别当前 Windows 用户|cannot identify.*windows user/i.test(text)) return "unknown-account";
  return "acl-error";
}

function windowsSystemExecutable(name) {
  const windowsRoot = String(process.env.SystemRoot || process.env.WINDIR || "").trim();
  const executable = windowsRoot ? path.join(windowsRoot, "System32", name) : "";
  return executable && fs.existsSync(executable) ? executable : (name.includes("\\") ? path.basename(name) : name);
}

function windowsUserSidFromOutput(output) {
  const text = Buffer.isBuffer(output) ? output.toString("latin1") : String(output || "");
  return text.match(/\bS-\d-(?:\d+-)+\d+\b/i)?.[0]?.toUpperCase() || "";
}

function windowsUserSid() {
  try {
    const result = spawnSync(windowsSystemExecutable("WindowsPowerShell\\v1.0\\powershell.exe"), [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
      "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value"
    ], {encoding:"utf8", windowsHide:true});
    const sid = result.status === 0 ? windowsUserSidFromOutput(result.stdout) : "";
    if (sid) return sid;
  } catch {}
  try {
    const result = spawnSync(windowsSystemExecutable("whoami.exe"), ["/user", "/fo", "csv", "/nh"], {windowsHide:true});
    const sid = result.status === 0 ? windowsUserSidFromOutput(result.stdout) : "";
    if (sid) return sid;
  } catch {}
  return "";
}

function windowsAclSidsFromSddl(output) {
  const text = String(output || "").replace(/^\uFEFF/, "");
  const sids = [];
  for (const match of text.matchAll(/\([^()]*;;;([^()]+)\)/g)) {
    const principal = String(match[1] || "").trim().toUpperCase();
    const sid = windowsSddlAliases.get(principal) || principal;
    if (sid) sids.push(sid);
  }
  return [...new Set(sids)];
}

function windowsAclSids(target) {
  const resolved = path.resolve(target);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "terma-acl-"));
  const aclFile = path.join(temporaryDirectory, "acl.txt");
  try {
    const result = spawnSync(windowsSystemExecutable("icacls.exe"), [resolved, "/save", aclFile, "/c"], {windowsHide:true});
    if (result.error || result.status !== 0) {
      throw new Error(windowsCommandFailure(result, "读取 Windows ACL"));
    }
    const data = fs.readFileSync(aclFile);
    const text = data.includes(0) ? data.toString("utf16le") : data.toString("utf8");
    const sids = windowsAclSidsFromSddl(text);
    if (!sids.length) throw new Error("无法读取 Windows ACL SID");
    return sids;
  } finally {
    fs.rmSync(temporaryDirectory, {recursive:true, force:true});
  }
}

function windowsCommandFailure(result, operation) {
  if (result?.error?.message) return `${operation}失败：${result.error.message}`;
  const output = Buffer.concat([
    Buffer.isBuffer(result?.stderr) ? result.stderr : Buffer.from(String(result?.stderr || "")),
    Buffer.isBuffer(result?.stdout) ? result.stdout : Buffer.from(String(result?.stdout || ""))
  ]).toString("utf8").trim();
  if (output && !output.includes("\uFFFD")) return output;
  return `${operation}失败（退出码 ${result?.status ?? "unknown"}）`;
}

function permissionError(target, detail, options: any = {}) {
  const resolved = path.resolve(String(target || "."));
  const detailText = String(detail || "未知权限错误").trim();
  const failureKind = storagePermissionFailureKind(detailText);
  const message = `无法收紧 Terma 数据权限：${resolved}（${detailText}）`;
  permissionFailures.set(resolved.toLowerCase(), {
    path:resolved,
    message,
    detail:detailText,
    failure_kind:failureKind,
    platform:process.platform
  });
  if (options.required) {
    const error: any = new Error(message);
    error.code = "INSECURE_STORAGE_PERMISSIONS";
    error.path = resolved;
    error.detail = detailText;
    error.failure_kind = failureKind;
    throw error;
  }
  return false;
}

function ensurePrivateWindowsPath(target, directory, options: any = {}) {
  const resolved = path.resolve(target);
  const cacheKey = `${directory ? "d" : "f"}:${resolved.toLowerCase()}`;
  if (securedWindowsPaths.has(cacheKey)) return true;
  const userSid = windowsUserSid();
  if (!userSid) return permissionError(resolved, "无法识别当前 Windows 用户 SID", options);
  const rights = directory ? "(OI)(CI)F" : "F";
  const allowed = new Set([
    userSid,
    "S-1-5-18",
    "S-1-5-32-544"
  ]);
  const run = args => spawnSync(windowsSystemExecutable("icacls.exe"), [resolved, ...args], {windowsHide:true});
  try {
    // Establish the private explicit ACL before removing inherited entries. If
    // icacls is interrupted or the grant fails, the path keeps its existing
    // inherited access instead of being left with an empty, unusable DACL.
    const grant = run(["/grant:r", `*${userSid}:${rights}`, `*S-1-5-18:${rights}`, `*S-1-5-32-544:${rights}`]);
    if (grant.status !== 0) return permissionError(resolved, windowsCommandFailure(grant, "写入 Windows ACL"), options);
    const inheritance = run(["/inheritance:r"]);
    if (inheritance.status !== 0) return permissionError(resolved, windowsCommandFailure(inheritance, "关闭 Windows ACL 继承"), options);
    for (const sid of windowsAclSids(resolved)) {
      if (allowed.has(sid)) continue;
      const removed = run(["/remove:g", `*${sid}`]);
      if (removed.status !== 0) return permissionError(resolved, `无法移除 ACL 主体 ${sid}`, options);
    }
    for (const principal of ["*S-1-5-11", "*S-1-5-32-545", "*S-1-1-0"]) run(["/remove:g", principal]);
    const unexpected = windowsAclSids(resolved).filter(sid => !allowed.has(sid));
    if (unexpected.length) return permissionError(resolved, `仍包含未授权 ACL 主体：${unexpected.join(", ")}`, options);
    securedWindowsPaths.add(cacheKey);
    permissionFailures.delete(resolved.toLowerCase());
    return true;
  } catch (error) {
    return permissionError(resolved, error.message || String(error), options);
  }
}

function ensurePrivateDirectory(directory, options: any = {}) {
  const target = String(directory || "");
  if (!target) return true;
  try {
    fs.mkdirSync(target, { recursive:true, mode:0o700 });
    if (process.platform === "win32") return ensurePrivateWindowsPath(target, true, options);
    fs.chmodSync(target, 0o700);
    permissionFailures.delete(path.resolve(target).toLowerCase());
    return true;
  } catch (error) {
    return permissionError(target, error.message || String(error), options);
  }
}

function ensurePrivateFile(file, options: any = {}) {
  const target = String(file || "");
  if (!target || !fs.existsSync(target)) return true;
  try {
    if (process.platform === "win32") return ensurePrivateWindowsPath(target, false, options);
    fs.chmodSync(target, 0o600);
    permissionFailures.delete(path.resolve(target).toLowerCase());
    return true;
  } catch (error) {
    return permissionError(target, error.message || String(error), options);
  }
}

function assertPrivateStorage(items = []) {
  for (const item of items) {
    if (!item?.path) continue;
    if (item.directory) ensurePrivateDirectory(item.path, {required:true});
    else ensurePrivateFile(item.path, {required:true});
  }
  return true;
}

function storagePermissionDiagnostics() {
  return {
    ok:permissionFailures.size === 0,
    failures:[...permissionFailures.values()]
  };
}

module.exports = {
  assertPrivateStorage,
  ensurePrivateDirectory,
  ensurePrivateFile,
  storagePermissionFailureKind,
  storagePermissionDiagnostics,
  windowsUserSidFromOutput,
  windowsAclSidsFromSddl
};
