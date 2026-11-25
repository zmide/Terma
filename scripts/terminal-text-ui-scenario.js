const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
async function runTerminalTextUiScenario(browser){
 const directory=process.env.TERMA_TEXT_VISUAL_DIR||path.join(process.cwd(),'data/terminal-text-visual');
 fs.mkdirSync(directory,{recursive:true});
 const execute=source=>browser.webContents.executeJavaScript(`(async()=>{${source}})()`),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const checks=[],states=[];
 const check=async(name,expression)=>{const value=await execute('return '+expression);checks.push({name,passed:!!value});assert.ok(value,name);};
 const shot=async name=>{await pause(120);browser.webContents.invalidate();await pause(80);fs.writeFileSync(path.join(directory,name+'.png'),(await browser.webContents.capturePage()).toPNG());states.push(name);};
 await execute(`await window.termaI18nReady;while(workspaceRestorePending)await new Promise(r=>setTimeout(r,20));window.termaWorkspaceRefresh.stop();closeModal();
 const key='terminal-text-fixture',lines=['Fixture terminal output','<img src=x onerror=window.__textUnsafe=true>','中文行 / Unicode 🙂','last output'];
 const f=window.__text={key,lines,sent:[],copied:[],focus:0};
 window.termaTerminalSurface.focus=()=>{f.focus++;};
 window.termaNotificationToasts.notify=()=>{};
 
 window.termaClipboard.copy=async value=>{f.copied.push(value);if(f.waitCopy)return new Promise(resolve=>f.copyResolve=resolve);return true;};
 f.reset=()=>{
  closeModal();f.session={key,id:7,connected:true,connection:{id:7,ssh_host:'fixture.invalid'},connectionAttempt:1,socket:{readyState:WebSocket.OPEN,send:value=>f.sent.push({key,value})},
    term:{focus(){},options:{},rows:lines.length,buffer:{active:{length:lines.length,getLine:index=>({translateToString:()=>lines[index]})}}}};
  window.termaTerminalState.terminalSessions.set(key,f.session);f.sent=[];f.copied=[];f.focus=0;f.waitCopy=false;
  window.termaTerminalHistory.clear();
  ['printf "hello"','<img src=x onerror=window.__textUnsafe=true>'].reverse().forEach(window.termaTerminalHistory.save);
 };
 f.reset();`);
 for(const width of [1200,390])for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']){
  const prefix=`${language}-${theme}-${width}`,other=language==='zh-CN'?'en-US':'zh-CN';
  browser.setContentSize(width,844);await pause(80);
  await execute(`applyTheme('${theme}');await setTermaLanguage('${language}',{persist:false});const f=window.__text;f.reset();window.termaTerminalTextDialogs.recent(f.key);await Promise.resolve();`);
  await check(prefix+' recent Vue and escaped commands',`!!document.querySelector('#modal .terma-operations-root .recent-command-list')&&document.querySelectorAll('.recent-command-list code').length===2&&!document.querySelector('.recent-command-list img')&&!window.__textUnsafe`);
  await check(prefix+' dialog inside viewport',`(()=>{const r=document.querySelector('#modal .modal-card').getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1})()`);
  await shot(prefix+'-recent');
  await execute(`window.__text.first=document.querySelector('.recent-command-list code');await setTermaLanguage('${other}',{persist:false});`);
  await check(prefix+' recent live language preserves command',`document.querySelector('#recentCommandTitle').textContent===tr('terminal:recent.title')&&document.querySelector('.recent-command-list code')===window.__text.first`);
  await shot(prefix+'-recent-language');
  await execute(`document.querySelector('.recent-command-list button').click();`);
  await check(prefix+' recent selected command sent once',`window.__text.sent.length===1&&window.__text.sent[0].value==='printf "hello"\\r'&&document.getElementById('modal').hidden`);
  await execute(`const f=window.__text;window.termaTerminalTextDialogs.recent(f.key);f.session.connectionAttempt++;document.querySelector('.recent-command-list button').click();`);
  await check(prefix+' stale recent selection cancelled',`window.__text.sent.length===1&&document.getElementById('modal').hidden`);
  await execute(`const f=window.__text;window.termaTerminalTextDialogs.recent(f.key);document.getElementById('recentCommandClear').click();`);
  await check(prefix+' clear single history owner',`window.termaTerminalHistory.list().length===0&&document.getElementById('modal').hidden`);
  await execute(`const f=window.__text;f.reset();await setTermaLanguage('${language}',{persist:false});window.termaTerminalTextDialogs.session(f.key);await Promise.resolve();`);
  await check(prefix+' session readonly full text and initial focus',`(()=>{const editor=document.getElementById('terminalSessionTextEditor');return editor.readOnly&&editor.value===window.__text.lines.join('\\n')&&document.activeElement===editor&&!document.querySelector('.terminal-session-text-modal img')})()`);
  await shot(prefix+'-session');
  await execute(`const editor=document.getElementById('terminalSessionTextEditor');window.__text.editor=editor;editor.setSelectionRange(8,16);await setTermaLanguage('${other}',{persist:false});`);
  await check(prefix+' session live language keeps text and selection',`(()=>{const editor=document.getElementById('terminalSessionTextEditor');return editor===window.__text.editor&&editor.selectionStart===8&&editor.selectionEnd===16&&document.getElementById('terminalSessionTextTitle').textContent===tr('terminal:session_copy.title')})()`);
  await shot(prefix+'-session-language');
  await execute(`const f=window.__text;f.waitCopy=true;document.getElementById('terminalSessionTextCopy').click();await Promise.resolve();`);
  await check(prefix+' pending copy prevents duplicate',`document.getElementById('terminalSessionTextCopy').disabled&&window.__text.copied.length===1`);
  await execute(`document.getElementById('terminalSessionTextCopy').click();document.getElementById('terminalSessionTextCancel').click();const f=window.__text;window.termaTerminalTextDialogs.recent(f.key);f.copyResolve(true);await new Promise(r=>setTimeout(r,20));`);
  await check(prefix+' late copy cannot close replacement modal',`!!document.getElementById('recentCommandTitle')&&!document.getElementById('modal').hidden&&window.__text.copied.length===1`);
  await execute(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
  await check(prefix+' Escape releases modal',`document.getElementById('modal').hidden`);
 }
 await execute(`closeModal();window.termaTerminalState.terminalSessions.delete(window.__text.key);window.termaTerminalHistory.clear();`);
 fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({checks,states},null,2));
 return {checks:checks.length,screenshots:states.length,directory};
}
module.exports={runTerminalTextUiScenario};
