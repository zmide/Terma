const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
async function runM6RunningUiScenario(browser,{viewport='desktop'}={}){
  if(!browser.webContents.debugger.isAttached()) browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  const directory=path.join(process.env.TERMA_RUNNING_VISUAL_DIR||path.join(process.cwd(),'data/m6-running-visual'),viewport);fs.mkdirSync(directory,{recursive:true});
  const evaluate=source=>browser.webContents.executeJavaScript(`(async()=>{${source}})()`),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const report=[];let screenshots=0;const opened=[];browser.webContents.setWindowOpenHandler(details=>{opened.push(details.url);return {action:'deny'};});
  const check=async(name,expression)=>{const result=await evaluate(`return !!(${expression});`);report.push({name,result});if(!result)console.error('Running UI diagnostic',await evaluate(`return {primaryView,ids:connections.map(row=>row.id),query:document.querySelector('#runningFilterInput')?.value,placeholder:document.querySelector('#runningFilterInput')?.placeholder,rows:document.querySelectorAll('.forward-running-row').length,hasReplacement:!!document.querySelector('#running-replacement'),calls:window.__running?.calls,modalHidden:$('modal').hidden,tree:document.querySelector('#connectionGroups').innerHTML.slice(0,600)};`));assert.equal(result,true,name);};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(`return !!(${expression});`))return;await delay(25);}throw Error('Running UI wait: '+expression);};
  const shot=async name=>{
    await evaluate('await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));');await delay(60);browser.webContents.invalidate();fs.writeFileSync(path.join(directory,name+'.png'),(await browser.webContents.capturePage()).toPNG());screenshots++;
    await check(name+' flat and no overflow',`[...document.querySelectorAll('.terma-running-root')].every(root=>root.scrollWidth<=root.clientWidth+2&&[...root.querySelectorAll('button,.forward-running-row')].every(node=>getComputedStyle(node).boxShadow==='none'&&getComputedStyle(node).backgroundImage==='none'))`);
    await check(name+' escaped text',`!document.querySelector('.terma-running-root img[src=x],.terma-running-root [onerror]')`);
    await check(name+' toolbar left aligned',`[...document.querySelectorAll('.running-tools button')].every(node=>{const r=node.getBoundingClientRect(),icon=node.querySelector('svg').getBoundingClientRect();return icon.left-r.left<18&&node.scrollWidth<=node.clientWidth+1;})`);
    await check(name+' English labels',`document.documentElement.lang!=='en-US'||![...document.querySelectorAll('.terma-running-root')].some(root=>/[\u3400-\u9fff]/.test(root.textContent))`);
  };
  const click=async selector=>{
    const point=await evaluate(`const node=document.querySelector(${JSON.stringify(selector)});if(!node?.checkVisibility()||node.disabled)throw Error('Missing running control '+${JSON.stringify(selector)});node.scrollIntoView({block:'nearest',inline:'nearest'});await new Promise(resolve=>requestAnimationFrame(resolve));const r=node.getBoundingClientRect(),point={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};if(!node.contains(document.elementFromPoint(point.x,point.y)))throw Error('Covered running control '+${JSON.stringify(selector)});return point;`);
    browser.webContents.sendInputEvent({type:'mouseMove',...point});browser.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});browser.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await delay(70);
  };
  const clickToolbar=async key=>click(await evaluate(`return '.running-tools button[aria-label="'+CSS.escape(tr(${JSON.stringify(key)}))+'"]';`));
  // Let an already requested revision finish before replacing the application data with fixtures.
  await evaluate(`await window.termaI18nReady;while(window.workspaceRestorePending||window.termaBootstrapRuntime?.getSnapshot().phase!=='ready')await new Promise(resolve=>setTimeout(resolve,20));window.termaWorkspaceRefresh.stop();await new Promise(resolve=>setTimeout(resolve,500));while(window.termaWorkspaceRefresh.loading)await new Promise(resolve=>setTimeout(resolve,20));window.termaWorkspaceShell.dismissGuide();closeModal();window.termaEfficiency.palette.close();window.termaSftpTaskWorkspace.runtime.close();
    window.__running={api,connections,loadAll:window.termaWorkspaceRefresh.load,primaryView,openManager:window.termaForwardWorkspace.openManager,copyText,openSystemLogAt:window.termaLogReader.feature().service.date,runningFilter:localStorage.getItem('runningFilter'),calls:[],reloads:0,copied:[],managed:[],logs:[],mode:'normal',occupied:false};const f=window.__running;
    const style=document.createElement('style');style.id='running-qa-notices';style.textContent='#toast,#notice{display:none!important}';document.head.append(style);
    f.reset=()=>{f.mode='normal';f.occupied=false;f.calls=[];connections=[{id:7801,name:'Review host',group_name:'Review',ssh_host:'example.invalid',ssh_user:'review',ssh_port:22,auth_type:'key',forwards:[
      {id:11,mode:'local',status:'running',service_name:'Web <img src=x>',service_type:'web',service_note:'Review note',bind_host:'127.0.0.1',bind_port:18080,target_host:'::1',target_port:80,pid:44001,started_at:Date.now()/1000-60},
      {id:12,mode:'local',status:'failed',service_name:'Failed rule',bind_host:'127.0.0.1',bind_port:18081,target_host:'127.0.0.1',target_port:22,last_error:'Review error <img src=x>',updated_at:Date.now()/1000},
      {id:13,mode:'socks',status:'reconnecting',service_name:'Proxy',bind_host:'127.0.0.1',bind_port:1080,reconnect_count:2},
      {id:14,mode:'remote',status:'running',service_name:'Remote rule',bind_host:'127.0.0.1',bind_port:5900,target_host:'127.0.0.1',target_port:5900},
      {id:15,mode:'local',status:'stopped',service_name:'Stopped rule'}]}];};
    api=async(url,options)=>{if(url==='/api/connections'&&!options?.method)return connections;if(options?.method){f.calls.push({url,method:options.method,body:options.body});if(url==='/api/ports/kill')throw Error('Fixture must never control host processes');if(url==='/api/ports/diagnose'){if(f.diagnosisPending)await new Promise(resolve=>f.finishDiagnosis=resolve);return {occupied:f.occupied&&JSON.parse(options.body).port===18080,host:'127.0.0.1',port:18080,processes:[{pid:77001,name:'Review process',path:'/fixture/review'}]};}if(url==='/api/ports/recommend')return {recommended_port:19090};const found=url.match(/^\\/api\\/forwards\\/(\\d+)(?:\\/(stop|start))?$/);if(found){const item=window.termaForwardWorkspace.find(Number(found[1]));if(f.mode==='error')throw Error('Review operation error <img src=x>');if(f.mode==='pending')await new Promise(resolve=>f.finishAction=resolve);if(options.method==='PUT')Object.assign(item,JSON.parse(options.body));else item.status=found[2]==='start'?'running':'stopped';return {};}if(url==='/api/forwards/restore')return {ok:3,failed:0};throw Error('Unexpected running write '+url);}return f.api(url,options);};
    window.termaWorkspaceRefresh.load=async()=>{f.reloads++;if(f.refreshPending)await new Promise(resolve=>f.finishRefresh=resolve);if(primaryView==='running')window.termaForwardWorkspace.renderRunning();};window.termaForwardWorkspace.openManager=(update,id)=>f.managed.push(id||0);copyText=async value=>f.copied.push(value);window.termaLogReader.feature().service.date=value=>f.logs.push(value);
  `);
  try{
    for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']){
      const name=language+'-'+theme,opposite=language==='zh-CN'?'en-US':'zh-CN';
      await evaluate(`closeModal();applyTheme('${theme}');await setTermaLanguage('${opposite}');window.__running.reset();primaryView='running';window.termaConnectionViews.renderExplorerTools();window.termaForwardWorkspace.renderRunning();window.termaRunning.service().search('');if(isMobileLayout())window.termaWorkspaceShell.showMobileExplorer();`);
      await click('#runningFilterInput');
      await evaluate(`document.getElementById('runningFilterInput').focus();`);
      browser.webContents.insertText('Failed');
      await wait(`document.getElementById('runningFilterInput').value==='Failed'`);
      await wait(`document.querySelectorAll('.forward-running-row').length===1`);
      await evaluate(`document.getElementById('runningFilterInput').setSelectionRange(1,3);await setTermaLanguage('${language}');`);
      await check(name+' live language and search draft',`document.querySelectorAll('.forward-running-row').length===1&&document.querySelector('#runningFilterInput').value==='Failed'&&document.querySelector('#runningFilterInput').placeholder===tr('connections:forward_manager.search_current')`);
      await shot(name+'-filtered');await evaluate(`window.termaRunning.service().search('');`);await shot(name+'-all-states');
      await check(name+' named primary action and two accessible icon actions',`(()=>{const actions=[...document.querySelectorAll('.running-tools button')];return actions.map(b=>b.getAttribute('aria-label')).join('|')===['connections:forward_manager.manage_all','connections:auto.restore_forwards','connections:forward_manager.stop_all'].map(k=>tr(k)).join('|')&&actions.every((b,index)=>b.querySelector('svg')&&b.title===b.getAttribute('aria-label')&&b.textContent.trim()===(index===0?b.title:''));})()`);
      await check(name+' running status contrast',`(()=>{const node=document.querySelector('.running-status.running'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});canvas.width=canvas.height=1;const light=color=>{ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const values=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;});return .2126*values[0]+.7152*values[1]+.0722*values[2];};const foreground=light(getComputedStyle(node).color),background=light(getComputedStyle(document.documentElement).getPropertyValue('--sidebar').trim());return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05)>=4.5;})()`);
      await check(name+' overview and stopped exclusion',`document.querySelectorAll('.forward-running-row').length===4&&window.termaRunning.service().rows().counts.running===2&&!document.querySelector('[data-forward-id="15"]')`);
      await click('.running-tools button:nth-child(1)');await check(name+' manage all entry',`window.__running.managed.at(-1)===0`);
      await click('[data-forward-id="11"] .running-forward-main');await check(name+' rule manage entry',`window.__running.managed.at(-1)===11`);
      await click('[data-forward-id="11"] .running-actions .icon-button');await check(name+' copy address',`window.__running.copied.at(-1)==='http://127.0.0.1:18080/'`);
      await click('[data-forward-id="11"] .open-forward-link');assert.ok(opened.at(-1).startsWith('http://127.0.0.1:18080/'),'Anchor opens validated URL through denied test popup');
      await click('[data-forward-id="12"] .forward-error-log-link');await check(name+' failure log entry',`window.__running.logs.at(-1)>0`);
      await evaluate(`window.__running.mode='error';`);await click('[data-forward-id="12"] .running-stop');await shot(name+'-stop-error');
      await evaluate(`window.__running.mode='pending';`);await click('[data-forward-id="12"] .running-stop');await shot(name+'-stop-busy');
      await check(name+' per-rule buttons locked',`document.querySelector('[data-forward-id="12"] .running-retry').disabled&&document.querySelector('[data-forward-id="12"] .running-stop').disabled`);
      await evaluate(`window.__running.mode='normal';window.__running.finishAction();`);await wait(`!document.querySelector('[data-forward-id="12"]')`);
      await evaluate(`window.__running.occupied=true;`);await click('[data-forward-id="11"] .running-retry');await wait(`document.querySelector('#modal [data-choice="2"]')`);await shot(name+'-port-conflict');
      await click('#modal [data-choice="0"]');await wait(`document.querySelector('#modal [data-choice="1"]')`);await shot(name+'-process-confirm');await click('#modal [data-choice="1"]');await wait(`$('modal').hidden`);
      await wait(`!document.querySelector('[data-forward-id="11"] .running-retry').disabled`);
      await click('[data-forward-id="11"] .running-retry');await wait(`document.querySelector('#modal [data-choice="2"]')`);await click('#modal [data-choice="1"]');await wait(`document.querySelector('#modal [data-choice="0"]')`);await shot(name+'-recommended-port');await click('#modal [data-choice="0"]');
      await wait(`window.__running.calls.some(call=>call.url==='/api/forwards/11/start')`);
      await check(name+' recommended port retry',`window.termaForwardWorkspace.find(11).bind_port===19090&&!window.__running.calls.some(call=>call.url==='/api/ports/kill')`);
      await clickToolbar('connections:auto.restore_forwards');await check(name+' restore entry',`window.__running.calls.some(call=>call.url==='/api/forwards/restore')`);await clickToolbar('connections:forward_manager.stop_all');await check(name+' operation area stop all',`window.__running.calls.some(call=>call.url==='/api/forwards/11/stop')&&window.termaRunning.service().rows().total===0`);await shot(name+'-stop-all');
      await evaluate(`window.termaRunning.service().search('no matching rule');`);await shot(name+'-no-matches');
      await evaluate(`window.termaRunning.service().search('');connections[0].forwards=[];window.termaForwardWorkspace.renderRunning();`);await shot(name+'-empty');
      await evaluate(`window.__running.reset();window.__running.diagnosisPending=true;window.termaForwardWorkspace.renderRunning();`);await click('[data-forward-id="11"] .running-retry');
      await evaluate(`window.termaWorkspaceShell.showPrimary('connections');window.termaConnectionViews.renderConnections();window.__running.diagnosisPending=false;window.__running.finishDiagnosis();`);await delay(100);
      await check(name+' late diagnosis cannot mutate or replace next view',`primaryView==='connections'&&document.querySelector('#connectionGroups .group')&&!document.querySelector('#connectionGroups .terma-running-root')&&!window.__running.calls.some(call=>/forwards\\/11\\/(?:start|stop)/.test(call.url))&&$('modal').hidden`);
    }
  }finally{
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({checks:report.length,screenshots,report},null,2));
    await evaluate(`window.termaRunning.release();const f=window.__running;api=f.api;connections=f.connections;window.termaWorkspaceRefresh.load=f.loadAll;primaryView=f.primaryView;window.termaForwardWorkspace.openManager=f.openManager;copyText=f.copyText;window.termaLogReader.feature().service.date=f.openSystemLogAt;if(f.runningFilter===null)localStorage.removeItem('runningFilter');else localStorage.setItem('runningFilter',f.runningFilter);closeModal();document.getElementById('running-qa-notices')?.remove();delete window.__running;`);
  }
  return {scenario:'m6-running',viewport,checks:report.length,screenshots};
}
module.exports={runM6RunningUiScenario};
