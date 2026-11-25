"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readFrontendDomain } = require("./frontend-source");
const { loadFrontendService } = require("./frontend-service-test-helper");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function installOutputOwner(sandbox) {
  sandbox.window = {};
  sandbox.tr ||= key => key;
  sandbox.globalThis = sandbox;
  const cache = new Map();
  const dock = loadFrontendService('frontend/src/features/workspace/workspace-dock-state.ts', sandbox, cache);
  loadFrontendService('frontend/src/features/workspace/workspace-layout-service.ts', sandbox, cache).installWorkspaceLayoutService();
  const pane = sandbox.workspaceFindPaneForTab?.();
  dock.workspaceDockState.focusedPaneId = sandbox.focusedPaneId || '';
  if (pane) dock.workspaceDockState.workspaceLayout = {type:'pane', ...pane, tabs:[pane.activeTabKey]};
  const {terminalOutputSessionIsFocused} = loadFrontendService('frontend/src/features/terminal/terminal-session-lifecycle.ts', sandbox, cache);
  const { createTerminalOutputFlowService } = loadFrontendService(
    'frontend/src/features/terminal/terminal-output-flow-service.ts', sandbox
  );
  sandbox.window.termaTerminalOutputFlow = createTerminalOutputFlowService({
    openState:1,
    isFocused:terminalOutputSessionIsFocused,
    captureAiBlock:sandbox.captureTerminalAiBlockOutput,
    refreshCommandBuffer:sandbox.refreshTerminalCommandBufferFromScreen,
    finalizePendingCommand:sandbox.finalizePendingTerminalCommand,
    finalizeAiBlock:sandbox.finalizeTerminalAiBlockFromScreen,
    fit:sandbox.scheduleTerminalFit
  });
}

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
  installOutputOwner(sandbox);
  const writes = [];
  const session = {
    term:{write(value, callback){ writes.push(value); callback(); }},
    socket:{readyState:1, send(value){ messages.push(JSON.parse(value)); }}
  };
  sandbox.window.termaTerminalOutputFlow.queue(session, "x".repeat(128 * 1024));
  assert.equal(timers.at(-1)?.delay, 8, "visible terminals at the live bottom must drain promptly");
  assert.equal(session.pendingTerminalOutputBytes, 128 * 1024, "browser queue must count pending output bytes");
  assert.deepEqual(messages, [{type:"terminal-output-flow", paused:true}], "high watermark must pause the remote output source");
  timers.shift().callback();
  timers.shift().callback();
  assert.equal(messages.length, 1, "queue above low watermark must stay paused");
  timers.shift().callback();
  assert.deepEqual(messages.at(-1), {type:"terminal-output-flow", paused:false}, "low watermark must resume the remote output source");
  assert.equal(session.pendingTerminalOutputBytes, 32 * 1024);
  timers.shift().callback();
  assert.equal(session.pendingTerminalOutputBytes, 0);
  assert.deepEqual(writes.map(value => value.length), [32768,32768,32768,32768], "normal drain respects the frame budget");

  const scrolledSession = {
    term:{buffer:{active:{viewportY:20, baseY:80}}, hasSelection:() => false},
    socket:{readyState:1, send() {}}
  };
  sandbox.window.termaTerminalOutputFlow.queue(scrolledSession, "history");
  assert.equal(timers.at(-1)?.delay, 24, "terminals viewing scrollback must reduce parse and repaint frequency");

  const selectedSession = {
    term:{buffer:{active:{viewportY:80, baseY:80}}, hasSelection:() => true},
    socket:{readyState:1, send() {}}
  };
  sandbox.window.termaTerminalOutputFlow.queue(selectedSession, "selection");
  assert.equal(timers.at(-1)?.delay, 24, "active selections must not be repainted at the full live-output rate");

  const tuiSession = {
    term:{buffer:{active:{type:"alternate", viewportY:0, baseY:0}}, hasSelection:() => false},
    socket:{readyState:1, send() {}}
  };
  sandbox.window.termaTerminalOutputFlow.queue(tuiSession, "tui-redraw");
  assert.equal(timers.at(-1)?.delay, 32, "alternate-screen TUIs must batch redraws to keep the shared renderer responsive");

  const inactiveSession = {
    term:{element:{isConnected:false}, buffer:{active:{type:"normal", viewportY:0, baseY:0}}, hasSelection:() => false},
    socket:{readyState:1, send() {}}
  };
  sandbox.window.termaTerminalOutputFlow.queue(inactiveSession, "inactive-tab");
  assert.equal(timers.at(-1)?.delay, 96, "detached terminal tabs must drain at a lower frequency");

  sandbox.document.hidden = true;
  const hiddenSession = {
    term:{buffer:{active:{viewportY:80, baseY:80}}, hasSelection:() => false},
    socket:{readyState:1, send() {}}
  };
  sandbox.window.termaTerminalOutputFlow.queue(hiddenSession, "background");
  assert.equal(timers.at(-1)?.delay, 96, "hidden windows must use the low-frequency fallback drain");
}

