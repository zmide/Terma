const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A disposable browser session: no remote shell or real termination request.
async function runTerminalPersistenceUiScenario(browser) {
  const directory = path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR || path.join(process.cwd(), 'data'), 'terminal-persistence-visual');
  fs.mkdirSync(directory, {recursive:true});
  const execute = source => browser.webContents.executeJavaScript(`(async()=>{${source}})()`);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const shot = async name => {
    await delay(100); browser.webContents.invalidate();
    fs.writeFileSync(path.join(directory, `${name}.png`), (await browser.webContents.capturePage()).toPNG());
  };
  const click = async selector => {
    const point = await execute(`const element=document.querySelector(${JSON.stringify(selector)});if(!element?.checkVisibility())throw Error('Missing '+${JSON.stringify(selector)});const r=element.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}`);
    for (const type of ['mouseMove','mouseDown','mouseUp']) {
      browser.webContents.sendInputEvent({type,...point,button:'left',clickCount:1}); await delay(20);
    }
  };
  const key = async (keyCode, modifiers=[]) => {
    for (const type of ['keyDown','keyUp']) browser.webContents.sendInputEvent({type,keyCode,modifiers});
    await delay(50);
  };
  await execute(`
    await window.termaI18nReady;while(window.workspaceRestorePending)await new Promise(r=>setTimeout(r,20));
    window.termaWorkspaceRefresh.stop();window.restoringTabs=true;
    connections=[{id:9871,name:'Fixture Shell',group_name:'default',ssh_host:'shell.example.test',ssh_user:'review',ssh_port:22,forwards:[]}];
    window.termaWorkspaceShell.showPrimary('connections');
    setWorkspace('Fixture Shell','review@shell.example.test','terminal','fixture-persistent',true,true,{kind:'terminal',id:9871,connectionStatus:'disconnected',sessionMode:'persistent',sessionBackend:'tmux',persistentSessionId:'fixture-session',resumePolicy:'auto'});
    window.__terminalRequests=[];window.__terminalReopens=[];window.__terminalSaves=0;
    window.__terminalNotifications=[];window.__terminalApiMode='success';
    const originalApi=api;api=async(route,options={})=>{
      if(route==='/api/ssh/preflight'&&window.__deferPreflight){
        window.__preflightStarted=true;
        return await new Promise((resolve,reject)=>window.__finishPreflight=mode=>{
          if(mode==='error')reject(Object.assign(Error('Fixture SSH host key probe timeout'),{code:'SSH_HOST_KEY_TIMEOUT'}));
          else resolve({ok:true});
        });
      }
      if(route==='/api/xserver'&&window.__deferXServer){
        return await new Promise((resolve,reject)=>window.__finishXServer=()=>{
          if(window.__deferXServer==='error')reject(Error('Fixture stale X Server failure'));
          else resolve({platform:'win32',available:true,running:true,installed:true,mode:'bundled',server:'Fixture X Server',display:':0',can_stop:true,integration_available:true,authorization_kind:'local-direct'});
        });
      }
      if(route==='/api/connections/9871/terminal-session'){
        window.__terminalRequests.push(JSON.parse(options.body));
        if(window.__terminalApiMode==='error')throw Error('Fixture termination failure');
        if(window.__terminalApiMode==='pending')await new Promise(resolve=>window.__terminalComplete=resolve);
        return {ok:true};
      }
      if(options.method&&options.method!=='GET')throw Error('Unexpected fixture mutation: '+route);
      return originalApi(route,options);
    };
    window.termaWorkspacePersistence.save=()=>window.__terminalSaves++;
    const originalEffective=window.termaTerminalStartupState.effective;
    window.termaTerminalStartupState.effective=(connection,...args)=>{
      if(connection.id===9871)window.__terminalReopens.push({connection,args});
      return originalEffective(connection,...args);
    };
    const originalAttach=window.termaTerminalSurface.attach;
    window.termaTerminalSurface.attach=(connection,...args)=>connection.id===9871?Promise.resolve():originalAttach(connection,...args);
    const originalNotify=notify;notify=(message,type)=>{window.__terminalNotifications.push({message,type});originalNotify(message,type);};
    window.__resetPersistentFixture=()=>Object.assign(workspaceTabByKey('fixture-persistent'),{sessionMode:'persistent',sessionBackend:'tmux',persistentSessionId:'fixture-session',resumePolicy:'auto'});
    document.querySelectorAll('.toast,.notice').forEach(element=>element.hidden=true);
  `);
  const matrix = [];
  for (const language of ['zh-CN','en-US']) for (const theme of ['light','dark']) for (const width of [1200,390]) {
    const prefix=`${language}-${theme}-${width}`;
    browser.setContentSize(width,844);
    await execute(`applyTheme('${theme}');await setTermaLanguage('${language}');if(isMobileLayout())window.termaWorkspaceShell.showMobileWorkspace();window.__resetPersistentFixture();window.__termination=window.termaTerminalPage.terminateTerminalPersistence('fixture-persistent');return true`);
    await delay(60);
    const report=await execute(`
      const modal=$('modal'),card=modal.querySelector('[role=alertdialog]'),r=card?.getBoundingClientRect();
      return {visible:!modal.hidden&&!!card?.checkVisibility(),title:card?.querySelector('h2')?.textContent,
        tile:!!card&&[...card.querySelectorAll('button:not(.dialog-window-resize)')].every(element=>element.hasAttribute('data-terma-button')) && !!card.querySelector('.dialog-window-resize'),
        contained:!!r&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,
        cancelFocused:document.activeElement?.dataset.choice==='1',
        translated:document.documentElement.lang!=='en-US'||!/[\u3400-\u9fff]/.test(card?.textContent||''),
        buttons:!!r&&[...card.querySelectorAll('button')].every(element=>{const b=element.getBoundingClientRect();return b.left>=r.left&&b.top>=r.top&&b.right<=r.right+1&&b.bottom<=r.bottom+1})};
    `);
    assert.equal(report.visible,true,`${prefix} termination confirmation is visible above its backdrop`);
    assert.equal(report.title,language==='zh-CN'?'终止可恢复会话':'Terminate recoverable session');
    for (const name of ['tile','contained','cancelFocused','translated','buttons']) assert.equal(report[name],true,`${prefix} ${name}`);
    await shot(`${prefix}-confirm`);
    await execute(`$('modal').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);
    assert.equal(await execute("return $('modal').hidden"),false,'backdrop cannot accept a destructive operation');
    const alternate=language==='zh-CN'?'en-US':'zh-CN';
    await execute(`window.__confirmCancel=$('modal').querySelector('[data-choice="1"]');await setTermaLanguage('${alternate}')`);
    assert.deepEqual(await execute(`return {message:$('modal').querySelector('.modal-message').textContent===tr('terminal:session.terminate_confirm'),title:$('modal').querySelector('h2').textContent===tr('terminal:session.manager.terminate_title'),focus:document.activeElement===window.__confirmCancel}`),{message:true,title:true,focus:true},'live locale keeps the same focused cancel button and updates the prompt');
    await shot(`${prefix}-live-language`);
    await key('Tab',['shift']);
    assert.equal(await execute("return document.activeElement?.dataset.choice"),'0');
    await key('Tab',['shift']);
    assert.equal(await execute("return document.activeElement?.classList.contains('dialog-window-resize')"),true,'keyboard users can reach the resize control within the dialog');
    await key('Tab',['shift']);
    assert.equal(await execute("return document.activeElement?.dataset.choice"),'1','focus wraps within the confirmation');
    await key('Escape');
    assert.equal(await execute('return window.__termination'),false);
    assert.equal(await execute("return $('modal').hidden"),true,'Escape releases the overlay');
    assert.equal(await execute('return window.__terminalRequests.length'),0,'cancel never sends a termination command');
    matrix.push({language,theme,width,...report});
  }
  browser.setContentSize(1200,844);
  await execute("await setTermaLanguage('zh-CN');applyTheme('light');syncResponsivePane();await window.termaQuickViews.openQuickConnectionLauncher();window.__termination=window.termaTerminalPage.terminateTerminalPersistence('fixture-persistent');return true");
  await shot('quick-to-confirm');
  assert.equal(await execute("return !$('modal').classList.contains('terma-quick-root')&&!!$('modal').querySelector('[role=alertdialog]')"),true,'confirmation releases the previous quick-dialog renderer');
  await execute("await setTermaLanguage('en-US')");
  assert.equal(await execute("return !$('modal').querySelector('.quick-connection-modal')&&!!$('modal').querySelector('[role=alertdialog]')"),true,'language change cannot resurrect the old quick dialog');
  await click('#modal [data-choice="1"]');
  assert.equal(await execute('return window.__termination'),false);

  // Late success and failure from a replaced X Server dialog cannot reclaim the modal.
  for(const mode of ['success','error']){
    await execute(`window.__deferXServer='${mode}';window.__xServerOpen=window.termaX11.openManager();window.__termination=window.termaTerminalPage.terminateTerminalPersistence('fixture-persistent');return true`);
    assert.equal(await execute("return !window.termaX11.manager.state.opening&&$('modal').dataset.xServerManager!=='1'"),true,'handoff invalidates the old X Server request');
    await execute('window.__finishXServer();return true');
    await execute('return window.__xServerOpen');
    assert.equal(await execute("return !$('modal').hidden&&!!$('modal').querySelector('[role=alertdialog]')"),true,'late X Server result cannot replace the confirmation');
    await shot(`xserver-${mode}-to-confirm`);await key('Escape');
    assert.equal(await execute('return window.__termination'),false);
    await execute('window.__deferXServer=null');
  }

  // Replacement and external close must settle the suspended operation safely.
  await execute("window.__termination=window.termaTerminalPage.terminateTerminalPersistence('fixture-persistent');window.termaConnectionViews.openGroupModal();return true");
  assert.equal(await execute('return window.__termination'),false,'another dialog cancels the pending destructive confirmation');
  await shot('confirm-to-group'); await execute('closeModal()');
  await execute("window.__termination=window.termaTerminalPage.terminateTerminalPersistence('fixture-persistent');window.__closeTabs=window.termaWorkspaceTabActions.confirm([{kind:'terminal',title:'Fixture Shell',connectionStatus:'connected',sessionMode:'persistent',persistentSessionId:'fixture-session'}]);return true");
  assert.equal(await execute('return window.__termination'),false,'workspace confirmation releases generic confirmation');
  await shot('confirm-to-workspace-close'); await key('Escape');
  assert.equal(await execute('return window.__closeTabs'),false);
  await execute("window.__closeTabs=window.termaWorkspaceTabActions.confirm([{kind:'terminal',title:'Fixture Shell',connectionStatus:'connected'}]);window.__termination=window.termaTerminalPage.terminateTerminalPersistence('fixture-persistent');return true");
  assert.equal(await execute('return window.__closeTabs'),false,'generic confirmation releases workspace confirmation');
  await shot('workspace-close-to-confirm');await execute('closeModal()');
  assert.equal(await execute('return window.__termination'),false,'external close resolves a pending confirmation');
  assert.equal(await execute('return window.__terminalRequests.length'),0);
  await execute('window.__terminalReopens=[];window.__terminalSaves=0');

  // A pending API must not keep an invisible blocking dialog over the application.
  await execute("window.__terminalApiMode='pending';window.__termination=window.termaTerminalPage.terminateTerminalPersistence('fixture-persistent');return true");
  await click('#modal [data-choice="0"]');await delay(50);
  assert.deepEqual(await execute("return {hidden:$('modal').hidden,requests:window.__terminalRequests.length,record:workspaceTabByKey('fixture-persistent').persistentSessionId,reopens:window.__terminalReopens.length}"),{hidden:true,requests:1,record:'fixture-session',reopens:0});
  await shot('termination-request-pending');
  await execute("window.__terminalComplete();return true");
  assert.equal(await execute('return window.__termination'),true);
  assert.deepEqual(await execute("const tab=workspaceTabByKey('fixture-persistent');return {mode:tab.sessionMode,id:tab.persistentSessionId,resume:tab.resumePolicy,request:window.__terminalRequests[0],reopens:window.__terminalReopens.length,reopenMode:window.__terminalReopens[0].connection.terminal_session_mode}"),{mode:'none',id:'',resume:'never',request:{action:'terminate',backend:'tmux',session_id:'fixture-session'},reopens:1,reopenMode:'none'});

  await execute("document.querySelectorAll('.toast,.notice').forEach(element=>element.remove());window.__resetPersistentFixture();window.__terminalApiMode='error';window.__termination=window.termaTerminalPage.terminateTerminalPersistence('fixture-persistent');return true");
  await click('#modal [data-choice="0"]');
  assert.equal(await execute('return window.__termination'),false);
  assert.deepEqual(await execute("return {hidden:$('modal').hidden,id:workspaceTabByKey('fixture-persistent').persistentSessionId,mode:workspaceTabByKey('fixture-persistent').sessionMode,reopens:window.__terminalReopens.length,error:window.__terminalNotifications.at(-1)}"),{hidden:true,id:'fixture-session',mode:'persistent',reopens:1,error:{message:'Fixture termination failure',type:'error'}},'failure preserves the recoverable record and does not reopen a shell');
  assert.equal(await execute("return [...document.querySelectorAll('.toast,.notice')].filter(element=>!element.hidden).some(element=>element.textContent.includes('Remote recoverable session terminated'))"),false,'failure screenshot must not retain the prior success toast');
  await shot('termination-request-failed');

  // Exercise the actual toolbar-menu route as well as the session-manager route.
  await execute("window.termaTerminalPage.openTerminalSessionMenu({preventDefault(){},stopPropagation(){},clientX:550,clientY:80},'fixture-persistent')");
  await click('#actionMenu button.danger');await shot('toolbar-menu-confirm');
  assert.equal(await execute("return $('modal').querySelector('h2')?.textContent"),'Terminate recoverable session');
  await key('Escape');
  await execute('window.termaSessionEfficiency.open();return true');
  await click('#modal .terminal-session-manager-terminate[data-index="0"]');
  await shot('session-manager-confirm');await click('#modal [data-choice="1"]');
  assert.equal(await execute('return window.__terminalRequests.length'),2);

  // Termination invalidates an in-flight auto-reconnect before its SSH probe can return late.
  await execute("window.termaNotificationToasts?.dispose();return true");
  await execute([
    "window.__resetPersistentFixture();window.__terminalApiMode='pending';window.__deferPreflight=true;",
    "window.__preflightStarted=false;window.__terminalOutput=[];window.__terminalReopens=[];",
    "const connection={...connections[0],terminal_session_mode:'none'};",
    "const session={key:'fixture-persistent',connection,connectionAttempt:0,connectionPending:false,connected:false,socket:null,id:9871,",
    "term:{writeln:value=>window.__terminalOutput.push(String(value)),focus(){}},currentDirectory:'',currentDirectoryKnown:false,previousDirectory:'',homeDirectory:'',",
    "quickToken:'',persistentSessionId:'fixture-session',reconnectToken:'fixture-token',reconnectTokenRestored:false,reconnectTokenStateHandled:false,",
    "expectingReattach:false,autoReconnectTimer:null,autoReconnectAttempts:2,autoReconnectPending:false,manualDisconnecting:false,",
    "everConnected:true,authenticationFailed:false,remoteSessionEnded:false,autoReconnectRequested:true};",
    "window.termaTerminalState.terminalSessions.set(session.key,session);window.__raceSession=session;",
    "window.__connectAttempt=window.termaTerminalConnectionRuntime.connectTerminal(connection,session.key,{auto:true});return true;"
  ].join('\n'));
  for(let attempt=0;attempt<100&&!await execute('return window.__preflightStarted');attempt++)await delay(20);
  assert.equal(await execute('return window.__preflightStarted'),true,'auto-reconnect is waiting on the SSH preflight');
  await execute("window.__termination=window.termaTerminalPage.terminateTerminalPersistence('fixture-persistent',{skipConfirm:true});return true");
  for(let attempt=0;attempt<100&&!await execute('return window.__terminalRequests.length===3');attempt++)await delay(20);
  assert.deepEqual(await execute("const session=window.__raceSession;return {attempt:session.connectionAttempt,pending:session.connectionPending,manual:session.manualDisconnecting,autoPending:session.autoReconnectPending,timer:session.autoReconnectTimer,requests:window.__terminalRequests.length}"),
    {attempt:2,pending:false,manual:true,autoPending:false,timer:null,requests:3},
    'termination cancels the pending local reconnect before requesting remote cleanup');
  await execute("window.__finishPreflight('error');await window.__connectAttempt;return true");
  assert.deepEqual(await execute("const session=window.__raceSession;return {attempt:session.connectionAttempt,pending:session.connectionPending,manual:session.manualDisconnecting,autoPending:session.autoReconnectPending,timer:session.autoReconnectTimer,hostKeyFailure:window.__terminalOutput.some(value=>value.includes('SSH 主机身份校验失败'))}"),
    {attempt:2,pending:false,manual:true,autoPending:false,timer:null,hostKeyFailure:false},
    'late host-key probe failure cannot restore a stale reconnect state');
  await shot('termination-cancels-pending-preflight');
  await execute('window.__terminalComplete();return true');
  assert.equal(await execute('return window.__termination'),true,'remote termination completes after the local retry is cancelled');
  assert.deepEqual(await execute("return {reopens:window.__terminalReopens.length,reopenMode:window.__terminalReopens[0].connection.terminal_session_mode,record:workspaceTabByKey('fixture-persistent').persistentSessionId}"),
    {reopens:1,reopenMode:'none',record:''},'successful termination reopens a normal shell');
  await execute("window.termaTerminalState.terminalSessions.delete('fixture-persistent');window.__deferPreflight=null;return true");

  // Generic input now uses the same lifecycle; changing locale retains the draft.
  await execute("window.__input=inputModal('Fixture input','Fixture label','original');$('modalInputValue').value='unsaved draft';$('modalInputValue').setSelectionRange(2,5);await setTermaLanguage('zh-CN')");
  assert.deepEqual(await execute("return {value:$('modalInputValue').value,start:$('modalInputValue').selectionStart,end:$('modalInputValue').selectionEnd}"),{value:'unsaved draft',start:2,end:5});
  await key('Escape');assert.equal(await execute('return window.__input'),'');
  await execute('closeModal()');
  fs.writeFileSync(path.join(directory,'matrix.json'),JSON.stringify(matrix,null,2));
  return {matrix:matrix.length,apiRequests:3,remoteConnections:0,directory};
}
module.exports = {runTerminalPersistenceUiScenario};
