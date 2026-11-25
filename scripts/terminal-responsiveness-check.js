"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { readFrontendDomain } = require("./frontend-source");
const { loadFrontendService } = require("./frontend-service-test-helper");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source block: ${startMarker}`);
  return source.slice(start, end);
}

function checkViewportAnchors() {
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
  const {createTerminalViewportService}=loadFrontendService('frontend/src/features/terminal/terminal-viewport-service.ts',sandbox);
  const service=createTerminalViewportService({
    sessions:()=>sandbox.terminalSessions.values(),capture:sandbox.captureTerminalViewport,
    fitPreservingViewport:sandbox.fitTerminalPreservingViewport,error:error=>{throw error;}
  });
  sandbox.__api={scheduleTerminalFit:service.schedule,fitVisibleTerminals:service.fit};

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
  const timers = [], writes = [];
  const {createTerminalOutputFlowService} = loadFrontendService(
    'frontend/src/features/terminal/terminal-output-flow-service.ts',
    {setTimeout(callback){timers.push(callback);return timers.length;}}
  );
  const service = createTerminalOutputFlowService();
  const term = {write(value, callback){writes.push(value);callback();}};

  const login = {term};
  service.queue(login, 'Last login: Wed Aug 19\r\n');
  service.queue(login, 'sh-4.1$ ');
  timers.shift()();
  assert.equal(
    writes.pop(),
    "Last login: Wed Aug 19\r\nsh-4.1$ ",
    "small adjacent login chunks should reach xterm in one write"
  );
  assert.equal(login.pendingTerminalOutput.length, 0);

  const binary = {term};
  service.queue(binary, new Uint8Array(32766).fill(1));
  service.queue(binary, new Uint8Array([2, 3, 5]));
  timers.shift()();
  const frame = writes.pop();
  assert.equal(frame.length, 32768, 'binary output uses the normal frame budget');
  assert.deepEqual([...frame.slice(-3)], [1,2,3], "adjacent binary chunks coalesce up to the frame budget");
  assert.deepEqual([...binary.pendingTerminalOutput[0]], [5], "binary overflow must remain queued for the next frame");
  timers.shift()();
  assert.deepEqual([...writes.pop()], [5]);
}

function checkLoginProbeDeferral() {
  const terminal = readFrontendDomain(root, "terminal");
  const directory = read("frontend/src/features/terminal/terminal-directory-service.ts");
  const directoryWorkspace = read("frontend/src/features/terminal/terminal-directory-workspace.ts");
  const transport = read("frontend/src/features/terminal/terminal-transport-service.ts");
  const connect = read("frontend/src/features/terminal/terminal-connection-runtime.ts");
  assert.doesNotMatch(connect, /void initializeTerminalDirectory\(session, c, key\)/, "SSH open must not start an SFTP directory probe immediately");
  assert.match(connect, /termaTerminalConnection!\.connect/, "SSH connects through the typed connection owner");
  const connection = read("frontend/src/features/terminal/terminal-connection-service.ts");
  assert.match(connection, /port\.bindTransport\(connection, key, session, socket, attempt\)/, "connection preparation binds through the existing transport");
  assert.match(transport, /port\.scheduleDirectory\(session, connection, key, 1200\)/, "SSH open should defer the first directory probe");
  assert.match(transport, /port\.queueOutput\(session, terminalOutput\);[\s\S]{0,180}port\.scheduleDirectory\(session, connection, key\)/, "terminal output should postpone the probe until login output becomes idle");
  assert.match(directory, /session\.directoryInitializationPending/, "terminal directory initialization must deduplicate concurrent requests");
  assert.match(directory, /session\.socket !== socket[\s\S]{0,160}!session\.connected/, "a deferred probe must be discarded after reconnect or disconnect");
  assert.match(directoryWorkspace, /\/sftp\/resolve-directory\?/, "terminal directory tracking must use the lightweight resolver");
  assert.doesNotMatch(
    directoryWorkspace,
    /page_size|refresh|\/sftp\?/,
    "terminal startup must not enumerate the remote home directory"
  );
}

checkViewportAnchors();
checkOutputBatching();
checkLoginProbeDeferral();
console.log("PASS terminal split resizing preserves the viewport and SSH login output stays responsive");
