const path = require("node:path");

const { listIdentityFiles } = require("../ssh");
const { diagnoseSshError } = require("../ssh-diagnostics");
const {
  createRemotePrivilegeGrant,
  getRemotePrivilegeGrant,
  revokeRemotePrivilegeGrant,
  runRemotePrivilegeCommand
} = require("../remote-privilege");

function createRemoteAdminGrant(connection, data, scope) {
  const auth = data?.admin_auth || data?.authorization || null;
  const requestedGrant = String(data?.admin_grant_id || auth?.admin_grant_id || auth?.grant_id || "").trim();
  if (requestedGrant) return getRemotePrivilegeGrant(requestedGrant, connection, scope);
  if (!auth || typeof auth !== "object") return null;
  if (auth.identity_file) {
    const requestedPath = path.resolve(String(auth.identity_file));
    const comparablePath = value => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
    const allowed = listIdentityFiles().some(item => comparablePath(item.path) === comparablePath(requestedPath));
    if (!allowed) throw new Error("临时授权只能使用 Terma 已识别的私钥文件");
  }
  return createRemotePrivilegeGrant(connection, auth, String(scope || data?.scope || "host:*").trim() || "host:*");
}

function releaseRemoteAdminGrant(grant) {
  const policy = String(grant?.reuse_policy || grant?.reusePolicy || "once");
  if (grant?.id && policy === "once") revokeRemotePrivilegeGrant(grant.id);
}

function adminGrantView(grant) {
  if (!grant?.id) return null;
  return {
    id:String(grant.id),
    expires_at:Number(grant.expires_at || grant.expiresAt || 0),
    reuse_policy:String(grant.reuse_policy || grant.reusePolicy || "once"),
    reusable:String(grant.reuse_policy || grant.reusePolicy || "once") !== "once",
    ssh_user:String(grant.ssh_user || grant.connection?.ssh_user || ""),
    auth_method:String(grant.auth_method || grant.authorization?.auth_method || ""),
    scope:String(grant.scope || "")
  };
}

function normalizeRemoteAdminAuthorizationError(error) {
  const raw = String(error?.message || error || "").trim();
  const diagnosis = diagnoseSshError(raw);
  const lower = raw.toLowerCase();
  if (/all configured authentication methods failed|no more authentication methods available|permission denied \(publickey|authentication failed/.test(lower)) {
    const normalized: any = new Error(`SSH 认证失败：请检查临时管理员 SSH 用户名、密码、私钥或 Agent。${diagnosis.suggestions?.[0] || "请重新检查认证信息后再试。"}`);
    normalized.code = "REMOTE_ADMIN_AUTH_FAILED";
    return normalized;
  }
  if (/sudo:\s*(?:incorrect password|a password is required|authentication failure|sorry, try again|管理权限验证失败)/i.test(raw)) {
    const normalized: any = new Error("sudo 认证失败：sudo 密码不正确或当前账号没有免密 sudo 权限，请重新授权后再试。");
    normalized.code = "REMOTE_ADMIN_SUDO_FAILED";
    return normalized;
  }
  return error instanceof Error ? error : new Error(raw || "临时管理员授权失败");
}

async function issueRemoteAdminGrant(connection, data: any = {}) {
  const requestedScope = String(data?.scope || "").trim() || "host:*";
  const grant = createRemoteAdminGrant(connection, {admin_auth:data.admin_auth || data.authorization || data}, requestedScope);
  if (!grant) throw new Error("请提供临时管理员 SSH 认证信息");
  try {
    const probe = await runRemotePrivilegeCommand(connection, "true", {grant_id:grant.id, scope:requestedScope, timeout_ms:30000});
    if (probe?.status !== 0) {
      throw new Error(`${probe?.stderr || probe?.stdout || probe?.error?.message || "临时管理员 SSH 验证失败"}`.trim());
    }
    return {ok:true, admin_grant:adminGrantView(grant), admin_grant_id:grant.id};
  } catch (error) {
    revokeRemotePrivilegeGrant(grant.id);
    throw normalizeRemoteAdminAuthorizationError(error);
  }
}

module.exports = {
  adminGrantView,
  createRemoteAdminGrant,
  issueRemoteAdminGrant,
  normalizeRemoteAdminAuthorizationError,
  releaseRemoteAdminGrant
};
