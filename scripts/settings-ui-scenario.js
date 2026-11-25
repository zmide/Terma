const { replayAppearanceBootstrap } = require('./appearance-ui-fixture');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function verifyAiProviderActions(execute, capture) {
  const result = await execute(`(async () => {
    const original = api, originalTest = window.termaAssistant.request;
    const field = id => document.getElementById(id);
    const change = (id,value,type='change') => {const target=field(id);target.value=value;target.dispatchEvent(new Event(type,{bubbles:true}));};
    const wait = async ready => {for(let round=0;round<160&&!ready();round++)await new Promise(resolve=>setTimeout(resolve,10));return Boolean(ready());};
    const save = () => field('terminalAiSaveBtn');
    const modelButton = () => field('terminalAiModelsBtn');
    const providerSelect = () => field('terminalAiProviderSelect');
    const saves=[];let finishModels, finishSave, requests=0, test;
    api = async (url,options={}) => {
      if(url==='/api/ai/models') {
        requests++;
        if(requests===1)return new Promise(resolve=>{finishModels=()=>resolve({models:['stale-fixture']});});
        return {models:['updated-fixture','updated-fixture']};
      }
      if(url==='/api/ai/settings') {
        const payload=JSON.parse(options.body).ai;
        saves.push(payload);
        if(saves.length===1)return new Promise((resolve,reject)=>{finishSave=()=>reject(Error('Fixture save failed'));});
        return {...payload,providers:payload.providers.map(({api_key,...item})=>({...item,api_key_configured:Boolean(api_key)||item.id==='fixture-selected'})),api_key:undefined};
      }
      return original(url,options);
    };
    window.termaAssistant.request=async(payload,handlers)=>{test=payload;handlers.onDelta('Fixture response');};
    try {
      const first=providerSelect().value;
      const originalModel=field('terminalAiModel').value;
      change('terminalAiModel','__custom__');
      change('terminalAiModelCustom','edited-fixture','input');
      change('terminalAiProviderName','Edited fixture provider','input');
      change('terminalAiApiKey','fixture-key','input');
      const pendingModels=await wait(()=>field('terminalAiModelCustom').checkVisibility());
      modelButton().click();
      const ready=await wait(()=>finishModels&&modelButton().disabled);
      const other=[...providerSelect().options].find(option=>option.value!==first).value;
      change('terminalAiProviderSelect',other);
      await wait(()=>field('terminalAiEndpoint').value.includes('default.example.test'));
      change('terminalAiProviderName','Renamed default fixture','input');
      finishModels?.();
      const ignored=await wait(()=>!modelButton().disabled&&!field('terminalAiModel').querySelector('[value="stale-fixture"]'));
      change('terminalAiProviderSelect',first);
      const kept=await wait(()=>field('terminalAiModel').value==='edited-fixture'&&field('terminalAiProviderName').value==='Edited fixture provider'&&field('terminalAiApiKey').value==='fixture-key');
      modelButton().click();
      const fresh=await wait(()=>requests===2&&!modelButton().disabled&&field('terminalAiModel').querySelectorAll('[value="updated-fixture"]').length===1);
      change('terminalAiModel','updated-fixture');
      save().click();
      const locked=await wait(()=>finishSave&&save().disabled&&field('terminalAiEndpoint').disabled);
      save().click();finishSave?.();
      const retry=await wait(()=>!save().disabled&&saves.length===1&&field('terminalAiApiKey').value==='fixture-key');
      save().click();
      const saved=await wait(()=>!save().disabled&&saves.length===2&&field('terminalAiApiKey').value==='');
      field('terminalAiTestBtn').click();
      const response=await wait(()=>field('terminalAiTestResult').textContent==='Fixture response');
      const requestContract=test?.mode==='chat'&&test.permission==='suggest'&&test.message==='hi'&&test.contexts.length===0;
      const persistedName=saves[1]?.providers.find(item=>item.id===other);
      return {pendingModels,ready,ignored,kept,fresh,locked,retry,saved,response,requestContract,
        renamed:persistedName?.name==='Renamed default fixture'&&persistedName.default_name===false,
        expectedPayloadChanged:originalModel!==saves[1]?.model&&saves[1]?.model==='updated-fixture'&&saves[1]?.active_provider_id===first&&saves[1]?.providers.find(item=>item.id===first).api_key==='fixture-key'};
    } finally { api=original;window.termaAssistant.request=originalTest; }
  })()`);
  for (const [name, passed] of Object.entries(result)) assert.equal(passed, true, 'AI provider actions ' + name);
  await capture('ai-settings-provider-actions');
  return result;
}

async function verifyAiSettingsDetails(execute, capture) {
  await execute(`(async()=>{
    dismissToast();
    const field=id=>document.getElementById(id), change=(id,value,type='input')=>{
      const control=field(id);control.value=value;control.dispatchEvent(new Event(type,{bubbles:true}));
    };
    const wait=async ready=>{for(let i=0;i<130&&!ready();i++)await new Promise(r=>setTimeout(r,10));return Boolean(ready());};
    const original=api,writes=[];
    let releaseDiscovery, rejectSave;
    api=async(url,options={})=>{
      if(!url.startsWith('/api/ai/'))return original(url,options);
      const body=JSON.parse(options.body||'{}'), method=options.method;
      writes.push({url,method,body});
      if(url==='/api/ai/settings'&&method==='PUT')return body.ai;
      if(url.endsWith('/discover')&&method==='POST') {
        await new Promise(resolve=>{releaseDiscovery=resolve;});
        return {tools:[{name:'fixture-describe',description:'Fixture description',risk:'read',inputSchema:{properties:{topic:{}}}}]};
      }
      if(body.server&&(method==='POST'||method==='PUT')) {
        if(body.server.name==='Fail once'&&writes.filter(write=>write.body.server?.name==='Fail once').length===1) {
          await new Promise((resolve,reject)=>{rejectSave=()=>reject(Error('Fixture editor save failed'));});
        }
        return {server:{...body.server,headers:Object.fromEntries(Object.keys(body.server.headers||{}).map(name=>[name,'']))}};
      }
      throw Error('Unexpected settings fixture request');
    };
    window.__aiDetailsFixture={field,change,wait,original,writes,release:()=>releaseDiscovery?.(),pending:()=>Boolean(releaseDiscovery),
      rejectSave:()=>rejectSave?.()};
    change('terminalAiPermission','full','change');
    if(!await wait(()=>document.querySelector('#modal:not([hidden]) [data-choice="0"]')))throw Error('Missing permission confirmation');
  })()`);
  await capture('ai-settings-permission-confirmation');
  try {
    const state = await execute(`(async()=>{
      const {field,change,wait,writes,release,pending,rejectSave}=window.__aiDetailsFixture;
      const save=()=>field('terminalAiSaveBtn');
      const choose=async index=>{
        const selector='#modal:not([hidden]) [data-choice="'+index+'"]';
        if(!await wait(()=>document.querySelector(selector)))throw Error('Missing permission response '+index);
        document.querySelector(selector).click();
      };
      const action=(name,root=field('settings-ai'))=>root.querySelector('[data-mcp-action="'+name+'"]');
      const pendingPermission=save().disabled&&field('terminalAiPermission').value==='confirm';
      save().click();await choose(1);
      const cancelled=await wait(()=>!save().disabled&&writes.length===0&&field('terminalAiPermission').value==='confirm');
      change('terminalAiPermission','full','change');
      await choose(0);
      const accepted=await wait(()=>field('terminalAiPermission').value==='full'&&!save().disabled);
      change('terminalAiPermission','controlled','change');
      field('terminalAiSkillAdd').click();
      const emptySkill=field('terminalAiUserSkillsList').children.length===0;
      change('terminalAiSkillName','Fixture skill');change('terminalAiSkillPrompt','Fixture prompt');field('terminalAiSkillAdd').click();
      const skill=await wait(()=>field('terminalAiUserSkillsList').textContent.includes('Fixture skill'));
      field('terminalAiUserSkillsList').querySelector('[data-user-skill-enabled]').click();
      change('terminalAiSkillName','Fixture remove');change('terminalAiSkillPrompt','Fixture prompt');field('terminalAiSkillAdd').click();
      await wait(()=>field('terminalAiUserSkillsList').children.length===2);
      field('terminalAiUserSkillsList').lastElementChild.querySelector('button').click();
      const removedSkill=await wait(()=>field('terminalAiUserSkillsList').children.length===1);
      dismissToast();
      document.querySelector('[data-mcp-preset="web-fetch"]').click();
      const preset=await wait(()=>field('terminalAiMcpName').value==='Web Fetch'&&!field('terminalAiMcpArgs').hidden);
      change('terminalAiMcpArgs','[12]');action('save').click();
      await new Promise(r=>setTimeout(r,100));
      const invalidArgs=writes.length===0;
      change('terminalAiMcpTransport','sse','change');
      change('terminalAiMcpName','Fail once');change('terminalAiMcpUrl','https://fixture.example.test/sse');
      change('terminalAiMcpHeaders','{"Authorization":2}');action('save').click();
      await new Promise(r=>setTimeout(r,100));
      const invalidHeaders=writes.length===0&&field('terminalAiMcpArgs').disabled&&field('terminalAiMcpCommand').hidden&&!field('terminalAiMcpHeaders').hidden;
      change('terminalAiMcpHeaders','{"Authorization":"fixture-header"}');
      await setTermaLanguage('en-US');
      const editorSurvived=field('terminalAiMcpHeaders').value.includes('fixture-header')&&field('terminalAiMcpTransport').value==='sse';
      action('save').click();
      const saveLocked=await wait(()=>writes.length===1&&action('save').disabled&&save().disabled);
      rejectSave();
      const failed=await wait(()=>!action('save').disabled&&field('terminalAiMcpName').value==='Fail once'&&field('toast').textContent.includes('Fixture editor save failed'));
      action('save').click();
      const retried=await wait(()=>writes.length===2&&action('edit')&&!action('save').disabled&&field('terminalAiMcpName').value==='');
      if(!retried)throw Error('MCP initial save sequence: '+JSON.stringify({pendingPermission,cancelled,accepted,invalidArgs,invalidHeaders,
        editorSurvived,failed,requests:writes.map(item=>[item.url,item.method]),transport:field('terminalAiMcpTransport').value,
        feedback:field('toast').textContent}));
      let row=field('terminalAiMcpList').querySelector('[data-mcp-server-id]');
      action('edit',row).click();
      const masked=await wait(()=>JSON.parse(field('terminalAiMcpHeaders').value||'{}').Authorization===''&&action('cancel'));
      change('terminalAiMcpName','Discarded');action('cancel').click();
      const cancelledEdit=await wait(()=>field('terminalAiMcpName').value===''&&row.textContent.includes('Fail once'));
      action('edit',row).click();await wait(()=>action('cancel'));
      change('terminalAiMcpName','Fixture MCP');change('terminalAiMcpTransport','streamable-http','change');action('save').click();
      const updated=await wait(()=>writes.length===3&&row.textContent.includes('Fixture MCP'));
      row.querySelector('[data-mcp-server-enabled]').click();action('discover',row).click();
      const discoveryLocked=await wait(()=>pending()&&save().disabled&&action('remove',row).disabled);
      save().click();action('discover',row).click();release();
      const discovered=await wait(()=>!save().disabled&&field('terminalAiMcpList').textContent.includes('fixture-describe'));
      if(!discovered)throw Error('MCP discovery sequence: '+JSON.stringify({updated,discoveryLocked,requests:writes.map(item=>[item.url,item.method])}));
      const discoveryContract=writes.length===5&&writes[3]?.method==='PUT'&&writes[3]?.body.server.enabled&&writes[4]?.url.endsWith('/discover')&&writes[4]?.method==='POST';
      field('terminalAiMcpList').querySelector('details summary').click();
      field('terminalAiMcpList').querySelector('[data-mcp-tool-enabled]').click();
      const approvalDefault=field('terminalAiMcpList').querySelector('[data-mcp-tool-approval]').checked;
      save().click();
      const saved=await wait(()=>writes.length===6&&!save().disabled);
      const ai=writes[5]?.body.ai;
      const stored=ai?.terminal_ai_permission==='controlled'&&ai?.user_skills.length===1&&ai.user_skills[0].enabled===false&&ai.mcp_servers.length===1&&
        ai.mcp_servers[0].tools[0].enabled===false&&ai.mcp_servers[0].tools[0].requires_approval===true&&ai.mcp_servers[0].headers.Authorization==='';
      dismissToast();field('terminalAiMcpList').querySelector('details').open=true;
      field('terminalAiMcpList').scrollIntoView({block:'center'});
      return {pendingPermission,cancelled,accepted,emptySkill,skill,removedSkill,preset,invalidArgs,invalidHeaders,editorSurvived,saveLocked,failed,
        retried,masked,cancelledEdit,updated,discoveryLocked,discovered,discoveryContract,approvalDefault,saved,stored};
    })()`);
    for (const [key,ok] of Object.entries(state)) assert.equal(ok,true,`AI settings details ${key}`);
    await capture('ai-settings-mcp-discovered');
    return state;
  } finally {
    await execute(`(async()=>{api=window.__aiDetailsFixture.original;delete window.__aiDetailsFixture;await setTermaLanguage('zh-CN');dismissToast();})()`);
  }
}

