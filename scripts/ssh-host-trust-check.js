const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-host-trust-"));
process.env.TERMA_DATA_DIR = path.join(root, "data");
process.env.TERMA_SSH_DIR = path.join(root, "ssh");

const {
  acceptHostTrust,
  listTrustedHosts,
  probeHostKey,
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

class ProbeClient extends EventEmitter {
  constructor() {
    super();
    this.connectOptions = null;
    this.endCalls = 0;
  }

  connect(options) {
    this.connectOptions = options;
  }

  end() {
    this.endCalls += 1;
  }
}

class LateErrorProbeClient extends ProbeClient {
  end() {
    super.end();
    queueMicrotask(() => this.emit("error", new Error("Connection lost before handshake")));
  }
}

async function checkProbeErrorLifecycle(connection) {
  console.log("检查主机密钥探测的迟到错误隔离和中文提示...");
  const successfulClient = new ProbeClient();
  const successfulProbe = probeHostKey(connection, {clientFactory:() => successfulClient});
  assert.equal(successfulClient.connectOptions.hostVerifier(hostKey(3)), false);
  const descriptor = await successfulProbe;
  assert.equal(descriptor.key_type, "ssh-ed25519");
  assert.equal(successfulClient.endCalls, 1);
  assert.doesNotThrow(() => successfulClient.emit("error", new Error("late socket error one")));
  assert.doesNotThrow(() => successfulClient.emit("error", new Error("late socket error two")));

  const refusedClient = new ProbeClient();
  const refusedProbe = probeHostKey(connection, {clientFactory:() => refusedClient});
  const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:2222"), {code:"ECONNREFUSED"});
  refusedClient.emit("error", refused);
  await assert.rejects(refusedProbe, error => {
    assert.equal(error.code, "ECONNREFUSED");
    assert.equal(error.message, "SSH 连接被拒绝：example.com:2222");
    return true;
  });
  assert.equal(refusedClient.endCalls, 1);
  assert.doesNotThrow(() => refusedClient.emit("error", new Error("second error after rejection")));

  const uncaught = [];
  const onUncaught = error => uncaught.push(error);
  process.on("uncaughtException", onUncaught);
  try {
    const timeoutClient = new LateErrorProbeClient();
    const timeoutProbe = probeHostKey(connection, {clientFactory:() => timeoutClient});
    timeoutClient.emit("error", new Error("Timed out while waiting for handshake"));
    await assert.rejects(timeoutProbe, error => {
      assert.equal(error.message, "SSH 主机密钥探测超时：example.com:2222");
      assert.doesNotMatch(error.message, /Timed out while waiting for handshake|Connection lost before handshake/i);
      return true;
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(timeoutClient.endCalls, 1);
    assert.equal(timeoutClient.listenerCount("error"), 1, "探测结束后仍需保留 error 监听以吞掉迟到错误");
    assert.deepEqual(uncaught, [], "握手超时后的迟到 connection lost 不得触发 uncaughtException");
  } finally {
    process.removeListener("uncaughtException", onUncaught);
  }

  const handshakeClient = new ProbeClient();
  const handshakeProbe = probeHostKey(connection, {clientFactory:() => handshakeClient});
  handshakeClient.emit("error", new Error("Handshake failed: no matching host key format"));
  await assert.rejects(handshakeProbe, error => {
    assert.match(error.message, /^SSH 握手失败/);
    assert.doesNotMatch(error.message, /Handshake failed/i);
    return true;
  });

  const unknownClient = new ProbeClient();
  const unknownProbe = probeHostKey(connection, {clientFactory:() => unknownClient});
  unknownClient.emit("error", new Error("Unexpected ssh2 transport detail"));
  await assert.rejects(unknownProbe, error => {
    assert.equal(error.message, "SSH 主机密钥探测失败：example.com:2222");
    assert.doesNotMatch(error.message, /Unexpected ssh2 transport detail/i);
    assert.doesNotMatch(JSON.stringify(error), /Unexpected ssh2 transport detail/i);
    return true;
  });
}

async function main() {
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

  await checkProbeErrorLifecycle(connection);

  console.log("SSH 主机信任与传输策略检查通过");
}

main()
  .catch(error => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(root, {recursive:true, force:true});
  });
