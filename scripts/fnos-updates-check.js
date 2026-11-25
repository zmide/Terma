"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {loadFrontendService} = require("./frontend-service-test-helper");
const {fnosUpdateStatus,selectFnosUpdateAsset} = require("../dist/infrastructure/fnos-updates");
const {UpdateInstaller,UPDATE_DOWNLOAD_ROUTES} = require("../dist/update-installer");

async function runFnosUpdateChecks() {
  const {selectedFnosUpdateAsset} = loadFrontendService(path.join(__dirname, '../frontend/src/features/settings/update-status-model.ts'),{URL});
  const {createSettingsRequestLifecycle} = loadFrontendService("frontend/src/features/settings/settings-request-lifecycle.ts");
  const {createUpdateController} = loadFrontendService("frontend/src/features/settings/update-controller.ts");
  const requests = createSettingsRequestLifecycle();
  let status;
  const updates = createUpdateController({
    requests, language:() => "en-US", distribution:() => "fnos", tr:key => key, emit() {},
    capturePane:() => action => action(),
    request:async url => url.endsWith("/download/status") ? status?.download_status : status,
    downloads:() => ({probeSnapshot:null, actionPending:false, startPolling() {}}),
    notice:() => ({sync() {}})
  });
  const release = {current_version:"1.7.9.4", latest_version:"1.7.10", update_available:true,
    release_url:"https://github.com/zmide/Terma/releases/tag/v1.7.10", notes:"Release <script>blocked</script>",
    download_status:{managed_by:"fnos",arch:"x64"}, assets:["x64","arm64"].map(arch => ({
      name:`Terma-1.7.10-fnos-${arch}.fpk`,url:`https://github.com/zmide/Terma/releases/download/v1.7.10/Terma-1.7.10-fnos-${arch}.fpk`,size:65536
    }))};
  for (const arch of ["x64","arm64"]) {
    const target = {...release,download_status:fnosUpdateStatus(release,arch)};
    assert.equal(selectedFnosUpdateAsset(target).name, `Terma-1.7.10-fnos-${arch}.fpk`);
    assert.equal(selectFnosUpdateAsset(release,arch).name,selectedFnosUpdateAsset(target).name);
    assert.deepEqual(target.download_status.download_links.map(link=>link.url),UPDATE_DOWNLOAD_ROUTES.map(route=>route.prefix+selectedFnosUpdateAsset(target).url));
    status = target;
    await updates.loadCached();
    const snapshot = updates.snapshot();
    assert.equal(snapshot.fnos,true);
    assert.equal(snapshot.update.notes,release.notes);
    assert.equal(Object.hasOwn(snapshot,"notesHtml"),false);
    assert.equal(snapshot.update.download_status.download_links.length,6);
  }
  for (const change of [
    {download_status:{managed_by:"fnos",arch:"ia32"}}, {assets:[]}, {assets:null},
    {release_url:"https://github.com/another/repo/releases/tag/v1.7.10"},
    {release_url:release.release_url+"?redirect=evil"}, {release_url:release.release_url+"#fragment"},
    {assets:[{...release.assets[0],url:"javascript:alert(1)"}]},
    {assets:[{...release.assets[0],url:release.assets[0].url+"?redirect=evil"}]},
    {assets:[{...release.assets[0],url:release.assets[0].url.replace("github.com", "github.com.evil.test")}]},
    {assets:[{name:"Terma-1.7.10-x64.AppImage",url:release.assets[0].url}]}
  ]) {
    const invalid={...release,...change};
    assert.equal(selectedFnosUpdateAsset(invalid),null,JSON.stringify(change));
    assert.equal(selectFnosUpdateAsset(invalid,change.download_status?.arch||"x64"),null,JSON.stringify(change));
    assert.deepEqual(fnosUpdateStatus(invalid,change.download_status?.arch||"x64").download_links,[]);
  }
  for (const record of [null, {error:"timeout"}, {...release,check_error:"timeout"}, {...release,update_available:false}, {...release,republished_available:true}]) {
    status = record;
    await updates.loadCached();
    assert.equal(updates.snapshot().fnos,true);
    assert.equal(updates.snapshot({checking:true}).checking,true);
    const request = requests.begin();
    assert.equal(updates.snapshot().checking,true);
    assert.equal(request.finish(), true);
  }
  const {handleUpdateRoutes} = require("../dist/routes/update-routes");
  const previous = process.env.TERMA_DISTRIBUTION;
  let checks = 0;
  const blocked = () => {throw new Error("fnOS must not invoke the desktop installer");};
  const dependencies = {
    checker:{packageInfo:{version:"1.7.9.4"},status:() => release,check:async options => {checks++;return release;}},
    installer:{status:blocked,download:blocked,probeDownloadLinks:blocked,verifyDownloaded:blocked},
    isLocalRequest:() => true,canOpenPackage:() => true,canOpenDirectory:() => true,openPackage:blocked,openDirectory:blocked
  };
  try {
    process.env.TERMA_DISTRIBUTION="fnos";
    for (const [method,url,expected] of [["GET","/api/updates/status",200],["GET","/api/updates/check?force=1",200],
      ["GET","/api/updates/download/status",200],["POST","/api/updates/download",409],
      ["POST","/api/updates/open",409],["POST","/api/updates/open-directory",409]]) {
      let result;
      const handled = await handleUpdateRoutes({method,url},{},url.split("?")[0],{...dependencies,sendJson:(_response,body,status=200) => {result={body,status};}});
      assert.equal(handled,true,url);
      assert.equal(result.status,expected,url);
      if (url === "/api/updates/download/status") { assert.equal(result.body.package_type,"fpk");assert.equal(result.body.download_links.length,6); }
    }
    assert.equal(checks,1);
    let result;
    const actualAsset=selectFnosUpdateAsset(release);
    dependencies.installer.probeAssetDownloadLinks=async (metadata,asset)=>{
      assert.equal(metadata,release);assert.equal(asset,actualAsset);return {asset_name:asset.name,asset_url:asset.url,results:[]};
    };
    const route=()=>handleUpdateRoutes({method:"POST",url:"/api/updates/download/probe"},{},"/api/updates/download/probe",{...dependencies,sendJson:(_response,body,status=200)=>{result={body,status};}});
    await route(); assert.equal(result.status,200); assert.equal(result.body.asset_name,actualAsset.name);
    dependencies.checker.check=async()=>({...release,assets:[]});
    await route();assert.equal(result.status,422);
    dependencies.checker.check=async()=>release;
    dependencies.installer.probeAssetDownloadLinks=async()=>{throw new Error("timeout");};
    await route();assert.deepEqual(result,{status:422,body:{error:"timeout"}});
  } finally {
    if (previous === undefined) delete process.env.TERMA_DISTRIBUTION;
    else process.env.TERMA_DISTRIBUTION=previous;
  }
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"terma-fnos-probe-"));
  try {
    for(const arch of ["x64","arm64"]) {
      const asset=selectFnosUpdateAsset(release,arch);
      const calls=[];
      const directory=path.join(root,arch);
      const installer=new UpdateInstaller(directory,{platform:"linux",arch,fetch:async (url,options)=>{
        calls.push(String(url));assert.equal(options.headers.Range,"bytes=0-65535");assert.equal(options.redirect,"manual");
        await new Promise(resolve=>setTimeout(resolve,5));
        return new Response(Buffer.alloc(65536,0x5a),{headers:{"content-type":"application/octet-stream"}});
      }});
      const results=await Promise.all([installer.probeAssetDownloadLinks(release,asset),installer.probeAssetDownloadLinks(release,asset)]);
      assert.deepEqual(results[0],results[1]);assert.equal(calls.length,6);
      assert.deepEqual(calls,UPDATE_DOWNLOAD_ROUTES.map(route=>route.prefix+asset.url));
      assert.equal(fs.existsSync(directory),false,"FPK probes must not write files");
      await assert.rejects(()=>installer.probeAssetDownloadLinks(release,{...asset,url:"https://example.com/evil.fpk"}));
      assert.equal(calls.length,6,"unrecognized assets must not reach the network");
    }
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
  console.log("fnOS update metadata, architecture links, release notes and installer restrictions passed");
}

if (require.main === module) runFnosUpdateChecks().catch(error => {console.error(error);process.exitCode=1;});
module.exports={runFnosUpdateChecks};
