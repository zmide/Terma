const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const files = [
  "public/csp-bootstrap.js",
  "public/app-api.js",
  "public/app-utils.js",
  "public/app-workspace.js",
  "public/app-docking.js",
  "public/app-settings.js",
  "public/app-running.js",
  "public/app-batch.js",
  "public/app-logs.js",
  "public/app-connections.js",
  "public/app-terminal.js",
  "public/app-forwards.js",
  "public/app-import.js",
  "public/app-sftp.js",
  "public/app-sftp-tasks.js",
  "public/app-local-files.js",
  "public/app-actions.js",
  "public/app-productivity.js",
  "public/app-remote.js",
  "public/app.js"
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", path.resolve(file)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

const css = fs.readFileSync(path.resolve("public/app.css"), "utf8");
if (!/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/.test(css)) {
  throw new Error("public/app.css 必须保证 hidden 元素不会被组件 display 样式重新显示");
}

const html = fs.readFileSync(path.resolve("public/index.html"), "utf8");
if (!html.includes('name="terma-csp-nonce" content="__TERMA_CSP_NONCE__"')) throw new Error("主页面缺少 CSP nonce 占位符");
if (!html.includes('/csp-bootstrap.js')) throw new Error("主页面必须在组件脚本之前加载 CSP 引导脚本");
for (const asset of ["/vendor/ace/ace.css", "/vendor/ace/theme-textmate.css", "/vendor/ace/theme-tomorrow_night.css"]) {
  if (!html.includes(asset)) throw new Error(`SFTP 编辑器缺少严格 CSP 外部样式：${asset}`);
}

const cspBootstrap = fs.readFileSync(path.resolve("public/csp-bootstrap.js"), "utf8");
for (const token of ["Document.prototype.createElement", "Document.prototype.createElementNS", 'setAttribute("nonce", nonce)']) {
  if (!cspBootstrap.includes(token)) throw new Error(`CSP 引导脚本缺少动态样式 nonce：${token}`);
}
if (!html.includes('id="connExtraDiagnostics"')) throw new Error("SSH 编辑页缺少附加参数诊断视图");
if (!html.includes('id="connAdvancedOptions"')) throw new Error("SSH 编辑页缺少可折叠的高级选项");

const connections = fs.readFileSync(path.resolve("public/app-connections.js"), "utf8");
for (const token of ["validateConnectionExtraArgs", "/api/ssh/extra-args/validate", "focusConnectionExtraArgsIssue", "updateConnectionAdvancedStatus", "formatAllHealthMessage"]) {
  if (!connections.includes(token)) throw new Error(`SSH 附加参数诊断前端缺少：${token}`);
}

const sftp = fs.readFileSync(path.resolve("public/app-sftp.js"), "utf8");
if (!sftp.includes('ace.config.set("useStrictCSP", true)')) throw new Error("Ace 编辑器必须启用严格 CSP 模式");
if (!sftp.includes("stylesReady")) throw new Error("Ace 样式失效时必须回退普通文本编辑器");

const terminal = fs.readFileSync(path.resolve("public/app-terminal.js"), "utf8");
if (!terminal.includes("terminal-font-size-readout")) throw new Error("终端工具栏缺少当前字号显示");

console.log(`前端语法检查通过：${files.length} 个脚本`);
