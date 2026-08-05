"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-vnc-credential-"));
process.env.TUNNELDESK_DATA_DIR = path.join(temporaryRoot, "data");

const database = require("../dist/db");

try {
  const id = database.insertRemoteProfile({
    name:"VNC credential fixture",
    group_name:"测试",
    protocol:"vnc",
    host:"127.0.0.1",
    port:5900,
    password:"initial-secret"
  });
  const listed = database.listRemoteProfiles().find(item => item.id === id);
  assert.equal(listed.has_password, true);
  assert.equal(listed.password, undefined, "连接列表不能暴露 VNC 明文密码");
  assert.deepEqual(database.getVncProfileCredential(id), {has_password:true, password:"initial-secret"});

  assert.deepEqual(database.updateVncProfileCredential(id, "replacement-secret"), {ok:true, has_password:true});
  assert.equal(database.getVncProfileCredential(id).password, "replacement-secret");

  assert.deepEqual(database.updateVncProfileCredential(id, ""), {ok:true, has_password:false});
  assert.deepEqual(database.getVncProfileCredential(id), {has_password:false, password:""});

  const ftpId = database.insertRemoteProfile({name:"FTP fixture", protocol:"ftp", host:"127.0.0.1", port:21});
  assert.throws(() => database.getVncProfileCredential(ftpId), /不是 VNC/);
  console.log("VNC 凭据检查通过：列表脱敏、可选保存、更新与清除均正常");
} finally {
  try { database.closeDatabase(); } catch {}
  fs.rmSync(temporaryRoot, {recursive:true, force:true});
}
