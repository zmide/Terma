const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { indexScriptFiles, readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const files = indexScriptFiles(root, { includeBootstrap:true });
files.push(path.join("public", "sftp-open-worker.js"));

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

const css = fs.readFileSync(path.resolve("public/app.css"), "utf8");
const themeGlassCss = fs.readFileSync(path.resolve("public/app-theme-glass.css"), "utf8");
if (!/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/.test(css)) {
  throw new Error("public/app.css 必须保证 hidden 元素不会被组件 display 样式重新显示");
}

const html = fs.readFileSync(path.resolve("public/index.html"), "utf8");
if (!html.includes('name="terma-csp-nonce" content="__TERMA_CSP_NONCE__"')) throw new Error("主页面缺少 CSP nonce 占位符");
if (!html.includes("?v=__TERMA_VERSION__") || /[?&]v=\d+\.\d+\.\d+/.test(html)) throw new Error("主页面静态资源必须统一使用版本占位符");
if (!html.includes('/csp-bootstrap.js')) throw new Error("主页面必须在组件脚本之前加载 CSP 引导脚本");
for (const asset of ["/vendor/ace/ace.css", "/vendor/ace/theme-textmate.css", "/vendor/ace/theme-tomorrow_night.css", "/vendor/diff/diff.min.js", "/vendor/i18next/i18next.min.js"]) {
  if (!html.includes(asset)) throw new Error(`SFTP 编辑器缺少严格 CSP 外部样式：${asset}`);
}
if (!html.includes('/app-theme-glass.css?v=__TERMA_VERSION__')) throw new Error("主页面缺少主题玻璃样式模块");
for (const token of [".terma-liquid-lens", "data-liquid-moving", ".modal-scroll-body", "--terma-modal-surface-opacity"]) {
  if (!themeGlassCss.includes(token)) throw new Error(`主题玻璃样式边界缺少：${token}`);
}

const cspBootstrap = fs.readFileSync(path.resolve("public/csp-bootstrap.js"), "utf8");
for (const token of ["Document.prototype.createElement", "Document.prototype.createElementNS", 'setAttribute("nonce", nonce)']) {
  if (!cspBootstrap.includes(token)) throw new Error(`CSP 引导脚本缺少动态样式 nonce：${token}`);
}
if (!html.includes('id="connExtraDiagnostics"')) throw new Error("SSH 编辑页缺少附加参数诊断视图");
if (!html.includes('id="connAdvancedOptions"')) throw new Error("SSH 编辑页缺少可折叠的高级选项");

const connections = readFrontendDomain(root, "connections");
for (const token of ["validateConnectionExtraArgs", "/api/ssh/extra-args/validate", "focusConnectionExtraArgsIssue", "updateConnectionAdvancedStatus", "formatAllHealthMessage", "openQuickConnectionLauncher", "createProgressToast"]) {
  if (!connections.includes(token)) throw new Error(`SSH 附加参数诊断前端缺少：${token}`);
}
if (/\son(?:click|change|input|dblclick|contextmenu|keydown|submit|drag\w*|drop)=/i.test(connections)) {
  throw new Error("连接模块必须使用 app-events.js 事件委托，不能重新加入内联事件");
}
for (const token of ["registerTermaAction", 'data-action="connection-open-terminal"', 'data-change-action="connection-select"']) {
  if (!connections.includes(token)) throw new Error(`连接模块缺少事件委托边界：${token}`);
}

for (const [label, source] of [
  ["public/index.html", html],
  ["工作区模块", `${fs.readFileSync(path.join(root, "public", "app-workspace.js"), "utf8")}\n${readFrontendDomain(root, "docking")}`],
  ["public/app-local-files.js", fs.readFileSync(path.join(root, "public", "app-local-files.js"), "utf8")]
]) {
  if (/\son[a-z]+=/i.test(source)) throw new Error(`${label} 必须使用 app-events.js 事件委托，不能重新加入内联事件`);
}
const staticActions = fs.readFileSync(path.resolve("public/app-static-actions.js"), "utf8");
for (const token of ["static-primary", "static-operation-expand", "static-task-center-toggle", "static-connection-save-clear", "static-connection-save-connect"]) {
  if (!staticActions.includes(token)) throw new Error(`静态控件事件边界缺少：${token}`);
}
const docking = fs.readFileSync(path.resolve("public/app-docking.js"), "utf8");
for (const token of ["bindWorkspaceToolbarHorizontalScroll", "workspaceHorizontalScroll", "ArrowLeft", "ArrowRight"]) {
  if (!docking.includes(token)) throw new Error(`工作区工具栏滚动边界缺少：${token}`);
}
const storageSettings = fs.readFileSync(path.resolve("public/app-settings-storage.js"), "utf8");
for (const token of ["storage-settings-primary-row", "storage-settings-save", "chooseDesktopStorageMigration", "settings:auto.migrate_restart", "settings:auto.switch_restart"]) {
  if (!storageSettings.includes(token)) throw new Error(`数据存储设置布局边界缺少：${token}`);
}

const sftp = readFrontendDomain(root, "sftp");
if (!sftp.includes('ace.config.set("useStrictCSP", true)')) throw new Error("Ace 编辑器必须启用严格 CSP 模式");
if (!sftp.includes("stylesReady")) throw new Error("Ace 样式失效时必须回退普通文本编辑器");
for (const token of ["document.activeElement === searchInput", "if (!keepSearchFocus) aceEditor.focus();", "if (!keepSearchFocus) fallbackEditor.focus();"]) {
  if (!sftp.includes(token)) throw new Error(`SFTP 编辑器搜索必须保留搜索框焦点：${token}`);
}
for (const token of ["/sftp/open?path=", "response.body.getReader()", "onPauseChange", "/sftp-open-worker.js", "50 * 1024 * 1024", "sftp-action-terminal", "sftpOpenTransportInterrupted", "sftp:editor.retrying_transfer", "sftpDiffViewerHtml", "openSftpExternalComparison", "/sftp/versions?path="]) {
  if (!sftp.includes(token)) throw new Error(`SFTP 流式打开边界缺少：${token}`);
}
for (const token of [".modal-card.quick-connection-modal", ".quick-connection-table", ".quick-connection-actions-heading", "position:sticky", "right:0"]) {
  if (!css.includes(token)) throw new Error(`快速服务器列表布局边界缺少：${token}`);
}

const terminal = readFrontendDomain(root, "terminal");
if (!terminal.includes("terminal-font-size-readout")) throw new Error("终端工具栏缺少当前字号显示");
for (const token of ["queueTerminalOutput", "TERMINAL_OUTPUT_FRAME_BUDGET", "terminalOutputWriting", "terminal-action-encoding", 'icon("folder-sync")']) {
  if (!terminal.includes(token)) throw new Error(`终端响应性或工具栏边界缺少：${token}`);
}

console.log(`前端语法检查通过：${files.length} 个脚本`);
