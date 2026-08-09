const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-ssh-connection-"));
const temporaryDataDir = path.join(temporaryRoot, "data");
const temporarySshDir = path.join(temporaryRoot, ".ssh");
process.env.TERMA_DATA_DIR = temporaryDataDir;
process.env.TERMA_SSH_DIR = temporarySshDir;
fs.mkdirSync(temporarySshDir, {recursive:true});
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength:2048,
  privateKeyEncoding:{type:"pkcs1", format:"pem"}
});
fs.writeFileSync(path.join(temporarySshDir, "id_ed25519"), privateKey, {mode:0o600});

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
  sshDestinationArgs,
  ssh2TimingOptions,
  sshTarget,
  structuredOpenSshArgs,
  validateSshHost,
  validateSshUser
} = require("../dist/ssh-connection");
const { assertSafeExtraArgs, builtinSshExtraOptions } = require("../dist/ssh-command");
const { shouldUseBuiltinSsh, sshTransportForConnection } = require("../dist/ssh2-client");

function connection(name, overrides={}) {
  return {
    name,
    group_name:"测试",
    ssh_host:"example.test",
    ssh_port:22,
    ssh_user:"tester",
    auth_type:"key",
    identity_file:path.join(temporarySshDir, "id_ed25519"),
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
  assert.deepEqual(sshDestinationArgs(target), ["-l", "tester", "--", "example.test"]);
  assert.equal(validateSshUser("alice@example.com"), "alice@example.com");
  for (const value of ["-oProxyCommand=echo injected", "user name", "user\nname"]) assert.throws(() => validateSshUser(value), /SSH/);
  for (const value of ["-oProxyCommand=echo injected", "host/name", "host name", "host\nname"]) {
    assert.throws(() => validateSshHost(value), /SSH/);
  }
  assert.throws(
    () => sshDestinationArgs({...target, ssh_user:"-oProxyCommand=echo injected"}),
    /SSH/
  );
  assert.throws(
    () => sshDestinationArgs({...target, ssh_host:"-oProxyCommand=echo injected"}),
    /SSH/
  );
  for (const value of [
    "-E /tmp/ssh.log",
    "-S /tmp/ssh.sock",
    "-O check",
    "-M",
    "-K",
    "-o ControlPath=/tmp/ssh.sock",
    "-o UserKnownHostsFile=/tmp/known_hosts",
    "-o IdentityFile2=/tmp/id_test",
    "-o SmartcardDevice=/tmp/provider.so",
    "-o XAuthLocation=/tmp/xauth",
    "-o GSSAPIDelegateCredentials=yes",
    "-o GSSAPIAuthentication=yes",
    "-o Hostname=other.example",
    "-o User=other-user",
    "-o HostbasedAuthentication=yes",
    "-o EnableSSHKeysign=yes",
    "-L 127.0.0.1:9000:127.0.0.1:80",
    "-R 0.0.0.0:9000:127.0.0.1:80",
    "-D 0.0.0.0:1080",
    "-W internal.example:22",
    "other-host.example",
    "-- other-host.example"
  ]) {
    assert.throws(() => assertSafeExtraArgs(value), /SSH/);
  }
  assert.deepEqual(assertSafeExtraArgs("-4Cv -c aes256-gcm@openssh.com -m hmac-sha2-256 -o Compression=yes -o LogLevel=ERROR"), [
    "-4Cv", "-c", "aes256-gcm@openssh.com", "-m", "hmac-sha2-256", "-o", "Compression=yes", "-o", "LogLevel=ERROR"
  ]);
  assert.deepEqual(builtinSshExtraOptions("-4Cv -c aes256-gcm@openssh.com -m hmac-sha2-256 -o Compression=yes -o LogLevel=ERROR"), {
    supported:true,
    unsupported:"",
    options:{
      forceIPv4:true,
      forceIPv6:false,
      algorithms:{
        compress:["zlib@openssh.com", "zlib", "none"],
        cipher:["aes256-gcm@openssh.com"],
        hmac:["hmac-sha2-256"]
      }
    }
  });
  assert.equal(sshTransportForConnection({...target, auth_type:"password", extra_args:"-o Compression=yes -c aes256-gcm@openssh.com"}), "builtin");
  assert.throws(() => insertConnection(connection("password-system-only", {
    auth_type:"password",
    identity_file:"",
    private_key_passphrase:"",
    ssh_password:"secret",
    extra_args:"-o IPQoS=throughput"
  }), ""), /系统 OpenSSH/);
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
