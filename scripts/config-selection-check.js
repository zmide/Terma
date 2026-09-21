const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-config-selection-check-"));
process.env.TERMA_DATA_DIR = root;

try {
  const database = require("../dist/db");
  const connectionId = database.insertConnection({
    name:"selection-ssh",
    group_name:"选择性导入测试",
    ssh_host:"127.0.0.1",
    ssh_port:22,
    ssh_user:"tester",
    auth_type:"password",
    ssh_password:"ssh-secret"
  }, "");
  database.insertRemoteProfile({
    name:"selection-rdp",
    group_name:"选择性导入测试",
    protocol:"rdp",
    host:"127.0.0.1",
    port:3389,
    username:"tester",
    password:"rdp-secret"
  });
  database.insertCommandSnippet({name:"selection-command", group_name:"测试", command:"echo ok"});
  database.insertForward(connectionId, {mode:"local", bind_host:"127.0.0.1", bind_port:39001, target_host:"127.0.0.1", target_port:22});

  const withoutPasswords = database.exportConfigSelection({connections:true, remote_profiles:true, forwards:true, command_snippets:true, passwords:false});
  assert.equal(withoutPasswords.type, "terma-config-selection");
  assert.equal(withoutPasswords.data.connections[0].ssh_password, null);
  assert.equal(withoutPasswords.data.remote_profiles[0].password, null);

  const withPasswords = database.exportConfigSelection({connections:true, remote_profiles:true, forwards:true, command_snippets:true, passwords:true});
  assert.equal(withPasswords.data.connections[0].ssh_password, "ssh-secret");
  assert.equal(withPasswords.data.remote_profiles[0].password, "rdp-secret");
  assert.equal(database.restoreConfigSelection(withPasswords).ok, true);

  const commandOnly = database.exportConfigSelection({command_snippets:true});
  assert.equal(commandOnly.data.connections, undefined);
  assert.equal(commandOnly.data.command_snippets.length, 1);

  database.closeDatabase();
  console.log("选择性配置导入导出检查通过");
} finally {
  fs.rmSync(root, {recursive:true, force:true});
}
