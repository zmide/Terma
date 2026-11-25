const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

// Disposable harness tabs exercise the real browser event path without SSH or
// host mutations. The inserted engine marker must survive every layout change.
async function runWorkspaceShellUiScenario(window) {
  const directory=process.env.TERMA_WORKSPACE_VISUAL_DIR||path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR||path.join(process.cwd(),'data'),'workspace-visual');
  fs.mkdirSync(directory,{recursive:true});
  const execute=source=>window.webContents.executeJavaScript(source);
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const capture=async name=>{window.webContents.invalidate();await window.webContents.capturePage();await delay(90);fs.writeFileSync(path.join(directory,`${name}.png`),(await window.webContents.capturePage()).toPNG());};
  const measureSplitter=()=>execute(`(()=>{
    const split=document.querySelector('#workspaceDock .workspace-split');
    const separator=split?.querySelector(':scope > [role="separator"]');
    if(!separator?.checkVisibility())return null;
    const rect=separator.getBoundingClientRect(),vertical=separator.getAttribute('aria-orientation')==='vertical';
    const first=split.firstElementChild.getBoundingClientRect(),last=split.lastElementChild.getBoundingClientRect();
    const point={x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)};
    const line=getComputedStyle(separator,'::before');
    return {vertical,point,hit:document.elementFromPoint(point.x,point.y)===separator,
      cursor:getComputedStyle(separator).cursor,display:getComputedStyle(split).display,
      handleSize:vertical?rect.width:rect.height,gap:vertical?last.left-first.right:last.top-first.bottom,
      color:line.backgroundColor,shadow:line.boxShadow,ink:vertical?line.width:line.height,
      focused:separator.matches(':focus-visible')};
  })()`);
  const click=async(selector,button='left')=>{
    const point=await execute(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e?.checkVisibility())throw new Error('Missing visible control: '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    window.webContents.sendInputEvent({type:'mouseMove',...point});
    window.webContents.sendInputEvent({type:'mouseDown',button,clickCount:1,...point});
    window.webContents.sendInputEvent({type:'mouseUp',button,clickCount:1,...point});await delay(80);
  };
  const tap=async selector=>{
    const point=await execute(`(()=>{
      const control=document.querySelector(${JSON.stringify(selector)});
      if(!control?.checkVisibility())throw new Error('Missing touch control: '+${JSON.stringify(selector)});
      control.scrollIntoView({block:'nearest',inline:'nearest'});
      const rect=control.getBoundingClientRect();
      const x=Math.round(rect.x+rect.width/2),y=Math.round(rect.y+rect.height/2);
      if(!control.contains(document.elementFromPoint(x,y)))throw new Error('Touch control is obscured: '+${JSON.stringify(selector)});
      return {x,y};
    })()`);
    const debuggerClient=window.webContents.debugger;
    await debuggerClient.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    await debuggerClient.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await delay(100);
  };
  const dragSftpTab=async zone=>{
    const points=await execute(`(()=>{const f=window.__sftpLifecycleFixture,tab=document.querySelector('.tab[data-tab-key="'+f.key+'"]'),r=tab.getBoundingClientRect(),pane=window.termaWorkspacePaneScope.workspacePaneElement(f.owner),target=pane.querySelector('${zone==='right'?'.workspace':'.tabs-shell'}').getBoundingClientRect();return {start:{x:Math.round(r.left+Math.min(45,r.width/3)),y:Math.round(r.top+r.height/2)},end:{x:Math.round(${zone==='right'?'target.right-25':'target.left+40'}),y:Math.round(${zone==='right'?'target.top+target.height/2':'target.top+target.height/2'})}}})()`);
    window.webContents.sendInputEvent({type:'mouseMove',...points.start});
    window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...points.start});
    for(let step=1;step<=8;step++){
      window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(points.start.x+(points.end.x-points.start.x)*step/8),y:Math.round(points.start.y+(points.end.y-points.start.y)*step/8)});await delay(25);
    }
    window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...points.end});await delay(180);
  };
  await execute(`(async()=>{
    await window.termaI18nReady;while(window.workspaceRestorePending)await new Promise(r=>setTimeout(r,20));
    window.restoringTabs=true;window.termaWorkspaceShell.showPrimary('settings');await window.termaSettingsViews.open();window.termaWorkspaceShell.setCollapsed(false);
    window.__shellDraft=document.querySelector('#webStorageRoot');window.__shellDraft.value='/fixture/unsaved-draft';
    window.__shellSettingsRoot=window.__shellDraft.closest('[data-terma-settings-owned]');
    for(const [key,title] of [['shell-alpha','Alpha <file>'],['shell-beta','Beta'],['shell-gamma','Gamma']])setWorkspace(title,'Fixture','terminal',key,true,true,{kind:'workspace-ui-fixture'});
    const owner=workspaceFindPaneForTab('shell-alpha');window.__shellOwner=owner.id;
    window.__shellEngine=document.createElement('div');window.__shellEngine.textContent='Session engine marker';window.__shellEngine.dataset.i18nSkip='';
    window.termaWorkspacePaneScope.workspacePaneElement(owner.id).querySelector('.workspace').appendChild(window.__shellEngine);
    window.termaWorkspaceDrag.applyTabDrop({key:'shell-gamma'},{paneId:owner.id,zone:'right'});
    window.__shellWrites=[];const originalApi=api;api=(url,options={})=>{if(options.method&&options.method!=='GET'){window.__shellWrites.push(url);throw new Error('Unexpected mutation: '+url);}return originalApi(url,options);};
    document.querySelectorAll('.toast').forEach(e=>e.remove());
  })()`);
  await delay(100);
  await execute(`(async()=>{const saved=activeTabKey;const exchange=window.termaExchange.feature();exchange.open();exchange.navigate('import-source');activateTab(saved);window.termaSettingsNavigation.show('settings-general',{moveToWorkspace:false});closeTabsByKey(['import']);})()`);await delay(25);
  assert.equal(await execute(`document.querySelector('#explorerTools [data-explorer-section="settings-general"]').classList.contains('active')`),true,'background legacy section updates do not clear Vue navigation selection');
  // Real pointer drag, keyboard adjustment and reset on the Vue separator.
  const separator=await execute(`(()=>{const e=document.querySelector('.workspace-splitter'),r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  for(const event of [{type:'mouseMove',...separator},{type:'mouseDown',button:'left',clickCount:1,...separator},{type:'mouseMove',x:separator.x+65,y:separator.y,movementX:65},{type:'mouseUp',button:'left',clickCount:1,x:separator.x+65,y:separator.y}]){window.webContents.sendInputEvent(event);await delay(25);}
  assert.ok(await execute(`Math.abs(workspaceLayout.ratio-.5)>.03`),'pointer drag changes split ratio');
  await execute(`document.querySelector('.workspace-splitter').focus()`);
  const before=await execute(`workspaceLayout.ratio`);
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});await delay(40);
  assert.ok(await execute(`workspaceLayout.ratio>${before}`),'keyboard changes split ratio');
  // Workspace header/tab chrome is owned by the TypeScript service. Exercise
  // the real pointer, keyboard and double-click reset paths before the matrix.
  window.setContentSize(1200,844);await delay(80);
  const chromePoints=await execute(`(()=>{const h=document.querySelector('#workspaceHeaderResize'),t=document.querySelector('.workspace-tab-resizer'),point=e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}};return {header:point(h),tabs:point(t),before:{header:getComputedStyle(document.documentElement).getPropertyValue('--workspace-header-height'),tabs:getComputedStyle(document.documentElement).getPropertyValue('--workspace-tab-height')}}})()`);
  for(const event of [{type:'mouseMove',...chromePoints.header},{type:'mouseDown',button:'left',clickCount:1,...chromePoints.header},{type:'mouseMove',x:chromePoints.header.x,y:chromePoints.header.y+12},{type:'mouseUp',button:'left',clickCount:1,x:chromePoints.header.x,y:chromePoints.header.y+12}]){window.webContents.sendInputEvent(event);await delay(25);}
  assert.notEqual(await execute(`getComputedStyle(document.documentElement).getPropertyValue('--workspace-header-height')`),chromePoints.before.header,'header pointer resize updates the CSS metric');
  await execute(`document.querySelector('#workspaceHeaderResize').focus()`);window.webContents.sendInputEvent({type:'keyDown',keyCode:'Home'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Home'});await delay(35);
  assert.equal(await execute(`getComputedStyle(document.documentElement).getPropertyValue('--workspace-header-height')`),'34px','header keyboard Home clamps to the minimum');
  await execute(`document.querySelector('#workspaceHeaderResize').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);await delay(35);
  assert.equal(await execute(`getComputedStyle(document.documentElement).getPropertyValue('--workspace-header-height')`),'42px','header double click restores the default');
  await execute(`document.querySelector('.workspace-tab-resizer').focus()`);window.webContents.sendInputEvent({type:'keyDown',keyCode:'End'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'End'});await delay(35);
  assert.equal(await execute(`getComputedStyle(document.documentElement).getPropertyValue('--workspace-tab-height')`),'48px','tab keyboard End clamps to the maximum');
  await execute(`document.querySelector('.workspace-tab-resizer').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);await delay(35);
  assert.equal(await execute(`getComputedStyle(document.documentElement).getPropertyValue('--workspace-tab-height')`),'32px','tab double click restores the default');
  const keyboardDebugger=window.webContents.debugger;
  const ownsDebugger=!keyboardDebugger.isAttached();
  if(ownsDebugger)keyboardDebugger.attach('1.3');
  await keyboardDebugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  const reports=[];
  for(const language of ['zh-CN','en-US'])for(const theme of ['light','dark'])for(const width of [1200,390]){
    if(width===390)await execute(`activateTab('shell-gamma')`);
    window.setContentSize(width,844);await delay(90);
    await execute(`(async()=>{await setTermaLanguage(${JSON.stringify(language)});applyTheme(${JSON.stringify(theme)});renderTabs();syncResponsivePane();if(isMobileLayout())window.termaWorkspaceShell.showMobileWorkspace();})()`);await delay(100);
    await capture(`${language}-${theme}-${width}`);
    const navigation = await execute(`(()=>{
      const back=document.getElementById('mobileBack'),bar=back.parentElement,rect=back.getBoundingClientRect();
      return {
        desktop:document.querySelector('#workspaceDock .tabs-shell').checkVisibility(),
        mobile:document.getElementById('mobileWorkspaceTabs').checkVisibility(),
        back:back.checkVisibility(),
        backHit:back.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)),
        barHeight:bar.getBoundingClientRect().height
      };
    })()`);
    const mobile=width===390;
    assert.deepEqual(navigation, {desktop:!mobile,mobile,back:mobile,backHit:mobile,barHeight:mobile?50:0}, `${language}/${theme}/${width} workspace navigation`);
    const report=await execute(`(()=>{
      const roots=[...document.querySelectorAll('.terma-shell-root,.workspace-pane-chrome,#workspaceGroupBar,#mobileWorkspaceTabs')];
      const chinese=[];if(document.documentElement.lang==='en-US')for(const root of roots){
        const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walker.nextNode())if(/[\\u3400-\\u9fff]/.test(walker.currentNode.textContent))chinese.push(walker.currentNode.textContent);
        for(const e of [root,...root.querySelectorAll('*')])for(const a of ['title','aria-label'])if(/[\\u3400-\\u9fff]/.test(e.getAttribute(a)||''))chinese.push(e.getAttribute(a));
      }
      return {engine:window.termaWorkspacePaneScope.workspacePaneElement(window.__shellOwner).contains(window.__shellEngine),draft:window.__shellDraft.value==='/fixture/unsaved-draft'&&window.__shellSettingsRoot.querySelector('#webStorageRoot')===window.__shellDraft&&window.__shellSettingsRoot.hasAttribute('data-terma-settings-owned'),panes:document.querySelectorAll('#workspaceDock .workspace-pane').length,heading:document.getElementById('workspaceTitle').textContent,chinese,overflow:document.documentElement.scrollWidth>innerWidth+1};
    })()`);
    assert.equal(report.engine,true,'engine DOM identity retained');assert.equal(report.draft,true,'hidden Settings draft and mounted field retained');assert.equal(report.panes,width===390?1:2);assert.equal(report.overflow,false);assert.deepEqual(report.chinese,[]);assert.equal(report.heading,language==='zh-CN'?'工作区':'Workspace');
    let splitLayout=null;
    if(width===1200){
      window.webContents.sendInputEvent({type:'mouseMove',x:3,y:400});
      await delay(150);
      const normal=await measureSplitter();
      assert.ok(normal?.vertical&&normal.hit,'the side-by-side pane separator must be visible and hit-testable');
      assert.deepEqual([normal.display,normal.cursor,normal.handleSize,normal.gap,normal.ink],['grid','col-resize',10,2,'1px']);
      window.webContents.sendInputEvent({type:'mouseMove',...normal.point});
      await delay(150);
      const hovered=await measureSplitter();
      assert.notEqual(hovered.color,normal.color,'the hover line uses a distinct color');
      assert.equal(hovered.shadow,'none');
      window.webContents.sendInputEvent({type:'mouseMove',x:3,y:400});
      await execute(`document.querySelector('#workspaceDock .workspace-splitter').focus()`);
      assert.equal(await execute(`document.activeElement.matches('.workspace-splitter')`),true,'the split separator accepts focus');
      for(const type of ['keyDown','keyUp'])window.webContents.sendInputEvent({type,keyCode:'Tab'});
      await delay(60);
      assert.equal(await execute(`document.activeElement.matches('.workspace-splitter')`),false,'Tab moves off the separator');
      for(const type of ['keyDown','keyUp'])window.webContents.sendInputEvent({type,keyCode:'Tab',modifiers:['shift']});
      await delay(150);
      splitLayout=await measureSplitter();
      assert.deepEqual([splitLayout.focused,splitLayout.ink,splitLayout.color,splitLayout.shadow],[true,'3px',hovered.color,'none']);
    }else{
      assert.equal(await execute(`document.querySelector('#workspaceDock .workspace-splitter')`),null,'the narrow view renders only the active pane');
    }
    await capture(`${language}-${theme}-${width}-split-layout`);
    const selectorForTab=key=>`${width===390?'#mobileWorkspaceTabs .mobile-workspace-tab-main':'.tab'}[data-tab-key="${key}"]`;
    const tabSelector=selectorForTab('shell-alpha');
    const readActivation=key=>execute(`(()=>{
      const control=document.querySelector(${JSON.stringify(selectorForTab(key))});
      const owner=workspaceFindPaneForTab(${JSON.stringify(key)});
      return {key:activeTabKey,pane:focusedPaneId,owner:owner.id,paneKey:owner.activeTabKey,
        selected:control?.getAttribute('aria-selected'),visible:control?.checkVisibility(),
        displayed:[...document.querySelectorAll('#workspaceDock .workspace-pane[data-pane-id]')].filter(node=>node.checkVisibility()).map(node=>node.dataset.paneId),
        engine:window.termaWorkspacePaneScope.workspacePaneElement(window.__shellOwner).contains(window.__shellEngine)};
    })()`);
    await click(selectorForTab('shell-gamma'));
    const otherPane=await readActivation('shell-gamma');
    await click(tabSelector);
    const returnedPane=await readActivation('shell-alpha');
    for(const [key,state] of [['shell-gamma',otherPane],['shell-alpha',returnedPane]]){
      assert.deepEqual([state.key,state.paneKey,state.pane,state.selected,state.visible,state.engine],[key,key,state.owner,'true',true,true],`${key} activates in its owning pane`);
      assert.ok(state.displayed.includes(state.owner),`${key} activates a displayed pane`);
      if(width===390)assert.deepEqual(state.displayed,[state.owner],`${key} is the only displayed pane at narrow width`);
    }
    assert.notEqual(returnedPane.owner,otherPane.owner,'activation switches between distinct panes');
    assert.equal(await execute(`workspaceFindPaneForTab('shell-gamma').activeTabKey`),'shell-gamma','returning leaves the previous pane selection in place');
    await capture(`${language}-${theme}-${width}-tab-activate`);
    const nestedLayout=await execute(`(()=>{
      const source=workspaceFindPaneForTab('shell-beta'),rootId=workspaceLayout.id;
      const insertion=source.tabs.indexOf('shell-beta'),previousLeaves=workspaceLeaves().map(leaf=>[...leaf.tabs]);
      const moved=window.termaWorkspaceDrag.applyTabDrop({key:'shell-beta',sourceActiveTabKey:source.activeTabKey},{paneId:source.id,zone:'bottom'});
      const nested=workspaceLayout.first,pane=workspaceFindPaneForTab('shell-beta');
      const visible=[...document.querySelectorAll('#workspaceDock .workspace-pane')].filter(node=>node.checkVisibility()).map(node=>node.dataset.paneId);
      return {moved,rootStable:workspaceLayout.id===rootId,rootDirection:workspaceLayout.direction,
        nestedDirection:nested.direction,distinctSplit:nested.id!==rootId,found:workspaceFindSplit(nested.id)===nested,
        ordered:workspaceLeaves().map(leaf=>leaf.activeTabKey),pane:pane.id,source:source.id,focused:focusedPaneId,insertion,previousLeaves,
        visible,separators:[...document.querySelectorAll('#workspaceDock .workspace-split > .workspace-splitter')].map(node=>node.getAttribute('aria-orientation')),
        overflow:document.documentElement.scrollWidth>innerWidth+1};
    })()`);
    assert.deepEqual(
      [nestedLayout.moved,nestedLayout.rootStable,nestedLayout.rootDirection,nestedLayout.nestedDirection,nestedLayout.distinctSplit,nestedLayout.found,nestedLayout.overflow],
      [true,true,'row','column',true,true,false],
      'nesting a second split preserves the root and creates a distinct vertical stack'
    );
    assert.deepEqual(nestedLayout.ordered,['shell-alpha','shell-beta','shell-gamma'],'nested split preserves leaf order and the existing pane selections');
    assert.equal(nestedLayout.focused,nestedLayout.pane,'the moved tab owns the focused pane');
    assert.ok(nestedLayout.visible.includes(nestedLayout.pane),'the focused nested pane is visible');
    assert.equal(nestedLayout.visible.length,width===390?1:3,'only desktop mounts all three panes');
    assert.deepEqual(nestedLayout.separators.sort(),width===390?[]:['horizontal','vertical'],'each desktop split has an oriented separator');
    await capture(`${language}-${theme}-${width}-layout-tree`);
    const collapsedLayout=await execute(`(()=>{
      const moved=window.termaWorkspaceDrag.applyTabDrop({key:'shell-beta'},{paneId:${JSON.stringify(nestedLayout.source)},zone:'tabs',index:${nestedLayout.insertion}});
      return {moved,removed:workspaceFindPane(${JSON.stringify(nestedLayout.pane)})===null,
        leaves:workspaceLeaves().map(pane=>pane.tabs),engine:window.termaWorkspacePaneScope.workspacePaneElement(window.__shellOwner).contains(window.__shellEngine)};
    })()`);
    assert.deepEqual(collapsedLayout,{moved:true,removed:true,leaves:nestedLayout.previousLeaves,engine:true},'moving the tab back prunes just its empty pane and retains the engine');
    await click(tabSelector);
    const savedLayout=await execute(`(()=>{
      const previous=localStorage.getItem('workspaceTabs'),restoring=window.restoringTabs;
      try {
        window.restoringTabs=false;
        window.termaWorkspacePersistence.schedule(10000);
        window.termaWorkspacePersistence.schedule(10000);
        window.termaWorkspacePersistence.flush();
        const saved=JSON.parse(localStorage.getItem('workspaceTabs'));
        const leaves=workspaceLeaves(saved.layout).map(pane=>pane.tabs);
        return {split:saved.layout.id===workspaceLayout.id,active:saved.activeTabKey,leaves,
          groupLayout:JSON.stringify(saved.layout)===JSON.stringify(saved.workspaceGroups.find(group=>group.id===saved.activeWorkspaceGroupId).layout)};
      } finally {
        window.restoringTabs=restoring;
        if(previous===null)localStorage.removeItem('workspaceTabs');
        else localStorage.setItem('workspaceTabs',previous);
      }
    })()`);
    assert.deepEqual(savedLayout,{split:true,active:'shell-alpha',leaves:nestedLayout.previousLeaves,groupLayout:true},'the final focused tab and collapsed tree are saved together');
    await capture(`${language}-${theme}-${width}-drag-save`);
    await execute(`(()=>{
      for(const suffix of ['a','b','c'])setWorkspace('Recent '+suffix,'Fixture','terminal','mru-'+suffix,true,true,{kind:'workspace-ui-fixture'});
    })()`);
    for(const suffix of ['a','b','c']){
      const selector=(width===390?'#mobileWorkspaceTabs':'#workspaceDock')+' [role="tab"][data-tab-key="mru-'+suffix+'"]';
      await execute(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`);
      await click(selector);
    }
    const recentTab=await execute(`(()=>{
      const owner=workspaceFindPaneForTab('mru-c');
      closeTabsByKey(['mru-b','mru-c'],'mru-c');
      return {active:activeTabKey,pane:workspaceFindPane(owner.id)?.activeTabKey,closed:!workspaceTabByKey('mru-b')&&!workspaceTabByKey('mru-c')};
    })()`);
    assert.deepEqual(recentTab,{active:'mru-a',pane:'mru-a',closed:true},'batch close returns to the recent surviving tab in its pane');
    await capture(`${language}-${theme}-${width}-recent-close`);
    await execute(`closeTabsByKey(['mru-a'],'mru-a');activateTab('shell-alpha')`);
    if (width===1200) {
      const points=await execute(`(()=>{
        const pane=window.termaWorkspacePaneScope.workspacePaneElement(window.__shellOwner);
        const tab=pane.querySelector('.tab[data-tab-key="shell-alpha"]').getBoundingClientRect();
        const workspace=pane.querySelector('.workspace').getBoundingClientRect();
        return {start:{x:Math.round(tab.left+tab.width/3),y:Math.round(tab.top+tab.height/2)},
          end:{x:Math.round(workspace.right-25),y:Math.round(workspace.top+workspace.height/2)}};
      })()`);
      window.webContents.sendInputEvent({type:'mouseMove',...points.start});
      window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...points.start});
      await delay(50);
      window.webContents.sendInputEvent({type:'mouseMove',...points.end});
      await delay(80);
      const preview=await execute(`(()=>{
        const ghost=document.querySelector('.workspace-tab-drag-ghost');
        const indicator=window.termaWorkspacePaneScope.workspacePaneElement(window.__shellOwner).querySelector('.workspace-pane-drop-indicator');
        const highlight=getComputedStyle(indicator,'::before');
        const hintRect=indicator.querySelector('span').getBoundingClientRect();
        const ghostRect=ghost?.getBoundingClientRect();
        const clearHint=ghostRect&&(ghostRect.right<=hintRect.left||ghostRect.left>=hintRect.right||ghostRect.bottom<=hintRect.top||ghostRect.top>=hintRect.bottom);
        return {title:ghost?.querySelector('span')?.textContent,ghost:ghost?.checkVisibility(),
          passthrough:ghost&&getComputedStyle(ghost).pointerEvents==='none',zone:indicator.dataset.zone,
          halfWidth:Math.abs(parseFloat(highlight.width)*2-indicator.clientWidth)<2,visible:indicator.checkVisibility(),clearHint};
      })()`);
      assert.deepEqual(preview,{title:'Alpha <file>',ghost:true,passthrough:true,zone:'right',halfWidth:true,visible:true,clearHint:true},
        'pointer drag shows the typed ghost and right-half preview');
      await capture(`${language}-${theme}-${width}-drag-preview`);
      assert.equal(await execute(`(()=>{
        window.dispatchEvent(new PointerEvent('pointerup',{pointerId:999,bubbles:true,cancelable:true}));
        return Boolean(document.querySelector('.workspace-tab-drag-ghost'));
      })()`),true,'an unrelated pointer cannot finish the active drag');
      window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
      window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
      window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...points.end});
      await delay(80);
      assert.deepEqual(await execute(`({
        clean:!document.querySelector('.workspace-tab-drag-ghost,.tab[aria-grabbed],.workspace-pane-drop-indicator:not([hidden])')&&!document.body.classList.contains('workspace-tab-drag-active'),
        layout:workspaceLeaves().map(pane=>pane.tabs)
      })`),{clean:true,layout:nestedLayout.previousLeaves},'Escape clears all drag chrome and retains the current layout');
    } else {
      assert.equal(await execute(`getComputedStyle(window.termaWorkspacePaneScope.workspacePaneElement(window.__shellOwner).querySelector('.workspace-pane-drop-indicator')).display`),'none','narrow workspace hides the docking preview');
    }
    const addedSelector=tabSelector.replace('shell-alpha','shell-added');
    const addedTab=await execute(`(()=>{
      const pane=workspaceFindPaneForTab('shell-alpha'),neighbor=workspaceFindPaneForTab('shell-gamma');
      const expected=[...pane.tabs],neighborBefore={keys:[...neighbor.tabs],active:neighbor.activeTabKey};
      expected.splice(expected.indexOf('shell-alpha')+1,0,'shell-added');
      setWorkspace('New tab','Fixture','terminal','shell-added',true,true,{kind:'workspace-ui-fixture'});
      const record=tabs.find(tab=>tab.key==='shell-added');
      setWorkspace('Updated tab','Fixture','terminal','shell-added',true,true,{kind:'workspace-ui-fixture'});
      return {expected,actual:pane.tabs,active:pane.activeTabKey,focused:activeTabKey,
        sameRecord:tabs.find(tab=>tab.key==='shell-added')===record,
        count:tabs.filter(tab=>tab.key==='shell-added').length,
        neighborBefore,neighborAfter:{keys:neighbor.tabs,active:neighbor.activeTabKey}};
    })()`);
    assert.deepEqual(addedTab.actual,addedTab.expected,'the new tab follows the active tab in its pane');
    assert.deepEqual([addedTab.active,addedTab.focused,addedTab.sameRecord,addedTab.count],['shell-added','shell-added',true,1]);
    assert.deepEqual(addedTab.neighborAfter,addedTab.neighborBefore,'adding and reopening a tab retains the adjacent pane');
    assert.equal(await execute(`(()=>{
      const tab=document.querySelector(${JSON.stringify(addedSelector)}),rect=tab.getBoundingClientRect();
      return tab.checkVisibility()&&tab.textContent.includes('Updated tab')
        &&tab.getAttribute('aria-selected')==='true'&&rect.left>=0&&rect.right<=innerWidth+1;
    })()`),true,'the updated active tab is visible in the viewport');
    await capture(`${language}-${theme}-${width}-tab-add`);
    const closeSelector=width===390?'#mobileWorkspaceTabs .mobile-workspace-tab-close[data-tab-key="shell-added"]':'.tab[data-tab-key="shell-added"] .tab-close';
    await click(closeSelector);
    const closedTab=await execute(`(()=>{
      const pane=workspaceFindPaneForTab('shell-alpha'),neighbor=workspaceFindPaneForTab('shell-gamma');
      const active=document.querySelector(${JSON.stringify(tabSelector)});
      return {keys:pane.tabs,active:pane.activeTabKey,focused:activeTabKey,
        closed:!tabs.some(tab=>tab.key==='shell-added')&&!document.querySelector(${JSON.stringify(addedSelector)}),
        visible:active?.checkVisibility()&&active.getAttribute('aria-selected')==='true',
        neighbor:{keys:neighbor.tabs,active:neighbor.activeTabKey}};
    })()`);
    assert.deepEqual(closedTab,{keys:addedTab.expected.filter(key=>key!=='shell-added'),active:'shell-alpha',focused:'shell-alpha',closed:true,visible:true,neighbor:addedTab.neighborBefore});
    await capture(`${language}-${theme}-${width}-tab-close`);
    if(width===1200){
      await delay(200);
      const original=await execute(`getComputedStyle(document.querySelector('.tab[data-tab-key="shell-alpha"]')).backgroundColor`);
      await click(tabSelector,'right');
      assert.equal(await execute(`document.querySelector('#tabContextMenu button')?.hasAttribute('data-terma-button')`),true);
      const menu=await execute(`(()=>{const r=document.querySelector('#tabContextMenu').getBoundingClientRect();const rows=[...document.querySelectorAll('#tabContextMenu button')].map(e=>({text:e.querySelector('span').getBoundingClientRect().left,icon:e.querySelector('svg').getBoundingClientRect().left}));return {fit:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,left:rows.every(e=>Math.abs(e.text-rows[0].text)<1&&e.icon<e.text)}})()`);
      assert.deepEqual(menu,{fit:true,left:true});await capture(`${language}-${theme}-menu`);
      const tabOrder=()=>execute(`(()=>{const pane=workspaceFindPaneForTab('shell-alpha');return {keys:pane.tabs,visibleKeys:[...window.termaWorkspacePaneScope.workspacePaneElement(pane.id).querySelectorAll('.tabs .tab[data-tab-key]')].map(tab=>tab.dataset.tabKey),neighbor:workspaceFindPaneForTab('shell-gamma').tabs,active:activeTabKey}})()`);
      const before=await tabOrder(), index=before.keys.indexOf('shell-alpha'), offset=index>0?-1:1;
      const moveSelector=async direction=>`#tabContextMenu button[aria-label=${JSON.stringify(await execute(`tr('common:auto.move_${direction<0?'left':'right'}')`))}]`;
      const target=index+offset, expectedOrder=[...before.keys];
      [expectedOrder[index],expectedOrder[target]]=[expectedOrder[target],expectedOrder[index]];
      await click(await moveSelector(offset));
      assert.deepEqual(await tabOrder(),{...before,keys:expectedOrder,visibleKeys:expectedOrder},'reordering changes only the current pane and retains its active tab');
      await capture(`${language}-${theme}-tab-order`);
      await click(tabSelector,'right');
      await click(await moveSelector(-offset));
      assert.deepEqual(await tabOrder(),before,'the inverse menu action restores the exact order');
      assert.equal(await execute(`getComputedStyle(document.querySelector('.tab[data-tab-key="shell-alpha"]')).backgroundColor`),original,'selected tab keeps its color while hovered');
      const menuItem=async key=>`#tabContextMenu button[aria-label=${JSON.stringify(await execute(`tr('common:auto.${key}')`))}]`;
      await click(tabSelector,'right');
      await click(await menuItem('duplicate_tab'));
      const copy=await execute(`tabs.find(tab=>tab.key.startsWith('shell-alpha-copy-'))?.key`);
      assert.match(copy,/^shell-alpha-copy-\d+$/);
      const copiedSelector=tabSelector.replace('shell-alpha',copy);
      const expectedCopyOrder=[...before.keys];expectedCopyOrder.splice(index+1,0,copy);
      assert.deepEqual(await tabOrder(),{...before,keys:expectedCopyOrder,visibleKeys:expectedCopyOrder,active:copy},'the copied tab follows the source and preserves its neighbor pane');
      await click(copiedSelector,'right');
      await click(await menuItem('pin_tab'));
      const pinned=()=>execute(`Boolean(tabs.find(tab=>tab.key===${JSON.stringify(copy)})?.pinned)`);
      assert.equal(await pinned(),true);
      await capture(`${language}-${theme}-${width}-tab-copy-pin`);
      await click(copiedSelector,'right');
      await click(await menuItem('unpin_tab'));
      assert.equal(await pinned(),false);
      await click(`${copiedSelector} .tab-close`);
      assert.deepEqual(await tabOrder(),before,'closing the unpinned copy returns to the source pane and tab');
    }
    await execute(`window.__shellClose=window.termaWorkspaceTabActions.confirm([{title:'Alpha <file>',kind:'terminal',connectionStatus:'connected'},{title:'Beta',kind:'terminal',connectionStatus:'connecting',sessionMode:'persistent',persistentSessionId:'fixture'}]);true`);
    await capture(`${language}-${theme}-${width}-close`);
    assert.equal(await execute(`document.activeElement?.id`),'workspaceCloseTabsCancel');
    assert.equal(await execute(`document.querySelectorAll('#modal button[data-terma-button]').length`),3);
    const closeGeometry=await execute(`(()=>{const card=document.querySelector('.workspace-close-tabs-modal'),r=card.getBoundingClientRect();return {card:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,buttons:[...card.querySelectorAll('button[data-terma-button]')].map(e=>{const b=e.getBoundingClientRect();return b.left>=r.left&&b.top>=r.top&&b.right<=r.right+1&&b.bottom<=r.bottom+1})}})()`);
    assert.equal(closeGeometry.card,true);assert.deepEqual(closeGeometry.buttons,[true,true,true],'every close action fits inside the dialog');
    const liveClose=await execute(`(async()=>{
      const modal=document.querySelector('#modal'), card=modal.querySelector('[role="alertdialog"]');
      const cancel=document.activeElement, initialHeading=card.querySelector('h2').textContent;
      const expectedLanguage=document.documentElement.lang, expectedTheme=document.documentElement.dataset.theme;
      const read=()=>{
        const rect=card.getBoundingClientRect();
        const buttons=[...card.querySelectorAll('button[data-terma-button]')];
        return {
          heading:card.querySelector('h2').textContent,
          message:card.querySelector('#workspaceCloseTabsMessage').textContent,
          language:document.documentElement.lang,
          theme:modal.dataset.theme,
          sameCard:modal.querySelector('[role="alertdialog"]')===card&&!modal.hidden,
          sameFocus:document.activeElement===cancel,
          buttons:buttons.map(button=>button.textContent.trim()),
          fits:rect.left>=-1&&rect.top>=-1&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1&&buttons.every(button=>{
            const bounds=button.getBoundingClientRect();
            return bounds.left>=rect.left&&bounds.right<=rect.right+1&&bounds.top>=rect.top&&bounds.bottom<=rect.bottom+1;
          }),
          titles:[...card.querySelectorAll('.workspace-close-tabs-list strong')].map(title=>title.textContent),
        };
      };
      const waitForPaint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      await setTermaLanguage(expectedLanguage==='zh-CN'?'en-US':'zh-CN');
      applyTheme(expectedTheme==='dark'?'light':'dark');await waitForPaint();
      const switched=read();
      await setTermaLanguage(expectedLanguage);applyTheme(expectedTheme);await waitForPaint();
      return {...read(), initialHeading, switched};
    })()`);
    assert.equal(liveClose.heading,liveClose.initialHeading,'dialog returns to the original language');
    assert.notEqual(liveClose.switched.heading,liveClose.initialHeading,'an open dialog redraws in the alternate language');
    assert.notDeepEqual(liveClose.switched.buttons,liveClose.buttons,'the live change also translates the three actions');
    assert.deepEqual([liveClose.language,liveClose.theme],[language,theme]);
    assert.deepEqual([liveClose.switched.language,liveClose.switched.theme],[language==='zh-CN'?'en-US':'zh-CN',theme==='dark'?'light':'dark']);
    for(const state of [liveClose,liveClose.switched]){
      assert.equal(state.sameCard,true,'appearance changes retain the open dialog');
      assert.equal(state.sameFocus,true,'appearance changes retain cancel focus');
      assert.equal(state.fits,true,'translated actions fit the dialog and viewport');
      assert.deepEqual(state.titles,['Alpha <file>','Beta'],'user-supplied tab titles stay literal');
      assert.match(state.message,state.language==='en-US'?/Recoverable remote sessions \(1\) will continue running/:/1 个可恢复远端会话会继续运行/);
    }
    await capture(`${language}-${theme}-${width}-close-live`);
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers:['shift']});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers:['shift']});await delay(35);
    assert.equal(await execute(`document.activeElement?.matches('.dialog-window-resize')`),true,'modal focus wraps to the keyboard resize handle');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers:['shift']});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers:['shift']});await delay(35);
    assert.equal(await execute(`document.activeElement?.id`),'workspaceCloseTabsTerminate','the resize handle precedes the final action in reverse tab order');
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await delay(35);
    assert.equal(await execute(`window.__shellClose`),false);
    assert.equal(await execute(`document.querySelector('#modal').hidden&&!document.querySelector('[data-workspace-dialog="close"]')&&activeTabKey==='shell-alpha'&&window.termaWorkspacePaneScope.workspacePaneElement(window.__shellOwner).contains(window.__shellEngine)&&window.__shellDraft.value==='/fixture/unsaved-draft'`),true,'cancel releases the dialog and retains the active tab, engine and settings draft');
    const longClose=await execute(`(()=>{
      window.__shellClose=window.termaWorkspaceTabActions.confirm(Array.from({length:48},(_,i)=>({
        title:'Session '+(i+1),connectionStatus:i%2?'connected':'connecting',kind:'terminal',
        sessionMode:i%2?'persistent':'none',persistentSessionId:i%2?'fixture':''
      })));
      const list=document.querySelector('.workspace-close-tabs-list'),rect=list.getBoundingClientRect();
      const x=Math.round(rect.left+rect.width/2),y=Math.round(rect.top+rect.height/2);
      return {x,y,hit:list.contains(document.elementFromPoint(x,y)),rows:list.children.length,
        overflow:list.scrollHeight>list.clientHeight,initialScroll:list.scrollTop};
    })()`);
    assert.deepEqual([longClose.rows,longClose.overflow,longClose.initialScroll,longClose.hit],[48,true,0,true]);
    const debuggerClient=window.webContents.debugger,ownsDebugger=!debuggerClient.isAttached();
    if(ownsDebugger)debuggerClient.attach('1.3');
    try {
      await debuggerClient.sendCommand('Input.dispatchMouseEvent',{type:'mouseWheel',x:longClose.x,y:longClose.y,deltaX:0,deltaY:4000});
      await delay(240);
    } finally {
      if(ownsDebugger)debuggerClient.detach();
    }
    const scrolledClose=await execute(`(()=>{
      const card=document.querySelector('.workspace-close-tabs-modal'),list=card.querySelector('.workspace-close-tabs-list');
      const last=list.lastElementChild, bounds=list.getBoundingClientRect(),row=last.getBoundingClientRect();
      const title=last.querySelector('strong'),status=last.querySelector('span');
      const titleRect=title.getBoundingClientRect(),statusRect=status.getBoundingClientRect();
      const titleText=document.createRange();titleText.selectNodeContents(title);
      return {scrolled:list.scrollTop>0,cardStayed:card.scrollTop===0,lastVisible:row.top>=bounds.top&&row.bottom<=bounds.bottom+1,
        listBeforeActions:bounds.bottom<=card.querySelector('.workspace-close-tabs-actions').getBoundingClientRect().top+1,
        stacked:statusRect.top>=titleRect.bottom,
        titleFits:titleText.getClientRects().length===1&&titleRect.right<=row.right+1,
        statusFits:statusRect.right<=row.right+1&&status.scrollWidth<=status.clientWidth+1,
        statusText:status.textContent,
        hit:[...card.querySelectorAll('button[data-terma-button]')].map(button=>{
          const r=button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
        })};
    })()`);
    assert.deepEqual(scrolledClose,{scrolled:true,cardStayed:true,lastVisible:true,listBeforeActions:true,stacked:width===390,
      titleFits:true,statusFits:true,statusText:await execute(`tr('common:auto.connected')+' · '+tr('common:dialogs.recoverable_session_continues')`),hit:[true,true,true]});
    await capture(`${language}-${theme}-${width}-close-scroll`);
    await click('#workspaceCloseTabsCancel');
    assert.equal(await execute(`window.__shellClose`),false,'Cancel remains clickable after scrolling the list');
    reports.push({language,theme,width,...report,splitLayout,otherPane,returnedPane,nestedLayout,collapsedLayout,savedLayout,liveClose,scrolledClose});
  }
  if(ownsDebugger){
    await keyboardDebugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:false});
    keyboardDebugger.detach();
  }
  window.setContentSize(1200,844);await delay(100);await execute(`syncResponsivePane();renderTabs();activateTab('shell-alpha')`);
  await click('.tab[data-tab-key="shell-beta"] .tab-close');assert.equal(await execute(`tabs.some(t=>t.key==='shell-beta')`),false);
  await execute(`window.termaWorkspaceGroups.beginSelection('shell-alpha');window.termaWorkspaceGroups.activateFromClick({preventDefault(){},stopPropagation(){}},'shell-gamma');renderTabs()`);
  await capture('group-selection');
  assert.equal(await execute(`document.querySelector('#workspaceGroupBar button[data-action="workspace-group-selection-confirm"]').disabled`),false);
  await execute(`window.termaWorkspaceGroups.cancelSelection();window.__shellReleasedPane=window.termaWorkspacePaneScope.workspacePaneElement(workspaceFindPaneForTab('shell-gamma').id)`);
  await click('.tab[data-tab-key="shell-gamma"] .tab-close');
  assert.deepEqual(await execute(`({panes:document.querySelectorAll('#workspaceDock .workspace-pane').length,released:!window.termaWorkspaceViews.retains(window.__shellReleasedPane),engine:window.termaWorkspacePaneScope.workspacePaneElement(window.__shellOwner).contains(window.__shellEngine),draft:window.__shellDraft.value==='/fixture/unsaved-draft'&&window.__shellSettingsRoot.hasAttribute('data-terma-settings-owned')})`),{panes:1,released:true,engine:true,draft:true},'removing the empty pane releases its views and retains the surviving session/draft');
  await execute(`(async()=>{
    const id=987654321,key='shell-sftp-roundtrip',connection={id,name:'SFTP lifecycle fixture',group_name:'Fixture',ssh_user:'fixture',ssh_host:'127.0.0.1',ssh_port:22,quick_connection:false,sftp_filename_encoding:'utf8',forwards:[]};
    connections.push(connection);window.__sftpLifecycleFixture={id,key,connection,originalApi:api};
    api=async(url,options={})=>{
      if(String(url).includes('/sftp?'))return {path:'/',entries:[{name:'fixture.txt',type:'file',size:23,mtime:1780000000,mode:'-rw-r--r--',owner:'fixture',group:'fixture',metadata_known:true}],page:1,page_size:50,total:1,total_pages:1,unfiltered_total:1,sort:'name',dir:'asc',paged:true};
      if(String(url).includes('/sftp/session'))return {connected:true};
      if(options.method&&options.method!=='GET')throw new Error('SFTP lifecycle fixture must remain read-only');
      if(String(url)==='/api/runtime-settings'){
        const settings=await window.__sftpLifecycleFixture.originalApi(url,options);
        // Match the persisted language normally saved by the language button,
        // without writing settings in this isolated browser scenario.
        return {...settings,saved:{...settings.saved,language:window.__sftpLifecycleFixture.language||document.documentElement.lang}};
      }
      return window.__sftpLifecycleFixture.originalApi(url,options);
    };
    addTab('shell-sftp-companion','SFTP companion','Fixture','terminal',true,{kind:'terminal',id:0});
    await window.termaSftpPage.open(id,'/',true,key);
    window.__sftpLifecycleFixture.owner=workspaceFindPaneForTab(key).id;
    await new Promise(resolve=>setTimeout(resolve,140));
    if(!document.querySelector('.sftp-shell .sftp-row'))throw new Error('SFTP fixture did not load before docking');
    window.__sftpLifecycleFixture.source=document.querySelector('.workspace-pane[data-pane-id="'+window.__sftpLifecycleFixture.owner+'"] #view-sftp');
    window.__sftpLifecycleFixture.shell=window.__sftpLifecycleFixture.source.querySelector('.sftp-shell');
  })()`);
  await dragSftpTab('right');
  await execute(`(async()=>{
    const {key}=window.__sftpLifecycleFixture;
    const splitPane=workspaceFindPaneForTab(key);
    if(workspaceLeaves().length!==2)throw new Error('Pointer drag did not split the SFTP fixture');
    window.__sftpLifecycleFixture.splitPane=splitPane.id;
    const splitView=window.termaWorkspacePaneScope.workspacePaneElement(splitPane.id)?.querySelector('#view-sftp');
    if(!splitView?.querySelector('.sftp-shell .sftp-row'))throw new Error('SFTP view went blank after split');
    window.__sftpLifecycleFixture.splitShell=splitView.querySelector('.sftp-shell');
    window.__sftpLifecycleFixture.splitToolbar=splitView.querySelector('#sftpToolbarMount > .sftp-toolbar');
  })()`);
  await delay(180);
  await capture('sftp-split-active');
  await dragSftpTab('tabs');
  await execute(`(async()=>{
    const {key,owner}=window.__sftpLifecycleFixture;
    await new Promise(resolve=>setTimeout(resolve,120));
    activateTab(key);
  })()`);
  await delay(260);
  await capture('sftp-split-returned');
  const sftpGeometry=await execute(`(()=>{const key=window.__sftpLifecycleFixture.key,pane=window.termaWorkspacePaneScope.workspacePaneElement(workspaceFindPaneForTab(key)?.id),workspace=pane?.querySelector(':scope > .workspace'),view=pane?.querySelector('#view-sftp'),shell=view?.querySelector('.sftp-shell'),top=shell?.querySelector('.sftp-top'),nav=top?.querySelector('.sftp-navigation-row'),list=shell?.querySelector('.sftp-list'),toolbar=document.querySelector('.sftp-toolbar[data-workspace-tab-key="'+CSS.escape(key)+'"]'),rect=node=>{const r=node?.getBoundingClientRect();return r?{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),bottom:Math.round(r.bottom)}:null};return {workspace:rect(workspace),view:rect(view),shell:rect(shell),top:rect(top),nav:rect(nav),list:rect(list),toolbar:rect(toolbar),toolbarHidden:toolbar?.hidden,toolbarParent:toolbar?.parentElement?.className||toolbar?.parentElement?.id||'',scroll:{workspace:workspace?.scrollTop,view:view?.scrollTop,shell:shell?.scrollTop,top:top?.scrollTop},favorites:{className:top?.querySelector('.sftp-favorites')?.className,rect:rect(top?.querySelector('.sftp-favorites'))},computed:{workspace:workspace?getComputedStyle(workspace).display:null,view:view?getComputedStyle(view).display:null,top:top?getComputedStyle(top).display:null,topPosition:top?getComputedStyle(top).position:null}}})()`);
  assert.ok(sftpGeometry.nav?.y<=sftpGeometry.workspace?.y+80,'SFTP path controls return directly below the workspace tabs');
  assert.equal(sftpGeometry.toolbarHidden,false,'SFTP toolbar is visible after returning from split');
  assert.ok(sftpGeometry.toolbarParent.includes('workspace-global-header-tools')&&
    sftpGeometry.toolbar.bottom<=sftpGeometry.workspace.y,'default SFTP toolbar returns to the workspace header');
  const sftpRoundTrip=await execute(`(()=>{const f=window.__sftpLifecycleFixture,pane=workspaceFindPaneForTab(f.key),view=pane&&window.termaWorkspacePaneScope.workspacePaneElement(pane.id)?.querySelector('#view-sftp'),runtime=sftpTabRuntimes.get(f.key),shell=view?.querySelector('.sftp-shell'),found=document.querySelector('.sftp-toolbar[data-workspace-tab-key="'+CSS.escape(f.key)+'"]'),toolbar=runtime?.toolbar||found;return {panes:document.querySelectorAll('#workspaceDock .workspace-pane').length,pane:pane?.id,returnedToOriginal:pane?.id===f.owner,rows:view?.querySelectorAll('.sftp-row').length||0,filename:view?.querySelector('.sftp-file-name')?.textContent||'',sameShell:shell===f.shell||shell===f.splitShell,toolbar:Boolean(toolbar?.isConnected),toolbarDebug:{found:Boolean(found),connected:runtime?.toolbar?.isConnected,className:runtime?.toolbar?.className||'',parent:runtime?.toolbar?.parentElement?.className||'',all:[...document.querySelectorAll('.sftp-toolbar')].map(node=>({key:node.dataset.workspaceTabKey,connected:node.isConnected,parent:node.parentElement?.className||''}))},runtimeRoot:runtime?.root===view,vueMounted:window.termaSftpViews?.isMounted(f.key),detached:!!runtime?.detachedView}})()`);
  sftpRoundTrip.heading=sftpRoundTrip.filename==='fixture.txt';
  assert.equal(sftpRoundTrip.panes,1,'returning the only SFTP tab prunes the empty split pane');
  assert.equal(sftpRoundTrip.returnedToOriginal,true,'SFTP rejoins its original pane');
  assert.equal(sftpRoundTrip.rows,1,'remote file list remains visible after split and merge');
  assert.equal(sftpRoundTrip.heading,true,'the returned view still displays its loaded content');
  assert.equal(sftpRoundTrip.sameShell,true,'the original mounted SFTP UI survives pane teardown');
  assert.equal(sftpRoundTrip.toolbar,true,'SFTP toolbar remains attached');
  assert.equal(sftpRoundTrip.runtimeRoot,true,'SFTP runtime points to the returned pane');
  assert.equal(sftpRoundTrip.vueMounted,true,'Vue SFTP view remains mounted after merge');
  assert.equal(sftpRoundTrip.detached,false,'no orphaned detached view remains');
  const sftpReturns=[];
  for(const language of ['zh-CN','en-US'])for(const theme of ['light','dark']){
    await execute(`(async()=>{window.__sftpLifecycleFixture.language='${language}';await setTermaLanguage('${language}');applyTheme('${theme}');})()`);await delay(80);
    await dragSftpTab('right');await capture(`sftp-${language}-${theme}-split`);
    assert.equal(await execute(`workspaceLeaves().length`),2,'SFTP pointer split creates a second pane');
    await dragSftpTab('tabs');await capture(`sftp-${language}-${theme}-returned`);
    const geometry=await execute(`(()=>{const f=window.__sftpLifecycleFixture,pane=workspaceFindPaneForTab(f.key),element=window.termaWorkspacePaneScope.workspacePaneElement(pane.id),workspace=element.querySelector(':scope > .workspace'),view=element.querySelector('#view-sftp'),shells=[...view.querySelectorAll(':scope > .sftp-shell')],nav=view.querySelector('.sftp-navigation-row'),toolbar=document.querySelector('.sftp-toolbar[data-workspace-tab-key="'+f.key+'"]');return {panes:workspaceLeaves().length,shells:shells.length,rows:view.querySelectorAll('.sftp-row').length,navTop:nav.getBoundingClientRect().top,workspaceTop:workspace.getBoundingClientRect().top,toolbarVisible:!!toolbar?.checkVisibility()&&toolbar.getBoundingClientRect().height>0,runtimeRoot:sftpTabRuntimes.get(f.key)?.root===view}})()`);
    assert.equal(geometry.panes,1);assert.equal(geometry.shells,1,'returned SFTP view has exactly one populated shell');assert.equal(geometry.rows,1);assert.equal(geometry.toolbarVisible,true);assert.equal(geometry.runtimeRoot,true);assert.ok(geometry.navTop<=geometry.workspaceTop+80,'no empty shell pushes the controls down');
    assert.equal(await execute(`document.documentElement.lang`),language,'docking retains the selected interface language');
    assert.equal(await execute(`document.querySelector('#workspaceTitle').textContent`),language==='zh-CN'?'工作区':'Workspace','workspace heading follows the language after docking');
    sftpReturns.push({language,theme,...geometry});
  }
  await execute(`(async()=>{
    const fixture=window.__sftpLifecycleFixture;
    window.__sftpLifecycleFixture.language='zh-CN';
    await setTermaLanguage('zh-CN');applyTheme('light');
    connections=connections.filter(item=>item.id!==fixture.id);
    activateTab('shell-sftp-companion');activateTab(fixture.key);
    await new Promise(resolve=>setTimeout(resolve,100));
    const state=document.querySelector('#view-sftp .sftp-unavailable-state');
    if(!state||state.querySelector('.sftp-unavailable-title')?.textContent!=='连接配置已不存在')throw new Error('Deleted SSH connection did not replace the stale SFTP view with its unavailable state');
    if(document.querySelector('#view-sftp .sftp-shell'))throw new Error('Deleted SSH connection left the old SFTP file view mounted');
    window.__sftpLifecycleFixture.unavailable=true;
  })()`);
  assert.deepEqual(await execute(`(()=>({active:activeTabKey,unavailable:window.__sftpLifecycleFixture.unavailable,title:document.querySelector('#view-sftp .sftp-unavailable-title')?.textContent||'',shell:Boolean(document.querySelector('#view-sftp .sftp-shell'))}))()`),{
    active:'shell-sftp-roundtrip',unavailable:true,title:'连接配置已不存在',shell:false
  },'returning to an SFTP tab whose SSH connection was deleted replaces stale content with an unavailable state');
  await execute(`window.__shellEngine?.remove()`);
  await execute(`(async()=>{window.__sftpLifecycleFixture.language='en-US';await setTermaLanguage('en-US');})()`);await delay(100);
  assert.equal(await execute(`document.querySelector('#view-sftp .sftp-unavailable-title')?.textContent`),'Connection unavailable','the unavailable state translates live without reopening its tab');
  const unavailableReturns=[];
  for(const language of ['zh-CN','en-US'])for(const theme of ['light','dark'])for(const width of [1200,390]){
    window.setContentSize(width,844);await delay(90);
    await execute(`(async()=>{window.__sftpLifecycleFixture.language='${language}';await setTermaLanguage('${language}');applyTheme('${theme}');syncResponsivePane();if(isMobileLayout())window.termaWorkspaceShell.showMobileWorkspace();activateTab(window.__sftpLifecycleFixture.key);})()`);await delay(120);
    const expected=language==='zh-CN'?'连接配置已不存在':'Connection unavailable';
    const state=await execute(`(()=>{const root=document.querySelector('#view-sftp .sftp-unavailable-state'),title=root?.querySelector('.sftp-unavailable-title'),message=root?.querySelector('.sftp-unavailable-message'),hint=root?.querySelector('.sftp-unavailable-hint'),r=root?.getBoundingClientRect();return {present:!!root,title:title?.textContent||'',message:message?.textContent||'',hint:hint?.textContent||'',width:r?Math.round(r.width):0,height:r?Math.round(r.height):0,theme:root?.dataset.theme||'',shell:Boolean(document.querySelector('#view-sftp .sftp-shell'))}})()`);
    assert.equal(state.present,true,`unavailable state renders at ${language}/${theme}/${width}`);assert.equal(state.title,expected);assert.ok(state.message.length>0&&state.hint.length>0);assert.equal(state.theme,theme);assert.equal(state.shell,false);assert.ok(state.width>=300&&state.height>=160);
    await capture(`sftp-unavailable-${language}-${theme}-${width}`);
    unavailableReturns.push({language,theme,width,...state});
  }
  await execute(`api=window.__sftpLifecycleFixture.originalApi;connections=connections.filter(item=>item.id!==window.__sftpLifecycleFixture.id);`);
  await execute(`window.restoringTabs=false`);
  assert.deepEqual(await execute(`window.__shellWrites`),[]);
  const restoredTabs=[
    {key:'restore-terminal',kind:'terminal',viewName:'terminal',title:'Saved terminal',closable:true,pinned:true,connectionStatus:'connected'},
    {key:'settings',kind:'settings',viewName:'settings',title:'Settings',closable:true}
  ];
  const restoreReports=[];
  const groupReturns=[];
  const groupCreations=[];
  const groupMaintenance=[];
  for(const language of ['zh-CN','en-US'])for(const theme of ['light','dark'])for(const width of [1200,390]){
    const groupId=width===1200?'workspace-group-79':'workspace-main';
    const legacy={tabs:restoredTabs,activeTabKey:'settings'};
    const snapshot=width===390?legacy:{
      activeWorkspaceGroupId:groupId,
      workspaceGroups:[{
        ...legacy,id:groupId,name:'Saved workspace',focusedPaneId:'pane-restore-left',
        tabs:[...restoredTabs,{key:'restore-neighbor',kind:'workspace-ui-fixture',viewName:'terminal',title:'Second pane',closable:true}],
        layout:{type:'split',id:'split-restore',direction:'row',ratio:0.6,
          first:{type:'pane',id:'pane-restore-left',tabs:restoredTabs.map(tab=>tab.key),activeTabKey:'settings'},
          second:{type:'pane',id:'pane-restore-right',tabs:['restore-neighbor'],activeTabKey:'restore-neighbor'}}
      }]
    };
    window.setContentSize(width,844);
    await execute(`window.termaWorkspacePersistence.flush();window.workspaceRestorePending=true;localStorage.setItem('workspaceTabs',${JSON.stringify(JSON.stringify(snapshot))})`);
    const finished=once(window.webContents,'did-finish-load');
    window.webContents.reload();
    await finished;
    const restored=await execute(`(async()=>{
      const deadline=Date.now()+15000;
      const phase=()=>window.termaBootstrapRuntime?.getSnapshot().phase;
      while(Date.now()<deadline&&phase()!=='ready'&&phase()!=='failed'){
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      if(phase()!=='ready')throw new Error('Workspace restore did not complete: '+phase());
      await setTermaLanguage(${JSON.stringify(language)});
      applyTheme(${JSON.stringify(theme)});
      if(isMobileLayout())window.termaWorkspaceShell.showMobileWorkspace();
      const list=isMobileLayout()?document.querySelector('#mobileWorkspaceTabs'):document.querySelector('#workspaceDock');
      const terminal=list.querySelector('[role=tab][data-tab-key="restore-terminal"]');
      const settings=list.querySelector('[role=tab][data-tab-key="settings"]');
      const stored=JSON.parse(localStorage.getItem('workspaceTabs'));
      return {
        group:activeWorkspaceGroupId,active:activeTabKey,focus:focusedPaneId,
        paneKeys:workspaceLeaves().map(pane=>pane.tabs),
        selected:settings?.checkVisibility()&&settings.getAttribute('aria-selected')==='true',
        disconnected:terminal?.checkVisibility()&&Boolean(terminal.querySelector('.tab-connection-dot.disconnected')),
        pinned:tabs.find(tab=>tab.key==='restore-terminal')?.pinned===true&&!list.querySelector('[data-action="workspace-tab-close"][data-tab-key="restore-terminal"]'),
        persisted:stored.workspaceGroups.find(group=>group.id===activeWorkspaceGroupId)?.tabs.every(tab=>!Object.hasOwn(tab,'connectionStatus')),
        reload:performance.getEntriesByType('navigation')[0]?.type
      };
    })()`);
    assert.deepEqual(restored,{
      group:groupId,active:'settings',focus:width===390?'pane-1':'pane-restore-left',
      paneKeys:width===390?[['restore-terminal','settings']]:[['restore-terminal','settings'],['restore-neighbor']],
      selected:true,disconnected:true,pinned:true,persisted:true,reload:'reload'
    },`workspace restore at ${language}/${theme}/${width}`);
    await capture(`${language}-${theme}-${width}-tab-restore`);
    restoreReports.push({language,theme,width,...restored});
    const otherGroup='workspace-group-80';
    await execute(`(()=>{
      workspaceGroups.push({
        id:'${otherGroup}',name:'Alternate workspace',
        tabs:[{key:'settings',kind:'settings',viewName:'settings',title:'Settings',closable:true}],
        layout:{type:'pane',id:'pane-alternate',tabs:['settings'],activeTabKey:'settings'},
        activeTabKey:'settings',focusedPaneId:'pane-alternate'
      });
      window.termaWorkspaceGroups.render();
    })()`);
    const groupSelector=id=>`#workspaceGroupBar [data-workspace-group-id="${id}"]`;
    const readGroup=()=>execute(`(()=>{
      const selected=document.querySelector('#workspaceGroupBar [aria-selected="true"]');
      return {group:activeWorkspaceGroupId,selected:selected?.dataset.workspaceGroupId,visible:selected?.checkVisibility(),
        focus:focusedPaneId,active:activeTabKey,paneKeys:workspaceLeaves().map(pane=>pane.tabs),
        pinned:tabs.some(tab=>tab.key==='restore-terminal'&&tab.pinned),
        stored:JSON.parse(localStorage.getItem('workspaceTabs')).activeWorkspaceGroupId};
    })()`);
    await click(groupSelector(otherGroup));
    assert.deepEqual(await readGroup(),{
      group:otherGroup,selected:otherGroup,visible:true,focus:'pane-alternate',active:'settings',
      paneKeys:[['settings']],pinned:false,stored:otherGroup
    },`switch to the alternate group at ${language}/${theme}/${width}`);
    await click(groupSelector(groupId));
    const returned=await readGroup();
    assert.deepEqual(returned,{
      group:groupId,selected:groupId,visible:true,focus:restored.focus,active:'settings',
      paneKeys:restored.paneKeys,pinned:true,stored:groupId
    },`return to the original group at ${language}/${theme}/${width}`);
    const groupName=width===1200?'Saved workspace':language==='zh-CN'?'主工作区':'Main workspace';
    const prefix=language==='zh-CN'?'已切换到':'Switched to ';
    assert.deepEqual(await execute(`Array.from(document.querySelectorAll('#toast .toast-copy strong'),node=>node.textContent)`),
      [`${prefix}“Alternate workspace”`,`${prefix}“${groupName}”`],`group labels remain verbatim at ${language}/${theme}/${width}`);
    for(let index=0;index<2;index++)await click('#toast .toast:not(.is-leaving) .toast-head button');
    await delay(300);
    assert.equal(await execute(`document.querySelectorAll('#toast .toast').length`),0);
    await capture(`${language}-${theme}-${width}-group-return`);
    groupReturns.push({language,theme,width,...returned});

    const name='Saved workspace <QA>';
    const secondKey=width===390?'settings':'restore-neighbor';
    const combineAction=await execute(`tr('navigation:auto.combine_workspace')`);
    const confirmSelection='#workspaceGroupBar [data-action="workspace-group-selection-confirm"]';
    let touchConfirmed=false;
    if(width===390){
      const debuggerClient=window.webContents.debugger;
      debuggerClient.attach('1.3');
      try {
        await debuggerClient.sendCommand('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
        await execute(`window.__workspaceTouchEvents=0;document.addEventListener('touchstart',()=>window.__workspaceTouchEvents++,{passive:true})`);
        const start='#workspaceGroupBar [data-action="workspace-group-selection-begin"]';
        const mobileTab=key=>`#mobileWorkspaceTabs .mobile-workspace-tab-main[data-tab-key="${key}"]`;
        await tap(start);
        await tap(mobileTab('restore-terminal'));
        assert.equal(await execute(`document.querySelector('${confirmSelection}').disabled`),true,'one touch-selected tab cannot form a group');
        await tap(mobileTab(secondKey));
        assert.deepEqual(await execute(`tabs.filter(tab=>window.termaWorkspaceGroups.isSelected(tab.key)).map(tab=>tab.key)`),['restore-terminal',secondKey]);
        assert.equal(await execute(`document.querySelectorAll('#mobileWorkspaceTabs [aria-checked="true"]').length`),2,'both touch selections are exposed');
        await capture(`${language}-${theme}-${width}-group-touch`);
        await tap(confirmSelection);
        assert.equal(await execute(`window.__workspaceTouchEvents`),4,'Chromium dispatched the full touch sequence');
        touchConfirmed=true;
      } finally {
        await debuggerClient.sendCommand('Emulation.setTouchEmulationEnabled',{enabled:false});
        debuggerClient.detach();
      }
    } else {
      await click('.tab[data-tab-key="restore-terminal"]','right');
      await click(`#tabContextMenu button[aria-label=${JSON.stringify(combineAction)}]`);
      assert.equal(await execute(`document.querySelector('${confirmSelection}').disabled`),true,'one tab cannot form a group');
      await click(`.tab[data-tab-key="${secondKey}"]`);
      assert.deepEqual(await execute(`tabs.filter(tab=>window.termaWorkspaceGroups.isSelected(tab.key)).map(tab=>tab.key)`),['restore-terminal',secondKey]);
    }
    const readComposition=()=>execute(`({
      id:activeWorkspaceGroupId,groups:workspaceGroups.map(group=>({id:group.id,keys:group.tabs.map(tab=>tab.key)})),
      selection:tabs.filter(tab=>window.termaWorkspaceGroups.isSelected(tab.key)).map(tab=>tab.key),composing:window.termaWorkspaceGroups.selectionMode()
    })`);
    const originalComposition=await readComposition();
    const readDraft=()=>execute(`(()=>{
      const modal=document.querySelector('#modal'), field=modal.querySelector('#modalInputValue');
      const controls=[field,...modal.querySelectorAll('.actions button')];
      const fits=controls.every(element=>{
        const rect=element.getBoundingClientRect();
        return element.checkVisibility()&&rect.left>=0&&rect.right<=innerWidth+1
          &&element.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2));
      });
      return {title:modal.querySelector('h2').textContent,label:modal.querySelector('label').textContent,
        draft:field.value,focused:document.activeElement===field,fits,
        controls:[...modal.querySelectorAll('.actions button')].map(button=>button.textContent.trim())};
    })()`);
    if(!touchConfirmed)await click(confirmSelection);
    await click('#modalCancelBtn');
    assert.deepEqual(await readComposition(),originalComposition,'cancel keeps the source group and selection');
    if(width===1200&&language==='zh-CN'&&theme==='dark'){
      await click(confirmSelection);
      await execute(`(()=>{
        const groups=window.termaWorkspaceGroups;
        groups.switchGroup(${JSON.stringify(otherGroup)},{notify:false});
        groups.switchGroup(${JSON.stringify(groupId)},{notify:false});
        groups.beginSelection('restore-terminal');
        groups.toggleSelection(${JSON.stringify(secondKey)});
        document.querySelector('#modalInputValue').value='Stale group';
      })()`);
      await click('#modalConfirmBtn');
      assert.deepEqual(await readComposition(),originalComposition,'the earlier naming dialog cannot submit after leaving and returning to its group');
    }
    await click(confirmSelection);
    await execute(`document.querySelector('#modalInputValue').value='  Alternate workspace  '`);
    await click('#modalConfirmBtn');
    assert.deepEqual(await readComposition(),originalComposition,'duplicate name keeps the existing groups and pending selection');
    const duplicate=await execute(`tr('navigation:menus.workspace_group_duplicate')`);
    assert.equal(await execute(`document.querySelector('#toast .toast-copy strong')?.textContent`),duplicate);
    await click('#toast .toast:not(.is-leaving) .toast-head button');
    await delay(300);
    await click(confirmSelection);
    await execute(`document.querySelector('#modalInputValue').value=${JSON.stringify(name)}`);
    const alternateLanguage=language==='zh-CN'?'en-US':'zh-CN';
    for(const dialogLanguage of [alternateLanguage,language]){
      await execute(`setTermaLanguage('${dialogLanguage}')`);
      const chinese=dialogLanguage==='zh-CN';
      assert.deepEqual(await readDraft(),{
        title:chinese?'组成工作区':'Combine into workspace',label:chinese?'工作区名称':'Workspace name',
        draft:name,focused:true,fits:true,controls:chinese?['确定','取消']:['OK','Cancel']
      },`naming dialog at ${dialogLanguage}/${theme}/${width}`);
    }
    await capture(`${language}-${theme}-${width}-group-name`);
    const expectedActive=await execute(`window.termaWorkspaceGroups.isSelected(activeTabKey)?activeTabKey:'restore-terminal'`);
    await click('#modalConfirmBtn');
    const created=await execute(`(()=>{
      const stored=JSON.parse(localStorage.getItem('workspaceTabs'));
      const source=workspaceGroups.find(group=>group.id===${JSON.stringify(groupId)});
      const created=workspaceGroups.find(group=>group.id===activeWorkspaceGroupId);
      const selected=document.querySelector('#workspaceGroupBar [aria-selected="true"]');
      const list=document.querySelector(isMobileLayout()?'#mobileWorkspaceTabs':'#workspaceDock');
      const pinned=list.querySelector('[role="tab"][data-tab-key="restore-terminal"]');
      const active=list.querySelector('[role="tab"][aria-selected="true"][data-tab-key="'+activeTabKey+'"]');
      return {source:source.tabs.map(tab=>tab.key),groupCount:workspaceGroups.length,groupName:created.name,
        active:activeTabKey,activeVisible:active?.checkVisibility(),
        keys:created.tabs.map(tab=>tab.key),paneKeys:workspaceLeaves().map(pane=>pane.tabs),
        pinned:pinned?.checkVisibility()&&tabs.some(tab=>tab.key==='restore-terminal'&&tab.pinned)
          &&!list.querySelector('[data-action="workspace-tab-close"][data-tab-key="restore-terminal"]'),
        focus:workspaceFindPaneForTab(activeTabKey)?.id===focusedPaneId,
        nameText:selected?.querySelector('span')?.textContent,nameMarkup:Boolean(selected?.querySelector('qa')),
        selectedIsNew:selected?.dataset.workspaceGroupId===created.id&&created.id!==source.id,
        clear:!window.termaWorkspaceGroups.selectionMode()&&!tabs.some(tab=>window.termaWorkspaceGroups.isSelected(tab.key)),
        stored:stored.activeWorkspaceGroupId===created.id&&stored.workspaceGroups.find(group=>group.id===created.id)?.name===created.name,
        overflow:document.documentElement.scrollWidth>innerWidth+1,
        toast:document.querySelector('#toast .toast-copy strong')?.textContent};
    })()`);
    assert.deepEqual(created,{
      source:width===390?[]:['settings'],groupCount:originalComposition.groups.length+1,groupName:name,active:expectedActive,activeVisible:true,
      keys:['restore-terminal',secondKey],paneKeys:width===390?[['restore-terminal','settings']]:[['restore-terminal'],['restore-neighbor']],
      pinned:true,focus:true,nameText:name,nameMarkup:false,selectedIsNew:true,clear:true,stored:true,overflow:false,
      toast:language==='zh-CN'?`已组成工作区“${name}”`:`Created workspace “${name}”`
    },`create and select a workspace group at ${language}/${theme}/${width}`);
    await click('#toast .toast:not(.is-leaving) .toast-head button');
    await delay(300);
    const groupTabVisible=await execute(`(()=>{
      const tab=document.querySelector('#workspaceGroupBar .workspace-group-tab[aria-selected="true"]');
      const tabRect=tab.getBoundingClientRect();
      const listRect=tab.parentElement.getBoundingClientRect();
      const hit=document.elementFromPoint(tabRect.left+tabRect.width/2,tabRect.top+tabRect.height/2);
      return tabRect.left>=listRect.left-1&&tabRect.right<=listRect.right+1&&tab.contains(hit);
    })()`);
    assert.equal(groupTabVisible,true,`selected group button fits in its horizontal list at ${language}/${theme}/${width}`);
    await capture(`${language}-${theme}-${width}-group-created`);
    groupCreations.push({language,theme,width,...created,groupTabVisible});

    const newGroup=(await readGroup()).group;
    const selectGroupAction=async(id, key)=>{
      const label=await execute(`tr('navigation:menus.${key}')`);
      await click(groupSelector(id),'right');
      await click(`#tabContextMenu button[aria-label=${JSON.stringify(label)}]`);
    };
    const renamedName='Settings <QA>';
    await selectGroupAction(newGroup,'workspace_group_rename');
    assert.equal((await readDraft()).draft,name,'rename starts with the original group name');
    await execute(`document.querySelector('#modalInputValue').value=${JSON.stringify(`  ${renamedName}  `)}`);
    await click('#modalConfirmBtn');
    const renamed=await execute(`(()=> {
      const group=document.querySelector(${JSON.stringify(groupSelector(newGroup))});
      const stored=JSON.parse(localStorage.getItem('workspaceTabs'));
      return {name:group.querySelector('span').textContent,markup:Boolean(group.querySelector('qa')),
        active:stored.activeWorkspaceGroupId,stored:stored.workspaceGroups.find(item=>item.id===${JSON.stringify(newGroup)})?.name};
    })()`);
    assert.deepEqual(renamed,{name:renamedName,markup:false,active:newGroup,stored:renamedName});
    let reordered=false;
    if(width===1200){
      const order=await execute(`(()=>{
        const source=document.querySelector(${JSON.stringify(groupSelector(newGroup))});
        const target=document.querySelector(${JSON.stringify(groupSelector(otherGroup))});
        const dataTransfer=new DataTransfer(),targetRect=target.getBoundingClientRect();
        source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer}));
        target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer}));
        target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer,clientX:targetRect.left+targetRect.width/4}));
        source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer}));
        const visible=[...document.querySelectorAll('#workspaceGroupBar .workspace-group-tab')].map(button=>button.dataset.workspaceGroupId);
        const stored=JSON.parse(localStorage.getItem('workspaceTabs')).workspaceGroups.map(group=>group.id);
        return {visible,stored,dragging:document.querySelector(".workspace-group-tab.dragging")?.dataset.workspaceGroupId||'',active:activeWorkspaceGroupId};
      })()`);
      assert.deepEqual(order,{visible:['workspace-main',groupId,newGroup,otherGroup],stored:['workspace-main',groupId,newGroup,otherGroup],dragging:'',active:newGroup});
      reordered=true;
    }
    await capture(`${language}-${theme}-${width}-group-renamed`);

    // Keep an existing main-group tab to verify merge order and duplicate keys.
    await execute(`(()=>{
      const main=workspaceGroups.find(group=>group.id==='workspace-main');
      const settings={key:'settings',kind:'settings',viewName:'settings',title:'Settings',closable:true};
      main.tabs=[settings];main.activeTabKey=settings.key;
      main.layout={type:'pane',id:main.focusedPaneId,tabs:[settings.key],activeTabKey:settings.key};
    })()`);
    await selectGroupAction(newGroup,'workspace_group_dissolve_title');
    const original=await readComposition();
    await click('#modal [data-choice="1"]');
    assert.deepEqual(await readComposition(),original,'cancelling dissolution keeps all groups');
    await selectGroupAction(newGroup,'workspace_group_dissolve_title');
    const modal=await execute(`(()=>{
      const message=document.querySelector('#modal .modal-message');
      return {text:message.textContent,markup:Boolean(message.querySelector('qa'))};
    })()`);
    const expectedMessage=language==='zh-CN'?`“${renamedName}”中的标签会移回主工作区，会话不会关闭。`:`Tabs in “${renamedName}” will move back to the main workspace. Sessions will remain open.`;
    assert.deepEqual(modal,{text:expectedMessage,markup:false});
    await capture(`${language}-${theme}-${width}-group-dissolve`);
    await click('#modal [data-choice="0"]');
    const dissolved=await readGroup();
    const merged=width===390?['settings','restore-terminal']:['settings','restore-terminal','restore-neighbor'];
    assert.equal(dissolved.group,'workspace-main');
    assert.equal(dissolved.selected,'workspace-main');
    assert.equal(dissolved.stored,'workspace-main');
    assert.equal(dissolved.active,'settings');
    assert.equal(dissolved.pinned,true);
    assert.deepEqual(dissolved.paneKeys,[merged]);
    assert.equal(await execute(`workspaceGroups.some(group=>group.id===${JSON.stringify(newGroup)})`),false);
    const dissolvedToast=language==='zh-CN'?`工作区“${renamedName}”已解散`:`Workspace “${renamedName}” dissolved`;
    assert.equal(await execute(`document.querySelector('#toast .toast-copy strong')?.textContent`),dissolvedToast);
    await click('#toast .toast:not(.is-leaving) .toast-head button');
    await delay(300);
    await capture(`${language}-${theme}-${width}-group-dissolved`);
    let inactiveDissolve=null;
    if(width===1200){
      const extraKey='inactive-group-terminal';
      await execute(`(()=>{
        const target=workspaceGroups.find(group=>group.id===${JSON.stringify(otherGroup)});
        target.tabs.push({key:${JSON.stringify(extraKey)},kind:'terminal',viewName:'terminal',title:'Background terminal',closable:true});
        target.layout.tabs.push(${JSON.stringify(extraKey)});
        window.termaWorkspaceGroups.render();
      })()`);
      await selectGroupAction(otherGroup,'workspace_group_dissolve_title');
      await click('#modal [data-choice="0"]');
      const result=await readGroup();
      assert.deepEqual(result.paneKeys,[[...merged,extraKey]],'dissolving an inactive group displays the merged tabs in the active main group');
      assert.equal(result.active,'settings','dissolving an inactive group keeps the current tab');
      inactiveDissolve=await execute(`(()=>{
        const saved=JSON.parse(localStorage.getItem('workspaceTabs'));
        return {present:saved.tabs.some(tab=>tab.key===${JSON.stringify(extraKey)}),
          removed:!saved.workspaceGroups.some(group=>group.id===${JSON.stringify(otherGroup)})};
      })()`);
      assert.deepEqual(inactiveDissolve,{present:true,removed:true},'the active merge is persisted');
      await click('#toast .toast:not(.is-leaving) .toast-head button');
      await delay(300);
      await capture(`${language}-${theme}-${width}-group-dissolved-inactive`);
    }
    groupMaintenance.push({language,theme,width,renamed,reordered,modal,dissolved,inactiveDissolve});
  }
  fs.writeFileSync(path.join(directory,'matrix.json'),JSON.stringify(reports,null,2));
  fs.writeFileSync(path.join(directory,'sftp-return-matrix.json'),JSON.stringify(sftpReturns,null,2));
  fs.writeFileSync(path.join(directory,'sftp-unavailable-matrix.json'),JSON.stringify(unavailableReturns,null,2));
  fs.writeFileSync(path.join(directory,'workspace-restore-matrix.json'),JSON.stringify(restoreReports,null,2));
  fs.writeFileSync(path.join(directory,'workspace-group-return-matrix.json'),JSON.stringify(groupReturns,null,2));
  fs.writeFileSync(path.join(directory,'workspace-group-create-matrix.json'),JSON.stringify(groupCreations,null,2));
  fs.writeFileSync(path.join(directory,'workspace-group-maintenance-matrix.json'),JSON.stringify(groupMaintenance,null,2));
  console.log('Workspace group rename and dissolve passed in 8 language/theme/width combinations, and drag reorder in 4 desktop combinations.');
  console.log('Workspace group naming, duplicate and cancellation checks, and creation passed in 8 language/theme/width combinations.');
  console.log('Workspace group switch and return passed in 8 language/theme/width combinations.');
  console.log('Workspace shell browser matrix passed: 8 language/theme/width combinations, pointer/keyboard split resize, close dialogs, tab menu, selection, stable engine DOM, deleted-connection SFTP fallback, and grouped and legacy startup restore after 8 reloads.');
}
module.exports={runWorkspaceShellUiScenario};