function checkScreenInspectionWaitsForIdle() {
  const timers = [];
  const inspections = [];
  const sandbox = {
    Uint8Array,
    WebSocket:{OPEN:1},
    document:{hidden:false},
    Number,
    Math,
    setTimeout:(callback, delay) => { timers.push({callback, delay}); return timers.length; },
    clearTimeout:() => {},
    cancelAnimationFrame:() => {},
    terminalSessions:new Map(),
    refreshTerminalCommandBufferFromScreen:() => inspections.push("command-buffer"),
    finalizePendingTerminalCommand:() => inspections.push("pending-command"),
    finalizeTerminalAiBlockFromScreen:() => inspections.push("ai-block")
  };
  installOutputOwner(sandbox);
  const writes = [];
  const session = {
    term:{
      write(value, callback){ writes.push(String(value)); callback(); },
      buffer:{active:{type:"normal", viewportY:0, baseY:0}}
    },
    socket:{readyState:1, send() {}}
  };
  sandbox.window.termaTerminalOutputFlow.queue(session, "x".repeat(40 * 1024));
  timers.shift().callback();
  assert.equal(inspections.length, 0, "screen inspection must not analyze a partially drained terminal frame");
  assert.equal(timers.length, 1, "remaining output must schedule another drain");
  timers.shift().callback();
  assert.equal(writes.join("").length, 40 * 1024, "all queued terminal output must still be written");
  assert.deepEqual(inspections, ["command-buffer", "pending-command", "ai-block"], "screen inspection should run once after the output batch is idle");
}

function checkAnsiRedrawAndSplitThrottling() {
  const timers = [];
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
  installOutputOwner(sandbox);
  const redrawSession = {
    key:"game",
    term:{buffer:{active:{type:"normal", viewportY:0, baseY:0}}, write(_value, callback){ callback(); }},
    socket:{readyState:1, send() {}}
  };
  for (let index = 0; index < 8; index += 1) {
    sandbox.window.termaTerminalOutputFlow.queue(redrawSession, "\x1b[1;1H");
    timers.shift().callback();
  }
  sandbox.window.termaTerminalOutputFlow.queue(redrawSession, "\x1b[1;1H");
  assert.equal(timers.at(-1)?.delay, 32, "frequent ANSI cursor redraws must throttle a normal-buffer game terminal");

  const splitTimers = [];
  const splitSandbox = {
    ...sandbox,
    setTimeout:(callback, delay) => { splitTimers.push({callback, delay}); return splitTimers.length; },
    workspaceFindPaneForTab:() => ({id:"pane-game", activeTabKey:"game"}),
    focusedPaneId:"pane-other"
  };
  installOutputOwner(splitSandbox);
  const splitSession = {
    key:"game",
    term:{buffer:{active:{type:"normal", viewportY:0, baseY:0}}, write(_value, callback){ callback(); }},
    socket:{readyState:1, send() {}}
  };
  splitSandbox.window.termaTerminalOutputFlow.queue(splitSession, "ordinary output");
  assert.equal(splitTimers.at(-1)?.delay, 96, "a terminal in an unfocused split pane must use the background drain rate");
}