async function verifyNotificationSettings(execute, capture) {
  const state = await execute(`(async()=>{
    window.termaSettingsNavigation.show('settings-notifications');
    window.termaSettingsViews.render();
    const field=id=>document.getElementById(id), save=()=>field('notificationSaveBtn'), toggle=()=>field('desktopNotificationToggleBtn');
    const wait=async ready=>{for(let i=0;i<150&&!ready();i++)await new Promise(r=>setTimeout(r,10));return Boolean(ready());};
    const change=(id,value,type='input')=>{const el=field(id);el.value=value;el.dispatchEvent(new Event(type,{bubbles:true}));};
    const original=api, writes=[];
    let rejectRuntime;
    api=async(url,options={})=>{
      if(!['/api/security','/api/runtime-settings'].includes(url)||options.method!=='PUT')return original(url,options);
      const body=JSON.parse(options.body);writes.push({url,body});
      if(url==='/api/security')return {...securitySettings,...body};
      if(!rejectRuntime)await new Promise((resolve,reject)=>{rejectRuntime=()=>reject(Error('Fixture display 503'));});
      return {...window.termaRuntimeSettingsModel.snapshot,saved:{...window.termaRuntimeSettingsModel.snapshot.saved,...body}};
    };
    try {
      change('notificationMode','muted','change');change('notificationSuccessDuration','0.2');save().click();
      const rejectsInvalid=await wait(()=>field('toast').textContent.includes(tr('settings:auto.notification_duration_invalid'))&&writes.length===0);
      change('notificationSuccessDuration','7.3');field('notificationInfoEnabled').click();field('taskCenterFloatingProgressEnabled').click();
      const disabledDuration=await wait(()=>field('notificationInfoDuration').disabled);
      save().click();
      const pending=await wait(()=>rejectRuntime&&save().disabled&&toggle().disabled&&writes.length===2);
      save().click();toggle().click();rejectRuntime?.();
      const partial=await wait(()=>securitySettings.notification_mode==='muted'&&!save().disabled);
      const feedback=field('toast').textContent;
      const retained=field('notificationSuccessDuration').value==='7.3'&&field('notificationInfoDuration').disabled&&field('notificationMode').value==='muted'&&writes.length===2;
      save().click();
      const retried=await wait(()=>!save().disabled&&writes.length===4&&window.termaRuntimeSettingsModel.snapshot.saved.notification_display.success.duration_ms===7300);
      const request=writes[3]?.body;
      const payload=request?.notification_display.info.enabled===false&&request?.notification_display.progress.success_duration_ms===null&&
        request?.sftp_floating_progress_enabled===field('taskCenterFloatingProgressEnabled').checked;
      return {checks:{rejectsInvalid,disabledDuration,pending,partial,retained,retried,payload},
        diagnostic:{feedback,mode:securitySettings.notification_mode,writes:writes.map(write=>write.url)}};
    } finally {api=original;}
  })()`);
  for (const [key,ok] of Object.entries(state.checks)) assert.equal(ok,true,`Notification settings ${key}: ${JSON.stringify(state.diagnostic)}`);
  await capture('notification-settings-partial-retry');
  await execute(`dismissToast();`);
  return state.checks;
}

async function verifyQuickOpen(execute, capture) {
  const result = await execute(`(async () => {
    const original = api, initial = window.termaRuntimeSettingsModel.snapshot;
    const oldValue = localStorage.getItem('remoteDesktopQuickOpen');
    const writes = [];
    const until = async ready => {
      for (let attempt=0; attempt<100 && !ready(); attempt++) await new Promise(resolve=>setTimeout(resolve,10));
      return Boolean(ready());
    };
    let releaseFirst;
    const button = () => document.getElementById('workspace-remote-quick-open');
    const pressed = () => button()?.getAttribute('aria-pressed');
    const busy = () => button()?.getAttribute('aria-busy');
    localStorage.setItem('remoteDesktopQuickOpen','1');
    api = async (url, options={}) => {
      if (url !== '/api/runtime-settings') return original(url,options);
      if (!options.method) return initial;
      const value = JSON.parse(options.body).remote_desktop_quick_open_enabled;
      writes.push(value);
      if (writes.length === 1) await new Promise(resolve=>{releaseFirst=resolve;});
      if (writes.length === 3) throw Error('Fixture quick-open write failed');
      return {...initial, saved:{...initial.saved, remote_desktop_quick_open_enabled:value}};
    };
    try {
      await window.termaRuntimeReader.load();
      window.termaWorkspaceShell.showPrimary('remote');
      const legacyLoaded = await until(() => pressed() === 'true');
      button()?.click(); button()?.click();
      const serialized = await until(() => releaseFirst && busy() === 'true' && writes.length === 1 && pressed() === 'true');
      releaseFirst?.();
      const restored = await until(() => writes.length === 2 && busy() === 'false' && pressed() === 'true');
      const keyMigrated = localStorage.getItem('remoteDesktopQuickOpen') === null;
      button()?.click();
      const failed = await until(() => writes.length === 3 && busy() === 'false' && pressed() === 'true');
      button()?.click();
      const retried = await until(() => writes.length === 4 && busy() === 'false' && pressed() === 'false');
      return {legacyLoaded,serialized,restored,keyMigrated,failed,retried,writeValues:JSON.stringify(writes)==='[false,true,false,false]'};
    } finally {
      if (oldValue === null) localStorage.removeItem('remoteDesktopQuickOpen');
      else localStorage.setItem('remoteDesktopQuickOpen', oldValue);
      await window.termaRuntimeReader.load();
      api = original;
    }
  })()`);
  for (const [name, passed] of Object.entries(result)) assert.equal(passed, true, 'remote quick open ' + name);
  await capture('remote-quick-open');
  await execute(`(async()=>{window.termaWorkspaceShell.showPrimary('settings'); await window.termaSettingsViews.open(); dismissToast();})()`);
  return result;
}

