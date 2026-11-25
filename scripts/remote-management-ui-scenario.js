const assert=require('node:assert/strict');
const {protocolStates}=require('./m7-protocol-ui-states');
const {vncManagementStates}=require('./m7-vnc-management-ui-states');

async function runRemoteManagementUiScenario(browser,{execute,evaluate,wait,shot,click,assertions}) {
  const plan={online:{available:true,command:'sudo apt install xfce4 xrdp'},local_offline:{available:true,package_names:['xfce4','xrdp']},offline:{available:false,command:''}};
  const copyFixture = "printf '%s' 'ready at 100%'";
  await execute(`
    await window.termaI18nReady;window.termaWorkspaceRefresh.stop();
    window.__managementOriginal={api,connections,remoteProfiles,credentialPrompt:window.termaConnectionCredentials.prompt,refresh:window.termaWorkspaceRefresh.load,linuxState:structuredClone(window.termaRemoteManagement.desktop.state),models:{},guides:{},tasks:{}};window.__managementRequests=[];window.__managementMode='missing';window.__managementDelay=0;
    window.__managementTypedCalls={rdp:0,xdmcp:0,vnc:0};
    window.__managementOriginal.models.state=window.termaRemoteManagement.models.state;
    window.termaRemoteManagement.models.state=(protocol,...args)=>{window.__managementTypedCalls[protocol]++;return window.__managementOriginal.models.state(protocol,...args);};
    window.__managementGuideCalls={rdp:0,xdmcp:0,vnc:0,desktop:0};
    const guides=window.termaRemoteManagement.guides;
    window.__managementOriginal.guides={open:guides.open,desktop:guides.desktop};
    guides.open=(profile,kind,...args)=>{window.__managementGuideCalls[kind]++;return window.__managementOriginal.guides.open(profile,kind,...args);};
    guides.desktop=(...args)=>{window.__managementGuideCalls.desktop++;return window.__managementOriginal.guides.desktop(...args);};
    window.__managementTaskCalls={requested:0,watch:0,desktopModel:0};
    for(const kind of ['requested','watch','desktopModel']){window.__managementOriginal.tasks[kind]=window.termaRemoteManagement.tasks[kind];window.termaRemoteManagement.tasks[kind]=(...args)=>{window.__managementTaskCalls[kind]++;return window.__managementOriginal.tasks[kind](...args);};}
    window.__managementPlan=${JSON.stringify(plan)};
    connections=[{id:9760,name:'Review host',group_name:'Review',ssh_user:'review',ssh_host:'desktop.example.test',ssh_port:22,auth_type:'password',has_password:true}];
    remoteProfiles=['rdp','xdmcp','vnc'].map((protocol,index)=>({id:9761+index,protocol,name:'Review '+protocol.toUpperCase(),group_name:'Review',host:'desktop.example.test',port:protocol==='rdp'?3389:protocol==='vnc'?5900:177,username:'review',options:{source_ssh_connection_id:9760,client_mode:'embedded'}}));
    window.__managementDiagnostic=protocol=>{
      const ready=window.__managementMode==='ready';
      const base={connection:connections[0],ssh_connection:connections[0],connection_id:9760,management_available:true,diagnostics_available:true,platform:'linux',platform_supported:true,os_id:'debian',package_manager:'apt',has_desktop:true,install_plan:window.__managementPlan,privileged:window.__managementPrivileged===true};
      if (ready) base.graphics_rendering={
        visible:true,protocol,java_gui_risk:true,summary:'Rendering fixture',detail:'Rendering fixture detail',
        state:protocol==='xdmcp'?'remote-x11':'software',backend:protocol==='vnc'?'TigerVNC/Xvnc':protocol==='rdp'?'xorgxrdp':'remote X11',
        display:':10',compatibility_commands:[{id:'java2d-safe',command:${JSON.stringify(copyFixture)}}]
      };
      if(window.__managementMode==='error')return {...base,error:'SSH authentication failed',code:'SSH_AUTHENTICATION_FAILED'};
      if(protocol==='rdp')return {...base,xrdp_installed:ready,xrdp_active:ready,xrdp_listening:ready,rdp_install_plan:window.__managementPlan};
      if(protocol==='xdmcp')return {...base,manager_label:'LightDM',supported:true,enabled:ready,listening:ready,ready_for_login:ready,has_x11_session:ready,action:ready?'disable':'install-xfce',required_action:ready?'disable':'install-xfce',sessions:ready?[{id:'xfce',name:'XFCE'}]:[],package_plans:{xfce:window.__managementPlan},config_file:'/etc/lightdm/lightdm.conf',firewall:'none',can_uninstall_lightdm:ready};
      return {...base,status:ready?'ready':'not-installed',installed:ready,listening:ready,service_unit:ready?'terma-vnc.service':'',service_state:ready?'active':'inactive',listener_process:ready?'/usr/bin/x11vnc':'',start_plan:ready?{kind:'service',persistent:true,supports_no_password:true}:null,server_mode:'shared-x11',source_display:':0',server_session_configurable:true,server_session_selection_matches_running:ready,server_session_selection:{mode:'shared',display:':0',install_required:!ready,component:'x11vnc'},selected_component:{key:'x11vnc',installed:ready,install_required:!ready,listening:ready},session_sources:[{display:':0',kind:'physical',desktop_id:'xfce'}],guide:{title:{key:'linux_title'},summary:{key:'linux_component_missing',params:{component_key:'x11vnc'}},steps:[{key:'linux_install_x11vnc'}],commands:['sudo systemctl status terma-vnc']}};
    };
    window.__managementLinux=()=>({connection:connections[0],platform_supported:true,os_id:'debian',package_manager:'apt',display_manager:'lightdm',has_desktop:true,desktops:[{id:'xfce',name:'XFCE'}],desktop_catalog:['xfce','gnome','plasma','mate','cinnamon','lxqt'].map(id=>({id})),installable_desktops:['xfce','gnome','plasma','mate','cinnamon','lxqt'],desktop_install_plans:Object.fromEntries(['xfce','gnome','plasma','mate','cinnamon','lxqt'].map(id=>[id,window.__managementPlan])),desktop_usage:{xfce:{system_default:true,rdp_configured:true,local_active:true}},desktop_selection:{system_default:{session:{desktop_id:'xfce'}}},active_graphical_sessions:[{desktop_id:'xfce'}]});
    window.__managementTask=()=>({id:'protocol-review-'+window.__managementTaskProtocol,connection_id:9760,status:window.__managementTaskStatus||'running',component:window.__managementTaskProtocol,action:'install',stage:'install',progress:window.__managementTaskStatus==='done'?100:42});
    api=async(route,options={})=>{
      const p=String(route);window.__managementRequests.push({route:p,method:options.method||'GET',body:options.body});
      if(/^\\/api\\/remote-profiles\\/976[123]\\/(rdp|xdmcp|vnc)\\/server$/.test(p)){if(options.method==='POST'){window.__managementTaskProtocol=p.split('/')[4];if(window.__managementPostMode==='delayed-error'){await new Promise(resolve=>window.__managementRejectPost=resolve);throw Error('Review service request rejected');}if(window.__managementPostMode==='result')return {after:window.__managementDiagnostic(p.split('/')[4])};return {task:window.__managementTask()};}if(window.__managementDelay)await new Promise(resolve=>setTimeout(resolve,window.__managementDelay));return window.__managementDiagnostic(p.split('/')[4]);}
      if(p.startsWith('/api/remote-component/tasks/protocol-review-'))return window.__managementTask();
      if(p==='/api/remote-profiles/9763/vnc-credential'&&options.method==='PUT')return {has_password:!!JSON.parse(options.body).password};
      if(p==='/api/remote-clients/diagnostics')return {rdp:{available:true,client:'RDP'},vnc:{available:true,client:'VNC'},xdmcp:{available:true,client:'XDMCP'}};
      if(p.endsWith('/connectivity'))return {supported:true,ok:true,status:'reachable',method:'tcp'};
      if(p==='/api/connections/9760/linux-desktop')return window.__managementLinux();
      if(p==='/api/connections/9760/x11-forwarding')return {platform:'linux',ready:true,x11_forwarding:'yes',xauth_path:'/usr/bin/xauth',sshd_present:true,can_manage:false,can_terminal_manage:true,terminal_commands:{disable:'sudo true'},config_file:'/etc/ssh/sshd_config'};
      if(p==='/api/linux-desktop/tasks')return [];
      if(p==='/api/identity-files')return [{path:'/fixture/review-key',name:'review-key',permission_ok:true}];
      if(p==='/api/admin-grants'){if(window.__managementAdminDelay)await new Promise(resolve=>setTimeout(resolve,window.__managementAdminDelay));if(window.__managementAdminReject)throw Error('Fixture authorization rejected');return {admin_grant:{id:'fixture-grant',reuse_policy:'once'}};}
      if(options.method && options.method!=='GET')throw Error('Unexpected mutation in management fixture: '+p);
      return window.__managementOriginal.api(route,options);
    };
  `);
  let checks=0;
  const screenshots=[];
  const capture=async name=>{await execute('dismissToast()');const file=`management-${name}`;await shot(file);screenshots.push(`${file}.png`);};
  const inspect=async(selector,label,passwordDecoration=false)=>{
    // The shared password visibility decorator is still an explicit legacy UI adapter.
    const result=await evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(selector)});const copy=[...root.querySelectorAll('[title],[aria-label],input')].flatMap(e=>[e.title,e.getAttribute('aria-label'),e.placeholder]).join(' ');return {exists:!!root,english:document.documentElement.lang!=='en-US'||!/[\u3400-\u9fff]/.test(root.textContent+' '+copy),flat:[root,...root.querySelectorAll('.remote-service-state,.modal-card')].every(node=>getComputedStyle(node).boxShadow==='none'),overflow:root.scrollWidth>root.clientWidth+1,pageOverflow:document.documentElement.scrollWidth>innerWidth+1,inline:!!root.querySelector('[onclick],[onchange]'),buttons:[...root.querySelectorAll('button')].every(e=>e.hasAttribute('data-terma-button')||(e.matches('.dialog-window-resize')&&!!e.getAttribute('aria-label'))||${passwordDecoration}&&e.matches('.password-visibility-toggle')),object:root.textContent.includes('[object Object]')}})()`);
    if(result.overflow)console.error(label,await evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(selector)}),r=root.getBoundingClientRect();return [...root.querySelectorAll('*')].filter(e=>e.checkVisibility()&&e.getBoundingClientRect().right>r.right+1).map(e=>({tag:e.tagName,class:e.className,width:e.getBoundingClientRect().width,text:e.textContent.slice(0,60)}))})()`));
    assert.deepEqual(result,{exists:true,english:true,flat:true,overflow:false,pageOverflow:false,inline:false,buttons:true,object:false},label);checks++;assertions.push({name:label,...result});
    const layout=await evaluate(`(()=>{
      const root=document.querySelector(${JSON.stringify(selector)});
      return [...root.querySelectorAll('.remote-diagnostic-status,.remote-service-head')].filter(node=>node.checkVisibility()).every(node=>{
        const icon=node.querySelector(':scope > .remote-diagnostic-icon,:scope > .remote-service-icon');
        const copy=icon?.nextElementSibling;
        if(!icon||!copy)return false;
        const bounds=node.getBoundingClientRect(),symbol=icon.getBoundingClientRect(),text=copy.getBoundingClientRect();
        const actions=node.querySelector(':scope > .remote-diagnostic-actions')?.getBoundingClientRect();
        const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
        return Math.abs(symbol.top+symbol.height/2-bounds.top-bounds.height/2)<=1
          && symbol.right<=text.left+1
          && [symbol,text,actions].filter(Boolean).every(rect=>rect.left>=bounds.left-1&&rect.right<=bounds.right+1)
          && (!actions||!overlap(symbol,actions)&&!overlap(text,actions));
      });
    })()`);
    if(!layout) {
      console.error(label,await evaluate(`JSON.stringify([...document.querySelector(${JSON.stringify(selector)}).querySelectorAll('.remote-diagnostic-status,.remote-service-head')].map(node=>({class:node.className,bounds:node.getBoundingClientRect().toJSON(),children:[...node.children].map(child=>({class:child.className,bounds:child.getBoundingClientRect().toJSON()}))})))`));
      await capture('status-layout-failure');
    }
    assert.equal(layout,true,`${label} status icons, text and actions align without overlap`);
    checks++;assertions.push({name:`${label} status layout`,layout});
    const taskActions=await evaluate(`(()=>[...document.querySelector(${JSON.stringify(selector)}).querySelectorAll('.remote-component-progress .actions button')].filter(button=>button.checkVisibility()).map(button=>{
      const bounds=button.getBoundingClientRect(),symbol=button.querySelector('svg')?.getBoundingClientRect(),text=button.querySelector('span')?.getBoundingClientRect();
      return !!symbol&&!!text&&symbol.left-bounds.left<=12&&text.left-bounds.left<=40
        &&symbol.right<=text.left+1&&Math.abs(symbol.top+symbol.height/2-text.top-text.height/2)<=1
        &&[symbol,text].every(rect=>rect.left>=bounds.left&&rect.right<=bounds.right&&rect.top>=bounds.top&&rect.bottom<=bounds.bottom);
    }))()`);
    if(taskActions.length) {
      assert.equal(taskActions.every(Boolean),true,`${label} task action icon and text align left without clipping`);
      checks++;assertions.push({name:`${label} task action alignment`,count:taskActions.length,aligned:true});
    }
  };
  for(const width of [1200,390])for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']) {
    const prefix=`${language}-${theme}-${width}`,other=language==='en-US'?'zh-CN':'en-US';browser.setContentSize(width,844);
    await execute(`closeModal();applyTheme('${theme}');await setTermaLanguage('${language}');window.__managementMode='missing'`);
    for(const [id,protocol] of [[9761,'rdp'],[9762,'xdmcp'],[9763,'vnc']]) {
      const typedCallsBefore=await evaluate(`window.__managementTypedCalls.${protocol}`);
      await execute(`await window.termaRemoteDesktop.open(${id},true,true)`);
      await wait(`document.querySelector('#${protocol}ServerState [data-management-owned]')`);
      const name=`${prefix} ${protocol.toUpperCase()} entry renders through the typed model`;
      assert.equal(await evaluate(`window.__managementTypedCalls.${protocol}>${typedCallsBefore}`),true,name);
      assertions.push({name,typed:true});
      checks++;
      await inspect(`#${protocol}ServerState`,`${prefix} ${protocol} diagnostic`);await capture(`${prefix}-${protocol}-missing`);
      const guideCallsBefore=await evaluate(`window.__managementGuideCalls.${protocol}`);
      await execute(`await window.termaRemoteManagement.openGuide(${id},'${protocol}',${protocol==='xdmcp'?"'install-xfce'":"''"})`);
      try {
        await wait("document.querySelector('#modal .terma-managed-install .remote-install-modes')");
      } catch(error) {
        await capture(`${prefix}-${protocol}-install-failure`);
        const detail=await evaluate("({hidden:document.querySelector('#modal').hidden,copy:document.querySelector('#modal').textContent.trim(),requests:window.__managementRequests.slice(-5).map(({route})=>route)})");
        throw new Error(`${error.message}: ${prefix} ${protocol} ${JSON.stringify(detail)}`,{cause:error});
      }
      const guideName=`${prefix} ${protocol} install entry uses the typed guide service`;
      assert.equal(await evaluate(`window.__managementGuideCalls.${protocol}>${guideCallsBefore}`),true,guideName);
      checks++;assertions.push({name:guideName,typed:true});
      if(protocol==='vnc') {
        const guideText=await evaluate("document.querySelector('#modal .terma-managed-install')?.textContent||''");
        const expected=language==='zh-CN'
          ? ['Linux VNC 服务安装/配置说明','x11vnc 共享桌面']
          : ['Linux VNC service installation and configuration','x11vnc shared desktop'];
        const translation={title:guideText.includes(expected[0]),component:guideText.includes(expected[1])};
        assert.deepEqual(translation,{title:true,component:true},`${prefix} VNC guide translation fixture: ${guideText}`);
        checks++;assertions.push({name:prefix+' VNC guide translation fixture',...translation});
      }
      await inspect('#modal .terma-managed-install',`${prefix} ${protocol} install`);await capture(`${prefix}-${protocol}-install`);
      await click('#modal [data-install-mode=manual]');await wait("document.querySelector('#modal details')?.open===true");
      await new Promise(resolve=>setTimeout(resolve,350));
      await capture(`${prefix}-${protocol}-manual`);
      await execute(`window.__managementFocus=document.querySelector('#modal .remote-install-copy');window.__managementFocus.focus({preventScroll:true});window.__managementScroll=document.querySelector('#modal .modal-card').scrollTop;await setTermaLanguage('${other}')`);
      assert.deepEqual(await evaluate("(()=>{const card=document.querySelector('#modal .modal-card');return {open:document.querySelector('#modal details').open,focus:document.activeElement===window.__managementFocus,scroll:Math.abs(card.scrollTop-Math.min(window.__managementScroll,Math.max(0,card.scrollHeight-card.clientHeight)))<=1}})()"),{open:true,focus:true,scroll:true},`${prefix} ${protocol} locale preserves open manual, focus and scroll`);checks++;
      await inspect('#modal .terma-managed-install',`${prefix} ${protocol} live locale`);await capture(`${prefix}-${protocol}-live-locale`);
      await execute(`await setTermaLanguage('${language}');closeModal();window.__managementMode='ready';${protocol==='rdp'?"await window.termaRemoteManagement.protocol.inspect(9761,'rdp')":protocol==='xdmcp'?"await window.termaRemoteManagement.protocol.inspect(9762,'xdmcp')":'await termaVncRuntime.management.inspect(9763)'}`);
      await inspect(`#${protocol}ServerState`,`${prefix} ${protocol} ready`);await capture(`${prefix}-${protocol}-ready`);
      const renderingAction=`#${protocol}ServerState .remote-rendering-state.warning button[data-management-action="rendering-0"]`;
      assert.ok(await evaluate(`document.querySelector(${JSON.stringify(renderingAction)})?.textContent.trim()===tr('remote:rendering.java2d_safe')`),`${prefix} ${protocol} renders the localized compatibility command`);
      checks++;
      await execute(`document.querySelector(${JSON.stringify(renderingAction)})?.scrollIntoView({block:'center'})`);
      await capture(`${prefix}-${protocol}-rendering-advice`);
      if (protocol === 'rdp') {
        await execute("window.__managementClipboard=window.termaClipboard.write;window.__managementCopied=[];window.termaClipboard.write=async command=>{window.__managementCopied.push(command);}");
        try {
          await click(renderingAction);
          assert.deepEqual(await evaluate('window.__managementCopied'),[copyFixture],`${prefix} renders a working copy action that preserves the command`);
          checks++;
        } finally {
          await execute('window.termaClipboard.write=window.__managementClipboard;delete window.__managementClipboard;delete window.__managementCopied;');
        }
      }

      const variants=protocol==='xdmcp' ? [
        ['pending',{enabled:true,listening:false,ready_for_login:false,action:'restart'}],
        ['conflict',{session_conflict:true,plasma_display:':0',preferred_session:{name:'XFCE'},saved_session:'xfce',action:'cleanup-sessions',warning:'Fixture conflict',matching_local_graphical_sessions:[{display:':0'}]}],
        ['unsupported',{platform:'macos',platform_unsupported:true,supported:false,listening:false,ready_for_login:false,has_x11_session:false,sessions:[],action:'manual',warning:'Fixture unsupported'}]
      ] : protocol==='vnc' ? [
        ['source-pending',{server_session_selection_matches_running:false,server_session_selection:{mode:'virtual',component:'tigervnc'},selected_component:{key:'tigervnc',installed:true,listening:false},start_plan:{kind:'tigervnc-systemd'}}],
        ['source-missing',{server_session_selection:{mode:'shared',display:':9',source_available:false}}],
        ['source-readonly',{server_session_configurable:false}],
        ['stopped',{status:'stopped',listening:false,selected_component:{key:'x11vnc',installed:true,listening:false}}],
        ['macos',{platform:'macos',server_session_configurable:false,server_mode:'unknown'}]
      ] : [];
      for(const [state,patch] of variants) {
        await execute(`window.__managementVisualDiagnostic={...window.__managementDiagnostic('${protocol}'),...${JSON.stringify(patch)}};window.termaRemoteManagement.diagnostics.present(document.querySelector('#${protocol}ServerState'),'${protocol}',window.__managementVisualDiagnostic,window.termaRemoteProfiles.byId(${id}),'remote-desktop-${id}',{preflight:true,showConnect:false});document.querySelector('#${protocol}ServerState').scrollIntoView({block:'start'})`);
        await inspect(`#${protocol}ServerState`,`${prefix} ${protocol} ${state}`);await capture(`${prefix}-${protocol}-${state}`);
        if(state==='source-missing') {
          const preserved=await evaluate("(()=>{const select=document.querySelector('#vnc_server_session_source_9763');return select.value==='shared|:9'&&select.selectedOptions[0].textContent===tr('remote:vnc_status.selected_display_missing',{display:':9'});})()");
          assert.equal(preserved,true,`${prefix} missing VNC source remains labeled in the selector`);
          const warning=await evaluate("(()=>{const state=document.querySelector('#vncServerState');return state.querySelector('.remote-service-icon')?.classList.contains('warning')&&state.querySelector('.vnc-connection-help-copy strong')?.textContent===tr('remote:vnc_status.selected_display_missing',{display:':9'});})()");
          assert.equal(warning,true,`${prefix} missing VNC source cannot be presented as ready`);
          checks+=2;assertions.push({name:`${prefix} missing VNC source uses a warning and preserves selection`,preserved,warning});
        }
        if(state==='source-pending'||state==='conflict') {
          await execute(`await setTermaLanguage('${other}')`);
          await inspect(`#${protocol}ServerState`,`${prefix} ${protocol} ${state} language`);await capture(`${prefix}-${protocol}-${state}-language`);
          await execute(`await setTermaLanguage('${language}')`);
        }
      }
      if(variants.length)await execute(`${protocol==='xdmcp'?"await window.termaRemoteManagement.protocol.inspect(9762,'xdmcp')":'await termaVncRuntime.management.inspect(9763)'}`);
      if(protocol!=='vnc'){const protocolChecks=await protocolStates({id,protocol,prefix,language,execute,evaluate,wait,click,capture,inspect,assertions});checks+=protocolChecks;}
      else checks+=await vncManagementStates({prefix,language,execute,evaluate,wait,click,capture,inspect,assertions});
      await execute("window.__managementMode='missing'");
    }
    await execute(`window.termaRemoteManagement.desktop.open(9760)`);await wait("document.querySelector('#view-linux-desktop [data-desktop-id=xfce]')");
    await inspect('#view-linux-desktop',`${prefix} Linux desktop`);await capture(`${prefix}-linux-top`);
    await execute("window.termaRemoteManagement.desktop.state.task={id:'fixture-task',action:'install',desktop_label:'GNOME',status:'running',stage:'install',progress:42,logs:Array.from({length:70},(_,i)=>({at:1729300000000+i*1000,text:'Package '+i}))};window.termaRemoteManagement.paintDesktop();document.querySelector('#linuxDesktopInstallTask .linux-desktop-task-head button').click();document.querySelector('#linuxDesktopInstallTask').scrollIntoView({block:'center'});document.querySelector('#linuxDesktopTaskLog').scrollTop=45;window.__managementLog=document.querySelector('#linuxDesktopTaskLog');window.__managementLog.dispatchEvent(new Event('scroll'));window.termaRemoteManagement.paintDesktopTask(document.querySelector('#view-linux-desktop'),window.termaRemoteManagement.desktop.state.task)");
    assert.equal(await evaluate("window.__managementLog===document.querySelector('#linuxDesktopTaskLog')&&window.__managementLog.scrollTop===45"),true,`${prefix} desktop task updates retain the log node and manual scroll position`);checks++;
    const desktopTaskVisible=await evaluate("(()=>{const node=document.querySelector('#linuxDesktopInstallTask'),r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return node.checkVisibility()&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&node.contains(hit)})()");
    assert.equal(desktopTaskVisible,true,`${prefix} desktop task log is visible and unobstructed before its screenshot`);checks++;
    assertions.push({name:`${prefix} desktop task log visibility and scroll`,visible:desktopTaskVisible,scrollPreserved:true});
    await inspect('#linuxDesktopInstallTask',`${prefix} desktop task log`);await capture(`${prefix}-desktop-task-log`);
    await execute("window.termaRemoteManagement.desktop.state.task=null;window.termaRemoteManagement.paintDesktop()");
    await execute(`await setTermaLanguage('${other}')`);
    const localizedTab=await evaluate(`(()=>{
      const labels=[...document.querySelectorAll('.tab[data-tab-key^="linux-desktop-"] .tab-title,.mobile-workspace-tab-main[data-tab-key^="linux-desktop-"] .mobile-workspace-tab-title')];
      return labels.length>0&&labels.every(node=>node.textContent===tr('remote:linux_desktop.title'));
    })()`);
    assert.equal(localizedTab,true,`${prefix} Linux desktop tab follows the current language`);
    checks++;assertions.push({name:`${prefix} Linux desktop localized tab`,localizedTab});
    await capture(`${prefix}-linux-tab-language`);
    await execute(`await setTermaLanguage('${language}')`);
    const probeStart=await evaluate('window.__managementRequests.length');
    await execute(`const button=[...document.querySelectorAll('#view-linux-desktop .x11-forwarding-panel button')].find(node=>node.textContent.includes(tr('common:actions.detect_again')));
      if(!button)throw Error('Missing Linux desktop X11 detect-again button');
      button.dataset.managementFixture='recheck-x11';`);
    await click('[data-management-fixture="recheck-x11"]');
    await wait(`window.__managementRequests.slice(${probeStart}).some(request=>request.route.endsWith('/linux-desktop'))&&!window.termaRemoteManagement.desktop.state.loading`);
    const x11Recheck=await evaluate(`window.__managementRequests.slice(${probeStart}).filter(request=>request.route.endsWith('/x11-forwarding')).map(request=>request.method)`);
    assert.deepEqual(x11Recheck,['GET'],`${prefix} X11 detect again reloads the desktop workspace`);
    checks++;assertions.push({name:`${prefix} Linux desktop X11 recheck`,passed:true});
    await execute("document.querySelector('#view-linux-desktop .x11-forwarding-panel').scrollIntoView({block:'start'})");await capture(`${prefix}-linux-x11`);
    const desktopGuideCalls=await evaluate('window.__managementGuideCalls.desktop');
    await execute("window.termaRemoteManagement.desktop.install('gnome')");await inspect('#modal .terma-managed-install',`${prefix} desktop install`);await capture(`${prefix}-linux-install`);
    assert.equal(await evaluate('window.__managementGuideCalls.desktop')>desktopGuideCalls,true,`${prefix} desktop installation uses the typed guide service`);checks++;
    await execute('closeModal()');
    await execute(`closeModal();const modal=document.querySelector('#modal');modal.innerHTML='<div class="modal-card" data-legacy-dialog>Previous SFTP dialog</div>';window.__managementAdminPromise=window.termaRemoteManagement.authorize(9760,tr('remote:vnc_ui.start_service_action'),'vnc.server.start');void window.__managementAdminPromise.then(value=>window.__managementAdminResult=value)`);
    await wait("document.querySelector('#remoteAdminUser')");await inspect('#modal .remote-admin-modal',`${prefix} admin`);
    assert.equal(await evaluate("document.querySelectorAll('#modal .modal-card').length===1&&!document.querySelector('#modal [data-legacy-dialog]')"),true,`${prefix} administrator prompt replaces a dismissed legacy modal`);checks++;
    assert.equal(await evaluate("document.querySelectorAll('#modal .remote-admin-modal input[data-password-visibility-input]').length===3&&[...document.querySelectorAll('#modal .password-visibility-toggle')].every(button=>button.hasAttribute('data-terma-button')&&button.getAttribute('aria-label')===tr('common:auto.show_password'))"),true,`${prefix} administrator password controls use the shared Vue field`);checks++;
    await execute("const input=document.querySelector('#remoteAdminPassword');input.value='visibility-fixture';input.focus();input.setSelectionRange(2,8);input.dispatchEvent(new Event('input',{bubbles:true}))");
    assert.deepEqual(await evaluate("(()=>{const input=document.querySelector('#remoteAdminPassword');return {start:input.selectionStart,end:input.selectionEnd}})()"),{start:2,end:8},`${prefix} administrator input retains its selection`);checks++;
    await click('#modal #remoteAdminPasswordBox .password-visibility-toggle');
    assert.deepEqual(await evaluate("(()=>{const input=document.querySelector('#remoteAdminPassword'),button=input.closest('.password-input-control').querySelector('button');return {type:input.type,value:input.value,focus:document.activeElement===input,start:input.selectionStart,end:input.selectionEnd,label:button.getAttribute('aria-label')===tr('common:auto.hide_password'),pressed:button.getAttribute('aria-pressed')}})()"),{type:'text',value:'visibility-fixture',focus:true,start:2,end:8,label:true,pressed:'true'},`${prefix} administrator show password preserves focus and caret`);checks++;
    await click('#modal #remoteAdminPasswordBox .password-visibility-toggle');
    assert.equal(await evaluate("document.querySelector('#remoteAdminPassword').type==='password'&&document.querySelector('#remoteAdminPasswordBox button').getAttribute('aria-pressed')==='false'"),true,`${prefix} administrator password hides again`);checks++;
    await execute("const input=document.querySelector('#remoteAdminPassword');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}))");
    const noticeContrast=await evaluate("(()=>{const node=document.querySelector('#modal .remote-admin-modal > .connection-test-status.warning'),style=getComputedStyle(node),context=document.createElement('canvas').getContext('2d',{willReadFrequently:true});const luminance=color=>{context.fillStyle=color;context.fillRect(0,0,1,1);const rgb=[...context.getImageData(0,0,1,1).data].slice(0,3).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};const a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})()");
    assert.ok(noticeContrast>=4.5,`${prefix} administrator privacy notice contrast: ${noticeContrast}`);checks++;await capture(`${prefix}-admin-password`);
    await execute(`const input=document.querySelector('#remoteAdminUser');input.value='review-draft';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(2,6);window.__managementAdminInput=input;await setTermaLanguage('${other}')`);
    assert.equal(await evaluate("document.activeElement===window.__managementAdminInput&&window.__managementAdminInput.value==='review-draft'&&window.__managementAdminInput.selectionStart===2"),true,`${prefix} admin locale preserves draft and caret`);checks++;
    await inspect('#modal .remote-admin-modal',`${prefix} admin live locale`);await capture(`${prefix}-admin-live-locale`);
    await execute(`await setTermaLanguage('${language}');const method=document.querySelector('#remoteAdminMethod');method.value='key';method.dispatchEvent(new Event('change',{bubbles:true}));const sudo=document.querySelector('#remoteAdminSudoMode');sudo.value='separate';sudo.dispatchEvent(new Event('change',{bubbles:true}))`);
    await capture(`${prefix}-admin-key-sudo`);await click('#modal [data-admin-cancel]');await wait("document.querySelector('#modal').hidden");
    assert.equal(await evaluate('window.__managementAdminResult===null'),true,`${prefix} cancel returns no authorization`);checks++;
  }
  // A closed loading dialog must not be restored by its delayed request.
  await execute("window.__managementDelay=250;void window.termaRemoteManagement.openGuide(9761,'rdp','')");await wait("document.querySelector('#modal .xdmcp-server-loading')");await capture('install-loading');
  await execute("closeModal();window.termaQuickViews.openQuickConnectionLauncher()");await new Promise(resolve=>setTimeout(resolve,330));
  assert.equal(await evaluate("document.querySelector('#modal').classList.contains('terma-quick-root')&&!document.querySelector('#modal .terma-managed-install')"),true,'late install diagnostics cannot overwrite another modal');checks++;
  await execute(`closeModal();window.__managementDelay=0;window.__managementMode='error';
    window.__managementRefreshes=0;
    window.termaWorkspaceRefresh.load=async()=>{window.__managementRefreshes++;};
    window.termaConnectionCredentials.prompt=(connection,options)=>{
      let release;
      const pending=new Promise(resolve=>{release=resolve;});
      window.__managementRepair={id:connection.id,options,complete:async()=>{
        const before=window.__managementRefreshes;
        release({saved:true});
        for(let attempt=0;attempt<100&&window.__managementRefreshes===before;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
        if(window.__managementRefreshes===before)throw Error('Credential save did not refresh the actual runtime');
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      }};
      return pending;
    };
    await window.termaRemoteDesktop.open(9761,true,true)`);await inspect('#rdpServerState','authentication failure');await capture('authentication-failure');
  for(const [id,kind] of [[9761,'rdp'],[9762,'xdmcp'],[9763,'vnc']]) {
    await execute(`window.__managementMode='error';await window.termaRemoteDesktop.open(${id},true,true)`);
    const repairAction=`#${kind}ServerState [data-management-action="repair-management"]`;
    await wait(`document.querySelector(${JSON.stringify(repairAction)})?.checkVisibility()`);
    await click(repairAction);
    const name=`${kind.toUpperCase()} uses the selected SSH connection for repair and reprobe`;
    assert.equal(await evaluate(`window.__managementRepair?.id===9760&&window.__managementRepair.options.context.includes('${kind.toUpperCase()}')`),true,name);
    const route=`/api/remote-profiles/${id}/${kind}/server`;
    await execute("window.__managementRequests.length=0;window.__managementMode='ready';await window.__managementRepair.complete()");
    const requests=await evaluate(`window.__managementRequests.filter(item=>item.route===${JSON.stringify(route)}&&item.method==='GET').length`);
    assert.equal(requests,1,name);checks+=2;assertions.push({name,source:9760,requests});
    await capture(`${kind}-credential-repaired`);
  }
  await execute("window.__managementMode='error';await window.termaRemoteDesktop.open(9761,true,true)");
  await click('#rdpServerState [data-management-action="repair-management"]');
  await execute("await window.termaRemoteDesktop.open(9762,true,true);window.__managementRequests.length=0;await window.__managementRepair.complete()");
  const staleName='saving credentials after changing tabs does not reprobe a stale RDP target';
  assert.equal(await evaluate("window.__managementRequests.some(item=>item.route==='/api/remote-profiles/9761/rdp/server')"),false,staleName);checks++;assertions.push({name:staleName});
  await execute("window.__managementMode='ready';window.__managementPostMode='task';window.__managementTaskStatus='running';window.__managementPrivileged=true;await window.termaRemoteDesktop.open(9763,true,true);window.__managementVncOldTab=tabs.find(tab=>tab.key===activeTabKey);window.__managementReopenDone=false;void termaVncRuntime.management.operate(9763,activeTabKey,'start').finally(()=>window.__managementReopenDone=true)");
  await wait("document.querySelector('#modal .forward-question')");
  await click('#modal .forward-question button:first-child');
  await wait("document.querySelector('#vncServerState .remote-component-progress-head')");
  await execute("const oldKey=window.__managementVncOldTab.key;closeTabsByKey([oldKey],oldKey);await window.termaRemoteDesktop.open(9763,true,true);window.__managementRequests.length=0;window.__managementTaskStatus='done'");
  await wait('window.__managementReopenDone');
  const reopenedName='VNC task from a closed tab does not repaint or reprobe its replacement with the same key';
  const reopened=await evaluate("(()=>{const tab=tabs.find(item=>item.key===activeTabKey);return tab?.key===window.__managementVncOldTab.key&&tab!==window.__managementVncOldTab&&!!document.querySelector('#vncServerState [data-management-owned]')&&!document.querySelector('#vncServerState .remote-component-progress-head')&&!window.__managementRequests.some(item=>item.route==='/api/remote-profiles/9763/vnc/server')&&!isUiActionInFlight('vnc-server:9763')})()");
  assert.equal(reopened,true,reopenedName);checks++;assertions.push({name:reopenedName});
  await capture('vnc-task-after-tab-reopened');
  const taskOwners=await evaluate('window.__managementTaskCalls');
  assert.equal(Object.values(taskOwners).every(count=>count>0),true,'task views and polling use the typed task owner');
  assertions.push({name:'task views and polling use the typed task owner',...taskOwners});checks++;
  await execute("api=window.__managementOriginal.api;connections=window.__managementOriginal.connections;remoteProfiles=window.__managementOriginal.remoteProfiles;window.termaConnectionCredentials.prompt=window.__managementOriginal.credentialPrompt;window.termaWorkspaceRefresh.load=window.__managementOriginal.refresh;Object.assign(window.termaRemoteManagement.models,window.__managementOriginal.models);Object.assign(window.termaRemoteManagement.guides,window.__managementOriginal.guides);Object.assign(window.termaRemoteManagement.tasks,window.__managementOriginal.tasks);Object.assign(window.termaRemoteManagement.desktop.state,window.__managementOriginal.linuxState);closeModal()");
  return {checks,screenshots,realTransport:false};
}
module.exports={runRemoteManagementUiScenario};
