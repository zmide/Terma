const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FRONTEND_DOMAINS, LEGACY_BUNDLE, indexScriptFiles, legacyBundleSource } = require("./frontend-source");

const root = path.resolve(__dirname, "..");
const entries = indexScriptFiles(root);
const scripts = indexScriptFiles(root, { expandLegacy:true });
const basenames = scripts.map(file => path.basename(file));
const MAX_BUSINESS_MODULE_LINES = 1400;

assert.equal(new Set(basenames).size, basenames.length, "index.html 不能重复加载前端业务脚本");
assert.equal(entries.some(file=>file===LEGACY_BUNDLE),false,"retired classic adapters must not load");
assert.equal(fs.existsSync(path.join(root,LEGACY_BUNDLE)),false,"retired classic adapters must not be emitted");