async function verifyWorkspacePreferences(execute) {
  const result = await execute(`(async () => {
    const original = api;
    const writes = [];
    const button = document.getElementById('restoreWorkspaceTabsSave');
    const interval = document.getElementById('generalUiRefreshIntervalSeconds');
    const placement = document.getElementById('toolbarPlacementSplitSftp');
    const restore = document.getElementById('restoreWorkspaceTabs');
    const intervalValue = value => { interval.value = value; interval.dispatchEvent(new Event('input',{bubbles:true})); };
    const until = async ready => {
      for (let attempt=0; attempt<100 && !ready(); attempt++) await new Promise(resolve=>setTimeout(resolve,10));
      return Boolean(ready());
    };
    let fail;
    try {
      window.termaSettingsNavigation.show('settings-general');
      api = async (url, options={}) => {
        if (url !== '/api/runtime-settings' || options.method !== 'PUT') return original(url,options);
        writes.push(JSON.parse(options.body));
        if (writes.length === 1) return new Promise((resolve,reject)=>{fail=()=>reject(Error('Fixture general settings save failed'));});
        return original(url,options);
      };
      intervalValue('61'); button.click();
      await until(() => document.querySelector('.toast'));
      const validationBeforeRequest = writes.length === 0 && interval.value === '61';
      restore.click(); placement.value = 'tab'; placement.dispatchEvent(new Event('change',{bubbles:true}));
      intervalValue('7'); button.click();
      const locked = await until(() => button.disabled && interval.disabled && placement.disabled && fail);
      button.click(); fail?.();
      const editable = await until(() => !button.disabled && !interval.disabled);
      const draftRetained = interval.value === '7' && placement.value === 'tab' && !restore.checked && writes.length === 1;
      await setTermaLanguage('en-US');
      const languageDraftRetained = interval.value === '7' && placement.value === 'tab' && !restore.checked;
      button.click();
      const persisted = await until(() => !button.disabled && window.termaRuntimeSettingsModel.snapshot.saved.ui_refresh_interval_ms === 7000);
      const body = writes[1];
      return {validationBeforeRequest, locked, editable, draftRetained, languageDraftRetained,
        persisted:persisted && writes.length === 2 && body.workspace_toolbar_placement.split.sftp === 'tab'
          && !body.restore_workspace_tabs && body.ui_refresh_interval_ms === 7000
          && body.sftp_background_status_poll_interval_ms === 15000};
    } finally { api = original; await setTermaLanguage('zh-CN'); dismissToast(); }
  })()`);
  for (const [name, passed] of Object.entries(result)) assert.equal(passed, true, 'workspace preferences ' + name);
  return result;
}

async function verifyRuntimeSettingsReload(execute) {
  const result = await execute(`(async () => {
    const original = api;
    const current = window.termaRuntimeSettingsModel.snapshot;
    let calls = 0;
    try {
      api = async (url, options={}) => {
        if (url !== '/api/runtime-settings' || options.method && options.method !== 'GET') return original(url, options);
        if (++calls === 1) throw Error('Fixture runtime read failed');
        return {...current, saved:{...current.saved, listen_port:18084}};
      };
      await window.termaRuntimeReader.load(true);
      const errorBox = document.querySelector('#runtimeSettingsPanel .runtime-feedback.error');
      const retained = Boolean(errorBox?.textContent.includes('Fixture runtime read failed'))
        && document.getElementById('runtimeListenPort').value === '18083';
      errorBox?.querySelector('button')?.click();
      for(let attempt=0; attempt<100 && document.getElementById('runtimeListenPort').value!=='18084'; attempt++)
        await new Promise(resolve=>setTimeout(resolve,10));
      return {retained, reloaded:calls === 2 && document.getElementById('runtimeListenPort').value === '18084'
        && window.termaRuntimeSettingsModel.snapshot.saved.listen_port === 18084 && !document.querySelector('#runtimeSettingsPanel .runtime-feedback.error')};
    } finally {api = original;}
  })()`);
  for (const [name, passed] of Object.entries(result)) assert.equal(passed, true, 'runtime reload ' + name);
  return result;
}

async function verifyRuntimeDiagnostics(execute) {
  const result = await execute(`(async () => {
    const original = api;
    const refresh = document.getElementById('runtimeDiagnosticsRefresh');
    const panel = document.getElementById('runtimeDiagnostics');
    let finish;
    let calls = 0;
    const until = async ready => {
      for (let attempt=0; attempt<100 && !ready(); attempt++) await new Promise(resolve=>setTimeout(resolve,10));
      return Boolean(ready());
    };
    try {
      window.termaSettingsNavigation.show('settings-runtime');
      api = async (url, options={}) => {
        if (url !== '/api/diagnostics/runtime') return original(url, options);
        calls++;
        if (calls === 1) return new Promise((resolve,reject)=>{finish=()=>reject(Error('Fixture diagnostics failed'));});
        return {...await original(url, options), web_info:'bad JSON', lan_urls:[
          'javascript:void(0)', 'https://fixture.example/', 'https://fixture.example',
          'http://fixture-user@invalid.example/'
        ]};
      };
      const notLoaded = !panel.querySelector('dl');
      refresh.click();
      const busy = await until(() => refresh.disabled && refresh.getAttribute('aria-busy') === 'true' && finish);
      refresh.click();
      finish?.();
      const failed = await until(() => !refresh.disabled && panel.classList.contains('error'));
      const singleRequest = calls === 1;
      refresh.click();
      const loaded = await until(() => panel.querySelectorAll('dt').length === 9 && !refresh.disabled);
      const links = [...document.querySelectorAll('#runtimeCurrentUrls a')].map(item => item.href);
      return {notLoaded,busy,failed,singleRequest,loaded,sanitized:links.length === 2
        && links.some(url=>url.startsWith('http://127.0.0.1:')) && links.includes('https://fixture.example/')};
    } finally { api = original; }
  })()`);
  for (const [name, passed] of Object.entries(result)) assert.equal(passed, true, 'runtime diagnostics ' + name);
  return result;
}

async function verifyRuntimeListener(execute) {
  const result = await execute(`(async () => {
    const original = api;
    const saves = [];
    const checks = [];
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const until = async ready => {
      for (let attempt=0; attempt<100 && !ready(); attempt++) await new Promise(resolve=>setTimeout(resolve,10));
      return Boolean(ready());
    };
    const port = document.getElementById('runtimeListenPort');
    const save = document.getElementById('runtimeSaveBtn');
    const check = document.getElementById('runtimeCheckBtn');
    const feedback = document.getElementById('runtimeSettingsFeedback');
    const setPort = value => {
      port.value = value;
      port.dispatchEvent(new Event('input', { bubbles:true }));
    };
    const host = value => document.querySelector('input[name="runtimeListenHost"][value="' + value + '"]');
    const selectedHosts = () => [...document.querySelectorAll('input[name="runtimeListenHost"]:checked')].map(input=>input.value);
    let finishCheck;
    let finishSave;
    try {
      window.termaSettingsNavigation.show('settings-runtime');
      api = async (url, options={}) => {
        if (url === '/api/runtime-settings/check') {
          const input = JSON.parse(options.body);
          checks.push(input);
          if (checks.length === 1) return new Promise(resolve=>{finishCheck=resolve;});
          return {available:false, code:'EADDRINUSE', requested_port:input.listen_port, suggested_port:18083};
        }
        if (url === '/api/runtime-settings' && options.method === 'PUT') {
          const input = JSON.parse(options.body);
          saves.push(input);
          if (saves.length === 1) return new Promise((resolve,reject)=>{finishSave=()=>reject(Error('Fixture listener save failed'));});
          return {...await original(url, options), restart_required:true};
        }
        return original(url, options);
      };
      setPort('65536');
      check.click();
      const invalid = await until(() => feedback.querySelector('.error')) && checks.length === 0;
      host('0.0.0.0').click();
      await tick();
      const wildcardOnly = selectedHosts().join() === '0.0.0.0'
        && host('127.0.0.1').closest('label').hidden && !document.getElementById('runtimeWildcardHint').hidden;
      host('0.0.0.0').click();
      await tick();
      check.click();
      const missingHost = await until(() => feedback.querySelector('.error')) && checks.length === 0;
      host('127.0.0.1').click();
      setPort('18081');
      check.click();
      const checkStarted = await until(() => check.disabled && finishCheck);
      setPort('18082');
      finishCheck?.({available:true, requested_port:18081});
      await until(() => !check.disabled);
      const staleCheckIgnored = !feedback.textContent.trim() && checks[0]?.listen_port === 18081;
      check.click();
      const conflict = await until(() => feedback.querySelector('.error button'));
      feedback.querySelector('button')?.click();
      await tick();
      const suggested = port.value === '18083' && document.activeElement === port && !feedback.textContent.trim();
      save.click();
      const locked = await until(() => save.disabled && port.disabled && finishSave);
      save.click();
      finishSave?.();
      const retry = await until(() => !save.disabled && /Fixture listener save failed/.test(feedback.textContent));
      const stayed = port.value === '18083' && selectedHosts().join() === '127.0.0.1' && saves.length === 1;
      save.click();
      const success = await until(() => feedback.querySelector('.success'));
      return {invalid, missingHost, wildcardOnly, checkStarted, staleCheckIgnored, conflict, suggested, locked, retry, stayed,
        saved:success && saves.length === 2 && saves[1].listen_port === 18083 && saves[1].listen_hosts.join() === '127.0.0.1'
          && window.termaRuntimeSettingsModel.snapshot.saved.listen_port === 18083 && window.termaRuntimeSettingsModel.snapshot.restart_required === true
          && Boolean(document.querySelector('#runtimeSettingsPanel .status-pill.reconnecting'))};
    } finally { api = original; dismissToast(); }
  })()`);
  for (const [name, passed] of Object.entries(result)) assert.equal(passed, true, 'runtime listener ' + name);
  return result;
}

