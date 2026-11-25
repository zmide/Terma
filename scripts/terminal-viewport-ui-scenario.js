const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function runTerminalViewportUiScenario(browser) {
  const directory = process.env.TERMA_VIEWPORT_VISUAL_DIR || path.join(process.cwd(), 'data', 'terminal-viewport-visual');
  fs.mkdirSync(directory, { recursive: true });
  const execute = source => browser.webContents.executeJavaScript(`(async()=>{${source}})()`);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const groups = [], screenshots = [];
  let checks = 0;
  const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
  const settle = async () => { await delay(850); await execute('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); };
  const capture = async name => {
    const file = `${name}.png`;
    browser.webContents.invalidate();
    await delay(250);
    let image;
    const terminal = name.includes('cursor-copy') || name.endsWith('-link-hover')
      || name.endsWith('-font') || name.endsWith('-font-wheel') || name.endsWith('-persistent-wheel')
      || name.endsWith('-settings-applied') || name.endsWith('-preferences-applied') ? await execute(`
      const term=__viewportSession.term,r=term.element.querySelector('.xterm-screen').getBoundingClientRect();
      return {left:r.left,top:r.top,bottom:r.bottom,cell:term._core._renderService.dimensions.css.cell.height,
        background:term.options.theme.background};
    `) : null;
    let ink = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      if (terminal) await execute(`
        __viewportSession.term.refresh(0,__viewportSession.term.rows-1);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      `);
      image = await browser.webContents.capturePage();
      if (!terminal) break;
      const bitmap = image.toBitmap(), size = image.getSize();
      const sample = (Math.max(0, Math.ceil(terminal.top + 2)) * size.width + Math.max(0, Math.ceil(terminal.left + 2))) * 4;
      const background = [...bitmap.subarray(sample, sample + 3)];
      ink = 0;
      for (let y = Math.ceil(terminal.top + terminal.cell * 4); y < Math.min(size.height, terminal.bottom - 2); y++) {
        for (let x = Math.ceil(terminal.left + 2); x < Math.min(size.width, terminal.left + 50); x++) {
          const index = (y * size.width + x) * 4;
          if (background.every((channel, offset) => Math.abs(bitmap[index + offset] - channel) > 40)) ink++;
        }
      }
      if (ink >= 100) break;
      await delay(100);
    }
    if (terminal) equal(ink >= 100, true, `${name} screenshot contains painted terminal text below the overlay`);
    fs.writeFileSync(path.join(directory, file), image.toPNG());
    screenshots.push(file);
  };
  const pointer = async (start, end) => {
    await execute(`
      window.__viewportPointerUpDelivered=false;
      window.__viewportPointerUpListener=()=>{window.__viewportPointerUpDelivered=true};
      window.addEventListener('pointerup',window.__viewportPointerUpListener,true);
    `);
    try {
      browser.webContents.sendInputEvent({ type: 'mouseMove', ...start });
      browser.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...start });
      for (let step = 1; step <= 10; step++) {
        browser.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(start.x + (end.x - start.x) * step / 10), y: Math.round(start.y + (end.y - start.y) * step / 10) });
        await delay(25);
      }
      browser.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...end });
      const deadline = Date.now() + 5000;
      while (!await execute('return window.__viewportPointerUpDelivered')) {
        if (Date.now() > deadline) throw Error('Pointer release did not reach the renderer');
        await delay(25);
      }
    } finally {
      await execute(`
        window.removeEventListener('pointerup',window.__viewportPointerUpListener,true);
        delete window.__viewportPointerUpListener;
      `);
    }
  };
  const click = async selector => {
    const point = await execute(`const element=document.querySelector(${JSON.stringify(selector)});element?.scrollIntoView({block:'nearest',inline:'center'});const rect=element?.getBoundingClientRect();if(!rect||!element.checkVisibility())throw Error('Missing control '+${JSON.stringify(selector)});const point={x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};if(!element.contains(document.elementFromPoint(point.x,point.y)))throw Error('Covered control '+${JSON.stringify(selector)});return point`);
    await pointer(point, point);
    await delay(60);
    await execute('await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  };
  const dragTab = async split => {
    const points = await execute(`
      const source=document.querySelector('.tab[data-tab-key="viewport-terminal"]'),sourceRect=source.getBoundingClientRect();
      const owner=window.termaWorkspacePaneScope.workspacePaneElement(window.__viewportOwner),target=owner.querySelector(${JSON.stringify(split ? ':scope > .workspace' : '.tabs-shell')}).getBoundingClientRect();
      return {start:{x:Math.round(sourceRect.left+Math.min(45,sourceRect.width/3)),y:Math.round(sourceRect.top+sourceRect.height/2)},
        end:{x:Math.round(${split ? 'target.right-25' : 'target.left+40'}),y:Math.round(target.top+target.height/2)}};
    `);
    await pointer(points.start, points.end);
    await settle();
  };
  const inspect = () => execute(`
    const session=window.__viewportSession,element=session.term.element,box=element.closest('.terminal-box'),r=box.getBoundingClientRect(),e=element.getBoundingClientRect();
    const buffer=session.term.buffer.active,toolbar=document.querySelector('.terminal-toolbar[data-workspace-tab-key="viewport-terminal"]');
    const pixelViewport=session.term._core?._viewport,scrollable=pixelViewport?._scrollableElement;
    return {viewportY:buffer.viewportY,baseY:buffer.baseY,atBottom:buffer.viewportY>=buffer.baseY,rows:session.term.rows,cols:session.term.cols,
      firstLine:buffer.getLine(buffer.viewportY)?.translateToString(true),renderViewportY:pixelViewport?._latestYDisp,
      scrollTop:scrollable?.getScrollPosition?.()?.scrollTop,cellHeight:session.term._core?._renderService?.dimensions?.css?.cell?.height,
      pixelAligned:!window.termaTerminalViewport.pixelDrift(session.term,buffer.viewportY),
      sameEngine:element===window.__viewportEngine,oneEngine:document.querySelectorAll('.terminal-box .xterm').length===1,
      fits:r.width>0&&r.height>0&&e.height<=r.height+1&&e.left>=r.left-1&&e.right<=r.right+1&&e.top>=r.top-1&&e.bottom<=r.bottom+1,
      boxScrollTop:box.scrollTop,focused:document.activeElement===element.querySelector('textarea'),
      box:r.toJSON(),element:e.toJSON(),appHeight:parseFloat(document.documentElement.style.getPropertyValue('--app-height')),
      noOverflow:document.documentElement.scrollWidth<=innerWidth+1,panes:workspaceLeaves().length,
      toolbarVisible:!!toolbar?.checkVisibility(),heightStyle:element.style.height,
      pending:window.termaTerminalViewport.getSnapshot(),viewport:window.termaViewport.getSnapshot()};
  `);
  const ownsDebugger = !browser.webContents.debugger.isAttached();
  if (ownsDebugger) browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  try {
    await execute(`
      await window.termaI18nReady;while(window.workspaceRestorePending)await new Promise(r=>setTimeout(r,20));
      window.termaWorkspaceRefresh.stop();window.termaSftpTransferLifecycle.polling.stop();window.restoringTabs=true;
      const deadline=Date.now()+5000;while(window.uiStateRefreshService?.getSnapshot().inFlight||window.dataRefreshService?.getSnapshot().inFlight){if(Date.now()>deadline)throw Error('Background requests did not settle');await new Promise(r=>setTimeout(r,25));}
      closeModal();dismissToast();window.termaWorkspaceShell.showPrimary('connections');await window.termaTerminalSettings.ensure();await window.termaTerminalLibraries.ensure();
      window.__viewportWrites=[];const originalApi=api;api=(route,options={})=>{
        if(route==='/api/connections/990018/terminal-preferences'&&options.method==='POST'){
          const body=JSON.parse(options.body);window.__viewportWrites.push({route,body});return Promise.resolve(body);
        }
        if(options.method&&options.method!=='GET')throw Error('Unexpected mutation '+route);
        return originalApi(route,options);
      };
      window.termaTerminalPreferences.schedule=()=>{};
      const connection={id:990018,name:'Viewport fixture',group_name:'Fixture',ssh_host:'viewport.example.test',ssh_user:'review',ssh_port:22,terminal_font_size:13,terminal_font_size_inherit:0,terminal_mobile_font_size:13,terminal_mobile_font_size_inherit:0,terminal_session_mode:'none',terminal_encoding:'utf8',x11_mode:'off',forwards:[]};
      connections.push(connection);
      const term=window.termaTerminalLibraries.terminal({allowProposedApi:true,fontSize:13,scrollback:2000,overviewRuler:{width:8}}),fit=window.termaTerminalViewport.adaptFitAddon(term,window.termaTerminalLibraries.fit());term.loadAddon(fit);
      const session={key:'viewport-terminal',id:connection.id,connection,term,fit,socket:null,connected:false,connectionAttempt:1,currentDirectory:'',currentDirectoryKnown:false};
      window.termaTerminalState.terminalSessions.set(session.key,session);window.__viewportSession=session;
      const owner=window.termaTerminalToolbar,original={mount:owner.mount,refresh:owner.refresh};
      for(const name of ['mount','refresh'])owner[name]=key=>{
        const host=document.querySelector('.terminal-toolbar[data-workspace-tab-key="'+key+'"]');
        if(key===session.key&&host&&!owner.isMounted(key)&&!window.__viewportColdHost){
          window.__viewportColdHost={empty:host.childNodes.length===0,key:host.dataset.terminalTabKey,entry:name};
        }
        return original[name](key);
      };
      try {
        window.termaTerminalPage.openTerminalConnection(connection,true,session.key,'Viewport fixture');
        window.__viewportColdHost.mounted=owner.isMounted(session.key);
      } finally {Object.assign(owner,original);}
      const mountDeadline=Date.now()+10000;
      while(!term.element){
        if(Date.now()>mountDeadline)throw Error('Terminal mount timed out '+JSON.stringify({tabs:workspaceAllTabs(),active:activeTabKey,view:document.querySelector('#view-terminal')?.innerHTML.slice(0,500),stored:window.termaTerminalState.terminalSessions.get(session.key)===session}));
        await new Promise(r=>setTimeout(r,20));
      }
      await new Promise(resolve=>term.write(Array.from({length:240},(_,index)=>'row-'+String(index).padStart(4,'0')+'\\r\\n').join(''),resolve));
      window.__viewportEngine=term.element;window.__viewportOwner=workspaceFindPaneForTab(session.key).id;
      addTab('viewport-companion','Companion','Fixture','terminal',true,{kind:'viewport-companion'});
      activateTab(session.key);
      const picker=document.createElement('label');picker.id='viewportPicker';picker.className='file-picker';
      picker.style.cssText='position:fixed;right:12px;bottom:12px;z-index:120;background:var(--bg);border:1px solid var(--border);padding:6px;';
      const input=document.createElement('input');input.type='file';input.id='viewportFile';input.addEventListener('click',event=>event.preventDefault());
      const text=document.createElement('span');text.className='file-picker-button';text.dataset.i18n='common:auto.choose_file';text.textContent=tr('common:auto.choose_file');
      picker.append(input,text);document.body.appendChild(picker);
    `);
    await settle();
    equal(await execute(`return __viewportColdHost.empty&&__viewportColdHost.key==='viewport-terminal'&&__viewportColdHost.mounted`), true, 'production cold entry mounts an empty escaped toolbar host synchronously');
    for (const width of [1200,390]) for (const theme of ['light','dark']) for (const language of ['zh-CN','en-US']) {
      const prefix = `${width}-${language}-${theme}`;
      const group = { width, theme, language, states: [] };
      groups.push(group);
      browser.setContentSize(width, 844);
      await execute(`applyTheme('${theme}');await setTermaLanguage('${language}');activateTab('viewport-terminal');if(isMobileLayout())window.termaWorkspaceShell.showMobileWorkspace();syncViewportHeight();`);
      await settle();
      await execute(`window.__viewportSession.term.scrollToLine(90)`);
      await delay(80);
      const restored = await execute(`
        const key=__viewportSession.key,view=window.termaTerminalEngineView.terminalViewForKey(key),surface=window.termaTerminalState.terminalSurfaceCache.get(key);
        const toolbar=document.querySelector('.terminal-toolbar[data-workspace-tab-key="'+key+'"]'),actions=toolbar.querySelector('.terminal-actions');
        const count=document.querySelectorAll('.terminal-toolbar[data-workspace-tab-key="'+key+'"]').length;
        window.termaTerminalSurface.park(view);view.replaceChildren();
        window.termaTerminalPage.openTerminalConnection(__viewportSession.connection,false,key,'Viewport fixture');
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const current=document.querySelector('.terminal-toolbar[data-workspace-tab-key="'+key+'"]');
        return {surface:window.termaTerminalState.terminalSurfaceCache.get(key)===surface&&view.firstElementChild===surface,
          toolbar:current===toolbar&&current.querySelector('.terminal-actions')===actions,
          unique:count===1&&document.querySelectorAll('.terminal-toolbar[data-workspace-tab-key="'+key+'"]').length===1,
          mounted:termaTerminalToolbar.isMounted(key)&&current.checkVisibility(),
          translated:current.querySelector('.terminal-session-badge').textContent===tr('terminal:toolbar.shell_normal')};
      `);
      for (const [field,value] of Object.entries(restored)) equal(value, true, `${prefix} cached entry retains ${field}`);
      await settle();
      let state = await inspect();
      for (const field of ['sameEngine','oneEngine','fits','noOverflow','toolbarVisible','pixelAligned']) equal(state[field], true, `${prefix} ${field}`);
      const focus = await execute(`
        const probe=document.createElement('input');probe.style.cssText='position:fixed;left:0;bottom:0;width:20px';
        document.body.appendChild(probe);probe.focus();window.termaTerminalPage.focusTerminalSession(__viewportSession.key);
        await new Promise(resolve=>setTimeout(resolve,20));
        const layoutFocus=isMobileLayout()?document.activeElement===probe:document.activeElement===__viewportSession.term.textarea;
        const modal=document.getElementById('modal'),hidden=modal.hidden;
        modal.hidden=false;probe.focus();window.termaTerminalPage.focusTerminalSession(__viewportSession.key);
        await new Promise(resolve=>setTimeout(resolve,20));
        const modalFocus=document.activeElement===probe;
        modal.hidden=hidden;probe.remove();window.termaTerminalPage.focusTerminalSession(__viewportSession.key);
        return {layoutFocus,modalFocus};
      `);
      equal(focus.layoutFocus, true, `${prefix} deferred focus respects the active layout`);
      equal(focus.modalFocus, true, `${prefix} modal focus survives terminal focus requests`);
      await capture(prefix+'-focus');
      equal(state.viewportY, 90, `${prefix} starts in scrollback`);
      equal(state.pending.timers, 0, `${prefix} layout timers finish`);
      group.states.push({ name: 'scrollback', ...state });
      await capture(`${prefix}-scrollback`);
      const touchScroll = await execute(`
        const session=window.__viewportSession,box=session.term.element.closest('.terminal-box');
        const before=session.term.buffer.active.viewportY;
        const cellHeight=session.term._core._renderService.dimensions.css.cell.height;
        const dispatch=(type,y)=>{
          const event=new Event(type,{bubbles:true,cancelable:true});
          Object.defineProperty(event,'touches',{value:[{clientY:y}]});
          box.dispatchEvent(event);
          return event.defaultPrevented;
        };
        dispatch('touchstart',100);
        const prevented=dispatch('touchmove',100+cellHeight*2.5);
        const after=session.term.buffer.active.viewportY;
        return {before,after,prevented,cellHeight};
      `);
      equal(touchScroll.prevented, true, `${prefix} touch scroll consumes whole-line movement`);
      equal(Math.abs(touchScroll.before-touchScroll.after), 2, `${prefix} touch scroll moves by measured xterm cell height`);
      group.states.push({ name: 'touch-scroll', ...touchScroll });
      await settle();
      await capture(`${prefix}-touch-scrolled`);
      await execute(`window.__viewportSession.term.scrollToLine(90);`);
      await settle();
      const persistentWheel = await execute(`
        const session=window.__viewportSession,tab=workspaceTabByKey(session.key);
        window.__viewportMode={sessionMode:tab.sessionMode,persistentSessionId:tab.persistentSessionId};
        Object.assign(tab,{sessionMode:'persistent',persistentSessionId:'viewport-fixture'});
        window.termaTerminalToolbar?.refresh(session.key);
        const before=session.term.buffer.active.viewportY;
        const event=new WheelEvent('wheel',{deltaY:56,bubbles:true,cancelable:true});
        session.term.element.querySelector('.xterm-screen').dispatchEvent(event);
        return {before,after:session.term.buffer.active.viewportY,prevented:event.defaultPrevented};
      `);
      equal(persistentWheel.prevented, true, `${prefix} persistent wheel prevents native terminal scrolling`);
      equal(persistentWheel.after-persistentWheel.before, 2, `${prefix} persistent wheel moves exactly two lines`);
      group.states.push({name:'persistent-wheel',...persistentWheel});
      await settle();
      await capture(`${prefix}-persistent-wheel`);
      const normalWheel = await execute(`
        const session=window.__viewportSession;
        workspaceTabByKey(session.key).sessionMode='none';
        const before=session.term.buffer.active.viewportY;
        const event=new WheelEvent('wheel',{deltaY:56,bubbles:true,cancelable:true});
        session.term.element.closest('.terminal-box').dispatchEvent(event);
        return {before,after:session.term.buffer.active.viewportY,prevented:event.defaultPrevented};
      `);
      equal(normalWheel.prevented, false, `${prefix} switching to normal mode restores native wheel handling`);
      equal(normalWheel.after, normalWheel.before, `${prefix} normal wheel does not run the persistent scroll policy`);
      await execute(`
        const session=window.__viewportSession;
        Object.assign(workspaceTabByKey(session.key),window.__viewportMode);
        window.termaTerminalToolbar?.refresh(session.key);session.term.scrollToLine(90);
      `);
      await settle();
      await execute(`
        window.__viewportSettingsBefore=window.termaTerminalSettings.current();
        const session=window.__viewportSession;
        session.connection.terminal_font_family_inherit=1;
        session.connection.terminal_font_size_inherit=1;
        session.connection.terminal_mobile_font_size_inherit=1;
        terminalGlobalSettings=window.termaTerminalSettingsModel.normalize({...window.termaTerminalSettings.current(),font_size:16,scrollback_lines:8000});
        window.termaTerminalSettings.applyAll();
      `);
      await settle();
      state = await inspect();
      equal(await execute('return window.__viewportSession.term.options.fontSize'), 16, `${prefix} global settings apply inherited font size to the real engine`);
      equal(await execute(`return document.querySelector('.terminal-toolbar[data-workspace-tab-key="viewport-terminal"] .terminal-font-size-readout').textContent`), '16px', `${prefix} global settings refresh the Vue font readout`);
      equal(await execute('return window.__viewportSession.term.options.scrollback'), 8000, `${prefix} global settings apply scrollback to the real engine`);
      equal(state.viewportY, 90, `${prefix} global settings preserve scrollback position`);
      equal(state.sameEngine && state.oneEngine && state.fits && state.pixelAligned, true, `${prefix} global settings retain one fitted and aligned engine`);
      await capture(`${prefix}-settings-applied`);
      await execute(`
        terminalGlobalSettings=window.termaTerminalSettingsModel.normalize({...window.termaTerminalSettings.current(),background_mode:'custom',background_color:'#808080',word_separators:'-_'});
        window.termaTerminalSettings.applyAll();
      `);
      await settle();
      state = await inspect();
      equal(await execute(`return window.__viewportSession.term.options.theme.background`), '#808080', `${prefix} model applies the custom background to the real engine`);
      equal(await execute(`return window.__viewportSession.term.options.wordSeparator`), '-_', `${prefix} model applies the selected word separators`);
      equal(await execute(`const colors=window.__viewportSession.term.options.theme;return ['foreground','red','green','blue','cyan'].every(name=>window.termaTerminalSettingsModel.contrast(colors[name],colors.background)>=4.5)`), true, `${prefix} real engine uses readable model colors`);
      equal(state.viewportY === 90 && state.sameEngine && state.oneEngine && state.fits && state.pixelAligned, true, `${prefix} model theme application keeps the engine and scrollback`);
      await capture(`${prefix}-model-theme-applied`);
      await execute(`
        terminalGlobalSettings=window.__viewportSettingsBefore;
        window.termaTerminalSettings.applyAll();
        const session=window.__viewportSession;
        session.connection.terminal_font_family_inherit=0;
        session.connection.terminal_font_size_inherit=0;
        session.connection.terminal_mobile_font_size_inherit=0;
      `);
      await settle();
      await execute(`await window.termaTerminalPreferences.apply('viewport-terminal',990018,{
        terminal_font_size:15,terminal_font_size_inherit:0,
        terminal_mobile_font_size:16,terminal_mobile_font_size_inherit:0,
        terminal_line_height:1.2,terminal_font_weight:'500'
      });`);
      await settle();
      state = await inspect();
      equal(await execute('return window.__viewportSession.term.options.fontSize'), width === 1200 ? 15 : 16, `${prefix} connection preference applies its layout font size`);
      equal(await execute(`return document.querySelector('.terminal-toolbar[data-workspace-tab-key="viewport-terminal"] .terminal-font-size-readout').textContent`), `${width === 1200 ? 15 : 16}px`, `${prefix} preferences refresh the Vue font readout`);
      equal(await execute('return window.__viewportSession.term.options.lineHeight'), 1.2, `${prefix} connection preference applies line height`);
      equal(state.viewportY, 90, `${prefix} connection preference preserves scrollback`);
      equal(state.sameEngine && state.oneEngine && state.fits && state.pixelAligned, true, `${prefix} connection preference keeps one fitted aligned engine`);
      await capture(`${prefix}-preferences-applied`);
      const alternate = language === 'zh-CN' ? 'en-US' : 'zh-CN';
      await execute(`window.__viewportSession.term.focus();await setTermaLanguage('${alternate}');`);
      await settle();
      state = await inspect();
      equal(state.viewportY, 90, `${prefix} live language preserves scrollback`);
      equal(state.pixelAligned, true, `${prefix} live language keeps pixel and buffer scrolling aligned`);
      equal(state.focused && state.fits && state.boxScrollTop === 0, true, `${prefix} live language preserves focus without scrolling the terminal shell`);
      equal(state.sameEngine, true, `${prefix} live language retains the engine`);
      equal(await execute(`return document.querySelector('#viewportPicker .file-picker-button').textContent===tr('common:auto.choose_file')`), true, `${prefix} file picker label translates live`);
      await capture(`${prefix}-live-language`);
      await execute(`await setTermaLanguage('${language}');`);
      await settle();
      if (width === 1200) {
        await dragTab(true);
        state = await inspect();
        equal(state.panes, 2, `${prefix} pointer splits the terminal`);
        equal(state.viewportY, 90, `${prefix} split preserves scrollback`);
        equal(state.pixelAligned, true, `${prefix} split keeps pixel and buffer scrolling aligned`);
        equal(state.sameEngine && state.fits, true, `${prefix} split retains a fitted engine`);
        await capture(`${prefix}-split`);
        await dragTab(false);
        state = await inspect();
        equal(state.panes, 1, `${prefix} pointer returns the terminal`);
        equal(state.viewportY, 90, `${prefix} returning from split preserves scrollback`);
        equal(state.pixelAligned, true, `${prefix} returning keeps pixel and buffer scrolling aligned`);
        equal(state.sameEngine && state.oneEngine && state.toolbarVisible, true, `${prefix} returning has one live engine and toolbar`);
        await capture(`${prefix}-returned`);
      }
      const fontBefore = await execute('return window.__viewportSession.term.options.fontSize');
      await click('.terminal-toolbar[data-workspace-tab-key="viewport-terminal"] .terminal-action-font:has(.lucide-plus)');
      await settle();
      equal(await execute('return window.__viewportSession.term.options.fontSize'), fontBefore + 1, `${prefix} actual font control works`);
      equal(await execute(`return document.querySelector('.terminal-toolbar[data-workspace-tab-key="viewport-terminal"] .terminal-font-size-readout').textContent`), `${fontBefore + 1}px`, `${prefix} font control refreshes the Vue readout`);
      equal((await inspect()).viewportY, 90, `${prefix} font adjustment preserves scrollback`);
      await capture(`${prefix}-font`);
      const fontWheel = await execute(`
        const session=window.__viewportSession,box=session.term.element.closest('.terminal-box');
        const event=new WheelEvent('wheel',{deltaY:-100,ctrlKey:true,bubbles:true,cancelable:true});
        box.dispatchEvent(event);
        return {prevented:event.defaultPrevented,before:session.term.options.fontSize};
      `);
      equal(fontWheel.prevented, true, `${prefix} Ctrl-wheel prevents terminal scroll`);
      await settle();
      equal(await execute('return window.__viewportSession.term.options.fontSize'), fontWheel.before + 1,
        `${prefix} Ctrl-wheel increases the live terminal font`);
      equal(await execute(`return document.querySelector('.terminal-toolbar[data-workspace-tab-key="viewport-terminal"] .terminal-font-size-readout').textContent`),
        `${fontWheel.before + 1}px`, `${prefix} Ctrl-wheel refreshes the Vue readout`);
      equal((await inspect()).viewportY, 90, `${prefix} Ctrl-wheel preserves scrollback`);
      await capture(`${prefix}-font-wheel`);
      await execute(`window.termaTerminalPage.changeTerminalFont('viewport-terminal',-2);`);
      await settle();
      equal(await execute('return window.__viewportSession.term.options.fontSize'), fontBefore,
        `${prefix} font-wheel scenario restores the baseline size`);
      await execute(`window.__viewportSession.term.scrollToBottom();`);
      await delay(80);
      equal((await inspect()).atBottom, true, `${prefix} reaches the live bottom before resizing`);
      browser.setContentSize(width, 690);
      await settle();
      state = await inspect();
      equal(state.atBottom, true, `${prefix} height shrink keeps the live bottom`);
      equal(state.fits, true, `${prefix} shorter window fits the terminal`);
      await capture(`${prefix}-short-bottom`);
      browser.setContentSize(width, 844);
      await settle();
      equal((await inspect()).atBottom, true, `${prefix} height growth keeps the live bottom`);
      await click('#viewportPicker .file-picker-button');
      const pickerState = await execute(`
        const deadline=performance.now()+1000;
        while(!window.termaViewport.getSnapshot().nativeFileDialogPending) {
          if(performance.now()>deadline)throw Error('Pointer click did not enter native picker pending state');
          await new Promise(resolve=>requestAnimationFrame(resolve));
        }
        document.documentElement.style.setProperty('--app-height','320px');syncViewportHeight();
        return {height:document.documentElement.style.getPropertyValue('--app-height'),
          pending:window.termaViewport.getSnapshot().nativeFileDialogPending};`);
      equal(pickerState.height, '320px', `${prefix} native picker freezes automatic height`);
      equal(pickerState.pending, true, `${prefix} native picker click enters pending state`);
      await capture(`${prefix}-picker-pending`);
      await execute(`window.dispatchEvent(new Event('focus'));`);
      await settle();
      state = await inspect();
      equal(state.viewport.nativeFileDialogPending, false, `${prefix} cancelled picker recovers on focus return`);
      equal(state.appHeight >= 843 && state.fits && state.noOverflow, true, `${prefix} picker return restores the complete layout`);
      await capture(`${prefix}-picker-recovered`);
      await execute(`beginNativeFileDialogViewport();const transfer=new DataTransfer();transfer.items.add(new File(['synthetic'],'viewport.txt'));document.querySelector('#viewportFile').files=transfer.files;document.querySelector('#viewportFile').dispatchEvent(new Event('change',{bubbles:true}));`);
      await settle();
      equal((await inspect()).viewport.nativeFileDialogPending, false, `${prefix} native picker change recovers the layout`);
      group.states.push({ name: 'recovered', ...await inspect() });
      const scan = await execute(`
        const root=document.querySelector('.terminal-toolbar[data-workspace-tab-key="viewport-terminal"]');
        const fields=[root.textContent,...[...root.querySelectorAll('*')].flatMap(element=>['title','aria-label','placeholder'].map(name=>element.getAttribute(name)||''))];
        return document.documentElement.lang!=='en-US'||!fields.some(value=>/[\\u3400-\\u9fff]/.test(value));
      `);
      equal(scan, true, `${prefix} toolbar text and hidden attributes use the current language`);
      await execute(`
        const session=window.__viewportSession;
        session.term.scrollToLine(90);
        window.__interactionSent=[];window.__interactionOpened=[];window.__interactionCopied=[];
        window.__interactionOriginal={send:session.socket?.send,socket:session.socket,open:window.open,copy:copyText};
        session.socket={readyState:WebSocket.OPEN,send:text=>__interactionSent.push({key:session.key,text})};
        window.open=url=>__interactionOpened.push(url);
        copyText=async text=>{__interactionCopied.push(text);return true};
        window.__interactionSettings=terminalGlobalSettings;
        terminalGlobalSettings=window.termaTerminalSettingsModel.normalize({...window.termaTerminalSettings.current(),right_mouse_action:'send_enter',middle_mouse_action:'send_enter'});
        window.termaTerminalCursorCopy.start(session.key);
      `);
      await delay(100);
      const hintState = await execute(`
        const hint=document.querySelector('.terminal-cursor-copy-hint'),button=hint.querySelector('button');
        const r=hint.getBoundingClientRect(),b=button.getBoundingClientRect();
        return {visible:hint.checkVisibility(),fits:r.left>=0&&r.right<=innerWidth&&b.left>=r.left&&b.right<=r.right,
          flat:getComputedStyle(hint).boxShadow==='none',start:__viewportSession.cursorCopyState.phase==='start',
          text:hint.textContent,translated:hint.textContent.includes(tr('terminal:settings.cursor_copy_start'))};
      `);
      for (const field of ['visible','fits','flat','start','translated']) equal(hintState[field], true, `${prefix} cursor copy ${field}`);
      await capture(`${prefix}-cursor-copy-start`);
      const points = await execute(`
        const screen=__viewportSession.term.element.querySelector('.xterm-screen').getBoundingClientRect();
        const cell=__viewportSession.term._core._renderService.dimensions.css.cell;
        return [{x:Math.round(screen.left+cell.width*.5),y:Math.round(screen.top+cell.height*5.5)},
          {x:Math.round(screen.left+cell.width*5.5),y:Math.round(screen.top+cell.height*5.5)}];
      `);
      await pointer(points[0], points[0]);
      equal(await execute(`return __viewportSession.cursorCopyState?.phase`), 'end', `${prefix} real pointer stores the selection start`);
      await capture(`${prefix}-cursor-copy-end`);
      await execute(`
        window.__copyStateBefore=__viewportSession.cursorCopyState;
        window.__copySelectionBefore=__viewportSession.term.getSelection();
        window.__copyScrollBefore=__viewportSession.term.buffer.active.viewportY;
        document.querySelector('.terminal-cursor-copy-cancel').focus();
        await setTermaLanguage('${language === 'zh-CN' ? 'en-US' : 'zh-CN'}');
        applyTheme('${theme === 'light' ? 'dark' : 'light'}');
      `);
      await delay(150);
      equal(await execute(`
        const hint=document.querySelector('.terminal-cursor-copy-hint');
        return __viewportSession.cursorCopyState===__copyStateBefore&&__viewportSession.term.getSelection()===__copySelectionBefore
          &&__viewportSession.term.buffer.active.viewportY===__copyScrollBefore&&document.activeElement===hint.querySelector('button')
          &&hint.textContent.includes(tr('terminal:settings.cursor_copy_end'))
          &&hint.querySelector('button').getAttribute('aria-label')===tr('terminal:settings.cursor_copy_cancel')
          &&hint.title===tr('terminal:settings.cursor_copy_touch_hint');
      `), true, `${prefix} cursor copy live locale keeps phase selection focus and scroll`);
      equal(await execute(`
        const hint=document.querySelector('.terminal-cursor-copy-hint');
        return document.documentElement.lang!=='en-US'||![hint.textContent,...[...hint.querySelectorAll('*')].flatMap(el=>[el.title,el.getAttribute('aria-label'),el.placeholder])].some(value=>/[\\u3400-\\u9fff]/.test(value||''));
      `), true, `${prefix} cursor copy translates visible and hidden attributes`);
      await capture(`${prefix}-cursor-copy-live-language`);
      await pointer(points[1], points[1]);
      await delay(100);
      equal(await execute(`return __interactionCopied.length===1&&__interactionCopied[0]==='row-00'&&!__viewportSession.cursorCopyState&&!document.querySelector('.terminal-cursor-copy-hint')`),
        true, `${prefix} real pointer finishes copying the inclusive range and releases the overlay`);
      await execute(`window.termaTerminalCursorCopy.start('viewport-terminal')`);
      await click('.terminal-cursor-copy-cancel');
      equal(await execute(`return !__viewportSession.cursorCopyState&&!document.querySelector('.terminal-cursor-copy-hint')`), true, `${prefix} real pointer cancel releases the overlay`);
      await execute(`window.termaTerminalCursorCopy.start('viewport-terminal')`);
      browser.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
      browser.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
      await delay(80);
      equal(await execute(`return !__viewportSession.cursorCopyState`), true, `${prefix} Escape releases cursor copying`);
      await execute(`
        applyTheme('${theme}');await setTermaLanguage('${language}');
        __interactionSent.length=0;
      `);
      browser.webContents.sendInputEvent({type:'mouseDown',button:'middle',clickCount:1,...points[0]});
      browser.webContents.sendInputEvent({type:'mouseUp',button:'middle',clickCount:1,...points[0]});
      await delay(80);
      equal(await execute(`return __interactionSent.length===1&&__interactionSent[0].key==='viewport-terminal'&&__interactionSent[0].text==='\\r'`),
        true, `${prefix} real middle click dispatches one configured action`);
      await execute(`
        copyText=()=>new Promise(resolve=>window.__resolveInteractionCopy=resolve);
        window.termaTerminalCursorCopy.start('viewport-terminal');
      `);
      await pointer(points[0], points[0]);
      await pointer(points[1], points[1]);
      equal(await execute(`return typeof __resolveInteractionCopy==='function'`), true, `${prefix} clipboard write can remain pending`);
      await execute(`
        window.termaTerminalCursorCopy.start('viewport-terminal');
        window.__replacementCopyState=__viewportSession.cursorCopyState;
        __resolveInteractionCopy(true);await Promise.resolve();await Promise.resolve();
      `);
      equal(await execute(`return __viewportSession.cursorCopyState===__replacementCopyState&&!!document.querySelector('.terminal-cursor-copy-hint')`),
        true, `${prefix} delayed clipboard completion preserves a replacement cursor selection`);
      await capture(`${prefix}-cursor-copy-pending-replaced`);
      await click('.terminal-cursor-copy-cancel');
      await execute(`
        await new Promise(resolve=>__viewportSession.term.write('\\r\\n中 https://example.test/a',resolve));
        __viewportSession.term.scrollToBottom();
        window.__interactionLine=__viewportSession.term.buffer.active.baseY+__viewportSession.term.buffer.active.cursorY+1;
      `);
      await delay(150);
      equal(await execute(`
        const links=window.termaTerminalInteraction.links(__viewportSession,__interactionLine);
        return links?.length===1&&links[0].text==='https://example.test/a'&&links[0].range.start.x===4;
      `), true, `${prefix} links after wide characters use the real xterm cell column`);
      const linkPoint = await execute(`
        const r=__viewportSession.term.element.querySelector('.xterm-screen').getBoundingClientRect();
        const cell=__viewportSession.term._core._renderService.dimensions.css.cell;
        return {x:Math.round(r.left+cell.width*7.5),y:Math.round(r.top+cell.height*(__viewportSession.term.buffer.active.cursorY+.5))};
      `);
      browser.webContents.sendInputEvent({type:'mouseMove',...linkPoint});
      await delay(250);
      equal(await execute(`return !!__viewportSession.terminalLinkHovered`), true, `${prefix} real pointer enters the xterm link`);
      await capture(`${prefix}-link-hover`);
      browser.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,modifiers:['control'],...linkPoint});
      browser.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,modifiers:['control'],...linkPoint});
      await delay(100);
      equal(await execute(`return __interactionOpened.length===1&&__interactionOpened[0]==='https://example.test/a'`),
        true, `${prefix} real modified click opens the link through the bounded host port`);
      await execute(`
        terminalGlobalSettings=__interactionSettings;
        window.__viewportSession.socket=__interactionOriginal.socket;
        window.open=__interactionOriginal.open;
        copyText=__interactionOriginal.copy;
        window.termaTerminalSettings.applyAll();
      `);
    }
    await execute(`window.termaTerminalCursorCopy.start('viewport-terminal');`);
    const lateAttach = await execute(`
      const settings=window.termaTerminalSettings,libraries=window.termaTerminalLibraries;
      const original={ensure:settings.ensure,term:libraries.terminal};
      let resume,created=0;
      settings.ensure=()=>new Promise(resolve=>resume=resolve);
      libraries.terminal=options=>{created++;return original.term(options)};
      const key='viewport-late-close';
      try{
        window.termaTerminalPage.openTerminalConnection(__viewportSession.connection,true,key,'Late close fixture');
        closeTabsByKey([key]);
        resume();await new Promise(resolve=>setTimeout(resolve,40));
        return {created,session:window.termaTerminalState.terminalSessions.has(key),surface:window.termaTerminalState.terminalSurfaceCache.has(key)};
      }finally{settings.ensure=original.ensure;libraries.terminal=original.term;activateTab(__viewportSession.key);}
    `);
    equal(lateAttach.created, 0, 'a terminal closed during dependency loading never constructs xterm');
    equal(lateAttach.session || lateAttach.surface, false, 'a terminal closed during loading leaves no session or cached surface');
    await execute(`window.termaTerminalViewport.schedule({force:true});window.termaWorkspaceTabRuntime.cleanup(new Map([['viewport-terminal',{key:'viewport-terminal',kind:"terminal"}]]));`);
    equal(await execute(`return !document.querySelector('.terminal-cursor-copy-hint')&&!__viewportSession.globalBehaviorBound&&!__viewportSession.globalLinkDisposable&&!__viewportSession.globalSelectionDisposable`),
      true, 'closing the terminal releases the interaction provider, selection listener and Vue cursor overlay');
    equal(await execute('return window.termaTerminalViewport.getSnapshot().pendingSessions'), 0, 'closing the terminal releases scheduled anchors');
    await execute('window.termaViewport.dispose()');
    equal(await execute('return window.termaTerminalViewport.getSnapshot().timers'), 0, 'disposing viewport listeners cancels delayed fits');
    equal(await execute('return window.termaViewport.getSnapshot().bound'), false, 'viewport listeners are released');
    await execute('bindNativeFileDialogViewportRecovery()');
    equal(await execute('return window.termaViewport.getSnapshot().bound'), true, 'viewport listeners can rebind');
    equal(await execute('return window.__viewportWrites.length'), 8, 'the eight preference writes stay within the synthetic API fixture');
    const report = { groups, checks, screenshots };
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    return `Terminal viewport browser matrix passed: ${groups.length} groups, ${checks} checks, ${screenshots.length} screenshots`;
  } catch (error) {
    await capture('failure');
    fs.writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ groups, checks, error: error.stack, state: await inspect().catch(() => null) }, null, 2));
    throw error;
  } finally {
    await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false });
    if (ownsDebugger) browser.webContents.debugger.detach();
  }
}

module.exports = { runTerminalViewportUiScenario };
