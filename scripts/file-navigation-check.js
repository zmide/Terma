"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {terminalShortcutConfig: shortcutConfig} = require("../dist/shared/terminal-shortcut-config");
const {checkTerminalShortcuts} = require("./terminal-shortcuts-check");
const {loadFrontendService,loadClassicTerminalSettings}=require("./frontend-service-test-helper");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, "public", file), "utf8");

async function checkFileNavigation() {
  const handlers = new Map();
  const calls = [];
  const modal = {hidden:true};
  const tabList = [{key:"sftp-left", kind:"sftp"}, {key:"sftp-right", kind:"sftp"}, {key:"local", kind:"local-files"}];
  const tabs=new Map(tabList.map(tab=>[tab.key,tab]));
  let pendingResolve;
  let shouldFail = false;
  class FakeElement { constructor(owner=null, excluded=false){this.owner=owner;this.excluded=excluded;} closest(selector){if(selector.startsWith(".sftp-editor"))return this.excluded?{}:null;return this.owner;} }
  const document={getElementById:() => modal,addEventListener:(type,handler)=>handlers.set(type,handler),removeEventListener() {}};
  const {createFileNavigation}=loadFrontendService("frontend/src/features/files/file-navigation.ts",{document,Element:FakeElement});
  const service=createFileNavigation({tab:key=>tabs.get(key),navigate:(kind,direction,tabKey)=>{
    calls.push({direction,tabKey});if(shouldFail)return Promise.reject(new Error("connection lost"));
    if(kind==="local-files")return;
    return new Promise(resolve=>{pendingResolve=resolve;});
  },error:error=>calls.push({error:error.message})});
  service.bind();
  const owner = {dataset:{sftpTabKey:"sftp-right"}};
  const target=new FakeElement(owner);
  const event = (type, button=3, node=target) => ({
    type, button, target:node, defaultPrevented:false, stopped:false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  for (const type of ["mousedown", "mouseup", "auxclick"]) {
    const sample = event(type);
    handlers.get(type)(sample);
    assert.equal(sample.defaultPrevented, true);
    assert.equal(sample.stopped, true);
  }
  await flush();
  assert.deepEqual(calls, [{direction:-1, tabKey:"sftp-right"}]);
  handlers.get("mouseup")(event("mouseup"));
  await flush();
  assert.equal(calls.length, 1, "rapid mouse events must not overlap a directory request");
  pendingResolve(true);
  await flush();
  handlers.get("mouseup")(event("mouseup", 4));
  await flush();
  assert.deepEqual(calls[1], {direction:1, tabKey:"sftp-right"});
  pendingResolve(true);
  await flush();
  owner.dataset = {tabKey:"local"};
  handlers.get("mouseup")(event("mouseup"));
  await flush();
  assert.deepEqual(calls[2], {direction:-1, tabKey:"local"});
  for (const button of [0, 1, 2]) {
    const sample = event("mouseup", button);
    handlers.get("mouseup")(sample);
    assert.equal(sample.defaultPrevented, false);
  }
  const editorEvent = event("mouseup", 3, new FakeElement(null,true));
  handlers.get("mouseup")(editorEvent);
  assert.equal(editorEvent.defaultPrevented, false);
  const outsideEvent = event("mouseup", 3, new FakeElement());
  handlers.get("mouseup")(outsideEvent);
  assert.equal(outsideEvent.defaultPrevented, false);
  modal.hidden = false;
  const blockedEvent = event("mouseup");
  handlers.get("mouseup")(blockedEvent);
  assert.equal(blockedEvent.defaultPrevented, false);
  modal.hidden = true;
  owner.dataset = {sftpTabKey:"sftp-left"};
  shouldFail = true;
  handlers.get("mouseup")(event("mouseup"));
  await flush();
  assert.equal(calls.at(-1).error, "connection lost");
  shouldFail = false;
  handlers.get("mouseup")(event("mouseup"));
  await flush();
  assert.deepEqual(calls.at(-1), {direction:-1, tabKey:"sftp-left"});
  pendingResolve(true);
  await flush();
}

function checkTerminalNavigationKeys() {
  const sandbox = {activeTabKey:"normal", terminalSessions:new Map([
    ["normal", {term:{modes:{applicationCursorKeysMode:false}}}],
    ["application", {term:{modes:{applicationCursorKeysMode:true}}}]
  ])};
  sandbox.window = sandbox;
  loadClassicTerminalSettings(sandbox);
  loadFrontendService("frontend/src/features/terminal/terminal-keys-service.ts", sandbox).installTerminalKeysService();
  for (const [label, normal, application] of [
    ["Home", "\x1b[H", "\x1bOH"], ["End", "\x1b[F", "\x1bOF"],
    ["PgUp", "\x1b[5~", "\x1b[5~"], ["PgDn", "\x1b[6~", "\x1b[6~"],
    ["↑", "\x1b[A", "\x1bOA"], ["Tab", "\t", "\t"], ["Esc", "\x1b", "\x1b"]
  ]) {
    assert.equal(sandbox.termaTerminalKeysService.sequence(label, "normal"), normal);
    assert.equal(sandbox.termaTerminalKeysService.sequence(label, "application"), application);
  }
  assert.equal(sandbox.termaTerminalKeysService.sequence("/", "normal"), "/");
}

function checkShortcutVisibility() {
  const saved = [];
  const fitted = [];
  const refreshed = [];
  const toolbar = [];
  const boxes = new Map(["left", "right"].map(key => [key, {scrollLeft:17, outerHTML:""}]));
  const sandbox = {
    activeTabKey:"left", terminalKeysVisible:false, terminalCtrlArmed:false, terminalCtrlLocked:false,
    termaTerminalShortcuts:shortcutConfig,
    termaTerminalSettings:{current:()=>({shortcut_keys:shortcutConfig.defaults})},
    terminalSurfaceCache:new Map([["left", {}], ["right", {}]]),
    terminalSessions:new Map([["left", {key:"left"}], ["right", {key:"right"}]]),
    localStorage:{setItem:(name, value) => saved.push({name, value})},
    fitTerminalPreservingViewport:session => fitted.push(session.key),
    termaTerminalKeys:{refresh:key => {refreshed.push(key); return true;}},
    termaTerminalToolbar:{refresh:key => toolbar.push(key)},
    openTerminal:() => { throw new Error("shortcut visibility must not reopen terminal connections"); },
    tr:key => key, icon:()=>"", esc:value => value, escAttr:value => value
  };
  sandbox.window = sandbox;
  loadClassicTerminalSettings(sandbox);
  const cache = new Map([[path.resolve("frontend/src/features/terminal/terminal-viewport-service.ts"), {
    terminalViewport:{fitSession:session => fitted.push(session.key)}
  }]]);
  loadFrontendService("frontend/src/features/terminal/terminal-keys-service.ts", sandbox, cache).installTerminalKeysService();
  sandbox.termaTerminalKeysService.toggle("left");
  for (const box of boxes.values()) {
    assert.equal(box.outerHTML, "", "Vue retains the shortcut host");
    assert.equal(box.scrollLeft, 17);
  }
  assert.equal(sandbox.termaTerminalKeysService.model("left").visible, true);
  sandbox.termaTerminalKeysService.toggle("left");
  assert.equal(sandbox.termaTerminalKeysService.model("left").visible, false);
  assert.deepEqual(saved.map(entry => entry.value), ["1", "0"]);
  assert.deepEqual(fitted, ["left", "right", "left", "right"]);
  assert.deepEqual(refreshed, fitted);
  assert.deepEqual(toolbar, fitted);
}

async function main() {
  await checkFileNavigation();
  checkTerminalNavigationKeys();
  checkShortcutVisibility();
  checkTerminalShortcuts();
  console.log("目录侧键与终端导航键检查通过：分屏归属、请求合并、失败恢复、弹窗隔离和终端应用模式");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
