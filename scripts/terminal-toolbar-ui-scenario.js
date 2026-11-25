const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Disposable Chromium browser: production toolbar/model, synthetic sessions, no SSH.
async function runTerminalToolbarUiScenario(browser, options = {}) {
  const directory = path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR || path.join(process.cwd(), 'data'), 'terminal-toolbar-visual', options.viewport || 'current');
  fs.mkdirSync(directory, {recursive:true});
  const execute = async source => {
    try { return await browser.webContents.executeJavaScript(`(async()=>{${source}})()`); }
    catch (error) { console.error('[terminal-toolbar execute failed]', source, error); throw error; }
  };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const states = [], checks = [], screenshotContexts = [];
  const menuLanguageKeys = {
    encoding: [], font: ['terminal:display.system_font', 'terminal:display.custom_font', 'terminal:display.reset'],
    session: ['terminal:session.reconnect', 'terminal:session.terminate_short'],
    x11: ['terminal:x11_menu.launch_app', 'terminal:x11_menu.default_untrusted']
  };
  const shot = async name => {
    await delay(90); browser.webContents.invalidate();
    const image = await browser.webContents.capturePage();
    fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
    states.push(name);
    screenshotContexts.push({name,...await execute(`return {language:document.documentElement.lang,theme:document.documentElement.dataset.theme};`)});
  };
  const check = async (name, expression) => {
    const result = await execute(`return (${expression});`);
    checks.push({name,result});
    if (!result) {
      console.log('[terminal-toolbar] last pointer target',await execute(`return window.__toolbarLastClick||null;`));
      console.log('[terminal-toolbar] key refresh',await execute(`return window.__keysRefreshResult||null;`));
      console.log('[terminal-toolbar] mobile layout metrics',JSON.stringify(await execute(`return window.__mobileToolbarMetrics||null;`)));
      console.log('[terminal-toolbar] menu item bounds',JSON.stringify(await execute(`return [...document.querySelectorAll('#actionMenu [data-terminal-display-action]')].map(item=>({key:item.dataset.terminalDisplayAction,rect:item.getBoundingClientRect().toJSON(),children:[...item.children].map(child=>({tag:child.tagName,className:child.getAttribute('class'),text:child.textContent,rect:child.getBoundingClientRect().toJSON()}))}));`)));
      console.log('[terminal-toolbar] failed check',name,await execute(`const el=document.querySelector('#toolbarFixture .terminal-ai-button'),t=document.querySelector('.terminal-toolbar[data-workspace-tab-key="'+__toolbarKey+'"]');return {fixture:!!document.querySelector('#toolbarFixture'),mounted:window.termaTerminalToolbar?.isMounted(__toolbarKey),keysMounted:window.termaTerminalKeys?.isMounted(__toolbarKey),keys:document.querySelector('#toolbarFixture .terminal-keys')?.outerHTML,target:t&&{connected:t.isConnected,parent:t.parentElement?.className,actions:!!t.querySelector('.terminal-actions')},actionMenu:document.querySelector('#actionMenu')?.innerText||null,notices:document.querySelectorAll('.toast').length,hover:el?.matches(':hover'),focused:document.activeElement===el,viewport:{width:innerWidth,height:innerHeight}};`));
      await shot('failure');
    }
    assert.equal(result, true, name);
  };
  const click = async selector => {
    const point = await execute(`const el=document.querySelector(${JSON.stringify(selector)});if(!el?.checkVisibility())throw Error('Missing '+${JSON.stringify(selector)});el.scrollIntoView({block:'nearest',inline:'center',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=el.getBoundingClientRect(),point={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)},hit=document.elementFromPoint(point.x,point.y);if(hit!==el&&!el.contains(hit))throw Error('Click target is covered '+${JSON.stringify(selector)}+' '+JSON.stringify({point,hit:hit?.className}));window.__toolbarLastClick={selector: ${JSON.stringify(selector)},point,scrollLeft:el.closest('.terminal-actions')?.scrollLeft,hit:hit?.closest('button')?.className};return point;`);
    for (const type of ['mouseMove','mouseDown','mouseUp']) {
      browser.webContents.sendInputEvent({type,...point,button:'left',clickCount:1}); await delay(15);
    }
    await delay(60);
  };
  const movePointerTo = async selector => {
    const point = await execute(`const el=document.querySelector(${JSON.stringify(selector)});if(!el?.checkVisibility())throw Error('Missing '+${JSON.stringify(selector)});el.scrollIntoView({block:'nearest',inline:'center',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};`);
    browser.webContents.sendInputEvent({type:'mouseMove',...point});
    await delay(60);
  };
  const key = async keyCode => {
    for (const type of ['keyDown','keyUp']) browser.webContents.sendInputEvent({type,keyCode});
    await delay(50);
  };
  const layout = async (name, selector='#toolbarFixture') => {
    const result = await execute(`
      const root=document.querySelector(${JSON.stringify(selector)});
      const toolbar=root?.querySelector('.terminal-toolbar');
      if(!root||!toolbar)return {setupError:!root?'fixture root missing':root.innerHTML};
      const r=root.getBoundingClientRect(),actions=root.querySelector('.terminal-actions');
      const buttons=[...toolbar.querySelectorAll('button')];
      const model=window.termaTerminalToolbarService?.model(toolbar.dataset.workspaceTabKey);
      const badge=toolbar.querySelector('.terminal-session-badge,.terminal-quick-badge');
      const chrome=[toolbar.textContent,...[...toolbar.querySelectorAll('*')].flatMap(el=>[el.title,el.getAttribute('aria-label')])].join(' ');
      const overlaps=buttons.filter(el=>{if(!el.checkVisibility())return false;const b=el.getBoundingClientRect();return [...el.querySelectorAll('svg,span')].filter(n=>n.checkVisibility()).some(n=>{const q=n.getBoundingClientRect();return q.left<b.left-1||q.right>b.right+1||q.top<b.top-1||q.bottom>b.bottom+1});}).map(el=>el.className);
      return {setupError:null,fits:r.left>=0&&r.right<=innerWidth+1&&toolbar.getBoundingClientRect().right<=r.right+1,
        tile:buttons.every(el=>el.hasAttribute('data-terma-button')),
        scoped:toolbar.classList.contains('terma-vue-root')&&toolbar.dataset.theme===document.documentElement.dataset.theme,
        noInline:![...toolbar.querySelectorAll('*')].some(el=>[...el.attributes].some(a=>/^on/.test(a.name))),
        translated:document.documentElement.lang!=='en-US'||!/[\\u3400-\\u9fff]/.test(chrome),
        modelMatches:!!model&&badge?.textContent===(model.quick?model.temporaryLabel:model.shellLabel)
          &&toolbar.querySelector('#terminalStatus')?.title===model.statusTitle
          &&toolbar.querySelector('.terminal-action-reconnect')?.title===model.reconnectTitle,
        currentShellLanguage:!!model&&(model.quick?model.temporaryLabel===tr('terminal:toolbar.temporary'):model.shellLabel===tr('terminal:toolbar.shell_'+model.shellMode)),
        contentFits:!overlaps.length,overlaps,scrollBinding:termaTerminalToolbarScroll.has(actions)};
    `);
    checks.push({name,...result});
    for (const [field,value] of Object.entries(result)) if(typeof value==='boolean') {
      if(!value) await shot('failure');
      assert.equal(value,true,`${name}: ${field} ${JSON.stringify(result.overlaps)}`);
    }
  };
  const checkKeys = async (prefix, width, theme, language) => {
    await execute(`
      window.__keysSaved={settings:terminalGlobalSettings,send:window.termaTerminalState.terminalSessions.get(__toolbarKey).socket.send};
      window.__keysSent=[];
      terminalGlobalSettings=window.termaTerminalSettingsModel.normalize({...window.termaTerminalSettings.current(),shortcut_keys:[
        {key:'C'},{key:'F5',ctrl:true},{key:'Up'},{key:'Left'},{key:'Down'},{key:'Right'},
        {key:'B',enabled:false},{key:'F6',label:'<b>Keys</b>'}
      ]});
      window.termaTerminalState.terminalSessions.get(__toolbarKey).term.modes={applicationCursorKeysMode:true};
      window.termaTerminalState.terminalSessions.get(__toolbarKey).socket.send=data=>__keysSent.push({key:__toolbarKey,data});
      window.termaTerminalKeys.refresh(__toolbarKey);
    `);
    const keyClick = async selector => {
      if (width<=760) await click('#toolbarFixture '+selector);
      else { await execute(`document.querySelector(${JSON.stringify('#toolbarFixture '+selector)}).click();`); await delay(50); }
    };
    try {
      await check(`${prefix} typed keys render literal labels and original indices`, `(()=>{const row=document.querySelector('#toolbarFixture .terminal-keys');return row.querySelectorAll('[data-shortcut-index]').length===7&&!row.querySelector('[data-shortcut-index="6"]')&&row.querySelector('[data-shortcut-index="7"]').textContent==='<b>Keys</b>'&&!row.querySelector('b')&&row.querySelector('.terminal-arrow-pad').querySelectorAll('button').length===4&&[...row.querySelectorAll('button')].every(button=>button.hasAttribute('data-terma-button')&&![...button.attributes].some(attribute=>/^on/.test(attribute.name)))})()`);
      await keyClick('.terminal-key-ctrl-once');
      await check(`${prefix} typed Ctrl once arms through the view`, `terminalCtrlArmed&&!terminalCtrlLocked&&document.querySelector('#toolbarFixture .terminal-key-ctrl-once').getAttribute('aria-pressed')==='true'`);
      if(width<=760) await shot(`${prefix}-keys-ctrl-once`);
      await keyClick('[data-shortcut-index="0"]');
      await check(`${prefix} typed shortcut consumes Ctrl once in the requested pane`, `__keysSent.length===1&&__keysSent[0].key===__toolbarKey&&__keysSent[0].data==='\\x03'&&!terminalCtrlArmed`);
      await keyClick('.terminal-key-ctrl-lock');
      await keyClick('[data-shortcut-index="0"]');
      await keyClick('[data-shortcut-index="0"]');
      await check(`${prefix} typed Ctrl lock persists across sends`, `terminalCtrlLocked&&!terminalCtrlArmed&&__keysSent.length===3&&__keysSent.every(frame=>frame.key===__toolbarKey&&frame.data==='\\x03')&&document.querySelector('#toolbarFixture .terminal-key-ctrl-lock').getAttribute('aria-pressed')==='true'`);
      await execute(`const row=document.querySelector('#toolbarFixture .terminal-keys');row.scrollLeft=Math.min(80,Math.max(0,row.scrollWidth-row.clientWidth));window.__keysRow=row;window.__keysScroll=row.scrollLeft;window.__keysNode=row.querySelector('[data-shortcut-index="0"]');window.__keysLock=row.querySelector('.terminal-key-ctrl-lock');__keysLock.focus({preventScroll:true});window.__keysFocus=document.activeElement;await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});applyTheme('${theme==='light'?'dark':'light'}');`);
      await delay(100);
      await check(`${prefix} typed keys live locale retains nodes state focus and scroll`, `Object.values(window.__keysRefreshResult={
        host:document.querySelector('#toolbarFixture .terminal-keys')===__keysRow,
        shortcut:__keysRow.querySelector('[data-shortcut-index="0"]')===__keysNode,
        lock:__keysRow.querySelector('.terminal-key-ctrl-lock')===__keysLock,
        focus:document.activeElement===__keysFocus,state:terminalCtrlLocked,
        scroll:Math.abs(__keysRow.scrollLeft-Math.min(__keysScroll,Math.max(0,__keysRow.scrollWidth-__keysRow.clientWidth)))<=1,
        label:__keysLock.textContent.trim()===tr('terminal:keys.ctrl_lock'),
        theme:__keysRow.dataset.theme==='${theme==='light'?'dark':'light'}'
      }).every(value=>value)`);
      await check(`${prefix} typed keys translate visible and hidden attributes`, `(()=>{if(document.documentElement.lang!=='en-US')return true;const texts=[...__keysRow.querySelectorAll('*')].flatMap(el=>[el.textContent,el.title,el.getAttribute('aria-label')]);return !/[\\u3400-\\u9fff]/.test(texts.join(' '))})()`);
      await layout(`${prefix} combined locale and theme match the typed toolbar model`);
      if(width<=760) {
        await execute(`__keysLock.scrollIntoView({block:'nearest',inline:'end',behavior:'instant'});`);
      }
      await shot(`${prefix}-keys-locked-live-locale`);
      await execute(`applyTheme('${theme}');await setTermaLanguage('${language}',{render:false});`);
      await keyClick('.terminal-key-ctrl-lock');
      await keyClick('[data-shortcut-index="2"]');
      await check(`${prefix} typed arrows use application cursor mode`, `!terminalCtrlLocked&&__keysSent.at(-1).key===__toolbarKey&&__keysSent.at(-1).data==='\\x1bOA'`);
      await execute(`window.termaTerminalState.terminalSessions.get(__toolbarKey).term.modes.applicationCursorKeysMode=false;window.termaTerminalKeysService.sendShortcut(__toolbarKey,2);window.termaTerminalKeysService.sendShortcut(__toolbarKey,6);window.termaTerminalKeysService.sendShortcut(__toolbarKey,999);`);
      await check(`${prefix} compatibility sends use normal mode and reject disabled indices`, `__keysSent.length===5&&__keysSent.at(-1).data==='\\x1b[A'&&__keysSent.every(frame=>frame.key===__toolbarKey)`);
    } finally {
      await execute(`terminalGlobalSettings=__keysSaved.settings;window.termaTerminalState.terminalSessions.get(__toolbarKey).socket.send=__keysSaved.send;terminalCtrlArmed=false;terminalCtrlLocked=false;delete window.termaTerminalState.terminalSessions.get(__toolbarKey).term.modes;applyTheme('${theme}');await setTermaLanguage('${language}',{render:false});window.termaTerminalKeys.refresh(__toolbarKey);delete window.__keysSaved;`);
    }
  };
  await execute(`
    await window.termaI18nReady;while(window.workspaceRestorePending||window.termaWorkspaceRefresh.loading)await new Promise(r=>setTimeout(r,20));
    window.termaWorkspaceRefresh.stop();window.restoringTabs=true;
    window.termaNotificationToasts?.dispose();
    window.__toolbarPreferenceWrites=[];window.__toolbarPreferenceFrames=[];window.__toolbarPreferenceNotices=[];
    window.__toolbarPreferenceMode='success';
    const originalApi=api;api=async(route,options={})=>{
      if (route === '/api/connections' && (!options.method || options.method === 'GET')) return [...connections.filter(row => row.id !== window.__toolbarConnection?.id), ...(window.__toolbarConnection ? [window.__toolbarConnection] : [])];
      if(route==='/api/connections/990001/terminal-preferences'&&options.method==='POST'){
        const body=JSON.parse(options.body);window.__toolbarPreferenceWrites.push(body);
        if(window.__toolbarPreferenceMode==='pending')await new Promise(resolve=>window.__toolbarPreferenceComplete=resolve);
        return {...__toolbarConnection,...body};
      }
      if(options.method&&options.method!=='GET')throw Error('Unexpected mutation '+route);return originalApi(route,options);
    };
    window.__toolbarCalls=[];notify=(...args)=>window.__toolbarPreferenceNotices.push(args);
    captureTerminalViewport=()=>null;fitTerminalPreservingViewport=()=>{};focusTerminalSession=()=>{};
    window.__toolbarScheduleSave=window.termaTerminalPreferences.schedule;window.termaTerminalPreferences.schedule=()=>{};
    window.__toolbarKey='terminal-toolbar-fixture';window.__quickKey='terminal-toolbar-quick';
    terminalKeysVisible=true;terminalCtrlArmed=false;terminalCtrlLocked=false;
    window.__toolbarConnection={id:990001,name:'Toolbar review',ssh_host:'server.example',ssh_user:'review',ssh_port:22,terminal_font_size:13,terminal_font_size_inherit:0,terminal_mobile_font_size:13,terminal_mobile_font_size_inherit:0,terminal_encoding:'utf8',terminal_session_mode:'persistent',terminal_session_id:'fixture-session',x11_mode:'trusted',forwards:[]};
    const currentSavedConnection=window.termaConnectionController.current;
    window.termaConnectionController.current=id=>Number(id)===__toolbarConnection.id?__toolbarConnection:currentSavedConnection(id);
    connections.push(__toolbarConnection);
    tabs.push({key:__toolbarKey,id:990001,kind:'terminal',title:'Toolbar review',sessionMode:'persistent',persistentSessionId:'fixture-session'});
    window.termaTerminalState.terminalSessions.set(__toolbarKey,{key:__toolbarKey,id:990001,connection:__toolbarConnection,connected:true,socket:{readyState:WebSocket.OPEN,send:value=>window.__toolbarPreferenceFrames.push(JSON.parse(value))},term:{options:{fontSize:13},focus(){},writeln(){}}});
    window.__oldWorkspaceLayout=workspaceLayout;window.__oldFocusedPaneId=focusedPaneId;
    window.__oldToolbarPlacement=window.termaRuntimeSettingsModel.snapshot?.saved?.workspace_toolbar_placement;
    window.termaRuntimeSettingsModel.snapshot.saved.workspace_toolbar_placement={unsplit:{terminal:'tab'},split:{terminal:'tab'}};
    window.__fixturePanes=[];
    window.__makeToolbarFixture=(id,key)=>{
      const root=document.createElement('section');root.id=id;root.className='terminal-toolbar-fixture';
      root.style.cssText='position:fixed;inset:0;box-sizing:border-box;z-index:30;padding:12px;background:var(--bg);display:flex;flex-direction:column;gap:10px;container-type:inline-size;container-name:terminal-view;';
      const paneId=id+'-pane';const pane=document.createElement('div');pane.className='workspace-pane';pane.dataset.paneId=paneId;pane.style.cssText='display:flex;flex-direction:column;min-height:0;gap:10px;';
      const workspace=document.createElement('div');workspace.className='workspace';workspace.style.cssText='display:flex;flex:1;min-height:0;flex-direction:column;gap:10px;';
      const tabs=document.createElement('div');tabs.className='tabs';tabs.style.display='none';
      const headerTools=document.createElement('div');headerTools.dataset.workspaceRole='header-tools';headerTools.style.cssText='display:flex;min-width:0;';
      const view=document.createElement('div');view.id='view-terminal';view.dataset.workspaceTabKey=key;view.style.cssText='display:flex;flex:1;min-height:0;flex-direction:column;gap:10px;';
      const mount=document.createElement('div');mount.id='terminalToolbarMount';mount.dataset.workspaceToolbarMount='terminal';mount.dataset.workspaceTabKey=key;
      const toolbar=document.createElement('div');toolbar.className='terminal-toolbar';toolbar.dataset.workspaceTabKey=key;toolbar.dataset.terminalTabKey=key;
      if(id==='toolbarFixture')toolbar.innerHTML='<div class="terminal-title-row"><span class="legacy-toolbar-label">旧工具栏标题</span></div><div class="actions terminal-actions"><button class="terminal-action-sftp">旧 SFTP 按钮</button></div>';
      const keys=document.createElement('div');keys.id='terminalKeys';keys.className='terminal-keys';keys.dataset.workspaceTabKey=key;keys.dataset.terminalTabKey=key;
      const surface=document.createElement('pre');surface.textContent='review@server.example:~$';surface.style.cssText='flex:1;margin:0;padding:12px;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:6px;';
      mount.append(toolbar);view.append(mount,keys,surface);workspace.append(view);pane.append(tabs,headerTools,workspace);root.append(pane);document.body.append(root);
      workspacePaneNodes.set(paneId,pane);window.__fixturePanes.push(paneId);
      const paneNode={type:'pane',id:paneId,tabs:[key],activeTabKey:key};
      if(!workspaceLayout||!workspaceLeaves().some(item=>window.__fixturePanes.includes(item.id)))workspaceLayout=paneNode;
      else {const existing=workspaceLayout;workspaceLayout={type:'split',id:id+'-split',direction:'horizontal',ratio:0.5,first:existing,second:paneNode};}
      focusedPaneId=paneId;window.termaTerminalToolbar.mount(key);window.termaTerminalKeys.mount(key);return root;
    };
    __makeToolbarFixture('toolbarFixture',__toolbarKey);
  `);
  await check('Vue mount replaces legacy toolbar without duplicating content', `(()=>{const toolbar=document.querySelector('#toolbarFixture .terminal-toolbar');return !!toolbar&&!toolbar.querySelector('.legacy-toolbar-label')&&toolbar.querySelectorAll('.terminal-title-row').length===1&&toolbar.querySelectorAll('.terminal-actions').length===1&&toolbar.querySelectorAll('.terminal-action-sftp').length===1&&[...toolbar.querySelectorAll('button')].every(button=>button.hasAttribute('data-terma-button'))})()`);
  await shot('legacy-toolbar-replaced');
  const width=await execute('return innerWidth;');
  for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']) {
    const prefix=`${language}-${theme}-${width}`;
    const expectedStatusColor=theme==='light'?'rgb(22, 130, 95)':'rgb(70, 194, 168)';
    await execute(`const fixture=document.querySelector('#toolbarFixture');fixture.style.width='${width}px';fixture.style.right='auto';hideActionMenu();closeModal();terminalKeysVisible=true;terminalCtrlArmed=false;terminalCtrlLocked=false;window.termaTerminalKeys.refresh(__toolbarKey);applyTheme('${theme}');await setTermaLanguage('${language}',{render:false});window.termaTerminalToolbarService.status.set(__toolbarKey,'connected');window.termaTerminalState.terminalSessions.get(__toolbarKey).connected=true;window.termaTerminalState.terminalSessions.get(__toolbarKey).autoReconnectPending=false;window.termaTerminalConnectionRuntime.updateTerminalConnectionStatus(__toolbarConnection,__toolbarKey,'connected');window.termaTerminalToolbar?.refresh(__toolbarKey);`);
    await delay(100);await layout(prefix);await shot(`${prefix}-toolbar`);
    const sftpButton = '#toolbarFixture .terminal-action-sftp';
    const moveAway = async () => {
      browser.webContents.sendInputEvent({type:'mouseMove',x:2,y:Math.floor(await execute('return innerHeight/2;'))});
      await delay(80);
    };
    await moveAway();
    await movePointerTo(sftpButton);
    await delay(520);
    const tooltipMatchesLocale = `(()=>{const tooltip=document.querySelector('.terma-hover-tooltip'),button=document.querySelector('${sftpButton}');return !!tooltip&&button.title===''&&tooltip.textContent===button.getAttribute('aria-label')&&tooltip.textContent===termaTerminalToolbarService.model(__toolbarKey).sftpTitle})()`;
    await check(`${prefix} SFTP hover shows a rounded localized tooltip with a thin border`, `(()=>{
      if(!${tooltipMatchesLocale})return false;
      const tooltip=document.querySelector('.terma-hover-tooltip'),style=getComputedStyle(tooltip),r=tooltip.getBoundingClientRect();
      return style.borderTopWidth==='1px'&&style.borderTopLeftRadius==='5px'&&style.pointerEvents==='none'
        &&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;
    })()`);
    await shot(`${prefix}-sftp-tooltip`);
    await execute(`await setTermaLanguage('${language === 'zh-CN' ? 'en-US' : 'zh-CN'}',{render:false});`);
    await check(`${prefix} open SFTP tooltip updates language in place`, tooltipMatchesLocale);
    await key('Escape');
    await check(`${prefix} Escape closes the hover tooltip`, `!document.querySelector('.terma-hover-tooltip')`);
    await execute(`document.querySelector('${sftpButton}').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse'}));`);
    await check(`${prefix} pointer interaction restores the native title immediately`, `document.querySelector('${sftpButton}').title===termaTerminalToolbarService.model(__toolbarKey).sftpTitle&&!document.querySelector('.terma-hover-tooltip')`);
    await moveAway();
    await check(`${prefix} leaving the trigger restores the translated title`, `document.querySelector('${sftpButton}').title===termaTerminalToolbarService.model(__toolbarKey).sftpTitle`);
    await execute(`await setTermaLanguage('${language}',{render:false});`);
    if (width>760) {
      const selector = '#toolbarFixture .terminal-action-encoding';
      browser.webContents.sendInputEvent({type:'mouseMove',x:2,y:Math.floor(await execute('return innerHeight/2;'))});
      await delay(150);
      const idle = await execute(`return getComputedStyle(document.querySelector('${selector}')).backgroundColor;`);
      await movePointerTo(selector);
      await delay(150);
      await check(`${prefix} encoding button has a visible pointer highlight`, `(()=>{const b=document.querySelector('${selector}');return b.matches(':hover')&&getComputedStyle(b).backgroundColor!==${JSON.stringify(idle)};})()`);
      await shot(`${prefix}-encoding-hover`);
    }
    if(width<=760) {
      await check(`${prefix} mobile toolbar controls use the terminal domain layout`, `(() => {
        const toolbar = document.querySelector('#toolbarFixture .terminal-toolbar');
        const shell = toolbar?.querySelector('.terminal-actions-scroll-shell');
        const actions = shell?.querySelector(':scope > .terminal-actions');
        const readout = actions?.querySelector('.terminal-font-size-readout');
        if (!actions || !readout) return false;

        const buttons = [...actions.querySelectorAll(':scope > button:not(.terminal-global-settings-button)')];
        const diagnostics = window.__mobileToolbarMetrics = {
          viewportWidth: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          shellAlign: getComputedStyle(shell).alignItems,
          actionsHeight: actions.getBoundingClientRect().height,
          actionsAlign: getComputedStyle(actions).alignItems,
          scrollbarWidth: getComputedStyle(actions).scrollbarWidth,
          readoutOrder: getComputedStyle(readout).order,
          readoutHeight: readout.getBoundingClientRect().height,
          buttons: []
        };
        const near = (actual, expected) => Math.abs(actual - expected) < 0.5;
        for (const button of buttons) {
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          const hidden = [...button.querySelectorAll(':scope > span:not(.composite-icon), :scope > svg:not(:first-child)')];
          const icon = button.querySelector(':scope > svg.lucide:first-child');
          const iconRect = icon?.getBoundingClientRect();
          diagnostics.buttons.push({
            name: button.getAttribute('aria-label'),
            compact: ['flex', 'inline-flex'].includes(style.display) && style.flexBasis === '30px'
              && style.alignItems === 'center' && style.justifyContent === 'center' && near(rect.width, 30) && near(rect.height, 30),
            hidden: hidden.every(node => getComputedStyle(node).display === 'none'),
            iconFits: !iconRect || (near(iconRect.width, 16) && near(iconRect.height, 14)
              && near(iconRect.x + iconRect.width / 2, rect.x + rect.width / 2)
              && near(iconRect.y + iconRect.height / 2, rect.y + rect.height / 2))
          });
        }
        return buttons.length > 0 && diagnostics.buttons.every(button => button.name && button.compact && button.hidden && button.iconFits)
          && diagnostics.readoutOrder === '10' && near(diagnostics.readoutHeight, 30)
          && diagnostics.shellAlign === 'center' && diagnostics.actionsAlign === 'center'
          && near(diagnostics.actionsHeight, 30) && diagnostics.scrollbarWidth === 'none'
          && diagnostics.documentWidth <= diagnostics.viewportWidth + 1;
      })()`);
    }
    await check(`${prefix} keeps forwarding list without latency or toggle`, `(()=>{const root=document.querySelector('#toolbarFixture');return !!root.querySelector('.terminal-action-forward-list')&&!root.querySelector('.terminal-action-forward,#terminalLatency')})()`);
    for (const mode of ['off','untrusted','trusted']) {
      await execute(`__toolbarConnection.x11_mode='${mode}';window.termaTerminalToolbar?.refresh(__toolbarKey);document.querySelector('#toolbarFixture .terminal-x11-button').scrollIntoView({inline:'center',block:'nearest'});`);
      await delay(60);
      await check(`${prefix} X11 ${mode} refreshes through the Vue owner`, `(()=>{const button=document.querySelector('#toolbarFixture .terminal-x11-button'),model=termaTerminalToolbarService.model(__toolbarKey);return button.classList.contains('active')===${mode!=='off'}&&button.title===model.x11Title&&button.getAttribute('aria-label')===model.x11Title})()`);
      await shot(`${prefix}-x11-mode-${mode}`);
    }
    await check(`${prefix} green connection and enabled session`, `(()=>{const root=document.querySelector('#toolbarFixture'),dot=root?.querySelector('.terminal-connection-dot'),session=root?.querySelector('.terminal-session-button'),x11=root?.querySelector('.terminal-x11-button'),color=dot&&getComputedStyle(dot).backgroundColor,expected='${expectedStatusColor}';return !!dot&&!!session&&!!x11&&dot.classList.contains('connected')&&color===expected&&root.querySelector('.terminal-session-badge.persistent')?.textContent===tr('terminal:toolbar.shell_persistent')&&session.getAttribute('aria-pressed')==='true'&&x11.classList.contains('active')})()`);
    await check(`${prefix} shortcut controls follow the desktop/mobile visibility rule`, `(()=>{const row=document.querySelector('#toolbarFixture .terminal-keys'),buttons=[...row.querySelectorAll('button')],visible=row.checkVisibility();return !!row&&termaTerminalKeys.isMounted(__toolbarKey)&&row.classList.contains('terma-vue-root')&&row.dataset.theme==='${theme}'&&buttons.length>0&&buttons.every(button=>button.hasAttribute('data-terma-button'))&&!buttons.some(button=>[...button.attributes].some(attribute=>/^on/.test(attribute.name)))&&(innerWidth<=760?visible&&!row.classList.contains('hidden'):!visible)})()`);
    await shot(`${prefix}-keys`);
    if(width<=760) {
      await execute(`window.__ctrlOnce=document.querySelector('#toolbarFixture .terminal-key-ctrl-once');window.__ctrlLock=document.querySelector('#toolbarFixture .terminal-key-ctrl-lock');`);
      await click('#toolbarFixture .terminal-key-ctrl-once');
      await check(`${prefix} Ctrl once control toggles`, `document.querySelector('#toolbarFixture .terminal-key-ctrl-once').getAttribute('aria-pressed')==='true'&&document.querySelector('#toolbarFixture .terminal-key-ctrl-once').classList.contains('active')`);
      await click('#toolbarFixture .terminal-key-ctrl-once');
      await click('#toolbarFixture .terminal-key-ctrl-lock');
      await check(`${prefix} Ctrl lock control toggles`, `document.querySelector('#toolbarFixture .terminal-key-ctrl-lock').getAttribute('aria-pressed')==='true'&&document.querySelector('#toolbarFixture .terminal-key-ctrl-lock').classList.contains('active')`);
      await click('#toolbarFixture .terminal-key-ctrl-lock');
    }
    await checkKeys(prefix,width,theme,language);
    await execute(`window.__actions=document.querySelector('#toolbarFixture .terminal-actions');window.__encoding=document.querySelector('#toolbarFixture .terminal-action-encoding');window.__actions.focus();`);
    await key('End');
    await check(`${prefix} End reaches right edge`, `__actions.scrollLeft+__actions.clientWidth>=__actions.scrollWidth-2`);
    await shot(`${prefix}-scroll-end`);
    await execute(`window.__scroll=__actions.scrollLeft;await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});`);
    await delay(100);
    await check(`${prefix} refresh retains nodes, scroll and arrows`, `document.querySelector('#toolbarFixture .terminal-actions')===__actions&&document.querySelector('#toolbarFixture .terminal-action-encoding')===__encoding&&(!window.__ctrlOnce||document.querySelector('#toolbarFixture .terminal-keys .terminal-key-ctrl-once')===window.__ctrlOnce)&&(!window.__ctrlLock||document.querySelector('#toolbarFixture .terminal-keys .terminal-key-ctrl-lock')===window.__ctrlLock)&&document.querySelector('#toolbarFixture .terminal-keys .terminal-key-ctrl-once').textContent.trim()===tr('terminal:keys.ctrl_once')&&(__actions.scrollWidth<=__actions.clientWidth+1||!document.querySelector('#toolbarFixture .terminal-actions-scroll-left').hidden)&&(__scroll===0||__actions.scrollLeft>0)`);
    await layout(`${prefix} live locale`);await shot(`${prefix}-live-locale`);
    await execute(`await setTermaLanguage('${language}',{render:false});__actions.focus();`);await key('Home');
    await check(`${prefix} Home reaches left edge`, `__actions.scrollLeft===0`);
    await execute(`window.__scrollHost=__actions.closest('.terminal-toolbar');termaTerminalToolbarScroll.schedule(__actions);window.termaTerminalToolbarScroll.release(__scrollHost);__actions.dispatchEvent(new WheelEvent('wheel',{deltaY:130,cancelable:true}));`);
    await delay(70);
    await check(`${prefix} released scrolling detaches pending work and input`, `!termaTerminalToolbarScroll.has(__scrollHost)&&!termaTerminalToolbarScroll.has(__actions)&&__actions.scrollLeft===0`);
    await execute(`window.termaTerminalToolbarScroll.bind(__scrollHost);window.termaTerminalToolbarScroll.bind(__scrollHost);`);
    await delay(70);
    await check(`${prefix} repeated binding retains row and keyboard focus`, `termaTerminalToolbarScroll.has(__scrollHost)&&termaTerminalToolbarScroll.has(__actions)&&document.querySelector('#toolbarFixture .terminal-actions')===__actions&&document.activeElement===__actions&&__scrollHost.querySelectorAll('.terminal-actions-scroll-shell').length===1`);
    await execute(`__actions.dispatchEvent(new WheelEvent('wheel',{deltaY:130,cancelable:true}));`);
    await delay(60);
    await check(`${prefix} rebind installs one wheel handler and projects geometry through Vue`, `(()=>{const limit=Math.max(0,__actions.scrollWidth-__actions.clientWidth),left=__scrollHost.querySelector('.terminal-actions-scroll-left');return __actions.scrollLeft===Math.min(130,limit)&&left.hidden===(limit<=1)&&left.disabled===!(__actions.scrollLeft>1)})()`);
    await shot(`${prefix}-scroll-rebound`);
    await key('Home');
    const overflow=await execute(`return __actions.scrollWidth>__actions.clientWidth+1;`);
    if(overflow) {
      await click('#toolbarFixture .terminal-actions-scroll-right');
      await check(`${prefix} pointer scroll`, `__actions.scrollLeft>0`);
      await execute(`__actions.dispatchEvent(new WheelEvent('wheel',{deltaY:130,cancelable:true}));`);
      await check(`${prefix} wheel scroll`, `__actions.scrollLeft>100`);
    }
    for(const [name,selector] of [['encoding','.terminal-action-encoding'],['font','.terminal-action-display:not(.terminal-action-encoding)'],['session','.terminal-session-button'],['x11','.terminal-x11-button']]) {
      await click(`#toolbarFixture ${selector}`);
      await execute(`for(let attempt=0;attempt<100&&!document.querySelector('#actionMenu')?.checkVisibility();attempt++)await new Promise(resolve=>setTimeout(resolve,20));`);
      await check(`${prefix} ${name} menu opens visibly above fixture with usable targets`, `(()=>{const menu=document.querySelector('#actionMenu'),rect=menu?.getBoundingClientRect(),visible=!!menu&&menu.checkVisibility()&&!!rect&&rect.width>0&&rect.height>0&&rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight,hit=visible&&document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2),buttons=[...(menu?.querySelectorAll('button')||[])];return visible&&buttons.length>0&&menu.dataset.termaVueDisplayMenu==='true'&&buttons.every(button=>button.hasAttribute('data-terma-button')&&(innerWidth>760||button.getBoundingClientRect().height>=39.5))&&(hit===menu||menu.contains(hit))})()`);
      await check(`${prefix} ${name} menu has theme tokens and opaque surface`, `(()=>{const menu=document.querySelector('#actionMenu'),context=document.createElement('canvas').getContext('2d',{willReadFrequently:true}),nodes=[menu,...menu.querySelectorAll('.action-menu-close')];return getComputedStyle(menu).getPropertyValue('--tile-surface-elevated').trim()!==''&&nodes.every(node=>{context.clearRect(0,0,1,1);context.fillStyle=getComputedStyle(node).backgroundColor;context.fillRect(0,0,1,1);return context.getImageData(0,0,1,1).data[3]===255})})()`);
      await check(`${prefix} ${name} menu uses current language`, `(()=>{const text=document.querySelector('#actionMenu').textContent;return ${JSON.stringify(menuLanguageKeys[name])}.every(key=>text.includes(tr(key)))&&(${JSON.stringify(language)}!=='en-US'||!/[\u3400-\u9fff]/.test(text))})()`);
      await shot(`${prefix}-menu-${name}`);
      await execute(`await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});`);
      await check(`${prefix} ${name} open menu updates language`, `(()=>{const text=document.querySelector('#actionMenu').textContent;return ${JSON.stringify(menuLanguageKeys[name])}.every(key=>text.includes(tr(key)))&&(${JSON.stringify(language === 'zh-CN' ? 'en-US' : 'zh-CN')}!=='en-US'||!/[\u3400-\u9fff]/.test(text))})()`);
      await shot(`${prefix}-menu-${name}-live-locale`);
      await execute(`hideActionMenu();await setTermaLanguage('${language}',{render:false});`);
      if(name==='encoding') {
        await click('#toolbarFixture .terminal-action-encoding');
        await movePointerTo('#actionMenu [aria-checked="true"]');
        await check(`${prefix} selected encoding stays blue while hovered`, `(()=>{const item=document.querySelector('#actionMenu [aria-checked="true"]');if(!item)return false;const probe=document.createElement('span');probe.style.backgroundColor='color-mix(in srgb,var(--accent2) 10%,var(--panel))';probe.style.color='var(--accent2)';item.append(probe);const expectedBackground=getComputedStyle(probe).backgroundColor,expectedColor=getComputedStyle(probe).color;probe.remove();const style=getComputedStyle(item);return item.matches(':hover')&&style.backgroundColor===expectedBackground&&style.color===expectedColor&&style.transform==='none'&&style.boxShadow==='none'})()`);
        await shot(`${prefix}-menu-hover-selected`);
        await execute('hideActionMenu();');
        await execute(`window.__toolbarPreferenceMode='pending';window.__toolbarWriteCount=__toolbarPreferenceWrites.length;window.__toolbarFrameCount=__toolbarPreferenceFrames.length;`);
        await click('#toolbarFixture .terminal-action-encoding');
        await click('#actionMenu [data-terminal-display-action="encoding-gbk"]');
        await check(`${prefix} encoding awaits persistence before applying`, `__toolbarPreferenceWrites.length===__toolbarWriteCount+1&&__toolbarPreferenceFrames.length===__toolbarFrameCount`);
        await click('#toolbarFixture .terminal-action-display:not(.terminal-action-encoding)');
        await check(`${prefix} display menu stays usable during encoding save`, `document.querySelector('#actionMenu')?.checkVisibility()&&!!document.querySelector('#actionMenu [data-terminal-display-action="custom-font"]')`);
        await shot(`${prefix}-preference-pending`);
        const encodingApplied = `__toolbarConnection.terminal_encoding==='gbk'&&window.termaTerminalState.terminalSessions.get(__toolbarKey).terminalEncoding==='gbk'&&document.querySelector('#toolbarFixture .terminal-action-encoding span').textContent==='GBK'&&__toolbarPreferenceFrames.at(-1)?.encoding==='gbk'&&__toolbarPreferenceNotices.at(-1)?.[2]?.replaceKey==='terminal-encoding-990001'`;
        await execute(`hideActionMenu();__toolbarPreferenceComplete();window.__toolbarPreferenceMode='success';for(let i=0;i<100&&!(${encodingApplied});i++)await new Promise(resolve=>setTimeout(resolve,20));`);
        if (!await execute(`return (${encodingApplied});`)) console.error('Encoding result', await execute(`return [__toolbarConnection.terminal_encoding,window.termaTerminalState.terminalSessions.get(__toolbarKey).terminalEncoding,document.querySelector('#toolbarFixture .terminal-action-encoding span').textContent,__toolbarPreferenceFrames.at(-1),__toolbarPreferenceNotices.at(-1)];`));
        await check(`${prefix} saved encoding updates toolbar frame and notification`, encodingApplied);
        await shot(`${prefix}-preference-encoding-applied`);
      }
      if(name==='x11') {
        await click('#toolbarFixture .terminal-x11-button');
        await movePointerTo('#actionMenu [data-terminal-display-action="xserver-manager"]');
        await check(`${prefix} ordinary menu hover uses subtle neutral surface`, `(()=>{const item=document.querySelector('#actionMenu [data-terminal-display-action="xserver-manager"]');if(!item)return false;const style=getComputedStyle(item);return item.matches(':hover')&&style.backgroundColor!=='rgba(0, 0, 0, 0)'&&style.backgroundImage==='none'&&style.transform==='none'&&style.boxShadow==='none'})()`);
        await shot(`${prefix}-menu-hover-neutral`);
        await execute('hideActionMenu();');
      }
    }
    await execute(`const x11Button=document.querySelector('#toolbarFixture .terminal-x11-button');x11Button?.scrollIntoView({inline:'center',block:'nearest'});const x11Rect=x11Button?.getBoundingClientRect();window.__x11MenuEvent={clientX:(x11Rect?.left||0)+(x11Rect?.width||0)/2,clientY:(x11Rect?.top||0)+(x11Rect?.height||0)/2,preventDefault(){},stopPropagation(){}};window.termaX11TerminalMenu.open(window.__x11MenuEvent,__toolbarConnection.id,__toolbarKey);`);
    await click('#actionMenu [data-terminal-display-action="default-untrusted"]');
    await delay(80);
    await check(`${prefix} X11 scope submenu stays visible and uses Tile buttons`, `(()=>{const menu=document.querySelector('#actionMenu'),nested=innerWidth<=760?menu:document.querySelector('#actionSubMenu'),rect=nested?.getBoundingClientRect(),buttons=[...(nested?.querySelectorAll('button')||[])];return !!menu&&menu.dataset.termaVueDisplayMenu==='true'&&!!nested&&nested.checkVisibility()&&!!rect&&rect.width>0&&rect.height>0&&rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight&&buttons.length>=3&&buttons.every(button=>button.hasAttribute('data-terma-button'))&&(innerWidth<=760?menu.querySelector('[data-terminal-menu-back]')?.hasAttribute('data-terma-button')===true:document.querySelector('#actionSubMenu')?.dataset.termaVueSubmenu==='true')})()`);
    await check(`${prefix} both menu levels use the shared rounded surface`, `[...document.querySelectorAll('#actionMenu,#actionSubMenu')].every(menu=>getComputedStyle(menu).borderTopLeftRadius==='8px')`);
    await check(`${prefix} X11 scope items preserve order and left alignment`, `(()=>{const menu=document.querySelector(innerWidth<=760?'#actionMenu':'#actionSubMenu'),items=[...menu.querySelectorAll('[data-terminal-display-action]')],labels=items.map(item=>item.querySelector('span').getBoundingClientRect().left),icons=items.map(item=>item.querySelector('svg').getBoundingClientRect().left);return items.map(item=>item.dataset.terminalDisplayAction).join(',')==='current-terminal,new-terminal,next-start'&&items.every((item,index)=>item.textContent.trim()===tr(['terminal:x11_menu.current_terminal','terminal:x11_menu.new_terminal','terminal:x11_menu.next_start'][index])&&labels[index]<item.getBoundingClientRect().left+60)&&Math.max(...labels)-Math.min(...labels)<1&&Math.max(...icons)-Math.min(...icons)<1})()`);
    await execute(`window.__x11FocusedScope=document.querySelector((innerWidth<=760?'#actionMenu':'#actionSubMenu')+' [data-terminal-display-action="current-terminal"]');__x11FocusedScope.focus();window.__x11ScopeScroll=__x11FocusedScope.parentElement.scrollTop;`);
    await shot(`${prefix}-menu-x11-scope`);
    await execute(`await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});`);
    await delay(80);
    await check(`${prefix} X11 submenu survives live language change`, `(()=>{const menu=document.querySelector('#actionMenu'),nested=innerWidth<=760?menu:document.querySelector('#actionSubMenu');return !!nested&&nested.checkVisibility()&&!!nested.querySelector('[data-terminal-display-action="current-terminal"]')&&menu.dataset.termaVueDisplayMenu==='true'})()`);
    await check(`${prefix} X11 scope live language retains focus scroll and translated attributes`, `(()=>{const menu=document.querySelector(innerWidth<=760?'#actionMenu':'#actionSubMenu'),text=[menu.textContent,...[...menu.querySelectorAll('*')].flatMap(el=>[el.title,el.getAttribute('aria-label')])].join(' ');return document.activeElement===__x11FocusedScope&&__x11FocusedScope.parentElement.scrollTop===__x11ScopeScroll&&['current_terminal','new_terminal','next_start'].every(key=>text.includes(tr('terminal:x11_menu.'+key)))&&(document.documentElement.lang!=='en-US'||!/[\\u3400-\\u9fff]/.test(text))})()`);
    await execute(`applyTheme('${theme==='light'?'dark':'light'}');`);
    await delay(80);
    await check(`${prefix} X11 open scope follows live theme and retains focus`, `document.activeElement===__x11FocusedScope&&document.querySelector('#actionMenu').closest('[data-terma-display-menu-mount]').dataset.theme===document.documentElement.dataset.theme`);
    await shot(`${prefix}-menu-x11-scope-live-locale`);
    await execute(`applyTheme('${theme}');await setTermaLanguage('${language}',{render:false});`);
    if(width<=760) {
      await click('#actionMenu [data-terminal-menu-back]');
      await check(`${prefix} X11 mobile back restores parent menu`, `(()=>{const menu=document.querySelector('#actionMenu');return !!menu&&!menu.querySelector('[data-terminal-menu-back]')&&!!menu.querySelector('[data-terminal-display-action="default-untrusted"]')&&!menu.querySelector('[data-terminal-display-action="current-terminal"]')})()`);
      await shot(`${prefix}-menu-x11-parent`);
    }
    await execute('hideActionMenu();');
    await execute(`window.termaConnectionMenu.open(window.__x11MenuEvent,__toolbarConnection.id);`);
    await click('#actionMenu [data-terminal-display-action="x11"]');
    await click(`${width<=760?'#actionMenu':'#actionSubMenu'} [data-terminal-display-action="default-trusted"]`);
    await check(`${prefix} connection X11 nested scope uses the same typed actions`, `(()=>{const menu=document.querySelector(innerWidth<=760?'#actionMenu':'#actionSubMenu'),items=[...menu.querySelectorAll('[data-terminal-display-action]')],r=menu.getBoundingClientRect();return menu.checkVisibility()&&items.map(item=>item.dataset.terminalDisplayAction).join(',')==='current-terminal,new-terminal,next-start'&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`);
    await check(`${prefix} connection parent menu retains viewport bounds after nested rendering`, `(()=>{const menu=document.querySelector('#actionMenu'),rect=menu.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight&&[...menu.querySelectorAll('[data-terminal-display-action]')].every(item=>{const label=item.children[1],range=document.createRange();range.selectNodeContents(label);const text=range.getBoundingClientRect(),bounds=label.getBoundingClientRect();return text.left>=bounds.left-.5&&text.right<=bounds.right+.5&&text.right<=innerWidth-7})})()`);
    await check(`${prefix} connection nested scope leaves parent actions visible`, `(()=>{const parent=document.querySelector('#actionMenu'),child=document.querySelector('#actionSubMenu');if(!child)return true;const a=parent.getBoundingClientRect(),b=child.getBoundingClientRect();return a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top})()`);
    await shot(`${prefix}-menu-x11-connection-scope`);
    if(width<=760) {
      await click('#actionMenu [data-terminal-menu-back]');
      await check(`${prefix} connection X11 back restores the X11 menu`, `!!document.querySelector('#actionMenu [data-terminal-display-action="default-trusted"]')`);
      await click('#actionMenu [data-terminal-menu-back]');
      await check(`${prefix} connection X11 second back restores the connection menu`, `!!document.querySelector('#actionMenu [data-terminal-display-action="x11"]')&&!document.querySelector('#actionMenu [data-terminal-menu-back]')`);
    }
    if(width>760) {
      await execute(`const event=(x,y)=>({clientX:x,clientY:y,preventDefault(){},stopPropagation(){}});termaTerminalActionMenu.open(event(100,100),()=>[{key:'replacement-parent',label:'Fixture',children:[{key:'replacement-child',label:'Fixture'}]}]);document.querySelector('#actionMenu button').click();await Promise.resolve();termaTerminalActionMenu.open(event(600,400),()=>[{key:'replacement-current',label:'Fixture'}]);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
      await check(`${prefix} replaced menu ignores the prior owner positioning callback`, `(()=>{const menu=document.querySelector('#actionMenu'),rect=menu.getBoundingClientRect();return !!menu.querySelector('[data-terminal-display-action="replacement-current"]')&&Math.abs(rect.left-600)<1&&Math.abs(rect.top-400)<1&&!document.querySelector('#actionSubMenu')})()`);
    }
    await execute('hideActionMenu();');
    if(theme==='light'&&language==='zh-CN') {
      await click('#toolbarFixture .terminal-session-button');
      await execute(`window.__originalReconnectTerminal=window.termaTerminalConnection.connect;window.__reconnectArgs=null;window.termaTerminalConnection.connect=(connection,key)=>{window.__reconnectArgs=[connection.id,key];return Promise.resolve();};`);
      await click('#actionMenu [data-terminal-display-action="reconnect-session"]');
      await check(`${prefix} session reconnect action calls existing adapter and closes menu`, `Array.isArray(__reconnectArgs)&&__reconnectArgs[0]===__toolbarConnection.id&&__reconnectArgs[1]===__toolbarKey&&!termaTerminalActionMenu.active()`);
      await execute('window.termaTerminalConnection.connect=window.__originalReconnectTerminal;');
      await execute(`window.__originalSaveAndApplyX11Mode=window.termaX11.terminal.change;window.__x11SaveArgs=null;window.termaX11.terminal.change=(...args)=>{window.__x11SaveArgs=args;return true;};`);
      await click('#toolbarFixture .terminal-x11-button');
      await click('#actionMenu [data-terminal-display-action="default-untrusted"]');
      if(width<=760) await click('#actionMenu [data-terminal-display-action="current-terminal"]');
      else await click('#actionSubMenu [data-terminal-display-action="current-terminal"]');
      await check(`${prefix} X11 action calls existing adapter and closes menu`, `Array.isArray(__x11SaveArgs)&&__x11SaveArgs[0]===__toolbarConnection.id&&__x11SaveArgs[1]==='untrusted'&&__x11SaveArgs[2]==='current'&&__x11SaveArgs[3]===__toolbarKey&&!termaTerminalActionMenu.active()`);
      await execute('window.termaX11.terminal.change=window.__originalSaveAndApplyX11Mode;');
    }
    await click('#toolbarFixture .terminal-action-display:not(.terminal-action-encoding)');
    await click('#actionMenu [data-terminal-display-action="custom-font"]');
    await delay(70);
    await check(`${prefix} custom font Vue dialog opens visibly`, `(()=>{const modal=document.querySelector('#modal[data-terminal-dialog="font-prompt"]'),card=modal?.querySelector('.terminal-font-prompt-modal'),input=modal?.querySelector('#terminalFontPromptInput'),rect=card?.getBoundingClientRect(),hit=rect&&document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);return !!modal&&!modal.hidden&&!!input&&!!rect&&rect.width>0&&rect.height>0&&input===document.activeElement&&modal.querySelectorAll('[data-terma-button]').length===3&&(hit===card||card.contains(hit))})()`);
    await shot(`${prefix}-font-prompt`);
    await execute(`const input=document.querySelector('#terminalFontPromptInput');input.value='Consolas, monospace';input.dispatchEvent(new Event('input',{bubbles:true}));input.setSelectionRange(4,11);window.__fontTitleBefore=document.querySelector('#terminalFontPromptTitle').textContent;window.__fontLabelBefore=document.querySelector('label[for="terminalFontPromptInput"]').textContent;`);
    await execute(`await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});`);
    await delay(70);
    await check(`${prefix} font dialog refreshes language and keeps input`, `(()=>{const modal=document.querySelector('#modal[data-terminal-dialog="font-prompt"]'),input=modal?.querySelector('#terminalFontPromptInput'),title=modal?.querySelector('#terminalFontPromptTitle')?.textContent||'',label=modal?.querySelector('label[for="terminalFontPromptInput"]')?.textContent||'';return !!input&&input.value==='Consolas, monospace'&&input.selectionStart===4&&input.selectionEnd===11&&document.activeElement===input&&title!==window.__fontTitleBefore&&label!==window.__fontLabelBefore})()`);
    await shot(`${prefix}-font-prompt-live-locale`);
    await execute(`await setTermaLanguage('${language}',{render:false});`);
    await delay(70);
    await check(`${prefix} font dialog restores locale without losing value`, `(()=>{const input=document.querySelector('#terminalFontPromptInput');return !!input&&input.value==='Consolas, monospace'&&input.selectionStart===4&&input.selectionEnd===11&&document.activeElement===input&&document.querySelector('#terminalFontPromptTitle').textContent===tr('terminal:display.custom_font_title')})()`);
    await execute(`window.__toolbarWriteCount=__toolbarPreferenceWrites.length;`);
    await click('#terminalFontPromptSave');
    await delay(90);
    await check(`${prefix} custom font saves through the production service`, `__toolbarPreferenceWrites.length===__toolbarWriteCount+1&&__toolbarPreferenceWrites.at(-1).terminal_font_family==='Consolas, monospace'&&__toolbarConnection.terminal_font_family==='Consolas, monospace'&&window.termaTerminalState.terminalSessions.get(__toolbarKey).term.options.fontFamily==='Consolas, monospace'&&document.querySelector('#modal').hidden`);
    await shot(`${prefix}-preference-font-applied`);
    await execute(`window.__toolbarWriteCount=__toolbarPreferenceWrites.length;const field=window.termaTerminalMetadata.terminalFontSizeField(),flag=window.termaTerminalMetadata.terminalFontSizeInheritField();__toolbarConnection[field]=18;__toolbarConnection[flag]=0;__toolbarScheduleSave(__toolbarConnection);__toolbarScheduleSave(__toolbarConnection);`);
    await delay(380);
    await check(`${prefix} font timer debounces without overwriting encoding`, `__toolbarPreferenceWrites.length===__toolbarWriteCount+1&&!Object.hasOwn(__toolbarPreferenceWrites.at(-1),'terminal_encoding')&&__toolbarConnection.terminal_encoding==='gbk'`);
    if(width>760) {
      await click('#toolbarFixture .terminal-global-settings-button');
      await check(`${prefix} settings opens visibly above fixture`, `(()=>{const title=document.querySelector('#terminalSettingsTitle'),modal=title?.closest('.modal'),card=title?.closest('.modal-card'),r=card?.getBoundingClientRect(),hit=r&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!title&&!!modal&&!modal.hidden&&!!r&&r.width>0&&r.height>0&&(hit===card||card.contains(hit))})()`);
      await shot(`${prefix}-settings`);await execute(`closeModal();`);
    }
    await execute(`window.termaTerminalStartupState.overrides.set(__toolbarKey,window.termaTerminalStartup.normalize({terminal_startup_mode:'program',terminal_profile_name:'Temporary Shell <literal>',terminal_program_path:'/bin/bash'}));window.termaTerminalToolbar.refresh(__toolbarKey);`);
    await delay(70);
    await check(`${prefix} startup refresh shows the temporary profile through Vue`, `(()=>{const button=document.querySelector('#toolbarFixture .terminal-startup-button'),model=termaTerminalToolbarService.model(__toolbarKey);return button.classList.contains('has-temporary-startup')&&button.title===model.startupTitle&&button.getAttribute('aria-label')===model.startupTitle&&button.title.includes('Temporary Shell <literal>')&&!button.querySelector('literal')})()`);
    await shot(`${prefix}-startup-temporary`);
    await execute(`window.termaTerminalStartupState.overrides.delete(__toolbarKey);window.termaTerminalToolbar.refresh(__toolbarKey);`);
    await delay(70);
    await check(`${prefix} startup restore clears the temporary profile through Vue`, `(()=>{const button=document.querySelector('#toolbarFixture .terminal-startup-button');return !button.classList.contains('has-temporary-startup')&&button.title===termaTerminalToolbarService.model(__toolbarKey).startupTitle})()`);
    await click('#toolbarFixture .terminal-startup-button');
    await check(`${prefix} startup opens visibly above fixture`, `(()=>{const modal=$('modal'),card=modal.querySelector('.modal-card'),r=card?.getBoundingClientRect(),hit=r&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !modal.hidden&&!!r&&r.width>0&&r.height>0&&(hit===card||card.contains(hit))})()`);
    await shot(`${prefix}-startup`);await execute(`closeModal();`);
    await execute(`const el=document.querySelector('#toolbarFixture .terminal-ai-button');el.scrollIntoView({inline:'nearest'});document.activeElement?.blur?.();el.blur();`);
    await delay(180);
    const hover=await execute(`const el=document.querySelector('#toolbarFixture .terminal-ai-button'),r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};`);
    browser.webContents.sendInputEvent({type:'mouseMove',...hover});await delay(80);
    await check(`${prefix} hover has no halo or motion`, `(()=>{const el=document.querySelector('#toolbarFixture .terminal-ai-button'),s=getComputedStyle(el);return el.matches(':hover')&&s.boxShadow==='none'&&s.transform==='none'&&s.transition==='none';})()`);
    await shot(`${prefix}-hover`);
    await execute(`document.querySelector('#toolbarFixture .terminal-ai-button').focus();`);await key('Tab');await shot(`${prefix}-keyboard-focus`);
    for(const state of ['connecting','authentication','authorization','reconnecting','disconnected','connected']) {
      await execute(`const session=window.termaTerminalState.terminalSessions.get(__toolbarKey);session.connected='${state}'==='connected';session.autoReconnectPending='${state}'==='reconnecting';window.termaTerminalConnectionRuntime.updateTerminalConnectionStatus(__toolbarConnection,__toolbarKey,'${state}');`);
      await delay(35);
      await check(`${prefix} ${state} updates`, `document.querySelector('#toolbarFixture #terminalStatus').dataset.connectionState==='${state}'&&document.querySelector('#toolbarFixture .terminal-action-reconnect').disabled===${!['connected','disconnected'].includes(state)}`);
      await shot(`${prefix}-state-${state}`);
    }
    await execute(`terminalKeysVisible=!terminalKeysVisible;window.termaTerminalKeys.refresh(__toolbarKey);window.termaAssistant.service.state(__toolbarKey).open=true;__toolbarConnection.x11_mode='off';window.termaTerminalToolbar?.refresh(__toolbarKey);`);
    await check(`${prefix} shortcut AI X11 state`, `document.querySelector('#toolbarFixture .terminal-action-keys').getAttribute('aria-pressed')===String(terminalKeysVisible)&&document.querySelector('#toolbarFixture .terminal-keys').classList.contains('hidden')&&document.querySelector('#toolbarFixture .terminal-ai-button').getAttribute('aria-pressed')==='true'&&!document.querySelector('#toolbarFixture .terminal-x11-button').classList.contains('active')`);
    await shot(`${prefix}-toggles`);
    await execute(`window.termaAssistant.service.state(__toolbarKey).open=false;__toolbarConnection.x11_mode='trusted';window.termaTerminalToolbar?.refresh(__toolbarKey);`);
  }
  await execute(`
    const quick={...__toolbarConnection,id:-990001,quick_connection:true,ssh_host:'quick.example'};
    window.termaTerminalQuickRegistry.quickConnectionsById.set(quick.id,quick);tabs.push({key:__quickKey,id:quick.id,kind:'quick-terminal'});
    window.termaTerminalState.terminalSessions.set(__quickKey,{connection:quick,connected:false,socket:{readyState:WebSocket.CLOSED}});
    __makeToolbarFixture('quickToolbarFixture',__quickKey);
  `);
  await delay(100);await layout('temporary connection','#quickToolbarFixture');await shot('quick-toolbar');
  await check('empty temporary host mounts through the Vue owner', `document.querySelector('#quickToolbarFixture .terminal-toolbar').querySelectorAll('.terminal-title-row').length===1&&termaTerminalToolbar.isMounted(__quickKey)`);
  await check('temporary connection controls and independent status', `!document.querySelector('#quickToolbarFixture .terminal-session-button')&&!document.querySelector('#quickToolbarFixture .terminal-startup-button')&&!document.querySelector('#quickToolbarFixture .terminal-action-forward')&&!!document.querySelector('#quickToolbarFixture .terminal-x11-button')&&document.querySelector('#quickToolbarFixture .terminal-connection-dot').classList.contains('disconnected')&&document.querySelector('#toolbarFixture .terminal-connection-dot').classList.contains('connected')`);
  for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']) {
    const prefix=`${width}-${language}-${theme}`;
    await execute(`applyTheme('${theme}');await setTermaLanguage('${language}',{render:false});`);
    await click('#quickToolbarFixture .terminal-x11-button');
    await check(`${prefix} temporary X11 menu has only session-specific actions`, `(()=>{const menu=document.querySelector('#actionMenu'),items=[...menu.querySelectorAll('[data-terminal-display-action]')],r=menu.getBoundingClientRect(),labels=items.map(item=>item.children[1].getBoundingClientRect().left);return menu.checkVisibility()&&items.map(item=>item.dataset.terminalDisplayAction).join(',')==='quick-untrusted,quick-trusted,quick-manager'&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&Math.max(...labels)-Math.min(...labels)<1})()`);
    await check(`${prefix} temporary X11 menu text fits inside each button and viewport`, `(()=>{const menu=document.querySelector('#actionMenu'),r=menu.getBoundingClientRect();return r.left>=7&&r.right<=innerWidth-7&&[...menu.querySelectorAll('[data-terminal-display-action]')].every(item=>{const label=item.children[1],range=document.createRange();range.selectNodeContents(label);const text=range.getBoundingClientRect(),rect=label.getBoundingClientRect(),button=item.getBoundingClientRect();return text.left>=rect.left-1&&text.right<=rect.right+1&&text.right<=button.right&&text.right<=innerWidth-7})})()`);
    await shot(`${prefix}-menu-x11-quick`);
    await execute(`await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}',{render:false});`);
    await check(`${prefix} temporary X11 menu translates while open`, `(()=>{const menu=document.querySelector('#actionMenu'),text=[menu.textContent,...[...menu.querySelectorAll('*')].flatMap(el=>[el.title,el.getAttribute('aria-label')])].join(' ');return ['terminal:x11_menu.temporary_untrusted','terminal:x11_menu.temporary_trusted','common:x11.manager'].every(key=>text.includes(tr(key)))&&(document.documentElement.lang!=='en-US'||!/[\\u3400-\\u9fff]/.test(text))})()`);
    await check(`${prefix} temporary X11 live language text remains fully visible`, `(()=>{const menu=document.querySelector('#actionMenu'),r=menu.getBoundingClientRect();return r.left>=7&&r.right<=innerWidth-7&&[...menu.querySelectorAll('[data-terminal-display-action]')].every(item=>{const label=item.children[1],range=document.createRange();range.selectNodeContents(label);return range.getBoundingClientRect().right<=label.getBoundingClientRect().right+1})})()`);
    await shot(`${prefix}-menu-x11-quick-live-locale`);
    await execute(`window.__quickMenuSaved=window.termaTerminalActionMenu.open;window.__quickActionCalls=[];window.termaTerminalActionMenu.open=(event,actions)=>{
      const key=event.target.closest('.terminal-toolbar')?.dataset.terminalTabKey;
      return __quickMenuSaved(event,()=>actions().map(item=>item.run?{...item,run:()=>{__quickActionCalls.push([key,item.key]);return true;}}:item));
    };hideActionMenu();`);
    for(const action of ['quick-untrusted','quick-trusted','quick-manager']) {
      await click('#quickToolbarFixture .terminal-x11-button');
      await click(`#actionMenu [data-terminal-display-action="${action}"]`);
      await check(`${prefix} ${action} dispatches from the temporary terminal toolbar and closes the menu`, `JSON.stringify(__quickActionCalls.at(-1))===JSON.stringify(['terminal-toolbar-quick',${JSON.stringify(action)}])&&!termaTerminalActionMenu.active()`);
    }
    await execute(`window.termaTerminalActionMenu.open=__quickMenuSaved;await setTermaLanguage('${language}',{render:false});`);
  }
  await execute(`window.__quickToolbar=document.querySelector('#quickToolbarFixture .terminal-toolbar');window.__quickBadge=__quickToolbar.querySelector('.terminal-quick-badge');document.querySelector('#quickToolbarFixture').style.display='none';`);
  for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']) {
    await execute(`applyTheme('${theme}');await setTermaLanguage('${language}',{render:false});`);
    await delay(100);
    await check(`${language} ${theme} hidden temporary toolbar keeps its node and current model`, `!__quickToolbar.checkVisibility()&&document.querySelector('#quickToolbarFixture .terminal-toolbar')===__quickToolbar&&__quickToolbar.querySelector('.terminal-quick-badge')===__quickBadge&&__quickBadge.textContent===tr('terminal:toolbar.temporary')&&__quickToolbar.dataset.theme==='${theme}'&&window.termaTerminalToolbarService.model(__quickKey).quick`);
  }
  await execute(`document.querySelector('#quickToolbarFixture').style.display='flex';`);
  await layout('restored temporary toolbar','#quickToolbarFixture');
  await shot('quick-toolbar-restored');
  await execute(`window.__old=document.querySelector('#quickToolbarFixture .terminal-toolbar');window.__oldActions=__old.querySelector('.terminal-actions');__old.remove();`);
  await delay(80);
  await check('removed target releases Vue root and scroll listeners', `!termaTerminalToolbar.isMounted(__quickKey)&&!__old.classList.contains('terma-vue-root')&&!__old.hasAttribute('data-theme')&&!termaTerminalToolbarScroll.has(__old)&&!termaTerminalToolbarScroll.has(__oldActions)`);
  await execute(`document.querySelector('#quickToolbarFixture').remove();window.__savedToolbar=document.querySelector('#toolbarFixture .terminal-toolbar');window.__savedActions=__savedToolbar.querySelector('.terminal-actions');window.__savedKeys=document.querySelector('#toolbarFixture .terminal-keys');window.termaTerminalState.terminalSurfaceCache.set(__toolbarKey,document.querySelector('#toolbarFixture #view-terminal'));window.termaTerminalToolbarService.status.set(__toolbarKey,'disconnected');window.termaTerminalState.terminalSessions.delete(__toolbarKey);tabs=tabs.filter(tab=>tab.key!==__toolbarKey);window.termaWorkspaceTabRuntime.cleanup(new Map([[__toolbarKey,{key:__toolbarKey,kind:"terminal"}]]));`);
  await check('close releases state even without a session', `!termaTerminalToolbar.isMounted(__toolbarKey)&&!termaTerminalKeys.isMounted(__toolbarKey)&&!__savedKeys.hasAttribute('data-theme')&&!__savedKeys.classList.contains('terma-vue-root')&&!__savedKeys.querySelector('button')&&window.termaTerminalToolbarService.status.get(__toolbarKey)===undefined&&!termaTerminalToolbarScroll.has(__savedActions)`);
  await execute(`for(const id of __fixturePanes)workspacePaneNodes.delete(id);workspaceLayout=__oldWorkspaceLayout;focusedPaneId=__oldFocusedPaneId;window.termaRuntimeSettingsModel.snapshot.saved.workspace_toolbar_placement=__oldToolbarPlacement;`);
  const report={directory,checks:checks.length,assertions:checks,states,screenshotContexts,realTransport:false};
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  return {directory,checks:checks.length,states:states.length};
}
module.exports={runTerminalToolbarUiScenario};
