const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { indexScriptFiles, readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const files = indexScriptFiles(root, { includeBootstrap:true });

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

const css = fs.readFileSync(path.resolve("public/app.css"), "utf8");
if (!/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/.test(css)) {
  throw new Error("public/app.css 必须保证 hidden 元素不会被组件 display 样式重新显示");
}
const sftpSearchRule = css.match(/\.sftp-floating-search\s*\{([^}]*)\}/)?.[1] || "";
if (!/\bposition\s*:\s*static\b/.test(sftpSearchRule) || /\bposition\s*:\s*absolute\b/.test(sftpSearchRule)) {
  throw new Error("SFTP 搜索框必须位于路径栏后的正常文档流，不能残留旧的绝对定位");
}

const html = fs.readFileSync(path.resolve("public/index.html"), "utf8");
if (!html.includes('name="terma-csp-nonce" content="__TERMA_CSP_NONCE__"')) throw new Error("主页面缺少 CSP nonce 占位符");
if (!html.includes("?v=__TERMA_VERSION__") || /[?&]v=\d+\.\d+\.\d+/.test(html)) throw new Error("主页面静态资源必须统一使用版本占位符");
if (!html.includes('/csp-bootstrap.js')) throw new Error("主页面必须在组件脚本之前加载 CSP 引导脚本");
for (const asset of ["/vendor/ace/ace.css", "/vendor/ace/theme-textmate.css", "/vendor/ace/theme-tomorrow_night.css", "/vendor/diff/diff.min.js", "/vendor/jspdf/jspdf.umd.min.js", "/vendor/svg2pdf/svg2pdf.umd.min.js", "/vendor/i18next/i18next.min.js"]) {
  if (!html.includes(asset)) throw new Error(`SFTP 编辑器缺少严格 CSP 外部样式：${asset}`);
}
const pdfFontPath = path.resolve("public", "fonts", "NotoSansSC-Regular.ttf");
if (!fs.existsSync(pdfFontPath) || fs.statSync(pdfFontPath).size < 1000000) throw new Error("SVG PDF 导出缺少可嵌入的中文字体");
const pdfFontLicensePath = path.resolve("public", "fonts", "OFL.txt");
if (!fs.existsSync(pdfFontLicensePath) || !fs.readFileSync(pdfFontLicensePath, "utf8").includes("SIL OPEN FONT LICENSE Version 1.1")) throw new Error("SVG PDF 导出字体缺少 OFL 许可证文本");

const cspBootstrap = fs.readFileSync(path.resolve("public/csp-bootstrap.js"), "utf8");
for (const token of ["Document.prototype.createElement", "Document.prototype.createElementNS", 'setAttribute("nonce", nonce)']) {
  if (!cspBootstrap.includes(token)) throw new Error(`CSP 引导脚本缺少动态样式 nonce：${token}`);
}
if (!html.includes('id="connExtraDiagnostics"')) throw new Error("SSH 编辑页缺少附加参数诊断视图");
if (!html.includes('id="connAdvancedOptions"')) throw new Error("SSH 编辑页缺少可折叠的高级选项");

const connectionActions = fs.readFileSync(path.join(root, "frontend/src/shared/static-action-registry.ts"), "utf8");
const connectionViews = fs.readFileSync(path.join(root, "frontend/src/features/connections/connection-views.ts"), "utf8");
const validationActions = fs.readFileSync(path.join(root, "frontend/src/features/connections/connection-validation-actions-service.ts"), "utf8");
for (const token of ["/api/ssh/extra-args/validate", "schedule(form", "ensureValid(form"]) {
  if (!validationActions.includes(token)) throw new Error(`SSH 附加参数校验服务缺少：${token}`);
}
const validationView = fs.readFileSync(path.join(root, "frontend/src/features/connections/connection-validation-view.ts"), "utf8");
for (const token of ["focusExtraArgsIssue", "updateAdvancedStatus", "refreshExtraArgsLanguage"]) {
  if (!validationView.includes(token)) throw new Error(`SSH 附加参数诊断前端缺少：${token}`);
}
const healthRuntime = fs.readFileSync(path.join(root, "frontend/src/features/connections/connection-health-runtime.ts"), "utf8");
for (const token of ["formatAllHealthMessage", "createProgressToast"]) {
  if (!healthRuntime.includes(token)) throw new Error(`连接状态展示缺少：${token}`);
}
if (/\son(?:click|change|input|dblclick|contextmenu|keydown|submit|drag\w*|drop)=/i.test(connectionViews)) {
  throw new Error("连接模块必须使用 app-utils.js 事件委托，不能重新加入内联事件");
}
for (const [attribute, action] of [["data-action", "connection-open-terminal"], ["data-change-action", "connection-select"]]) {
  const vue = `"${attribute}": "${action}"`;
  if (!connectionActions.includes(`'${action}':`) || !connectionViews.includes(vue)) throw new Error(`连接视图缺少事件委托边界：${action}`);
}

