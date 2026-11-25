const assert = require('node:assert/strict');
const {terminalOwnershipStates}=require('./m7-transport-ui-states');

// Only transport endpoints are fixtures. The page, Vue views, xterm and pointer events are real.
async function runRemoteRuntimeUiScenario(browser, {execute,evaluate,wait,shot,click,assertions,transportOnly=false}) {
  await execute(`window.termaWorkspaceRefresh.stop();
    const notice=document.createElement('style');notice.textContent='.notification-toast-stack{display:none!important}';document.head.append(notice);
    window.__runtimeOriginalSocket=window.WebSocket;window.__runtimeSockets=[];
    window.WebSocket=class FixtureSocket {
      static OPEN=1;static CONNECTING=0;static CLOSING=2;static CLOSED=3;
      constructor(url,...args){if(!String(url).includes('/ws/remote-terminal'))return new window.__runtimeOriginalSocket(url,...args);this.url=String(url);this.readyState=0;this.sent=[];window.__runtimeSockets.push(this);}
      send(data){this.sent.push(data);}
      close(){this.readyState=3;setTimeout(()=>this.onclose?.({}),0);}
      open(){this.readyState=1;this.onopen?.({});}
    };
    window.__terminalProfiles=[{id:9792,name:'Fixture Telnet',protocol:'telnet',host:'terminal.example.test',port:23,group_name:'Fixture group',options:{}},{id:9793,name:'Fixture Serial',protocol:'serial',host:'',port:0,group_name:'Fixture group',options:{path:'COM-TEST',baud_rate:115200}}];
    remoteProfiles.push(...window.__terminalProfiles);
    window.__runtimeApi=api;window.__credentialRequests=[];window.__credentialReject=false;
    api=async(route,options={})=>{
      if(route==='/api/logs')return {system:[{label:'system-2026-10-19.log',path:'fixture-system.log',size_bytes:1024}],batch:[],connections:[{name:'Fixture server',logs:[],size_bytes:0}]};
      if(route==='/api/remote-profiles/9791/test-credentials'){
        const body=JSON.parse(options.body);window.__credentialRequests.push({kind:'test',username:body.username,port:body.port});
        await new Promise(r=>setTimeout(r,200));if(window.__credentialReject)throw Error('Fixture authentication rejected');return {ok:true};
      }
      if(route==='/api/remote-profiles/9791' && options.method==='PUT'){
        const body=JSON.parse(options.body);window.__credentialRequests.push({kind:'save',host:body.host,username:body.username,port:body.port});return {id:9791};
      }
      return window.__runtimeApi(route,options);
    };
  `);
  for(const width of [1200,390]) for(const theme of ['light','dark']) for(const language of ['zh-CN','en-US']) {
    const prefix=`${language}-${theme}-${width}`;
    browser.setContentSize(width,844);
    await execute(`closeModal();applyTheme('${theme}');await setTermaLanguage('${language}');window.termaWorkspaceShell.showPrimary('remote');window.termaRemoteTransport.terminal.open(9792,true,'remote-terminal-9792-fixture');`);
    await wait("window.termaRemoteTransport.terminal.sessions.get('remote-terminal-9792-fixture')?.socket");
    await shot(`${prefix}-terminal-connecting`);
    await execute("window.__fixtureTerm=window.termaRemoteTransport.terminal.sessions.get('remote-terminal-9792-fixture').term;window.termaRemoteTransport.terminal.sessions.get('remote-terminal-9792-fixture').socket.open();window.__fixtureTerm.write('Terma Telnet fixture\\r\\nreview@fixture:~$ ')");
    await wait("window.termaRemoteTransport.terminal.views.get('remote-terminal-9792-fixture')?.status==='connected'");
    await shot(`${prefix}-terminal-connected`);
    assert.equal(await evaluate("document.querySelector('#view-remote-terminal').classList.contains('terma-remote-root')&&document.querySelectorAll('#view-remote-terminal [data-remote-terminal-mount] .xterm').length===1"),true,`${prefix} has one actual xterm mount`);
    const result=await evaluate("({rootOverflow:document.querySelector('#view-remote-terminal').scrollWidth>document.querySelector('#view-remote-terminal').clientWidth+1,pageOverflow:document.documentElement.scrollWidth>innerWidth+1})");
    assert.equal(result.pageOverflow,false,`${prefix} terminal page fits viewport`);
    assert.equal(result.rootOverflow,false,`${prefix} terminal view fits viewport`);
    await execute("const input=document.querySelector('#view-remote-terminal [data-remote-terminal-input]');input.value='echo fixture';input.dispatchEvent(new Event('input',{bubbles:true}));window.__fixtureSocket=window.termaRemoteTransport.terminal.sessions.get('remote-terminal-9792-fixture').socket;await setTermaLanguage(document.documentElement.lang==='en-US'?'zh-CN':'en-US');");
    assert.equal(await evaluate("window.termaRemoteTransport.terminal.sessions.get('remote-terminal-9792-fixture').term===window.__fixtureTerm&&window.termaRemoteTransport.terminal.sessions.get('remote-terminal-9792-fixture').socket===window.__fixtureSocket&&document.querySelector('#view-remote-terminal [data-remote-terminal-input]').value==='echo fixture'"),true,`${prefix} locale preserves engine, socket and input`);
    await execute(`await setTermaLanguage('${language}');window.termaRemoteTransport.terminal.send('remote-terminal-9792-fixture')`);
    assert.equal(await evaluate("window.__fixtureSocket.sent.includes('echo fixture\\r')&&window.termaRemoteTransport.terminal.views.get('remote-terminal-9792-fixture').draft===''"),true,`${prefix} composer sends to its session`);
    await execute("window.__fixtureSocket.onerror?.({})");await shot(`${prefix}-terminal-error`);
    await execute("window.__fixtureSocket.close()");await wait("window.termaRemoteTransport.terminal.views.get('remote-terminal-9792-fixture')?.status==='disconnected'");await shot(`${prefix}-terminal-disconnected`);
    await click('#view-remote-terminal .terminal-actions button:first-child');
    await wait("window.termaRemoteTransport.terminal.sessions.get('remote-terminal-9792-fixture').socket!==window.__fixtureSocket");
    await execute("window.termaRemoteTransport.terminal.sessions.get('remote-terminal-9792-fixture').socket.open();window.termaRemoteTransport.terminal.open(9793,true,'remote-terminal-9793-fixture')");
    await wait("window.termaRemoteTransport.terminal.sessions.get('remote-terminal-9793-fixture')?.socket");
    await execute("window.termaRemoteTransport.terminal.sessions.get('remote-terminal-9793-fixture').socket.open()");
    await shot(`${prefix}-serial-connected`);
    assert.equal(await evaluate("document.querySelectorAll('#view-remote-terminal [data-remote-terminal-mount] .xterm').length===1&&document.querySelector('#view-remote-terminal [data-remote-terminal-status]').textContent.includes('COM-TEST')"),true,`${prefix} serial and telnet engines do not overlap`);
    await execute("window.termaRemoteTransport.terminal.sessions.get('remote-terminal-9792-fixture').socket.close()");
    await wait("window.termaRemoteTransport.terminal.views.get('remote-terminal-9792-fixture')?.status==='disconnected'");
    assert.equal(await evaluate("document.querySelector('#view-remote-terminal [data-remote-terminal-status]').textContent.includes('COM-TEST')"),true,`${prefix} hidden session status stays isolated`);
    if(language==='en-US')assert.equal(await evaluate("!/[\\u3400-\\u9fff]/.test([...document.querySelectorAll('#view-remote-terminal .terminal-toolbar,#view-remote-terminal .terminal-mobile-composer')].flatMap(root=>[root.textContent,...[...root.querySelectorAll('[title],[aria-label],input')].flatMap(node=>[node.title,node.getAttribute('aria-label'),node.placeholder])]).join(' '))"),true,`${prefix} runtime labels translate`);
    await execute("window.__serialEngine=window.termaRemoteTransport.terminal.sessions.get('remote-terminal-9793-fixture').term;window.__serialSocket=window.termaRemoteTransport.terminal.sessions.get('remote-terminal-9793-fixture').socket");
    await click('#view-remote-terminal .terminal-actions button:nth-child(2)');
    await wait("document.querySelector('#view-edit #remoteProfileForm')");
    await shot(`${prefix}-runtime-settings`);
    await execute('dismissToast()');
    await click(width===390?'#mobileWorkspaceTabs .mobile-workspace-tab-main[data-tab-key="remote-terminal-9793-fixture"]':'#tabs .tab[data-tab-key="remote-terminal-9793-fixture"]');
    await wait("activeTabKey==='remote-terminal-9793-fixture'&&document.querySelector('#view-remote-terminal')?.checkVisibility()&&document.querySelector('#view-remote-terminal [data-remote-terminal-mount] .xterm')");
    assert.equal(await evaluate("window.termaRemoteTransport.terminal.sessions.get('remote-terminal-9793-fixture').term===window.__serialEngine&&window.termaRemoteTransport.terminal.sessions.get('remote-terminal-9793-fixture').socket===window.__serialSocket"),true,`${prefix} connection settings preserve runtime`);
    await terminalOwnershipStates({prefix,language,execute,evaluate,wait,shot,click,assertions});
    await execute("window.termaRemoteTransport.releaseWorkspace('remote-terminal-9792-fixture');window.termaRemoteTransport.releaseWorkspace('remote-terminal-9793-fixture')");

    await execute("window.__credentialPromise=window.termaRemoteProfiles.prompt(window.__ftpFixture);void window.__credentialPromise.then(value=>{window.__credentialOutcome=value;})");
    await wait("document.querySelector('#remoteCredentialPassword')");await shot(`${prefix}-credential-dialog`);
    if(language==='zh-CN'&&theme==='light'&&width===1200) {
      await click('#remoteCredentialPassword');
      await wait("document.activeElement?.id==='remoteCredentialPassword'");
      await execute("const input=document.querySelector('#remoteCredentialPassword');input.value='fixture-only';input.dispatchEvent(new Event('input',{bubbles:true}));input.setSelectionRange(2,4);window.__credentialInput=input;await setTermaLanguage('en-US')");
      assert.deepEqual(await evaluate(`({
        sameNode: document.querySelector('#remoteCredentialPassword')===window.__credentialInput,
        sameDraft: window.__credentialInput.value==='fixture-only',
        focused: document.activeElement===window.__credentialInput,
        caret: window.__credentialInput.selectionStart===2 && window.__credentialInput.selectionEnd===4,
        translated: document.querySelector('#remoteCredentialRepairTitle')?.textContent==='Repair FTP authentication',
        passwordControl: document.querySelector('#modal .password-visibility-toggle')?.title==='Show password' &&
          document.querySelectorAll('#modal .password-visibility-toggle').length===1
      })`),{sameNode:true,sameDraft:true,focused:true,caret:true,translated:true,passwordControl:true},'open credential dialog keeps secret, focus and caret while translating');
      await shot('live-language-credential-en-US');await execute("await setTermaLanguage('zh-CN')");
    }
    await execute("for(const [id,value] of [['remoteCredentialUser','fixture-review'],['remoteCredentialPort','2121'],['remoteCredentialPassword','fixture-only']]){const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}window.__credentialReject=true;");
    await click('#remoteCredentialConnect');await shot(`${prefix}-credential-busy`);
    await wait("document.querySelector('#remoteCredentialStatus')?.classList.contains('error')");await shot(`${prefix}-credential-error`);
    assert.equal(await evaluate("!window.__credentialRequests.some(r=>r.kind==='save')"),true,`${prefix} failed verification cannot save credentials`);
    await execute("window.__credentialReject=false;");await click('#remoteCredentialConnect');
    await wait("document.querySelector('#modal').hidden");
    assert.equal(await evaluate("window.__credentialOutcome?.saved===true&&window.__credentialRequests.at(-1)?.host==='ftp.example.test'&&!document.querySelector('#remoteCredentialPassword')"),true,`${prefix} successful verification keeps target and clears password UI`);
    await execute("window.__credentialRequests=[];window.__credentialOutcome=null;window.__credentialPromise=window.termaRemoteProfiles.prompt(window.__ftpFixture);void window.__credentialPromise.then(value=>{window.__credentialOutcome=value===null?'cancelled':value;})");
    await wait("document.querySelector('#remoteCredentialPassword')");
    await execute("document.querySelector('#remoteCredentialPassword').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert.equal(await evaluate("document.querySelector('#modal').hidden&&!window.termaRemoteProfiles.busy()&&!document.querySelector('#remoteCredentialPassword')&&window.__credentialOutcome==='cancelled'"),true,`${prefix} cancellation releases credential input`);
    assertions.push({name:`${prefix}-terminal-credentials`,...result});
  }

  // Component loading failure and retry must preserve the runtime mount boundary.
  browser.setContentSize(1200,844);
  await execute("window.__ensureTerminal=window.termaTerminalLibraries.ensure;window.termaTerminalLibraries.ensure=async()=>{throw Error('Fixture terminal component unavailable')};window.termaWorkspaceShell.showPrimary('remote');window.termaRemoteTransport.terminal.open(9792,true,'remote-terminal-load-error')");
  await wait("window.termaRemoteTransport.terminal.views.get('remote-terminal-load-error')?.error");await shot('terminal-component-failure');
  await execute("window.termaTerminalLibraries.ensure=window.__ensureTerminal");await click('#view-remote-terminal .remote-terminal-error button');
  await wait("window.termaRemoteTransport.terminal.sessions.get('remote-terminal-load-error')?.socket");
  assert.equal(await evaluate("!window.termaRemoteTransport.terminal.views.get('remote-terminal-load-error').error"),true,'load-error Retry recovers component mount');
  await execute("window.termaRemoteTransport.releaseWorkspace('remote-terminal-load-error');window.WebSocket=window.__runtimeOriginalSocket");

  if(transportOnly)return;
  for(const width of [1200,390])for(const theme of ['light','dark'])for(const language of ['zh-CN','en-US']) {
    browser.setContentSize(width,844);
    await execute(`closeModal();applyTheme('${theme}');await setTermaLanguage('${language}');connections=[{id:9780,name:'Fixture server',ssh_host:'forward.example.test',ssh_user:'review',ssh_port:22,group_name:'Fixture group',forwards:[{id:9781,name:'Local forwarding',mode:'local',status:'running',bind_host:'127.0.0.1',bind_port:6006,target_host:'127.0.0.1',target_port:6868}]}];commandTemplates=[{id:9782,name:'Fixture command',command:'printf fixture\\nuname -a',description:'Fixture description'}];window.termaWorkspaceShell.showPrimary('connections');renderConnections();`);
    for(const [activity,listClass,textSelector] of [['Running','.running-overview','.conn-meta'],['Command','.template-list','.template-command-preview'],['Logs','.log-group','.count']]) {
      if(activity!=='Running') await execute("window.termaWorkspaceShell.showPrimary('connections');renderConnections()");
      await click(`#${width<761?'mobile':'nav'}${activity}`);
      await wait(`primaryView==='${activity.toLowerCase()==='running'?'running':activity.toLowerCase()==='command'?'command':'logs'}'&&document.querySelector('#connectionGroups ${listClass}')`);
      const result=await evaluate(`(()=>{const root=document.querySelector('#connectionGroups');const button=document.querySelector('#explorerTools .explorer-main-action');const svg=button.querySelector('svg');const b=button.getBoundingClientRect(),s=svg.getBoundingClientRect();const text=root.querySelector('${textSelector}');return {rootClean:!root.classList.contains('terma-vue-root')&&!root.hasAttribute('data-theme'),justify:getComputedStyle(button).justifyContent,iconInset:Math.round(s.left-b.left),color:text?getComputedStyle(text).color:'',muted:getComputedStyle(root).getPropertyValue('--muted').trim(),overflow:document.documentElement.scrollWidth>innerWidth+1}})()`);
      assert.equal(result.rootClean,true,`${activity} releases prior connection theme`);
      assert.equal(result.justify,'flex-start',`${activity} main action stays left aligned`);
      assert.ok(result.iconInset<20,`${activity} icon remains at left edge`);
      assert.equal(result.overflow,false,`${activity} page fits viewport`);
      if(activity==='Running')assert.equal(await evaluate("[...document.querySelectorAll('.global-forward-actions button span')].filter(node=>node.checkVisibility()).every(node=>node.scrollWidth<=node.clientWidth+1)"),true,`${language} forwarding action labels fit`);
      if(activity==='Command'||activity==='Running') {
        const selector=activity==='Command'?'#batchCommandRunBtn':'.global-forward-hero button.primary';
        const contrast=await evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});const context=document.createElement('canvas').getContext('2d',{willReadFrequently:true});const luminance=color=>{context.fillStyle=color;context.fillRect(0,0,1,1);const rgb=[...context.getImageData(0,0,1,1).data].slice(0,3).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const style=getComputedStyle(button);const a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);})()`);
        assert.ok(contrast>=4.5,`${theme} ${activity} primary button contrast ${contrast}`);
      }
      if(activity==='Command') {
        if(language==='en-US')assert.equal(await evaluate("!/[\\u3400-\\u9fff]/.test(document.querySelector('.command-panel').textContent+document.querySelector('#batchCommandText').placeholder)"),true,'open batch page static labels translate without reopening');
        if(width===1200&&language==='zh-CN') {
          await execute("window.__batchDraftField=document.querySelector('#batchCommandText');window.__batchDraftField.value='printf preserved-draft';window.__batchDraftField.dispatchEvent(new Event('input',{bubbles:true}));window.__batchDraftField.focus();window.__batchDraftField.setSelectionRange(2,8);document.querySelector('.batch-command-check').checked=true;updateBatchTargetCount();await setTermaLanguage('en-US');await setTermaLanguage('zh-CN')");
          assert.equal(await evaluate("document.querySelector('#batchCommandText')===window.__batchDraftField&&document.activeElement===window.__batchDraftField&&window.__batchDraftField.value==='printf preserved-draft'&&window.__batchDraftField.selectionStart===2&&window.__batchDraftField.selectionEnd===8&&document.querySelector('.batch-command-check').checked"),true,'batch live translation keeps draft, focus, caret and target selection');
          assert.equal(await evaluate("primaryView==='command'&&!!document.querySelector('#connectionGroups .template-command-preview')&&!document.querySelector('#connectionGroups').classList.contains('terma-vue-root')"),true,'batch live translation keeps command templates in the operation pane');
        }
      }
      assertions.push({name:`${language}-${theme}-${width}-operations-${activity}`,...result});
      await shot(`${language}-${theme}-${width}-operations-${activity.toLowerCase()}`);
    }
  }
}

module.exports={runRemoteRuntimeUiScenario};
