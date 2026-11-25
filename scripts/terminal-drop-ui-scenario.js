const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
async function runTerminalDropUiScenario(browser){
 const directory=process.env.TERMA_DROP_VISUAL_DIR||path.join(process.cwd(),'data/terminal-drop-visual');
 fs.mkdirSync(directory,{recursive:true});
 const execute=source=>browser.webContents.executeJavaScript(`(async()=>{${source}})()`),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const checks=[],states=[];
 const check=async(name,expression)=>{const value=await execute('return '+expression);checks.push({name,passed:!!value});assert.ok(value,name);};
 const shot=async name=>{await pause(80);browser.webContents.invalidate();await pause(80);fs.writeFileSync(path.join(directory,name+'.png'),(await browser.webContents.capturePage()).toPNG());states.push(name);};
 await execute(`await window.termaI18nReady;await window.termaTerminalLibraries.ensure();while(workspaceRestorePending)await new Promise(r=>setTimeout(r,20));window.termaWorkspaceRefresh.stop();closeModal();
 const connection={id:7,ssh_host:'fixture.invalid',ssh_user:'fixture',ssh_port:22};
 window.__drop={key:'terminal-drop-fixture',connection,requests:[],notices:[],local:null,remote:null};
 const f=window.__drop;
 window.termaConnectionController.current=id=>Number(id)===7?connection:undefined;
 window.termaNotificationToasts.notify=(message,kind)=>f.notices.push({message,kind});
 window.termaFileTransferRuntime.drag.read=()=>f.local;
 window.termaSftpDragWorkspace.drag.source.active=()=>f.remote;
 window.termaSftpDragWorkspace.browserDrop.hasFiles=()=>true;
 window.termaSftpDragWorkspace.collect=()=>f.collect?f.collect():Promise.resolve([{file:new File(['fixture'],'fixture.txt'),relativePath:'fixture.txt'}]);
 window.termaSftpTransfers.controller.submit=async(files,id,directory,options)=>{f.requests.push({kind:'files',id,directory,current:options.isCurrent()});};
 window.termaFileTransferRuntime.upload=async(payload,target)=>{f.requests.push({kind:'local',id:target.id,directory:target.path,current:target.valid()});};
 window.termaSftpDragWorkspace.drag.destinations.directory=async(drag,id,directory,options)=>{f.requests.push({kind:'copy',id,directory,current:options.valid()});};
 window.termaSftpDragWorkspace.drag.browser.finishPayload=()=>{};
 window.__makeDrop=()=>{
  if(f.session){window.termaTerminalDrop.release(f.session);window.termaTerminalState.terminalSessions.delete(f.key);}
  setWorkspace('Terminal drop fixture','fixture.invalid','terminal',f.key,true,true,{kind:'terminal',id:7});
  if(!f.mount){
  const root=document.createElement('section');root.className='terminal-drop-fixture';
  root.style.cssText='position:fixed;inset:90px 12px 12px;z-index:70;background:var(--panel);border:1px solid var(--line);display:flex;flex-direction:column';
  const title=document.createElement('h3');title.textContent='Terminal drop fixture';title.style.margin='12px';
  const mount=document.createElement('div');mount.className='terminal-box';mount.style.cssText='flex:1;position:relative;min-height:0';
  root.append(title,mount);document.body.append(root);
  const term=window.termaTerminalLibraries.terminal({fontSize:13}),fit=window.termaTerminalLibraries.fit();term.loadAddon(fit);term.open(mount);fit.fit();
  f.mount=mount;f.term=term;f.fit=fit;
  }
  const mount=f.mount;
  f.session={key:f.key,id:7,connection,connected:true,socket:{},connectionAttempt:1,currentDirectory:'/fixture',currentDirectoryKnown:true,mount,term:f.term,fit:f.fit};
  window.termaTerminalState.terminalSessions.set(f.key,f.session);window.termaTerminalDrop.bind(f.session,mount);
  f.event=type=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{files:[],items:[],types:['Files']}});mount.dispatchEvent(event);};
 };`);
 for(const width of [1200,390])for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']){
  const prefix=`${language}-${theme}-${width}`,other=language==='zh-CN'?'en-US':'zh-CN';
  browser.setContentSize(width,844);await pause(100);
  await execute(`applyTheme('${theme}');await setTermaLanguage('${language}',{persist:false});window.__makeDrop();const f=window.__drop;f.local=null;f.remote=null;f.collect=null;f.requests=[];f.event('dragenter');`);
  await check(prefix+' visible contained overlay',`(()=>{const n=window.__drop.mount.querySelector('.terminal-drop-overlay'),r=n.getBoundingClientRect();return n.checkVisibility()&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1})()`);
  await check(prefix+' directory retained in hint',`window.__drop.mount.querySelector('.terminal-drop-label').textContent.includes('/fixture')`);
  await shot(prefix+'-upload');
  await execute(`window.__drop.label=window.__drop.mount.querySelector('.terminal-drop-label');await setTermaLanguage('${other}',{persist:false});`);
  await check(prefix+' live language keeps overlay identity',`window.__drop.label===window.__drop.mount.querySelector('.terminal-drop-label')&&window.__drop.label.textContent===tr('terminal:drop.upload_to_current',{directory:'/fixture'})`);
  await shot(prefix+'-language');
  await execute(`await setTermaLanguage('${language}',{persist:false});window.__drop.remote={sourceTabKey:'fixture-source',connectionId:8,entries:[]};window.__drop.event('dragover');`);
  await check(prefix+' copy label',`window.__drop.mount.querySelector('.terminal-drop-label').textContent===tr('terminal:drop.copy_to_current',{directory:'/fixture'})`);
  await shot(prefix+'-copy');
  await execute(`window.__drop.event('drop');await new Promise(r=>setTimeout(r,20));`);
  await check(prefix+' copy reaches original target once',`window.__drop.requests.length===1&&window.__drop.requests[0].kind==='copy'&&window.__drop.requests[0].current`);
  await execute(`const f=window.__drop;f.remote=null;f.requests=[];f.event('drop');await new Promise(r=>setTimeout(r,20));`);
  await check(prefix+' browser file uses current destination',`window.__drop.requests.length===1&&window.__drop.requests[0].kind==='files'&&window.__drop.requests[0].directory==='/fixture'&&window.__drop.requests[0].current`);
  await execute(`const f=window.__drop;f.requests=[];f.local={paths:['/fixture.txt'],entries:[]};f.event('drop');await new Promise(r=>setTimeout(r,20));`);
  await check(prefix+' local file retains owner guard',`window.__drop.requests.length===1&&window.__drop.requests[0].kind==='local'&&window.__drop.requests[0].current`);
  await execute(`const f=window.__drop;f.local=null;f.requests=[];f.collect=()=>new Promise(resolve=>f.resolve=resolve);f.event('drop');f.session.connectionAttempt++;f.resolve([{file:new File(['fixture'],'fixture.txt'),relativePath:'fixture.txt'}]);await new Promise(r=>setTimeout(r,20));`);
  await check(prefix+' reconnect rejects old file capture',`window.__drop.requests.length===0`);
  await execute(`const f=window.__drop;f.event('dragenter');window.termaTerminalDrop.release(f.session);f.event('drop');await new Promise(r=>setTimeout(r,20));`);
  await check(prefix+' dispose clears overlay and listeners',`window.__drop.mount.querySelector('.terminal-drop-overlay').hidden&&window.__drop.requests.length===0`);
  await shot(prefix+'-released');
 }
 await execute(`const f=window.__drop;window.termaTerminalDrop.release(f.session);window.termaTerminalState.terminalSessions.delete(f.key);document.querySelector('.terminal-drop-fixture')?.remove();`);
 fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({checks,states},null,2));
 return {checks:checks.length,screenshots:states.length,directory};
}
module.exports={runTerminalDropUiScenario};
