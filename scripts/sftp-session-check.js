const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Server } = require("ssh2");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-sftp-session-"));
process.env.TERMA_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TERMA_SSH_DIR = path.join(temporaryRoot, "ssh");

const db = require("../dist/db");
const dbModule = require.cache[require.resolve("../dist/db")];
const { trustTestHost } = require("./ssh-host-trust-test-helper");
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const hostKey = privateKey.export({ type:"pkcs1", format:"pem" });
let connections = 0;
let commands = 0;
let subsystemMode = "reject";
let rejectAuthentication = false;
const largeOutput = Buffer.alloc(2 * 1024 * 1024 + 16004, 0x61);

const server = new Server({hostKeys:[hostKey]}, client => {
  connections += 1;
  client.on("authentication", context => rejectAuthentication ? context.reject() : context.accept());
  client.on("ready", () => client.on("session", accept => {
    const session = accept();
    session.on("subsystem", (acceptSubsystem, rejectSubsystem) => {
      if (subsystemMode === "reject") return rejectSubsystem();
      const stream = acceptSubsystem();
      if (subsystemMode === "exits") {
        stream.stderr.write("fixture diagnostic that must not be sent to the browser");
        stream.exit(127);
      }
      stream.close();
    });
    session.on("exec", (acceptExec, _rejectExec, info) => {
      commands += 1;
      const stream = acceptExec();
      const encoded = info.command.match(/terma_payload=([A-Za-z0-9+/=]+);/)?.[1];
      const script = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
      if (script.includes("__TERMA_DIRECTORY_V1__")) {
        const targets = ["/missing", "/denied", "/compatible"].find(target => script.includes(Buffer.from(target).toString("base64")) || script.includes(target));
        if (targets === "/missing") stream.stderr.write("__TERMA_DIRECTORY_NOT_FOUND__");
        else if (targets === "/denied") stream.stderr.write("__TERMA_DIRECTORY_PERMISSION_DENIED__");
        else if (targets === "/compatible") {
          stream.write("__TERMA_DIRECTORY_V1__\n/compatible\n");
          stream.exit(0);
          stream.end();
          return;
        }
        stream.exit(1);
        stream.end();
        return;
      }
      stream.write(info.command === "large" ? largeOutput : `command-${commands}`);
      stream.exit(0);
      stream.end();
    });
  }));
});

function waitForServer() {
  return new Promise((resolve, reject) => server.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()));
}

function runCommand(spawn, connection, command) {
  return new Promise((resolve, reject) => {
    const child = spawn(connection, command);
    const chunks = [];
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.once("error", reject);
    child.once("close", code => code === 0
      ? resolve(Buffer.concat(chunks).toString("utf8"))
      : reject(new Error(`remote command exited with ${code}`)));
    child.stdin.end();
  });
}

function runLargeCommand(spawn, connection) {
  return new Promise((resolve, reject) => {
    const child = spawn(connection, "large");
    const chunks = [];
    child.stdout.on("data", chunk => {
      chunks.push(chunk);
      child.stdout.pause();
      setTimeout(() => child.stdout.resume(), 2);
    });
    child.once("error", reject);
    child.once("close", code => code === 0
      ? resolve(Buffer.concat(chunks))
      : reject(new Error(`remote command exited with ${code}`)));
    child.stdin.end();
  });
}

async function main() {
  await waitForServer();
  const connection = {
    id:99001,
    ssh_host:"127.0.0.1",
    ssh_port:server.address().port,
    ssh_user:"smoke",
    auth_type:"password",
    ssh_password:"smoke"
  };
  const originalGetConnection = dbModule.exports.getConnection;
  dbModule.exports.getConnection = id => Number(id) === connection.id ? connection : originalGetConnection(id);
  await trustTestHost(connection);
  connections = 0;
  const session = require("../dist/sftp-session");
  try {
    assert.equal(await runCommand(session.spawnSftpSessionCommand, connection, "first"), "command-1");
    assert.equal(await runCommand(session.spawnSftpSessionCommand, connection, "second"), "command-2");
    assert.deepEqual(await runLargeCommand(session.spawnSftpSessionCommand, connection), largeOutput);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(await runLargeCommand(session.spawnSftpSessionCommand, connection), largeOutput);
    const burstOutputs = await Promise.all(
      Array.from({length:24}, (_, index) => runCommand(session.spawnSftpSessionCommand, connection, `burst-${index}`))
    );
    assert.equal(burstOutputs.length, 24, "parallel SFTP commands must all complete");
    assert.ok(burstOutputs.every(value => /^command-\d+$/.test(value)), "parallel SFTP commands must keep their output intact");
    assert.equal(connections, 1, "commands in one SFTP workspace should reuse the SSH2 transport");
    assert.equal(session.sftpSessionStatus(connection.id).connected, true);
    const failure = error => error.publicCode === "sftp_subsystem_unavailable" && error.statusCode === 502
      && !error.message.includes("fixture diagnostic");
    await assert.rejects(session.readSftpDirectory(connection.id), failure);
    subsystemMode = "exits";
    await assert.rejects(session.readSftpDirectory(connection.id), failure);
    const { listRemoteDir } = require("../dist/sftp");
    await assert.rejects(listRemoteDir(connection.id), failure);
    await assert.rejects(listRemoteDir(connection.id, "/missing"), error => error.code === "SFTP_DIRECTORY_NOT_FOUND");
    await assert.rejects(listRemoteDir(connection.id, "/denied"), error => error.code === "SFTP_DIRECTORY_PERMISSION_DENIED");
    assert.equal((await listRemoteDir(connection.id, "/compatible")).path, "/compatible", "a compatible shell still lists directories when the native read fails");
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(listRemoteDir(connection.id, ".", {signal:controller.signal}), error => error.name === "AbortError");
    subsystemMode = "close";
    await assert.rejects(session.readSftpDirectory(connection.id), error => error.code === "SSH_TRANSPORT_FAILED"
      && /unexpected SFTP session termination/.test(error.cause?.message));

    session.disconnectSftpSession(connection.id, {remember:true});
    assert.equal(session.sftpSessionStatus(connection.id).connected, false);
    assert.match(await runCommand(session.spawnSftpSessionCommand, connection, "after-drop"), /^command-\d+$/);
    assert.equal(connections, 2, "the next SFTP operation should transparently reconnect after a manual disconnect");
    assert.equal(session.sftpSessionStatus(connection.id).connected, true);
    session.disconnectSftpSession(connection.id, {remember:true});
    rejectAuthentication = true;
    await assert.rejects(session.readSftpDirectory(connection.id), {code:"SSH_AUTHENTICATION_FAILED"});
    console.log("Persistent SFTP session check passed.");
  } finally {
    session.closeAllSftpSessions();
    await new Promise(resolve => server.close(resolve));
    db.closeDatabase();
    fs.rmSync(temporaryRoot, {recursive:true, force:true});
  }
}

main().catch(error => {
  console.error(error);
  try { db.closeDatabase(); } catch {}
  try { server.close(); } catch {}
  try { fs.rmSync(temporaryRoot, {recursive:true, force:true}); } catch {}
  process.exitCode = 1;
});
