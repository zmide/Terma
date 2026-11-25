"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {UPDATE_DOWNLOAD_ROUTES} = require("../dist/update-installer");
const {BrowserWindow} = require("electron");
const {loadUpdateFixture} = require('./update-ui-fixture');

async function fnosUpdatePageScenario(options) {
  const previous = {api,runtimeSettings: window.termaRuntimeSettingsModel.snapshot};
  const notes = '[English](#english) · [简体中文](#简体中文)\n\n<a id="english"></a>\n### English\n\n- Improved file transfers.\n- <script>literal-note</script>\n\n<a id="简体中文"></a>\n### 简体中文\n\n- 改进文件传输。\n- <script>literal-note</script>';
  let checks=0;
  let offline=false;
  let checkGate=null;
  let releaseCheck;
  let releaseProbe;
  const probeGate=new Promise(resolve=>{releaseProbe=resolve;});
  const release={current_version:'1.7.9.4',latest_version:'1.7.10',update_available:true,checked_at:'2026-10-17T01:00:00Z',
    release_url:'https://github.com/zmide/Terma/releases/tag/v1.7.10',notes,
    release_notes:[{version:'1.7.10',notes},{version:'1.7.9',notes}],
    assets:[{name:'Terma-1.7.10-fnos-'+options.arch+'.fpk',url:'https://github.com/zmide/Terma/releases/download/v1.7.10/Terma-1.7.10-fnos-'+options.arch+'.fpk',digest:'sha256:'+'a'.repeat(64)}]};
  const download={state:'managed',managed_by:'fnos',package_type:'fpk',arch:options.arch,platform:'linux',can_open:false,
    download_asset_name:release.assets[0].name,download_links:options.routes.map(route=>({id:route.id,label:route.label,url:route.prefix+release.assets[0].url}))};
  let probes=0;
  const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()));
  try {
    window.termaRuntimeSettingsModel.snapshot={...window.termaRuntimeSettingsModel.snapshot,distribution:'fnos',saved:{...window.termaRuntimeSettingsModel.snapshot?.saved,language:options.language}};
    api=async (url,request={}) => {
      if (url.startsWith('/api/updates/check')) {
        checks++;
        if(checkGate)await checkGate;
        else await new Promise(resolve=>setTimeout(resolve,20));
        if (offline) throw new Error('timeout');
        return {...release};
      }
      if (url==='/api/updates/status') return {...release};
      if (url==='/api/updates/download/status') return download;
      if (url==='/api/updates/download/probe') {
        probes++;
        await probeGate;
        return {asset_name:release.assets[0].name,asset_url:release.assets[0].url,results:options.routes.map((route,index)=>({id:route.id,available:index!==2,bytes_per_second:index===1?900000:100000,elapsed_ms:20,error:index===2?'测速超时':''}))};
      }
      if (url.startsWith('/api/updates/')) throw new Error('Unexpected installer request: '+url);
      if (url==='/api/runtime-settings') return window.termaRuntimeSettingsModel.snapshot;
      return previous.api(url,request);
    };
    await setTermaLanguage(options.language);
    applyTheme(options.theme);
    await window.termaSettingsNavigation.open('settings-about');
    window.termaWorkspaceShell.showMobileWorkspace();
    await window.termaUpdateStatus.refresh();
    const checkingUpdates=()=>$('checkUpdateBtn')?.getAttribute('aria-busy')==='true';
    const settled=async (expectWarning=false) => {
      for(let attempt=0;attempt<100;attempt++) {
        const currentArea=$('updateCheckArea');
        const entries=[...currentArea?.querySelectorAll('.update-release-entry')||[]];
        const notesReady=entries.length===2&&entries.every(entry=>entry.textContent.includes(options.language==='en-US'?'Improved file transfers.':'改进文件传输。'));
        if (!checkingUpdates()&&notesReady&&(!expectWarning||currentArea.querySelector('.warning'))) return;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      throw new Error('fnOS update rendering timed out: '+JSON.stringify({language:options.language,width:options.width,theme:options.theme,checking:checkingUpdates(),lang:document.documentElement.lang,text:$('updateCheckArea')?.textContent.slice(0,700)}));
    };
    await settled();
    const before=checks;
    checkGate=new Promise(resolve=>{releaseCheck=resolve;});
    $('checkUpdateBtn').click();
    await new Promise(resolve=>setTimeout(resolve,10));
    const busy=$('checkUpdateBtn').disabled;
    releaseCheck();
    checkGate=null;
    await settled();
    const area=$('updateCheckArea');
    const text=area.textContent;
    const visibleNotes=text.includes(options.language==='en-US'?'Improved file transfers.':'改进文件传输。');
    const escapedNotes=[...area.querySelectorAll('.update-release-markdown')].every(node=>node.textContent.includes('<script>literal-note</script>')&&!node.querySelector('script'));
    if (!escapedNotes) throw new Error('Release notes containing HTML were not rendered as text');
    const links=[...area.querySelectorAll('a[href$=".fpk"]')];
    const matchingPackage=links.length===6&&links.every((link,index)=>link.href===download.download_links[index].url);
    $('probeUpdateDownloadLinksBtn').click();
    await new Promise(resolve=>setTimeout(resolve,10));
    const probeBusy=$('probeUpdateDownloadLinksBtn').disabled;
    const probeStarted=probes===1;
    releaseProbe();
    if(!probeBusy||!probeStarted)throw new Error('fnOS probe did not show its busy state: '+JSON.stringify({view:window.termaUpdateStatus.snapshot().probe,button:$('probeUpdateDownloadLinksBtn')?.outerHTML,probes}));
    for(let attempt=0;attempt<100&&window.termaUpdateStatus.snapshot().probe?.running;attempt++)await new Promise(resolve=>setTimeout(resolve,20));
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
    releaseCheck?.();
    releaseProbe?.();
    api=previous.api;
    window.termaRuntimeSettingsModel.snapshot=previous.runtimeSettings;
    dismissToast();
  }
}

