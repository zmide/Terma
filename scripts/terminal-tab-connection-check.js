"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const terminalSource = fs.readFileSync(path.join(root, "public", "app-terminal.js"), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source block: ${startMarker}`);
  return source.slice(start, end);
}

const decisionSource = sourceBetween(
  terminalSource,
  "function terminalSessionNeedsAutomaticConnection(",
  "\nfunction restoreQuickTerminalTab("
);
const context = vm.createContext({
  Boolean,
  Number,
  WebSocket:{CONNECTING:0, OPEN:1}
});
vm.runInContext(`${decisionSource}\nthis.needsAutomaticConnection = terminalSessionNeedsAutomaticConnection;\nthis.connectionStatus = terminalSessionConnectionStatus;`, context);

assert.equal(context.needsAutomaticConnection({socket:null, connectionAttempt:0}), true, "a newly created terminal session should connect once");
assert.equal(context.needsAutomaticConnection({socket:null, connectionAttempt:1, connectionPending:true}), false, "returning to a tab during SSH preflight must not start a second connection");
assert.equal(context.needsAutomaticConnection({socket:null, connectionAttempt:1, connectionPending:false}), false, "returning to a failed terminal tab must wait for an explicit reconnect");
assert.equal(context.needsAutomaticConnection({socket:{readyState:1}, connectionAttempt:1}), false, "an existing WebSocket must always be reused");

assert.equal(context.connectionStatus({connectionPending:true, socket:null, connected:false}), "connecting", "SSH preflight should remain visibly connecting after a tab remount");
assert.equal(context.connectionStatus({connectionPending:false, socket:{readyState:0}, connected:false}), "connecting", "a WebSocket handshake should remain visibly connecting after a tab remount");
assert.equal(context.connectionStatus({connectionPending:false, socket:{readyState:1}, connected:false}), "connected", "an open WebSocket should be treated as connected even before the cached flag refreshes");
assert.equal(context.connectionStatus({connectionPending:false, socket:null, connected:false}), "disconnected", "a settled failed attempt should remain disconnected");

const attachSource = sourceBetween(terminalSource, "async function attachTerminal(", "\nfunction enableTerminalFontWheel(");
assert.match(attachSource, /terminalSessionNeedsAutomaticConnection\(session\)/, "terminal remounts must use the one-shot automatic connection decision");
assert.match(attachSource, /terminalSessionConnectionStatus\(session\)/, "terminal remounts must preserve preflight and WebSocket status");

const connectSource = sourceBetween(terminalSource, "async function connectTerminal(", "\nfunction reconnectTerminal(");
assert.match(connectSource, /session\.connectionPending = true;/, "SSH preflight must expose an in-progress state before awaiting the backend");
assert.match(connectSource, /session\.connectionAttempt === attempt[\s\S]*?session\.connectionPending = false;/, "only the current connection attempt may clear the preflight state");
assert.match(terminalSource, /session\?\.connected \|\| session\?\.connectionPending \|\| session\?\.socket\?\.readyState === WebSocket\.CONNECTING/, "the connection toggle must be able to cancel an in-progress preflight");

console.log("PASS terminal tabs reuse the original SSH attempt and never reconnect merely because the tab became active");
