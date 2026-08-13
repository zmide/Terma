const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowDirectory = path.resolve(__dirname, "../.github/workflows");
const findings = [];
const node24Pins = new Map([
  ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
  ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
  ["actions/upload-artifact", "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"],
  ["actions/download-artifact", "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c"],
  ["softprops/action-gh-release", "3d0d9888cb7fd7b750713d6e236d1fcb99157228"]
]);
const seenNode24Actions = new Set();
for (const name of fs.readdirSync(workflowDirectory).filter(item => /\.ya?ml$/i.test(item))) {
  const lines = fs.readFileSync(path.join(workflowDirectory, name), "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/);
    if (!match) return;
    const [action, reference = ""] = match[1].split("@");
    if (!/^[0-9a-f]{40}$/i.test(reference)) findings.push(`${name}:${index + 1} ${match[1]}`);
    const requiredPin = node24Pins.get(action);
    if (requiredPin) {
      seenNode24Actions.add(action);
      if (reference !== requiredPin) findings.push(`${name}:${index + 1} ${action} must use Node 24 pin ${requiredPin}`);
    }
  });
}

assert.deepEqual(findings, [], `GitHub Actions 必须固定到完整 commit SHA：\n${findings.join("\n")}`);
assert.deepEqual([...seenNode24Actions].sort(), [...node24Pins.keys()].sort(), "Node 24 Actions 迁移缺少必要 action");
const regressionWorkflow = fs.readFileSync(path.join(workflowDirectory, "regression.yml"), "utf8");
assert.match(regressionWorkflow, /xvfb-run[^\n]*npm run ui:smoke/, "Regression workflow 必须在虚拟显示器中运行 Electron UI smoke");
assert.match(regressionWorkflow, /TERMA_UI_NO_SANDBOX:\s*["']?1["']?/, "Linux CI 的 Electron UI smoke 必须显式关闭不可用的 SUID sandbox");
assert.match(regressionWorkflow, /TERMA_UI_VISUAL_DIR:\s*data\/ui-visual-current/, "Electron UI smoke 必须把视觉诊断写入 artifact 目录");
assert.match(regressionWorkflow, /name:\s*Windows \/ Node\.js 22[\s\S]*runs-on:\s*windows-latest/, "Regression workflow 缺少 Windows 轻量检查");
assert.match(regressionWorkflow, /name:\s*macOS \/ Node\.js 22[\s\S]*runs-on:\s*macos-latest/, "Regression workflow 缺少 macOS 轻量检查");
assert.match(regressionWorkflow, /name:\s*Upload artifact round-trip fixture[\s\S]*name:\s*Download artifact round-trip fixture[\s\S]*name:\s*Verify artifact round-trip digest/, "Regression workflow 缺少 artifact 上传、下载和摘要往返检查");
assert.ok(fs.existsSync(path.resolve(__dirname, "../.github/dependabot.yml")), "仓库缺少 Dependabot 配置");
console.log("GitHub Actions 引用检查通过：Node 24 action 均固定到已审核的完整 commit SHA，并覆盖 artifact 往返摘要校验");
