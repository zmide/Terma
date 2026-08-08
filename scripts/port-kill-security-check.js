const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { spawn } = require("node:child_process");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-port-kill-security-"));
const previousData = process.env.TERMA_DATA_DIR;
const previousSsh = process.env.TERMA_SSH_DIR;
process.env.TERMA_DATA_DIR = path.join(root, "data");
process.env.TERMA_SSH_DIR = path.join(root, ".ssh");

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

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "close"),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function startListenerChild(port, host = "127.0.0.1") {
  const child = spawn(process.execPath, ["-e", [
    'const net = require("node:net");',
    'const server = net.createServer();',
    'server.listen(Number(process.env.TERMA_TEST_PORT), process.env.TERMA_TEST_HOST, () => process.stdout.write("ready\\n"));',
    'setInterval(() => {}, 1000);'
  ].join("")], {
    env:{...process.env, TERMA_TEST_PORT:String(port), TERMA_TEST_HOST:host},
    stdio:["ignore", "pipe", "ignore"],
    windowsHide:true
  });
  await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(([code]) => { throw new Error(`Listener child exited before readiness (${code})`); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Listener child startup timed out")), 5000))
  ]);
  return child;
}

async function main() {
  const { pidRunning, closeDatabase } = require("../dist/db");
  const { diagnosePortUsage, killPortOwner } = require("../dist/ssh");
  let child = null;
  let listenerChild = null;
  try {
    for (const pid of [undefined, null, "", false, true, [], {}, -1, 0, 1, 1.5, "2.5", Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(() => killPortOwner(pid, 8088, "127.0.0.1"), error => /PID.*(safe integer|安全整数)/i.test(error.message));
    }
    for (const port of [undefined, null, "", -1, 0, 1.5, 65536, "65536", {}]) {
      await assert.rejects(() => killPortOwner(process.pid, port, "127.0.0.1"), error => /(Port|端口).*(1.*65535|65535)/i.test(error.message));
    }
    for (const host of [undefined, null, "", false, "127.0.0.1;shutdown", "host/name", "x".repeat(256)]) {
      await assert.rejects(() => killPortOwner(process.pid, 8088, host), error => /(Invalid port host|监听地址|host)/i.test(error.message));
    }
    for (const pid of [undefined, null, false, true, [], {}, -1, 0, 1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(pidRunning(pid), false);
    }

    child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio:"ignore",
      windowsHide:true
    });
    await once(child, "spawn");
    assert.equal(pidRunning(child.pid), true);
    const freePort = await availablePort();
    await assert.rejects(
      () => killPortOwner(child.pid, freePort, "127.0.0.1"),
      error => error?.statusCode === 409 && /(no longer the owner|占用状态|owner)/i.test(error.message)
    );
    assert.equal(child.exitCode, null, "A non-owner PID must remain running");

    const wildcardPort = await availablePort();
    listenerChild = await startListenerChild(wildcardPort, "0.0.0.0");
    await assert.rejects(
      () => killPortOwner(listenerChild.pid, wildcardPort, "192.0.2.1"),
      error => error?.statusCode === 409 && /(no longer the owner|占用状态|owner)/i.test(error.message)
    );
    assert.equal(listenerChild.exitCode, null, "A non-local requested address must not match a wildcard listener");
    await stopChild(listenerChild);
    listenerChild = null;

    const listenerPort = await availablePort();
    listenerChild = await startListenerChild(listenerPort);
    const diagnosis = await diagnosePortUsage("127.0.0.1", listenerPort);
    const listenerOwner = diagnosis.processes.find(item => Number(item.pid) === listenerChild.pid);
    assert.ok(diagnosis.occupied, "The listener port should be occupied");
    assert.ok(listenerOwner, "The exact listener address should resolve to the child owner");
    assert.ok(listenerOwner.listeners.some(item => item.address === "127.0.0.1"), "Owner evidence should retain the listener address");

    await assert.rejects(
      () => killPortOwner(listenerChild.pid, listenerPort, "192.0.2.1"),
      error => error?.statusCode === 409 && /(no longer the owner|占用状态|owner)/i.test(error.message)
    );
    assert.equal(listenerChild.exitCode, null, "A PID listening on another address must not be terminated");

    const killed = await killPortOwner(listenerChild.pid, listenerPort, "127.0.0.1");
    assert.equal(killed.ok, true);
    await Promise.race([once(listenerChild, "close"), new Promise(resolve => setTimeout(resolve, 3000))]);
    assert.notEqual(listenerChild.exitCode, null, "The exact address and port owner should be terminated");
    listenerChild = null;

    const frontend = fs.readFileSync(path.join(__dirname, "..", "public", "app-forwards.js"), "utf8");
    const callIndex = frontend.indexOf('api("/api/ports/kill"');
    assert.ok(callIndex >= 0, "The frontend should call the protected port-kill API");
    const call = frontend.slice(callIndex, callIndex + 260);
    assert.match(call, /pid\s*:\s*p\.pid/);
    assert.match(call, /host\s*:\s*diagnosis\.host/);
    assert.match(call, /port\s*:\s*diagnosis\.port/);

    console.log("Port kill security check passed: PID/port/host validation, listener-address owner binding, and frontend request binding");
  } finally {
    await stopChild(child);
    await stopChild(listenerChild);
    try { closeDatabase(); } catch {}
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  fs.rmSync(root, {recursive:true, force:true});
  if (previousData === undefined) delete process.env.TERMA_DATA_DIR;
  else process.env.TERMA_DATA_DIR = previousData;
  if (previousSsh === undefined) delete process.env.TERMA_SSH_DIR;
  else process.env.TERMA_SSH_DIR = previousSsh;
});
