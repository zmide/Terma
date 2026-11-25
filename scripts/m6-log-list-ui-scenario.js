const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
async function runM6LogListUiScenario(browser,{viewport='desktop'}={}){
 const directory=path.join(process.env.TERMA_LOG_LIST_VISUAL_DIR||path.join(process.cwd(),'data/m6-log-list-visual'),viewport);fs.mkdirSync(directory,{recursive:true});let screenshots=0;const report=[];
 const evaluate=s=>browser.webContents.executeJavaScript(`(async()=>{${s}})()`),delay=ms=>new Promise(r=>setTimeout(r,ms));
 const check=async(name,expression)=>{const ok=await evaluate(`return !!(${expression});`);report.push({name,ok});assert.ok(ok,name);};
 const click=async selector=>{const p=await evaluate(`const n=[...document.querySelectorAll(${JSON.stringify(selector)})].find(n=>n.checkVisibility());if(!n||n.disabled)throw Error('Missing log control '+${JSON.stringify(selector)});n.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(r));const b=n.getBoundingClientRect();if(!n.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)))throw Error('Covered log control');return {x:b.x+b.width/2,y:b.y+b.height/2};`);for(const type of ['mouseMove','mouseDown','mouseUp'])browser.webContents.sendInputEvent({type,button:'left',clickCount:1,...p});await delay(60);};
 const fill=async value=>{await click('#logSearch');await evaluate(`document.querySelector('#logSearch').select()`);browser.webContents.insertText(value);await delay(360);};
 const shot=async name=>{await delay(70);fs.writeFileSync(path.join(directory,name+'.png'),(await browser.webContents.capturePage()).toPNG());screenshots++;await check(name+' flat, escaped, translated and bounded',`[...document.querySelectorAll('.terma-log-list-root')].every(r=>r.scrollWidth<=r.clientWidth+2&&!r.querySelector('img[src=x],[onerror]')&&!(document.documentElement.lang==='en-US'&&/[\u3400-\u9fff]/.test(r.textContent))&&[...r.querySelectorAll('button')].every(b=>{const a=b.getBoundingClientRect(),p=r.getBoundingClientRect();return a.left>=p.left-2&&a.right<=p.right+2&&getComputedStyle(b).boxShadow==='none'&&getComputedStyle(b).backgroundImage==='none';}))`);};
 await evaluate(`
  await window.termaI18nReady;
  while(window.workspaceRestorePending)await new Promise(r=>setTimeout(r,20));
  window.termaWorkspaceRefresh.stop();window.termaWorkspaceShell.dismissGuide();
  closeModal();window.termaEfficiency.palette.close();
  const f=window.__logListQa={api,openLog:window.termaLogReader.feature().service.open,primaryView,showLogSettings:window.termaLogMaintenance.settings,calls:[],opened:[],mode:'normal',pending:false};
  f.reset=()=>{
    window.termaLogList.release();
    f.calls=[];f.opened=[];f.mode='normal';f.pending=false;logSearch='';
    logOpen.clear();logOpen.add('system');logOpen.add('batch');
    const model=window.termaLogList.service().model;
    model.query='';model.hits.clear();model.pages.clear();model.open=new Set(['system','batch']);
    f.data={system:Array.from({length:12},(_,i)=>({path:'system/'+i+'.log',label:'Review system '+i,size_bytes:1024})),batch:[{path:'batch/a.log',label:'Review batch'}],connections:[{name:'Review server',logs:[{path:'terminals/a.log',label:'Review terminal-2026年7月30日 01:31:49'}]}]};
  };
  api=async(url,o={})=>{
    if(url==='/api/logs'||url.startsWith('/api/logs/search?')||url==='/api/logs/delete'){
      f.calls.push({url,data:o.body&&JSON.parse(o.body)});
      if(f.pending)await new Promise(r=>f.finish=r);
      if(f.mode==='error')throw Error('Review log API error <img src=x>');
      if(url==='/api/logs')return f.data;
      if(url.startsWith('/api/logs/search?'))return [{path:'system/0.log',matches:[{line:42,text:'Review needle <img src=x>'}]}];
      const ids=JSON.parse(o.body).paths;f.data.system=f.data.system.filter(v=>!ids.includes(v.path));return {deleted:ids};
    }
    return f.api(url,o);
  };
  window.termaLogReader.feature().service.open=(...args)=>f.opened.push(args);
  window.termaLogMaintenance.settings=async()=>f.settings=true;
  f.reset();
 `);
 try{for(const theme of ['light','dark'])for(const lang of ['zh-CN','en-US']){const name=lang+'-'+theme,other=lang==='en-US'?'zh-CN':'en-US';
  await evaluate(`closeModal();window.__logListQa.reset();applyTheme('${theme}');await setTermaLanguage('${other}');primaryView='logs';window.termaConnectionViews.renderExplorerTools();await window.termaLogList.renderExplorer();if(isMobileLayout())window.termaWorkspaceShell.showMobileExplorer();await setTermaLanguage('${lang}');`);await shot(name+'-list');
  await check(name+' primary left aligned',`(()=>{const b=document.querySelector('.log-list-tools>.primary'),r=b.getBoundingClientRect(),i=b.querySelector('svg').getBoundingClientRect();return i.left-r.left<18;})()`);
  await click('.log-list-group-main');await shot(name+'-collapsed');await click('.log-list-group-main');
  await click('.log-list-pager button:last-child');await shot(name+'-last-page');await check(name+' 10 item paging',`document.querySelectorAll('.log-list-group:first-child .log-list-row').length===2`);await click('.log-list-pager button:first-child');
  await click('.log-list-group:last-child .log-list-group-main');await shot(name+'-terminal-time');await check(name+' full terminal timestamp',`document.querySelector('.log-item-time').textContent==='2026-07-30 01:31:49'`);
  await fill('needle');await shot(name+'-search');await check(name+' search safely highlighted',`document.querySelector('.log-item-hit mark').textContent==='needle'&&!document.querySelector('.log-item-hit img')`);await click('.log-list-file');await check(name+' opens matching line',`window.__logListQa.opened.at(-1).slice(-2).join(',')==='needle,42'`);
  await evaluate(`const input=document.querySelector('#logSearch');input.focus();input.setSelectionRange(1,3);window.__logInput=input;await setTermaLanguage('${other}');`);await shot(name+'-live-language');await check(name+' live query and caret',`window.__logInput===document.querySelector('#logSearch')&&window.__logInput.value==='needle'&&window.__logInput.selectionStart===1`);await evaluate(`await setTermaLanguage('${lang}');`);
  await fill('no match');await evaluate(`window.termaLogList.service().model.hits.clear();window.termaLogList.service().refresh();`);await shot(name+'-no-matches');await fill('');
  await click('.log-list-row .danger');await shot(name+'-delete-confirm');await click('#modal button:last-child');await check(name+' cancel sends no deletion',`!window.__logListQa.calls.some(c=>c.url==='/api/logs/delete')`);
  await click('.log-list-group header .danger');await shot(name+'-group-delete-confirm');await click('#modal button:last-child');
  await evaluate(`window.__logListQa.pending=true;void window.termaLogList.renderExplorer();`);await shot(name+'-loading');await evaluate(`window.__logListQa.pending=false;window.__logListQa.finish();`);await delay(80);
  await evaluate(`window.__logListQa.mode='error';await window.termaLogList.renderExplorer();`);await shot(name+'-error');await evaluate(`window.__logListQa.mode='normal';`);await click('.log-list-error button');await check(name+' error retry',`!window.termaLogList.service().error()`);
  await evaluate(`window.__logListQa.data={system:[],batch:[],connections:[]};await window.termaLogList.renderExplorer();`);await shot(name+'-empty');
 }}finally{fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({checks:report.length,screenshots,report},null,2));await evaluate(`window.termaLogList.release();const f=window.__logListQa;api=f.api;window.termaLogReader.feature().service.open=f.openLog;primaryView=f.primaryView;window.termaLogMaintenance.settings=f.showLogSettings;closeModal();delete window.__logListQa;`);}
 return {scenario:'m6-log-list',viewport,checks:report.length,screenshots};
}module.exports={runM6LogListUiScenario};
