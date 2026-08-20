const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { utils } = require("ssh2");
const { PROJECT_SSH_DIR, USER_SSH_DIR } = require("./config");
const { getConnection } = require("./db");
const { allowedIdentityPath, looksLikePrivateKeyData } = require("./identity-path");
const { runSshCommandForConnection, securePrivateKeyPermissions } = require("./ssh");
const { buildRemotePosixCommand } = require("./remote-posix");
const { ensurePrivateDirectory } = require("./storage-permissions");

const KEY_TYPES = Object.freeze({
  ed25519: {bits:[256], defaultBits:256, label:"Ed25519"},
  rsa: {bits:[2048, 3072, 4096], defaultBits:3072, label:"RSA"},
  ecdsa: {bits:[256, 384, 521], defaultBits:256, label:"ECDSA"}
});

function pathKey(value) {
  const resolved = path.resolve(String(value || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function cleanKeyName(value, keyType = "ed25519") {
  const name = String(value || `id_${keyType}_terma`).trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(name) || name === "." || name === ".." || name.toLowerCase().endsWith(".pub")) {
    throw new Error("密钥名称只能包含字母、数字、点、横线和下划线，且不能以 .pub 结尾");
  }
  return name;
}

function normalizeKeyOptions(data: any = {}) {
  const keyType = String(data.key_type || data.type || "ed25519").trim().toLowerCase();
  const spec = KEY_TYPES[keyType];
  if (!spec) throw new Error("密钥类型只支持 Ed25519、RSA 或 ECDSA");
  const requestedBits = data.key_bits ?? data.bits;
  const bits = requestedBits === "" || requestedBits === null || typeof requestedBits === "undefined"
    ? spec.defaultBits
    : Number(requestedBits);
  if (!Number.isInteger(bits) || !spec.bits.includes(bits)) {
    throw new Error(`${spec.label} 密钥长度必须是 ${spec.bits.join("、")}`);
  }
  return {keyType, bits, label:spec.label};
}

function keyRoot(scope = "project", userKeysEnabled = false) {
  const value = String(scope || "project").toLowerCase();
  if (value === "project") return PROJECT_SSH_DIR;
  if (value !== "user") throw new Error("未知的密钥目录");
  if (!userKeysEnabled) {
    const error: any = new Error("用户 ~/.ssh 密钥管理尚未启用");
    error.statusCode = 403;
    throw error;
  }
  return USER_SSH_DIR;
}

function uniqueKeyPath(name, scope = "project", userKeysEnabled = false, keyType = "ed25519") {
  const root = keyRoot(scope, userKeysEnabled);
  ensurePrivateDirectory(root, {required:true});
  const clean = cleanKeyName(name, keyType);
  let target = path.join(root, clean);
  let index = 1;
  while (fs.existsSync(target) || fs.existsSync(`${target}.pub`)) {
    target = path.join(root, `${clean}-${index}`);
    index += 1;
  }
  return target;
}

function generateUsableKey(keyType, bits, comment, passphrase) {
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const keys = utils.generateKeyPairSync(keyType, {
      ...(keyType === "ed25519" ? {} : {bits}),
      comment,
      ...(passphrase ? {cipher:"aes256-ctr", passphrase} : {})
    });
    const parsed = utils.parseKey(Buffer.from(keys.private), passphrase || undefined);
    if (!(parsed instanceof Error)) return keys;
    lastError = parsed;
  }
  throw new Error(`生成的 ${KEY_TYPES[keyType].label} 私钥校验失败：${lastError?.message || "未知格式错误"}`);
}

function generateSshKey(data: any = {}, userKeysEnabled = false) {
  const options = normalizeKeyOptions(data);
  const scope = String(data.scope || "project").toLowerCase();
  const target = uniqueKeyPath(data.name, scope, userKeysEnabled, options.keyType);
  const passphrase = String(data.passphrase || "");
  const comment = String(data.comment || "Terma").trim().slice(0, 120);
  const keys = generateUsableKey(options.keyType, options.bits, comment, passphrase);
  const publicPath = `${target}.pub`;
  try {
    fs.writeFileSync(target, keys.private, {encoding:"utf8", mode:0o600, flag:"wx"});
    fs.writeFileSync(publicPath, `${String(keys.public).trim()}\n`, {encoding:"utf8", mode:0o644, flag:"wx"});
    securePrivateKeyPermissions(target);
    try { fs.chmodSync(publicPath, 0o644); } catch {}
    return {ok:true, scope, key_type:options.keyType, key_bits:options.bits, private_path:target, public_path:publicPath, public_key:String(keys.public).trim(), has_passphrase:Boolean(passphrase)};
  } catch (error) {
    try { fs.rmSync(target, {force:true}); } catch {}
    try { fs.rmSync(publicPath, {force:true}); } catch {}
    throw error;
  }
}

function managedPrivatePath(file, scope, userKeysEnabled = false) {
  const root = path.resolve(keyRoot(scope, userKeysEnabled));
  const candidate = path.resolve(String(file || ""));
  if (pathKey(path.dirname(candidate)) !== pathKey(root)) throw new Error("密钥不在所选管理目录中");
  const allowed = allowedIdentityPath(candidate);
  if (!allowed) throw new Error("所选文件不是可管理的普通私钥文件");
  return allowed;
}

function parsedPublicKey(privatePath) {
  const publicPath = `${privatePath}.pub`;
  const parsed = utils.parseKey(fs.existsSync(publicPath) ? fs.readFileSync(publicPath) : fs.readFileSync(privatePath));
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  return item instanceof Error ? null : item;
}

function publicKeyBits(parsed) {
  if (!parsed) return 0;
  if (parsed.type === "ssh-ed25519") return 256;
  try {
    const key = crypto.createPublicKey(parsed.getPublicPEM());
    if (parsed.type === "ssh-rsa") return Number(key.asymmetricKeyDetails?.modulusLength || 0);
    const curve = String(key.asymmetricKeyDetails?.namedCurve || "").toLowerCase();
    return Number(curve.match(/(?:p-|nistp)(256|384|521)/)?.[1] || 0);
  } catch {
    return Number(String(parsed.type || "").match(/nistp(256|384|521)/)?.[1] || 0);
  }
}

function keyTypeName(value) {
  const type = String(value || "");
  if (type === "ssh-rsa") return "RSA";
  if (type.startsWith("ecdsa-")) return "ECDSA";
  if (type === "ssh-ed25519") return "Ed25519";
  return type || "Unknown";
}

function isPrivateKeyEncrypted(privatePath) {
  try {
    const data = fs.readFileSync(privatePath);
    const text = data.toString("utf8");
    if (!/PRIVATE KEY/.test(text)) return false;
    const parsed = utils.parseKey(data);
    return parsed instanceof Error;
  } catch {
    return false;
  }
}

function managedKeyMetadata(privatePath, scope) {
  const stat = fs.statSync(privatePath);
  const parsed = parsedPublicKey(privatePath);
  const publicSsh = parsed?.getPublicSSH?.();
  return {
    name:path.basename(privatePath), path:privatePath, public_path:fs.existsSync(`${privatePath}.pub`) ? `${privatePath}.pub` : "", scope,
    type:keyTypeName(parsed?.type), key_type:String(parsed?.type || ""), bits:publicKeyBits(parsed), comment:String(parsed?.comment || ""),
    fingerprint:publicSsh ? `SHA256:${crypto.createHash("sha256").update(publicSsh).digest("base64").replace(/=+$/, "")}` : "",
    size:Number(stat.size || 0), modified_at:Number(stat.mtimeMs || 0), has_public_key:Boolean(parsed),
    permissions:process.platform === "win32" ? "managed" : ((stat.mode & 0o077) === 0 ? "secure" : "unsafe"),
    has_passphrase:isPrivateKeyEncrypted(privatePath)
  };
}

function listManagedKeys(userKeysEnabled = false) {
  const scopes: Array<[string, string]> = [["project", PROJECT_SSH_DIR]];
  if (userKeysEnabled) scopes.push(["user", USER_SSH_DIR]);
  const items = [];
  for (const [scope, root] of scopes) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      const privatePath = allowedIdentityPath(path.join(root, name));
      if (!privatePath) continue;
      try { items.push(managedKeyMetadata(privatePath, scope)); } catch {}
    }
  }
  return {items:items.sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name)), directories:{project:PROJECT_SSH_DIR, user:userKeysEnabled ? USER_SSH_DIR : ""}, user_keys_enabled:Boolean(userKeysEnabled)};
}

