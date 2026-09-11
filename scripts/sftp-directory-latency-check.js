const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-sftp-directory-latency-"));
process.env.TERMA_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TERMA_SSH_DIR = path.join(temporaryRoot, "ssh");

const connection = {
  id:99002,
  ssh_host:"127.0.0.1",
  ssh_port:22,
  ssh_user:"smoke",
  auth_type:"password",
  ssh_password:"smoke"
};
const db = require("../dist/db");
const dbModule = require.cache[require.resolve("../dist/db")];
const sshClientModule = require("../dist/ssh2-client");
const quickTerminalModule = require("../dist/quick-terminal");
const originalGetConnection = dbModule.exports.getConnection;
const originalConnectSsh = sshClientModule.connectSsh;
let channelOpens = 0;
let activeDirectory = "";

class FakeSftpChannel extends EventEmitter {
  constructor() {
    super();
    this.closed = false;
  }

  realpath(remotePath, callback) {
    setTimeout(() => callback(null, remotePath), 2);
  }

  readdir(remotePath, callback) {
    const delay = remotePath === "/slow" ? 200 : 2;
    setTimeout(() => callback(null, [
      {filename:"notes.txt", attrs:{mode:0o100644, size:12, mtime:1700000000}}
    ]), delay);
  }

  stat(_remotePath, callback) {
    setTimeout(() => callback(null, {mode:0o100644, size:12, mtime:1700000000}), 2);
  }

  end() {
    if (this.closed) return;
    this.closed = true;
    setImmediate(() => this.emit("close"));
  }
}

const fakeClient = new EventEmitter();
fakeClient.sftp = callback => {
  channelOpens += 1;
  setTimeout(() => callback(null, new FakeSftpChannel()), 120);
};
fakeClient.end = () => fakeClient.emit("close");

dbModule.exports.getConnection = id => Number(id) === connection.id ? connection : originalGetConnection(id);
sshClientModule.connectSsh = async () => fakeClient;
quickTerminalModule.resolveQuickConnectionById = () => null;

const session = require("../dist/sftp-session");

async function main() {
  try {
    const firstStart = performance.now();
    const first = await session.readSftpDirectory(connection.id, "/one", {resolveSymlinks:true});
    const firstMs = performance.now() - firstStart;
    const warmStart = performance.now();
    const warm = await session.readSftpDirectory(connection.id, "/two", {resolveSymlinks:true});
    const warmMs = performance.now() - warmStart;

    assert.equal(first.entries.length, 1);
    assert.equal(warm.entries.length, 1);
    assert.equal(channelOpens, 1, "sequential directory reads must reuse the warm SFTP channel");
    assert.ok(firstMs >= 100, `the simulated first SFTP handshake should be observable: ${firstMs.toFixed(1)}ms`);
    assert.ok(warmMs < 80, `a warm small-directory read paid the handshake again: ${warmMs.toFixed(1)}ms`);

    const controller = new AbortController();
    const slowRequest = session.readSftpDirectory(connection.id, "/slow", {signal:controller.signal});
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(slowRequest, error => error?.name === "AbortError");

    await session.readSftpDirectory(connection.id, "/after-cancel", {resolveSymlinks:true});
    assert.equal(channelOpens, 2, "cancelling a directory read must discard only its leased channel");
    console.log(`SFTP directory latency check passed: cold=${firstMs.toFixed(1)}ms warm=${warmMs.toFixed(1)}ms channels=${channelOpens}`);
  } finally {
    session.closeAllSftpSessions();
    db.closeDatabase();
    sshClientModule.connectSsh = originalConnectSsh;
    dbModule.exports.getConnection = originalGetConnection;
    try { fs.rmSync(temporaryRoot, {recursive:true, force:true}); } catch {}
  }
}

main().catch(error => {
  console.error(error);
  try { db.closeDatabase(); } catch {}
  try { fs.rmSync(temporaryRoot, {recursive:true, force:true}); } catch {}
  process.exitCode = 1;
});
