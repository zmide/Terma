const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const iconv = require("iconv-lite");
const { Server } = require("ssh2");
const { runPasswordCommand } = require("../dist/ssh2-client");
const { trustTestHost } = require("./ssh-host-trust-test-helper");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function connection(port) {
  return {
    auth_type: "password",
    ssh_host: "127.0.0.1",
    ssh_port: port,
    ssh_user: "test",
    ssh_password: "test-password"
  };
}

async function main() {
  let uncaught = null;
  let unhandled = null;
  const onUncaught = (error) => { uncaught = error; };
  const onUnhandled = (error) => { unhandled = error; };
  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onUnhandled);

  const rejectingServer = net.createServer((socket) => socket.destroy());
  const rejectingPort = await listen(rejectingServer);
  const failed = await runPasswordCommand(connection(rejectingPort), "true", null, 3000);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await close(rejectingServer);
  assert.equal(failed.status, null);
  assert.ok(failed.error, "握手失败应返回普通错误结果");
  assert.equal(uncaught, null, `握手失败不应触发未捕获异常：${uncaught?.message || ""}`);
  assert.equal(unhandled, null, `握手失败不应触发未处理拒绝：${unhandled?.message || ""}`);

  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sshServer = new Server({
    hostKeys: [privateKey.export({type:"pkcs1", format:"pem"})]
  }, (client) => {
    client.on("authentication", (context) => {
      if (context.method === "password" && context.username === "test" && context.password === "test-password") context.accept();
      else context.reject();
    });
    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.on("exec", (acceptExec) => {
          const stream = acceptExec();
          stream.write(iconv.encode("安装完成\n", "gbk"));
          stream.exit(0);
          stream.end();
        });
      });
    });
  });
  const sshPort = await listen(sshServer);
  const encodedConnection = {...connection(sshPort), terminal_encoding:"gbk"};
  await trustTestHost(encodedConnection, "once");
  const succeeded = await runPasswordCommand(encodedConnection, "true", null, 3000);
  await close(sshServer);

  const encryptedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-encrypted-key-"));
  const encryptedKeyPath = path.join(encryptedDirectory, "id_rsa");
  const passphrase = "tunneldesk-test-passphrase";
  fs.writeFileSync(encryptedKeyPath, privateKey.export({
    type:"pkcs1",
    format:"pem",
    cipher:"aes-256-cbc",
    passphrase
  }));
  const keyServer = new Server({
    hostKeys: [privateKey.export({type:"pkcs1", format:"pem"})]
  }, (client) => {
    client.on("authentication", (context) => {
      if (context.method === "publickey" && context.username === "key-test") context.accept();
      else context.reject();
    });
    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.on("exec", (acceptExec) => {
          const stream = acceptExec();
          stream.exit(0);
          stream.end();
        });
      });
    });
  });
  const keyPort = await listen(keyServer);
  const keyConnection = {
    auth_type:"key",
    ssh_host:"127.0.0.1",
    ssh_port:keyPort,
    ssh_user:"key-test",
    identity_file:encryptedKeyPath,
    private_key_passphrase:passphrase,
    ssh_agent_mode:"off"
  };
  await trustTestHost(keyConnection, "once");
  const keySucceeded = await runPasswordCommand(keyConnection, "true", null, 3000);
  await close(keyServer);
  fs.rmSync(encryptedDirectory, {recursive:true, force:true});

  process.removeListener("uncaughtException", onUncaught);
  process.removeListener("unhandledRejection", onUnhandled);
  assert.equal(succeeded.status, 0, succeeded.error?.message || succeeded.stderr || "后续 SSH 测试应成功");
  assert.equal(succeeded.stdout, "安装完成\n", "普通 SSH 命令输出必须按连接编码解码");
  assert.equal(keySucceeded.status, 0, keySucceeded.error?.message || keySucceeded.stderr || "加密私钥口令连接应成功");
  assert.equal(uncaught, null);
  assert.equal(unhandled, null);
  console.log("SSH2 认证检查通过：握手失败可隔离，密码和加密私钥口令连接均可建立");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
