const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-host-trust-"));
process.env.TUNNELDESK_DATA_DIR = path.join(root, "data");
process.env.TUNNELDESK_SSH_DIR = path.join(root, "ssh");

const {
  acceptHostTrust,
  listTrustedHosts,
  removeTrustedHost,
  systemHostKeyArgs,
  verifyHostKey
} = require("../dist/ssh-host-trust");
const { sshTransportForConnection } = require("../dist/ssh2-client");

function sshString(value) {
  const body = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  return Buffer.concat([length, body]);
}

function hostKey(seed) {
  return Buffer.concat([sshString("ssh-ed25519"), sshString(Buffer.alloc(32, seed))]);
}

function challengeFor(connection, key, expectedCode) {
  try {
    verifyHostKey(connection, key);
  } catch (error) {
    assert.equal(error.code, expectedCode);
    return error.challenge;
  }
  assert.fail(`expected ${expectedCode}`);
}

function main() {
  const connection = { ssh_host:"Example.COM", ssh_port:2222 };
  const firstKey = hostKey(1);
  const changedKey = hostKey(2);

  console.log("检查首次 SSH 主机指纹确认...");
  const initial = challengeFor(connection, firstKey, "SSH_HOST_KEY_UNKNOWN");
  assert.equal(initial.state, "unknown");
  assert.equal(initial.host_label, "example.com:2222");
  acceptHostTrust(initial.token, "persist");
  assert.equal(verifyHostKey(connection, firstKey), true);

  const records = listTrustedHosts();
  assert.equal(records.length, 1);
  assert.equal(records[0].key_type, "ssh-ed25519");
  assert.equal(Object.prototype.hasOwnProperty.call(records[0], "key_base64"), false);

  console.log("检查主机密钥变化、仅本次信任和永久更新...");
  const changed = challengeFor(connection, changedKey, "SSH_HOST_KEY_CHANGED");
  assert.equal(changed.previous_fingerprint, records[0].fingerprint);
  acceptHostTrust(changed.token, "once");
  assert.equal(verifyHostKey(connection, changedKey, {consume:false}), true);
  const onceArgs = systemHostKeyArgs(connection);
  assert.ok(onceArgs.includes("StrictHostKeyChecking=yes"));
  assert.ok(onceArgs.some(item => item.startsWith("UserKnownHostsFile=")));
  assert.ok(onceArgs.includes("HostKeyAlgorithms=ssh-ed25519"));
  challengeFor(connection, changedKey, "SSH_HOST_KEY_CHANGED");

  const update = challengeFor(connection, changedKey, "SSH_HOST_KEY_CHANGED");
  acceptHostTrust(update.token, "persist");
  assert.equal(verifyHostKey(connection, changedKey), true);
  removeTrustedHost(listTrustedHosts()[0].id);
  assert.equal(listTrustedHosts().length, 0);

  console.log("检查内置 SSH 默认优先和系统 OpenSSH 自动回退...");
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength:2048 });
  const keyFile = path.join(root, "id_rsa");
  fs.writeFileSync(keyFile, privateKey.export({type:"pkcs1", format:"pem"}), {mode:0o600});
  const keyConnection = {auth_type:"key", identity_file:keyFile, extra_args:"-o ServerAliveInterval=60"};
  assert.equal(sshTransportForConnection(keyConnection), "builtin");
  assert.equal(sshTransportForConnection({...keyConnection, extra_args:"-o ProxyJump=bastion"}), "system");
  const previousAgent = process.env.SSH_AUTH_SOCK;
  delete process.env.SSH_AUTH_SOCK;
  assert.equal(sshTransportForConnection({auth_type:"key", identity_file:"", extra_args:""}), "system");
  if (previousAgent !== undefined) process.env.SSH_AUTH_SOCK = previousAgent;
  assert.equal(sshTransportForConnection({auth_type:"password", extra_args:"-o ProxyJump=bastion"}), "unsupported");

  console.log("SSH 主机信任与传输策略检查通过");
}

try {
  main();
} finally {
  fs.rmSync(root, {recursive:true, force:true});
}
