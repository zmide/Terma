"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readFrontendDomain } = require("./frontend-source");
const { loadFrontendService } = require("./frontend-service-test-helper");

const root = path.resolve(__dirname, "..");
const source = readFrontendDomain(root, "settings");
const styles = fs.readFileSync(path.join(root, "public", "app.css"), "utf8");
const { updateMarkdownHtml, localizedUpdateReleaseMarkdown, releaseNotesPlan, renderReleaseNotes } =
  loadFrontendService(path.join(root,'frontend/src/features/settings/release-notes-model.ts'),{URL});

const markdown = updateMarkdownHtml([
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

const unsafeLink = updateMarkdownHtml("[危险](javascript:alert(1))");
assert.doesNotMatch(unsafeLink, /<a\b/);
assert.match(unsafeLink, /javascript:alert\(1\)/);

const versionDeduplicated = updateMarkdownHtml("## v1.2.0\n\n### 重要修复\n\n正文", "1.2.0");
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
const chineseRelease = localizedUpdateReleaseMarkdown(releaseBody, "zh-CN", "Unavailable");
assert.doesNotMatch(chineseRelease, /English|<a id=/);
assert.doesNotMatch(chineseRelease, /### 简体中文/);
const renderedChineseRelease = updateMarkdownHtml(chineseRelease, "1.4.7");
assert.doesNotMatch(renderedChineseRelease, /&lt;a id=/);
assert.match(renderedChineseRelease, /<h6>重要修复<\/h6>/);
assert.match(renderedChineseRelease, /<li>修复启动问题。<\/li>/);
const renderedNavigation = updateMarkdownHtml("[English](#english)\n\n<a id=\"english\"></a>\n#### Important fixes");
assert.match(renderedNavigation, /href=\"#english\"/);
assert.doesNotMatch(renderedNavigation, /&lt;a id=/);

assert.match(styles, /\.update-release-markdown :not\(pre\) > code \{[^}]*background:color-mix\(/);
assert.doesNotMatch(styles, /\.update-release-markdown code \{[^}]*background:var\(--code\)/);
assert.match(styles, /\.update-notes \{[^}]*background:var\(--panel2,var\(--panel\)\)/);
assert.match(styles, /\.update-release-markdown a \{[^}]*color:color-mix\(/);

const {updateDownloadLinkRows,updateManualLinksAllowed}=loadFrontendService(path.join(root,'frontend/src/features/settings/update-link-model.ts'),{URL});
const asset = {name:"Terma-1.7.6-windows-x64-installer.exe", url:"https://github.com/zmide/Terma/releases/download/v1.7.6/Terma-1.7.6-windows-x64-installer.exe"};
const linkUpdate = {assets:[asset], download_status:{download_asset_name:asset.name, download_links:[
  {id:"direct", label:"GitHub", url:asset.url},
  {id:"mirror", label:"<script>mirror</script>", url:`https://ghfast.top/${asset.url}`},
  {id:"unsafe", label:"unsafe", url:"javascript:alert(1)"},
  {id:"insecure", label:"insecure", url:"http://example.com/file.exe"},
  {id:"credentials", label:"credentials", url:"https://user:pass@example.com/file.exe"}
]}};
const links = updateDownloadLinkRows(linkUpdate.download_status.download_links,[]);
assert.equal(JSON.stringify(links.map(({url})=>url.href)),JSON.stringify([asset.url,`https://ghfast.top/${asset.url}`]));
assert.equal(updateManualLinksAllowed(linkUpdate),true);
assert.equal(updateManualLinksAllowed({...linkUpdate, assets:[]}),false);
assert.equal(updateManualLinksAllowed({...linkUpdate, assets:[{...asset, name:"other.exe"}]}),false);
assert.equal(updateManualLinksAllowed({...linkUpdate, assets:[{...asset, url:asset.url.replace("v1.7.6", "v1.7.7")}]}),false);
assert.equal(updateManualLinksAllowed(null),false);

async function checkReleaseNotesScheduling() {
  const note = {version:'1.4.7', notes:releaseBody};
  const data = {release_notes:Array(12).fill(note)};
  const chinese = releaseNotesPlan(data,'zh-CN','Unavailable');
  const english = releaseNotesPlan(data,'en-US','Unavailable');
  assert.notEqual(chinese.key,english.key);
  assert.equal(chinese.entries.length,10);
  assert.notEqual(chinese.key,releaseNotesPlan({release_notes:[{...note,notes:'different'}]},'zh-CN','Unavailable').key);
  assert.equal(localizedUpdateReleaseMarkdown('只有中文','en-US','Unavailable'),'Unavailable');
  let resume;
  let active = true;
  const canceled = renderReleaseNotes(chinese,'No notes',() => active,() => new Promise(resolve => { resume = resolve; }));
  active = false;
  resume();
  assert.equal(await canceled,null);
  let frames = 0;
  const rendered = await renderReleaseNotes(english,'No notes',() => true,async () => { frames++; });
  assert.equal(frames,10);
  assert.equal(rendered.length,10);
  assert.match(rendered[0].markdown,/Important fixes/);
  assert.doesNotMatch(rendered[0].markdown,/修复启动问题/);
  assert.equal((await renderReleaseNotes(releaseNotesPlan({latest_version:'1.4.7', notes:'plain body'},'en-US','Unavailable'),'No notes',() => true))[0].markdown,'<p>plain body</p>');
  console.log('更新说明与下载链接检查通过：安全转义、语言切换、分帧、取消、边界及过期资源隔离');
}
checkReleaseNotesScheduling().catch(error => { console.error(error); process.exitCode = 1; });
