"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {handleUpdateRoutes} = require("../dist/routes/update-routes");
const {loadFrontendService} = require("./frontend-service-test-helper");

const {updateDownloadLinkRows} = loadFrontendService(path.join(__dirname,"../frontend/src/features/settings/update-link-model.ts"),{URL});
const asset = {name:"Terma.exe", url:"https://github.com/zmide/Terma/releases/download/v1.7.6/Terma.exe"};
const update = {assets:[asset], download_status:{download_asset_name:asset.name, download_links:[
  {id:"direct", label:"GitHub", url:asset.url},
  {id:"mirror", label:"Mirror", url:`https://ghfast.top/${asset.url}`}
]}};
const result = {asset_name:asset.name, asset_url:asset.url, results:[
  {id:"direct", available:true, bytes_per_second:100, elapsed_ms:20},
  {id:"mirror", available:false, elapsed_ms:8000, error:"测速超时"}
]};

const {createUpdateDownloadController} = loadFrontendService(path.join(__dirname,"../frontend/src/features/settings/update-download-controller.ts"),{URL});

async function checkFrontend() {
  let resolveRequest;
  let rejectRequest;
  let requests = 0;
  let renders = 0;
  let status = update;
  const controller = createUpdateDownloadController({
    getUpdate: () => status, isFnos: () => false, capturePane: () => callback => callback(),
    repaint: () => { renders++; },
    request(url, options) {
      requests++;
      assert.equal(url, "/api/updates/download/probe");
      assert.equal(options.method, "POST");
      return new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; });
    }
  });
  assert.equal(controller.probeSnapshot,null);
  const pending = controller.probe();
  assert.equal(controller.probeSnapshot.running,true);
  await controller.probe();
  assert.equal(requests,1);
  resolveRequest(result);
  await pending;
  assert.equal(controller.probeSnapshot.running,false);
  const rows = updateDownloadLinkRows(update.download_status.download_links,controller.probeSnapshot.results);
  assert.equal(rows[0].fastest,true);
  assert.equal(rows[0].result.bytes_per_second,100);
  assert.equal(rows[1].result.available,false);
  assert.equal(rows[1].result.error,"测速超时");
  assert.equal(rows.length,2,"failed routes remain clickable");
  const stale = controller.probe();
  status = {...update, assets:[{...asset, name:"Terma-new.exe"}], download_status:{...update.download_status, download_asset_name:"Terma-new.exe"}};
  assert.equal(controller.probeSnapshot,null);
  resolveRequest(result);
  await stale;
  status = update;
  assert.equal(controller.probeSnapshot,null,"a late result cannot reappear when returning to the old release");
  const failed = controller.probe();
  rejectRequest(new Error("<error>"));
  await failed;
  assert.equal(controller.probeSnapshot.error,"<error>");
  assert.equal(controller.probeSnapshot.running,false);
  const retry = controller.probe();
  resolveRequest(result);
  await retry;
  assert.equal(requests,4);
  assert.equal(renders,8);
}

async function checkDownloadAndOpen() {
  let tick;
  let timerClears = 0;
  const {createUpdateDownloadController:createWithClock} = loadFrontendService(path.join(__dirname,"../frontend/src/features/settings/update-download-controller.ts"),{
    URL,
    setInterval(callback, ms) { assert.equal(ms,500); tick = callback; return 1; },
    clearInterval(id) { assert.equal(id,1); timerClears++; tick = undefined; }
  });
  function gate() {
    let resolve;
    const promise = new Promise(yes => { resolve = yes; });
    return {promise, resolve};
  }
  const installed = {state:'downloaded', version:'1.7.6', package_type:'installer', asset_name:asset.name,
    selected_asset_name:asset.name, digest:'sha256:fixture', can_open:true, can_open_directory:true};
  const release = {...update, latest_version:'1.7.6', republished_available:true, release_revision:2};
  let status = {...release};
  let fnos = false;
  const confirms = [];
  let approved = gate();
  let post = gate();
  const pendingRead = gate();
  const calls = [];
  const painted = [];
  const notices = [];
  const controller = createWithClock({
    getUpdate: () => status, isFnos: () => fnos, capturePane: () => callback => callback(),
    repaint: () => painted.push(controller.actionPending),
    setProgress: progress => { status = {...status, download_status:progress}; },
    tr: (key, values) => values?.version ? key + ': ' + values.version : key,
    confirm(message) { confirms.push(message); return approved.promise; },
    notify(message, kind) { notices.push({message,kind}); },
    async request(url, options) {
      calls.push({url,options});
      if(url==='/api/updates/download')return post.promise;
      if(url==='/api/updates/download/status')return pendingRead.promise;
      return {};
    }
  });
  const running = controller.download();
  await controller.download();
  assert.deepEqual(confirms,['settings:updates.republished_confirm: v1.7.6']);
  assert.equal(calls.length,0);
  approved.resolve(true);
  await new Promise(setImmediate);
  assert.deepEqual(painted,[true]);
  const poll = tick();
  await tick();
  assert.equal(calls.length,2,'only one progress read at a time');
  const signal = calls[1].options.signal;
  post.resolve(installed);
  await running;
  assert.equal(signal.aborted,true);
  assert.equal(timerClears,1);
  pendingRead.resolve({state:'downloading'});
  await poll;
  assert.equal(status.download_status.state,'downloaded','a late poll cannot replace a completed package');
  assert.deepEqual(painted,[true,false]);
  assert.deepEqual(notices,[{message:'settings:updates.package_verified',kind:'success'}]);
  await controller.openPackage();
  assert.equal(calls.at(-1).url,'/api/updates/open');
  status = {...release, download_status:{...installed,package_type:'portable'}};
  await controller.openPackage();
  assert.equal(calls.at(-1).url,'/api/updates/open-directory');
  approved = gate();
  const staleOpen = controller.openDirectory();
  const before = calls.length;
  status = {...status,release_revision:3};
  approved.resolve(true);
  await staleOpen;
  assert.equal(calls.length,before,'the affirmative dialog cannot open a changed release');
  status = {...release,download_status:{...installed,state:'idle'}};
  post = gate();
  const oldDownload = controller.download();
  await new Promise(setImmediate);
  status = {...status,latest_version:'1.7.7'};
  await tick();
  post.resolve(installed);
  await oldDownload;
  assert.equal(status.download_status.state,'idle','a replacement release cannot inherit an old download');
  fnos = true;
  const beforeFnos = calls.length;
  await controller.download();
  await controller.openPackage();
  assert.equal(calls.length,beforeFnos,'fnOS does not access the installer routes');
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

Promise.resolve().then(checkFrontend).then(checkDownloadAndOpen).then(checkRoute).then(() => {
  console.log("下载链接测速检查通过：测速、失效资产、重复操作、过期轮询、过期确认、便携包及 fnOS 路由隔离");
}).catch(error => { console.error(error); process.exitCode = 1; });
