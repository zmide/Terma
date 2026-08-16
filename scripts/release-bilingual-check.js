"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  bilingualPlaceholder,
  requiresBilingualRelease,
  validateBilingualReleaseBody
} = require("./release-notes");

const root = path.resolve(__dirname, "..");
const update = fs.readFileSync(path.join(root, "docs", "update.md"), "utf8").replace(/\r\n?/g, "\n");
assert.match(update, /^# Terma Release Notes \/ 更新记录\s*$/m, "更新草稿标题应明确为双语");
const draftMatch = update.match(/^## Next release draft \/ 下一版草稿\s*\n([\s\S]*?)(?=^##\s)/m);
assert.ok(draftMatch, "docs/update.md 顶部应包含双语的下一版草稿");
const draftSections = validateBilingualReleaseBody(draftMatch[1], "下一版草稿");

function bulletCount(markdown) {
  return (markdown.match(/^\s*-\s+/gm) || []).length;
}

function technicalTokens(markdown) {
  return [...markdown.matchAll(/`([^`\n]+)`/g)].map(match => match[1]).sort((left, right) => left.localeCompare(right, "en"));
}

function linkDestinations(markdown) {
  return [...markdown.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map(match => match[1])
    .sort((left, right) => left.localeCompare(right, "en"));
}

function assertSynchronizedSections(sections, label) {
  assert.equal((sections.english.match(/^####\s+/gm) || []).length, (sections.chinese.match(/^####\s+/gm) || []).length, `${label} 的中英文分类数量必须一致`);
  assert.equal(bulletCount(sections.english), bulletCount(sections.chinese), `${label} 的中英文条目数量必须一致`);
  assert.deepEqual(technicalTokens(sections.english), technicalTokens(sections.chinese), `${label} 的中英文技术标识必须一致`);
  assert.deepEqual(linkDestinations(sections.english), linkDestinations(sections.chinese), `${label} 的中英文链接目标必须一致`);
}

assertSynchronizedSections(draftSections, "下一版草稿");
validateBilingualReleaseBody(bilingualPlaceholder("v9.9.9"), "双语空说明模板");

const releaseNotesDirectory = path.join(root, ".github", "release-notes");
for (const name of fs.readdirSync(releaseNotesDirectory)) {
  const match = name.match(/^v(\d+)\.(\d+)\.(\d+)\.md$/);
  if (!match || !requiresBilingualRelease(`v${match[1]}.${match[2]}.${match[3]}`)) continue;
  const sections = validateBilingualReleaseBody(fs.readFileSync(path.join(releaseNotesDirectory, name), "utf8"), name);
  assertSynchronizedSections(sections, name);
}

console.log("Release Notes 双语检查通过：英文在前、中文在后、快速跳转与条目同步正常");