function checkCancellationAndWindowResume() {
  const timers = [], cancelled = [], inspections = [], refreshed = [];
  let fitCount = 0, finishWrite;
  const sandbox = {
    Uint8Array, document:{hidden:false}, terminalSessions:new Map(),
    setTimeout(callback){timers.push(callback);return timers.length;},
    clearTimeout:id => cancelled.push(id), cancelAnimationFrame:id => cancelled.push(id),
    refreshTerminalCommandBufferFromScreen:() => inspections.push('command'),
    scheduleTerminalFit:() => fitCount++
  };
  installOutputOwner(sandbox);
  const writing = {term:{rows:24,write(_value,callback){finishWrite=callback;},refresh:() => refreshed.push('writing')}};
  sandbox.window.termaTerminalOutputFlow.queue(writing, 'stale');
  timers.shift()();
  sandbox.window.termaTerminalOutputFlow.queue(writing, 'cancelled queue');
  sandbox.window.termaTerminalOutputFlow.cancel(writing);
  finishWrite();
  assert.equal(writing.terminalOutputWriting, false);
  assert.equal(writing.pendingTerminalOutputBytes, 0);
  assert.deepEqual(Array.from(writing.pendingTerminalOutput), []);
  assert.deepEqual(inspections, [], 'late xterm callback after cancellation cannot inspect the replaced screen');
  assert.equal(cancelled.length, 1);

  const pending = {term:{rows:24,write(_value,callback){callback();},refresh:() => refreshed.push('pending')}};
  const idle = {term:{rows:24,refresh:() => refreshed.push('idle')}};
  sandbox.terminalSessions.set('pending', pending);
  sandbox.terminalSessions.set('idle', idle);
  sandbox.terminalSessions.set('writing', writing);
  sandbox.window.termaTerminalOutputFlow.queue(pending, 'resume');
  sandbox.window.termaTerminalOutputFlow.resumeSessions(sandbox.terminalSessions.values());
  assert.equal(pending.pendingTerminalOutputBytes, 0);
  assert.deepEqual(refreshed, ['pending','idle','writing'], 'window resume refreshes every terminal including idle screens');
  assert.equal(fitCount, 1, 'window resume fits the workspace once');
  assert.deepEqual(inspections, ['command']);
  const inFlight = {terminalOutputWriting:true, pendingTerminalOutput:['queued'], term:{
    rows:24, write(){throw Error('cannot overlap an in-flight write');}, refresh:()=>refreshed.push('in-flight')
  }};
  const broken = {term:{refresh(){throw Error('disposed engine');}}};
  sandbox.terminalSessions.set('in-flight', inFlight);
  sandbox.terminalSessions.set('broken', broken);
  sandbox.window.termaTerminalOutputFlow.resumeSessions(sandbox.terminalSessions.values());
  assert.equal(fitCount, 2, 'one disposed engine cannot prevent the workspace fit');
  assert.equal(inFlight.pendingTerminalOutput.length, 1, 'resume preserves an in-flight queue');
  assert.equal(refreshed.at(-1), 'in-flight');
  sandbox.terminalSessions.clear();
  sandbox.window.termaTerminalOutputFlow.resumeSessions(sandbox.terminalSessions.values());
  assert.equal(fitCount, 3, 'an empty workspace still receives its layout refresh');
}