async function verifySecurityActions(execute, capture) {
  const result = await execute(`(async () => {
    const originalApi=api, originalSettings=securitySettings;
    const field=id=>document.getElementById(id);
    const button=action=>document.querySelector('[data-security-action="'+action+'"]');
    const wait=async (ready,label)=>{for(let round=0;round<130&&!ready();round++)await new Promise(resolve=>setTimeout(resolve,15));if(!ready())throw Error('Security UI did not settle: '+label);};
    const click=action=>button(action).click();
    const ready=action=>wait(()=>!button(action)?.disabled,action);
    const choice=index=>document.querySelector('#modal:not([hidden]) [data-choice="'+index+'"]');
    const requests=[];
    let failPassword=true, finishPassword;
    securitySettings={...securitySettings,auth_mode:'lan',encryption_enabled:true,token_set:true,notification_mode:'on'};
    api=async (url,options={})=>{
      if(!url.startsWith('/api/security')||!options.method||options.method==='GET')return originalApi(url,options);
      const payload=JSON.parse(options.body||'{}');
      requests.push({url,payload});
      if(url==='/api/security/password') {
        if(failPassword) return new Promise((_,reject)=>{finishPassword=()=>reject(new Error('Fixture password rejected'));});
        return {...securitySettings,password_set:true};
      }
      if(url==='/api/security/token')return {...securitySettings,token:'fixture-token-once',token_set:true};
      return {...securitySettings,...payload};
    };
    try {
      window.termaSettingsNavigation.show('settings-basic');window.termaSettingsViews.render();dismissToast();
      field('securityAuthMode').value='off';click('policy');
      await wait(()=>choice(1),'policy cancel');choice(1).click();await ready('policy');
      const cancelled=field('securityAuthMode').value==='off'&&securitySettings.auth_mode==='lan'&&requests.length===0;
      click('policy');await wait(()=>choice(0),'policy confirmation');choice(0).click();await ready('policy');
      const confirmed=requests.length===1&&requests[0].payload.confirm_unsafe===true&&requests[0].payload.auth_mode==='off'&&securitySettings.auth_mode==='off';
      field('securitySessionTtlMinutes').value='125';field('securitySessionMaxSessions').value='17';field('securitySessionCleanupMinutes').value='3';
      click('session');await ready('session');
      const sessionSaved=JSON.stringify(requests.find(request=>request.payload.session_ttl_minutes)?.payload)===JSON.stringify({session_ttl_minutes:125,session_max_sessions:17,session_cleanup_minutes:3});
      const password=field('securityPassword');password.value='synthetic-password';click('password');
      await wait(()=>finishPassword&&button('password').disabled,'pending password request');
      click('password');click('session');finishPassword();await ready('password');
      const repeatBlocked=requests.length===3;
      const failurePreserved=password.value==='synthetic-password';
      const failureReported=Boolean(field('toast').querySelector('.toast.error'));
      failPassword=false;click('password');await ready('password');
      const successCleared=password.value===''&&securitySettings.password_set===true;
      click('token');await wait(()=>choice(1),'token cancel');choice(1).click();await ready('token');
      const tokenCancel=!requests.some(request=>request.url.endsWith('/token'));
      click('token');await wait(()=>choice(0),'token confirmation');choice(0).click();await wait(()=>field('modalInputValue'),'one-time token display');
      const tokenOnce=field('modalInputValue').value==='fixture-token-once'&&!Object.hasOwn(securitySettings,'token');
      closeModal();await ready('token');
      const tokenRemoved=!field('modalInputValue');
      field('securityMasterPassword').value='synthetic-master';click('disable');
      await wait(()=>choice(1),'encryption cancel');choice(1).click();await ready('disable');
      const encryptionCancel=field('securityMasterPassword').value==='synthetic-master'&&!requests.some(request=>request.url.endsWith('/encryption/disable'));
      field('securityMasterPassword').value='';
      return {cancelled,confirmed,sessionSaved,repeatBlocked,failurePreserved,failureReported,successCleared,tokenCancel,tokenOnce,tokenRemoved,encryptionCancel};
    } finally {closeModal();api=originalApi;securitySettings=originalSettings;window.termaSettingsViews.render();dismissToast();}
  })()`);
  for (const [name, passed] of Object.entries(result)) assert.equal(passed, true, 'security actions ' + name);
  await capture('security-actions');
  return result;
}

