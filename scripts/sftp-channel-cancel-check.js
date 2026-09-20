const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-sftp-channel-cancel-"));
process.env.TERMA_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TERMA_SSH_DIR = path.join(temporaryRoot, ".ssh");
fs.mkdirSync(process.env.TERMA_DATA_DIR, {recursive:true});
fs.mkdirSync(process.env.TERMA_SSH_DIR, {recursive:true});

const connection = {
  id:99301,
  name:"sftp-channel-cancel-check",
  ssh_host:"127.0.0.1",
  ssh_port:22,
  ssh_user:"smoke",
  auth_type:"password",
  ssh_password:"smoke",
  sftp_filename_encoding:"utf8"
};

const db = require("../dist/db");
const dbModule = require.cache[require.resolve("../dist/db")];
const originalGetConnection = dbModule.exports.getConnection;
dbModule.exports.getConnection = id => Number(id) === connection.id ? connection : originalGetConnection(id);

const ssh2Client = require("../dist/ssh2-client");
const ssh2ClientModule = require.cache[require.resolve("../dist/ssh2-client")];
const originalConnectSsh = ssh2ClientModule.exports.connectSsh;
const originalNormalizeError = ssh2ClientModule.exports.normalizeSshTransportError;

class FakeSftpClient extends EventEmitter {
  constructor() {
    super();
    this.endCalls = 0;
    this.sftpCalls = 0;
    this.nextChannel = null;
  }

  end() {
    this.endCalls += 1;
  }

  sftp(callback) {
    this.sftpCalls += 1;
    const channel = this.nextChannel;
    setTimeout(() => callback(null, channel), 140);
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function rejectsPromptly(promise, controller, message) {
  const startedAt = Date.now();
  setTimeout(() => controller.abort(), 15);
  await assert.rejects(promise, error => error?.name === "AbortError", message);
  assert.ok(Date.now() - startedAt < 120, `${message}：取消没有及时返回`);
}

async function main() {
  const client = new FakeSftpClient();
  ssh2ClientModule.exports.connectSsh = () => new Promise(resolve => setTimeout(() => resolve(client), 140));
  ssh2ClientModule.exports.normalizeSshTransportError = error => error;
  const session = require("../dist/sftp-session");
  try {
    const connectionAbort = new AbortController();
    await rejectsPromptly(
      session.openSftpChannel(connection.id, connectionAbort.signal),
      connectionAbort,
      "连接建立阶段必须支持取消"
    );
    await delay(180);
    assert.equal(session.sftpSessionStatus(connection.id).connected, true, "取消单个等待者不能中断共享 SSH 会话");
    assert.equal(client.endCalls, 0, "取消单个等待者不能关闭共享 SSH 客户端");
    assert.equal(client.sftpCalls, 0, "连接等待已取消后不能继续打开 SFTP channel");

    const lateChannel = {endCalls:0, end() { this.endCalls += 1; }};
    client.nextChannel = lateChannel;
    const channelAbort = new AbortController();
    await rejectsPromptly(
      session.stageSftpPaths(connection.id, ["/tmp/late.bin"], {signal:channelAbort.signal}),
      channelAbort,
      "SFTP channel 建立阶段必须支持取消"
    );
    await delay(180);
    assert.equal(client.sftpCalls, 1, "取消后不能重试打开 SFTP channel");
    assert.equal(lateChannel.endCalls, 1, "取消后迟到的 SFTP channel 必须立即关闭");
    const stagingRoot = path.join(process.env.TERMA_DATA_DIR, "sftp-drag");
    assert.deepEqual(fs.existsSync(stagingRoot) ? fs.readdirSync(stagingRoot) : [], [], "取消后必须清理未完成的本机暂存目录");
    assert.equal(session.sftpSessionStatus(connection.id).connected, true, "channel 取消不能重置共享 SSH 会话");
    console.log("SFTP channel cancellation check passed.");
  } finally {
    session.closeAllSftpSessions();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  ssh2ClientModule.exports.connectSsh = originalConnectSsh;
  ssh2ClientModule.exports.normalizeSshTransportError = originalNormalizeError;
  dbModule.exports.getConnection = originalGetConnection;
  try { db.closeDatabase(); } catch {}
  try { fs.rmSync(temporaryRoot, {recursive:true, force:true}); } catch {}
});
