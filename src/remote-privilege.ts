const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const { SSH_BIN } = require("./config");
const { getConnection } = require("./db");
const { effectiveExtraArgs } = require("./ssh-command");
const { proxyJumpArgument, sshDestinationArgs, structuredOpenSshArgs } = require("./ssh-connection");
const { runPasswordCommand, shouldUseBuiltinSsh, decodeSshOutput } = require("./ssh2-client");
const { securePrivateKeyPermissions } = require("./ssh");
const { ensureConnectionHostTrusted, isHostTrustError, systemHostKeyArgs } = require("./ssh-host-trust");

const MAX_COMMAND_LENGTH = 1024 * 1024;
const MAX_PASSWORD_LENGTH = 4096;
const GRANT_TTL_MS = 10 * 60 * 1000;
const grants = new Map();

const REUSE_POLICIES = new Set(["once", "10m", "30m", "session"]);

function normalizeReusePolicy(value) {
  const normalized = text(value).trim().toLowerCase();
  if (["10", "10min", "10-min", "10minutes"].includes(normalized)) return "10m";
  if (["30", "30min", "30-min", "30minutes"].includes(normalized)) return "30m";
  if (["run", "process", "app", "runtime", "session"].includes(normalized)) return "session";
  return REUSE_POLICIES.has(normalized) ? normalized : "once";
}

function reusePolicyTtl(policy) {
  if (policy === "10m") return 10 * 60 * 1000;
  if (policy === "30m") return 30 * 60 * 1000;
  // Session grants are deliberately process-local; a restart drops them.
  if (policy === "session") return 0;
  return GRANT_TTL_MS;
}

function text(value) {
  return String(value ?? "");
}

function nonEmpty(value) {
  const result = text(value).trim();
  return result || "";
}

function boundedTimeout(value, fallback = 60000) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1000, Math.min(Math.trunc(number), 20 * 60 * 1000)) : fallback;
}

function validateSecret(value, label) {
  const result = text(value);
  if (result.length > MAX_PASSWORD_LENGTH) throw new Error(`${label}过长`);
  return result;
}

function authorizationInput(request: any = {}) {
  const source = request?.authorization || request?.admin || request?.ssh || request || {};
  return source && typeof source === "object" ? source : {};
}

function normalizeRemotePrivilegeRequest(request: any = {}) {
  const source = authorizationInput(request);
  const requestedAuthMethod = nonEmpty(source.auth_method || source.method || source.ssh_auth_method).toLowerCase();
  const sshUser = nonEmpty(source.ssh_user || source.username || source.user);
  const sshPassword = source.ssh_password !== undefined
    ? validateSecret(source.ssh_password, "SSH 密码")
    : source.password !== undefined
      ? validateSecret(source.password, "SSH 密码")
      : "";
  const identityFile = nonEmpty(source.identity_file || source.private_key || source.key_file);
  const passphrase = source.private_key_passphrase !== undefined
    ? validateSecret(source.private_key_passphrase, "私钥口令")
    : source.passphrase !== undefined
      ? validateSecret(source.passphrase, "私钥口令")
      : "";
  const agentRequested = requestedAuthMethod === "agent" || source.ssh_agent === true || source.agent === true || String(source.ssh_agent_mode || source.agent_mode || "").toLowerCase() === "required";
  const authMethod = requestedAuthMethod || (sshPassword ? "password" : identityFile ? "key" : agentRequested ? "agent" : "");
  const sudoRequested = source.sudo_requested === true || source.use_sudo === true || source.sudo === true || source.sudo_password !== undefined || source.sudoPassword !== undefined;
  const sudoPassword = source.sudo_password !== undefined
    ? validateSecret(source.sudo_password, "sudo 密码")
    : source.sudoPassword !== undefined
      ? validateSecret(source.sudoPassword, "sudo 密码")
      : "";
  if (sshPassword && (identityFile || agentRequested)) throw new Error("临时 SSH 授权不能同时使用密码、私钥和 SSH Agent");
  if (passphrase && !identityFile && !agentRequested) throw new Error("私钥口令需要同时指定私钥文件");
  if (authMethod && !["password", "key", "agent"].includes(authMethod)) throw new Error("临时 SSH 认证方式无效");
  if (authMethod === "password" && !sshPassword) throw new Error("密码认证需要输入 SSH 密码");
  if (authMethod === "key" && !identityFile) throw new Error("私钥认证需要选择私钥文件");
  if (authMethod === "agent" && !agentRequested) throw new Error("SSH Agent 认证配置无效");
  if (sudoPassword.includes("\n") || sudoPassword.includes("\r")) throw new Error("sudo 密码不能包含换行符");
  return {
    auth_method:authMethod,
    ssh_user:sshUser,
    ssh_password:sshPassword,
    identity_file:identityFile,
    private_key_passphrase:passphrase,
    agent_requested:agentRequested,
    sudo_requested:sudoRequested,
    sudo_password:sudoPassword,
    reuse_policy:normalizeReusePolicy(source.reuse_policy || source.reusePolicy || source.grant_reuse || source.reuse),
    timeout_ms:boundedTimeout(source.timeout_ms || request.timeout_ms),
    require_sudo_password:source.require_sudo_password === true
  };
}