// Runs against the harness's disposable server. All settings mutations below are
// intercepted in the renderer; screenshots contain synthetic credentials only.
async function runSettingsUiScenario(window) {
  const directory = process.env.TERMA_SETTINGS_VISUAL_DIR || path.join(process.cwd(), 'data', 'settings-visual');
  fs.mkdirSync(directory, {recursive:true});
  const execute = source => window.webContents.executeJavaScript(source);
  const reports = [];
  const capture = async name => {
    for (let attempt=0; attempt<3; attempt++) {
      try {
        window.webContents.invalidate();
        await new Promise(resolve => setTimeout(resolve, 100));
        const image=await window.webContents.capturePage();
        if (image.isEmpty()) throw new Error('Empty screenshot');
        fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
        return;
      } catch (error) {
        if (attempt===2 || !/UnknownVizError|Empty screenshot/.test(error.message)) {
          throw new Error(`Settings screenshot ${name} failed`, {cause:error});
        }
      }
    }
  };
  await execute(`(async()=>{
    await window.termaI18nReady;
    window.termaWorkspaceShell.showPrimary('settings'); await window.termaSettingsViews.open();
    window.__settingsOriginalApi=api;
    window.__settingsWrites=[];
    window.__settingsKeyFixture={name:'acceptance_key',path:'/fixture/keys/acceptance_key',scope:'project',type:'Ed25519',bits:256,comment:'Acceptance key',has_passphrase:true,fingerprint:'SHA256:FIXTURE'};
    window.__settingsSecurityFixture={...securitySettings,manage_user_ssh_keys_enabled:true};
    window.__settingsDirectory={current:'/fixture',parent:'/',roots:[{name:'Fixture',path:'/fixture'}],directories:[{name:'keys',path:'/fixture/keys'},{name:'Long directory name for layout verification',path:'/fixture/long-name'}]};
    window.__settingsXServer={platform:'win32',available:true,running:true,display:':0',mode:'bundled',reason_code:'xserver_ready',executable:'C:/Fixture/XServer.exe',desktop_integration:{native_desktop:true,scopes:['xserver']}};
    api=async (pathname,options={})=>{
      const method=options.method||'GET';
      if(pathname==='/api/cache'||pathname.startsWith('/api/cache?'))return window.__settingsOriginalApi(pathname,options);
      if(pathname==='/api/security'&&method==='GET')return window.__settingsSecurityFixture;
      if(pathname==='/api/runtime-settings'&&method==='GET')return window.__settingsRuntimeFixture;
      if(method!=='GET')window.__settingsWrites.push({pathname,method,body:typeof options.body==='string'?JSON.parse(options.body):null});
      if(pathname==='/api/managed-keys')return {items:[window.__settingsKeyFixture]};
      if(pathname==='/api/managed-keys/properties')return window.__settingsKeyFixture;
      if(pathname.startsWith('/api/managed-keys/public'))return {public_key:'ssh-ed25519 AAAATEST fixture@example.invalid'};
      if(pathname.startsWith('/api/storage/directories')){
        const requested = new URL(pathname,location.origin).searchParams.get('path');
        if(requested==='/fixture/keys' || requested==='/fixture/long-name') {
          return new Promise(resolve=>{(window.__directoryReads ||= {})[requested]={resolve,signal:options.signal};});
        }
        return window.__settingsDirectory;
      }
      if(pathname==='/api/xserver')return window.__settingsXServer;
      if(method!=='GET'){
        const body=typeof options.body==='string'?JSON.parse(options.body):{};
        if(pathname==='/api/security')return {...securitySettings,...body};
        if(pathname==='/api/runtime-settings')return {...window.termaRuntimeSettingsModel.snapshot,saved:{...window.termaRuntimeSettingsModel.snapshot.saved,...body}};
        if(pathname==='/api/security/token')return {...securitySettings,token_set:true,token:'fixture-token-once'};
        if(pathname==='/api/security/password')return {...securitySettings,password_set:true};
        if(pathname==='/api/ssh/keys/generate')return {private_path:'/fixture/generated',public_path:'/fixture/generated.pub',public_key:'ssh-ed25519 AAAATEST fixture'};
        return {ok:true};
      }
      return window.__settingsOriginalApi(pathname,options);
    };
    const requestPort = window.termaWorkspaceRequestPort;
    const originalFetch = requestPort.fetch;
    window.__settingsCache = {bytes:2048,reclaimable_bytes:1024,retained_bytes:1024,categories:{sftp_downloads:{bytes:1024,reclaimable_bytes:1024},sftp_uploads:{bytes:1024,reclaimable_bytes:0,busy:true}}};
    window.__settingsCacheDeletes = [];
    requestPort.fetch = async (pathname, options={}) => {
      if(pathname.startsWith('/api/ssh/trusted-hosts?'))return Response.json({page:1,page_size:5,total:1,total_pages:1,hosts:[{id:'fixture-trust',host:'fixture.example',port:22,host_label:'fixture.example:22',key_type:'ssh-ed25519',fingerprint:'SHA256:FIXTURE',updated_at:1720000000000}]});
      if(pathname==='/api/cache'||pathname.startsWith('/api/cache?')) {
        if(options.method==='DELETE') {
          window.__settingsCacheDeletes.push(pathname);
          return new Promise(resolve=>{window.__settingsCacheDelete=resolve;});
        }
        if(window.__settingsCacheDelay) return new Promise(resolve=>{window.__settingsCacheRead={resolve,signal:options.signal};});
        return Response.json(window.__settingsCache);
      }
      if(!pathname.startsWith('/api/managed-keys') && pathname!=='/api/ssh/keys/generate') return originalFetch(pathname,options);
      return Response.json(await api(pathname,options));
    };
    securitySettings=window.__settingsSecurityFixture;
    const fixtureAi={enabled:false,active_provider_id:'fixture-selected',context_chars:24000,providers:[
      {id:'default',default_name:true,name:'Default provider',endpoint:'https://default.example.test/v1'},
      {id:'fixture-selected',name:'Fixture provider',endpoint:'https://fixture.example.test/v1',model:'fixture-small',api_type:'completions',api_key_configured:true}
    ]};
    window.termaRuntimeSettingsModel.snapshot=window.termaRuntimeSettingsModel.normalize({...window.termaRuntimeSettingsModel.snapshot,saved:{...window.termaRuntimeSettingsModel.snapshot.saved,ai:fixtureAi},
      available_hosts:(window.termaRuntimeSettingsModel.snapshot.available_hosts||[]).map(entry=>({...entry,interface:entry.interface==='saved'?'saved':'Fixture Ethernet',label:entry.address}))});
    window.__settingsRuntimeFixture=window.termaRuntimeSettingsModel.snapshot;
    await window.termaTrustedHosts.load();
    connections=[{id:123,name:'Fixture SSH',host:'fixture.example',port:22,username:'fixture'}];
    await window.termaProgramCache.load();
    window.termaSettingsViews.render();window.termaSettingsViews.navigation($('explorerTools'));
    window.__settingsManagedDialog = async (action,kind) => {
      window.termaSettingsNavigation.show('settings-key-management');
      const selector='#sshKeyManagementPanel [data-managed-action="'+action+'"]';
      for(let i=0;i<80&&!document.querySelector(selector);i++)await new Promise(resolve=>setTimeout(resolve,20));
      document.querySelector(selector)?.click();
      for(let i=0;i<80&&document.getElementById('modal').dataset.termaSettingsDialog!==kind;i++)await new Promise(resolve=>setTimeout(resolve,20));
    };
    dismissToast();
  })()`);
  const listener = await verifyRuntimeListener(execute);
  console.log('[settings] runtime listener', JSON.stringify(listener));
  const reload = await verifyRuntimeSettingsReload(execute);
  console.log('[settings] runtime settings reload', JSON.stringify(reload));
  const diagnostics = await verifyRuntimeDiagnostics(execute);
  console.log('[settings] runtime diagnostics', JSON.stringify(diagnostics));
  await capture('listener-saved');
  const workspace = await verifyWorkspacePreferences(execute);
  console.log('[settings] workspace preferences', JSON.stringify(workspace));
  console.log('[settings] remote quick open', JSON.stringify(await verifyQuickOpen(execute, capture)));
  if (process.env.TERMA_SETTINGS_LISTENER_ONLY === '1') return;
  await execute(`window.termaSettingsNavigation.show('settings-ai')`);
  for (const language of ['zh-CN','en-US']) {
    const ai = await execute(`(async()=>{
      await setTermaLanguage(${JSON.stringify(language)});
      const el=id=>document.getElementById(id);
      return {active:el('terminalAiProviderSelect').value, defaultName:el('terminalAiProviderSelect').options[0].textContent===tr('settings:ai.provider_default_name',{count:1}),
        endpoint:el('terminalAiEndpoint').value, model:el('terminalAiModel').value,
        context:el('terminalAiContextValue').value + el('terminalAiContextUnit').value,
        masked:el('terminalAiApiKey').value===''&&el('terminalAiApiKey').placeholder===tr('settings:ai.key_keep_placeholder')};
    })()`);
    assert.deepEqual(ai,{active:'fixture-selected',defaultName:true,endpoint:'https://fixture.example.test/v1',model:'fixture-small',context:'6K',masked:true});
    await capture(`ai-response-${language}`);
  }
  await execute(`document.getElementById('terminalAiContextUnit').scrollIntoView({block:'center'})`);
  await capture('ai-response-context-budget');
  await execute(`setTermaLanguage('zh-CN')`);
  console.log('[settings] AI provider actions', JSON.stringify(await verifyAiProviderActions(execute, capture)));
  console.log('[settings] AI settings details', JSON.stringify(await verifyAiSettingsDetails(execute, capture)));
  console.log('[settings] Notification settings', JSON.stringify(await verifyNotificationSettings(execute, capture)));
  console.log('[settings] fixture ready');
  const sections = ['general','ai','basic','key-management','notifications','runtime','cache','about'];
  // Switch the application's language while each subpage is already mounted.
  // Do not call renderSettings or reopen it here: that would hide stale-view bugs.
  for (const section of sections) {
    await execute(`window.termaSettingsNavigation.show('settings-${section}')`);
    for(const language of ['en-US','zh-CN']) {
      const state=await execute(`(async()=>{
        const root=document.getElementById('view-settings'),field=document.getElementById('webStorageRoot');field.value='/fixture/live-unsaved';
        const before=root.querySelector('#settings-${section}');
        await setTermaLanguage(${JSON.stringify(language)});
        await new Promise(resolve=>setTimeout(resolve,0));
        return {sameRoot:root===document.getElementById('view-settings'),samePanel:before===root.querySelector('#settings-${section}'),value:field.value,title:before.querySelector('h3')?.textContent,nav:document.querySelector('#explorerTools [aria-current="page"]')?.textContent,selected:document.querySelector('#explorerTools [aria-current="page"]')?.dataset.explorerSection,heading:document.getElementById('workspaceTitle').textContent,headingExpected:tr('navigation:auto.workspace'),subtitle:document.getElementById('workspaceSubtitle').textContent,subtitleExpected:window.termaSettingsNavigation.label('settings-${section}'),tab:document.querySelector('.tab.active .tab-title')?.textContent,tabExpected:tr('settings:title'),han:${JSON.stringify(language)}==='en-US'?[...root.querySelectorAll('.settings-group h3,.settings-group button,.settings-group label,#runtimeDiagnostics dt,#runtimeDiagnostics dd,#securityLocalDirectDesktopIntegrationState,.runtime-feedback')].filter(el=>/[\u3400-\u9fff]/.test(el.textContent)).map(el=>el.textContent):[]};
      })()`);
      assert.equal(state.sameRoot,true);assert.equal(state.samePanel,true);assert.equal(state.value,'/fixture/live-unsaved');assert.deepEqual(state.han,[]);
      assert.ok(state.title&&state.nav);
      assert.equal(state.selected,'settings-'+section);
      assert.equal(state.heading,state.headingExpected);
      assert.equal(state.subtitle,state.subtitleExpected);
      assert.equal(state.tab,state.tabExpected);
      await capture(`live-language-${section}-${language}`);
    }
  }
  for (const width of [1200,390]) {
    window.setContentSize(width,844);
    await new Promise(resolve => setTimeout(resolve, 150));
    for(const language of ['zh-CN','en-US']) for(const theme of ['light','dark']) {
      await execute(`(async()=>{await setTermaLanguage(${JSON.stringify(language)},{persist:false});applyTheme(${JSON.stringify(theme)});window.termaSettingsViews.render();window.termaSettingsViews.navigation($('explorerTools'));dismissToast();await new Promise(resolve=>setTimeout(resolve,0))})()`);
      assert.equal(await execute(`document.querySelector('.tab.active .tab-title')?.textContent===tr('settings:title')`),
        true,'settings matrix uses the normal language entry and translates the active tab');
      const appearance = await execute(`(async()=>{
        localStorage.setItem('termaAppearanceV1',JSON.stringify({preset:'luminous'}));
        const track=document.querySelector('.activity-top'),lens=document.createElement('span');
        lens.className='terma-liquid-lens';track.classList.add('terma-liquid-track','has-liquid-selection');track.append(lens);
        await (${replayAppearanceBootstrap.toString()})();
        const root=document.documentElement;
        return root.dataset.appearancePreset==='clear'
          && root.classList.contains('terma-frosted-disabled')
          && !document.querySelector('.terma-liquid-lens,.terma-liquid-track')
          && localStorage.getItem('termaAppearanceV1')===null
          && !('termaAppearanceLegacy' in window) && !('termaThemeAppearance' in window);
      })()`);
      assert.equal(appearance,true,'the normal appearance entry applies flat defaults and clears old state');
      for(const section of sections) {
        const id = `settings-${section}`;
        const prefix = `${width}-${language}-${theme}-${section}`;
        const state = await execute(`(async()=>{
          const id=${JSON.stringify(id)};
          const button = document.querySelector('#explorerTools [data-explorer-section="'+id+'"]');
          button.click();
          if(id==='settings-key-management')for(let i=0;i<80&&!document.querySelector('#managedKeysList .ssh-managed-key-row');i++)await new Promise(resolve=>setTimeout(resolve,20));
          const root=document.getElementById('view-settings'), panel=root.querySelector('#'+id);
          const visible=[...root.querySelectorAll('.settings-group')].filter(el=>el.checkVisibility()).map(el=>el.id);
          const nav=[...document.querySelectorAll('#explorerTools [aria-current="page"]')].map(el=>el.dataset.explorerSection);
          const flatNodes=[...panel.querySelectorAll('.settings-grid > section,.ssh-trust-record,.ssh-key-management-toolbar,.ssh-key-management-scope,.ssh-managed-key-row,.ssh-key-public-preview,.runtime-config-summary,.runtime-host-option,.notification-preference-list,.update-card,.update-status,.update-notes,.desktop-runtime-row')].filter(el=>el.checkVisibility());
          const flat=flatNodes.every(el=>{const style=getComputedStyle(el);return style.boxShadow==='none'&&style.backgroundImage==='none'&&parseFloat(style.borderTopLeftRadius||'0')===0});
          const navigation = {section:window.termaSettingsNavigation.section, activeView, activeTabKey, focusedPaneId,
            owner:workspaceFindPaneForTab(activeTabKey)?.id, paneTab:workspaceFindPaneForTab(activeTabKey)?.activeTabKey,
            buttonDisabled:button.disabled, buttonConnected:button.isConnected};
          return {id,visible,nav,navigation,owned:root.dataset.termaSettingsOwned,legacyButtons:[...panel.querySelectorAll('button')].filter(button=>!button.hasAttribute('data-terma-button')).map(button=>button.textContent),inlineHandlers:root.querySelectorAll('[onclick],[onchange]').length,flat,flatNodes:flatNodes.length,englishHan:${JSON.stringify(language)}==='en-US'?[...panel.querySelectorAll('h2,h3,label,button,.muted')].filter(el=>el.checkVisibility()&&/[\u3400-\u9fff]/.test(el.textContent)).map(el=>el.textContent):[]};
        })()`);
        assert.deepEqual(state.visible,[id],`${prefix} ${JSON.stringify(state.navigation)}`); assert.deepEqual(state.nav,[id]);
        assert.equal(state.owned,'page'); assert.deepEqual(state.legacyButtons,[]);
        assert.equal(state.inlineHandlers,0); assert.equal(state.flat,true,`${prefix} settings containers stay flat`); assert.deepEqual(state.englishHan,[]);
        let step = 0;
        while (true) {
          await capture(`${prefix}-${step}`);
          const next = await execute(`(()=>{const pane=document.getElementById('view-settings').closest('.workspace');const before=pane.scrollTop;pane.scrollTop+=Math.max(120,pane.clientHeight-90);return {moved:Math.abs(pane.scrollTop-before)>1,overflow:document.body.scrollWidth>innerWidth+1}})()`);
          assert.equal(next.overflow,false,prefix+' page overflow');
          if(!next.moved)break;
          assert.ok(++step<30,'Settings scroll did not terminate');
        }
        reports.push({...state,width,language,theme,screenshots:step+1});
      }
      if(width===1200) {
        const navStyle=()=>execute(`(()=>{const b=document.querySelector('#explorerTools [aria-current="page"]');const s=getComputedStyle(b);return {color:s.color,background:s.backgroundColor,shadow:s.boxShadow}})()`);
        window.webContents.sendInputEvent({type:'mouseMove',x:width-2,y:2});
        await new Promise(resolve=>setTimeout(resolve,80));
        const normal=await navStyle();
        const point=await execute(`(()=>{const r=document.querySelector('#explorerTools [aria-current="page"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
        window.webContents.sendInputEvent({type:'mouseMove',...point});
        await new Promise(resolve=>setTimeout(resolve,180));
        assert.deepEqual(await navStyle(),normal,'Selected navigation changed on hover');
        await capture(`${width}-${language}-${theme}-navigation-hover`);
      }
      // Render dialogs through the actual entrypoints and retain each language/theme/width.
      const dialogs = [
        ['directory',`window.termaSettingsNavigation.show('settings-general');await window.termaDesktopStorage.openStorageDirectoryBrowser()`],
        ['key-wizard',`window.termaSettingsNavigation.show('settings-key-management');window.termaKeyWizard.open()`],
        ['key-properties',`await window.__settingsManagedDialog('properties','key-properties')`],
        ['public-key',`await window.__settingsManagedDialog('public','public-key')`],
        ['key-deploy',`await window.__settingsManagedDialog('deploy','key-deploy')`],
        ['key-import',`await window.__settingsManagedDialog('import','key-import')`],
        ['key-result',`window.termaKeyWizard.open();document.querySelector('#modal form.ssh-key-wizard')?.requestSubmit();
          for(let i=0;i<80&&document.getElementById('modal').dataset.termaSettingsDialog!=='key-result';i++) await new Promise(resolve=>setTimeout(resolve,20))`],
        ['choice',`void confirmModal(tr('settings:security.disable_encryption_confirm'),tr('settings:security.disable_encryption_title'),tr('settings:security.decrypt_disable'),tr('common:actions.cancel'),true)`],
        ['input',`window.__settingsPrompt = inputModal(() => tr('settings:auto.token_once'), () => tr('settings:auto.token_save'), 'fixture-token-once')`],
        ['xserver-local',`window.termaSettingsNavigation.show('settings-general');
          window.__settingsBeforeXServer=window.termaDesktopStorage.snapshot;
          window.termaDesktopStorage.snapshot={available:true,settings:{},xserver:window.__settingsXServer};
          window.termaSettingsViews.render();
          document.querySelector('.desktop-runtime-row:not(.desktop-vnc-client-row) button').click();
          for(let i=0;i<60&&!document.querySelector('#modal #xServerManagerTitle');i++)await new Promise(resolve=>setTimeout(resolve,30));
          if(window.termaX11.manager.state.connectionId!==0)throw Error('Local settings inherited a workspace connection')`]
      ];
      for(const [kind,open] of dialogs) {
        await execute(`(async()=>{closeModal();${open};dismissToast()})()`);
        const state = await execute(`(()=>{const modal=document.getElementById('modal'),card=modal.querySelector('.modal-card'),r=card?.getBoundingClientRect(),grip=card?.querySelector(':scope > button.dialog-window-resize');return {kind:modal.dataset.termaSettingsDialog,visible:!modal.hidden,role:card?.getAttribute('role'),fits:r&&r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1,resizeLabel:grip?.getAttribute('aria-label'),legacy:[...modal.querySelectorAll('button:not([data-terma-button])')].filter(button=>button!==grip).length,text:modal.innerText}})()`);
        assert.equal(state.kind,kind);assert.equal(state.visible,true);assert.equal(state.fits,true,kind+' dialog overflow');assert.equal(state.legacy,0,kind+' dialog legacy buttons');assert.ok(state.resizeLabel,kind+' dialog resize control label');
        if(language==='en-US')assert.equal(/[\u3400-\u9fff]/.test(state.text),false,kind+' untranslated');
        if(kind==='input') {
          const editor = await execute(`(async()=>{
            const input=document.getElementById('modalInputValue'), focused=document.activeElement===input;
            const selected=input.selectionStart===0&&input.selectionEnd===input.value.length;
            input.value='unsaved test draft';input.setSelectionRange(4,8);
            await setTermaLanguage('${language==='en-US'?'zh-CN':'en-US'}',{persist:false});
            const translated=document.querySelector('#modal h2').textContent===tr('settings:auto.token_once');
            const preserved=input===document.getElementById('modalInputValue')&&document.activeElement===input
              &&input.value==='unsaved test draft'&&input.selectionStart===4&&input.selectionEnd===8;
            await setTermaLanguage('${language}',{persist:false});
            return {focused,selected,preserved,translated};
          })()`);
          assert.deepEqual(editor,{focused:true,selected:true,preserved:true,translated:true});
        }
        if(kind==='directory') {
          const rows=await execute(`(()=>{
            const buttons=[...document.querySelectorAll('.storage-directory-list > button')];
            return buttons.map(button=>{
              const box=button.getBoundingClientRect(),icon=button.querySelector('svg')?.getBoundingClientRect(),
                label=button.querySelector('span')?.getBoundingClientRect(),style=getComputedStyle(button);
              return {left:style.justifyContent==='flex-start'&&style.textAlign==='left',
                icon:icon&&icon.left-box.left>=5&&icon.left-box.left<=16,
                fits:label&&label.left>=box.left&&label.right<=box.right+1&&box.right<=innerWidth+1,
                visible:button.checkVisibility()};
            });
          })()`);
          assert.equal(rows.length,2);
          assert.ok(rows.every(row=>row.left&&row.icon&&row.fits&&row.visible),'Directory entries align left and fit each button '+JSON.stringify(rows));
          const live=await execute(`(async()=>{
            const card=document.querySelector('.storage-directory-modal'),rows=[...card.querySelectorAll('[data-storage-directory]')];
            rows[0].focus();const active=document.activeElement;
            await setTermaLanguage('${language==='en-US'?'zh-CN':'en-US'}',{persist:false});
            await Promise.resolve();
            const expected=tr('settings:storage.select_runtime_root');
            return card===document.querySelector('.storage-directory-modal')
              &&rows.every((row,index)=>row===card.querySelectorAll('[data-storage-directory]')[index])
              &&document.activeElement===active&&card.querySelector('h2').textContent===expected
              &&rows[0].textContent.includes('keys');
          })()`);
          assert.equal(live,true,'Open directory language change preserves nodes, focus and names');
          await capture(`${width}-${language}-${theme}-dialog-directory-live`);
          await execute(`setTermaLanguage('${language}',{persist:false})`);
          await execute(`(async()=>{
            const directory=document.querySelector('.storage-directory-modal');
            const buttons=directory.querySelectorAll('[data-storage-directory]');
            buttons[0].click();buttons[1].click();
            const reads=window.__directoryReads;
            if(!reads['/fixture/keys'].signal.aborted) throw Error('Old directory request still active');
            const fixture={...window.__settingsDirectory, current:'/fixture/long-name', parent:'/fixture', directories:[]};
            reads[fixture.current].resolve(fixture);
            reads['/fixture/keys'].resolve({...fixture,current:'/fixture/keys'});
            await new Promise(resolve=>setTimeout(resolve,0));
            if(directory!==document.querySelector('.storage-directory-modal') || directory.querySelector('code').textContent!==fixture.current){
              throw Error('Stale directory request replaced the latest listing');
            }
          })()`);
          await capture(`${width}-${language}-${theme}-dialog-directory-empty`);
          await execute(`(async()=>{
            document.getElementById('storageDirectoryUp').click();
            await new Promise(resolve=>setTimeout(resolve,0));
            document.querySelector('[data-storage-directory]').click();
            const read=window.__directoryReads['/fixture/keys'];
            closeModal();
            void confirmModal('Review replacement','Review replacement');
            read.resolve({...window.__settingsDirectory,current:'/fixture/keys'});
            await new Promise(resolve=>setTimeout(resolve,0));
            if(!read.signal.aborted || document.getElementById('modal').dataset.termaSettingsDialog!=='choice'){
              throw Error('Closed directory request overwrote a later dialog');
            }
            closeModal();await window.termaDesktopStorage.openStorageDirectoryBrowser();
          })()`);

        }
        await capture(`${width}-${language}-${theme}-dialog-${kind}`);
        // Every overlay ignores the backdrop; Escape closes it and cleans Vue ownership.
        await execute(`document.getElementById('modal').click()`);
        assert.equal(await execute(`!document.getElementById('modal').hidden`),true);
        await execute(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
        assert.equal(await execute(`document.getElementById('modal').hidden`),true,kind+' Escape');
        if(kind==='input') assert.equal(await execute('window.__settingsPrompt'), '', 'Escape settles the input without saving its draft');
        if(kind==='xserver-local') await execute('window.termaDesktopStorage.snapshot=window.__settingsBeforeXServer;delete window.__settingsBeforeXServer;window.termaSettingsViews.render()');
      }
      await execute(`(async()=>{
        closeModal();window.termaEfficiency.palette.open();
        window.termaCommandNavigation.start('review-parent-prompt',()=>chooseModal(() => tr('settings:security.disable_encryption_title'),'', [{label:tr('common:actions.cancel'),value:false}]));
        window.__settingsChildPrompt=inputModal(() => tr('settings:auto.token_once'),'', 'review child draft');
      })()`);
      assert.equal(await execute(`document.querySelector('[data-command-page] #modalInputValue')?.value`), 'review child draft');
      await capture(`${width}-${language}-${theme}-command-input`);
      await execute(`document.querySelector('.command-page-back').click()`);
      assert.equal(await execute('window.__settingsChildPrompt'), '', 'Command back settles the input');
      assert.equal(await execute(`document.querySelector('[data-command-page] #modal h2')?.textContent===tr('settings:security.disable_encryption_title')`), true);
      await execute('window.termaCommandNavigation.exit();window.termaEfficiency.palette.close();delete window.__settingsChildPrompt');
    }
  }
  // A mobile navigation click must open Settings from another workspace first.
  for(const section of sections) {
    const entered=await execute(`(async()=>{
      setWorkspace('Fixture import','','import','settings-entry-fixture',true,true,{kind:'import'});
      window.termaWorkspaceShell.showPrimary('settings');
      document.querySelector('#explorerTools [data-explorer-section="settings-${section}"]').click();
      for(let attempt=0;attempt<80&&!document.getElementById('settings-${section}')?.checkVisibility();attempt++)await new Promise(resolve=>setTimeout(resolve,50));
      return activeView==='settings'&&document.getElementById('settings-${section}')?.checkVisibility();
    })()`);
    assert.equal(entered,true,'Mobile navigation failed to enter '+section);
  }
  const actions = await execute(`(async()=>{
    window.termaSettingsNavigation.show('settings-general');
    document.getElementById('webStorageRoot').value='/fixture/unsaved';
    window.termaSettingsNavigation.show('settings-ai');window.termaSettingsNavigation.show('settings-general');
    const unsaved=document.getElementById('webStorageRoot').value==='/fixture/unsaved';
    window.termaSettingsNavigation.show('settings-basic');
    const password=document.getElementById('securityPassword');password.value='fixture-password';
    const toggle=password.closest('.password-input-control')?.querySelector('button');toggle?.click();await Promise.resolve();
    const visible=password.type==='text'&&password.value==='fixture-password';toggle?.click();await Promise.resolve();
    const masked=password.type==='password'&&password.value==='fixture-password';
    const save=document.querySelector('[data-security-action="password"]');save.click();
    for(let attempt=0;attempt<80&&(save.disabled||password.value);attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    const cleared=password.value==='';
    window.termaKeyWizard.open();document.getElementById('sshKeyName').value='fixture-key';
    const lengths={};for(const type of ['rsa','ecdsa','ed25519']){document.getElementById('sshKeyType').value=type;document.getElementById('sshKeyType').dispatchEvent(new Event('change',{bubbles:true}));lengths[type]=[...document.getElementById('sshKeyBits').options].map(el=>el.value)}
    const namePreserved=document.getElementById('sshKeyName').value==='fixture-key';
    document.getElementById('sshKeyType').value='rsa';document.getElementById('sshKeyType').dispatchEvent(new Event('change',{bubbles:true}));
    document.getElementById('sshKeyBits').value='3072';
    await setTermaLanguage('en-US');await setTermaLanguage('zh-CN');
    const dialogDraftPreserved=document.getElementById('sshKeyName').value==='fixture-key'&&document.getElementById('sshKeyBits').value==='3072';closeModal();
    const busy=document.getElementById('notificationSaveBtn');setButtonBusy(busy,true,'Fixture saving');await Promise.resolve();
    const busyShown=busy.disabled&&busy.textContent==='Fixture saving';setButtonBusy(busy,false);await Promise.resolve();
    const busyRestored=!busy.disabled&&!busy.textContent.includes('Fixture saving');
    const decision=confirmModal('Fixture','Fixture','Proceed','Cancel',true);document.querySelector('#modal [data-choice="1"]').click();const cancelled=!(await decision);
    return {unsaved,visible,masked,cleared,namePreserved,dialogDraftPreserved,lengths,busyShown,busyRestored,cancelled,writes:window.__settingsWrites};
  })()`);
  for(const key of ['unsaved','visible','masked','cleared','namePreserved','dialogDraftPreserved','busyShown','busyRestored','cancelled'])assert.equal(actions[key],true,key);
  assert.ok(actions.lengths.rsa.includes('4096'));assert.ok(actions.lengths.ecdsa.includes('384'));assert.deepEqual(actions.lengths.ed25519,['256']);
  assert.ok(actions.writes.some(write=>write.pathname==='/api/security/password'));
  window.setContentSize(1200,844);
  await new Promise(resolve=>setTimeout(resolve,150));
  console.log('[settings] security actions', JSON.stringify(await verifySecurityActions(execute, capture)));
  await execute(`(async () => {
    await window.termaWorkspaceRefresh.stop();
    window.__storageBefore = {api, desktopSettings: window.termaDesktopStorage.snapshot};
    const desktopFixture={available:true,settings:{dataMode:'user'},paths:{dataDir:'/fixture/current-data',sshDir:'/fixture/current-keys'}};
    api = async (path, options={}) => {
      if (path!=='/api/desktop-settings') return window.__storageBefore.api(path, options);
      if (options.method==='PUT') {
        window.__storagePayloads.push(JSON.parse(options.body));
        return {migration_requested:true,restart_required:true};
      }
      return desktopFixture;
    };
    window.__storagePayloads=[];
    window.__prepareDesktopStorage = () => {
      window.termaDesktopStorage.snapshot=desktopFixture;
      window.termaSettingsNavigation.show('settings-general');window.termaSettingsViews.render();
      const mode=$('desktopDataMode');mode.value='custom';mode.dispatchEvent(new Event('change',{bubbles:true}));
      $('desktopCustomDataDir').value='/fixture/desktop-root';
      const save=mode.parentElement.querySelector('.storage-settings-save');
      if (!save?.checkVisibility()) throw Error('Missing desktop save control');
      window.__desktopStorageOperation=window.termaDesktopStorage.saveDesktopSettings(save);
      return save;
    };
    window.__prepareDesktopStorage();
  })()`);
  await capture('desktop-storage-migration-choice');
  const desktopStorage = await execute(`(async()=>{
    const choices=()=>[...document.querySelectorAll('#modal [data-choice]')].map(button=>button.textContent.trim());
    const labels=choices(),wait=()=>new Promise(resolve=>setTimeout(resolve,30));
    const select=choice=>{
      const button=document.querySelector('#modal [data-choice="'+choice+'"]');
      if (!button) throw Error('Missing choice '+choice+' in '+choices().join(','));
      button.click();
    };
    select(2);await window.__desktopStorageOperation;
    const cancelled=window.__storagePayloads.length===0;
    const save=window.__prepareDesktopStorage();await wait();
    select(0);await window.__desktopStorageOperation;await wait();
    const locked=save.disabled;
    await window.termaDesktopStorage.saveDesktopSettings($('desktopSettingsSaveBtn'));
    window.termaUiActions.end('settings:storage:save',save);
    api=window.__storageBefore.api;window.termaDesktopStorage.snapshot=window.__storageBefore.desktopSettings;
    window.termaSettingsViews.render();
    return {labels,cancelled,locked,payloads:window.__storagePayloads};
  })()`);
  assert.equal(desktopStorage.labels.length,3);
  assert.equal(desktopStorage.cancelled && desktopStorage.locked,true);
  assert.equal(desktopStorage.payloads.length,1);
  assert.deepEqual({mode:desktopStorage.payloads[0].dataMode, root:desktopStorage.payloads[0].customDataDir, migrate:desktopStorage.payloads[0].migrateData},
    {mode:'custom',root:'/fixture/desktop-root',migrate:true});
  const programCache = await runProgramCacheScenario(execute, capture);
  const splitLanguage = await execute(`(async()=>{
    window.termaExchange.feature().open();const imported=tabs.find(tab=>tab.key===activeTabKey),settings=tabs.find(tab=>tab.kind==='settings');
    if(!window.termaWorkspaceDrag.applyTabDrop({key:imported.key},{paneId:workspaceFindPaneForTab(settings.key).id,zone:'right'}))throw new Error('Settings split setup failed');
    await new Promise(resolve=>setTimeout(resolve,300));
    const checks=[];
    for(const tab of [settings,imported])for(const language of ['en-US','zh-CN']){
      activateTab(tab.key);
      const layout=JSON.stringify(workspaceLayout),focus=focusedPaneId;
      await setTermaLanguage(language);
      const expectedSubtitle=tab.kind==='settings'
        ? window.termaSettingsNavigation.label()
        : tab.kind==='import'
          ? tr('settings:auto.ssh_config_import_export',{defaultValue:'SSH config import and export'})
          : window.termaWorkspaceViews.presentation.subtitle(tab);
      checks.push({kind:tab.kind,language,heading:document.getElementById('workspaceTitle').textContent,headingExpected:tr('navigation:auto.workspace'),subtitle:document.getElementById('workspaceSubtitle').textContent,subtitleExpected:expectedSubtitle,layout:layout===JSON.stringify(workspaceLayout),focus:focus===focusedPaneId,activeView});
    }
    const importPane=window.termaWorkspacePaneScope.workspacePaneElement(workspaceFindPaneForTab(imported.key).id);
    const settingsPane=window.termaWorkspacePaneScope.workspacePaneElement(workspaceFindPaneForTab(settings.key).id);
    const originalImportView=importPane.querySelector('#view-import');
    if(!originalImportView?.checkVisibility())throw Error('Import pane did not reach its original view');
    document.querySelector('#explorerTools [data-explorer-section="settings-about"]').click();
    const navigationState=()=>({view:activeView,visible:Boolean(settingsPane.querySelector('#settings-about')?.checkVisibility()),
      selected:document.querySelector('#explorerTools [aria-current="page"]')?.dataset.explorerSection,
      tab:settingsPane.querySelector('.tab.active')?.dataset.tabKey,focused:settingsPane.dataset.paneId===focusedPaneId});
    const isReady=state=>state.view==='settings'&&state.visible&&state.selected==='settings-about'&&state.tab===settings.key&&state.focused;
    let consecutive=0;
    for(let attempt=0;attempt<100&&consecutive<5;attempt++){
      consecutive=isReady(navigationState())?consecutive+1:0;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    const navigation=navigationState();
    return {checks,navigation:isReady(navigation),navigationState:navigation,otherPaneIntact:originalImportView===importPane.querySelector('#view-import')
      && originalImportView.checkVisibility() && importPane.dataset.activeView==='import' && importPane.querySelector('#view-settings').hidden};
  })()`);
  for(const check of splitLanguage.checks){assert.equal(check.heading,check.headingExpected,JSON.stringify(check));assert.equal(check.subtitle,check.subtitleExpected,JSON.stringify(check));assert.ok(check.layout&&check.focus,JSON.stringify(check));}
  assert.equal(splitLanguage.navigation,true,'Settings navigation after changing focused pane: '+JSON.stringify(splitLanguage.navigationState));
  assert.equal(splitLanguage.otherPaneIntact,true,'Opening a settings section must leave the import pane visible and unchanged');
  await capture('split-language-navigation');
  const loadOwnership = await verifySettingsLoadOwnership(execute, capture);
  const summary={views:reports.length,dialogs:80,liveLanguageSwitches:16,directoryLanguageSwitches:8,directoryGeometryGroups:8,splitLanguageSwitches:4,mobileEntries:8,selectedHover:4,screenshots:reports.reduce((total,item)=>total+item.screenshots,111)};
  summary.screenshots += 2;
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({summary,reports,actions,desktopStorage,splitLanguage,loadOwnership,programCache},null,2));
  console.log('[ui-smoke] Settings matrix', JSON.stringify({...summary,actions}));
}

async function verifySettingsLoadOwnership(execute, capture) {
  try {
    const retired = await execute(`(async()=>{
      await window.termaSettingsViews.open();
      const key = activeTabKey, old = workspaceTabByKey(key), original = window.termaProgramCache.load;
      const fixture = window.__settingsLoadOwnership = {original, requests: []};
      window.termaProgramCache.load = options => options?.quiet ? new Promise((resolve,reject)=>fixture.requests.push({resolve,reject})) : original(options);
      const start = () => window.termaSettingsViews.open();
      fixture.first = start(); await Promise.resolve();
      const coalesced = start() === fixture.first;
      await closeTabsByKey([key]);
      fixture.second = start(); await Promise.resolve();
      return {coalesced, reopened: workspaceTabByKey(key) !== old, separateRead: fixture.requests.length === 2,
        loading: $('view-settings').querySelector('.ui-state.loading')?.checkVisibility() === true};
    })()`);
    for (const [name, passed] of Object.entries(retired)) assert.equal(passed,true,`Settings page load ${name}`);
    await capture('settings-reopened-loading');
    const error = await execute(`(async()=>{
      const f = window.__settingsLoadOwnership;
      f.requests[1].reject(new Error('fixture settings read failed'));
      await f.second;
      f.requests[0].resolve();
      await f.first;
      const panel = $('view-settings').querySelector('.ui-state.error');
      return {retiredResponseIgnored:panel?.textContent.includes('fixture settings read failed') === true, retry:panel?.querySelector('button')?.checkVisibility() === true};
    })()`);
    for (const [name, passed] of Object.entries(error)) assert.equal(passed,true,`Settings page load ${name}`);
    await capture('settings-reopened-error');
    const retried = await execute(`(async()=>{
      const f = window.__settingsLoadOwnership;
      $('view-settings').querySelector('.ui-state.error button').click();
      await Promise.resolve();
      f.requests[2].resolve();
      for(let i=0;i<100;i++){
        if($('view-settings').querySelector('.settings-panel')?.checkVisibility())return true;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      return false;
    })()`);
    assert.equal(retried,true,'Retry opens settings in the current pane');
    return {...retired,...error,retried};
  } finally {
    await execute(`if(window.__settingsLoadOwnership){window.termaProgramCache.load=window.__settingsLoadOwnership.original;delete window.__settingsLoadOwnership;}`);
  }
}

async function runProgramCacheScenario(execute, capture) {
  await execute(`(async()=>{
    await setTermaLanguage('en-US',{persist:false});applyTheme('dark');
    window.termaWorkspaceShell.showPrimary('settings');await window.termaSettingsViews.open();window.termaSettingsNavigation.show('settings-cache');closeModal();dismissToast();
    document.querySelector('#view-settings [data-cache-category="sftp_downloads"]').click();
  })()`);
  assert.equal(await execute(`document.querySelector('#modal h2').textContent`),'Clear application cache');
  await capture('program-cache-category-confirmation');
  const state = await execute(`(async()=>{
    const wait=()=>new Promise(resolve=>setTimeout(resolve,20));
    const until=async (read, stage)=>{
      for(let i=0;i<60;i++){const item=read();if(item)return item;await wait();}
      throw Error('Cache UI did not settle: '+stage+'; active='+activeView+'; clearing='+window.termaProgramCache.snapshot().clearing);
    };
    const clickChoice=async (choice, stage)=>(await until(()=>document.querySelector('#modal:not([hidden]) [data-choice="'+choice+'"]'), stage)).click();
    const find=selector=>$('view-settings')?.querySelector(selector);
    const download=()=>find('[data-cache-category="sftp_downloads"]');
    const upload=()=>find('[data-cache-category="sftp_uploads"]');
    const refresh=()=>find('#refreshProgramCacheButton');
    const all=()=>find('#clearProgramCacheButton');
    const usage=()=>find('#cacheManagementPanel .settings-kv strong').textContent;
    await clickChoice(1,'cancel category');await wait();
    const cancelled=window.__settingsCacheDeletes.length===0;
    window.__settingsCacheDelay=true;
    refresh().click();
    const old=await until(()=>window.__settingsCacheRead,'pending refresh');
    all().click();await clickChoice(0,'confirm all');
    await until(()=>window.__settingsCacheDeletes.length===1,'pending clear all');
    const busy=all().disabled&&refresh().disabled&&download().disabled&&all().getAttribute('aria-busy')==='true';
    download().click();
    const oldAborted=old.signal.aborted;
    window.__settingsCacheDelete(Response.json({error:'Fixture cleanup failed'}, {status:500}));await wait();
    const failedRestored=!all().disabled&&!download().disabled&&upload().disabled&&document.body.textContent.includes('Fixture cleanup failed');
    const directoryCache=window.termaSftpDirectoryWorkspace.cache;
    directoryCache.setSize(123,'/fixture',{status:'ready',sizeBytes:'99'});
    const before=usage();
    download().click();await clickChoice(0,'confirm category');
    await until(()=>window.__settingsCacheDeletes.length===2,'pending category clear');
    window.__settingsCache={bytes:1024,reclaimable_bytes:0,retained_bytes:1024,categories:{sftp_uploads:{bytes:1024,reclaimable_bytes:0,busy:true}}};
    window.__settingsCacheDelete(Response.json(window.__settingsCache));await wait();
    old.resolve(Response.json({bytes:999999,reclaimable_bytes:999999}));await wait();
    window.__settingsCacheDelay=false;dismissToast();
    return {cancelled,busy,oldAborted,failedRestored,before,after:usage(),downloadDisabled:download().disabled,
      uploadDisabled:upload().disabled,refreshEnabled:!refresh().disabled,sizeInvalidated:directoryCache.getSize(123,'/fixture')===null,
      deletes:window.__settingsCacheDeletes};
  })()`);
  assert.deepEqual(state.deletes,['/api/cache','/api/cache?category=sftp_downloads']);
  assert.notEqual(state.before,state.after);
  for (const key of ['cancelled','busy','oldAborted','failedRestored','downloadDisabled','uploadDisabled','refreshEnabled','sizeInvalidated']) {
    assert.equal(state[key],true,`application cache ${key}`);
  }
  await capture('program-cache-after-category-clear');
  return state;
}
module.exports = {runSettingsUiScenario};
