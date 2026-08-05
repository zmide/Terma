const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-sync-check-"));
process.env.TUNNELDESK_DATA_DIR = path.join(root, "data");
const workspace = path.join(root, "workspace");

try {
  fs.mkdirSync(path.join(workspace, ".git"), {recursive:true});
  fs.mkdirSync(path.join(workspace, "node_modules"));
  fs.mkdirSync(path.join(workspace, "src"));
  fs.writeFileSync(path.join(workspace, ".git", "config"), "ignored");
  fs.writeFileSync(path.join(workspace, "node_modules", "module.js"), "ignored");
  fs.writeFileSync(path.join(workspace, "src", "main.js"), "kept");
  fs.writeFileSync(path.join(workspace, "debug.log"), "custom ignored");
  fs.writeFileSync(path.join(workspace, "scratch.tmp"), "default ignored");
  const { syncTestHelpers } = require("../dist/sftp-sync");
  const items = syncTestHelpers.localTree(workspace, syncTestHelpers.exclusionMatchers("*.log"));
  assert.deepEqual([...items.keys()], ["src/main.js"]);
  assert.throws(() => syncTestHelpers.checkedLocalTarget(workspace, "../outside"), /越界/);
  assert.equal(syncTestHelpers.checkedLocalTarget(workspace, "src/main.js"), path.join(workspace, "src", "main.js"));

  const frontend = fs.readFileSync(path.join(__dirname, "..", "public", "app-productivity.js"), "utf8");
  const tasks = ["app-sftp.js", "app-sftp-tasks.js"].map(file => fs.readFileSync(path.join(__dirname, "..", "public", file), "utf8")).join("\n");
  assert.match(frontend, /生成变更清单/);
  assert.match(frontend, /上传本地版本/);
  assert.match(frontend, /selected_indexes/);
  assert.match(tasks, /retrySftpSyncJob/);
  assert.match(tasks, /exportSftpSyncResult/);
  console.log("SFTP 目录同步检查通过：排除规则、路径边界、冲突预览、任务重试和结果导出均已覆盖");
} finally {
  try { require("../dist/db").closeDatabase(); } catch {}
  fs.rmSync(root, {recursive:true, force:true});
}