function createTemporaryAdminConnection(baseConnection: any, request: any = {}) {
  if (!baseConnection || typeof baseConnection !== "object") throw new Error("缺少 SSH 连接配置");
  const authorization = normalizeRemotePrivilegeRequest(request);
  const connection = { ...baseConnection };
  if (authorization.ssh_user) connection.ssh_user = authorization.ssh_user;
  if (authorization.ssh_password) {
    connection.auth_type = "password";
    connection.ssh_password = authorization.ssh_password;
    delete connection.identity_file;
    delete connection.private_key_passphrase;
    connection.ssh_agent_mode = "off";
  } else if (authorization.agent_requested) {
    connection.auth_type = "key";
    delete connection.ssh_password;
    delete connection.identity_file;
    delete connection.private_key_passphrase;
    connection.ssh_agent_mode = "required";
  } else if (authorization.identity_file) {
    connection.auth_type = "key";
    delete connection.ssh_password;
    connection.identity_file = authorization.identity_file;
    connection.private_key_passphrase = authorization.private_key_passphrase;
    connection.ssh_agent_mode = "off";
  }
  return { connection, authorization };
}

function systemConnectionArgs(connection: any) {
  const jump = connection?.jump_connection_id ? getConnection(Number(connection.jump_connection_id)) : null;
  const args = [
    ...systemHostKeyArgs(connection, { additionalConnections:jump ? [jump] : [] }),
    ...structuredOpenSshArgs(connection)
  ];
  if (jump) args.push("-J", proxyJumpArgument(jump));
  return args;
}

function buildRemotePrivilegeInvocation(command, authorization: any = {}) {
  const script = text(command);
  if (!script.trim()) throw new Error("请输入要执行的远端命令");
  if (script.length > MAX_COMMAND_LENGTH) throw new Error("远端命令过长");
  if (!authorization.sudo_requested) {
    return { command:"/bin/sh -s", input:script.endsWith("\n") ? script : `${script}\n`, uses_sudo:false };
  }
  const hasPassword = Boolean(authorization.sudo_password);
  if (authorization.require_sudo_password && !hasPassword) throw new Error("此操作需要输入 sudo 密码");
  return {
    command:hasPassword ? "sudo -S -k -p '' -- /bin/sh -s" : "sudo -n -k -p '' -- /bin/sh -s",
    input:hasPassword
      ? `${authorization.sudo_password}\n${script}${script.endsWith("\n") ? "" : "\n"}`
      : script.endsWith("\n") ? script : `${script}\n`,
    uses_sudo:true,
    password_via_stdin:hasPassword
  };
}

