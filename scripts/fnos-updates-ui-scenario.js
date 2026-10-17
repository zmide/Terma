"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {UPDATE_DOWNLOAD_ROUTES} = require("../dist/update-installer");

async function fnosUpdatePageScenario(options) {
  const previous = {api,updateSettings,runtimeSettings,updateDownloadLinksProbe};
  const notes = '[English](#english) · [简体中文](#简体中文)\n\n<a id="english"></a>\n### English\n\n- Improved file transfers.\n\n<a id="简体中文"></a>\n### 简体中文\n\n- 改进文件传输。';
  let checks=0;
  let offline=false;
  const release={current_version:'1.7.9.4',latest_version:'1.7.10',update_available:true,checked_at:'2026-10-17T01:00:00Z',
    release_url:'https://github.com/zmide/Terma/releases/tag/v1.7.10',notes,
    release_notes:[{version:'1.7.10',notes},{version:'1.7.9',notes}],
    assets:[{name:'Terma-1.7.10-fnos-'+options.arch+'.fpk',url:'https://github.com/zmide/Terma/releases/download/v1.7.10/Terma-1.7.10-fnos-'+options.arch+'.fpk',digest:'sha256:'+'a'.repeat(64)}]};
  const download={state:'managed',managed_by:'fnos',package_type:'fpk',arch:options.arch,platform:'linux',can_open:false,
    download_asset_name:release.assets[0].name,download_links:options.routes.map(route=>({id:route.id,label:route.label,url:route.prefix+release.assets[0].url}))};
  let probes=0;
  try {
    runtimeSettings={...runtimeSettings,distribution:'fnos',saved:{...runtimeSettings?.saved,language:options.language}};
    updateDownloadLinksProbe=null;
    api=async (url,request={}) => {
      if (url.startsWith('/api/updates/check')) {
        checks++;
        await new Promise(resolve=>setTimeout(resolve,20));
        if (offline) throw new Error('timeout');
        return {...release};
      }
      if (url==='/api/updates/status') return {...release};
      if (url==='/api/updates/download/status') return download;
      if (url==='/api/updates/download/probe') {
        probes++;
        await new Promise(resolve=>setTimeout(resolve,60));
        return {asset_name:release.assets[0].name,asset_url:release.assets[0].url,results:options.routes.map((route,index)=>({id:route.id,available:index!==2,bytes_per_second:index===1?900000:100000,elapsed_ms:20,error:index===2?'测速超时':''}))};
      }
      if (url.startsWith('/api/updates/')) throw new Error('Unexpected installer request: '+url);
      if (url==='/api/runtime-settings') return runtimeSettings;
      return previous.api(url,request);
    };
    await setTermaLanguage(options.language,{render:false,emit:false});
    applyTheme(options.theme);
    await openSettingsSection('settings-about');
    showMobileWorkspace();
    const settled=async (expectWarning=false) => {
      for(let attempt=0;attempt<100;attempt++) {
        const currentArea=$('updateCheckArea');
        if (!updateStatusChecking&&currentArea?.querySelectorAll('.update-release-entry').length===2&&(!expectWarning||currentArea.querySelector('.warning'))) return;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      throw new Error('fnOS update rendering timed out');
    };
    await settled();
    const before=checks;
    $('checkUpdateBtn').click();
    const busy=$('checkUpdateBtn').disabled;
    await settled();
    const area=$('updateCheckArea');
    const text=area.textContent;
    const visibleNotes=text.includes(options.language==='en-US'?'Improved file transfers.':'改进文件传输。');
    const links=[...area.querySelectorAll('a[href$=".fpk"]')];
    const matchingPackage=links.length===6&&links.every((link,index)=>link.href===download.download_links[index].url);
    $('probeUpdateDownloadLinksBtn').click();
    const probeBusy=$('probeUpdateDownloadLinksBtn').disabled;
    for(let attempt=0;attempt<100&&updateDownloadLinksProbe?.running;attempt++)await new Promise(resolve=>setTimeout(resolve,20));
    const probeArea=$('updateCheckArea');
    const measured=probes===1&&probeArea.querySelector('a.is-fastest')?.href===download.download_links[1].url
      &&probeArea.querySelectorAll('a[href$=".fpk"]').length===6&&!$('probeUpdateDownloadLinksBtn').disabled;
    const noInstaller=!area.querySelector('#downloadUpdateBtn,[onclick*="openDownloadedUpdate"]');
    const attributes=[...area.querySelectorAll('*')].flatMap(node=>['title','aria-label','placeholder'].map(name=>node.getAttribute(name)||''));
    const translated=options.language!=='en-US'||!/[\u3400-\u9fff]/.test(text+attributes.join(''));
    const withinViewport=document.documentElement.scrollWidth<=innerWidth&&area.scrollWidth<=area.clientWidth+1;
    offline=true;
    $('checkUpdateBtn').click();
    await settled(true);
    const failedArea=$('updateCheckArea');
    const offlineRetainsNotes=Boolean(failedArea.querySelector('.warning'))&&failedArea.querySelectorAll('.update-release-entry').length===2&&!$('checkUpdateBtn').disabled;
    offline=false;
    $('checkUpdateBtn').click();
    await settled();
    return {busy,manualCheck:checks>=before+2,visibleNotes,matchingPackage,probeBusy,measured,noInstaller,translated,withinViewport,offlineRetainsNotes};
  } finally {
    api=previous.api;
    updateSettings=previous.updateSettings;
    runtimeSettings=previous.runtimeSettings;
    updateDownloadLinksProbe=previous.updateDownloadLinksProbe;
    dismissToast();
  }
}

async function runFnosUpdatesUiScenario(window) {
  await window.webContents.executeJavaScript(`(async()=>{await window.termaI18nReady;while(window.workspaceRestorePending)await new Promise(resolve=>setTimeout(resolve,20));})()`);
  const results=[];
  for (const width of [390,1200]) for (const language of ['zh-CN','en-US']) for (const theme of ['light','dark']) {
    window.setSize(width,844);
    await new Promise(resolve=>setTimeout(resolve,80));
    const options={width,language,theme,arch:theme==='light'?'x64':'arm64',routes:UPDATE_DOWNLOAD_ROUTES};
    const metrics=await window.webContents.executeJavaScript(`(${fnosUpdatePageScenario.toString()})(${JSON.stringify(options)})`);
    for (const [name,value] of Object.entries(metrics)) assert.equal(value,true,`${JSON.stringify(options)} ${name}: ${JSON.stringify(metrics)}`);
    if(process.env.TERMA_UI_FNOS_UPDATES_PROOF_DIR){
      fs.mkdirSync(process.env.TERMA_UI_FNOS_UPDATES_PROOF_DIR,{recursive:true});
      fs.writeFileSync(path.join(process.env.TERMA_UI_FNOS_UPDATES_PROOF_DIR,`updates-${width}-${language}-${theme}.png`),(await window.webContents.capturePage()).toPNG());
    }
    results.push({width,language,theme,arch:options.arch,...metrics});
  }
  console.log('fnOS updates UI passed',JSON.stringify(results));
}
module.exports={runFnosUpdatesUiScenario};
