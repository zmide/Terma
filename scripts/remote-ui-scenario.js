const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {runRemoteRuntimeUiScenario}=require('./remote-runtime-ui-scenario');
const {runRemoteGraphicsUiScenario}=require('./remote-graphics-ui-scenario');
const {runRemoteManagementUiScenario}=require('./remote-management-ui-scenario');
const {ftpOwnershipStates}=require('./m7-transport-ui-states');
const {captureElectronSurface} = require('./electron-surface-screenshot');

async function runRemoteUiScenario(browser,{transportOnly=false}={}) {
  const directory = process.env.TERMA_REMOTE_VISUAL_DIR || path.join(process.cwd(), 'data', 'remote-visual');
  fs.mkdirSync(directory, { recursive: true });
  const screenshots = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const execute = source => browser.webContents.executeJavaScript(/^\s*\(async/.test(source) ? source : `(async()=>{${source}})()`);
  const evaluate = source => execute(`return (${source})`);
  const wait = async condition => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await execute(`return !!(${condition})`)) return;
      await delay(20);
    }
    throw new Error(`Remote UI timed out waiting for ${condition}`);
  };
  const shot = async name => {
    await captureElectronSurface(browser, path.join(directory, `${name}.png`));
    screenshots.push(`${name}.png`);
  };
  const click = async selector => {
    const point = await execute(`const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('Missing '+${JSON.stringify(selector)});element.scrollIntoView({block:'nearest'});const r=element.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
      browser.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
      await delay(20);
    }
  };
  const assertions = [];
  const checkView = async name => {
    const result = await execute(`const root=document.querySelector('#view-ftp');if(!root)return {visible:false,object:false,duplicates:[],overflow:false,listOverflow:false,chinese:false,rows:0,viewOwner:false,controls:false};const ids=[...document.querySelectorAll('[id]')].filter(e=>e.checkVisibility()).map(e=>e.id);const content=[root.textContent,...[...root.querySelectorAll('[title],[aria-label],input')].flatMap(e=>[e.title,e.getAttribute('aria-label'),e.placeholder])].join(' ');const list=root.querySelector('.ftp-list');return {visible:root.checkVisibility(),object:root.textContent.includes('[object Object]'),duplicates:ids.filter((id,i)=>ids.indexOf(id)!==i),overflow:document.documentElement.scrollWidth>innerWidth+1,listOverflow:list?list.scrollWidth>list.clientWidth+1:false,chinese:document.documentElement.lang==='en-US'&&/[\\u3400-\\u9fff]/.test(content),rows:root.querySelectorAll('.ftp-row').length,viewOwner:root.classList.contains('terma-remote-root'),controls:[...root.querySelectorAll('.ftp-toolbar button,.ftp-row-actions button')].every(e=>e.classList.contains('terma-button'))}`);
    assert.equal(result.visible, true, `${name} FTP view visible`);
    assert.equal(result.object, false, `${name} has no coerced object text`);
    assert.deepEqual(result.duplicates, [], `${name} has unique visible IDs`);
    assert.equal(result.overflow, false, `${name} has no page overflow`);
    assert.equal(result.listOverflow, false, `${name} file actions fit the list`);
    assert.equal(result.chinese,false,`${name} visible text and accessible labels translate`);
    assert.equal(result.viewOwner, true, `${name} view is owned by Vue`);
    assert.equal(result.controls, true, `${name} actionable buttons use Tile UI adapter`);
    assertions.push({ name, ...result });
  };

  await execute(`await window.termaI18nReady;window.termaWorkspaceRefresh.stop();window.__remoteOriginalApi=api;window.__ftpFixture={
    id:9791,protocol:'ftp',name:'Fixture FTP',group_name:'Fixture group',host:'ftp.example.test',port:21,username:'review',options:{base_path:'/workspace'}
  };window.__ftpEntries=[
    {name:'Documents',type:'directory'},
    {name:'README.txt',type:'file',size:1536,modified_at:'2026-10-19T02:30:00.000Z'},
    {name:'latest',type:'link',size:0}
  ];window.__ftpRequests=[];window.__ftpDelay=0;remoteProfiles=[window.__ftpFixture];
    api=async(route,options={})=>{
      if(String(route).startsWith('/api/remote-profiles/9791/ftp')){
        window.__ftpRequests.push({route,method:options.method||'GET'});
        if(window.__ftpDelay)await new Promise(resolve=>setTimeout(resolve,window.__ftpDelay));
        if(String(route).includes('ftp?path=%2Ferror'))throw Error('Fixture network unavailable');
        if(String(route).includes('/ftp/mkdir')){const body=JSON.parse(options.body);window.__ftpEntries.push({name:body.name,type:'directory'});return {ok:true};}
        if(String(route).includes('/ftp/rename')){const body=JSON.parse(options.body);const entry=window.__ftpEntries.find(item=>item.name===body.name);if(entry)entry.name=body.new_name;return {ok:true};}
        if(String(route).includes('/ftp/delete')){const body=JSON.parse(options.body);window.__ftpEntries=window.__ftpEntries.filter(item=>item.name!==body.name);return {ok:true};}
        if(String(route).includes('/ftp?')){const url=new URL(route,location.origin);const target=url.searchParams.get('path')||'/';if(target==='/empty')return {path:target,entries:[]};if(target==='/workspace/Documents')return {path:target,entries:[{name:'manual.pdf',type:'file',size:82}]};return {path:target,entries:window.__ftpEntries};}
      }
      return window.__remoteOriginalApi(route,options);
    };
    window.__remoteOriginalFetch=window.fetch;
    window.fetch=async(input,options)=>{if(String(input).includes('/api/remote-profiles/9791/ftp/upload')){window.__ftpUpload={path:options.body.get('path'),name:options.body.get('file').name};return new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}});}return window.__remoteOriginalFetch(input,options)};
    window.__ftpAnchorClick=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(this.href.includes('/api/remote-profiles/9791/ftp/download')){window.__ftpDownload=this.href;return;}return window.__ftpAnchorClick.call(this);};
  `);

  for (const width of [1200, 390]) for (const theme of ['light', 'dark']) for (const language of ['zh-CN', 'en-US']) {
    const prefix = `${language}-${theme}-${width}`;
    browser.setContentSize(width, 844);
    await wait(width <= 760 ? 'isMobileLayout()' : '!isMobileLayout()');
    await execute(`closeModal();applyTheme('${theme}');await setTermaLanguage('${language}');window.__ftpEntries=[{name:'Documents',type:'directory'},{name:'README.txt',type:'file',size:1536,modified_at:'2026-10-19T02:30:00.000Z'},{name:'latest',type:'link',size:0}];window.termaWorkspaceShell.showPrimary('remote');window.__ftpDelay=220;window.termaRemoteTransport.ftp.open(9791,'/workspace',true,'ftp-9791')`);
    await wait("document.querySelector('#view-ftp')?.classList.contains('terma-remote-root')");
    await shot(`${prefix}-loading`);
    await wait("window.termaRemoteTransport.ftp.states.get('ftp-9791')?.loading===false");
    await checkView(`${prefix}-listing`);
    await shot(`${prefix}-listing`);
    assert.equal(await evaluate("document.querySelector('#view-ftp .ftp-table')?.getAttribute('role')==='table'&&document.querySelectorAll('#view-ftp [role=columnheader]').length===4"), true, `${prefix} table semantics`);

    await execute("await window.termaRemoteTransport.ftp.load('ftp-9791','/empty')");
    await checkView(`${prefix}-empty`); await shot(`${prefix}-empty`);
    await execute("try{await window.termaRemoteTransport.ftp.load('ftp-9791','/error')}catch{}");
    await checkView(`${prefix}-error`); await shot(`${prefix}-error`);
    await click('#view-ftp .ftp-state button');
    await wait("window.termaRemoteTransport.ftp.states.get('ftp-9791')?.loading===false&&!window.termaRemoteTransport.ftp.states.get('ftp-9791')?.error");
    await execute("await window.termaRemoteTransport.ftp.load('ftp-9791','/workspace')");
    await click('#view-ftp .ftp-toolbar button:nth-of-type(2)');
    await wait("window.termaRemoteTransport.ftp.states.get('ftp-9791')?.loading===false");

    await execute("const path=document.querySelector('#view-ftp [data-ftp-path]');path.value='/workspace/Documents';path.dispatchEvent(new Event('input',{bubbles:true}));path.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    await wait("window.termaRemoteTransport.ftp.states.get('ftp-9791')?.loading===false");
    assert.equal(await evaluate("window.termaRemoteTransport.ftp.states.get('ftp-9791')?.path==='/workspace/Documents'"), true, `${prefix} navigates to a directory`);
    await click('#view-ftp [aria-label="上一级"],#view-ftp [aria-label="Go to parent"]');
    await wait("window.termaRemoteTransport.ftp.states.get('ftp-9791')?.loading===false");

    await click('#view-ftp [aria-label="打开: Documents"],#view-ftp [aria-label="Open: Documents"]');
    await wait("window.termaRemoteTransport.ftp.states.get('ftp-9791')?.path==='/workspace/Documents'&&document.querySelector('#view-ftp .ftp-entry-name')?.textContent==='manual.pdf'");
    await shot(`${prefix}-open-directory`);
    await click('#view-ftp [aria-label="上一级"],#view-ftp [aria-label="Go to parent"]');
    await wait("window.termaRemoteTransport.ftp.states.get('ftp-9791')?.path==='/workspace'&&document.querySelector('#view-ftp .ftp-entry-name')?.textContent==='Documents'");

    await click('#view-ftp [aria-label="新建文件夹"],#view-ftp [aria-label="New directory"]');
    await wait("!document.querySelector('#modal').hidden&&document.querySelector('#modal .ftp-action-dialog')");
    await shot(`${prefix}-create-dialog`);
    if (language === 'en-US') assert.equal(await evaluate("document.querySelector('#ftpDialogTitle')?.textContent.trim()==='New FTP directory'"), true, `${prefix} English create dialog`);
    await execute("document.querySelector('#ftpDialogInput').value='created-by-ui';document.querySelector('#ftpDialogInput').dispatchEvent(new Event('input',{bubbles:true}))");
    await click('#modal .actions .primary'); await wait("document.querySelector('#modal').hidden&&window.__ftpEntries.some(item=>item.name==='created-by-ui')&&window.termaRemoteTransport.ftp.states.get('ftp-9791')?.loading===false");
    assert.equal(await evaluate("window.__ftpEntries.some(item=>item.name==='created-by-ui')"), true, `${prefix} creates directory through bridge`);
    await shot(`${prefix}-after-create`);

    await click('#view-ftp [aria-label^="重命名: README.txt"],#view-ftp [aria-label^="Rename: README.txt"]');
    await wait("!document.querySelector('#modal').hidden&&document.querySelector('#ftpDialogInput')");
    await shot(`${prefix}-rename-dialog`);
    await execute("document.querySelector('#ftpDialogInput').value='guide.txt';document.querySelector('#ftpDialogInput').dispatchEvent(new Event('input',{bubbles:true}))");
    await click('#modal .actions .primary'); await wait("document.querySelector('#modal').hidden&&window.__ftpEntries.some(item=>item.name==='guide.txt')&&window.termaRemoteTransport.ftp.states.get('ftp-9791')?.loading===false");
    assert.equal(await evaluate("window.__ftpEntries.some(item=>item.name==='guide.txt')"), true, `${prefix} renames entry through bridge`);

    await click('#view-ftp [aria-label^="删除: guide.txt"],#view-ftp [aria-label^="Delete: guide.txt"]');
    await wait("!document.querySelector('#modal').hidden&&document.querySelector('#modal .ftp-action-dialog[role=alertdialog]')");
    await shot(`${prefix}-delete-confirm`);
    await click('#modal .actions button:not(.danger)');
    assert.equal(await evaluate("document.querySelector('#modal').hidden&&window.__ftpEntries.some(item=>item.name==='guide.txt')"), true, `${prefix} delete cancel preserves entry`);
    await click('#view-ftp [aria-label^="删除: guide.txt"],#view-ftp [aria-label^="Delete: guide.txt"]');
    await wait("!document.querySelector('#modal').hidden");
    await click('#modal .actions .danger'); await wait("document.querySelector('#modal').hidden&&!window.__ftpEntries.some(item=>item.name==='guide.txt')&&window.termaRemoteTransport.ftp.states.get('ftp-9791')?.loading===false");
    assert.equal(await evaluate("!window.__ftpEntries.some(item=>item.name==='guide.txt')"), true, `${prefix} confirms deletion through bridge`);
    await shot(`${prefix}-after-delete`);

    await ftpOwnershipStates({prefix,language,execute,evaluate,wait,shot,click,assertions});
    if (language === 'zh-CN' && theme === 'light' && width === 1200) {
      await click('#view-ftp [aria-label="新建文件夹"]'); await wait("!document.querySelector('#modal').hidden&&document.querySelector('#ftpDialogInput')");
      await execute("const input=document.querySelector('#ftpDialogInput');input.value='unsaved-folder';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(1,4);window.__ftpDraftInput=input;await setTermaLanguage('en-US');await window.termaQuickLocalizationReady;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
      assert.equal(await evaluate("document.querySelector('#ftpDialogTitle')?.textContent.trim()==='New FTP directory'"), true, 'open FTP dialog refreshes language');
      assert.equal(await evaluate("document.activeElement===window.__ftpDraftInput&&window.__ftpDraftInput.value==='unsaved-folder'&&window.__ftpDraftInput.selectionStart===1"),true,'FTP modal locale preserves draft, focus and caret');
      await shot('live-language-dialog-en-US');
      await click('#modal .actions button:not(.primary)');
      assert.equal(await evaluate("document.querySelector('#modal').hidden"), true, 'FTP dialog cancellation closes and releases dialog');
    }
  }

  await execute("const input=document.querySelector('#view-ftp [data-ftp-upload]');const files=new DataTransfer();files.items.add(new File(['fixture'],'fixture-upload.txt',{type:'text/plain'}));input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}))");
  await wait("window.__ftpUpload&&window.termaRemoteTransport.ftp.states.get('ftp-9791')?.loading===false");
  assert.equal(await evaluate("window.__ftpUpload.path==='/workspace'&&window.__ftpUpload.name==='fixture-upload.txt'"),true,'file input uploads only to its FTP profile and directory');
  await click('#view-ftp [aria-label^="Download: latest"]');await wait("window.__ftpDownload");
  assert.equal(await evaluate("new URL(window.__ftpDownload).searchParams.get('path')==='/workspace'&&new URL(window.__ftpDownload).searchParams.get('name')==='latest'"),true,'download preserves its profile and path');
  await execute("const state=window.termaRemoteTransport.ftp.states.get('ftp-9791');state.entries.push({name:'<img src=x onerror=window.__ftpInjected=true>',type:'file',size:1});window.termaRemoteTransport.ftp.refresh()");
  assert.equal(await evaluate("!document.querySelector('#view-ftp .ftp-table img')&&!window.__ftpInjected&&document.querySelector('#view-ftp .ftp-table').textContent.includes('<img src=x')"),true,'untrusted file names render only as text');
  await execute("window.termaRemoteTransport.ftp.open(9791,'/workspace/Documents',true,'ftp-9791-second')");
  await wait("window.termaRemoteTransport.ftp.states.get('ftp-9791-second')?.loading===false");
  await execute("await window.termaRemoteTransport.ftp.load('ftp-9791','/empty');window.termaRemoteTransport.ftp.refresh()");
  assert.equal(await evaluate("document.querySelector('#view-ftp').dataset.ftpTabKey==='ftp-9791-second'&&document.querySelector('#view-ftp').textContent.includes('manual.pdf')&&window.termaRemoteTransport.ftp.states.get('ftp-9791').path==='/empty'&&window.termaRemoteTransport.ftp.states.get('ftp-9791-second').path==='/workspace/Documents'"),true,'inactive FTP requests cannot overwrite another tab view or path');

  await runRemoteRuntimeUiScenario(browser,{execute,evaluate,wait,shot,click,assertions,transportOnly});
  if(!transportOnly){await runRemoteGraphicsUiScenario(browser,{execute,evaluate,wait,shot,click,assertions});await runRemoteManagementUiScenario(browser,{execute,evaluate,wait,shot,click,assertions});}
  await execute("api=window.__remoteOriginalApi;window.fetch=window.__remoteOriginalFetch;HTMLAnchorElement.prototype.click=window.__ftpAnchorClick;closeModal();");
  const report={screenshots:directory,checks:assertions.length,assertions,realTransport:false,states:screenshots};
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  return report;
}

module.exports = { runRemoteUiScenario };
