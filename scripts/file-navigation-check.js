"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const shortcutConfig = require("../public/app-terminal-shortcut-config");
const {checkTerminalShortcuts} = require("./terminal-shortcuts-check");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, "public", file), "utf8");

async function checkFileNavigation() {
  const handlers = new Map();
  const calls = [];
  const modal = {hidden:true};
  const tabList = [{key:"sftp-left", kind:"sftp"}, {key:"sftp-right", kind:"sftp"}, {key:"local", kind:"local-files"}];
  let pendingResolve;
  let shouldFail = false;
  const sandbox = {
    document:{getElementById:() => modal, addEventListener:(type, handler) => handlers.set(type, handler)},
    tabs:tabList,
    navigateSftpHistory:(direction, tabKey) => {
      calls.push({direction, tabKey});
      if (shouldFail) return Promise.reject(new Error("connection lost"));
      return new Promise(resolve => { pendingResolve = resolve; });
    },
    navigateLocalFilesHistory:(direction, tabKey) => { calls.push({direction, tabKey}); },
    notify:message => calls.push({error:message})
  };
  vm.runInNewContext(read("app-file-navigation.js"), sandbox);
  const owner = {dataset:{sftpTabKey:"sftp-right"}};
  const target = {
    closest:selector => selector.startsWith(".sftp-editor") ? null : owner
  };
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
  const editorEvent = event("mouseup", 3, {closest:() => ({})});
  handlers.get("mouseup")(editorEvent);
  assert.equal(editorEvent.defaultPrevented, false);
  const outsideEvent = event("mouseup", 3, {closest:() => null});
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
  vm.runInNewContext(read("app-terminal-keys.js"), sandbox);
  for (const [label, normal, application] of [
    ["Home", "\x1b[H", "\x1bOH"], ["End", "\x1b[F", "\x1bOF"],
    ["PgUp", "\x1b[5~", "\x1b[5~"], ["PgDn", "\x1b[6~", "\x1b[6~"],
    ["↑", "\x1b[A", "\x1bOA"], ["Tab", "\t", "\t"], ["Esc", "\x1b", "\x1b"]
  ]) {
    assert.equal(sandbox.terminalSequence(label, "normal"), normal);
    assert.equal(sandbox.terminalSequence(label, "application"), application);
  }
  assert.equal(sandbox.terminalSequence("/", "normal"), "/");
}

function checkShortcutVisibility() {
  const saved = [];
  const fitted = [];
  const boxes = new Map(["left", "right"].map(key => [key, {scrollLeft:17, outerHTML:""}]));
  const sandbox = {
    activeTabKey:"left", terminalKeysVisible:false, terminalCtrlArmed:false, terminalCtrlLocked:false,
    termaTerminalShortcuts:shortcutConfig,
    currentTerminalGlobalSettings:()=>({shortcut_keys:shortcutConfig.defaults}),
    terminalSurfaceCache:new Map([["left", {}], ["right", {}]]),
    terminalSessions:new Map([["left", {key:"left"}], ["right", {key:"right"}]]),
    localStorage:{setItem:(name, value) => saved.push({name, value})},
    terminalElementForKey:(key, selector) => selector === "#terminalKeys" ? boxes.get(key) : null,
    fitTerminalPreservingViewport:session => fitted.push(session.key),
    openTerminal:() => { throw new Error("shortcut visibility must not reopen terminal connections"); },
    tr:key => key, icon:()=>"", esc:value => value, escAttr:value => value
  };
  vm.runInNewContext(read("app-terminal-keys.js"), sandbox);
  sandbox.toggleTerminalKeys("left");
  assert.equal(sandbox.terminalKeysVisible, true);
  for (const box of boxes.values()) {
    assert.ok(!box.outerHTML.includes('class="terminal-keys hidden"'));
    assert.ok(box.outerHTML.includes('data-i18n-skip="true"'), "terminal key names must remain literal rather than be translated as tabs");
    assert.equal(box.scrollLeft, 17);
  }
  sandbox.toggleTerminalKeys("left");
  for (const box of boxes.values()) assert.ok(box.outerHTML.includes('class="terminal-keys hidden"'));
  assert.deepEqual(saved.map(entry => entry.value), ["1", "0"]);
  assert.deepEqual(fitted, ["left", "right", "left", "right"]);
}

async function main() {
  await checkFileNavigation();
  checkTerminalNavigationKeys();
  checkShortcutVisibility();
  checkTerminalShortcuts();
  console.log("目录侧键与终端导航键检查通过：分屏归属、请求合并、失败恢复、弹窗隔离和终端应用模式");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
