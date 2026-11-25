"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {loadFrontendService} = require("./frontend-service-test-helper");

const root = path.resolve(__dirname, "..");
const runtimeSource = fs.readFileSync(path.join(root, "public", "vendor", "zmodem.js"), "utf8");
const terminalSource = fs.readFileSync(path.join(root, "src", "terminal.ts"), "utf8");

assert.doesNotMatch(runtimeSource, /console\.log\(["']consuming/);
assert.doesNotMatch(runtimeSource, /console\.log\(\s*this\.type,\s*["']SENDING HEADER/);

const parsed = loadFrontendService("frontend/src/features/terminal/terminal-zmodem-service.ts", {
  window:{termaTerminalZmodemPort:{}}, document:{}
});
assert.equal(parsed.commandRole("sz log.log"), "receive");
assert.equal(parsed.commandRole("sudo /usr/bin/lsz -- log.log"), "receive");
assert.equal(parsed.commandRole("command rz"), "send");
assert.equal(parsed.commandRole("echo sz log.log"), "");
assert.equal(parsed.commandInfo("sz").canStart, false);
assert.equal(parsed.commandInfo("rz log.log").canStart, false);
assert.equal(parsed.commandInfo("rz").canStart, true);
assert.equal(parsed.rzNeedsOverwrite(parsed.commandInfo("rz")), true);
assert.equal(parsed.rzNeedsOverwrite(parsed.commandInfo("rz -y")), false);
assert.equal(parsed.safeFilename("../../folder/remote.txt"), "remote.txt");
assert.equal(parsed.safeFilename("../\x00.."), "download.bin");
assert.equal(parsed.formatBytes(1024 * 1024), "1.0 MB");

for (const token of ["terminal-binary-mode", "setSessionBinaryMode", "!session.binaryMode", "if (!session.binaryMode) appendTerminalLog"]) {
  assert.equal(terminalSource.includes(token), true, `终端后端缺少 ZMODEM 二进制边界：${token}`);
}
const runtimeSourceTs = fs.readFileSync(path.join(root,"frontend/src/features/terminal/terminal-zmodem-runtime-service.ts"), "utf8");
const transferSourceTs = fs.readFileSync(path.join(root,"frontend/src/features/terminal/terminal-zmodem-transfer-service.ts"), "utf8");
const classicSource = fs.readFileSync(path.join(root,"frontend/src/features/terminal/terminal-transport-workspace.ts"), "utf8");
const workspaceSource = fs.readFileSync(path.join(root,"frontend/src/features/terminal/terminal-zmodem-workspace.ts"), "utf8");
for (const token of ["terminalZmodemPrepareInput", "terminalZmodemTakePreparedInput", "terminalZmodemRzNeedsOverwrite", "consumeTerminalZmodemOutput", "terminalZmodemCancel", "terminalZmodemDetected"]) {
  assert.equal(runtimeSourceTs.includes(token), true, `typed runtime must retain ${token}`);
}
for (const token of ["terminalZmodemPrepareSendFiles", "uploadPlan", "conflict", "terminalZmodemSentFileSummary"]) {
  assert.equal(transferSourceTs.includes(token), true, `typed transfer owner must retain ${token}`);
}
assert.doesNotMatch(classicSource, /function (?:terminalZmodem|ensureTerminalZmodem|initializeTerminalZmodem|consumeTerminalZmodem|closeTerminalZmodem|syncTerminalZmodem)/);
assert.doesNotMatch(classicSource, /termaTerminalZmodemPort/);
for (const token of ['termaTerminalZmodem.prepareInput', 'termaTerminalZmodem.takePreparedInput', 'termaTerminalZmodem.consume']) {
  assert.equal(classicSource.includes(token), true, `terminal transport must call the typed ${token} owner`);
}
assert.match(workspaceSource, /installTerminalZmodemService\(\{/);
assert.match(workspaceSource, /terminalSessions\.get\(session\.key\) === session/);

assert.match(fs.readFileSync(path.join(root,"frontend/src/features/terminal/terminal-zmodem-runtime-service.ts"), "utf8"), /generation/);
assert.match(fs.readFileSync(path.join(root,"frontend/src/features/terminal/terminal-zmodem-transfer-service.ts"), "utf8"), /uploadPlan/);
const sandbox = {window:{}, console:{log(){}, debug(){}, warn(){}, error(){}}, setTimeout, clearTimeout, Uint8Array, ArrayBuffer};
vm.createContext(sandbox);
vm.runInContext(runtimeSource, sandbox, {filename:"zmodem.js"});
const sentry = new sandbox.window.Zmodem.Sentry({to_terminal(){},sender(){},on_detect(){},on_retract(){}});
const zrqinit = Buffer.from("2a2a184230303030303030303030303030300d8a11", "hex");
sentry.consume(zrqinit.buffer.slice(zrqinit.byteOffset, zrqinit.byteOffset + zrqinit.byteLength));
console.log("ZMODEM utility and vendor runtime checks passed");
