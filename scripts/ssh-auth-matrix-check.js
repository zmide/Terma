const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { Server } = require("ssh2");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-auth-matrix-"));
process.env.TERMA_DATA_DIR = root;
const sshRoot = path.join(root, ".ssh");
process.env.TERMA_SSH_DIR = sshRoot;
fs.mkdirSync(sshRoot, {recursive:true});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(server.address().port); });
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

function commandServer(hostKey) {
  return new Server({hostKeys:[hostKey]}, client => {
    client.on("authentication", context => {
      if (context.username === "tester" && context.method === "password" && context.password === "test-password") context.accept();
      else if (context.username === "tester" && context.method === "publickey") context.accept();
      else context.reject();
    });
    client.on("ready", () => client.on("session", accept => {
      const session = accept();
      session.on("exec", acceptExec => {
        const stream = acceptExec();
        stream.write("matrix-ok\n");
        stream.exit(0);
        stream.end();
      });
    }));
  });
}

async function main() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {modulusLength:2048});
  const hostKey = privateKey.export({type:"pkcs1", format:"pem"});
  const encryptedKey = path.join(sshRoot, "id_rsa");
  fs.writeFileSync(encryptedKey, privateKey.export({type:"pkcs1", format:"pem", cipher:"aes-256-cbc", passphrase:"key-passphrase"}));

  const targetServer = commandServer(hostKey);
  const targetPort = await listen(targetServer);
  let jumpConnections = 0;
  const jumpServer = new Server({hostKeys:[hostKey]}, client => {
    client.on("authentication", context => {
      if (context.username === "tester" && context.method === "password" && context.password === "test-password") context.accept();
      else context.reject();
    });
    client.on("ready", () => {
      jumpConnections += 1;
      client.on("tcpip", (accept, reject, info) => {
        const socket = net.connect(Number(info.destPort), String(info.destIP));
        socket.once("connect", () => {
          const channel = accept();
          socket.pipe(channel).pipe(socket);
        });
        socket.once("error", () => reject());
      });
    });
  });
  const jumpPort = await listen(jumpServer);

  const { closeDatabase, getConnection, insertConnection } = require("../dist/db");
  const { builtinSshCompatibility, closeJumpConnectionPool, ensureConnectionHostTrusted, runPasswordCommand } = require("../dist/ssh2-client");
  const { trustTestHost } = require("./ssh-host-trust-test-helper");
  const base = {name:"", group_name:"测试", ssh_host:"127.0.0.1", ssh_user:"tester", ssh_agent_mode:"off"};
  const jumpId = insertConnection({...base, name:"jump", ssh_port:jumpPort, auth_type:"password", ssh_password:"test-password"}, "");
  const keyId = insertConnection({...base, name:"key-target", ssh_port:targetPort, auth_type:"key", identity_file:encryptedKey, private_key_passphrase:"key-passphrase", jump_connection_id:jumpId}, "");
  const passwordId = insertConnection({...base, name:"password-target", ssh_port:targetPort, auth_type:"password", ssh_password:"test-password"}, "");
  const jump = getConnection(jumpId);
  const keyTarget = getConnection(keyId);
  const passwordTarget = getConnection(passwordId);

  await trustTestHost(jump, "persist");
  await trustTestHost(keyTarget, "persist");
  await ensureConnectionHostTrusted(keyTarget);
  await trustTestHost(passwordTarget, "persist");

  const passwordResult = await runPasswordCommand(passwordTarget, "true", null, 4000);
  const firstJumpResult = await runPasswordCommand(keyTarget, "true", null, 4000);
  const secondJumpResult = await runPasswordCommand(keyTarget, "true", null, 4000);
  assert.equal(passwordResult.status, 0, passwordResult.error?.message || passwordResult.stderr);
  assert.equal(firstJumpResult.status, 0, firstJumpResult.error?.message || firstJumpResult.stderr);
  assert.equal(secondJumpResult.status, 0, secondJumpResult.error?.message || secondJumpResult.stderr);
  assert.equal(jumpConnections, 2, "主机信任预检使用独立连接，后续两个目标会话应复用同一个跳板连接");
  const previousDisplay = process.env.DISPLAY;
  process.env.DISPLAY = "127.0.0.1:0.0";
  assert.equal(builtinSshCompatibility({...passwordTarget, x11_mode:"untrusted"}).supported, true, "密码 X11 应由内置 SSH 处理");
  if (previousDisplay === undefined) delete process.env.DISPLAY;
  else process.env.DISPLAY = previousDisplay;
  assert.equal(builtinSshCompatibility({...passwordTarget, x11_mode:"untrusted"}).supported, true, "没有 DISPLAY 时仍应使用内置 SSH，并在会话内降级为普通终端");

  closeJumpConnectionPool();
  await new Promise(resolve => setTimeout(resolve, 100));
  closeDatabase();
  await Promise.all([close(targetServer), close(jumpServer)]);
  console.log("SSH 认证矩阵检查通过：密码、加密私钥、内置 X11、单级跳板、双端主机信任与跳板空闲复用正常");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  try { require("../dist/ssh2-client").closeJumpConnectionPool(); } catch {}
  try { require("../dist/db").closeDatabase(); } catch {}
  try { fs.rmSync(root, {recursive:true, force:true}); } catch {}
});
