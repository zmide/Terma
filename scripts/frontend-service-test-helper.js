const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript-legacy');
const { frontendSourcePath } = require('./frontend-source');
const serviceOwners=[{"name":"sharedServices","file":"frontend/src/shared/installed-services.ts"},{"name":"assistantServices","file":"frontend/src/features/assistant/installed-services.ts"},{"name":"batchServices","file":"frontend/src/features/batch/installed-services.ts"},{"name":"connectionsServices","file":"frontend/src/features/connections/installed-services.ts"},{"name":"dataExchangeServices","file":"frontend/src/features/data-exchange/installed-services.ts"},{"name":"efficiencyServices","file":"frontend/src/features/efficiency/installed-services.ts"},{"name":"filesServices","file":"frontend/src/features/files/installed-services.ts"},{"name":"forwardsServices","file":"frontend/src/features/forwards/installed-services.ts"},{"name":"logsServices","file":"frontend/src/features/logs/installed-services.ts"},{"name":"operationsServices","file":"frontend/src/features/operations/installed-services.ts"},{"name":"quickServices","file":"frontend/src/features/quick/installed-services.ts"},{"name":"remoteServices","file":"frontend/src/features/remote/installed-services.ts"},{"name":"sessionEfficiencyServices","file":"frontend/src/features/session-efficiency/installed-services.ts"},{"name":"settingsServices","file":"frontend/src/features/settings/installed-services.ts"},{"name":"snippetsServices","file":"frontend/src/features/snippets/installed-services.ts"},{"name":"terminalServices","file":"frontend/src/features/terminal/installed-services.ts"},{"name":"workspaceServices","file":"frontend/src/features/workspace/installed-services.ts"},{"name":"x11Services","file":"frontend/src/features/x11/installed-services.ts"}];
function installedServiceFixture(request, host) {
  if (!request.startsWith("@/")) return undefined;
  const owner=serviceOwners.find(item=>item.file === "frontend/src/" + request.slice(2) + ".ts");
  return owner ? {[owner.name]:host} : undefined;
}