function importManagedKey(filename, data, scope = "project", userKeysEnabled = false) {
  const name = cleanKeyName(path.basename(String(filename || "id_key")), "key");
  if (!Buffer.isBuffer(data) || !data.length || data.length > 1024 * 1024 || !looksLikePrivateKeyData(name, data)) throw new Error("上传内容不是受支持的 SSH 私钥，或文件超过 1MB");
  const target = uniqueKeyPath(name, scope, userKeysEnabled, "key");
  try {
    fs.writeFileSync(target, data, {mode:0o600, flag:"wx"});
    securePrivateKeyPermissions(target);
    const parsed = parsedPublicKey(target);
    const publicSsh = parsed?.getPublicSSH?.();
    if (publicSsh) {
      const publicText = `${String(publicSsh).trim()}${parsed.comment ? ` ${String(parsed.comment).trim()}` : ""}\n`;
      fs.writeFileSync(`${target}.pub`, publicText, {mode:0o644, flag:"wx"});
    }
    return {ok:true, item:managedKeyMetadata(target, scope)};
  } catch (error) {
    try { fs.rmSync(target, {force:true}); } catch {}
    try { fs.rmSync(`${target}.pub`, {force:true}); } catch {}
    throw error;
  }
}

function deleteManagedKey(file, scope, userKeysEnabled = false, referencedPaths: string[] = []) {
  const target = managedPrivatePath(file, scope, userKeysEnabled);
  if (referencedPaths.some(item => pathKey(item) === pathKey(target))) throw new Error("该私钥正在被 SSH 连接使用，请先更换连接的认证密钥");
  fs.rmSync(target);
  try { fs.rmSync(`${target}.pub`, {force:true}); } catch {}
  return {ok:true};
}

