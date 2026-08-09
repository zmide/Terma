const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const securedWindowsPaths = new Set();
const permissionFailures = new Map();

function windowsAccount() {
  const username = String(process.env.USERNAME || "").trim();
  const domain = String(process.env.USERDOMAIN || "").trim();
  if (username) return domain ? `${domain}\\${username}` : username;
  try {
    const result = spawnSync("whoami", [], {encoding:"utf8", windowsHide:true});
    return result.status === 0 ? String(result.stdout || "").trim() : "";
  } catch {
    return "";
  }
}

function windowsAclPrincipals(output, target) {
  const resolved = path.resolve(target);
  return String(output || "").split(/\r?\n/).map((line) => {
    let acl = line.trim();
    if (!acl) return "";
    if (acl.toLowerCase().startsWith(resolved.toLowerCase())) acl = acl.slice(resolved.length).trim();
    return acl.match(/^(.+?):(?:\([^)]+\))+/)?.[1]?.trim() || "";
  }).filter(Boolean);
}

function permissionError(target, detail, options: any = {}) {
  const resolved = path.resolve(String(target || "."));
  const message = `无法收紧 Terma 数据权限：${resolved}（${detail}）`;
  permissionFailures.set(resolved.toLowerCase(), { path:resolved, message, platform:process.platform });
  if (options.required) {
    const error: any = new Error(message);
    error.code = "INSECURE_STORAGE_PERMISSIONS";
    throw error;
  }
  return false;
}

function ensurePrivateWindowsPath(target, directory, options: any = {}) {
  const resolved = path.resolve(target);
  const cacheKey = `${directory ? "d" : "f"}:${resolved.toLowerCase()}`;
  if (securedWindowsPaths.has(cacheKey)) return true;
  const account = windowsAccount();
  if (!account) return permissionError(resolved, "无法识别当前 Windows 用户", options);
  const rights = directory ? "(OI)(CI)F" : "F";
  const allowed = new Set([
    account,
    String(process.env.USERNAME || ""),
    "nt authority\\system",
    "builtin\\administrators",
    "s-1-5-18",
    "s-1-5-32-544",
    "*s-1-5-18",
    "*s-1-5-32-544"
  ].map(item => item.toLowerCase()).filter(Boolean));
  const run = args => spawnSync("icacls", [resolved, ...args], {encoding:"utf8", windowsHide:true});
  try {
    const inheritance = run(["/inheritance:r"]);
    if (inheritance.status !== 0) return permissionError(resolved, String(inheritance.stderr || inheritance.stdout || "icacls inheritance failed").trim(), options);
    const grant = run(["/grant:r", `${account}:${rights}`, `*S-1-5-18:${rights}`, `*S-1-5-32-544:${rights}`]);
    if (grant.status !== 0) return permissionError(resolved, String(grant.stderr || grant.stdout || "icacls grant failed").trim(), options);
    const listed = run([]);
    if (listed.status !== 0) return permissionError(resolved, String(listed.stderr || listed.stdout || "icacls listing failed").trim(), options);
    for (const principal of windowsAclPrincipals(listed.stdout || "", resolved)) {
      if (allowed.has(principal.toLowerCase())) continue;
      const removed = run(["/remove:g", principal]);
      if (removed.status !== 0) return permissionError(resolved, `无法移除 ACL 主体 ${principal}`, options);
    }
    for (const principal of ["*S-1-5-11", "*S-1-5-32-545", "*S-1-1-0"]) run(["/remove:g", principal]);
    const verified = run([]);
    if (verified.status !== 0) return permissionError(resolved, "无法验证最终 ACL", options);
    const unexpected = windowsAclPrincipals(verified.stdout || "", resolved)
      .filter(principal => !allowed.has(principal.toLowerCase()));
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
  storagePermissionDiagnostics
};
