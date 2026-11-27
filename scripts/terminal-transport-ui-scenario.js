const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function runTerminalTransportUiScenario(browser) {
  const directory=process.env.TERMA_TRANSPORT_VISUAL_DIR||path.join(process.cwd(),'data','terminal-transport-visual');
  fs.mkdirSync(directory,{recursive:true});
  const execute=source=>browser.webContents.executeJavaScript(`(async()=>{${source}})()`);
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const groups=[],screenshots=[];
  let checks=0;
  const equal=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
  const settle=async()=>{await delay(300);await execute('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');};
  const capture=async name=>{
    await settle();const file=name+'.png';
    fs.writeFileSync(path.join(directory,file),(await browser.webContents.capturePage()).toPNG());screenshots.push(file);
  };
  const pointer=async selector=>{
    const point=await execute(`
      const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>node.checkVisibility());element?.scrollIntoView({block:'nearest',inline:'center'});
      const box=element?.getBoundingClientRect();if(!box||!element.checkVisibility())throw Error('Hidden transport control '+${JSON.stringify(selector)});
      const point={x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};
      if(!element.contains(document.elementFromPoint(point.x,point.y)))throw Error('Covered transport control');return point;`);
    for(const type of ['mouseMove','mouseDown','mouseUp'])browser.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});
    await settle();
  };
  const key=async keyCode=>{
    browser.webContents.focus();
    for(const type of ['keyDown','keyUp'])browser.webContents.sendInputEvent({type,keyCode});
    await settle();
  };
  const inspect=()=>execute(`
    const session=window.__transport.session,root=session.term.element.closest('.terminal-tab-surface');
    const toolbar=document.querySelector('.terminal-toolbar[data-workspace-tab-key="transport-terminal"]');
    if(!toolbar)throw Error('Missing production terminal toolbar');
    const clone=document.createElement('div');clone.append(root.cloneNode(true),toolbar.cloneNode(true));
    clone.querySelectorAll('.xterm,[data-i18n-skip="true"]').forEach(element=>element.remove());
    const han=[];const note=value=>{
      if(!/[\\u3400-\\u9fff]/.test(value||''))return;
      han.push(value);
    };
    const walker=document.createTreeWalker(clone,NodeFilter.SHOW_TEXT);
    while(walker.nextNode())note(walker.currentNode.textContent,walker.currentNode.parentElement,'text');
    for(const element of clone.querySelectorAll('*'))for(const attribute of ['title','aria-label','placeholder'])note(element.getAttribute(attribute),element,attribute);
    const scroll=toolbar.querySelector('.terminal-actions'),box=scroll.getBoundingClientRect();
    const actions=[...scroll.querySelectorAll('button')].filter(button=>button.checkVisibility()).map(button=>{
      const rect=button.getBoundingClientRect();return {label:button.getAttribute('aria-label'),width:rect.width,reachable:rect.width<=scroll.clientWidth};
    });
    return {han,actions,actionContainerFits:box.left>=-1&&box.right<=innerWidth+1,overflow:document.documentElement.scrollWidth>innerWidth+1,
      connected:session.connected,state:window.termaTerminalToolbarService.status.get(session.key),
      engine:session.term.element===window.__transport.engine,scroll:session.term.buffer.active.viewportY};`);
  const reviewControls = async (prefix, width, language) => {
    const toolbar = '.terminal-toolbar[data-workspace-tab-key="transport-terminal"]';
    const composer = '.terminal-tab-surface .terminal-mobile-composer';
    if (width===390 && !await execute('return terminalKeysVisible')) await pointer(toolbar+' .terminal-action-keys');
    equal(await execute(`
      const bar=window.termaTerminalSurface.element('transport-terminal','.terminal-keys');
      return bar.querySelectorAll('button').length===window.termaTerminalKeysService.model('transport-terminal').shortcuts.length+3
        &&bar.querySelectorAll('.terminal-key-ctrl-once').length===1
        &&bar.querySelectorAll('.terminal-key-ctrl-lock').length===1
        &&!bar.querySelector('[onclick],[onpointerdown]');`), true, 'shortcut mount replaces all legacy buttons');
    await capture(prefix+'-keys');
    if (width===390) await pointer(composer+' input');
    await execute(`
      const f=window.__transport;
      f.composer=window.termaTerminalSurface.element(f.session.key,'#terminalMobileInput');
      f.composer.value='echo <b>迁移 draft</b>';f.composer.setSelectionRange(2,7);
      f.composerBefore={focus:document.activeElement,scroll:f.session.term.buffer.active.viewportY};
      await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{persist:false});`);
    await settle();
    equal(await execute(`
      const f=window.__transport,input=window.termaTerminalSurface.element(f.session.key,'#terminalMobileInput');
      const send=input.nextElementSibling,placeholder=tr('terminal:toolbar.command_placeholder'),label=tr('terminal:toolbar.send_command');
      return input===f.composer&&input.value==='echo <b>迁移 draft</b>'&&input.selectionStart===2&&input.selectionEnd===7
        &&document.activeElement===f.composerBefore.focus&&f.session.term.buffer.active.viewportY===f.composerBefore.scroll
        &&input.placeholder===placeholder&&input.getAttribute('aria-label')===placeholder
        &&send.title===label&&send.getAttribute('aria-label')===label
        &&!input.closest('.terminal-mobile-composer').querySelector('[onclick],[onkeydown],b');`),
    true, 'composer language retains draft focus selection and scroll with translated attributes');
    if (language==='zh-CN') equal((await inspect()).han, [], 'composer live English scans hidden terminal UI and attributes');
    await capture(prefix+'-composer-language');
    if (width===390) {
      const sentBefore=await execute('return window.__transport.socket.sent.length');
      for (const type of ['keyDown','keyUp']) browser.webContents.sendInputEvent({type,keyCode:'Enter',modifiers:['shift']});
      await settle();
      equal(await execute('return window.__transport.socket.sent.length'), sentBefore, 'Shift Enter keeps the mobile draft');
      await key('Enter');
      equal(await execute(`
        const f=window.__transport;
        return {sent:f.socket.sent.slice(${sentBefore}),value:f.composer.value,focused:document.activeElement===f.composer};`),
      {sent:['echo <b>迁移 draft</b>\r'],value:'',focused:true}, 'real Enter sends the exact mobile command once');
      await execute(`window.__transport.composer.value='echo pointer-send';`);
      await pointer(composer+' button');
      equal(await execute(`const f=window.__transport;return f.socket.sent.at(-1)==='echo pointer-send\\r'&&f.composer.value==='';`),
        true, 'real pointer sends the mobile command through the existing port');
      const hover = await execute(`
        const button=window.__transport.composer.nextElementSibling,style=getComputedStyle(button);
        const context=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
        context.fillStyle=style.backgroundColor;context.fillRect(0,0,1,1);
        return {hovered:button.matches(':hover'),color:style.color,background:style.backgroundColor,
          rgba:[...context.getImageData(0,0,1,1).data],shadow:style.boxShadow,transform:style.transform};`);
      equal(hover.hovered&&hover.color==='rgb(255, 255, 255)'&&hover.rgba[2]>hover.rgba[0]+20
        &&hover.rgba[3]===255&&hover.shadow==='none'&&hover.transform==='none',
      true, 'mobile send hover retains the flat primary color in both themes '+JSON.stringify(hover));
      await capture(prefix+'-composer-send-hover');
      await key('Tab');
      equal(await execute(`
        const button=window.__transport.composer.nextElementSibling;
        const style=getComputedStyle(button);
        return document.activeElement===button&&button.matches(':focus-visible')
          &&style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>=1;`),
      true, 'real Tab shows the mobile send keyboard focus');
      await capture(prefix+'-composer-send-focus');
      equal(await execute(`
        const root=window.__transport.composer.closest('.terminal-mobile-composer'),box=root.getBoundingClientRect();
        return [...root.children].every(control=>{const rect=control.getBoundingClientRect();
          return rect.width>0&&rect.left>=box.left-1&&rect.right<=box.right+1&&rect.left>=-1&&rect.right<=innerWidth+1;});`),
      true, 'mobile composer input and send button fit the viewport');
    }
    await execute(`
      const f=window.__transport;f.composer.value='cached draft';f.composer.setSelectionRange(1,5);
      f.surface=f.session.term.element.closest('.terminal-tab-surface');f.parent=f.surface.parentNode;
      f.quickBar=document.querySelector('#terminalPanel');
      f.quickResizer=document.querySelector('[data-panel-resize]');
      f.surface.remove();
      await setTermaLanguage('${language}',{persist:false});`);
    await settle();
    equal(await execute(`
      const f=window.__transport,input=window.termaTerminalSurface.element(f.session.key,'#terminalMobileInput');
      return !f.surface.isConnected&&input===f.composer&&input.value==='cached draft'
        &&input.selectionStart===1&&input.selectionEnd===5&&input.placeholder===tr('terminal:toolbar.command_placeholder');`),
    true, 'cached surface retains and translates the same composer');
    equal(await execute(`
      const f=window.__transport,bar=f.quickBar;
      return bar.isConnected&&bar===document.querySelector('#terminalPanel')
        &&bar.getAttribute('aria-label')===tr('terminal:panel.title')
        &&document.querySelector('[data-panel-resize]')===f.quickResizer
        &&f.quickResizer?.getAttribute('aria-label')===tr('terminal:panel.resize');`),
    true, 'caching a terminal retains and translates the shared panel independently');
    await execute(`const f=window.__transport;f.parent.append(f.surface);f.composer.value='';`);
    await settle();
    if (language==='en-US') equal((await inspect()).han, [], 'cached surface English scans hidden terminal UI and attributes');
    const wasVisible = await execute(`return window.termaEfficiency.quick.visible()`);
    if (!wasVisible) await execute(`window.termaEfficiency.quick.toggle()`);
    await settle();
    equal(await execute(`return window.__transport.quickResizer.checkVisibility()`), true, 'shared panel controls are visible when the cached terminal returns');
    await capture(prefix+'-quick-command-restored');
    if (!wasVisible) await execute(`window.termaEfficiency.quick.toggle()`);
    await execute(`for(let attempt=0;attempt<50&&window.termaTerminalViewport.getSnapshot().timers;attempt++)
      await new Promise(resolve=>setTimeout(resolve,20));`);
    await settle();
  };
  const reviewStartup = async prefix => {
    const toolbar = '.terminal-toolbar[data-workspace-tab-key="transport-terminal"]';
    const state = () => execute(`return window.termaTerminalToolbarService.status.get('transport-terminal')`);
    const outputContains = translation => execute(`
      const buffer=window.__transport.session.term.buffer.active;
      return Array.from({length:buffer.length},(_,index)=>buffer.getLine(index)?.translateToString(true)||'').join('')
        .includes(tr(${JSON.stringify(translation)}));`);
    await execute(`
      const f=window.__transport;dismissToast();f.session.term.clear();
      f.beforeStartupSockets=f.sockets.length;f.beforeStartupWrites=f.writes.length;
      f.request=()=>new Promise(resolve=>{f.resolvePreflight=resolve;});
      f.pending=window.termaTerminalConnectionRuntime.connectTerminal(f.connection,f.session.key);`);
    equal(await state(), 'connecting', 'preflight wait stays visible through the normal connection entry');
    equal(await execute('return window.__transport.session.connectionPending'), true, 'preflight remains busy');
    await capture(prefix+'-preflight-wait');
    equal(await execute(`return document.querySelector('${toolbar} .terminal-action-reconnect').disabled`), true,
      'preflight keeps the reconnect button busy');
    await execute(`const f=window.__transport;window.termaTerminalConnectionRuntime.toggleTerminalConnection(f.connection.id,f.session.key);`);
    equal(await execute('return window.__transport.session.manualDisconnecting'), true, 'normal disconnect entry cancels preflight');
    await execute(`const f=window.__transport;f.resolvePreflight({});await f.pending;f.request=null;`);
    equal(await execute('return window.__transport.sockets.length===window.__transport.beforeStartupSockets'), true,
      'cancelled preflight never opens a socket');
    equal(await execute('return window.__transport.writes.length===window.__transport.beforeStartupWrites+1'), true,
      'cancelled preflight never requests a ticket');
    await execute(`
      const f=window.__transport;f.request=async()=>{throw {code:'SSH_HOST_TRUST_CANCELLED'};};
      await window.termaTerminalConnectionRuntime.connectTerminal(f.connection,f.session.key);`);
    equal(await state(), 'disconnected', 'host trust cancellation shows disconnected');
    equal(await outputContains('terminal:system.host_trust_cancelled'), true, 'host trust cancellation uses the current language');
    await capture(prefix+'-preflight-cancelled');
    await execute(`
      const f=window.__transport;f.connection.x11_mode='trusted';
      f.request=async route=>{if(route.endsWith('preflight'))return {};throw {code:'STARTUP_FAILED'};};
      await window.termaTerminalConnectionRuntime.connectTerminal(f.connection,f.session.key);`);
    equal(await state(), 'disconnected', 'startup preparation failure shows disconnected');
    equal(await execute(`return document.body.textContent.includes(tr('terminal:notifications.startup_prepare_failed'))`), true,
      'startup failure notification is localized');
    await capture(prefix+'-startup-failed');
    await execute(`
      const f=window.__transport;dismissToast();f.ticketRequests=0;
      f.request=async(route,options)=>{
        if(route.endsWith('preflight'))return {};
        f.ticketRequests++;f.lastStartup=JSON.parse(options.body).startup;
        if(f.ticketRequests===1)throw {code:'DESKTOP_INTEGRATION_AUTH_REQUIRED'};
        return {token:'startup-review-ticket'};
      };
      await window.termaTerminalConnectionRuntime.connectTerminal(f.connection,f.session.key);
      f.socket=f.sockets.at(-1);f.socket.open();`);
    equal(await execute(`const f=window.__transport;return f.ticketRequests===2&&f.lastStartup.x11_mode==='off'
      &&f.session.effectiveX11Mode==='off'&&new URL(f.socket.url).searchParams.get('startup_token')==='startup-review-ticket'`),
      true, 'default X11 authorization fallback uses a scoped one-time ticket');
    await settle();
    equal(await outputContains('terminal:system.x11_fallback'), true, 'X11 fallback feedback uses the current language');
    await capture(prefix+'-startup-fallback');
    await execute(`
      const f=window.__transport;dismissToast();f.xserver=[];
      f.originalXServer=window.termaX11.openManager;
      window.termaX11.openManager=async(id,key)=>{f.xserver.push({id,key});};
      window.termaTerminalStartupState.overrides.set(f.session.key,{x11_mode:'trusted'});
      f.request=async route=>{if(route.endsWith('preflight'))return {};throw {code:'DESKTOP_INTEGRATION_AUTH_REQUIRED'};};
      f.beforeAuthorizationSockets=f.sockets.length;await window.termaTerminalConnectionRuntime.connectTerminal(f.connection,f.session.key);`);
    equal(await state(), 'authorization', 'explicit X11 request waits for authorization');
    equal(await execute(`const f=window.__transport;return f.sockets.length===f.beforeAuthorizationSockets
      &&f.xserver.length===1&&f.xserver[0].id===f.connection.id&&f.xserver[0].key===f.session.key`),
      true, 'explicit X11 authorization keeps its connection and tab context');
    await settle();
    equal(await outputContains('terminal:system.x11_authorization_hint'), true, 'explicit X11 authorization hint is localized');
    await capture(prefix+'-startup-authorization');
    await execute(`
      const f=window.__transport;window.termaX11.openManager=f.originalXServer;
      delete f.originalXServer;window.termaTerminalStartupState.overrides.delete(f.session.key);
      f.connection.x11_mode='off';f.request=null;dismissToast();`);
  };
  const ownsDebugger=!browser.webContents.debugger.isAttached();
  if(ownsDebugger)browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  try {
    await execute(`
      await window.termaI18nReady;while(window.workspaceRestorePending)await new Promise(r=>setTimeout(r,20));
      window.termaWorkspaceRefresh.stop();window.termaSftpTransferLifecycle.polling.stop();window.restoringTabs=true;closeModal();dismissToast();
      window.termaWorkspaceShell.showPrimary('connections');await window.termaTerminalSettings.ensure();await window.termaTerminalLibraries.ensure();
      window.__transport={sockets:[],writes:[],originalApi:api,OriginalWebSocket:WebSocket};
      const f=window.__transport;
      api=(route,options={})=>{
        if(route==='/api/ssh/preflight'||route==='/api/terminal/startup-tickets'){
          f.writes.push(route);return f.request?f.request(route,options):Promise.resolve({ok:true});
        }
        if(options.method&&options.method!=='GET')throw Error('Unexpected transport mutation '+route);
        return f.originalApi(route,options);
      };
      window.WebSocket=class extends EventTarget {
        static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
        constructor(url){super();this.url=url;this.readyState=0;this.sent=[];f.sockets.push(this);}
        send(value){if(this.readyState!==1)throw Error('Fixture socket is not open');this.sent.push(value);}
        open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
        message(data){this.dispatchEvent(new MessageEvent('message',{data}));}
        close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
      };
      window.termaTerminalPreferences.schedule=()=>{};
      const connection={id:990023,name:'Transport fixture',group_name:'Fixture',ssh_host:'transport.example.test',ssh_user:'review',ssh_port:22,
        terminal_font_size:13,terminal_font_size_inherit:0,terminal_mobile_font_size:13,terminal_mobile_font_size_inherit:0,
        terminal_session_mode:'none',terminal_encoding:'utf8',x11_mode:'off',forwards:[]};
      connections.push(connection);f.connection=connection;
      const term=window.termaTerminalLibraries.terminal({allowProposedApi:true,fontSize:13,scrollback:2000,overviewRuler:{width:8}}),fit=window.termaTerminalViewport.adaptFitAddon(term,window.termaTerminalLibraries.fit());term.loadAddon(fit);
      const session={key:'transport-terminal',id:connection.id,connection,term,fit,socket:null,connected:false,connectionAttempt:0,reconnectToken:'transport-review-reconnect-token'};
      f.session=session;window.termaTerminalState.terminalSessions.set(session.key,session);window.termaTerminalPage.openTerminalConnection(connection,true,session.key,'Transport fixture');
      while(!term.element)await new Promise(r=>setTimeout(r,20));f.engine=term.element;
    `);
    for(const width of [1200,390])for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']){
      const prefix=`${width}-${theme}-${language}`;
      browser.setContentSize(width,844);
      await execute(`
        const f=window.__transport;window.termaTerminalSessionCore.cancelAutoReconnect(f.session);applyTheme('${theme}');await setTermaLanguage('${language}',{persist:false});
        activateTab(f.session.key);if(isMobileLayout())window.termaWorkspaceShell.showMobileWorkspace();await window.termaTerminalConnectionRuntime.connectTerminal(f.connection,f.session.key);
        f.socket=f.sockets.at(-1);`);
      await settle();
      equal(await execute('return window.__transport.socket.readyState'),0,'normal connection entry binds a pending socket');
      await capture(prefix+'-pending');
      await execute(`
        const f=window.__transport;f.socket.open();
        f.socket.message(Array.from({length:100},(_,index)=>'review-row-'+String(index).padStart(3,'0')+'\\r\\n').join(''));
        f.socket.message(new TextEncoder().encode('binary-output-ok\\r\\n').buffer);`);
      await settle();
      const state=await inspect();
      equal(state.connected,true);equal(state.engine,true);equal(state.overflow,false);
      equal(state.actionContainerFits&&state.actions.length>0&&state.actions.every(action=>action.reachable),true,'transport action scroll container fits viewport');
      if (width===1200) {
        const layout=await execute(`
          const pane=window.__transport.engine.closest('.workspace-pane');
          const rail=document.querySelector('.activity');
          const sidebar=document.getElementById('sidebar');
          const tabs=pane.querySelector('.tabs-shell');
          const active=tabs.querySelector('.tab.active');
          const toolbar=document.getElementById('workspaceGlobalHeaderTools');
          const view=pane.querySelector('.workspace');
          const terminal=pane.querySelector('.terminal-box');
          const style=element=>getComputedStyle(element);
          const rect=element=>element.getBoundingClientRect();
          return {
            columns:rect(rail).right===rect(sidebar).left&&rect(sidebar).right<rect(pane).left
              &&rect(sidebar).top===rect(pane).top,
            sharedSidebarColor:style(rail).backgroundColor===style(sidebar).backgroundColor,
            sidebarRadius:style(sidebar).borderTopLeftRadius,
            paneRadius:style(pane).borderTopLeftRadius,
            tabRadius:[style(active).borderTopLeftRadius,style(active).borderBottomLeftRadius],
            headerToolbar:toolbar.querySelector('.terminal-toolbar')?.checkVisibility()===true
              &&rect(toolbar).bottom<rect(tabs).top,
            joined:rect(active).bottom===rect(view).top&&style(view).backgroundColor===style(active).backgroundColor,
            activeLine:style(active).borderTopWidth==='1px'
              &&style(active).borderTopColor!=='rgba(0, 0, 0, 0)',
            terminalBorder:style(terminal).borderTopWidth,
            terminalRadius:style(terminal).borderTopLeftRadius,
            terminalShadow:style(terminal).boxShadow
          };`);
        equal(layout, {
          columns:true, sharedSidebarColor:true, sidebarRadius:'0px', paneRadius:'0px',
          tabRadius:['4px','0px'], headerToolbar:true, joined:true, activeLine:true,
          terminalBorder:'0px', terminalRadius:'0px', terminalShadow:'none'
        },'the desktop terminal uses the workspace header, a joined active tab and a unified sidebar');
      }
      equal(await execute(`return window.__transport.socket.sent.some(value=>{try{return JSON.parse(value).type==='terminal-encoding'}catch{return false}})`),true);
      if(language==='en-US')equal(state.han,[],'English scans hidden terminal UI and attributes');
      await execute(`const session=window.__transport.session;session.commandBuffer='';session.commandCursor=0;
        session.commandBufferNeedsScreenSync=false;session.commandBufferFromPaste=false;`);
      await pointer('.terminal-tab-surface .xterm-screen');
      browser.webContents.sendInputEvent({type:'char',keyCode:'x'});await settle();
      equal(await execute(`return window.__transport.socket.sent.includes('x')`),true,'real terminal typing reaches the bound socket');
      await key('Enter');
      equal(await execute(`const session=window.__transport.session;
        return window.termaTerminalHistory.list()[0]==='x'&&session.commandBuffer===''&&session.commandCursor===0
          &&window.__transport.socket.sent.includes('\\r');`), true,
        'real terminal Enter records exactly the tracked command through the TypeScript owner');
      await capture(prefix+'-connected');
      equal(await execute(`
        const f=window.__transport;f.outputFlowStart=f.socket.sent.length;
        const payload=Array.from({length:512},(_,index)=>'flow-'+index+' '+ 'x'.repeat(256)+'\\r\\n').join('')+'FLOW-END\\r\\n';
        f.socket.message(payload);
        f.socket.message(new TextEncoder().encode('BINARY-END\\r\\n').buffer);
        return f.session.terminalOutputFlowPaused&&f.session.pendingTerminalOutputBytes>=128*1024;`),
        true, 'normal transport applies output backpressure before xterm consumes a large frame');
      const outputFlow=await execute(`
        const f=window.__transport;
        for(let attempt=0;attempt<160&&(f.session.pendingTerminalOutputBytes||f.session.terminalOutputWriting);attempt++)await new Promise(resolve=>setTimeout(resolve,25));
        const buffer=f.session.term.buffer.active;
        const text=Array.from({length:buffer.length},(_,index)=>buffer.getLine(index)?.translateToString(true)||'').join('\\n');
        const messages=f.socket.sent.slice(f.outputFlowStart).flatMap(value=>{try{const parsed=JSON.parse(value);return parsed.type==='terminal-output-flow'?[parsed.paused]:[]}catch{return []}});
        return {messages,idle:!f.session.pendingTerminalOutputBytes&&!f.session.terminalOutputWriting&&!f.session.terminalOutputFlowPaused,
          complete:text.includes('FLOW-END')&&text.includes('BINARY-END')};`);
      equal(outputFlow.messages,[true,false],'transport pauses once and resumes at the low watermark');
      equal(outputFlow.idle&&outputFlow.complete,true,'string and binary output finish through the same TypeScript queue');
      await capture(prefix+'-output-flow');
      equal(await execute(`
        const f=window.__transport,session=f.session,engine=session.term,textarea=engine.textarea;
        f.resumeSockets=f.sockets.length;
        engine.scrollToBottom();
        window.termaTerminalOutputFlow.queue(session,'WINDOW-RESUME-END\\r\\n');
        window.dispatchEvent(new Event('focus'));
        for(let attempt=0;attempt<80&&(session.pendingTerminalOutputBytes||session.terminalOutputWriting);attempt++)
          await new Promise(resolve=>setTimeout(resolve,20));
        const buffer=engine.buffer.active;
        return f.sockets.length===f.resumeSockets&&session.term===engine&&engine.textarea===textarea
          &&!session.pendingTerminalOutputBytes&&!session.terminalOutputWriting
          &&Array.from({length:buffer.length},(_,index)=>buffer.getLine(index)?.translateToString(true)||'').join('\\n').includes('WINDOW-RESUME-END');`),
        true,'window resume drains the existing queue and preserves the engine, input and socket');
      await capture(prefix+'-window-resume');
      await reviewControls(prefix,width,language);
      await execute(`
        const f=window.__transport;f.session.term.scrollToLine(12);
        f.draft=f.session.term.element.querySelector('textarea');f.draft.focus();f.draft.value='review draft';f.draft.setSelectionRange(2,7);
        f.before={scroll:f.session.term.buffer.active.viewportY,node:f.draft};
        await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{persist:false});`);
      await settle();
      const retained=await execute(`
        const f=window.__transport;return {same:f.before.node===f.session.term.element.querySelector('textarea'),
          value:f.draft.value,start:f.draft.selectionStart,end:f.draft.selectionEnd,focus:document.activeElement===f.draft,
          scroll:f.session.term.buffer.active.viewportY,before:f.before.scroll};`);
      equal(retained.same&&retained.value==='review draft'&&retained.start===2&&retained.end===7&&retained.focus&&retained.scroll===retained.before,true,'live language retains terminal draft focus selection and scroll '+JSON.stringify(retained));
      if(language==='zh-CN')equal((await inspect()).han,[],'live English scans hidden terminal UI and attributes');
      await capture(prefix+'-language');
      await execute(`await setTermaLanguage('${language}',{persist:false});window.__transport.session.term.scrollToBottom();`);
      await pointer('.terminal-toolbar[data-workspace-tab-key="transport-terminal"] .terminal-action-reconnect');
      equal(await execute('return window.__transport.session.manualDisconnecting&&!window.__transport.session.connected&&!window.__transport.session.autoReconnectTimer'),true,'real disconnect button suppresses automatic reconnect');
      await capture(prefix+'-disconnected');
      await pointer('.terminal-tab-surface .xterm-screen');await key('Enter');
      equal(await execute('return window.__transport.sockets.at(-1)!==window.__transport.socket'),true,'real Enter reconnect creates a new socket');
      equal(await execute('return window.__transport.session.term.element===window.__transport.engine'),true,'reconnect preserves the existing engine');
      await execute(`
        const f=window.__transport;f.old=f.socket;f.socket=f.sockets.at(-1);f.socket.open();
        const oldState=f.session.serverSessionState;f.old.message('\\0TERMA:{"type":"terminal-session","state":"ended"}');f.staleIgnored=f.session.serverSessionState===oldState;
        f.socket.dispatchEvent(new Event('error'));f.socket.close();window.termaTerminalSessionCore.cancelAutoReconnect(f.session);`);
      await settle();
      equal(await execute('return window.__transport.staleIgnored'),true,'late replaced socket controls cannot end the active shell');
      equal(await execute(`const buffer=window.__transport.session.term.buffer.active;
        const text=Array.from({length:buffer.length},(_,index)=>buffer.getLine(index)?.translateToString(true)||'').join('');
        return text.includes(tr('terminal:system.closed_auto_reconnect'))&&text.includes(tr('terminal:system.websocket_failed'));`),true,'transport errors and automatic retry feedback use the current language');
      await capture(prefix+'-error');
      await execute(`document.querySelector('.terminal-toolbar[data-workspace-tab-key="transport-terminal"] .terminal-action-reconnect').focus();`);
      await key('Tab');
      equal(await execute(`return !!document.activeElement.closest('.terminal-tab-surface,.terminal-toolbar[data-workspace-tab-key="transport-terminal"]')&&document.activeElement.matches(':focus-visible')`),true,'real Tab preserves visible terminal keyboard focus');
      await reviewStartup(prefix);
      equal(await execute(`return window.__transport.writes.every(route=>['/api/ssh/preflight','/api/terminal/startup-tickets'].includes(route))`),true,'browser fixture intercepts preflight and tickets and performs no persistent writes');
      groups.push({width,theme,language,state,retained,final:await inspect()});
      console.log('[terminal-transport] passed '+prefix);
    }
    await execute(`
      const f=window.__transport;f.surface=f.session.term.element.closest('.terminal-tab-surface');
      f.beforeCloseSockets=f.sockets.length;f.request=()=>new Promise(resolve=>{f.resolveClosePreflight=resolve;});
      f.pendingClose=window.termaTerminalConnectionRuntime.connectTerminal(f.connection,f.session.key);`);
    await pointer('[data-action="workspace-tab-close"][data-tab-key="transport-terminal"]');
    equal(await execute(`return document.querySelector('.workspace-close-tabs-modal')?.checkVisibility()`), true,
      'closing a pending terminal retains the normal confirmation');
    await capture('390-dark-en-US-preflight-close-confirmation');
    await pointer('#workspaceCloseTabsConfirm');
    await execute(`const f=window.__transport;f.resolveClosePreflight({});await f.pendingClose;f.socket.message('late after tab close');`);
    await settle();
    equal(await execute('return !window.termaTerminalState.terminalSessions.has("transport-terminal")'),true,'normal tab close releases the transport');
    equal(await execute('return window.__transport.sockets.length===window.__transport.beforeCloseSockets'),true,
      'real tab close prevents a late preflight from opening a socket');
    equal(await execute(`return !window.__transport.surface.querySelector('#terminalMobileInput,.terminal-keys button')`),
      true, 'normal tab close releases composer and shortcut views');
    equal(await execute(`const bar=window.__transport.quickBar;return {shared:bar.isConnected,
      released:!bar.querySelector('option[value="session:transport-terminal"]'),
      independent:!window.__transport.surface.querySelector('[data-terminal-quick-command-bar]')}`),
      {shared:true,released:true,independent:true}, 'normal tab close retains the shared panel and releases the closed session target');
    return {groups:groups.length,checks,screenshots:screenshots.length};
  } catch(error) {
    await capture('failure');throw error;
  } finally {
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({groups,checks,screenshots},null,2));
    await execute(`const f=window.__transport;if(f){window.termaTerminalSessionCore.cancelAutoReconnect(f.session);window.termaTerminalTransport.release(f.session);
      if(f.originalXServer)window.termaX11.openManager=f.originalXServer;
      window.termaTerminalStartupState.overrides.delete(f.session.key);window.WebSocket=f.OriginalWebSocket;api=f.originalApi;}`);
    if(ownsDebugger)browser.webContents.debugger.detach();
  }
}
module.exports={runTerminalTransportUiScenario};
