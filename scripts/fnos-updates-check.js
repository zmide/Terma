"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const os = require("node:os");
const {fnosUpdateStatus,selectFnosUpdateAsset} = require("../dist/infrastructure/fnos-updates");
const {UpdateInstaller,UPDATE_DOWNLOAD_ROUTES} = require("../dist/update-installer");

async function runFnosUpdateChecks() {
  const escaped = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[char]));
  const context = {URL, document:{documentElement:{lang:"en-US"}}, esc:escaped, escAttr:escaped,
    icon:() => "", tr:key => key, registerTermaAction:() => {}, runtimeSettings:{distribution:"fnos"}};
  vm.createContext(context);
  for (const file of ["app-settings-fnos-updates.js", "app-settings-updates.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,"..","public",file),"utf8"), context);
  }
  const release = {current_version:"1.7.9.4", latest_version:"1.7.10", update_available:true,
    release_url:"https://github.com/zmide/Terma/releases/tag/v1.7.10", notes:"Release <script>blocked</script>",
    download_status:{managed_by:"fnos",arch:"x64"}, assets:["x64","arm64"].map(arch => ({
      name:`Terma-1.7.10-fnos-${arch}.fpk`,url:`https://github.com/zmide/Terma/releases/download/v1.7.10/Terma-1.7.10-fnos-${arch}.fpk`,size:65536
    }))};
  for (const arch of ["x64","arm64"]) {
    const target = {...release,download_status:fnosUpdateStatus(release,arch)};
    assert.equal(context.fnosReleaseAsset(target).name, `Terma-1.7.10-fnos-${arch}.fpk`);
    assert.equal(selectFnosUpdateAsset(release,arch).name,context.fnosReleaseAsset(target).name);
    assert.deepEqual(target.download_status.download_links.map(link=>link.url),UPDATE_DOWNLOAD_ROUTES.map(route=>route.prefix+context.fnosReleaseAsset(target).url));
    const html = context.fnosUpdateStatusHtml(target);
    assert.match(html,/data-action="fnos-check-updates"/);
    assert.match(html,/update-notes/);
    assert.match(html,/&lt;script&gt;blocked/);
    assert.match(html,/data-action="fnos-probe-download-links"/);
    assert.equal((html.match(/href='?"?https:[^>]+\.fpk"/g)||[]).length,6);
    assert.doesNotMatch(html,/onclick=|downloadUpdateBtn|openDownloadedUpdate|<script>/);
    vm.runInContext('updateDownloadLinksProbe='+JSON.stringify({key:context.updateDownloadLinksKey(target.download_status),results:[{id:"direct",available:false,error:"更新下载返回了网页，而不是安装包"}]}),context);
    assert.doesNotMatch(context.fnosUpdateStatusHtml(target), /更新下载返回了网页/);
    vm.runInContext('updateDownloadLinksProbe=null',context);
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
    assert.equal(context.fnosReleaseAsset(invalid),null,JSON.stringify(change));
    assert.equal(selectFnosUpdateAsset(invalid,change.download_status?.arch||"x64"),null,JSON.stringify(change));
    assert.deepEqual(fnosUpdateStatus(invalid,change.download_status?.arch||"x64").download_links,[]);
  }
  for (const status of [null, {error:"timeout"}, {...release,check_error:"timeout"}, {...release,update_available:false}, {...release,republished_available:true}]) {
    context.updateSettings=status;
    context.updateStatusChecking=false;
    assert.match(context.updateStatusHtml(), /fnos-update-card/);
    assert.match(context.updateStatusHtml({checking:true}), /disabled aria-busy="true"/);
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
