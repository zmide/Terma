"use strict";

const assert = require("node:assert/strict");
const {accessErrorLanguage, rejectHostRequest} = require("../dist/services/access-error-page-service");

function reject(url, headers) {
  const result = {};
  rejectHostRequest({url, headers}, {
    writeHead(status, values) { result.status = status; result.headers = values; },
    end(body) { result.body = body; }
  });
  return result;
}

assert.equal(accessErrorLanguage({url:"/", headers:{"accept-language":"en-US;q=0.4,zh-CN;q=0.9"}}), "zh-CN");
assert.equal(accessErrorLanguage({url:"/?terma_access_language=en-US", headers:{"accept-language":"zh-CN"}}), "en-US");
const zh = reject("/", {host:"evil.example<script>alert(1)</script>", "accept-language":"zh-CN", accept:"text/html"});
assert.equal(zh.status, 421);
assert.match(zh.body, /lang="zh-CN"/);
assert.match(zh.body, /evil.example&lt;script&gt;/);
assert.equal(zh.body.includes("<script>"), false);
assert.equal(zh.headers["Cache-Control"], "no-store");
assert.match(zh.headers["Content-Security-Policy"], /default-src 'none'/);
assert.equal(zh.headers["Set-Cookie"], undefined);
const en = reject("/?terma_access_language=en-US", {host:"example.com", "accept-language":"zh-CN"});
assert.match(en.body, /lang="en-US"/);
assert.equal(/[\u3400-\u9fff]/.test(en.body.replace("简体中文", "")), false);
const api = reject("/api/connections", {host:"example.com", "accept-language":"en"});
assert.equal(api.status, 421);
assert.equal(JSON.parse(api.body).error_code, "host_not_allowed");
assert.equal(JSON.parse(api.body).error_params.host, "example.com");
const json = reject("/", {host:"example.com", accept:"application/json"});
assert.match(json.headers["Content-Type"], /application\/json/);
console.log("Host rejection language, HTML escaping, CSP and JSON compatibility checks passed.");
