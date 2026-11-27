"use strict";
async function runPanelContentMatrix(driver) {
  const {execute,wait,check,click,shot,prefix,delay,browser,point}=driver;
  await execute(`const f=window.__panelFixture;f.contentApi=api;f.requests=[];f.closed=[];
    api=async(url,options={})=>{
      const match=url.match(/^\\/api\\/connections\\/(\\d+)\\/sftp(?:\\?|$)/);
      if(match){const id=Number(match[1]),params=new URL(url,location.origin).searchParams,path=params.get('path'),
          page=Number(params.get('page')||1),size=Number(params.get('page_size')||50);
        f.requests.push({id,path,page,size,signal:options.signal});
        if(path==='/slow')await new Promise(resolve=>setTimeout(resolve,200));
        const total=path==='/large'?50000:2;
        const entries=path==='/large'?Array.from({length:Math.min(size,total-(page-1)*size)},(_,n)=>({
          name:'file-'+String((page-1)*size+n).padStart(5,'0')+'.txt',type:'file',size:128,mtime:1700000000
        })):[{name:'config',type:'dir',size:0,mtime:1700000000},{name:'notes.txt',type:'file',size:128,mtime:1700000000}];
        return {path:path==='.'?'/home/review':path,entries,page,page_size:size,total,total_pages:Math.ceil(total/size),paged:true};}
      if(/\\/sftp\\/session/.test(url))return {connected:true};
      return f.contentApi(url,options);
    };
    activeTabKey='terminal-panel-review-0';
    for(const session of window.termaTerminalState.terminalSessions.values())if(session.key.startsWith('terminal-panel-review-')){
      session.connectionAttempt=(session.connectionAttempt||0)+1;session.currentDirectoryKnown=false;
    }
    const p=window.termaEfficiency.panel;p.dispose();p.install();p.model.restore({});
    p.model.current().height=380;f.files=p.model.add('files');p.model.publish();
    f.fileState=()=>window.termaSftpTabs.runtime.restore(f.files).state;
  `);
  await wait("document.querySelector('.sftp-embedded .sftp-row')");
  await check(prefix+' full SFTP toolbar and compact continuous status',`!!document.querySelector('.sftp-embedded #sftpUpload')&&
    !!document.querySelector('.sftp-embedded #sftpList')&&!document.querySelector('.sftp-embedded .sftp-pagination')&&
    document.querySelector('.sftp-embedded .file-list-status').getBoundingClientRect().height<=25`);
  await execute("window.termaTerminalDirectory.set(window.termaTerminalState.terminalSessions.get('terminal-panel-review-0'),'/guessed','cd')");
  await delay(80);
  await check(prefix+' unconfirmed cd cannot move SFTP',"!window.__panelFixture.requests.some(r=>r.path==='/guessed')");
  await execute("window.termaTerminalDirectory.set(window.termaTerminalState.terminalSessions.get('terminal-panel-review-0'),'/confirmed','osc7')");
  await wait("window.__panelFixture.fileState().path==='/confirmed'");
  await shot(prefix+'-files-follow');
  await click('[data-panel-files-action=pause_follow]');
  await execute("window.termaTerminalDirectory.set(window.termaTerminalState.terminalSessions.get('terminal-panel-review-0'),'/next','osc7')");
  await delay(80);
  await check(prefix+' paused follows no directory changes',"window.__panelFixture.fileState().path==='/confirmed'");
  const folder=await point('.sftp-embedded .sftp-row .sftp-name');
  for(const type of ['mouseMove','mouseDown','mouseUp'])browser.webContents.sendInputEvent({type,...folder,button:'left',clickCount:2});
  await wait("window.__panelFixture.fileState().path==='/confirmed/config'");
  await click('[data-panel-files-action=current_directory]');
  await wait("window.__panelFixture.fileState().path==='/next'");
  await execute("window.termaTerminalDirectory.set(window.termaTerminalState.terminalSessions.get('terminal-panel-review-0'),'/slow','osc7')");
  await wait("window.__panelFixture.requests.some(r=>r.path==='/slow')");
  await execute("window.termaTerminalDirectory.set(window.termaTerminalState.terminalSessions.get('terminal-panel-review-0'),'/latest','osc7')");
  await wait("window.__panelFixture.fileState().path==='/latest'");
  await delay(250);
  await check(prefix+' stale directory request aborted',"window.__panelFixture.requests.find(r=>r.path==='/slow').signal.aborted&&window.__panelFixture.fileState().path==='/latest'");
  await execute("window.termaTerminalDirectory.set(window.termaTerminalState.terminalSessions.get('terminal-panel-review-0'),'/large','osc7')");
  await wait("window.__panelFixture.fileState().path==='/large'&&document.querySelector('.sftp-embedded .sftp-check[value=\"/large/file-00000.txt\"]')");
  await click('.sftp-embedded .sftp-check[value="/large/file-00000.txt"]');
  await execute("const n=document.querySelector('.sftp-embedded #sftpList');n.scrollTop=25000*parseFloat(getComputedStyle(n).getPropertyValue('--file-row-height'));n.dispatchEvent(new Event('scroll'))");
  await wait("document.querySelector('.sftp-embedded .sftp-check[value=\"/large/file-25000.txt\"]')");
  await check(prefix+' 50000 files use bounded DOM and retain offscreen selection',`document.querySelectorAll('.sftp-embedded .sftp-row').length<55&&
    window.termaSftpViews.selectedPaths(window.__panelFixture.files).includes('/large/file-00000.txt')&&window.__panelFixture.requests.every(r=>r.size<=200)`);
  await shot(prefix+'-files-virtual-middle');
  await execute("const n=document.querySelector('.sftp-embedded #sftpList');n.scrollTop=n.scrollHeight;n.dispatchEvent(new Event('scroll'))");
  await wait("document.querySelector('.sftp-embedded .sftp-check[value=\"/large/file-49999.txt\"]')");
  await execute("window.termaTerminalDirectory.set(window.termaTerminalState.terminalSessions.get('terminal-panel-review-0'),'/latest','osc7')");
  await wait("window.__panelFixture.fileState().path==='/latest'&&document.querySelector('.sftp-embedded #sftpList').scrollTop===0");
  await check(prefix+' navigation resets scroll and selection',"window.termaSftpViews.selectedPaths(window.__panelFixture.files).length===0");
  if (prefix.startsWith('1200')) {
  await execute("window.__panelFixture.embeddedList=document.querySelector('.sftp-embedded #sftpList');renderTabs()");
  const source=await point('[data-panel-tab="'+await execute("return window.__panelFixture.files")+'"]'),
    destination=await point('#workspaceDock .tabs-shell');
  for(const type of ['mouseMove','mouseDown'])browser.webContents.sendInputEvent({type,...source,button:'left',clickCount:1});
  browser.webContents.sendInputEvent({type:'mouseMove',x:source.x+8,y:source.y,button:'left'});
  browser.webContents.sendInputEvent({type:'mouseMove',...destination,button:'left'});
  await delay(100);
  await check(prefix+' SFTP copy drop has main workspace feedback',"document.querySelector('#workspaceDock .panel-sftp-copy-target')");
  browser.webContents.sendInputEvent({type:'mouseUp',...destination,button:'left',clickCount:1});
  await wait("tabs.some(t=>t.kind==='sftp'&&t.id===9971&&t.path==='/latest')");
  await wait("document.querySelector('#workspaceDock #view-sftp .sftp-row')");
  await check(prefix+' dragging SFTP copies into main workspace and retains panel',`document.querySelector('[data-panel-tab="'+window.__panelFixture.files+'"]')&&
    document.querySelector('.sftp-embedded #sftpList')===window.__panelFixture.embeddedList&&
    (innerWidth<=760||document.querySelector('.sftp-embedded #sftpSearchToggle')?.checkVisibility())&&
    document.querySelector('#workspaceDock #view-sftp .sftp-row')&&
    !document.querySelector('.panel-sftp-copy-target')`);
  await shot(prefix+'-sftp-copy-workspace');
  await execute("closeTabsByKey(tabs.filter(t=>t.kind==='sftp'&&t.id===9971).map(t=>t.key));activeTabKey='terminal-panel-review-0';window.dispatchEvent(new CustomEvent('terma:workspace-target-changed'))");
  }
  await execute(`const f=window.__panelFixture;f.bridge=window.termaDesktop;window.termaDesktop=undefined;
    const p=window.termaEfficiency.panel;p.dispose();p.install();p.model.restore({});p.model.add('terminal');`);
  await wait("document.querySelector('.panel-terminal-workspace .terminal-panel-empty')?.textContent.includes(tr('terminal:panel.local_desktop_required'))");
  await check(prefix+' web cannot launch a local shell',"!document.querySelector('.panel-local-terminal')");
  await execute(`const f=window.__panelFixture;f.localStarts=[];f.localListeners=new Set();
    window.termaDesktop={capabilities:{platform:'win32'},
      async localTerminalProfiles(){return [{id:'powershell',label:'PowerShell'},{id:'cmd',label:'Command Prompt'},{id:'git-bash',label:'Git Bash'}]},
      async startLocalTerminal(value){f.localStarts.push(value);setTimeout(()=>{for(const receive of f.localListeners){
        receive({id:value.id,type:'ready',pty:true});receive({id:value.id,type:'data',data:'Local shell\\r\\nPS> '});}},20);},
      async writeLocalTerminal(id,data){for(const receive of f.localListeners)receive({id,type:'data',data});},
      async resizeLocalTerminal(){},async closeLocalTerminal(id){f.closed.push(id);},
      onLocalTerminal(callback){f.localListeners.add(callback);return ()=>f.localListeners.delete(callback);}
    };
    const p=window.termaEfficiency.panel;p.dispose();p.install();p.model.restore({});
    p.model.current().height=380;f.terminal=p.model.add('terminal');p.model.publish();`);
  await wait("window.__panelFixture.localStarts.length===1&&document.querySelector('.panel-local-terminal .xterm-screen')");
  await check(prefix+' PowerShell starts automatically without elevation',"window.__panelFixture.localStarts[0].profile==='powershell'&&window.__panelFixture.localStarts[0].elevated===false");
  await shot(prefix+'-terminal-single');
  await click('[data-local-action=terminal_profiles]');
  await shot(prefix+'-terminal-profiles');
  await execute(`const n=[...document.querySelectorAll('#actionMenu [role=menuitem]')].find(n=>n.textContent.trim()==='Command Prompt');n.dataset.testProfile='cmd'`);
  await click('[data-test-profile=cmd]');
  await wait("window.__panelFixture.localStarts.length===2&&document.querySelectorAll('[data-local-instance]').length===2");
  await check(prefix+' multiple sessions move names into right list',"!document.querySelector('.panel-terminal-profile')&&window.__panelFixture.localStarts[1].profile==='cmd'");
  const resizeList = async distance => {
    const from=await point('.panel-terminal-list-resizer');
    for(const type of ['mouseMove','mouseDown'])browser.webContents.sendInputEvent({type,...from,button:'left',clickCount:1});
    browser.webContents.sendInputEvent({type:'mouseMove',x:from.x+distance,y:from.y,button:'left'});
    browser.webContents.sendInputEvent({type:'mouseUp',x:from.x+distance,y:from.y,button:'left',clickCount:1});
    await delay(80);
  };
  await resizeList(170);
  await check(prefix+' real pointer collapses terminal list to icons',`document.querySelector('.panel-terminal-instances').classList.contains('icons-only')&&
    document.querySelector('.panel-terminal-instances').getBoundingClientRect().width===36&&
    [...document.querySelectorAll('.panel-terminal-instance>button:first-child span')].every(n=>!n.checkVisibility())`);
  await shot(prefix+'-terminal-list-icons');
  await resizeList(-80);
  await check(prefix+' real pointer expands terminal list',"document.querySelector('.panel-terminal-instances').getBoundingClientRect().width>80&&!document.querySelector('.panel-terminal-instances').classList.contains('icons-only')");
  await click('[data-local-action=split_terminal]');
  await wait("window.__panelFixture.localStarts.length===3&&document.querySelectorAll('[data-local-pane]').length===2");
  await execute("window.__panelFixture.terminalNodes=[...document.querySelectorAll('.panel-local-terminal .xterm-screen')]");
  await shot(prefix+'-terminal-split');
  if(prefix.startsWith('1200')){
    const from=await point('.panel-terminal-divider');
    for(const type of ['mouseMove','mouseDown'])browser.webContents.sendInputEvent({type,...from,button:'left',clickCount:1});
    browser.webContents.sendInputEvent({type:'mouseMove',x:from.x+45,y:from.y,button:'left'});
    browser.webContents.sendInputEvent({type:'mouseUp',x:from.x+45,y:from.y,button:'left',clickCount:1});
    await check(prefix+' pointer resizes terminal group',"Number(document.querySelector('.panel-terminal-divider').getAttribute('aria-valuenow'))>50");
  }
  await click('[data-panel-action=dock_right]');
  await wait("document.querySelector('#terminalPanelRight .panel-local-terminal')?.checkVisibility()");
  await check(prefix+' dock retains engines and three processes',"window.__panelFixture.localStarts.length===3&&window.__panelFixture.terminalNodes.every(n=>[...document.querySelectorAll('#terminalPanelRight .xterm-screen')].includes(n))");
  await shot(prefix+'-terminal-right');
  await execute(`const m=window.termaEfficiency.panel.model;m.dock(m.current().tabs.find(t=>t.kind==='commands').key,'right');`);
  await wait("document.querySelectorAll('#terminalPanelRight [data-panel-section]').length===2");
  await click('#terminalPanelRight [data-panel-tab="'+await execute("return window.__panelFixture.terminal")+'"]');
  await wait("window.termaEfficiency.panel.model.state.collapsedRight.has(window.__panelFixture.terminal)");
  await check(prefix+' right accordion collapses without closing terminals',`document.querySelector('#terminalPanelRight [data-panel-content="'+window.__panelFixture.terminal+'"]').hidden&&window.__panelFixture.localStarts.length===3`);
  await shot(prefix+'-right-accordion');
  await click('#terminalPanelRight [data-panel-tab="'+await execute("return window.__panelFixture.terminal")+'"]');
  await wait("document.querySelector('#terminalPanelRight .panel-local-terminal')?.checkVisibility()");
  await resizeList(170);
  await shot(prefix+'-right-terminal-icons');
  await check(prefix+' right accordion expands without replacing terminal engines',"window.__panelFixture.localStarts.length===3&&window.__panelFixture.terminalNodes.every(n=>[...document.querySelectorAll('#terminalPanelRight .xterm-screen')].includes(n))");
  await execute(`const m=window.termaEfficiency.panel.model;m.dock(m.current().tabs.find(t=>t.kind==='commands').key,'bottom');`);
  await click('#terminalPanelRight [data-panel-action=return_bottom]');
  await wait("document.querySelector('#terminalPanel .panel-local-terminal')?.checkVisibility()");
  await check(prefix+' return keeps terminal group',"window.__panelFixture.localStarts.length===3&&document.querySelectorAll('[data-local-pane]').length===2");
  await click('[data-local-action=close_terminal]');
  await wait("document.querySelector('#workspaceCloseTabsConfirm')");
  await shot(prefix+'-terminal-close-confirm');
  await click('#workspaceCloseTabsConfirm');
  await wait("document.querySelectorAll('[data-local-instance]').length===2");
  await check(prefix+' closing split retains sibling and other group',"document.querySelectorAll('[data-local-pane]').length===1&&window.__panelFixture.closed.length>=1");
  await execute(`const f=window.__panelFixture;api=f.contentApi;const p=window.termaEfficiency.panel;p.dispose();
    window.termaDesktop=f.bridge;p.install();p.model.restore({});`);
}
module.exports={runPanelContentMatrix};
