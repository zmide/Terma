const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Dedicated disposable browser, with saves/paste capture isolated from host services.
async function runTerminalSettingsUiScenario(browser) {
  const directory = path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR || path.join(process.cwd(), 'data'), 'terminal-settings-visual');
  fs.mkdirSync(directory, {recursive:true});
  const execute = source => browser.webContents.executeJavaScript(`(async()=>{${source}})()`);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const states = [], checks = [];
  const shot = async name => {
    await delay(90); browser.webContents.invalidate();
    fs.writeFileSync(path.join(directory, `${name}.png`), (await browser.webContents.capturePage()).toPNG()); states.push(name);
  };
  const click = async selector => {
    const point = await execute(`const element=document.querySelector(${JSON.stringify(selector)});if(!element?.checkVisibility())throw Error('Missing '+${JSON.stringify(selector)});element.scrollIntoView({block:'nearest',inline:'nearest'});const r=element.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}`);
    for (const type of ['mouseMove','mouseDown','mouseUp']) { browser.webContents.sendInputEvent({type,...point,button:'left',clickCount:1}); await delay(15); }
  };
  const key = async (keyCode, modifiers=[]) => {
    for (const type of ['keyDown','keyUp']) browser.webContents.sendInputEvent({type,keyCode,modifiers});
    await delay(40);
  };
  const check = async (name, expression) => { const result = await execute(`return (${expression});`); checks.push({name,result}); if(!result)await shot('failure'); assert.equal(result,true,name); };
  const layout = async name => {
    const result = await execute(`
      const card=$('modal').querySelector('.modal-card'),r=card.getBoundingClientRect();
      const fields=[...card.querySelectorAll('button,input,textarea,select')].filter(el=>el.checkVisibility());
      const panels=card.querySelector('.terminal-settings-panels');
      const tab=card.querySelector('[role=tab][aria-selected=true]'),list=tab?.parentElement;
      const selected=tab?.getBoundingClientRect(),strip=list?.getBoundingClientRect();
      const overflow=fields.filter(el=>{const b=el.getBoundingClientRect();const tab=el.closest('[role=tablist]');return !tab&&(b.left<r.left-1||b.right>r.right+1||el.tagName==='BUTTON'&&el.scrollWidth>el.clientWidth+2);}).map(el=>({id:el.id,text:el.textContent}));
      const chrome=[card.textContent,...[...card.querySelectorAll('*')].flatMap(el=>[el.title,el.getAttribute('aria-label'),el.placeholder])].join(' ');
      return {fits:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,
        panelFits:!panels||panels.scrollWidth<=panels.clientWidth+1, tile:[...card.querySelectorAll('button:not(.dialog-window-resize)')].every(el=>el.hasAttribute('data-terma-button')),
        noInline:![...card.querySelectorAll('*')].some(el=>[...el.attributes].some(attr=>/^on/.test(attr.name))),
        translated:document.documentElement.lang!=='en-US'||!/[\\u3400-\\u9fff]/.test(chrome),controls:!overflow.length,overflow,
        selectedVisible:!tab||selected.left>=strip.left-1&&selected.right<=strip.right+1};
    `);
    checks.push({name,...result});
    if(Object.values(result).some(value=>value===false))await shot('failure-layout');
    for(const [field,value] of Object.entries(result))if(typeof value==='boolean')assert.equal(value,true,`${name}: ${field} ${JSON.stringify(result.overflow)}`);
  };
  await execute(`
    await window.termaI18nReady;while(window.workspaceRestorePending)await new Promise(r=>setTimeout(r,20));
    window.termaWorkspaceRefresh.stop();window.restoringTabs=true;
    window.__terminalSettingsWrites=[];window.__terminalSettingsNotices=[];window.__terminalSettingsSaveMode='success';window.__terminalFocus=[];
    terminalGlobalSettings=window.termaTerminalSettingsModel.normalize(window.termaTerminalSettingsModel.defaults);
    const originalApi=api;api=async(route,options={})=>{
      if(route==='/api/runtime-settings'&&options.method==='PUT'){
        window.__terminalSettingsWrites.push(JSON.parse(options.body));
        if(window.__terminalSettingsSaveMode==='error')throw Error('Fixture save failure');
        if(window.__terminalSettingsSaveMode==='pending')await new Promise(resolve=>window.__terminalSettingsComplete=resolve);
        if(window.__terminalSettingsSaveMode==='pending-error')await new Promise((_resolve,reject)=>window.__terminalSettingsReject=()=>reject(Error('Late fixture save failure')));
        return {saved:{terminal:window.termaTerminalSettingsModel.normalize(JSON.parse(options.body).terminal)}};
      }
      if(options.method&&options.method!=='GET')throw Error('Unexpected mutation '+route);
      return originalApi(route,options);
    };
    notify=(message,type)=>window.__terminalSettingsNotices.push({message,type});
    window.__terminalOriginalFocus=window.termaTerminalSurface.focus;
    window.termaTerminalSurface.focus=key=>window.__terminalFocus.push(key);
    window.__clipboardOriginalTab=activeTabKey;
    window.__clipboardOriginalTrack=window.termaTerminalCommandTracking.trackCommand;
    window.termaTerminalCommandTracking.trackCommand=(session,data,options)=>window.__clipboardTracked.push({key:session.key,data,options});
    window.__clipboardOriginalDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
    window.__clipboardInput='clipboard text';window.__clipboardSent=[];window.__clipboardTracked=[];
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:()=>Promise.resolve(window.__clipboardInput)}});
    window.__clipboardSession=(key,extra={})=>({
      key,id:733,connected:true,connection:{id:733},connectionAttempt:1,
      socket:{readyState:WebSocket.OPEN,send:data=>window.__clipboardSent.push({key,data})},
      term:{hasSelection:()=>true,getSelection:()=>'',focus:()=>window.__terminalFocus.push(key)},
      ...extra
    });
    window.__resetClipboardFixture=()=>{
      window.termaTerminalState.terminalSessions.set('fixture-clipboard-origin',window.__clipboardSession('fixture-clipboard-origin'));
      activeTabKey='fixture-clipboard-origin';window.__clipboardSent=[];window.__clipboardTracked=[];window.__clipboardOutcome='pending';
      terminalGlobalSettings=window.termaTerminalSettingsModel.normalize({...window.termaTerminalSettingsModel.defaults,multiline_paste_mode:'prompt'});
    };
    window.__fillTerminalField=(id,value)=>{const field=$(id);if(typeof value==='boolean'){field.checked=value;field.dispatchEvent(new Event('change',{bubbles:true}));}else{field.value=value;field.dispatchEvent(new Event(field.tagName==='SELECT'?'change':'input',{bubbles:true}));}};
  `);
  for(const width of [1200,390])for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']) {
    const prefix=`${language}-${theme}-${width}`;
    browser.setContentSize(width,844);
    await execute(`closeModal();applyTheme('${theme}');await setTermaLanguage('${language}');terminalGlobalSettings=window.termaTerminalSettingsModel.normalize(window.termaTerminalSettingsModel.defaults);$('modal').innerHTML='<div class="modal-card" data-legacy-terminal-fixture>Old dialog</div>';await window.termaTerminalSettings.open('fixture-terminal-left');`);
    await check(`${prefix} single owner clears legacy modal`, `$('modal').querySelectorAll('.modal-card').length===1&&!$('modal').querySelector('[data-legacy-terminal-fixture]')&&$('modal').dataset.terminalDialog==='settings'`);
    await check(`${prefix} settings use shared defaults`, `window.termaTerminalSettingsModel.defaults.shortcut_keys.length===21&&Object.isFrozen(window.termaTerminalSettingsModel.defaults.shortcut_keys)`);
    await layout(`${prefix} appearance`); await shot(`${prefix}-appearance`);
    await execute(`window.termaTerminalViews.fillSettings({...window.termaTerminalSettingsModel.defaults,font_size:18,url_links_enabled:false,word_separators:'-_',shortcut_keys:[]});window.termaTerminalViews.selectBackground('#123456');`);
    await check(`${prefix} compatibility fill and background use the Vue draft`, `window.termaTerminalViews.readSettings().font_size===18&&window.termaTerminalViews.readSettings().url_links_enabled===false&&window.termaTerminalViews.readSettings().word_separators==='-_'&&(window.termaTerminalViews?.readShortcuts() || []).length===0&&window.termaTerminalViews.selectedBackgroundMode()==='custom'&&$('terminalSettingBackgroundColor').value==='#123456'&&window.termaTerminalSettings.current().font_size===13`);
    await shot(`${prefix}-compatibility-form`);
    await execute(`window.termaTerminalViews.fillSettings(window.termaTerminalSettingsModel.defaults);`);
    await check(`${prefix} compatibility reset restores one draft`, `window.termaTerminalViews.readSettings().font_size===13&&window.termaTerminalViews.readSettings().url_links_enabled&&window.termaTerminalViews.readSettings().word_separators===window.termaTerminalSettingsModel.defaults.word_separators&&(window.termaTerminalViews?.readShortcuts() || []).length===21&&window.termaTerminalViews.selectedBackgroundMode()==='theme'`);
    await execute(`__fillTerminalField('terminalSettingFontFamily','Draft Mono');$('terminalSettingFontFamily').focus();$('terminalSettingFontFamily').setSelectionRange(2,7);window.__field=$('terminalSettingFontFamily');await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}');`);
    await check(`${prefix} locale preserves input, focus and selection`, `$('terminalSettingFontFamily')===window.__field&&window.__field.value==='Draft Mono'&&document.activeElement===window.__field&&window.__field.selectionStart===2&&window.__field.selectionEnd===7`);
    await check(`${prefix} mouse options translate from the shared IDs`, `[...$('terminalSettingMiddleMouse').options].every((option,index)=>{const [value,label]=window.termaTerminalSettingsModel.mouseOptions()[index];return option.value===value&&option.textContent===label;})`);
    await shot(`${prefix}-appearance-live-locale`);
    await execute(`await setTermaLanguage('${language}');`);
    for(const mode of ['black','white','custom','theme']) {
      await execute(`const field=document.querySelector('input[name=terminalSettingBackgroundMode][value=${mode}]');field.checked=true;field.dispatchEvent(new Event('change',{bubbles:true}));${mode==='custom'?"__fillTerminalField('terminalSettingBackgroundColor','#808080');":''}`);
      await check(`${prefix} ${mode} preview`, `window.termaTerminalViews.selectedBackgroundMode()==='${mode}'&&window.termaTerminalViews.readSettings().background_mode==='${mode}'&&getComputedStyle($('terminalBackgroundPreview')).color!==getComputedStyle($('terminalBackgroundPreview')).backgroundColor`);
      await check(`${prefix} ${mode} model and rendered colors agree`, `(()=>{
        const values=window.termaTerminalViews.readSettings(),model=window.termaTerminalSettingsModel,colors=model.theme(values);
        const expected='${mode}'==='custom'?'#808080':'${mode}'==='black'?'#000000':'${mode}'==='white'?'#ffffff':'${theme}'==='dark'?'#000000':'#ffffff';
        const swatch=document.createElement('span');swatch.style.color=colors.background;document.body.appendChild(swatch);
        const rendered=getComputedStyle(swatch).color;swatch.remove();
        return colors.background===expected&&getComputedStyle($('terminalBackgroundPreview')).backgroundColor===rendered
          &&['foreground','red','green','blue','cyan'].every(name=>model.contrast(colors[name],colors.background)>=4.5);
      })()`);
      await shot(`${prefix}-background-${mode}`);
    }
    await execute(`$('terminalSettingFontFamily').focus();$('terminalSettingFontFamily').setSelectionRange(1,6);window.__themeField=$('terminalSettingFontFamily');applyTheme('${theme==='dark'?'light':'dark'}');`);
    await check(`${prefix} live theme retains draft focus and selection`, `$('terminalSettingFontFamily')===window.__themeField&&window.__themeField.value==='Draft Mono'&&document.activeElement===window.__themeField&&window.__themeField.selectionStart===1&&window.__themeField.selectionEnd===6&&window.termaTerminalSettingsModel.theme(window.termaTerminalViews.readSettings()).background==='${theme==='dark'?'#ffffff':'#000000'}'`);
    await shot(`${prefix}-live-theme`);
    await execute(`applyTheme('${theme}');`);
    for(const [name,suffix] of [['interaction','Interaction'],['clipboard','Clipboard'],['shortcuts','Shortcuts']]) {
      await click(`#terminalSettingsTab${suffix}`); await layout(`${prefix} ${name}`); await shot(`${prefix}-${name}`);
      await execute(`const panel=$('modal').querySelector('.terminal-settings-panels');panel.scrollTop=panel.scrollHeight;await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}');`);
      await check(`${prefix} ${name} remains selected on locale`, `$('terminalSettingsTab${suffix}').getAttribute('aria-selected')==='true'&&$('terminalSettingFontFamily').value==='Draft Mono'`);
      await layout(`${prefix} ${name} live locale`);
      await shot(`${prefix}-${name}-live-locale`);
      await execute(`await setTermaLanguage('${language}');`);
    }
    await execute(`window.termaTerminalViews.selectTab('interaction');__fillTerminalField('terminalSettingUrlLinks',false);`);
    await check(`${prefix} URL disabled state`, `$('terminalSettingUrlPrefixes').disabled&&$('terminalSettingUrlCtrlClick').disabled`);
    await shot(`${prefix}-links-disabled`);
    await execute(`window.termaTerminalViews.selectTab('clipboard');__fillTerminalField('terminalSettingWordSeparators','-_');__fillTerminalField('terminalSettingAutoCopy',true);window.termaTerminalViews.resetSeparators();`);
    await check(`${prefix} separator reset only`, `$('terminalSettingWordSeparators').value===window.termaTerminalSettingsModel.defaults.word_separators&&$('terminalSettingAutoCopy').checked`);
    await execute(`window.termaTerminalViews.selectTab('shortcuts');window.termaTerminalViews?.fillShortcuts([]);`);
    await shot(`${prefix}-shortcuts-empty`);
    await execute(`__fillTerminalField('terminalShortcutKey','custom');__fillTerminalField('terminalShortcutCharacter','文');`);
    await click('#terminalShortcutAdd');
    await check(`${prefix} shortcut validation`, `!$('terminalShortcutError').hidden&&(window.termaTerminalViews?.readShortcuts() || []).length===0`);
    await shot(`${prefix}-shortcuts-invalid`);
    await execute(`__fillTerminalField('terminalShortcutCharacter','x');__fillTerminalField('terminalShortcutLabel','Review');__fillTerminalField('terminalShortcutCtrl',true);`);
    await click('#terminalShortcutAdd');
    await execute(`__fillTerminalField('terminalShortcutKey','F5');__fillTerminalField('terminalShortcutCtrl',false);__fillTerminalField('terminalShortcutLabel','Second');window.termaTerminalViews?.addShortcut();window.termaTerminalViews?.editShortcut(1,'up');`);
    await check(`${prefix} shortcut add reorder draft isolation`, `window.termaTerminalViews?.readShortcuts()[0].label==='Second'&&window.termaTerminalViews?.readShortcuts()[1].label==='Review'&&window.termaTerminalSettings.current().shortcut_keys.length===21`);
    await shot(`${prefix}-shortcuts-edited`);
    await execute(`window.__shortcutDraft=window.termaTerminalViews?.readShortcuts();window.termaTerminalViews?.fillShortcuts(Array.from({length:48},()=>({key:'F5'})));window.termaTerminalViews?.addShortcut();`);
    await check(`${prefix} shortcut limit rejects a forty-ninth draft row`, `(window.termaTerminalViews?.readShortcuts() || []).length===48&&$('terminalShortcutAdd').disabled&&!$('terminalShortcutError').hidden&&window.termaTerminalSettings.current().shortcut_keys.length===21`);
    await layout(`${prefix} shortcut limit`); await shot(`${prefix}-shortcuts-limit`);
    await execute(`window.termaTerminalViews?.fillShortcuts(window.__shortcutDraft);`);
    await execute(`const label=$('terminalShortcutRows').querySelector('[data-shortcut-label="0"]');label.value='Unsafe <img src=x onerror=alert(1)>';label.dispatchEvent(new Event('input',{bubbles:true}));await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}');`);
    await check(`${prefix} user shortcut text stays literal`, `!$('modal').querySelector('img')&&$('terminalShortcutRows').querySelector('input[data-shortcut-label="0"]').value.includes('<img')`);
    await execute(`await setTermaLanguage('${language}');$('terminalShortcutRows').querySelector('input[data-shortcut-label="0"]').value='Second';`);
    const hover = await execute(`const tab=$('terminalSettingsTabShortcuts'),r=tab.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),before:getComputedStyle(tab).backgroundColor}`);
    browser.webContents.sendInputEvent({type:'mouseMove',x:hover.x,y:hover.y});await delay(40);
    assert.equal(await execute(`return getComputedStyle($('terminalSettingsTabShortcuts')).backgroundColor`),hover.before,`${prefix} active tab stays blue on hover`);
    await shot(`${prefix}-selected-hover`);
    await execute(`$('terminalSettingsTabShortcuts').focus();`);await key('RIGHT');
    await check(`${prefix} keyboard tab navigation`, `$('terminalSettingsTabAppearance').getAttribute('aria-selected')==='true'&&document.activeElement===$('terminalSettingsTabAppearance')`);
    await shot(`${prefix}-keyboard-tabs`);
    await execute(`$('modal').querySelector('.dialog-window-resize').focus();`);await key('Tab');
    await check(`${prefix} focus stays in dialog`, `document.activeElement===$('modal').querySelector('button')`);
    await execute(`__fillTerminalField('terminalSettingFontSize','99');window.__writeCount=__terminalSettingsWrites.length;`);
    await click('#terminalSettingsSave');
    await check(`${prefix} invalid values never save`, `!$('modal').hidden&&__terminalSettingsWrites.length===window.__writeCount`);
    await check(`${prefix} model validation uses the active language`, `__terminalSettingsNotices.at(-1).message===tr('terminal:settings.invalid_font_size')`);
    await check(`${prefix} invalid size keeps the raw draft and safe preview`, `$('terminalSettingFontSize').value==='99'&&getComputedStyle($('terminalBackgroundPreview')).fontSize===window.termaTerminalSettingsModel.defaults.font_size+'px'`);
    await layout(`${prefix} invalid setting`);
    await shot(`${prefix}-invalid-setting`);
    await execute(`__fillTerminalField('terminalSettingFontSize','16');window.__terminalSettingsSaveMode='error';`);
    await click('#terminalSettingsSave');
    await check(`${prefix} failed save preserves draft`, `!$('modal').hidden&&$('terminalSettingFontSize').value==='16'&&!$('terminalSettingsSave').disabled&&__terminalSettingsNotices.at(-1).message==='Fixture save failure'`);
    await shot(`${prefix}-save-failure`);
    await execute(`window.__terminalSettingsSaveMode='pending';`);await click('#terminalSettingsSave');
    await check(`${prefix} pending save blocks editing and cancellation`, `$('terminalSettingsSave').disabled&&$('modal').querySelector('fieldset').disabled`);
    await execute(`window.__busyWriteCount=__terminalSettingsWrites.length;window.termaTerminalViews.closeSettings();void window.termaTerminalViews.saveSettings();`);
    await check(`${prefix} compatibility close and duplicate save respect busy owner`, `!$('modal').hidden&&__terminalSettingsWrites.length===window.__busyWriteCount`);
    await key('Escape');await check(`${prefix} Escape cannot dismiss pending save`, `!$('modal').hidden`);await shot(`${prefix}-save-pending`);
    await execute(`window.__terminalSettingsComplete();`);await delay(80);
    await check(`${prefix} successful save closes and applies`, `$('modal').hidden&&window.termaTerminalSettings.current().font_family==='Draft Mono'&&window.termaTerminalSettings.current().font_size===16&&window.termaTerminalSettings.current().shortcut_keys[0].label==='Second'`);
    await execute(`window.__clipboardSent=[];window.termaTerminalState.terminalSessions.set('fixture-config-shortcut',window.__clipboardSession('fixture-config-shortcut',{term:{modes:{applicationCursorKeysMode:true},focus(){}}}));window.termaTerminalKeysService.sendShortcut('fixture-config-shortcut',0);window.termaTerminalKeysService.sendShortcut('fixture-config-shortcut',1);window.termaTerminalKeysService.sendShortcut('fixture-config-shortcut',99);window.termaTerminalState.terminalSessions.delete('fixture-config-shortcut');`);
    await check(`${prefix} saved shortcut dispatch uses canonical sequences`, `__clipboardSent.length===2&&__clipboardSent.every(item=>item.key==='fixture-config-shortcut')&&__clipboardSent[0].data==='\\x1b[15~'&&__clipboardSent[1].data==='\\x18'`);
    await execute(`window.__terminalSettingsSaveMode='success';await window.termaTerminalSettings.open('fixture-terminal-right');__fillTerminalField('terminalSettingFontFamily','Discard');window.__writeCount=__terminalSettingsWrites.length;`);
    await key('Escape');await check(`${prefix} cancel never saves`, `$('modal').hidden&&__terminalSettingsWrites.length===window.__writeCount&&window.termaTerminalSettings.current().font_family==='Draft Mono'&&window.__terminalFocus.at(-1)==='fixture-terminal-right'`);
    await execute(`window.__pasteOutcome='pending';void window.termaTerminalClipboard.prompt('first\\r\\nsecond').then(value=>window.__pasteOutcome=value);`);
    await layout(`${prefix} paste`);await shot(`${prefix}-paste`);
    await execute(`__fillTerminalField('terminalPasteEditor','edited\\nsecond');$('terminalPasteEditor').focus();$('terminalPasteEditor').setSelectionRange(1,5);window.__pasteNode=$('terminalPasteEditor');await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}');`);
    await check(`${prefix} paste live locale preserves draft and selection`, `$('terminalPasteEditor')===window.__pasteNode&&document.activeElement===window.__pasteNode&&window.__pasteNode.selectionStart===1&&window.__pasteNode.selectionEnd===5&&window.__pasteNode.value==='edited\\nsecond'`);
    await shot(`${prefix}-paste-live-locale`);
    await execute(`await setTermaLanguage('${language}');$('modal').click();`);await check(`${prefix} backdrop leaves paste open`, `!$('modal').hidden&&window.__pasteOutcome==='pending'`);
    await click('#terminalPasteSingleLine');
    await check(`${prefix} merge returns text and clears node`, `window.__pasteOutcome==='edited second'&&window.__pasteNode.value===''&&$('modal').hidden`);
    await execute(`window.__pasteOutcome='pending';void window.termaTerminalClipboard.prompt('line1\\nline2').then(value=>window.__pasteOutcome=value);`);
    await key('Enter',['control']);await check(`${prefix} Ctrl Enter confirms`, `window.__pasteOutcome==='line1\\nline2'&&$('modal').hidden`);
    await execute(`window.__pasteOutcome='pending';void window.termaTerminalClipboard.prompt('discard').then(value=>window.__pasteOutcome=value);window.__pasteNode=$('terminalPasteEditor');`);
    await key('Escape');await check(`${prefix} Escape cancels and clears`, `window.__pasteOutcome===null&&window.__pasteNode.value===''&&$('modal').hidden`);
    await execute(`window.__pasteOutcome='pending';void window.termaTerminalClipboard.prompt('handoff').then(value=>window.__pasteOutcome=value);void window.termaQuickViews.openQuickConnectionLauncher();`);
    await delay(70);await check(`${prefix} handoff cancels pending paste`, `window.__pasteOutcome===null&&!$('modal').querySelector('#terminalPasteEditor')&&!!$('modal').querySelector('#quickConnectionSearch')`);
    await execute(`window.__replacement=$('quickConnectionSearch');window.__writeCount=__terminalSettingsWrites.length;window.__focusCount=__terminalFocus.length;window.termaTerminalViews.selectTab('clipboard');window.termaTerminalViews.selectBackground('#112233');if(window.termaTerminalViews.settingsActive()) window.termaTerminalViews.refreshSettings();window.termaTerminalViews.resetSeparators();window.termaTerminalViews.fillSettings({font_size:99});window.termaTerminalViews.fillSettings(window.termaTerminalSettingsModel.defaults);window.termaTerminalViews?.fillShortcuts([]);window.termaTerminalViews?.refreshSettings();window.termaTerminalViews?.editShortcut(0,'remove');window.termaTerminalViews?.refreshSettings();window.termaTerminalViews?.addShortcut();await window.termaTerminalViews.saveSettings();window.termaTerminalViews.closeSettings();`);
    await check(`${prefix} inactive compatibility helpers preserve the replacement`, `!$('modal').hidden&&$('quickConnectionSearch')===window.__replacement&&__terminalSettingsWrites.length===window.__writeCount&&__terminalFocus.length===window.__focusCount&&window.termaTerminalViews.readSettings()===undefined&&(window.termaTerminalViews?.readShortcuts() || []).length===0&&window.termaTerminalViews.selectedBackgroundMode()==='theme'`);
    await execute(`await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}');`);await check(`${prefix} locale never revives old dialog`, `!$('modal').querySelector('#terminalPasteEditor')&&!$('modal').querySelector('#terminalSettingsTitle')`);
    await shot(`${prefix}-quick-handoff`);
    await execute(`closeModal();await setTermaLanguage('${language}');await window.termaTerminalSettings.open('fixture-terminal-left');__fillTerminalField('terminalSettingFontFamily','Transient');window.__terminalSettingsSaveMode='pending';void window.termaTerminalViews.saveSettings();void window.termaQuickViews.openQuickConnectionLauncher();`);
    await delay(70);await execute(`window.__terminalSettingsComplete();`);await delay(70);
    await check(`${prefix} late save cannot close replacement dialog`, `!$('modal').hidden&&!!$('quickConnectionSearch')&&!$('modal').querySelector('#terminalSettingsTitle')`);
    await execute(`window.__terminalSettingsSaveMode='success';closeModal();`);
    await execute(`window.__terminalSettingsSaveMode='pending-error';window.__noticeCount=__terminalSettingsNotices.length;await window.termaTerminalSettings.open('fixture-terminal-left');void window.termaTerminalViews.saveSettings();void window.termaQuickViews.openQuickConnectionLauncher();`);
    await delay(70);await execute(`window.__terminalSettingsReject();`);await delay(70);
    await check(`${prefix} late save failure cannot affect replacement dialog`, `!$('modal').hidden&&!!$('quickConnectionSearch')&&!$('modal').querySelector('#terminalSettingsTitle')&&__terminalSettingsNotices.length===window.__noticeCount`);
    await shot(`${prefix}-late-save-failure-handoff`);
    await execute(`window.__terminalSettingsSaveMode='success';closeModal();`);
    await execute(`__resetClipboardFixture();void window.termaTerminalClipboard.send('fixture-clipboard-origin','first\\r\\nsecond').then(value=>window.__clipboardOutcome=value);`);
    await layout(`${prefix} send paste editor`);await shot(`${prefix}-clipboard-confirm`);
    await execute(`__fillTerminalField('terminalPasteEditor','edited\\nsecond');activeTabKey='fixture-clipboard-other';window.__clipboardFocusCount=__terminalFocus.length;`);
    await click('#terminalPasteConfirm');
    await check(`${prefix} tab switch keeps the originating send and command tracking`, `window.__clipboardOutcome===true&&__clipboardSent.length===1&&__clipboardSent[0].key==='fixture-clipboard-origin'&&__clipboardSent[0].data==='edited\\rsecond'&&__clipboardTracked.length===1&&__clipboardTracked[0].key==='fixture-clipboard-origin'&&__clipboardTracked[0].data==='edited\\rsecond'&&__clipboardTracked[0].options.source==='paste'&&__terminalFocus.length===window.__clipboardFocusCount`);
    for(const mode of ['paste','single_line']) {
      await execute(`__resetClipboardFixture();terminalGlobalSettings.multiline_paste_mode='${mode}';window.__clipboardInput=' first\\r\\n second ';window.__clipboardOutcome=await window.termaTerminalPage.pasteTerminalText('fixture-clipboard-origin');`);
      await check(`${prefix} browser clipboard ${mode}`, `window.__clipboardOutcome===true&&__clipboardSent.length===1&&__clipboardSent[0].data===${JSON.stringify(mode==='paste'?' first\r second ':'first second')}&&$('modal').hidden`);
    }
    for(const mutation of ['close','reconnect','replace']) {
      await execute(`__resetClipboardFixture();void window.termaTerminalClipboard.send('fixture-clipboard-origin','first\\nsecond').then(value=>window.__clipboardOutcome=value);window.__clipboardFocusCount=__terminalFocus.length;window.__clipboardNoticeCount=__terminalSettingsNotices.length;`);
      await layout(`${prefix} ${mutation} while paste pending`);
      await shot(`${prefix}-clipboard-pending-${mutation}`);
      await execute(`${mutation==='close'?"window.termaTerminalState.terminalSessions.delete('fixture-clipboard-origin');":mutation==='reconnect'?"window.termaTerminalState.terminalSessions.get('fixture-clipboard-origin').connectionAttempt++;":"window.termaTerminalState.terminalSessions.set('fixture-clipboard-origin',{...window.termaTerminalState.terminalSessions.get('fixture-clipboard-origin')});"}`);
      await click('#terminalPasteConfirm');
      await check(`${prefix} ${mutation} rejects stale confirmed text`, `window.__clipboardOutcome===false&&!__clipboardSent.length&&__terminalFocus.length===window.__clipboardFocusCount&&__terminalSettingsNotices.length===window.__clipboardNoticeCount&&$('modal').hidden`);
    }
    await execute(`__resetClipboardFixture();void window.termaTerminalClipboard.send('fixture-clipboard-origin','first\\nsecond').then(value=>window.__clipboardOutcome=value);__fillTerminalField('terminalPasteEditor','');`);
    await shot(`${prefix}-clipboard-empty`);
    await click('#terminalPasteConfirm');
    await check(`${prefix} empty confirmed text never sends`, `window.__clipboardOutcome===false&&!__clipboardSent.length&&__terminalSettingsNotices.at(-1).message===tr('terminal:settings.paste_empty')`);
    await execute(`__resetClipboardFixture();void window.termaTerminalClipboard.send('fixture-clipboard-origin','first\\nsecond').then(value=>window.__clipboardOutcome=value);activeTabKey='fixture-clipboard-other';window.__clipboardFocusCount=__terminalFocus.length;`);
    await key('Escape');
    await check(`${prefix} switched-tab cancellation preserves focus`, `window.__clipboardOutcome===false&&!__clipboardSent.length&&__terminalFocus.length===window.__clipboardFocusCount`);
    await execute(`__resetClipboardFixture();void window.termaTerminalClipboard.send('fixture-clipboard-origin','first\\nsecond').then(value=>window.__clipboardOutcome=value);window.__clipboardFocusCount=__terminalFocus.length;void window.termaQuickViews.openQuickConnectionLauncher();`);
    await delay(70);
    await check(`${prefix} pending paste handoff preserves replacement focus`, `window.__clipboardOutcome===false&&!__clipboardSent.length&&__terminalFocus.length===window.__clipboardFocusCount&&!!$('quickConnectionSearch')`);
    await shot(`${prefix}-clipboard-handoff`);
    await execute(`closeModal();window.termaTerminalState.terminalSessions.delete('fixture-clipboard-origin');activeTabKey=window.__clipboardOriginalTab;`);
    await execute(`
      const originalApi=api;terminalGlobalSettings=null;
      window.__finishSettingsLoad=null;
      api=(route,options={})=>route==='/api/runtime-settings'&&!options.method
        ?new Promise(resolve=>window.__finishSettingsLoad=()=>resolve({terminal:window.termaTerminalSettingsModel.normalize(window.termaTerminalSettingsModel.defaults)}))
        :originalApi(route,options);
      try {
        window.__settingsOpening=window.termaTerminalSettings.open('fixture-delayed');
        const deadline=Date.now()+3000;
        while(!window.__finishSettingsLoad){if(Date.now()>deadline)throw Error('Settings read did not start');await new Promise(resolve=>setTimeout(resolve,10));}
        await window.termaQuickViews.openQuickConnectionLauncher();
        const search=$('quickConnectionSearch');
        search.value='handoff-fixture';search.dispatchEvent(new Event('input',{bubbles:true}));search.focus();
        window.__settingsHandoffCard=search.closest('.modal-card');
        window.__settingsHandoffSearch=search;
        window.__finishSettingsLoad();await window.__settingsOpening;
      } finally {api=originalApi;}
    `);
    await check(`${prefix} late settings load cannot replace Quick Connect`, `!!$('quickConnectionSearch')&&!$('modal').querySelector('#terminalSettingsTitle')`);
    await check(`${prefix} late settings load retains replacement draft focus and geometry`, `(()=>{
      const search=$('quickConnectionSearch'),card=search.closest('.modal-card'),rect=card.getBoundingClientRect();
      return search===window.__settingsHandoffSearch&&card===window.__settingsHandoffCard
        &&search.value==='handoff-fixture'&&document.activeElement===search
        &&rect.left>=0&&rect.top>=0&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1;
    })()`);
    await execute(`await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
    const handoffLayout = await execute(`
      const table=document.querySelector('.quick-connection-table'),bounds=table.getBoundingClientRect();
      const rows=[...table.querySelectorAll('.quick-connection-target-row')];
      return {rowCount:rows.length,tableFits:table.scrollWidth<=table.clientWidth+1,rows:rows.map(button=>{
        const rect=button.getBoundingClientRect(),copy=button.children[1].getBoundingClientRect();
        const icon=button.querySelector('.quick-result-icon svg').getBoundingClientRect();
        return {fits:rect.left>=bounds.left&&rect.right<=bounds.right+1
          &&rect.top>=0&&rect.bottom<=innerHeight+1&&button.scrollWidth<=button.clientWidth+1,
          iconInset:icon.left-rect.left,textInset:copy.left-rect.left,separated:icon.right<copy.left};
      })};
    `);
    checks.push({name:`${prefix} late settings handoff target layout`,...handoffLayout});
    assert.equal(handoffLayout.rowCount, 2, `${prefix} handoff target count ${JSON.stringify(handoffLayout)}`);
    assert.equal(handoffLayout.tableFits, true, `${prefix} handoff table fits ${JSON.stringify(handoffLayout)}`);
    for (const row of handoffLayout.rows) {
      assert.ok(row.fits&&row.iconInset<=24&&row.textInset<=60&&row.separated, `${prefix} handoff row fits ${JSON.stringify(handoffLayout)}`);
    }
    await shot(`${prefix}-settings-load-handoff`);
    await execute(`closeModal();`);
  }
  await execute(`closeModal();window.termaTerminalSurface.focus=window.__terminalOriginalFocus;window.termaTerminalCommandTracking.trackCommand=window.__clipboardOriginalTrack;activeTabKey=window.__clipboardOriginalTab;if(window.__clipboardOriginalDescriptor)Object.defineProperty(navigator,'clipboard',window.__clipboardOriginalDescriptor);else delete navigator.clipboard;`);
  const report={directory,checks:checks.length,assertions:checks,states,realTransport:false};
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  return {directory,checks:checks.length,states:states.length};
}
module.exports={runTerminalSettingsUiScenario};
