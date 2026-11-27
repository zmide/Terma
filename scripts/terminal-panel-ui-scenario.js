"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {runPanelContentMatrix} = require('./terminal-panel-content-ui-scenario');
const {runPanelRealSsh,runPanelRealLocal} = require('./terminal-panel-real-ui-scenario');
const {runPanelPerformanceMatrix} = require('./terminal-panel-performance-ui-scenario');
const {runLocalFileWindowMatrix} = require('./file-list-window-ui-scenario');

async function runTerminalPanelUiScenario(browser) {
  const directory = path.resolve(process.env.TERMA_PANEL_VISUAL_DIR || "data/terminal-panel-ui");
  fs.mkdirSync(directory, {recursive:true});
  const reports = [], images = [];
  const ownsDebugger = !browser.webContents.debugger.isAttached();
  if (ownsDebugger) browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {enabled:true});
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const execute = code => browser.webContents.executeJavaScript(`(async()=>{${code}})()`);
  const wait = async (expression, attempts = 200) => {
    for (let count = 0; count < attempts; count++) {
      if (await execute(`return !!(${expression});`)) return;
      await delay(25);
    }
    console.error("Panel diagnostic", await execute(`return {html:document.querySelector('#terminalPanel .terminal-panel-content')?.outerHTML,
      rows:window.termaEfficiency.quick.items(),currentTab:window.termaEfficiency.panel.model.current().tabs,
      active:activeTabKey,tabs:tabs.map(t=>t.key),sessions:[...window.termaTerminalState.terminalSessions].map(([key,s])=>({key,connected:s.connected,pending:s.connectionPending,attempt:s.connectionAttempt,mount:s.mount?.outerHTML?.slice(0,300),term:!!s.term.element,socket:s.socket?.readyState})),
      preferences:window.termaEfficiency.panel.model.state.preferences,
      directory:window.__panelFixture.realSession&&{
        current:window.__panelFixture.realSession.currentDirectory,source:window.__panelFixture.realSession.currentDirectorySource,
        home:window.__panelFixture.realSession.homeDirectory,probe:window.__panelFixture.realSession.directoryProbeId,
        confirmed:window.termaTerminalDirectory.confirmed(window.__panelFixture.realSession)}};`));
    fs.writeFileSync(path.join(directory,"failure.png"),(await browser.webContents.capturePage()).toPNG());
    throw new Error("Panel UI wait: " + expression);
  };
  const check = async (name, expression) => {
    const passed=await execute(`return !!(${expression});`);
    if(!passed)fs.writeFileSync(path.join(directory,'failure.png'),(await browser.webContents.capturePage()).toPNG());
    if(!passed)console.error("Panel bounds diagnostic",await execute(`const root=document.querySelector('#terminalPanelWorkspace'),r=root.getBoundingClientRect();return [...root.querySelectorAll('.terminal-panel button,.terminal-panel input,.terminal-panel select')].filter(n=>n.checkVisibility()).flatMap(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);return b.left<r.left-1||b.right>r.right+1||s.boxShadow!=='none'||s.backgroundImage!=='none'||s.transform!=='none'?[{html:n.outerHTML.slice(0,220),left:b.left,right:b.right,shadow:s.boxShadow,bg:s.backgroundImage,transform:s.transform}]:[]})`));
    assert.equal(passed, true, name);
    reports.push({name, passed:true});
  };
  const point = selector => execute(`let n=document.querySelector(${JSON.stringify(selector)});
    if(!n?.checkVisibility()||n.disabled)throw Error('Unavailable '+${JSON.stringify(selector)});
    n.scrollIntoView({block:'nearest',inline:'nearest'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    n=document.querySelector(${JSON.stringify(selector)});
    if(!n?.checkVisibility()||n.disabled)throw Error('Unavailable after layout '+${JSON.stringify(selector)});
    const b=n.getBoundingClientRect(),p={x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)};
    if(!n.contains(document.elementFromPoint(p.x,p.y)))throw Error('Covered '+${JSON.stringify(selector)}+' by '+document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,350));return p;`);
  const click = async selector => {
    if (process.env.TERMA_PANEL_TRACE === '1') console.log('[terminal-panel click] '+selector);
    const action = selector.match(/\[data-panel-action=["']?([a-z_]+)["']?\]/)?.[1];
    if (action && await execute(`return !document.querySelector(${JSON.stringify(selector)})?.checkVisibility()&&!!document.querySelector('.terminal-panel-pane.focused [data-panel-action=more_actions]')?.checkVisibility()`)) {
      await execute(`document.querySelector('[data-panel-test-menu]')?.removeAttribute('data-panel-test-menu');const scope=document.querySelector(${JSON.stringify(selector)})?.closest('.terminal-panel-pane')||document.querySelector('.terminal-panel-pane.focused');scope.querySelector('[data-panel-action=more_actions]').dataset.panelTestMenu='1'`);
      const menu = await point('[data-panel-test-menu]');
      for (const type of ["mouseMove","mouseDown","mouseUp"]) browser.webContents.sendInputEvent({type,...menu,button:"left",clickCount:1});
      await wait("document.querySelector('#actionMenu')?.checkVisibility()");
      await execute(`const item=[...document.querySelectorAll('#actionMenu [role=menuitem]')].find(n=>n.textContent.trim()===tr('terminal:panel.${action}'));if(!item)throw Error('Missing panel action ${action}');item.dataset.panelTestAction='${action}'`);
      selector = `[data-panel-test-action="${action}"]`;
    }
    let p;
    try {p = await point(selector);}
    catch (error) {fs.writeFileSync(path.join(directory,"failure.png"),(await browser.webContents.capturePage()).toPNG()); throw error;}
    for (const type of ["mouseMove","mouseDown","mouseUp"]) browser.webContents.sendInputEvent({type,...p,button:"left",clickCount:1});
    await delay(80);
  };
  const shot = async name => {
    await execute("await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    browser.webContents.invalidate(); await delay(60);
    fs.writeFileSync(path.join(directory, name + ".png"), (await browser.webContents.capturePage()).toPNG());
    images.push(name + ".png");
    await check(name + " flat surfaces and viewport bounds", `(()=>{
      const root=document.querySelector('#terminalPanelWorkspace'),r=root.getBoundingClientRect();
      return root.checkVisibility()&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&
        document.documentElement.scrollWidth<=innerWidth+1&&
        [...root.querySelectorAll('.terminal-panel button,.terminal-panel input,.terminal-panel select')].filter(n=>n.checkVisibility()).every(n=>{
          const b=n.getBoundingClientRect(),s=getComputedStyle(n);return b.left>=r.left-1&&b.right<=r.right+1&&
            s.boxShadow==='none'&&s.backgroundImage==='none'&&s.transform==='none';})})()`);
    await check(name + " English attributes and DOM", `document.documentElement.lang!=='en-US'||(()=>{
      const host=document.createElement('div');for(const panel of document.querySelectorAll('.terminal-panel'))host.append(panel.cloneNode(true));
      const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);
      while(walker.nextNode())if(!walker.currentNode.parentElement?.closest('[data-i18n-skip]')&&/[\\u3400-\\u9fff]/.test(walker.currentNode.textContent))return false;
      return [...host.querySelectorAll('*')].every(n=>['title','aria-label','placeholder'].every(k=>
        k==='title'&&n.hasAttribute('data-panel-file')||!/[\\u3400-\\u9fff]/.test(n.getAttribute(k)||'')));})()`);
  };
  await execute(`await window.termaI18nReady;
    while(workspaceRestorePending||window.termaWorkspaceRefresh.loading)await new Promise(r=>setTimeout(r,20));
    window.termaWorkspaceRefresh.stop();closeModal();window.termaEfficiency.palette.close();
    window.__panelFixture={preferences:structuredClone(window.termaEfficiency.panel.model.state.preferences)};
    const f=window.__panelFixture;f.originalApi=api;f.sends=[];f.connections=connections;f.tabs=tabs;f.active=activeTabKey;
    const style=document.createElement('style');style.textContent='#toast,#notice,#sftpTaskFloat,.notification-toast-stack{display:none!important}';document.head.append(style);
    f.rows=[{id:9981,name:'Inspect host',command:'printf panel',group_name:'Review',quick_visible:1,quick_action:'insert',quick_color:'gray',quick_badge:'',quick_sort_order:1}];
    api=async(url,options={})=>url==='/api/command-snippets'?structuredClone(f.rows):url.startsWith('/api/command-snippets/')?{ok:true}:f.originalApi(url,options);
    await window.termaSnippets.service.load();
    connections=[{id:9971,name:'Review host A',group_name:'Review',ssh_host:'review-a.invalid',ssh_user:'review',ssh_port:22,forwards:[]},{id:9972,name:'Review host B',group_name:'Review',ssh_host:'review-b.invalid',ssh_user:'review',ssh_port:22,forwards:[]}];
    const {Terminal}=await import('/vendor/xterm/xterm.mjs'),{FitAddon}=await import('/vendor/xterm/addon-fit.mjs');
    for(const [index,c]of connections.entries()){const key='terminal-panel-review-'+index,term=new Terminal(),fit=new FitAddon();
      term.loadAddon(fit);term.write('review@host:~$');
      window.termaTerminalState.terminalSessions.set(key,{key,id:c.id,connected:true,connection:c,term,fit,socket:{readyState:WebSocket.OPEN,send:text=>f.sends.push({key,text})}});
    }
    tabs=connections.map((c,index)=>({key:'terminal-panel-review-'+index,kind:'terminal',id:c.id,title:c.name}));
    activeTabKey=tabs[0].key;window.dispatchEvent(new CustomEvent('terma:workspace-target-changed'));
  `);
  try {
    for (const width of process.env.TERMA_PANEL_REAL_ONLY === '1' ? [] : process.env.TERMA_PANEL_WIDTHS
      ? process.env.TERMA_PANEL_WIDTHS.split(',').map(Number) : [1200,390]) {
      browser.setContentSize(width, 844);
      await execute("syncResponsivePane();if(isMobileLayout())window.termaWorkspaceShell.showMobileWorkspace()");
      for (const theme of ["light","dark"]) for (const language of ["zh-CN","en-US"]) {
        const prefix = `${width}-${language}-${theme}`;
        console.log("[terminal-panel] " + prefix);
        await execute(`applyTheme('${theme}');await setTermaLanguage('${language}',{persist:false});
          const p=window.termaEfficiency.panel,m=p.model;m.restore({});m.state.preferences.presets=[];m.state.preferences.defaultId='';
          if(!p.visible())p.toggle();m.current().height=260;m.publish();`);
        await wait("document.querySelector('#terminalPanel [data-terminal-quick-command-id]')");
        if (process.env.TERMA_PANEL_FILE_LIST_ONLY === '1') {
          await runLocalFileWindowMatrix({execute,wait,check,shot,prefix});
          continue;
        }
        await shot(prefix + "-commands");
        await check(prefix+" four default flat text tabs without add", `document.querySelectorAll('[data-panel-tab]').length===4&&!document.querySelector('[data-panel-action=add]')&&
          [...document.querySelectorAll('[data-panel-tab]')].every(n=>!n.querySelector('svg')&&getComputedStyle(n.parentElement).borderRightWidth==='0px')`);
        await execute("document.querySelector('[data-panel-tab][aria-selected=true]').focus()");
        browser.webContents.focus();
        browser.webContents.sendInputEvent({type:"keyDown",keyCode:"Right"});
        browser.webContents.sendInputEvent({type:"keyUp",keyCode:"Right"});
        await wait("document.activeElement?.getAttribute('role')==='tab'&&document.activeElement.textContent===tr('terminal:panel.files')");
        browser.webContents.sendInputEvent({type:"keyDown",keyCode:"Left"});
        browser.webContents.sendInputEvent({type:"keyUp",keyCode:"Left"});
        await wait("document.activeElement?.textContent===tr('terminal:panel.commands')");
        for(const type of ["keyDown","keyUp"])browser.webContents.sendInputEvent({type,keyCode:"Tab"});
        await delay(60);
        for(const type of ["keyDown","keyUp"])browser.webContents.sendInputEvent({type,keyCode:"Tab",modifiers:["shift"]});
        await wait("document.activeElement?.getAttribute('role')==='tab'");
        await check(prefix+" keyboard tabs keep visible focus and thin active underline",
          "getComputedStyle(document.activeElement).outlineStyle!=='none'&&getComputedStyle(document.activeElement.parentElement,'::after').height==='1px'");
        await shot(prefix+"-tab-focus");
        const hover=await point('[data-panel-tab][aria-selected=true]');
        browser.webContents.sendInputEvent({type:"mouseMove",...hover});
        await shot(prefix+"-tab-hover");
        const before = await execute("return window.__panelFixture.sends.length");
        await click("#terminalPanel [data-terminal-quick-command-id]");
        await check(prefix + " command uses displayed target and insertion semantics", `window.__panelFixture.sends.length===${before+1}&&window.__panelFixture.sends.at(-1).key==='terminal-panel-review-0'&&window.__panelFixture.sends.at(-1).text==='printf panel'`);
        await execute(`activeTabKey='terminal-panel-review-1';window.dispatchEvent(new CustomEvent('terma:workspace-target-changed'));`);
        await delay(80);
        await check(prefix+" removed binding row and compact tabs", "!document.querySelector('[data-panel-target],[data-panel-binding]')&&document.querySelector('.terminal-panel-tabs').getBoundingClientRect().height<=30");
        await click("#terminalPanel [data-terminal-quick-command-id]");
        await check(prefix + " following switches command target", "window.__panelFixture.sends.at(-1).key==='terminal-panel-review-1'");
        await click('[data-panel-action="split_horizontal"]');
        await wait("document.querySelectorAll('[data-panel-pane]').length===2");
        await shot(prefix + "-split");
        if (width === 1200) {
          const p = await point("[data-panel-divider]"), ratio = await execute("return window.termaEfficiency.panel.model.current().layout.ratio");
          for (const type of ["mouseMove","mouseDown"]) browser.webContents.sendInputEvent({type,...p,button:"left",clickCount:1});
          browser.webContents.sendInputEvent({type:"mouseMove",x:p.x+55,y:p.y,button:"left"});
          browser.webContents.sendInputEvent({type:"mouseUp",x:p.x+55,y:p.y,button:"left",clickCount:1});
          await delay(80);
          await check(prefix + " real pointer resizes split", `window.termaEfficiency.panel.model.current().layout.ratio>${ratio}`);
          const keyboardRatio = await execute("document.querySelector('[data-panel-divider]').focus();return window.termaEfficiency.panel.model.current().layout.ratio");
          browser.webContents.sendInputEvent({type:"keyDown",keyCode:"Right"});
          browser.webContents.sendInputEvent({type:"keyUp",keyCode:"Right"});
          await delay(80);
          await check(prefix+" keyboard resizes split", `window.termaEfficiency.panel.model.current().layout.ratio>${keyboardRatio}`);
        } else {
          await check(prefix + " narrow keeps one visible pane", "[...document.querySelectorAll('[data-panel-pane]')].filter(n=>n.checkVisibility()).length===1");
          await execute(`const m=window.termaEfficiency.panel.model,n=m.current().layout.first;m.activate(n.id,n.activeTabKey)`);
          await wait("document.querySelector('.terminal-panel-pane.focused').dataset.panelPane===window.termaEfficiency.panel.model.current().layout.first.id");
          await check(prefix + " narrow can switch retained panes", "document.querySelector('.terminal-panel-pane.focused').dataset.panelPane===window.termaEfficiency.panel.model.current().layout.first.id");
        }
        await click('[data-panel-action="dock_right"]');
        await check(prefix+" moved tab belongs only to right and bottom remains", "document.querySelector('#terminalPanelRight [data-panel-tab]')&&document.querySelector('#terminalPanel [data-panel-tab]')&&document.querySelectorAll('[data-panel-tab]').length===4");
        await shot(prefix + "-right");
        const handle = await point('[data-panel-resize="right"]');
        const size = await execute(`return window.termaEfficiency.panel.model.current().${width===1200?'width':'height'}`);
        for (const type of ["mouseMove","mouseDown"]) browser.webContents.sendInputEvent({type,...handle,button:"left",clickCount:1});
        const destination = width === 1200 ? {x:handle.x-40,y:handle.y} : {x:handle.x,y:handle.y-40};
        browser.webContents.sendInputEvent({type:"mouseMove",...destination,button:"left"});
        browser.webContents.sendInputEvent({type:"mouseUp",...destination,button:"left",clickCount:1});
        await delay(80);
        await check(prefix + " real pointer resizes dock", `window.termaEfficiency.panel.model.current().${width===1200?'width':'height'}>${size}`);
        await click('[data-panel-action="presets"]');
        await click("[data-panel-preset-name]");
        browser.webContents.insertText("Review layout");
        await execute(`window.__panelFixture.draftNode=document.querySelector('[data-panel-preset-name]');
          window.__panelFixture.draftNode.setSelectionRange(2,5);await setTermaLanguage('${language==='en-US'?'zh-CN':'en-US'}',{render:false});`);
        await check(prefix + " live language preserves draft node focus and caret", `document.querySelector('[data-panel-preset-name]')===window.__panelFixture.draftNode&&document.activeElement===window.__panelFixture.draftNode&&document.activeElement.value==='Review layout'&&document.activeElement.selectionStart===2`);
        await execute(`await setTermaLanguage('${language}',{render:false});`);
        await click("[data-panel-save-preset]");
        await check(prefix + " preset saves whitelist only", `window.termaEfficiency.panel.model.state.preferences.presets.length===1&&!/printf panel|password|token|sends/.test(localStorage.getItem('termaTerminalPanelV1'))`);
        await shot(prefix + "-preset");
        await click('[data-panel-action="set_default"]');
        await check(prefix+" preset can become default", "window.termaEfficiency.panel.model.state.preferences.defaultId===window.termaEfficiency.panel.model.state.preferences.presets[0].id");
        await click("[data-panel-preset-name]");
        browser.webContents.insertText("Renamed layout");
        await click('[data-panel-action="rename_preset"]');
        await check(prefix+" preset can be renamed", "document.querySelector('.terminal-panel-preset-row').textContent.includes('Renamed layout')");
        const savedHeight = await execute("const m=window.termaEfficiency.panel.model;const saved=m.state.preferences.presets[0].value.height;m.current().height=150;m.publish();return saved");
        await click(".terminal-panel-preset-row>button:first-child");
        await wait(`window.termaEfficiency.panel.model.current().height===${savedHeight}`);
        await click("[data-panel-reset]");
        await click('[data-panel-action="delete_preset"]');
        await check(prefix+" default reset and preset delete preserve current layout", `window.termaEfficiency.panel.model.current().height===${savedHeight}&&window.termaEfficiency.panel.model.state.preferences.presets.length===0&&!window.termaEfficiency.panel.model.state.preferences.defaultId`);
        await click('[data-panel-action="presets"]');
        await click('[data-panel-action="maximize"]');
        await shot(prefix + "-maximized");
        await click('[data-panel-action="restore"]');
        await execute(`const p=window.termaEfficiency.panel;window.__panelFixture.saved=JSON.stringify(p.model.current());p.toggle();p.toggle();`);
        await check(prefix + " hide and reopen preserves layout without sending", "JSON.stringify(window.termaEfficiency.panel.model.current())===window.__panelFixture.saved");
        await execute(`activeTabKey='terminal-panel-review-0';window.dispatchEvent(new CustomEvent('terma:workspace-target-changed'));`);
        await click('#terminalPanelRight [data-panel-action="dock_bottom"]');
        await check(prefix+" returning last right tab hides sidebar", "!document.querySelector('#terminalPanelRight').checkVisibility()&&document.querySelectorAll('#terminalPanel [data-panel-tab]').length===4");
        const collapseHandle = await point("[data-panel-resize]");
        for (const type of ["mouseMove","mouseDown"]) browser.webContents.sendInputEvent({type,...collapseHandle,button:"left",clickCount:1});
        browser.webContents.sendInputEvent({type:"mouseMove",x:collapseHandle.x,y:830,button:"left"});
        browser.webContents.sendInputEvent({type:"mouseUp",x:collapseHandle.x,y:830,button:"left",clickCount:1});
        await delay(100);
        await check(prefix+" resize collapses to flat tabs and actions only", "window.termaEfficiency.panel.model.current().height===28&&document.querySelector('#terminalPanel').getBoundingClientRect().height<=29&&document.querySelector('.terminal-panel-tabbar').checkVisibility()&&![...document.querySelectorAll('#terminalPanel .terminal-panel-content')].some(n=>n.checkVisibility())&&!document.querySelector('.terminal-panel-header')");
        await shot(prefix+"-collapsed");
        await execute("const m=window.termaEfficiency.panel.model;m.current().height=380;m.publish()");
        if (Number(process.env.TERMA_PANEL_BATCH || 3) >= 2)
          await runPanelContentMatrix({execute,wait,check,click,shot,prefix,delay,browser,point});
        if (Number(process.env.TERMA_PANEL_BATCH || 3) >= 3)
          await runPanelPerformanceMatrix({execute,wait,check,click,shot,prefix,delay});
        await runLocalFileWindowMatrix({execute,wait,check,shot,prefix});
      }
    }
    if (process.env.TERMA_PANEL_REAL_SSH === '1')
      await runPanelRealSsh({execute,wait,check,click,shot,browser,delay});
    if (process.env.TERMA_PANEL_REAL_LOCAL === '1')
      await runPanelRealLocal({execute,wait,check,click,shot,browser,delay});
    if (process.env.TERMA_PANEL_MINIMUM === '1') {
      browser.setContentSize(1200,844);
      for(const theme of ["light","dark"])for(const language of ["zh-CN","en-US"]){
        await execute(`syncResponsivePane();applyTheme('${theme}');await setTermaLanguage('${language}',{persist:false});
          const p=window.termaEfficiency.panel,m=p.model;m.restore({});m.current().width=260;
          m.dock(m.current().tabs.find(t=>t.kind==='commands').key,'right');if(!p.visible())p.toggle();m.publish();`);
        await delay(250);
        await check(`${language} ${theme} minimum right dock retains every title action`,
          "[...document.querySelectorAll('.terminal-panel-header-actions button')].filter(b=>b.checkVisibility()).every(b=>{const r=b.getBoundingClientRect(),host=b.closest('.terminal-panel').getBoundingClientRect();return r.left>=host.left&&r.right<=host.right&&(b.disabled||document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b)})");
        await shot(`1200-${language}-${theme}-minimum-right`);
      }
    }
  } finally {
    await execute(`const f=window.__panelFixture;api=f.originalApi;connections=f.connections;tabs=f.tabs;activeTabKey=f.active;
      for(const key of ['terminal-panel-review-0','terminal-panel-review-1']){
        const session=window.termaTerminalState.terminalSessions.get(key);
        if(session){window.termaTerminalViewport.cancelSession(session);session.term.dispose();}
        window.termaTerminalState.terminalSessions.delete(key);
      }
      window.termaEfficiency.panel.model.state.preferences=f.preferences;window.termaEfficiency.panel.model.publish();`);
    fs.writeFileSync(path.join(directory,"report.json"), JSON.stringify({reports,images},null,2));
    await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {enabled:false});
    if (ownsDebugger) browser.webContents.debugger.detach();
  }
  return JSON.stringify({checks:reports.length,screenshots:images.length,directory});
}
module.exports = {runTerminalPanelUiScenario};
