"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {handleUpdateRoutes} = require("../dist/routes/update-routes");

const source = fs.readFileSync(path.join(__dirname, "../public/app-settings-updates.js"), "utf8");
const start = source.indexOf("let updateDownloadLinksProbe = null;");
const end = source.indexOf("function updateStatusHtml", start);
assert.ok(start >= 0 && end > start);
const asset = {name:"Terma.exe", url:"https://github.com/zmide/Terma/releases/download/v1.7.6/Terma.exe"};
const update = {assets:[asset], download_status:{download_asset_name:asset.name, download_links:[
  {id:"direct", label:"GitHub", url:asset.url},
  {id:"mirror", label:"Mirror", url:`https://ghfast.top/${asset.url}`}
]}};
const result = {asset_name:asset.name, asset_url:asset.url, results:[
  {id:"direct", available:true, bytes_per_second:100, elapsed_ms:20},
  {id:"mirror", available:false, elapsed_ms:8000, error:"测速超时"}
]};

async function checkFrontend() {
  let resolveRequest;
  let rejectRequest;
  let requestCount = 0;
  let renders = 0;
  const context = {
    updateSettings:update, URL,
    captureSettingsPane:() => callback => callback(),
    renderUpdateStatus:() => { renders += 1; },
    formatUpdateSpeed:value => `${value} B/s`,
    localizedUpdateStatusError:value => value,
    tr:(key, values) => `${key}${values?.speed ? ` ${values.speed}` : ""}`,
    esc:value => String(value).replaceAll("<", "&lt;"),
    escAttr:value => String(value).replaceAll('"', "&quot;").replaceAll("<", "&lt;"),
    icon:() => "",
    api:(url, options) => {
      requestCount += 1;
      assert.equal(url, "/api/updates/download/probe");
      assert.equal(options.method, "POST");
      return new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; });
    }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  assert.match(context.updateManualDownloadLinksHtml(update), /probeUpdateDownloadLinksBtn/);
  const pending = context.probeUpdateDownloadLinks();
  const busyMarkup = context.updateManualDownloadLinksHtml(update);
  assert.match(busyMarkup, /disabled aria-busy="true"/);
  assert.match(busyMarkup, /settings:updates.probe_running/);
  await context.probeUpdateDownloadLinks();
  assert.equal(requestCount, 1);
  resolveRequest(result);
  await pending;
  const completed = context.updateManualDownloadLinksHtml(update);
  assert.match(completed, /is-fastest/);
  assert.match(completed, /probe_fastest 100 B\/s/);
  assert.match(completed, /settings:updates.probe_unavailable/);
  assert.match(completed, /settings:updates.probe_timeout/);
  assert.doesNotMatch(completed, /disabled/);
  assert.equal((completed.match(/href=/g) || []).length, 2, "failed routes remain clickable");
  const newer = {...update, assets:[{...asset, name:"Terma-new.exe"}], download_status:{...update.download_status, download_asset_name:"Terma-new.exe"}};
  assert.doesNotMatch(context.updateManualDownloadLinksHtml(newer), /is-fastest|100 B\/s|probe_unavailable/);
  const failed = context.probeUpdateDownloadLinks();
  rejectRequest(new Error("<error>"));
  await failed;
  const failure = context.updateManualDownloadLinksHtml(update);
  assert.match(failure, /&lt;error>/);
  assert.doesNotMatch(failure, /disabled|<error>/);
  const retry = context.probeUpdateDownloadLinks();
  resolveRequest(result);
  await retry;
  assert.equal(requestCount, 3);
  assert.equal(renders, 6);
}

async function checkRoute() {
  const calls = [];
  const dependencies = {
    checker:{check:async options => { calls.push(options); return update; }},
    installer:{probeDownloadLinks:async release => { assert.equal(release, update); return result; }, download:() => { throw new Error("must not download"); }},
    sendJson:(_response, body, status=200) => calls.push({body, status})
  };
  const request = {method:"POST", url:"/api/updates/download/probe"};
  assert.equal(await handleUpdateRoutes(request, {}, request.url, dependencies), true);
  assert.deepEqual(calls, [{force:false}, {body:result, status:200}]);
  dependencies.installer.probeDownloadLinks = async () => { throw new Error("failed"); };
  await handleUpdateRoutes(request, {}, request.url, dependencies);
  assert.deepEqual(calls.at(-1), {body:{error:"failed"}, status:422});
  assert.equal(await handleUpdateRoutes({...request, method:"GET"}, {}, request.url, dependencies), false);
}

Promise.resolve().then(checkFrontend).then(checkRoute).then(() => {
  console.log("下载链接测速检查通过：手动触发、加载反馈、最快标识、失败重试、旧资源隔离和独立 API");
}).catch(error => { console.error(error); process.exitCode = 1; });
