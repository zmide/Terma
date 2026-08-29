"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source block: ${startMarker}`);
  return source.slice(start, end);
}

function checkViewportAnchors() {
  const source = sourceBetween(
    read("public/app-utils.js"),
    "function captureVisibleTerminalViewports(",
    "\nfunction chooseModal("
  );
  const timers = new Map();
  const fitCalls = [];
  let nextTimer = 0;
  const boxRect = {width:960, height:640};
  const box = {
    isConnected:true,
    style:{},
    getBoundingClientRect:() => ({...boxRect})
  };
  const session = {
    term:{
      element:{style:{}, closest:selector => selector === ".terminal-box" ? box : null},
      rows:24
    }
  };
  const originalAnchor = {viewportY:240, atBottom:true};
  const sandbox = {
    Map,
    Number,
    Math,
    terminalSessions:new Map([["terminal-1", session]]),
    captureTerminalViewport:() => ({viewportY:0, atBottom:false}),
    fitTerminalPreservingViewport:(target, anchor) => fitCalls.push({target, anchor:{...anchor}}),
    setTimeout:(callback, delay) => {
      nextTimer += 1;
      timers.set(delay, {id:nextTimer, callback});
      return nextTimer;
    },
    clearTimeout:() => {},
    window:{}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${source}\n;globalThis.__api = {scheduleTerminalFit, fitVisibleTerminals};`, sandbox, {
    filename:"public/app-utils.js",
    timeout:5000
  });

  const anchors = new Map([[session, originalAnchor]]);
  sandbox.__api.scheduleTerminalFit({anchors});
  assert.equal(fitCalls.length, 1, "the first layout pass should fit the visible terminal once");
  assert.deepEqual(fitCalls[0].anchor, originalAnchor, "the pre-layout viewport anchor must be used by the first fit");

  boxRect.height = 420;
  timers.get(80).callback();
  assert.equal(fitCalls.length, 2, "a later layout size change should trigger one follow-up fit");
  assert.deepEqual(fitCalls[1].anchor, originalAnchor, "follow-up fits must retain the pre-layout viewport anchor");

  timers.get(240).callback();
  assert.equal(fitCalls.length, 2, "unchanged terminal dimensions must not trigger another expensive fit");
}

function checkOutputBatching() {
  const source = sourceBetween(
    read("public/app-terminal-output.js"),
    "const TERMINAL_OUTPUT_FRAME_BUDGET",
    "\nfunction drainTerminalOutput("
  );
  const sandbox = {Uint8Array, Number, setTimeout:() => 1};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${source}\n;globalThis.__take = takeTerminalOutputChunk;`, sandbox, {
    filename:"public/app-terminal-output.js",
    timeout:5000
  });

  const login = {pendingTerminalOutput:["Last login: Wed Aug 19\r\n", "sh-4.1$ "]};
  assert.equal(
    sandbox.__take(login, 32 * 1024),
    "Last login: Wed Aug 19\r\nsh-4.1$ ",
    "small adjacent login chunks should reach xterm in one write"
  );
  assert.equal(login.pendingTerminalOutput.length, 0);

  const binary = {pendingTerminalOutput:[new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])]};
  assert.deepEqual([...sandbox.__take(binary, 4)], [1, 2, 3, 4], "binary output should coalesce only up to the frame budget");
  assert.deepEqual([...binary.pendingTerminalOutput[0]], [5], "binary overflow must remain queued for the next frame");
}

function checkLoginProbeDeferral() {
  const terminal = readFrontendDomain(root, "terminal");
  const core = read("public/app-terminal-core.js");
  const connect = sourceBetween(terminal, "async function connectTerminalAttempt(", "\nfunction reconnectTerminal(");
  assert.doesNotMatch(connect, /void initializeTerminalDirectory\(session, c, key\)/, "SSH open must not start an SFTP directory probe immediately");
  assert.match(connect, /scheduleTerminalDirectoryInitialization\(session, c, key, 1200\)/, "SSH open should defer the first directory probe");
  assert.match(connect, /queueTerminalOutput\(session, terminalOutput\);[\s\S]{0,180}scheduleTerminalDirectoryInitialization\(session, c, key\)/, "terminal output should postpone the probe until login output becomes idle");
  assert.match(core, /session\.directoryInitializationPending/, "terminal directory initialization must deduplicate concurrent requests");
  assert.match(core, /session\.socket !== socket[\s\S]{0,160}!session\.connected/, "a deferred probe must be discarded after reconnect or disconnect");
  assert.match(core, /\/sftp\/resolve-directory\?/, "terminal directory tracking must use the lightweight resolver");
  assert.doesNotMatch(
    sourceBetween(core, "async function probeTerminalDirectory(", "\nasync function initializeTerminalDirectory("),
    /page_size|refresh|\/sftp\?/,
    "terminal startup must not enumerate the remote home directory"
  );
}

checkViewportAnchors();
checkOutputBatching();
checkLoginProbeDeferral();
console.log("PASS terminal split resizing preserves the viewport and SSH login output stays responsive");
