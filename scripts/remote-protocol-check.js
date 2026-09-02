const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "terma-remote-protocol-"));
process.env.TERMA_DATA_DIR = temporary;

let db;
try {
  db = require("../dist/db");
  const sshId = db.insertConnection({
    name:"x11-test",
    group_name:"协议测试",
    ssh_host:"127.0.0.1",
    ssh_port:22,
    ssh_user:"tester",
    auth_type:"key",
    x11_mode:"trusted"
  }, "");
  assert.equal(db.getConnection(sshId).x11_mode, "trusted");
  const passwordX11Id = db.insertConnection({
    name:"bad-x11",
    ssh_host:"127.0.0.1",
    ssh_user:"tester",
    auth_type:"password",
    ssh_password:"secret",
    x11_mode:"untrusted"
  }, "");
  assert.equal(db.getConnection(passwordX11Id).x11_mode, "untrusted");
  assert.deepEqual(db.updateConnectionX11Mode(passwordX11Id, "trusted"), {ok:true,x11_mode:"trusted"});
  assert.equal(db.getConnection(passwordX11Id).x11_mode, "trusted");
  assert.deepEqual(db.updateConnectionX11Mode(passwordX11Id, "off"), {ok:true,x11_mode:"off"});
  assert.equal(db.getConnection(passwordX11Id).x11_mode, "off");
  assert.throws(() => db.updateConnectionX11Mode(passwordX11Id, "invalid"), /X11 转发模式无效/);

  const ids = new Map();
  for (const protocol of ["rdp", "vnc", "xdmcp", "ftp", "telnet", "serial"]) {
    const options = protocol === "serial"
      ? {path:process.platform === "win32" ? "COM99" : "/dev/tty-test"}
      : protocol === "vnc"
        ? {client_mode:"system", cursor_mode:"hide", display_mode:"original", quality:7}
        : protocol === "xdmcp"
          ? {mode:"indirect", window_mode:"windowed", width:1600, height:900, local_address:"192.168.31.111"}
          : {};
    const id = db.insertRemoteProfile({
      name:`${protocol}-test`,
      group_name:"协议测试",
      protocol,
      host:protocol === "serial" ? "" : protocol === "rdp" ? "[2001:db8::21]" : "127.0.0.1",
      username:protocol === "ftp" ? "ftp-user" : protocol === "rdp" ? "desktop-user" : "",
      password:protocol === "ftp" ? "ftp-secret" : protocol === "rdp" ? "rdp-secret" : "",
      options:protocol === "rdp" ? {...options, allow_password_transfer:true} : options
    });
    ids.set(protocol, id);
    assert.equal(db.getRemoteProfile(id).protocol, protocol);
  }
  assert.equal(db.getRemoteProfile(ids.get("vnc")).options.client_mode, "system");
  assert.equal(db.getRemoteProfile(ids.get("vnc")).options.cursor_mode, "hide");
  assert.equal(db.getRemoteProfile(ids.get("vnc")).options.display_mode, "original");
  db.updateRemoteProfile(ids.get("vnc"), {options:{client_mode:"embedded", cursor_mode:"show", display_mode:"resize", quality:9}});
  db.updateRemoteProfile(ids.get("vnc"), {options:{client_mode:"bundled"}});
  assert.equal(db.getRemoteProfile(ids.get("vnc")).options.client_mode, "bundled");
  db.updateRemoteProfile(ids.get("vnc"), {options:{client_mode:"embedded", cursor_mode:"show", display_mode:"resize", quality:9}});
  assert.equal(db.getRemoteProfile(ids.get("vnc")).options.cursor_mode, "show");
  assert.equal(db.getRemoteProfile(ids.get("vnc")).options.display_mode, "resize");
  db.updateRemoteProfile(ids.get("vnc"), {options:{cursor_mode:"invalid"}});
  assert.equal(db.getRemoteProfile(ids.get("vnc")).options.cursor_mode, "auto");
  assert.equal(db.getRemoteProfile(ids.get("vnc")).options.display_mode, "scale");
  assert.deepEqual(db.getRemoteProfile(ids.get("xdmcp")).options, {mode:"indirect", window_mode:"fixed", width:1600, height:900, local_address:"192.168.31.111", ssh_connection_id:0});
  const defaultRdp = db.getRemoteProfile(ids.get("rdp")).options;
  assert.equal(db.getRemoteProfile(ids.get("rdp")).host, "2001:db8::21");
  assert.equal(db.getRemoteProfile(ids.get("rdp")).username, "desktop-user");
  assert.equal(db.getRemoteProfile(ids.get("rdp")).password, "rdp-secret");
  assert.equal(db.listRemoteProfiles().find(item => item.id === ids.get("rdp")).password, undefined);
  assert.equal(db.listRemoteProfiles().find(item => item.id === ids.get("rdp")).has_password, true);
  assert.equal(defaultRdp.allow_password_transfer, true);
  assert.equal(defaultRdp.display_mode, "dynamic");
  assert.equal(defaultRdp.fullscreen, false);
  assert.throws(() => db.insertRemoteProfile({name:"rdp-transfer-no-user",protocol:"rdp",host:"127.0.0.1",username:"",password:"secret",options:{allow_password_transfer:true}}), /必须填写用户名/);
  db.updateRemoteProfile(ids.get("rdp"), {options:{fullscreen:true,width:1920,height:1080}});
  assert.equal(db.getRemoteProfile(ids.get("rdp")).options.display_mode, "fullscreen");
  db.updateRemoteProfile(ids.get("rdp"), {options:{display_mode:"fixed",width:7680,height:4320}});
  assert.equal(db.getRemoteProfile(ids.get("rdp")).options.display_mode, "fixed");
  assert.equal(db.getRemoteProfile(ids.get("rdp")).options.width, 7680);
  const emptyRdpId = db.insertRemoteProfile({name:"rdp-empty",protocol:"rdp",host:"2001:db8::22",username:"",password:"",options:{}});
  assert.equal(db.getRemoteProfile(emptyRdpId).username, "");
  assert.equal(db.getRemoteProfile(emptyRdpId).password || "", "");
  assert.equal(db.getRemoteProfile(emptyRdpId).has_password, false);
  db.deleteRemoteProfile(emptyRdpId);
  const listedFtp = db.listRemoteProfiles().find(item => item.id === ids.get("ftp"));
  assert.equal(listedFtp.password, undefined);
  assert.equal(listedFtp.has_password, true);
  assert.equal(db.getRemoteProfile(ids.get("ftp")).password, "ftp-secret");

  const duplicate = db.duplicateRemoteProfile(ids.get("ftp"));
  assert.match(duplicate.name, /（copy1）$/);
  assert.equal(db.getRemoteProfile(duplicate.id).password, "ftp-secret");

  db.updateRemoteProfile(ids.get("telnet"), {port:2323, options:{encoding:"gbk", terminal_type:"xterm"}});
  assert.equal(db.getRemoteProfile(ids.get("telnet")).port, 2323);
  assert.equal(db.getRemoteProfile(ids.get("telnet")).options.encoding, "gbk");

  const snapshot = db.exportConfigSnapshot();
  assert.equal(snapshot.remote_profiles.length, 7);
  const restored = db.restoreConfigSnapshot(snapshot);
  assert.equal(restored.remote_profiles, 7);
  assert.equal(db.listRemoteProfiles().length, 7);

  const { buildTerminalCommand } = require("../dist/ssh");
  const previousXauth = process.env.TERMA_XAUTH;
  process.env.TERMA_XAUTH = process.platform === "win32" ? "C:\\Terma\\xauth.exe" : "/opt/terma/xauth";
  const args = buildTerminalCommand(db.getConnection(sshId));
  assert.equal(args.includes("-Y"), true);
  assert.equal(args.includes(`XAuthLocation=${process.env.TERMA_XAUTH}`), true);
  if (previousXauth === undefined) delete process.env.TERMA_XAUTH;
  else process.env.TERMA_XAUTH = previousXauth;
  const { shouldUseBuiltinSsh } = require("../dist/ssh2-client");
  assert.equal(shouldUseBuiltinSsh(db.getConnection(sshId)), false);

  const { ftpName, ftpPath } = require("../dist/ftp");
  assert.equal(ftpPath("/root/../srv/./data"), "/srv/data");
  assert.equal(ftpName("report.txt"), "report.txt");
  assert.throws(() => ftpName("../report.txt"), /无效/);

  const { serialRuntime } = require("../dist/remote-terminal");
  assert.equal(typeof serialRuntime().available, "boolean");
  const remoteHost = require("../dist/remote-host");
  assert.equal(remoteHost.normalizeRemoteHost("[2001:db8::1]"), "2001:db8::1");
  assert.equal(remoteHost.formatRemoteEndpoint("2001:db8::1", 3389), "[2001:db8::1]:3389");
  assert.throws(() => remoteHost.validateRemoteHost("[not-an-ipv6]"), /IPv6/);
  console.log("多协议回归检查通过：远程配置、加密凭据、快照、X11、FTP 路径和串口运行时");
} finally {
  try { db?.closeDatabase(); } catch {}
  const resolved = path.resolve(temporary);
  const root = path.resolve(os.tmpdir());
  if (resolved.startsWith(`${root}${path.sep}`) && path.basename(resolved).startsWith("terma-remote-protocol-")) {
    fs.rmSync(resolved, {recursive:true, force:true});
  }
}
