const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Server } = require("ssh2");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-sftp-session-"));
process.env.TUNNELDESK_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TUNNELDESK_SSH_DIR = path.join(temporaryRoot, "ssh");

const db = require("../dist/db");
const dbModule = require.cache[require.resolve("../dist/db")];
const { trustTestHost } = require("./ssh-host-trust-test-helper");
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const hostKey = privateKey.export({ type:"pkcs1", format:"pem" });
let connections = 0;
let commands = 0;

const server = new Server({hostKeys:[hostKey]}, client => {
  connections += 1;
  client.on("authentication", context => context.accept());
  client.on("ready", () => client.on("session", accept => {
    const session = accept();
    session.on("exec", acceptExec => {
      commands += 1;
      const stream = acceptExec();
      stream.write(`command-${commands}`);
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
    assert.equal(connections, 1, "commands in one SFTP workspace should reuse the SSH2 transport");
    assert.equal(session.sftpSessionStatus(connection.id).connected, true);

    session.disconnectSftpSession(connection.id, {remember:true});
    assert.equal(session.sftpSessionStatus(connection.id).connected, false);
    assert.equal(await runCommand(session.spawnSftpSessionCommand, connection, "after-drop"), "command-3");
    assert.equal(connections, 2, "the next SFTP operation should transparently reconnect after a manual disconnect");
    assert.equal(session.sftpSessionStatus(connection.id).connected, true);
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
