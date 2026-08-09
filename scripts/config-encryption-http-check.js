const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`配置加密测试服务器提前退出：${child.exitCode}`);
    try {
      if ((await fetch(`${url}/api/auth/status`)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("等待配置加密测试服务器启动超时");
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-encryption-http-"));
  const previousData = process.env.TERMA_DATA_DIR;
  const previousSsh = process.env.TERMA_SSH_DIR;
  process.env.TERMA_DATA_DIR = path.join(root, "data");
  process.env.TERMA_SSH_DIR = path.join(root, ".ssh");
  fs.mkdirSync(process.env.TERMA_SSH_DIR, {recursive:true});
  const webPassword = `web-${crypto.randomBytes(18).toString("base64url")}`;
  const masterPassword = `master-${crypto.randomBytes(18).toString("base64url")}`;
  const security = require("../dist/security");
  const database = require("../dist/db");
  const cryptoStore = require("../dist/crypto-store");
  security.setPassword(webPassword);
  security.updateSecurityOptions({auth_mode:"always"});
  database.insertConnection({
    name:"encrypted-http",
    group_name:"测试",
    ssh_host:"example.test",
    ssh_port:22,
    ssh_user:"tester",
    auth_type:"password",
    ssh_password:"http-secret"
  }, "");
  cryptoStore.enableEncryption(masterPassword);
  database.encryptStoredConnectionSecrets();
  cryptoStore.completeEncryptionEnable();
  cryptoStore.lockEncryption();
  database.closeDatabase();

  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join("dist", "server.js"), "--host", "127.0.0.1", "--port", String(port)], {
    cwd:path.resolve(__dirname, ".."),
    env:process.env,
    stdio:["ignore", "pipe", "pipe"],
    windowsHide:true
  });
  const output = [];
  child.stdout.on("data", chunk => output.push(chunk.toString()));
  child.stderr.on("data", chunk => output.push(chunk.toString()));
  try {
    await waitForServer(url, child);
    const login = await fetch(`${url}/api/auth/login`, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({password:webPassword})
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const lockedSettings = await (await fetch(`${url}/api/security`, {headers:{Cookie:cookie}})).json();
    assert.equal(lockedSettings.encryption_enabled, true);
    assert.equal(lockedSettings.encryption_ready, false);
    assert.equal((await fetch(`${url}/api/backup/bundle`, {headers:{Cookie:cookie}})).status, 423);

    const unlocked = await fetch(`${url}/api/security/encryption/unlock`, {
      method:"POST",
      headers:{Cookie:cookie, "Content-Type":"application/json"},
      body:JSON.stringify({password:masterPassword})
    });
    assert.equal(unlocked.status, 200);
    const bundleResponse = await fetch(`${url}/api/backup/bundle`, {headers:{Cookie:cookie}});
    assert.equal(bundleResponse.status, 200);
    const bundle = Buffer.from(await bundleResponse.arrayBuffer());
    const magic = Buffer.from("TERMA-BACKUP-V3\n", "ascii");
    assert.equal(bundle.subarray(0, magic.length).equals(magic), true);
    const metadataLength = bundle.readUInt32BE(magic.length);
    const metadata = JSON.parse(bundle.subarray(magic.length + 4, magic.length + 4 + metadataLength).toString("utf8"));
    assert.equal(metadata.security.encryption_version, 2);
    assert.equal(metadata.security.encryption_state, "enabled");
    assert.notEqual(metadata.security.encryption_check, crypto.scryptSync(masterPassword, metadata.security.encryption_salt, 32).toString("hex"));
    console.log("配置加密 HTTP 边界检查通过：锁定状态拒绝完整迁移包，解锁后仅导出 v2 verifier");
  } catch (error) {
    if (output.length) console.error(output.join("").slice(-12000));
    throw error;
  } finally {
    try { child.kill("SIGTERM"); } catch {}
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        resolve();
      }, 3000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    fs.rmSync(root, {recursive:true, force:true});
    if (previousData === undefined) delete process.env.TERMA_DATA_DIR;
    else process.env.TERMA_DATA_DIR = previousData;
    if (previousSsh === undefined) delete process.env.TERMA_SSH_DIR;
    else process.env.TERMA_SSH_DIR = previousSsh;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
