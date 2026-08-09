const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FRONTEND_DOMAINS, indexScriptFiles } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const scripts = indexScriptFiles(root);
const basenames = scripts.map(file => path.basename(file));
const MAX_BUSINESS_MODULE_LINES = 1400;

assert.equal(new Set(scripts).size, scripts.length, "index.html 不能重复加载前端业务脚本");

for (const file of scripts) {
  const absolute = path.join(root, file);
  assert.equal(fs.existsSync(absolute), true, `前端模块不存在：${file}`);
  const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/).length;
  assert.ok(lines <= MAX_BUSINESS_MODULE_LINES, `${file} 已增长到 ${lines} 行，请先按领域继续拆分`);
}

for (const [domain, files] of Object.entries(FRONTEND_DOMAINS)) {
  const positions = files.map(file => basenames.indexOf(file));
  assert.equal(positions.every(position => position >= 0), true, `${domain} 领域模块没有全部加载`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, `${domain} 领域模块加载顺序错误`);
  for (let index = 1; index < positions.length; index += 1) {
    assert.equal(positions[index], positions[index - 1] + 1, `${domain} 领域模块必须连续加载`);
  }
}

assert.ok(fs.readFileSync(path.join(root, "public", "app.js"), "utf8").split(/\r?\n/).length <= 300, "app.js 只能保留启动编排");
assert.ok(fs.readFileSync(path.join(root, "public", "app-state.js"), "utf8").split(/\r?\n/).length <= 200, "app-state.js 只能保留共享状态边界");

console.log(`前端模块边界检查通过：${scripts.length} 个脚本，单文件上限 ${MAX_BUSINESS_MODULE_LINES} 行`);
