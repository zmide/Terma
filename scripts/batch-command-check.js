const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { buildRemoteScript } = require(path.join(root, "dist", "commands"));
const frontend = fs.readFileSync(path.join(root, "public", "app-batch.js"), "utf8");
const docking = fs.readFileSync(path.join(root, "public", "app-docking.js"), "utf8");

const command = [
  "if [ -f /tmp/terma-example ]; then",
  "  printf '%s\\n' 'kept indentation'  ",
  "fi",
  "cat <<'EOF'",
  "line one",
  "line two",
  "EOF",
  "printf '%s\\n' https://example.com/a%20b"
].join("\n");
const expectedQuote = `'${command.replace(/'/g, `'\\''`)}'`;
const remoteScript = buildRemoteScript(command);

assert.ok(remoteScript.includes(`terma_cmd=${expectedQuote}`), "完整脚本必须作为一个值原样传给远端 shell");
assert.equal((remoteScript.match(/eval \"\$terma_cmd\"/g) || []).length, 1, "完整脚本只能统一执行一次");
assert.doesNotMatch(remoteScript, /terma_run\s+'if /, "不能把控制结构拆成逐行 eval");

assert.match(frontend, /const batchCommandStates = new Map\(\)/, "批量命令状态必须按标签隔离");
assert.match(frontend, /state\.preflight = true;[\s\S]*updateBatchCommandUi\(root, state\.export\)/, "确认和预检前必须立即锁定界面");
assert.match(frontend, /state\.export\.invalidated = true/, "修改执行参数后必须永久失效旧结果");
assert.match(frontend, /workspaceElementForTab\(batchCommandStateKey\(tabKey\), "#view-command"\)/, "异步事件必须重新解析当前标签 DOM");
assert.match(frontend, /item\.state = state\.export\.stop_requested \? "stopped" : "disconnected"/, "停止和断开必须落到逐目标状态");
assert.match(docking, /stopBatchCommand\(key\)/, "关闭批量标签只能停止该标签自己的任务");

console.log("Batch command check passed: script structure, tab isolation, preflight locking, result invalidation, live DOM rebinding, and interrupted states");