function createRemotePrivilegeGrant(baseConnection: any, request: any = {}, scope = "") {
  const { connection, authorization } = createTemporaryAdminConnection(baseConnection, request);
  if (!authorization.auth_method) throw new Error("请选择临时 SSH 认证方式");
  const id = crypto.randomBytes(24).toString("base64url");
  const reusePolicy = authorization.reuse_policy || "once";
  const ttl = reusePolicyTtl(reusePolicy);
  const expiresAt = ttl > 0 ? Date.now() + ttl : 0;
  const baseHost = nonEmpty(baseConnection?.ssh_host).toLowerCase();
  const basePort = Number(baseConnection?.ssh_port || 22);
  grants.set(id, {
    id,
    connection,
    authorization,
    scope:String(scope || ""),
    reusePolicy,
    expiresAt,
    baseId:Number(baseConnection?.id || 0),
    baseHost,
    basePort
  });
  return {
    id,
    expires_at:expiresAt,
    ssh_user:connection.ssh_user,
    auth_method:authorization.auth_method,
    scope:String(scope || ""),
    reuse_policy:reusePolicy,
    reusable:reusePolicy !== "once"
  };
}

function getRemotePrivilegeGrant(id, baseConnection: any = null, scope = "") {
  const key = text(id).trim();
  const grant = grants.get(key);
  if (!grant || (grant.expiresAt > 0 && grant.expiresAt < Date.now())) {
    if (grant) revokeRemotePrivilegeGrant(key);
    throw new Error("临时管理员授权已过期，请重新授权");
  }
  if (baseConnection && Number(grant.baseId || 0) && Number(baseConnection.id || 0) !== Number(grant.baseId || 0)) {
    throw new Error("临时管理员授权与当前 SSH 主机不匹配");
  }
  if (baseConnection && (nonEmpty(baseConnection.ssh_host).toLowerCase() !== grant.baseHost || Number(baseConnection.ssh_port || 22) !== grant.basePort)) {
    throw new Error("临时管理员授权与当前 SSH 主机不匹配");
  }
  const requestedScope = String(scope || "").trim();
  const grantedScope = String(grant.scope || "").trim();
  if (grantedScope !== requestedScope && grantedScope !== "host:*") throw new Error("临时管理员授权不能用于此操作");
  return grant;
}

function revokeRemotePrivilegeGrant(id) {
  const key = text(id).trim();
  const grant = grants.get(key);
  if (!grant) return false;
  try {
    grant.authorization.ssh_password = "";
    grant.authorization.private_key_passphrase = "";
    grant.authorization.sudo_password = "";
    grant.connection.ssh_password = "";
    grant.connection.private_key_passphrase = "";
  } catch {}
  grants.delete(key);
  return true;
}

function handoffRemotePrivilegeGrant(grant, callback) {
  try {
    return callback();
  } catch (error) {
    const policy = String(grant?.reuse_policy || grant?.reusePolicy || grant?.authorization?.reuse_policy || "once");
    if (grant?.id && policy === "once") revokeRemotePrivilegeGrant(grant.id);
    throw error;
  }
}

function reapRemotePrivilegeGrants() {
  const now = Date.now();
  for (const [id, grant] of grants) if (grant.expiresAt > 0 && grant.expiresAt < now) revokeRemotePrivilegeGrant(id);
}

async function probeRemotePrivilege(connection, authorization) {
  const direct = await runCommandWithInput(connection, "id -u", "", authorization.timeout_ms);
  if (direct.status !== 0) throw new Error(`${direct.stderr || direct.stdout || direct.error?.message || "临时管理员 SSH 登录失败"}`.trim());
  const uid = Number(String(direct.stdout || "").trim().split(/\s+/)[0]);
  if (uid === 0) return true;
  const sudo = buildRemotePrivilegeInvocation("id -u", {...authorization, sudo_requested:true});
  const elevated = await runCommandWithInput(connection, sudo.command, sudo.input, authorization.timeout_ms);
  const elevatedUid = Number(String(elevated.stdout || "").trim().split(/\s+/).pop());
  if (elevated.status === 0 && elevatedUid === 0) return false;
  const output = `${elevated.stderr || ""}${elevated.stdout || ""}`.replace(/sudo:\s*[^\n]*/gi, "sudo: 管理员权限验证失败").trim();
  throw new Error(output || "当前管理员账号没有 root 或可用 sudo 权限");
}