function loadFrontendService(relative, globals = {}, cache = new Map()) {
  const filename = path.resolve(relative);
  if(globals.window&&!globals.window.location)globals.window.location={origin:"https://fixture.terma.test"};


  const helperOwners={"isLoopbackHost":"shared/browser-ui","currentPageHostForForward":"shared/browser-ui","cssEscape":"shared/browser-ui","isMobileLayout":"shared/browser-ui","keepTerminalKeyboardClosed":"shared/browser-ui","stateView":"shared/browser-ui","toggleCheckGroup":"shared/browser-ui","preferredTheme":"shared/theme-runtime","syncThemeToggleControls":"shared/theme-runtime","applyTheme":"shared/theme-runtime","toggleTheme":"shared/theme-runtime","localizedIdentitySourceLabel":"features/connections/identity-labels","localizedIdentityFileLabel":"features/connections/identity-labels","configEncryptionLocked":"features/settings/encryption-guard","requireConfigEncryptionUnlocked":"features/settings/encryption-guard","saveGroupState":"shared/expanded-groups","saveRemoteGroupState":"shared/expanded-groups","saveRunningState":"shared/expanded-groups","saveLogState":"shared/expanded-groups","localizedTermaUiPhrase":"shared/i18n/ui-phrase","hideActionMenu":"shared/action-menu","normalizeActionMenuActions":"shared/action-menu","showActionMenu":"shared/action-menu","dismissToast":"features/efficiency/notification-actions","notify":"features/efficiency/notification-actions","createProgressToast":"features/efficiency/notification-actions","desktopNotificationEnabled":"features/efficiency/notification-actions","requestDesktopNotifications":"features/efficiency/notification-actions","showDesktopNotification":"features/efficiency/notification-actions","handleNotificationAction":"features/efficiency/notification-actions","currentNotificationLanguage":"features/efficiency/notification-actions","handleNotificationEvent":"features/efficiency/notification-actions","pollNotifications":"features/efficiency/notification-actions","initializeNotificationCursor":"features/efficiency/notification-actions","esc":"shared/html-escape","escAttr":"shared/html-escape","normalizeBackendPublicErrorCode":"shared/api/public-errors","backendPublicErrorParams":"shared/api/public-errors","localizedBackendPublicError":"shared/api/public-errors","apiErrorFromResponse":"shared/api/public-errors","api":"shared/api/workspace-request","icon":"shared/ui/icon-service","x11Icon":"shared/ui/icon-service","refreshIcons":"shared/ui/icon-service","syncPasswordVisibilityControl":"shared/form-controls","enhancePasswordInputs":"shared/form-controls","updateFilePicker":"shared/form-controls","syncFilePickerLabels":"shared/form-controls","setButtonBusy":"shared/ui-action-service","syncUiActionControls":"shared/ui-action-service","beginUiAction":"shared/ui-action-service","endUiAction":"shared/ui-action-service","isUiActionInFlight":"shared/ui-action-service","captureUiState":"shared/ui-snapshot-service","restoreUiState":"shared/ui-snapshot-service","writeClipboardText":"shared/clipboard-service","copyText":"shared/clipboard-service","beginNativeFileDialogViewport":"shared/viewport-service","resetMobileWorkspaceShellScroll":"shared/viewport-service","settleNativeFileDialogViewport":"shared/viewport-service","bindNativeFileDialogViewportRecovery":"shared/viewport-service","syncViewportHeight":"shared/viewport-service","normalizeTermaLanguage":"shared/i18n/ui-phrase"};
  for(const module of new Set(Object.values(helperOwners))){
    const helperFile=path.resolve(__dirname,'../frontend/src',module+'.ts');
    if(filename===helperFile||cache.has(helperFile))continue;
    const names=Object.keys(helperOwners).filter(name=>helperOwners[name]===module);
    const provided=names.filter(name=>typeof globals[name]==='function'||typeof globals.window?.[name]==='function');
    if(provided.length)cache.set(helperFile,Object.fromEntries(provided.map(name=>[name,(...args)=>(globals[name]||globals.window[name])(...args)])));
  }

  const fixtures={
   '@/features/connections/connection-selection':['noteConnectionUsage','selectConnection','currentConnection','selectedConnection'],
   '@/shared/workspace-dom':['$'],
   '@/features/workspace/workspace-modal-host':['closeModal'],
   '@/shared/i18n/workspace-bootstrap':['tr','registerTermaI18nRenderer','translatedTermaPhrase','rememberTermaRawUiPhrase','isTermaRawUiPhrase','setTermaLanguage','ensureTermaI18nResourceBundles','normalizeTermaLanguage']
  };
  for(const [relative,names]of Object.entries(fixtures)){
   const file=path.resolve(__dirname,'../frontend/src',relative.slice(2)+'.ts');
   if(filename===file||cache.has(file))continue;
   if(names.some(name=>typeof globals[name]==='function'||typeof globals.window?.[name]==='function')){
    const fixture=Object.fromEntries(names.map(name=>[name,(...args)=>{
      const callback=globals[name]||globals.window?.[name];return typeof callback==='function'?callback(...args):args[0];
    }]));
    cache.set(file,fixture);
   }
  }
  const appStateFile=path.resolve(__dirname,'../frontend/src/shared/application-state.ts');
  const appStateFields=["connections","selectedId","activeView","primaryView","restoringTabs","workspaceRestorePending","tabs","activeTabKey","remoteProfiles","selectedRemoteProfileId","groupOpen","remoteGroupOpen","runningOpen","logOpen","logsData","pendingGroup","terminalFontSize","terminalGlobalSettings","terminalKeysVisible","terminalCtrlArmed","terminalCtrlLocked","connectionSearch","connectionBulkMode","selectedConnectionIds","logSearch","healthResults","connectionVirtual","forwardTemplates","runningGroupMode","sftpDisconnectedTabs","securitySettings","sftpJobsTimer"];
  if(filename!==appStateFile&&!cache.has(appStateFile)&&appStateFields.some(name=>name in globals)){
    const storage={getItem:()=>null,setItem(){}};
    const state=loadFrontendService(appStateFile,{localStorage:storage},cache);
    for(const name of appStateFields)if(name in globals)Object.defineProperty(state.applicationState,name,{
      configurable:true,enumerable:true,get:()=>globals[name],set:value=>{globals[name]=value;}
    });
  }
  const pageFile=path.resolve(__dirname,'../frontend/src/features/terminal/terminal-page.ts');
  const pageFields=["updateTerminalStatusForLayout","syncTerminalToolbarPlacement","updateTerminalConnectionToggle","nextTerminalTabIndex","openTerminal","openQuickTerminal","restoreQuickTerminalTab","openTerminalConnection","toggleTerminalPersistence","handleTerminalSessionButton","openTerminalSessionMenu","terminateTerminalPersistenceRecord","terminateTerminalPersistence","updateTerminalSessionToolbar","attachTerminal","enableTerminalFontWheel","observeTerminalBox","syncTerminalResponsiveFontSizes","changeTerminalFont","focusTerminalSession","copyTerminalText","pasteTerminalText","showTerminalContextMenu"];
  if(filename!==pageFile&&!cache.has(pageFile)&&pageFields.some(name=>typeof globals[name]==='function')){
    cache.set(pageFile,Object.fromEntries(pageFields.filter(name=>typeof globals[name]==='function').map(name=>[name,(...args)=>globals[name](...args)])));
  }
  const stateFile=path.resolve(__dirname,'../frontend/src/features/terminal/terminal-session-state.ts');
  const stateFields=['terminalSessions','terminalSurfaceCache','terminalCounts','auxiliaryTerminalOwners'];
  if(filename!==stateFile&&!cache.has(stateFile)&&stateFields.some(name=>name in globals)){
    const fixture={};
    for(const name of stateFields){
      const fallback=new Map();
      Object.defineProperty(fixture,name,{enumerable:true,get:()=>globals[name]??fallback});
    }
    cache.set(stateFile,fixture);
  }
  const serviceOwner=serviceOwners.find(owner=>path.resolve(__dirname,'..',owner.file)===filename);
  if(serviceOwner){
    if(!cache.has(filename))cache.set(filename,{[serviceOwner.name]:globals.window||globals});
    return cache.get(filename);
  }
  if (cache.has(filename)) return cache.get(filename);
  const exports = {}; cache.set(filename, exports);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: filename.endsWith('.tsx') ? ts.JsxEmit.ReactJSX : undefined }
  }).outputText;
  const context = vm.createContext({ exports, console, fetch, Headers, Error, DOMException, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Blob, AbortController, AbortSignal, URL, URLSearchParams, Response, ReadableStream, performance, structuredClone, setTimeout, clearTimeout, crypto:require('node:crypto').webcrypto,
    require:name => {
      if (/\.(?:css|scss)$/.test(name)) return {};
      if (name.startsWith('@/')) {
        if (name === 'react/jsx-runtime') return {jsx:()=>null, jsxs:()=>null, Fragment:Symbol('Fragment')};
        const base = path.resolve(__dirname, '../frontend/src', name.slice(2));
        const target = [base+'.ts', base+'.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
          .find(candidate => fs.existsSync(candidate));
        if (!target) throw new Error('Missing service dependency: '+name);
        return loadFrontendService(target, globals, cache);
      }
      if (name === 'react/jsx-runtime') return {jsx:()=>null, jsxs:()=>null, Fragment:Symbol('Fragment')};
      if (name === 'vue') return require('../frontend/node_modules/vue');
      if (/\.(?:css|scss)$/.test(name)) return {};
      if(name==='vue')return require('../frontend/node_modules/vue');
      if (!name.startsWith('.')) throw new Error('Unexpected service dependency: '+name);
      const base = path.resolve(path.dirname(filename), name);
      const target = [base+'.ts', base+'.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
        .find(candidate => fs.existsSync(candidate));
      if (!target) throw new Error('Missing service dependency: '+name);
      return loadFrontendService(target, globals, cache);
    }, ...globals });
  vm.runInContext(source, context, { filename }); return exports;
}

function loadClassicTerminalSettings(sandbox) {
  const fixture = {...sandbox};
  sandbox.window ||= sandbox;
  sandbox.window.termaTerminalState={
    terminalSessions:sandbox.terminalSessions??new Map(),
    terminalSurfaceCache:sandbox.terminalSurfaceCache??new Map(),
    terminalCounts:sandbox.terminalCounts??new Map()
  };
  if (!sandbox.isMobileLayout) sandbox.isMobileLayout = () => false;
  if (!sandbox.setButtonBusy) sandbox.setButtonBusy = () => {};
  if (!sandbox.tr) sandbox.tr = key => key;
  if (!sandbox.WebSocket) sandbox.WebSocket = {OPEN:1};
  const context = vm.createContext(sandbox);
  Object.assign(context, fixture);
  if (fixture.terminalStartupOverrides) {
    vm.runInContext('terminalStartupOverrides.has = globalThis.terminalStartupOverrides.has;', context);
  }
  return context;
}

module.exports = { loadFrontendService, loadClassicTerminalSettings, installedServiceFixture };
