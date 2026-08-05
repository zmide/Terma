const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const files = [
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

console.log(`前端语法检查通过：${files.length} 个脚本`);
