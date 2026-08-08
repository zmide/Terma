const fs = require("node:fs");
const path = require("node:path");
const { PROJECT_SSH_DIR, USER_SSH_DIR } = require("./config");

function pathKey(value) {
  const resolved = path.resolve(String(value || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function resolvedRoot(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function identityRoots() {
  const roots = [];
  const seen = new Set();
  for (const value of [PROJECT_SSH_DIR, USER_SSH_DIR]) {
    const root = resolvedRoot(value);
    const key = pathKey(root);
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(root);
  }
  return roots;
}

function sameFileIdentity(left, right) {
  const leftInode = Number(left?.ino || 0);
  const rightInode = Number(right?.ino || 0);
  const leftDevice = Number(left?.dev || 0);
  const rightDevice = Number(right?.dev || 0);
  if (!leftInode || !rightInode) return true;
  return leftInode === rightInode && leftDevice === rightDevice;
}

function privateKeyHeader(name, head) {
  const lowerName = String(name || "").toLowerCase();
  if (lowerName.endsWith(".pub") || ["authorized_keys", "known_hosts", "config"].includes(lowerName)) return false;
  return /-----BEGIN (?:OPENSSH |RSA |DSA |EC |ENCRYPTED )?PRIVATE KEY-----/.test(head)
    || /^PuTTY-User-Key-File-/m.test(head);
}

function looksLikePrivateKeyData(name, data) {
  const head = Buffer.isBuffer(data)
    ? data.subarray(0, 4096).toString("utf8")
    : String(data || "").slice(0, 4096);
  return privateKeyHeader(name, head);
}

function inspectRegularPrivateKey(file) {
  const candidate = path.resolve(String(file || ""));
  let descriptor = null;
  try {
    const before = fs.lstatSync(candidate);
    if (!before.isFile() || before.isSymbolicLink() || Number(before.nlink || 1) > 1 || before.size > 1024 * 1024) return null;
    const noFollow = Number(fs.constants.O_NOFOLLOW || 0);
    descriptor = fs.openSync(candidate, fs.constants.O_RDONLY | noFollow);
    const opened = fs.fstatSync(descriptor);
    const current = fs.lstatSync(candidate);
    if (!opened.isFile() || current.isSymbolicLink() || Number(opened.nlink || 1) > 1 || Number(current.nlink || 1) > 1) return null;
    if (!sameFileIdentity(before, opened) || !sameFileIdentity(opened, current)) return null;
    const resolved = fs.realpathSync(candidate);
    if (pathKey(resolved) !== pathKey(candidate)) return null;
    const size = Math.min(Number(opened.size || 0), 4096);
    const buffer = Buffer.alloc(size);
    if (size) fs.readSync(descriptor, buffer, 0, size, 0);
    if (!looksLikePrivateKeyData(path.basename(resolved), buffer)) return null;
    return { path:resolved, stat:opened };
  } catch {
    return null;
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function looksLikePrivateKey(file) {
  return Boolean(inspectRegularPrivateKey(file));
}

function allowedIdentityPath(file) {
  if (!file || typeof file !== "string") return "";
  const candidate = path.resolve(file);
  const parent = pathKey(path.dirname(candidate));
  if (!identityRoots().some(root => parent === pathKey(root))) return "";
  return inspectRegularPrivateKey(candidate)?.path || "";
}

function listAllowedIdentityPaths() {
  const allowed = new Map();
  for (const root of identityRoots()) {
    if (!fs.existsSync(root)) continue;
    let names = [];
    try { names = fs.readdirSync(root); } catch { continue; }
    for (const name of names) {
      const resolved = allowedIdentityPath(path.join(root, name));
      if (resolved) allowed.set(pathKey(resolved), resolved);
    }
  }
  return [...allowed.values()];
}

function assertAllowedIdentityPath(file, options: any = {}) {
  if (!String(file || "").trim()) {
    if (options.allowEmpty) return "";
    throw new Error("请选择 Terma 已识别的私钥文件");
  }
  const allowed = allowedIdentityPath(String(file));
  if (!allowed) throw new Error("所选私钥不在允许的密钥目录中，或不是独立的普通私钥文件");
  return allowed;
}

module.exports = {
  allowedIdentityPath,
  assertAllowedIdentityPath,
  identityRoots,
  listAllowedIdentityPaths,
  looksLikePrivateKey,
  looksLikePrivateKeyData
};