function runCommandWithInput(connection: any, command, input, timeoutMs, onChunk: any = null) {
  if (shouldUseBuiltinSsh(connection)) {
    return runPasswordCommand(connection, command, input, timeoutMs, onChunk).catch(error => {
      if (isHostTrustError(error)) throw error;
      throw error;
    });
  }
  return new Promise(async (resolve, reject) => {
    try { await ensureConnectionHostTrusted(connection); } catch (error) { reject(error); return; }
    const args = ["-T", ...systemConnectionArgs(connection), "-o", "BatchMode=yes", "-p", String(connection.ssh_port || 22)];
    if (connection.identity_file) {
      securePrivateKeyPermissions(connection.identity_file);
      args.push("-i", connection.identity_file);
    }
    args.push(...effectiveExtraArgs(connection.extra_args, connection));
    args.push(...sshDestinationArgs(connection), String(command || ""));
    const child = spawn(SSH_BIN, args, { stdio:["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (status, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        status,
        stdout:decodeSshOutput(Buffer.concat(stdout).slice(-60000), connection.terminal_encoding),
        stderr:decodeSshOutput(Buffer.concat(stderr).slice(-60000), connection.terminal_encoding),
        error
      });
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish(null, new Error("命令执行超时"));
    }, timeoutMs);
    child.stdout?.on("data", chunk => { stdout.push(Buffer.from(chunk)); onChunk?.(chunk, "stdout"); });
    child.stderr?.on("data", chunk => { stderr.push(Buffer.from(chunk)); onChunk?.(chunk, "stderr"); });
    child.on("error", error => finish(null, error));
    child.on("close", code => finish(code));
    try {
      child.stdin.end(input || "");
    } catch (error) {
      finish(null, error);
    }
  });
}

async function runRemotePrivilegeCommand(baseConnection: any, command, request: any = {}) {
  reapRemotePrivilegeGrants();
  const grant = request?.grant_id
    ? getRemotePrivilegeGrant(request.grant_id, baseConnection, request.scope || "")
    : null;
  const temporary = grant ? null : createTemporaryAdminConnection(baseConnection, request);
  const connection = grant
    ? {...grant.connection, x11_mode:baseConnection?.x11_mode ?? grant.connection.x11_mode}
    : temporary.connection;
  const authorization = grant ? grant.authorization : temporary.authorization;
  const isRoot = await probeRemotePrivilege(connection, authorization);
  const invocation = isRoot
    ? {command:"/bin/sh -s", input:String(command).endsWith("\n") ? String(command) : `${command}\n`}
    : buildRemotePrivilegeInvocation(command, {...authorization, sudo_requested:true});
  return runCommandWithInput(connection, invocation.command, invocation.input, authorization.timeout_ms, request.on_chunk || null);
}

async function runRemotePrivilegeCommandStreaming(baseConnection: any, command, request: any = {}, onChunk: any = null) {
  return runRemotePrivilegeCommand(baseConnection, command, {...request, on_chunk:onChunk || request.on_chunk});
}

module.exports = {
  MAX_COMMAND_LENGTH,
  MAX_PASSWORD_LENGTH,
  normalizeRemotePrivilegeRequest,
  createTemporaryAdminConnection,
  buildRemotePrivilegeInvocation,
  createRemotePrivilegeGrant,
  getRemotePrivilegeGrant,
  revokeRemotePrivilegeGrant,
  handoffRemotePrivilegeGrant,
  probeRemotePrivilege,
  runRemotePrivilegeCommand,
  runRemotePrivilegeCommandStreaming
};
