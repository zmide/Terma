const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readSources } = require("./backend-source");
const { readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src", "remote-privilege.ts"), "utf8");
const serverSource = readSources(root, [
  "src/server.ts",
  "src/routes/remote-task-routes.ts",
  "src/routes/remote-profile-routes.ts",
  "src/routes/x11-forwarding-routes.ts",
  "src/services/remote-admin-service.ts",
  "src/services/remote-component-service.ts",
  "src/services/x11-management-service.ts",
  "src/services/vnc-management-service.ts",
  "src/services/linux-desktop-service.ts"
]);
const remoteFrontend = readFrontendDomain(root, "remote");
assert.doesNotMatch(source, /localStorage|sessionStorage/);
assert.doesNotMatch(source, /INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/);
assert.match(source, /sudo -S -k -p '' -- \/bin\/sh -s/);
assert.match(source, /child\.stdin\.end\(input/);
assert.match(source, /jump_connection_id/);
assert.match(source, /systemHostKeyArgs/);
assert.match(serverSource, /createRemoteAdminGrant/);
assert.match(serverSource, /linux-desktop\.install/);
assert.match(serverSource, /dependencies\.handoffRemotePrivilegeGrant\(grant, \(\) => dependencies\.startLinuxDesktopInstall\(id, data\.desktop_id, "install", grant, mode\)\)/);
assert.match(serverSource, /dependencies\.handoffRemotePrivilegeGrant\(grant, \(\) => dependencies\.startLinuxDesktopInstall\(id, data\.desktop_id, "uninstall", grant\)\)/);
assert.match(serverSource, /x11\.sshd-config/);
assert.match(serverSource, /xdmcp\.configure/);
assert.match(serverSource, /x11\.remote-install/);
assert.match(serverSource, /vnc\.server\.\$\{action\}/);
assert.match(remoteFrontend, /requestRemoteAdminAuthorization/);
assert.match(remoteFrontend, /临时授权后/);
assert.match(remoteFrontend, /installVncServer/);

const privilege = require(path.join(root, "dist", "remote-privilege.js"));
const base = Object.freeze({
  id:42,
  name:"temporary-test",
  ssh_host:"192.0.2.10",
  ssh_port:22,
  ssh_user:"operator",
  auth_type:"key",
  identity_file:"C:\\keys\\operator.key",
  private_key_passphrase:"old-passphrase",
  ssh_agent_mode:"auto",
  jump_connection_id:7,
  extra_args:"-o ServerAliveInterval=30",
  x11_mode:"off"
});

const passwordAuth = privilege.createTemporaryAdminConnection(base, {
  ssh_user:"root",
  ssh_password:"temporary password",
  sudo_password:"unused"
});
assert.equal(passwordAuth.connection.ssh_user, "root");
assert.equal(passwordAuth.connection.auth_type, "password");
assert.equal(passwordAuth.connection.ssh_password, "temporary password");
assert.equal(passwordAuth.connection.ssh_agent_mode, "off");
assert.equal("identity_file" in passwordAuth.connection, false);
assert.equal(passwordAuth.connection.jump_connection_id, 7);
assert.equal(base.ssh_user, "operator");
assert.equal(base.ssh_password, undefined);

const keyAuth = privilege.createTemporaryAdminConnection(base, {
  username:"admin",
  identity_file:"C:\\keys\\admin.key",
  passphrase:"key secret"
});
assert.equal(keyAuth.connection.auth_type, "key");
assert.equal(keyAuth.connection.ssh_user, "admin");
assert.equal(keyAuth.connection.identity_file, "C:\\keys\\admin.key");
assert.equal(keyAuth.connection.private_key_passphrase, "key secret");
assert.equal(keyAuth.connection.ssh_agent_mode, "off");
assert.equal(keyAuth.connection.jump_connection_id, 7);

const agentAuth = privilege.createTemporaryAdminConnection(base, {
  user:"admin",
  auth_method:"agent"
});
assert.equal(agentAuth.connection.auth_type, "key");
assert.equal(agentAuth.connection.ssh_agent_mode, "required");
assert.equal("identity_file" in agentAuth.connection, false);

const sudo = privilege.buildRemotePrivilegeInvocation("printf '%s' ready", {
  sudo_requested:true,
  sudo_password:"sudo-secret"
});
assert.equal(sudo.command, "sudo -S -k -p '' -- /bin/sh -s");
assert.equal(sudo.password_via_stdin, true);
assert.ok(sudo.input.startsWith("sudo-secret\n"));
assert.equal(sudo.command.includes("sudo-secret"), false);
assert.equal(sudo.command.includes("printf"), false);

const noPasswordSudo = privilege.buildRemotePrivilegeInvocation("id", {sudo_requested:true});
assert.equal(noPasswordSudo.command, "sudo -n -k -p '' -- /bin/sh -s");
assert.equal(noPasswordSudo.input, "id\n");

const direct = privilege.buildRemotePrivilegeInvocation("printf ok", {sudo_requested:false});
assert.equal(direct.command, "/bin/sh -s");
assert.equal(direct.input, "printf ok\n");

assert.throws(() => privilege.normalizeRemotePrivilegeRequest({ssh_password:"a", identity_file:"key"}), /不能同时使用/);
assert.throws(() => privilege.normalizeRemotePrivilegeRequest({passphrase:"orphan"}), /需要同时指定/);
assert.throws(() => privilege.normalizeRemotePrivilegeRequest({auth_method:"password"}), /需要输入 SSH 密码/);
assert.throws(() => privilege.normalizeRemotePrivilegeRequest({auth_method:"key"}), /需要选择私钥文件/);
assert.throws(() => privilege.normalizeRemotePrivilegeRequest({auth_method:"unknown"}), /认证方式无效/);
assert.throws(() => privilege.normalizeRemotePrivilegeRequest({sudo_password:"line\nbreak"}), /不能包含换行/);
assert.throws(() => privilege.buildRemotePrivilegeInvocation(" ", {}), /请输入/);
assert.throws(() => privilege.createRemotePrivilegeGrant(base, {username:"root"}, "scope.empty"), /请选择临时 SSH 认证方式/);

const grant = privilege.createRemotePrivilegeGrant(base, {username:"root", identity_file:"C:\\keys\\admin.key"}, "scope.one");
assert.equal(privilege.getRemotePrivilegeGrant(grant.id, base, "scope.one").connection.ssh_user, "root");
assert.throws(() => privilege.getRemotePrivilegeGrant(grant.id, base, "scope.two"), /不能用于此操作/);
assert.throws(() => privilege.getRemotePrivilegeGrant(grant.id, {...base,ssh_host:"192.0.2.11"}, "scope.one"), /主机不匹配/);
assert.equal(privilege.revokeRemotePrivilegeGrant(grant.id), true);
assert.throws(() => privilege.getRemotePrivilegeGrant(grant.id, base, "scope.one"), /已过期/);

const failedGrant = privilege.createRemotePrivilegeGrant(base, {username:"root", identity_file:"C:\\keys\\admin.key"}, "scope.failure");
assert.throws(() => privilege.handoffRemotePrivilegeGrant(failedGrant, () => {
  throw new Error("sync start failed");
}), /sync start failed/);
assert.throws(() => privilege.getRemotePrivilegeGrant(failedGrant.id, base, "scope.failure"), /已过期/);

const handedOffGrant = privilege.createRemotePrivilegeGrant(base, {username:"root", identity_file:"C:\\keys\\admin.key"}, "scope.success");
const handedOffTask = privilege.handoffRemotePrivilegeGrant(handedOffGrant, () => ({id:"task"}));
assert.equal(handedOffTask.id, "task");
assert.ok(privilege.getRemotePrivilegeGrant(handedOffGrant.id, base, "scope.success"));
privilege.revokeRemotePrivilegeGrant(handedOffGrant.id);

const expiredGrant = privilege.createRemotePrivilegeGrant(base, {username:"root", ssh_password:"expired-secret", sudo_password:"expired-secret"}, "scope.expired");
const storedExpiredGrant = privilege.getRemotePrivilegeGrant(expiredGrant.id, base, "scope.expired");
storedExpiredGrant.expiresAt = Date.now() - 1;
assert.throws(() => privilege.getRemotePrivilegeGrant(expiredGrant.id, base, "scope.expired"), /已过期/);
assert.equal(storedExpiredGrant.authorization.ssh_password, "");
assert.equal(storedExpiredGrant.authorization.sudo_password, "");
assert.equal(storedExpiredGrant.connection.ssh_password, "");

console.log("远端管理员授权检查通过：临时 SSH 认证、跳板/主机信任继承、sudo stdin、无持久化");
