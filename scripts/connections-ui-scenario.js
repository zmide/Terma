const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function runConnectionsUiScenario(browser) {
  const directory=process.env.TERMA_CONNECTION_VISUAL_DIR || path.join(process.env.TERMA_UI_DIAGNOSTICS_DIR || path.join(process.cwd(),'data'),'connections-visual');
  fs.mkdirSync(directory,{recursive:true});
  if(!browser.webContents.debugger.isAttached()) browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  const execute=source=>browser.webContents.executeJavaScript(/\bawait\b/.test(source)&&!/^\s*\(async/.test(source)?`(async()=>{${source}})()`:source);
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const click=async selector=>{
    const point=await execute(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    for(const type of ['mouseMove','mouseDown','mouseUp']){browser.webContents.sendInputEvent({type,...point,button:'left',clickCount:1});await delay(20);}
    await delay(90);
  };
  const shot=async(name,withToast=false)=>{await delay(120);await execute(`window.__shotTransient=[...document.querySelectorAll(${JSON.stringify(withToast?'#notice':'#toast,#notice')})].map(e=>({e,style:e.getAttribute('style')}));window.__shotTransient.forEach(({e})=>e.style.setProperty('display','none','important'));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);try{browser.webContents.invalidate();fs.writeFileSync(path.join(directory,name+'.png'),(await browser.webContents.capturePage()).toPNG());}finally{await execute("window.__shotTransient.forEach(({e,style})=>style===null?e.removeAttribute('style'):e.setAttribute('style',style))");}};
  const capture=async(name,selector)=>{
    await execute(`(()=>{window.__connectionScroll=[document.querySelector(${JSON.stringify(selector)}),...document.querySelector(${JSON.stringify(selector)}).querySelectorAll('*')].filter(e=>e.checkVisibility()&&e.clientHeight>80&&e.scrollHeight>e.clientHeight+24&&['auto','scroll'].includes(getComputedStyle(e).overflowY)).map(e=>({e,top:e.scrollTop}));})()`);
    await shot(name);
    const count=await execute('window.__connectionScroll.length');
    for(let i=0;i<count;i++){
      const positions=await execute(`(()=>{const e=window.__connectionScroll[${i}].e,max=e.scrollHeight-e.clientHeight,p=[];for(let top=Math.floor(e.clientHeight*.8);top<max;top+=Math.max(80,Math.floor(e.clientHeight*.8)))p.push(top);p.push(max);return p;})()`);
      for(let j=0;j<positions.length;j++){await execute(`window.__connectionScroll[${i}].e.scrollTop=${positions[j]}`);await shot(name+'-scroll-'+i+'-'+j);}
      await execute(`window.__connectionScroll[${i}].e.scrollTop=window.__connectionScroll[${i}].top`);
    }
  };
  const reports=[];
  const menuChecks=[];
  const menuCheck=async(name,source)=>{
    assert.equal(await execute(source),true,name);
    menuChecks.push(name);
  };
  const checkMenu=async(name)=>{
    await menuCheck(name+' bounds labels and Tile controls',`(()=>{const menus=[...document.querySelectorAll('#actionMenu,#actionSubMenu')].filter(e=>e.checkVisibility());return menus.length>0&&menus.every(menu=>{const r=menu.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&[...menu.querySelectorAll('[data-terminal-display-action]')].every(button=>{const label=button.children[1],range=document.createRange();range.selectNodeContents(label);const text=range.getBoundingClientRect(),bounds=label.getBoundingClientRect();return button.hasAttribute('data-terma-button')&&text.left>=bounds.left-.5&&text.right<=bounds.right+.5;});});})()`);
    await menuCheck(name+' submenu leaves parent items visible',`(()=>{const parent=document.querySelector('#actionMenu'),child=document.querySelector('#actionSubMenu');if(!child)return true;const a=parent.getBoundingClientRect(),b=child.getBoundingClientRect();return a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top;})()`);
    await check(name,await execute(`innerWidth<=760||!document.querySelector('#actionSubMenu')?'#actionMenu':'#actionSubMenu'`));
  };
  const directActions={
    remote:['workspace-show-connections','workspace-remote-xserver'],
    ssh:['static-forwards-start-all','static-forwards-stop-all','workspace-connection-check-all']
  };
  const toolbar=async(prefix,kind)=>{
    const controls=directActions[kind];
    await menuCheck(prefix+' '+kind+' shows accessible, centered direct actions',`(()=>{
      const bar=$('explorerTools'),bounds=bar.getBoundingClientRect(),buttons=[...bar.querySelectorAll('.connection-quick-actions button')];
      const rows=new Set(buttons.map(b=>Math.round(b.getBoundingClientRect().top))).size;
      const maxRows=${kind==='ssh'?1:2};
      return rows>0 && rows<=maxRows && !bar.querySelector('[data-action="workspace-remote-menu"],[data-action="workspace-connection-menu"]')
        && !bar.querySelector('[data-action="workspace-remote-refresh"]')
        && ${JSON.stringify(controls)}.every(action=>buttons.some(b=>b.dataset.action===action||b.id===action))
        && buttons.every(b=>{const r=b.getBoundingClientRect(),g=b.querySelector('svg')?.getBoundingClientRect(),label=b.getAttribute('aria-label');
          return b.checkVisibility()&&r.width>=32&&r.height>=26&&r.left>=bounds.left&&r.right<=bounds.right&&g
            && Math.abs(g.x+g.width/2-r.x-r.width/2)<=1&&b.title&&label
            && (document.documentElement.lang!=='en-US'||!/[\u3400-\u9fff]/.test(b.title+label));});
    })()`);
    const viewport=await execute('({width:innerWidth,height:innerHeight})');
    browser.webContents.sendInputEvent({type:'mouseMove',x:viewport.width-8,y:Math.round(viewport.height*.55)});
    await delay(230);
    await shot(prefix+'-'+kind+'-toolbar');
  };
  const key=async (keyCode)=>{
    for (const type of ['keyDown','keyUp']) browser.webContents.sendInputEvent({type,keyCode});
    await delay(55);
  };
  const prepareNarrowPane=async()=>{
    await execute('window.termaWorkspaceShell.setCollapsed(false);void 0');
    await delay(180);
    const point=await execute(`(()=>{const r=$('operationPaneResize').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+Math.min(150,r.height/2)};})()`);
    const mouse=(type,x,buttons)=>browser.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,x,y:point.y,button:type==='mouseMoved'?'none':'left',buttons,clickCount:1});
    await mouse('mouseMoved',point.x,0);
    await mouse('mousePressed',point.x,1);
    await mouse('mouseMoved',point.x-16,1);
    await mouse('mouseMoved',point.x-100,1);
    await mouse('mouseReleased',point.x-100,0);
    await delay(80);
    await menuCheck('pointer narrows the desktop operation pane', 'window.termaWorkspaceChrome.value("operation")===260 && document.documentElement.classList.contains("operation-pane-narrow")');
  };
  const checkDirectActions=async()=>{
    await execute(`window.__toolbarCalls=[];window.__originalToolbar=[window.termaForwardGlobal.service.startAll,window.termaForwardGlobal.service.stopAll,window.termaConnectionHealthBatch.checkAll,window.termaX11.openManager];
      window.termaForwardGlobal.service.startAll=b=>__toolbarCalls.push(b.dataset.action);window.termaForwardGlobal.service.stopAll=b=>__toolbarCalls.push(b.dataset.action);window.termaConnectionHealthBatch.checkAll=b=>__toolbarCalls.push(b.dataset.action);
      window.termaX11.openManager=()=>__toolbarCalls.push('workspace-remote-xserver');void 0;`);
    try {
      await click('#explorerTools #workspace-remote-xserver');
      await click('#explorerTools [data-action="workspace-show-connections"]');
      await menuCheck('Create from SSH opens the SSH explorer',`primaryView==='connections' && !!$('connectionSearch')`);
      for (const action of directActions.ssh) await click('#explorerTools [data-action="'+action+'"]');
      assert.deepEqual(await execute('window.__toolbarCalls'),[...directActions.remote.slice(1),...directActions.ssh]);
    } finally {
      await execute('[window.termaForwardGlobal.service.startAll,window.termaForwardGlobal.service.stopAll,window.termaConnectionHealthBatch.checkAll,window.termaX11.openManager]=window.__originalToolbar;void 0');
    }
  };
  const settle=()=>execute('await window.termaConnectionLocalizationReady;await window.termaQuickLocalizationReady;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const check=async(name,selector)=>{
    const draft=()=>execute(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return [...e.querySelectorAll('input,select,textarea')].map(x=>({id:x.id,value:x.value,checked:x.checked,type:x.type}));})()`);
    const saved=await draft(),language=await execute('document.documentElement.lang');
    for(const next of [language==='en-US'?'zh-CN':'en-US',language]){await execute(`await setTermaLanguage(${JSON.stringify(next)})`);await settle();}
    assert.deepEqual(await draft(),saved,name+' preserves fields and password visibility during live language switch');
    if(selector==='#view-edit')assert.equal(await execute(`(()=>{const tab=tabs.find(value=>value.key===activeTabKey);const node=[...document.querySelectorAll('.tab[data-tab-key],.mobile-workspace-tab-main[data-tab-key]')].find(value=>value.dataset.tabKey===activeTabKey);const title=node?.querySelector('.tab-title,.mobile-workspace-tab-title');if(!tab||!title)return true;let expected='';if(tab.kind==='remote-edit'&&!Number(tab.id))expected=tr('remote:auto.add_protocol_short',{protocol:window.termaRemoteProfiles.presentation.label(tab.protocol)});else if((tab.kind==='edit'||!tab.kind&&tab.viewName==='edit')&&!Number(tab.id))expected=tr('connections:list.add_ssh');else return true;return title.textContent.trim()===expected;})()`),true,name+' keeps the new connection tab title localized to its protocol');
    const result=await execute(`(()=>{const root=document.querySelector(${JSON.stringify(selector)});if(!root?.checkVisibility())throw Error('Hidden view '+${JSON.stringify(name)});const han=[],w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(w.nextNode())if(/[\u3400-\u9fff]/.test(w.currentNode.textContent))han.push(w.currentNode.textContent.trim());for(const e of [root,...root.querySelectorAll('*')])for(const a of ['title','placeholder','aria-label'])if(/[\u3400-\u9fff]/.test(e.getAttribute(a)||''))han.push(e.getAttribute(a));const ids=[...document.querySelectorAll('[id]')].filter(e=>e.checkVisibility()).map(e=>e.id);return {han:[...new Set(han)],object:root.textContent.includes('[object Object]'),duplicates:ids.filter((id,i)=>ids.indexOf(id)!==i),overflow:document.documentElement.scrollWidth>innerWidth+1,cards:[...root.querySelectorAll('.modal-card,.panel,.server-directory-picker')].filter(e=>e.checkVisibility()&&e.scrollWidth>e.clientWidth+2).map(e=>({className:e.className,overflow:e.scrollWidth-e.clientWidth})),language:document.documentElement.lang};})()`);
    const toolbarFits=await execute(`(()=>{const strip=document.querySelector('#explorerTools .connection-action-strip');if(!strip?.checkVisibility())return true;const bounds=strip.getBoundingClientRect();return [...strip.querySelectorAll('button')].every(button=>{const rect=button.getBoundingClientRect();return rect.left>=bounds.left-.5&&rect.right<=bounds.right+.5&&rect.top>=bounds.top-.5&&rect.bottom<=bounds.bottom+.5;});})()`);
    await capture(name,selector);
    assert.equal(toolbarFits,true,name+' responsive connection toolbar buttons fit their grid');
    assert.equal(result.object,false,name+' no coerced objects');assert.deepEqual(result.duplicates,[],name+' unique IDs');assert.equal(result.overflow,false,name+' page fits');assert.deepEqual(result.cards,[],name+' content fits');
    if(result.language==='en-US')assert.deepEqual(result.han,[],name+' translates hidden content and attributes');
    reports.push({name,...result});
  };
  const checkDashboard = async prefix => {
    const refresh = '#view-dashboard [data-dashboard-action="refresh"]';
    await execute(`window.__inspectionFixture={api,requests:0,pending:[],repair:window.termaConnectionHealthActions.repairDashboardCredentials,repairs:[]};
      api=(route,options)=>route==='/api/connections/9701/inspect' && options?.method==='POST'
        ? (window.__inspectionFixture.requests++,new Promise((resolve,reject)=>window.__inspectionFixture.pending.push({resolve,reject})))
        : window.__inspectionFixture.api(route,options);
      window.termaConnectionHealthActions.repairDashboardCredentials=(id,options)=>window.__inspectionFixture.repairs.push({id,options});
      window.termaConnectionMenu.open(__connectionMenuEvent,9701);void 0;`);
    try {
      await click('#actionMenu [data-terminal-display-action="dashboard"]');
      await menuCheck(prefix+' dashboard loading and disabled refresh',`!!document.querySelector('#view-dashboard .dashboard-grid[aria-busy="true"]') && document.querySelector('${refresh}').disabled && __inspectionFixture.requests===1`);
      await check(prefix+'-dashboard-loading','#view-dashboard');
      const sample = {ok:true, output:'## system\nFixture <b>literal</b>\n## __proto__\nIgnored\n## ports\n22/ssh'};
      await execute(`__inspectionFixture.pending.shift().resolve(${JSON.stringify(sample)});await Promise.resolve();`);
      await menuCheck(prefix+' dashboard parses known sections and prints remote text literally',`$('view-dashboard').textContent.includes('Fixture <b>literal</b>') && !$('view-dashboard').querySelector('pre b') && !$('view-dashboard').textContent.includes('Ignored') && $('view-dashboard').querySelectorAll('.dashboard-card').length===6`);
      await check(prefix+'-dashboard-result','#view-dashboard');
      await click(refresh);
      await execute(`__inspectionFixture.pending.shift().reject(Object.assign(new Error('Fixture SSH authentication failed'),{code:'SSH_AUTHENTICATION_FAILED'}));await Promise.resolve();`);
      await menuCheck(prefix+' dashboard authentication routes captured connection',`__inspectionFixture.repairs.length===1 && __inspectionFixture.repairs[0].id===9701 && !!$('view-dashboard').querySelector('[data-dashboard-action="repair"]')`);
      await check(prefix+'-dashboard-error','#view-dashboard');
      await click('#view-dashboard [data-dashboard-action="repair"]');
      await menuCheck(prefix+' dashboard manual repair stays in the same tab',`__inspectionFixture.repairs.length===2 && activeTabKey==='dashboard-9701'`);
      await execute(`void __inspectionFixture.repairs[1].options.onSaved();await Promise.resolve();`);
      await menuCheck(prefix+' dashboard retries after credentials are saved',`__inspectionFixture.requests===3 && $('view-dashboard').querySelector('.dashboard-grid').getAttribute('aria-busy')==='true'`);
      await execute(`closeTabsByKey(['dashboard-9701']);void window.termaConnectionMenu.actions(9701,[]).find(action=>action.key==='dashboard').run();await Promise.resolve();`);
      await execute(`__inspectionFixture.pending.shift().reject(Object.assign(new Error('Stale response'),{code:'SSH_AUTHENTICATION_FAILED'}));await Promise.resolve();`);
      await menuCheck(prefix+' closed dashboard response cannot paint or invoke repair in the reopened tab',`__inspectionFixture.requests===4 && __inspectionFixture.repairs.length===2 && !$('view-dashboard').textContent.includes('Stale response') && $('view-dashboard').querySelector('.dashboard-grid').getAttribute('aria-busy')==='true'`);
      await execute(`__inspectionFixture.pending.shift().resolve({ok:false,output:''});await Promise.resolve();`);
      await menuCheck(prefix+' empty dashboard response stays in the new tab',`$('view-dashboard').querySelectorAll('.dashboard-card.bad').length===6 && $('view-dashboard').textContent.includes(tr('connections:health.no_data'))`);
      await check(prefix+'-dashboard-empty','#view-dashboard');
    } finally {
      await execute(`closeTabsByKey(['dashboard-9701']);api=__inspectionFixture.api;window.termaConnectionHealthActions.repairDashboardCredentials=__inspectionFixture.repair;delete window.__inspectionFixture;if(isMobileLayout())window.termaWorkspaceShell.showPrimary('connections');void 0;`);
    }
  };
  const checkHealth = async prefix => {
    const checkAll = '#explorerTools [data-action="workspace-connection-check-all"]';
    await execute(`window.__healthFixture={api,requests:[],before:new Map(healthResults),toasts:new Set([...$('toast').querySelectorAll('.toast')].map(e=>e.dataset.toastId))};
      api=async (route, options)=>{
        const id=Number(route.split('/')[3]);
        if(![9701,9702].includes(id)||!route.endsWith('/health')||options?.method!=='POST')return __healthFixture.api(route,options);
        __healthFixture.requests.push(id);
        return id===9701
          ? {id,ok:false,ssh:{ok:false,diagnosis:{reason_code:'ssh_failed'},raw_output:'Fixture raw <literal>',preserve_raw_output:true}}
          : {id,ok:false,ssh:{ok:false,diagnosis:{reason_code:'ssh_handshake_timeout'},raw_output:'INTERNAL DIAGNOSTIC',preserve_raw_output:false}};
      };
      window.termaConnectionMenu.open(__connectionMenuEvent,9701);void 0;`);
    try {
      await click('#actionMenu [data-terminal-display-action="health"]');
      await menuCheck(prefix+' row health shows translated diagnostic and literal remote output',`(()=>{
        const toast=[...$('toast').querySelectorAll('.toast-progress')].find(e=>!__healthFixture.toasts.has(e.dataset.toastId));
        return JSON.stringify(__healthFixture.requests)==='[9701]'&&healthResults.get(9701)?.ok===false&&toast?.checkVisibility()&&toast.textContent.includes(tr('errors:ssh_failed'))&&toast.textContent.includes('Fixture raw <literal>')&&!toast.querySelector('literal');
      })()`);
      await shot(prefix+'-health-row-diagnosis',true);
      await execute(`for(const toast of $('toast').querySelectorAll('.toast-progress'))if(!__healthFixture.toasts.has(toast.dataset.toastId))window.termaNotificationToasts.dismiss(toast.dataset.toastId);void 0;`);
      await delay(260);
      await click(checkAll);
      await menuCheck(prefix+' batch health identifies both rows, restores button and omits internal diagnostic',`(()=>{
        const toast=[...$('toast').querySelectorAll('.toast-progress')].find(e=>!__healthFixture.toasts.has(e.dataset.toastId)&&!e.classList.contains('is-leaving'));
        const targets=[9701,9702].map(id=>connections.find(item=>item.id===id));
        return JSON.stringify(__healthFixture.requests)==='[9701,9701,9702]'&&!document.querySelector('${checkAll}').disabled&&toast?.checkVisibility()&&targets.every(c=>toast.textContent.includes(c.name+' · '+c.ssh_user+'@'+c.ssh_host+':'+c.ssh_port))&&toast.textContent.includes(tr('errors:ssh_handshake_timeout'))&&!toast.textContent.includes('INTERNAL DIAGNOSTIC');
      })()`);
      await shot(prefix+'-health-batch-result',true);
    } finally {
      await execute(`api=__healthFixture.api;healthResults.clear();for(const [key,value] of __healthFixture.before)healthResults.set(key,value);for(const toast of $('toast').querySelectorAll('.toast-progress'))if(!__healthFixture.toasts.has(toast.dataset.toastId))window.termaNotificationToasts.dismiss(toast.dataset.toastId);delete window.__healthFixture;window.termaConnectionViews.renderConnections();void 0;`);
    }
  };
  const checkAdvancedDiagnostics = async (prefix, language) => {
    const setExtraArgs = async (value, state) => {
      const ready = state === 'clear' ? 'box.hidden' : `box.classList.contains('has-${state}')`;
      await execute(`const field=$('conn_extra'),box=$('connExtraDiagnostics');field.value=${JSON.stringify(value)};
        field.dispatchEvent(new Event('input',{bubbles:true}));
        for(let i=0;i<60&&!${ready};i++)await new Promise(r=>setTimeout(r,35));`);
    };
    const warn = '-o ServerAliveInterval=10';
    const broken = warn + '\n-o Compression="yes';
    const visibleRow = severity => `(()=>{const row=$('connExtraDiagnostics').querySelector('.ssh-extra-issue.${severity}');const r=row.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&row.contains(document.elementFromPoint(Math.floor(r.x+r.width/2),Math.floor(r.y+r.height/2)));})()`;
    await setExtraArgs(warn, 'warnings');
    await menuCheck(prefix+' validation shows the duplicate setting as a warning',`$('connExtraDiagnostics').classList.contains('has-warnings')&&$('connExtraDiagnostics').querySelector('.ssh-extra-issue.warning')&&$('connAdvancedOptions').open&&$('conn_extra').getAttribute('aria-invalid')==='false'&&$('connAdvancedStatus').textContent===tr('connections:validation.warning_count',{count:1})`);
    await execute("$('connExtraDiagnostics').querySelector('.ssh-extra-issue').scrollIntoView({block:'center'})");
    await menuCheck(prefix+' warning row is visible', visibleRow('warning'));
    await shot(prefix+'-ssh-extra-args-warning');
    await setExtraArgs(broken, 'errors');
    await menuCheck(prefix+' validation shows an error while retaining the warning',`$('connExtraDiagnostics').classList.contains('has-errors')&&$('connExtraDiagnostics').querySelector('.ssh-extra-issue.warning')&&$('connAdvancedStatus').classList.contains('error')&&$('conn_extra').getAttribute('aria-invalid')==='true'`);
    await execute(`window.__sshIssue=$('connExtraDiagnostics').querySelector('.ssh-extra-issue.error');__sshIssue.scrollIntoView({block:'center'});__sshIssue.focus({preventScroll:true});void 0`);
    try {
      for (const next of [language==='en-US'?'zh-CN':'en-US', language]) {
        await execute(`await setTermaLanguage('${next}')`);
        await settle();
        await menuCheck(prefix+' diagnostic updates language without replacing the focused row',`document.activeElement===__sshIssue&&$('connExtraDiagnostics').querySelector('.ssh-extra-diagnostics-head strong').textContent===tr('connections:validation.fix_count',{count:1})&&$('conn_extra').value===${JSON.stringify(broken)}&&$('conn_name').value==='unsaved-name'`);
      }
    } finally {
      await execute('delete window.__sshIssue');
    }
    await execute("$('connExtraDiagnostics').querySelector('.ssh-extra-issue.error').scrollIntoView({block:'center'})");
    await menuCheck(prefix+' error row is visible', visibleRow('error'));
    await shot(prefix+'-ssh-extra-args-error');
    await check(prefix+'-ssh-extra-args-review','#view-edit');
    await click('#connExtraDiagnostics .ssh-extra-issue.error');
    await menuCheck(prefix+' diagnostic click selects the bad span in the editor',`(()=>{const editor=$('conn_extra');return document.activeElement===editor&&editor.value.slice(editor.selectionStart,editor.selectionEnd)==='Compression="yes';})()`);
    await execute(`window.termaConnectionFormWorkspace.advanced.render($('connectionForm'), [{severity:'warning',line:1,option:'Fixture',message:'Literal <em>argument</em>'}]);void 0`);
    await menuCheck(prefix+' unknown diagnostic is rendered as text',`$('connExtraDiagnostics').textContent.includes('Literal <em>argument</em>')&&!$('connExtraDiagnostics').querySelector('em')`);
    await setExtraArgs('', 'clear');
    await menuCheck(prefix+' clearing the input removes diagnostics and invalid state',`$('connExtraDiagnostics').hidden&&!$('connExtraDiagnostics').childElementCount&&$('conn_extra').getAttribute('aria-invalid')==='false'&&$('connAdvancedStatus').textContent===tr('connections:validation.summary')`);
  };
  await execute(`(async()=>{await window.termaI18nReady;window.__connectionApi=api;window.__connectionDesktop=window.termaDesktop;window.__connectionOriginal=connections;window.__connectionWrites=[];window.__identityReads=0;window.__pickerError=false;window.__pickerCreated=false;
    window.termaDesktop=undefined;
    window.__connectionFixture=[{id:9701,name:'Fixture Alpha',group_name:'Fixture group',ssh_user:'review',ssh_host:'alpha.example',ssh_port:22,auth_type:'key',sort_order:1,forwards:[],identity_file:'C:/fixture/id_ed25519'},{id:9702,name:'Fixture Beta',group_name:'Fixture group',ssh_user:'review',ssh_host:'beta.example',ssh_port:2222,auth_type:'password',sort_order:2,forwards:[]}];
    connections=window.__connectionFixture;groupOpen.add('Fixture group');
    api=async(route,options={})=>{
      if(route==='/api/connection-groups/reorder'){window.__connectionGroupOrder=JSON.parse(options.body).names;return {ok:true};}
      if(route==='/api/server-files/create'){window.__pickerCreated=true;return {ok:true};}
      if(route==='/api/serial/ports')return {available:true,ports:[{path:'COM7',manufacturer:'Fixture serial'}]};
      if(route==='/api/ssh/extra-args/validate')return window.__connectionApi(route,options);
      if(route==='/api/test-ssh'){
        const body=JSON.parse(options.body);
        window.__testFormFlags={passwordOnly:body.auth_type==='password'&&body.identity_file===''&&body.private_key_passphrase===''&&body.ssh_agent_mode==='off'&&body.ssh_password==='fixture-only',group:body.group_name};
        return {ok:true,elapsed_ms:12,capabilities:{platform:'linux',platform_label:'Linux',default_shell:{label:'Bash',path:'/bin/bash'},profiles:[{label:'Bash',path:'/bin/bash',kind:'shell'}],tools:[]}};
      }
      if(route==='/api/identity-files/check')return {ok:true,label:'Fixture permissions',details:''};
      if(options.method&&options.method!=='GET'){window.__connectionWrites.push(route);throw Error('Unexpected fixture mutation: '+route);}
      if(route==='/api/connections')return window.__connectionFixture;
      if(route==='/api/startup-status')return {state:'ready',local_url:'http://127.0.0.1:8108',lan_urls:['http://192.0.2.1:8108']};
      if(route==='/api/identity-files'){window.__identityReads++;return [{path:'C:/fixture/id_ed25519',name:'id_ed25519',source:'project',permission_ok:false}];}
      if(route==='/api/identity-files/info')return {items:[{path:'C:/fixture/id_ed25519',name:'id_ed25519',permission:{ok:true}}]};
      if(route==='/api/sftp/automations')return [];
      if(route==='/api/sftp/automations/context')return {default_path:'C:/fixture/host'};
      if(route.startsWith('/api/server-files/resolve'))return {path:'/workspace',display_path:'C:/fixture/host'};
      if(route.startsWith('/api/server-files?')){if(window.__pickerError)throw Error('Fixture access denied');const q=new URL(route,location.origin).searchParams,p=q.get('path')||'',page=Number(q.get('page')||1);return {path:p,display_path:p?'C:/fixture/host'+p.replace('/workspace',''):'',parent:p.includes('/project')?'/workspace':'',page,total_pages:p==='/workspace'?2:1,entries:p===' '||!p?[{type:'drive',name:'Fixture host',path:'/workspace',display_path:'C:/fixture/host'}]:p==='/workspace'?[{type:'dir',name:page===1?'project':'archive',path:'/workspace/'+(page===1?'project':'archive')},...(window.__pickerCreated?[{type:'dir',name:'created',path:'/workspace/created'}]:[])]:[]};}
      return window.__connectionApi(route,options);
    };window.termaWorkspaceShell.dismissGuide();window.termaWorkspaceShell.showPrimary('connections');window.termaConnectionViews.renderConnections();})()`);
  try {
    for(const width of [1200,390])for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']){
      const prefix=language+'-'+theme+'-'+width;console.log('[connections-ui] '+prefix);browser.setContentSize(width,844);await delay(70);
      await execute(`window.termaWorkspaceShell.showPrimary('running');window.termaForwardWorkspace.renderRunning();window.termaWorkspaceShell.showPrimary('connections');window.termaConnectionViews.renderConnections()`);
      await execute(`closeModal();hideActionMenu();applyTheme('${theme}');await setTermaLanguage('${language}');window.termaWorkspaceShell.showPrimary('connections');window.termaConnectionViews.renderWelcome();if(isMobileLayout())window.termaWorkspaceShell.showMobileWorkspace()`);await settle();await check(prefix+'-welcome','#view-welcome');
      await execute(`const realApi=api;api=(url,...args)=>url==='/api/startup-status'?Promise.resolve({state:'starting',local_url:'http://127.0.0.1:8109'}):realApi(url,...args);try{window.termaConnectionViews.renderWelcome();for(let attempt=0;attempt<100&&!$('startupSummary')?.textContent.includes('8109');attempt++)await new Promise(done=>setTimeout(done,25));if(!$('startupSummary')?.textContent.includes('8109'))throw new Error('Starting summary did not load');}finally{api=realApi;}`);await check(prefix+'-welcome-starting','#view-welcome');
      await execute(`window.termaWorkspaceShell.showPrimary('remote');if(isMobileLayout())window.termaWorkspaceShell.showMobileExplorer()`);
      await menuCheck(prefix+' remote Add Connection label fits its button',`(()=>{
        const button=document.querySelector('[data-action="workspace-remote-add"]'),label=button.querySelector('span');
        const range=document.createRange();range.selectNodeContents(label);
        const bounds=button.getBoundingClientRect();
        return button.checkVisibility()&&label.textContent===tr('remote:auto.add_connection')&&range.getClientRects().length===1&&[...range.getClientRects()].every(rect=>
          rect.left>=bounds.left&&rect.right<=bounds.right&&rect.top>=bounds.top&&rect.bottom<=bounds.bottom);
      })()`);
      await toolbar(prefix,'remote');
      await execute(`window.termaWorkspaceRefresh.stop();window.__remoteSearchFixture={profiles:remoteProfiles,search:window.termaRemoteList.getSearch()};
        remoteProfiles=[{id:9780,name:'Fixture IPv6',protocol:'ftp',username:'review',host:'[2001:db8::1]',port:21,group_name:'Fixture remote'},
          {id:9781,name:'Fixture serial',protocol:'serial',options:{path:'COM91'},group_name:'Fixture remote'},
          {id:9782,name:'Fixture LAN',protocol:'xdmcp',port:177,options:{mode:'broadcast'},group_name:'Fixture remote'}];
        remoteGroupOpen.add('Fixture remote');window.termaRemoteList.setSearch('');
        window.__enterRemoteSearch=query=>{const input=$('remoteConnectionSearch');input.focus();input.value=query;input.dispatchEvent(new Event('input',{bubbles:true}));};void 0`);
      try {
        await execute(`window.__enterRemoteSearch('  DB8::1  ');void 0`);
        await settle();
        await menuCheck(prefix+' IPv6 search is case-insensitive and formats the address once',`(()=>{const rows=[...document.querySelectorAll('[data-remote-profile-id]')];return rows.length===1&&rows[0].querySelector('.conn-meta')?.textContent==='review@[2001:db8::1]:21'&&localStorage.getItem('remoteConnectionSearch')==='  DB8::1  ';})()`);
        await shot(prefix+'-remote-ipv6-search');
        await execute(`window.termaWorkspaceShell.showPrimary('connections');window.termaWorkspaceShell.showPrimary('remote');if(isMobileLayout())window.termaWorkspaceShell.showMobileExplorer();void 0`);
        await settle();
        await menuCheck(prefix+' view switch restores the filter',`$('remoteConnectionSearch').value==='  DB8::1  '&&window.termaRemoteList.visible().length===1`);
        await execute(`window.__enterRemoteSearch('missing-target');void 0`);
        await click('[data-action="remote-search-clear"]');
        await menuCheck(prefix+' clear-search restores results and persisted state',`$('remoteConnectionSearch').value===''&&localStorage.getItem('remoteConnectionSearch')===''&&window.termaRemoteList.visible().length===3`);
        await click('[data-action="workspace-remote-add"]');
        await menuCheck(prefix+' the shared add menu localizes serial and lists all six protocols',`(()=>{const entries=[...document.querySelectorAll('#actionMenu [data-terminal-display-action]')];return entries.length===6&&entries[0].textContent.trim()==='RDP'&&entries[5].textContent.trim()===tr('remote:auto.serial');})()`);
        await shot(prefix+'-remote-add-protocols');
        await click('#actionMenu [data-terminal-display-action="action-5"]');
        await settle();
        await menuCheck(prefix+' real click launches the serial editor with its own tab',`activeTabKey==='remote-new-serial'&&$('remote_protocol')?.value==='serial'&&$('remoteNetworkFields')?.hidden`);
        await shot(prefix+'-remote-add-serial');
      } finally {
        await execute(`hideActionMenu();remoteProfiles=window.__remoteSearchFixture.profiles;window.termaRemoteList.setSearch(window.__remoteSearchFixture.search);window.termaWorkspaceShell.showPrimary('remote');if(isMobileLayout())window.termaWorkspaceShell.showMobileExplorer();void 0`);
      }
      await checkDirectActions();
      await execute(`window.termaWorkspaceShell.showPrimary('connections');window.termaConnectionList.setSearch('');groupOpen.add('Fixture group');window.termaConnectionViews.renderConnections();if(isMobileLayout())window.termaWorkspaceShell.showMobileExplorer()`);await check(prefix+'-connection-list','#connectionGroups');
      await toolbar(prefix,'ssh');
      if (process.env.TERMA_CONNECTION_TOOLBAR_ONLY==='1') {
        await execute(`$('connectionSearch').focus();void 0;`);
        await key('Tab');await key('Tab');
        await menuCheck(prefix+' Tab focuses the first icon',`document.activeElement?.dataset.action==='workspace-group-add' && document.activeElement.matches(':focus-visible')`);
        await shot(prefix+'-ssh-keyboard-focus');
        await execute('document.activeElement.blur();void 0');
        if(width===1200) {
          await prepareNarrowPane();
          await toolbar(prefix+'-narrow-pane','ssh');
          await execute(`window.termaWorkspaceShell.showPrimary('remote');void 0;`);
          await toolbar(prefix+'-narrow-pane','remote');
          await execute(`window.termaWorkspaceChrome.apply("operation", 292);void 0;`);
        }
        continue;
      }
      await menuCheck(prefix+' remote toolbar mode is cleared when returning to SSH',`!$('explorerTools').classList.contains('remote-connection-mode')`);
      if (width===1200) {
        const points = await execute(`(()=>{
          window.__connectionGroupOrder=null;
          connections=[...__connectionFixture,{id:9703,name:'Fixture Gamma',group_name:'Fixture secondary',ssh_host:'gamma.example',forwards:[]}];
          groupOpen.delete('Fixture secondary');window.termaConnectionViews.renderConnections();
          const groups=[...$('connectionGroups').querySelectorAll('.connection-group-head-row')];
          const [first,second]=groups.map(row=>row.getBoundingClientRect());
          const grip=groups[1].querySelector('.connection-group-drag-handle').getBoundingClientRect();
          const title=groups[1].querySelector('.group-head').getBoundingClientRect();
          return {
            hover:{x:Math.round(title.left+20),y:Math.round(second.top+second.height/2)},
            grip:{x:Math.round(grip.left+grip.width/2),y:Math.round(grip.top+grip.height/2)},
            target:{x:Math.round(first.left+28),y:Math.round(first.top+5)},
            rowHeight:second.height
          };
        })()`);
        assert.equal(points.rowHeight,28,prefix+' compact group heading');
        await shot(prefix+'-groups-resting');
        browser.webContents.sendInputEvent({type:'mouseMove',...points.hover});
        await delay(120);
        await menuCheck(prefix+' group hover reveals grip and menu',`(()=>{
          const row=document.querySelector('.connection-group-head-row:hover');
          return Number(getComputedStyle(row.querySelector('.connection-group-drag-handle')).opacity)>0
            &&getComputedStyle(row.querySelector('.connection-group-menu-button')).opacity==='1';
        })()`);
        await shot(prefix+'-group-controls');
        browser.webContents.sendInputEvent({type:'mouseMove',...points.grip});
        browser.webContents.sendInputEvent({type:'mouseDown',...points.grip,button:'left',clickCount:1});
        await delay(520);
        await menuCheck(prefix+' long press starts group drag',`!!document.querySelector('.group-dragging')`);
        browser.webContents.sendInputEvent({type:'mouseMove',...points.target});
        await delay(90);
        await shot(prefix+'-group-dragging');
        browser.webContents.sendInputEvent({type:'mouseUp',...points.target,button:'left',clickCount:1});
        await delay(550);
        const groupOrder=await execute(`({
          rendered:[...$('connectionGroups').querySelectorAll('.group[data-group-name]')]
            .map(group=>decodeURIComponent(group.dataset.groupName)),
          saved:__connectionGroupOrder?.slice(0,2)
        })`);
        const expected=['Fixture secondary','Fixture group'];
        assert.deepEqual(groupOrder,{rendered:expected,saved:expected},prefix+' drag saves new group order and rerenders');
        await shot(prefix+'-groups-reordered');
        await click('.connection-group-head-row .connection-group-menu-button');
        await checkMenu(prefix+'-group-actions');
        await execute(`hideActionMenu();connections=__connectionFixture;window.termaConnectionViews.renderConnections()`);
      }
      const activeRows=`[...$('connectionGroups').querySelectorAll('.conn-row.active')].map(row=>row.dataset.connectionId)`;
      const switched=await execute(`(async()=>{
        const host=$('connectionGroups'), rows=[...host.querySelectorAll('.conn-row')];
        const control=rows[0].querySelector('[data-action="connection-menu"]');
        control.focus({preventScroll:true});
        const priorScroll=host.scrollTop;
        selectConnection(9702);
        const afterRender=${activeRows};
        selectConnection('9701',{render:false});
        await new Promise(requestAnimationFrame);
        return {afterRender,afterSync:${activeRows},
          sameRows:rows.every((row,index)=>host.querySelectorAll('.conn-row')[index]===row),
          sameFocus:document.activeElement===control,sameScroll:host.scrollTop===priorScroll,
          current:currentConnection()===__connectionFixture[0]};
      })()`);
      assert.deepEqual(switched,{afterRender:['9702'],afterSync:['9701'],sameRows:true,sameFocus:true,sameScroll:true,current:true},prefix+' selection follows the controller without replacing rows or moving focus');
      await check(prefix+'-selected-connection-row','#connectionGroups');
      assert.deepEqual(await execute(activeRows),['9701'],prefix+' a live language repaint preserves a numeric-string selection');
      await execute(`window.__controllerWrites=__connectionWrites.length;window.__controllerRemove=window.termaConnectionController.remove(9701);await new Promise(resolve=>requestAnimationFrame(resolve));selectConnection(9702,{render:false});if(!$('modal').textContent.includes('Fixture Alpha'))throw Error('Delete confirmation lost its captured connection');`);
      await check(prefix+'-controller-delete-cancel','#modal');
      await click('#modal [data-choice="1"]');
      assert.equal(await execute(`await __controllerRemove;return $('modal').hidden&&Number(selectedId)===9702&&currentConnection()===__connectionFixture[1]&&__connectionWrites.length===__controllerWrites;`),true,prefix+' cancelled deletion keeps the new selection and performs no write');
      await click('.group-head');
      await menuCheck(prefix+' collapsed group exposes aria-expanded=false',`document.querySelector('.group-head').getAttribute('aria-expanded')==='false'`);
      await check(prefix+'-collapsed-group','#connectionGroups');await click('.group-head');
      await menuCheck(prefix+' open group exposes aria-expanded=true',`document.querySelector('.group-head').getAttribute('aria-expanded')==='true'`);
      assert.deepEqual(await execute(activeRows),['9702'],prefix+' reopening the group paints only the currently selected row');
      await execute(`window.termaConnectionList.setSearch('no-match')`);await check(prefix+'-search-empty','#connectionGroups');
      await execute(`window.termaConnectionList.setSearch('')`);
      assert.deepEqual(await execute(activeRows),['9702'],prefix+' clearing a search restores the current selection');
      await execute(`connections=Array.from({length:100},(_,i)=>({...__connectionFixture[0],id:10000+i,name:'Fixture virtual '+i}));$('connectionGroups').scrollTop=0;window.termaConnectionViews.renderConnections()`);
      await menuCheck(prefix+' large list renders just the initial window', `!!document.querySelector('.conn-row[data-connection-id="10000"]')&&$('connectionGroups').querySelectorAll('.conn-row').length<100`);
      await execute(`$('connectionGroups').scrollTop=4800`);
      await delay(140);
      await menuCheck(prefix+' scrolling replaces the virtual window', `$('connectionGroups').scrollTop>=4700&&!document.querySelector('.conn-row[data-connection-id="10000"]')&&!!document.querySelector('.conn-row[data-connection-id="10040"]')`);
      await shot(prefix+'-virtual-scroll');
      await execute(`connections=[...__connectionFixture];$('connectionGroups').scrollTop=0;window.termaConnectionViews.renderConnections()`);
      await click('#explorerTools [data-action="workspace-group-add"]');
      await menuCheck(prefix+' add group focuses its field', `document.activeElement===$('newGroupName')`);
      await click('[data-connection-group-add="confirm"]');
      await menuCheck(prefix+' empty group stays open', `!!$('newGroupName')&&window.termaConnectionGroups.adding`);
      await execute(`$('newGroupName').value='Fixture draft';$('newGroupName').focus()`);
      await check(prefix+'-new-group','#connectionGroups');
      await menuCheck(prefix+' group draft keeps focus after language changes', `document.activeElement===$('newGroupName')`);
      await click('[data-connection-group-add="cancel"]');
      await menuCheck(prefix+' group cancel removes the field', `!$('newGroupName')&&!window.termaConnectionGroups.adding`);
      await execute(`window.termaConnectionViews.openGroupModal(()=>{})`);await check(prefix+'-choose-group','#modal');await execute('closeModal()');
      await execute(`window.termaConnectionMenu.openGroup({clientX:110,clientY:160,preventDefault(){},stopPropagation(){}},'Fixture group')`);await check(prefix+'-group-menu','#actionMenu');await execute('hideActionMenu()');
      await execute(`window.termaConnectionMenu.open({clientX:110,clientY:230,preventDefault(){},stopPropagation(){}},9701)`);await check(prefix+'-row-menu','#actionMenu');await execute('hideActionMenu()');
      await execute(`window.__connectionMenuCalls=[];window.__connectionMenuSaved=[];
        window.__stubConnectionMenu=(object,key,run)=>{__connectionMenuSaved.push([object,key,object[key]]);object[key]=run;};
        window.__restoreConnectionMenu=()=>{ for(const [object,key,original] of __connectionMenuSaved.splice(0).reverse())object[key]=original; };
        __stubConnectionMenu(window.termaConnectionList,'orderedConnectionGroupNames',()=>['First','Fixture group','Last']);
        __stubConnectionMenu(window.termaConnectionGroups,'rename',group=>__connectionMenuCalls.push(['rename',group]));
        __stubConnectionMenu(window.termaConnectionList,'moveGroup',(group,delta)=>__connectionMenuCalls.push(['move',group,delta]));window.__connectionMenuEvent={clientX:innerWidth-12,clientY:innerHeight-12,preventDefault(){},stopPropagation(){}};void 0;`);
      for(const [group,keys] of [['First',['rename','move-down']],['Fixture group',['rename','move-up','move-down']],['Last',['rename','move-up']],['Missing',['rename']]]){
        await execute(`window.termaConnectionMenu.openGroup(__connectionMenuEvent,${JSON.stringify(group)})`);
        await menuCheck(prefix+' group order '+group,`JSON.stringify([...document.querySelectorAll('#actionMenu [data-terminal-display-action]')].map(e=>e.dataset.terminalDisplayAction))===${JSON.stringify(JSON.stringify(keys))}`);
        await checkMenu(prefix+'-group-'+group.replaceAll(' ','-'));
      }
      await execute(`window.termaConnectionMenu.openGroup(__connectionMenuEvent,'Fixture group')`);await click('#actionMenu [data-terminal-display-action="move-up"]');
      await menuCheck(prefix+' group move retains the exact group and delta',`JSON.stringify(__connectionMenuCalls.at(-1))==='["move","Fixture group",-1]'&&!termaTerminalActionMenu.active()`);
      await execute(`window.termaConnectionMenu.openGroup(__connectionMenuEvent,'Fixture group')`);await click('#actionMenu [data-terminal-display-action="rename"]');
      await menuCheck(prefix+' group rename retains the exact group',`JSON.stringify(__connectionMenuCalls.at(-1))==='["rename","Fixture group"]'`);
      await execute(`(()=>{const capture=(name,id)=>__connectionMenuCalls.push([name,id]);
        __stubConnectionMenu(window.termaActionRegistry,'runAction',(_key,{connectionId})=>capture('sftp',connectionId));
        __stubConnectionMenu(window.termaConnectionHealthActions,'check',id=>capture('health',id));
        __stubConnectionMenu(window.termaConnectionController,'duplicate',id=>capture('duplicate',id));
        __stubConnectionMenu(window.termaConnectionFormWorkspace,'edit',id=>capture('edit',id));
        __stubConnectionMenu(window.termaConnectionController,'remove',id=>capture('remove',id));
        __stubConnectionMenu(window.termaRemoteDesktop.relations,'actionsForSsh',id=>[{label:'Fixture <literal>',icon:'monitor',run:()=>__connectionMenuCalls.push(['open-remote',id,9801])}]);window.termaConnectionMenu.open(__connectionMenuEvent,9701);})()`);
      await checkMenu(prefix+'-row-linked-menu');
      await execute(`window.__connectionMenuFocused=document.querySelector('#actionMenu [data-terminal-display-action="health"]');__connectionMenuFocused.focus();window.__connectionMenuScroll=__connectionMenuFocused.parentElement.scrollTop;await setTermaLanguage('${language==='en-US'?'zh-CN':'en-US'}',{render:false});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));`);
      await menuCheck(prefix+' row live language retains focused node scroll and text',`document.activeElement===__connectionMenuFocused&&__connectionMenuFocused.parentElement.scrollTop===__connectionMenuScroll&&__connectionMenuFocused.textContent.trim()===tr('connections:actions.health_check')`);
      await shot(prefix+'-row-live-language');
      await execute(`await setTermaLanguage('${language}',{render:false});`);
      await click('#actionMenu [data-terminal-display-action="open-remote"]');await checkMenu(prefix+'-row-open-remote');
      await menuCheck(prefix+' remote names render as literal text',`(()=>{const menu=document.querySelector(innerWidth<=760?'#actionMenu':'#actionSubMenu');return menu.textContent.includes('Fixture <literal>')&&!menu.querySelector('literal')})()`);
      await click(`${width<=760?'#actionMenu':'#actionSubMenu'} [data-terminal-display-action="action-0"]`);
      await menuCheck(prefix+' remote child keeps captured target',`JSON.stringify(__connectionMenuCalls.at(-1))==='["open-remote",9701,9801]'&&!termaTerminalActionMenu.active()`);
      await execute(`window.termaConnectionMenu.open(__connectionMenuEvent,9701)`);await click('#actionMenu [data-terminal-display-action="create-remote"]');await checkMenu(prefix+'-row-create-remote');
      await execute(`hideActionMenu();window.termaConnectionMenu.open(__connectionMenuEvent,9701)`);await click('#actionMenu [data-terminal-display-action="x11"]');
      await click(`${width<=760?'#actionMenu':'#actionSubMenu'} [data-terminal-display-action="default-trusted"]`);await checkMenu(prefix+'-row-x11-scope');
      await menuCheck(prefix+' nested X11 reuses typed scope items',`JSON.stringify([...document.querySelectorAll((innerWidth<=760?'#actionMenu':'#actionSubMenu')+' [data-terminal-display-action]')].map(e=>e.dataset.terminalDisplayAction))==='["current-terminal","new-terminal","next-start"]'`);
      if(width<=760){
        await click('#actionMenu [data-terminal-menu-back]');await menuCheck(prefix+' first back returns to X11',`!!document.querySelector('#actionMenu [data-terminal-display-action="default-trusted"]')`);
        await click('#actionMenu [data-terminal-menu-back]');await menuCheck(prefix+' second back returns to row',`!!document.querySelector('#actionMenu [data-terminal-display-action="sftp"]')&&!document.querySelector('#actionMenu [data-terminal-menu-back]')`);
      }
      for(const [key,owner] of [['sftp','sftp'],['health','health'],['duplicate','duplicate'],['edit','edit'],['delete','remove']]){
        await execute(`hideActionMenu();window.termaConnectionMenu.open(__connectionMenuEvent,9701);selectedId=9702;`);
        await click(`#actionMenu [data-terminal-display-action="${key}"]`);
        await menuCheck(prefix+' '+key+' dispatch keeps the opened row',`JSON.stringify(__connectionMenuCalls.at(-1))===${JSON.stringify(JSON.stringify([owner,9701]))}&&!termaTerminalActionMenu.active()`);
      }
      await execute(`window.__restoreConnectionMenu();selectedId=9701;`);
      await checkDashboard(prefix);
      await execute(`if(isMobileLayout())window.termaWorkspaceShell.showMobileExplorer()`);
      await checkHealth(prefix);
      await click('#explorerTools [data-action="workspace-connection-bulk"]');
      await menuCheck(prefix+' empty bulk selection disables row actions', `$('connectionBulkEditBtn').disabled&&$('connectionBulkDeleteBtn').disabled&&!$('connectionSelectAll').checked&&!$('connectionSelectAll').indeterminate`);
      await click('input[data-change-action="connection-select"][data-connection-id="9701"]');
      await menuCheck(prefix+' selecting one row shows the mixed state', `(()=>{const e=$('connectionSelectAll');return e.indeterminate&&!e.checked&&getComputedStyle(e,'::before').clipPath.startsWith('inset(')&&!$('connectionBulkEditBtn').disabled&&$('connectionBulkCount').textContent===tr('connections:groups.selected_count',{count:1});})()`);
      await shot(prefix+'-bulk-mixed');
      await click('#connectionSelectAll');
      await menuCheck(prefix+' selecting all marks both rows', `$('connectionSelectAll').checked&&!$('connectionSelectAll').indeterminate&&selectedConnectionIds.has(9701)&&selectedConnectionIds.has(9702)`);
      await click('input[data-change-action="connection-select"][data-connection-id="9702"]');
      await click('#connectionBulkEditBtn');
      await check(prefix+'-bulk-settings','#modal');
      await menuCheck(prefix+' bulk credentials initially disabled', `$('bulkAuthType').disabled&&$('bulkPassword').disabled&&$('bulkIdentity').disabled`);
      await click('#bulkSetPort');
      await menuCheck(prefix+' enabling port focuses the number field', `!$('bulkPort').disabled&&document.activeElement===$('bulkPort')`);
      await execute(`$('bulkPort').value='2244'`);
      await click('#bulkSetAuth');
      await menuCheck(prefix+' password enables only the password field', `!$('bulkPassword').disabled&&$('bulkIdentity').disabled&&$('bulkIdentity').hidden&&$('bulkPassword').checkVisibility()`);
      await execute(`$('bulkPassword').value='fixture-only'`);
      await execute(`$('bulkAuthType').value='key';$('bulkAuthType').dispatchEvent(new Event('change',{bubbles:true}))`);
      await settle();
      await execute(`$('bulkIdentity').value='C:/fixture/id_ed25519';$('bulkIdentity').focus()`);
      await check(prefix+'-bulk-key','#modal');
      await menuCheck(prefix+' bulk language retains key choice and enabled fields', `$('bulkAuthType').value==='key'&&$('bulkIdentity').value==='C:/fixture/id_ed25519'&&document.activeElement===$('bulkIdentity')&&!$('bulkIdentity').disabled&&$('bulkPassword').disabled&&!$('bulkPassword').checkVisibility()&&$('bulkPort').value==='2244'`);
      await click('#modal [data-action="connection-modal-close"]');
      await click('#connectionBulkEditBtn');
      await menuCheck(prefix+' closing and reopening bulk settings clears its draft', `!$('bulkSetAuth').checked&&$('bulkPassword').value===''&&$('bulkPort').value==='22'`);
      await click('#modal [data-action="connection-modal-close"]');
      await click('#connectionBulkDeleteBtn');await check(prefix+'-bulk-delete-confirm','#modal');
      await click('#modal [data-action="connection-modal-close"]');
      await click('#explorerTools [data-action="workspace-connection-bulk"]');
      await click('[data-action="workspace-connection-new"]');await delay(80);await check(prefix+'-new-ssh-key','#view-edit');
      await execute(`(()=>{const group=$('conn_group');group.value='Fixture group';group.dispatchEvent(new Event('change',{bubbles:true}));group.value='__new_group__';group.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await menuCheck(prefix+' group creation preserves the current choice before cancel',`!$('modal').hidden&&$('conn_group').value==='Fixture group'`);
      await click('#modal [data-action="connection-modal-close"]');
      await menuCheck(prefix+' canceling group creation preserves the form choice',`$('modal').hidden&&$('conn_group').value==='Fixture group'`);
      await execute(`window.__groupBeforeSave=pendingGroup;$('conn_group').value='__new_group__';$('conn_group').dispatchEvent(new Event('change',{bubbles:true}));`);
      await click('#modal [data-action="connection-group-save"]');
      await menuCheck(prefix+' cannot save an empty group',`!$('modal').hidden&&$('conn_group').value==='Fixture group'`);
      await execute(`$('modalGroupName').value='  Fixture new group  ';void 0;`);
      await check(prefix+'-ssh-new-group','#modal');
      await click('#modal [data-action="connection-group-save"]');
      await menuCheck(prefix+' saving a group selects and expands the trimmed name',`$('modal').hidden&&$('conn_group').value==='Fixture new group'&&groupOpen.has('Fixture new group')`);
      await execute(`pendingGroup=window.__groupBeforeSave;groupOpen.delete('Fixture new group');saveGroupState();$('conn_group').value='Fixture group';$('conn_group').dispatchEvent(new Event('change',{bubbles:true}));`);
      await execute(`$('conn_name').value='unsaved-name';$('conn_key').value='C:/fixture/id_ed25519';$('conn_key_passphrase').value='fixture-key-passphrase';$('conn_auth_type').value='password';$('conn_auth_type').dispatchEvent(new Event('change',{bubbles:true}));$('conn_password').value='fixture-only'`);
      await menuCheck(prefix+' auth change disables inactive credentials',`$('keyAuthBox').hidden&&$('conn_key').disabled&&$('conn_key_passphrase').disabled&&!$('passwordAuthBox').hidden&&!$('conn_password').disabled&&$('conn_x11_mode').title===tr('connections:form.x11_password_hint')`);
      await click('#passwordAuthBox .password-visibility-toggle');await check(prefix+'-new-ssh-password','#view-edit');
      await execute(`$('connAdvancedOptions').open=true;$('conn_extra').value='-o Compression=yes'`);await check(prefix+'-new-ssh-advanced','#view-edit');
      await checkAdvancedDiagnostics(prefix,language);
      await click('#connTestBtn');
      await execute(`for(let i=0;i<60&&!$('connTerminalDetectionStatus').classList.contains('success');i++)await new Promise(r=>setTimeout(r,35));$('connTerminalDetectionStatus').scrollIntoView({block:'center'});`);
      await menuCheck(prefix+' pointer test renders visible startup detection',`(()=>{const status=$('connTerminalDetectionStatus'),r=status.getBoundingClientRect();return status.classList.contains('success')&&status.textContent.includes('Bash')&&r.top>=0&&r.bottom<=innerHeight&&status.contains(document.elementFromPoint(Math.floor(r.x+r.width/2),Math.floor(r.y+r.height/2)));})()`);
      await shot(prefix+'-ssh-detection-visible');
      await check(prefix+'-ssh-detected','#view-edit');
      await menuCheck(prefix+' SSH testing submits the selected group and only active credentials',`__testFormFlags.passwordOnly&&__testFormFlags.group==='Fixture group'`);
      await execute(`$('conn_port').value='2222';$('conn_keepalive_interval').value='8';$('connectionForm').dataset.remoteProfileLinkId='91';$('connectionForm').dataset.identityFileStatus='unsafe';void 0`);
      await click('#view-edit [data-action="static-connection-reset"]');
      await menuCheck(prefix+' Clear restores defaults and drops stale association and credentials',`$('conn_port').value==='22'&&$('conn_keepalive_interval').value==='60'&&$('conn_auth_type').value==='key'&&$('conn_password').value===''&&$('conn_key_passphrase').value===''&&!$('connAdvancedOptions').open&&$('connTestStatus').hidden&&$('connTerminalDetectionStatus').classList.contains('muted')&&!$('connectionForm').dataset.remoteProfileLinkId&&!$('connectionForm').dataset.identityFileStatus`);
      await execute(`$('conn_name').scrollIntoView({block:'center'});void 0`);
      await check(prefix+'-ssh-cleared','#view-edit');
      await execute(`Object.assign(__connectionFixture[0],{has_private_key_passphrase:true,keepalive_interval_seconds:'0',tcp_keepalive:0,tags:'saved-tag',extra_args:'-o Compression=yes',jump_connection_id:9702});window.termaConnectionMenu.open(__connectionMenuEvent,9701);`);
      await click('#actionMenu [data-terminal-display-action="edit"]');
      await execute(`$('connAdvancedOptions').open=true;`);
      assert.equal(await execute(`$('conn_id').value==='9701'&&$('conn_name').value==='Fixture Alpha'&&$('conn_group').value==='Fixture group'&&$('conn_host').value==='alpha.example'&&$('conn_keepalive_interval').value==='0'&&$('conn_tcp_keepalive').value==='0'&&$('conn_jump').value==='9702'&&$('conn_tags').value==='saved-tag'&&$('conn_extra').value==='-o Compression=yes'&&$('conn_password').value===''&&$('conn_key_passphrase').value===''&&!$('connClearPassphraseLine').hidden&&!$('conn_clear_key_passphrase').checked&&$('connRemoteGenerationLine').hidden`),true,prefix+' saved edit hydrates legacy values without refilling secrets');
      await check(prefix+'-edit-ssh-hydrated','#view-edit');
      await menuCheck(prefix+' the newest key request owns the attached select',`(async()=>{
        const original=api, pending=[], select=$('conn_key');
        api=(url,options)=>url==='/api/identity-files'&&(!options?.method||options.method==='GET')?new Promise(resolve=>pending.push(resolve)):original(url,options);
        try {
          const first=window.termaConnectionFormActions.refreshKeys(select.form,'old-key'), second=window.termaConnectionFormActions.refreshKeys(select.form,'new-key');
          pending[1]([{path:'new-key',name:'Fixture newer key'}]);await second;
          pending[0]([{path:'old-key',name:'Fixture older key'}]);await first;
          return select.value==='new-key'&&!select.querySelector('[value="old-key"]');
        } finally {api=original;}
      })()`);
      await execute(`await window.termaConnectionFormActions.refreshKeys($('connectionForm'),'C:/fixture/id_ed25519');window.__identityReadsBeforeLanguage=__identityReads;`);
      for (const next of [language==='en-US'?'zh-CN':'en-US',language]) {
        await execute(`await setTermaLanguage('${next}')`);
        await settle();
        await menuCheck(prefix+' '+next+' managed key remains selected and labels update without fetching',`(()=>{
          const select=$('conn_key'),selected=select.selectedOptions[0];
          return selected?.value==='C:/fixture/id_ed25519'&&selected.textContent===localizedIdentityFileLabel({name:'id_ed25519',source:'project',permission_ok:false},{permission:true})&&
            select.querySelector('option[value=""]').textContent===tr('connections:auto.no_private_key')&&__identityReads===__identityReadsBeforeLanguage;
        })()`);
      }
      await execute(`const form=$('connectionForm');form.dataset.identityFileStatus='unsafe';await window.termaConnectionFormActions.refreshKeys(form,'C:/fixture/unmanaged');window.__identityReadsBeforeLanguage=__identityReads;`);
      for (const next of [language==='en-US'?'zh-CN':'en-US',language]) {
        await execute(`await setTermaLanguage('${next}')`);
        await settle();
        await menuCheck(prefix+' '+next+' unsafe key warning stays selected despite sharing an empty value',`(()=>{
          const select=$('conn_key'),selected=select.selectedOptions[0];
          return selected?.disabled&&selected.dataset.legacyUnsafe==='1'&&selected.textContent===tr('connections:identity.legacy_invalid')&&
            $('keyStatus').textContent===tr('connections:identity.unsafe_fallback')&&__identityReads===__identityReadsBeforeLanguage;
        })()`);
      }
      await execute(`$('conn_key').scrollIntoView({block:'center'})`);
      await shot(prefix+'-edit-ssh-key-language');
      await execute(`$('conn_key_passphrase').value='draft-only';$('conn_clear_key_passphrase').checked=true;window.termaConnectionFormWorkspace.edit(9702);`);
      assert.equal(await execute(`$('conn_id').value==='9702'&&$('conn_name').value==='Fixture Beta'&&$('conn_auth_type').value==='password'&&$('conn_keepalive_interval').value==='60'&&$('conn_tcp_keepalive').value==='1'&&$('conn_password').value===''&&$('conn_key_passphrase').value===''&&$('connClearPassphraseLine').hidden&&!$('conn_clear_key_passphrase').checked`),true,prefix+' switching saved edits isolates credential fields and uses legacy defaults');
      await execute(`activateTab('edit-9701')`);
      assert.equal(await execute(`activeTabKey==='edit-9701'&&$('conn_id').value==='9701'&&$('conn_host').value==='alpha.example'&&$('conn_key_passphrase').value===''&&!$('conn_clear_key_passphrase').checked`),true,prefix+' workspace restores the correct saved edit');
      await execute(`window.termaConnectionFormWorkspace.edit(9701);$('conn_name').value='unsaved-edit';$('connAdvancedOptions').open=true`);await delay(70);await check(prefix+'-edit-ssh','#view-edit');
      assert.equal(await execute(`$('connPrimarySave').dataset.saveAction==='close'&&$('connSaveAndConnect').dataset.closeAfterSave==='1'&&$('connSaveAndClear').hidden&&$('connPrimarySave').textContent.trim()===tr('connections:auto.save_close')`),true,prefix+' editing actions retained');
      for(const [index,protocol] of ['rdp','vnc','xdmcp','ftp','telnet','serial'].entries()){
        const id=9800+index;
        await execute(`setWorkspace('Fixture ${protocol.toUpperCase()}','Fixture group','edit','remote-form-ui-smoke',true,true,{kind:'remote-edit',id:0,protocol:${JSON.stringify(protocol)}});window.termaRemoteProfiles.editor.render({protocol:${JSON.stringify(protocol)},name:'',group_name:'Fixture group',host:${JSON.stringify(protocol==='serial'?'':'remote.example.test')},options:${JSON.stringify(protocol==='vnc'?{client_mode:'bundled',display_mode:'scale',quality:8}:protocol==='xdmcp'?{window_mode:'fixed',width:1920,height:1080}:{})}});`);
        await delay(80);
        if(protocol==='rdp'){
          await execute(`$('remote_rdp_display_mode').value='fixed';$('remote_rdp_display_mode').dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));$('remote_rdp_resolution_preset').value='1920x1080';$('remote_rdp_resolution_preset').dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));`);
          assert.equal(await execute(`!$('remote_rdp_resolution_options').hidden&&$('remote_rdp_width').value==='1920'&&$('remote_rdp_height').value==='1080'`),true,prefix+' RDP fixed resolution interaction');
          await execute(`$('remote_group').value='__new_group__';$('remote_group').dispatchEvent(new Event('change',{bubbles:true}))`);await check(prefix+'-remote-new-group','#modal');await execute('closeModal();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
          assert.equal(await execute(`$('remote_group').value`),'Fixture group',prefix+' canceling new protocol group restores the selected group');
        }else if(protocol==='vnc'){
          await execute(`$('remote_vnc_performance_preset').value='smooth';$('remote_vnc_performance_preset').dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));`);
          assert.equal(await execute(`$('remote_quality').value==='6'&&$('remote_vnc_auto_sync_images').disabled`),true,prefix+' VNC quality preset and bundled clipboard behavior');
        }else if(protocol==='xdmcp'){
          assert.equal(await execute(`!$('remote_xdmcp_resolution_options').hidden`),true,prefix+' XDMCP fixed resolution fields');
        }else if(protocol==='serial'){
          await execute(`await document.getElementById('remoteProfileForm')?.remoteScan?.()`);
          assert.equal(await execute(`$('remoteSerialPorts').options[0]?.value==='COM7'&&$('remoteNetworkFields').hidden`),true,prefix+' serial port discovery and network fields');
        }
        await check(`${prefix}-remote-${protocol}`,'#view-edit');
      }
      await execute(`window.termaRemoteProfiles.editor.render({protocol:'rdp',name:'',group_name:'Fixture group',host:'',options:{}});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));$('remote_name').value='draft survives protocol changes';$('remote_name').dispatchEvent(new Event('input',{bubbles:true}));$('remote_host').value='preserved.example.test';$('remote_host').dispatchEvent(new Event('input',{bubbles:true}));$('remote_protocol').value='vnc';$('remote_protocol').dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));`);
      assert.deepEqual(await execute(`[$('remote_name').value,$('remote_host').value,$('remote_protocol').value,$('remote_vnc_client_mode').value]`),['draft survives protocol changes','preserved.example.test','vnc','embedded'],prefix+' Vue preserves unsaved common draft when switching protocol');
      await execute(`$('remote_protocol').value='serial';$('remote_protocol').dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));`);
      assert.deepEqual(await execute(`[$('remote_name').value,$('remote_host').value,$('remote_protocol').value,$('remoteNetworkFields').hidden]`),['draft survives protocol changes','preserved.example.test','serial',true],prefix+' serial mode preserves draft and hides network fields');
      await execute(`$('remote_protocol').value='rdp';$('remote_protocol').dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));`);
      assert.deepEqual(await execute(`[$('remote_name').value,$('remote_host').value,$('remote_protocol').value,$('remote_port').value]`),['draft survives protocol changes','preserved.example.test','rdp','3389'],prefix+' return to protocol retains draft and sets default port');
      await check(prefix+'-remote-protocol-switch','#view-edit');
      await execute(`setWorkspace('Saved RDP fixture · Edit','Fixture group','edit','remote-edit-9809',true,true,{kind:'remote-edit',id:9809,protocol:'rdp'});window.termaRemoteProfiles.editor.render({id:9809,protocol:'rdp',name:'Saved RDP fixture',group_name:'Fixture group',host:'rdp.example.test',port:3389,username:'review-user',has_password:true,options:{display_mode:'dynamic',allow_password_transfer:true}})`);
      assert.equal(await execute(`(()=>{const tab=tabs.find(value=>value.key===activeTabKey);const node=[...document.querySelectorAll('.tab[data-tab-key],.mobile-workspace-tab-main[data-tab-key]')].find(value=>value.dataset.tabKey===activeTabKey);const title=node?.querySelector('.tab-title,.mobile-workspace-tab-title');return tab?.kind==='remote-edit'&&Number(tab.id)===9809&&tab.protocol==='rdp'&&title?.textContent.trim()==='Saved RDP fixture · '+tr('common:actions.edit');})()`),true,prefix+' saved remote edit screenshot uses the active RDP tab');
      await check(prefix+'-remote-edit-password','#view-edit');
      await execute(`await window.termaSftpWorkflow.automation.manager();window.termaSftpWorkflow.automation.edit()`);await check(prefix+'-web-sync-form','#modal');
      assert.equal(await execute(`$('sftpAutomationLocal').value`),'C:/fixture/host',prefix+' uses Terma host directory');
      // Directory picker coverage moved with the M6 automation view; keep
      // this connection matrix focused on the host-path handoff and let the
      // dedicated automation scenario own the picker DOM/actions.
      await execute(`closeModal();window.termaWorkspaceShell.showPrimary('connections');if(isMobileLayout())window.termaWorkspaceShell.showMobileExplorer()`);
      const hover=await execute(`(()=>{const b=document.querySelector(isMobileLayout()?'.mobile-tabs button.active':'.activity button.active');const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),background:getComputedStyle(b).backgroundColor,color:getComputedStyle(b).color};})()`);
      browser.webContents.sendInputEvent({type:'mouseMove',x:hover.x,y:hover.y});await delay(150);
      const after=await execute(`(()=>{const b=document.querySelector(isMobileLayout()?'.mobile-tabs button.active':'.activity button.active');return {background:getComputedStyle(b).backgroundColor,color:getComputedStyle(b).color,shadow:getComputedStyle(b).boxShadow,hover:b.matches(':hover')};})()`);
      assert.equal(after.hover,true,prefix+' real hover');assert.equal(after.background,hover.background,prefix+' selected background stable');assert.equal(after.color,hover.color,prefix+' selected color stable');assert.equal(after.shadow,'none',prefix+' no hover halo');await check(prefix+'-selected-hover','#connectionGroups');
      browser.webContents.focus();await execute(`document.getElementById('connectionSearch').focus()`);browser.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});browser.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await delay(130);
      const focus=await execute(`(()=>{const e=document.activeElement,s=getComputedStyle(e);return {tag:e.tagName,id:e.id,visible:e.matches(':focus-visible'),outline:s.outlineWidth,style:s.outlineStyle,shadow:s.boxShadow}})()`);
      assert.deepEqual([focus.tag,focus.visible,focus.outline,focus.style,focus.shadow],['BUTTON',true,'2px','solid','none'],prefix+' keyboard focus remains visible '+JSON.stringify(focus));await capture(prefix+'-keyboard-focus','#connectionGroups');
    }
    assert.deepEqual(await execute('window.__connectionWrites'),[],'fixture does not mutate user resources');
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(reports,null,2));
    fs.writeFileSync(path.join(directory,'menu-report.json'),JSON.stringify({checks:menuChecks},null,2));
    console.log('Connection browser checks passed: '+reports.length+' states and '+menuChecks.length+' menu assertions.');return {states:reports.length,directory};
  }catch(error){await shot('failure');throw error;}
  finally{await execute('closeModal();hideActionMenu();if(window.__connectionMenuSaved)window.__restoreConnectionMenu();api=window.__connectionApi;connections=window.__connectionOriginal;window.termaDesktop=window.__connectionDesktop');}
}
module.exports={runConnectionsUiScenario};