for (const [label, source] of [
  ["public/index.html", html],
  ["工作区模块", readFrontendDomain(root, "docking")],
  ["frontend/src/features/files/LocalFilesView.ts", fs.readFileSync(path.join(root, "frontend/src/features/files", "LocalFilesView.ts"), "utf8")]
]) {
  if (/\son[a-z]+=/i.test(source)) throw new Error(`${label} 必须使用 app-utils.js 事件委托，不能重新加入内联事件`);
}
const staticActions = fs.readFileSync(path.resolve("frontend/src/shared/static-action-registry.ts"), "utf8");
for (const token of ["static-primary", "static-operation-expand", "static-task-center-toggle", "static-connection-save-clear", "static-connection-save-connect"]) {
  if (!staticActions.includes(token)) throw new Error(`静态控件事件边界缺少：${token}`);
}
const toolbarPlacement = fs.readFileSync(path.resolve("frontend/src/features/workspace/workspace-toolbar-placement.ts"), "utf8");
for (const token of ["bindWorkspaceToolbarHorizontalScroll", "workspaceHorizontalScroll", "ArrowLeft", "ArrowRight"]) {
  if (!toolbarPlacement.includes(token)) throw new Error(`工作区工具栏滚动边界缺少：${token}`);
}
const storageSettings = fs.readFileSync(path.resolve("frontend/src/features/settings/desktop-storage-controller.ts"), "utf8")
  + fs.readFileSync(path.resolve("frontend/src/features/settings/general-view.ts"), "utf8");
for (const token of ["storage-settings-primary-row", "storage-settings-save", "saveDesktopSettings", "settings:auto.migrate_restart", "settings:auto.switch_restart"]) {
  if (!storageSettings.includes(token)) throw new Error(`数据存储设置布局边界缺少：${token}`);
}

const sftp = readFrontendDomain(root, "sftp")
  + fs.readFileSync(path.resolve("frontend/src/features/files/sftp/file-open-service.ts"), "utf8")
  + fs.readFileSync(path.resolve("frontend/src/features/files/sftp/text-codec.ts"), "utf8")
  + fs.readFileSync(path.resolve("frontend/src/features/files/sftp/editor-runtime.ts"), "utf8")
  + fs.readFileSync(path.resolve("frontend/src/features/files/sftp/preview-workspace.ts"), "utf8")
  + fs.readFileSync(path.resolve("frontend/src/features/files/sftp/SftpView.ts"), "utf8");
if (!sftp.includes('ace.config.set("useStrictCSP", true)')) throw new Error("Ace 编辑器必须启用严格 CSP 模式");
if (!sftp.includes("stylesReady")) throw new Error("Ace 样式失效时必须回退普通文本编辑器");
for (const token of ["replaceEditorMatches(false)", "replaceEditorMatches(true)", "aceEditor.session.markUndoGroup()", "setRangeText(replacement"]) {
  if (!sftp.includes(token)) throw new Error(`SFTP 编辑器搜索替换边界缺少：${token}`);
}
for (const token of ["/sftp/open?path=", "response.body.getReader()", "onPauseChange", "50 * 1024 * 1024", "sftp-action-terminal", "transportInterrupted", "sftp:editor.retrying_transfer", "editorDiff(", "/sftp/versions?path="]) {
  if (!sftp.includes(token)) throw new Error(`SFTP 流式打开边界缺少：${token}`);
}
if (!fs.readFileSync(path.resolve('frontend/src/features/files/sftp/file-workflow.ts'), 'utf8').includes('termaSftpComparisonViews!.show')) throw new Error('External comparison must use the typed comparison view owner');
if (!fs.readFileSync(path.resolve('frontend/src/entries/about-embed.ts'), 'utf8').includes('sftp-open-worker?worker&inline')) throw new Error('SFTP worker must be included in the same-origin frontend build');
for (const token of [".modal-card.quick-connection-modal", ".quick-connection-table", ".quick-connection-actions-heading", "position:sticky", "right:0"]) {
  if (!css.includes(token)) throw new Error(`快速服务器列表布局边界缺少：${token}`);
}

const terminal = readFrontendDomain(root, "terminal");
const terminalToolbar = fs.readFileSync(path.resolve('frontend/src/features/terminal/TerminalToolbarView.ts'), 'utf8');
if (!terminalToolbar.includes("terminal-font-size-readout")) throw new Error("终端工具栏缺少当前字号显示");
for (const token of ["termaTerminalOutputFlow.queue", "termaTerminalOutputFlow"]) {
  if (!terminal.includes(token)) throw new Error(`终端响应性或工具栏边界缺少：${token}`);
}
const terminalOutputOwner = fs.readFileSync(path.resolve('frontend/src/features/terminal/terminal-output-flow-service.ts'), 'utf8');
for (const token of ['TERMINAL_OUTPUT_FRAME_BUDGET = 32 * 1024', 'terminalOutputGeneration', 'terminalOutputWriting']) {
  if (!terminalOutputOwner.includes(token)) throw new Error(`终端输出所有者边界缺少：${token}`);
}
const terminalAiTracker=fs.readFileSync(path.resolve('frontend/src/features/assistant/terminal-ai-tracker.ts'),'utf8');
for (const token of ['terminalOutputWriting','pendingTerminalOutput','port.current(session)','port.scope(key)']) {
  if (!terminalAiTracker.includes(token)) throw new Error(`终端助手跟踪所有者边界缺少：${token}`);
}
for (const token of ['terminal-action-encoding', "'folder-sync'", 'actionsPort?.sftp(model.connectionId)']) {
  if (!terminalToolbar.includes(token)) throw new Error(`终端工具栏所有者缺少：${token}`);
}

console.log(`前端语法检查通过：${files.length} 个脚本`);
