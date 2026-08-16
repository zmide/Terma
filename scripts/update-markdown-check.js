"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { readFrontendDomain } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const source = readFrontendDomain(root, "settings");
const styles = fs.readFileSync(path.join(root, "public", "app.css"), "utf8");
const start = source.indexOf("function safeUpdateMarkdownUrl");
const end = source.indexOf("function formatUpdateBytes", start);
assert.ok(start >= 0 && end > start, "更新说明 Markdown 渲染器应存在");

const context = {
  URL,
  esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[character]));
  },
  escAttr(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[character]));
  }
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

const markdown = context.updateMarkdownHtml([
  "## 重要更新",
  "",
  "- **任务中心**支持 `local-delivery`。",
  "- 查看 [项目主页](https://github.com/zmide/Terma)。",
  "",
  "> 后台任务会显示实时状态。",
  "",
  "```sh",
  "echo safe",
  "```",
  "",
  "<script>alert('blocked')</script>"
].join("\n"));

assert.match(markdown, /<h5>重要更新<\/h5>/);
assert.match(markdown, /<strong>任务中心<\/strong>/);
assert.match(markdown, /<code>local-delivery<\/code>/);
assert.match(markdown, /<a href="https:\/\/github\.com\/zmide\/Terma"/);
assert.match(markdown, /rel="noopener noreferrer"/);
assert.match(markdown, /<blockquote>/);
assert.match(markdown, /<pre><code>echo safe<\/code><\/pre>/);
assert.match(markdown, /&lt;script&gt;alert\(&#39;blocked&#39;\)&lt;\/script&gt;/);
assert.doesNotMatch(markdown, /<script>/);

const unsafeLink = context.updateMarkdownHtml("[危险](javascript:alert(1))");
assert.doesNotMatch(unsafeLink, /<a\b/);
assert.match(unsafeLink, /javascript:alert\(1\)/);

const versionDeduplicated = context.updateMarkdownHtml("## v1.2.0\n\n### 重要修复\n\n正文", "1.2.0");
assert.doesNotMatch(versionDeduplicated, />v1\.2\.0</);
assert.match(versionDeduplicated, /<h6>重要修复<\/h6>/);

const releaseBody = [
  "[English](#english) · [简体中文](#简体中文)",
  "",
  "<a id=\"english\"></a>",
  "### English",
  "",
  "> English summary",
  "",
  "#### Important fixes",
  "",
  "- Fixed the startup issue.",
  "",
  "<a id=\"简体中文\"></a>",
  "### 简体中文",
  "",
  "> 中文摘要",
  "",
  "#### 重要修复",
  "",
  "- 修复启动问题。"
].join("\n");
context.document = {documentElement:{lang:"zh-CN"}};
context.tr = (_key, options) => options?.defaultValue || "";
const chineseRelease = context.localizedUpdateReleaseMarkdown(releaseBody);
assert.doesNotMatch(chineseRelease, /English|<a id=/);
assert.doesNotMatch(chineseRelease, /### 简体中文/);
const renderedChineseRelease = context.updateMarkdownHtml(chineseRelease, "1.4.7");
assert.doesNotMatch(renderedChineseRelease, /&lt;a id=/);
assert.match(renderedChineseRelease, /<h6>重要修复<\/h6>/);
assert.match(renderedChineseRelease, /<li>修复启动问题。<\/li>/);
const renderedNavigation = context.updateMarkdownHtml("[English](#english)\n\n<a id=\"english\"></a>\n#### Important fixes");
assert.match(renderedNavigation, /href=\"#english\"/);
assert.doesNotMatch(renderedNavigation, /&lt;a id=/);

assert.match(styles, /\.update-release-markdown :not\(pre\) > code \{[^}]*background:color-mix\(/);
assert.doesNotMatch(styles, /\.update-release-markdown code \{[^}]*background:var\(--code\)/);
assert.match(styles, /\.update-notes \{[^}]*background:var\(--panel2,var\(--panel\)\)/);
assert.match(styles, /\.update-release-markdown a \{[^}]*color:color-mix\(/);

console.log("更新说明 Markdown 渲染检查通过：版本标题去重、主题代码样式、链接、代码和 HTML 转义正常");
