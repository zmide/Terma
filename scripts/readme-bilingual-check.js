"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const english = fs.readFileSync(path.join(root, "README.md"), "utf8").replace(/\r\n?/g, "\n");
const chinese = fs.readFileSync(path.join(root, "README.zh-CN.md"), "utf8").replace(/\r\n?/g, "\n");

assert.match(english, /^<p align="right"><strong>English<\/strong> · <a href="README\.zh-CN\.md">简体中文<\/a><\/p>/);
assert.match(chinese, /^<p align="right"><a href="README\.md">English<\/a> · <strong>简体中文<\/strong><\/p>/);

function fencedBlocks(markdown) {
  return [...markdown.matchAll(/^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm)].map(match => ({
    language:match[1].trim(),
    body:match[2].trimEnd()
  }));
}

function withoutFences(markdown) {
  return markdown.replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, "");
}

function headingLevels(markdown) {
  return [...withoutFences(markdown).matchAll(/^(#{1,6})\s+.+$/gm)].map(match => match[1].length);
}

function technicalCode(markdown) {
  return [...withoutFences(markdown).matchAll(/`([^`\n]+)`/g)]
    .map(match => match[1])
    .sort((left, right) => left.localeCompare(right, "en"));
}

function assetSources(markdown) {
  return [...markdown.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)]
    .map(match => match[1])
    .sort((left, right) => left.localeCompare(right, "en"));
}

function normalizedAssetSources(markdown) {
  return assetSources(markdown).map(source => source.replace(/\.github\/assets\/screenshots\/(?:en-US|zh-CN)\//, ".github/assets/screenshots/")).sort((left, right) => left.localeCompare(right, "en"));
}

function linkDestinations(markdown) {
  const markdownLinks = [...markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(match => match[1]);
  const htmlLinks = [...markdown.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map(match => match[1]);
  return [...markdownLinks, ...htmlLinks]
    .filter(destination => destination !== "README.md" && destination !== "README.zh-CN.md")
    .sort((left, right) => left.localeCompare(right, "en"));
}

function markdownTableShape(markdown) {
  return withoutFences(markdown)
    .split("\n")
    .filter(line => /^\s*\|.*\|\s*$/.test(line))
    .map(line => (line.match(/\|/g) || []).length);
}

function htmlTableShape(markdown) {
  return ["table", "tr", "td"].map(tag => (markdown.match(new RegExp(`<${tag}\\b`, "g")) || []).length);
}

const englishBlocks = fencedBlocks(english);
const chineseBlocks = fencedBlocks(chinese);
assert.deepEqual(headingLevels(english), headingLevels(chinese), "中英文 README 标题层级必须保持一致");
assert.deepEqual(technicalCode(english), technicalCode(chinese), "中英文 README 的行内命令、路径和技术标识必须保持一致");
assert.deepEqual(normalizedAssetSources(english), normalizedAssetSources(chinese), "中英文 README 必须引用同一组截图");
assert(assetSources(english).every(source => source.includes(".github/assets/screenshots/en-US/")), "英文 README 必须引用英文截图");
assert(assetSources(chinese).every(source => source.includes(".github/assets/screenshots/zh-CN/")), "中文 README 必须引用中文截图");
assert.deepEqual(linkDestinations(english), linkDestinations(chinese), "中英文 README 的外部链接和项目文件链接必须保持一致");
assert.deepEqual(markdownTableShape(english), markdownTableShape(chinese), "中英文 README 的 Markdown 表格结构必须保持一致");
assert.deepEqual(htmlTableShape(english), htmlTableShape(chinese), "中英文 README 的截图表格结构必须保持一致");
assert.deepEqual(englishBlocks.map(block => block.language), chineseBlocks.map(block => block.language), "中英文 README 的代码块顺序和语言必须保持一致");

for (let index = 0; index < englishBlocks.length; index += 1) {
  const left = englishBlocks[index];
  const right = chineseBlocks[index];
  if (["sh", "bash", "bat", "powershell", "nginx"].includes(left.language)) {
    const executableLines = body => body.split("\n").filter(line => !/^\s*#/.test(line)).join("\n").trim();
    assert.equal(executableLines(left.body), executableLines(right.body), `中英文 README 的第 ${index + 1} 个命令块必须保持一致`);
    continue;
  }
  assert.equal(left.body.split("\n").length, right.body.split("\n").length, `中英文 README 的第 ${index + 1} 个代码块行数必须保持一致`);
}

const englishBullets = (withoutFences(english).match(/^\s*-\s+/gm) || []).length;
const chineseBullets = (withoutFences(chinese).match(/^\s*-\s+/gm) || []).length;
assert.equal(englishBullets, chineseBullets, "中英文 README 的功能与说明条目数量必须保持一致");

console.log("README 双语同步检查通过：结构、命令、链接、截图、表格和技术标识一致");
