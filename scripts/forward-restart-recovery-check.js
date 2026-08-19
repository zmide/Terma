"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const ssh = read("src/ssh.ts");
const ssh2 = read("src/ssh2-client.ts");

async function main() {
  assert.match(ssh, /await stopForwardRuntime\(id, \{ preserveRestoreState: true \}\)/, "starting a forward must wait for its previous listener to close");
  assert.match(ssh, /const forwardOperations = new Map\(\)/, "forward start/stop operations must be serialized per forward");
  assert.match(ssh, /async function stopConnectionForwards[\s\S]*await Promise\.all\(forwards\.map\(\(forward\) => stopForward\(forward\.id, options\)\)\)/, "connection-wide stop must await every listener close");
  assert.match(ssh, /for \(const id of ssh2Forwards\.keys\(\)\)[\s\S]*stopConnectionForwards\(connectionId, options\)/, "shutdown must close in-memory listeners even after their database status changed");
  assert.match(ssh2, /function closeForwardListener\([\s\S]*listener\.close\(finish\)/, "local listeners must expose an awaitable close operation");
  assert.match(ssh2, /const closeTask = null|let closeTask = null|let closeTask:/, "managed forward close must be idempotent");
  assert.doesNotMatch(ssh, /stopPid\(Number\(owner\.pid\)\)[\s\S]{0,200}Terma/i, "recovery must not kill processes merely because they are Terma");

  const { startSocksForward } = require("../dist/ssh2-client");
  const fakeClient = {forwardOut(){ throw new Error("unexpected test connection"); }};
  const first = await startSocksForward(fakeClient, {bind_host:"127.0.0.1", bind_port:0}, () => {});
  const port = first.address().port;
  await first.close();
  const replacement = await startSocksForward(fakeClient, {bind_host:"127.0.0.1", bind_port:port}, () => {});
  assert.equal(replacement.address().port, port, "the same port must be reusable immediately after awaited close");
  await replacement.close();

  console.log("PASS forward restart waits for listener release and serializes per-forward operations");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
