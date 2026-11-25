const assert = require('node:assert/strict');
const {vncLifecycleStates}=require('./m7-vnc-ui-states');

async function runRemoteGraphicsUiScenario(browser, {execute,evaluate,wait,shot:saveShot,click,assertions}) {
  let screenshotCount=0;
  const shot=async name=>{try{await saveShot(name);screenshotCount++;}catch(error){throw new Error(`Could not capture ${name}`,{cause:error});}};
  const profiles = [
    {id:9794,protocol:'rdp',name:'Fixture RDP',host:'rdp.example.test',port:3389,username:'review',group_name:'Graphical fixtures',options:{}},
    {id:9795,protocol:'xdmcp',name:'Fixture XDMCP',host:'xdmcp.example.test',port:177,username:'review',group_name:'Graphical fixtures',options:{}},
    {id:9796,protocol:'vnc',name:'Fixture VNC',host:'vnc.example.test',port:5900,username:'review',group_name:'Graphical fixtures',has_password:false,options:{client_mode:'embedded',view_only:true,auto_sync_images:false,shared:false}}
  ];

  const realVnc = await execute(`
    const first=window.termaVncRuntime.loadRfb(),second=window.termaVncRuntime.loadRfb();
    const [Rfb, vendor]=await Promise.all([first,import('/vendor/novnc/core/rfb.js')]);
    return {
      sharesLoad:first===second,
      usesVendor:Rfb===vendor.default,
      canDisconnect:typeof Rfb.prototype.disconnect==='function',
      patchesFailure:Rfb.prototype.__termaFailureEventPatched===true
    };
  `);
  assert.deepEqual(realVnc,{sharesLoad:true,usesVendor:true,canDisconnect:true,patchesFailure:true});
  for (const name of Object.keys(realVnc)) assertions.push({name:`real noVNC ${name}`,passed:true});

  await execute(`
    await window.termaI18nReady;
    window.termaWorkspaceRefresh.stop();
    window.__graphicsOriginalApi=api;
    window.__graphicsOriginalRfb=window.termaVncRuntime.loadRfb;
    window.__graphicsOriginalProfiles=remoteProfiles;
    window.__graphicsOriginalConnections=connections;
    window.__graphicsFixtureStyle=document.createElement('style');window.__graphicsFixtureStyle.textContent='.graphics-fixture-desktop{width:min(640px,85%);aspect-ratio:4/3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;margin:auto;border:1px solid #65a8ff;border-radius:8px;color:#fff;background:#175da8;font:600 18px system-ui} .graphics-fixture-desktop span{font-size:13px;font-weight:400;color:#eaf4ff}';document.head.append(window.__graphicsFixtureStyle);
    remoteProfiles=${JSON.stringify(profiles)};
    connections=[{id:9798,name:'Clipboard SSH alternate',ssh_host:'other.example.test',ssh_user:'review',ssh_port:2222}];
    window.__clipboardHelperCalls=[];window.__clipboardOtherActions=[];window.__clipboardDelayGuide=false;window.__clipboardFixtureMode='missing';window.__clipboardUiActions=[];
    const clipboardHelper=window.termaVncRuntime.helper;
    window.__graphicsOriginalClipboardActions={operate:clipboardHelper.operate,copy:window.termaClipboard.copy,prompt:window.termaConnectionCredentials.prompt};
    clipboardHelper.operate=(key,mode)=>window.__clipboardUiActions.push(mode==='uninstall'?{action:'uninstall',key}:{action:'install',key,mode});
    window.termaClipboard.copy=async text=>window.__clipboardUiActions.push({action:'copy',text});
    window.termaConnectionCredentials.prompt=async connection=>{window.__clipboardUiActions.push({action:'repair',key:'remote-desktop-9796',connectionId:connection.id});return null;};
    window.__graphicsRfbs=[];
    window.__graphicsAuthorization=null;window.__graphicsAuthorizationCalls=[];
    api=async(route,options={})=>{
      const value=String(route);
      if(value==='/api/desktop-integration/status'&&window.__graphicsAuthorization)return {...window.__graphicsAuthorization};
      if(value==='/api/desktop-integration/authorize'&&window.__graphicsAuthorization){
        if(options.method==='DELETE'){window.__graphicsAuthorization={...window.__graphicsAuthorization,scopes:[],authorized:false};return {...window.__graphicsAuthorization};}
        const body=JSON.parse(options.body||'{}');window.__graphicsAuthorizationCalls.push(body);
        await new Promise(resolve=>{window.__graphicsApproveAuthorization=resolve;});
        window.__graphicsApproveAuthorization=null;
        window.__graphicsAuthorization={...window.__graphicsAuthorization,approved:true,authorized:true,authorization_kind:'temporary',scopes:body.scopes,authorization_browser_session:body.authorization_mode==='browser-session',authorization_expires_at:Date.now()+body.duration_minutes*60000};
        return {...window.__graphicsAuthorization};
      }
      if(value==='/api/remote-clients/diagnostics')return {
        ...(window.__graphicsAuthorization||{}),
        rdp:{available:true,system_available:true,client:'Fixture RDP client'},
        xdmcp:{available:true,system_available:true,client:'Fixture XDMCP client'},
        vnc:{available:true,system_available:true,client:'Fixture VNC client'}
      };
      if(/^\\/api\\/remote-profiles\\/979[456]\\/connectivity$/.test(value))return window.__graphicsBlockedVnc && value.includes('/9796/')
        ? {supported:true,ok:false,status:'unreachable',method:'tcp',error:'Fixture endpoint unavailable'}
        : {supported:true,ok:true,status:'reachable',method:'tcp'};
      if(value==='/api/remote-profiles/9796'&&options.method==='PUT'){
        const profile=window.termaRemoteProfiles.byId(9796),body=JSON.parse(options.body||'{}');
        return {...profile,options:{...body.options}};
      }
      if(value==='/api/remote-profiles/9796/vnc/server')return {diagnostics_available:false,management_available:false,status:'unmanaged'};
      if(value==='/api/connections/9797/linux-desktop')return {platform_supported:true,os_id:'debian',has_desktop:!window.__graphicsMissingDesktop,desktop_catalog:[]};
      if(value==='/api/connections/9797/x11-forwarding')return {platform:'linux',ready:false};
      if(value==='/api/linux-desktop/tasks')return [];
      if(value==='/api/remote-profiles/9796/vnc-clipboard/helper'){
        const body=JSON.parse(options.body||'{}'),connectionId=Number(body.connection_id||0);
        if(body.action!=='guide'){window.__clipboardOtherActions.push(body);throw new Error('Clipboard fixture blocks mutating helper actions');}
        window.__clipboardHelperCalls.push({connection_id:connectionId,action:body.action});
        if(window.__clipboardDelayGuide)await new Promise(resolve=>{window.__clipboardResolveGuide=()=>{window.__clipboardDelayGuide=false;resolve();};});
        const guideText=(key,params={})=>({i18n_key:'remote:clipboard_guide.'+key,params}),installText=key=>({i18n_key:'remote:install.'+key,params:{}});
        const mode=window.__clipboardFixtureMode;
        if(mode==='error')throw Object.assign(new Error(tr('remote:clipboard.probe_failed')),{code:'SSH_AUTHENTICATION_FAILED'});
        const result={ok:true,action:'guide',connection_id:connectionId,connection_name:connectionId===9797?'Clipboard SSH same-host':'Clipboard SSH alternate',available:false,platform:'linux',session_type:'x11',package_manager:'apt',reason:guideText('linux_summary_unknown',{packages:'xclip/xsel or wl-clipboard'}),
          install_plan:{online:{available:true,command:'sudo apt-get install -y xclip',description:installText('online_description')},local_offline:{available:true,command:'',description:installText('local_offline_description'),package_names:['xclip']},offline:{available:true,command:'sudo apt-get install --no-download xclip',description:installText('remote_cache_description')},manual:{available:true},uninstall:{available:false,command:''}},
          uninstall_plan:{available:false,command:''},guide:{title:guideText('linux_title'),summary:guideText('linux_summary_unknown',{packages:'xclip/xsel or wl-clipboard'}),steps:[guideText('linux_install_tool'),guideText('linux_session_environment'),guideText('linux_redetect'),guideText('linux_offline_apt'),...Array.from({length:8},()=>guideText('linux_session_environment'))],commands:['printf "%s\\n" "$DISPLAY" "$WAYLAND_DISPLAY"','command -v xclip xsel wl-copy wl-paste']}};
        if(mode==='linux-ready')return {...result,available:true,transport:'ssh-linux',tool:'xclip',uninstall_plan:{available:true,command:'sudo apt-get remove -y xclip',package_names:['xclip']}};
        if(mode==='macos')return {...result,platform:'macos',available:true,transport:'ssh-macos',tool:'pbcopy/pbpaste',install_plan:{},guide:{title:guideText('macos_title'),summary:guideText('macos_summary'),steps:[guideText('macos_confirm_connection'),guideText('macos_confirm_session'),guideText('macos_verify_tools'),guideText('macos_relogin')],commands:['command -v /usr/bin/pbcopy /usr/bin/pbpaste']}};
        if(mode==='unknown')return {...result,platform:'unknown',reason:{i18n_key:'remote:clipboard.confirm_remote_system'},install_plan:{},guide:{steps:[],commands:[]}};
        return result;
      }
      return window.__graphicsOriginalApi(route,options);
    };
    window.termaVncRuntime.loadRfb=async()=>class FixtureRFB {
      constructor(screen,url,options){
        this.screen=screen;this.url=url;this.options=options;this.handlers=new Map();this.sentCredentials=null;
        const desktop=document.createElement('div');desktop.className='graphics-fixture-desktop';desktop.innerHTML='<strong>Fixture remote desktop</strong><span>1024 × 768</span>';screen.append(desktop);
        window.__graphicsRfbs.push(this);
      }
      addEventListener(name,handler){const listeners=this.handlers.get(name)||[];listeners.push(handler);this.handlers.set(name,listeners);}
      emit(name,detail={}){for(const handler of this.handlers.get(name)||[])handler({detail});}
      sendCredentials(value){this.sentCredentials=value;}
      sendCtrlAltDel(){this.ctrlAltDelSent=true;}
      disconnect(){this.disconnected=true;this.emit('disconnect',{clean:true});}
    };
  `);

  const matrix = [];
  const checkDesktopAuthorization = async (prefix, language) => {
    const host = '#remoteDesktopAuthorization', other = language==='en-US'?'zh-CN':'en-US';
    const check = async (name, source) => {
      const value=await evaluate(source);assert.equal(value,true,`${prefix} ${name}`);assertions.push({name:`${prefix} ${name}`,value});
    };
    const capture = async name => {
      await execute(`dismissToast();document.querySelector('${host}').scrollIntoView({block:'center'})`);
      await check('authorization controls fit and remain reachable',`(()=>{const panel=document.querySelector('${host} .desktop-integration-authorization'),bounds=panel.getBoundingClientRect();return [...panel.querySelectorAll('button,select,input')].filter(node=>node.checkVisibility()).every(node=>{const r=node.getBoundingClientRect();return r.left>=bounds.left-1&&r.right<=bounds.right+1&&r.top>=0&&r.bottom<=innerHeight+1&&(node.disabled||node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))})})()`);
      await shot(`graphics-${prefix}-desktop-authorization-${name}`);
    };
    await execute("window.__graphicsAuthorization={desktop_backend_available:true,can_request_authorization:true,web_session_authenticated:true,scopes:[]};await window.termaRemoteDesktop.open(9794,false,true)");
    await wait(`document.querySelector('${host} [data-action="desktop-integration-authorize"]')`);
    await execute(`const select=document.querySelector('${host} select');select.value='custom';select.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0));const input=document.querySelector('${host} input');input.value='149';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();window.__graphicsAuthorizationInput=input`);
    await capture('custom');
    await execute(`await setTermaLanguage('${other}')`);
    await check('authorization draft and focus survive live language',"document.activeElement===window.__graphicsAuthorizationInput&&window.__graphicsAuthorizationInput.value==='149'&&window.__graphicsAuthorizationInput.isConnected");
    await check('authorization visible text and hidden attributes translate',`(()=>{const root=document.querySelector('${host}'),text=root.textContent+' '+[...root.querySelectorAll('[title],[aria-label],[placeholder]')].flatMap(node=>[node.title,node.getAttribute('aria-label'),node.getAttribute('placeholder')]).join(' ');return document.documentElement.lang!=='en-US'||!/[\\u3400-\\u9fff]/.test(text)})()`);
    await capture('language');
    await execute(`await setTermaLanguage('${language}')`);
    await click(`${host} [data-action="desktop-integration-authorize"]`);
    await wait(`window.__graphicsApproveAuthorization&&document.querySelector('${host} button')?.disabled`);
    await capture('busy');
    await execute('window.__graphicsApproveAuthorization()');
    await wait(`document.querySelector('${host} [data-action="desktop-integration-revoke"]')`);
    await check('remote page sends exact scope and custom duration',"(()=>{const body=window.__graphicsAuthorizationCalls.at(-1);return body.scopes.join()==='remote-client'&&body.duration_minutes===149&&body.authorization_mode==='timed'})()");
    await capture('granted');
    await click(`${host} [data-action="desktop-integration-revoke"]`);
    await wait(`document.querySelector('${host} [data-action="desktop-integration-authorize"]')`);
    await capture('revoked');
    await execute(`const select=document.querySelector('${host} select');select.value='browser-session';select.dispatchEvent(new Event('change',{bubbles:true}))`);
    await click(`${host} [data-action="desktop-integration-authorize"]`);
    await wait('window.__graphicsApproveAuthorization');
    await execute('window.__graphicsApproveAuthorization()');
    await wait(`document.querySelector('${host} [data-action="desktop-integration-revoke"]')`);
    await check('remote page preserves browser-session authorization',"(()=>{const body=window.__graphicsAuthorizationCalls.at(-1);return body.authorization_mode==='browser-session'&&body.duration_minutes===0})()");
    await capture('browser-session');
    await click(`${host} [data-action="desktop-integration-revoke"]`);
    await wait(`document.querySelector('${host} [data-action="desktop-integration-authorize"]')`);
    await execute('window.__graphicsAuthorization=null;await window.termaRemoteDesktop.open(9794,false,true)');
  };
  const checkSetupGuide = async (protocol, prefix, language) => {
    const expected=await evaluate("(()=>{const modal=document.querySelector('#modal');const card=modal.querySelector('.terma-remote-setup-guide');const text=[...card.querySelectorAll('[title],[aria-label]')].flatMap(node=>[node.title,node.getAttribute('aria-label')]).join(' ');return {owner:modal.classList.contains('terma-remote-root'),controls:[...card.querySelectorAll('button:not(.dialog-window-resize)')].every(node=>node.matches('[data-terma-button]')),safe:!card.querySelector('[onclick]'),translated:document.documentElement.lang!=='en-US'||!/[\u3400-\u9fff]/.test(card.textContent+' '+text),overflow:card.scrollWidth>card.clientWidth+1}})()");
    assert.deepEqual(expected,{owner:true,controls:true,safe:true,translated:true,overflow:false},`${prefix} ${protocol} setup guide is Vue/Tile-owned, translated and contained`);
    const nextLanguage=language==='en-US'?'zh-CN':'en-US';
    await execute(`const card=document.querySelector('#modal .terma-remote-setup-guide');card.scrollTop=22;window.__setupGuideScroll=card.scrollTop;window.__setupGuideFocus=card.querySelector('[data-remote-setup-manage]');window.__setupGuideFocus.focus({preventScroll:true});await setTermaLanguage('${nextLanguage}')`);
    assert.equal(await evaluate("(()=>{const card=document.querySelector('#modal .terma-remote-setup-guide');return document.activeElement===window.__setupGuideFocus&&card.scrollTop===window.__setupGuideScroll&&!!card.querySelector('[data-remote-setup-manage]')})()"),true,`${prefix} ${protocol} open guide keeps focus and scroll when changing locale`);
    await shot(`graphics-${prefix}-${protocol}-setup-live-language`);
    await execute(`await setTermaLanguage('${language}')`);
  };
  const checkClipboardDialogs = async (prefix, language) => {
    const session="window.termaVncRuntime.session.sessions.get('remote-desktop-9796')";
    const inspectDialog=async label=>{
      const result=await evaluate("(()=>{const card=document.querySelector('#modal .vnc-clipboard-modal');const text=card.textContent+' '+[...card.querySelectorAll('[title],[aria-label],[placeholder]')].flatMap(node=>[node.title,node.getAttribute('aria-label'),node.getAttribute('placeholder')]).join(' ');return {english:document.documentElement.lang!=='en-US'||!/[\\u3400-\\u9fff]/.test(text),overflow:card.scrollWidth>card.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1,inline:!!card.querySelector('[onclick],[onchange]'),object:text.includes('[object Object]'),buttons:[...card.querySelectorAll('button:not(.dialog-window-resize)')].every(button=>button.hasAttribute('data-terma-button'))}})()");
      assert.deepEqual(result,{english:true,overflow:false,inline:false,object:false,buttons:true},`${prefix} ${label} clipboard chrome and hidden manual text translate without overflow or inline handlers`);
      assert.equal(await evaluate("document.querySelectorAll('#modal .modal-card').length===1&&!document.querySelector('#modal [data-legacy-dialog]')"),true,`${prefix} ${label} clipboard prompt replaces dismissed legacy content`);
      const contrasts=await evaluate("(()=>{const context=document.createElement('canvas').getContext('2d',{willReadFrequently:true});const luminance=color=>{context.fillStyle=color;context.fillRect(0,0,1,1);const rgb=[...context.getImageData(0,0,1,1).data].slice(0,3).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};return [...document.querySelectorAll('#modal .vnc-clipboard-modal > .connection-test-status.warning')].map(node=>{const style=getComputedStyle(node),a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})})()");
      assert.ok(contrasts.every(value=>value>=4.5),`${prefix} ${label} clipboard warning text contrast: ${contrasts.join(', ')}`);
    };
    await execute("dismissToast();closeModal();document.querySelector('#modal').innerHTML='<div class=\"modal-card\" data-legacy-dialog>Previous SFTP dialog</div>';window.__clipboardFixtureMode='missing';connections.push({id:9797,name:'Clipboard SSH same-host',ssh_host:'vnc.example.test',ssh_user:'review',ssh_port:22})");
    await click('#view-remote-desktop [data-vnc-clipboard-helper]');
    await wait("!document.querySelector('#modal').hidden&&document.querySelector('#vncClipboardSshConnection')&&document.querySelector('#modal .vnc-clipboard-helper-modal')");
    await wait("document.querySelector('#modal .remote-install-modes')&&window.__clipboardHelperCalls.some(item=>item.connection_id===9797)");
    const initial=await evaluate("(()=>{const modal=document.querySelector('#modal'),card=modal.querySelector('.modal-card'),select=modal.querySelector('#vncClipboardSshConnection'),details=modal.querySelector('.remote-install-manual'),buttons=[...modal.querySelectorAll('button:not(.dialog-window-resize)')];return {owner:modal.classList.contains('terma-remote-root')&&modal.hasAttribute('data-i18n-skip'),controls:buttons.every(button=>button.matches('[data-terma-button]')),safe:!modal.querySelector('[onclick]'),selected:Number(select.value),options:select.options.length,manualSteps:modal.querySelectorAll('.remote-install-manual li').length,translated:document.querySelector('#vncClipboardDialogTitle').textContent===tr('remote:clipboard.helper_title')&&modal.querySelector('.actions [data-vnc-clipboard-helper-cancel]').textContent.trim()===tr('remote:clipboard.cancel'),overflow:card.scrollWidth>card.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1,detailsOpen:details.open}})()");
    assert.deepEqual(initial,{owner:true,controls:true,safe:true,selected:9797,options:3,manualSteps:13,translated:true,overflow:false,detailsOpen:false},`${prefix} SSH clipboard helper opens with localized, contained Vue controls and same-host default`);
    await inspectDialog('missing helper');
    assert.equal(await evaluate("(()=>{const close=document.querySelector('#modal .modal-title-row [data-vnc-clipboard-helper-cancel]');if(!close)return false;const bounds=close.getBoundingClientRect();return close.contains(document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2))})()"),true,`${prefix} helper close control is visible and hit-testable`);
    await shot(`graphics-${prefix}-vnc-clipboard-helper`);
    for(const mode of ['online','local-offline','offline']){
      await execute(`document.querySelector('#modal [data-install-mode="${mode}"]').scrollIntoView({block:'center'})`);
      await click(`#modal [data-install-mode="${mode}"]`);
      assert.deepEqual(await evaluate('window.__clipboardUiActions.at(-1)'),{action:'install',key:'remote-desktop-9796',mode},`${prefix} ${mode} install targets the owning VNC session`);
    }
    await execute(`const key='vnc-clipboard-helper:9796';beginUiAction(key,null,tr('remote:clipboard.installing'));await window.termaVncRuntime.helper.inspect(${session})`);
    assert.equal(await evaluate("[...document.querySelectorAll('#modal [data-install-mode]:not([data-install-mode=manual])')].every(button=>button.disabled)&&!document.querySelector('#modal [data-install-mode=manual]').disabled"),true,`${prefix} a running helper action disables duplicate installation while preserving manual instructions`);
    await inspectDialog('busy');
    await shot(`graphics-${prefix}-vnc-clipboard-busy`);
    await execute(`endUiAction('vnc-clipboard-helper:9796');await window.termaVncRuntime.helper.inspect(${session})`);
    await execute("document.querySelector('#modal [data-install-mode=manual]').scrollIntoView({block:'center'})");
    await click('#modal [data-install-mode=manual]');
    await wait("document.querySelector('#modal .remote-install-manual')?.open===true");
    await execute("document.querySelector('#modal [data-management-action=copy-reference]').scrollIntoView({block:'center'})");
    await click('#modal [data-management-action=copy-reference]');
    assert.deepEqual(await evaluate("window.__clipboardUiActions.at(-1)"),{action:'copy',text:await evaluate("[...document.querySelectorAll('#modal .remote-install-manual pre')].map(node=>node.textContent).join('\\n\\n')")},`${prefix} copy matches the visible guide text`);
    await execute("const card=document.querySelector('#modal .modal-card'),select=document.querySelector('#vncClipboardSshConnection');select.focus({preventScroll:true});card.scrollTop=card.scrollHeight;window.__clipboardHelperFocus=select;window.__clipboardHelperScroll=card.scrollTop");
    const expanded=await evaluate("(()=>({open:document.querySelector('#modal .remote-install-manual')?.open,scroll:document.querySelector('#modal .modal-card')?.scrollTop,scrollMax:(document.querySelector('#modal .modal-card')?.scrollHeight||0)-(document.querySelector('#modal .modal-card')?.clientHeight||0)}))()");
    assert.equal(expanded.open,true,`${prefix} manual SSH clipboard instructions expand`);
    assert.ok(expanded.scroll>0&&expanded.scrollMax>0,`${prefix} expanded helper has independently scrollable content`);
    await shot(`graphics-${prefix}-vnc-clipboard-helper-expanded`);
    const nextLanguage=language==='en-US'?'zh-CN':'en-US';
    await execute(`await setTermaLanguage('${nextLanguage}')`);
    await inspectDialog('live language');
    const live=await evaluate("(()=>{const modal=document.querySelector('#modal'),card=modal.querySelector('.modal-card'),select=modal.querySelector('#vncClipboardSshConnection');return {language:document.documentElement.lang,title:modal.querySelector('#vncClipboardDialogTitle')?.textContent,selected:Number(select?.value),focused:document.activeElement===window.__clipboardHelperFocus,scrollPreserved:Math.abs(card.scrollTop-Math.min(window.__clipboardHelperScroll,card.scrollHeight-card.clientHeight))<=1,expanded:modal.querySelector('.remote-install-manual')?.open,overflow:card.scrollWidth>card.clientWidth+1||document.documentElement.scrollWidth>innerWidth+1}})()");
    assert.deepEqual(live,{language:nextLanguage,title:await evaluate("tr('remote:clipboard.helper_title')"),selected:9797,focused:true,scrollPreserved:true,expanded:true,overflow:false},`${prefix} helper language repaint preserves connection selection, focus, expanded guide and scroll within the translated content bounds`);
    await shot(`graphics-${prefix}-vnc-clipboard-helper-live-language`);
    await execute("const select=document.querySelector('#vncClipboardSshConnection');select.value='9798';select.dispatchEvent(new Event('change',{bubbles:true}))");
    await wait("window.__clipboardHelperCalls.some(item=>item.connection_id===9798)&&document.querySelector('#vncClipboardHelperState .remote-service-head small')?.textContent==='Clipboard SSH alternate'");
    assert.equal(await evaluate("Number(document.querySelector('#vncClipboardSshConnection').value)"),9798,`${prefix} selecting another SSH connection requests fresh diagnostics for that exact connection`);
    await execute(`await setTermaLanguage('${language}')`);
    for(const mode of ['linux-ready','macos','unknown','error']){
      await execute(`${mode==='unknown' ? "connections=connections.filter(connection=>connection.id!==9797);" : ''}window.__clipboardFixtureMode='${mode}';void window.termaVncRuntime.helper.inspect(${session})`);
      await wait("document.querySelector('#vncClipboardHelperState .remote-service-head, #vncClipboardHelperState .remote-diagnostic-status')");
      await inspectDialog(mode);
      assert.equal(await evaluate("!!document.querySelector('#modal [data-management-action=uninstall]')"),mode==='linux-ready',`${prefix} uninstall is shown only for a removable Linux helper`);
      assert.equal(await evaluate("!!document.querySelector('#modal [data-management-action=repair-credentials]')"),mode==='error',`${prefix} authentication failure exposes credential repair`);
      if(mode==='unknown')assert.equal(await evaluate("document.querySelector('#modal .vnc-clipboard-helper-modal').textContent.includes(tr('remote:clipboard.no_match'))&&!document.querySelector('#modal .remote-install-modes')"),true,`${prefix} an unmatched unrecognized host explains the selection without offering Linux installation`);
      await execute("document.querySelector('#vncClipboardHelperState').scrollIntoView({block:'start'})");
      await shot(`graphics-${prefix}-vnc-clipboard-${mode}`);
      if(mode==='linux-ready'){
        await execute("document.querySelector('#modal [data-management-action=uninstall]').scrollIntoView({block:'center'})");
        await click('#modal [data-management-action=uninstall]');
        assert.deepEqual(await evaluate('window.__clipboardUiActions.at(-1)'),{action:'uninstall',key:'remote-desktop-9796'},`${prefix} uninstall targets the owning VNC session`);
      }
      if(mode==='error'){
        await click('#modal [data-management-action=repair-credentials]');
        assert.deepEqual(await evaluate('window.__clipboardUiActions.at(-1)'),{action:'repair',key:'remote-desktop-9796',connectionId:9798},`${prefix} repair targets the selected SSH connection`);
        await execute("window.__clipboardFixtureMode='missing'");
        await click('#modal [data-management-action=detect-again]');
        await wait("!!document.querySelector('#modal .remote-install-modes')");
        await inspectDialog('retry');
        await shot(`graphics-${prefix}-vnc-clipboard-retry`);
      }
    }
    await click('#modal .actions [data-vnc-clipboard-helper-cancel]');
    await wait("document.querySelector('#modal').hidden");
    assert.equal(await evaluate("!document.querySelector('#modal').classList.contains('terma-remote-root')&&window.__clipboardOtherActions.length===0"),true,`${prefix} cancelling helper releases Vue ownership without installing or saving`);

    await execute(`document.querySelector('#modal').innerHTML='<div class="modal-card" data-legacy-dialog>Previous SFTP dialog</div>';window.__clipboardTextPromise=window.termaVncRuntime.helper.promptText(${session},{i18n_key:'remote:clipboard.browser_read_denied'});void window.__clipboardTextPromise.then(value=>{window.__clipboardTextResult=value})`);
    await wait("!document.querySelector('#modal').hidden&&document.querySelector('#vncClipboardManualText')");
    await inspectDialog('manual paste');
    await execute("const input=document.querySelector('#vncClipboardManualText');input.value='Clipboard draft 中文\\nsecond line';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(4,13);window.__clipboardTextFocus=input");
    await shot(`graphics-${prefix}-vnc-clipboard-text`);
    await execute(`await setTermaLanguage('${nextLanguage}')`);
    await inspectDialog('manual paste live language');
    const textState=await evaluate("(()=>{const input=document.querySelector('#vncClipboardManualText');return {language:document.documentElement.lang,title:document.querySelector('#vncClipboardDialogTitle')?.textContent,value:input?.value,start:input?.selectionStart,end:input?.selectionEnd,focused:document.activeElement===window.__clipboardTextFocus,overflow:document.querySelector('#modal .modal-card').scrollWidth>document.querySelector('#modal .modal-card').clientWidth+1||document.documentElement.scrollWidth>innerWidth+1}})()");
    assert.deepEqual(textState,{language:nextLanguage,title:await evaluate("tr('remote:clipboard.send_to',{name:'Fixture VNC'})"),value:'Clipboard draft 中文\nsecond line',start:4,end:13,focused:true,overflow:false},`${prefix} manual clipboard draft and caret survive locale change`);
    await shot(`graphics-${prefix}-vnc-clipboard-text-live-language`);
    await execute(`await setTermaLanguage('${language}')`);
    await click('#modal [data-vnc-clipboard-cancel]');
    await wait("document.querySelector('#modal').hidden&&window.__clipboardTextResult===null");
    assert.equal(await evaluate("window.__clipboardOtherActions.length===0&&window.termaVncRuntime.session.sessions.get('remote-desktop-9796').clipboardPendingUnicodeText===undefined"),true,`${prefix} cancelling manual paste does not send clipboard content`);
    return {helper:true,manualText:true};
  };
  async function checkJumpActions(prefix, language) {
    await execute(`
      window.__jumpOriginal={profiles:remoteProfiles,connections,select:window.termaConnectionController.select,sftp:window.termaSftpPage.open,open:window.termaRemoteProfiles.open};
      const host='jump.example.test';
      remoteProfiles=remoteProfiles.map(profile=>({...profile,host,options:{...profile.options,source_ssh_connection_id:9799}}));
      remoteProfiles.push({id:9793,protocol:'vnc',name:'Different SSH source',host,options:{source_ssh_connection_id:9800}});
      connections=[...connections,{id:9799,name:'Linked SSH',ssh_host:host,ssh_user:'review',ssh_port:22},{id:9800,name:'Different SSH',ssh_host:host,ssh_user:'review',ssh_port:2222}];
      window.__jumpCalls=[];
      window.termaConnectionController.select=(id,...args)=>{
        if(id===9799){window.__jumpCalls.push(['terminal',id]);return;}
        return window.__jumpOriginal.select(id,...args);
      };
      window.termaSftpPage.open=id=>window.__jumpCalls.push(['sftp',id]);
      window.termaRemoteProfiles.open=profile=>window.__jumpCalls.push(['open',profile.id]);
      await window.termaRemoteDesktop.open(9794,true,true);
    `);
    try {
      const root='#view-remote-desktop .remote-desktop-jump-actions';
      const state=await evaluate(`(()=>{
        const root=document.querySelector(${JSON.stringify(root)}),buttons=[...root.querySelectorAll('button:not(.dialog-window-resize)')];
        const text=[...root.querySelectorAll('[title],[aria-label]')].flatMap(node=>[node.title,node.getAttribute('aria-label')]).join(' ');
        return {count:buttons.length,owned:buttons.every(button=>button.matches('[data-terma-button]')),safe:!root.querySelector('[onclick]'),english:document.documentElement.lang!=='en-US'||!/[\\u3400-\\u9fff]/.test(text)};
      })()`);
      assert.deepEqual(state,{count:3,owned:true,safe:true,english:true},prefix+' Vue linked jump controls');
      await shot(`graphics-${prefix}-linked-jumps`);
      for (let index=1;index<=3;index++) await click(`${root} button:nth-child(${index})`);
      const options='#actionMenu [data-terminal-display-action]';
      await wait(`document.querySelectorAll(${JSON.stringify(options)}).length===2`);
      const labels=await evaluate(`[...document.querySelectorAll(${JSON.stringify(options)})].map(button=>button.textContent.trim())`);
      assert.equal(labels.some(label=>label.includes('Fixture XDMCP'))&&labels.some(label=>label.includes('Fixture VNC'))&&!labels.some(label=>label.includes('Different SSH source')),true,prefix+' desktop switch excludes the other SSH source');
      await shot(`graphics-${prefix}-linked-jump-menu`);
      await click('#actionMenu [data-terminal-display-action="action-0"]');
      assert.deepEqual(await evaluate('window.__jumpCalls'),[['terminal',9799],['sftp',9799],['open',9795]],prefix+' real pointer preserves linked target');
      const other=language==='zh-CN'?'en-US':'zh-CN';
      await execute(`await setTermaLanguage('${other}')`);
      const title=await evaluate(`document.querySelector(${JSON.stringify(root)}+' button').title`);
      assert.equal(title,await evaluate("tr('remote:actions.open_linked_terminal')"),prefix+' open page jump labels translate');
      await shot(`graphics-${prefix}-linked-jumps-language`);
      matrix.push({prefix,jumpActions:state,targets:true,liveLanguage:true});
    } finally {
      await execute(`
        hideActionMenu();
        remoteProfiles=window.__jumpOriginal.profiles;connections=window.__jumpOriginal.connections;
        window.termaConnectionController.select=window.__jumpOriginal.select;window.termaSftpPage.open=window.__jumpOriginal.sftp;window.termaRemoteProfiles.open=window.__jumpOriginal.open;
        await setTermaLanguage('${language}');await window.termaRemoteDesktop.open(9794,true);
        delete window.__jumpOriginal;
      `);
    }
  }
  async function checkMissingDesktop(prefix, language) {
    const manage = '#view-remote-desktop #remoteDesktopManageLinuxButton';
    await execute("window.termaVncRuntime.close('remote-desktop-9796');window.__graphicsRfbs=[];window.__graphicsMissingDesktop=true;connections.push({id:9797,name:'Linux desktop fixture',ssh_host:'vnc.example.test',ssh_user:'review',ssh_port:22});await window.termaRemoteDesktop.open(9796,true,true)");
    await execute("document.querySelector('#view-remote-desktop #remoteDesktopLaunchButton').scrollIntoView({block:'nearest'})");
    await click('#view-remote-desktop #remoteDesktopLaunchButton');
    await wait(`document.querySelector('${manage}')?.checkVisibility()`);
    const state = "(()=>{const root=document.querySelector('#view-remote-desktop');const status=root.querySelector('[role=status]');return {owned:root.classList.contains('terma-remote-root'),text:status?.textContent===tr('remote:diagnostics.linux_desktop_missing',{protocol:'VNC'}),buttons:[...root.querySelectorAll('button')].every(node=>node.matches('[data-terma-button]')),inline:!!root.querySelector('[onclick]'),opening:window.__graphicsRfbs.length>0,overflow:root.scrollWidth>root.clientWidth+1,stale:!!root.querySelector('#vncServerState,[data-management-owned]')}})()";
    assert.deepEqual(await evaluate(state),{owned:true,text:true,buttons:true,inline:false,opening:false,overflow:false,stale:false},`${prefix} missing Linux desktop shows the typed warning without opening VNC or retaining the previous diagnostics`);
    await execute('dismissToast()');
    await shot(`graphics-${prefix}-vnc-linux-desktop-missing`);
    const other = language==='zh-CN'?'en-US':'zh-CN';
    await execute(`await setTermaLanguage('${other}')`);
    assert.equal(await evaluate(`document.querySelector('${manage}')?.textContent.trim()===tr('remote:diagnostics.open_linux_desktop_manager')&&(${state}).text`),true,`${prefix} fallback follows live locale`);
    await execute(`await setTermaLanguage('${language}')`);
    await click(manage);
    assert.equal(await evaluate('window.termaRemoteManagement.desktop.state.connectionId'),9797,`${prefix} desktop manager opens the linked SSH source`);
    await execute("window.__graphicsMissingDesktop=false;connections=connections.filter(item=>item.id!==9797)");
    assertions.push({name:`${prefix} VNC Linux desktop fallback`,owned:true,liveLanguage:true,source:9797});
  }
  for (const width of [1200,390]) for (const theme of ['light','dark']) for (const language of ['zh-CN','en-US']) {
    const prefix=`${language}-${theme}-${width}`;
    browser.setContentSize(width,844);
    await execute(`connections=connections.filter(connection=>connection.id!==9797);closeModal();applyTheme('${theme}');await setTermaLanguage('${language}');window.termaWorkspaceShell.showPrimary('remote');await window.termaRemoteDesktop.open(9794,true)`);
    await wait("document.querySelector('#view-remote-desktop .remote-desktop-launch[data-remote-protocol=rdp]')&&document.querySelector('#remoteDesktopLaunchButton')?.disabled===false");
    const rdp=await evaluate(`(()=>{const root=document.querySelector('#view-remote-desktop');const visible=[...root.querySelectorAll('[title],[aria-label]')].filter(node=>node.checkVisibility()).flatMap(node=>[node.title,node.getAttribute('aria-label')]).join(' ');const actions=root.querySelector('.remote-desktop-actions');return {owner:root.classList.contains('terma-remote-root'),protocol:root.querySelector('.remote-desktop-launch')?.dataset.remoteProtocol,pageOverflow:document.documentElement.scrollWidth>innerWidth+1,rootOverflow:root.scrollWidth>root.clientWidth+1,englishClean:document.documentElement.lang!=='en-US'||!/[\\u3400-\\u9fff]/.test(root.textContent+' '+visible),buttons:[...actions.querySelectorAll(':scope > button')].every(button=>button.matches('[data-terma-button]'))}})()`);
    assert.equal(rdp.owner,true,`${prefix} RDP launch view is Vue-owned`);
    assert.equal(rdp.protocol,'rdp',`${prefix} RDP launch protocol`);
    assert.equal(rdp.pageOverflow,false,`${prefix} RDP has no viewport overflow`);
    assert.equal(rdp.rootOverflow,false,`${prefix} RDP content fits its pane`);
    assert.equal(rdp.englishClean,true,`${prefix} RDP visible labels are translated`);
    assert.equal(rdp.buttons,true,`${prefix} RDP launch actions use Tile UI buttons`);
    assert.equal(await evaluate("document.querySelector('.remote-desktop-jump-actions .remote-desktop-switch-button').disabled"),true,prefix+' unlinked switch remains disabled');
    await shot(`graphics-${prefix}-rdp-launch`);
    await checkJumpActions(prefix,language);
    await checkDesktopAuthorization(prefix,language);
    await execute("document.querySelector('#remoteDesktopSetupGuideButton').click()");
    await wait("!document.querySelector('#modal').hidden&&document.querySelector('#rdpSetupGuideTitle')");
    await shot(`graphics-${prefix}-rdp-setup-dialog`);
    await checkSetupGuide('rdp',prefix,language);
    await click('#modal .modal-title-row .icon-button');
    await wait("document.querySelector('#modal').hidden");

    await execute('await window.termaRemoteDesktop.open(9795,true)');
    await wait("document.querySelector('#view-remote-desktop .remote-desktop-launch[data-remote-protocol=xdmcp]')&&document.querySelector('#remoteDesktopLaunchButton')?.disabled===false");
    await shot(`graphics-${prefix}-xdmcp-launch`);
    await execute("document.querySelector('#remoteDesktopSetupGuideButton').click()");
    await wait("!document.querySelector('#modal').hidden&&document.querySelector('#xdmcpSetupGuideTitle')");
    if (width===390) {
      const actionGeometry=await evaluate("(()=>{const status=[...document.querySelectorAll('#modal .x11-install-guide .remote-diagnostic-status')].find(item=>item.querySelector('.remote-diagnostic-actions'));const button=status?.querySelector('.remote-diagnostic-actions button');return {statusWidth:status?.clientWidth||0,buttonWidth:button?.getBoundingClientRect().width||0,buttonHeight:button?.getBoundingClientRect().height||0}})()");
      assert.ok(actionGeometry.buttonWidth>actionGeometry.statusWidth*0.7&&actionGeometry.buttonHeight<80,`${prefix} XDMCP management action remains horizontal and readable on mobile`);
    }
    await shot(`graphics-${prefix}-xdmcp-setup-dialog`);
    await checkSetupGuide('xdmcp',prefix,language);
    await click('#modal .modal-title-row .icon-button');
    await wait("document.querySelector('#modal').hidden");

    await checkMissingDesktop(prefix,language);
    await execute('await window.termaRemoteDesktop.open(9796,true,true)');
    await wait("document.querySelector('#view-remote-desktop .remote-desktop-launch[data-remote-protocol=vnc]')&&document.querySelector('#remoteDesktopLaunchButton')?.disabled===false");
    await shot(`graphics-${prefix}-vnc-management`);
    await execute("document.querySelector('#remoteDesktopSetupGuideButton').click()");
    await wait("!document.querySelector('#modal').hidden&&document.querySelector('#vncSetupGuideTitle')");
    await shot(`graphics-${prefix}-vnc-setup-dialog`);
    await checkSetupGuide('vnc',prefix,language);
    await click('#modal [data-remote-setup-manage]');
    await wait("document.querySelector('#connectionForm')?.dataset.remoteProfileLinkId==='9796'");
    assert.equal(await evaluate("document.querySelector('#modal').hidden&&!document.querySelector('#modal').classList.contains('terma-remote-root')"),true,`${prefix} setup guide releases its Vue ownership before opening SSH for the exact profile`);
    assert.deepEqual(await evaluate(`(()=>{const form=document.querySelector('#connectionForm');const read=id=>form.querySelector('#'+id)?.value;return [read('conn_host'),read('conn_port'),read('conn_user'),read('conn_group'),read('conn_password')]})()`),['vnc.example.test','22','review','Graphical fixtures',''],`${prefix} SSH draft uses the management port and does not copy credentials`);
    await wait("document.activeElement?.id==='conn_user'");
    await shot(`graphics-${prefix}-management-ssh-draft`);
    const otherLocale=language==='zh-CN'?'en-US':'zh-CN';
    await execute(`const input=document.querySelector('#conn_user');input.value='manual-user';input.setSelectionRange(0,6);await setTermaLanguage('${otherLocale}');await window.termaConnectionLocalizationReady`);
    assert.equal(await evaluate(`(()=>{const form=document.querySelector('#connectionForm'),input=form.querySelector('#conn_user'),notice=form.querySelector('.remote-management-link-notice');return notice?.textContent===tr('remote:management.link_after_save',{name:'Fixture VNC'})&&input.value==='manual-user'&&document.activeElement===input&&input.selectionEnd===6})()`),true,`${prefix} locale change translates the notice and preserves draft, focus and selection`);
    await shot(`graphics-${prefix}-management-ssh-draft-live-locale`);
    assertions.push({name:`${prefix} scoped management SSH draft and live locale`,passed:true});
    await execute(`await setTermaLanguage('${language}');closeTabsByKey([activeTabKey],activeTabKey);await window.termaRemoteDesktop.open(9796,true,true)`);
    await wait("document.querySelector('#modal').hidden");
    assert.equal(await evaluate("(()=>{const e=document.querySelector('#remoteDesktopLaunchButton');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()"),true,`${prefix} launch button is visible and can receive pointer clicks`);
    await click('#remoteDesktopLaunchButton');
    await wait("window.termaVncRuntime.session.sessions.get('remote-desktop-9796')?.rfb&&document.querySelector('#view-remote-desktop .vnc-workspace')");
    const dial=await evaluate("(()=>{const client=window.termaVncRuntime.findSession('remote-desktop-9796').rfb,url=new URL(client.url);return url.host===location.host&&url.protocol==='ws:'&&url.pathname==='/ws/vnc'&&url.searchParams.get('id')==='9796'&&client.options.shared===false&&client.options.credentials?.username==='review'&&!client.options.credentials.password})()");
    assert.equal(dial,true,`${prefix} typed noVNC dial uses the application origin, saved profile and shared setting`);
    assertions.push({name:`${prefix} typed noVNC dial`,passed:true});
    await execute("window.termaVncRuntime.session.sessions.get('remote-desktop-9796').rfb.emit('connect')");
    await wait("window.termaVncRuntime.session.sessions.get('remote-desktop-9796')?.connected===true");
    const toolbarGeometry=await evaluate("(()=>{const bar=document.querySelector('#view-remote-desktop .vnc-toolbar-actions');const buttons=[...bar.querySelectorAll('button:not(.dialog-window-resize)')];const helper=bar.querySelector('[data-vnc-clipboard-helper]');const copy=helper.querySelector('span').getBoundingClientRect();const bounds=helper.getBoundingClientRect();return {overlap:buttons.some((button,index)=>index>0&&buttons[index-1].getBoundingClientRect().right>button.getBoundingClientRect().left+1),copyFits:copy.left>=bounds.left&&copy.right<=bounds.right,helperFits:helper.scrollWidth<=helper.clientWidth+1}})()");
    assert.deepEqual(toolbarGeometry,{overlap:false,copyFits:true,helperFits:true},`${prefix} VNC toolbar keeps helper text and neighboring buttons separate`);
    await shot(`graphics-${prefix}-vnc-viewer`);
    const nextLanguage=language==='en-US'?'zh-CN':'en-US';
    await execute(`await setTermaLanguage('${nextLanguage}')`);
    await wait(`document.documentElement.lang==='${nextLanguage}'&&document.querySelector('#view-remote-desktop .vnc-workspace')`);
    assert.equal(await evaluate("(()=>{const session=window.termaVncRuntime.session.sessions.get('remote-desktop-9796');return session.rfb===window.__graphicsRfbs[0]&&session.screen===session.viewport?.querySelector('.vnc-screen')&&session.screen.querySelector('.graphics-fixture-desktop')?.isConnected})()"),true,`${prefix} language repaint preserves the same RFB session and reattaches the screen`);
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),true,`${prefix} VNC toolbar fits the viewport`);
    await shot(`graphics-${prefix}-vnc-live-language`);
    await execute(`await setTermaLanguage('${language}')`);
    await wait(`document.documentElement.lang==='${language}'`);
    assert.equal(await evaluate("window.termaVncRuntime.session.sessions.get('remote-desktop-9796')?.rfb===window.__graphicsRfbs[0]"),true,`${prefix} restoring the locale does not reconnect`);
    const clipboardDialogs=await checkClipboardDialogs(prefix,language);

    await execute("window.__graphicsRfbs[0].emit('credentialsrequired',{types:['username','target','password']})");
    await wait("!document.querySelector('#modal').hidden&&document.querySelector('#vncCredentialPassword')");
    await shot(`graphics-${prefix}-vnc-auth-dialog`);
    await execute("for(const [id,value] of [['vncCredentialUsername','fixture-user'],['vncCredentialTarget','desktop-2'],['vncCredentialPassword','fixture-secret']]){const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}const input=document.getElementById('vncCredentialPassword');input.focus();input.setSelectionRange(2,7);window.__graphicsCredentialInput=input");
    await execute(`await setTermaLanguage('${nextLanguage}')`);
    assert.equal(await evaluate("document.activeElement===window.__graphicsCredentialInput&&window.__graphicsCredentialInput.value==='fixture-secret'&&window.__graphicsCredentialInput.selectionStart===2&&document.getElementById('vncCredentialUsername').value==='fixture-user'&&document.getElementById('vncCredentialTarget').value==='desktop-2'"),true,`${prefix} VNC challenge locale keeps typed credentials, focus and caret`);
    await shot(`graphics-${prefix}-vnc-auth-live-language`);
    await execute(`await setTermaLanguage('${language}')`);
    await click('#modal [type=submit]');
    await wait("document.querySelector('#modal').hidden&&window.__graphicsRfbs[0].sentCredentials?.password==='fixture-secret'");
    assert.equal(await evaluate("window.__graphicsRfbs[0].sentCredentials.username==='fixture-user'&&window.__graphicsRfbs[0].sentCredentials.target==='desktop-2'"),true,`${prefix} VNC challenge submits the exact credentials to its RFB session`);

    if (width===1200 && theme==='light' && language==='zh-CN') {
      await execute("window.__noPasswordPromise=window.termaVncRuntime.promptCredentials(window.termaRemoteProfiles.byId(9796),['password'],{allowNoPassword:true});void window.__noPasswordPromise.then(value=>{window.__noPasswordResult=value})");
      await wait("!document.querySelector('#modal').hidden&&document.querySelector('#vncCredentialNoPassword')");
      await shot('graphics-vnc-no-password-dialog');
      await click('#vncCredentialNoPassword');
      await wait("document.querySelector('#vncCredentialNoPassword')?.checked===true");
      const noPasswordState=await evaluate("({checked:document.querySelector('#vncCredentialNoPassword')?.checked,passwordDisabled:document.querySelector('#vncCredentialPassword')?.disabled,saveDisabled:document.querySelector('#vncCredentialSave')?.disabled,saveChecked:document.querySelector('#vncCredentialSave')?.checked})");
      assert.deepEqual(noPasswordState,{checked:true,passwordDisabled:true,saveDisabled:true,saveChecked:false},'no-password mode disables password entry and storage');
      await shot('graphics-vnc-no-password-enabled');
      await click('#modal [type=submit]');
      await wait("document.querySelector('#modal').hidden&&window.__noPasswordResult?.allow_no_password===true");
    }

    await execute("termaVncRuntime.session.management(9796,'remote-desktop-9796',false)");
    await wait("document.querySelector('#view-remote-desktop .remote-desktop-launch[data-remote-protocol=vnc]')&&window.termaVncRuntime.session.sessions.get('remote-desktop-9796')?.presentation==='management'&&document.querySelector('#remoteDesktopLaunchButton')?.disabled===false");
    await shot(`graphics-${prefix}-vnc-management-retained`);
    await execute("window.__graphicsBlockedVnc=true;await termaVncRuntime.management.inspect(9796)");
    const retainedLabel="document.querySelector('#remoteDesktopStatus')?.textContent===tr('remote:vnc_status.embedded_running')&&document.querySelector('#remoteDesktopLaunchButton')?.textContent.trim()===tr('remote:vnc_status.reenter')&&document.querySelector('#remoteDesktopLaunchButton')?.disabled===false&&document.querySelector('#remoteDesktopCloseButton')?.hidden===false";
    assert.equal(await evaluate(retainedLabel),true,`${prefix} failed service probe keeps re-enter and close available for a connected VNC session`);
    await execute(`await setTermaLanguage('${language==='zh-CN'?'en-US':'zh-CN'}')`);
    await wait(retainedLabel);
    assert.equal(await evaluate(retainedLabel),true,`${prefix} retained status and actions use the switched locale`);
    await shot(`graphics-${prefix}-vnc-management-retained-language`);
    await execute(`window.__graphicsBlockedVnc=false;await setTermaLanguage('${language}')`);
    await click('#remoteDesktopLaunchButton');
    await wait("document.querySelector('#view-remote-desktop .vnc-workspace')&&window.termaVncRuntime.session.sessions.get('remote-desktop-9796')?.presentation==='viewer'");
    assert.equal(await evaluate("window.termaVncRuntime.session.sessions.get('remote-desktop-9796')?.rfb===window.__graphicsRfbs[0]&&window.termaVncRuntime.session.sessions.get('remote-desktop-9796')?.screen.querySelector('.graphics-fixture-desktop')?.isConnected"),true,`${prefix} management/viewer round trip retains the connected screen`);
    await shot(`graphics-${prefix}-vnc-reentered`);
    await vncLifecycleStates(browser,{prefix,language,execute,evaluate,wait,shot,click,assertions});
    await execute("window.__graphicsClosingRfb=window.termaVncRuntime.session.sessions.get('remote-desktop-9796').rfb;await termaVncRuntime.session.management(9796,'remote-desktop-9796',false)");
    await wait("document.querySelector('#remoteDesktopCloseButton')?.hidden===false");
    await execute("document.querySelector('#remoteDesktopCloseButton').scrollIntoView({block:'nearest'})");
    await click('#remoteDesktopCloseButton');
    await wait("!window.termaVncRuntime.session.sessions.has('remote-desktop-9796')&&document.querySelector('#remoteDesktopCloseButton')?.hidden===true");
    assert.equal(await evaluate("window.__graphicsClosingRfb.disconnected===true&&!document.querySelector('#view-remote-desktop').hasAttribute('data-retained-vnc')"),true,`${prefix} closing from the management page disconnects and leaves a fresh probe`);
    await shot(`graphics-${prefix}-vnc-management-closed`);
    await execute("await window.termaVncRuntime.session.open(9796,'remote-desktop-9796')");
    await wait("window.termaVncRuntime.session.sessions.get('remote-desktop-9796')?.rfb");
    await execute("window.termaVncRuntime.session.sessions.get('remote-desktop-9796').rfb.emit('connect')");
    matrix.push({name:prefix,...rdp,...clipboardDialogs});
  }

  await execute("window.__clipboardDelayGuide=true;document.querySelector('#view-remote-desktop [data-vnc-clipboard-helper]').click()");
  await wait("window.__clipboardResolveGuide&&!document.querySelector('#modal').hidden&&document.querySelector('#vncClipboardHelperState .remote-install-modes')===null");
  await shot('graphics-vnc-clipboard-helper-waiting');
  await execute("window.termaQuickViews.openQuickConnectionLauncher()");
  await wait("!document.querySelector('#modal').hidden&&document.querySelector('#modal').classList.contains('terma-quick-root')");
  await execute("window.__clipboardResolveGuide();await new Promise(resolve=>setTimeout(resolve,40))");
  assert.equal(await evaluate("document.querySelector('#modal').classList.contains('terma-quick-root')&&!document.querySelector('#modal').classList.contains('terma-remote-root')&&!document.querySelector('#modal .vnc-clipboard-helper-modal')&&window.__clipboardOtherActions.length===0"),true,'quick connect takes ownership while SSH clipboard inspection is pending and ignores its stale response');
  await shot('graphics-vnc-clipboard-helper-quick-connect-handoff');
  await execute('closeModal()');

  await execute("window.__clipboardResolveGuide=null;window.__clipboardDelayGuide=true;connections.push({id:9797,name:'Clipboard SSH same-host',ssh_host:'vnc.example.test',ssh_user:'review',ssh_port:22});document.querySelector('#view-remote-desktop [data-vnc-clipboard-helper]').click()");
  await wait("document.querySelector('#vncClipboardHelperState [role=status]')&&typeof window.__clipboardResolveGuide==='function'");
  assert.equal(await evaluate("window.__clipboardHelperCalls.at(-1).connection_id"),9797,'held clipboard diagnostics belong to the previously selected connection');
  await execute("window.__oldClipboardGuide=window.__clipboardResolveGuide;window.__clipboardDelayGuide=false;const select=document.querySelector('#vncClipboardSshConnection');select.value='9798';select.dispatchEvent(new Event('change',{bubbles:true}))");
  await wait("document.querySelector('#vncClipboardHelperState .remote-service-head small')?.textContent==='Clipboard SSH alternate'");
  await execute("window.__oldClipboardGuide();await new Promise(resolve=>setTimeout(resolve,40))");
  assert.equal(await evaluate("document.querySelector('#vncClipboardHelperState .remote-service-head small')?.textContent==='Clipboard SSH alternate'&&document.querySelector('#vncClipboardSshConnection').value==='9798'"),true,'late clipboard inspection cannot replace the selected connection or its action diagnostics');
  await shot('graphics-vnc-clipboard-helper-current-selection');
  await execute("closeModal();connections=connections.filter(item=>item.id!==9797)");

  await execute("window.termaRemoteManagement.setupGuide(9796,'vnc')");
  await wait("document.activeElement===document.querySelector('#modal .terma-remote-setup-guide .actions button')");
  await execute("document.querySelector('#modal button').focus()");
  for (const type of ['keyDown','keyUp']) browser.webContents.sendInputEvent({type,keyCode:'Tab',modifiers:['shift']});
  await wait("document.activeElement===Array.from(document.querySelectorAll('#modal .modal-card button:not(:disabled)')).at(-1)");
  assert.equal(await evaluate("document.activeElement===Array.from(document.querySelectorAll('#modal .modal-card button:not(:disabled)')).at(-1)"),true,'setup guide traps reverse keyboard navigation including the resize handle');
  await shot('graphics-setup-guide-keyboard-focus');
  for (const type of ['keyDown','keyUp']) browser.webContents.sendInputEvent({type,keyCode:'Escape'});
  await wait("document.querySelector('#modal').hidden");
  assert.equal(await evaluate("document.querySelector('#modal').hidden&&!document.querySelector('#modal').classList.contains('terma-remote-root')"),true,'Escape closes setup guide and clears its Vue ownership');
  await execute("window.__graphicsOriginalName=window.termaRemoteProfiles.byId(9796).name;window.termaRemoteProfiles.byId(9796).name='<img src=x onerror=alert(1)>';window.termaRemoteManagement.setupGuide(9796,'vnc')");
  assert.equal(await evaluate("!document.querySelector('#modal img')&&document.querySelector('#modal').textContent.includes('<img src=x onerror=alert(1)>')"),true,'setup guide renders profile metadata as literal text');
  await execute("window.termaRemoteProfiles.byId(9796).name=window.__graphicsOriginalName;window.termaQuickViews.openQuickConnectionLauncher();await setTermaLanguage('en-US')");
  assert.equal(await evaluate("document.querySelector('#modal').classList.contains('terma-quick-root')&&!document.querySelector('#modal').classList.contains('terma-remote-root')&&!document.querySelector('#modal .terma-remote-setup-guide')&&!document.querySelector('#modal').hidden"),true,'quick connect takes ownership of a setup guide and language changes cannot restore its stale content');
  await shot('graphics-setup-guide-quick-connect-handoff');

  await execute("window.termaRemoteTransport.releaseWorkspace('remote-desktop-9796');api=window.__graphicsOriginalApi;window.termaVncRuntime.loadRfb=window.__graphicsOriginalRfb;remoteProfiles=window.__graphicsOriginalProfiles;connections=window.__graphicsOriginalConnections;window.termaVncRuntime.helper.operate=window.__graphicsOriginalClipboardActions.operate;window.termaClipboard.copy=window.__graphicsOriginalClipboardActions.copy;window.termaConnectionCredentials.prompt=window.__graphicsOriginalClipboardActions.prompt;window.__graphicsFixtureStyle.remove();closeModal();");
  const detached = new URL(browser.webContents.getURL());
  detached.searchParams.set('termaVncWindow', '2147483647');
  await browser.loadURL(detached.href);
  await wait("window.termaBootstrapRuntime?.getSnapshot().phase==='ready'");
  const startup = await evaluate(`({
    detached: window.termaVncDetached && window.termaBootstrapBackground.getSnapshot().detached,
    pending: window.workspaceRestorePending,
    appHidden: !document.querySelector('.app').checkVisibility(),
    missingProfile: Boolean([...document.querySelectorAll('.toast')].find(node =>
      node.textContent.includes(tr('remote:vnc_ui.detached_profile_missing'))))
  })`);
  assert.deepEqual(startup, {detached:true,pending:false,appHidden:true,missingProfile:true},
    'a direct detached URL restores through the real startup sequence and reports a missing profile');
  await shot('graphics-detached-startup-missing-profile');
  await execute('await new Promise(resolve=>setTimeout(resolve,1200))');
  assert.equal(await evaluate(`performance.getEntriesByType('resource').some(entry =>
    ['/api/ui-state/revision','/api/sftp/jobs'].includes(new URL(entry.name).pathname))`), false,
    'a direct detached URL does not start unrelated polling');
  assertions.push({name:'direct detached startup and background isolation',passed:true});
  assertions.push(...matrix);
  return {screenshots:process.env.TERMA_REMOTE_VISUAL_DIR || 'data/remote-visual',checks:matrix.length,states:screenshotCount,realTransport:false};
}

module.exports = {runRemoteGraphicsUiScenario};
