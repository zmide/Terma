const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowDirectory = path.resolve(__dirname, "../.github/workflows");
const findings = [];
for (const name of fs.readdirSync(workflowDirectory).filter(item => /\.ya?ml$/i.test(item))) {
  const lines = fs.readFileSync(path.join(workflowDirectory, name), "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/);
    if (!match) return;
    const reference = match[1].split("@").at(-1) || "";
    if (!/^[0-9a-f]{40}$/i.test(reference)) findings.push(`${name}:${index + 1} ${match[1]}`);
  });
}

assert.deepEqual(findings, [], `GitHub Actions 必须固定到完整 commit SHA：\n${findings.join("\n")}`);
const regressionWorkflow = fs.readFileSync(path.join(workflowDirectory, "regression.yml"), "utf8");
assert.match(regressionWorkflow, /xvfb-run[^\n]*npm run ui:smoke/, "Regression workflow 必须在虚拟显示器中运行 Electron UI smoke");
assert.match(regressionWorkflow, /TERMA_UI_NO_SANDBOX:\s*["']?1["']?/, "Linux CI 的 Electron UI smoke 必须显式关闭不可用的 SUID sandbox");
assert.match(regressionWorkflow, /TERMA_UI_VISUAL_DIR:\s*data\/ui-visual-current/, "Electron UI smoke 必须把视觉诊断写入 artifact 目录");
assert.match(regressionWorkflow, /name:\s*Windows \/ Node\.js 22[\s\S]*runs-on:\s*windows-latest/, "Regression workflow 缺少 Windows 轻量检查");
assert.match(regressionWorkflow, /name:\s*macOS \/ Node\.js 22[\s\S]*runs-on:\s*macos-latest/, "Regression workflow 缺少 macOS 轻量检查");
assert.ok(fs.existsSync(path.resolve(__dirname, "../.github/dependabot.yml")), "仓库缺少 Dependabot 配置");
console.log("GitHub Actions 引用检查通过：所有 workflow action 均固定到完整 commit SHA");
