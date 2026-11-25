"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const config = require("../dist/shared/terminal-shortcut-config").terminalShortcutConfig;
const {loadFrontendService,loadClassicTerminalSettings} = require("./frontend-service-test-helper");

function checkSharedConfiguration() {
  let checks = 0;
  const check = (value, message) => { assert.ok(value, message); checks++; };
  const plain = value => JSON.parse(JSON.stringify(value));
  const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const sandbox = {tr:key => key, document:{documentElement:{dataset:{theme:"light"}}}};
  sandbox.window = sandbox;
  check(!sandbox.termaTerminalShortcuts, "shortcut owner is installed by typed bootstrap");
  const context = loadClassicTerminalSettings(sandbox);
  check(!sandbox.termaTerminalSettingsModel, "classic script registration does not instantiate the typed model");
  const cache = new Map();
  const shortcuts = loadFrontendService("frontend/src/features/terminal/terminal-shortcut-config-service.ts", {window:sandbox}, cache);
  shortcuts.installTerminalShortcutConfigService();
  const owner = sandbox.termaTerminalShortcuts;
  shortcuts.installTerminalShortcutConfigService();
  check(sandbox.termaTerminalShortcuts === owner, "installation preserves the canonical owner");
  check(Object.isFrozen(owner), "the browser installer uses the immutable shared configuration");
  check(JSON.stringify(owner.defaults) === JSON.stringify(config.defaults) && JSON.stringify(owner.keys) === JSON.stringify(config.keys), "browser and Node read canonical keys and defaults");
  check(config === require("../dist/shared/terminal-shortcut-config").terminalShortcutConfig, "Node compatibility exports the compiled shared owner");
  check(owner.label({key:"Up",ctrl:true}) === "Ctrl+↑", "browser labels use the canonical format");
  const model = loadFrontendService("frontend/src/features/terminal/terminal-settings-model.ts", {window:sandbox}, cache)
    .createTerminalSettingsModel({tr:key=>sandbox.tr(key),dark:()=>false});
  const backend = require("../dist/runtime-settings");
  check(JSON.stringify(model.defaults.shortcut_keys) === JSON.stringify(owner.defaults), "settings and keyboard share the same immutable shortcuts");
  check(Object.isFrozen(model.defaults) && Object.isFrozen(model.defaults.shortcut_keys) && model.defaults.shortcut_keys.every(Object.isFrozen), "canonical shortcut defaults retain their immutable shape");
  assert.deepEqual(plain(model.defaults), backend.DEFAULT_TERMINAL_SETTINGS); checks++;
  check(model.mouseOptions().map(([value]) => value).join() === "none,context_menu,paste_clipboard,open_settings,send_enter,paste_selection", "mouse option IDs retain their order");
  sandbox.tr = key => "changed " + key;
  check(model.mouseOptions().every(([,text]) => text.startsWith("changed terminal:settings.mouse_")), "mouse labels read the current language");
  const keys = [...new Set([...config.keys, ...Array.from({length:95}, (_,index) => String.fromCharCode(32 + index))])];
  for (const key of keys) for (let flags = 0; flags < 8; flags++) {
    const input = {key,ctrl:Boolean(flags & 1),alt:Boolean(flags & 2),shift:Boolean(flags & 4)};
    let normalized;
    try { normalized = config.normalize([input]); } catch (error) {
      assert.equal(error.code, "terminal_shortcuts_invalid");
      assert.throws(() => owner.normalize([input]), failure => failure.code === error.code);
      checks++;
      continue;
    }
    assert.deepEqual(plain(owner.normalize([input])), normalized); checks++;
    for (const application of [false,true]) {
      check(owner.sequence(input, application) === config.sequence(input, application), "browser and Node sequence rules agree across printable keys and modifiers");
    }
    assert.deepEqual(plain(model.normalize({shortcut_keys:[input]}).shortcut_keys), backend.normalizeTerminalSettings({shortcut_keys:[input]}).shortcut_keys); checks++;
  }
  for (const input of [[], config.defaults, [{key:"F5",ctrl:true,label:"Logs"}], Array(48).fill({key:"Tab"})]) {
    assert.deepEqual(plain(owner.normalize(input)), config.normalize(input)); checks++;
  }
  for (const input of [null, false, {}, Array(49).fill({key:"Tab"}), [null], [[]], [{key:"C",enabled:0}], [{key:"C",alt:"yes"}], [{key:"C",label:"bad\u007f"}]]) {
    assert.throws(() => owner.normalize(input), error => error.code === "terminal_shortcuts_invalid"); checks++;
    assert.throws(() => backend.normalizeTerminalSettings({shortcut_keys:input ?? {}}), error => error.code === "terminal_shortcuts_invalid"); checks++;
  }
  const current = model.normalize(), second = model.normalize();
  current.url_prefixes.push("draft://"); current.shortcut_keys[0].key = "Enter";
  check(!second.url_prefixes.includes("draft://") && second.shortcut_keys[0].key === "Esc", "normalized drafts detach both mutable lists");
  check(!fs.existsSync(path.join(__dirname,"../public/app-terminal-shortcut-config.js")) && !fs.existsSync(path.join(__dirname,"../frontend/legacy/app-terminal-settings.js")), "classic scripts contain no second configuration implementation");
  check(!read("src/runtime-settings.ts").includes('require("../public/app-terminal-shortcut-config")'), "backend configuration has no public-script dependency");
  console.log(`Shared terminal configuration checks passed (${checks}).`);
}

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
  const escape = value=>String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const sandbox = {
    termaTerminalShortcuts:config,
    termaTerminalSettings:{current:()=>({shortcut_keys:custom})},
    terminalCtrlArmed:false, terminalCtrlLocked:false, terminalKeysVisible:true,
    terminalSessions:new Map([["right", {term:{modes:{applicationCursorKeysMode:true}}}]]),
    sendTerminalData:(key, data)=>sent.push({key, data}),
    sendCtrlCombo:()=>{throw new Error("unexpected control override");},
    $:()=>null, icon:()=>"", tr:value=>value, esc:escape, escAttr:escape
  };
  sandbox.window = sandbox;
  loadClassicTerminalSettings(sandbox);
  const sendCache=new Map([[require('node:path').resolve('frontend/src/features/terminal/terminal-input-actions.ts'),{sendTerminalData:(...args)=>sandbox.sendTerminalData(...args)}]]);
  loadFrontendService("frontend/src/features/terminal/terminal-keys-service.ts", sandbox,sendCache).installTerminalKeysService();
  sandbox.termaTerminalKeysService.sendShortcut("right", 0);
  sandbox.termaTerminalKeysService.sendShortcut("right", 1);
  assert.deepEqual(sent, [{key:"right", data:"\x1b[15;5~"}]);
  assert.equal(sandbox.termaTerminalKeysService.model("right").shortcuts[0].label, "Logs");
  assert.equal(sandbox.termaTerminalKeysService.model("right").shortcuts.length, 1);
  custom[0].label = "'><b>key</b>";
  assert.equal(sandbox.termaTerminalKeysService.model("right").shortcuts[0].label, custom[0].label);

  console.log("自定义终端快捷键检查通过，覆盖默认兼容、组合键序列、输入校验、后端保存及分屏发送");
  checkSharedConfiguration();
}

if (require.main === module) checkTerminalShortcuts();
module.exports = {checkTerminalShortcuts};
