"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createProductivityRepository } = require("../dist/database/productivity-repository");
const { readFrontendDomain } = require("./frontend-source");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const quickCommands = read("frontend/src/features/efficiency/efficiency-runtime.ts");
const commandSnippets = read("frontend/src/features/snippets/snippet-runtime.ts");
const terminal = readFrontendDomain(root, "terminal");
const styles = read("public/app.css");
const migrations = read("src/database/migrations.ts");
const database = ["src/db.ts", "src/database/config-snapshot-service.ts"].map(read).join("\n");
const index = read("public/index.html");

const quickRuntime=read('frontend/src/features/efficiency/efficiency-runtime.ts'),quickService=read('frontend/src/features/efficiency/quick-command-service.ts'),quickView=read('frontend/src/features/efficiency/QuickCommandView.ts'),snippetView=read('frontend/src/features/snippets/SnippetViews.ts'),snippetModel=read('frontend/src/features/snippets/snippet-model.ts');
for (const name of ['mount','persist','beginDrag','menu']) assert.ok(quickCommands.includes('function '+name+'('));
assert.ok(quickRuntime.includes("window.addEventListener('pointermove',move,true)"));
assert.ok(quickRuntime.includes("window.removeEventListener('pointermove',move,true)"));
assert.ok(quickRuntime.includes('list.scrollLeft+=delta'));
assert.ok(quickRuntime.includes('port.edit(0,true)'));
assert.ok(quickService.includes('target.current()'));
assert.ok(quickService.includes('quick_sort_order:ids.indexOf(id)+1'));
assert.ok(quickView.includes("'data-terminal-quick-command-drag'"));
assert.doesNotMatch(quickCommands,/onclick\s*=/i);
const toolbarView = read('frontend/src/features/terminal/TerminalToolbarView.ts');
assert.doesNotMatch(toolbarView, /terminal-action-quick-commands/);
assert.doesNotMatch(toolbarView, /quickCommands/);
assert.doesNotMatch(read('frontend/src/features/terminal/terminal-toolbar-service.ts'), /quickCommands/);
const utilityPanel = read('frontend/src/features/terminal-panel/panel-contents.ts');
assert.match(utilityPanel, /dataset\.terminalQuickCommandBar/);
assert.match(utilityPanel, /termaEfficiency\.quick\.mount\(key, host\)/);
assert.doesNotMatch(read('frontend/src/features/terminal/terminal-page.ts'), /data-terminal-quick-command-bar/);
assert.doesNotMatch(index, /app-(?:command-snippets|terminal-quick-commands)\.js/);
assert.match(index, /id="terminalPanelToggleButton"[^>]*data-action="static-terminal-panel-toggle"/);
assert.match(read('frontend/src/shared/static-action-registry.ts'), /'static-terminal-panel-toggle': \(\) => efficiencyServices\.termaEfficiency\.quick\.toggle\(\)/);
assert.doesNotMatch(toolbarView, /list-checks/);
assert.doesNotMatch(quickCommands, /terminal-quick-command-head/);
assert.match(styles, /\.terminal-quick-command-list \{[^}]*display:flex;[^}]*flex-wrap:wrap;[^}]*overflow-x:hidden; overflow-y:auto/);
assert.match(styles, /\.terminal-quick-command \{[^}]*width:max-content;[^}]*max-width:min\(190px,100%\)/);
assert.match(styles, /\.terminal-quick-command-bar \{[^}]*min-height:32px/);
assert.match(styles, /\.terminal-quick-command\.no-badge/);
assert.match(styles, /\.terminal-quick-command-bar\.compact/);
assert.match(styles, /\.terminal-quick-command-bar:not\(\.compact\) \.terminal-quick-command \{[^}]*min-height:30px/);
assert.match(styles, /\.terminal-quick-command-bar:not\(\.compact\) \.terminal-quick-command-list \{[^}]*overflow-x:auto/);
assert.ok(snippetView.includes("label('show_in_quick_bar')"));
assert.ok(snippetView.includes("'badges.'+(code||'none')"));
assert.match(snippetView,/data-snippet-save/);
assert.match(snippetView,/data-snippet-back/);
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
assert.equal(inserted[5], "");
assert.deepEqual(inserted.slice(6, 12), [1, 1, "execute", "", "blue", 1000000]);
assert.deepEqual(inserted.slice(12), [100, 100]);
const workflowSnippet = repository.insertCommandSnippet({
  name:"参数化工作流",
  command:"echo ${path} && echo ${port} && echo ${token}",
  workflow_json:{version:2, dryRun:true, parameters:[
    {name:"path", type:"path", required:true, default:"/tmp/demo"},
    {name:"port", type:"port", required:true, default:"8080"},
    {name:"token", type:"text", required:true, secret:true, default:"do-not-save"}
  ], steps:[{command:"echo ${path}"},{command:"echo ${port}"}]}
});
const workflow = JSON.parse(workflowSnippet.workflow_json);
assert.equal(workflow.version, 2);
assert.equal(workflow.dryRun, true);
assert.equal(workflow.parameters.find(item => item.name === "token").default, "");
assert.equal(workflow.steps.length, 2);
const changed = repository.updateCommandSnippet(7, {quick_action:"insert", quick_badge:"库", quick_color:"purple", quick_sort_order:4});
assert.equal(changed.quick_action, "insert");
assert.equal(changed.quick_badge, "database");
assert.equal(changed.quick_color, "purple");
assert.equal(changed.quick_sort_order, 4);
assert.equal(updated[5], "");
assert.deepEqual(updated.slice(6, 12), [1, 1, "insert", "database", "purple", 4]);
assert.ok(snippetModel.includes("'服':'service'"));
assert.ok(quickView.includes('service.glyph(item)'));
assert.match(migrations, /WHEN '服' THEN 'service'/);

console.log("终端快速命令栏检查通过：独立模块、可调高度、事件委托、数据库兼容和展示字段白名单均已覆盖");
require('./terminal-panel-check');
