const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowDirectory = path.resolve(__dirname, "../.github/workflows");
const findings = [];
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const getNamedStep = (workflow, name) => {
  const lineBreak = "\\r?\\n";
  const match = workflow.match(new RegExp(`(?:^|${lineBreak})      - name: ${escapeRegex(name)}${lineBreak}[\\s\\S]*?(?=${lineBreak}      - name: |${lineBreak}  [a-zA-Z0-9_-]+:${lineBreak}|$)`));
  assert.ok(match, `Regression workflow 缺少 ${name} 步骤`);
  return match[0];
};
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
const artifactName = "terma-actions-node24-smoke-${{ github.run_id }}-${{ github.run_attempt }}";
const prepareArtifactStep = getNamedStep(regressionWorkflow, "Prepare artifact round-trip fixture");
const uploadArtifactStep = getNamedStep(regressionWorkflow, "Upload artifact round-trip fixture");
const downloadArtifactStep = getNamedStep(regressionWorkflow, "Download artifact round-trip fixture");
const verifyArtifactStep = getNamedStep(regressionWorkflow, "Verify artifact round-trip digest");
assert.match(regressionWorkflow, /xvfb-run[^\n]*npm run ui:smoke/, "Regression workflow 必须在虚拟显示器中运行 Electron UI smoke");
assert.match(regressionWorkflow, /TERMA_UI_NO_SANDBOX:\s*["']?1["']?/, "Linux CI 的 Electron UI smoke 必须显式关闭不可用的 SUID sandbox");
assert.match(regressionWorkflow, /TERMA_UI_VISUAL_DIR:\s*data\/ui-visual-current/, "Electron UI smoke 必须把视觉诊断写入 artifact 目录");
assert.match(regressionWorkflow, /name:\s*Windows \/ Node\.js 22[\s\S]*runs-on:\s*windows-latest/, "Regression workflow 缺少 Windows 轻量检查");
assert.match(regressionWorkflow, /name:\s*macOS \/ Node\.js 22[\s\S]*runs-on:\s*macos-latest/, "Regression workflow 缺少 macOS 轻量检查");
assert.match(prepareArtifactStep, /mkdir -p data\/actions-node24-smoke/, "artifact 准备步骤缺少源目录");
assert.match(prepareArtifactStep, /TERMA_ACTIONS_SMOKE_SHA=.*sha256sum data\/actions-node24-smoke\/payload\.txt/, "artifact 准备步骤缺少源文件 SHA-256 记录");
assert.match(uploadArtifactStep, new RegExp(`uses: actions/upload-artifact@${node24Pins.get("actions/upload-artifact")}`), "artifact 上传步骤未使用已审核 action");
assert.ok(uploadArtifactStep.includes(`name: ${artifactName}`), "artifact 上传步骤名称不一致");
assert.match(uploadArtifactStep, /if-no-files-found: error/, "artifact 上传步骤必须在文件缺失时失败");
assert.match(uploadArtifactStep, /path: data\/actions-node24-smoke\/payload\.txt/, "artifact 上传步骤路径不一致");
assert.match(downloadArtifactStep, new RegExp(`uses: actions/download-artifact@${node24Pins.get("actions/download-artifact")}`), "artifact 下载步骤未使用已审核 action");
assert.ok(downloadArtifactStep.includes(`name: ${artifactName}`), "artifact 下载步骤名称与上传步骤不一致");
assert.match(downloadArtifactStep, /digest-mismatch: error/, "artifact 下载步骤必须在摘要不匹配时失败");
assert.match(downloadArtifactStep, /path: data\/actions-node24-roundtrip/, "artifact 下载步骤路径不一致");
assert.match(verifyArtifactStep, /test -f data\/actions-node24-roundtrip\/payload\.txt/, "artifact 校验步骤缺少下载文件检查");
assert.match(verifyArtifactStep, /sha256sum data\/actions-node24-roundtrip\/payload\.txt[^\n]*TERMA_ACTIONS_SMOKE_SHA/, "artifact 校验步骤缺少 SHA-256 比较");
assert.ok(fs.existsSync(path.resolve(__dirname, "../.github/dependabot.yml")), "仓库缺少 Dependabot 配置");
console.log("GitHub Actions 引用检查通过：Node 24 action 均固定到已审核的完整 commit SHA，并覆盖 artifact 往返摘要校验");
