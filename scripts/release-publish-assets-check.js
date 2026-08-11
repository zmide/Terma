"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { expectedReleaseFiles, prepare, verifyRemote } = require("./release-publish-assets");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
const normalizedWorkflow = workflow.replace(/\r\n?/g, "\n");
assert.equal((workflow.match(/softprops\/action-gh-release@/g) || []).length, 1);
for (const token of [
  "publish-release:",
  "needs:",
  "actions/download-artifact@",
  "draft: true",
  "Verify uploaded release assets",
  "npm sbom",
  "SHA256SUMS"
]) assert.ok(workflow.includes(token), `release workflow missing ${token}`);
assert.match(
  normalizedWorkflow,
  /\n  regression:\n[\s\S]*?\n      - name: Run regression checks\n        run: npm run regression\n/,
  "release workflow must run the complete regression suite before packaging"
);
for (const job of ["windows", "linux", "macos", "linux-source"]) {
  assert.match(
    normalizedWorkflow,
    new RegExp(`\\n  ${job}:\\n    name:[^\\n]+\\n    needs: regression\\n`),
    `${job} release packaging must depend on the regression gate`
  );
}

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "terma-release-assets-"));
try {
  for (const name of expectedReleaseFiles()) fs.writeFileSync(path.join(fixture, name), name);
  prepare(fixture);
  const names = fs.readdirSync(fixture).sort((left, right) => left.localeCompare(right, "en"));
  assert.ok(names.includes("SHA256SUMS"));
  const remoteList = path.join(os.tmpdir(), `${path.basename(fixture)}-remote.txt`);
  fs.writeFileSync(remoteList, names.join("\n"));
  verifyRemote(fixture, remoteList);
  fs.rmSync(remoteList, {force:true});
  fs.rmSync(path.join(fixture, expectedReleaseFiles()[0]));
  assert.throws(() => prepare(fixture), /missing:/);
} finally {
  fs.rmSync(fixture, {recursive:true, force:true});
}

console.log("原子 Release、附件集合、SBOM 与 SHA256SUMS 检查通过");
