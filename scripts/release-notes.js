"use strict";

const fs = require("node:fs");

function parseVersion(version) {
  const match = String(version || "").match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

function requiresBilingualRelease(version) {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  const baseline = [1, 4, 7];
  for (let index = 0; index < baseline.length; index += 1) {
    if (parsed[index] !== baseline[index]) return parsed[index] > baseline[index];
  }
  return true;
}

function validateBilingualReleaseBody(body, label="Release Notes") {
  const normalized = String(body || "").replace(/\r\n?/g, "\n");
  const navigation = normalized.indexOf("[English](#english)");
  const chineseNavigation = normalized.indexOf("[简体中文](#简体中文)");
  const englishAnchor = normalized.indexOf('<a id="english"></a>');
  const englishHeading = normalized.indexOf("### English", englishAnchor);
  const chineseAnchor = normalized.indexOf('<a id="简体中文"></a>');
  const chineseHeading = normalized.indexOf("### 简体中文", chineseAnchor);
  if (!(navigation >= 0 && chineseNavigation > navigation && englishAnchor > chineseNavigation && englishHeading > englishAnchor && chineseAnchor > englishHeading && chineseHeading > chineseAnchor)) {
    throw new Error(`${label} 必须提供快速跳转，并按 English、简体中文顺序排列`);
  }
  const english = normalized.slice(englishHeading + "### English".length, chineseAnchor).trim();
  const chinese = normalized.slice(chineseHeading + "### 简体中文".length).trim();
  if (!/^>\s+\S/m.test(english) || !/^>\s+\S/m.test(chinese)) throw new Error(`${label} 的中英文部分都必须包含版本摘要`);
  if (!/^####\s+\S/m.test(english) || !/^####\s+\S/m.test(chinese)) throw new Error(`${label} 的中英文部分都必须包含分类标题`);
  if (!/^\s*-\s+\S/m.test(english) || !/^\s*-\s+\S/m.test(chinese)) throw new Error(`${label} 的中英文部分都必须包含用户可见条目`);
  return {english, chinese};
}

function bilingualPlaceholder(version) {
  return `## ${version}\n\n[English](#english) · [简体中文](#简体中文)\n\n<a id="english"></a>\n### English\n\n> Release notes are being prepared.\n\n#### Other changes\n\n- No release notes are available yet.\n\n<a id="简体中文"></a>\n### 简体中文\n\n> 发布说明正在整理。\n\n#### 其他变化\n\n- 暂无发布说明。\n`;
}

function generateReleaseNotes() {
  const tag = process.env.GITHUB_REF_NAME || process.argv[2] || "";
  const version = tag.startsWith("v") ? tag : `v${tag}`;
  const pattern = new RegExp(`## ${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const localNotesPath = "docs/update.md";
  const publishedNotesPath = `.github/release-notes/${version}.md`;

  let body = "";
  if (fs.existsSync(publishedNotesPath)) {
    body = fs.readFileSync(publishedNotesPath, "utf8").trimEnd() + "\n";
  }
  if (!body && fs.existsSync(localNotesPath)) {
    const match = fs.readFileSync(localNotesPath, "utf8").match(pattern);
    if (match) body = `## ${version}\n${match[1].trim()}\n`;
  }
  if (!body) body = bilingualPlaceholder(version);
  if (requiresBilingualRelease(version)) validateBilingualReleaseBody(body, version);
  fs.writeFileSync("release-notes.md", body, "utf8");
}

if (require.main === module) generateReleaseNotes();

module.exports = {
  bilingualPlaceholder,
  generateReleaseNotes,
  requiresBilingualRelease,
  validateBilingualReleaseBody
};
