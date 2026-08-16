"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createProductivityRepository } = require("../dist/database/productivity-repository");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const quickCommands = read("public/app-terminal-quick-commands.js");
const commandSnippets = read("public/app-command-snippets.js");
const terminal = read("public/app-terminal.js");
const styles = read("public/app.css");
const migrations = read("src/database/migrations.ts");
const database = ["src/db.ts", "src/database/config-snapshot-service.ts"].map(read).join("\n");
const index = read("public/index.html");

for (const contract of [
  /terminalQuickCommandToolbarButton/,
  /renderTerminalQuickCommandBar/,
  /toggleTerminalQuickCommandBar/,
  /bindTerminalQuickCommandResize/,
  /beginTerminalQuickCommandDrag/,
  /window\.addEventListener\("pointermove"/,
  /persistTerminalQuickCommandOrder/,
  /runTerminalQuickCommand/,
  /showTerminalQuickCommandMenu/,
  /addEventListener\("wheel"/,
  /list\.scrollLeft \+= delta/,
  /openCommandSnippetEditor\(0, \{quick:true\}\)/
]) assert.match(quickCommands, contract);
assert.doesNotMatch(quickCommands, /onclick\s*=/i, "new quick command interactions must use delegated listeners");
assert.match(terminal, /terminalQuickCommandToolbarButton\(key\)/);
assert.match(terminal, /renderTerminalQuickCommandBar\(key\)/);
assert.match(terminal, /mountTerminalQuickCommandBar\(key, terminalView\)/);
assert.match(index, /app-command-snippets\.js[^]*app-terminal-quick-commands\.js[^]*app-named-workspaces\.js/);
assert.match(quickCommands, /icon\("list-checks"\)/);
assert.doesNotMatch(quickCommands, /terminal-quick-command-head/);
assert.match(styles, /\.terminal-quick-command-list \{[^}]*display:flex;[^}]*flex-wrap:wrap;[^}]*overflow-x:hidden; overflow-y:auto/);
assert.match(styles, /\.terminal-quick-command \{[^}]*width:max-content;[^}]*max-width:min\(190px,100%\)/);
assert.match(styles, /\.terminal-quick-command-bar \{[^}]*min-height:32px/);
assert.match(styles, /\.terminal-quick-command\.no-badge/);
assert.match(styles, /\.terminal-quick-command-bar\.compact/);
assert.match(commandSnippets, /显示在终端快速命令栏/);
assert.match(commandSnippets, /无（更紧凑）/);
assert.match(commandSnippets, /data-snippet-save/);
assert.match(commandSnippets, /data-snippet-back/);
assert.doesNotMatch(commandSnippets, /onclick="saveCommandSnippetUi/);
assert.match(migrations, /quick_visible INTEGER NOT NULL DEFAULT 0/);
assert.match(migrations, /quick_action TEXT NOT NULL DEFAULT 'execute'/);
assert.match(migrations, /ALTER TABLE command_snippets ADD COLUMN quick_badge/);
assert.match(migrations, /ALTER TABLE command_snippets ADD COLUMN quick_sort_order/);
assert.match(database, /favorite,quick_visible,quick_action,quick_badge,quick_color,quick_sort_order,last_used_at/);

let inserted = null;
let updated = null;
const existing = {
  id:7,
  name:"查看服务",
  group_name:"默认分组",
  command:"systemctl status sshd",
  description:"",
  tags:"",
  favorite:1,
  quick_visible:1,
  quick_action:"execute",
  quick_badge:"服",
  quick_color:"green",
  quick_sort_order:3,
  created_at:1,
  updated_at:1
};
const repository = createProductivityRepository({
  all:() => [],
  get:() => existing,
  run:(sql, params) => {
    if (sql.startsWith("INSERT INTO command_snippets")) inserted = params;
    if (sql.startsWith("UPDATE command_snippets")) updated = params;
    return {lastInsertRowid:8, changes:1};
  },
  now:() => 100
});
const safe = repository.insertCommandSnippet({
  name:"危险展示值",
  command:"echo ok",
  favorite:1,
  quick_visible:1,
  quick_action:"launch-program",
  quick_badge:"<",
  quick_color:"url(javascript:1)",
  quick_sort_order:2000000
});
assert.equal(safe.quick_action, "execute");
assert.equal(safe.quick_badge, "");
assert.equal(safe.quick_color, "blue");
assert.equal(safe.quick_sort_order, 1000000);
assert.deepEqual(inserted.slice(5, 11), [1, 1, "execute", "", "blue", 1000000]);
const changed = repository.updateCommandSnippet(7, {quick_action:"insert", quick_badge:"库", quick_color:"purple", quick_sort_order:4});
assert.equal(changed.quick_action, "insert");
assert.equal(changed.quick_badge, "database");
assert.equal(changed.quick_color, "purple");
assert.equal(changed.quick_sort_order, 4);
assert.deepEqual(updated.slice(5, 11), [1, 1, "insert", "database", "purple", 4]);
assert.match(commandSnippets, /commandSnippetLegacyBadgeCodes/);
assert.match(quickCommands, /commandSnippetBadgeGlyph\(item\.quick_badge\)/);
assert.match(migrations, /WHEN '服' THEN 'service'/);

console.log("终端快速命令栏检查通过：独立模块、可调高度、事件委托、数据库兼容和展示字段白名单均已覆盖");
