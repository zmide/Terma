const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { buildRemoteScript } = require(path.join(root, "dist", "commands"));
const operationsHost = fs.readFileSync(path.join(root, "frontend/src/features/operations/workspace-operations-host.ts"), "utf8");
const workspaceHost = fs.readFileSync(path.join(root, "frontend/src/features/workspace/workspace-host.ts"), "utf8");

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

const runtime=fs.readFileSync(path.join(root,'frontend/src/features/batch/batch-service.ts'),'utf8');
const views=fs.readFileSync(path.join(root,'frontend/src/features/batch/BatchViews.ts'),'utf8');
assert.match(views,/sessions=new Map<object/,'批量命令状态按实际标签对象隔离');
assert.ok(runtime.includes("model.phase='preparing'")&&runtime.indexOf("model.phase='preparing'")<runtime.indexOf("await ask"),'确认前锁定执行参数');
assert.match(runtime,/model\.run\.invalidated=true/,'修改执行参数后永久失效旧结果');
assert.ok(operationsHost.includes("workspaceElementForTab(tab.key, '#view-command')")&&views.includes('previous.service===service'),'异步页面绑定按标签与所有者解析');
assert.ok(runtime.includes("kind==='stopped'?'stopped':'disconnected'")&&runtime.includes('for(const item of Object.values(run.results))'),'中断落到逐目标状态');
assert.ok(workspaceHost.includes("releaseCommand:key => batchServices.termaBatch.dispose(key)") && views.includes("service.scope.key===key") && runtime.includes("generation++;cleanup()"), "关闭批量标签只能停止该标签自己的任务");

console.log("Batch command check passed: script structure, tab isolation, preflight locking, result invalidation, live DOM rebinding, and interrupted states");
