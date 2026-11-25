const {captureElectronSurface}=require('./electron-surface-screenshot');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
async function runX11UiScenario(browser){
 const directory=process.env.TERMA_REMOTE_VISUAL_DIR||path.join(process.cwd(),'data/m7-x11-visual');fs.mkdirSync(directory,{recursive:true});const assertions=[],states=[];
 const pause=ms=>new Promise(r=>setTimeout(r,ms)),execute=source=>browser.webContents.executeJavaScript(`(async()=>{${source}})()`),evaluate=source=>execute(`return (${source})`);
 const wait=async expression=>{for(let i=0;i<180;i++){if(await evaluate(`!!(${expression})`))return;await pause(30);}await shot('failure-state');throw Error('X11 UI timeout: '+expression);};
 const click=async selector=>{await execute('dismissToast()');const point=await execute(`const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing '+${JSON.stringify(selector)});node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}`);for(const type of ['mouseMove','mouseDown','mouseUp']){browser.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});await pause(25);}};
 const shot=async name=>{
  await execute('dismissToast();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  if(name.includes('-authorization-')){
   await execute("document.querySelector('.desktop-integration-authorization')?.scrollIntoView({block:'center'})");
   const geometry=await evaluate("(()=>{const root=document.querySelector('.desktop-integration-authorization'),copy=root.querySelector('.desktop-integration-authorization-copy'),r=root.getBoundingClientRect(),c=copy.getBoundingClientRect();return {readable:c.width>=Math.min(150,r.width/2),controls:[...root.querySelectorAll('button,input,select')].filter(n=>n.checkVisibility()).every(n=>{const b=n.getBoundingClientRect(),hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return b.left>=r.left&&b.right<=r.right+1&&b.top>=0&&b.bottom<=innerHeight&&!!hit&&(n===hit||n.contains(hit)||(getComputedStyle(n).pointerEvents==='none'&&hit===n.parentElement))})}})()");
   if(!geometry.readable||!geometry.controls){
    await captureElectronSurface(browser,path.join(directory,name+'-failure.png'));
    console.error(await evaluate("(()=>{const root=document.querySelector('.desktop-integration-authorization'),r=root.getBoundingClientRect();return [...root.querySelectorAll('button,input,select')].filter(n=>n.checkVisibility()).map(n=>{const b=n.getBoundingClientRect(),hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return {tag:n.tagName,text:n.textContent,left:b.left-r.left,right:r.right-b.right,top:b.top,bottom:b.bottom,hit:hit?.className,pointer:getComputedStyle(n).pointerEvents}})})()"));
   }
   assert.deepEqual(geometry,{readable:true,controls:true},name+' authorization geometry');assertions.push({name:name+' authorization geometry',...geometry});
   await check(name+' authorization text contrast',`(()=>{
    const root=document.querySelector('.desktop-integration-authorization'),canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const context=canvas.getContext('2d',{willReadFrequently:true}),luminance=color=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);const channels=[...context.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722};
    const background=luminance(getComputedStyle(root).backgroundColor);
    return [...root.querySelectorAll('.desktop-integration-authorization-copy b,.desktop-integration-authorization-copy small')].every(node=>{const foreground=luminance(getComputedStyle(node).color);return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05)>=4.5});
   })()`);
  }
  await captureElectronSurface(browser,path.join(directory,name+'.png'));states.push(name+'.png');
 };
 const check=async(name,expression)=>{assert.equal(await evaluate(expression),true,name);assertions.push({name,passed:true});};
 const inspect=async(name,selector)=>{
  const result=await evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(selector)});if(!root)return {missing:true};const r=root.getBoundingClientRect(),nodes=[root,...root.querySelectorAll('[title],[aria-label],[placeholder]')],text=nodes.map(n=>n.textContent+' '+n.title+' '+n.getAttribute('aria-label')+' '+n.getAttribute('placeholder')).join(' ');return {visible:root.checkVisibility(),overflow:root.scrollWidth>root.clientWidth+2,page:document.documentElement.scrollWidth>innerWidth+2,flat:getComputedStyle(root).boxShadow==='none',english:document.documentElement.lang!=='en-US'||!/[㐀-鿿]/.test(text),inline:!!root.querySelector('[onclick],[onchange]'),object:root.textContent.includes('[object Object]'),buttons:[...root.querySelectorAll('button')].filter(b=>b.checkVisibility()).every(b=>{const x=b.getBoundingClientRect();return x.left>=r.left-1&&x.right<=r.right+1})}})()`);
  if(result.buttons===false){console.error(name,await evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(selector)}),r=root.getBoundingClientRect();return [...root.querySelectorAll('button')].filter(b=>b.checkVisibility()).map(b=>{const x=b.getBoundingClientRect();return {text:b.textContent,left:x.left-r.left,right:x.right-r.left,width:r.width}})})()`));await shot('failure-inspect');}assert.deepEqual(result,{visible:true,overflow:false,page:false,flat:true,english:true,inline:false,object:false,buttons:true},name);assertions.push({name,...result});
 };
 await execute(`window.termaWorkspaceRefresh.stop();const quiet=document.createElement('style');quiet.textContent='#toast,#notice,.notification-toast-stack{visibility:hidden!important}';document.head.append(quiet);window.__x11OriginalApi=api;window.__x11Copy=window.termaClipboard.copy;window.__x11Copied=[];window.termaClipboard.copy=async text=>window.__x11Copied.push(text);window.__x11OriginalSelect=window.termaConnectionController.select;window.__x11Opened=[];window.termaConnectionController.select=(id,...args)=>{if(id!==9881)return window.__x11OriginalSelect(id,...args);window.__x11Opened.push({id});return undefined};
 window.__x11Connection={id:9881,name:'X11 fixture',group_name:'X11 fixtures',ssh_host:'x11.example.test',ssh_port:22,ssh_user:'review',auth_type:'password',has_password:true,x11_mode:'off',forwards:[]};connections=[window.__x11Connection];window.__x11Calls=[];window.__x11Root=false;window.__x11TaskStatus='running';window.__x11TaskCounter=0;window.__x11TaskMode=false;
 window.__x11Base={platform:'win32',available:true,running:true,installed:true,can_start:false,can_stop:true,can_install:false,managed:true,auto_start:true,mode:'bundled',display:':0',server:'X Server fixture',integration_available:true,authorization_kind:'local-direct',reason_code:'xserver_ready'};window.__x11Local={...window.__x11Base};
 window.__x11Plan=()=>({discovery:{platform:'linux',xauth_available:true,applications:[{id:'xterm',path:'/usr/bin/xterm',command:'xterm',category:'terminal'},...['dolphin','nautilus','thunar','plasma','gnome','xfce'].map(id=>({id,command:id,category:['plasma','gnome','xfce'].includes(id)?'desktop':'file'})),{id:'fixture-custom',label:'User application',category:'fixture-custom',category_label:'User category'}],...window.__x11DiscoveryPatch},install_plan:{supported:true,requires_password:!window.__x11Root,package_manager:'apt',online:{available:true,command:'apt install xauth xterm'},offline:{available:true,command:'apt install --no-download xauth xterm'},local_offline:{available:true,package_names:['xauth','xterm']},instructions:['Fixture installation instructions'],optional_commands:['apt install fixture-optional']}});
 window.__x11Task=()=>({id:'x11-fixture-'+window.__x11TaskCounter,connection_id:9881,status:window.__x11TaskStatus,component:'x11-clipboard',action:'install',stage:'install',progress:window.__x11TaskStatus==='done'?100:42,logs:['Fixture task log']});
 window.termaWorkspaceRefresh.load=async()=>{connections=[window.__x11Connection]};
 api=async(route,options={})=>{window.__x11Calls.push({route,method:options.method||'GET',body:options.body});route=route.replace(/^\\/api\\/connections\\/-9881\\//,'/api/connections/9881/');
 if(route==='/api/xserver'){if(window.__x11ReadError)throw Error('Fixture local read failure');if(window.__x11ReadGate)await new Promise(r=>window.__x11ReadRelease=r);if(['POST','DELETE'].includes(options.method)){if(window.__x11WriteGate)await new Promise(r=>window.__x11WriteRelease=r);const started=options.method==='POST';window.__x11Local={...window.__x11Local,available:started,running:started,can_start:!started,can_stop:started,reason_code:started?'xserver_ready':'xserver_installed_stopped'};}return {...window.__x11Local};}
 if(route==='/api/desktop-integration/status')return {...window.__x11Local};
 if(route==='/api/desktop-integration/authorize'){
  if(options.method==='DELETE'){window.__x11Local={...window.__x11Local,authorization_required:true,authorization_kind:'none',authorized:false,approved:false,scopes:[]};return {ok:true,revoked:true};}
  if(window.__x11AuthGate)await new Promise(resolve=>window.__x11AuthRelease=resolve);
  const data=JSON.parse(options.body);window.__x11Local={...window.__x11Local,authorization_required:false,authorization_kind:'temporary',authorized:true,approved:true,scopes:data.scopes,authorization_browser_session:data.authorization_mode==='browser-session',authorization_expires_at:Date.now()+data.duration_minutes*60000};return {...window.__x11Local};
 }
 if(route==='/api/xserver/install'){if(window.__x11InstallError)throw Error('Fixture install failure');return {restart_required:true};}
 if(route==='/api/identity-files')return [];
 if(route==='/api/admin-grants')return {admin_grant:{id:'x11-fixture-grant',reuse_policy:'once',scope:JSON.parse(options.body).scope}};
 if(route.startsWith('/api/remote-component/tasks/x11-fixture-'))return window.__x11Task();
 if(route==='/api/sftp/jobs')return [];
 if(route.startsWith('/api/connections/9881/')){if(route.endsWith('/x11-mode')){window.__x11Connection.x11_mode=JSON.parse(options.body).mode;return {};}
 if(route.endsWith('/verify')){if(window.__x11VerifyGate)await new Promise(r=>window.__x11VerifyRelease=r);return {application:{path:'/usr/bin/xterm'}};}
 if(route.endsWith('/install-plan')){if(window.__x11PlanError)throw Error('Fixture plan failure');if(window.__x11PlanGate)await new Promise(r=>window.__x11PlanRelease=r);return window.__x11Plan();}
 if(route.endsWith('/x11-applications')){if(window.__x11DiscoverError)throw Error('Fixture discovery failure');if(window.__x11DiscoverGate)await new Promise(r=>window.__x11DiscoverRelease=r);return window.__x11Plan();}
 if(route.endsWith('/x11-forwarding')||route.endsWith('/x11-clipboard/helper')){if(options.method==='POST'){if(window.__x11TaskMode){window.__x11TaskCounter++;return {task:window.__x11Task()};}return {};}if(route.endsWith('/x11-forwarding')&&window.__x11CredentialFailure)return {error:'SSH authentication failed',code:'SSH_AUTHENTICATION_FAILED'};return {supported:true,platform:'linux',root:window.__x11Root,can_manage:window.__x11Root,x11_forwarding:'yes',xauth_available:!window.__x11MissingXauth,xauth_path:window.__x11MissingXauth?'':'/usr/bin/xauth',ready:!window.__x11MissingXauth,installed:true,package_manager:'apt',guide:{summary:{i18n_key:'common:x11.clipboard_guide_summary',params:{}},steps:[],commands:[]},terminal_commands:{enable:'sudo fixture-enable',disable:'sudo fixture-disable'}};}
 if(route.endsWith('/x11-applications/install'))return window.__x11TaskMode?{task:window.__x11Task()}:{};
 }return window.__x11OriginalApi(route,options);};`);
 const widths=process.env.TERMA_X11_WIDTH?[Number(process.env.TERMA_X11_WIDTH)]:[1200,390];
 const themes=process.env.TERMA_X11_THEME?[process.env.TERMA_X11_THEME]:['light','dark'];
 const languages=process.env.TERMA_X11_LANGUAGE?[process.env.TERMA_X11_LANGUAGE]:['zh-CN','en-US'];
 for(const width of widths)for(const theme of themes)for(const language of languages){
  const prefix=`${language}-${theme}-${width}`,other=language==='en-US'?'zh-CN':'en-US';browser.setContentSize(width,844);
  await execute(`closeModal();window.__x11Local={...window.__x11Base};window.__x11Root=false;window.__x11TaskMode=false;connections=[window.__x11Connection];applyTheme('${theme}');await setTermaLanguage('${language}');await window.termaX11.openManager(9881)`);await wait("document.querySelector('#modal .xserver-details')");await inspect(prefix+' manager','#modal .xserver-manager');await shot(prefix+'-manager-ready');
  const footerBelowContent=await execute(`
    const manager=document.querySelector('.xserver-manager');
    const footer=manager.querySelector(':scope > .actions');
    const before=footer.getBoundingClientRect();
    const body=footer.previousElementSibling.getBoundingClientRect();
    manager.scrollTop=manager.scrollHeight;
    return getComputedStyle(footer).position==='static'&&before.top>=body.bottom
      &&footer.getBoundingClientRect().bottom<=manager.getBoundingClientRect().bottom;
  `);
  assert.ok(footerBelowContent,prefix+' manager footer scrolls with the content');
  await shot(prefix+'-manager-footer');
  const reads=await evaluate("window.__x11Calls.length");await execute(`await setTermaLanguage('${other}')`);await inspect(prefix+' manager language','#modal .xserver-manager');await check(prefix+' language does not probe again',`window.__x11Calls.length===${reads}`);await shot(prefix+'-manager-language');await execute(`await setTermaLanguage('${language}')`);
  for(const [name,patch]of [['authorization',"authorization_required:true,authorization_kind:'none',desktop_backend_available:true,can_request_authorization:true,web_session_authenticated:true,scopes:[]"],['standalone',"integration_available:false,desktop_backend_available:false"],['stopped',"available:false,running:false,can_start:true,can_stop:false,reason_code:'xserver_installed_stopped'"],['linux',"platform:'linux',available:false,display:'',can_start:false,can_stop:false,can_install:true,reason_code:'linux_display_missing'"]].filter(([name])=>process.env.TERMA_X11_AUTH_ONLY!=='1'||name==='authorization')){
   await execute(`window.__x11Local={...window.__x11Base,${patch}};await window.termaX11.manager.refresh()`);await inspect(prefix+' '+name,'#modal .xserver-manager');await shot(prefix+'-manager-'+name);
   if(name==='authorization'){
    await execute(`const select=document.querySelector('[data-role="desktop-integration-duration"]');select.value='custom';select.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>requestAnimationFrame(resolve));const input=document.querySelector('[data-role="desktop-integration-custom-minutes"]');input.value='137';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();window.__x11AuthInput=input;await setTermaLanguage('${other}')`);
    await check(prefix+' authorization language preserves custom draft',"document.querySelector('[data-role=\"desktop-integration-custom-minutes\"]')===window.__x11AuthInput&&window.__x11AuthInput.value==='137'&&document.activeElement===window.__x11AuthInput");
    await inspect(prefix+' authorization language','#modal .xserver-manager');await shot(prefix+'-authorization-language');
    await execute(`await setTermaLanguage('${language}');window.__x11AuthGate=true`);
    await click('[data-action="desktop-integration-authorize"]');await wait('!!window.__x11AuthRelease');
    await check(prefix+' authorization busy button disabled',"document.querySelector('[data-action=\"desktop-integration-authorize\"]').disabled");
    await shot(prefix+'-authorization-busy');
    await execute("window.__x11AuthGate=false;window.__x11AuthRelease()");
    await wait("document.querySelector('[data-action=\"desktop-integration-revoke\"]')");
    await check(prefix+' custom authorization exact payload',"(()=>{const body=JSON.parse(window.__x11Calls.filter(c=>c.route==='/api/desktop-integration/authorize'&&c.method==='POST').at(-1).body);return body.scopes.join(',')==='xserver'&&body.duration_minutes===137&&body.authorization_mode==='timed'})()");
    await inspect(prefix+' authorized','#modal .xserver-manager');await shot(prefix+'-authorization-granted');
    await click('[data-action="desktop-integration-revoke"]');await wait("document.querySelector('[data-action=\"desktop-integration-authorize\"]')");
    await shot(prefix+'-authorization-revoked');
    await execute("const select=document.querySelector('[data-role=\"desktop-integration-duration\"]');select.value='browser-session';select.dispatchEvent(new Event('change',{bubbles:true}))");
    await click('[data-action="desktop-integration-authorize"]');await wait("document.querySelector('[data-action=\"desktop-integration-revoke\"]')");
    await check(prefix+' browser-session exact payload',"(()=>{const body=JSON.parse(window.__x11Calls.filter(c=>c.route==='/api/desktop-integration/authorize'&&c.method==='POST').at(-1).body);return body.authorization_mode==='browser-session'&&body.duration_minutes===0&&document.querySelector('.desktop-integration-authorization-copy').textContent.includes(tr('remote:desktop_authorization.browser_session_expiry'))})()");
    await inspect(prefix+' browser session','#modal .xserver-manager');await shot(prefix+'-authorization-browser-session');
    await click('[data-action="desktop-integration-revoke"]');await wait("document.querySelector('[data-action=\"desktop-integration-authorize\"]')");
   }
  }
  if(process.env.TERMA_X11_AUTH_ONLY==='1'){
   await execute("window.termaX11.closeManager();await window.termaX11.openManager(0, '', 'settings')");
   await wait("document.querySelector('#modal .terma-button[data-action=\"desktop-integration-authorize\"]')");
   await shot(prefix+'-authorization-settings');
   await execute(`const select=document.querySelector('[data-role="desktop-integration-duration"]');select.value='custom';select.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>requestAnimationFrame(resolve));const input=document.querySelector('[data-role="desktop-integration-custom-minutes"]');input.value='143';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();window.__x11AuthInput=input;await setTermaLanguage('${other}')`);
   await check(prefix+' settings authorization retains draft',"document.querySelector('[data-role=\"desktop-integration-custom-minutes\"]')===window.__x11AuthInput&&window.__x11AuthInput.value==='143'&&document.activeElement===window.__x11AuthInput");
   await inspect(prefix+' settings authorization language','#modal .xserver-manager');await shot(prefix+'-authorization-settings-language');
   continue;
  }
  await check(prefix+' missing DISPLAY does not claim ready',"!document.querySelector('.xserver-manager').textContent.includes(tr('common:x11.display_ready_default_off',{name:'X11 fixture'}))");
  await execute(`window.termaX11.closeManager();
    const trigger=[document.querySelector('#xServerQuickButton'),document.querySelector('#connectionSearch')]
      .find(node=>node?.checkVisibility());
    if(!trigger)throw Error('Missing focus trigger');
    trigger.focus();window.__x11FocusTrigger=trigger;
    window.__x11ReadRelease=undefined;window.__x11ReadGate=true;window.__x11Opening=window.termaX11.openManager(9881)`);
  await wait('!!window.__x11ReadRelease');
  await inspect(prefix+' manager pending','#modal .xserver-manager');
  await shot(prefix+'-manager-pending');
  await check(prefix+' duplicate open while pending is ignored',"await window.termaX11.openManager(9881)===false");
  await execute("window.termaX11.closeManager()");
  await check(prefix+' pending manager restores focus on close','document.activeElement===window.__x11FocusTrigger');
  await check(prefix+' close during pending suppresses late result and duplicate open',
    `!(await window.termaX11.openManager(9881))&&
    (window.__x11ReadGate=false,window.__x11ReadRelease(),!(await window.__x11Opening))&&
    document.getElementById('modal').hidden`);
  await check(prefix+' manager can be reopened after pending read has settled',"await window.termaX11.openManager(9881)===true");
  await execute("window.__x11ReadError=true;await window.termaX11.manager.refresh()");await inspect(prefix+' local error','#modal .xserver-manager');await shot(prefix+'-manager-error');await execute("window.__x11ReadError=false;window.__x11Local={...window.__x11Base}");await click('.xserver-manager .remote-diagnostic-actions button');await wait("document.querySelector('#modal .xserver-details')");
  const x11ForwardButton = '.x11-forwarding-panel [data-ui-action-key="x11-forwarding:9881"]';
  await click(x11ForwardButton);
  await wait("!!document.querySelector('.forward-question')");
  await click('.forward-question button:last-child');
  await wait(`document.querySelector(${JSON.stringify(x11ForwardButton)})?.disabled===false`);
  await check(prefix+' cancel restores forwarding action without writing', "!window.__x11Calls.some(c=>c.route.endsWith('/x11-forwarding')&&c.method==='POST')");
  await execute(`window.__x11MissingXauth=true;await window.termaX11.manager.refresh();
    const guideButton=[...document.querySelectorAll('.x11-forwarding-panel button')].find(node=>node.textContent.includes(tr('common:x11.install_components')));
    if(!guideButton)throw Error('X11 installation button is missing');
    guideButton.dataset.x11Fixture='open-guide';`);
  await click('[data-x11-fixture="open-guide"]');
  await wait("!!window.termaX11.remote.guideState?.result");
  await check(prefix+' manager opens guide for its SSH connection', "window.termaX11.remote.guideState.id===9881&&!document.querySelector('#modal .xserver-manager')");
  await inspect(prefix+' guide from manager','#modal .x11-install-guide');
  await shot(prefix+'-guide-from-manager');
  await execute("window.__x11MissingXauth=false;await window.termaX11.openManager(9881)");
  await execute(`window.__x11CredentialFailure=true;window.__x11SavedRepair=window.termaConnectionCredentials.prompt;
    window.termaConnectionCredentials.prompt=async connection=>{window.__x11RepairedId=connection.id;return null;};
    await window.termaX11.manager.refresh()`);
  await inspect(prefix+' saved SSH repair entry','#modal .xserver-manager');
  await shot(prefix+'-repair-saved');
  await click('.x11-forwarding-panel.warning .actions button');
  await check(prefix+' saved repair uses the manager connection','window.__x11RepairedId===9881');
  await execute(`window.termaX11.closeManager();window.termaConnectionCredentials.prompt=window.__x11SavedRepair;
    const connection={...window.__x11Connection,id:-9881,quick_connection:true};
    window.termaTerminalQuickRegistry.quickConnectionsById.set(connection.id,connection);
    window.termaTerminalState.terminalSessions.set('x11-quick-repair-fixture',{connection});
    const auth=window.termaTerminalAuthentication;
    window.__x11TerminalRepair=auth.repair;
    window.__x11QuickRepairOk=false;
    auth.repair=async (target,key,session,currentSession)=>{
      window.__x11QuickRepairOk=target===connection&&key==='x11-quick-repair-fixture'&&
        session===currentSession()&&document.getElementById('modal').hidden;
    };
    await window.termaX11.openManager(connection.id,'x11-quick-repair-fixture')`);
  await inspect(prefix+' quick SSH repair entry','#modal .xserver-manager');
  await shot(prefix+'-repair-temporary');
  await click('.x11-forwarding-panel.warning .actions button');
  await check(prefix+' quick repair reuses the exact temporary session','window.__x11QuickRepairOk===true');
  await execute(`window.termaTerminalAuthentication.repair=window.__x11TerminalRepair;
    window.termaTerminalState.terminalSessions.delete('x11-quick-repair-fixture');window.termaTerminalQuickRegistry.quickConnectionsById.delete(-9881);
    window.__x11CredentialFailure=false;await window.termaX11.openManager(9881)`);
  await execute("window.__x11Operation=window.termaX11.manager.operate('stop')");await wait("document.querySelector('#modal .forward-question')");await inspect(prefix+' stop confirm','#modal .forward-question');await shot(prefix+'-stop-confirm');await execute(`await setTermaLanguage('${other}')`);await inspect(prefix+' stop language','#modal .forward-question');await shot(prefix+'-stop-language');await click('.forward-question button:last-child');await execute("await window.__x11Operation");await wait("document.querySelector('#modal .xserver-details')");await execute(`await setTermaLanguage('${language}');window.__x11WriteGate=true;window.__x11Operation=window.termaX11.manager.operate('stop')`);await wait("document.querySelector('.forward-question')");await click('.forward-question button:first-child');await wait('!!window.__x11WriteRelease');await shot(prefix+'-stop-busy');await check(prefix+' local repeated action blocked',"await window.termaX11.manager.operate('start')===null");await execute("window.__x11WriteGate=false;window.__x11WriteRelease();await window.__x11Operation");await inspect(prefix+' stopped result','#modal .xserver-manager');await shot(prefix+'-stop-complete');
  await execute("window.termaX11.closeManager();await window.termaX11.openManager(0, '', 'settings')");await wait("document.querySelector('#modal .xserver-manager')");await inspect(prefix+' settings same service','#modal .xserver-manager');await shot(prefix+'-settings-local');
  await execute("closeModal();window.__x11DiscoverGate=true;window.termaX11.openLauncher(9881)");await wait('!!window.__x11DiscoverRelease');await inspect(prefix+' discovery loading','#modal .x11-app-launcher');await shot(prefix+'-launcher-loading');await execute("window.__x11DiscoverGate=false;window.__x11DiscoverRelease()");await wait("window.termaX11.launcher.state?.loading===false");await inspect(prefix+' applications','#modal .x11-app-launcher');await shot(prefix+'-launcher-ready');
  await check(prefix+' typed application and category labels',"(()=>{const select=document.querySelector('#x11AppPreset');return ['dolphin','nautilus','thunar','plasma','gnome','xfce'].every(id=>select.querySelector('[value=\"'+id+'\"]').textContent===tr('common:x11.application_'+id))&&select.querySelector('[value=\"fixture-custom\"]').textContent==='User application'&&[...select.querySelectorAll('optgroup')].some(n=>n.label==='User category')})()");
  for(const platform of ['macos','linux']){
   await execute(`window.__x11DiscoveryPatch={platform:'${platform}',xauth_available:false};await window.termaX11.launcher.detect()`);
   await check(prefix+' '+platform+' shared discovery warning',`document.querySelector('#x11AppDetection').textContent.includes(tr('common:x11.${platform==='macos'?'warning_xquartz_missing':'warning_xauth_missing'}'))`);
   await inspect(prefix+' '+platform+' discovery warning','#modal .x11-app-launcher');await shot(prefix+'-launcher-warning-'+platform);
   await execute(`await setTermaLanguage('${other}')`);await inspect(prefix+' '+platform+' warning live language','#modal .x11-app-launcher');await shot(prefix+'-launcher-warning-'+platform+'-language');await execute(`await setTermaLanguage('${language}')`);
  }
  await execute("window.__x11DiscoveryPatch={applications:[],xauth_available:false};await window.termaX11.launcher.detect()");
  await check(prefix+' empty discovery retains custom option',"document.querySelector('#x11AppPreset').options.length===1&&document.querySelector('#x11AppDetection').textContent.includes(tr('common:x11.warning_xauth_missing'))");
  await inspect(prefix+' empty applications','#modal .x11-app-launcher');await shot(prefix+'-launcher-empty');
  await execute("window.__x11DiscoverError=true;await window.termaX11.launcher.detect()");
  await inspect(prefix+' discovery failure','#modal .x11-app-launcher');await shot(prefix+'-launcher-error');
  await execute("window.__x11DiscoverError=false;window.__x11DiscoveryPatch=undefined;await window.termaX11.launcher.detect()");
  await execute(`const input=document.querySelector('#x11AppArgs');input.value='--retained draft';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(2,7);window.__x11Input=input;await setTermaLanguage('${other}')`);await check(prefix+' launcher locale keeps draft and caret',"document.querySelector('#x11AppArgs')===window.__x11Input&&window.__x11Input.value==='--retained draft'&&window.__x11Input.selectionStart===2&&document.activeElement===window.__x11Input");await inspect(prefix+' launcher language','#modal .x11-app-launcher');await shot(prefix+'-launcher-language');await execute(`await setTermaLanguage('${language}')`);
  await execute("window.__x11VerifyGate=true;window.__x11Launch=window.termaX11.launcher.submit()");await wait('!!window.__x11VerifyRelease');await shot(prefix+'-launcher-busy');const opens=await evaluate('window.__x11Opened.length');await execute("window.termaX11.closeLauncher();window.termaQuickViews.openQuickConnectionLauncher();window.__x11VerifyGate=false;window.__x11VerifyRelease();await window.__x11Launch");await check(prefix+' closed launch leaves replacement dialog',`window.__x11Opened.length===${opens}&&!!document.querySelector('#modal .quick-connection-modal')`);await shot(prefix+'-launcher-closed');
  await execute("closeModal();window.__x11PlanGate=true;window.__x11Guide=window.termaX11.openGuide(9881)");await wait('!!window.__x11PlanRelease');await shot(prefix+'-guide-loading');await execute(`await setTermaLanguage('${other}')`);await inspect(prefix+' loading guide live language','#modal .x11-install-guide');await shot(prefix+'-guide-loading-language');await execute(`await setTermaLanguage('${language}')`);await execute("window.__x11PlanGate=false;window.__x11PlanRelease();await window.__x11Guide");await inspect(prefix+' guide','#modal .x11-install-guide');await shot(prefix+'-guide-ready');await click('.x11-install-guide [data-install-mode="manual"]');await execute(`document.querySelector('.remote-install-manual').scrollIntoView({block:'center'});await setTermaLanguage('${other}')`);await check(prefix+' open manual language retains expansion',"document.querySelector('.remote-install-manual').open");await inspect(prefix+' manual language','#modal .x11-install-guide');await shot(prefix+'-guide-manual-language');await execute(`await setTermaLanguage('${language}')`);
  await click('.x11-install-guide .remote-install-copy');
  await check(prefix+' copy uses reference commands from this guide',"window.__x11Copied.at(-1)===[...document.querySelectorAll('.x11-install-guide .remote-install-manual pre')].map(node=>node.textContent).join('\\n\\n')");
  for(const [area,modes]of [['components',['online','offline','local-offline','uninstall']],['clipboard',['online','offline','local-offline','uninstall']],['forwarding',['enable','disable']]]){for(const mode of modes){const source=area==='components'?'install-guide':'xserver';await execute(source==='xserver'?"closeModal();await window.termaX11.openManager(9881)":"closeModal();await window.termaX11.openGuide(9881)");await execute(`window.__x11Operation=window.termaX11.remote.operate(9881,'${area}','${mode}',null,'${source}')`);await wait("document.querySelector('.forward-question')");await inspect(`${prefix} ${area} ${mode}`,'#modal .forward-question');await shot(`${prefix}-confirm-${area}-${mode}`);await execute(`await setTermaLanguage('${other}')`);await inspect(`${prefix} ${area} ${mode} live language`,'#modal .forward-question');await shot(`${prefix}-confirm-${area}-${mode}-language`);await execute(`await setTermaLanguage('${language}')`);await click('.forward-question button:last-child');await execute("await window.__x11Operation");}}
  await execute("closeModal();await window.termaX11.openManager(9881);window.__x11TaskMode=true;window.__x11TaskStatus='running';window.__x11OperationDone=false;window.__x11Operation=window.termaX11.remote.operate(9881,'clipboard','local-offline',null,'xserver').then(()=>window.__x11OperationDone=true)");await wait("document.querySelector('.forward-question')");await click('.forward-question button:first-child');await wait("document.querySelector('#remoteAdminMethod')");await inspect(prefix+' admin','#modal .remote-admin-modal');await execute(`const input=document.querySelector('#remoteAdminPassword');input.value='fixture-only';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(2,5);window.__x11Secret=input;await setTermaLanguage('${other}')`);await check(prefix+' authorization language retains secret and caret',"document.querySelector('#remoteAdminPassword')===window.__x11Secret&&window.__x11Secret.value==='fixture-only'&&window.__x11Secret.selectionStart===2");await shot(prefix+'-admin-language');await execute(`await setTermaLanguage('${language}')`);await click('.remote-admin-modal button[type="submit"]');await wait("document.querySelector('#x11ClipboardTaskState .remote-component-progress-head')");await execute("document.querySelector('#x11ClipboardTaskState .remote-component-progress-head').scrollIntoView({block:'center'})");await check(prefix+' task visible and uncovered',"(()=>{const n=document.querySelector('#x11ClipboardTaskState .remote-component-progress-head'),r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})()");await shot(prefix+'-task-running');await execute(`await setTermaLanguage('${other}')`);await wait("document.querySelector('#x11ClipboardTaskState .remote-component-progress-head')");await inspect(prefix+' task live language','#modal .xserver-manager');await shot(prefix+'-task-language');await execute(`await setTermaLanguage('${language}')`);await check(prefix+' exact clipboard grant',"JSON.parse(window.__x11Calls.filter(c=>c.route==='/api/admin-grants').at(-1).body).scope==='x11.clipboard.install-local-offline'");await execute("window.__x11TaskStatus='done'");await wait('window.__x11OperationDone');await inspect(prefix+' task result','#modal .xserver-manager');await check(prefix+' task mutex released',"!isUiActionInFlight('x11-clipboard-9881')");await shot(prefix+'-task-complete');
  await execute("closeModal();window.__x11PlanError=true;await window.termaX11.openGuide(9881)");await inspect(prefix+' guide error','#modal .x11-install-guide');await shot(prefix+'-guide-error');await execute(`await setTermaLanguage('${other}')`);await inspect(prefix+' failed guide live language','#modal .x11-install-guide');await check(prefix+' guide error action uses shared column',"(()=>{const root=document.querySelector('.x11-install-guide'),button=root.querySelector('.remote-diagnostic-actions button'),copy=root.querySelector('.remote-diagnostic-copy');return !!button&&button.getBoundingClientRect().left>=(innerWidth>700?copy:root).getBoundingClientRect().left-1})()");await shot(prefix+'-guide-error-language');await execute(`await setTermaLanguage('${language}');window.__x11PlanError=false`);await click('.x11-install-guide .remote-diagnostic-actions button');await wait("!!window.termaX11.remote.guideState?.result");await execute("window.termaX11.closeGuide();window.__x11PlanGate=true;window.__x11Guide=window.termaX11.openGuide(9881)");await wait('!!window.__x11PlanRelease');await execute("window.termaX11.closeGuide();window.termaQuickViews.openQuickConnectionLauncher();window.__x11PlanGate=false;window.__x11PlanRelease();await window.__x11Guide");await check(prefix+' closed plan does not reopen',"!!document.querySelector('#modal .quick-connection-modal')&&!document.querySelector('.x11-install-guide')");await shot(prefix+'-guide-closed');await execute('closeModal()');
  await execute("window.__x11OriginalActiveKey=activeTabKey;window.__x11OriginalSelected=selectedId;selectedId=9881;window.__x11TaskMode=false;window.__x11Local={...window.__x11Base};window.termaTerminalState.terminalSessions.set('x11-context-fixture',{id:9881,connection:window.__x11Connection});activeTabKey='x11-context-fixture';await window.termaX11.openManager()");
  await check(prefix+' manager entry uses active saved session',"window.termaX11.manager.state.connectionId===9881&&window.termaX11.manager.state.terminalKey==='x11-context-fixture'");
  await inspect(prefix+' active saved context','#modal .xserver-manager');await shot(prefix+'-context-saved');
  await execute("window.termaX11.closeManager();window.__x11QuickConnection={...window.__x11Connection,id:-9881,quick_connection:true};window.termaTerminalQuickRegistry.quickConnectionsById.set(-9881,window.__x11QuickConnection);window.termaTerminalState.terminalSessions.set('x11-context-fixture',{id:-9881,connection:window.__x11QuickConnection});await window.termaX11.openManager()");
  await check(prefix+' manager entry uses active quick session',"window.termaX11.manager.state.connectionId===-9881&&window.termaX11.manager.state.terminalKey==='x11-context-fixture'&&!document.querySelector('[data-action=\"x11-default-mode\"]')");
  await inspect(prefix+' active quick context','#modal .xserver-manager');await shot(prefix+'-context-quick');
  await execute("window.termaX11.closeManager();window.termaTerminalState.terminalSessions.delete('x11-context-fixture');window.termaTerminalQuickRegistry.quickConnectionsById.delete(-9881);remoteProfiles.push({id:9882,protocol:'vnc',name:'X11 context profile',host:'x11.example.test',options:{source_ssh_connection_id:9881}});tabs.push({key:'x11-context-fixture',kind:'remote-desktop',id:9882});await window.termaX11.openManager()");
  await check(prefix+' manager entry resolves remote management association',"window.termaX11.manager.state.connectionId===9881&&window.termaX11.manager.state.terminalKey===''");
  await inspect(prefix+' remote desktop context','#modal .xserver-manager');await shot(prefix+'-context-remote-desktop');
  await execute("window.termaX11.closeManager();tabs.find(t=>t.key==='x11-context-fixture').kind='welcome';window.__x11ContextCallCount=window.__x11Calls.length;await window.termaX11.openManager()");
  await check(prefix+' unrelated active tab cannot inherit selected SSH',"window.termaX11.manager.state.connectionId===0&&window.__x11Calls.slice(window.__x11ContextCallCount).every(c=>!c.route.startsWith('/api/connections/'))");
  await inspect(prefix+' local only context','#modal .xserver-manager');await shot(prefix+'-context-local');
  for(const [code,key]of [['xserver_display_unavailable','reason_xserver_display_unavailable'],['xquartz_not_installed','reason_xquartz_not_installed'],['linux_display_missing','reason_linux_display_missing']]){
   await execute(`window.__x11Local={...window.__x11Base,available:false,running:false,can_start:false,can_stop:false,reason_code:'${code}',mode:'system'};await window.termaX11.manager.refresh()`);
   await check(prefix+' '+code+' typed reason',`document.querySelector('.xserver-manager').textContent.includes(tr('common:x11.${key}'))`);
   await inspect(prefix+' '+code,'#modal .xserver-manager');await shot(prefix+'-reason-'+code);
   await execute(`await setTermaLanguage('${other}')`);await check(prefix+' '+code+' live translation',`document.querySelector('.xserver-manager').textContent.includes(tr('common:x11.${key}'))`);await inspect(prefix+' '+code+' live language','#modal .xserver-manager');await shot(prefix+'-reason-'+code+'-language');await execute(`await setTermaLanguage('${language}')`);
  }
  await execute("window.__x11Local={...window.__x11Local,reason_code:'xserver_ready',reason:'<fixture> remote stderr',reason_preserve_message:true};await window.termaX11.manager.refresh()");
  await check(prefix+' preserved diagnostic remains text',"document.querySelector('.xserver-manager').textContent.includes('<fixture> remote stderr')&&!document.querySelector('.xserver-manager fixture')");
  await inspect(prefix+' preserved raw diagnostic','#modal .xserver-manager');await shot(prefix+'-reason-preserved');
  await execute("window.termaX11.closeManager();tabs.splice(tabs.findIndex(t=>t.key==='x11-context-fixture'),1);remoteProfiles.splice(remoteProfiles.findIndex(p=>p.id===9882),1);activeTabKey=window.__x11OriginalActiveKey;selectedId=window.__x11OriginalSelected;window.__x11Local={...window.__x11Base}");
 }
 await execute('window.termaClipboard.copy=window.__x11Copy');
 const report={checks:assertions.length,states,assertions,realHostMutations:false};fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));return {checks:report.checks,states:states.length,directory};
}
module.exports={runX11UiScenario};
