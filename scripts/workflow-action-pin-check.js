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
console.log("GitHub Actions 引用检查通过：所有 workflow action 均固定到完整 commit SHA");
