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
    if (match[1].startsWith("./")) {
      if (!/^\.\/\.github\/workflows\/[a-zA-Z0-9_-]+\.ya?ml$/.test(match[1])
        || !fs.existsSync(path.resolve(workflowDirectory, "../..", match[1]))
        || !fs.lstatSync(path.resolve(workflowDirectory, "../..", match[1])).isFile()) findings.push(`${name}:${index + 1} invalid local workflow ${match[1]}`);
      return;
    }
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
const visibilityArtifactStep = getNamedStep(regressionWorkflow, "Wait for artifact visibility");
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
assert.match(uploadArtifactStep, /id: roundtrip-upload/, "artifact 上传步骤必须提供本次实际上传 ID");
assert.match(uploadArtifactStep, /if-no-files-found: error/, "artifact 上传步骤必须在文件缺失时失败");
assert.match(uploadArtifactStep, /path: data\/actions-node24-smoke\/payload\.txt/, "artifact 上传步骤路径不一致");
assert.match(visibilityArtifactStep, /timeout-minutes: 2/, "artifact 可见性等待必须有时间上限");
assert.ok(visibilityArtifactStep.includes("TERMA_ARTIFACT_ID: ${{ steps.roundtrip-upload.outputs.artifact-id }}"), "可见性等待必须核对实际上传 ID");
assert.ok(regressionWorkflow.indexOf(visibilityArtifactStep) < regressionWorkflow.indexOf(downloadArtifactStep), "artifact 可见性检查必须先于下载");
assert.match(downloadArtifactStep, new RegExp(`uses: actions/download-artifact@${node24Pins.get("actions/download-artifact")}`), "artifact 下载步骤未使用已审核 action");
assert.ok(downloadArtifactStep.includes("artifact-ids: ${{ steps.roundtrip-upload.outputs.artifact-id }}"), "artifact 下载必须使用本次上传返回的 ID");
assert.ok(downloadArtifactStep.includes("github-token: ${{ github.token }}"), "artifact 下载必须通过当前工作流的只读 API 权限访问");
assert.doesNotMatch(downloadArtifactStep, /^\s+name: terma-actions-/m, "artifact ID 和名称不能同时指定");
assert.match(regressionWorkflow, /name: Ubuntu \/ Node\.js 22[\s\S]*?permissions:\s+contents: read\s+actions: read/, "artifact 回读只需要 contents/actions 只读权限");
assert.match(downloadArtifactStep, /digest-mismatch: error/, "artifact 下载步骤必须在摘要不匹配时失败");
assert.match(downloadArtifactStep, /path: data\/actions-node24-roundtrip/, "artifact 下载步骤路径不一致");
assert.match(verifyArtifactStep, /test -f data\/actions-node24-roundtrip\/payload\.txt/, "artifact 校验步骤缺少下载文件检查");
assert.match(verifyArtifactStep, /sha256sum data\/actions-node24-roundtrip\/payload\.txt[^\n]*TERMA_ACTIONS_SMOKE_SHA/, "artifact 校验步骤缺少 SHA-256 比较");
assert.ok(fs.existsSync(path.resolve(__dirname, "../.github/dependabot.yml")), "仓库缺少 Dependabot 配置");

// Execute the actual workflow shell against an isolated API fixture. Windows
// source checks do not depend on a Unix shell; this runs in the Ubuntu gate.
if (process.platform !== "win32") {
  const {spawnSync} = require("node:child_process");
  const directory = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "terma-artifact-visibility-"));
  const stateFile = path.join(directory, "state.json");
  const waitScript = visibilityArtifactStep.match(/        run: \|\r?\n([\s\S]*)/)[1]
    .split(/\r?\n/).map(line => line.replace(/^          /, "")).join("\n");
  try {
    fs.writeFileSync(path.join(directory, "gh"), `#!/usr/bin/env node
const fs=require("node:fs"),file=process.env.TERMA_VISIBILITY_STATE;
let state;try{state=JSON.parse(fs.readFileSync(file,"utf8"));}catch{state={calls:[],sleeps:[]};}
state.calls.push(process.argv.slice(2));fs.writeFileSync(file,JSON.stringify(state));
const mode=process.env.TERMA_VISIBILITY_MODE,count=state.calls.length;
if(mode==="api-error"&&count<3)process.exit(1);
if(mode==="ready"||mode==="api-error"||mode==="delayed"&&count>=3)console.log("12345");
if(mode==="wrong")console.log("99999");
`, {mode:0o700});
    fs.writeFileSync(path.join(directory, "sleep"), `#!/usr/bin/env node
const fs=require("node:fs"),file=process.env.TERMA_VISIBILITY_STATE;
const state=JSON.parse(fs.readFileSync(file,"utf8"));
state.sleeps.push(process.argv[2]);fs.writeFileSync(file,JSON.stringify(state));
`, {mode:0o700});
    for (const [mode, id, status, calls, sleeps] of [
      ["ready", "12345", 0, 1, 0],
      ["delayed", "12345", 0, 3, 2],
      ["api-error", "12345", 0, 3, 2],
      ["missing", "12345", 1, 12, 11],
      ["wrong", "12345", 1, 12, 11],
      ["ready", "invalid-id", 1, 0, 0]
    ]) {
      fs.writeFileSync(stateFile, JSON.stringify({calls:[], sleeps:[]}));
      const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", waitScript], {
        encoding:"utf8", timeout:10000,
        env:{...process.env, PATH:directory + path.delimiter + process.env.PATH,
          GH_TOKEN:"fixture", GITHUB_REPOSITORY:"fixture/project", GITHUB_RUN_ID:"42",
          TERMA_ARTIFACT_ID:id, TERMA_VISIBILITY_MODE:mode, TERMA_VISIBILITY_STATE:stateFile}
      });
      assert.equal(result.status, status, `${mode}: ${result.error || result.stderr || result.stdout}`);
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      assert.equal(state.calls.length, calls, mode);
      assert.deepEqual(state.sleeps, Array(sleeps).fill("5"), mode);
      for (const args of state.calls) {
        assert.deepEqual(args, ["api", "-H", "Cache-Control: no-cache",
          "repos/fixture/project/actions/runs/42/artifacts?per_page=100",
          "--jq", ".artifacts[] | select(.expired == false) | .id"]);
      }
    }
    console.log("Artifact visibility checks passed: delayed indexing, API recovery, exact ID, bounded failure, invalid input");
  } finally {
    fs.rmSync(directory, {recursive:true, force:true});
  }
}
console.log("GitHub Actions 引用检查通过：Node 24 action 均固定到已审核的完整 commit SHA，并覆盖 artifact 往返摘要校验");
