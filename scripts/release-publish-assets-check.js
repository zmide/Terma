"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { expectedReleaseFiles, prepare, verifyRemote } = require("./release-publish-assets");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
const normalizedWorkflow = workflow.replace(/\r\n?/g, "\n");
const publishReleaseJob = normalizedWorkflow.match(/\n  publish-release:\n[\s\S]*?(?=\n  [a-zA-Z0-9_-]+:\n|$)/)?.[0] || "";
assert.equal((workflow.match(/softprops\/action-gh-release@/g) || []).length, 1);
for (const token of [
  "publish-release:",
  "needs:",
  "draft: true",
  "Verify uploaded release assets",
  "npm sbom",
  "SHA256SUMS",
  "Validate release version and revision",
  "terma-release-revision",
  "releaseRevision",
  "gh release edit \"$GITHUB_REF_NAME\" --draft=true",
  "Remove existing release assets before replacement",
  "(.apiUrl | split(\"/\")[-1])",
  "gh api --method DELETE \"repos/$GITHUB_REPOSITORY/releases/assets/$asset_id\"",
  "for attempt in 1 2 3 4 5",
  "test \"$REVISION\" -gt \"$remote_revision\"",
  "test \"$REVISION\" -ge \"$remote_revision\""
]) assert.ok(workflow.includes(token), `release workflow missing ${token}`);
assert.match(
  publishReleaseJob,
  /\n      - name: Download all platform artifacts\n        uses: actions\/download-artifact@[0-9a-f]{40}[^\n]*\n        with:\n          digest-mismatch: error\n          pattern: Terma-\*\n          path: release-assets\n          merge-multiple: true\n/,
  "publish-release must download platform artifacts with digest mismatch failure enabled"
);
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