async function runFnosUpdatesUiScenario(window) {
  const results=[];
  const proofDirectory=process.env.TERMA_UI_FNOS_UPDATES_PROOF_DIR;
  const waitForRender=page=>page.webContents.executeJavaScript(`new Promise(resolve=>{requestAnimationFrame(()=>requestAnimationFrame(resolve));setTimeout(resolve,100);})`);
  const pressTab=async(page, shiftKey=false)=>{
    const key={key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:shiftKey?8:0};
    for(const type of ['rawKeyDown','keyUp']) {
      await page.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {type,...key});
    }
    await waitForRender(page);
  };
  const checkModalTabOrder=async(page, dialogSelector, label)=>{
    const footer='.terma-about-modal-actions button:last-child';
    const close='.terma-about-close';
    const resize='button.dialog-window-resize';
    const hasResize=await page.webContents.executeJavaScript(
      `Boolean(document.querySelector(${JSON.stringify(`${dialogSelector} ${resize}`)}))`
    );
    const expectFocus=async(selector)=>{
      const target=JSON.stringify(`${dialogSelector} ${selector}`);
      assert.equal(await page.webContents.executeJavaScript(`document.activeElement===document.querySelector(${target})`),true,`${label} focus should reach ${selector}`);
    };
    await page.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(`${dialogSelector} ${footer}`)}).focus()`);
    await expectFocus(footer);
    if(hasResize){
      await pressTab(page);
      await expectFocus(resize);
    }
    await pressTab(page);
    await expectFocus(close);
    if(hasResize){
      await pressTab(page,true);
      await expectFocus(resize);
    }
    await pressTab(page,true);
    await expectFocus(footer);
  };
  const emitSnapshot=async(page,snapshot)=>{
    await page.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('terma:update-status-changed',{detail:${JSON.stringify(snapshot)}}))`);
    await waitForRender(page);
  };
  const loadState=(page,update)=>page.webContents.executeJavaScript(`(${loadUpdateFixture.toString()})(${JSON.stringify(update)})`);
  const capture=async(page,name)=>{
    if(!proofDirectory)return;
    fs.mkdirSync(proofDirectory,{recursive:true});
    await new Promise(resolve=>setTimeout(resolve,220));
    await page.webContents.capturePage();
    await new Promise(resolve=>setTimeout(resolve,100));
    fs.writeFileSync(path.join(proofDirectory,`${name}.png`),(await page.webContents.capturePage()).toPNG());
  };
  const assertAboutFits=async(page,label)=>{
    const bounds=await page.webContents.executeJavaScript(`(()=>{const selectors=['#settings-about','#settings-about .settings-grid','#settings-about .settings-grid > section','#updateCheckArea','.update-card','.update-notes','.update-download-links','.update-actions','.about-third-party-list'];return selectors.flatMap(selector=>[...document.querySelectorAll(selector)].map(element=>{const rect=element.getBoundingClientRect();return {selector,left:rect.left,right:rect.right,clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,viewport:innerWidth};})).filter(item=>item.left< -1||item.right>item.viewport+1||item.scrollWidth>item.clientWidth+2);})()`);
    assert.deepEqual(bounds,[],`${label} internal clipping: ${JSON.stringify(bounds)}`);
  };
  for (const width of [390,1200]) for (const language of ['zh-CN','en-US']) for (const theme of ['light','dark']) {
    console.log('About visual check',width,language,theme);
    const page=new BrowserWindow({show:false,width,height:844,webPreferences:{contextIsolation:true,backgroundThrottling:false,
      partition:`fnos-updates-${width}-${language}-${theme}-${Date.now()}`,preload:path.join(__dirname,'ui-smoke-preload.js')}});
    const diagnostics=[];
    page.webContents.on('console-message',details=>{if(['warning','error'].includes(details.level))diagnostics.push(details.message);});
    page.webContents.on('did-fail-load',(_event,code,description)=>diagnostics.push(`${code}: ${description}`));
    try {
      await page.loadURL(window.webContents.getURL());
      page.webContents.debugger.attach('1.3');
      await page.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {enabled:true});
      await page.webContents.executeJavaScript(`(async()=>{await window.termaI18nReady;while(window.workspaceRestorePending)await new Promise(resolve=>setTimeout(resolve,20));})()`);
      const options={width,language,theme,arch:theme==='light'?'x64':'arm64',routes:UPDATE_DOWNLOAD_ROUTES};
      const metrics=await page.webContents.executeJavaScript(`(${fnosUpdatePageScenario.toString()})(${JSON.stringify(options)})`);
      for (const [name,value] of Object.entries(metrics)) assert.equal(value,true,`${JSON.stringify(options)} ${name}: ${JSON.stringify(metrics)}`);
      const stem=`about-${width}-${language}-${theme}`;
      await page.webContents.executeJavaScript(`dismissToast()`);
      await new Promise(resolve=>setTimeout(resolve,260));
      const resetScroll=await page.webContents.executeJavaScript(`(()=>{
        const candidates=[...document.querySelectorAll('body *')].filter(element=>{
          const style=getComputedStyle(element);
          return /(auto|scroll)/.test(style.overflowY)&&element.scrollHeight-element.clientHeight>80;
        }).sort((left,right)=>(right.scrollHeight-right.clientHeight)-(left.scrollHeight-left.clientHeight)).slice(0,5);
        candidates.forEach((element,index)=>{element.dataset.aboutAuditScroll=String(index);element.scrollTop=0;});
        document.querySelectorAll('body *').forEach(element=>{if(element.classList?.contains('update-notes')||element.classList?.contains('about-third-party-list'))element.scrollLeft=0;});
        return candidates.map((element,index)=>({index,id:element.id,className:String(element.className||''),clientHeight:element.clientHeight,scrollHeight:element.scrollHeight}));
      })()`);
      await waitForRender(page);
      await assertAboutFits(page,stem);
      if(language==='en-US'){
        const untranslated=await page.webContents.executeJavaScript(`(()=>{const root=document.querySelector('#settings-about');return [root.textContent,...[root,...root.querySelectorAll('*')].flatMap(node=>['title','aria-label','placeholder'].map(name=>node.getAttribute(name)||''))].filter(text=>/[\\u3400-\\u9fff]/.test(text));})()`);
        assert.deepEqual(untranslated,[],`${stem} contains untranslated About content: ${JSON.stringify(untranslated)}`);
      }
      await capture(page,`${stem}-page-top`);
      for(const candidate of resetScroll){
        const lastOffset=Math.max(0,candidate.scrollHeight-candidate.clientHeight);
        const offsets=[];
        for(let offset=0;offset<lastOffset;offset+=Math.max(100,Math.floor(candidate.clientHeight*0.8)))offsets.push(offset);
        offsets.push(lastOffset);
        for(let index=0;index<offsets.length;index++){
          await page.webContents.executeJavaScript(`(()=>{const element=document.querySelector('[data-about-audit-scroll="${candidate.index}"]');if(element)element.scrollTop=${offsets[index]};})()`);
          await waitForRender(page);
          await capture(page,`${stem}-scroll-${candidate.index}-${String(index).padStart(2,'0')}`);
        }
      }
      await page.webContents.executeJavaScript(`(()=>{const button=document.querySelector('#openLicenseBtn');button?.scrollIntoView({block:'center'});button?.click();})()`);
      await waitForRender(page);
      const dialog=await page.webContents.executeJavaScript(`(()=>{const element=document.querySelector('.terma-about-modal');const rect=element?.getBoundingClientRect();return {open:Boolean(element),withinViewport:rect?rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight:false,rect:rect?{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height}:null,viewport:{width:innerWidth,height:innerHeight},focus:document.activeElement?.className||document.activeElement?.id||''};})()`);
      await capture(page,`${stem}-license-dialog`);
      if(!dialog.withinViewport){
        const context=await page.webContents.executeJavaScript(`(()=>{const values=[];for(let element=document.querySelector('.terma-about-modal');element;element=element.parentElement){const style=getComputedStyle(element),rect=element.getBoundingClientRect();values.push({tag:element.tagName,id:element.id,class:element.className,position:style.position,display:style.display,alignItems:style.alignItems,transform:style.transform,filter:style.filter,perspective:style.perspective,contain:style.contain,contentVisibility:style.contentVisibility,top:rect.top,height:rect.height,width:rect.width,background:style.backgroundColor,color:style.color});}return values;})()`);
        console.log('license dialog layout context',JSON.stringify(context));
      }
      assert.equal(dialog.open,true,`${JSON.stringify(options)} license dialog did not open`);
      assert.equal(dialog.withinViewport,true,`${JSON.stringify(options)} license dialog exceeds viewport: ${JSON.stringify(dialog)}`);
      await page.webContents.executeJavaScript(`document.querySelector('.terma-about-modal-backdrop').click()`);
      await waitForRender(page);
      assert.equal(await page.webContents.executeJavaScript(`Boolean(document.querySelector('.terma-about-modal'))`),true,`${stem} license backdrop changed the existing close behavior`);
      await checkModalTabOrder(page,'.terma-about-modal',`${stem} license`);
      await page.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
      await waitForRender(page);
      const focusRestored=await page.webContents.executeJavaScript(`!document.querySelector('.terma-about-modal')&&document.activeElement?.id==='openLicenseBtn'`);
      assert.equal(focusRestored,true,`${JSON.stringify(options)} license Escape close did not restore focus`);
      const baseSnapshot=await page.webContents.executeJavaScript(`window.termaUpdateStatus.snapshot()`);
      const assetName='Terma-1.7.10-windows-x64-installer.exe';
      const assetUrl=`https://github.com/zmide/Terma/releases/download/v1.7.10/${assetName}`;
      const digest=`sha256:${'a'.repeat(64)}`;
      const standardDownload={state:'idle',platform:'win32',arch:'x64',package_type:'installer',selected_asset_name:assetName,asset_name:assetName,download_asset_name:assetName,selected_asset_size:134217728,size:134217728,can_open:false,can_open_directory:false,download_links:options.routes.map(route=>({id:route.id,label:route.label,url:`${route.prefix}${assetUrl}`}))};
      const portableName='Terma-1.7.10-windows-x64-portable.exe';
      const portableUrl=assetUrl.replace(assetName,portableName);
      const portableDownload={...standardDownload,package_type:'portable',selected_asset_name:portableName,asset_name:portableName,download_asset_name:portableName,download_links:options.routes.map(route=>({id:route.id,label:route.label,url:`${route.prefix}${portableUrl}`}))};
      const standard={...baseSnapshot,update:{...baseSnapshot.update,current_version:'1.7.9.4',latest_version:'1.7.10',update_available:true,republished_available:false,update_ignored:false,error:undefined,check_error:undefined,release_url:'https://github.com/zmide/Terma/releases/tag/v1.7.10',published_at:'2026-10-17T00:00:00Z',assets:[{name:assetName,url:assetUrl,digest}],download_status:standardDownload},checking:false,fnos:false,releaseUrl:'https://github.com/zmide/Terma/releases/tag/v1.7.10',probe:{running:false,results:[]},statusError:undefined,checkError:undefined,downloadError:undefined,probeError:undefined,ignoreSaving:false,downloadActionPending:false};
      const current={...standard.update,current_version:standard.update.latest_version,update_available:false};
      await page.webContents.executeJavaScript(`(()=>{
        window.__aboutCurrentProbePrevious={api,runtimeSettings: window.termaRuntimeSettingsModel.snapshot};
        window.__aboutCurrentProbeCalls=[];
        window.termaRuntimeSettingsModel.snapshot={...window.termaRuntimeSettingsModel.snapshot,distribution:'standard'};
        api=async(url,request)=>{
          if(!url.startsWith('/api/updates/'))return window.__aboutCurrentProbePrevious.api(url,request);
          window.__aboutCurrentProbeCalls.push({url,method:request?.method||'GET'});
          if(url==='/api/updates/download/probe')return new Promise(resolve=>{window.__aboutCurrentProbeResolve=resolve;});
          throw new Error('Unexpected latest-version request: '+url);
        };
      })()`);
      await loadState(page,current);
      await waitForRender(page);
      const currentProbe=await page.webContents.executeJavaScript(`(()=>{const area=document.getElementById('updateCheckArea');return {button:Boolean(area.querySelector('#probeUpdateDownloadLinksBtn')),links:area.querySelectorAll('.update-download-link').length,asset:area.textContent.includes(${JSON.stringify(assetName)}),download:Boolean(area.querySelector('#downloadUpdateBtn'))};})()`);
      assert.deepEqual(currentProbe,{button:true,links:6,asset:true,download:false},`${stem} latest version must retain its download routes and speed test`);
      await page.webContents.executeJavaScript(`document.getElementById('probeUpdateDownloadLinksBtn').scrollIntoView({block:'center'});document.getElementById('probeUpdateDownloadLinksBtn').click()`);
      await waitForRender(page);
      assert.equal(await page.webContents.executeJavaScript(`document.getElementById('probeUpdateDownloadLinksBtn').disabled`),true,`${stem} latest-version probe did not become busy`);
      await assertAboutFits(page,'latest-version probe busy');
      await capture(page,`${stem}-windows-current-probe-busy`);
      const currentProbeResult={asset_name:assetName,asset_url:assetUrl,results:options.routes.map((route,index)=>({id:route.id,available:index!==2,bytes_per_second:index===1?900000:100000,elapsed_ms:20,error:index===2?'测速超时':''}))};
      await page.webContents.executeJavaScript(`window.__aboutCurrentProbeResolve(${JSON.stringify(currentProbeResult)})`);
      await waitForRender(page);
      const currentMeasured=await page.webContents.executeJavaScript(`(()=>{const area=document.getElementById('updateCheckArea');return {busy:document.getElementById('probeUpdateDownloadLinksBtn').disabled,fastest:area.querySelector('.is-fastest')?.href,unavailable:area.querySelectorAll('.update-download-link .is-unavailable').length,calls:window.__aboutCurrentProbeCalls};})()`);
      assert.deepEqual(currentMeasured,{busy:false,fastest:standardDownload.download_links[1].url,unavailable:1,calls:[{url:'/api/updates/download/probe',method:'POST'}]},`${stem} latest-version speed results are incomplete`);
      await assertAboutFits(page,'latest-version probe measured');
      await capture(page,`${stem}-windows-current-probe-measured`);
      await page.webContents.executeJavaScript(`(()=>{const previous=window.__aboutCurrentProbePrevious;api=previous.api;delete window.__aboutCurrentProbePrevious;delete window.__aboutCurrentProbeCalls;delete window.__aboutCurrentProbeResolve;})()`);
      const statusError='timeout';
      const visualStates=[
        ['windows-reading',{update:null,checking:true}],
        ['windows-not-checked',{update:{latest_version:undefined}}],
        ['windows-current',{update:{update_available:false,current_version:'1.7.10',download_status:{...standardDownload,state:'failed',error:'timeout',progress_percent:42}},downloadError:statusError}],
        ['windows-available',{}],
        ['windows-checking',{checking:true}],
        ['windows-probing',{probe:{running:true,results:[]}}],
        ['windows-fastest-route',{probe:{running:false,results:options.routes.map((route,index)=>({id:route.id,available:index!==4,bytes_per_second:index===2?900000:180000,elapsed_ms:32,error:index===4?'测速超时':''}))}}],
        ['windows-action-pending',{downloadActionPending:true}],
        ['windows-downloading',{update:{download_status:{...standardDownload,state:'downloading',progress_percent:38,bytes_downloaded:51000000,source_id:'gh-proxy-hk',source_label:'hk.gh-proxy.org',source_speed_bytes_per_second:460800}}}],
        ['windows-verifying',{update:{download_status:{...standardDownload,state:'downloading',phase:'verifying',progress_percent:100,bytes_downloaded:134217728,source_id:'direct'}}}],
        ['windows-download-failed',{update:{download_status:{...standardDownload,state:'failed',progress_percent:42}},downloadError:statusError}],
        ['windows-downloaded',{update:{download_status:{...standardDownload,state:'downloaded',version:'1.7.10',progress_percent:100,bytes_downloaded:134217728,can_open:true,can_open_directory:true,digest}}}],
        ['windows-portable-ready',{update:{assets:[{name:portableName,url:portableUrl,digest}],download_status:{...portableDownload,state:'downloaded',version:'1.7.10',progress_percent:100,bytes_downloaded:134217728,can_open_directory:true,digest}}}],
        ['windows-no-native-open',{update:{download_status:{...standardDownload,state:'downloaded',version:'1.7.10',progress_percent:100,bytes_downloaded:134217728,can_open:false,can_open_directory:false,digest}}}],
        ['windows-check-failed',{update:{...standard.update,error:'timeout'},statusError}],
        ['windows-ignored-version',{update:{...standard.update,update_ignored:true}}],
        ['windows-republished',{update:{...standard.update,republished_available:true,update_ignored:false}}]
      ];
      if(width===390&&language==='zh-CN'&&theme==='light'||width===1200&&language==='en-US'&&theme==='dark'){
        for(const [name,changes] of visualStates){
          const view={...standard,...changes,update:changes.update===null?null:{...standard.update,...changes.update,download_status:changes.update?.download_status||standard.update.download_status}};
          await emitSnapshot(page,view);
          await assertAboutFits(page,name);
          const stateView=await page.webContents.executeJavaScript(`(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth,buttons:[...document.querySelectorAll('#updateCheckArea button')].every(button=>button.classList.contains('terma-button')),links:[...document.querySelectorAll('#updateCheckArea .update-release-link,#updateCheckArea .update-download-link')].every(link=>link.classList.contains('terma-link')),text:document.querySelector('#updateCheckArea')?.textContent||''}))()`);
          assert.equal(stateView.scrollWidth<=stateView.innerWidth+1,true,`${name} overflows ${width}px: ${JSON.stringify(stateView)}`);
          assert.equal(stateView.buttons,true,`${name} contains a non-Tile update button`);
          assert.equal(stateView.links,true,`${name} contains a non-Tile update link`);
          if(name==='windows-downloading')assert.match(stateView.text,/38%/);
          if(name==='windows-downloaded')assert.match(stateView.text,/100%/);
          if(name==='windows-portable-ready'){
            assert.ok(stateView.text.includes(portableName)&&!stateView.text.includes(assetName));
            const actions=await page.webContents.executeJavaScript(`(()=>{const buttons=[...document.querySelectorAll('#updateCheckArea button')];return {folder:!!buttons.find(button=>button.textContent.trim()===tr('settings:updates.open_download_directory'))?.querySelector('.lucide-folder-open'),redownload:!!buttons.find(button=>button.textContent.trim()===tr('settings:auto.update_redownload'))?.querySelector('.lucide-download'),install:buttons.some(button=>button.textContent.trim()===tr('settings:updates.open_verified_package')||button.querySelector('.lucide-package-open'))};})()`);
            assert.deepEqual(actions,{folder:true,redownload:true,install:false});
          }
          if(name==='windows-check-failed')assert.ok(stateView.text.includes(statusError));
          if(name==='windows-current'){
            assert.ok(!stateView.text.includes(statusError),'A completed update must clear the previous download error');
            assert.equal(await page.webContents.executeJavaScript(`Boolean(document.querySelector('#downloadUpdateBtn'))`),false,'A completed update must hide download actions');
            assert.equal(await page.webContents.executeJavaScript(`Boolean(document.querySelector('#probeUpdateDownloadLinksBtn'))`),true,'A completed update must retain manual speed tests');
          }
          await page.webContents.executeJavaScript(`document.querySelector('#updateCheckArea').scrollIntoView({block:'start'})`);
          await waitForRender(page);
          await capture(page,`${stem}-${name}-summary`);
          await page.webContents.executeJavaScript(`document.querySelector('#updateCheckArea .update-download-links,#updateCheckArea .update-actions')?.scrollIntoView({block:'center'})`);
          await waitForRender(page);
          await capture(page,`${stem}-${name}-actions`);
        }
      }
      await emitSnapshot(page,standard);
      const openedLinks=[];
      page.webContents.setWindowOpenHandler(({url})=>{openedLinks.push(url);return {action:'deny'};});
      const expectedLinks=await page.webContents.executeJavaScript(`(()=>{const links=[...document.querySelectorAll('#settings-about a[target="_blank"]')];links.forEach(link=>link.click());return links.map(link=>link.href);})()`);
      for(let attempt=0;attempt<100&&openedLinks.length<expectedLinks.length;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
      assert.ok(expectedLinks.length>=9,`${stem} external link coverage is incomplete`);
      assert.deepEqual(openedLinks,expectedLinks,`${stem} external buttons did not request their displayed destinations`);
      await page.webContents.executeJavaScript(`(()=>{
        window.__aboutAuditPreviousApi=api;
        window.__aboutAuditUpdateCalls=[];
        api=async (url,options)=>{
          if(url.startsWith('/api/updates/')){
            window.__aboutAuditUpdateCalls.push({url,method:options?.method||'GET'});
            const update=window.termaUpdateStatus.current();
            if(url.startsWith('/api/updates/ignore?'))return {...update,update_ignored:url.endsWith('=1')};
            return update.download_status;
          }
          return window.__aboutAuditPreviousApi(url,options);
        };
      })()`);
      const downloaded=visualStates.find(([name])=>name==='windows-downloaded')[1];
      for(const [name,selector,snapshot] of [
        ['download','#downloadUpdateBtn',standard],
        ['redownload','#downloadUpdateBtn',{...standard,update:{...standard.update,...downloaded.update}}],
        ['open-package','.update-actions button:nth-child(2)',{...standard,update:{...standard.update,...downloaded.update}}],
        ['open-directory','.update-actions button:nth-child(3)',{...standard,update:{...standard.update,...downloaded.update}}]
      ]){
        await loadState(page,snapshot.update);
        await waitForRender(page);
        await page.webContents.executeJavaScript(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});button?.scrollIntoView({block:'center'});button?.focus();button?.click();})()`);
        await waitForRender(page);
        const confirm=await page.webContents.executeJavaScript(`(()=>{const dialog=document.querySelector('.terma-about-confirm');const rect=dialog?.getBoundingClientRect();return {open:Boolean(dialog),withinViewport:Boolean(rect&&rect.left>=0&&rect.top>=0&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1),text:dialog?.textContent||'',focused:document.activeElement?.id||''};})()`);
        await capture(page,`${stem}-confirm-${name}`);
        assert.equal(confirm.open,true,`${name} Vue confirmation did not open: ${JSON.stringify(confirm)}`);
        assert.equal(confirm.withinViewport,true,`${name} confirmation overflows`);
        assert.equal(confirm.focused,'terma-about-confirm-cancel',`${name} did not focus cancel`);
        await page.webContents.executeJavaScript(`document.querySelector('.terma-about-modal-backdrop').click()`);
        await waitForRender(page);
        assert.equal(await page.webContents.executeJavaScript(`Boolean(document.querySelector('.terma-about-confirm'))`),true,`${name} backdrop changed the existing confirmation behavior`);
        await checkModalTabOrder(page,'.terma-about-confirm',`${stem} ${name}`);
        if(language==='en-US')assert.equal(/[\u3400-\u9fff]/.test(confirm.text),false,`${name} contains untranslated text: ${confirm.text}`);
        await page.webContents.executeJavaScript(`document.getElementById('terma-about-confirm-cancel').click()`);
        await waitForRender(page);
        assert.equal(await page.webContents.executeJavaScript(`!document.querySelector('.terma-about-confirm')`),true,`${name} did not cancel`);
      }
      assert.deepEqual(await page.webContents.executeJavaScript(`window.__aboutAuditUpdateCalls`),[],'Cancelling confirmations must not invoke download or open APIs');
      if(width===390&&language==='zh-CN'&&theme==='light'||width===1200&&language==='en-US'&&theme==='dark'){
        for(const [name,selector,snapshot,url] of [
          ['download','#downloadUpdateBtn',standard,'/api/updates/download'],
          ['redownload','#downloadUpdateBtn',{...standard,update:{...standard.update,...downloaded.update}},'/api/updates/download'],
          ['open-package','.update-actions button:nth-child(2)',{...standard,update:{...standard.update,...downloaded.update}},'/api/updates/open'],
          ['open-directory','.update-actions button:nth-child(3)',{...standard,update:{...standard.update,...downloaded.update}},'/api/updates/open-directory']
        ]){
          await loadState(page,snapshot.update);
          await waitForRender(page);
          await page.webContents.executeJavaScript(`(()=>{window.__aboutAuditUpdateCalls=[];document.querySelector(${JSON.stringify(selector)}).click();})()`);
          await waitForRender(page);
          await page.webContents.executeJavaScript(`document.querySelector('.terma-about-confirm .terma-about-modal-actions button:last-child').click()`);
          await waitForRender(page);
          const calls=await page.webContents.executeJavaScript(`window.__aboutAuditUpdateCalls`);
          assert.deepEqual(calls,[{url,method:'POST'}],`${name} confirmation did not dispatch exactly one expected API action`);
        }
        for(const enabled of [true,false]){
          await loadState(page,{...standard.update,update_ignored:!enabled});
          await waitForRender(page);
          await page.webContents.executeJavaScript(`(()=>{window.__aboutAuditUpdateCalls=[];document.getElementById('updateIgnoreCurrentVersion').click();})()`);
          await waitForRender(page);
          assert.equal(await page.webContents.executeJavaScript(`document.getElementById('updateIgnoreCurrentVersion').checked`),enabled,`ignore ${enabled} did not retain its saved value`);
          assert.deepEqual(await page.webContents.executeJavaScript(`window.__aboutAuditUpdateCalls`),[{url:`/api/updates/ignore?enabled=${enabled?'1':'0'}`,method:'POST'}],`ignore ${enabled} did not dispatch the expected API action`);
        }
      }
      await page.webContents.executeJavaScript(`api=window.__aboutAuditPreviousApi;delete window.__aboutAuditPreviousApi;delete window.__aboutAuditUpdateCalls;`);
      assert.deepEqual(diagnostics,[],`${stem} browser console or loading errors`);
      results.push({width,language,theme,arch:options.arch,...metrics});
      console.log('About visual check passed',width,language,theme);
    } finally {
      page.destroy();
    }
  }
  console.log('fnOS updates UI passed',JSON.stringify(results));
}
module.exports={runFnosUpdatesUiScenario};
