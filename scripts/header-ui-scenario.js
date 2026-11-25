const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Exercise the existing status request and real pointer hover without starting
// or stopping an X Server. Geometry is checked against the actual resize handle.
async function runHeaderUiScenario(browser) {
  const directory = process.env.TERMA_HEADER_VISUAL_DIR || path.join(process.cwd(), 'data', 'header-visual');
  fs.mkdirSync(directory, { recursive: true });
  const execute = source => browser.webContents.executeJavaScript(source);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const click = async (selector, reveal = false) => {
    const point = await execute(`(async()=>{
      const find=()=>[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility());
      if(${reveal}){
        find()?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      }
      const element=find(),box=element?.getBoundingClientRect();
      if(!box)throw Error('Missing header pointer target: '+${JSON.stringify(selector)});
      const x=Math.round(box.x+box.width/2),y=Math.round(box.y+box.height/2),hit=document.elementFromPoint(x,y);
      if(!element.contains(hit))throw Error('Covered header pointer target: '+${JSON.stringify(selector)}+' '+JSON.stringify({x,y,hit:hit?.className}));
      return {x,y};
    })()`);
    for (const type of ['mouseMove','mouseDown','mouseUp']) {
      browser.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});
      await delay(20);
    }
  };
  const capture = async name => {
    await execute('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await delay(120);
    browser.webContents.invalidate();
    fs.writeFileSync(path.join(directory, name + '.png'), (await browser.webContents.capturePage()).toPNG());
  };
  const measureSidebars = () => execute(`(() => {
    const width = id => Number(document.getElementById(id).getAttribute('aria-valuenow'));
    return {activity:width('activityBarResize'), operation:width('operationPaneResize'),
      rail:Math.round(document.querySelector('.activity').getBoundingClientRect().width),
      side:Math.round(document.querySelector('.left-pane').getBoundingClientRect().width),
      narrow:document.documentElement.classList.contains('operation-pane-narrow')};
  })()`);
  const checkSidebarSizing = async prefix => {
    const point = await execute(`(() => {
      const handle = document.getElementById('activityBarResize');
      const rect = handle.getBoundingClientRect();
      const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
      if (document.elementFromPoint(x, y) !== handle) throw Error('Covered activity resize handle');
      return {x, y};
    })()`);
    for (const [type, x] of [['mouseMove', point.x], ['mouseDown', point.x], ['mouseMove', point.x + 80], ['mouseUp', point.x + 80]]) {
      browser.webContents.sendInputEvent({type, x, y:point.y, button:'left', clickCount:1});
      await delay(45);
    }
    assert.equal((await measureSidebars()).rail, 64, `${prefix} activity pointer reaches max`);
    await execute(`document.getElementById('operationPaneResize').focus()`);
    for (const type of ['keyDown','keyUp']) browser.webContents.sendInputEvent({type,keyCode:'Home'});
    await delay(230);
    assert.deepEqual(await measureSidebars(), {activity:64,operation:260,rail:64,side:260,narrow:true}, `${prefix} compact operation layout`);
    assert.deepEqual(await execute(`['activityBarWidth','operationPaneWidth'].map(key=>localStorage.getItem(key))`), ['64','260']);
    await capture(prefix + '-sidebar-widths');
    await execute(`(() => {
      for (const [kind,id,delta] of [['activity','activityBarResize',-10],['operation','operationPaneResize',24]]) {
        const handle = document.getElementById(id);
        handle.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:100,pointerId:23,bubbles:true,cancelable:true}));
        window.dispatchEvent(new PointerEvent('pointermove',{clientX:100+delta,pointerId:23,cancelable:true}));
        handle.dispatchEvent(new PointerEvent('pointercancel',{pointerId:23,bubbles:true}));
        window.termaWorkspaceChrome.apply(kind, 400, {fit:false});
      }
      window.termaWorkspaceChrome.restore();
    })()`);
    assert.deepEqual(await measureSidebars(), {activity:64,operation:260,rail:64,side:260,narrow:true}, `${prefix} stored widths restore`);
    await execute(`for (const id of ['activityBarResize','operationPaneResize']) document.getElementById(id).dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}))`);
    await delay(230);
    assert.deepEqual(await measureSidebars(), {activity:40,operation:292,rail:40,side:292,narrow:false}, `${prefix} double click restores defaults`);
  };
  const checkSavedOperationPane = async () => {
    const reload = async () => {
      const loaded = require('node:events').once(browser.webContents, 'did-finish-load');
      browser.webContents.reload();
      await loaded;
      await execute(`(async()=>{
        const deadline=Date.now()+10000;
        while(Date.now()<deadline){
          if(window.TermaBootstrap?.snapshot?.().phase==='ready'||(document.querySelector('.brand[data-terma-shell-owned]')&&window.workspaceRestorePending===false))return;
          await new Promise(resolve=>setTimeout(resolve,30));
        }
        throw Error('Operation pane did not finish restoring after reload');
      })()`);
      await execute(`closeModal();dismissToast();window.termaSftpTaskWorkspace.runtime.close()`);
    };
    browser.setContentSize(1200, 844);
    await execute(`localStorage.setItem('operationPaneCollapsed','0');
      localStorage.setItem('operationPanePinnedByViewV1','{"connections":true,"running":false}');
      localStorage.removeItem('operationPanePinGuideSeenV3');`);
    await reload();
    await execute(`(async()=>{await setTermaLanguage('en-US');applyTheme('light')})()`);
    const guide = await execute(`(()=>{
      const tip=document.getElementById('operationPanePinGuide'),pin=document.getElementById('operationPanePin');
      const bounds=tip.getBoundingClientRect(),button=pin.getBoundingClientRect(),arrow=getComputedStyle(tip,'::before');
      return {shown:tip.checkVisibility(), seen:localStorage.getItem('operationPanePinGuideSeenV3'),
        offset:Math.abs(bounds.x+parseFloat(arrow.left)+parseFloat(arrow.width)/2-button.x-button.width/2),
        pins:[window.termaWorkspaceShell.isPinned('connections'),window.termaWorkspaceShell.isPinned('running')],
        expanded:document.getElementById('navConnections').getAttribute('aria-expanded')};
    })()`);
    assert.ok(guide.shown&&guide.offset<1.5, 'first-visit guide points to the pin button');
    assert.deepEqual({seen:guide.seen,pins:guide.pins,expanded:guide.expanded}, {seen:'1',pins:[true,false],expanded:'true'});
    await capture('en-US-light-1200-operation-pin-guide');
    await execute(`(async()=>{await setTermaLanguage('zh-CN');applyTheme('dark')})()`);
    await capture('zh-CN-dark-1200-operation-pin-guide');
    await click('#operationPanePinGuide button');
    assert.equal(await execute(`document.getElementById('operationPanePinGuide').hidden`),true);
    await click('#navRunning');
    assert.equal(await execute(`document.getElementById('operationPanePin').getAttribute('aria-pressed')`),'false');
    await execute(`document.getElementById('content').dispatchEvent(new MouseEvent('click',{button:2,bubbles:true}));`);
    assert.equal(await execute(`window.termaWorkspaceShell.isCollapsed()`),false,'non-primary clicks leave the pane open');
    assert.equal(await execute(`(()=>{const button=document.createElement('button');let clicked=false;
      button.addEventListener('click',event=>{clicked=true;event.stopPropagation()});document.getElementById('content').append(button);
      button.click();button.remove();return clicked&&window.termaWorkspaceShell.isCollapsed()})()`),true,'an unpinned view collapses through the capture phase');
    await capture('zh-CN-dark-1200-operation-unpinned-collapsed');
    await reload();
    assert.deepEqual(await execute(`({collapsed:window.termaWorkspaceShell.isCollapsed(), guide:document.getElementById('operationPanePinGuide').hidden,
      expanded:document.getElementById('navConnections').getAttribute('aria-expanded'), pins:['connections','running'].map(view=>window.termaWorkspaceShell.isPinned(view))})`),
      {collapsed:true,guide:true,expanded:'false',pins:[true,false]});
    await click('#operationPaneExpand');
    assert.equal(await execute(`document.getElementById('operationPanePinGuide').hidden`),true,'guide does not repeat after reload and expansion');
    await execute(`window.termaWorkspaceShell.setPinned(true,'running')`);
    console.log('[header] operation pane persisted per view, one-time guide aligned, and unpinned content auto-collapsed');
  };
  const checkTerminalNavigation = async (prefix, index) => {
    const alpha = `terminal-9701-${index}`;
    const beta = `terminal-9702-${index}`;
    await execute(`(()=>{
      window.__headerConnections=connections;
      window.__headerTerminalConnect=window.termaTerminalConnection.connect;
      window.termaTerminalConnection.connect=async(_connection,key)=>{
        const session=window.termaTerminalState.terminalSessions.get(key);
        session.connectionAttempt=1;
        session.term.writeln('$ echo Terma fixture');
        session.term.writeln('Terma fixture');
      };
      connections=[
        {id:9701,name:'Fixture Alpha',group_name:'Fixture group',ssh_user:'review',ssh_host:'alpha.example',ssh_port:22,forwards:[]},
        {id:9702,name:'Fixture Beta',group_name:'Fixture secondary',ssh_user:'review',ssh_host:'beta.example',ssh_port:22,forwards:[]}
      ];
      window.termaWorkspaceShell.showPrimary('connections');window.termaWorkspaceShell.setCollapsed(false);
      groupOpen.delete('Fixture secondary');selectConnection(9701);
      for(const [id,title,key] of [[9701,'Fixture Alpha','${alpha}'],[9702,'Fixture Beta','${beta}']]){
        addTab(key,title,'','terminal',true,{kind:'terminal',id,resumePolicy:'never',connectionStatus:'disconnected'});
      }
    })()`);
    try {
      const sidebarState = `({rows:[...$('connectionGroups').querySelectorAll('.conn-row.active')].map(row=>row.dataset.connectionId),
        closed:!groupOpen.has('Fixture secondary'), activity:document.querySelector('.activity-top > .active')?.id,scroll:$('connectionGroups').scrollTop})`;
      const before = await execute(sidebarState);
      assert.deepEqual(before,{ rows:['9701'], closed:true, activity:'navConnections', scroll:0 });
      const choose = async (key, id) => {
        await click(`.tab[data-tab-key="${key}"] .tab-title`, true);
        assert.deepEqual(await execute('({activeTabKey,id:currentConnection()?.id})'), {activeTabKey:key,id});
      };
      await choose(alpha,9701);
      await choose(beta,9702);
      assert.deepEqual(await execute(sidebarState),before,prefix+' tab activation leaves the SSH sidebar alone');
      await capture(`${prefix}-terminal-tab-independent-sidebar`);
      await click('#operationPaneCollapse');
      await choose(alpha,9701);
      assert.equal(await execute('window.termaWorkspaceShell.isCollapsed()&&document.querySelector("#navConnections").classList.contains("active")'),true);
      await capture(`${prefix}-terminal-tab-collapsed-sidebar`);
    } finally {
      await execute(`window.termaWorkspaceShell.setCollapsed(false);closeTabsByKey(${JSON.stringify([alpha,beta])});
        window.termaTerminalConnection.connect=window.__headerTerminalConnect;connections=window.__headerConnections;window.termaConnectionViews.renderConnections()`);
    }
  };
  if (process.env.TERMA_UI_OPERATION_PANE === '1') await checkSavedOperationPane();
  await execute(`(async()=>{
    await window.termaI18nReady;
    while(window.workspaceRestorePending)await new Promise(resolve=>setTimeout(resolve,20));
    closeModal();window.termaEfficiency.palette.close();window.termaSftpTaskWorkspace.runtime.close();window.termaBatch.open();
    const notices=document.createElement('style');notices.id='header-fixture-notices';notices.textContent='#toast,#notice{display:none!important}';document.head.append(notices);
    window.__headerOriginalApi=api;window.__headerOriginalHeight=window.termaWorkspaceChrome.value('header');
    api=async(route,options)=>{if(route==='/api/xserver'){if(window.__headerStatus==='unavailable')throw Error('Fixture offline');return {available:window.__headerStatus==='ready',running:['ready','unauthorized'].includes(window.__headerStatus),authorization_required:window.__headerStatus==='unauthorized',display:':0'};}return window.__headerOriginalApi(route,options);};
  })()`);
  const reports = [];
  let terminalFixtureIndex = 80;
  try {
    for (const width of [1200, 390]) for (const theme of ['light', 'dark']) for (const language of ['zh-CN', 'en-US']) {
      browser.setContentSize(width, 844);
      await execute(`(async()=>{await setTermaLanguage('${language}');applyTheme('${theme}');syncResponsivePane();if(isMobileLayout())window.termaWorkspaceShell.showMobileWorkspace();})()`);
      if (width === 1200) {
        const columnLayout = `(()=>{
          const [left,rail,sidebar,dock]=['.left-pane','.activity','.sidebar','#workspaceDock'].map(s=>document.querySelector(s));
          const [leftStyle,railStyle,sidebarStyle,dockStyle]=[left,rail,sidebar,dock].map(el=>getComputedStyle(el));
          const tab=dock.querySelector('.tab.active');
          const tabStyle=getComputedStyle(tab);
          return {surfaces:new Set([railStyle.backgroundColor,sidebarStyle.backgroundColor,dockStyle.backgroundColor]).size,
            operationMatchesActivity:railStyle.backgroundColor===sidebarStyle.backgroundColor,
            divider:leftStyle.borderInlineEndWidth,railDivider:railStyle.borderInlineEndWidth,
            sidebar:sidebar.checkVisibility(),dockGap:dockStyle.paddingInlineStart,
            adjacent:Math.abs(dock.getBoundingClientRect().left-left.getBoundingClientRect().right)<=1,
            tabJoinsWorkspace:tabStyle.backgroundColor===dockStyle.backgroundColor,
            tabAccent:tabStyle.borderBlockStartColor!== 'rgba(0, 0, 0, 0)'};
        })()`;
        const expanded = {surfaces:2,operationMatchesActivity:true,divider:'1px',railDivider:'1px',sidebar:true,dockGap:'0px',adjacent:true,tabJoinsWorkspace:true,tabAccent:true};
        await execute(`(async()=>{window.termaWorkspaceShell.showPrimary('settings');await window.termaSettingsViews.open();window.termaWorkspaceShell.setCollapsed(false);})()`);
        assert.equal(await execute(`primaryView`), 'settings');
        const navigationState = `({activeTabKey,primaryView,operationPaneCollapsed:window.termaWorkspaceShell.isCollapsed(),selected:document.querySelector('#navSettings').classList.contains('active')})`;
        await click('#workspaceDock .tab[data-tab-key="command"]');
        browser.webContents.sendInputEvent({type:'mouseMove',x:width-2,y:300});
        assert.deepEqual(await execute(navigationState),
          {activeTabKey:'command',primaryView:'settings',operationPaneCollapsed:false,selected:true});
        await delay(160);
        assert.deepEqual(await execute(columnLayout), expanded, await execute(`(()=>{const tab=document.querySelector('#workspaceDock .tab.active');return [tab.className,getComputedStyle(tab).backgroundColor,getComputedStyle($('workspaceDock')).backgroundColor].join(' / ');})()`));
        await click('#workspaceDock .tab[data-tab-key="settings"]');
        browser.webContents.sendInputEvent({type:'mouseMove',x:width-2,y:300});
        await capture(`${language}-${theme}-${width}-navigation-expanded`);
        if (process.env.TERMA_UI_SIDEBAR_SIZING === "1") await checkSidebarSizing(`${language}-${theme}-${width}`);
        await click('#operationPaneCollapse');
        await click('#workspaceDock .tab[data-tab-key="command"]');
        assert.deepEqual(await execute(navigationState),
          {activeTabKey:'command',primaryView:'settings',operationPaneCollapsed:true,selected:true});
        await click('#workspaceDock .tab[data-tab-key="settings"]');
        browser.webContents.sendInputEvent({type:'mouseMove',x:width-2,y:300});
        assert.deepEqual(await execute(navigationState),
          {activeTabKey:'settings',primaryView:'settings',operationPaneCollapsed:true,selected:true});
        await delay(160);
        assert.deepEqual(await execute(columnLayout), {...expanded,railDivider:'0px',sidebar:false});
        await capture(`${language}-${theme}-${width}-navigation-collapsed`);
        await checkTerminalNavigation(`${language}-${theme}-${width}`,terminalFixtureIndex++);
        for (const section of ['connections','remote','logs','settings','import','command','running']) {
          await execute(`window.termaWorkspaceShell.showPrimary('${section}');window.termaWorkspaceShell.setCollapsed(false);`);
          const sizing = await execute(`(()=>{const root=document.getElementById('explorerTools'),controls=[...root.querySelectorAll('.search-field,button')].filter(el=>el.checkVisibility()),box=root.getBoundingClientRect();return {count:controls.length,fits:controls.every(el=>{const r=el.getBoundingClientRect();return r.height>=26&&r.height<=36&&r.left>=box.left-1&&r.right<=box.right+1;})};})()`);
          assert.ok(sizing.count > 0 && sizing.fits, `${section} explorer compact bounds ${JSON.stringify(sizing)}`);
          await capture(`${language}-${theme}-${width}-controls-${section}`);
        }
        await execute(`window.termaBatch.open();`);
        for (const [name, selector] of [['brand', '#operationPaneCollapse'], ['shortcut', '#workspaceQuickActions button:not(:disabled)']]) {
          browser.webContents.sendInputEvent({type:'mouseMove',x:width-2,y:300});
          await delay(150);
          const inspect = `(()=>{const button=document.querySelector(${JSON.stringify(selector)}),box=button.getBoundingClientRect(),style=getComputedStyle(button);return {x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2),hover:button.matches(':hover'),background:style.backgroundColor,color:style.color};})()`;
          const idle = await execute(inspect);
          browser.webContents.sendInputEvent({type:'mouseMove',x:idle.x,y:idle.y});
          await delay(150);
          const hovered = await execute(inspect);
          assert.equal(hovered.hover, true, name+' real hover');
          assert.notEqual(hovered.background, idle.background, name+' visible hover surface');
          assert.equal(hovered.color, idle.color, name+' icon color');
          await capture(`${language}-${theme}-${width}-${name}-hover`);
        }
      }
      const publicError = await execute(`(async()=>{
        document.getElementById('header-fixture-notices').disabled=true;
        window.termaNotificationToasts.dispose();
        const error=await apiErrorFromResponse(new Response(JSON.stringify({
          error:'<img id="publicErrorProbe" src=x>内部错误',error_code:'REQUEST_FAILED',
          error_params:{password:'fixture-secret'},connection_id:-42,remote_profile_id:7
        }),{status:409}));
        notify(error.message,'error');
        const toast=document.querySelector('#toast .toast');
        if(toast)window.termaNotificationToasts.pause(toast.dataset.toastId,'fixture');
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const box=toast?.getBoundingClientRect(),close=toast?.querySelector('button')?.getBoundingClientRect();
        return {message:error.message,expected:tr('errors:backend.request_failed'),status:error.status,
          connectionId:error.connectionId,remoteProfileId:error.remoteProfileId,
          visible:Boolean(toast?.checkVisibility()),safe:!document.getElementById('publicErrorProbe')&&!toast?.textContent.includes('fixture-secret'),
          contained:Boolean(box&&close&&box.left>=0&&box.right<=innerWidth+1&&close.right<=box.right+1)};
      })()`);
      const errorName = `${language}-${theme}-${width}-public-error`;
      await capture(errorName);
      reports.push({name:errorName,...publicError});
      assert.equal(publicError.message,publicError.expected,errorName+' translated error');
      assert.equal(publicError.status,409);
      assert.equal(publicError.connectionId,-42);
      assert.equal(publicError.remoteProfileId,7);
      assert.equal(publicError.visible,true,errorName+' visible notification');
      assert.equal(publicError.safe,true,errorName+' escaped and filtered content');
      assert.equal(publicError.contained,true,errorName+' toast and close button fit');
      await execute(`window.termaNotificationToasts.dispose();document.getElementById('header-fixture-notices').disabled=false;`);
      if (process.env.TERMA_HEADER_CLIPBOARD_CHECK === '1') {
        for (const mode of ['success', 'denied']) {
          const clipboard = await execute(`(async()=>{
            const desktop=window.termaDesktop,clipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
            let writes=0,browserWrites=0,result;
            document.getElementById('header-fixture-notices').disabled=true;
            try {
              window.termaDesktop={...desktop,writeClipboardText:async text=>{if(${JSON.stringify(mode)}==='denied')throw Error(tr('common:notifications.copy_unsupported'));if(text!=='synthetic clipboard text')throw Error('Wrong clipboard value');writes++;}};
              Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{browserWrites++;}}});
              result=await copyText('synthetic clipboard text');
            } finally {window.termaDesktop=desktop;if(clipboardDescriptor)Object.defineProperty(navigator,'clipboard',clipboardDescriptor);else delete navigator.clipboard;}
            const toast=document.querySelector('#toast .toast'),box=toast?.getBoundingClientRect();
            if(toast)window.termaNotificationToasts.pause(toast.dataset.toastId,'fixture');
            return {result,writes,browserWrites,message:toast?.querySelector('strong')?.textContent,
              expected:tr(${JSON.stringify(mode)}==='success'?'common:notifications.copied':'common:notifications.copy_unsupported'),
              visible:Boolean(toast?.checkVisibility()),contained:Boolean(box&&box.left>=0&&box.right<=innerWidth+1)};
          })()`);
          const clipboardName = `${language}-${theme}-${width}-clipboard-${mode}`;
          await capture(clipboardName);
          reports.push({name:clipboardName,...clipboard});
          assert.equal(clipboard.result,mode==='success',clipboardName+' return value');
          assert.equal(clipboard.writes,mode==='success'?1:0,clipboardName+' native calls');
          assert.equal(clipboard.browserWrites,0,clipboardName+' native permission boundary');
          assert.equal(clipboard.message,clipboard.expected,clipboardName+' translated feedback');
          assert.equal(clipboard.visible,true,clipboardName+' visible feedback');
          assert.equal(clipboard.contained,true,clipboardName+' notification fit');
          await execute(`window.termaNotificationToasts.dispose();document.getElementById('header-fixture-notices').disabled=false;`);
        }
      }
      for (const height of width === 1200 ? [34, 42, 64] : [42]) {
        await execute(`window.termaWorkspaceChrome.apply('header',${height},{fit:false})`);
        for (const status of height === 42 ? ['ready', 'stopped', 'unavailable', 'unauthorized'] : ['ready']) {
          await execute(`(async()=>{window.__headerStatus='${status}';await window.termaX11.manager.refreshHeader();})()`);
          for (const hover of [false, true]) {
            const point = await execute(`(()=>{const box=document.getElementById('xServerQuickButton').getBoundingClientRect();return {x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)};})()`);
            browser.webContents.sendInputEvent({ type:'mouseMove', ...(hover ? point : { x:width-2, y:300 }) });
            await delay(220);
            const result = await execute(`(()=>{
              const header=document.querySelector('.topbar').getBoundingClientRect(),title=document.getElementById('workspaceTitle').getBoundingClientRect(),subtitle=document.getElementById('workspaceSubtitle').getBoundingClientRect();
              const handle=document.getElementById('workspaceHeaderResize'),handleBox=handle.getBoundingClientRect();
              const boundary=handle.checkVisibility()?handleBox.top:header.bottom;
              const button=document.getElementById('xServerQuickButton'),icon=button.querySelector('svg'),probe=document.createElement('span');
              probe.style.color='var('+(${JSON.stringify(status)}==='ready'?'--accent':${JSON.stringify(status)}==='unauthorized'?'--warn':'--danger')+')';button.parentElement.append(probe);
              const expected=getComputedStyle(probe).color;probe.remove();
              return {titleTop:title.top,subtitleBottom:subtitle.bottom,boundary,centerOffset:Math.abs((title.top+subtitle.bottom-header.top-header.bottom)/2),contained:title.top>=header.top-.5&&subtitle.bottom<=boundary+.5&&subtitle.top>=title.bottom-.5,subtitle:document.getElementById('workspaceSubtitle').textContent,color:getComputedStyle(button).color,stroke:getComputedStyle(icon).stroke,expected,hover:button.matches(':hover'),overflow:document.documentElement.scrollWidth>innerWidth+1};
            })()`);
            const name = `${language}-${theme}-${width}-${height}-${status}${hover ? '-hover' : ''}`;
            await capture(name);
            reports.push({ name, ...result });
            assert.equal(result.contained, true, name + ' subtitle stays inside the header above the resize handle: ' + JSON.stringify(result));
            if (width === 1200) assert.ok(result.centerOffset <= 3, name + ' heading is vertically centered: ' + result.centerOffset);
            assert.equal(result.color, result.expected, name + ' status color');
            assert.equal(result.stroke, result.expected, name + ' icon stroke');
            assert.equal(result.hover, hover, name + ' actual pointer hover');
            assert.equal(result.overflow, false, name + ' horizontal overflow');
            assert.equal(/[\u3400-\u9fff]/.test(result.subtitle), language === 'zh-CN', name + ' live subtitle language');
          }
        }
      }
    }
  } finally {
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(reports, null, 2));
    await execute(`(async()=>{api=window.__headerOriginalApi;window.termaWorkspaceChrome.apply('header',window.__headerOriginalHeight,{fit:false});await window.termaX11.manager.refreshHeader();document.getElementById('header-fixture-notices').remove();delete window.__headerOriginalApi;delete window.__headerOriginalHeight;delete window.__headerStatus;})()`);
  }
  console.log('Header browser checks passed: ' + reports.length + ' screenshots; subtitle bounds, live language, resize limits and X Server status/hover colors.');
}
module.exports = { runHeaderUiScenario };
