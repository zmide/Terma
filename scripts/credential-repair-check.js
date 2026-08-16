"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const { normalizeFtpTransportError } = require(path.join(root, "dist", "ftp.js"));
const { handleRemoteCredentialRoutes } = require(path.join(root, "dist", "routes", "remote-credential-routes.js"));
const { handleRemoteConnectivityRoutes } = require(path.join(root, "dist", "routes", "remote-connectivity-routes.js"));

function frontendFunctions(file) {
  const context = {console};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "public", file), "utf8"), context, {filename:file});
  return context;
}

async function main() {
  const ssh = frontendFunctions("app-ssh-credentials.js");
  assert.equal(ssh.sshAuthenticationFailure({code:"SSH_AUTHENTICATION_FAILED"}), true);
  assert.equal(ssh.sshAuthenticationFailure(new Error("Permission denied (publickey,password)")), true);
  assert.equal(ssh.sshAuthenticationFailure(new Error("Connection timed out")), false);
  const repairedPayload = ssh.sshCredentialRepairPayload({
    id:7, name:"saved", ssh_host:"example.com", ssh_port:22, ssh_user:"old",
    auth_type:"password", keepalive_interval_seconds:15
  }, {
    ssh_user:"new-user", ssh_port:2202, auth_type:"key",
    identity_file:"managed-key", private_key_passphrase:"test-passphrase"
  });
  assert.equal(repairedPayload.ssh_host, "example.com", "凭据修复不得改变目标主机");
  assert.equal(repairedPayload.ssh_user, "new-user");
  assert.equal(repairedPayload.ssh_port, 2202);
  assert.equal(repairedPayload.ssh_agent_mode, "off");
  assert.equal(repairedPayload.keepalive_interval_seconds, 15, "保存时必须保留连接的非凭据设置");

  const remote = frontendFunctions("app-remote-credentials.js");
  assert.equal(remote.remoteProfileAuthenticationFailure({code:"FTP_AUTHENTICATION_FAILED"}, "ftp"), true);
  assert.equal(remote.remoteProfileAuthenticationFailure(new Error("530 Login incorrect"), "ftp"), true);
  assert.equal(remote.remoteProfileAuthenticationFailure(new Error("ECONNREFUSED"), "ftp"), false);

  const original = Object.assign(new Error("530 Login incorrect: secret-must-not-leak"), {code:530});
  const normalized = normalizeFtpTransportError(original, {id:9, name:"FTP fixture"});
  assert.equal(normalized.code, "FTP_AUTHENTICATION_FAILED");
  assert.equal(normalized.remoteProfileId, 9);
  assert.equal(normalized.remoteProfileName, "FTP fixture");
  assert.doesNotMatch(normalized.message, /secret-must-not-leak/);
  const transport = new Error("socket closed");
  assert.equal(normalizeFtpTransportError(transport, {id:9}), transport);

  let testedProfile = null;
  let sent = null;
  assert.equal(await handleRemoteCredentialRoutes(
    {method:"POST"}, {}, "/api/remote-profiles/9/test-credentials", {
      getRemoteProfile(id) {
        assert.equal(id, 9);
        return {id, name:"FTP fixture", protocol:"ftp", host:"example.com", port:21, username:"old", password:"stored", options:{base_path:"/srv"}};
      },
      async readJson() { return {username:"new-user", password:"temporary-secret", port:2121}; },
      sendJson(_response, data, status) { sent = {data, status}; },
      async testFtpCredentials(profile) {
        testedProfile = profile;
        return {ok:true, path:"/srv"};
      }
    }
  ), true);
  assert.equal(testedProfile.host, "example.com", "临时验证不得接受客户端覆盖目标主机");
  assert.equal(testedProfile.username, "new-user");
  assert.equal(testedProfile.password, "temporary-secret");
  assert.equal(testedProfile.port, 2121);
  assert.deepEqual(sent, {data:{ok:true, path:"/srv"}, status:undefined});

  await assert.rejects(() => handleRemoteCredentialRoutes(
    {method:"POST"}, {}, "/api/remote-profiles/9/test-credentials", {
      getRemoteProfile() { return {id:9, protocol:"rdp"}; },
      async readJson() { return {username:"user", password:"secret", port:3389}; },
      sendJson() {},
      async testFtpCredentials() { throw new Error("must not test"); }
    }
  ), /不支持应用内凭据修复/);

  let probedProfile = null;
  let connectivityResponse = null;
  assert.equal(await handleRemoteConnectivityRoutes(
    {method:"GET"}, {}, "/api/remote-profiles/12/connectivity", {
      getRemoteProfile(id) {
        assert.equal(id, 12);
        return {id, name:"Saved RDP", protocol:"rdp", host:"saved.example.com", port:3390};
      },
      async inspectRemoteProfileConnectivity(profile) {
        probedProfile = profile;
        return {supported:true, method:"tcp", ok:true, host:profile.host, port:profile.port};
      },
      sendJson(_response, data, status) { connectivityResponse = {data, status}; }
    }
  ), true);
  assert.equal(probedProfile.host, "saved.example.com", "端口探测只能使用数据库中保存的远程连接目标");
  assert.deepEqual(connectivityResponse, {
    data:{supported:true, method:"tcp", ok:true, host:"saved.example.com", port:3390},
    status:undefined
  });

  const sources = {
    terminal:fs.readFileSync(path.join(root, "public", "app-terminal.js"), "utf8"),
    sftp:fs.readFileSync(path.join(root, "public", "app-sftp-core.js"), "utf8"),
    health:fs.readFileSync(path.join(root, "public", "app-connection-health.js"), "utf8"),
    x11:fs.readFileSync(path.join(root, "public", "app-x11.js"), "utf8"),
    linux:fs.readFileSync(path.join(root, "public", "app-linux-desktop.js"), "utf8"),
    forwards:fs.readFileSync(path.join(root, "public", "app-forwards.js"), "utf8"),
    ftp:fs.readFileSync(path.join(root, "public", "app-remote-ftp.js"), "utf8"),
    remote:fs.readFileSync(path.join(root, "public", "app-remote.js"), "utf8"),
    rdp:fs.readFileSync(path.join(root, "public", "app-remote-rdp.js"), "utf8"),
    xdmcp:fs.readFileSync(path.join(root, "public", "app-remote-xdmcp.js"), "utf8"),
    vnc:fs.readFileSync(path.join(root, "public", "app-vnc.js"), "utf8"),
    vncClipboard:fs.readFileSync(path.join(root, "public", "app-vnc-clipboard.js"), "utf8"),
    quickSsh:fs.readFileSync(path.join(root, "public", "app-quick-ssh.js"), "utf8"),
    sshModal:fs.readFileSync(path.join(root, "public", "app-ssh-credentials.js"), "utf8"),
    ftpModal:fs.readFileSync(path.join(root, "public", "app-remote-credentials.js"), "utf8"),
    connectivityRoute:fs.readFileSync(path.join(root, "src", "routes", "remote-connectivity-routes.ts"), "utf8"),
    connectivity:fs.readFileSync(path.join(root, "src", "remote-connectivity.ts"), "utf8"),
    xdmcpManager:fs.readFileSync(path.join(root, "src", "xdmcp-manager.ts"), "utf8")
  };
  assert.match(sources.sshModal, /sshCredentialUser/);
  assert.match(sources.sshModal, /sshCredentialPort/);
  assert.match(sources.sshModal, /sshCredentialKeyUpload/);
  assert.match(sources.sshModal, /sshCredentialSave[^\n]+checked/);
  assert.match(sources.terminal, /repairTerminalCredentials/);
  assert.match(sources.terminal, /connection\.quick_connection[\s\S]*?startQuickSshConnection[\s\S]*?repair:true/);
  assert.match(sources.terminal, /tr\("terminal:system\.quick_auth_repair_opening", \{defaultValue:/);
  assert.match(sources.quickSsh, /tr\("connections:quick_ssh\.repair_title", \{defaultValue:/);
  assert.match(sources.sftp, /repairSftpCredentials/);
  assert.match(sources.health, /repairConnectionHealthCredentials/);
  assert.match(sources.x11, /repairX11ManagerCredentials/);
  assert.match(sources.x11, /xServerManagerOpening/);
  assert.match(sources.x11, /showXServerManagerLoading\(\)/);
  assert.match(sources.x11, /x11-quick-credential-repair/);
  assert.match(sources.linux, /linux-desktop-credential-repair/);
  assert.match(sources.linux, /tr\("remote:linux_desktop\.detecting_host", \{host:hostLabel,/);
  assert.match(sources.forwards, /context:tr\("connections:forwards\.auth_failed_context", \{defaultValue:/);
  assert.match(sources.ftp, /ftpRequestWithCredentialRepair/);
  assert.match(sources.ftpModal, /test-credentials/);
  assert.match(sources.ftpModal, /remoteCredentialSave[^\n]+checked disabled/);
  assert.match(sources.remote, /repairRemoteManagementCredentials/);
  assert.match(sources.rdp, /remoteManagementCredentialRepairMarkup/);
  assert.match(sources.xdmcp, /remoteManagementCredentialRepairMarkup/);
  assert.match(sources.vnc, /remoteManagementCredentialRepairMarkup/);
  assert.match(sources.vnc, /handleVncSecurityFailure/);
  assert.match(sources.vnc, /updateByDefault:true/);
  assert.match(sources.vncClipboard, /vnc-clipboard-credential-repair/);
  assert.match(sources.rdp, /endpoint_probe/);
  assert.match(sources.vnc, /endpoint_probe/);
  assert.match(sources.remote, /remoteManagementUnavailableMarkup/);
  assert.match(sources.remote, /newRemoteManagementSshConnection/);
  assert.match(sources.connectivityRoute, /getRemoteProfile\(id\)/, "端口探测路由必须从数据库解析目标");
  assert.match(sources.connectivity, /xdmcpQueryPacket/);
  assert.match(sources.connectivity, /method:"xdmcp-query"/);
  assert.match(sources.xdmcp, /endpoint_probe/);
  assert.doesNotMatch(sources.xdmcpManager, /XDMCP 设置中选择 SSH 管理连接/);
  console.log("凭据修复回归通过：SSH/SFTP/X11/健康检查/转发与 FTP/VNC 均覆盖对应认证失败入口");
}

module.exports = main;

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
