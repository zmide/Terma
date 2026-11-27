"use strict";
const fs=require('node:fs');
const path=require('node:path');
async function runPanelRealSsh(driver){
  const {execute,wait,check,click,shot,browser,delay}=driver;
  browser.setContentSize(1200,844);
  for(const machine of [{name:'linux',host:'192.168.31.76',user:'root',home:'/root'},
    {name:'mac',host:'192.168.31.109',user:'junruo',home:'/Users/junruo'}]){
    await execute(`const f=window.__panelFixture;
      const p=window.termaEfficiency.panel;p.dispose();p.install();p.model.restore({});
      const result=await f.originalApi('/api/connections',{method:'POST',body:JSON.stringify({
        name:'${machine.name}',group_name:'Review',ssh_host:'${machine.host}',ssh_port:22,ssh_user:'${machine.user}',
        auth_type:'key',identity_file:'C:/Users/junruo/.ssh/id_rsa_junruo',extra_args:''
      })});f.realId=result.id;
      const response=await fetch('/api/ssh/preflight',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({connection_id:f.realId})});
      const preflight=await response.json();
      if(preflight.challenge?.token)await f.originalApi('/api/ssh/host-trust',{method:'POST',body:JSON.stringify({token:preflight.challenge.token,mode:'persist'})});
      const rows=await f.originalApi('/api/connections');f.real=rows.find(c=>c.id===f.realId);connections=[...connections,f.real];
      f.realKey=window.termaTerminalPage.openTerminalConnection(f.real,true);
      p.model.current().height=330;f.files=p.model.add('files');p.model.publish();if(!p.visible())p.toggle();
      f.fileState=()=>window.termaSftpTabs.runtime.restore(f.files).state;`);
    try{
      await wait("window.termaTerminalState.terminalSessions.get(window.__panelFixture.realKey)?.connected",1600);
      await execute(`const f=window.__panelFixture;f.realSession=window.termaTerminalState.terminalSessions.get(f.realKey);
        window.termaTerminalInputActions.sendTerminalData(f.realKey,"cd /tmp\\r");`);
      await wait("window.termaTerminalDirectory.confirmed(window.__panelFixture.realSession)==='/tmp'",1200);
      await wait(`window.__panelFixture.fileState().path===${JSON.stringify(machine.name==='mac'?'/private/tmp':'/tmp')}&&document.querySelector('.sftp-embedded .sftp-row')`,1200);
      await shot('real-'+machine.name+'-cd-follow');
      if(machine.name==='mac'){
        await check('macOS login zsh reports OSC directory',"window.__panelFixture.realSession.currentDirectorySource==='osc7'");
        await execute(`window.termaTerminalInputActions.sendTerminalData(window.__panelFixture.realKey,"cd '/Library/Application Support'\\r");`);
        await wait("window.__panelFixture.fileState().path==='/Library/Application Support'",1200);
        await shot('real-mac-space-directory');
      }
      const expected=machine.name==='mac'?'/Library/Application Support':'/tmp';
      await execute(`window.termaTerminalInputActions.sendTerminalData(window.__panelFixture.realKey,"cd /no-such-terma-directory\\r");`);
      await delay(700);
      await check(machine.name+' failed cd retains actual path',`window.__panelFixture.fileState().path===${JSON.stringify(expected)}`);
      await execute(`const f=window.__panelFixture;f.realFileNode=document.querySelector('.sftp-embedded #sftpList');window.termaEfficiency.panel.model.dock(f.files,'right')`);
      await wait("document.querySelector('#terminalPanelRight .sftp-embedded #sftpList')?.checkVisibility()");
      await shot('real-'+machine.name+'-sftp-right');
      await click('#terminalPanelRight [data-panel-action=return_bottom]');
      await wait("document.querySelector('#terminalPanel .sftp-embedded #sftpList')?.checkVisibility()");
      await check(machine.name+' SFTP return keeps full live view',"document.querySelector('.sftp-embedded #sftpList')===window.__panelFixture.realFileNode");
      await execute(`window.termaTerminalInputActions.sendTerminalData(window.__panelFixture.realKey,"cd ~\\r");`);
      await wait(`window.__panelFixture.fileState().path===${JSON.stringify(machine.home)}`,1200);
      await execute("const m=window.termaEfficiency.panel.model;m.add('performance','row');m.current().height=360;m.publish()");
      await wait("document.querySelector('.panel-performance time')&&document.querySelectorAll('[data-panel-process]').length>0",1600);
      await check(machine.name+' samples automatically',"!document.querySelector('[data-panel-performance-toggle]')&&document.querySelector('.panel-performance-metrics').textContent.includes('MB')");
      await shot('real-'+machine.name+'-performance');
    }finally{
      await execute(`window.termaEfficiency.panel.model.restore({});if(window.__panelFixture.realKey)void window.termaWorkspaceTabActions.requestClose([window.__panelFixture.realKey],window.__panelFixture.realKey)`);
      await wait("document.querySelector('#workspaceCloseTabsConfirm')");await click('#workspaceCloseTabsConfirm');
      await execute(`const f=window.__panelFixture;if(f.realId)await f.originalApi('/api/connections/'+f.realId,{method:'DELETE'});connections=connections.filter(c=>c.id!==f.realId)`);
    }
  }
}
async function runPanelRealLocal(driver){
  const {execute,wait,check,click,shot,browser,delay}=driver;
  browser.setContentSize(1200,844);
  await execute(`const f=window.__panelFixture;f.desktopBridge=window.termaDesktop;window.termaDesktop=window.termaLocalTerminalTest;
    f.localOutput='';f.localEvents=[];f.localOff=window.termaLocalTerminalTest.onLocalTerminal(event=>{
      f.localEvents.push(event);if(event.type==='data')f.localOutput+=event.data;});
    const p=window.termaEfficiency.panel;p.dispose();p.install();p.model.restore({});p.model.current().height=330;
    f.terminal=p.model.add('terminal');p.model.publish();if(!p.visible())p.toggle();`);
  try{
    await wait("window.__panelFixture.localEvents.some(e=>e.type==='ready')&&document.querySelector('.panel-local-terminal .xterm-screen')",1200);
    await check('native default terminal uses PTY',"window.__panelFixture.localEvents.find(e=>e.type==='ready').pty===true");
    const command=async marker=>{
      await execute("document.querySelector('.panel-local-terminal .xterm-helper-textarea').focus()");browser.webContents.focus();
      browser.webContents.insertText('echo '+marker);await delay(100);
      browser.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});browser.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
      await wait(`window.__panelFixture.localOutput.split('${marker}').length>=3`,1200);
    };
    await command('TERMA_LOCAL_OK');await shot('real-local-default');
    if(process.platform==='win32'){
      await click('[data-local-action=terminal_profiles]');
      await execute(`const n=[...document.querySelectorAll('#actionMenu [role=menuitem]')].find(n=>n.textContent.trim()==='Command Prompt');n.dataset.testCmd='1'`);
      await click('[data-test-cmd]');
      await wait("window.__panelFixture.localEvents.filter(e=>e.type==='ready').length===2",1200);
      await command('TERMA_CMD_OK');await shot('real-local-cmd');
    }
    await click('[data-local-action=split_terminal]');
    await wait("document.querySelectorAll('[data-local-pane]').length===2&&window.__panelFixture.localEvents.filter(e=>e.type==='ready').length>=3",1200);
    await execute("const f=window.__panelFixture;f.engines=[...document.querySelectorAll('.panel-local-terminal .xterm-screen')];f.readyCount=f.localEvents.filter(e=>e.type==='ready').length;window.termaEfficiency.panel.model.dock(f.terminal,'right')");
    await wait("document.querySelector('#terminalPanelRight .panel-local-terminal')?.checkVisibility()");await shot('real-local-split-right');
    await click('#terminalPanelRight [data-panel-action=return_bottom]');
    await wait("document.querySelector('#terminalPanel .panel-local-terminal')?.checkVisibility()");
    await check('native PTYs and engines survive sidebar return',"window.__panelFixture.readyCount===window.__panelFixture.localEvents.filter(e=>e.type==='ready').length&&window.__panelFixture.engines.every(n=>n.isConnected)");
    await shot('real-local-split-returned');
    if(process.env.TERMA_PANEL_DOC_SHOTS==='1'){
      await execute(`for(const [index,event] of window.__panelFixture.localEvents.filter(e=>e.type==='ready').entries())await window.termaLocalTerminalTest.writeLocalTerminal(event.id,
        ${process.platform==='win32'?`index===0?${JSON.stringify("function prompt { 'PS> ' }; Clear-Host; Write-Output 'Local PowerShell'\r")}:${JSON.stringify("@echo off\rprompt $G\rcls\recho Local Command Prompt\r")}`:JSON.stringify("printf '\\033[2J\\033[HLocal shell\\n'\r")});`);
      await delay(500);await execute("applyTheme('dark')");
      for(const language of ['en-US','zh-CN']){
        await execute(`await setTermaLanguage('${language}',{persist:false})`);await delay(200);
        const rect=await execute("const r=document.querySelector('#terminalPanel').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)}");
        const destination=path.resolve('.github/assets/screenshots',language,'desktop-terminal-panel.png');
        fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,(await browser.webContents.capturePage(rect)).toPNG());
      }
      fs.copyFileSync(path.resolve('.github/assets/screenshots/zh-CN/desktop-terminal-panel.png'),path.resolve('docs-site/public/screenshots/desktop-terminal-panel.png'));
    }
    await click('[data-local-action=close_terminal]');await wait("document.querySelector('#workspaceCloseTabsConfirm')");
    await click('#workspaceCloseTabsConfirm');await wait("document.querySelectorAll('[data-local-pane]').length===1");
  }finally{
    await execute(`const p=window.termaEfficiency.panel;p.dispose();window.__panelFixture.localOff();window.termaDesktop=window.__panelFixture.desktopBridge;p.install();p.model.restore({})`);
  }
}
module.exports={runPanelRealSsh,runPanelRealLocal};
