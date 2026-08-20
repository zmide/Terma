const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readFrontendDomain } = require("./frontend-source");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const productivity = readFrontendDomain(root, "productivity");
const docking = readFrontendDomain(root, "docking");
const terminal = readFrontendDomain(root, "terminal");
const sftp = readFrontendDomain(root, "sftp");
const actions = read("public/app-actions.js");
const index = read("public/index.html");
const styles = read("public/app.css");

for (const contract of [
  /openQuickPanel/,
  /openCommandSnippetManager/,
  /captureNamedWorkspaceLayout/,
  /importNamedWorkspaceData/,
  /repairNamedWorkspace/,
  /openTerminalBroadcastPicker/,
  /restoreRecentlyClosedTab/,
  /openTerminalPathInSftp/
]) assert.match(productivity, contract);
assert.match(productivity, /workspace_groups_version/);
assert.match(productivity, /workspace_groups/);
assert.match(productivity, /applyWorkspaceGroupPreset/);
assert.match(productivity, /namedWorkspaceSavedTabs/);
assert.match(productivity, /tr\("common:command_palette\.named_workspace_detail", \{count:namedWorkspaceSavedTabs\(workspace\.layout \|\| \{\}\)\.length/);
assert.match(productivity, /workspace-preview"><strong>\$\{esc\(tr\("common:named_workspaces\.tab_count", \{count:savedTabs\.length/);
assert.match(productivity, /for \(const tab of Array\.isArray\(layout\.tabs\) \? layout\.tabs : \[\]\) callback\(tab, null\)/);
assert.match(docking, /workspaceGroupSelectionMode/);
assert.match(docking, /showWorkspaceTabsContextMenu/);
assert.match(docking, /beginWorkspaceGroupDrag/);
assert.match(productivity, /tab\?\.kind === "local-files"[\s\S]*localFilesAvailable/);
assert.match(docking, /tab\.pinned/);
assert.doesNotMatch(docking, /toggleTabNotifications/);
assert.match(terminal, /在 SFTP 打开/);
assert.match(actions, /registerAppAction/);
assert.match(productivity, /runAppAction\(action\.id/);
assert.match(productivity, /kind:"workspace"/);
assert.match(productivity, /kind:"workspace-group"/);
assert.match(productivity, /listWorkspaceGroups/);
assert.match(productivity, /保存当前工作区为预设/);
assert.match(productivity, /previewNamedWorkspace\(workspace\.id\)/);
assert.match(productivity, /function previewNamedWorkspace[\s\S]*modal\.hidden = false/);
assert.match(productivity, /icon\("zap"\)/);
assert.match(productivity, /command_window_shortcut/);
const commandPalette = read("public/app-command-palette.js");
assert.match(commandPalette, /navigation:auto\.command_window/);
assert.match(commandPalette, /hasConnectionSearch/);
assert.match(commandPalette, /scheduleQuickPanelRender/);
assert.match(commandPalette, /if \(hasConnectionSearch\) \{[\s\S]*kind:"snippet"/);
assert.match(productivity, /return `<div class="quick-result/);
assert.doesNotMatch(productivity, /return `<button class="quick-result/);
assert.match(styles, /\.quick-result \{[^}]*grid-template-columns:30px minmax\(0,1fr\) auto/);
assert.doesNotMatch(productivity, /broadcastSource/);
assert.match(productivity, /targets\.length < 2/);
assert.match(productivity, /broadcastTargets\.has\(sourceKey\)/);
assert.match(productivity, /function isTerminalBroadcastTarget/);
assert.match(productivity, /function isWorkspaceTabCurrentlyVisible/);
assert.match(productivity, /!isWorkspaceTabCurrentlyVisible\(key\)/);
assert.match(productivity, /renderTabsPreservingTerminalFocus/);
assert.doesNotMatch(productivity, /markTerminalCommandComplete|activityState\s*=\s*"complete"|command_duration/);
assert.match(docking, /broadcast-selected/);
assert.match(docking, /multi-selected/);
assert.match(docking, /createWorkspaceGroupFromSelection/);
assert.match(docking, /activeWorkspaceGroupId/);
assert.match(docking, /function workspaceTabByKey/);
assert.match(docking, /function workspaceHasTabKey/);
assert.match(terminal, /workspaceHasTabKey\(key\)/);
assert.match(terminal, /const terminalOutput = event\.data instanceof ArrayBuffer[\s\S]{0,240}updateTerminalSmartState\(key, terminalOutput\)[\s\S]{0,240}consumeTerminalZmodemOutput/);
assert.match(productivity, /workspaceTabByKey\(key\)/);
assert.match(sftp, /workspaceAllTabs\(\)/);
assert.match(docking, /if \(pane\.activeTabKey\) revealWorkspaceTab\(pane\.activeTabKey\)/);
assert.match(styles, /\.tab\.broadcast-selected/);
assert.match(styles, /\.workspace-group-bar/);
assert.match(styles, /\.tab\.active\.multi-selected/);
assert.doesNotMatch(styles, /\.tab\.activity-complete/);
assert.match(productivity, /terminal-broadcast-exit/);
assert.match(index, /id="workspaceQuickActions"/);
assert.match(styles, /\.workspace-quick-actions/);
console.log("效率功能契约检查通过：快速面板、片段、工作区、广播、标签恢复、未读输出提示和 SFTP 路径联动均已注册");
