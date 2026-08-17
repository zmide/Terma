"use strict";

const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-persistent-ssh-"));
process.env.TERMA_DATA_DIR = path.join(temporaryRoot, "data");

const ssh2ClientPath = require.resolve(path.join(root, "dist", "ssh2-client"));
let connectCount = 0;
let execCount = 0;
let endCount = 0;

class FakeChannel extends EventEmitter {
  constructor(command) {
    super();
    this.command = command;
    this.stderr = new EventEmitter();
  }

  end(input) {
    queueMicrotask(() => {
      this.emit("data", Buffer.from(`ok:${this.command}`));
      if (input) this.emit("data", Buffer.from(`:${Buffer.from(input).toString("utf8")}`));
      this.emit("close", 0);
    });
  }

  close() {
    this.emit("close", null);
  }
}

class FakeClient extends EventEmitter {
  exec(command, callback) {
    execCount += 1;
    callback(null, new FakeChannel(command));
  }

  end() {
    endCount += 1;
    this.emit("close");
  }
}

require.cache[ssh2ClientPath] = {
  id:ssh2ClientPath,
  filename:ssh2ClientPath,
  loaded:true,
  exports:{
    connectSsh:async () => {
      connectCount += 1;
      return new FakeClient();
    },
    ensureConnectionHostTrusted:async () => ({}),
    normalizeSshTransportError:error => error,
    runPasswordCommand:async () => ({status:0, stdout:"", stderr:""}),
    shouldUseBuiltinSsh:() => true,
    startPasswordForward:() => { throw new Error("unexpected forward"); },
    decodeSshOutput:value => Buffer.from(value || []).toString("utf8")
  }
};

const ssh = require(path.join(root, "dist", "ssh"));
const db = require(path.join(root, "dist", "db"));

(async () => {
  try {
    const connection = {
      id:71,
      ssh_host:"linux.test",
      ssh_port:22,
      ssh_user:"tester",
      auth_type:"password",
      ssh_password:"secret"
    };

    const first = await ssh.runPersistentSshCommandForConnection(connection, "first", 1000);
    const second = await ssh.runPersistentSshCommandForConnectionStreaming(
      connection,
      "second",
      1000,
      null,
      {input:Buffer.from("payload")}
    );
    assert.equal(first.status, 0);
    assert.equal(first.stdout, "ok:first");
    assert.equal(second.stdout, "ok:second:payload");
    assert.equal(connectCount, 1, "commands for one connection must reuse one SSH client");
    assert.equal(execCount, 2, "each operation must use a separate exec channel");

    await ssh.runPersistentSshCommandForConnection({...connection, ssh_port:2222}, "changed", 1000);
    assert.equal(connectCount, 2, "connection-setting changes must rebuild the persistent SSH client");
    assert.ok(endCount >= 1, "the replaced SSH client must be closed");

    ssh.closePersistentSshCommandSessions();
    assert.ok(endCount >= 2, "server shutdown must close all persistent SSH clients");
    console.log("Persistent SSH command session check passed.");
  } finally {
    ssh.closePersistentSshCommandSessions();
    db.closeDatabase();
    fs.rmSync(temporaryRoot, {recursive:true, force:true});
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
