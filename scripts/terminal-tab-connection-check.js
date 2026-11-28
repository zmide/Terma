"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const terminalSource = fs.readFileSync(path.join(root,"frontend/src/features/terminal/terminal-page.ts"),"utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source block: ${startMarker}`);
  return source.slice(start, end);
}

const {loadFrontendService}=require('./frontend-service-test-helper');
const cache=new Map();
for(const [file,value] of Object.entries({
 'features/terminal/terminal-session-state':{terminalSessions:new Map()},
 'features/terminal/terminal-quick-registry':{},
 'shared/i18n/runtime':{},
 'features/workspace/workspace-dock-runtime':{}
}))cache.set(path.resolve(root,'frontend/src',file+'.ts'),value);
const runtime=loadFrontendService('frontend/src/features/terminal/terminal-connection-runtime.ts',{window:{},WebSocket:{CONNECTING:0,OPEN:1}},cache);
const context={needsAutomaticConnection:runtime.terminalSessionNeedsAutomaticConnection,connectionStatus:runtime.terminalSessionConnectionStatus};
const {registerAuxiliaryTerminalSession,releaseAuxiliaryTerminalSession,terminalSessionHasWorkspaceOwner}=loadFrontendService('frontend/src/features/terminal/terminal-session-state.ts');

assert.equal(context.needsAutomaticConnection({socket:null, connectionAttempt:0}), true, "a newly created terminal session should connect once");
assert.equal(context.needsAutomaticConnection({socket:null, connectionAttempt:1, connectionPending:true}), false, "returning to a tab during SSH preflight must not start a second connection");
assert.equal(context.needsAutomaticConnection({socket:null, connectionAttempt:1, connectionPending:false}), false, "returning to a failed terminal tab must wait for an explicit reconnect");
assert.equal(context.needsAutomaticConnection({socket:{readyState:1}, connectionAttempt:1}), false, "an existing WebSocket must always be reused");

assert.equal(context.connectionStatus({connectionPending:true, socket:null, connected:false}), "connecting", "SSH preflight should remain visibly connecting after a tab remount");
assert.equal(context.connectionStatus({connectionPending:false, socket:{readyState:0}, connected:false}), "connecting", "a WebSocket handshake should remain visibly connecting after a tab remount");
assert.equal(context.connectionStatus({connectionPending:false, socket:{readyState:1}, connected:false}), "connected", "an open WebSocket should be treated as connected even before the cached flag refreshes");
assert.equal(context.connectionStatus({connectionPending:false, socket:null, connected:false}), "disconnected", "a settled failed attempt should remain disconnected");
registerAuxiliaryTerminalSession('panel-remote-sftp-1','sftp-1');
assert.equal(terminalSessionHasWorkspaceOwner('panel-remote-sftp-1',key=>key==='sftp-1'),true,"a panel terminal remains valid while its SFTP workspace tab exists");
assert.equal(terminalSessionHasWorkspaceOwner('panel-remote-sftp-1',()=>false),false,"a closed SFTP owner invalidates its auxiliary terminal");
assert.equal(terminalSessionHasWorkspaceOwner('terminal-1',key=>key==='terminal-1'),true,"ordinary terminal ownership remains unchanged");
releaseAuxiliaryTerminalSession('panel-remote-sftp-1');

const attachSource = sourceBetween(terminalSource, "async function attachTerminal(", "\nexport function enableTerminalFontWheel(");
const surface = fs.readFileSync(path.join(root,"frontend/src/features/terminal/terminal-surface-service.ts"),"utf8");
assert.match(attachSource, /termaTerminalSurface!\.attach/);
assert.match(surface, /port\.needsConnection\(session\)/, "terminal remounts must use the one-shot automatic connection decision");
assert.match(surface, /port\.status\(session\)/, "terminal remounts must preserve preflight and WebSocket status");

const connectSource=fs.readFileSync(path.join(root,'frontend/src/features/terminal/terminal-connection-runtime.ts'),'utf8');
const core = fs.readFileSync(path.join(root, "frontend/src/features/terminal/terminal-session-core-service.ts"), "utf8");
assert.match(connectSource, /core\.beginConnection\(session/);
assert.match(connectSource, /core\.finishConnection\(connection,key,session/);
assert.match(core, /session\.connectionPending = true;/, "SSH preflight must expose an in-progress state before awaiting the backend");
assert.match(core, /session\.connectionAttempt !== attempt[\s\S]*?session\.connectionPending = false;/, "only the current connection attempt may clear the preflight state");
assert.match(connectSource, /session\?\.connected\|\|session\?\.connectionPending\|\|session\?\.socket\?\.readyState===WebSocket\.CONNECTING/, "the connection toggle must be able to cancel an in-progress preflight");
const transportWorkspace=fs.readFileSync(path.join(root,'frontend/src/features/terminal/terminal-transport-workspace.ts'),'utf8');
assert.match(transportWorkspace,/terminalSessions\.get\(key\)===session&&terminalSessionHasWorkspaceOwner\(key,workspaceHasTabKey\)/,
  "SSH transport must validate session identity and current workspace ownership");

console.log("PASS terminal tabs reuse the original SSH attempt and never reconnect merely because the tab became active");