function checkProductionBindings() {
  assert.match(read('frontend/src/features/terminal/terminal-transport-workspace.ts'), /termaTerminalOutputFlow!\.queue\(owned,data\)/);
  assert.match(read('frontend/src/shared/workspace-bootstrap.ts'), /termaTerminalOutputFlow\?\.resumeSessions\(terminalSessions\.values\(\)\)/);
  assert.match(read('frontend/src/features/terminal/terminal-session-lifecycle.ts'), /termaTerminalOutputFlow\?\.cancel\(/);
}

function checkServerFlowContract() {
  const source = read("src/terminal.ts");
  assert.match(source, /terminal-output-flow/, "server must recognize the output-flow control message");
  assert.match(source, /source\.pause\?\.\(\)/, "server must pause terminal output sources");
  assert.match(source, /source\.resume\?\.\(\)/, "server must resume terminal output sources");
  assert.match(source, /outputSocketBackpressured/, "server must react to WebSocket backpressure");
  assert.match(read("src/websocket.ts"), /socket\.write\(Buffer\.concat\(\[header, payload\]\).*!== false/s, "WebSocket writes must report backpressure");
  const surface = read("frontend/src/features/terminal/terminal-surface-service.ts");
  assert.match(surface, /convertEol:\s*false/, "PTY output must retain remote carriage-return progress updates");
  assert.match(read("frontend/src/features/terminal/terminal-engine-view.ts"), /attachCustomKeyEventHandler[\s\S]*sendTerminalData\(key,'\\x03'/, "Ctrl+C without a selection must send an interrupt byte directly");
  assert.match(read("frontend/src/features/remote/transport-runtime.ts"), /convertEol:\s*false/, "other terminal transport must use the same remote newline behavior");
  assert.match(read("src/runtime-settings.ts"), /DEFAULT_TERMINAL_SETTINGS = defaultTerminalSettings/, "backend terminal defaults must use the shared configuration");
  assert.match(read("src/shared/terminal-settings.ts"), /scrollback_lines:\s*30000/, "terminal scrollback must have a bounded default");
  assert.match(surface, /scrollback:\s*Number\(port\.settings\(\)\.scrollback_lines\)/, "new terminals must apply the configured scrollback limit");
  assert.match(read("frontend/src/features/terminal/terminal-settings-service.ts"), /options\.scrollback = Number\(values\.scrollback_lines\)/, "open terminals must apply updated scrollback settings");
  const preferences = read("frontend/src/features/terminal/terminal-preferences-service.ts");
  assert.match(preferences, /session\.terminalEncoding = settings\.terminal_encoding[\s\S]*port\.refreshToolbar\(key\)/, "toolbar refresh must read the newly applied runtime encoding");
  assert.match(preferences, /const queues = new Map<number, Promise<void>>\(\)/, "terminal preference saves must serialize per connection");
  const delayedSave = preferences.match(/function schedule\([\s\S]*?\n  \}/)?.[0] || "";
  assert.match(delayedSave, /enqueue\(id, async/, "delayed font-size saves must share the per-connection preference queue");
  const displayValues = preferences.match(/function displayValues\([\s\S]*?\n  \}/)?.[0] || "";
  assert.doesNotMatch(displayValues, /terminal_encoding\s*:/, "delayed font-size saves must not overwrite a newer terminal encoding");
  assert.match(preferences, /const current = connection\.quick_connection[\s\S]*if \(current !== connection\) Object\.assign\(current, settings\)/, "encoding saves must update the current connection object after background refresh replacement");
  const notificationToasts = read("frontend/src/features/efficiency/notification-toast-service.ts");
  assert.match(notificationToasts, /item\.replaceKey === replaceKey && !item\.leaving/, "keyed notifications must find the active notice through the shared service");
  assert.match(notificationToasts, /models\.set\(model\.id, model\)/, "keyed notifications must update in place instead of leaving a stale encoding notice");
}

checkBrowserWatermarks();
checkScreenInspectionWaitsForIdle();
checkAnsiRedrawAndSplitThrottling();
checkCancellationAndWindowResume();
checkProductionBindings();
checkServerFlowContract();
console.log("PASS terminal output high/low watermarks pause and resume remote sources");
