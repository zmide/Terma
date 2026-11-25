"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { frontendSourcePath, readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const { normalizeFtpTransportError } = require(path.join(root, "dist", "ftp.js"));
const { handleRemoteCredentialRoutes } = require(path.join(root, "dist", "routes", "remote-credential-routes.js"));
const { handleRemoteConnectivityRoutes } = require(path.join(root, "dist", "routes", "remote-connectivity-routes.js"));

function frontendFunctions(file) {
  const {loadFrontendService}=require('./frontend-service-test-helper');
  const {authenticationFailure}=loadFrontendService('frontend/src/features/remote/profile-model.ts');
  const {sshAuthenticationFailure,sshCredentialRepairPayload,createTemporarySshConnection}=loadFrontendService('frontend/src/features/connections/connection-credential-model.ts');
  const context = {console,WebSocket,window:{termaRemoteProfiles:{authenticationFailure},termaConnectionCredentials:{authenticationFailure:sshAuthenticationFailure,repairPayload:sshCredentialRepairPayload,temporaryConnection:createTemporarySshConnection}}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, frontendSourcePath(file)), "utf8"), context, {filename:file});
  return context;
}

async function main() {
  const ssh = require('./frontend-service-test-helper').loadFrontendService('frontend/src/features/connections/connection-credential-model.ts');
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

  const remote = require('./frontend-service-test-helper').loadFrontendService('frontend/src/features/remote/profile-model.ts');
  assert.equal(remote.authenticationFailure({code:"FTP_AUTHENTICATION_FAILED"}, "ftp"), true);
  assert.equal(remote.authenticationFailure(new Error("530 Login incorrect"), "ftp"), true);
  assert.equal(remote.authenticationFailure(new Error("ECONNREFUSED"), "ftp"), false);

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
    terminal:readFrontendDomain(root, "terminal"),
    sftp:fs.readFileSync(path.join(root, "frontend/src/entries", "about-embed.ts"), "utf8"),
    health:fs.readFileSync(path.join(root, "frontend/src/features/connections/connection-health-runtime.ts"), "utf8"),
    globalForwards:fs.readFileSync(path.join(root, "frontend/src/features/forwards", "forward-workspace.ts"), "utf8"),
    x11Views:fs.readFileSync(path.join(root, "frontend/src/features/quick/quick-views.ts"), "utf8"),
    x11Runtime:fs.readFileSync(path.join(root, "frontend/src/features/x11/x11-runtime.ts"), "utf8"),
    linuxModel:fs.readFileSync(path.join(root, "frontend/src/features/remote/linux-desktop-model.ts"), "utf8"),
    linuxRuntime:fs.readFileSync(path.join(root, "frontend/src/features/remote/management-runtime.ts"), "utf8"),
    remote:fs.readFileSync(path.join(root, "frontend/src/features/remote/remote-host.ts"), "utf8"),
    vnc:fs.readFileSync(path.join(root, "frontend/src/features/remote/vnc-runtime.ts"), "utf8"),
    vncClipboard:fs.readFileSync(path.join(root, "frontend/src/features/remote/vnc-clipboard-helper.ts"), "utf8"),
    quickSsh:[
      fs.readFileSync(path.join(root, "frontend/src/features/quick", "quick-ssh-service.ts"), "utf8"),
      fs.readFileSync(path.join(root, "frontend", "src", "features", "quick", "quick-views.ts"), "utf8")
    ].join("\n"),
    sshModal:fs.readFileSync(path.join(root, "frontend/src/features/connections", "ssh-credential-runtime.ts"), "utf8"),
    connectivityRoute:fs.readFileSync(path.join(root, "src", "routes", "remote-connectivity-routes.ts"), "utf8"),
    connectivity:fs.readFileSync(path.join(root, "src", "remote-connectivity.ts"), "utf8"),
    xdmcpManager:fs.readFileSync(path.join(root, "src", "xdmcp-manager.ts"), "utf8")
  };
  const sshCredentialView = fs.readFileSync(path.join(root, "frontend", "src", "features", "connections", "ConnectionCredentialDialog.ts"), "utf8");
  assert.match(sshCredentialView, /sshCredentialUser/);
  assert.match(sshCredentialView, /sshCredentialPort/);
  assert.match(sshCredentialView, /sshCredentialKeyUpload/);
  assert.match(sshCredentialView, /id: 'sshCredentialSave'/);
  assert.match(sshCredentialView, /checked: state\.save/);
  assert.match(fs.readFileSync(path.join(root,'frontend/src/features/terminal/terminal-transport-workspace.ts'),'utf8'), /terminalAuthentication\.repair/);
  assert.match(fs.readFileSync(path.join(root,'frontend/src/features/terminal/terminal-authentication-service.ts'),'utf8'), /connection\.quick_connection[\s\S]*?startQuickSshConnection[\s\S]*?repair: true/);
  assert.match(fs.readFileSync(path.join(root,'frontend/src/features/terminal/terminal-transport-service.ts'),'utf8'), /output\(connection\.quick_connection \? 'terminal:system\.quick_auth_repair_opening'/);
  assert.match(sources.quickSsh, /tr\("connections:quick_ssh\.repair_title",\s*\{[\s\S]*?defaultValue:/);
  assert.match(sources.sftp, /repair:\s*sftpRepair\.repair/);
  assert.match(sources.health, /=> repairSshCredentials\(id, options\)/);
  assert.match(sources.x11Views, /termaX11\.repair\(id, source\)/);
  assert.match(fs.readFileSync(path.join(root,'frontend/src/features/x11/local-service.ts'),'utf8'),/opening:false/);
  assert.match(fs.readFileSync(path.join(root,'frontend/src/features/x11/x11-surfaces.ts'),'utf8'),/showXServerManagerLoading\(\)/);
  assert.match(sources.x11Views, /termaX11\.repairTemporary\(id\)/);
  assert.match(sources.x11Runtime, /authentication\.repair\(session\.connection, key, session, \(\) => port\.session\(key\)\)/);
  assert.match(sources.linuxModel, /authenticationFailure\(error\).*?'repair-desktop'.*?port\.repair\(selected\)/);
  assert.match(sources.linuxModel, /text\('detecting_host', \{host:connection\?\.name/);
  assert.match(sources.linuxRuntime, /if \(active\(\) && desktop\.state\.connectionId === id\) await desktop\.load\(\)/);
  assert.match(sources.globalForwards, /context: host\.tr\('connections:forwards\.auth_failed_context'\)/);
  assert.match(fs.readFileSync(path.join(root,'frontend/src/features/remote/ftp-service.ts'),'utf8'), /port\.repair\(s\.profileId/);
  const ftpCredentialService=fs.readFileSync(path.join(root,'frontend/src/features/remote/credential-service.ts'),'utf8');
  assert.match(ftpCredentialService,/test-credentials/);
  const ftpCredentialView = fs.readFileSync(path.join(root,"frontend/src/features/remote/RemoteCredentialDialog.ts"),"utf8");
  assert.match(ftpCredentialView, /id:'remoteCredentialSave'[^\n]+checked:true,disabled:true/);
  assert.match(sources.remote, /repair: \(id, options\) => remoteServices\.termaRemoteProfiles\.repair\(id, options\)/);
  assert.doesNotMatch(sources.remote, /repairRemoteManagementCredentials|newRemoteManagementSshConnection/);
  const managementView=fs.readFileSync(path.join(root,"frontend/src/features/remote/remote-protocol-view.ts"),"utf8");
  assert.match(managementView, /port\.diagnostics\.render\(container, protocol, diagnostics, id, key\)/);
  const managementRuntime = fs.readFileSync(path.join(root, 'frontend/src/features/remote/management-runtime.ts'), 'utf8');
  assert.match(managementRuntime, /management\.repairCredentials\(id,kind,/);
  const managementModel = fs.readFileSync(path.join(root, 'frontend/src/features/remote/remote-management-model-service.ts'), 'utf8');
  assert.match(managementModel, /port\.repairManagementCredentials\(Number\(profile\.id \|\| 0\), protocol\)/);
  assert.match(fs.readFileSync(path.join(root,'frontend/src/features/remote/vnc-session-service.ts'),'utf8'), /on\('securityfailure',event=>\{void security\(session,rfb/);
  assert.match(fs.readFileSync(path.join(root,'frontend/src/features/remote/vnc-management-service.ts'),'utf8'), /updateByDefault:true/);
  assert.match(sources.vncClipboard, /repair-credentials[\s\S]*?port\.repair/);
  assert.match(sources.vnc, /repair:.*host\.repairCredentials\(id,\{context,onSaved:/);
  const diagnosticsView = fs.readFileSync(path.join(root,'frontend/src/features/remote/remote-diagnostics-view.ts'),'utf8');
  assert.match(diagnosticsView, /else if \(protocol === 'rdp'\)[\s\S]*?endpoint_probe/);
  assert.match(fs.readFileSync(path.join(root,'frontend/src/features/remote/vnc-management-service.ts'),'utf8'), /endpoint_probe:await endpoint/);
  assert.doesNotMatch(sources.remote, /function remoteManagementUnavailableMarkup/);
  assert.match(managementRuntime, /newManagementConnection: management\.seed/);
  assert.match(sources.connectivityRoute, /getRemoteProfile\(id\)/, "端口探测路由必须从数据库解析目标");
  assert.match(sources.connectivity, /xdmcpQueryPacket/);
  assert.match(sources.connectivity, /method:"xdmcp-query"/);
  assert.match(fs.readFileSync(path.join(root,"frontend/src/features/remote/protocol-service.ts"),"utf8"), /endpoint_probe:await endpoint/);
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
