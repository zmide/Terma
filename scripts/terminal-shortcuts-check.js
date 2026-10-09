"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const config = require("../public/app-terminal-shortcut-config");

function checkTerminalShortcuts() {
  const defaults = config.normalize();
  assert.equal(defaults.length, 21);
  const copy = config.normalize(defaults);
  copy[0].key = "Enter";
  assert.equal(defaults[0].key, "Esc");
  assert.equal(config.defaults[0].key, "Esc");
  for (const [shortcut, data, application] of [
    [{key:"Home"}, "\x1b[H", "\x1bOH"], [{key:"End"}, "\x1b[F", "\x1bOF"],
    [{key:"Up", ctrl:true}, "\x1b[1;5A"], [{key:"Right", shift:true, alt:true}, "\x1b[1;4C"],
    [{key:"F1"}, "\x1bOP"], [{key:"F5", ctrl:true, alt:true}, "\x1b[15;7~"],
    [{key:"F12", shift:true}, "\x1b[24;2~"], [{key:"Tab", shift:true}, "\x1b[Z"],
    [{key:"Delete"}, "\x1b[3~"], [{key:"PgUp", ctrl:true}, "\x1b[5;5~"],
    [{key:"C", ctrl:true}, "\x03"], [{key:"B", alt:true}, "\x1bb"],
    [{key:"A"}, "a"], [{key:"A", shift:true}, "A"], [{key:"2", shift:true}, "@"],
    [{key:"/", shift:true}, "?"], [{key:"[", ctrl:true}, "\x1b"],
    [{key:"Space", ctrl:true}, "\0"], [{key:"Backspace"}, "\x7f"],
    [{key:"Backspace", ctrl:true}, "\b"], [{key:"Enter"}, "\r"]
  ]) {
    assert.equal(config.sequence(shortcut), data);
    assert.equal(config.sequence(shortcut, true), application || data);
  }
  for (const invalid of [null, {}, Array(49).fill({key:"Tab"}), [{key:"bad"}], [{key:"\x1b"}],
    [{key:"Tab", ctrl:true}], [{key:"Esc", shift:true}], [{key:"A", label:"a".repeat(25)}],
    [{key:"C", label:"bad\nlabel"}], [{key:"C", ctrl:"true"}], [{key:"1", ctrl:true}]
  ]) assert.throws(() => config.normalize(invalid), error=>error.code === "terminal_shortcuts_invalid");
  assert.deepEqual(config.normalize([]), []);
  assert.equal(config.label({key:"C", ctrl:true}), "Ctrl+C");
  assert.equal(config.label({key:"C", ctrl:true, label:"Stop"}), "Stop");
  const backend = require("../dist/runtime-settings");
  const custom = config.normalize([{key:"F5", ctrl:true, label:"Logs"}, {key:"A", enabled:false}]);
  const stored = backend.normalizeTerminalSettings({shortcut_keys:custom});
  assert.deepEqual(stored.shortcut_keys, custom);
  assert.deepEqual(backend.normalizeTerminalSettings({font_size:15}, stored).shortcut_keys, custom);
  assert.deepEqual(backend.normalizeTerminalSettings({shortcut_keys:[]}).shortcut_keys, []);
  assert.throws(() => backend.normalizeTerminalSettings({shortcut_keys:[{key:"\r"}]}), /shortcut/);

  const sent = [];
  const elements = new Map();
  for (const id of ["terminalShortcutRows", "terminalShortcutCount", "terminalShortcutAdd", "terminalShortcutError", "terminalShortcutKey", "terminalShortcutLabel", "terminalShortcutCharacter", "terminalShortcutCtrl", "terminalShortcutAlt", "terminalShortcutShift"]) {
    elements.set(id, {value:"", checked:false, hidden:true, focus() {}, querySelector:()=>null});
  }
  const escape = value=>String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const sandbox = {
    termaTerminalShortcuts:config,
    currentTerminalGlobalSettings:()=>({shortcut_keys:custom}),
    terminalCtrlArmed:false, terminalCtrlLocked:false, terminalKeysVisible:true,
    terminalSessions:new Map([["right", {term:{modes:{applicationCursorKeysMode:true}}}]]),
    terminalElementForKey:()=>null,
    sendTerminalData:(key, data)=>sent.push({key, data}),
    sendCtrlCombo:()=>{throw new Error("unexpected control override");},
    $:id=>elements.get(id), icon:()=>"", tr:value=>value, esc:escape, escAttr:escape
  };
  const read = file=>fs.readFileSync(path.join(__dirname, "..", "public", file), "utf8");
  vm.runInNewContext(read("app-terminal-keys.js"), sandbox);
  sandbox.sendTerminalShortcut("right", 0);
  sandbox.sendTerminalShortcut("right", 1);
  assert.deepEqual(sent, [{key:"right", data:"\x1b[15;5~"}]);
  assert.match(sandbox.renderTerminalKeys("right"), /Logs/);
  assert.doesNotMatch(sandbox.renderTerminalKeys("right"), />A<\/button>/);
  custom[0].label = "'><b>key</b>";
  assert.match(sandbox.renderTerminalKeys("right"), /&lt;b&gt;key/);
  assert.doesNotMatch(sandbox.renderTerminalKeys("right"), /<b>key/);

  vm.runInNewContext(read("app-terminal-shortcut-settings.js"), sandbox);
  sandbox.fillTerminalShortcutSettings(custom);
  sandbox.editTerminalShortcut(1, "up");
  assert.equal(sandbox.terminalShortcutSettingsFormValue()[0].enabled, false);
  sandbox.editTerminalShortcut(0, "remove");
  assert.equal(sandbox.terminalShortcutSettingsFormValue().length, 1);
  assert.equal(custom.length, 2, "draft changes must not mutate saved settings before Save");
  elements.get("terminalShortcutKey").value = "F12";
  elements.get("terminalShortcutCtrl").checked = true;
  sandbox.addTerminalShortcut();
  assert.equal(sandbox.terminalShortcutSettingsFormValue().length, 2);
  elements.get("terminalShortcutKey").value = "Tab";
  sandbox.addTerminalShortcut();
  assert.equal(sandbox.terminalShortcutSettingsFormValue().length, 2);
  assert.equal(elements.get("terminalShortcutError").hidden, false);
  console.log("自定义终端快捷键检查通过：默认兼容、组合键序列、输入校验、草稿隔离、排序删除与分屏发送");
}

if (require.main === module) checkTerminalShortcuts();
module.exports = {checkTerminalShortcuts};
