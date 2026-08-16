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

function availablePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function availableIpv6Port() {
  try {
    return await availablePort("::");
  } catch (error) {
    if (["EAFNOSUPPORT", "EADDRNOTAVAIL", "EPROTONOSUPPORT"].includes(error?.code)) return null;
    throw error;
  }
}

function childStopped(child) {
  return !child || child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildStop(child, timeoutMs = 3000) {
  if (childStopped(child)) return true;
  await Promise.race([
    once(child, "close"),
    new Promise(resolve => setTimeout(resolve, timeoutMs))
  ]);
  return childStopped(child);
}

async function stopChild(child) {
  if (childStopped(child)) return;
  child.kill("SIGTERM");
  await waitForChildStop(child, 2000);
  if (!childStopped(child)) child.kill("SIGKILL");
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
    const freeDiagnosis = await diagnosePortUsage("127.0.0.1", freePort);
    assert.equal(freeDiagnosis.occupied, false, "A free listener port should remain available");
    assert.equal(Object.hasOwn(freeDiagnosis, "message"), false, "Port diagnosis should return structured state without fixed-language copy");
    await assert.rejects(
      () => killPortOwner(child.pid, freePort, "127.0.0.1"),
      error => error?.statusCode === 409 && /(no longer the owner|占用状态|owner)/i.test(error.message)
    );
    assert.equal(childStopped(child), false, "A non-owner PID must remain running");

    const wildcardPort = await availablePort();
    listenerChild = await startListenerChild(wildcardPort, "0.0.0.0");
    await assert.rejects(
      () => killPortOwner(listenerChild.pid, wildcardPort, "192.0.2.1"),
      error => error?.statusCode === 409 && /(no longer the owner|占用状态|owner)/i.test(error.message)
    );
    assert.equal(childStopped(listenerChild), false, "A non-local requested address must not match a wildcard listener");
    await stopChild(listenerChild);
    listenerChild = null;

    const ipv6Port = process.platform === "win32" ? null : await availableIpv6Port();
    if (process.platform === "win32") {
      console.log("IPv6 wildcard owner check skipped: Unix lsof listener detection is not used on Windows");
    } else if (ipv6Port === null) {
      console.log("IPv6 wildcard owner check skipped: IPv6 is unavailable on this system");
    } else {
      listenerChild = await startListenerChild(ipv6Port, "::");
      const ipv6Diagnosis = await diagnosePortUsage("::1", ipv6Port);
      const ipv6Owner = ipv6Diagnosis.processes.find(item => Number(item.pid) === listenerChild.pid);
      assert.equal(ipv6Diagnosis.occupied, true, "An IPv6 wildcard listener should occupy the IPv6 loopback port");
      assert.equal(Object.hasOwn(ipv6Diagnosis, "message"), false, "IPv6 diagnosis should not include fixed-language copy");
      assert.ok(ipv6Owner, "The IPv6 wildcard listener should resolve to the child owner");
      assert.ok(
        ipv6Owner.listeners.some(item => item.address === "::" && item.family === 6 && item.port === ipv6Port),
        "Owner evidence should retain the IPv6 wildcard address, family, and port"
      );
      await stopChild(listenerChild);
      listenerChild = null;
    }

    const listenerPort = await availablePort();
    listenerChild = await startListenerChild(listenerPort);
    const diagnosis = await diagnosePortUsage("127.0.0.1", listenerPort);
    const listenerOwner = diagnosis.processes.find(item => Number(item.pid) === listenerChild.pid);
    assert.ok(diagnosis.occupied, "The listener port should be occupied");
    assert.equal(Object.hasOwn(diagnosis, "message"), false, "Occupied-port diagnosis should remain language-neutral");
    assert.ok(listenerOwner, "The exact listener address should resolve to the child owner");
    assert.ok(listenerOwner.listeners.some(item => item.address === "127.0.0.1"), "Owner evidence should retain the listener address");

    await assert.rejects(
      () => killPortOwner(listenerChild.pid, listenerPort, "192.0.2.1"),
      error => error?.statusCode === 409 && /(no longer the owner|占用状态|owner)/i.test(error.message)
    );
    assert.equal(childStopped(listenerChild), false, "A PID listening on another address must not be terminated");

    const killed = await killPortOwner(listenerChild.pid, listenerPort, "127.0.0.1");
    assert.equal(killed.ok, true);
    await waitForChildStop(listenerChild);
    assert.equal(childStopped(listenerChild), true, "The exact address and port owner should be terminated");
    listenerChild = null;

    const frontend = fs.readFileSync(path.join(__dirname, "..", "public", "app-forwards.js"), "utf8");
    const callIndex = frontend.indexOf('api("/api/ports/kill"');
    assert.ok(callIndex >= 0, "The frontend should call the protected port-kill API");
    const call = frontend.slice(callIndex, callIndex + 260);
    assert.match(call, /pid\s*:\s*p\.pid/);
    assert.match(call, /host\s*:\s*diagnosis\.host/);
    assert.match(call, /port\s*:\s*diagnosis\.port/);
    assert.match(frontend, /function forwardPortDiagnosisMessage\(diagnosis=\{\}\)/);
    assert.match(frontend, /connections:forwards\.diagnosis_port_available/);
    assert.match(frontend, /connections:forwards\.diagnosis_port_occupied/);
    assert.doesNotMatch(frontend, /\b(?:result|diagnosis|after)\.message\b/);

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
