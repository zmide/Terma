const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-ssh-connection-"));
process.env.TERMA_DATA_DIR = temporaryRoot;
fs.writeFileSync(path.join(temporaryRoot, "id_ed25519"), "test-key-placeholder");

const {
  closeDatabase,
  get,
  getConnection,
  insertConnection,
  listConnections,
  updateConnection
} = require("../dist/db");
const {
  connectionSettings,
  proxyJumpArgument,
  ssh2TimingOptions,
  sshTarget,
  structuredOpenSshArgs
} = require("../dist/ssh-connection");
const { shouldUseBuiltinSsh, sshTransportForConnection } = require("../dist/ssh2-client");

function connection(name, overrides={}) {
  return {
    name,
    group_name:"测试",
    ssh_host:"example.test",
    ssh_port:22,
    ssh_user:"tester",
    auth_type:"key",
    identity_file:path.join(temporaryRoot, "id_ed25519"),
    private_key_passphrase:"secret-passphrase",
    ssh_agent_mode:"off",
    connect_timeout_seconds:17,
    keepalive_interval_seconds:31,
    keepalive_count_max:4,
    tcp_keepalive:0,
    ...overrides
  };
}

try {
  const jumpId = insertConnection(connection("jump", {private_key_passphrase:""}), "");
  const targetId = insertConnection(connection("target", {jump_connection_id:jumpId}), "");
  const target = getConnection(targetId);

  assert.equal(target.private_key_passphrase, "secret-passphrase");
  assert.equal(listConnections().find((item) => item.id === targetId).private_key_passphrase, undefined);
  assert.equal(listConnections().find((item) => item.id === targetId).has_private_key_passphrase, true);
  assert.equal(typeof get("SELECT private_key_passphrase FROM connections WHERE id=?", [targetId]).private_key_passphrase, "string");

  assert.deepEqual(connectionSettings(target), {
    connectTimeoutSeconds:17,
    keepaliveIntervalSeconds:31,
    keepaliveCountMax:4,
    tcpKeepalive:false,
    agentMode:"off"
  });
  assert.deepEqual(ssh2TimingOptions(target), {
    readyTimeout:17000,
    keepaliveInterval:31000,
    keepaliveCountMax:4
  });
  assert.deepEqual(structuredOpenSshArgs(target), [
    "-o", "ConnectTimeout=17",
    "-o", "ServerAliveInterval=31",
    "-o", "ServerAliveCountMax=4",
    "-o", "TCPKeepAlive=no"
  ]);
  assert.equal(sshTarget({...target, ssh_host:"2001:db8::1"}).label, "tester@[2001:db8::1]:22");
  assert.equal(proxyJumpArgument({...getConnection(jumpId), ssh_host:"2001:db8::2"}), "tester@[2001:db8::2]:22");
  assert.equal(sshTransportForConnection({...target, auth_type:"password", extra_args:"-o ProxyCommand=custom"}), "unsupported");
  assert.throws(() => shouldUseBuiltinSsh({...target, auth_type:"password", extra_args:"-o ProxyCommand=custom"}), /不能安全回退/);

  assert.throws(
    () => updateConnection(jumpId, connection("jump", {jump_connection_id:targetId, private_key_passphrase:""}), ""),
    /单级跳板/
  );
  assert.throws(
    () => updateConnection(targetId, connection("target", {jump_connection_id:targetId}), ""),
    /不能.*自己.*跳板/
  );

  console.log("SSH 连接构建检查通过：结构化参数、加密私钥口令、Agent 与单级跳板约束正常");
} finally {
  closeDatabase();
  fs.rmSync(temporaryRoot, {recursive:true, force:true});
}