function managedKeyProperties(file, scope, userKeysEnabled = false) {
  return managedKeyMetadata(managedPrivatePath(file, scope, userKeysEnabled), scope);
}

function runSshKeygenPassphrase(privatePath, currentPassphrase, nextPassphrase) {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh-keygen", ["-p", "-f", privatePath, "-P", String(currentPassphrase || ""), "-N", String(nextPassphrase || "")], {windowsHide:true, stdio:["ignore", "ignore", "pipe"]});
    let stderr = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(new Error("修改私钥口令超时"), undefined); }, 20000);
    child.stderr?.on("data", chunk => { stderr += String(chunk); });
    child.on("error", error => finish(new Error("当前系统没有可用的 ssh-keygen，无法修改私钥口令"), undefined));
    child.on("close", code => {
      if (code === 0) return finish(null, true);
      finish(new Error(stderr.toLowerCase().includes("incorrect passphrase") ? "原私钥口令不正确" : "修改私钥口令失败，请确认当前口令和 OpenSSH 工具可用"), undefined);
    });
  });
}

async function updateManagedKey(file, scope, userKeysEnabled = false, data:any = {}) {
  const target = managedPrivatePath(file, scope, userKeysEnabled);
  const comment = String(data.comment ?? "").trim().slice(0, 120);
  if (/[\u0000-\u001f\u007f]/.test(comment)) throw new Error("备注不能包含控制字符");
  const currentPassphrase = String(data.current_passphrase || "");
  const nextPassphrase = String(data.new_passphrase || "");
  if (currentPassphrase.length > 256 || nextPassphrase.length > 256) throw new Error("私钥口令长度不能超过 256 个字符");
  const before = managedKeyMetadata(target, scope);
  const passphraseRequested = Boolean(data.change_passphrase) || Boolean(currentPassphrase) || Boolean(nextPassphrase);
  if (passphraseRequested) {
    if (before.has_passphrase && !currentPassphrase) throw new Error("请输入当前私钥口令");
    await runSshKeygenPassphrase(target, currentPassphrase, nextPassphrase);
  }
  const publicPath = `${target}.pub`;
  if (!fs.existsSync(publicPath)) throw new Error("该私钥没有对应的 .pub 公钥文件");
  const publicKey = fs.readFileSync(publicPath, "utf8").trim();
  const parts = publicKey.split(/\s+/);
  if (parts.length < 2) throw new Error("公钥格式无效");
  const nextPublic = `${parts[0]} ${parts[1]}${comment ? ` ${comment}` : ""}\n`;
  fs.writeFileSync(publicPath, nextPublic, {encoding:"utf8", mode:0o644});
  return {ok:true, item:managedKeyMetadata(target, scope)};
}

