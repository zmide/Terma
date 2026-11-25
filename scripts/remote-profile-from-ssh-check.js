"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readFrontendDomain } = require("./frontend-source");
const { loadFrontendService } = require('./frontend-service-test-helper');
const { normalizeRelatedHost, createRemoteProfileRelations } = loadFrontendService('frontend/src/features/remote/profile-relations.ts');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-remote-from-ssh-"));
process.env.TERMA_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TERMA_SSH_DIR = path.join(temporaryRoot, ".ssh");

const database = require("../dist/db");
const connectionUi = fs.readFileSync(path.join(__dirname, "../frontend/src/features/connections/connection-host.ts"), "utf8");
const connectionActions = fs.readFileSync(path.join(__dirname, "../frontend/src/shared/static-action-registry.ts"), "utf8");
const connectionMenu = fs.readFileSync(path.join(__dirname, "..", "frontend", "src", "features", "connections", "connection-menu-service.ts"), "utf8");
const remoteUi = readFrontendDomain(path.join(__dirname, ".."), "remote");
const zhConnections = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "locales", "zh-CN", "connections.json"), "utf8"));
const enConnections = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "locales", "en-US", "connections.json"), "utf8"));

assert.match(connectionUi, /\.relations\.actionsForSsh\(id\)/, "SSH 更多菜单必须读取同主机的已有其他连接");
assert.match(connectionActions, /termaConnectionMenu\?\.open\(event, connectionId\(dataset\)\)/, "SSH 更多菜单必须委托类型化菜单所有者");
assert.match(connectionMenu, /port\.tr\('connections:actions\.open_other_connections'\)/, "SSH 更多菜单必须通过国际化词条提供已有连接快捷入口");
assert.equal(zhConnections.actions.open_other_connections, "打开其他连接…");
assert.equal(enConnections.actions.open_other_connections, "Open other connection…");
assert.doesNotMatch(remoteUi, /function (remoteProfilesForSshConnection|remoteDesktopSwitchProfiles|normalizeRemoteHost)\(/);
assert.equal(normalizeRelatedHost("[2001:DB8::1]"), "2001:db8::1");
assert.equal(normalizeRelatedHost("EXAMPLE.COM."), "example.com");
assert.equal(normalizeRelatedHost("::ffff:192.0.2.10"), "192.0.2.10");

const relationProfiles=[
  {id:1,protocol:'rdp',host:'HOST.TEST.',options:{source_ssh_connection_id:8}},
  {id:2,protocol:'xdmcp',host:'host.test',options:{source_ssh_connection_id:8}},
  {id:3,protocol:'vnc',host:'host.test',options:{source_ssh_connection_id:9}},
  {id:4,protocol:'ftp',host:'host.test'},
  {id:5,protocol:'telnet',host:'other.test',options:{source_ssh_connection_id:8}},
  {id:6,protocol:'serial',host:'host.test'}
];
const opened=[];
const sshSources=new Map([[8,{id:8,ssh_host:'host.test',ssh_port:22}],[9,{id:9,ssh_host:'host.test',ssh_port:2222}]]);
const relationPort={profiles:()=>relationProfiles,connection:id=>sshSources.get(id),
  managementConnectionId:profile=>profile.options?.source_ssh_connection_id||0,tr:key=>key,protocolLabel:p=>p,protocolIcon:p=>p,
  open:profile=>opened.push(profile.id),terminal:id=>opened.push(`terminal:${id}`),sftp:id=>opened.push(`sftp:${id}`),notify:()=>{},
  showMenu:(_event,actions)=>{relationPort.items=actions;}};
const relations=createRemoteProfileRelations(relationPort);
const ids=items=>Array.from(items,item=>item.id);
assert.deepEqual(ids(relations.desktopsForSsh(8)),[1,2,3]);
assert.deepEqual(ids(relations.alternatives(relationProfiles[0])),[2]);
assert.deepEqual(ids(relations.alternatives({id:7,protocol:'rdp',host:'host.test'})),[1,2,3]);
assert.equal(relations.sharedVnc(relationProfiles[0]).id,3);
assert.equal(relations.actionsForSsh(8).length,4,'SSH shortcut excludes serial and cross-host profiles despite matching recorded SSH ID');
const jump=relations.workspaceActions(relationProfiles[0]).actions;
jump[0].onClick({});jump[1].onClick({});jump[2].onClick({});
relationPort.items[0].run();
assert.deepEqual(opened,['terminal:8','sftp:8',2]);
relationProfiles[1].host='changed.test';relationPort.items[0].run();
sshSources.get(8).ssh_port=2201;jump[0].onClick({});jump[1].onClick({});
assert.equal(opened.length,3,'editing the SSH endpoint invalidates the already rendered toolbar actions');
sshSources.get(8).ssh_port=22;
relationProfiles[0].options.source_ssh_connection_id=9;jump[0].onClick({});jump[1].onClick({});
assert.equal(opened.length,3,'a stale menu item or toolbar cannot open a newly associated profile or SSH connection');

try {
  const connectionId = database.insertConnection({
    name:"Linux 图形主机",
    group_name:"测试环境",
    ssh_host:"192.0.2.10",
    ssh_port:2222,
    ssh_user:"operator",
    auth_type:"password",
    ssh_password:"ssh-only-secret",
    tags:"linux,graphics"
  }, "");

  const xdmcpResult = database.createRemoteProfileFromConnection(connectionId, "xdmcp");
  assert.equal(xdmcpResult.created, true);
  const xdmcp = database.getRemoteProfile(xdmcpResult.id);
  assert.equal(xdmcp.name, "Linux 图形主机 · XDMCP");
  assert.equal(xdmcp.group_name, "测试环境");
  assert.equal(xdmcp.host, "192.0.2.10");
  assert.equal(xdmcp.port, 177);
  assert.equal(xdmcp.options.ssh_connection_id, connectionId);
  assert.equal(xdmcp.options.source_ssh_connection_id, connectionId);
  assert.equal(xdmcp.password, null);

  const repeated = database.createRemoteProfileFromConnection(connectionId, "xdmcp");
  assert.equal(repeated.created, false);
  assert.equal(repeated.id, xdmcpResult.id);

  const ftpResult = database.createRemoteProfileFromConnection(connectionId, "ftp");
  const ftp = database.getRemoteProfile(ftpResult.id);
  assert.equal(ftp.username, "operator");
  assert.equal(ftp.has_password, false, "不能把 SSH 密码当作 FTP 密码复制");
  assert.equal(ftp.options.source_ssh_connection_id, connectionId);

  const rdpResult = database.createRemoteProfileFromConnection(connectionId, "rdp");
  const rdp = database.getRemoteProfile(rdpResult.id);
  assert.equal(rdp.username, "", "RDP 不应把 SSH 用户名当作桌面登录账号");

  const generated = database.createAllRemoteProfilesFromConnection(connectionId);
  assert.equal(generated.created_count, 2);
  assert.equal(generated.existing_count, 3);
  assert.deepEqual(generated.results.map(item => item.protocol), ["rdp", "vnc", "xdmcp", "ftp", "telnet"]);
  assert.equal(database.listRemoteProfiles().length, 5);

  const generatedAgain = database.createAllRemoteProfilesFromConnection(connectionId);
  assert.equal(generatedAgain.created_count, 0);
  assert.equal(generatedAgain.existing_count, 5);

  assert.throws(() => database.createRemoteProfileFromConnection(connectionId, "serial"), /不能从 SSH/);
  console.log("SSH 快捷生成其他连接检查通过：单个/全部生成、来源关联、XDMCP SSH 密钥管理和协议凭据隔离正常");
} finally {
  try { database.closeDatabase(); } catch {}
  fs.rmSync(temporaryRoot, {recursive:true, force:true});
}
