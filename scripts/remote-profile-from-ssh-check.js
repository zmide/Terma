"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readFrontendDomain } = require("./frontend-source");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-remote-from-ssh-"));
process.env.TERMA_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TERMA_SSH_DIR = path.join(temporaryRoot, ".ssh");

const database = require("../dist/db");
const connectionUi = readFrontendDomain(path.join(__dirname, ".."), "connections");
const remoteUi = readFrontendDomain(path.join(__dirname, ".."), "remote");
const appCss = fs.readFileSync(path.join(__dirname, "..", "public", "app.css"), "utf8");
const zhConnections = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "locales", "zh-CN", "connections.json"), "utf8"));
const enConnections = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "locales", "en-US", "connections.json"), "utf8"));

assert.match(connectionUi, /function renderRemoteHostGroups\(profiles\)/);
assert.doesNotMatch(connectionUi, /remoteProfiles\.forEach\(profile => remoteHostOpen\.add\(remoteHostKey\(profile\)\)\)/, "其他连接中的服务器子菜单首次进入时应保持折叠");
assert.match(connectionUi, /return JSON\.stringify\(\["host", group, host \|\| "unknown"\]\)/);
assert.match(connectionUi, /const open = searching \|\| remoteHostOpen\.has\(key\)/);
assert.match(connectionUi, /function revealRemoteProfile\(profile\)[\s\S]*?remoteHostOpen\.add\(remoteHostKey\(profile\)\)/);
assert.match(appCss, /\.remote-host-head-row \{ position:sticky; top:var\(--connection-group-sticky-height\); z-index:1;/);
const remoteHostKeySource = connectionUi.match(/function remoteHostKey\(profile\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(remoteHostKeySource, "必须保留其他连接的主机分组键");
const remoteHostKey = Function(`${remoteHostKeySource}; return remoteHostKey;`)();
assert.equal(remoteHostKey({group_name:"生产", host:"EXAMPLE.COM"}), remoteHostKey({group_name:"生产", host:"example.com"}));
assert.notEqual(remoteHostKey({group_name:"生产", host:"example.com"}), remoteHostKey({group_name:"测试", host:"example.com"}));
assert.match(connectionUi, /remoteProfileOpenActionsForSsh\(id\)/, "SSH 更多菜单必须读取同主机的已有其他连接");
assert.match(connectionUi, /tr\("connections:actions\.open_other_connections"/, "SSH 更多菜单必须通过国际化词条提供已有连接快捷入口");
assert.equal(zhConnections.actions.open_other_connections, "打开其他连接…");
assert.equal(enConnections.actions.open_other_connections, "Open other connection…");
assert.match(remoteUi, /function remoteProfilesForSshConnection\(connection\)/);
assert.match(remoteUi, /return profileHost === host;/, "已有连接快捷入口必须严格按标准化主机地址关联");
assert.doesNotMatch(remoteUi, /profileHost === host \|\|/, "来源 SSH 编号不得把不同主机的连接错误挂到快捷入口");
const normalizeRemoteHostSource = remoteUi.match(/function normalizeRemoteHost\(value=""\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(normalizeRemoteHostSource, "必须保留统一的主机地址标准化函数");
const normalizeRemoteHost = Function(`${normalizeRemoteHostSource}; return normalizeRemoteHost;`)();
assert.equal(normalizeRemoteHost("[2001:DB8::1]"), "2001:db8::1");
assert.equal(normalizeRemoteHost("EXAMPLE.COM."), "example.com");
assert.equal(normalizeRemoteHost("::ffff:192.0.2.10"), "192.0.2.10");

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