function managedPublicKey(file, scope, userKeysEnabled = false) {
  const target = managedPrivatePath(file, scope, userKeysEnabled);
  const publicPath = `${target}.pub`;
  if (!fs.existsSync(publicPath)) throw new Error("该私钥没有对应的 .pub 公钥文件");
  const publicKey = fs.readFileSync(publicPath, "utf8").trim();
  if (!/^(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521))\s+\S+(?:\s+.*)?$/.test(publicKey)) throw new Error("公钥格式无效");
  return {ok:true, public_path:publicPath, public_key:publicKey, filename:path.basename(publicPath)};
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function deployGeneratedPublicKey(connectionId, publicPath, userKeysEnabled = false) {
  const target = path.resolve(String(publicPath || ""));
  const projectRelative = path.relative(path.resolve(PROJECT_SSH_DIR), target);
  const userRelative = path.relative(path.resolve(USER_SSH_DIR), target);
  const inProject = projectRelative && !projectRelative.startsWith("..") && !path.isAbsolute(projectRelative);
  const inUser = userKeysEnabled && userRelative && !userRelative.startsWith("..") && !path.isAbsolute(userRelative);
  if ((!inProject && !inUser) || !target.endsWith(".pub")) throw new Error("公钥不在允许管理的密钥目录中");
  const publicKey = fs.readFileSync(target, "utf8").trim();
  if (!/^(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521))\s+\S+(?:\s+.*)?$/.test(publicKey)) throw new Error("公钥格式无效");
  const encoded = Buffer.from(publicKey, "utf8").toString("base64");
  const command = ["set -eu", "td_ssh_dir=\"$HOME/.ssh\"", "td_auth=\"$td_ssh_dir/authorized_keys\"", "mkdir -p \"$td_ssh_dir\"", "chmod 700 \"$td_ssh_dir\"", `td_key=$(printf %s ${shellQuote(encoded)} | base64 -d 2>/dev/null || printf %s ${shellQuote(encoded)} | base64 -D)`, "touch \"$td_auth\"", "chmod 600 \"$td_auth\"", "grep -qxF \"$td_key\" \"$td_auth\" || printf '%s\\n' \"$td_key\" >> \"$td_auth\""].join("\n");
  const connection = getConnection(Number(connectionId));
  const result: any = await runSshCommandForConnection(connection, buildRemotePosixCommand(command), 60000);
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || result.error?.message || "部署公钥失败").trim());
  return {ok:true, connection_id:connection.id, connection_name:connection.name};
}

module.exports = { KEY_TYPES, cleanKeyName, deleteManagedKey, deployGeneratedPublicKey, generateSshKey, importManagedKey, listManagedKeys, managedKeyProperties, managedPublicKey, normalizeKeyOptions, updateManagedKey };
