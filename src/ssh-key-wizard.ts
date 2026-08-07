const fs = require("node:fs");
const path = require("node:path");
const { utils } = require("ssh2");
const { PROJECT_SSH_DIR } = require("./config");
const { getConnection } = require("./db");
const { runSshCommandForConnection } = require("./ssh");
const { buildRemotePosixCommand } = require("./remote-posix");

function cleanKeyName(value) {
  const name = String(value || "id_ed25519_terma").trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(name) || name === "." || name === "..") {
    throw new Error("密钥名称只能包含字母、数字、点、横线和下划线");
  }
  return name;
}

function uniqueKeyPath(name) {
  fs.mkdirSync(PROJECT_SSH_DIR, {recursive:true});
  const clean = cleanKeyName(name);
  let target = path.join(PROJECT_SSH_DIR, clean);
  let index = 1;
  while (fs.existsSync(target) || fs.existsSync(`${target}.pub`)) {
    target = path.join(PROJECT_SSH_DIR, `${clean}-${index}`);
    index += 1;
  }
  return target;
}

function generateUsableEd25519Key(comment, passphrase) {
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const keys = utils.generateKeyPairSync("ed25519", {
      comment,
      ...(passphrase ? {cipher:"aes256-ctr", passphrase} : {})
    });
    const parsed = utils.parseKey(Buffer.from(keys.private), passphrase || undefined);
    if (!(parsed instanceof Error)) return keys;
    lastError = parsed;
  }
  throw new Error(`生成的 Ed25519 私钥校验失败：${lastError?.message || "未知格式错误"}`);
}

function generateSshKey(data: any = {}) {
  const target = uniqueKeyPath(data.name);
  const passphrase = String(data.passphrase || "");
  const comment = String(data.comment || "Terma").trim().slice(0, 120);
  const keys = generateUsableEd25519Key(comment, passphrase);
  fs.writeFileSync(target, keys.private, {encoding:"utf8", mode:0o600, flag:"wx"});
  fs.writeFileSync(`${target}.pub`, `${String(keys.public).trim()}\n`, {encoding:"utf8", mode:0o644, flag:"wx"});
  try { fs.chmodSync(target, 0o600); } catch {}
  try { fs.chmodSync(`${target}.pub`, 0o644); } catch {}
  return {
    ok:true,
    private_path:target,
    public_path:`${target}.pub`,
    public_key:String(keys.public).trim(),
    has_passphrase:Boolean(passphrase)
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function deployGeneratedPublicKey(connectionId, publicPath) {
  const target = path.resolve(String(publicPath || ""));
  const relative = path.relative(path.resolve(PROJECT_SSH_DIR), target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !target.endsWith(".pub")) {
    throw new Error("公钥不在 Terma 密钥目录中");
  }
  const publicKey = fs.readFileSync(target, "utf8").trim();
  if (!/^ssh-ed25519\s+\S+/.test(publicKey)) throw new Error("公钥格式无效");
  const encoded = Buffer.from(publicKey, "utf8").toString("base64");
  const command = [
    "set -eu",
    "td_ssh_dir=\"$HOME/.ssh\"",
    "td_auth=\"$td_ssh_dir/authorized_keys\"",
    "mkdir -p \"$td_ssh_dir\"",
    "chmod 700 \"$td_ssh_dir\"",
    `td_key=$(printf %s ${shellQuote(encoded)} | base64 -d 2>/dev/null || printf %s ${shellQuote(encoded)} | base64 -D)`,
    "touch \"$td_auth\"",
    "chmod 600 \"$td_auth\"",
    "grep -qxF \"$td_key\" \"$td_auth\" || printf '%s\\n' \"$td_key\" >> \"$td_auth\""
  ].join("\n");
  const connection = getConnection(Number(connectionId));
  const result: any = await runSshCommandForConnection(connection, buildRemotePosixCommand(command), 60000);
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || result.error?.message || "部署公钥失败").trim());
  return {ok:true, connection_id:connection.id, connection_name:connection.name};
}

module.exports = {
  cleanKeyName,
  deployGeneratedPublicKey,
  generateSshKey
};
