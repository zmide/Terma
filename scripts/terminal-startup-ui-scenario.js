const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Disposable browser exercises the production dialog with bounded API/tab action fixtures.
async function runTerminalStartupUiScenario(browser) {
  const ownsDebugger = !browser.webContents.debugger.isAttached();
  if (ownsDebugger) browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {enabled:true});
  try {
  const directory = path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR || path.join(process.cwd(),'data'), 'terminal-startup-visual');
  fs.mkdirSync(directory,{recursive:true});
  const execute = source => browser.webContents.executeJavaScript(`(async()=>{${source}})()`);
  const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
  const checks=[], states=[];
  const shot = async name => {
    await delay(70);browser.webContents.invalidate();
    fs.writeFileSync(path.join(directory,`${name}.png`),(await browser.webContents.capturePage()).toPNG());states.push(name);
  };
  const check = async (name,expression) => {
    const result=await execute(`return (${expression})`);checks.push({name,result});
    if(!result){
      console.log('[startup layout diagnostic]',await execute(`const card=$('modal').querySelector('.terminal-startup-modal');if(!card)return null;const elements=[...card.querySelectorAll('*')],text=document.createTreeWalker(card,NodeFilter.SHOW_TEXT);let han=[];while(text.nextNode())if(/[\\u3400-\\u9fff]/.test(text.currentNode.textContent))han.push(text.currentNode.textContent);const failures=elements.filter(el=>el.tagName==='BUTTON'&&el.checkVisibility()).flatMap(el=>{const b=el.getBoundingClientRect();return [...el.querySelectorAll('svg,span')].filter(node=>node.checkVisibility()).flatMap(node=>{const q=node.getBoundingClientRect();return q.left<b.left-1||q.right>b.right+1||q.top<b.top-1||q.bottom>b.bottom+1||node.scrollWidth>node.clientWidth+2?[{button:el.textContent,child:node.className,rect:[q.x,q.y,q.width,q.height],buttonRect:[b.x,b.y,b.width,b.height],scroll:node.scrollWidth,client:node.clientWidth}]:[]})});return {han,failures,card:[card.scrollWidth,card.clientWidth]};`));
      console.log('[terminal-startup failure]',name,await execute(`const el=document.activeElement,s=el&&getComputedStyle(el),drawer=$('sftpTaskCenterDrawer'),button=$('sftpTaskCenterButton');return {active:el?.id,visible:el?.matches(':focus-visible'),hasFocus:document.hasFocus(),outline:s?.outline,inside:$('modal').contains(el),busy:window.termaTerminalViews.startupOptions()?.busy,drawer:drawer&&{hidden:drawer.hidden,display:getComputedStyle(drawer).display,rect:[drawer.getBoundingClientRect().x,drawer.getBoundingClientRect().y,drawer.getBoundingClientRect().width,drawer.getBoundingClientRect().height],parent:drawer.parentElement?.id,open:document.body.classList.contains('sftp-task-center-open')},button:button&&{hidden:button.hidden,display:getComputedStyle(button).display},notices:window.__startupNotices,opened:window.__startupOpened,clicks:window.__startupClicks};`));
      await shot('failure');
    }
    assert.equal(result,true,name);
  };
  const point = selector => execute(`const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.checkVisibility());if(!el)throw Error('Missing '+${JSON.stringify(selector)});el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const b=el.getBoundingClientRect(),p={x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)},hit=document.elementFromPoint(p.x,p.y);if(hit!==el&&!el.contains(hit))throw Error('Covered '+${JSON.stringify(selector)});return p`);
  const hover = async selector => {
    browser.webContents.sendInputEvent({type:'mouseMove',x:5,y:5});await delay(160);
    browser.webContents.sendInputEvent({type:'mouseMove',...await point(selector)});await delay(160);
  };
  const click = async selector => {
    const p=await point(selector);
    for(const type of ['mouseMove','mouseDown','mouseUp']){browser.webContents.sendInputEvent({type,...p,button:'left',clickCount:1});await delay(20);}
    await delay(70);
  };
  const key = async keyCode => {
    browser.webContents.focus();
    for(const type of ['keyDown','keyUp'])browser.webContents.sendInputEvent({type,keyCode});await delay(40);
  };
  const layout = async prefix => {
    await check(`${prefix} controls fit and English hidden DOM is translated`, `(()=>{const card=$('modal').querySelector('.terminal-startup-modal'),r=card.getBoundingClientRect(),elements=[...card.querySelectorAll('*')],chrome=[card.textContent,...elements.flatMap(el=>[el.title,el.getAttribute('aria-label'),el.placeholder])].join(' ');return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&card.scrollWidth<=card.clientWidth+1&&elements.filter(el=>el.tagName==='BUTTON'&&el.checkVisibility()).every(el=>{const b=el.getBoundingClientRect();return b.left>=r.left-1&&b.right<=r.right+1&&el.scrollWidth<=el.clientWidth+2&&[...el.querySelectorAll('svg,span')].filter(node=>node.checkVisibility()).every(node=>{const q=node.getBoundingClientRect();return q.left>=b.left-1&&q.right<=b.right+1&&q.top>=b.top-1&&q.bottom<=b.bottom+1&&node.scrollWidth<=node.clientWidth+2})})&&(document.documentElement.lang!=='en-US'||!/[\\u3400-\\u9fff]/.test(chrome))})()`);
  };
  await execute(`
    await window.termaI18nReady;while(window.workspaceRestorePending||window.termaWorkspaceRefresh.loading)await new Promise(r=>setTimeout(r,20));
    window.termaWorkspaceRefresh.stop();restoringTabs=true;
    window.__startupKey='startup-service-fixture';window.__startupId=909191;
    window.__startupConnection={id:__startupId,name:'Fixture Shell',group_name:'Fixture',ssh_user:'fixture',ssh_host:'fixture.invalid',ssh_port:22,terminal_startup_mode:'default'};
    connections.push(__startupConnection);tabs.push({key:__startupKey,kind:'terminal',id:__startupId,title:'Fixture Shell'});
    window.__startupWrites=[];window.__startupOpened=[];window.__startupNotices=[];window.__startupMode='success';
    window.__startupClicks=[];for(const name of ['mousedown','mouseup','click'])document.addEventListener(name,event=>{const b=event.target.closest('button'),top=document.querySelector('#modal [data-split-zone="top"]'),r=top?.getBoundingClientRect();__startupClicks.push({name,id:b?.id,zone:b?.dataset.splitZone,disabled:b?.disabled,point:[event.clientX,event.clientY],top:r&&[r.x,r.y,r.width,r.height],transform:top&&getComputedStyle(top).transform,scroll:$('modal').scrollTop});},true);
    const originalApi=api;api=async(route,options={})=>{
      if(window.__componentMode){
        if(route==='/api/identity-files'){
          if(__componentMode==='pending-identities')await new Promise(resolve=>window.__componentFinishIdentities=resolve);
          return [];
        }
        if(route==='/api/ssh/preflight')return {ok:true};
        if(route==='/api/admin-grants')return {admin_grant:{id:'fixture-component-grant',reuse_policy:'once'}};
        if(route==='/api/remote-component/tasks')return Object.values(__componentTasks);
        if(route.startsWith('/api/remote-component/tasks/component-fixture-'))return __componentTasks[route.split('/').at(-1)];
        if(route==='/api/connections/'+__startupId+'/terminal-session-components'){
          if(options.method==='POST'){
            const body=JSON.parse(options.body);__componentWrites.push(body);
            if(__componentMode==='post-error')throw Error('Fixture component failure');
            if(__componentMode==='pending-post')await new Promise(resolve=>window.__componentFinishPost=resolve);
            const id='component-fixture-'+(++__componentTaskSerial),task={id,connection_id:__startupId,status:'running',component:'terminal-session-'+body.component,component_label:body.component+' 会话管理器',action:body.action,action_label:'在线安装',stage:'install',progress:42,logs:[{at:Date.now(),text:'Fixture package output <img src=x onerror=alert(1)>'}]};
            __componentTasks[id]=task;return {task};
          }
          if(__componentMode==='component-error')throw Error('Fixture component probe failure');
          return {supported:__componentMode!=='component-unsupported',root:__componentRoot,components:__componentMode==='component-empty'?{}:{tmux:{label:'tmux fixture',installed:__componentInstalled,version:__componentInstalled?'3.4':'',install_plan:__componentPlan,uninstall_plan:{available:__componentInstalled}},screen:{label:'GNU screen fixture',installed:true,version:'4.9',active_sessions:0,uninstall_plan:{available:true},install_plan:__componentPlan}}};
        }
      }
      if(route==='/api/connections/'+__startupId+'/terminal-capabilities'){
        if(__startupMode==='pending-detect')await new Promise(resolve=>window.__startupFinishDetect=resolve);
        if(__startupMode==='error')throw Error('Fixture detection failure');
        return {capabilities:{platform:'posix',platform_label:'Linux',default_shell:{label:'Bash'},profiles:[{kind:'shell',label:'Bash',path:'/bin/bash',args:'-l',platform:'posix'}],tools:[{name:'node',version:'v22'}],warnings:[]}};
      }
      if(route==='/api/connections/'+__startupId+'/terminal-session-components')return {supported:__startupMode!=='unsupported',components:__startupMode==='empty'?{}:{tmux:{label:'tmux',installed:true,version:'3.4',active_sessions:1,terma_active_sessions:1}}};
      if(route==='/api/connections/'+__startupId+'/terminal-startup'){
        __startupWrites.push(JSON.parse(options.body));
        if(__startupMode==='save-error')throw Error('Fixture save failure');
        if(__startupMode==='pending-save')await new Promise(resolve=>window.__startupFinishSave=resolve);
        return {startup:JSON.parse(options.body)};
      }
      if(options.method&&options.method!=='GET')throw Error('Unexpected mutation '+route);
      return originalApi(route,options);
    };
    const originalRenderTab=window.termaWorkspaceTabRuntime.render;window.termaWorkspaceTabRuntime.render=tab=>tab.key===__startupKey?undefined:originalRenderTab(tab);
    window.termaTerminalState.terminalSessions.set(__startupKey,{id:__startupId,connection:__startupConnection,term:{cols:80,rows:24,options:{},writeln(){},focus(){}}});
    window.termaTerminalConnection.connect=async(connection,key,session)=>{
      if(window.termaTerminalState.terminalSessions.get(key)!==session)throw Error('Startup reconnect lost its owner');
      __startupOpened.push({target:'current',id:connection.id,key});
    };
    window.termaWorkspaceTabCopy.duplicate=(key,options)=>{const newKey='startup-copy-'+__startupOpened.length;options.beforeOpen(newKey);options.result.split=!!options.splitZone;__startupOpened.push({target:'new',key:newKey,zone:options.splitZone});return newKey;};
    const originalNotify=notify;notify=(message,kind)=>{__startupNotices.push({message,kind});originalNotify(message,kind);};
    window.__startupOpen=mode=>{closeModal();__startupMode=mode||'success';document.querySelectorAll('.toast,.notice').forEach(el=>el.remove());window.termaTerminalStartup.open(__startupKey,__startupId);};
    window.__startupFill=(id,value)=>{const el=$(id);if(typeof value==='boolean')el.checked=value;else el.value=value;el.dispatchEvent(new Event(el.tagName==='SELECT'||typeof value==='boolean'?'change':'input',{bubbles:true}));};
    window.__startupContrast=selector=>{const el=document.querySelector(selector),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});canvas.width=canvas.height=1;const luminance=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const text=luminance(getComputedStyle(el).color),background=luminance(getComputedStyle($('modal').querySelector('.modal-card')).backgroundColor);return (Math.max(text,background)+.05)/(Math.min(text,background)+.05);};
    window.__componentTasks={};window.__componentTaskSerial=0;window.__componentWrites=[];
    window.__componentPlan={online:{available:true,command:'sudo apt-get install tmux'},offline:{available:true,command:'sudo apt-get --no-download install tmux'},local_offline:{available:true,package_names:['tmux']},manual:{available:true}};
    window.__componentOpen=(mode='ready',root=true)=>{activeTabKey=__startupKey;if(isMobileLayout())window.termaWorkspaceShell.showMobileWorkspace();__componentMode=mode;__componentRoot=root;__componentInstalled=false;window.termaSftpTaskWorkspace.runtime.close();__startupOpen();};
  `);
  if(process.env.TERMA_TERMINAL_COMPONENTS_ONLY!=='1')for(const width of [1200,390])for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']){
    const prefix=`${width}-${theme}-${language}`, alternate=language==='zh-CN'?'en-US':'zh-CN';
    browser.setContentSize(width,844);
    await execute(`applyTheme('${theme}');await setTermaLanguage('${language}');__startupOpen('pending-detect');`);
    await check(`${prefix} detection is busy`, `$('terminalStartupDetect').disabled&&$('terminalStartupCapabilitySummary').classList.contains('loading')`);
    await layout(prefix);await shot(`${prefix}-detecting`);
    await execute(`__startupFinishDetect();`);await delay(80);
    await check(`${prefix} detection and installed text contrast`, `__startupContrast('#terminalStartupCapabilitySummary > span')>=4.5&&__startupContrast('.terminal-session-component-status.installed')>=4.5`);
    await execute(`__startupFill('terminalStartupProfile','custom');__startupFill('terminalStartupProfileName','Draft Shell');__startupFill('terminalStartupPath','/bin/bash');__startupFill('terminalStartupArgs','-l');$('terminalStartupProfileName').focus();$('terminalStartupProfileName').setSelectionRange(2,7);window.__startupField=$('terminalStartupProfileName');const scroll=$('modal').querySelector('.terminal-startup-scroll');scroll.scrollTop=60;window.__startupScroll=scroll.scrollTop;await setTermaLanguage('${alternate}');`);
    await check(`${prefix} live locale preserves draft focus selection and scroll`, `$('terminalStartupProfileName')===__startupField&&__startupField.value==='Draft Shell'&&document.activeElement===__startupField&&__startupField.selectionStart===2&&__startupField.selectionEnd===7&&Math.abs($('modal').querySelector('.terminal-startup-scroll').scrollTop-__startupScroll)<2`);
    await check(`${prefix} detection summary follows live locale`, `$('terminalStartupCapabilitySummary').textContent.includes(tr('terminal:startup.default_summary',{platform:'Linux',shell:'Bash'}))`);
    await layout(`${prefix}-live`);await shot(`${prefix}-live-locale`);
    await execute(`await setTermaLanguage('${language}');`);
    await hover('#terminalStartupCurrent');
    await check(`${prefix} hover is flat`, `(()=>{const b=$('terminalStartupCurrent'),s=getComputedStyle(b);return b.matches(':hover')&&s.transform==='none'&&s.boxShadow==='none'})()`);
    await shot(`${prefix}-hover`);
    await click('#terminalStartupCancel');await execute(`__startupOpen();`);await delay(50);
    await key('Tab');await key('Tab');await key('Tab');
    await check(`${prefix} keyboard focus remains visible`, `(()=>{const el=document.activeElement,s=getComputedStyle(el);return $('modal').contains(el)&&el.matches(':focus-visible')&&s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0})()`);
    await shot(`${prefix}-focus`);
    await execute(`__startupOpen('error');`);await delay(50);
    await check(`${prefix} detection failure is localized`, `$('terminalStartupCapabilitySummary').querySelector('strong').textContent===tr('terminal:startup.detect_failed',{error:'Fixture detection failure'})`);
    await execute(`await setTermaLanguage('${alternate}');`);
    await check(`${prefix} error follows live locale`, `$('terminalStartupCapabilitySummary').querySelector('strong').textContent===tr('terminal:startup.detect_failed',{error:'Fixture detection failure'})`);
    await layout(`${prefix}-error`);await shot(`${prefix}-error`);
    await execute(`await setTermaLanguage('${language}');__startupOpen();`);await delay(50);
    await execute(`__startupFill('terminalStartupSaveDefault',true);__startupMode='pending-save';window.__startupCount=__startupOpened.length;`);
    await click('#terminalStartupCurrent');
    await check(`${prefix} save blocks duplicate and close controls`, `window.termaTerminalViews.startupOptions()?.busy&&[...$('modal').querySelectorAll('button:not(.dialog-window-resize),input:not([type=hidden]),select')].filter(el=>el.checkVisibility()).every(el=>el.disabled)`);
    await key('Escape');
    await check(`${prefix} Escape preserves pending save`, `!$('modal').hidden&&window.termaTerminalViews.startupOptions()?.busy`);
    await execute(`await setTermaLanguage('${alternate}');`);
    await check(`${prefix} live refresh preserves disabled save controls`, `$('terminalStartupCurrent').disabled&&$('terminalStartupProfile').disabled&&$('terminalStartupSaveDefault').disabled`);
    await shot(`${prefix}-saving`);
    await execute(`__startupFinishSave();`);await delay(70);
    await check(`${prefix} save reconnects once`, `$('modal').hidden&&__startupOpened.length===__startupCount+1`);
    await execute(`await setTermaLanguage('${language}');__startupOpen('save-error');`);await delay(50);
    await execute(`__startupFill('terminalStartupSaveDefault',true);`);
    await click('#terminalStartupCurrent');
    await check(`${prefix} save failure restores controls and draft`, `!$('modal').hidden&&!$('terminalStartupCurrent').disabled&&!$('terminalStartupProfile').disabled&&$('terminalStartupSaveDefault').checked&&__startupNotices.at(-1).kind==='error'`);
    await check(`${prefix} the displayed save error preserves the original words`, `Array.from(document.querySelectorAll('.toast strong, .toast .toast-copy span')).some(node=>node.textContent.includes('Fixture save failure'))`);
    await shot(`${prefix}-save-error`);
    for(const mode of ['empty','unsupported']){
      await execute(`__startupOpen('${mode}');`);await delay(50);
      await check(`${prefix} ${mode} component state`, `$('terminalSessionComponents').textContent.includes(tr('terminal:session.${mode==='empty'?'no_components':'unsupported'}'))`);
      await layout(`${prefix}-${mode}`);await shot(`${prefix}-${mode}`);
    }
    await execute(`window.termaTerminalStartupState.overrides.set(__startupKey,window.termaTerminalStartup.normalize({terminal_startup_mode:'program',terminal_program_path:'/bin/bash',terminal_profile_name:'Temporary Shell'}));__startupOpen();`);await delay(50);
    await shot(`${prefix}-temporary`);
    await click('#terminalStartupRestore');
    await check(`${prefix} restore clears override and reconnects`, `$('modal').hidden&&!window.termaTerminalStartupState.overrides.has(__startupKey)&&__startupOpened.at(-1).target==='current'`);
    await execute(`__startupOpen();`);await delay(40);
    await click('#terminalStartupNewTab');
    await check(`${prefix} new tab action preserves temporary target`, `$('modal').hidden&&__startupOpened.at(-1).target==='new'&&window.termaTerminalStartupState.overrides.has(__startupOpened.at(-1).key)`);
    if(width===1200){
      for(const zone of ['top','bottom','left','right']){
        await execute(`__startupOpen();`);await delay(40);
        await hover('#terminalStartupSplit');
        await check(`${prefix} ${zone} split picker fits and stays flat`, `(()=>{const buttons=[...$('modal').querySelectorAll('[data-split-zone]')];return buttons.every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&getComputedStyle(el).boxShadow==='none'})&&getComputedStyle($('modal').querySelector('.terminal-startup-split-center')).boxShadow==='none'})()`);
        await shot(`${prefix}-split-${zone}`);
        await click('#modal [data-split-zone="'+zone+'"]');
        await check(`${prefix} ${zone} split is forwarded`, `$('modal').hidden&&__startupOpened.at(-1).zone==='${zone}'`);
      }
    }else{
      await execute(`__startupOpen();`);
      await check(`${prefix} split control respects narrow layout`, `!$('terminalStartupSplit')`);
    }
    await execute(`__startupOpen('pending-detect');window.__startupRefreshCount=__startupNotices.length;`);
    await click('#terminalStartupCancel');
    await execute(`__startupOpen();`);await delay(50);
    await execute(`window.__startupReplacement=$('modal').querySelector('.terminal-startup-modal');__startupFinishDetect();`);await delay(50);
    await check(`${prefix} late detection cannot reclaim replacement`, `$('modal').querySelector('.terminal-startup-modal')===__startupReplacement&&__startupNotices.length===__startupRefreshCount`);
    await shot(`${prefix}-replacement`);
  }
  const row = '[data-session-component="tmux"]';
  const install = mode => `${row} [data-install-mode="${mode}"]`;
  const wait = async expression => {
    const deadline=Date.now()+5000;
    while(Date.now()<deadline){if(await execute(`return (${expression})`))return;await delay(50);}
    throw Error('Timed out waiting for '+expression);
  };
  for(const width of [1200,390])for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']){
    const prefix=`components-${width}-${theme}-${language}`, alternate=language==='zh-CN'?'en-US':'zh-CN';
    browser.setContentSize(width,844);
    await delay(160);
    await execute(`Object.values(__componentTasks).forEach(task=>{task.status='done';task.progress=100;});applyTheme('${theme}');await setTermaLanguage('${language}');__componentOpen();`);
    await wait(`window.termaTerminalViews.startupOptions().session.status==='success'`);
    await check(`${prefix} three installation modes manual and uninstall are present`, `document.querySelectorAll('${row} [data-install-mode]').length===4&&!!document.querySelector('[data-session-component="screen"] [data-management-action="uninstall"]')`);
    await layout(prefix);await shot(`${prefix}-ready`);
    await click(install('manual'));
    await check(`${prefix} manual opens the selected component`, `document.querySelector('${row} details').open`);
    await layout(`${prefix}-manual`);await shot(`${prefix}-manual`);
    await click(`${row} .remote-install-copy`);
    await check(`${prefix} reference copy uses component commands`, `__startupNotices.at(-1).message===tr('remote:install.commands_copied')`);
    await execute(`__startupFill('terminalStartupProfile','custom');__startupFill('terminalStartupProfileName','Component Draft');__startupFill('terminalStartupPath','/bin/bash');$('terminalStartupProfileName').focus();$('terminalStartupProfileName').setSelectionRange(1,6);window.__componentField=$('terminalStartupProfileName');const scroll=$('modal').querySelector('.terminal-startup-scroll');scroll.scrollTop=50;window.__componentScroll=scroll.scrollTop;await setTermaLanguage('${alternate}');`);
    await check(`${prefix} component language preserves draft focus selection and scroll`, `$('terminalStartupProfileName')===__componentField&&document.activeElement===__componentField&&__componentField.selectionStart===1&&__componentField.selectionEnd===6&&__componentField.value==='Component Draft'&&Math.abs($('modal').querySelector('.terminal-startup-scroll').scrollTop-__componentScroll)<2&&document.querySelector('${row} details').open`);
    await layout(`${prefix}-live`);await shot(`${prefix}-live-locale`);
    await execute(`await setTermaLanguage('${language}');`);
    await hover(install('online'));
    await check(`${prefix} install hover remains flat`, `(()=>{const el=document.querySelector('${install('online')}'),s=getComputedStyle(el);return el.matches(':hover')&&s.boxShadow==='none'&&s.transform==='none'})()`);
    await shot(`${prefix}-hover`);
    await click(`${row} details > summary`);await key('Tab');
    await check(`${prefix} management keyboard focus is visible`, `(()=>{const el=document.activeElement,s=getComputedStyle(el);return $('modal').contains(el)&&el.matches(':focus-visible')&&s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0})()`);
    await shot(`${prefix}-focus`);
    await click(install('local-offline'));
    await wait(`!!document.querySelector('.settings-choice-modal')`);
    await check(`${prefix} local preparation confirmation translates live`, `document.querySelector('.settings-choice-modal').textContent.includes(tr('terminal:session.local_confirm'))`);
    await execute(`await setTermaLanguage('${alternate}');`);
    await check(`${prefix} confirmation follows locale immediately`, `document.querySelector('.settings-choice-modal').textContent.includes(tr('terminal:session.local_confirm'))`);
    await shot(`${prefix}-local-confirm`);
    await click('.settings-choice-modal [data-choice="1"]');
    await wait(`!!document.querySelector('.terminal-startup-modal')`);
    await check(`${prefix} confirmation cancel restores original draft`, `$('terminalStartupProfileName').value==='Component Draft'&&!window.termaTerminalViews.startupOptions().busy`);
    await execute(`await setTermaLanguage('${language}');__componentRoot=false;await window.termaTerminalViews.startupOptions().actions.refreshComponents();`);
    await click(install('online'));
    await wait(`!!document.querySelector('.remote-admin-modal')`);
    await execute(`await setTermaLanguage('${alternate}');`);
    await check(`${prefix} admin prompt follows locale`, `document.querySelector('#remoteAdminTitle').textContent===tr('remote:admin.title')`);
    await shot(`${prefix}-authorization`);
    await click('.remote-admin-modal [data-admin-cancel]');
    await wait(`!!document.querySelector('.terminal-startup-modal')`);
    await check(`${prefix} authorization cancel restores draft`, `$('terminalStartupProfileName').value==='Component Draft'&&!window.termaTerminalViews.startupOptions().busy`);
    await execute(`await setTermaLanguage('${language}');`);
    await click(install('online'));
    await wait(`!!document.querySelector('.remote-admin-modal')`);
    await click('.remote-admin-modal button[type="submit"]');
    await wait(`!!document.querySelector('${row} .remote-component-progress')&&!window.termaTerminalViews.startupOptions().busy`);
    await check(`${prefix} authorized task submits scoped grant once`, `__componentWrites.at(-1).admin_auth.admin_grant_id==='fixture-component-grant'`);
    await check(`${prefix} task progress is visible and duplicate install disabled`, `(()=>{const el=document.querySelector('${row} .remote-component-progress');el.scrollIntoView({block:'nearest',behavior:'instant'});const r=el.getBoundingClientRect();return el.checkVisibility()&&r.top>=0&&r.bottom<=innerHeight&&el.querySelector('[role=progressbar]').getAttribute('aria-valuenow')==='42'&&document.querySelector('${install('online')}').disabled})()`);
    await layout(`${prefix}-progress`);await shot(`${prefix}-progress`);
    {
      await click(`${row} [data-management-action="task-center"]`);
      await wait(`!!$('sftpTaskCenterDrawer')?.querySelector('.sftp-job[data-task-id="component:'+Object.values(__componentTasks).at(-1).id+'"]')?.checkVisibility()`);
      await check(`${prefix} task drawer is visible and unobscured`, `(()=>{const el=$('sftpTaskCenterDrawer'),card=el?.querySelector('.sftp-job[data-task-id="component:'+Object.values(__componentTasks).at(-1).id+'"]');if(!el?.checkVisibility()||!card?.checkVisibility())return false;card.scrollIntoView({block:'nearest',behavior:'instant'});const r=card.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&(hit===card||card.contains(hit))&&!card.querySelector('img')})()`);
      await click(await execute(`return '#sftpTaskCenterDrawer .sftp-job[data-task-id="component:'+Object.values(__componentTasks).at(-1).id+'"] .global-task-log > summary'`));
      await execute(`$('sftpTaskCenterDrawer').querySelector('.sftp-job[data-task-id="component:'+Object.values(__componentTasks).at(-1).id+'"]').scrollIntoView({block:'nearest',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));`);
      await check(`${prefix} task logs remain escaped in visible drawer`, `(()=>{const drawer=$('sftpTaskCenterDrawer'),log=drawer.querySelector('.sftp-job[data-task-id="component:'+Object.values(__componentTasks).at(-1).id+'"] .global-task-log'),r=log.querySelector('pre').getBoundingClientRect(),bounds=$('sftpTaskCenterList').getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return log.open&&r.top>=bounds.top&&r.bottom<=bounds.bottom&&(hit===log.querySelector('pre')||log.contains(hit))&&log.textContent.includes('<img src=x onerror=alert(1)>')&&!log.querySelector('img')})()`);
      await execute(`await setTermaLanguage('${alternate}');`);
      await check(`${prefix} task center translates real component labels immediately`, `(()=>{const card=$('sftpTaskCenterDrawer').querySelector('.sftp-job[data-task-id="component:'+Object.values(__componentTasks).at(-1).id+'"]');return card.textContent.includes(tr('terminal:session.component_tmux'))&&card.textContent.includes(tr('remote:task_actions.install'))&&(document.documentElement.lang!=='en-US'||!/[\\u3400-\\u9fff]/.test(card.textContent))})()`);
      await execute(`await setTermaLanguage('${language}');`);
      await shot(`${prefix}-task-center`);
    }
    await execute(`window.termaSftpTaskWorkspace.runtime.close();const task=Object.values(__componentTasks).at(-1);task.status='done';task.progress=100;__componentInstalled=true;__startupOpen();`);
    await wait(`!!document.querySelector('${row} [data-management-action="uninstall"]')`);
    await shot(`${prefix}-installed`);
    await execute(`__componentRoot=true;await window.termaTerminalViews.startupOptions().actions.refreshComponents();`);
    await click(`${row} [data-management-action="uninstall"]`);
    await wait(`Object.values(__componentTasks).at(-1).status==='running'&&!window.termaTerminalViews.startupOptions().busy`);
    await check(`${prefix} uninstall reuses same component endpoint`, `__componentWrites.at(-1).action==='uninstall'`);
    await execute(`const task=Object.values(__componentTasks).at(-1);task.status='failed';task.error='Fixture package failure';`);
    await wait(`document.querySelector('${row} .remote-component-progress.error')`);
    await layout(`${prefix}-failed`);await shot(`${prefix}-failed-task`);
    await execute(`__componentOpen('pending-post');`);await wait(`window.termaTerminalViews.startupOptions().session.status==='success'`);
    await click(install('offline'));
    await check(`${prefix} pending component request blocks form actions`, `window.termaTerminalViews.startupOptions().busy&&[...$('modal').querySelectorAll('button:not(.dialog-window-resize),input:not([type=hidden]),select')].filter(el=>el.checkVisibility()).every(el=>el.disabled)`);
    await execute(`await setTermaLanguage('${alternate}');`);
    await shot(`${prefix}-submitting`);
    await execute(`__componentFinishPost();`);await wait(`!window.termaTerminalViews.startupOptions().busy`);
    await execute(`__componentOpen('post-error');`);await wait(`window.termaTerminalViews.startupOptions().session.status==='success'`);
    await click(install('online'));
    await check(`${prefix} component rejection recovers controls`, `!window.termaTerminalViews.startupOptions().busy&&!document.querySelector('${install('online')}').disabled&&__startupNotices.at(-1).kind==='error'`);
    await shot(`${prefix}-request-error`);
    await execute(`__componentOpen();`);await wait(`window.termaTerminalViews.startupOptions().session.status==='success'`);
    await click(install('local-offline'));await wait(`!!document.querySelector('.settings-choice-modal')`);
    await click('.settings-choice-modal [data-choice="0"]');
    await wait(`!!document.querySelector('${row} .remote-component-progress')&&!window.termaTerminalViews.startupOptions().busy`);
    await check(`${prefix} local preparation acceptance keeps exact task action`, `__componentWrites.at(-1).action==='install-local-offline'`);
    await shot(`${prefix}-local-progress`);
    await execute(`__componentOpen('ready',false);`);await wait(`window.termaTerminalViews.startupOptions().session.status==='success'`);
    await click(install('online'));await wait(`!!document.querySelector('.remote-admin-modal')`);
    await execute(`window.__componentNoticeCount=__startupNotices.length;await window.termaTerminalSettings.open(__startupKey);window.__componentOther=$('modal').querySelector('.terminal-settings-modal');`);
    await delay(100);
    await check(`${prefix} authorization replacement never restores startup`, `!!__componentOther&&$('modal').querySelector('.terminal-settings-modal')===__componentOther&&!$('modal').querySelector('.terminal-startup-modal')&&__startupNotices.length===__componentNoticeCount`);
    await shot(`${prefix}-replacement`);
    await execute(`__componentOpen('pending-identities',false);`);await wait(`window.termaTerminalViews.startupOptions().session.status==='success'`);
    await click(install('online'));await wait(`typeof __componentFinishIdentities==='function'`);
    await execute(`closeModal();__componentFinishIdentities();window.__componentFinishIdentities=null;`);await delay(100);
    await check(`${prefix} closing before identities never opens a late authorization`, `$('modal').hidden&&!document.querySelector('.remote-admin-modal')`);
    for(const state of ['component-error','component-empty','component-unsupported']){
      await execute(`__componentOpen('${state}');`);await wait(`window.termaTerminalViews.startupOptions().session.status!=='loading'&&window.termaTerminalViews.startupOptions().session.status!=='idle'`);
      await check(`${prefix} ${state} leaves startup controls usable`, `!$('terminalStartupDetect').disabled&&document.querySelectorAll('${row} [data-install-mode]').length===0&&$('terminalSessionComponents').textContent.length>0`);
      await layout(`${prefix}-${state}`);await shot(`${prefix}-${state}`);
    }
    await execute(`__componentMode='';closeModal();window.termaSftpTransferLifecycle.polling.stop();`);
  }
  await execute(`__startupOpen('pending-detect');await window.termaTerminalSettings.open(__startupKey);window.__startupOther=$('modal').querySelector('.terminal-settings-modal');__startupFinishDetect();`);
  await delay(70);
  await check('late startup detection cannot refresh another dialog', `!!__startupOther&&$('modal').querySelector('.terminal-settings-modal')===__startupOther&&!$('modal').querySelector('.terminal-startup-modal')`);
  await shot('startup-to-settings');
  await execute(`closeModal();`);
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({groups:8,checks,states,tabActions:'bounded fixture',remoteConnections:0},null,2));
  return `Terminal startup browser checks passed (${checks.length}, ${states.length} screenshots)`;
  } finally {
    if (ownsDebugger && browser.webContents.debugger.isAttached()) browser.webContents.debugger.detach();
  }
}
module.exports={runTerminalStartupUiScenario};
