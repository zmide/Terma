const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runHeaderUiScenario } = require('./header-ui-scenario');
const { runTaskUiScenario } = require('./task-ui-scenario');

async function runQuickUiScenario(browser, {includeSharedScenarios=true} = {}) {
  const directory = process.env.TERMA_QUICK_VISUAL_DIR || path.join(process.cwd(), 'data', 'quick-visual');
  fs.mkdirSync(directory, { recursive: true });
  const execute = source => browser.webContents.executeJavaScript(
    /\bawait\b/.test(source) && !/^\s*\(async/.test(source) ? `(async()=>{${source}})()` : source
  );
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const capture = async (name, selector) => {
    await execute(`(()=>{const elements=['toast','notice','sftpTaskFloat'].map(id=>document.getElementById(id)).filter(Boolean);window.__quickCaptureVisibility=elements.map(element=>({element,visibility:element.style.visibility}));for(const element of elements)if(element.id!=='sftpTaskFloat'||!${JSON.stringify(name)}.endsWith('-task-float'))element.style.visibility='hidden';})()`);
    const shot = async suffix => {
      await execute(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      await delay(140);
      browser.webContents.invalidate();
      fs.writeFileSync(path.join(directory, name + suffix + '.png'), (await browser.webContents.capturePage()).toPNG());
    };
    try {
      await shot('');
      const count = await execute(`(()=>{const root=document.querySelector(${JSON.stringify(selector)});window.__quickScreenshotScrollRoots=[root,...root.querySelectorAll('*')].filter(element=>element.checkVisibility()&&element.clientHeight>80&&element.scrollHeight>element.clientHeight+24&&['auto','scroll'].includes(getComputedStyle(element).overflowY)).map(element=>({element,top:element.scrollTop}));return window.__quickScreenshotScrollRoots.length;})()`);
      for (let index = 0; index < count; index++) {
        const positions = await execute(`(()=>{const element=window.__quickScreenshotScrollRoots[${index}].element;const max=element.scrollHeight-element.clientHeight;const positions=[];for(let top=0;top<max;top+=Math.max(80,Math.floor(element.clientHeight*.8)))positions.push(top);positions.push(max);return positions;})()`);
        for (let part = 0; part < positions.length; part++) {
          await execute(`window.__quickScreenshotScrollRoots[${index}].element.scrollTop=${positions[part]}`);
          await shot('-scroll-' + index + '-' + part);
        }
        await execute(`(()=>{const item=window.__quickScreenshotScrollRoots[${index}];item.element.scrollTop=item.top;})()`);
      }
    } finally {
      await execute(`(()=>{for(const item of window.__quickCaptureVisibility||[])item.element.style.visibility=item.visibility;for(const item of window.__quickScreenshotScrollRoots||[])item.element.scrollTop=item.top;delete window.__quickCaptureVisibility;delete window.__quickScreenshotScrollRoots;})()`);
    }
  };
  const click = async selector => {
    const point = await execute(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('Missing control '+${JSON.stringify(selector)});element.scrollIntoView({block:'nearest'});const r=element.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) { browser.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 }); await delay(20); }
    await delay(70);
  };
  await execute(`(async()=>{
    await window.termaI18nReady;
    await window.termaWorkspaceRefresh.stop();window.termaSftpTransferLifecycle.polling.stop();
    const pendingDeadline=Date.now()+5000;
    while(window.termaWorkspaceRefresh.loading&&Date.now()<pendingDeadline)await new Promise(resolve=>setTimeout(resolve,25));
    if(window.termaWorkspaceRefresh.loading)throw Error('Fixture refresh did not settle');
    window.__quickOriginalApi=api;window.__quickOriginalConnections=connections;window.__quickOriginalRuntimeSettings=window.termaRuntimeSettingsModel.snapshot;window.__quickOriginalDismissedJobs=new Set(window.termaSftpTaskWorkspace.state.dismissed);window.__quickOriginalJobs=window.termaSftpTaskWorkspace.state.jobs;
    window.__quickOriginalDesktop=window.termaDesktop;
    window.__quickWrites=[]; window.__quickX={platform:'win32',available:true,running:true,installed:true,mode:'bundled',server:'Fixture X Server',display:':0',can_stop:true,integration_available:true,authorization_kind:'local-direct'};
    window.__quickConnections=[{id:9001,name:'Fixture Alpha',group_name:'default',ssh_user:'review',ssh_host:'alpha.example',ssh_port:22,auth_type:'key',forwards:[{id:9901,mode:'local',status:'running',service_name:'Fixture HTTP',bind_host:'2001:db8::1',bind_port:18888,target_host:'2001:db8::2',target_port:8080,service_type:'http',url_path:'/review'}]},{id:9002,name:'Fixture Beta',group_name:'default',ssh_user:'review',ssh_host:'beta.example',ssh_port:2222,auth_type:'key',forwards:[]}];
    window.__quickAutomations=[{id:9101,name:'Fixture sync',connection_id:9001,connection_name:'Fixture Alpha',kind:'sync',trigger_mode:'continuous',direction:'bidirectional',local_path:'C:/fixture/project',remote_path:'/srv/fixture',enabled:true,last_status:'done',schedule:{frequency:'weekly',weekdays:[1,3],interval:1},options:{compare_content:true,conflict:'rename'}},{id:9102,name:'Fixture backup',connection_id:9002,connection_name:'Fixture Beta',kind:'transfer',direction:'download',local_path:'C:/fixture/backup',remote_path:'/srv/backup',enabled:false,last_status:'paused',schedule:{frequency:'daily'},options:{}}];
    window.__quickRuns=[{id:9201,status:'done',reason:'manual',started_at:1780000000,finished_at:1780000012,summary:{transferred:1,skipped:1,details:[{action:'uploaded',path:'/srv/fixture/a.txt',bytes:1024},{action:'skipped',path:'/srv/fixture/b.txt',reason:'unchanged'}]}},{id:9202,status:'failed',reason:'schedule',started_at:1780000100,finished_at:1780000110,error:'Fixture error',summary:{failed:1,details:[{action:'failed',path:'/srv/fixture/c.txt',reason:'permission_denied'}]}}];
    window.__quickTransferJobs=[{id:'fixture-running',type:'upload',status:'running',connection_name:'Fixture Alpha',file_name:'running.txt',size:10000,transferred:4000,speed_bps:1024,resume_supported:true,can_pause:true,can_cancel:true},{id:'fixture-paused',type:'download',status:'paused',connection_name:'Fixture Beta',file_name:'paused.txt',size:10000,transferred:2000,resume_supported:true,can_resume:true,can_cancel:true},{id:'fixture-failed',type:'download',status:'failed',connection_name:'Fixture Alpha',file_name:'failed.txt',error:'Fixture error',can_resume:true},{id:'fixture-done',type:'download',status:'done',file_name:'done.txt',delivery_status:'saved',saved_path:'C:/fixture/done.txt',size:1000,transferred:1000}];
    connections=window.__quickConnections;window.termaDesktop={};window.termaRuntimeSettingsModel.snapshot={...window.termaRuntimeSettingsModel.snapshot,saved:{...window.termaRuntimeSettingsModel.snapshot?.saved,sftp_floating_progress_enabled:true}};
    api=async(route,options={})=>{
      if(route==='/api/connections')return window.__quickConnections;
      if(route==='/api/sftp/jobs')return window.__quickTransferJobs;
      if(route==='/api/linux-desktop/tasks'||route==='/api/remote-component/tasks')return [];
      if(route==='/api/identity-files')return [{path:'C:/fixture/id_ed25519',name:'id_ed25519',permission:{ok:true}}];
      if(route==='/api/sftp/automations')return window.__quickAutomations;
      if(/sftp\\/automations\\/\\d+\\/runs/.test(route))return {items:window.__quickRuns,total:2,page:1,total_pages:1,history_limit:300};
      if(route==='/api/sftp/automations/cron-preview')return {valid:true,next_runs:[Date.now()+60000,Date.now()+120000,Date.now()+180000]};
      if(route==='/api/xserver')return window.__quickX;
      if(route.includes('/x11-forwarding'))return {supported:true,platform:'linux',enabled:true,configured:true,sshd_config:'/etc/ssh/sshd_config',x11_forwarding:'yes',xauth_available:true};
      if(route.includes('/x11-clipboard/helper'))return {platform:'linux',installed:true,package_manager:'apt',guide:{steps:[],commands:[]}};
      if(route.includes('/x11-applications'))return {discovery:{platform:'linux',xauth_available:true,applications:[{id:'xterm',name:'xterm',command:'xterm',path:'/usr/bin/xterm',category:'terminal'}]},install_plan:{supported:true,package_manager:'apt',requires_password:false,online:{available:true,command:'apt install xauth xterm'},offline:{available:true,command:'apt install --no-download xauth xterm'},local_offline:{available:false,package_names:['xauth','xterm']},instructions:['Fixture installation instructions'],optional_commands:['apt install firefox']}};
      if(route.includes('/sftp?'))return {entries:[{name:'project',type:'dir'},{name:'archive',type:'dir'}]};
      if(route==='/api/test-ssh')return {ok:true,elapsed_ms:12,capabilities:{platform:'linux',platform_label:'Linux',default_shell:{label:'Bash',path:'/bin/bash'},profiles:[{label:'Bash',path:'/bin/bash',kind:'shell'}],tools:[]}};
      if(route==='/api/connections/9001/usage'&&options.method==='POST')return {ok:true};
      if(options.method&&options.method!=='GET'){window.__quickWrites.push(route);throw Error('Fixture blocked a host mutation');}
      return window.__quickOriginalApi(route,options);
    };
    localStorage.setItem('closedWorkspaceTabsV1',JSON.stringify([{key:'quick-review-session',kind:'terminal',id:9001,title:'Fixture session',viewName:'terminal',sessionMode:'persistent',persistentSessionId:'fixture-only',sessionBackend:'tmux',closable:true}]));
    window.termaSftpTaskWorkspace.state.jobs=window.__quickTransferJobs;
    window.termaConnectionViews.renderConnections();window.termaSftpTaskWorkspace.state.paint();
  })()`);
  const reports = [];
  const check = async (name, selector = '#modal', targetSelector = selector) => {
    const formState = () => execute(`(()=>{const root=document.querySelector(${JSON.stringify(selector)});return {fields:[...root.querySelectorAll('input,select,textarea')].map((element,index)=>({id:element.id||element.name+index,value:element.value,checked:element.type==='radio'||element.type==='checkbox'?element.checked:undefined})),details:[...root.querySelectorAll('details')].map(element=>element.open)};})()`);
    const saved = await formState();
    const language = await execute(`document.documentElement.lang`);
    for (const next of [language === 'en-US' ? 'zh-CN' : 'en-US', language]) {
      await execute(`(async()=>{await setTermaLanguage(${JSON.stringify(next)});await window.termaQuickLocalizationReady;})()`);
    }
    assert.deepEqual(await formState(), saved, name + ' live language switch retains the open view, fields and expansion');
    const result = await execute(`(async()=>{const root=document.querySelector(${JSON.stringify(selector)});if(!root||root.hidden)throw Error('View is hidden: '+${JSON.stringify(name)});const deadline=Date.now()+2400;let target;while(Date.now()<deadline){target=root.matches(${JSON.stringify(targetSelector)})?root:root.querySelector(${JSON.stringify(targetSelector)});if(target?.checkVisibility({checkOpacity:true}))break;await new Promise(resolve=>setTimeout(resolve,40));}const visible=Boolean(target?.checkVisibility({checkOpacity:true}));if(!visible)throw Error('Expected view content never became visible: '+${JSON.stringify(name)}+' ('+${JSON.stringify(targetSelector)}+')');await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const text=[];const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walker.nextNode())if(/[\\u3400-\\u9fff]/.test(walker.currentNode.textContent))text.push(walker.currentNode.textContent.trim());for(const element of [root,...root.querySelectorAll('*')])for(const attr of ['title','placeholder','aria-label'])if(/[\\u3400-\\u9fff]/.test(element.getAttribute(attr)||''))text.push(element.getAttribute(attr));const brand=document.querySelector('.terma-shell-root.brand h1')?.getBoundingClientRect();const pin=document.getElementById('operationPanePin')?.getBoundingClientRect();const pinOverlap=Boolean(brand&&pin&&brand.width&&pin.width&&brand.left<pin.right&&pin.left<brand.right&&brand.top<pin.bottom&&pin.top<brand.bottom);return {visible,target:${JSON.stringify(targetSelector)},han:[...new Set(text)],duplicateIds:[...document.querySelectorAll('[id]')].filter(el=>el.checkVisibility()).map(el=>el.id).filter((id,index,ids)=>ids.indexOf(id)!==index),overflow:document.documentElement.scrollWidth>innerWidth+1,pinOverlap,owned:root.closest('.terma-quick-root,.terma-operations-root')!==null||root.querySelector('.terma-quick-root,.terma-operations-root')!==null};})()`);
    assert.equal(result.visible, true, name + ' expected content visible');
    assert.equal(await execute(`document.querySelector(${JSON.stringify(selector)}).textContent.includes('[object Object]')`), false, name + ' component content is rendered');
    const overflowingCards = await execute(`[...document.querySelector(${JSON.stringify(selector)}).querySelectorAll('.modal-card')].filter(element=>element.scrollWidth>element.clientWidth+1).map(element=>({className:element.className,extra:element.scrollWidth-element.clientWidth,children:[...element.children].map(child=>{const box=child.getBoundingClientRect(),parent=element.getBoundingClientRect();return {tag:child.tagName,className:typeof child.className==='string'?child.className:'',id:child.id,left:Math.round(box.left-parent.left),right:Math.round(box.right-parent.right),width:Math.round(box.width),scroll:child.scrollWidth,client:child.clientWidth}})}))`);
    assert.deepEqual(overflowingCards, [], name + ' dialog content fits horizontally');
    assert.deepEqual(result.duplicateIds, [], name + ' duplicate IDs'); assert.equal(result.overflow, false, name + ' page overflow'); assert.equal(result.pinOverlap, false, name + ' pinned button overlaps the brand');
    if (/-quick-direct(?:-long)?$/.test(name)) {
      result.targetLayout = await execute(`(()=>{
        const table=document.querySelector('.quick-connection-table'),bounds=table.getBoundingClientRect();
        const rows=[...table.querySelectorAll('.quick-connection-target-row')].map(button=>{
          const box=button.getBoundingClientRect(),icon=button.querySelector('.quick-result-icon svg').getBoundingClientRect();
          const copy=button.children[1],title=copy.querySelector('strong'),detail=copy.querySelector('small');
          const titleRange=document.createRange();titleRange.selectNodeContents(title);
          const text=titleRange.getBoundingClientRect(),copyBox=copy.getBoundingClientRect();
          const end=button.lastElementChild.querySelector('svg').getBoundingClientRect();
          const point=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
          return {action:button.dataset.action,visible:button.checkVisibility()&&button.contains(point),
            fits:box.left>=bounds.left&&box.right<=bounds.right+1&&box.top>=0&&box.bottom<=innerHeight+1
              &&button.scrollWidth<=button.clientWidth+1&&copy.scrollWidth<=copy.clientWidth+1,
            iconInset:icon.left-box.left,textInset:text.left-box.left,
            textLeft:Math.abs(text.left-copyBox.left)<=1,
            separated:icon.right<text.left&&copyBox.right<=end.left,
            detailFits:detail.scrollWidth<=detail.clientWidth+1,
            endFits:end.right<=box.right-8};
        });
        return {noHorizontalScroll:table.scrollWidth<=table.clientWidth+1,rows};
      })()`);
      assert.equal(result.targetLayout.noHorizontalScroll, true, name + ' target list fits without horizontal scrolling');
      assert.equal(result.targetLayout.rows.length, 2, name + ' both target actions render');
      for (const row of result.targetLayout.rows) {
        for (const field of ['visible','fits','textLeft','separated','detailFits','endFits']) {
          assert.equal(row[field], true, name + ' ' + row.action + ' ' + field + ' ' + JSON.stringify(row));
        }
        assert.ok(row.iconInset>=12&&row.iconInset<=24, name + ' target icon stays in the left column');
        assert.ok(row.textInset>=50&&row.textInset<=60, name + ' target text starts after the icon column');
      }
    }
    if (/-automations(?:-hover)?$/.test(name)) {
      result.buttonContrast = await execute(`(()=>{
        const context=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
        const luminance=color=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);const rgb=[...context.getImageData(0,0,1,1).data].slice(0,3).map(value=>{const channel=value/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
        return [...document.querySelectorAll('.automation-row .automation-actions .primary')].filter(button=>button.checkVisibility()).map(button=>{const style=getComputedStyle(button),labelStyle=getComputedStyle(button.querySelector('span')),foreground=labelStyle.webkitTextFillColor||labelStyle.color,background=style.backgroundColor,fg=luminance(foreground),bg=luminance(background);return {label:button.textContent.trim(),foreground,background,ratio:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)};});
      })()`);
      assert.equal(result.buttonContrast.length, 2, name + ' both run buttons are visible');
      for (const button of result.buttonContrast) assert.ok(button.ratio >= 4.5, name + ' readable button contrast: ' + JSON.stringify(button));
    }
    if (await execute(`document.documentElement.lang==='en-US'`)) assert.deepEqual(result.han, [], name + ' untranslated text/attributes');
    if (await execute(`document.documentElement.lang==='en-US'`)) assert.equal(await execute(`/[\\u3400-\\u9fff]/.test(document.getElementById('view-welcome')?.textContent||'')`), false, name + ' background welcome translated');
    reports.push({ name, ...result }); await capture(name, selector);
  };
  const ownsDebugger = !browser.webContents.debugger.isAttached();
  if (ownsDebugger) browser.webContents.debugger.attach('1.3');
  await browser.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {enabled:true});
  try {
    for (const width of [1200, 390]) for (const theme of ['light', 'dark']) for (const language of ['zh-CN', 'en-US']) {
      browser.setContentSize(width, 844); await delay(70);
      await execute(`(async()=>{closeModal();window.termaEfficiency.palette.close();await setTermaLanguage('${language}');applyTheme('${theme}');if(isMobileLayout())window.termaWorkspaceShell.showMobileWorkspace();})()`);
      const prefix = `${language}-${theme}-${width}`;
      await execute(`await window.termaEfficiency.palette.open()`); await check(prefix + '-commands', '#quickPanel', '.quick-panel-dialog');
      await execute(`$('quickPanelInput').value='Fixture';window.termaEfficiency.palette.refresh('Fixture')`); await check(prefix + '-command-search', '#quickPanel', '.quick-panel-dialog');
      const url = 'http://[2001:db8::1]:18888/review';
      const endpoint = '[2001:db8::1]:18888 → [2001:db8::2]:8080';
      const paletteRow = await execute(`(()=>{
        const forward=window.__quickConnections[0].forwards[0];
        const query='Fixture HTTP';
        const field=$('quickPanelInput');field.value=query;
        const state=()=>{
          window.termaEfficiency.palette.refresh(query);
          const toggle=document.querySelector('#quickPanel [data-action="quick-forward-toggle"][data-forward-id="9901"]');
          const row=toggle?.closest('.quick-result');
          return {detail:row?.querySelector('.quick-result-copy small')?.textContent||'',url:row?.querySelector('a[href]')?.getAttribute('href')||'',label:toggle?.getAttribute('aria-label')||''};
        };
        try {
          const running=state();
          forward.status='reconnecting';
          const reconnecting=state();
          forward.status='stopped';
          const stopped=state();
          forward.mode='remote';
          forward.status='running';
          return {running,reconnecting,stopped,remote:state()};
        } finally {forward.mode='local';forward.status='running';window.termaEfficiency.palette.refresh(query);}
      })()`);
      assert.ok(paletteRow.running.detail.includes(endpoint), prefix + ' command palette displays the IPv6 rule');
      assert.equal(paletteRow.running.url, url, prefix + ' command palette displays the running local URL');
      assert.equal(paletteRow.reconnecting.label, paletteRow.running.label, prefix + ' reconnecting rule keeps the stop action');
      assert.notEqual(paletteRow.stopped.label, paletteRow.running.label, prefix + ' stopped rule displays the start action');
      for (const state of ['reconnecting', 'stopped', 'remote']) assert.equal(paletteRow[state].url, '', prefix + ' suppresses the URL for ' + state);
      await capture(prefix + '-commands-forward-running', '#quickPanel');
      await click('#quickPanel [data-action="quick-panel-forward-open"][data-forward-id="9901"]');
      assert.equal(await execute(`(() => {
        const rule = document.querySelector('#view-forwards .forward-rule-row.is-focused[data-forward-id="9901"]');
        return $('quickPanel').hidden && activeTabKey === 'forwards-9001' && Boolean(rule?.checkVisibility());
      })()`), true, prefix + ' command palette opens and focuses the matching forwarding rule');
      await capture(prefix + '-commands-forward-focused', '#view-forwards');
      await execute(`window.termaEfficiency.palette.close();window.termaQuickViews.openQuickConnectionLauncher()`); await check(prefix + '-quick-connections', '#modal', '.quick-connection-modal');
      const toggleSelector = '[data-action="quick-forward-toggle"][data-forward-id="9901"]';
      await execute(`(() => {
        const field=$('quickConnectionSearch');
        window.__quickForwardCommand=window.termaForwardActions.command;
        window.__quickForwardCalls=[];
        window.termaForwardActions.command=async(id,kind,connectionLevel,button)=>{
          window.__quickForwardCalls.push([id,kind,connectionLevel,button.dataset.forwardId]);
          window.__quickConnections[0].forwards[0].status='stopped';
          return true;
        };
        field.value='Fixture HTTP';
        field.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await delay(80);
      try {
        const quickRow = await execute(`(()=>{
          const row=document.querySelector('.quick-forward-row[data-forward-id="9901"]');
          const address=row.querySelector('.quick-forward-server small');
          const probe=document.createElement('span');
          probe.style.color='var(--tile-text-link)';
          address.append(probe);
          const linkColor=getComputedStyle(probe).color;
          probe.remove();
          return {endpoint:row.querySelector('.quick-connection-user').title,url:row.querySelector('a[href]').getAttribute('href'),addressColor:getComputedStyle(address).color,linkColor};
        })()`);
        assert.ok(quickRow.endpoint.includes(endpoint), prefix + ' quick connection displays the same IPv6 rule');
        assert.equal(quickRow.url, url, prefix + ' quick connection displays the same running URL');
        assert.equal(quickRow.addressColor, quickRow.linkColor, prefix + ' address uses the theme link color');
        await capture(prefix + '-quick-forward-running', '#modal');
        await click(toggleSelector);
        assert.deepEqual(await execute("window.__quickForwardCalls"), [[9901,'stop',false,'9901']], prefix + ' quick forward stops exactly one fixture rule');
        assert.equal(await execute(`document.querySelector(${JSON.stringify(toggleSelector)}).classList.contains('primary')`), true, prefix + ' refreshed forward action is start');
        await execute(`document.querySelector(${JSON.stringify(toggleSelector)}).scrollIntoView({block:'nearest',inline:'nearest'})`);
        await capture(prefix + '-quick-forward-toggled', '#modal');
      } finally {
        await execute(`window.termaForwardActions.command=window.__quickForwardCommand;window.__quickConnections[0].forwards[0].status='running'`);
      }
      await click('[data-action="quick-connect-forward"][data-forward-id="9901"]');
      assert.equal(await execute(`$('modal').hidden && Boolean($('view-forwards').querySelector('[data-forward-id="9901"].is-focused')?.checkVisibility())`), true, prefix + ' quick connect focuses the selected rule in its connection tab');
      await capture(prefix + '-quick-forward-focused', '#view-forwards');
      await execute(`window.termaQuickViews.openQuickConnectionLauncher()`);
      await execute(`(()=>{
        const table=document.querySelector('.quick-connection-table');table.scrollLeft=table.scrollWidth;
        $('quickConnectionSearch').value='review@direct.example:2222';
        $('quickConnectionSearch').dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      await delay(90);
      await check(prefix + '-quick-direct', '#modal', '.quick-connection-modal');
      const targetPoint = await execute(`(()=>{
        const rect=document.querySelector('[data-action="quick-connect-direct"]').getBoundingClientRect();
        return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)};
      })()`);
      browser.webContents.sendInputEvent({type:'mouseMove',...targetPoint});
      await delay(160);
      assert.equal(await execute(`document.querySelector('[data-action="quick-connect-direct"]').matches(':hover')`), true, prefix + ' target actual pointer hover');
      await capture(prefix + '-quick-direct-hover', '#modal');
      await execute(`$('quickConnectionSearch').focus()`);
      for (const type of ['keyDown','keyUp']) browser.webContents.sendInputEvent({type,keyCode:'Tab'});
      await delay(60);
      const keyboardFocus = await execute(`({
        action:document.activeElement.dataset.action,
        visible:document.activeElement.matches(':focus-visible'),
        documentFocused:document.hasFocus(),
        outlineOffset:getComputedStyle(document.activeElement).outlineOffset
      })`);
      assert.equal(keyboardFocus.action, 'quick-connect-direct', prefix + ' Tab reaches the first target ' + JSON.stringify(keyboardFocus));
      assert.equal(keyboardFocus.visible, true, prefix + ' target keyboard focus ' + JSON.stringify(keyboardFocus));
      const outlineOffset = Number.parseFloat(keyboardFocus.outlineOffset);
      assert.ok(Number.isFinite(outlineOffset) && outlineOffset <= -1.5 && outlineOffset >= -2.1,
        prefix + ' target focus outline stays inside the scroll container ' + JSON.stringify(keyboardFocus));
      await capture(prefix + '-quick-direct-focus', '#modal');
      await click('[data-action="quick-connect-direct"]'); await check(prefix + '-auth-password', '#modal', '.quick-ssh-auth-modal');
      await click('input[name="quickSshAuthType"][value="key"]'); await check(prefix + '-auth-key', '#modal', '.quick-ssh-auth-modal');
      await execute(`window.termaQuickViews.closeQuickSshAuthModal();window.termaQuickViews.openQuickConnectionLauncher();$('quickConnectionSearch').value='review@a-very-long-target-hostname-for-layout-checks.example:2222';$('quickConnectionSearch').dispatchEvent(new Event('input',{bubbles:true}));`);
      await delay(90);
      await check(prefix + '-quick-direct-long', '#modal', '.quick-connection-modal');
      await click('[data-action="quick-connect-new"]');
      assert.equal(await execute(`$('conn_host')?.value`), 'a-very-long-target-hostname-for-layout-checks.example', prefix + ' new target click fills the connection form');
      await execute(`window.termaQuickViews.closeQuickSshAuthModal();window.termaSessionEfficiency.open()`); await check(prefix + '-sessions', '#modal', '.terminal-session-manager');
      await execute(`closeModal();window.__quickManagerOpened=await window.termaX11.openManager(9001)`); await check(prefix + '-xserver', '#modal', '.xserver-manager');
      await execute(`window.termaX11.closeManager();window.termaX11.openLauncher(9001);await window.termaX11.launcher.detect()`); await check(prefix + '-x11-apps', '#modal', '.x11-app-launcher');
      assert.equal(await execute(`$('x11AppPreset').value`), 'xterm', prefix + ' detected X11 application');
      await execute(`window.termaX11.closeLauncher();await window.termaX11.openGuide(9001)`); await check(prefix + '-x11-install', '#modal', '.x11-install-guide');
      await click('.x11-install-guide [data-install-mode="manual"]'); await check(prefix + '-x11-manual', '#modal', '.remote-install-manual[open]');
      await execute(`window.termaX11.closeGuide();await window.termaSftpWorkflow.automation.manager()`); await check(prefix + '-automations', '#modal', '.sftp-automation-manager[data-sftp-automation-view="manager"]');
      const runPoint = await execute(`(()=>{const r=document.querySelector('.automation-row .automation-actions .primary').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
      browser.webContents.sendInputEvent({type:'mouseMove',...runPoint}); await delay(180);
      assert.equal(await execute(`document.querySelector('.automation-row .automation-actions .primary').matches(':hover')`), true, prefix + ' actual run button hover');
      await check(prefix + '-automations-hover', '#modal', '.sftp-automation-manager[data-sftp-automation-view="manager"]');
      await execute(`await window.termaSftpWorkflow.automation.edit(9101)`); await check(prefix + '-automation-form', '#modal', '#sftpAutomationForm');
      await execute(`window.termaSftpWorkflow.automation.actions().change('frequency','cron')`); await check(prefix + '-automation-cron', '#modal', '#sftpAutomationCron');
      await execute(`await window.termaSftpWorkflow.automation.actions().browse();window.termaSftpWorkflow.automation.actions().pickerEdit('create',true)`); await check(prefix + '-remote-picker', '#modal', '.automation-picker');
      await execute(`await window.termaSftpWorkflow.automation.history(9101)`); await check(prefix + '-automation-history', '#modal', '.automation-runs');
      await execute(`document.querySelector('.automation-run')?.setAttribute('open','')`);
      await check(prefix + '-automation-history-details', '#modal', '.automation-run[open]');
      await execute(`closeModal();window.termaSftpTaskWorkspace.state.view='current';await window.termaSftpTaskWorkspace.runtime.toggle()`); await check(prefix + '-tasks-current', '#sftpTaskCenter');
      await click('#sftpTaskCenterFailedTab'); await check(prefix + '-tasks-failed', '#sftpTaskCenter');
      await click('#sftpTaskCenterHistoryTab'); await check(prefix + '-tasks-history', '#sftpTaskCenter');
      await execute(`window.termaSftpTaskWorkspace.runtime.close();window.termaSftpTaskWorkspace.state.dismissed.clear();window.termaSftpTaskWorkspace.state.float()`); await check(prefix + '-task-float', '#sftpTaskFloat');
    }
    browser.setContentSize(1200, 844);
    await execute(`(async()=>{await setTermaLanguage('zh-CN');applyTheme('light');await window.termaQuickViews.startQuickSshConnection({host:'direct.example',port:22,user:'review'});$('quickSshPassword').value='fixture-secret-not-sent';$('quickSshUser').value='unsaved-user';await setTermaLanguage('en-US');})()`); await delay(180);
    assert.equal(await execute(`$('quickSshPassword').value==='fixture-secret-not-sent'&&$('quickSshUser').value==='unsaved-user'`), true, 'live translation retains auth draft'); await check('live-auth-en');
    await execute(`window.termaQuickViews.closeQuickSshAuthModal();window.termaWorkspaceShell.showPrimary('connections');window.termaConnectionFormWorkspace.create();$('connAdvancedOptions').open=true;$('conn_name').value='unsaved-name';await setTermaLanguage('zh-CN');await setTermaLanguage('en-US')`); await delay(90);
    await check('live-add-ssh-en', '#view-edit');
    assert.equal(await execute(`$('conn_name').value==='unsaved-name'`), true, 'SSH form draft retained');
    await execute(`await window.termaConnectionFormActions.test($('connectionForm'), $('connTestBtn'))`); await check('live-ssh-detected-en', '#view-edit');
    await execute(`await setTermaLanguage('zh-CN');await setTermaLanguage('en-US')`); await check('live-ssh-detected-again-en', '#view-edit');
    await execute(`setWorkspace('Fixture connected','review@alpha.example:22','terminal','fixture-connected',true,true,{kind:'terminal',id:9001,connectionStatus:'connected'})`);
    await check('connected-tab-indicator', '#tabs', '.tab-connection-dot.connected');
    assert.equal(await execute(`(()=>{const dot=document.querySelector('.tab-connection-dot.connected');const probe=document.createElement('span');probe.style.background='var(--tile-text-success)';dot.parentElement.append(probe);const green=getComputedStyle(probe).backgroundColor;const actual=getComputedStyle(dot).backgroundColor;probe.remove();return actual===green;})()`), true, 'connected tab indicator uses the green success color');
    await execute(`tabs.find(tab=>tab.key==='fixture-connected').connectionStatus='disconnected';await window.termaWorkspaceTabActions.requestClose(['fixture-connected'])`);
    assert.deepEqual(await execute(`window.__quickWrites`), [], 'review never changes host resources');
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(reports, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(directory, 'failure.png'), (await browser.webContents.capturePage()).toPNG());
    const state = await execute(`(()=>{const modal=$('modal'),manager=window.termaX11?.manager?.state;return {hidden:modal?.hidden,dataset:{...modal?.dataset},hasXServer:Boolean(modal?.querySelector('.xserver-manager')),opened:window.__quickManagerOpened,connectionIds:connections.map(item=>item.id),manager:manager?{connectionId:manager.connectionId,revision:manager.revision,opening:manager.opening,suspended:manager.suspended,kind:manager.kind,hasSnapshot:Boolean(manager.snapshot)}:null};})()`);
    fs.writeFileSync(path.join(directory, 'failure-state.json'), JSON.stringify({message:error.message,state,reports},null,2));
    throw error;
  } finally {
    await execute(`closeModal();window.termaEfficiency.palette.close();window.termaSftpTaskWorkspace.runtime.close();window.termaSftpTransferLifecycle.polling.stop();api=window.__quickOriginalApi;connections=window.__quickOriginalConnections;window.termaRuntimeSettingsModel.snapshot=window.__quickOriginalRuntimeSettings;window.termaSftpTaskWorkspace.state.dismissed.clear();for(const id of window.__quickOriginalDismissedJobs)window.termaSftpTaskWorkspace.state.dismissed.add(id);window.termaSftpTaskWorkspace.state.jobs=window.__quickOriginalJobs;window.termaSftpTaskWorkspace.state.paint();window.termaSftpTaskWorkspace.state.float();window.termaDesktop=window.__quickOriginalDesktop;window.termaQuickSshFlow.clearSecrets()`);
    if (ownsDebugger) browser.webContents.debugger.detach();
  }
  if (includeSharedScenarios) {
    await runTaskUiScenario(browser);
    await runHeaderUiScenario(browser);
  }
  return { views: reports.length, directory };
}
module.exports = { runQuickUiScenario };
