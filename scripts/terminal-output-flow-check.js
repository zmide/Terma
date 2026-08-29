"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function checkBrowserWatermarks() {
  const timers = [];
  const messages = [];
  const sandbox = {
    Uint8Array,
    WebSocket:{OPEN:1},
    document:{hidden:false},
    Number,
    Math,
    setTimeout:(callback, delay) => { timers.push({callback, delay}); return timers.length; },
    clearTimeout:() => {},
    cancelAnimationFrame:() => {},
    terminalSessions:new Map()
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${read("public/app-terminal-output.js")}\n;globalThis.__api={queueTerminalOutput,takeTerminalOutputChunk};`, sandbox, {filename:"public/app-terminal-output.js", timeout:5000});
  const session = {
    term:{},
    socket:{readyState:1, send(value){ messages.push(JSON.parse(value)); }}
  };
  sandbox.__api.queueTerminalOutput(session, "x".repeat(128 * 1024));
  assert.equal(timers.at(-1)?.delay, 8, "visible terminals at the live bottom must drain promptly");
  assert.equal(session.pendingTerminalOutputBytes, 128 * 1024, "browser queue must count pending output bytes");
  assert.deepEqual(messages, [{type:"terminal-output-flow", paused:true}], "high watermark must pause the remote output source");
  sandbox.__api.takeTerminalOutputChunk(session, 80 * 1024);
  assert.equal(messages.length, 1, "queue above low watermark must stay paused");
  sandbox.__api.takeTerminalOutputChunk(session, 48 * 1024);
  assert.deepEqual(messages.at(-1), {type:"terminal-output-flow", paused:false}, "low watermark must resume the remote output source");

  const scrolledSession = {
    term:{buffer:{active:{viewportY:20, baseY:80}}, hasSelection:() => false},
    socket:{readyState:1, send() {}}
  };
  sandbox.__api.queueTerminalOutput(scrolledSession, "history");
  assert.equal(timers.at(-1)?.delay, 24, "terminals viewing scrollback must reduce parse and repaint frequency");

  const selectedSession = {
    term:{buffer:{active:{viewportY:80, baseY:80}}, hasSelection:() => true},
    socket:{readyState:1, send() {}}
  };
  sandbox.__api.queueTerminalOutput(selectedSession, "selection");
  assert.equal(timers.at(-1)?.delay, 24, "active selections must not be repainted at the full live-output rate");

  sandbox.document.hidden = true;
  const hiddenSession = {
    term:{buffer:{active:{viewportY:80, baseY:80}}, hasSelection:() => false},
    socket:{readyState:1, send() {}}
  };
  sandbox.__api.queueTerminalOutput(hiddenSession, "background");
  assert.equal(timers.at(-1)?.delay, 48, "hidden windows must use the low-frequency fallback drain");
}

function checkServerFlowContract() {
  const source = read("src/terminal.ts");
  assert.match(source, /terminal-output-flow/, "server must recognize the output-flow control message");
  assert.match(source, /source\.pause\?\.\(\)/, "server must pause terminal output sources");
  assert.match(source, /source\.resume\?\.\(\)/, "server must resume terminal output sources");
  assert.match(source, /outputSocketBackpressured/, "server must react to WebSocket backpressure");
  assert.match(read("src/websocket.ts"), /socket\.write\(Buffer\.concat\(\[header, payload\]\).*!== false/s, "WebSocket writes must report backpressure");
  const terminalUi = readFrontendDomain(root, "terminal");
  assert.match(terminalUi, /convertEol:false/, "PTY output must retain remote carriage-return progress updates");
  assert.match(read("public/app-terminal-core.js"), /attachCustomKeyEventHandler[\s\S]*sendTerminalData\(key, "\\x03"/, "Ctrl+C without a selection must send an interrupt byte directly");
  assert.match(read("public/app-remote-terminal.js"), /convertEol:false/, "other terminal views must use the same remote newline behavior");
  assert.match(read("src/runtime-settings.ts"), /scrollback_lines:\s*30000/, "terminal scrollback must have a bounded default");
  assert.match(terminalUi, /scrollback:Number\(currentTerminalGlobalSettings\(\)\.scrollback_lines\)/, "new terminals must apply the configured scrollback limit");
  assert.match(read("public/app-terminal-settings.js"), /session\.term\.options\.scrollback/, "open terminals must apply updated scrollback settings");
  assert.match(terminalUi, /activeSession\.terminalEncoding = settings\.terminal_encoding[\s\S]*terminalEncodingLabel\(settings, sessionKey\)/, "encoding labels must read the newly applied runtime encoding");
  const terminalSettingsUi = read("public/app-terminal-settings.js");
  assert.match(terminalSettingsUi, /const terminalPreferenceQueues = new Map\(\)/, "terminal preference saves must serialize per connection");
  const delayedSave = terminalSettingsUi.match(/function scheduleTerminalPreferencesSave\(connection\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(delayedSave, /enqueueTerminalPreferenceOperation/, "delayed font-size saves must share the per-connection preference queue");
  assert.doesNotMatch(delayedSave, /terminal_encoding\s*:/, "delayed font-size saves must not overwrite a newer terminal encoding");
  assert.match(terminalUi, /const current = currentConnection\(connectionId\) \|\| connection;[\s\S]*if \(current !== connection\) Object\.assign\(current, settings\)/, "encoding saves must update the current connection object after background refresh replacement");
  assert.match(read("public/app-utils.js"), /item\.dataset\.toastReplaceKey === replaceKey/, "keyed notifications must update in place instead of leaving a stale encoding notice");
}

checkBrowserWatermarks();
checkServerFlowContract();
console.log("PASS terminal output high/low watermarks pause and resume remote sources");
