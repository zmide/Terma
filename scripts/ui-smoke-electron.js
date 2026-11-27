const {runTerminalDropUiScenario}=require('./terminal-drop-ui-scenario');
const { app, BrowserWindow, clipboard, ipcMain, session } = require("electron");
app.on('web-contents-created',(_event,contents)=>{
 const evaluate=contents.executeJavaScript.bind(contents);
 contents.executeJavaScript=(source,...args)=>evaluate(`(()=>{
  const state=window.termaApplicationState;if(!state)return;
  for(const [name,value]of Object.entries(window.termaWorkspaceLanguage||{}))window[name]=value;
  window.termaI18nReady=window.termaWorkspaceLanguage?.i18nReady;

  if(window.termaWorkspaceRequest&&!Object.getOwnPropertyDescriptor(window,'api'))
    Object.defineProperty(window,'api',{configurable:true,get:()=>window.termaWorkspaceRequest,set:value=>{window.termaWorkspaceRequest=value;}});
  const wrappers={
    dismissToast:()=>window.termaNotificationToasts.dismiss(),
    notify:(...args)=>window.termaNotificationToasts.notify(...args),
    createProgressToast:(...args)=>window.termaNotificationToasts.createProgress(...args),
    apiErrorFromResponse:(...args)=>window.termaPublicErrors.fromResponse(...args),
    localizedBackendPublicError:(...args)=>window.termaPublicErrors.message(...args),
    icon:(...args)=>window.termaIcons.html(...args),x11Icon:(label)=>window.termaIcons.html('x11',label),
    refreshIcons:()=>{window.termaFormControls?.enhancePasswords(document);window.termaIcons.refresh();},
    copyText:text=>window.termaClipboard.copy(text),writeClipboardText:text=>window.termaClipboard.write(text),
    isMobileLayout:()=>matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)').matches,
    applyTheme:theme=>{if(document.documentElement.dataset.theme!==theme)document.getElementById('themeToggle')?.click();},
    toggleTheme:()=>document.getElementById('themeToggle')?.click(),
    hideActionMenu:()=>{window.termaTerminalActionMenu?.close(false);window.termaTerminalDisplayMenu?.close(false);},
    showActionMenu:(event,actions)=>window.termaTerminalActionMenu.open(event,()=>actions),
    beginUiAction:(...args)=>window.termaUiActions.begin(...args),endUiAction:(...args)=>window.termaUiActions.end(...args),
    setButtonBusy:(...args)=>window.termaUiActions.setButtonBusy(...args),
    captureUiState:(...args)=>window.termaUiSnapshots.capture(...args),restoreUiState:(...args)=>window.termaUiSnapshots.restore(...args),
    syncViewportHeight:(...args)=>window.termaViewport.sync(...args),
    beginNativeFileDialogViewport:()=>window.termaViewport.beginFileDialog(),
    settleNativeFileDialogViewport:()=>window.termaViewport.settleFileDialog()
  };
  for(const [name,callback]of Object.entries(wrappers))if(!window[name])window[name]=callback;
  if(!window.esc)window.esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  for(const key of Object.keys(state))if(!Object.getOwnPropertyDescriptor(window,key))
    Object.defineProperty(window,key,{configurable:true,get:()=>state[key],set:value=>{state[key]=value;}});
  for(const [name,value]of Object.entries(window.termaWorkspaceDom||{}))window[name]=value;
  for(const [name,value]of Object.entries(window.termaConnectionSelection||{}))window[name]=value;
 })();\n`+source,...args);
});

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runMobileScenario } = require("./ui-smoke-mobile-scenario");
const { runMobileWorkspaceUiScenario } = require("./mobile-workspace-ui-scenario");
const {runMobileLayoutUiScenario} = require('./mobile-layout-ui-scenario');
const { runFnosUpdatesUiScenario } = require("./fnos-updates-ui-scenario");
const {loadUpdateFixture} = require("./update-ui-fixture");
const {verifyLanguageOnboarding} = require("./language-onboarding-ui-scenario");
const { runFnosDescriptionUiScenario } = require("./fnos-description-ui-scenario");
const { runOriginProtocolUiScenario } = require("./origin-protocol-ui-scenario");
const { runVisualRegression } = require("./ui-visual-regression");
const { runIssueUiScenario } = require("./issue-ui-scenario");
const { replayAppearanceBootstrap } = require('./appearance-ui-fixture');
const { runManagedKeysUiScenario } = require("./managed-keys-ui-scenario");
const { runSettingsUiScenario } = require("./settings-ui-scenario");
const { runSshHostTrustUiScenario } = require("./ssh-host-trust-ui-scenario");
const { runFormControlsUiScenario } = require("./form-controls-ui-scenario");
const { runTerminalViewportUiScenario } = require("./terminal-viewport-ui-scenario");
const { runNotificationPresentationUiScenario } = require("./notification-presentation-ui-scenario");
const { runUiInteractionUiScenario } = require("./ui-interaction-ui-scenario");
const { runSystemNotificationUiScenario } = require("./system-notification-ui-scenario");
const { runApplicationLifecycleUiScenario } = require("./application-lifecycle-ui-scenario");
const { runTerminalTransportUiScenario } = require("./terminal-transport-ui-scenario");
const { runWorkspaceShellUiScenario } = require("./workspace-shell-ui-scenario");
const { runOperationSurfaceUiScenario } = require('./operation-surface-ui-scenario');
const { runWebFilesUiScenario, runLocalFilesToolbarUiScenario } = require("./web-files-ui-scenario");
const { runSftpRenameUiScenario } = require("./sftp-rename-ui-scenario");
const {installSftpDomFixtures}=require('./sftp-dom-fixtures');
const {attachWorkspaceBrowserFixture}=require('./workspace-browser-fixture');
const { runSftpEditorBrowserScenario } = require('./sftp-editor-ui-scenario');
const { runWebFilesRealUiScenario } = require("./web-files-real-ui-scenario");
const { runWebFilesDeliveryUiScenario } = require("./web-files-delivery-ui-scenario");
const { runQuickUiScenario } = require("./quick-ui-scenario");
const {runX11UiScenario}=require('./m7-x11-ui-scenario');
const {runAssistantUiScenario}=require('./m8-assistant-ui-scenario');
const {runSessionEfficiencyUiScenario}=require('./m8-session-efficiency-ui-scenario');
const {runEfficiencyUiScenario}=require('./m8-efficiency-ui-scenario');
const {runSnippetsUiScenario}=require('./m8-snippets-ui-scenario');
const {runClipboardFlowUiScenario}=require('./vnc-clipboard-flow-ui-scenario');
const { runHeaderUiScenario } = require("./header-ui-scenario");
const { runTaskUiScenario } = require("./task-ui-scenario");
const { runConnectionsUiScenario } = require("./connections-ui-scenario");
const { runRemoteUiScenario } = require("./remote-ui-scenario");
const { captureElectronSurface } = require('./electron-surface-screenshot');
const { runRemoteGraphicsUiScenario } = require("./remote-graphics-ui-scenario");
const { runRemoteManagementUiScenario } = require("./remote-management-ui-scenario");
const { runTerminalPersistenceUiScenario } = require("./terminal-persistence-ui-scenario");
const { runTerminalSettingsUiScenario } = require("./terminal-settings-ui-scenario");
const { runTerminalStartupUiScenario } = require("./terminal-startup-ui-scenario");
const { runTerminalToolbarUiScenario } = require("./terminal-toolbar-ui-scenario");
const { runTerminalPanelUiScenario } = require("./terminal-panel-ui-scenario");
const { runTerminalZmodemUiScenario } = require("./terminal-zmodem-ui-scenario");
const {runTerminalTextUiScenario}=require('./terminal-text-ui-scenario');
const { runTerminalImagePasteUiScenario } = require("./terminal-image-paste-ui-scenario");
const { runSftpVueUiScenario } = require("./sftp-vue-ui-scenario");
const { runM6OperationsUiScenario } = require('./m6-operations-ui-scenario');
const { runM6AutomationsUiScenario } = require('./m6-automations-ui-scenario');
const { runM6RunningUiScenario } = require('./m6-running-ui-scenario');
const { runM6ForwardPagesUiScenario } = require('./m6-forward-pages-ui-scenario');
const { runM6LogReaderUiScenario } = require('./m6-log-reader-ui-scenario');
const { runM7ListUiScenario } = require('./m7-list-ui-scenario');
const {runM7ManagementUiScenario}=require('./m7-management-ui-scenario');
const { runM7ProfileUiScenario } = require('./m7-profile-ui-scenario');
const { runM6ExchangeUiScenario } = require('./m6-exchange-ui-scenario');
const { runM6LogListUiScenario } = require('./m6-log-list-ui-scenario');
const { runM6BatchUiScenario } = require('./m6-batch-ui-scenario');
const { runSftpDialogUiScenario } = require("./sftp-dialog-ui-scenario");
const { runSftpGlobalSettingsUiScenario } = require("./sftp-global-settings-ui-scenario");
const { runImagePreviewUiScenario } = require("./image-preview-ui-scenario");
const { runI18nResourcesUiScenario } = require("./i18n-resources-ui-scenario");

const url = process.env.TERMA_CHECK_URL || process.env.TUNNELDESK_CHECK_URL || "http://127.0.0.1:8099";
const errors = [];
const ignorableConsoleMessage = message => String(message || '').startsWith('[terminal-input] released focus target');
const cspViolations = [];
let smokeWindow = null;
const smokeStartedAt=Date.now();let smokeLastStage='';
const smokeProgress=setInterval(async()=>{try{const stage=await smokeWindow?.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage||''");if(stage&&stage!==smokeLastStage){smokeLastStage=stage;console.log(`[ui-smoke +${Math.round((Date.now()-smokeStartedAt)/1000)}s] ${stage}`);}}catch{}},10000);
smokeProgress.unref();
let rendererFailure = null;
const smokeUserData = process.env.TERMA_UI_USER_DATA || process.env.TUNNELDESK_UI_USER_DATA || path.join(os.tmpdir(), `terma-ui-smoke-${process.pid}`);
const screenshotEnabled = (process.env.TERMA_UI_SCREENSHOT || process.env.TUNNELDESK_UI_SCREENSHOT) === "1";
const notificationScreenshotEnabled = (process.env.TERMA_UI_NOTIFICATION_SCREENSHOT || process.env.TUNNELDESK_UI_NOTIFICATION_SCREENSHOT) === "1";
const diagnosticsDirectory = path.resolve(process.env.TERMA_UI_DIAGNOSTICS_DIR || path.join(process.cwd(), "data"));
if (screenshotEnabled || notificationScreenshotEnabled) {
  fs.mkdirSync(diagnosticsDirectory, { recursive: true });
}
ipcMain.on("terma-ui-smoke:csp-violation", (_event, violation) => {
  const item = violation && typeof violation === "object" ? violation : {};
  cspViolations.push(item);
  errors.push(`CSP violation: ${item.effectiveDirective || item.violatedDirective || "unknown"} blocked ${item.blockedURI || "unknown"}${item.sourceFile ? ` (${item.sourceFile}:${item.lineNumber || 0})` : ""}`);
});
app.disableHardwareAcceleration();
app.setPath("userData", smokeUserData);
const smokeTimeoutMs = Math.max(180000, Number(process.env.TERMA_UI_SMOKE_TIMEOUT_MS) || 300000);
const smokeWatchdog = setTimeout(async () => {
  let stage = "unknown";
  try {
    stage = await Promise.race([
      smokeWindow?.webContents.executeJavaScript("JSON.stringify({stage:document.documentElement.dataset.uiSmokeStage||'unknown',modal:document.querySelector('#modal h2')?.textContent,dialog:window.termaSftpDialogs?.active(),editorCount:document.querySelectorAll('.sftp-editor-floating-window').length,active:document.activeElement?.id})"),
      new Promise(resolve => setTimeout(() => resolve("renderer-unresponsive"), 1000))
    ]);
  } catch {}
  console.error(`UI 冒烟超过 ${Math.round(smokeTimeoutMs / 1000)} 秒仍未完成，停留阶段：${stage}`);
  app.exit(1);
}, smokeTimeoutMs);

app.whenReady().then(async () => {
  app.on('browser-window-created', (_event, created) => attachWorkspaceBrowserFixture(created));
  await session.defaultSession.clearCache();
  const offscreenScenarios = [
    "settings","workspace-shell","operation-surfaces","quick","header","tasks","connections","remote","m7-transport","remote-graphics","remote-management",
    "terminal-persistence","terminal-settings","terminal-toolbar","terminal-zmodem","terminal-startup","terminal-transport",
    "terminal-viewport","sftp-vue","sftp-dialogs","sftp-editor","web-files","i18n-resources",
    "notification-presentation","ui-interaction"
  ];
  const window = new BrowserWindow({
    show:false,
    width:1200,
    height:800,
    webPreferences:{
      contextIsolation:true,
      backgroundThrottling:false,
      offscreen:process.env.TERMA_UI_OFFSCREEN === "1" || offscreenScenarios.includes(process.env.TERMA_UI_SCENARIO),
      preload:path.join(__dirname, "ui-smoke-preload.js")
    }
  });
  smokeWindow = window;
  if(process.env.TERMA_UI_SCENARIO==="terminal-panel"){
    const local=require("../desktop/local-terminal").createLocalTerminals({ipcMain,allowed:event=>
      event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&
      new URL(event.sender.getURL()).origin===new URL(url).origin});
    app.on("before-quit",()=>local.dispose());
  }
  const evaluateForSmoke = window.webContents.executeJavaScript.bind(window.webContents);
  window.webContents.executeJavaScript = async (...args) => {
    const caller = new Error('Browser evaluation call site').stack;
    try { return await evaluateForSmoke(...args); }
    catch (error) { if (String(error?.message || error).includes('Failed to fetch')) console.error('[ui-smoke network evaluation]', caller); throw error; }
  };
  session.defaultSession.webRequest.onErrorOccurred(details => {
    if (details.error === 'net::ERR_ABORTED') return;
    let route = ''; try { route = new URL(details.url).pathname; } catch {}
    console.error('[ui-smoke network request]', JSON.stringify({route, error:details.error, resource:details.resourceType}));
  });
  window.webContents.on("console-message", details => {
    if (["warning", "error"].includes(details.level) && !ignorableConsoleMessage(details.message)) {
      errors.push(`${details.message}${details.sourceId ? ` (${details.sourceId}:${details.lineNumber || 0})` : ""}`);
    }
  });
  window.webContents.on("did-fail-load", (_event, code, description) => errors.push(`${code}: ${description}`));
  window.webContents.on("render-process-gone", (_event, details) => {
    rendererFailure = {reason:details.reason, exitCode:details.exitCode};
    errors.push(`renderer process gone: ${details.reason} (${details.exitCode})`);
  });
  await window.loadURL(url);
  await new Promise(resolve => setTimeout(resolve, 1200));
  console.log("[ui-smoke] page loaded");
  await window.webContents.executeJavaScript(`window.addEventListener('error',event=>{
    const sessions=typeof window.termaTerminalState.terminalSessions==='undefined'?[]:[...window.termaTerminalState.terminalSessions].filter(([,session])=>!session.term||!session.term.options).map(([key])=>key);
    console.error('[ui-smoke browser error]',JSON.stringify({stage:document.documentElement.dataset.uiSmokeStage,stack:event.error?.stack,incompleteSessions:sessions}));
  });`);
    const bootstrap = await window.webContents.executeJavaScript(`(async()=>{
      const deadline=Date.now()+15000;
      while(Date.now()<deadline){
        const snapshot=window.termaBootstrapRuntime?.getSnapshot();
        if(snapshot?.phase==='ready'||snapshot?.phase==='failed')return snapshot;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      return {phase:window.termaBootstrapRuntime?.getSnapshot().phase||'unavailable'};
    })()`);
    if(bootstrap.phase!=='ready')throw new Error(`TypeScript bootstrap did not complete: ${bootstrap.phase}`);
    console.log("[ui-smoke] typed bootstrap ready");
  await window.webContents.executeJavaScript(`(()=>{if(!window.sendTerminalData&&window.termaTerminalInputActions)window.sendTerminalData=(...args)=>window.termaTerminalInputActions.sendTerminalData(...args);if(!window.focusTerminalSession&&window.termaTerminalPage)window.focusTerminalSession=(...args)=>window.termaTerminalPage.focusTerminalSession(...args);return null})()`);
  if(process.env.TERMA_UI_SCENARIO==='terminal-panel'){
    console.log(await runTerminalPanelUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO==='terminal-text'){
    console.log(await runTerminalTextUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO==='i18n-resources'){
    console.log(await runI18nResourcesUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(!process.env.TERMA_UI_SCENARIO||process.env.TERMA_UI_SCENARIO==='base')await window.webContents.executeJavaScript('('+installSftpDomFixtures.toString()+')()');
  if(process.env.TERMA_UI_SCENARIO === 'terminal-toolbar') {
    console.log(await runTerminalToolbarUiScenario(window, {viewport:'desktop'}));
    const mobile=new BrowserWindow({show:false,width:390,height:844,webPreferences:{contextIsolation:true,backgroundThrottling:false,offscreen:true,preload:path.join(__dirname,'ui-smoke-preload.js')}});
    mobile.webContents.on('console-message', details => {
      if (['warning','error'].includes(details.level) && !ignorableConsoleMessage(details.message)) errors.push(details.message);
    });
    try {
      await mobile.loadURL(url);
      await new Promise(resolve=>setTimeout(resolve,1200));
      console.log(await runTerminalToolbarUiScenario(mobile, {viewport:'mobile'}));
    } finally {mobile.destroy();}
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(['terminal-zmodem','terminal-image-paste'].includes(process.env.TERMA_UI_SCENARIO)) {
    const scenario=process.env.TERMA_UI_SCENARIO==='m6-batch'?runM6BatchUiScenario:process.env.TERMA_UI_SCENARIO==='terminal-zmodem'?runTerminalZmodemUiScenario:runTerminalImagePasteUiScenario;
    console.log(await scenario(window, {viewport:'desktop'}));
    const mobile=new BrowserWindow({show:false,width:390,height:844,webPreferences:{contextIsolation:true,backgroundThrottling:false,offscreen:true,preload:path.join(__dirname,'ui-smoke-preload.js')}});
    mobile.webContents.on('console-message', details => {
      if (['warning','error'].includes(details.level)) errors.push(details.message);
    });
    try {
      await mobile.loadURL(url);
      await new Promise(resolve=>setTimeout(resolve,1200));
      console.log(await scenario(mobile, {viewport:'mobile'}));
    } finally { mobile.destroy(); }
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO==='sftp-global-settings') {
    console.log(await runSftpGlobalSettingsUiScenario(window,{viewport:'desktop'}));
    const mobile=new BrowserWindow({show:false,width:390,height:844,webPreferences:{contextIsolation:true,backgroundThrottling:false,offscreen:true,preload:path.join(__dirname,'ui-smoke-preload.js')}});
    mobile.webContents.on('console-message', details=>{if(['warning','error'].includes(details.level))errors.push(details.message);});
    try {await mobile.loadURL(url);await new Promise(resolve=>setTimeout(resolve,1200));console.log(await runSftpGlobalSettingsUiScenario(mobile,{viewport:'mobile'}));}
    finally {mobile.destroy();}
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(['sftp-vue','sftp-dialogs','sftp-editor','m6-operations','m6-automations','m6-running','m6-forward-pages','m6-batch','m6-log-list','m6-log-reader','m6-exchange','m7-profile','m7-list','m7-management'].includes(process.env.TERMA_UI_SCENARIO)) {
    const scenario=process.env.TERMA_UI_SCENARIO==='m7-management'?runM7ManagementUiScenario:process.env.TERMA_UI_SCENARIO==='m7-list'?runM7ListUiScenario:process.env.TERMA_UI_SCENARIO==='m7-profile'?runM7ProfileUiScenario:process.env.TERMA_UI_SCENARIO==='m6-exchange'?runM6ExchangeUiScenario:process.env.TERMA_UI_SCENARIO==='m6-log-reader'?runM6LogReaderUiScenario:process.env.TERMA_UI_SCENARIO==='m6-log-list'?runM6LogListUiScenario:process.env.TERMA_UI_SCENARIO==='m6-batch'?runM6BatchUiScenario:process.env.TERMA_UI_SCENARIO==='m6-forward-pages'?runM6ForwardPagesUiScenario:process.env.TERMA_UI_SCENARIO==='m6-running'?runM6RunningUiScenario:process.env.TERMA_UI_SCENARIO==='m6-automations'?runM6AutomationsUiScenario:process.env.TERMA_UI_SCENARIO==='m6-operations'?runM6OperationsUiScenario:process.env.TERMA_UI_SCENARIO==='sftp-editor'?runSftpEditorBrowserScenario:process.env.TERMA_UI_SCENARIO==='sftp-dialogs'?runSftpDialogUiScenario:runSftpVueUiScenario;
    if(process.env.TERMA_UI_SCENARIO!=='m6-automations'||process.env.TERMA_AUTOMATIONS_VIEWPORT!=='mobile')console.log(await scenario(window,{viewport:'desktop'}));
    const mobile=new BrowserWindow({show:false,width:390,height:844,webPreferences:{contextIsolation:true,backgroundThrottling:false,offscreen:true,preload:path.join(__dirname,'ui-smoke-preload.js')}});
    mobile.webContents.on('console-message', details=>{if(['warning','error'].includes(details.level))errors.push(details.message);});
    try {await mobile.loadURL(url);await new Promise(resolve=>setTimeout(resolve,1200));console.log(await scenario(mobile,{viewport:'mobile'}));}
    finally {mobile.destroy();}
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'terminal-settings') {
    console.log(await runTerminalSettingsUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'terminal-startup') {
    console.log(await runTerminalStartupUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'terminal-persistence') {
    console.log(await runTerminalPersistenceUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO==='vnc-clipboard-flow'){
    console.log(await runClipboardFlowUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO==='terminal-drop'){console.log(await runTerminalDropUiScenario(window));if(errors.length)throw Error(errors.join('\n'));clearTimeout(smokeWatchdog);app.exit(0);return;}
  if(process.env.TERMA_UI_SCENARIO==='m8-assistant'){console.log(await runAssistantUiScenario(window));if(errors.length)throw Error(errors.join('\n'));clearTimeout(smokeWatchdog);app.exit(0);return;}
  if(process.env.TERMA_UI_SCENARIO==='m8-session-efficiency'){console.log(await runSessionEfficiencyUiScenario(window));if(errors.length)throw Error(errors.join('\n'));clearTimeout(smokeWatchdog);app.exit(0);return;}
  if(process.env.TERMA_UI_SCENARIO==='m8-efficiency'){console.log(await runEfficiencyUiScenario(window));if(errors.length)throw Error(errors.join('\n'));clearTimeout(smokeWatchdog);app.exit(0);return;}
  if(process.env.TERMA_UI_SCENARIO==='m8-snippets'){
    console.log(await runSnippetsUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO==='m7-x11'){
    console.log(await runX11UiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(['remote','m7-transport'].includes(process.env.TERMA_UI_SCENARIO)) {
    const report=await runRemoteUiScenario(window,{transportOnly:process.env.TERMA_UI_SCENARIO==='m7-transport'});
    console.log({screenshots:report.screenshots,checks:report.checks,states:report.states.length});
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(['remote-graphics','remote-management'].includes(process.env.TERMA_UI_SCENARIO)) {
    const directory=process.env.TERMA_REMOTE_VISUAL_DIR || path.join(diagnosticsDirectory,"remote-visual");
    fs.mkdirSync(directory,{recursive:true});
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const execute=source=>window.webContents.executeJavaScript(/^\s*\(async/.test(source)?source:`(async()=>{${source}})()`);
    const evaluate=source=>execute(`return (${source})`);
    const wait=async condition=>{for(let attempt=0;attempt<750;attempt++){if(await execute(`return !!(${condition})`))return;await delay(20);}const state=await execute(`return {condition:${JSON.stringify(condition)},protocol:window.__protocolResult,done:window.__protocolDone,requests:window.__managementRequests?.length,modal:document.querySelector('#modal')?.innerText?.slice(0,500),activeView,primaryView};`);throw new Error(`Remote graphics UI timed out waiting for ${JSON.stringify(state)}`);};
    const shot=name=>captureElectronSurface(window,path.join(directory,`${name}.png`));
    const click=async selector=>{const point=await execute(`const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('Missing '+${JSON.stringify(selector)});element.scrollIntoView({block:'nearest'});const r=element.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}`);for(const type of ["mouseMove","mouseDown","mouseUp"]){window.webContents.sendInputEvent({type,...point,button:"left",clickCount:1});await delay(20);}};
    const assertions=[];
    const run=process.env.TERMA_UI_SCENARIO==='remote-management'?runRemoteManagementUiScenario:runRemoteGraphicsUiScenario;
    const report=await run(window,{execute,evaluate,wait,shot,click,assertions});
    fs.writeFileSync(path.join(directory,process.env.TERMA_UI_SCENARIO+'-report.json'),JSON.stringify({...report,assertions},null,2));
    console.log({screenshots:Array.isArray(report.screenshots)?report.screenshots.length:report.screenshots,checks:assertions.length,...(Array.isArray(report.states)?{states:report.states.length}:{})});
    if(errors.length)throw new Error(errors.join("\n"));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'connections') {
    console.log(await runConnectionsUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'tasks') {
    console.log(await runTaskUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'header') {
    await runHeaderUiScenario(window);
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'workspace-shell') {
    await runWorkspaceShellUiScenario(window);
    await runOperationSurfaceUiScenario(window);
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'operation-surfaces') {
    await runOperationSurfaceUiScenario(window);
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'settings') {
    await runSettingsUiScenario(window);
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'ssh-host-trust') {
    console.log(await runSshHostTrustUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'notification-presentation') {
    console.log(await runNotificationPresentationUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'ui-interaction') {
    console.log(await runUiInteractionUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'system-notification') {
    console.log(await runSystemNotificationUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'application-lifecycle') {
    console.log(await runApplicationLifecycleUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'terminal-transport') {
    console.log(await runTerminalTransportUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'form-controls') {
    console.log(await runFormControlsUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'terminal-viewport') {
    console.log(await runTerminalViewportUiScenario(window));
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if (["quick", "quick-views"].includes(process.env.TERMA_UI_SCENARIO)) {
    try { console.log("[ui-smoke] quick views", await runQuickUiScenario(window, {includeSharedScenarios:process.env.TERMA_UI_SCENARIO === "quick"})); }
    catch (error) { console.error(errors.join("\n")); throw error; }
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if (process.env.TERMA_UI_SCENARIO === "issue-ui") {
    await runIssueUiScenario(window);
    if (errors.length) throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);
    app.exit(0);
    return;
  }
  if (process.env.TERMA_UI_SCENARIO === "origin-protocol") {
    await runOriginProtocolUiScenario(window);
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if (process.env.TERMA_UI_SCENARIO === "fnos-description") {
    await runFnosDescriptionUiScenario(window);
    clearTimeout(smokeWatchdog);
    app.exit(0);
    return;
  }
  if (process.env.TERMA_UI_SCENARIO === "language-onboarding") {
    const proof = process.env.TERMA_LANGUAGE_ONBOARDING_PROOF_DIR;
    for (const width of [392,1200]) for (const theme of ['light','dark']) {
      window.setSize(width,800);
      await new Promise(resolve=>setTimeout(resolve,80));
      await window.webContents.executeJavaScript(`applyTheme(${JSON.stringify(theme)})`);
      const result = await verifyLanguageOnboarding(window,{proof:proof && path.join(proof,`${width}-${theme}`)});
      console.log('Language onboarding',width,theme,JSON.stringify(result));
      if (Object.values(result).some(value=>!value)) throw new Error('Language onboarding behavior failed');
    }
    if(errors.length)throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if (process.env.TERMA_UI_SCENARIO === "fnos-updates") {
    await runFnosUpdatesUiScenario(window);
    clearTimeout(smokeWatchdog);
    app.exit(0);
    return;
  }
  if (process.env.TERMA_UI_SCENARIO === "mobile-workspace") {
    try { await runMobileWorkspaceUiScenario(window); }
    catch (error) { console.error(errors.join("\n")); throw error; }
    clearTimeout(smokeWatchdog);
    app.exit(0);
    return;
  }
  if (process.env.TERMA_UI_SCENARIO === 'mobile-layout') {
    await runMobileLayoutUiScenario(window);
    if(errors.length)throw Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'web-files-real') {
    await runWebFilesRealUiScenario(window);clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if(process.env.TERMA_UI_SCENARIO === 'local-files-toolbar') {
    await runLocalFilesToolbarUiScenario(window);clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if (process.env.TERMA_UI_SCENARIO === "managed-keys") {
    await runManagedKeysUiScenario(window);
    clearTimeout(smokeWatchdog);
    app.exit(0);
    return;
  }
  if (process.env.TERMA_UI_SCENARIO === "image-preview") {
    await runImagePreviewUiScenario(window);
    clearTimeout(smokeWatchdog);app.exit(0);return;
  }
  if (process.env.TERMA_UI_SCENARIO === "web-files") {
    await runLocalFilesToolbarUiScenario(window);
    await runWebFilesUiScenario(window);
    await runSftpRenameUiScenario(window);
    await runWebFilesDeliveryUiScenario(window);
    clearTimeout(smokeWatchdog);
    app.exit(0);
    return;
  }
  // Receive fixtures use their own workspace so they cannot leave tabs or
  // asynchronous settings renderers behind in the integration window.
  const deliveryWindow = new BrowserWindow({
    show:false, width:1200, height:800,
    webPreferences:{contextIsolation:true, backgroundThrottling:false, preload:path.join(__dirname,"ui-smoke-preload.js")}
  });
  deliveryWindow.webContents.on("console-message", details => {
    if (["warning","error"].includes(details.level)) errors.push(details.message);
  });
  try {
    await deliveryWindow.loadURL(url);
    await deliveryWindow.webContents.executeJavaScript(`(async () => {
      await window.termaI18nReady;
      for (let attempt=0;window.workspaceRestorePending && attempt<100;attempt++) await new Promise(resolve=>setTimeout(resolve,20));
      if (window.workspaceRestorePending) throw new Error("Receive fixture initialization timed out");
      return true;
    })()`);
    await runWebFilesDeliveryUiScenario(deliveryWindow);
  } finally { deliveryWindow.destroy(); }
  const mobileNavigationWindow = new BrowserWindow({
    show:false, width:390, height:844,
    webPreferences:{contextIsolation:true, backgroundThrottling:false, partition:"mobile-workspace-smoke", preload:path.join(__dirname,"ui-smoke-preload.js")}
  });
  mobileNavigationWindow.webContents.on("console-message", details => {
    if (["warning", "error"].includes(details.level)) errors.push(details.message);
  });
  try {
    await mobileNavigationWindow.loadURL(url);
    await runMobileWorkspaceUiScenario(mobileNavigationWindow);
    await runFnosUpdatesUiScenario(mobileNavigationWindow);
    await runOriginProtocolUiScenario(mobileNavigationWindow);
    await runFnosDescriptionUiScenario(mobileNavigationWindow);
  } catch (error) { console.error(errors.join("\n")); throw error; }
  finally { mobileNavigationWindow.destroy(); }
  console.log("[ui-smoke] language onboarding");
  window.setSize(392, 800);
  await new Promise(resolve => setTimeout(resolve, 80));
  const languageOnboardingUi = await verifyLanguageOnboarding(window);
  window.setSize(1200, 800);
  let desktopViewportReady = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 50));
    desktopViewportReady = await window.webContents.executeJavaScript("window.innerWidth > 760 && !isMobileLayout()");
    if (desktopViewportReady) break;
  }
  if (!desktopViewportReady) throw new Error("语言引导窄屏检查后未恢复桌面视口");
  await window.webContents.executeJavaScript(`(async () => {
    // The onboarding scenario intentionally exercises the non-mainland English
    // default. Keep the legacy geometry and interaction scenarios on their
    // explicit Chinese baseline; English coverage runs in the dedicated i18n
    // scenario below and must not make localized selectors data-dependent.
    await setTermaLanguage('zh-CN', {emit:false});
    syncResponsivePane();
  })()`);
  console.log("[ui-smoke] noVNC module");
  const noVncModuleUi = await window.webContents.executeJavaScript(`(async () => {
    const RFB = await window.termaVncRuntime.loadRfb();
    return {
      loaded:typeof RFB === 'function',
      named:Boolean(RFB?.name),
      prototype:Boolean(RFB?.prototype)
    };
  })()`);
  console.log("[ui-smoke] ZMODEM module");
  const zmodemModuleUi = await window.webContents.executeJavaScript(`(async () => {
    const Zmodem = await window.termaTerminalZmodem.ensureLibrary();
    return {
      loaded:Boolean(Zmodem?.Sentry),
      browser:Boolean(Zmodem?.Browser?.send_files),
      abortSequence:Boolean(Zmodem?.ZMLIB?.ABORT_SEQUENCE?.length)
    };
  })()`);
  await window.webContents.executeJavaScript(`(() => {
    window.__uiSmokeRealLoadAll = window.termaWorkspaceRefresh.load;
    // Keep background polling from crossing the temporary API fixtures below.
    // SFTP job refresh behavior is exercised explicitly in the dedicated checks.
    if (sftpJobsTimer) {
      window.termaSftpTransferLifecycle.polling.stop();
    }
    const fixtureConnection = {
      id: 900001,
      name: 'UI Smoke',
      group_name: 'UI Smoke',
      ssh_host: '127.0.0.1',
      ssh_port: 22,
      ssh_user: 'tester',
      tags: '',
      forwards: [{
        id: 900001,
        connection_id: 900001,
        mode: 'local',
        service_name: 'UI Smoke Web',
        service_type: 'web',
        url_scheme: 'http',
        url_path: '/admin',
        bind_host: '127.0.0.1',
        bind_port: 18099,
        target_host: '127.0.0.1',
        target_port: 80,
        status: 'running',
        reconnect_count: 0
      }]
    };
    const fixtureIndex = connections.findIndex(item => Number(item?.id) === fixtureConnection.id);
    if (fixtureIndex >= 0) connections.splice(fixtureIndex, 1);
    connections.unshift(fixtureConnection);
    groupOpen.add('UI Smoke');
    window.termaConnectionViews.renderConnections();
    // Keep the in-memory fixture stable when the isolated test service has no records.
    window.termaWorkspaceRefresh.load = async () => {};
  })()`);
  console.log("[ui-smoke] base layout");
  const result = await window.webContents.executeJavaScript(`(() => {
    const activity = document.querySelector('.activity');
    const activityRect = activity?.getBoundingClientRect();
    const activityItems = [...document.querySelectorAll('.activity-top > button, .activity-bottom > button, .activity-bottom > a')].map(item => {
      const itemRect = item.getBoundingClientRect();
      const iconRect = item.querySelector('svg')?.getBoundingClientRect();
      return {
        id: item.id || 'github',
        itemCenter: itemRect.left + itemRect.width / 2,
        iconCenter: iconRect ? iconRect.left + iconRect.width / 2 : NaN,
        iconDelta: iconRect ? Math.abs((iconRect.left + iconRect.width / 2) - (itemRect.left + itemRect.width / 2)) : Infinity,
        insideColumn: Boolean(activityRect && itemRect.left >= activityRect.left - 0.5 && itemRect.right <= activityRect.right + 0.5)
      };
    });
    const baseline = activityItems[0]?.itemCenter;
    const activityHandle = document.querySelector('#activityBarResize');
    const activityStoredBefore = localStorage.getItem('activityBarWidth');
    const activityWidthBefore = window.termaWorkspaceChrome.value('activity');
    let activityResizable = false;
    if (activityHandle) {
      const handleRect = activityHandle.getBoundingClientRect();
      const startX = handleRect.left + handleRect.width / 2;
      activityHandle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:91,pointerType:'mouse',button:0,clientX:startX,clientY:handleRect.top+20}));
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:91,pointerType:'mouse',button:0,clientX:startX+1000,clientY:handleRect.top+20}));
      window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:91,pointerType:'mouse',button:0,clientX:startX+1000,clientY:handleRect.top+20}));
      const pointerMax = window.termaWorkspaceChrome.value('activity') === 64
        && Number(localStorage.getItem('activityBarWidth')) === 64
        && !document.body.classList.contains('activity-bar-resizing');
      activityHandle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Home'}));
      const keyboardMin = window.termaWorkspaceChrome.value('activity') === 36
        && Math.abs(activity.getBoundingClientRect().width-36) <= 0.5;
      activityHandle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowRight',shiftKey:true}));
      const keyboardStep = window.termaWorkspaceChrome.value('activity') === 36 + 4;
      activityHandle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
      const keyboardMax = window.termaWorkspaceChrome.value('activity') === 64;
      activityHandle.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
      const doubleClickReset = window.termaWorkspaceChrome.value('activity') === 40
        && Number(localStorage.getItem('activityBarWidth')) === 40
        && Math.abs(activity.getBoundingClientRect().width-40) <= 0.5;
      activityResizable = getComputedStyle(activityHandle).display !== 'none'
        && handleRect.width >= 6
        && activityHandle.getAttribute('aria-orientation') === 'vertical'
        && Number(activityHandle.getAttribute('aria-valuemin')) === 36
        && Number(activityHandle.getAttribute('aria-valuemax')) === 64
        && Number(activityHandle.getAttribute('aria-valuenow')) === 40
        && pointerMax && keyboardMin && keyboardStep && keyboardMax && doubleClickReset;
    }
    window.termaWorkspaceChrome.apply('activity', activityWidthBefore,{fit:false});
    if (activityStoredBefore === null) localStorage.removeItem('activityBarWidth');
    else localStorage.setItem('activityBarWidth',activityStoredBefore);
    const operationPaneRect = document.querySelector('.left-pane')?.getBoundingClientRect();
    const connectionToolStrip = document.querySelector('#explorerTools .connection-action-strip');
    const connectionToolStripRect = connectionToolStrip?.getBoundingClientRect();
    const connectionToolButtons = [...(connectionToolStrip?.querySelectorAll('button') || [])].map(button=>button.getBoundingClientRect());
    const connectionFooter = document.querySelector('.conn-footer');
    const connectionFooterRect = connectionFooter?.getBoundingClientRect();
    const connectionActionButtons = [...document.querySelectorAll('.conn-actions > button')];
    const connectionHasSftpAction = Boolean(document.querySelector('.conn-actions button[title="打开 SFTP 文件管理"]'));
    const quickConnectButton = document.querySelector('.workspace-quick-connect-button');
    window.termaQuickViews.openQuickConnectionLauncher();
    const quickConnectModal = document.querySelector('.quick-connection-modal');
    const quickConnectTable = document.querySelector('.quick-connection-table');
    const quickConnectHeadings = [...document.querySelectorAll('.quick-connection-columns > span')];
    const quickConnectRow = document.querySelector('.quick-connection-row');
    const quickConnectCells = quickConnectRow ? [...quickConnectRow.children].map(item=>item.getBoundingClientRect()) : [];
    const quickConnectHeadingRects = quickConnectHeadings.map(item=>item.getBoundingClientRect());
    let quickActionsPinned = false;
    let quickActionScrollMetrics = null;
    if (quickConnectTable && quickConnectRow) {
      quickConnectTable.style.width = '620px';
      const action = quickConnectRow.querySelector('.quick-connection-actions');
      quickConnectTable.scrollLeft = 0;
      const rightBeforeScroll = action?.getBoundingClientRect().right;
      quickConnectTable.scrollLeft = quickConnectTable.scrollWidth;
      const rightAfterScroll = action?.getBoundingClientRect().right;
      const tableRight = quickConnectTable.getBoundingClientRect().right;
      quickActionScrollMetrics = {
        position: action ? getComputedStyle(action).position : '',
        rightBeforeScroll,
        rightAfterScroll,
        tableRight,
        scrollWidth: quickConnectTable.scrollWidth,
        clientWidth: quickConnectTable.clientWidth,
        scrollLeft: quickConnectTable.scrollLeft
      };
      quickActionsPinned = Boolean(
        getComputedStyle(action).position === 'sticky'
        && Math.abs(Number(rightBeforeScroll)-tableRight) < 12
        && Math.abs(Number(rightAfterScroll)-tableRight) < 12
      );
      quickConnectTable.style.width = '';
      quickConnectTable.scrollLeft = 0;
    }
    const quickConnectionLauncher = Boolean(
      quickConnectButton
      && quickConnectModal?.getBoundingClientRect().width >= Math.min(1000, innerWidth-40)
      && quickConnectRow
      && quickConnectRow.querySelectorAll('.quick-connection-actions button').length === 3
      && quickConnectCells.length === 5
      && quickConnectHeadingRects.length === 5
      && quickConnectHeadingRects.slice(0,4).every((rect,index)=>Math.abs(rect.left-quickConnectCells[index].left)<2)
      && quickConnectCells.every(rect=>Math.abs((rect.top+rect.bottom)-(quickConnectCells[0].top+quickConnectCells[0].bottom))<4)
      && quickActionsPinned
    );
    const quickConnectionLayout = {
      modalWidth: quickConnectModal?.getBoundingClientRect().width || 0,
      requiredWidth: Math.min(1000, innerWidth-40),
      actionButtons: quickConnectRow?.querySelectorAll('.quick-connection-actions button').length || 0,
      rowCells: quickConnectCells.length,
      headingCells: quickConnectHeadingRects.length,
      headingDeltas: quickConnectHeadingRects.slice(0,4).map((rect,index)=>Math.abs(rect.left-(quickConnectCells[index]?.left || 0))),
      rowAligned: quickConnectCells.every(rect=>Math.abs((rect.top+rect.bottom)-(quickConnectCells[0].top+quickConnectCells[0].bottom))<4),
      actionsPinned: quickActionsPinned,
      actionScrollMetrics: quickActionScrollMetrics
    };
    const quickConnectionSearch = document.querySelector('#quickConnectionSearch');
    quickConnectionSearch.value = '/admin';
    window.termaQuickViews.renderQuickConnectionRows(quickConnectionSearch.value);
    const quickForwardRow = document.querySelector('.quick-forward-row');
    const quickForwardSearch = Boolean(
      quickForwardRow?.textContent.includes('UI Smoke Web')
      && quickForwardRow?.textContent.includes('UI Smoke · 127.0.0.1')
      && quickForwardRow?.textContent.includes('运行中')
      && quickForwardRow?.textContent.includes('http://127.0.0.1:18099/admin')
      && quickForwardRow?.querySelector('a[href="http://127.0.0.1:18099/admin"]')
      && quickForwardRow?.querySelector('[data-action="quick-forward-toggle"][data-forward-id="900001"]')
      && quickForwardRow?.dataset.forwardId === '900001'
    );
    window.termaEfficiency.palette.refresh('/admin');
    const quickCommandForward = [...document.querySelectorAll('#quickPanelResults .quick-result')].find(row => row.textContent.includes('UI Smoke Web'));
    const quickCommandForwardSearch = Boolean(
      quickCommandForward
      && quickCommandForward.textContent.includes('http://127.0.0.1:18099/admin')
      && quickCommandForward.querySelector('[data-action="quick-forward-toggle"][data-forward-id="900001"]')
      && quickCommandForward.querySelector('a[href="http://127.0.0.1:18099/admin"]')
    );
    window.termaEfficiency.palette.close();
    const forwardFixture=connections[0]?.forwards?.[0],managerView=$('view-forward-manager');
    const managerScope=window.termaWorkspacePaneScope.currentWorkspaceDomScope(),managerPreviousView=[...(managerScope?.querySelectorAll('.view')||[])].find(v=>!v.hidden);
    const forwardStorage={};for(const key of Object.keys(localStorage))if(key.startsWith('globalForward')||key.startsWith('connectionForward')){forwardStorage[key]=localStorage.getItem(key);localStorage.removeItem(key);}
    window.termaForwardPages.release();window.termaForwardPages.manage(managerView);
    if(managerPreviousView)managerPreviousView.hidden=true;managerView.hidden=false;
    const managerRunningCard=managerView.querySelector('[data-forward-id="900001"]');
    const globalForwardManager=!!(managerView.querySelector('.terma-forward-root')&&managerView.querySelectorAll('.forward-statistics button').length===5&&managerRunningCard?.querySelector('a[href="http://127.0.0.1:18099/admin"]'));
    const inside=node=>{const a=node.getBoundingClientRect(),b=managerView.getBoundingClientRect();return a.left>=b.left-.5&&a.right<=b.right+.5&&node.scrollWidth<=node.clientWidth+1;};
    const globalForwardStatsAligned=[...managerView.querySelectorAll('.forward-statistics button')].every(inside);
    const globalForwardToolbarAligned=[...managerView.querySelectorAll('.forward-filters select,.forward-search input')].every(inside);
    const globalForwardToolbarWideAligned=globalForwardToolbarAligned;
    const globalForwardWideGrid=[...managerView.querySelectorAll('.forward-rule-row')].every(inside);
    const forwardCardActionsAligned=[...managerView.querySelectorAll('.forward-row-actions button')].every(inside);
    const groupSelect=managerView.querySelector('[name="group_mode"]');groupSelect.value='ssh';groupSelect.dispatchEvent(new Event('change',{bubbles:true}));
    const groupedManager=!!(managerView.querySelector('.forward-group')&&managerView.querySelector('.forward-connection-group')&&managerView.querySelectorAll('.forward-drag-handle').length>=2);
    if(forwardFixture)forwardFixture.status='stopped';window.termaForwardPages.refresh();
    const globalForwardStoppedHidesAccess=!!managerView.querySelector('[data-forward-id="900001"]')&&!managerView.querySelector('[data-forward-id="900001"] .forward-address a');
    let forwardingPagination=false,connectionForwardPagination=false,singleForwardWideGrid=false;
    if(forwardFixture){
      const original=connections[0].forwards;connections[0].forwards=Array.from({length:13},(_,i)=>({...forwardFixture,id:900100+i,service_name:'UI Smoke Page '+i,status:'stopped'}));
      window.termaForwardPages.release();window.termaForwardPages.manage(managerView);
      forwardingPagination=managerView.querySelectorAll('.forward-rule-row').length===12&&!!managerView.querySelector('.forward-page-nav select');
      const view=$('view-forwards');window.termaForwardPages.connection(view,connections[0].id);view.hidden=false;managerView.hidden=true;
      connectionForwardPagination=view.querySelectorAll('.forward-rule-row').length===12&&!!view.querySelector('.forward-page-nav select');
      singleForwardWideGrid=[...view.querySelectorAll('.forward-rule-row')].every(n=>n.scrollWidth<=n.clientWidth+1);
      connections[0].forwards=original;view.hidden=true;
    }
    if(forwardFixture)forwardFixture.status='running';
    window.termaForwardPages.release();for(const key of Object.keys(localStorage))if(key.startsWith('globalForward')||key.startsWith('connectionForward'))localStorage.removeItem(key);for(const [key,value]of Object.entries(forwardStorage))localStorage.setItem(key,value);
    managerView.hidden=true;if(managerPreviousView)managerPreviousView.hidden=false;
    quickConnectionSearch.value = 'tester@198.51.100.25:2200';
    window.termaQuickViews.renderQuickConnectionRows(quickConnectionSearch.value);
    const quickSshCandidates = Boolean(
      document.querySelector('[data-action="quick-connect-direct"]')?.textContent.includes('tester@198.51.100.25:2200')
      && document.querySelector('[data-action="quick-connect-new"]')?.textContent.includes('新建 SSH 连接')
      && window.termaQuickSshService.parse('root@[2001:db8::1]:2222')?.port === 2222
      && window.termaQuickSshService.parse('example.test')?.port === 22
    );
    window.termaQuickViews.closeQuickConnectionLauncher();
    const originalSelectForDoubleClick = window.termaConnectionController.select;
    let doubleClickedConnectionId = 0;
    window.termaConnectionController.select = id => { doubleClickedConnectionId = Number(id); };
    document.querySelector('.conn-name-open')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
    window.termaConnectionController.select = originalSelectForDoubleClick;
    const connectionNameDoubleClickOpens = doubleClickedConnectionId === Number(connections[0]?.id || 0);
    const explorerTree = document.querySelector('#connectionGroups')?.closest('.tree');
    const compactOperationPane = Boolean(operationPaneRect&&operationPaneRect.width<=292.5&&operationPaneRect.width>=280);
    const compactConnectionTools = Boolean(connectionToolStripRect&&connectionToolButtons.length===5&&connectionToolButtons.every(rect=>Math.abs((rect.top+rect.bottom)-(connectionToolStripRect.top+connectionToolStripRect.bottom))<2&&rect.left>=connectionToolStripRect.left-0.5&&rect.right<=connectionToolStripRect.right+0.5));
    const compactConnectionRows = Boolean(connectionFooterRect&&connectionActionButtons.length===6&&connectionActionButtons.every(button=>{const rect=button.getBoundingClientRect();return !button.textContent.trim()&&rect.width<=30&&rect.left>=connectionFooterRect.left-0.5&&rect.right<=connectionFooterRect.right+0.5;}));
    const operationHandle = document.querySelector('#operationPaneResize');
    const operationStoredBefore = localStorage.getItem('operationPaneWidth');
    const operationWidthBefore = window.termaWorkspaceChrome.value('operation');
    let operationPaneResizable = false;
    if (operationHandle) {
      const handleRect = operationHandle.getBoundingClientRect();
      const startX = handleRect.left + handleRect.width / 2;
      operationHandle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:92,pointerType:'mouse',button:0,clientX:startX,clientY:handleRect.top+20}));
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:92,pointerType:'mouse',button:0,clientX:startX+1000,clientY:handleRect.top+20}));
      window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:92,pointerType:'mouse',button:0,clientX:startX+1000,clientY:handleRect.top+20}));
      const pointerMax = window.termaWorkspaceChrome.value('operation') === 520
        && Number(localStorage.getItem('operationPaneWidth')) === 520
        && !document.body.classList.contains('operation-pane-resizing');
      operationHandle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Home'}));
      const keyboardMin = window.termaWorkspaceChrome.value('operation') === 260
        && document.documentElement.classList.contains('operation-pane-narrow');
      operationHandle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowRight',shiftKey:true}));
      const keyboardStep = window.termaWorkspaceChrome.value('operation') === 260 + 16
        && !document.documentElement.classList.contains('operation-pane-narrow');
      operationHandle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
      const keyboardMax = window.termaWorkspaceChrome.value('operation') === 520;
      operationHandle.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
      const doubleClickReset = window.termaWorkspaceChrome.value('operation') === 292
        && Number(localStorage.getItem('operationPaneWidth')) === 292;
      operationPaneResizable = getComputedStyle(operationHandle).display !== 'none'
        && handleRect.width >= 6
        && operationHandle.getAttribute('aria-orientation') === 'vertical'
        && Number(operationHandle.getAttribute('aria-valuemin')) === 260
        && Number(operationHandle.getAttribute('aria-valuemax')) === 520
        && Number(operationHandle.getAttribute('aria-valuenow')) === 292
        && pointerMax && keyboardMin && keyboardStep && keyboardMax && doubleClickReset;
    }
    window.termaWorkspaceChrome.apply('operation', operationWidthBefore,{fit:false});
    if (operationStoredBefore === null) localStorage.removeItem('operationPaneWidth');
    else localStorage.setItem('operationPaneWidth',operationStoredBefore);
    const brandHeight = document.querySelector('.brand')?.getBoundingClientRect().height || 0;
    const topbarHeight = document.querySelector('.topbar')?.getBoundingClientRect().height || 0;
    const tabsHeight = document.querySelector('.tabs')?.getBoundingClientRect().height || 0;
    const workspacePaddingTop = parseFloat(getComputedStyle(document.querySelector('.workspace')).paddingTop) || 0;
    const groupActionButton = document.querySelector('.connection-group-menu-button');
    const groupHeadRow = document.querySelector('.connection-group-head-row');
    const groupHeadStyle = groupHeadRow ? getComputedStyle(groupHeadRow) : null;
    const connectionTree = document.querySelector('#connectionGroups');
    const connectionTreeRect = connectionTree?.getBoundingClientRect();
    const groupHeadRect = groupHeadRow?.getBoundingClientRect();
    const stickyGroupHeaders = Boolean(
      groupHeadStyle
      && groupHeadStyle.position === 'sticky'
      && parseFloat(groupHeadStyle.top) === 0
      && groupHeadStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'
      && groupHeadStyle.boxShadow === 'none'
    );
    const stickyGroupHeaderSealsTop = Boolean(
      connectionTree
      && connectionTreeRect
      && groupHeadRect
      && parseFloat(getComputedStyle(connectionTree).paddingTop) === 0
      && Math.abs(groupHeadRect.top - connectionTreeRect.top) <= 0.5
    );
    const forwardToggle = document.querySelector('.conn-actions .connection-forward-toggle');
    const forwardToggleRect = forwardToggle?.getBoundingClientRect();
    const connectionActionsRect = forwardToggle?.closest('.conn-actions')?.getBoundingClientRect();
    const originalPaneCollapsed = window.termaWorkspaceShell.isCollapsed();
    const originalPrimaryView = primaryView;
    const views=['connections','remote','running','command','import','logs','settings'];
    const originalPins = new Map(views.map(view=>[view,window.termaWorkspaceShell.isPinned(view)]));
    const originalPanePinnedStorage = localStorage.getItem('operationPanePinnedByViewV1');
    window.termaWorkspaceShell.setCollapsed(false);
    window.termaWorkspaceShell.showPrimary('connections');
    for(const view of views)window.termaWorkspaceShell.setPinned(true,view);
    const expandedContentWidth = document.querySelector('#content')?.getBoundingClientRect().width || 0;
    const brandMark = document.querySelector('.brand h1 .brand-mark');
    const collapsedBrandButton = document.querySelector('#operationPaneExpand');
    const collapsedBrandMark = collapsedBrandButton?.querySelector('.brand-mark');
    const expandedBrand = Boolean(brandMark)
      && getComputedStyle(brandMark).display !== 'none'
      && brandMark.getBoundingClientRect().width > 0
      && brandMark.getAttribute('src') === '/assets/terma-icon.png'
      && getComputedStyle(document.querySelector('.brand-name-full')).display !== 'none'
      && getComputedStyle(document.querySelector('#operationPaneCollapse')).display !== 'none';
    const paneExpanded = getComputedStyle(document.querySelector('#sidebar')).display !== 'none'
      && document.querySelector('#navConnections')?.getAttribute('aria-expanded') === 'true';
    document.querySelector('#operationPaneCollapse')?.click();
    const collapsedContentWidth = document.querySelector('#content')?.getBoundingClientRect().width || 0;
    const collapsedBrand = getComputedStyle(document.querySelector('.brand h1')).display === 'none'
      && Boolean(collapsedBrandButton)
      && getComputedStyle(collapsedBrandButton).display !== 'none'
      && collapsedBrandButton.getBoundingClientRect().width > 0
      && collapsedBrandMark?.getAttribute('src') === '/assets/terma-icon.png';
    const paneCollapsed = getComputedStyle(document.querySelector('#sidebar')).display === 'none'
      && document.querySelector('#navConnections')?.getAttribute('aria-expanded') === 'false'
      && document.querySelector('.app')?.classList.contains('operation-pane-collapsed');
    collapsedBrandButton?.click();
    const collapsedBrandExpandState = {
      actionRegistered:window.TermaEvents?.registeredActions?.().includes('static-operation-expand') === true,
      expandedState:!window.termaWorkspaceShell.isCollapsed(),
      sidebarVisible:getComputedStyle(document.querySelector('#sidebar')).display !== 'none',
      buttonHidden:getComputedStyle(collapsedBrandButton).display === 'none'
    };
    const collapsedBrandExpands = Object.values(collapsedBrandExpandState).every(Boolean);
    window.termaWorkspaceShell.setCollapsed(true);
    document.querySelector('#navRunning')?.click();
    const differentActivityExpands = primaryView === 'running'
      && getComputedStyle(document.querySelector('#sidebar')).display !== 'none'
      && document.querySelector('#navRunning')?.getAttribute('aria-expanded') === 'true';
    document.querySelector('#navRunning')?.click();
    const activeActivityCollapses = getComputedStyle(document.querySelector('#sidebar')).display === 'none'
      && document.querySelector('#navRunning')?.getAttribute('aria-expanded') === 'false';
    window.termaWorkspaceShell.setCollapsed(false);
    window.termaWorkspaceShell.setPinned(false, 'running');
    const runningPinShowsAutoCollapse = document.querySelector('#operationPanePin')?.getAttribute('aria-pressed') === 'false'
      && document.querySelector('#operationPanePin')?.dataset.icon === 'pin-off';
    const captureFixture = document.createElement('button');
    let captureFixtureClicked = false;
    captureFixture.addEventListener('click', event=>{ captureFixtureClicked=true; event.stopPropagation(); });
    document.querySelector('#content')?.appendChild(captureFixture);
    captureFixture.click();
    const unpinnedContentClickCollapses = captureFixtureClicked&&window.termaWorkspaceShell.isCollapsed()&&document.querySelector('.app')?.classList.contains('operation-pane-collapsed');
    captureFixture.remove();
    window.termaWorkspaceShell.setCollapsed(false);
    window.termaWorkspaceShell.showPrimary('connections');
    document.querySelector('#content')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0}));
    const pinnedContentClickStaysOpen = !window.termaWorkspaceShell.isCollapsed()&&window.termaWorkspaceShell.isPinned('connections')&&!window.termaWorkspaceShell.isPinned('running');
    const persistedPinState = JSON.parse(localStorage.getItem('operationPanePinnedByViewV1') || '{}');
    const independentPinPersistence = views.every(name=>persistedPinState[name]===(name!=='running'));
    for(const [view,pinned] of originalPins)window.termaWorkspaceShell.setPinned(pinned,view);
    if (originalPanePinnedStorage === null) localStorage.removeItem('operationPanePinnedByViewV1');
    else localStorage.setItem('operationPanePinnedByViewV1', originalPanePinnedStorage);
    window.termaWorkspaceShell.showPrimary(originalPrimaryView);
    window.termaWorkspaceShell.setCollapsed(originalPaneCollapsed);
    document.querySelector('.group-head')?.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:180, clientY:180}));
    const groupMenuLabels = [...document.querySelectorAll('#actionMenu button span')].map(node => node.textContent.trim());
    hideActionMenu();
    return {
      title: document.title,
      icons: document.querySelectorAll('svg.lucide').length,
      pendingIcons: document.querySelectorAll('i[data-lucide]').length,
      connections: document.querySelectorAll('.conn-row').length,
      groups: document.querySelectorAll('.group').length,
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      visibleView: Array.from(document.querySelectorAll('.view')).find(el => !el.hidden)?.id || '',
      groupRenameMenu: groupMenuLabels.includes('重命名分组'),
      groupActionButton: Boolean(groupActionButton && groupActionButton.getAttribute('aria-label')?.includes('分组操作')),
      stickyGroupHeaders,
      stickyGroupHeaderSealsTop,
      compactOperationPane,
      compactConnectionTools,
      compactConnectionRows,
      connectionHasSftpAction,
      quickConnectionLauncher,
      quickConnectionLayout,
      quickForwardSearch,
      quickCommandForwardSearch,
      globalForwardManager,
      globalForwardStatsAligned,
      globalForwardToolbarAligned,
      globalForwardToolbarWideAligned,
      globalForwardWideGrid,
      singleForwardWideGrid,
      forwardCardActionsAligned,
      groupedManager,
      globalForwardStoppedHidesAccess,
      forwardingPagination,
      connectionForwardPagination,
      quickSshCandidates,
      connectionNameDoubleClickOpens,
      operationPaneHorizontalScrollHidden:Boolean(explorerTree&&getComputedStyle(explorerTree).overflowX==='hidden'),
      operationPaneResizable,
      operationPaneCollapsible: expandedBrand && collapsedBrand && paneExpanded && paneCollapsed && collapsedBrandExpands && differentActivityExpands && activeActivityCollapses && collapsedContentWidth >= expandedContentWidth + 250,
      operationPaneCollapseLayout:{expandedBrand,collapsedBrand,paneExpanded,paneCollapsed,collapsedBrandExpands,collapsedBrandExpandState,differentActivityExpands,activeActivityCollapses,expandedContentWidth,collapsedContentWidth},
      operationPanePinBehavior: runningPinShowsAutoCollapse&&unpinnedContentClickCollapses&&pinnedContentClickStaysOpen&&independentPinPersistence,
      activityUtilities: document.querySelector('.activity-bottom')?.children[0]?.id === 'languageToggle'
        && document.querySelector('.activity-bottom')?.children[1]?.id === 'themeToggle'
        && document.querySelector('.activity-bottom')?.children[2]?.id === 'activityRefresh'
        && document.querySelector('.activity-bottom')?.children[3]?.classList.contains('github-link'),
      compactDesktopHeader: brandHeight >= 33.5
        && brandHeight <= 64.5
        && topbarHeight >= 33.5
        && topbarHeight <= 64.5
        && Math.abs(brandHeight - topbarHeight) <= 0.5
        && tabsHeight >= 25.5
        && tabsHeight <= 48.5
        && workspacePaddingTop <= 12.5,
      forwardToggleFits: Boolean(
        forwardToggle
        && forwardToggle.getAttribute('aria-label') === '停止转发'
        && forwardToggleRect
        && connectionActionsRect
        && forwardToggleRect.right <= connectionActionsRect.right + 0.5
      ),
      activity: {
        count: activityItems.length,
        iconCentered: activityItems.every(item => item.iconDelta <= 0.5),
        centersAligned: activityItems.every(item => Math.abs(item.itemCenter - baseline) <= 0.5),
        insideColumn: activityItems.every(item => item.insideColumn),
        resizable:activityResizable,
        items: activityItems
      }
    };
  })()`);
  console.log("[ui-smoke] forwarding template actions");
  const forwardTemplateLayoutUi=await window.webContents.executeJavaScript(`(()=>{
    const previous=forwardTemplates;const host=document.createElement('div');host.style.cssText='position:fixed;left:-10000px;top:0;width:292px';document.body.appendChild(host);
    try{
      forwardTemplates=[{id:'layout-1',name:'Memcached',mode:'local',bind_host:'127.0.0.1',bind_port:11211,target_host:'127.0.0.1',target_port:11211},{id:'layout-2',name:'Web HTTP',mode:'local',bind_host:'127.0.0.1',bind_port:8080,target_host:'127.0.0.1',target_port:80}];
      const owner=window.termaForwardPages.connection(host,Number(connections[0]?.id));owner.service.state.templatesOpen=true;owner.paint();
      const rows=[...host.querySelectorAll('.forward-template-list article')],buttons=[...host.querySelectorAll('.forward-template-list button')];
      const insideRows=rows.every(row=>{const a=row.getBoundingClientRect();return [...row.querySelectorAll('button')].every(button=>{const b=button.getBoundingClientRect();return b.left>=a.left-.5&&b.right<=a.right+.5&&b.bottom<=a.bottom+.5;});});
      const noOverlap=rows.every(row=>{const rects=[...row.querySelectorAll('button')].map(b=>b.getBoundingClientRect());return rects.every((a,i)=>rects.every((b,j)=>i===j||a.right<=b.left+.5||b.right<=a.left+.5||a.bottom<=b.top+.5||b.bottom<=a.top+.5));});
      return {rows:rows.length,buttons:buttons.length,singleLine:buttons.every(b=>b.scrollWidth<=b.clientWidth+1),insideRows,noOverlap};
    }finally{forwardTemplates=previous;window.termaForwardPages.release(host);host.remove();}
  })()`);
  console.log("[ui-smoke] appearance effects disabled");
  const appearanceEffectsUi = await window.webContents.executeJavaScript(`(async () => {
    localStorage.setItem('termaAppearanceV1', JSON.stringify({preset:'luminous',frosted_strength:53,liquid_strength:39}));
    document.documentElement.classList.add('terma-liquid-enabled');
    const track = document.querySelector('.activity-top');
    if (track) {
      track.classList.add('terma-liquid-track','has-liquid-selection');
      track.insertAdjacentHTML('afterbegin','<span class="terma-liquid-lens" aria-hidden="true"></span>');
    }
    await (${replayAppearanceBootstrap.toString()})();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const root = document.documentElement;
    return {
      featureDisabled:!('termaAppearanceLegacy' in window) && !('termaThemeAppearance' in window),
      storageCleared:localStorage.getItem('termaAppearanceV1') === null,
      clearPreset:root.dataset.appearancePreset === 'clear',
      classesCleared:!root.classList.contains('terma-liquid-enabled') && root.classList.contains('terma-glass-disabled') && root.classList.contains('terma-frosted-disabled'),
      noLenses:document.querySelectorAll('.terma-liquid-lens').length === 0,
      noTracks:document.querySelectorAll('.terma-liquid-track').length === 0,
      zeroBlur:getComputedStyle(root).getPropertyValue('--terma-frosted-backdrop-blur').trim() === '0px'
    };
  })()`);
  console.log("[ui-smoke] refresh state");
  const refreshStateUi = await window.webContents.executeJavaScript(`(async () => {
    const fixture = connections[0];
    const previousApi = api;
    const previousConnections = connections;
    const previousTemplates = forwardTemplates;
    const previousSecurity = securitySettings;
    const previousSelectedId = selectedId;
    const previousPrimaryView = primaryView;
    const previousActiveView = activeView;
    const previousOpenGroups = [...groupOpen];
    const previousStoredGroups = localStorage.getItem('openGroups');
    const previousStatuses = (fixture?.forwards || []).map(forward => forward.status);
    try {
      if (!fixture) return {found:false};
      primaryView = 'connections';
      activeView = 'welcome';
      selectedId = fixture.id;
      groupOpen.add(fixture.group_name);
      saveGroupState();
      window.termaConnectionViews.renderConnections();
      window.termaConnectionList.toggleGroup(fixture.group_name);
      const collapsedBeforeRefresh = !groupOpen.has(fixture.group_name)
        && !document.querySelector('.group[data-group-name="' + encodeURIComponent(fixture.group_name) + '"] .conn-row');
      api = async path => {
        if (path === '/api/connections') return previousConnections;
        if (path === '/api/forward-templates') return previousTemplates;
        if (path === '/api/security') return previousSecurity;
        throw new Error('Unexpected refresh-state request: ' + path);
      };
      await window.__uiSmokeRealLoadAll({silent:true});
      const collapsedAfterRefresh = !groupOpen.has(fixture.group_name)
        && !document.querySelector('.group[data-group-name="' + encodeURIComponent(fixture.group_name) + '"] .conn-row');
      const collapsePersisted = !JSON.parse(localStorage.getItem('openGroups') || '[]').includes(fixture.group_name);

      const apiWithFixture = api;
      api = (url,...args) => url === '/api/startup-status'
        ? Promise.resolve({state:'ready',local_url:'http://127.0.0.1:8088',lan_urls:[]})
        : apiWithFixture(url,...args);
      window.termaConnectionViews.renderWelcome();
      for (let retry=0; retry<100 && !$('startupSummary')?.textContent.includes('8088'); retry++) {
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      const startupCountSnapshot = state => {
        const card = document.querySelector('[data-startup-state="' + state + '"]');
        const count = card?.querySelector('strong');
        const label = card?.querySelector('small');
        const countRect = count?.getBoundingClientRect();
        const labelRect = label?.getBoundingClientRect();
        return {
          count:count?.textContent?.trim() || '',
          label:label?.textContent?.trim() || '',
          labelBelow:Boolean(countRect && labelRect && labelRect.top >= countRect.bottom - 0.5)
        };
      };
      fixture.forwards[0].status = 'running';
      window.termaConnectionViews.renderStartupSummary();
      const runningState = startupCountSnapshot('running');
      const runningFailedState = startupCountSnapshot('failed');
      fixture.forwards[0].status = 'reconnecting';
      window.termaConnectionViews.renderStartupSummary();
      const reconnectingState = startupCountSnapshot('reconnecting');
      fixture.forwards[0].status = 'failed';
      window.termaConnectionViews.renderStartupSummary();
      const failedText = document.querySelector('#startupSummary')?.textContent || '';
      const failedRunningState = startupCountSnapshot('running');
      const failedState = startupCountSnapshot('failed');
      selectConnection(fixture.id);
      const explicitSelectionReopens = groupOpen.has(fixture.group_name);
      return {
        found:true,
        collapsedBeforeRefresh,
        collapsedAfterRefresh,
        collapsePersisted,
        explicitSelectionReopens,
        runningCountLive:runningState.count === '1' && runningState.label === '运行中' && runningFailedState.count === '0' && runningFailedState.label === '启动失败',
        failureCountLive:failedRunningState.count === '0' && failedRunningState.label === '运行中' && failedState.count === '1' && failedState.label === '启动失败' && !!document.querySelector('[data-startup-state="failed"][data-action="workspace-show-running"]'),
        startupLabelsBelowNumbers:runningState.labelBelow && reconnectingState.labelBelow && failedState.labelBelow,
        oldStartupLabelsRemoved:!failedText.includes('转发成功') && !failedText.includes('部分转发异常') && !failedText.includes('异常 1')
      };
    } finally {
      api = previousApi;
      connections = previousConnections;
      forwardTemplates = previousTemplates;
      securitySettings = previousSecurity;
      selectedId = previousSelectedId;
      primaryView = previousPrimaryView;
      activeView = previousActiveView;
      if (fixture) (fixture.forwards || []).forEach((forward,index) => { forward.status = previousStatuses[index]; });
      groupOpen.clear();
      previousOpenGroups.forEach(group => groupOpen.add(group));
      if (previousStoredGroups === null) localStorage.removeItem('openGroups');
      else localStorage.setItem('openGroups', previousStoredGroups);
      // Keep Vue's welcome tree intact while exercising the real summary controller.
      window.termaConnectionViews?.refreshWelcome();
      window.termaConnectionViews.renderConnections();
    }
  })()`);
  console.log("[ui-smoke] workspace tab drag");
  const workspaceTabDragUi = await window.webContents.executeJavaScript(`(async () => {
    const previousTabs = tabs.map(tab => ({...tab}));
    const previousActiveTabKey = activeTabKey;
    const previousStoredTabs = localStorage.getItem('workspaceTabs');
    try {
      tabs = [
        {key:'drag-a',title:'demo-host · 终端',subtitle:'demo@demo-host.example:22',viewName:'welcome',closable:true,kind:'terminal',id:900001},
        {key:'drag-b',title:'测试 · 终端 #5',subtitle:'root@192.0.2.5:22',viewName:'welcome',closable:true,kind:'terminal',id:900002},
        {key:'drag-c',title:'标签 C · SFTP',subtitle:'',viewName:'welcome',closable:true,kind:'sftp',id:900003}
      ];
      activeTabKey = 'drag-b';
      renderTabs();
      const first = document.querySelector('.tab[data-tab-key="drag-a"]');
      const last = document.querySelector('.tab[data-tab-key="drag-c"]');
      const firstRect = first.getBoundingClientRect();
      const lastRect = last.getBoundingClientRect();
      const shortTitleRect = last.querySelector('.tab-title').getBoundingClientRect();
      const shortCloseRect = last.querySelector('.tab-close').getBoundingClientRect();
      const terminalKindIcon = first.querySelector('.tab-kind-icon.terminal svg');
      const sftpKindIcon = last.querySelector('.tab-kind-icon.sftp svg');
      const compactKindLabels = first.querySelector('.tab-title').textContent === 'demo-host'
        && document.querySelector('.tab[data-tab-key="drag-b"] .tab-title').textContent === '测试 #5'
        && last.querySelector('.tab-title').textContent === '标签 C';
      const distinctKindIcons = Boolean(terminalKindIcon && sftpKindIcon && terminalKindIcon.outerHTML !== sftpKindIcon.outerHTML);
      const remoteProtocolHost = document.createElement('div');
      remoteProtocolHost.className = 'tabs';
      remoteProtocolHost.style.cssText = 'position:fixed;left:8px;top:8px;height:var(--workspace-tab-height);visibility:hidden;pointer-events:none';
      const remoteProtocolFixtures = [
        {key:'remote-rdp',title:'Linux图形界面测试 · RDP',kind:'remote-desktop',protocol:'rdp'},
        {key:'remote-vnc',title:'Linux图形界面测试 · VNC',kind:'remote-desktop',protocol:'vnc'},
        {key:'remote-xdmcp',title:'Linux图形界面测试 · XDMCP',kind:'remote-desktop'}
      ];
      remoteProtocolHost.innerHTML = remoteProtocolFixtures.map(tab => {
        const presentation = window.termaWorkspaceViews.presentation.fallback(tab);
        return '<button class="tab" data-test-protocol="'+tab.key+'">'+presentation.icon+'<span class="tab-title">'+presentation.title+'</span></button>';
      }).join('');
      document.body.appendChild(remoteProtocolHost);
      const remoteProtocolTabs = [...remoteProtocolHost.querySelectorAll('.tab')];
      const remoteProtocolTitlesCompact = remoteProtocolTabs.every(tab => tab.querySelector('.tab-title')?.textContent === 'Linux图形界面测试');
      const remoteProtocolLetters = remoteProtocolTabs.map(tab => tab.querySelector('.tab-protocol-letter')?.textContent || '');
      const remoteProtocolMonitorBadges = remoteProtocolTabs.every(tab => {
        const badge = tab.querySelector('.tab-kind-icon.remote-desktop');
        const badgeRect = badge?.getBoundingClientRect();
        const letterRect = badge?.querySelector('.tab-protocol-letter')?.getBoundingClientRect();
        return Boolean(badge?.querySelector('svg') && badgeRect && letterRect
          && letterRect.left >= badgeRect.left - 0.5 && letterRect.right <= badgeRect.right + 0.5
          && letterRect.top >= badgeRect.top - 0.5 && letterRect.bottom <= badgeRect.bottom + 0.5);
      });
      const remoteProtocolThemeColors = remoteProtocolTabs.map(tab => getComputedStyle(tab.querySelector('.tab-kind-icon')).color);
      const remoteProtocolThemeAware = new Set(remoteProtocolThemeColors).size === 3
        && remoteProtocolThemeColors.every(color => color && color !== 'rgba(0, 0, 0, 0)');
      remoteProtocolHost.remove();
      const activeTab = document.querySelector('.tab[data-tab-key="drag-b"]');
      const inactiveStyle = getComputedStyle(first);
      const activeStyle = getComputedStyle(activeTab);
      const activeSelectionVisible = activeTab.classList.contains('active')
        && activeStyle.backgroundColor !== inactiveStyle.backgroundColor
        && Number.parseFloat(activeStyle.borderTopWidth) >= 1
        && activeStyle.borderTopColor !== 'rgba(0, 0, 0, 0)'
        && activeStyle.boxShadow === 'none'
        && Number.parseInt(activeStyle.fontWeight, 10) >= 600;
      const shortTabUsesContentWidth = lastRect.width < 120
        && shortCloseRect.left - shortTitleRect.right >= 4
        && shortCloseRect.left - shortTitleRect.right <= 8;
      first.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:71,pointerType:'mouse',button:0,clientX:firstRect.left+8,clientY:firstRect.top+8}));
      const activatedOnPress = activeTabKey === 'drag-a';
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:71,pointerType:'mouse',button:0,clientX:lastRect.right-2,clientY:firstRect.top+8}));
      const draggedTab = document.querySelector('.tab[data-tab-key="drag-a"]');
      const activeDraggedTab = draggedTab;
      const dragGhost = document.querySelector('.workspace-tab-drag-ghost');
      const insertionIndicator = activeDraggedTab?.closest('.workspace-pane')?.querySelector('.workspace-tab-insert-indicator');
      const beganImmediately = Boolean(activeDraggedTab?.classList.contains('tab-dragging') && document.body.classList.contains('workspace-tab-drag-active'));
      const dragGhostVisible = Boolean(dragGhost && dragGhost.textContent.includes('demo-host') && !dragGhost.textContent.includes('终端') && getComputedStyle(dragGhost).display !== 'none');
      const dropPositionVisible = Boolean(
        insertionIndicator
        && !insertionIndicator.hidden
        && getComputedStyle(insertionIndicator).display !== 'none'
        && insertionIndicator.getBoundingClientRect().left >= lastRect.right - 4
      );
      const touchReady = getComputedStyle(activeDraggedTab).touchAction === 'pan-y';
      const commonTitleFits = activeDraggedTab.querySelector('.tab-title').scrollWidth <= activeDraggedTab.querySelector('.tab-title').clientWidth;
      const sessionTitle = document.querySelector('.tab[data-tab-key="drag-b"] .tab-title');
      const numberedSessionTitleFits = sessionTitle.scrollWidth <= sessionTitle.clientWidth;
      const tabFontSize = parseFloat(getComputedStyle(activeDraggedTab).fontSize);
      const tabFontWithinResizeRange = tabFontSize >= 10.4 && tabFontSize <= 15.1;
      const fullTitleTooltip = activeDraggedTab.title === 'demo-host · 终端 - demo@demo-host.example:22';
      const liveOrder = [...document.querySelectorAll('#tabs .tab')].map(tab => tab.dataset.tabKey);
      window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:71,pointerType:'mouse',button:0,clientX:lastRect.right-2,clientY:firstRect.top+8}));
      const savedOrder = tabs.map(tab => tab.key);
      await new Promise(resolve => setTimeout(resolve, 100));
      const persistedOrder = JSON.parse(localStorage.getItem('workspaceTabs') || '{}').tabs?.map(tab => tab.key) || [];
      const activeFollowsDragged = activeTabKey === 'drag-a';
      const dragGhostRemoved = !document.querySelector('.workspace-tab-drag-ghost');
      const dropPositionRemoved = !document.querySelector('.workspace-tab-insert-indicator:not([hidden])');
      const clickSuppressed = window.termaWorkspaceDrag.tabs.suppressClick();

      const beforeCancel = tabs.map(tab => tab.key);
      const cancelTab = document.querySelector('.tab[data-tab-key="drag-b"]');
      const cancelTarget = document.querySelector('.tab[data-tab-key="drag-a"]');
      const cancelRect = cancelTab.getBoundingClientRect();
      const cancelTargetRect = cancelTarget.getBoundingClientRect();
      cancelTab.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:72,pointerType:'touch',button:0,clientX:cancelRect.left+8,clientY:cancelRect.top+8}));
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:72,pointerType:'touch',button:0,clientX:cancelTargetRect.right-2,clientY:cancelRect.top+8}));
      const cancelStarted = Boolean(document.querySelector('.tab[data-tab-key="drag-b"].tab-dragging'));
      window.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,cancelable:true,pointerId:72,pointerType:'touch',button:0,clientX:cancelTargetRect.right-2,clientY:cancelRect.top+8}));
      const cancelRestored = JSON.stringify(tabs.map(tab => tab.key)) === JSON.stringify(beforeCancel)
        && JSON.stringify([...document.querySelectorAll('#tabs .tab')].map(tab => tab.dataset.tabKey)) === JSON.stringify(beforeCancel);

      const closeControl = document.querySelector('.tab[data-tab-key="drag-a"] .tab-close');
      closeControl.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:73,pointerType:'mouse',button:0}));
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:73,pointerType:'mouse',clientX:80,clientY:80}));
      const closeDoesNotDrag = !document.body.classList.contains('workspace-tab-drag-active');
      window.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:73}));
      moveWorkspaceTab('drag-a', -1);
      const fallbackMove = JSON.stringify(tabs.map(tab => tab.key)) === JSON.stringify(['drag-b','drag-a','drag-c']);
      const tabShell = document.querySelector('.tabs-shell');
      const tabStrip = document.querySelector('#tabs');
      const leftScroll = document.querySelector('#tabsScrollLeft');
      const rightScroll = document.querySelector('#tabsScrollRight');
      const previousShellWidth = tabShell.style.width;
      tabShell.style.width = '280px';
      tabStrip.scrollLeft = 0;
      window.termaWorkspaceDockTabs.syncTabScroll();
      const scrollControlsVisible = !leftScroll.hidden && !rightScroll.hidden && leftScroll.disabled && !rightScroll.disabled;
      const nativeScrollbarHidden = getComputedStyle(tabStrip).scrollbarWidth === 'none'
        && tabStrip.offsetHeight === tabStrip.clientHeight;
      tabStrip.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:80}));
      const wheelScrollsTabs = tabStrip.scrollLeft > 0;
      tabShell.style.width = previousShellWidth;
      tabStrip.scrollLeft = 0;
      window.termaWorkspaceDockTabs.syncTabScroll();
      const scrollControlsHideWhenFit = leftScroll.hidden && rightScroll.hidden
        && getComputedStyle(leftScroll).display === 'none'
        && getComputedStyle(rightScroll).display === 'none';
      return {
        beganImmediately,
        activatedOnPress,
        dragGhostVisible,
        dropPositionVisible,
        dropPositionRemoved,
        dragGhostRemoved,
        touchReady,
        commonTitleFits,
        numberedSessionTitleFits,
        compactKindLabels,
        distinctKindIcons,
        remoteProtocolTitlesCompact,
        remoteProtocolLetters,
        remoteProtocolMonitorBadges,
        remoteProtocolThemeAware,
        activeSelectionVisible,
        tabFontWithinResizeRange,
        shortTabUsesContentWidth,
        fullTitleTooltip,
        liveOrder,
        savedOrder,
        persistedOrder,
        activeFollowsDragged,
        clickSuppressed,
        cancelStarted,
        cancelRestored,
        closeDoesNotDrag,
        fallbackMove,
        scrollControlsVisible,
        scrollControlsHideWhenFit,
        nativeScrollbarHidden,
        wheelScrollsTabs
      };
    } finally {
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
      window.termaWorkspacePersistence.flush();
      tabs = previousTabs;
      activeTabKey = previousActiveTabKey;
      window.restoringTabs = true;
      renderTabs();
      window.restoringTabs = false;
      if (previousStoredTabs === null) localStorage.removeItem('workspaceTabs');
      else localStorage.setItem('workspaceTabs', previousStoredTabs);
    }
  })()`);
  console.log("[ui-smoke] connected tab close confirmation");
  const workspaceTabCloseUi = await window.webContents.executeJavaScript(`(async () => {
    const previousTabs = tabs.map(tab => ({...tab}));
    const previousLayout = JSON.parse(JSON.stringify(workspaceLayout));
    const previousActiveTabKey = activeTabKey;
    const previousActiveView = activeView;
    const previousStoredTabs = localStorage.getItem('workspaceTabs');
    const pause = () => new Promise(resolve => setTimeout(resolve, 0));
    try {
      tabs = [
        {key:'close-connected',title:'Connected terminal',subtitle:'',viewName:'welcome',closable:true,kind:'terminal',connectionStatus:'connected'},
        {key:'close-connecting',title:'Connecting SFTP',subtitle:'',viewName:'welcome',closable:true,kind:'sftp',connectionStatus:'connecting'},
        {key:'close-remote',title:'Connecting VNC',subtitle:'',viewName:'welcome',closable:true,kind:'remote-desktop',protocol:'vnc',connectionStatus:'connecting'},
        {key:'close-system-remote',title:'RDP management',subtitle:'',viewName:'welcome',closable:true,kind:'remote-desktop',protocol:'rdp',connectionStatus:'connected'},
        {key:'close-xdmcp',title:'XDMCP management',subtitle:'',viewName:'welcome',closable:true,kind:'remote-desktop',protocol:'xdmcp',connectionStatus:'connecting'},
        {key:'close-disconnected',title:'Disconnected terminal',subtitle:'',viewName:'welcome',closable:true,kind:'terminal',connectionStatus:'disconnected'}
      ];
      workspaceLayout = {type:'pane',id:'close-pane',tabs:tabs.map(tab => tab.key),activeTabKey:'close-connected'};
      focusedPaneId = 'close-pane';
      activeTabKey = 'close-connected';
      activeView = 'welcome';
      renderTabs();
      const remoteStatusDotVisible = document.querySelector('.tab[data-tab-key="close-remote"] .tab-connection-dot.connecting') !== null;
      const systemRemoteStatusHidden = !document.querySelector('.tab[data-tab-key="close-system-remote"] .tab-connection-dot')
        && !document.querySelector('.tab[data-tab-key="close-xdmcp"] .tab-connection-dot');
      void window.termaWorkspaceTabActions.requestClose(['close-system-remote'], 'close-system-remote');
      await pause();
      const systemRemoteClosesImmediately = !workspaceHasTabKey('close-system-remote')
        && document.querySelector('#modal')?.hidden;
      tabs = tabs.filter(tab => !['close-system-remote','close-xdmcp'].includes(tab.key));
      workspaceLayout.tabs = workspaceLayout.tabs.filter(key => !['close-system-remote','close-xdmcp'].includes(key));
      renderTabs();
      void window.termaWorkspaceTabActions.requestClose(['close-connected'], 'close-connected');
      await pause();
      const modal = document.querySelector('#modal');
      const connectedCard = modal.querySelector('.workspace-close-tabs-modal');
      const connectedRect = connectedCard?.getBoundingClientRect();
      const connectedPrompt = Boolean(connectedCard && connectedCard.textContent.includes('Connected terminal') && document.activeElement === document.querySelector('#workspaceCloseTabsCancel'));
      modal.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      const backdropIgnored = Boolean(!modal.hidden && modal.querySelector('.workspace-close-tabs-modal'));
      modal.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Escape'}));
      await pause();
      const escapePreservesTabs = tabs.length === 4 && modal.hidden;
      void window.termaWorkspaceTabActions.requestClose(['close-connecting'], 'close-connecting');
      await pause();
      document.querySelector('#workspaceCloseTabsCancel')?.click();
      await pause();
      const cancelPreservesTabs = tabs.length === 4 && tabs.some(tab => tab.key === 'close-connecting') && modal.hidden;
      void window.termaWorkspaceTabActions.closeMode('others','close-disconnected');
      await pause();
      const multiCard = modal.querySelector('.workspace-close-tabs-modal');
      const multiRect = multiCard?.getBoundingClientRect();
      const multiItems = [...(multiCard?.querySelectorAll('.workspace-close-tabs-list li') || [])];
      const multiPromptListsNames = Boolean(multiCard
        && multiItems.length === 3
        && multiCard.textContent.includes('Connected terminal')
        && multiCard.textContent.includes('Connecting SFTP')
        && multiCard.textContent.includes('Connecting VNC'));
      document.querySelector('#workspaceCloseTabsConfirm')?.click();
      await pause();
      const confirmed = tabs.length === 1 && tabs[0].key === 'close-disconnected';
      await window.termaWorkspaceTabActions.requestClose(['close-disconnected'], 'close-disconnected');
      await pause();
      const disconnectedClosesImmediately = tabs.length === 0
        && modal.hidden;
      return {
        remoteStatusDotVisible,
        systemRemoteStatusHidden,
        systemRemoteClosesImmediately,
        connectedPrompt,
        backdropIgnored,
        escapePreservesTabs,
        cancelPreservesTabs,
        multiPromptListsNames,
        multiPromptDiagnostics:{itemCount:multiItems.length,items:multiItems.map(item=>item.textContent.trim()),text:multiCard?.textContent.replace(/\s+/g,' ').trim()||''},
        confirmed,
        disconnectedClosesImmediately,
        withinViewport:Boolean(connectedRect && multiRect
          && connectedRect.left >= -0.5 && connectedRect.right <= innerWidth + 0.5
          && connectedRect.top >= -0.5 && connectedRect.bottom <= innerHeight + 0.5
          && multiRect.left >= -0.5 && multiRect.right <= innerWidth + 0.5
          && multiRect.top >= -0.5 && multiRect.bottom <= innerHeight + 0.5)
      };
    } finally {
      tabs = previousTabs;
      workspaceLayout = previousLayout;
      activeTabKey = previousActiveTabKey;
      activeView = previousActiveView;
      window.restoringTabs = true;
      renderTabs();
      window.restoringTabs = false;
      if (previousStoredTabs === null) localStorage.removeItem('workspaceTabs');
      else localStorage.setItem('workspaceTabs', previousStoredTabs);
    }
  })()`);
  console.log("[ui-smoke] recursive workspace docking");
  const workspaceDockingUi = await window.webContents.executeJavaScript(`(async () => {
    const previousTabs = tabs.map(tab => ({...tab}));
    const previousLayout = JSON.parse(JSON.stringify(workspaceLayout));
    const previousFocusedPaneId = focusedPaneId;
    const previousActiveTabKey = activeTabKey;
    const previousActiveView = activeView;
    const previousStoredTabs = localStorage.getItem('workspaceTabs');
    const previousStoredHeaderHeight = localStorage.getItem('workspaceHeaderHeight');
    const previousStoredTabHeight = localStorage.getItem('workspaceTabHeight');
    const previousHeaderHeight = window.termaWorkspaceChrome.value('header');
    const previousTabHeight = window.termaWorkspaceChrome.value('tabs');
    const previousRenderWorkspacePaneContent = renderWorkspacePaneContent;
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
    const nearly = (value, expected, tolerance=0.6) => Math.abs(value - expected) <= tolerance;
    const dragChromeHandle = async (handle, pointerId, deltaY, kind) => {
      if (!handle) return {started:false,ended:false};
      const rect = handle.getBoundingClientRect();
      const startY = rect.top + rect.height / 2;
      handle.dispatchEvent(new PointerEvent('pointerdown',{
        bubbles:true,
        cancelable:true,
        pointerId,
        pointerType:'mouse',
        button:0,
        clientX:rect.left + Math.max(1, rect.width / 2),
        clientY:startY
      }));
      const resizeClass = kind === 'tabs' ? 'workspace-tab-resizing' : 'workspace-header-resizing';
      const started = document.body.classList.contains('workspace-chrome-resizing')
        && document.body.classList.contains(resizeClass);
      window.dispatchEvent(new PointerEvent('pointermove',{
        bubbles:true,
        cancelable:true,
        pointerId,
        pointerType:'mouse',
        button:0,
        clientX:rect.left + Math.max(1, rect.width / 2),
        clientY:startY + deltaY
      }));
      await nextFrame();
      window.dispatchEvent(new PointerEvent('pointerup',{
        bubbles:true,
        cancelable:true,
        pointerId,
        pointerType:'mouse',
        button:0,
        clientX:rect.left + Math.max(1, rect.width / 2),
        clientY:startY + deltaY
      }));
      await nextFrame();
      return {
        started,
        ended:!document.body.classList.contains('workspace-chrome-resizing')
      };
    };
    try {
      tabs = ['a','b','c','d'].map(key => ({key:'dock-'+key,title:'Dock '+key.toUpperCase(),subtitle:'',viewName:'welcome',closable:true,kind:'fixture'}));
      workspaceLayout = {type:'pane',id:'dock-pane-root',tabs:tabs.map(tab=>tab.key),activeTabKey:'dock-a'};
      focusedPaneId = 'dock-pane-root';
      activeTabKey = 'dock-a';
      activeView = 'welcome';
      renderTabs();
      const firstSplit = window.termaWorkspaceDrag.applyTabDrop({key:'dock-b',sourcePaneId:'dock-pane-root'}, {paneId:'dock-pane-root',zone:'right'});
      const rightPane = workspaceFindPaneForTab('dock-b');
      const sourcePane = workspaceFindPaneForTab('dock-a');
      const secondSplit = Boolean(rightPane && sourcePane)
        && window.termaWorkspaceDrag.applyTabDrop({key:'dock-c',sourcePaneId:sourcePane.id}, {paneId:rightPane.id,zone:'bottom'});
      const nestedTree = workspaceLayout.type === 'split'
        && workspaceLayout.direction === 'row'
        && workspaceLayout.second?.type === 'split'
        && workspaceLayout.second.direction === 'column';
      const paneCount = document.querySelectorAll('#workspaceDock .workspace-pane').length;
      const eachPaneComplete = [...document.querySelectorAll('#workspaceDock .workspace-pane')].every(pane => pane.querySelector('.tabs-shell') && pane.querySelector('.workspace'));
      const expectedActivityFitPaneIds=workspaceVisiblePanes().map(pane=>pane.id);
      const activityFitPaneIds=[];
      const originalUpdateTabScrollControls=window.termaWorkspaceDockTabs.syncTabScroll;
      const activityWidthBeforeFit=window.termaWorkspaceChrome.value('activity');
      window.termaWorkspaceDockTabs.syncTabScroll=paneId=>{
        activityFitPaneIds.push(paneId);
        return originalUpdateTabScrollControls(paneId);
      };
      window.termaWorkspaceChrome.apply('activity', activityWidthBeforeFit===64?36:activityWidthBeforeFit+1);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      window.termaWorkspaceChrome.apply('activity', activityWidthBeforeFit,{fit:false});
      window.termaWorkspaceDockTabs.syncTabScroll=originalUpdateTabScrollControls;
      const activityResizeReflowsEveryPane=expectedActivityFitPaneIds.every(paneId=>activityFitPaneIds.includes(paneId));
      const splitters = [...document.querySelectorAll('#workspaceDock .workspace-splitter')];
      const splitterMetrics = splitters.map(splitter => {
        const splitElement = splitter.parentElement;
        const vertical = splitElement?.classList.contains('workspace-split-row');
        const rect = splitter.getBoundingClientRect();
        const style = getComputedStyle(splitter);
        const line = getComputedStyle(splitter, '::before');
        const firstRect = splitElement?.querySelector(':scope > .workspace-split-first')?.getBoundingClientRect();
        const secondRect = splitElement?.querySelector(':scope > .workspace-split-second')?.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        // Probe away from the midpoint, where a nested perpendicular splitter can overlap.
        const hitX = vertical ? centerX : rect.left + rect.width / 4;
        const hitY = vertical ? rect.top + rect.height / 4 : centerY;
        const hitOffsets = [-3, 0, 3];
        return {
          vertical,
          orientation:splitter.getAttribute('aria-orientation'),
          trackSize:vertical ? rect.width : rect.height,
          layoutGap:vertical
            ? (secondRect?.left ?? 0) - (firstRect?.right ?? 0)
            : (secondRect?.top ?? 0) - (firstRect?.bottom ?? 0),
          hitAreaCoversTrack:hitOffsets.every(offset => document.elementFromPoint(
            vertical ? hitX + offset : hitX,
            vertical ? hitY : hitY + offset
          ) === splitter),
          lineSize:parseFloat(vertical ? line.width : line.height),
          lineColor:line.backgroundColor,
          trackColor:style.backgroundColor,
          content:line.content,
          spansAxis:vertical
            ? nearly(parseFloat(line.top), 0) && nearly(parseFloat(line.bottom), 0)
            : nearly(parseFloat(line.left), 0) && nearly(parseFloat(line.right), 0)
        };
      });
      const splitterTracksUsable = splitterMetrics.every(metric => metric.trackSize >= 9.5
        && metric.layoutGap >= 1.5
        && metric.layoutGap <= 2.5
        && metric.hitAreaCoversTrack);
      const splitterLinesVisible = splitterMetrics.every(metric => metric.lineSize >= 0.75
        && metric.lineSize <= 1.25
        && metric.content !== 'none'
        && metric.content !== 'normal'
        && metric.lineColor !== 'transparent'
        && metric.lineColor !== 'rgba(0, 0, 0, 0)'
        && metric.lineColor !== metric.trackColor
        && metric.spansAxis
        && metric.orientation === (metric.vertical ? 'vertical' : 'horizontal'));
      const paneElements = [...document.querySelectorAll('#workspaceDock .workspace-pane')];
      paneElements.forEach(pane => pane.classList.add('terminal-pane'));
      const terminalWorkspaceStyles = paneElements.map(pane => getComputedStyle(pane.querySelector(':scope > .workspace')));
      const terminalInsetsCompact = terminalWorkspaceStyles.every(style => nearly(parseFloat(style.paddingTop), 0)
        && nearly(parseFloat(style.paddingRight), 0)
        && nearly(parseFloat(style.paddingBottom), 0)
        && nearly(parseFloat(style.paddingLeft), 0));
      const terminalScrollbarGutterReleased = terminalWorkspaceStyles.every(style => style.scrollbarGutter === 'auto');
      paneElements.forEach(pane => pane.classList.remove('terminal-pane'));
      const rootSplitId = workspaceLayout.id;
      window.termaWorkspaceDrag.splitter.setRatio(rootSplitId, 0.64);
      const ratioAdjusted = Math.abs(workspaceFindSplit(rootSplitId).ratio - 0.64) < 0.001
        && document.querySelector('[data-split-id="'+rootSplitId+'"]')?.style.getPropertyValue('--workspace-split-ratio') === '64%';
      const persistedLayout = JSON.parse(localStorage.getItem('workspaceTabs') || '{}').layout;
      const ratioPersisted = persistedLayout?.id === rootSplitId
        && Math.abs(Number(persistedLayout.ratio) - 0.64) < 0.001;

      for (const pane of paneElements) {
        const tab = pane.querySelector('.tab');
        if (!tab || tab.querySelector('.tab-connection-dot')) continue;
        const dot = document.createElement('span');
        dot.className = 'tab-connection-dot connected ui-smoke-tab-connection-dot';
        dot.setAttribute('aria-hidden', 'true');
        tab.prepend(dot);
      }
      const tabResizeHandles = [...document.querySelectorAll('#workspaceDock .workspace-tab-resizer')];
      const tabResizeAccessible = tabResizeHandles.length === paneCount
        && tabResizeHandles.every(handle => handle.getAttribute('role') === 'separator'
          && handle.getAttribute('aria-orientation') === 'horizontal'
          && Number(handle.getAttribute('aria-valuemin')) === 26
          && Number(handle.getAttribute('aria-valuemax')) === 48
          && getComputedStyle(handle).display !== 'none'
          && handle.getBoundingClientRect().height >= 6);
      const tabSnapshot = () => {
        const shells = [...document.querySelectorAll('#workspaceDock .tabs-shell')];
        const tabNodes = shells.map(shell => shell.querySelector('.tab')).filter(Boolean);
        const dots = shells.map(shell => shell.querySelector('.tab-connection-dot')).filter(Boolean);
        const handles = [...document.querySelectorAll('#workspaceDock .workspace-tab-resizer')];
        return {
          heights:shells.map(shell => shell.getBoundingClientRect().height),
          fonts:tabNodes.map(tab => parseFloat(getComputedStyle(tab).fontSize)),
          dots:dots.map(dot => {
            const rect = dot.getBoundingClientRect();
            return {width:rect.width,height:rect.height};
          }),
          aria:handles.map(handle => Number(handle.getAttribute('aria-valuenow')))
        };
      };
      const headerStorageBeforeTabResize = localStorage.getItem('workspaceHeaderHeight');
      const tabMinDrag = await dragChromeHandle(tabResizeHandles[0], 181, -1000, 'tabs');
      const tabMin = tabSnapshot();
      const tabMaxDrag = await dragChromeHandle(tabResizeHandles[1] || tabResizeHandles[0], 182, 1000, 'tabs');
      const tabMax = tabSnapshot();
      const tabAllPanesClampMin = tabMin.heights.length === paneCount
        && tabMin.heights.every(height => nearly(height, 26))
        && tabMin.aria.every(value => value === 26);
      const tabAllPanesClampMax = tabMax.heights.length === paneCount
        && tabMax.heights.every(height => nearly(height, 48))
        && tabMax.aria.every(value => value === 48);
      const tabTextScales = tabMin.fonts.length === paneCount
        && tabMax.fonts.length === paneCount
        && Math.min(...tabMax.fonts) >= Math.max(...tabMin.fonts) + 1;
      const statusDotScales = tabMin.dots.length === paneCount
        && tabMax.dots.length === paneCount
        && Math.min(...tabMax.dots.map(dot => Math.min(dot.width, dot.height)))
          >= Math.max(...tabMin.dots.map(dot => Math.max(dot.width, dot.height))) + 1;
      const tabPointerLifecycle = tabMinDrag.started && tabMinDrag.ended && tabMaxDrag.started && tabMaxDrag.ended;
      const tabHeightPersisted = Number(localStorage.getItem('workspaceTabHeight')) === 48;
      const tabKeyboardHandle = tabResizeHandles.at(-1);
      tabKeyboardHandle?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowUp'}));
      await nextFrame();
      const tabKeyboardUp = window.termaWorkspaceChrome.value('tabs') === 48 - 1
        && Number(localStorage.getItem('workspaceTabHeight')) === 48 - 1;
      tabKeyboardHandle?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowDown'}));
      await nextFrame();
      const tabKeyboardDown = window.termaWorkspaceChrome.value('tabs') === 48;
      tabKeyboardHandle?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Home'}));
      await nextFrame();
      const tabKeyboardHome = window.termaWorkspaceChrome.value('tabs') === 26;
      tabKeyboardHandle?.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
      await nextFrame();
      const tabKeyboardEnd = window.termaWorkspaceChrome.value('tabs') === 48
        && tabSnapshot().heights.every(height => nearly(height, 48));
      const tabKeyboardControls = tabKeyboardUp && tabKeyboardDown && tabKeyboardHome && tabKeyboardEnd;
      tabKeyboardHandle?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
      await nextFrame();
      const tabDoubleClickResets = window.termaWorkspaceChrome.value('tabs') === 32
        && Number(localStorage.getItem('workspaceTabHeight')) === 32
        && tabSnapshot().heights.every(height => nearly(height, 32));
      window.termaWorkspaceChrome.apply("tabs",45, {persist:true,fit:false});
      window.termaWorkspaceChrome.apply("tabs",26, {fit:false});
      window.termaWorkspaceChrome.restore();
      await nextFrame();
      const restoredTabSnapshot = tabSnapshot();
      const tabHeightRestored = window.termaWorkspaceChrome.value('tabs') === 45
        && restoredTabSnapshot.heights.every(height => nearly(height, 45))
        && restoredTabSnapshot.aria.every(value => value === 45);
      const tabStorageIndependent = localStorage.getItem('workspaceHeaderHeight') === headerStorageBeforeTabResize;

      const inactivePane = workspaceFindPaneForTab('dock-b');
      const movedIntoInactivePane = Boolean(inactivePane && sourcePane)
        && window.termaWorkspaceDrag.applyTabDrop({key:'dock-d',sourcePaneId:sourcePane.id}, {paneId:inactivePane.id,zone:'tabs',index:inactivePane.tabs.length});
      const closeRenderCalls = [];
      if (movedIntoInactivePane) {
        inactivePane.activeTabKey = 'dock-b';
        focusedPaneId = sourcePane.id;
        activeTabKey = sourcePane.activeTabKey;
        renderWorkspacePaneContent = paneId => {
          closeRenderCalls.push(paneId);
          return previousRenderWorkspacePaneContent(paneId);
        };
        try {
          closeTabsByKey(['dock-b'], 'dock-b');
        } finally {
          renderWorkspacePaneContent = previousRenderWorkspacePaneContent;
        }
      }
      const inactiveCloseRerendered = movedIntoInactivePane
        && inactivePane.activeTabKey === 'dock-d'
        && !!document.querySelector('.workspace-pane[data-pane-id="'+inactivePane.id+'"] .tab[data-tab-key="dock-d"].active');

      const cPane = workspaceFindPaneForTab('dock-c');
      const mergedNested = Boolean(cPane && sourcePane)
        && window.termaWorkspaceDrag.applyTabDrop({key:'dock-c',sourcePaneId:cPane.id}, {paneId:sourcePane.id,zone:'tabs',index:sourcePane.tabs.length});
      const dPane = workspaceFindPaneForTab('dock-d');
      const mergedAll = Boolean(dPane && sourcePane)
        && window.termaWorkspaceDrag.applyTabDrop({key:'dock-d',sourcePaneId:dPane.id}, {paneId:sourcePane.id,zone:'tabs',index:sourcePane.tabs.length});
      const collapsedToSinglePane = workspaceLayout.type === 'pane' && workspaceLeaves().length === 1
        && document.querySelectorAll('#workspaceDock .workspace-pane').length === 1;
      document.querySelectorAll('.ui-smoke-tab-connection-dot').forEach(dot => dot.remove());
      renderTabs();
      return {
        firstSplit,
        secondSplit,
        nestedTree,
        paneCount,
        eachPaneComplete,
        activityResizeReflowsEveryPane,
        splitterCount:splitters.length,
        splitterMetrics,
        splitterTracksUsable,
        splitterLinesVisible,
        terminalInsetsCompact,
        terminalScrollbarGutterReleased,
        ratioAdjusted,
        ratioPersisted,
        tabResizeAccessible,
        tabAllPanesClampMin,
        tabAllPanesClampMax,
        tabTextScales,
        statusDotScales,
        tabPointerLifecycle,
        tabHeightPersisted,
        tabKeyboardControls,
        tabDoubleClickResets,
        tabHeightRestored,
        tabStorageIndependent,
        inactiveCloseRerendered,
        tabMin,
        tabMax,
        mergedNested,
        mergedAll,
        collapsedToSinglePane
      };
    } finally {
      renderWorkspacePaneContent = previousRenderWorkspacePaneContent;
      window.termaWorkspaceChrome.cancel();
      if (previousStoredHeaderHeight === null) localStorage.removeItem('workspaceHeaderHeight');
      else localStorage.setItem('workspaceHeaderHeight', previousStoredHeaderHeight);
      if (previousStoredTabHeight === null) localStorage.removeItem('workspaceTabHeight');
      else localStorage.setItem('workspaceTabHeight', previousStoredTabHeight);
      window.termaWorkspaceChrome.apply("header",previousHeaderHeight, {fit:false});
      window.termaWorkspaceChrome.apply("tabs",previousTabHeight, {fit:false});
      tabs = previousTabs;
      workspaceLayout = previousLayout;
      focusedPaneId = previousFocusedPaneId;
      activeTabKey = previousActiveTabKey;
      activeView = previousActiveView;
      window.restoringTabs = true;
      renderTabs();
      const focused = workspaceFindPane(focusedPaneId) || workspaceLeaves()[0];
      if (focused?.activeTabKey) renderWorkspacePaneContent(focused.id);
      window.restoringTabs = false;
      if (previousStoredTabs === null) localStorage.removeItem('workspaceTabs');
      else localStorage.setItem('workspaceTabs', previousStoredTabs);
    }
  })()`);
  console.log("[ui-smoke] startup workspace restore guard");
  const workspaceStartupRestoreUi = await window.webContents.executeJavaScript(`(() => {
    const previousTabs=tabs;
    const previousLayout=workspaceLayout;
    const previousGroups=workspaceGroups;
    const previousGroupId=activeWorkspaceGroupId;
    const previousFocusedPaneId=focusedPaneId;
    const previousActiveTabKey=activeTabKey;
    const previousActiveView=activeView;
    const previousPending=window.workspaceRestorePending;
    const previousStoredTabs=localStorage.getItem('workspaceTabs');
    const fixtureTabs=[
      {key:'startup-fixture-a',title:'终端 A',subtitle:'',viewName:'welcome',closable:true,kind:'fixture',id:1},
      {key:'startup-fixture-b',title:'终端 B',subtitle:'',viewName:'welcome',closable:true,kind:'fixture',id:2},
      {key:'startup-fixture-c',title:'终端 C',subtitle:'',viewName:'welcome',closable:true,kind:'fixture',id:3}
    ];
    const fixtureStorage={version:1,workspaceGroupsVersion:1,activeWorkspaceGroupId:'workspace-main',activeTabKey:'startup-fixture-b',focusedPaneId:'pane-1',workspaceGroups:[{id:'workspace-main',name:'主工作区',tabs:fixtureTabs,layout:{type:'pane',id:'pane-1',tabs:fixtureTabs.map(tab=>tab.key),activeTabKey:'startup-fixture-b'},activeTabKey:'startup-fixture-b',focusedPaneId:'pane-1'}],tabs:fixtureTabs,layout:{type:'pane',id:'pane-1',tabs:fixtureTabs.map(tab=>tab.key),activeTabKey:'startup-fixture-b'}};
    const serializedFixture=JSON.stringify(fixtureStorage);
    try {
      localStorage.setItem('workspaceTabs',serializedFixture);
      tabs=[{key:'settings',title:'设置',subtitle:'',viewName:'settings',closable:true,kind:'settings'}];
      workspaceLayout={type:'pane',id:'pane-1',tabs:['settings'],activeTabKey:'settings'};
      workspaceGroups=[{id:'workspace-main',name:'主工作区',tabs:[...tabs],layout:workspaceLayout,activeTabKey:'settings',focusedPaneId:'pane-1'}];
      activeWorkspaceGroupId='workspace-main';
      focusedPaneId='pane-1';
      activeTabKey='settings';
      activeView='settings';
      window.workspaceRestorePending=true;
      window.termaWorkspacePersistence.save();
      const storageProtected=localStorage.getItem('workspaceTabs')===serializedFixture;
      const restored=window.termaWorkspacePersistence.restore();
      const restoredKeys=tabs.map(tab=>tab.key);
      const restoredThreeTabs=restored&&restoredKeys.length===3&&restoredKeys.join(',')===fixtureTabs.map(tab=>tab.key).join(',');
      const activeRestored=activeTabKey==='startup-fixture-b';
      return {storageProtected,restoredThreeTabs,activeRestored};
    } finally {
      tabs=previousTabs;
      workspaceLayout=previousLayout;
      workspaceGroups=previousGroups;
      activeWorkspaceGroupId=previousGroupId;
      focusedPaneId=previousFocusedPaneId;
      activeTabKey=previousActiveTabKey;
      activeView=previousActiveView;
      window.workspaceRestorePending=true;
      renderTabs();
      window.workspaceRestorePending=previousPending;
      if(previousStoredTabs===null)localStorage.removeItem('workspaceTabs');else localStorage.setItem('workspaceTabs',previousStoredTabs);
    }
  })()`);
  console.log("[ui-smoke] workspace tab visibility");
  const workspaceTabVisibilityUi = await window.webContents.executeJavaScript(`(async () => {
    const previousTabs = tabs.map(tab => ({...tab}));
    const previousLayout = JSON.parse(JSON.stringify(workspaceLayout));
    const previousFocusedPaneId = focusedPaneId;
    const previousActiveTabKey = activeTabKey;
    const previousActiveView = activeView;
    const previousStoredTabs = localStorage.getItem('workspaceTabs');
    const previousApi = api;
    let localKey;
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
    const settle = async () => { await nextFrame(); await nextFrame(); await nextFrame(); };
    const tabVisible = (paneId, key) => {
      const strip = window.termaWorkspacePaneScope.workspacePaneElement(paneId)?.querySelector('.tabs');
      const tab = strip?.querySelector('.tab[data-tab-key="' + CSS.escape(key) + '"]');
      if (!strip || !tab) return false;
      const stripRect = strip.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      return tabRect.left >= stripRect.left - 1 && tabRect.right <= stripRect.right + 1;
    };
    try {
      tabs = Array.from({length:9}, (_, index) => ({
        key:'visibility-' + (index + 1),
        title:'Visibility ' + (index + 1),
        subtitle:'',
        viewName:'welcome',
        closable:true,
        kind:'welcome'
      }));
      workspaceLayout = {type:'pane',id:'visibility-pane',tabs:tabs.map(tab => tab.key),activeTabKey:'visibility-7'};
      focusedPaneId = 'visibility-pane';
      activeTabKey = 'visibility-7';
      activeView = 'welcome';
      renderTabs();
      await settle();
      const paneElement = window.termaWorkspacePaneScope.workspacePaneElement('visibility-pane');
      const shell = paneElement.querySelector('.tabs-shell');
      const strip = paneElement.querySelector('.tabs');
      shell.style.width = '270px';
      await settle();

      strip.scrollLeft = 0;
      activateTab('visibility-9');
      await settle();
      const switchKeepsActiveVisible = tabVisible('visibility-pane', 'visibility-9');

      strip.scrollLeft = 0;
      shell.style.width = '190px';
      await settle();
      const resizeKeepsActiveVisible = tabVisible('visibility-pane', 'visibility-9');

      activateTab('visibility-1');
      await settle();
      window.termaWorkspaceDrag.applyTabDrop({key:'visibility-1'}, {paneId:'visibility-pane', zone:'tabs', index:9});
      await settle();
      const dragKeepsActiveVisible = tabVisible('visibility-pane', 'visibility-1');

      const sourceOrderBeforeSplit = [...(workspaceFindPane('visibility-pane')?.tabs || [])];
      const sourceActiveBeforeSplit = sourceOrderBeforeSplit.at(-3);
      const sourceLastBeforeSplit = sourceOrderBeforeSplit.at(-1);
      activateTab(sourceActiveBeforeSplit);
      await settle();
      const sourceScrollBefore = strip.scrollLeft;
      api = (url, options) => url.startsWith('/api/local-files?')
        ? Promise.resolve({path:'C:/fixture',kind:'directory',entries:[]}) : previousApi(url, options);
      localKey = await window.termaLocalFileRuntime.pages.placement('native','left');
      await settle();
      const sourcePane = workspaceFindPaneForTab(sourceActiveBeforeSplit);
      const localPane = workspaceFindPaneForTab(localKey);
      const sourceStrip = window.termaWorkspacePaneScope.workspacePaneElement(sourcePane?.id)?.querySelector('.tabs');
      const sourceLast = sourceStrip?.querySelector('.tab[data-tab-key="' + CSS.escape(sourceLastBeforeSplit) + '"]');
      const sourceRect = sourceStrip?.getBoundingClientRect();
      const lastRect = sourceLast?.getBoundingClientRect();
      const splitSourceActivePreserved = sourcePane?.activeTabKey === sourceActiveBeforeSplit;
      const splitSourceActiveVisible = Boolean(sourcePane && tabVisible(sourcePane.id, sourceActiveBeforeSplit));
      const splitSourceDidNotJumpLast = Boolean(sourceRect && lastRect && lastRect.right > sourceRect.right + 1);
      const splitSourceScrollNearPrevious = Math.abs(Number(sourceStrip?.scrollLeft || 0) - sourceScrollBefore) < 180;
      const localSplitCreated = Boolean(localPane && sourcePane && localPane.id !== sourcePane.id && localPane.activeTabKey === localKey);
      const splitSourceOrderPreserved = Boolean(sourcePane && JSON.stringify(sourcePane.tabs) === JSON.stringify(sourceOrderBeforeSplit));
      const splitSourceActiveIndexPreserved = Boolean(sourcePane && sourcePane.tabs.indexOf(sourceActiveBeforeSplit) === sourcePane.tabs.length - 3);
      return {
        switchKeepsActiveVisible,
        resizeKeepsActiveVisible,
        dragKeepsActiveVisible,
        splitSourceActivePreserved,
        splitSourceActiveVisible,
        splitSourceDidNotJumpLast,
        splitSourceScrollNearPrevious,
        localSplitCreated,
        splitSourceOrderPreserved,
        splitSourceActiveIndexPreserved
      };
    } finally {
      api = previousApi;
      if (localKey) window.termaLocalFileRuntime.pages.release([localKey]);
      tabs = previousTabs;
      workspaceLayout = previousLayout;
      focusedPaneId = previousFocusedPaneId;
      activeTabKey = previousActiveTabKey;
      activeView = previousActiveView;
      window.restoringTabs = true;
      renderTabs();
      const focused = workspaceFindPane(focusedPaneId) || workspaceLeaves()[0];
      if (focused?.activeTabKey) renderWorkspacePaneContent(focused.id);
      window.restoringTabs = false;
      if (previousStoredTabs === null) localStorage.removeItem('workspaceTabs');
      else localStorage.setItem('workspaceTabs', previousStoredTabs);
    }
  })()`);
  console.log("[ui-smoke] workspace header resize");
  const workspaceHeaderResizeUi = await window.webContents.executeJavaScript(`(async () => {
    const topbar = document.querySelector('.topbar');
    const brand = document.querySelector('.brand');
    const handle = document.querySelector('#workspaceHeaderResize');
    const tools = document.querySelector('#workspaceGlobalHeaderTools');
    if (!topbar || !brand || !handle || !tools) return {found:false};
    const previousStoredHeaderHeight = localStorage.getItem('workspaceHeaderHeight');
    const previousStoredTabHeight = localStorage.getItem('workspaceTabHeight');
    const previousHeaderHeight = window.termaWorkspaceChrome.value('header');
    const previousTabHeight = window.termaWorkspaceChrome.value('tabs');
    const previousToolsHidden = tools.hidden;
    const fixture = document.createElement('div');
    fixture.className = 'terminal-toolbar terminal-toolbar-header workspace-header-resize-fixture';
    fixture.innerHTML = '<div class="actions terminal-actions"><button class="terminal-dropdown-button workspace-header-resize-fixture-button">'
      + icon('type') + '<span>Header size</span>' + icon('chevron-down') + '</button></div>';
    tools.appendChild(fixture);
    tools.hidden = false;
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
    const nearly = (value, expected, tolerance=0.6) => Math.abs(value - expected) <= tolerance;
    const snapshot = () => {
      const button = fixture.querySelector('button');
      const label = button?.querySelector('span');
      const svg = button?.querySelector('svg');
      const topbarRect = topbar.getBoundingClientRect();
      const brandRect = brand.getBoundingClientRect();
      const buttonRect = button?.getBoundingClientRect();
      const svgRect = svg?.getBoundingClientRect();
      return {
        height:topbarRect.height,
        brandHeight:brandRect.height,
        topbarTop:topbarRect.top,
        topbarBottom:topbarRect.bottom,
        controlTop:buttonRect?.top || 0,
        controlBottom:buttonRect?.bottom || 0,
        titleFont:parseFloat(getComputedStyle(document.querySelector('#workspaceTitle')).fontSize),
        subtitleFont:parseFloat(getComputedStyle(document.querySelector('#workspaceSubtitle')).fontSize),
        controlHeight:buttonRect?.height || 0,
        controlFont:parseFloat(getComputedStyle(button).fontSize),
        labelFont:parseFloat(getComputedStyle(label).fontSize),
        iconSize:svgRect ? Math.max(svgRect.width, svgRect.height) : 0,
        ariaNow:Number(handle.getAttribute('aria-valuenow'))
      };
    };
    const dragHeader = async (pointerId, deltaY) => {
      const rect = handle.getBoundingClientRect();
      const startY = rect.top + rect.height / 2;
      const hitTarget = document.elementFromPoint(
        rect.left + Math.max(1, rect.width / 2),
        startY
      );
      hitTarget?.dispatchEvent(new PointerEvent('pointerdown',{
        bubbles:true,
        cancelable:true,
        pointerId,
        pointerType:'mouse',
        button:0,
        clientX:rect.left + Math.max(1, rect.width / 2),
        clientY:startY
      }));
      const started = document.body.classList.contains('workspace-chrome-resizing')
        && document.body.classList.contains('workspace-header-resizing');
      window.dispatchEvent(new PointerEvent('pointermove',{
        bubbles:true,
        cancelable:true,
        pointerId,
        pointerType:'mouse',
        button:0,
        clientX:rect.left + Math.max(1, rect.width / 2),
        clientY:startY + deltaY
      }));
      await nextFrame();
      window.dispatchEvent(new PointerEvent('pointerup',{
        bubbles:true,
        cancelable:true,
        pointerId,
        pointerType:'mouse',
        button:0,
        clientX:rect.left + Math.max(1, rect.width / 2),
        clientY:startY + deltaY
      }));
      await nextFrame();
      return {
        started,
        ended:!document.body.classList.contains('workspace-chrome-resizing')
      };
    };
    try {
      await nextFrame();
      const classicAppearance = document.documentElement.dataset.appearancePreset === 'clear'
        && !document.documentElement.classList.contains('terma-liquid-enabled');
      const accessible = handle.getAttribute('role') === 'separator'
        && handle.getAttribute('aria-orientation') === 'horizontal'
        && Number(handle.getAttribute('aria-valuemin')) === 34
        && Number(handle.getAttribute('aria-valuemax')) === 64
        && getComputedStyle(handle).display !== 'none'
        && handle.getBoundingClientRect().height >= 6;
      const visibleTabHandle = [...document.querySelectorAll('.workspace-tab-resizer')].find(item => item.getBoundingClientRect().width > 0 && getComputedStyle(item).display !== 'none');
      const tabShell = visibleTabHandle?.closest('.tabs-shell');
      const headerHandleRect = handle.getBoundingClientRect();
      const tabHandleRect = visibleTabHandle?.getBoundingClientRect();
      const tabShellRect = tabShell?.getBoundingClientRect();
      const headerHandleStyle = getComputedStyle(handle);
      const tabHandleStyle = visibleTabHandle ? getComputedStyle(visibleTabHandle) : null;
      const resizeHandlesPlaced = Boolean(visibleTabHandle && tabShell
        && headerHandleStyle.position === 'absolute'
        && tabHandleStyle?.position === 'absolute'
        && nearly(headerHandleRect.top + headerHandleRect.height / 2, topbar.getBoundingClientRect().bottom)
        && nearly(tabHandleRect.top + tabHandleRect.height / 2, tabShellRect.bottom)
        && tabHandleRect.top > headerHandleRect.bottom + 8);
      const headerHandleHit = document.elementFromPoint(
        headerHandleRect.left + headerHandleRect.width / 2,
        headerHandleRect.top + headerHandleRect.height / 2
      ) === handle;
      const tabHandleHit = Boolean(visibleTabHandle && tabHandleRect && document.elementsFromPoint(
        tabHandleRect.left + tabHandleRect.width / 2,
        tabHandleRect.top + tabHandleRect.height / 2
      )[0] === visibleTabHandle);
      const tabStorageBeforeHeaderResize = localStorage.getItem('workspaceTabHeight');
      const minDrag = await dragHeader(191, -1000);
      const compact = snapshot();
      const maxDrag = await dragHeader(192, 1000);
      const expanded = snapshot();
      const minClamped = nearly(compact.height, 34)
        && compact.ariaNow === 34;
      const maxClamped = nearly(expanded.height, 64)
        && expanded.ariaNow === 64;
      const brandAligned = nearly(compact.brandHeight, compact.height)
        && nearly(expanded.brandHeight, expanded.height);
      const textScales = expanded.titleFont >= compact.titleFont + 1
        && expanded.subtitleFont >= compact.subtitleFont + 1;
      const controlsScale = expanded.controlHeight >= compact.controlHeight + 4
        && expanded.controlFont >= compact.controlFont + 1
        && expanded.labelFont >= compact.labelFont + 1
        && expanded.iconSize >= compact.iconSize + 1;
      const controlsUnclipped = [compact, expanded].every(state => state.controlTop >= state.topbarTop - .5
        && state.controlBottom <= state.topbarBottom + .5);
      const pointerLifecycle = minDrag.started && minDrag.ended && maxDrag.started && maxDrag.ended;
      const heightPersisted = Number(localStorage.getItem('workspaceHeaderHeight')) === 64;
      handle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowUp'}));
      await nextFrame();
      const keyboardUp = window.termaWorkspaceChrome.value('header') === 64 - 1
        && Number(localStorage.getItem('workspaceHeaderHeight')) === 64 - 1;
      handle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'ArrowDown'}));
      await nextFrame();
      const keyboardDown = window.termaWorkspaceChrome.value('header') === 64;
      handle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Home'}));
      await nextFrame();
      const keyboardHome = window.termaWorkspaceChrome.value('header') === 34;
      handle.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
      await nextFrame();
      const keyboardEnd = window.termaWorkspaceChrome.value('header') === 64
        && nearly(snapshot().height, 64);
      const keyboardControls = keyboardUp && keyboardDown && keyboardHome && keyboardEnd;
      handle.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
      await nextFrame();
      const doubleClickResets = window.termaWorkspaceChrome.value('header') === 42
        && Number(localStorage.getItem('workspaceHeaderHeight')) === 42
        && nearly(snapshot().height, 42);
      window.termaWorkspaceChrome.apply("header",58, {persist:true,fit:false});
      window.termaWorkspaceChrome.apply("header",34, {fit:false});
      window.termaWorkspaceChrome.restore();
      await nextFrame();
      const restored = snapshot();
      const heightRestored = window.termaWorkspaceChrome.value('header') === 58
        && nearly(restored.height, 58)
        && nearly(restored.brandHeight, 58)
        && restored.ariaNow === 58;
      const tabStorageIndependent = localStorage.getItem('workspaceTabHeight') === tabStorageBeforeHeaderResize;
      return {
        found:true,
        classicAppearance,
        accessible,
        minClamped,
        maxClamped,
        brandAligned,
        textScales,
        controlsScale,
        controlsUnclipped,
        resizeHandlesPlaced,
        resizeHandlesHitTestable:headerHandleHit && tabHandleHit,
        pointerLifecycle,
        heightPersisted,
        keyboardControls,
        doubleClickResets,
        heightRestored,
        tabStorageIndependent,
        compact,
        expanded,
        restored
      };
    } finally {
      window.termaWorkspaceChrome.cancel();
      if (previousStoredHeaderHeight === null) localStorage.removeItem('workspaceHeaderHeight');
      else localStorage.setItem('workspaceHeaderHeight', previousStoredHeaderHeight);
      if (previousStoredTabHeight === null) localStorage.removeItem('workspaceTabHeight');
      else localStorage.setItem('workspaceTabHeight', previousStoredTabHeight);
      window.termaWorkspaceChrome.apply("header",previousHeaderHeight, {fit:false});
      window.termaWorkspaceChrome.apply("tabs",previousTabHeight, {fit:false});
      fixture.remove();
      tools.hidden = previousToolsHidden;
    }
  })()`);
  console.log("[ui-smoke] primary pages");
  const pages = await window.webContents.executeJavaScript(`(async () => {
    const rows = [];
    for (const name of ['connections','remote','running','command','logs','settings','import']) {
      window.termaWorkspaceShell.showPrimary(name);
      await new Promise(resolve => setTimeout(resolve, 250));
      const tools=document.querySelector('#explorerTools');
      const toolsRect=tools?.getBoundingClientRect();
      const expectedMode=['settings','import'].includes(name)?'section-mode':(['connections','remote'].includes(name)?'connection-mode':'compact-mode');
      // Primary actions and secondary actions occupy separate rows; logs also have search.
      const maxToolHeight=name==='settings'?264:(name==='import'?220:(name==='logs'?150:104));
      const controls=[...(tools?.querySelectorAll('button')||[])].map(button=>button.getBoundingClientRect());
      rows.push({
        name,
        width:document.documentElement.clientWidth,
        scrollWidth:document.documentElement.scrollWidth,
        visibleView:Array.from(document.querySelectorAll('.view')).find(el => !el.hidden)?.id || '',
        operationPaneWidth:document.querySelector('.left-pane')?.getBoundingClientRect().width||0,
        toolHeight:toolsRect?.height||0,
        toolFits:Boolean(tools&&toolsRect&&tools.scrollWidth<=tools.clientWidth+1&&controls.every(rect=>rect.left>=toolsRect.left-0.5&&rect.right<=toolsRect.right+0.5)),
        layoutMode:Boolean(tools?.classList.contains(expectedMode)),
        compactHeight:Boolean(toolsRect&&toolsRect.height<=maxToolHeight)
      });
    }
    return rows;
  })()`);
  console.log("[ui-smoke] settings and import navigation");
  const navigationUi = await window.webContents.executeJavaScript(`(async () => {
    const loadUpdate = (${loadUpdateFixture.toString()});
    document.documentElement.dataset.uiSmokeStage = 'settings-and-import-navigation';
    const previousPrimary = primaryView;
    const previousActiveView = activeView;
    const previousTabKey = activeTabKey;
    const previousSettingsSection = window.termaSettingsNavigation.section;
    const exchange = window.termaExchange.feature();
    const previousImportSection = exchange.current()?.state.section;
    const previousUpdate = window.termaUpdateStatus.current();
    const previousRuntimeSettings = window.termaRuntimeSettingsModel.snapshot;
    const previousSecurity = securitySettings;
    const previousDesktopSettings = window.termaDesktopStorage.snapshot;
    const previousLatestJobs = window.termaSftpTaskWorkspace.state.jobs;
    const previousLanguage = normalizeTermaLanguage(document.documentElement.lang || window.termaRuntimeSettingsModel.snapshot?.saved?.language);
    const UPDATE_NOTICE_SESSION_KEY = 'termaUpdateReadVersion';
    const previousStoredVersion = sessionStorage.getItem(UPDATE_NOTICE_SESSION_KEY);
    let thirdPartyLiveFixture = null;
    let thirdPartyLiveEditor = null;
    let thirdPartyLiveZmodemSession = null;
    try {
      primaryView = 'settings';
      await window.termaSettingsViews.open();
      window.termaSettingsNavigation.show('settings-general', {moveToWorkspace:false});
      document.documentElement.dataset.uiSmokeStage = 'settings-navigation-update-fixture';
      await loadUpdate({current_version:'1.0.8',latest_version:'1.0.9',update_available:true});
      window.termaRuntimeSettingsModel.snapshot = window.termaRuntimeSettingsModel.normalize({
        saved:{listen_hosts:['127.0.0.1','192.0.2.10'],listen_port:18100,sftp_recycle_bin_enabled:true},
        effective:{listen_hosts:['127.0.0.1','192.0.2.10'],listen_port:18100},
        available_hosts:[
          {address:'192.0.2.10',interface:'Ethernet',label:'Ethernet · 192.0.2.10'},
          {address:'192.0.2.11',interface:'Wi-Fi',label:'Wi-Fi · 192.0.2.11'}
        ],
        local_url:'http://127.0.0.1:18100',
        lan_urls:['http://192.0.2.10:18100'],
        restart_required:true
      });
      securitySettings = {
        ...securitySettings,
        trusted_proxy_enabled:false,
        local_direct_desktop_integration_enabled:false,
        local_direct_desktop_integration:{
          enabled:false,
          available:false,
          authorized:false,
          actual_listen_hosts:['127.0.0.1'],
          listen_loopback_only:true,
          direct_loopback_request:true,
          web_session_authenticated:true,
          web_access_authorized:true,
          blocked_reason:'disabled'
        }
      };
      window.termaDesktopStorage.snapshot = {
        available:true,
        storage_management_available:true,
        settings:{
          dataMode:'project',
          customDataDir:'',
          openAtLogin:false,
          minimizeToTray:true,
          startMinimizedToTray:false,
          showStartupNotification:true,
          xServerAutoStart:true
        },
        paths:{
          dataDir:'C:\\\\TermaSmoke\\\\data',
          sshDir:'C:\\\\TermaSmoke\\\\.ssh'
        },
        storage:{
          root:'C:\\\\TermaSmoke',
          data_dir:'C:\\\\TermaSmoke\\\\data',
          ssh_dir:'C:\\\\TermaSmoke\\\\.ssh'
        },
        project_mode_available:true,
        project_mode_label:'项目所在文件夹',
        xserver:{available:false,installed:false}
      };
      sessionStorage.removeItem(UPDATE_NOTICE_SESSION_KEY);
      document.documentElement.dataset.uiSmokeStage = 'settings-navigation-mount';
      window.termaSettingsViews.render();
      window.termaConnectionViews.renderExplorerTools();
      window.termaUpdateNotice.paint();
      let settingsResponsiveColumns = {narrow:'', wide:'', viewportWide:false};
      {
        document.documentElement.dataset.uiSmokeStage = 'settings-navigation-waterfall';
        const fixture = document.createElement('div');
        fixture.className = 'workspace-pane';
        fixture.style.cssText = 'position:fixed;left:-3000px;top:0;width:1000px;height:320px;overflow:hidden';
        fixture.innerHTML = '<div class="settings-grid settings-waterfall"><section>One</section><section>Two</section></div>';
        document.body.appendChild(fixture);
        try {
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const waterfall = fixture.querySelector('.settings-waterfall');
          settingsResponsiveColumns.narrow = getComputedStyle(waterfall).columnCount;
          fixture.style.width = '1200px';
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          settingsResponsiveColumns.wide = getComputedStyle(waterfall).columnCount;
          settingsResponsiveColumns.viewportWide = document.documentElement.clientWidth > 1100;
        } finally {
          fixture.remove();
        }
        if (settingsResponsiveColumns.narrow !== '1' || (settingsResponsiveColumns.viewportWide && settingsResponsiveColumns.wide !== '2')) {
          throw new Error('general settings waterfall did not follow the split-pane container width: ' + JSON.stringify(settingsResponsiveColumns));
        }
      }
      document.documentElement.dataset.uiSmokeStage = 'settings-navigation-language';
      await setTermaLanguage('zh-CN');
      const visibleHan = [];
      const thirdPartyLiveSwitch = {
        scenario:'third-party-live-language-switch',
        aceSeededChinese:false,
        zmodemSeededChinese:false,
        aceClean:false,
        zmodemClean:false,
        zmodemLocalizedTitle:false,
        zmodemUserTextPreserved:false
      };
      const collectThirdPartyChromeHan = (root, textSelector, preservedValues=[]) => {
        const findings = [];
        if (!root) return findings;
        const chromeValue = value => preservedValues.reduce((result, preserved) => result.split(preserved).join(''), value);
        for (const textRoot of root.querySelectorAll(textSelector)) {
          const walker = document.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const value = String(walker.currentNode.nodeValue || '').replace(/\\s+/g, ' ').trim();
            if (value && /[㐀-鿿]/.test(chromeValue(value))) findings.push(value);
          }
        }
        const elements = [];
        if (root.matches?.('[title],[aria-label],[placeholder],[aria-roledescription]')) elements.push(root);
        elements.push(...root.querySelectorAll('[title],[aria-label],[placeholder],[aria-roledescription]'));
        for (const element of elements) {
          for (const attribute of ['title','aria-label','placeholder','aria-roledescription']) {
            const value = String(element.getAttribute(attribute) || '').replace(/\\s+/g, ' ').trim();
            if (value && /[㐀-鿿]/.test(chromeValue(value))) findings.push('@' + attribute + '=' + value);
          }
        }
        return findings;
      };
      if (typeof window.ace?.edit !== 'function') throw new Error('Ace runtime was not loaded before the live language-switch scenario');
      document.documentElement.dataset.uiSmokeStage = 'settings-live-third-party-ace';
      window.ace.config.set('basePath', '/vendor/ace');
      window.ace.config.set('useStrictCSP', true);
      window.termaAceLocalization.sync();
      thirdPartyLiveFixture = document.createElement('section');
      thirdPartyLiveFixture.style.cssText = 'position:fixed;left:-2000px;top:0;width:720px;height:420px;z-index:9999;background:var(--panel)';
      thirdPartyLiveFixture.innerHTML = '<div class="sftp-code-editor third-party-live-ace" style="width:100%;height:260px"></div><div class="terminal-box third-party-live-zmodem"></div>';
      document.body.appendChild(thirdPartyLiveFixture);
      const thirdPartyLiveAceHost = thirdPartyLiveFixture.querySelector('.third-party-live-ace');
      thirdPartyLiveEditor = window.ace.edit(thirdPartyLiveAceHost);
      thirdPartyLiveAceHost.__termaAceEditor = thirdPartyLiveEditor;
      thirdPartyLiveEditor.session.setUseWorker(false);
      thirdPartyLiveEditor.setValue('{\\n  "value": 1\\n}\\n', -1);
      document.documentElement.dataset.uiSmokeStage = 'settings-live-third-party-ace-mode';
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Ace JSON mode did not load')), 5000);
        thirdPartyLiveEditor.session.setMode('ace/mode/json', () => { clearTimeout(timeout); resolve(); });
      });
      document.documentElement.dataset.uiSmokeStage = 'settings-live-third-party-ace-search';
      thirdPartyLiveEditor.setOption('enableKeyboardAccessibility', true);
      thirdPartyLiveEditor.session.setAnnotations([{row:0,column:0,text:'Smoke warning',type:'warning'}]);
      thirdPartyLiveEditor.renderer.updateFull(true);
      thirdPartyLiveEditor.execCommand('find');
      for (let attempt=0; attempt<20 && !thirdPartyLiveFixture.querySelector('.ace_search'); attempt+=1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      window.termaAceLocalization.sync(thirdPartyLiveFixture);
      document.documentElement.dataset.uiSmokeStage = 'settings-live-third-party-zmodem';
      thirdPartyLiveZmodemSession = {mount:thirdPartyLiveFixture.querySelector('.third-party-live-zmodem')};
      const thirdPartyLiveZmodemFilename = '设置';
      window.termaTerminalZmodem.render(thirdPartyLiveZmodemSession, {
        titleKey:'terminal:zmodem.receiving_file',
        titleOptions:{name:thirdPartyLiveZmodemFilename, defaultValue:'正在接收 ' + thirdPartyLiveZmodemFilename},
        detailKey:'terminal:zmodem.binary_mode_hint',
        detailOptions:{defaultValue:'已启用二进制传输模式；按 Ctrl+C 可取消'},
        primaryAction:'send',
        primaryLabelKey:'terminal:zmodem.choose_files',
        primaryLabelOptions:{defaultValue:'选择文件'}
      });
      const aceChineseBeforeSwitch = collectThirdPartyChromeHan(thirdPartyLiveAceHost, '.ace_search');
      const zmodemChineseBeforeSwitch = collectThirdPartyChromeHan(thirdPartyLiveZmodemSession.mount, '.terminal-zmodem-panel', [thirdPartyLiveZmodemFilename]);
      thirdPartyLiveSwitch.aceSeededChinese = aceChineseBeforeSwitch.length > 0;
      thirdPartyLiveSwitch.zmodemSeededChinese = zmodemChineseBeforeSwitch.length > 0;
      const tabsBeforeLanguageSwitch = tabs.map(tab => tab.key);
      const languageTaskFixtures = [
        {id:'language-paused-cross-copy',status:'paused',type:'cross-copy',label:'跨 SFTP 传输',connection_id:1,connection_name:'Target',size:100,transferred:50,can_resume:true,resume_supported:true},
        {id:'language-running-cross-copy',status:'running',type:'cross-copy',phase:'transferring',label:'跨 SFTP 传输',connection_id:1,connection_name:'Target',size:100,transferred:25,can_pause:true,resume_supported:true}
      ];
      window.termaSftpTaskWorkspace.state.jobs = languageTaskFixtures;
      window.termaSftpTaskWorkspace.state.paint(languageTaskFixtures);
      const originalLanguageApi = api;
      const languageRequests = [];
      api = async (path, options={}) => {
        if (path === '/api/runtime-settings' && String(options.method || 'GET').toUpperCase() === 'PUT') {
          const body = JSON.parse(options.body || '{}');
          languageRequests.push(body);
          return window.termaRuntimeSettingsModel.normalize({
            ...window.termaRuntimeSettingsModel.snapshot,
            saved:{...window.termaRuntimeSettingsModel.snapshot.saved, language:body.language}
          });
        }
        return originalLanguageApi(path, options);
      };
      document.documentElement.dataset.uiSmokeStage = 'settings-live-third-party-language-toggle';
      document.querySelector('#languageToggle')?.click();
      document.documentElement.dataset.uiSmokeStage = 'settings-live-third-party-language-wait';
      for (let attempt=0; attempt<30 && document.documentElement.lang !== 'en-US'; attempt+=1) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      api = originalLanguageApi;
      document.documentElement.dataset.uiSmokeStage = 'settings-live-third-party-language-frame';
      await Promise.race([
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        new Promise((_,reject) => setTimeout(() => reject(Error('Language switch did not produce two animation frames')), 2500))
      ]);
      document.documentElement.dataset.uiSmokeStage = 'settings-live-third-party-language-review';
      const aceHanAfterSwitch = collectThirdPartyChromeHan(thirdPartyLiveAceHost, '.ace_search');
      const zmodemHanAfterSwitch = collectThirdPartyChromeHan(thirdPartyLiveZmodemSession.mount, '.terminal-zmodem-panel', [thirdPartyLiveZmodemFilename]);
      thirdPartyLiveSwitch.aceClean = aceHanAfterSwitch.length === 0;
      thirdPartyLiveSwitch.zmodemClean = zmodemHanAfterSwitch.length === 0;
      const thirdPartyLiveZmodemTitle = String(thirdPartyLiveZmodemSession.mount.querySelector('.terminal-zmodem-copy strong')?.textContent || '');
      thirdPartyLiveSwitch.zmodemLocalizedTitle = thirdPartyLiveZmodemTitle === tr('terminal:zmodem.receiving_file', {name:thirdPartyLiveZmodemFilename});
      thirdPartyLiveSwitch.zmodemUserTextPreserved = thirdPartyLiveZmodemTitle.includes(thirdPartyLiveZmodemFilename);
      visibleHan.push(...aceHanAfterSwitch.map(value => 'third-party-live-ace: ' + value));
      visibleHan.push(...zmodemHanAfterSwitch.map(value => 'third-party-live-zmodem: ' + value));
      window.termaTerminalZmodem.render(thirdPartyLiveZmodemSession, {hidden:true});
      try { thirdPartyLiveEditor.destroy(); } catch {}
      thirdPartyLiveFixture.remove();
      thirdPartyLiveEditor = null;
      thirdPartyLiveZmodemSession = null;
      thirdPartyLiveFixture = null;
      window.termaSettingsViews.render();
      window.termaConnectionViews.renderExplorerTools();
      await new Promise(resolve => setTimeout(resolve, 0));
      const englishTaskButtons = [...document.querySelectorAll('#sftpTaskCenterList .sftp-job .actions button')].map(button => button.textContent.trim());
      const languageButton = document.querySelector('#languageToggle');
      const languageThemeButton = document.querySelector('#themeToggle');
      const languageRect = languageButton?.getBoundingClientRect();
      const themeRect = languageThemeButton?.getBoundingClientRect();
      // The review owns its user-content exclusions instead of calling a retired global helper.
      const skipTranslationReview = element => Boolean(element?.closest(
        'script,style,code,pre,.xterm,.terminal-box,.log-content,.log-line,.ace_editor,' +
        '.sftp-name-cell,.local-files-name-cell,.connection-name,.vnc-screen,.vnc-viewport,.vnc-rfb,[data-i18n-skip]'
      ));
      const collectVisibleHan = (scope, includeHidden=false, root=document.body) => {
        const scanRoot = root?.nodeType ? root : document.body;
        const walker = document.createTreeWalker(scanRoot, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const parent = node.parentElement;
          const value = String(node.nodeValue || '').replace(/\\s+/g,' ').trim();
          if (!value || !/[㐀-鿿]/.test(value) || !parent || skipTranslationReview(parent)) continue;
           if (!includeHidden && (!parent.getClientRects().length || getComputedStyle(parent).visibility === 'hidden')) continue;
           visibleHan.push(scope+': '+value);
         }
        for (const element of scanRoot.querySelectorAll?.('[title],[aria-label],[placeholder]') || []) {
          if (skipTranslationReview(element) || (!includeHidden && (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden'))) continue;
          for (const attribute of ['title','aria-label','placeholder']) {
            const value = String(element.getAttribute(attribute) || '').replace(/\\s+/g,' ').trim();
            if (value && /[㐀-鿿]/.test(value)) visibleHan.push(scope+': @'+attribute+'='+value);
          }
        }
      };
      const collectTranslatedHan = async (scope, includeHidden=false, root=document.body) => {
        applyTermaTranslations(root || document.body);
        await new Promise(resolve => setTimeout(resolve, 0));
        collectVisibleHan(scope, includeHidden, root);
      };
      for (const section of ['settings-general','settings-ai','settings-basic','settings-notifications','settings-runtime','settings-cache','settings-about']) {
        window.termaSettingsNavigation.show(section, {moveToWorkspace:false});
        await new Promise(resolve => setTimeout(resolve, 0));
        collectVisibleHan(section);
      }
      const generalVncFullscreenToolbar = document.querySelector('#settings-general #generalVncFullscreenToolbar');
      if (!generalVncFullscreenToolbar || JSON.stringify([...generalVncFullscreenToolbar.options].map(option => option.value)) !== JSON.stringify(['always','never','edge'])) {
        throw new Error('VNC fullscreen toolbar preference is missing from general settings');
      }
      const backgroundIntervalDefaults = {
        generalUiRefreshIntervalSeconds:'4',
        generalSftpActiveStatusIntervalSeconds:'5',
        generalSftpBackgroundStatusIntervalSeconds:'15',
        generalVncLocalImageIntervalSeconds:'5',
        generalVncRemoteImageIntervalSeconds:'3'
      };
      for (const [id, value] of Object.entries(backgroundIntervalDefaults)) {
        const input = document.querySelector('#settings-general #' + id);
        if (!input || input.value !== value || input.min !== '1' || input.max !== '60') {
          throw new Error(id + ' background interval preference is missing or invalid');
        }
      }
      if (document.querySelector('#settings-runtime #runtimeVncFullscreenToolbar')) {
        throw new Error('VNC fullscreen toolbar preference is still present in listener settings');
      }
      for (const name of ['connections','remote','running','command','logs','import']) {
        window.termaWorkspaceShell.showPrimary(name);
        await new Promise(resolve => setTimeout(resolve, 0));
        collectVisibleHan(name);
      }
      const previousLanguageApi = api;
      const languageRemoteConnection = connections[0] || {id:1,name:'Language SSH',ssh_host:'192.0.2.7',ssh_port:22,ssh_user:'smoke',x11_mode:'trusted'};
      const languageVncProfile = {id:910091,name:'Language VNC',protocol:'vnc',host:'192.0.2.77',port:5900,username:'',options:{source_ssh_connection_id:Number(languageRemoteConnection.id),view_only:false}};
      const languageVncKey = 'language-vnc-clipboard';
      const languageVncSession = {key:languageVncKey,profile:languageVncProfile,rfb:{viewOnly:false},screen:document.createElement('div'),connecting:false,connected:true,clipboardAutoSync:false,clipboardTransport:'ssh-linux-x11',clipboardTransportChecked:true,clipboardBridgeTool:'xclip',remoteClipboardAvailable:false,remoteClipboardPending:false,remoteClipboardText:'',viewport:null};
      window.termaVncRuntime.session.sessions.set(languageVncKey, languageVncSession);
      api = async (path, options={}) => {
        const value = String(path);
        if (value === '/api/xserver') return {integration_available:true,desktop:true,desktop_backend_available:true,authorization_required:false,platform:'linux',available:true,running:true,managed:true,mode:'native',server:'X11',display:':0',reason:'X Server 已就绪',can_start:false,can_stop:false,can_install:false};
        if (value.endsWith('/x11-forwarding')) return {platform:'linux',ready:true,enabled:true,x11_forwarding:'yes',sshd_present:true,config_present:true,can_manage:true,can_terminal_manage:true,xauth_path:'/usr/bin/xauth',xauth_location:'/usr/bin/xauth',x11_display_offset:'10',terminal_commands:{}};
        if (value.endsWith('/x11-clipboard/helper')) return {platform:'linux',installed:false,package_manager:'apt',reason:'远端尚未安装 xclip；安装后可从 X11 转发终端粘贴图片',install_plan:{online:{available:true,description:'在线安装'},offline:{available:true,description:'使用远端缓存'},local_offline:{available:true,package_names:['xclip'],description:'本机下载后离线安装'},manual:{available:true,description:'手动安装/配置说明'}},guide:{steps:['确认本机 X Server 已启动'],commands:['command -v xclip']},uninstall_plan:{available:false}};
        return previousLanguageApi(value, options);
      };
      try {
        document.documentElement.dataset.uiSmokeStage = 'settings-xserver-and-vnc';
        await window.termaX11.openManager(Number(languageRemoteConnection.id));
        collectVisibleHan('xserver');
        window.termaX11.closeManager();
        window.termaVncRuntime.session.mount(languageVncProfile, languageVncKey, {platform:'linux'});
        await new Promise(resolve => setTimeout(resolve, 0));
        const vncToolbar = document.querySelector('#view-remote-desktop .vnc-toolbar-actions');
        if (!vncToolbar?.querySelector('[data-vnc-fullscreen-toggle]')) throw new Error('VNC fullscreen toggle is missing');
        if (vncToolbar?.querySelector('[data-vnc-window-maximize]')) throw new Error('VNC native maximize toggle should use the Electron title bar instead');
        if (![...vncToolbar.querySelectorAll('button')].some(button => button.title === 'Open in new window')) throw new Error('VNC detached-window action is missing');
        if (!document.querySelector('#view-remote-desktop .vnc-fullscreen-toolbar-edge-zone')) throw new Error('VNC fullscreen top-edge target is missing');
        const originalSetTimeout = window.setTimeout;
        let fullscreenToolbarHideDelay = null;
        try {
          window.setTimeout = (callback, delay, ...args) => {
            fullscreenToolbarHideDelay = Number(delay);
            return originalSetTimeout(callback, 0, ...args);
          };
          document.documentElement.classList.add('vnc-fullscreen-toolbar-edge-visible');
          termaVncRuntime.fullscreen.hide();
        } finally {
          window.setTimeout = originalSetTimeout;
        }
        await new Promise(resolve => originalSetTimeout(resolve, 0));
        if (fullscreenToolbarHideDelay !== 500) throw new Error('VNC fullscreen toolbar hide delay should be 500ms, got ' + fullscreenToolbarHideDelay);
        if (document.documentElement.classList.contains('vnc-fullscreen-toolbar-edge-visible')) throw new Error('VNC fullscreen toolbar hide timer did not collapse the toolbar');
        collectVisibleHan('vnc');
        collectVisibleHan('document', true);
        const vncWindowBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'termaDesktop');
        const originalWindowOpen = window.open;
        const browserProfileId = Number(languageVncProfile.id);
        const previousWindowProfiles = remoteProfiles;
        remoteProfiles = [...remoteProfiles.filter(profile=>Number(profile.id)!==browserProfileId), languageVncProfile];
        const vncWindowLifecycle = [];
        try {
          Object.defineProperty(window, 'termaDesktop', {configurable:true,writable:true,value:undefined});
          const browserPopup = {
            closed:false,
            location:{href:'about:blank',replace(value){this.href=String(value);}},
            focus(){},
            close(){this.closed=true;}
          };
          window.open = () => browserPopup;
          await termaVncRuntime.windows.close(browserProfileId);
          const firstBrowserReservation = termaVncRuntime.windows.reserve(browserProfileId);
          const secondBrowserReservation = termaVncRuntime.windows.reserve(browserProfileId);
          if (!firstBrowserReservation?.created || secondBrowserReservation?.created || firstBrowserReservation.child !== browserPopup || secondBrowserReservation?.child !== browserPopup || firstBrowserReservation.state !== secondBrowserReservation?.state || firstBrowserReservation.state?.claims.size !== 2) {
            throw new Error('Web VNC popup was not reserved synchronously');
          }
          termaVncRuntime.windows.cancel(firstBrowserReservation);
          if (browserPopup.closed || firstBrowserReservation.state?.claims.size !== 1 || !termaVncRuntime.windows.active(browserProfileId)) throw new Error('A stale VNC probe closed a popup still claimed by another request');
          const reservedUrl = new URL(location.href);
          reservedUrl.searchParams.set('termaVncWindow', String(browserProfileId));
          if (termaVncRuntime.windows.commit(secondBrowserReservation, reservedUrl.href) !== browserPopup || browserPopup.location.href !== reservedUrl.href || browserPopup.closed || termaVncRuntime.windows.active(browserProfileId)) {
            throw new Error('Shared Web VNC popup was not committed atomically');
          }
          termaVncRuntime.windows.cancel(secondBrowserReservation);
          if (browserPopup.closed) throw new Error('Committed Web VNC popup was closed while releasing its final probe claim');
          browserPopup.close();
          await termaVncRuntime.windows.close(browserProfileId);
          window.open = originalWindowOpen;
          Object.defineProperty(window, 'termaDesktop', {
            configurable:true,
            writable:true,
            value:{
              async openVncWindow(profileId) {
                vncWindowLifecycle.push({action:'open-detached',profileId,embeddedActive:window.termaVncRuntime.session.sessions.has(languageVncKey)});
                return {ok:true,profileId,reused:false};
              },
              async closeVncWindowForProfile(profileId) {
                vncWindowLifecycle.push({action:'close-detached',profileId});
                return {ok:true,profileId,closed:true};
              }
            }
          });
          const detachedOpened = await termaVncRuntime.windows.open(languageVncProfile.id, languageVncKey);
          const embeddedPrepared = await termaVncRuntime.windows.embedded(languageVncProfile.id);
          if (!detachedOpened || window.termaVncRuntime.session.sessions.has(languageVncKey)) throw new Error('Opening a detached VNC window did not close the built-in session');
          if (vncWindowLifecycle[0]?.action !== 'open-detached' || !vncWindowLifecycle[0]?.embeddedActive) throw new Error('Built-in VNC closed before native window success was known');
          if (!embeddedPrepared || vncWindowLifecycle[1]?.action !== 'close-detached') throw new Error('Switching to built-in VNC did not close the detached window');
        } finally {
          window.open = originalWindowOpen;
          remoteProfiles = previousWindowProfiles;
          if (vncWindowBridgeDescriptor) Object.defineProperty(window, 'termaDesktop', vncWindowBridgeDescriptor);
          else delete window.termaDesktop;
        }
      } finally {
        window.termaX11.closeManager();
        window.termaVncRuntime.session.sessions.delete(languageVncKey);
        api = previousLanguageApi;
      }
      const i18nScenarioErrors = [];
      const runI18nScenario = async (name, action, options={}) => {
        try {
          document.documentElement.dataset.uiSmokeStage = 'settings-i18n-' + name + '-action';
          await action();
          if (options.translate === false) return;
          document.documentElement.dataset.uiSmokeStage = 'settings-i18n-' + name + '-translations';
          await new Promise(resolve => setTimeout(resolve, 0));
          applyTermaTranslations(document);
          document.documentElement.dataset.uiSmokeStage = 'settings-i18n-' + name + '-settle';
          await new Promise(resolve => setTimeout(resolve, 0));
        } catch (error) {
          i18nScenarioErrors.push(name + ': ' + (error?.message || error));
        }
      };
      await runI18nScenario('file-picker-language-switch', async () => {
        window.termaWorkspaceShell.showPrimary('import');
        await new Promise(resolve=>setTimeout(resolve,0));
        const input = document.getElementById('config_upload');
        const name = input?.closest('.exchange-picker')?.querySelector('small');
        if (!input || !name) throw new Error('config file picker was not found');
        const change=files=>{
          Object.defineProperty(input,'files',{configurable:true,value:files});
          input.dispatchEvent(new Event('change',{bubbles:true}));
        };
        try {
          change([]);
          if (name.textContent.trim() !== 'No file selected') throw new Error('empty file picker was not generated in English');
          change([new File(['fixture'],'中文配置.conf')]);
          if (name.textContent.trim() !== '中文配置.conf') throw new Error('selected user filename was not preserved');
          await setTermaLanguage('zh-CN', {emit:false});
          await setTermaLanguage('en-US', {emit:false});
          applyTermaTranslations(name);
          if (name.textContent.trim() !== '中文配置.conf') throw new Error('selected user filename changed after switching languages');
          change([]);
          await setTermaLanguage('zh-CN', {emit:false});
          window.dispatchEvent(new CustomEvent('terma:language-changed'));
          if (name.textContent.trim() !== '未选择文件') throw new Error('empty file picker did not refresh in Chinese');
          await setTermaLanguage('en-US', {emit:false});
          window.dispatchEvent(new CustomEvent('terma:language-changed'));
          if (name.textContent.trim() !== 'No file selected') throw new Error('cleared file picker did not restore the English empty state');
        } finally {
          delete input.files;
          window.termaWorkspaceShell.showPrimary('settings');
        }
      });
      await runI18nScenario('connection-health-diagnosis', async () => {
        const oldApi=api, oldProgress=createProgressToast, id=-9401;
        let text='';
        const check = async (code, raw, preserve) => {
          api=async (route, options)=>route==='/api/connections/'+id+'/health'
            ? {ok:false,ssh:{ok:false,diagnosis:{reason_code:code,message:raw},raw_output:raw,preserve_raw_output:preserve}}
            : oldApi(route, options);
          await window.termaConnectionHealthActions.check(id,null,{skipCredentialRepair:true});
          return text;
        };
        try {
          createProgressToast=()=>({fail:message=>{text=message;}});
          const fixed=await check('ssh_handshake_timeout','SSH 握手超时，请检查主机地址、端口和 SSH 服务',false);
          if (!fixed.includes('SSH handshake timed out. Check the host address, port, and SSH service.') || /[㐀-鿿]/.test(fixed)) throw new Error('fixed SSH health diagnosis was not generated in English');
          const remoteOutput='远端自定义诊断输出';
          const preserved=await check('ssh_failed',remoteOutput,true);
          if (!preserved.includes('The SSH connection failed.') || !preserved.includes(remoteOutput)) throw new Error('raw remote SSH output was not preserved');
        } finally {
          api=oldApi;createProgressToast=oldProgress;healthResults.delete(id);
        }
      });
      await runI18nScenario('third-party-components', async () => {
        if (typeof window.ace?.edit !== 'function') throw new Error('Ace runtime was not loaded');
        if (typeof window.Diff?.diffLines !== 'function') throw new Error('jsdiff runtime was not loaded');
        if (typeof window.Zmodem?.Sentry !== 'function') throw new Error('ZMODEM runtime was not loaded');
        const aceMessages = window.termaAceLocalization.messages();
        if (Object.values(aceMessages).some(value => /[㐀-鿿]/.test(String(value)))) {
          throw new Error('Ace messages still contain Chinese');
        }
        const fixture = document.createElement('section');
        fixture.style.cssText = 'position:fixed;left:24px;top:24px;width:720px;height:420px;z-index:9999;background:var(--panel)';
        fixture.innerHTML = '<div class="third-party-ace" style="width:100%;height:220px"></div><div class="third-party-diff"></div><div class="third-party-zmodem"></div>';
        document.body.appendChild(fixture);
        let editor = null;
        try {
          const aceHost = fixture.querySelector('.third-party-ace');
          editor = window.ace.edit(aceHost);
          editor.setValue('first\\nsecond\\n', -1);
          editor.execCommand('find');
          let findInput = null;
          let replaceInput = null;
          for (let attempt=0; attempt<20 && !findInput; attempt+=1) {
            await new Promise(resolve => setTimeout(resolve, 10));
            findInput = fixture.querySelector('.ace_search_form .ace_search_field');
            replaceInput = fixture.querySelector('.ace_replace_form .ace_search_field');
          }
          window.termaAceLocalization.sync(fixture);
          if (!findInput || findInput.placeholder !== aceMessages['search-box.find.placeholder']) {
            throw new Error('Ace find placeholder was not localized: ' + JSON.stringify({actual:findInput?.placeholder || '', expected:aceMessages['search-box.find.placeholder']}));
          }
          if (!replaceInput || replaceInput.placeholder !== aceMessages['search-box.replace.placeholder']) {
            throw new Error('Ace replace placeholder was not localized: ' + JSON.stringify({actual:replaceInput?.placeholder || '', expected:aceMessages['search-box.replace.placeholder']}));
          }
          const diffHost = fixture.querySelector('.third-party-diff');
          diffHost.innerHTML = sftpDiffViewerHtml('first\\nold value\\n', 'first\\nnew value\\n', {
            oldLabel:tr('sftp:diff.old_version'),
            newLabel:tr('sftp:diff.new_version')
          });
          const zmodemMount = fixture.querySelector('.third-party-zmodem');
          const zmodemSession = {mount:zmodemMount};
          window.termaTerminalZmodem.render(zmodemSession, {
            detailKey:'terminal:zmodem.binary_mode_hint',
            detailOptions:{defaultValue:'已启用二进制传输模式；按 Ctrl+C 可取消'},
            primaryAction:'send',
            primaryLabelKey:'terminal:zmodem.choose_files',
            primaryLabelOptions:{defaultValue:'选择文件'}
          });
          collectVisibleHan('third-party-components', true, fixture);
          window.termaTerminalZmodem.render(zmodemSession, {hidden:true});
        } finally {
          try { editor?.destroy(); } catch {}
          fixture.remove();
        }
      });
      await runI18nScenario('welcome', async () => {
        const scenarioApi = api;
        api = async (path, options={}) => String(path) === '/api/startup-status'
          ? {state:'ready',local_url:'http://127.0.0.1:18100',lan_urls:[]}
          : scenarioApi(path, options);
        try {
          await setTermaLanguage('zh-CN', {emit:false});
          window.termaConnectionViews.renderWelcome();
          await new Promise(resolve => setTimeout(resolve, 0));
          if (document.getElementById('workspaceSubtitle')?.textContent.trim() !== '选择左侧项目后开始操作') throw new Error('welcome workspace subtitle was not seeded in Chinese');
          await setTermaLanguage('en-US', {emit:false});
          await new Promise(resolve => setTimeout(resolve, 0));
          applyTermaTranslations(document.getElementById('view-welcome'));
          collectVisibleHan('welcome-open', true, document.getElementById('view-welcome'));
          collectVisibleHan('welcome-workspace-header-after-switch', true, document.querySelector('.workspace-heading'));
          if (document.getElementById('workspaceSubtitle')?.textContent.trim() !== 'Select an item on the left to begin') throw new Error('welcome workspace subtitle did not switch to English');
        } finally {
          api = scenarioApi;
        }
      });
      await runI18nScenario('rdp-form', async () => {
        window.termaRemoteProfiles.editor.render({id:910099,protocol:'rdp',name:'Language RDP',group_name:'Default',options:{display_mode:'dynamic',clipboard:true}});
        await new Promise(resolve => setTimeout(resolve, 0));
        applyTermaTranslations(document.getElementById('view-edit'));
        const editActions = [...document.querySelectorAll('#remoteProfileForm button[type="submit"]')].map(button => button.textContent.trim());
        if (!['Save only','Save and close','Save and open'].every(label => editActions.includes(label))) throw new Error('remote connection edit save actions were not generated in English');
        collectVisibleHan('rdp-form-open', true, document.getElementById('view-edit'));
      });
      await runI18nScenario('quick-panel', async () => {
        await window.termaEfficiency.palette.open();
        window.termaEfficiency.palette.refresh('');
        await new Promise(resolve => setTimeout(resolve, 0));
        applyTermaTranslations(document);
        collectVisibleHan('quick-panel-open', true, document.getElementById('quickPanel'));
        window.termaEfficiency.palette.close();
      });
      await runI18nScenario('ssh-key-wizard', async () => {
        window.termaKeyWizard.open();
        await new Promise(resolve => setTimeout(resolve, 0));
        applyTermaTranslations(document);
        collectVisibleHan('ssh-key-wizard-open', true, document.getElementById('modal'));
        closeModal();
      });
      await runI18nScenario('connected-tab-close', async () => {
        const decision = window.termaWorkspaceTabActions.confirm([{title:'Language Terminal',connectionStatus:'connected'}]);
        await new Promise(resolve => setTimeout(resolve, 0));
        collectVisibleHan('connected-tab-close-modal', true, document.getElementById('modal'));
        document.getElementById('workspaceCloseTabsCancel')?.click();
        await decision;
      });
      await runI18nScenario('recent-commands', async () => {
        const previousRecentCommands = window.termaTerminalHistory.list();
        ((items)=>{window.termaTerminalHistory.clear();[...items].reverse().forEach(window.termaTerminalHistory.save);})(['printf "language smoke"']);
        try {
          window.termaTerminalTextDialogs.recent('language-terminal');
          const modal = document.getElementById('modal');
          collectVisibleHan('recent-commands-immediate', true, modal);
          if (modal?.querySelector('h2')?.textContent.trim() !== 'Recent commands') throw new Error('recent commands dialog was not generated in English');
          document.getElementById('recentCommandClose')?.click();
        } finally {
          ((items)=>{window.termaTerminalHistory.clear();[...items].reverse().forEach(window.termaTerminalHistory.save);})(previousRecentCommands);
          closeModal();
        }
      });
      await runI18nScenario('workspace-tab-menu', async () => {
        const tab = tabs.find(item => item.closable !== false) || tabs[0];
        if (!tab) throw new Error('no workspace tab available');
        window.termaWorkspaceTabActions.showMenu({preventDefault(){},stopPropagation(){},clientX:160,clientY:120}, tab.key);
        await collectTranslatedHan('workspace-tab-menu-open', true, document.getElementById('tabContextMenu'));
        window.termaWorkspaceTabActions.hideMenu();
      });
      await runI18nScenario('local-files-shortcuts', async () => {
        const host = document.createElement('div');
        try {
          const shortcut = document.createElement('button');
          shortcut.title = tr('navigation:auto.new_local_files_tab');
          shortcut.dataset.action = 'local-files-new-tab';
          shortcut.innerHTML = icon('hard-drive');
          host.append(shortcut);
          document.body.appendChild(host);
          await collectTranslatedHan('local-files-shortcut-button', true, host);
          window.termaLocalFileRuntime.pages.menu({preventDefault(){},stopPropagation(){},clientX:180,clientY:140});
          const menu = document.getElementById('actionMenu');
          if (!menu) throw new Error('local files menu was not opened');
          await collectTranslatedHan('local-files-shortcut-menu', true, menu);
        } finally {
          hideActionMenu();
          host.remove();
        }
      });
      await runI18nScenario('local-files-view', async () => {
        const tabKey = 'language-local-files-view';
        const host = document.createElement('div');
        host.innerHTML = '<div id="view-local-files"><div class="local-files-shell"><div class="local-files-list"></div></div></div>';
        document.body.appendChild(host);
        const fixtureRoot = host.querySelector('#view-local-files');
        Object.assign(window.termaLocalFileRuntime.files.state(tabKey), {
          path:'C:/LanguageSmoke',displayPath:'C:/LanguageSmoke',location:'directory',parent:'C:/',parentKind:'directory',
          page:1,pageSize:50,total:1,totalPages:1,loaded:true,query:'',sort:'name',dir:'asc',
          entries:[{name:'notes.txt',path:'C:/LanguageSmoke/notes.txt',type:'file',size:12,mtime:1700000000,mode:'644'}]
        });
        try {
          window.termaLocalFileViews.mount(fixtureRoot,window.termaLocalFileRuntime.viewOptions(tabKey));
          const root = fixtureRoot;
          collectVisibleHan('local-files-view-immediate', true, root);
          const row = root?.querySelector('.local-files-row');
          if (!row) throw new Error('local files row was not rendered');
          row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:220,clientY:180}));
          const menu = document.getElementById('actionMenu');
          collectVisibleHan('local-files-context-menu-immediate', true, menu);
          const labels = [...menu.querySelectorAll('button span')].map(item => item.textContent.trim());
          if (!labels.includes('Open / Edit') || !labels.includes('Open in system file manager') || !labels.includes('Copy path')) throw new Error('local files context menu was not generated in English');
        } finally {
          hideActionMenu();
          window.termaLocalFileViews.release(tabKey);
          window.termaLocalFileRuntime.files.dispose(tabKey);
          host.remove();
        }
      });
      await runI18nScenario('remote-explorer-menu', async () => {
        window.termaWorkspaceShell.showPrimary('remote');
        await collectTranslatedHan('remote-explorer-actions', true, document.getElementById('explorerTools'));
      });
      await runI18nScenario('sftp-settings', async () => {
        const scenarioApi = api;
        api = async (path, options={}) => String(path) === '/api/sftp/download-settings'
          ? {delivery_mode:'desktop',configured_directory:'',default_directory:'C:\\Downloads',effective_directory:'C:\\Downloads'}
          : scenarioApi(path, options);
        try {
          await window.termaSftpGlobalSettings.open();
          for (const [index, section] of ['general','editor','transfer'].entries()) {
            document.querySelectorAll('#modal .sftp-global-settings-modal [role="tab"]')[index]?.click();
            await new Promise(resolve => setTimeout(resolve, 0));
            collectVisibleHan('sftp-settings-' + section, true, document.getElementById('modal'));
          }
        } finally {
          window.termaSftpGlobalSettings.close();
          api = scenarioApi;
        }
      });
      await runI18nScenario('sftp-view', async () => {
        const scenarioApi = api;
        const scenarioRefreshSftpJobs = window.termaSftpTaskWorkspace.runtime.refresh;
        const scenarioStartSftpJobsTimer = window.termaSftpTransferLifecycle.polling.start;
        const connectionId = Number(languageRemoteConnection.id);
        const tabKey = 'language-sftp-view';
        window.termaSftpTaskWorkspace.runtime.refresh = async () => [];
        window.termaSftpTransferLifecycle.polling.start = () => {};
        api = async (path, options={}) => {
          const value = String(path);
          if (['/api/sftp/jobs','/api/sftp/sync/jobs','/api/linux-desktop/tasks','/api/remote-component/tasks'].includes(value)) return [];
          if (value.startsWith('/api/connections/' + connectionId + '/sftp?')) return {
            path:'/',page:1,page_size:50,total:1,total_pages:1,unfiltered_total:1,paged:true,sort:'name',dir:'asc',
            entries:[{name:'notes.txt',path:'/notes.txt',type:'file',size:12,mtime:1700000000,mode:'-rw-r--r--',owner:'smoke',group:'smoke',metadata_known:true}]
          };
          return scenarioApi(path, options);
        };
        try {
          await window.termaSftpPage.open(connectionId, '/', true, tabKey);
          window.termaSftpViews.search(tabKey,'toggle');
          window.termaSftpConnection.paint(connectionId, 'disconnected', 'SFTP 连接已断开');
          await new Promise(resolve => setTimeout(resolve, 0));
          applyTermaTranslations(document);
          collectVisibleHan('sftp-view-open', true, document.querySelector('[data-sftp-tab-key="' + tabKey + '"]'));
          await runI18nScenario('sftp-context-menu', async () => {
            const row = document.querySelector('[data-sftp-tab-key="' + tabKey + '"] .sftp-row');
            if (!row) throw new Error('SFTP row was not rendered');
            window.termaSftpEntryActions.menu.entry({currentTarget:row,target:row,preventDefault(){},stopPropagation(){},clientX:220,clientY:180}, tabKey, connectionId, {path:'/notes.txt',name:'notes.txt',type:'file'});
            await collectTranslatedHan('sftp-context-menu-open', true, document.getElementById('actionMenu'));
            hideActionMenu();
          });
          await runI18nScenario('sftp-permissions-dialog', async () => {
            window.termaSftpFileActions.operations.permissions(tabKey, ['/notes.txt']);
            const modal = document.getElementById('modal');
            collectVisibleHan('sftp-permissions-dialog-immediate', true, modal);
            if (modal?.querySelector('h2')?.textContent.trim() !== 'Set permissions') throw new Error('SFTP permissions dialog was not generated in English');
            document.getElementById('sftpPermissionCancel')?.click();
          });
          await runI18nScenario('sftp-rename-dialog', async () => {
            const operation = window.termaSftpFileActions.operations.rename(tabKey, connectionId, '/notes.txt', 'notes.txt');
            await new Promise(resolve => setTimeout(resolve, 0));
            const modal = document.getElementById('modal');
            collectVisibleHan('sftp-rename-dialog-immediate', true, modal);
            if (modal?.querySelector('h2')?.textContent.trim() !== 'Rename' || modal?.querySelector('label')?.textContent.trim() !== 'New name') throw new Error('SFTP rename dialog was not generated in English');
            document.getElementById('modalCancelBtn')?.click();
            await operation;
          });
          await runI18nScenario('sftp-compress-dialog', async () => {
            const operation = window.termaSftpFileActions.compressEntry(tabKey, connectionId, '/notes.txt');
            try {
              await new Promise(resolve => setTimeout(resolve, 0));
              const modal = document.getElementById('modal');
              collectVisibleHan('sftp-compress-dialog-immediate', true, modal);
              if (modal?.querySelector('h2')?.textContent.trim() !== tr('sftp:archive.compress_title') || !document.getElementById('sftpArchiveCancel')) throw new Error('SFTP compression dialog was not generated in English');
            } finally {
              document.getElementById('sftpArchiveCancel')?.click();
              await operation;
            }
          });
        } finally {
          closeTabsByKey([tabKey], tabKey);
          window.termaSftpTaskWorkspace.runtime.refresh = scenarioRefreshSftpJobs;
          window.termaSftpTransferLifecycle.polling.start = scenarioStartSftpJobsTimer;
          api = scenarioApi;
        }
      });
      await runI18nScenario('xclip-local-offline', async () => {
        const scenarioApi = api;
        const connectionId = Number(languageRemoteConnection.id);
        api = async (path, options={}) => String(path).endsWith('/x11-clipboard/helper')
          ? {platform:'linux',root:true,installed:false,install_plan:{local_offline:{available:true}}}
          : scenarioApi(path, options);
        try {
          closeModal();
          const action = window.termaX11.remote.operate(connectionId, 'clipboard', 'local-offline', null, 'xserver');
          let cancel=null;
          for (let attempt=0; attempt<100; attempt+=1) {
            cancel=document.querySelector('#modal:not([hidden]) [data-automation-layer] button[data-choice="1"]');
            if(cancel&&!cancel.disabled)break;
            await new Promise(resolve=>setTimeout(resolve,10));
          }
          if(!cancel||cancel.disabled)throw new Error('X11 local offline cancel control was not ready');
          collectVisibleHan('xclip-local-offline-modal', true, document.getElementById('modal'));
          cancel.click();
          let timeout;
          try { await Promise.race([action,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('X11 local offline cancellation did not settle')),2000);})]); }
          finally { clearTimeout(timeout); }
        } finally {
          closeModal();
          api = scenarioApi;
        }
      });
      await runI18nScenario('xclip-no-plan-notification', async () => {
        notify('当前系统没有可用的 xclip 安装方案，请查看手动安装说明', 'error');
        await new Promise(resolve => setTimeout(resolve, 0));
        applyTermaTranslations(document.getElementById('toast'));
        collectVisibleHan('xclip-no-plan-notification-open', true, document.getElementById('toast'));
      });
      await runI18nScenario('named-workspaces', async () => {
        const scenarioWorkspaces = [{
          id:910101,
          name:'Workspace 4',
          description:'',
          layout:{tabs:[{kind:'settings',key:'settings'}],workspace_groups:[{id:'workspace-main',name:'Main',tabs:[{kind:'settings',key:'settings'}]}]}
        }];
        const scenarioApi = api;
        api = async (path, options={}) => String(path) === '/api/named-workspaces' && !options.method ? scenarioWorkspaces : scenarioApi(path, options);
        try {
          await window.termaNamedWorkspaces.manager();
          await collectTranslatedHan('named-workspaces-open', true, document.getElementById('modal'));
          const rename = window.termaNamedWorkspacePresets.rename(910101);
          await new Promise(resolve => setTimeout(resolve, 0));
          await collectTranslatedHan('named-workspaces-rename', true, document.getElementById('modal'));
          document.querySelector('#modal .actions button:not(.primary):last-child')?.click();
          await rename;
        } finally {
          api = scenarioApi;
          await window.termaNamedWorkspacePresets.list();
          closeModal();
        }
      });
      await runI18nScenario('batch-template-editor', async () => {
        const templates=window.termaBatch.templates().model.items;
        templates.push({id:'language-template',name:'Language template',command:'uname -a',description:'Fixture'});
        window.termaBatch.templateEditor('language-template');
        const modal = document.getElementById('modal');
        collectVisibleHan('batch-template-editor-immediate', true, modal);
        if (modal?.querySelector('h2')?.textContent.trim() !== 'Edit command template') throw new Error('batch template editor was not generated in English');
        modal?.querySelector('[data-template-cancel]')?.click();
        templates.splice(templates.findIndex(item=>item.id==='language-template'),1);
        closeModal();
      });
      await runI18nScenario('command-snippet-manager', async () => {
        const previousSnippets = window.termaSnippets.service.state.items;
        const scenarioApi = api;
        const snippets = [{id:910150,name:'Inspect service',group_name:'Operations',command:'systemctl status example.service',description:'Service status',tags:'service',favorite:1,quick_visible:1,quick_action:'execute',quick_badge:'服',quick_color:'blue'}];
        window.termaSnippets.service.replaceItems(snippets);
        api = async (path, options={}) => String(path) === '/api/command-snippets' && !options.method ? snippets : scenarioApi(path, options);
        try {
          await window.termaSnippets.navigate('manager');
          const modal = document.getElementById('modal');
          collectVisibleHan('command-snippet-manager-immediate', true, modal);
          if (!modal?.innerText.includes('Command snippets') || !modal?.innerText.includes('Command bar')) throw new Error('command snippet manager was not generated in English');
          window.termaSnippets.navigate('editor', 910150);
          collectVisibleHan('command-snippet-editor-immediate', true, modal);
          if (!modal?.innerText.includes('Edit command snippet') || !modal?.innerText.includes('Click action')) throw new Error('command snippet editor was not generated in English');
        } finally {
          window.termaSnippets.service.replaceItems(previousSnippets);
          api = scenarioApi;
          closeModal();
        }
      });
      await runI18nScenario('sftp-clipboard-actions', async () => {
        const previousClipboard = window.termaSftpFileActions.clipboard.value;
        const tabKey = 'language-sftp-clipboard';
        const runtime = window.termaSftpTabs.runtime.ensure(tabKey, Number(languageRemoteConnection.id));
        const host = document.createElement('div');
        document.body.appendChild(host);
        try {
          window.termaSftpFileActions.clipboard.value = {mode:'copy',connectionId:Number(languageRemoteConnection.id),connectionName:'Language SSH',paths:['/one.txt','/two.txt']};
          runtime.state.connectionId = Number(languageRemoteConnection.id) + 1;
          host.innerHTML = renderSftpClipboardActions(tabKey);
          collectVisibleHan('sftp-copy-queue-immediate', true, host);
          if (!host.innerText.includes('Copy queue')) throw new Error('cross-host SFTP copy queue was not generated in English');
          runtime.state.connectionId = Number(languageRemoteConnection.id);
          window.termaSftpFileActions.clipboard.value = {...window.termaSftpFileActions.clipboard.value,mode:'move'};
          host.innerHTML = renderSftpClipboardActions(tabKey);
          collectVisibleHan('sftp-move-queue-immediate', true, host);
          if (!host.innerText.includes('Move queue') || !host.innerText.includes('Paste')) throw new Error('SFTP move queue actions were not generated in English');
        } finally {
          window.termaSftpFileActions.clipboard.value = previousClipboard;
          window.termaSftpTabs.runtime.dispose(tabKey);
          host.remove();
        }
      });
      await runI18nScenario('remote-protocol-forms', async () => {
        for (const protocol of ['ftp','vnc','xdmcp','telnet','serial']) {
          window.termaRemoteProfiles.editor.render({protocol,name:'Language ' + protocol.toUpperCase(),group_name:'Default',options:{}});
          const view = document.getElementById('view-edit');
          collectVisibleHan(protocol + '-form-immediate', true, view);
          const formText = view?.innerText || '';
          if (protocol === 'ftp' && (!formText.includes('Transfer security') || !formText.includes('Explicit FTPS'))) throw new Error('FTP options were not generated in English');
          if (protocol === 'vnc' && (!formText.includes('Open with') || !formText.includes('Image quality') || !formText.includes('Performance preset') || !view.querySelector('#remote_vnc_performance_preset'))) throw new Error('VNC options were not generated in English');
          if (protocol === 'xdmcp' && (!formText.includes('Connection mode') || !formText.includes('LAN broadcast'))) throw new Error('XDMCP options were not generated in English');
          if (protocol === 'telnet' && (!formText.includes('Terminal type') || !formText.includes('does not encrypt'))) throw new Error('Telnet options were not generated in English');
          if (protocol === 'serial' && (!formText.includes('Serial device') || !formText.includes('Baud rate'))) throw new Error('serial options were not generated in English');
        }
      });
      await runI18nScenario('ssh-extra-args-validation', async () => {
        const host = document.createElement('div');
        host.innerHTML = '<form id="languageConnectionForm"><textarea id="conn_extra"></textarea><div id="connExtraDiagnostics"></div><div id="connAdvancedStatus"></div></form>';
        document.body.appendChild(host);
        const form = host.querySelector('#languageConnectionForm');
        window.termaConnectionFormWorkspace.advanced.render(form, [{severity:'warning',code:'SSH_EXTRA_ARGS_DUPLICATES_STRUCTURED_FIELD',line:2,start:8,end:27,option:'KeepAliveInterval',message:'与上方“KeepAliveInterval”设置重复（当前：60）',suggestion:'删除这一项并使用上方结构化设置，避免两处数值不一致。'}]);
        const diagnostics = document.getElementById('connExtraDiagnostics');
        collectVisibleHan('ssh-extra-args-validation-immediate', true, diagnostics);
        if (!diagnostics?.innerText.includes('current: 60') || !diagnostics?.innerText.includes('argument warning')) throw new Error('SSH additional-argument diagnostics were not generated in English');
        window.termaConnectionFormWorkspace.advanced.render(form, []);
        host.remove();
      });
      await runI18nScenario('connection-terminal-startup-form', async () => {
        const host = document.createElement('div');
        host.innerHTML = '<form id="languageTerminalForm"><select id="conn_terminal_startup_mode"><option value="default">default</option><option value="program">program</option></select><input id="conn_terminal_profile_name"><input id="conn_terminal_profile_kind"><input id="conn_terminal_program_path"><input id="conn_terminal_program_args"><input id="conn_terminal_working_directory"><select id="conn_terminal_program_platform"><option value="auto">auto</option></select><select id="conn_terminal_profile_select"></select><div id="connTerminalProgramFields"></div><div id="connTerminalDetectionStatus"></div><div id="connTerminalCapabilities"></div></form>';
        document.body.appendChild(host);
        const form = host.querySelector('#languageTerminalForm');
        window.termaConnectionTerminal.resetStartup(form);
        window.termaConnectionTerminal.renderProfiles(form, {platform:'linux',platform_label:'Linux',default_shell:{name:'bash',label:'Bash',path:'/bin/bash'},profiles:[{name:'python',label:'Python',path:'/usr/bin/python3',kind:'repl'}],tools:[{label:'Git',version:'2.51'}],warnings:[]});
        const startupRoot = document.getElementById('connTerminalStartupFields') || form;
        collectVisibleHan('connection-terminal-startup-form-immediate', true, startupRoot);
        const text = startupRoot.innerText || '';
        const groupLabel = form.querySelector('#conn_terminal_profile_select optgroup')?.label || '';
        if (groupLabel !== 'Interactive languages' || !text.includes('Installed tools')) throw new Error('connection terminal startup form was not generated in English');
        host.remove();
      });
      await runI18nScenario('forward-empty', async () => {
        const previousForwards = languageRemoteConnection.forwards;
        languageRemoteConnection.forwards = [];
        try {
          window.termaForwardWorkspace.openConnection(Number(languageRemoteConnection.id), false);
          const view = $('view-forwards') || document.getElementById('view-forwards');
          collectVisibleHan('forward-empty-immediate', true, view);
          const forwardEmptyText = view?.textContent || '';
          if (!forwardEmptyText.includes('No forwarding rules')) throw new Error('empty forwarding state was not generated in English');
        } finally {
          languageRemoteConnection.forwards = previousForwards;
        }
      });
      await runI18nScenario('forward-list', async () => {
        const previousForwards = languageRemoteConnection.forwards;
        languageRemoteConnection.forwards = [{id:910201,connection_id:Number(languageRemoteConnection.id),mode:'local',bind_host:'127.0.0.1',bind_port:3210,target_host:'127.0.0.1',target_port:8080,service_name:'Language service',service_type:'web',status:'running',started_at:Date.now()/1000-36,reconnect_count:2}];
        try {
          window.termaForwardWorkspace.openConnection(Number(languageRemoteConnection.id), false);
          await new Promise(resolve => setTimeout(resolve, 0));
          const forwardView = $('view-forwards') || document.getElementById('view-forwards');
          applyTermaTranslations(forwardView);
          await collectTranslatedHan('forward-list-open', true, forwardView);
          await runI18nScenario('forward-runtime', async () => {
            await collectTranslatedHan('forward-runtime-open', true, forwardView);
            const runtime = forwardView?.querySelector('.forward-runtime')?.textContent || '';
            if (!runtime.includes('Running for') || !runtime.includes('Reconnected 2 times')) throw new Error('forward runtime was not localized');
          });
        } finally {
          languageRemoteConnection.forwards = previousForwards;
        }
      });
      await runI18nScenario('terminal-startup-dialog', async () => {
        const scenarioApi = api;
        const scenarioRequireUnlocked = requireConfigEncryptionUnlocked;
        requireConfigEncryptionUnlocked = () => true;
        api = async (path, options={}) => String(path).endsWith('/terminal-capabilities')
          ? {capabilities:{platform:'linux',platform_label:'Linux',default_shell:{name:'bash',label:'Bash'},profiles:[{name:'bash',label:'Bash',path:'/bin/bash',kind:'shell',is_default:true}],tools:[{name:'git',label:'Git',version:'2.51'}],warnings:[]}}
          : scenarioApi(path, options);
        try {
          window.termaTerminalStartup.open('language-terminal-startup', Number(languageRemoteConnection.id));
          await new Promise(resolve => setTimeout(resolve, 20));
          await collectTranslatedHan('terminal-startup-dialog-open', true, document.getElementById('modal'));
        } finally {
          window.termaTerminalViews.startupOptions()?.actions.close();
          api = scenarioApi;
          requireConfigEncryptionUnlocked = scenarioRequireUnlocked;
        }
      });
      await runI18nScenario('terminal-x11-menu', async () => {
        showActionMenu({preventDefault(){},stopPropagation(){},clientX:200,clientY:140}, window.termaX11TerminalMenu.actions(Number(languageRemoteConnection.id), ''));
        await collectTranslatedHan('terminal-x11-menu-open', true, document.getElementById('actionMenu'));
        hideActionMenu();
      });
      await runI18nScenario('terminal-context-menu', async () => {
        const key = 'language-terminal-context';
        window.termaTerminalState.terminalSessions.set(key, {
          id:Number(languageRemoteConnection.id),
          connected:true,
          connection:languageRemoteConnection,
          term:{
            clear(){}, focus(){}, scrollToBottom(){}, getSelection(){ return ''; }, hasSelection(){ return false; }
          }
        });
        try {
          window.termaTerminalPage.showTerminalContextMenu({preventDefault(){},stopPropagation(){},clientX:200,clientY:140}, key, Number(languageRemoteConnection.id));
          const menu = document.getElementById('actionMenu');
          collectVisibleHan('terminal-context-menu-immediate', true, menu);
          const labels = [...menu.querySelectorAll('button span')].map(item => item.textContent.trim());
          if (!labels.includes('Copy selection') || !labels.includes('Open current directory in SFTP') || !labels.includes('Global terminal settings')) throw new Error('terminal context menu was not generated in English');
        } finally {
          hideActionMenu();
          window.termaTerminalState.terminalSessions.delete(key);
        }
      });
      await runI18nScenario('download-complete-notification', async () => {
        notify(tr('tasks:notifications.download_done') + '\\n' + tr('tasks:notifications.saved_to',{path:'D:/Downloads/switchcodex.service'}), 'success', {action:{download_job_id:'job-notification',can_open_file:true,can_open_directory:true,can_delete_file:true}});
        const toast = document.querySelector('#toast .toast:last-child');
        collectVisibleHan('download-complete-notification-immediate', true, toast);
        const text = toast?.innerText || '';
        if (!text.includes('SFTP download completed') || !text.includes('Saved to D:/Downloads/switchcodex.service') || !text.includes('Open file') || !text.includes('Open directory') || !text.includes('Delete file') || text.includes('Download switchcodex.service')) throw new Error('download completion notification actions were not generated in English');
        notify('Generated SVG saved\\nSaved to D:/Downloads/diagram.svg', 'success', {action:{generated_task_id:'local:generated-svg',can_open_file:true,can_open_directory:true,can_delete_file:true}});
        const generatedToast = document.querySelector('#toast .toast:last-child');
        if (!generatedToast?.textContent.includes('Open file') || !generatedToast?.textContent.includes('Open directory') || !generatedToast?.textContent.includes('Delete file')) throw new Error('generated-file notification actions were not generated in English');
      });
      await runI18nScenario('progress-notification-controls', async () => {
        const controller = createProgressToast({title:'正在处理',detail:'准备中',onPauseChange(){},onCancel(){}});
        const toast = document.querySelector('#toast .toast-progress:last-child');
        if (!toast) throw new Error('progress toast was not created');
        collectVisibleHan('progress-notification-immediate', true, toast);
        const text = toast.innerText;
        if (!text.includes('Pause') || !text.includes('Stop')) throw new Error('progress notification controls were not generated in English');
        controller.dismiss();
      });
      await runI18nScenario('desktop-notification-toggle', async () => {
        const savedApi = api;
        const savedSettings = window.termaRuntimeSettingsModel.snapshot;
        const descriptor = Object.getOwnPropertyDescriptor(window, 'Notification');
        try {
          Object.defineProperty(window, 'Notification', {configurable:true,value:{permission:'granted'}});
          window.termaRuntimeSettingsModel.snapshot = {...window.termaRuntimeSettingsModel.snapshot,saved:{...window.termaRuntimeSettingsModel.snapshot.saved,desktop_notifications_enabled:true}};
          api = async (pathname, options={}) => {
            if (pathname === '/api/runtime-settings' && options.method === 'PUT') {
              return {saved:{...window.termaRuntimeSettingsModel.snapshot.saved,...JSON.parse(options.body)}};
            }
            return savedApi(pathname, options);
          };
          window.termaSettingsViews.render();
          (document.getElementById('desktopNotificationToggleBtn')?.click(),await new Promise(resolve=>setTimeout(resolve,60)));
          const button = document.getElementById('desktopNotificationToggleBtn');
          if (button.textContent.trim() !== tr('settings:auto.enable_desktop_notifications') || button.disabled || button.hasAttribute('aria-busy')) throw new Error('desktop notification toggle restored its old label after saving');
          collectVisibleHan('desktop-notification-disabled', true, document.getElementById('settings-notifications'));
          (document.getElementById('desktopNotificationToggleBtn')?.click(),await new Promise(resolve=>setTimeout(resolve,60)));
          if (button.textContent.trim() !== tr('settings:auto.disable_desktop_notifications')) throw new Error('desktop notifications could not be enabled again');
        } finally {
          api = savedApi;
          window.termaRuntimeSettingsModel.snapshot = savedSettings;
          if (descriptor) Object.defineProperty(window, 'Notification', descriptor);
          else delete window.Notification;
          window.termaSettingsViews.render();
        }
      });
      await runI18nScenario('task-confirmations', async () => {
        const prompts = [
          [tr('tasks:dialogs.delete_message'),tr('tasks:dialogs.delete_title'),tr('common:actions.delete')],
          [tr('tasks:dialogs.clear_history_message'),tr('tasks:dialogs.clear_history_title'),tr('tasks:dialogs.clear_history_action')],
          [tr('tasks:dialogs.clear_failed_message',{count:3}),tr('tasks:dialogs.clear_failed_title'),tr('tasks:dialogs.clear_failed_action')]
        ];
        for (const [message,title,action] of prompts) {
          const decision = confirmModal(message,title,action,tr('common:actions.cancel'),true);
          await new Promise(resolve => setTimeout(resolve, 0));
          await collectTranslatedHan('task-confirmation-open', true, document.getElementById('modal'));
          document.querySelector('#modal .actions button:last-child')?.click();
          await decision;
        }
      });
      await runI18nScenario('batch-log-label', async () => {
        const host = document.createElement('div');
        host.textContent = window.termaLogList.label('批量执行-8月14日 21:15:24');
        document.body.appendChild(host);
        await collectTranslatedHan('batch-log-label-open', true, host);
        if (!host.innerText.includes('Batch execution - Aug 14 21:15:24')) throw new Error('batch log label was not localized');
        host.remove();
      });
      await runI18nScenario('quick-open-notice', async () => {
        const previousQuickOpen = localStorage.getItem('remoteDesktopQuickOpen');
        const previousRuntimeSettings = window.termaRuntimeSettingsModel.snapshot;
        const quickOpenApi = api;
        const writes = [];
        localStorage.setItem('remoteDesktopQuickOpen','0');
        api = async (path, options={}) => {
          if (path === '/api/runtime-settings' && !options.method) return previousRuntimeSettings;
          if (String(path) === '/api/runtime-settings' && String(options.method || 'GET').toUpperCase() === 'PUT') {
            const body = JSON.parse(options.body || '{}');
            writes.push(body.remote_desktop_quick_open_enabled === true);
            await Promise.resolve();
            return window.termaRuntimeSettingsModel.normalize({
              ...window.termaRuntimeSettingsModel.snapshot,
              saved:{...window.termaRuntimeSettingsModel.snapshot.saved, remote_desktop_quick_open_enabled:body.remote_desktop_quick_open_enabled === true}
            });
          }
          return quickOpenApi(path, options);
        };
        try {
          await window.termaRuntimeReader.load();
          window.termaWorkspaceShell.showPrimary('remote');
          const button = document.getElementById('workspace-remote-quick-open');
          button.click(); button.click();
          for (let attempt=0; attempt<100 && (writes.length<2 || button.getAttribute('aria-busy')==='true'); attempt++) {
            await new Promise(resolve=>setTimeout(resolve,10));
          }
          if (JSON.stringify(writes) !== JSON.stringify([true,false])) throw new Error('quick-open toggles were not serialized against the latest requested state');
          if (button.getAttribute('aria-pressed')!=='false' || button.getAttribute('aria-busy')!=='false') throw new Error('quick-open double toggle did not restore the original state');
          await collectTranslatedHan('quick-open-notice-open', true, document.getElementById('toast'));
        } finally {
          if(previousQuickOpen===null) localStorage.removeItem('remoteDesktopQuickOpen');
          else localStorage.setItem('remoteDesktopQuickOpen',previousQuickOpen);
          await window.termaRuntimeReader.load();
          api = quickOpenApi;
          window.termaRuntimeSettingsModel.snapshot = previousRuntimeSettings;
          window.termaConnectionViews.renderExplorerTools();
        }
      });
      await runI18nScenario('connection-controls', async () => {
        window.termaWorkspaceShell.showPrimary('connections');
        connectionBulkMode = true;
        selectedConnectionIds.clear();
        window.termaConnectionViews.renderConnections();
        await collectTranslatedHan('connection-bulk-open', true, document.getElementById('connectionGroups'));
        const menuEvent = {preventDefault(){},stopPropagation(){},clientX:120,clientY:120};
        await collectTranslatedHan('connection-explorer-actions', true, document.getElementById('explorerTools'));
        window.termaConnectionMenu.openGroup(menuEvent, languageRemoteConnection.group_name || 'UI Smoke');
        await collectTranslatedHan('connection-group-menu-open', true, document.getElementById('actionMenu'));
        hideActionMenu();
        window.termaConnectionViews.openGroupModal(() => {});
        await collectTranslatedHan('connection-group-modal-open', true, document.getElementById('modal'));
        closeModal();
        connectionBulkMode = false;
        selectedConnectionIds.clear();
        window.termaConnectionViews.renderConnections();
      });
      await runI18nScenario('connection-row-menu', async () => {
        const menuEvent = {preventDefault(){},stopPropagation(){},clientX:120,clientY:120};
        window.termaConnectionMenu.open(menuEvent, Number(languageRemoteConnection.id));
        const menu = document.getElementById('actionMenu');
        collectVisibleHan('connection-row-menu-immediate', true, menu);
        const labels = [...menu.querySelectorAll('button span')].map(item => item.textContent.trim());
        if (!labels.includes('SFTP files') || !labels.includes('Server dashboard') || !labels.includes('Health check')) throw new Error('connection row menu was not generated in English');
        hideActionMenu();
      });
      await runI18nScenario('remote-profile-menu', async () => {
        const profile = {...languageVncProfile,name:'Language VNC Menu'};
        const existingIndex = remoteProfiles.findIndex(item => Number(item.id) === Number(profile.id));
        if (existingIndex >= 0) remoteProfiles.splice(existingIndex, 1);
        remoteProfiles.push(profile);
        const host = document.createElement('div');
        document.body.appendChild(host);
        try {
          host.innerHTML = window.termaConnectionViews.renderRemoteProfileRow(profile);
          collectVisibleHan('remote-profile-row-immediate', true, host);
          window.termaRemoteList.show({preventDefault(){},stopPropagation(){},clientX:140,clientY:140}, profile.id);
          const menu = document.getElementById('actionMenu');
          collectVisibleHan('remote-profile-menu-immediate', true, menu);
          const labels = [...menu.querySelectorAll('button span')].map(item => item.textContent.trim());
          if (!labels.includes('Open Remote Desktop') || !labels.includes('Test connection') || !labels.includes('Edit connection')) throw new Error('remote profile menu was not generated in English');
        } finally {
          hideActionMenu();
          host.remove();
          const index = remoteProfiles.findIndex(item => Number(item.id) === Number(profile.id));
          if (index >= 0) remoteProfiles.splice(index, 1);
        }
      });
      await runI18nScenario('quick-connection', async () => {
        window.termaQuickViews.openQuickConnectionLauncher();
        await collectTranslatedHan('quick-connection-open', true, document.getElementById('modal'));
        window.termaQuickViews.closeQuickConnectionLauncher();
      });
      await runI18nScenario('linux-desktop-empty', async () => {
        const previousState = {...window.termaRemoteManagement.desktop.state};
        Object.assign(window.termaRemoteManagement.desktop.state, {connectionId:0,diagnostics:null,sshX11:null,error:null,loading:false,taskId:'',task:null,logs:[]});
        try {
          window.termaRemoteManagement.paintDesktop();
          await collectTranslatedHan('linux-desktop-empty-open', true, document.getElementById('view-linux-desktop'));
        } finally {
          Object.assign(window.termaRemoteManagement.desktop.state, previousState);
        }
      });
      await runI18nScenario('linux-desktop-error', async () => {
        const previousState = {...window.termaRemoteManagement.desktop.state};
        Object.assign(window.termaRemoteManagement.desktop.state, {connectionId:Number(languageRemoteConnection.id),diagnostics:null,sshX11:null,error:{message:'SSH 握手超时，请检查主机地址、端口和 SSH 服务',code:'SSH_HANDSHAKE_TIMEOUT'},loading:false,taskId:'',task:null,logs:[]});
        try {
          window.termaRemoteManagement.paintDesktop();
          await collectTranslatedHan('linux-desktop-error-open', true, document.getElementById('view-linux-desktop'));
          if (!(document.getElementById('view-linux-desktop')?.innerText || '').includes('SSH handshake timed out')) throw new Error('Linux desktop SSH error was not localized');
        } finally {
          Object.assign(window.termaRemoteManagement.desktop.state, previousState);
        }
      });
      await runI18nScenario('migration-snapshots', async () => {
        const scenarioApi = api;
        api = async (path, options={}) => {
          const value = String(path);
          if (value === '/api/config-snapshots') return [
            {id:'snapshot-1',reason:'调整 SSH 连接分组顺序前自动快照',created_at:'2026-08-06T07:50:12.000Z',counts:{connections:17,forwards:25,templates:6}},
            {id:'snapshot-2',reason:'手动快照',created_at:'2026-08-05T14:45:14.000Z',counts:{connections:14,forwards:24,templates:6}}
          ];
          return scenarioApi(path, options);
        };
        try {
          const service = exchange.open();
          await service.snapshotList();
          service.select('configSnapshots', false);
          await collectTranslatedHan('config-snapshots-open', true, document.getElementById('configSnapshots'));
        } finally {
          api = scenarioApi;
        }
      });
      await runI18nScenario('storage-update-status', async () => {
        const previousDesktopSettings = window.termaDesktopStorage.snapshot;
        const previousUpdateSettings = window.termaUpdateStatus.current();
        window.termaDesktopStorage.snapshot = {
          ...window.termaDesktopStorage.snapshot,
          available:true,
          storage_management_available:true,
          xserver:{available:true,installed:true,display:'127.0.0.1:0.0'},
          paths:{dataDir:'C:\\TermaSmoke\\data',sshDir:'C:\\TermaSmoke\\.ssh'},
          settings:{...(window.termaDesktopStorage.snapshot?.settings || {}),dataMode:'user'}
        };
        await loadUpdate({current_version:'1.4.6',latest_version:'1.4.6',checked_at:'2026-08-15T07:58:07.000Z',published_at:'2026-08-15T00:00:00.000Z',update_available:false,release_notes:[{version:'1.4.6',published_at:'2026-08-15T00:00:00.000Z',notes:'Release notes fixture'}]});
        try {
          window.termaSettingsViews.render();
          window.termaSettingsNavigation.show('settings-general', {moveToWorkspace:false});
          await collectTranslatedHan('storage-status-open', true, document.getElementById('settings-general'));
          window.termaSettingsNavigation.show('settings-about', {moveToWorkspace:false});
          await collectTranslatedHan('update-status-open', true, document.getElementById('settings-about'));
        } finally {
          window.termaDesktopStorage.snapshot = previousDesktopSettings;
          await loadUpdate(previousUpdateSettings);
        }
      });
        await runI18nScenario('fnos-managed-settings', async () => {
          const host = $('view-settings');
          const previousRuntime = window.termaRuntimeSettingsModel.snapshot;
          const previousSection = window.termaSettingsNavigation.section;
          const previousUpdateSettings = window.termaUpdateStatus.current();
          await loadUpdate({current_version:'1.7.9',download_status:{managed_by:'fnos'}});
          window.termaRuntimeSettingsModel.snapshot = window.termaRuntimeSettingsModel.normalize({...previousRuntime,listen_locked:true,saved:{...previousRuntime?.saved,listen_hosts:['0.0.0.0'],listen_port:8088}});
          window.termaSettingsNavigation.show('settings-runtime', {moveToWorkspace:false});
          window.termaSettingsViews.render();
          try {
            await collectTranslatedHan('fnos-managed-settings-open', true, host);
            if (host.querySelector('#downloadUpdateBtn') || !host.querySelector('#runtimeListenPort')?.disabled) throw new Error('fnOS package management controls are not restricted');
          } finally {
            window.termaRuntimeSettingsModel.snapshot = previousRuntime;
            window.termaSettingsNavigation.show(previousSection,{moveToWorkspace:false});
            window.termaSettingsViews.render();
            await loadUpdate(previousUpdateSettings);
          }
        });
        await runI18nScenario('cache-clear-confirmation', async () => {
        const decision = window.termaProgramCache.clear();
        await new Promise(resolve => setTimeout(resolve, 0));
        const modal = document.getElementById('modal');
        collectVisibleHan('cache-clear-confirmation-immediate', true, modal);
        if (modal?.querySelector('h2')?.textContent.trim() !== 'Clear application cache') throw new Error('cache cleanup confirmation was not generated in English');
        modal?.querySelector('button[data-choice="1"]')?.click();
        await decision;
      });
      await runI18nScenario('sftp-single-download-task', async () => {
        const job = {id:'language-download-task',status:'done',type:'download',label:'SFTP 下载到本机',phase:'delivering',current:'发送到桌面',connection_name:'Language SSH',size:1,transferred:1,progress_unit:'items',delivery_status:'done',delivery_path:'C:/Desktop/notes.txt'};
        const previousTaskView = window.termaSftpTaskWorkspace.state.view;
        window.termaSftpTaskWorkspace.state.view = 'history';
        window.termaSftpTaskWorkspace.state.paint([job]);
        try {
          const host = document.querySelector('#sftpTaskCenterList .sftp-job');
          if (!host) throw new Error('single-item SFTP task was not rendered');
          collectVisibleHan('sftp-single-download-task-immediate', true, host);
          const text = host.textContent || '';
          if (/\\b1 items\\b/.test(text) || !text.includes('1 item')) throw new Error('single-item SFTP task did not use the English singular');
        } finally {
          window.termaSftpTaskWorkspace.state.view = previousTaskView;
          window.termaSftpTaskWorkspace.state.paint(window.termaSftpTaskWorkspace.state.jobs);
        }
      });
      await runI18nScenario('system-log-compatibility', async () => {
        const source = [
          '[08:00:00] Terma 正在关闭',
          '[08:00:01] Terma 已启动：http://127.0.0.1:18100',
          '[08:00:02] 终端已启动（内置 SSH PTY）：Game · 终端',
          '[08:00:03] 启动任务完成：自动转发成功0、失败0；恢复转发成功1、失败0',
          '[08:00:04] 已停止连接 Game 的全部转发',
          '[08:00:05] 通知：SFTP 下载到本机已完成：Game · 发送到桌面',
          '[08:00:06] 已保存到 C:/Desktop'
        ].join('\\n');
        const fixturesPath = 'system/language-smoke.log';
        const fixturesKey = 'log-' + fixturesPath;
        const previousApi = api;
        api = async (path, options) => path.startsWith('/api/logs/read?')
          && new URLSearchParams(path.split('?')[1]).get('path') === fixturesPath
          ? {text:source,offset:0,end_offset:source.length,has_older:false,has_newer:false}
          : previousApi(path, options);
        try {
          await window.termaLogReader.feature().service.open(fixturesPath, 'system-2026-08-15', true, fixturesKey, '');
          const translated = window.termaLogReader.feature().element(fixturesKey)?.querySelector('.log-view')?.textContent || '';
          if (/[㐀-鿿]/.test(translated)) throw new Error('known system log lines still contain Chinese: ' + translated);
          if (!translated.includes('Terma is shutting down') || !translated.includes('Saved to C:/Desktop')) throw new Error('known system log templates were not localized');
        } finally {
          api = previousApi;
          closeTabsByKey([fixturesKey]);
        }
      }, {translate:false});
      const terminalSystemSamples = [
        tr('terminal:system.connecting', {endpoint:'tester@127.0.0.1:22'}),
        tr('terminal:system.connected', {endpoint:'tester@127.0.0.1:22',pty:tr('terminal:system.pty_suffix'),startup:''}),
        tr('terminal:system.x11_connected', {display:'localhost:10.0'}),
        tr('terminal:system.closed_reconnect'),
        tr('terminal:system.reconnecting_preserved')
      ];
      for (const value of terminalSystemSamples) {
        if (/[㐀-鿿]/.test(value)) visibleHan.push('terminal-system: ' + value);
      }
      window.termaSftpTaskWorkspace.state.jobs = languageTaskFixtures;
      window.termaSftpTaskWorkspace.state.paint(languageTaskFixtures);
      const forbiddenMixedTranslations = [
        '根Directory',
        'SFTP Connection已断开',
        'Close仍在Connection的Tab',
        'SFTP 全局Settings',
        '管理命名Workspace',
        'Save当前Workspace为预设',
        'Automatic跟随窗口',
        '当前SystemNo 可用的 xclip Install方案'
      ];
      const renderedI18nText = document.body.innerText;
      const mixedTranslations = forbiddenMixedTranslations.filter(value => renderedI18nText.includes(value));
      const i18nUi = {
        language:document.documentElement.lang,
        settingsTitle:document.querySelector('#settings-general .settings-group-head h3')?.textContent.trim() || '',
        activityTitle:languageButton?.title || '',
        mobileTitle:document.querySelector('#mobileLanguageToggle')?.title || '',
        activityOrder:Boolean(languageRect && themeRect && languageRect.bottom <= themeRect.top + 0.5),
        persisted:languageRequests.length === 1 && JSON.stringify(languageRequests[0]) === JSON.stringify({language:'en-US'}),
        settingsSelectorRemoved:!document.querySelector('#interfaceLanguage'),
        resumeButton:englishTaskButtons.includes('Resume'),
        pauseButton:englishTaskButtons.includes('Pause'),
        visibleHan:[...new Set([
          ...visibleHan,
          ...i18nScenarioErrors.map(value => 'scenario-error: ' + value),
          ...mixedTranslations.map(value => 'mixed-translation: ' + value)
        ])].slice(0,300),
        scenarioErrors:i18nScenarioErrors,
        mixedTranslations,
        thirdPartyLiveSwitch,
        tasksPreserved:JSON.stringify(window.termaSftpTaskWorkspace.state.jobs.map(job=>job.id)) === JSON.stringify(languageTaskFixtures.map(job=>job.id)),
        tabsPreserved:JSON.stringify(tabs.map(tab=>tab.key)) === JSON.stringify(tabsBeforeLanguageSwitch)
      };
      if (i18nUi.visibleHan.length) console.log("[ui-smoke] visible Chinese in English mode: " + JSON.stringify(i18nUi.visibleHan));
      sessionStorage.removeItem(UPDATE_NOTICE_SESSION_KEY);
      window.termaUpdateNotice.paint();
      window.termaWorkspaceShell.showPrimary('settings');
      window.termaSettingsNavigation.show('settings-general', {moveToWorkspace:false});
      await setTermaLanguage('zh-CN');
      window.termaSettingsViews.render();
      window.termaConnectionViews.renderExplorerTools();
      window.termaSettingsNavigation.show('settings-general', {moveToWorkspace:false});
      window.termaSftpTaskWorkspace.state.jobs = previousLatestJobs;
      window.termaSftpTaskWorkspace.state.paint(previousLatestJobs);
      const storagePrimaryRow = document.querySelector('.storage-settings-primary-row');
      const storagePrimaryControl = storagePrimaryRow?.firstElementChild;
      const storageSaveButton = storagePrimaryRow?.querySelector('.storage-settings-save');
      const storageControlRect = storagePrimaryControl?.getBoundingClientRect();
      const storageSaveRect = storageSaveButton?.getBoundingClientRect();
      const storageAlignmentUi = {
        found:Boolean(storagePrimaryRow && storagePrimaryControl && storageSaveButton),
        topAligned:Boolean(storageControlRect && storageSaveRect && Math.abs(storageControlRect.top-storageSaveRect.top)<=0.5),
        bottomAligned:Boolean(storageControlRect && storageSaveRect && Math.abs(storageControlRect.bottom-storageSaveRect.bottom)<=0.5)
      };
      const storageMode = document.querySelector('#desktopDataMode');
      const storageCustomPath = document.querySelector('#desktopCustomDataDir');
      const originalStorageMode = storageMode?.value || '';
      const originalStorageCustomPath = storageCustomPath?.value || '';
      document.documentElement.dataset.uiSmokeStage = 'desktop-storage-migration';
      const originalApi = api;
      let storageMigrationCalls = [];
      let storageMigrationActions = [];
      let storageCancelBlockedRequest = false;
      let storageMigrationPayload = null;
      try {
        if (storageMode && storageSaveButton) {
          const alternateMode = window.termaDesktopStorage.snapshot?.settings?.dataMode === 'user'
            ? (storageMode.querySelector('option[value="project"]') ? 'project' : 'custom')
            : 'user';
          storageMode.value = alternateMode;
          if (alternateMode === 'custom' && storageCustomPath) storageCustomPath.value = 'C:\\TermaSmokeMigration';
          window.termaDesktopStorage.syncDesktopCustomDataMode();
          api = async (path, options) => {
            storageMigrationCalls.push({path, options});
            storageMigrationPayload = JSON.parse(options?.body || '{}');
            return {ok:true, restart_required:true, migration_requested:Boolean(storageMigrationPayload.migrateData)};
          };
          async function saveAndChoose(index) {
            const operation = window.termaDesktopStorage.saveDesktopSettings(storageSaveButton);
            const selector = '#modal [data-choice="' + index + '"]';
            for (let frame = 0; frame < 20 && !document.querySelector(selector); frame++) await Promise.resolve();
            const button = document.querySelector(selector);
            if (!button) {closeModal(); await operation; throw new Error('Missing storage migration choice ' + index);}
            storageMigrationActions = [...document.querySelectorAll('#modal [data-choice]')].map(item => item.textContent.trim());
            button.click();
            await operation;
          }
          await saveAndChoose(2);
          storageCancelBlockedRequest = storageMigrationCalls.length === 0;
          await saveAndChoose(0);
        }
      } finally {
        api = originalApi;
        if (storageMode) storageMode.value = originalStorageMode;
        if (storageCustomPath) storageCustomPath.value = originalStorageCustomPath;
        if (storageSaveButton) {
          storageSaveButton.disabled = false;
          storageSaveButton.removeAttribute('aria-busy');
          window.termaUiActions.end('settings:storage:save', storageSaveButton);
        }
        window.termaDesktopStorage.syncDesktopCustomDataMode();
      }
      const storageMigrationUi = {
        controlsFound:Boolean(storageMode && storageSaveButton),
        threeChoices:JSON.stringify(storageMigrationActions) === JSON.stringify(['迁移并重启','仅切换并重启','取消']),
        cancelBlockedRequest:storageCancelBlockedRequest,
        oneMigrationRequest:storageMigrationCalls.length === 1,
        migrationRequested:storageMigrationPayload?.migrateData === true,
        actions:storageMigrationActions,payload:storageMigrationPayload,mode:originalStorageMode,currentSettings:window.termaDesktopStorage.snapshot?.settings
      };
      const tools = document.querySelector('#explorerTools');
      const settingsButtons = [...tools.querySelectorAll(':scope > button[data-explorer-section]')];
      const settingsLabels = settingsButtons.map(button => button.querySelector('span')?.textContent.trim() || '');
      const settingsExpected = ['通用设置','AI 设置','安全','用户密钥管理','通知设置','启动与运行','缓存管理','关于'];
      const settingsRects = settingsButtons.map(button => button.getBoundingClientRect());
      const settingsVertical = settingsRects.every((rect,index) => index === 0 || rect.top >= settingsRects[index-1].bottom - 0.5) && settingsRects.every(rect => Math.abs(rect.left-settingsRects[0].left)<1 && Math.abs(rect.width-settingsRects[0].width)<1);
      const settingsChecks = [];
      for (const button of settingsButtons.filter(item => item.dataset.explorerSection !== 'settings-about')) {
        button.click();
        await Promise.resolve();
        const visible = [...document.querySelectorAll('#view-settings .settings-group')].filter(group => !group.hidden).map(group => group.id);
        const active = [...tools.querySelectorAll(':scope > button.active')].map(item => item.dataset.explorerSection);
        settingsChecks.push({requested:button.dataset.explorerSection, visible, active});
      }
      const cacheButton = tools.querySelector('[data-explorer-section="settings-cache"]');
      cacheButton?.click();
      await Promise.resolve();
      const cacheUi = {
        selected:Boolean(cacheButton?.classList.contains('active') && !document.querySelector('#settings-cache')?.hidden),
        panel:Boolean(document.querySelector('#settings-cache #cacheManagementPanel')),
        categories:document.querySelectorAll('#settings-cache .cache-category-row').length,
        beforeAbout:settingsButtons.indexOf(cacheButton) === settingsButtons.findIndex(item => item.dataset.explorerSection === 'settings-about') - 1,
        absentFromGeneral:!document.querySelector('#settings-general #cacheManagementPanel')
      };
      const themeButton = tools.querySelector('[data-explorer-section="settings-theme"]');
      localStorage.setItem('termaAppearanceV1', JSON.stringify({preset:'luminous',frosted_strength:53,liquid_strength:39}));
      await (${replayAppearanceBootstrap.toString()})();
      const themeUi = {
        entryHidden:!themeButton && !document.querySelector('#settings-theme'),
        controlsHidden:!document.querySelector('#themeAppearancePanel, #themeFrostedStrength, #themeLiquidStrength'),
        oldConfigIgnored:localStorage.getItem('termaAppearanceV1') === null,
        clearPreset:document.documentElement.dataset.appearancePreset === 'clear',
        noEffects:!document.documentElement.classList.contains('terma-liquid-enabled')
          && document.querySelectorAll('.terma-liquid-lens, .terma-liquid-track').length === 0,
        zeroBlur:getComputedStyle(document.documentElement).getPropertyValue('--terma-frosted-backdrop-blur').trim() === '0px'
      };
      await loadUpdate({current_version:'1.0.8',latest_version:'1.0.9',update_available:true,update_ignored:false});
      sessionStorage.removeItem(UPDATE_NOTICE_SESSION_KEY);
      window.termaUpdateNotice.paint();
      const updateDotIds = ['navSettingsUpdateDot','mobileSettingsUpdateDot','settingsExplorerUpdateDot'];
      const dotsBeforeRead = updateDotIds.map(id => ({id, found:Boolean(document.getElementById(id)), hidden:document.getElementById(id)?.hidden}));
      await loadUpdate({...window.termaUpdateStatus.current(), update_ignored:true});
      window.termaUpdateNotice.paint();
      const ignoredVersionHidesNotice = !window.termaUpdateNotice.visible() && updateDotIds.every(id => document.getElementById(id)?.hidden === true);
      await loadUpdate({...window.termaUpdateStatus.current(), latest_version:'1.0.10', update_ignored:false});
      window.termaUpdateNotice.paint();
      const newerAfterIgnoredShowsNotice = window.termaUpdateNotice.visible() && updateDotIds.every(id => document.getElementById(id)?.hidden === false);
      await loadUpdate({...window.termaUpdateStatus.current(), latest_version:'1.0.9', update_ignored:false});
      window.termaUpdateNotice.paint();
      tools.querySelector('[data-explorer-section="settings-about"]')?.click();
      await Promise.resolve();
      const aboutVisible = [...document.querySelectorAll('#view-settings .settings-group')].filter(group => !group.hidden).map(group => group.id);
      const aboutActive = [...tools.querySelectorAll(':scope > button.active')].map(item => item.dataset.explorerSection);
      const dotsAfterRead = updateDotIds.map(id => ({id, found:Boolean(document.getElementById(id)), hidden:document.getElementById(id)?.hidden}));
      const storedReadVersion = sessionStorage.getItem(UPDATE_NOTICE_SESSION_KEY);
      const sameVersionStaysRead = !window.termaUpdateNotice.visible();
      await loadUpdate({...window.termaUpdateStatus.current(), latest_version:'1.0.9', update_available:false, republished_available:true, release_revision:2, update_ignored:false});
      sessionStorage.removeItem(UPDATE_NOTICE_SESSION_KEY);
      window.termaUpdateNotice.paint();
      const republishedShowsNotice = window.termaUpdateNotice.visible() && updateDotIds.every(id => document.getElementById(id)?.hidden === false);
      tools.querySelector('[data-explorer-section="settings-about"]')?.click();
      await Promise.resolve();
      const republishedStoredReadVersion = sessionStorage.getItem(UPDATE_NOTICE_SESSION_KEY);
      const republishedReadMarksNotice = republishedStoredReadVersion === '1.0.9:r2' && !window.termaUpdateNotice.visible();
      tools.querySelector('[data-explorer-section="settings-basic"]')?.click();
      await Promise.resolve();
      const sessionUi = {
        ttl:document.querySelector('#securitySessionTtlMinutes')?.value,
        max:document.querySelector('#securitySessionMaxSessions')?.value,
        cleanup:document.querySelector('#securitySessionCleanupMinutes')?.value,
        active:document.querySelector('#settings-basic')?.textContent.includes('当前活动会话'),
        save:Boolean([...document.querySelectorAll('#settings-basic button')].find(button=>button.textContent.includes('保存会话设置')))
      };
      const authPolicyUi = {
        redundantCheckboxRemoved:!document.querySelector('#securityLanAuth'),
        localOnlyLabel:[...document.querySelectorAll('#securityAuthMode option')].some(option=>option.value==='lan'&&option.textContent.includes('仅非本机访问')),
        alwaysLabel:[...document.querySelectorAll('#securityAuthMode option')].some(option=>option.value==='always'&&option.textContent.includes('所有浏览器访问')),
        directDefinition:document.querySelector('#settings-basic')?.textContent.includes('来源和 Host 都是回环或当前机器地址')
      };
      const localDirectControl = document.querySelector('#securityLocalDirectDesktopIntegration');
      const localDirectState = document.querySelector('#securityLocalDirectDesktopIntegrationState');
      const localDirectDefaultOff = Boolean(localDirectControl && !localDirectControl.checked && localDirectState?.textContent.includes('默认关闭'));
      const localDirectPolicyCopy = Boolean(localDirectState?.textContent.includes('已通过当前 Web 访问策略') && !localDirectState?.textContent.includes('且已登录时'));
      if (localDirectControl) {
        localDirectControl.checked = true;
        localDirectControl.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const localDirectEnabled = Boolean(localDirectState?.classList.contains('success') && localDirectState.textContent.includes('当前已生效'));
      const trustedProxyControl = document.querySelector('#securityTrustedProxyEnabled');
      if (trustedProxyControl) {
        trustedProxyControl.checked = true;
        trustedProxyControl.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const localDirectProxyBlocked = Boolean(localDirectState?.classList.contains('warning')
        && localDirectState.textContent.includes('已启用可信反向代理')
        && localDirectState.textContent.includes('桌面集成继续使用临时授权'));
      const localDirectUi = {control:Boolean(localDirectControl), defaultOff:localDirectDefaultOff, policyCopy:localDirectPolicyCopy, enabled:localDirectEnabled, proxyBlocked:localDirectProxyBlocked};
      await loadUpdate({...window.termaUpdateStatus.current(), latest_version:'1.0.10'});
      window.termaUpdateNotice.sync();
      const newerVersionShowsAgain = window.termaUpdateNotice.visible() && updateDotIds.every(id => document.getElementById(id)?.hidden === false);

      tools.querySelector('[data-explorer-section="settings-runtime"]')?.click();
      await Promise.resolve();
      const runtimeGroup = document.querySelector('#settings-runtime');
      const runtimeHosts = [...document.querySelectorAll('[name="runtimeListenHost"]')];
      const wildcard = runtimeHosts.find(input => input.value === '0.0.0.0');
      if (!wildcard) {
        const explorerSections = [...tools.querySelectorAll('[data-explorer-section]')].map(item => item.dataset.explorerSection);
        throw new Error('runtime wildcard host missing; primary=' + primaryView + '; activeView=' + activeView + '; section=' + window.termaSettingsNavigation.section + '; explorer=' + explorerSections.join(','));
      }
      if (!wildcard.checked) wildcard.click();
      await Promise.resolve();
      const wildcardCollapsed = runtimeHosts.filter(input => input !== wildcard).every(input => input.closest('.runtime-host-option')?.hidden);
      const runtimeUrlLinks = [...document.querySelectorAll('#runtimeCurrentUrls .runtime-url-row')];
      const runtimeUi = {
        found:Boolean(runtimeGroup && document.querySelector('#runtimeSettingsPanel')),
        selectedHosts:runtimeHosts.filter(input => input.checked).map(input => input.value),
        port:document.querySelector('#runtimeListenPort')?.value || '',
        sftpSettingsAbsent:!document.querySelector('#settings-general #sftpRecycleBinEnabled') && !document.querySelector('#settings-general #sftpMaxOpenFileSizeMb'),
        terminalLatencySettingAbsent:!document.querySelector('#terminalLatencyVisible'),
        wildcardCollapsed,
        urlLinks:runtimeUrlLinks.map(link => link.href),
        restartNotice:runtimeGroup?.textContent.includes('等待重启') || false
      };

      primaryView = 'import';
      exchange.open(true, 'import-source');
      window.termaConnectionViews.renderExplorerTools();
      await Promise.resolve();
      const importButtons = [...tools.querySelectorAll(':scope > button[data-explorer-section]')];
      const importLabels = importButtons.map(button => button.querySelector('span')?.textContent.trim() || '');
      const importExpected = ['SSH config 导入导出','数据库导入导出','配置版本快照'];
      const importRects = importButtons.map(button => button.getBoundingClientRect());
      const importVertical = importRects.every((rect,index) => index === 0 || rect.top >= importRects[index-1].bottom - 0.5) && importRects.every(rect => Math.abs(rect.left-importRects[0].left)<1 && Math.abs(rect.width-importRects[0].width)<1);
      const importResults = document.querySelector('#import-source #import-results');
      const importResultsMerged = Boolean(importResults && importResults.parentElement?.id === 'import-source');
      const importChecks = [];
      for (const button of importButtons) {
        button.click();
        await Promise.resolve();
        const visible = importButtons.map(item => item.dataset.explorerSection).filter(id => document.getElementById(id) && !document.getElementById(id).hidden);
        const active = [...tools.querySelectorAll(':scope > button.active')].map(item => item.dataset.explorerSection);
        importChecks.push({requested:button.dataset.explorerSection, visible, active, resultsVisible: Boolean(importResults?.offsetParent)});
      }
      return {
        settingsLabels,
        settingsOnlySections:JSON.stringify(settingsLabels) === JSON.stringify(settingsExpected),
        settingsSectionMode:tools.classList.contains('section-mode'),
        settingsVertical,
        settingsChecks,
        cacheUi,
        themeUi,
        storageAlignmentUi,
        storageMigrationUi,
        aboutVisible,
        aboutActive,
        duplicateSettingsNav:document.querySelectorAll('.settings-nav').length,
        inlineUpdateDotPresent:Boolean(document.getElementById('settingsInlineUpdateDot')),
        dotsBeforeRead,
        dotsAfterRead,
        storedReadVersion,
        sameVersionStaysRead,
        ignoredVersionHidesNotice,
        newerAfterIgnoredShowsNotice,
        republishedShowsNotice,
        republishedReadMarksNotice,
        newerVersionShowsAgain,
        sessionUi,
        authPolicyUi,
        localDirectUi,
        runtimeUi,
        settingsResponsiveColumns,
        i18nUi,
        importLabels,
        importOwnSections:JSON.stringify(importLabels) === JSON.stringify(importExpected),
        importSectionMode:tools.classList.contains('section-mode'),
        importVertical,
        importResultsMerged,
        importChecks,
        treeHidden:Boolean(document.querySelector('#connectionGroups')?.hidden)
      };
    } finally {
      try { if (thirdPartyLiveZmodemSession) window.termaTerminalZmodem.render(thirdPartyLiveZmodemSession, {hidden:true}); } catch {}
      try { thirdPartyLiveEditor?.destroy(); } catch {}
      thirdPartyLiveFixture?.remove();
      await loadUpdate(previousUpdate);
      window.termaRuntimeSettingsModel.snapshot = previousRuntimeSettings;
      securitySettings = previousSecurity;
      window.termaDesktopStorage.snapshot = previousDesktopSettings;
      window.termaSftpTaskWorkspace.state.jobs = previousLatestJobs;
      window.termaSftpTaskWorkspace.state.paint(previousLatestJobs);
      await setTermaLanguage(previousLanguage);
      window.termaSettingsNavigation.show(previousSettingsSection, {moveToWorkspace:false});
      if (previousImportSection) exchange.current()?.select(previousImportSection, false);
      if (previousStoredVersion === null) sessionStorage.removeItem(UPDATE_NOTICE_SESSION_KEY);
      else sessionStorage.setItem(UPDATE_NOTICE_SESSION_KEY, previousStoredVersion);
      if (workspaceTabByKey(previousTabKey)) activateTab(previousTabKey);
      primaryView = previousPrimary;
      activeView = previousActiveView;
      window.termaConnectionViews.renderExplorerTools();
      window.termaUpdateNotice.paint();
    }
  })().catch(error => {
    const stage = document.documentElement.dataset.uiSmokeStage || 'settings-and-import-navigation';
    throw new Error('[' + stage + '] ' + (error?.stack || error?.message || error));
  })`);
  console.log("[ui-smoke] about modal");
  const aboutUi = await window.webContents.executeJavaScript(`(async () => {
    const loadUpdate = (${loadUpdateFixture.toString()});
    const originalApi = api;
    let updateSettings = null;
    try {
      window.termaWorkspaceShell.showPrimary('settings');
      for (let i = 0; i < 40 && (activeView !== 'settings' || !document.querySelector('#settings-about')); i += 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const aboutButton = document.querySelector('#explorerTools [data-explorer-section="settings-about"]');
      aboutButton?.click();
      for (let i = 0; i < 80; i += 1) {
        if (document.querySelector('#explorerTools [data-explorer-section="settings-about"]')?.classList.contains('active')
          && document.querySelector('#settings-about .about-product')
          && !document.querySelector('#settings-about')?.hidden) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const section = [...document.querySelectorAll('#settings-about')].find(item=>!item.hidden&&item.getClientRects().length)
        || document.querySelector('#settings-about');
      const visibleGroups = [...(section?.closest('[data-terma-settings-owned="page"]')?.querySelectorAll('.settings-group') || [])].filter(group => !group.hidden).map(group => group.id);
      const sourceLink = [...(section?.querySelectorAll('.about-actions a') || [])]
        .find(link => link.href === window.termaSettingsViews.currentAbout()?.repository_url);
      const trigger = [...document.querySelectorAll('#openLicenseBtn')].find(item=>item.getClientRects().length)
        || document.querySelector('#openLicenseBtn');
      if (!section || !trigger) return {found:false, visibleGroups};
      trigger.click();
      for (let i = 0; i < 80 && !section.querySelector('.terma-about-modal'); i += 1) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const modal = document.querySelector('#modal');
      const backdrop = section.querySelector('.terma-about-modal-backdrop');
      const card = backdrop?.querySelector('.terma-about-modal');
      const text = card?.querySelector('pre');
      const cardRect = card?.getBoundingClientRect();
      const textStyle = text ? getComputedStyle(text) : null;
      const result = {
        found:true,
        visibleGroups,
        navigation:{primary:primaryView,section:window.termaSettingsNavigation.section,buttons:[...document.querySelectorAll('#explorerTools [data-explorer-section]')].map(button=>({section:button.dataset.explorerSection,active:button.classList.contains('active'),current:button.getAttribute('aria-current')}))},
        aboutSelected:visibleGroups.length === 1 && visibleGroups[0] === 'settings-about' && document.querySelector('#explorerTools [data-explorer-section="settings-about"]')?.classList.contains('active'),
        duplicateSettingsNav:document.querySelectorAll('.settings-nav').length,
        versionMatches:Boolean(window.termaSettingsViews.currentAbout()?.version && section.textContent.includes('版本 ' + window.termaSettingsViews.currentAbout().version)),
        licenseMetadata:section.textContent.includes('GPL-3.0-only'),
        sourceLink:Boolean(sourceLink && sourceLink.target === '_blank' && sourceLink.relList.contains('noopener') && sourceLink.href === window.termaSettingsViews.currentAbout()?.repository_url),
        modalOpen:Boolean(card?.checkVisibility()),
        accessible:Boolean(card?.getAttribute('role') === 'dialog' && card?.getAttribute('aria-modal') === 'true' && document.getElementById(card?.getAttribute('aria-labelledby'))?.textContent),
        fullText:Boolean(text?.textContent.includes('GNU GENERAL PUBLIC LICENSE') && text?.textContent.includes('END OF TERMS AND CONDITIONS') && text.textContent === window.termaSettingsViews.currentAbout()?.license_text),
        textScrollable:Boolean(text && text.scrollHeight > text.clientHeight && textStyle?.overflowY === 'auto'),
        cardWithinViewport:Boolean(cardRect && cardRect.left >= -0.5 && cardRect.right <= innerWidth + 0.5 && cardRect.top >= -0.5 && cardRect.bottom <= innerHeight + 0.5),
        closeFocused:document.activeElement === card?.querySelector('.terma-about-close')
      };
      const originalElementFocus = HTMLElement.prototype.focus;
      let triggerFocusCalls = 0;
      try {
        HTMLElement.prototype.focus = function(...args) {
          if (this?.id === 'openLicenseBtn') triggerFocusCalls += 1;
          return originalElementFocus.apply(this, args);
        };
        backdrop.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
        await new Promise(resolve => setTimeout(resolve, 0));
        result.backdropIgnored = Boolean(card?.isConnected && card.checkVisibility() && text?.textContent === window.termaSettingsViews.currentAbout()?.license_text);
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
        await new Promise(resolve => setTimeout(resolve, 25));
        result.closedByEscape = !section.querySelector('.terma-about-modal');
        result.focusReturned = triggerFocusCalls > 0 || document.activeElement?.id === 'openLicenseBtn';
      } finally {
        HTMLElement.prototype.focus = originalElementFocus;
      }
      const followup = chooseModal('后续确认框', '验证共享弹窗状态已经清理。', [{label:'确定', value:'ok'}]);
      result.followupBackdropClean = modal.onclick === null;
      modal.querySelector('button[data-choice]')?.click();
      result.followupResolved = await followup === 'ok';
      const previousUpdate = window.termaUpdateStatus.current();
      // Explicit states below must not race a late settings-entry refresh.
      api = (url, options) => url.startsWith('/api/updates/check') ? Promise.resolve(window.termaUpdateStatus.current()) : originalApi(url, options);
      // The settings page starts a real refresh on entry. Keep its response from
      // replacing the explicit download states exercised below.
      window.termaSettingsRequests.updates.cancel();
      window.termaUpdateDownloads.stopPolling();
      const syncUpdateUi = async () => {
        await loadUpdate(updateSettings);
        await new Promise(resolve => setTimeout(resolve, 30));
      };
      const withUpdateUiTimeout = async (label, task, timeout = 8000) => {
        let timer;
        try {
          return await Promise.race([
            Promise.resolve().then(task),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' timed out')), timeout); })
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      updateSettings = {
        current_version:'1.0.8',
        latest_version:'1.0.9',
        update_available:true,
        release_url:'https://github.com/zmide/Terma/releases/tag/v1.0.9',
        published_at:'2026-07-20T00:00:00Z',
        checked_at:'2026-07-20T00:01:00Z',
        notes:'更新检查测试',
        update_ignored:false,
        release_notes:Array.from({length:10}, (_, index) => ({
          version:'1.0.'+(9-index),
          published_at:'2026-07-'+String(20-index).padStart(2, '0')+'T00:00:00Z',
          notes:index===0?'更新检查测试：新版本更新内容':index===1?'上一版本更新内容':'历史版本 '+(9-index)+' 更新内容'
        })),
        download_status:{
          state:'idle',
          selected_asset_name:'Terma-1.0.9-windows-x64-portable.exe',
          selected_asset_size:10485760,
          platform:'win32',
          arch:'x64',
          package_type:'portable',
          progress_percent:0,
          can_open:true
        }
      };
      await syncUpdateUi();
      const updateArea = document.querySelector('#updateCheckArea');
      const updateLink = updateArea.querySelector('a');
      const releaseEntries = [...updateArea.querySelectorAll('.update-release-entry')];
      const updateCardReady = updateArea?.textContent.includes(tr('settings:auto.github_release_updates'))
        && updateArea.textContent.includes('Terma-1.0.9-windows-x64-portable.exe')
        && updateArea.textContent.includes('Windows · x64 · '+tr('settings:auto.update_portable'))
        && updateArea.textContent.includes(tr('settings:auto.update_security_hint'))
        && updateArea.textContent.includes('更新检查测试')
        && releaseEntries.length === 10
        && releaseEntries[0].textContent.includes('v1.0.9')
        && releaseEntries[0].textContent.includes('新版本更新内容')
        && releaseEntries[1].textContent.includes('v1.0.8')
        && releaseEntries[1].textContent.includes('上一版本更新内容')
        && Boolean(updateArea.querySelector('#updateIgnoreCurrentVersion'))
        && updateArea.textContent.includes(tr('settings:auto.ignore_version_hint'))
        && updateArea.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '0'
        && Boolean([...updateArea.querySelectorAll('button')].find(button=>button.textContent.includes('下载并校验')))
        && updateLink?.textContent.includes(tr('settings:updates.view_release'))
        && updateLink?.href === 'https://github.com/zmide/Terma/releases/tag/v1.0.9';
      updateSettings.download_status = {
        ...updateSettings.download_status,
        state:'downloading',
        phase:'probing',
        bytes_downloaded:0,
        progress_percent:0
      };
      const notesBeforeRefresh = updateArea.querySelector('.update-notes');
      const requestedNotesScroll = Math.min(120, Math.max(0, notesBeforeRefresh.scrollHeight - notesBeforeRefresh.clientHeight));
      notesBeforeRefresh.scrollTop = requestedNotesScroll;
      await syncUpdateUi();
      const preservedNotesScroll = updateArea.querySelector('.update-notes')?.scrollTop || 0;
      const probingStateReady = updateArea.textContent.includes(tr('settings:auto.update_speed_test'))
        && updateArea.textContent.includes(tr('settings:updates.testing_routes'))
        && updateArea.textContent.includes(tr('settings:auto.update_parallel_speed'))
        && Boolean([...updateArea.querySelectorAll('button')].find(button=>button.textContent.includes(tr('settings:auto.update_speed_test')) && button.disabled))
        && requestedNotesScroll > 0
        && Math.abs(preservedNotesScroll - requestedNotesScroll) <= 1;
      updateSettings.download_status = {
        ...updateSettings.download_status,
        phase:'downloading',
        source_label:'ghfast.top',
        source_speed_bytes_per_second:2097152,
        bytes_downloaded:5242880,
        progress_percent:50
      };
      await syncUpdateUi();
      const selectedRouteReady = updateArea.textContent.includes('ghfast.top'+tr('settings:updates.speed_suffix',{speed:'2.0 MB/s'}))
        && updateArea.textContent.includes(tr('settings:auto.route_fallback'))
        && updateArea.textContent.includes('50% · 5.0 MB / 10.0 MB');
      updateSettings.download_status = {
        ...updateSettings.download_status,
        phase:'verifying',
        bytes_downloaded:10485760,
        progress_percent:99
      };
      await syncUpdateUi();
      const verifyingStateReady = updateArea.textContent.includes('正在校验')
        && updateArea.textContent.includes(tr('settings:updates.verifying_sha', {progress:100}));
      updateSettings = {
        ...updateSettings,
        current_version:'1.0.9',
        update_available:false,
        download_status:{state:'failed', error:'fetch failed', progress_percent:18}
      };
      await syncUpdateUi();
      const staleFailureCleared = updateArea.textContent.includes(tr('settings:auto.update_latest'))
        && updateArea.textContent.includes(tr('settings:auto.update_no_download'))
        && !updateArea.textContent.includes(tr('settings:auto.update_failed'))
        && !updateArea.textContent.includes('fetch failed')
        && !document.querySelector('#downloadUpdateBtn');
      updateSettings = {
        ...updateSettings,
        current_version:'1.0.8',
        update_available:true,
        download_status:{
          state:'idle',
          selected_asset_name:'Terma-1.0.9-windows-x64-portable.exe',
          selected_asset_size:10485760,
          platform:'win32',
          arch:'x64',
          package_type:'portable',
          progress_percent:0,
          can_open:true
        }
      };
      updateSettings.download_status = {
        ...updateSettings.download_status,
        state:'downloaded',
        version:'1.0.9',
        asset_name:'Terma-1.0.9-windows-x64-portable.exe',
        progress_percent:100,
        can_open:true,
        can_open_directory:true
      };
      await syncUpdateUi();
      const portableButtons = [...updateArea.querySelectorAll('button')].map(button=>button.textContent.trim());
      const portableActionsReady = portableButtons.includes(tr('settings:updates.open_download_directory'))
        && portableButtons.includes(tr('settings:auto.update_redownload'))
        && !portableButtons.includes(tr('settings:updates.open_verified_package'));
      updateSettings.download_status = {
        ...updateSettings.download_status,
        selected_asset_name:'Terma-1.0.9-windows-x64-installer.exe',
        asset_name:'Terma-1.0.9-windows-x64-installer.exe',
        package_type:'installer'
      };
      await syncUpdateUi();
      const installerButtons = [...updateArea.querySelectorAll('button')].map(button=>button.textContent.trim());
      const installerActionsReady = installerButtons.includes(tr('settings:updates.open_verified_package'))
        && installerButtons.includes(tr('settings:updates.open_download_directory'))
        && installerButtons.includes(tr('settings:auto.update_redownload'));
      document.documentElement.dataset.uiSmokeStage = 'update-republished-confirmation';
      updateSettings = {
        ...updateSettings,
        current_version:'1.0.9',
        latest_version:'1.0.9',
        update_available:false,
        republished_available:true,
        release_revision:2,
        download_status:{state:'idle'}
      };
      await withUpdateUiTimeout('update fixture load before republished confirmation', () => loadUpdate(updateSettings));
      let republishedConfirmation = '';
      await withUpdateUiTimeout('republished confirmation', () => window.termaUpdateDownloads.download(false, async message => {
        republishedConfirmation = String(typeof message === 'function' ? message() : message || '');
        return false;
      }));
      const republishedConfirmationReady = republishedConfirmation.includes('v1.0.9')
        && !republishedConfirmation.includes('{{version}}');
      result.updateUiParts = {updateCardReady,probingStateReady,selectedRouteReady,verifyingStateReady,staleFailureCleared,portableActionsReady,installerActionsReady,republishedConfirmationReady,republishedConfirmation,portableButtons,installerButtons,text:updateArea.textContent.replace(/\s+/g,' ').trim()};
      result.updateUi = updateCardReady
        && probingStateReady
        && selectedRouteReady
        && verifyingStateReady
        && staleFailureCleared
        && portableActionsReady
        && installerActionsReady
        && republishedConfirmationReady;
      updateSettings = previousUpdate;
      await syncUpdateUi();
      return result;
    } catch (error) {
      return {error:error?.stack || error?.message || String(error)};
    } finally {
      api = originalApi;
    }
  })()`);
  console.log("[ui-smoke] ssh host trust");
  const hostTrustUi = await window.webContents.executeJavaScript(`(async () => {
    const modal=document.querySelector('#modal');
    const unknownPromise=window.termaWorkspaceRequestPort.confirmHost({
      token:'unknown-token',state:'unknown',host_label:'server.example:22',key_type:'ssh-ed25519',
      fingerprint:'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    });
    await Promise.resolve();
    const unknownCard=modal.querySelector('.ssh-host-trust-modal.unknown');
    const unknown={
      open:Boolean(unknownCard&&!modal.hidden),
      fingerprint:unknownCard?.textContent.includes('SHA256:AAAA'),
      actions:[...unknownCard?.querySelectorAll('button')||[]].map(button=>button.textContent.trim()),
      cancelFocused:document.activeElement?.id==='sshHostTrustCancel'
    };
    modal.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    unknown.backdropIgnored=!modal.hidden;
    modal.querySelector('#sshHostTrustOnce')?.click();
    unknown.result=await unknownPromise;

    const changedPromise=window.termaWorkspaceRequestPort.confirmHost({
      token:'changed-token',state:'changed',host_label:'server.example:22',key_type:'ssh-ed25519',
      previous_fingerprint:'SHA256:OLD',fingerprint:'SHA256:NEW'
    });
    await Promise.resolve();
    const changedCard=modal.querySelector('.ssh-host-trust-modal.changed');
    const changed={
      open:Boolean(changedCard&&!modal.hidden),
      warning:changedCard?.textContent.includes('主机密钥发生变化'),
      oldAndNew:changedCard?.textContent.includes('SHA256:OLD')&&changedCard?.textContent.includes('SHA256:NEW'),
      updateDanger:changedCard?.querySelector('#sshHostTrustPersist')?.classList.contains('danger'),
      updateLabel:changedCard?.querySelector('#sshHostTrustPersist')?.textContent.trim()==='更新并永久信任'
    };
    changedCard?.querySelector('#sshHostTrustPersist')?.click();
    changed.result=await changedPromise;

    const cancelPromise=window.termaWorkspaceRequestPort.confirmHost({state:'unknown',host_label:'cancel.example:22',key_type:'ssh-rsa',fingerprint:'SHA256:CANCEL'});
    await Promise.resolve();
    modal.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    const escapeCancelled=await cancelPromise===null&&modal.hidden;

    const requestPort=window.termaWorkspaceRequestPort, previousFetch=requestPort.fetch;
    let observedPageSize;
    requestPort.fetch=async (pathname, options) => {
      if(!pathname.startsWith('/api/ssh/trusted-hosts?')) return previousFetch(pathname, options);
      observedPageSize=new URL(pathname,location.origin).searchParams.get('page_size');
      return Response.json({page:1,page_size:5,total:1,total_pages:1,hosts:[{id:'host-record',host:'server.example',port:22,host_label:'server.example:22',key_type:'ssh-ed25519',fingerprint:'SHA256:TRUSTED',updated_at:Date.now()}]});
    };
    const previousTab = activeTabKey, previousSection = window.termaSettingsNavigation.section;
    try { await window.termaSettingsViews.open(); } finally { requestPort.fetch=previousFetch; }
    const fixture = $('view-settings');
    window.termaSettingsNavigation.show('settings-basic', {moveToWorkspace:false});
    const trustPanel=fixture.querySelector('#sshHostTrustPanel');
    const settings={
      visible:Boolean(trustPanel&&getComputedStyle(trustPanel).display!=='none'),
      record:trustPanel?.textContent.includes('server.example:22')&&trustPanel?.textContent.includes('SHA256:TRUSTED'),
      removeButton:Boolean(trustPanel?.querySelector('button[aria-label="删除信任记录"]')),
      searchInput:Boolean(trustPanel?.querySelector('#sshHostTrustSearch')),
      searchPlaceholder:Boolean(trustPanel?.querySelector('#sshHostTrustSearch')?.placeholder),
      pageSizeDefault:observedPageSize==='5'
    };
    window.termaSettingsNavigation.show(previousSection,{moveToWorkspace:false});
    if (workspaceTabByKey(previousTab)) activateTab(previousTab);
    await window.termaTrustedHosts.load();
    return {unknown,changed,escapeCancelled,settings};
  })()`);
  console.log("[ui-smoke] menus and actions");
  const desktopMenu = await window.webContents.executeJavaScript(`(async () => {
    window.termaWorkspaceShell.showPrimary('connections');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!document.querySelector('.conn-row')) document.querySelector('.group-head')?.click();
    document.querySelector('.conn-actions .icon-button[title="更多操作"]')?.click();
    const opened = Boolean(document.querySelector('#actionMenu'));
    const labels = [...document.querySelectorAll('#actionMenu button')].map(button => button.textContent.trim());
    const duplicateConnection = labels.includes('复制');
    const simplifiedMenu=['复制 SSH 命令','复制 SFTP 命令','用 VS Code Remote SSH 打开'].every(label=>!labels.includes(label))&&labels.includes('生成其他连接…');
    const menuContentIsPhysicallyLeftAligned = selector => {
      const menu=document.querySelector(selector);
      if (!menu) return false;
      const menuLeft=menu.getBoundingClientRect().left;
      return [...menu.querySelectorAll(':scope > button')].every(button => {
        const firstContent=button.querySelector('svg, span');
        return getComputedStyle(button).textAlign==='left'
          && getComputedStyle(button).justifyContent==='flex-start'
          && firstContent
          && firstContent.getBoundingClientRect().left-menuLeft<=18;
      });
    };
    const leftAligned=menuContentIsPhysicallyLeftAligned('#actionMenu');
    const generatedMenuButton=[...document.querySelectorAll('#actionMenu button')].find(button=>button.textContent.includes('生成其他连接'));
    generatedMenuButton?.click();
    const parentStaysOpen=Boolean(document.querySelector('#actionMenu'));
    const submenu=Boolean(document.querySelector('#actionSubMenu'));
    const submenuLeftAligned=menuContentIsPhysicallyLeftAligned('#actionSubMenu');
    const submenuLabels=[...document.querySelectorAll('#actionSubMenu button span')].map(node=>node.textContent.trim());
    const generateAll=submenuLabels.includes('生成全部连接');
    document.dispatchEvent(new Event('scroll', {bubbles:true}));
    return {opened, duplicateConnection, simplifiedMenu, leftAligned, submenuLeftAligned, parentStaysOpen, submenu, generateAll, labels, submenuLabels, closedOnScroll:!document.querySelector('#actionMenu')&&!document.querySelector('#actionSubMenu')};
  })()`);
  console.log("[ui-smoke] running actions");
  const runningActions = await window.webContents.executeJavaScript(`(() => {
    const connection = connections[0];
    const previousForwards = connection?.forwards;
    const previousRunningFilter = localStorage.getItem('runningFilter');
    const fixture = {
      id:990001,
      connection_id:Number(connection?.id || 0),
      mode:'local',
      service_name:'Running actions fixture',
      service_type:'web',
      url_scheme:'http',
      url_path:'/admin?view=full#status',
      bind_host:'127.0.0.1',
      bind_port:18099,
      target_host:'127.0.0.1',
      target_port:80,
      status:'running',
      reconnect_count:0
    };
    try {
      if (!connection) return {found:false,reason:'connection fixture missing'};
      connection.forwards = [fixture];
      localStorage.removeItem('runningFilter');
      runningOpen.add(connection.name);
      window.termaWorkspaceShell.showPrimary('running');
      window.termaForwardWorkspace.renderRunning();
      window.termaRunning.service().search('');
      const actions = document.querySelector('.running-actions');
      const open = actions?.querySelector('.open-forward-link');
      const buttons = [...(actions?.querySelectorAll('button') || [])];
      const retry = buttons.find(button => button.dataset.action === 'running-forward-retry');
      const stop = buttons.find(button => button.dataset.action === 'running-forward-stop');
      const copy = buttons.find(button => button.dataset.action === 'running-forward-copy');
      const overviewCards = [...document.querySelectorAll('.running-overview > span')];
      const overviewLabelsBelowNumbers = overviewCards.length === 3 && overviewCards.every(card => {
        const countRect = card.querySelector('strong')?.getBoundingClientRect();
        const labelRect = card.querySelector('.running-overview-label')?.getBoundingClientRect();
        return Boolean(countRect && labelRect && labelRect.top >= countRect.bottom - 0.5);
      });
      if (!actions || !open || !retry || !stop || !copy) return {
        found:false,
        actionCount:document.querySelectorAll('.running-actions').length,
        text:document.querySelector('#connectionGroups')?.textContent || ''
      };
      const actionsRect = actions.getBoundingClientRect();
      const openRect = open.getBoundingClientRect();
      const retryRect = retry.getBoundingClientRect();
      const buttonRects = [retry,stop,copy].map(button=>button.getBoundingClientRect());
      const expectedUrl = 'http://127.0.0.1:18099/admin?view=full#status';
      return {
        found:true,
        fits:openRect.left>=actionsRect.left-0.5&&openRect.right<=actionsRect.right+0.5&&buttonRects.every(rect=>rect.left>=actionsRect.left-0.5&&rect.right<=actionsRect.right+0.5),
        compact:buttonRects.every(rect=>rect.width<=31&&rect.height<=31)&&openRect.height<=31,
        iconOnly:[retry,stop,copy].every(button=>!button.textContent.trim()),
        overviewLabelsBelowNumbers,
        customPathApplied:open.getAttribute('href')===expectedUrl&&copy.dataset.copyText===expectedUrl,
        open:{width:openRect.width,height:openRect.height},
        retry:{width:retryRect.width,height:retryRect.height}
      };
    } finally {
      if (connection) connection.forwards = previousForwards;
      window.termaRunning.service().search(previousRunningFilter || '');
      if (previousRunningFilter === null) localStorage.removeItem('runningFilter');
    }
  })()`);
  console.log("[ui-smoke] auth fields");
  const authUi = await window.webContents.executeJavaScript(`(async () => {
    window.termaConnectionFormWorkspace.create();
    const auth = document.querySelector('#conn_auth_type');
    const keyBox = document.querySelector('#keyAuthBox');
    const passwordBox = document.querySelector('#passwordAuthBox');
    if (!auth || !keyBox || !passwordBox) return {found:false};
    auth.value = 'password';
    window.termaConnectionFormWorkspace.updateAuth($('connectionForm'));
    const passwordMode = {
      keyHidden:keyBox.hidden && getComputedStyle(keyBox).display === 'none',
      keyDisabled:Array.from(keyBox.querySelectorAll('input,select,button')).every(control=>control.disabled),
      passwordVisible:!passwordBox.hidden && getComputedStyle(passwordBox).display !== 'none',
      passwordEnabled:Array.from(passwordBox.querySelectorAll('input,select,button')).every(control=>!control.disabled)
    };
    const passwordInputs=[...document.querySelectorAll('#connectionForm .password-input-control input')];
    const passwordToggleCount=passwordInputs.length===2&&passwordInputs.every(input=>input.closest('.password-input-control')?.querySelectorAll('.password-visibility-toggle').length===1);
    const passwordInput=document.querySelector('#conn_password');
    const passwordToggle=passwordInput?.closest('.password-input-control')?.querySelector('.password-visibility-toggle');
    passwordInput.value='connection-visibility-secret';
    passwordToggle?.click();
    await Promise.resolve();
    const passwordShown=passwordInput.type==='text'&&passwordInput.value==='connection-visibility-secret'&&passwordToggle?.getAttribute('aria-pressed')==='true';
    passwordToggle?.click();
    await Promise.resolve();
    const passwordHidden=passwordInput.type==='password'&&passwordInput.value==='connection-visibility-secret'&&passwordToggle?.getAttribute('aria-pressed')==='false';
    const passwordEyeToggle=Boolean(passwordToggleCount&&passwordShown&&passwordHidden);
    auth.value = 'key';
    window.termaConnectionFormWorkspace.updateAuth($('connectionForm'));
    const keyMode = {
      keyVisible:!keyBox.hidden && getComputedStyle(keyBox).display !== 'none',
      keyEnabled:Array.from(keyBox.querySelectorAll('input,select,button')).every(control=>!control.disabled),
      passwordHidden:passwordBox.hidden && getComputedStyle(passwordBox).display === 'none',
      passwordDisabled:Array.from(passwordBox.querySelectorAll('input,select,button')).every(control=>control.disabled)
    };
    return {found:true,passwordMode,keyMode,passwordEyeToggle};
  })()`);
  console.log("[ui-smoke] connection startup form");
  const connectionStartupUi = await window.webContents.executeJavaScript(`(async () => {
    const originalApi=api;
    const originalNotify=notify;
    let testedPayload=null;
    const notices=[];
    api=async (path,options={}) => {
      if(path==='/api/test-ssh'){
        testedPayload=JSON.parse(options.body||'{}');
        return {
          ok:true,
          elapsed_ms:12,
          capabilities:{
            platform:'linux',
            platform_label:'Linux',
            default_shell:{name:'bash',label:'Bash',path:'/bin/bash'},
            profiles:[
              {id:'bash',kind:'shell',label:'Bash',path:'/bin/bash',args:'-l',platform:'posix',is_default:true},
              {id:'python3',kind:'repl',label:'Python 3',path:'/usr/bin/python3',args:'-i',platform:'posix',is_default:false},
              {id:'tmux',kind:'session',label:'tmux',path:'/usr/bin/tmux',args:'new-session -A -s terma',platform:'posix',is_default:false}
            ],
            tools:[{id:'git',label:'Git',path:'/usr/bin/git'}],
            warnings:[]
          }
        };
      }
      return {};
    };
    notify=(...args)=>notices.push(args);
    window.termaWorkspaceShell.showPrimary('connections');
    window.termaConnectionFormWorkspace.create();
    const form=$("connectionForm");
    const field=id=>form?.querySelector('#'+id);
    if(!form || !field('conn_host')) {
      api=originalApi;
      notify=originalNotify;
      return {found:false,missingConnectionForm:true};
    }
    field('conn_name').value='startup-smoke';
    field('conn_user').value='root';
    field('conn_host').value='example.test';
    const advanced=field('connAdvancedOptions');
    const defaultAdvancedCollapsed=advanced?.open===false;
    field('conn_terminal_startup_mode').value='program';
    field('conn_terminal_profile_name').value='My shell';
    field('conn_terminal_profile_kind').value='custom';
    field('conn_terminal_program_path').value='/custom/my-shell';
    field('conn_terminal_program_args').value='--interactive';
    window.termaConnectionTerminal.toggleStartup(form);
    await window.termaConnectionFormActions.test(form, field('connTestBtn'));
    const select=field('conn_terminal_profile_select');
    const customPreserved=field('conn_terminal_program_path').value==='/custom/my-shell'
      && select.value==='__current__';
    const pythonOption=[...select.options].find(option=>option.textContent.includes('Python 3'));
    if(pythonOption) window.termaConnectionTerminal.applyProfile(pythonOption.value,select);
    const detectedApplied=field('conn_terminal_program_path').value==='/usr/bin/python3'
      && field('conn_terminal_program_args').value==='-i'
      && field('conn_terminal_profile_kind').value==='repl'
      && field('conn_terminal_program_platform').value==='posix';
    field('conn_host').value='changed.example';
    field('conn_host').dispatchEvent(new Event('input',{bubbles:true}));
    const stale=form._terminalProbeStale===true
      && field('connTerminalDetectionStatus')?.textContent.includes('已变化');
    window.termaConnectionFormWorkspace.advanced.render(form,[{
      severity:'error',
      line:1,
      start:0,
      end:18,
      option:'StrictHostKeyChecking',
      message:'SSH 主机信任由 Terma 统一管理。',
      suggestion:'请删除该参数。'
    }]);
    const parameterIssueExpanded=advanced?.open===true
      && field('connAdvancedStatus')?.textContent.includes('参数错误')
      && field('connExtraDiagnostics')?.hidden===false;
    advanced.open=false;
    field('connTerminalDetectionStatus').className='terminal-startup-detection error';
    field('connTerminalDetectionStatus').textContent='无法检测远端启动环境。';
    window.termaConnectionFormWorkspace.advanced.update(form);
    const terminalIssueExpanded=advanced?.open===true
      && field('connAdvancedStatus')?.textContent.includes('终端检测失败');
    const card=form.querySelector('.terminal-startup-card');
    const formRect=form.getBoundingClientRect();
    const cardRect=card?.getBoundingClientRect();
    const result={
      found:Boolean(form&&card&&select),
      defaultMode:testedPayload?.terminal_startup_mode==='program',
      requestedDiscovery:testedPayload?.discover_terminal===true,
      customPreserved,
      categories:[...select.querySelectorAll('optgroup')].map(group=>group.label),
      toolShown:field('connTerminalCapabilities')?.textContent.includes('Git'),
      detectedApplied,
      stale,
      defaultAdvancedCollapsed,
      parameterIssueExpanded,
      terminalIssueExpanded,
      noOverflow:Boolean(cardRect&&cardRect.left>=formRect.left-0.5&&cardRect.right<=formRect.right+0.5),
      pathRequired:field('conn_terminal_program_path').required===true
    };
    api=originalApi;
    notify=originalNotify;
    return result;
  })()`);
  console.log("[ui-smoke] save and clear form");
  const saveAndClearUi = await window.webContents.executeJavaScript(`(async () => {
    const originalApi = api;
    const originalLoadAll = window.termaWorkspaceRefresh.load;
    const originalNotify = notify;
    const originalSelectForSave = window.termaConnectionController.select;
    const originalCloseTabsByKey = closeTabsByKey;
    const saved = [];
    const notices = [];
    let openedConnectionId = 0;
    let closedSourceTab = false;
    api = async (url, options={}) => {
      if(url==='/api/identity-files') return [];
      if(url==='/api/connections'&&options.method==='POST') {
        saved.push(JSON.parse(options.body));
        return {id:9902};
      }
      return {};
    };
    window.termaWorkspaceRefresh.load = async () => {};
    notify = (...args) => notices.push(args);
    window.termaConnectionController.select = id => { openedConnectionId=Number(id); };
    closeTabsByKey = keys => { closedSourceTab=Array.isArray(keys)&&keys.includes(activeTabKey); };
    window.termaConnectionFormWorkspace.create();
    document.querySelector('#conn_name').value='save-clear-test';
    document.querySelector('#conn_user').value='root';
    document.querySelector('#conn_host').value='example.test';
    const button=document.querySelector('#connSaveAndClear');
    const visible=Boolean(button&&!button.hidden&&getComputedStyle(button).display!=='none');
    button?.click();
    await new Promise(resolve=>setTimeout(resolve,25));
    const clearResult={
      visible,
      saved:saved.length===1&&saved[0].name==='save-clear-test'&&saved[0].ssh_host==='example.test'&&saved[0].sort_order===1,
      cleared:document.querySelector('#conn_name')?.value===''&&document.querySelector('#conn_user')?.value===''&&document.querySelector('#conn_host')?.value===''&&document.querySelector('#conn_port')?.value==='22',
      defaultsRestored:document.querySelector('#conn_auth_type')?.value==='key'
        && document.querySelector('#conn_sort_order')?.value==='1'
        && document.querySelector('#conn_extra')?.value===''
        && document.querySelector('#conn_remote_generation')?.value===''
        && document.querySelector('#conn_connect_timeout')?.value==='10'
        && document.querySelector('#conn_keepalive_interval')?.value==='60'
        && document.querySelector('#conn_keepalive_count')?.value==='3'
        && document.querySelector('#conn_tcp_keepalive')?.value==='1',
      focused:document.activeElement===document.querySelector('#conn_name'),
      notice:notices.some(args=>String(args[0]).includes('表单已清空')),
      readyAgain:button?.disabled===false&&button?.textContent.trim()==='保存并清空'
    };
    window.termaConnectionFormWorkspace.create();
    document.querySelector('#conn_name').value='save-connect-test';
    document.querySelector('#conn_user').value='root';
    document.querySelector('#conn_host').value='connect.example.test';
    const connectButton=document.querySelector('#connSaveAndConnect');
    const connectVisible=Boolean(connectButton&&!connectButton.hidden&&getComputedStyle(connectButton).display!=='none');
    connectButton?.click();
    await new Promise(resolve=>setTimeout(resolve,25));
    const editFixture={id:9903,name:'edit-save-actions',group_name:window.termaConnectionList.groupNames(undefined,'ssh').find(name=>name==='默认分组'),ssh_user:'root',ssh_host:'edit.example.test',ssh_port:22,sort_order:1,auth_type:'key',identity_file:'',ssh_agent_mode:'auto',jump_connection_id:null,connect_timeout_seconds:10,keepalive_interval_seconds:60,keepalive_count_max:3,tcp_keepalive:1,x11_mode:'off',tags:'',autostart_forwards:0,extra_args:'',forwards:[]};
    connections.push(editFixture);
    window.termaConnectionFormWorkspace.edit(editFixture.id);
    const sshEditActions=[...document.querySelectorAll('#connectionForm .actions button')].filter(item=>!item.hidden).map(item=>item.textContent.trim());
    const sshEditSaveActions=['仅保存','保存并关闭','保存并打开'].every(label=>sshEditActions.includes(label))&&document.querySelector('#connSaveAndClear')?.hidden===true;
    connections.splice(connections.indexOf(editFixture),1);
    window.termaRemoteProfiles.editor.render({id:9904,protocol:'rdp',name:'remote-edit-save-actions',group_name:window.termaConnectionList.groupNames(undefined,'ssh').find(name=>name==='默认分组'),host:'rdp.example.test',port:3389,username:'',options:{display_mode:'dynamic'}});
    const remoteEditActions=[...document.querySelectorAll('#remoteProfileForm button[type="submit"]')].map(item=>item.textContent.trim());
    const remoteEditSaveActions=['仅保存','保存并关闭','保存并打开'].every(label=>remoteEditActions.includes(label));
    const result={
      ...clearResult,
      saveConnectVisible:connectVisible,
      saveConnectOpens:openedConnectionId===9902,
      saveConnectClosesSource:closedSourceTab,
      saveConnectReadyAgain:connectButton?.disabled===false&&connectButton?.textContent.trim()==='保存并连接',
      sshEditSaveActions,
      remoteEditSaveActions
    };
    api=originalApi;
    window.termaWorkspaceRefresh.load=originalLoadAll;
    notify=originalNotify;
    window.termaConnectionController.select=originalSelectForSave;
    closeTabsByKey=originalCloseTabsByKey;
    return result;
  })()`);
  console.log("[ui-smoke] notification cursor");
  const notificationUi = await window.webContents.executeJavaScript(`(async () => {
    const originalNotify = notify;
    const originalDesktop = showDesktopNotification;
    const originalRuntimeSettings = window.termaRuntimeSettingsModel.snapshot;
    const previousTab = activeTabKey;
    const replayed = [];
    notify = (...args) => replayed.push({type:'toast',args});
    showDesktopNotification = event => replayed.push({type:'desktop',id:event?.id});
    if (window.termaNotificationState) {
      window.termaNotificationState.state.lastId = 0;
      window.termaNotificationState.state.cursorInitialized = false;
      window.termaNotificationState.state.pollInFlight = false;
    }
    localStorage.removeItem('lastNotificationId');
    await pollNotifications();
    const result = {replayed:replayed.length,cursor:window.termaNotificationState.state.lastId,initialized:window.termaNotificationState.state.cursorInitialized,stored:Number(localStorage.getItem('lastNotificationId')||0)};
    notify = originalNotify;
    showDesktopNotification = originalDesktop;
    window.termaRuntimeSettingsModel.snapshot = window.termaRuntimeSettingsModel.normalize({
      ...window.termaRuntimeSettingsModel.snapshot,
      saved:{
        ...window.termaRuntimeSettingsModel.snapshot?.saved,
        notification_display:{
          info:{enabled:true,duration_ms:60000},
          success:{enabled:false,duration_ms:3500},
          error:{enabled:true,duration_ms:8000},
          progress:{enabled:false,success_duration_ms:null,error_duration_ms:8000}
        }
      }
    });
    const displayRuntime = window.termaRuntimeSettingsModel.snapshot;
    dismissToast();
    await new Promise(resolve=>setTimeout(resolve,260));
    const before = document.querySelectorAll('#toast .toast').length;
    notify('disabled success category','success');
    const successSuppressed = document.querySelectorAll('#toast .toast').length === before;
    notify('enabled info category','info');
    const infoVisible = document.querySelectorAll('#toast .toast').length === before + 1;
    const progressBefore = document.querySelectorAll('#toast .toast-progress').length;
    createProgressToast({title:'disabled progress category'});
    const progressSuppressed = document.querySelectorAll('#toast .toast-progress').length === progressBefore;
    await window.termaSettingsViews.open();
    window.termaRuntimeSettingsModel.snapshot = displayRuntime;
    window.termaSettingsViews.render();
    result.categoryControls = ['notificationInfoEnabled','notificationInfoDuration','notificationSuccessEnabled','notificationSuccessDuration','notificationErrorEnabled','notificationErrorDuration','notificationProgressEnabled','notificationProgressSuccessDuration','notificationProgressErrorDuration','taskCenterFloatingProgressEnabled'].every(id=>document.getElementById(id));
    result.floatingUnderNotifications = Boolean(document.querySelector('#taskCenterFloatingProgressEnabled')?.closest('#settings-notifications'));
    result.successSuppressed = successSuppressed;
    result.infoVisible = infoVisible;
    result.progressSuppressed = progressSuppressed;
    const notificationDescriptor = Object.getOwnPropertyDescriptor(window, 'Notification');
    try {
      Object.defineProperty(window, 'Notification', {configurable:true, value:{permission:'granted'}});
      window.termaRuntimeSettingsModel.snapshot = window.termaRuntimeSettingsModel.normalize({...window.termaRuntimeSettingsModel.snapshot, saved:{...window.termaRuntimeSettingsModel.snapshot?.saved, desktop_notifications_enabled:true}});
      window.termaSettingsViews.render();
      window.termaRefreshVueSettings($('view-settings'));
      const enabledNotificationState = {
        summary:document.querySelector('#notificationPermissionStatus')?.textContent || '',
        status:document.querySelector('#desktopNotificationStatus')?.textContent || '',
        button:document.querySelector('#desktopNotificationToggleBtn')?.textContent.trim() || ''
      };
      const savedToggleApi = api;
      try {
        api = async (pathname, options={}) => {
          if (pathname === '/api/runtime-settings' && options.method === 'PUT') {
            return {saved:{...window.termaRuntimeSettingsModel.snapshot.saved,...JSON.parse(options.body)}};
          }
          return savedToggleApi(pathname, options);
        };
        (document.getElementById('desktopNotificationToggleBtn')?.click(),await new Promise(resolve=>setTimeout(resolve,60)));
      } finally {
        api = savedToggleApi;
      }
      const disabledNotificationState = {
        summary:document.querySelector('#notificationPermissionStatus')?.textContent || '',
        status:document.querySelector('#desktopNotificationStatus')?.textContent || '',
        button:document.querySelector('#desktopNotificationToggleBtn')?.textContent.trim() || ''
      };
      result.desktopToggleReflects = Boolean(
        enabledNotificationState.summary
        && enabledNotificationState.status
        && enabledNotificationState.button
        && disabledNotificationState.summary
        && disabledNotificationState.status
        && disabledNotificationState.button
        && enabledNotificationState.summary !== disabledNotificationState.summary
        && enabledNotificationState.status !== disabledNotificationState.status
        && enabledNotificationState.button !== disabledNotificationState.button
        && disabledNotificationState.summary.includes(disabledNotificationState.status)
      );
    } catch {
      result.desktopToggleReflects = false;
    } finally {
      if (notificationDescriptor) Object.defineProperty(window, 'Notification', notificationDescriptor);
      else delete window.Notification;
      window.termaRuntimeSettingsModel.snapshot = originalRuntimeSettings;
      window.termaSettingsViews.render();
    }
    dismissToast();
    await new Promise(resolve=>setTimeout(resolve,240));
    window.termaRuntimeSettingsModel.snapshot.saved.notification_display.info.duration_ms = 180;
    notify('hovered notification','info');
    const hoveredToast = document.querySelector('#toast .toast:last-child');
    hoveredToast?.dispatchEvent(new Event('pointerenter'));
    await new Promise(resolve=>setTimeout(resolve,260));
    const pointerKeepsToast = Boolean(hoveredToast?.isConnected);
    hoveredToast?.dispatchEvent(new Event('pointerleave'));
    await new Promise(resolve=>setTimeout(resolve,700));
    const pointerResumesToast = Boolean(hoveredToast && !hoveredToast.isConnected);
    dismissToast();
    window.termaRuntimeSettingsModel.snapshot = originalRuntimeSettings;
    result.pointerKeepsToast = pointerKeepsToast;
    result.pointerResumesToast = pointerResumesToast;
    return result;
  })()`);
  console.log("[ui-smoke] data exchange and restore dialogs");
  let restoreKeyUi;
  const exchangeProbe=new BrowserWindow({show:false,width:1200,height:844,webPreferences:{contextIsolation:true,backgroundThrottling:false,offscreen:true,partition:'exchange-smoke-'+Date.now(),preload:path.join(__dirname,'ui-smoke-preload.js')}});
  exchangeProbe.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
  try{await exchangeProbe.loadURL(url);await new Promise(resolve=>setTimeout(resolve,1200));restoreKeyUi=await runM6ExchangeUiScenario(exchangeProbe,{viewport:'desktop'});}
  finally{exchangeProbe.destroy();}
  const restoreCredentialUi=restoreKeyUi;
  console.log("[ui-smoke] terminal interactions");
  const terminalUi = await window.webContents.executeJavaScript(`(async () => {
    const first = connections[0];
    if (!first) return {found:false};
    const key = 'terminal-ui-smoke';
    const secondKey = 'terminal-ui-smoke-second';
    const previousTerminalTabKey = activeTabKey;
    const previousTerminalGlobalSettings = terminalGlobalSettings;
    const previousTheme = document.documentElement.dataset.theme || 'light';
    const numberingConnectionId = Number(first.id) + 900000;
    const tabsBeforeNumberingCheck = tabs;
    tabs = [{key:'terminal-'+numberingConnectionId+'-2',kind:'terminal',id:numberingConnectionId}];
    window.termaTerminalState.terminalCounts.set(numberingConnectionId,5);
    const numberingContinuesWithOpenTabs=window.termaTerminalPage.nextTerminalTabIndex(numberingConnectionId)===6;
    tabs = [];
    window.termaTerminalState.terminalCounts.set(numberingConnectionId,5);
    const numberingRestartsAfterAllClosed=window.termaTerminalPage.nextTerminalTabIndex(numberingConnectionId)===1;
    window.termaTerminalState.terminalCounts.delete(numberingConnectionId);
    tabs = tabsBeforeNumberingCheck;
    const fixturePane = workspaceFindPane(focusedPaneId);
    const previousFixtureTabs = fixturePane ? [...fixturePane.tabs] : [];
    const previousFixtureActive = fixturePane?.activeTabKey || '';
    tabs.push({key,title:'终端测试',subtitle:'',viewName:'terminal',closable:true,kind:'terminal',id:first.id});
    if (fixturePane) {
      fixturePane.tabs.push(key);
      fixturePane.activeTabKey = key;
    }
    activeTabKey = key;
    activeView = 'terminal';
    let binaryWrite = false;
    let fakeInputHandler = null;
    let terminalFocusCalls = 0;
    let fakeSocketUrl = '';
    let fakeLinkProvider = null;
    let fakeSelectionHandler = null;
    let terminalResetCalls = 0;
    const terminalWrites = [];
    const fakeTerm = {
      hasSelection:()=>true,
      getSelection:()=> 'selected text',
      select:()=>{}, selectAll:()=>{}, clearSelection:()=>{}, clear:()=>{}, reset:()=>{ terminalResetCalls += 1; }, focus:()=>{ terminalFocusCalls += 1; }, scrollToBottom:()=>{}, writeln:value=>terminalWrites.push(String(value||'')), refresh:()=>{},
      write:data=>{ binaryWrite = data instanceof Uint8Array && data[0]===0xff && data[1]===0xfe; },
      onData:handler=>{ fakeInputHandler=handler; return {dispose:()=>{}}; }, onResize:()=>({dispose:()=>{}}),
      onSelectionChange:handler=>{ fakeSelectionHandler=handler; return {dispose:()=>{}}; },
      registerLinkProvider:provider=>{ fakeLinkProvider=provider; return {dispose:()=>{}}; },
      cols:80, rows:24, options:{fontSize:13}, buffer:{active:{length:0,cursorX:0,cursorY:0}}
    };
    window.termaTerminalState.terminalSessions.set(key,{term:fakeTerm,fit:{fit:()=>{}},id:first.id,logId:'1700000000000-terminaluismoke'});
    const inactiveOutputKey = 'terminal-ui-smoke-inactive-output';
    const inactiveOutputWrites = [];
    let inactiveOutputRefreshes = 0;
    const inactiveOutputSession = {
      id:first.id,
      term:{
        write(data, callback){ inactiveOutputWrites.push(String(data || '')); callback?.(); },
        refresh(){ inactiveOutputRefreshes += 1; },
        rows:24,
        buffer:{active:{length:0,cursorX:0,cursorY:0}}
      }
    };
    window.termaTerminalState.terminalSessions.set(inactiveOutputKey, inactiveOutputSession);
    window.termaTerminalOutputFlow.queue(inactiveOutputSession, 'inactive-tab-output');
    await new Promise(resolve=>setTimeout(resolve,25));
    window.dispatchEvent(new Event('focus'));
    await new Promise(resolve=>setTimeout(resolve,25));
    const inactiveTerminalOutputContinues = activeTabKey !== inactiveOutputKey
      && inactiveOutputWrites.join('').includes('inactive-tab-output')
      && !inactiveOutputSession.pendingTerminalOutput?.length
      && !inactiveOutputSession.terminalOutputWriting
      && inactiveOutputRefreshes > 0;
    window.termaTerminalState.terminalSessions.delete(inactiveOutputKey);
    const OriginalWebSocket = window.WebSocket;
    class FakeWebSocket extends EventTarget {
      static OPEN = 1;
      constructor(url){ super(); fakeSocketUrl=String(url||''); this.readyState=1; this.binaryType='blob'; this.sent=[]; }
      send(data){ this.sent.push(data); }
      close(){}
    }
    window.WebSocket = FakeWebSocket;
    const originalTerminalApi = api;
    const fallbackKey = 'terminal-x11-fallback-smoke';
    const fallbackMessages = [];
    const fallbackTicketBodies = [];
    tabs.push({key:fallbackKey,title:'X11 fallback',subtitle:'',viewName:'terminal',closable:true,kind:'terminal',id:first.id});
    if (fixturePane) fixturePane.tabs.push(fallbackKey);
    window.termaTerminalState.terminalSessions.set(fallbackKey,{
      term:{cols:80,rows:24,writeln:value=>fallbackMessages.push(String(value||'')),onData:()=>({dispose(){}}),onResize:()=>({dispose(){}})},
      id:first.id,
      connectionAttempt:0
    });
    api = async (path, options={}) => {
      if(path==='/api/ssh/preflight') return {ok:true};
      if(path==='/api/terminal/startup-tickets') {
        const body=JSON.parse(options.body||'{}');
        fallbackTicketBodies.push(body.startup||{});
        if(body.startup?.x11_mode!=='off') {
          const error=new Error('当前浏览器没有 X11 桌面集成授权');
          error.code='DESKTOP_INTEGRATION_AUTH_REQUIRED';
          throw error;
        }
        return {token:'x11-fallback-ticket'};
      }
      return originalTerminalApi(path, options);
    };
    await window.termaTerminalConnectionRuntime.connectTerminal({...first,x11_mode:'trusted'},fallbackKey);
    const fallbackSocketUrl=fakeSocketUrl;
    const x11DefaultFallsBack=fallbackTicketBodies.length===2
      && !fallbackTicketBodies[0].x11_mode
      && fallbackTicketBodies[1].x11_mode==='off'
      && fallbackSocketUrl.includes('startup_token=x11-fallback-ticket')
      && fallbackMessages.some(line=>line.includes('已自动降级为普通 SSH 终端'));
    window.termaX11TerminalMenu.open(new MouseEvent('click',{bubbles:true,clientX:120,clientY:80}),first.id,key);
    const x11ModeButton=[...document.querySelectorAll('#actionMenu button')]
      .find(button=>button.textContent.includes('默认使用受限 X11'));
    x11ModeButton?.click();
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const x11ScopeLabels=[...document.querySelectorAll('#actionSubMenu button span')]
      .map(node=>node.textContent.trim());
    const x11ScopeMenu=Boolean(x11ModeButton
      && document.querySelector('#actionMenu')
      && document.querySelector('#actionSubMenu')
      && JSON.stringify(x11ScopeLabels)===JSON.stringify(['当前终端生效','新建终端','下次生效']));
    hideActionMenu();
    window.termaTerminalState.terminalSessions.get(fallbackKey)?.socket?.close?.();
    window.termaTerminalState.terminalSessions.delete(fallbackKey);
    tabs=tabs.filter(tab=>tab.key!==fallbackKey);
    if(fixturePane) fixturePane.tabs=fixturePane.tabs.filter(tabKey=>tabKey!==fallbackKey);
    fakeSocketUrl='';
    api = async (path, options={}) => path==='/api/ssh/preflight' ? {ok:true} : originalTerminalApi(path, options);
    await window.termaTerminalConnectionRuntime.connectTerminal(first,key);
    const fakeSocket = window.termaTerminalState.terminalSessions.get(key).socket;
    const ctrlVSession = window.termaTerminalState.terminalSessions.get(key);
    ctrlVSession.connected = true;
    ctrlVSession.connection = {...first, x11_mode:'trusted'};
    ctrlVSession.effectiveX11Mode = 'trusted';
    ctrlVSession.currentDirectoryKnown = true;
    ctrlVSession.currentDirectory = '/home/terma-smoke';
    const originalClipboardReader = window.termaTerminalImagePaste.readImage;
    const originalClipboardApi = api;
    const originalClipboardUpload = window.termaSftpTransfers.controller.submit;
    const originalTermaDesktop = window.termaDesktop;
    if (!window.termaDesktop) window.termaDesktop = {readClipboardImage:async () => ({ok:false,reason:'empty'})};
    const ctrlVUploads = [];
    const ctrlVSentBefore = fakeSocket.sent.length;
    const ctrlVImage = new File([Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4])], 'ctrl-v.png', {type:'image/png'});
    window.termaTerminalImagePaste.readImage = async () => ctrlVImage;
    api = async (path, options={}) => String(path).includes('/terminal-clipboard/image')
      ? {ready:false, available:false, reason:'xclip'}
      : originalClipboardApi(path, options);
    window.termaSftpTransfers.controller.submit = async (files, connectionId, directory, options) => {
      ctrlVUploads.push({files,connectionId,directory,options});
      return {ok:true};
    };
    fakeInputHandler?.(String.fromCharCode(22));
    for (let attempt=0;attempt<100;attempt+=1) {
      if(ctrlVUploads.length && fakeSocket.sent.slice(ctrlVSentBefore).some(value=>String(value).includes('/tmp/ctrl-v.png')))break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const ctrlVImageSent = fakeSocket.sent.slice(ctrlVSentBefore);
    const ctrlVImageIntercepted = ctrlVUploads.length === 1
      && ctrlVUploads[0].directory === '/tmp'
      && ctrlVUploads[0].options?.private === true
      && typeof ctrlVUploads[0].options?.isCurrent === 'function'
      && ctrlVUploads[0].options.isCurrent()
      && ctrlVImageSent.some(value => String(value).includes('/tmp/ctrl-v.png'))
      && !ctrlVImageSent.includes(String.fromCharCode(22));
    const ctrlVDiagnostics = {
      uploads:ctrlVUploads.map(item=>({connectionId:item.connectionId,directory:item.directory,options:{conflict:item.options?.conflict,private:item.options?.private,hasCurrentGuard:typeof item.options?.isCurrent==='function'},fileCount:item.files.length})),
      sent:ctrlVImageSent.map(value=>typeof value === 'string' ? value : Object.prototype.toString.call(value))
    };
    window.termaTerminalImagePaste.readImage = async () => null;
    const ctrlVEmptyBefore = fakeSocket.sent.length;
    fakeInputHandler?.(String.fromCharCode(22));
    await new Promise(resolve => setTimeout(resolve, 20));
    const ctrlVEmptyFallsThrough = fakeSocket.sent.slice(ctrlVEmptyBefore).includes(String.fromCharCode(22));
    window.termaTerminalImagePaste.readImage = originalClipboardReader;
    api = originalClipboardApi;
    window.termaSftpTransfers.controller.submit = originalClipboardUpload;
    if (originalTermaDesktop) window.termaDesktop = originalTermaDesktop;
    else delete window.termaDesktop;
    ctrlVSession.connection = first;
    ctrlVSession.effectiveX11Mode = 'off';
    fakeSocket.dispatchEvent(new MessageEvent('message',{data:new Uint8Array([0xff,0xfe]).buffer}));
    const binaryType = fakeSocket.binaryType;
    const stableLogId = fakeSocketUrl.includes('log_id=1700000000000-terminaluismoke');
    fakeSocket.readyState = 3;
    window.termaTerminalConnectionRuntime.reconnectTerminal(first.id,key);
    await new Promise(resolve=>setTimeout(resolve,10));
    const reconnectedFakeSocket = window.termaTerminalState.terminalSessions.get(key).socket;
    const reconnectPreservesOutput = terminalResetCalls===0
      && terminalWrites.some(line=>line.includes('以上终端内容已保留'))
      && reconnectedFakeSocket!==fakeSocket;
    api = originalTerminalApi;
    const originalConnectForEnter = window.termaTerminalConnection.connect;
    const enterReconnects = [];
    window.termaTerminalConnection.connect = async (connection, tabKey, session) => {
      enterReconnects.push({id:connection.id,tabKey,current:window.termaTerminalState.terminalSessions.get(tabKey)===session});
    };
    reconnectedFakeSocket.readyState = 3;
    fakeInputHandler?.(String.fromCharCode(13));
    const enterReconnect = enterReconnects.length===1&&enterReconnects[0].id===first.id&&enterReconnects[0].tabKey===key&&enterReconnects[0].current;
    window.termaTerminalConnection.connect = originalConnectForEnter;
    reconnectedFakeSocket.readyState = 1;
    window.WebSocket = OriginalWebSocket;
    const connectionPendingKey='terminal-ui-smoke-connection-pending';
    const connectionOtherKey='terminal-ui-smoke-connection-other';
    const previousConnectionPendingTabs=[...tabs];
    const previousConnectionPendingActive=activeTabKey;
    const previousConnectionPendingPaneTabs=fixturePane ? [...fixturePane.tabs] : null;
    tabs.push(
      {key:connectionPendingKey,title:'连接阶段测试',subtitle:'',viewName:'terminal',closable:true,kind:'terminal',id:first.id},
      {key:connectionOtherKey,title:'连接阶段切换',subtitle:'',viewName:'settings',closable:true,kind:'settings'}
    );
    if(fixturePane) fixturePane.tabs.push(connectionPendingKey,connectionOtherKey);
    const pendingWrites=[];
    window.termaTerminalState.terminalSessions.set(connectionPendingKey,{term:{cols:80,rows:24,writeln:value=>pendingWrites.push(String(value||'')),onData:()=>({dispose(){}}),onResize:()=>({dispose(){}})},id:first.id,connectionAttempt:0,connectionPending:false,socket:null,connected:false});
    let releasePreflight=null;
    let preflightStarted=false;
    api=async(pathname,options={})=>{
      if(pathname==='/api/ssh/preflight') {
        preflightStarted=true;
        return new Promise(resolve=>{releasePreflight=()=>resolve({ok:true});});
      }
      return originalTerminalApi(pathname,options);
    };
    const pendingConnection=window.termaTerminalConnectionRuntime.connectTerminal(first,connectionPendingKey);
    await new Promise(resolve=>setTimeout(resolve,0));
    const loopTimerStarted=await new Promise(resolve=>setTimeout(()=>resolve(true),10));
    activateTab(connectionOtherKey);
    const connectionStageTabSwitch=Boolean(preflightStarted&&loopTimerStarted&&activeTabKey===connectionOtherKey);
    releasePreflight?.();
    await pendingConnection;
    window.termaTerminalConnectionRuntime.disconnectTerminal(connectionPendingKey);
    window.termaTerminalState.terminalSessions.delete(connectionPendingKey);
    tabs=previousConnectionPendingTabs;
    activeTabKey=previousConnectionPendingActive;
    if(fixturePane) {
      fixturePane.tabs=previousConnectionPendingPaneTabs || fixturePane.tabs;
      fixturePane.activeTabKey=key;
    }
    api=originalTerminalApi;
    const fontSizeField = window.termaTerminalMetadata.terminalFontSizeField();
    const previousFontSize = first[fontSizeField];
    const focusBeforeFont = terminalFocusCalls;
    window.termaTerminalPage.changeTerminalFont(key,1);
    await new Promise(resolve=>setTimeout(resolve,5));
    const fontActionRestoresFocus = terminalFocusCalls>focusBeforeFont;
    window.termaTerminalPreferences.cancelPending(first.id);
    first[fontSizeField] = previousFontSize;
    const previousRecentTerminalCommands = [...window.termaTerminalHistory.list()];
    ((items)=>{window.termaTerminalHistory.clear();[...items].reverse().forEach(window.termaTerminalHistory.save);})(['echo terminal focus smoke']);
    const focusBeforeRecent = terminalFocusCalls;
    window.termaTerminalTextDialogs.recent(key);
    const recentCommandSequenceVisible = document.querySelector('.recent-command-index')?.textContent.trim() === '1'
      && document.querySelector('.recent-command-list button code')?.textContent === 'echo terminal focus smoke';
    document.querySelector('#recentCommandClose')?.click();
    await new Promise(resolve=>setTimeout(resolve,5));
    const recentCommandsRestoreFocus = terminalFocusCalls>focusBeforeRecent;
    ((items)=>{window.termaTerminalHistory.clear();[...items].reverse().forEach(window.termaTerminalHistory.save);})(previousRecentTerminalCommands);
    const connectionAddress=first.ssh_user+'@'+first.ssh_host+':'+first.ssh_port;
    let terminalTestView=window.termaTerminalEngineView.terminalViewForKey(key);
    if (!terminalTestView) return {found:false,executeError:'terminal test view unavailable'};
    terminalTestView.innerHTML='<div id="terminalToolbarMount"><div class="terminal-toolbar"></div></div><div id="terminalMount" class="terminal-box"></div>';
    setWorkspace('终端测试',connectionAddress,'terminal',key,false,true,{kind:'terminal',id:first.id});
    terminalTestView=window.termaTerminalEngineView.terminalViewForKey(key) || terminalTestView;
    const resourceWindowTitle = document.title === first.ssh_host+':'+first.ssh_port+' · 终端 · 终端测试 · Terma';
    const previousDocumentTitle = document.title;
    window.termaWorkspaceViews.presentation.syncTitle('210.10.1.134 · VNC', '210.10.1.134:5900', 'remote-desktop', 'ui-smoke-vnc-title', {kind:'remote-desktop', protocol:'vnc'});
    const remoteDesktopTitleDedup = document.title === '210.10.1.134:5900 · VNC · Terma';
    document.title = previousDocumentTitle;
    window.termaDesktop?.setWindowTitle?.(previousDocumentTitle);
    activeTabKey = key;
    window.termaTerminalConnectionRuntime.updateTerminalConnectionStatus(first, key, 'connected');
    await Promise.resolve();
    const statusIndicator = document.querySelector('#terminalStatus');
    const statusHoverShowsFull = statusIndicator?.title === connectionAddress+' · 已连接';
    const desktopStatusAvoidsDuplicate = statusIndicator?.textContent === ''
      && document.querySelector('#workspaceSubtitle')?.textContent === connectionAddress;
    const desktopToolbarInHeader = statusIndicator?.closest('#workspaceGlobalHeaderTools') !== null
      && document.querySelector('#workspaceGlobalHeaderTools')?.hidden === false
      && document.querySelector('#terminalToolbarMount')?.children.length === 0;
    const fixtureSession = window.termaTerminalState.terminalSessions.get(key);
    fixtureSession.connected = true;
    window.termaTerminalPage.updateTerminalConnectionToggle(key);
    await Promise.resolve();
    const connectionToggle = document.querySelector('.terminal-action-reconnect');
    const connectionToggleUsesLinkAction = Boolean(connectionToggle?.querySelector('.lucide-link-2-off') && connectionToggle.title.includes('断开'));
    const legacyTerminalControlsAbsent = !document.querySelector('#terminalLatency,.terminal-actions .terminal-action-forward');
    const mount=terminalTestView.querySelector('#terminalMount');
    const terminalBoxStyle=getComputedStyle(mount);
    const terminalFrameColors=[terminalBoxStyle.borderTopColor,terminalBoxStyle.borderRightColor,terminalBoxStyle.borderBottomColor];
    const terminalBackgroundColor=terminalBoxStyle.backgroundColor;
    const colorChannels=value=>{
      const channels=(value.match(/[\\d.]+/g)||[]).slice(0,3).map(Number);
      return value.startsWith('color(srgb ') ? channels.map(channel=>channel*255) : channels;
    };
    const backgroundChannels=colorChannels(terminalBackgroundColor);
    const terminalFrameLowContrast=backgroundChannels.length===3&&terminalFrameColors.every(color=>{
      const channels=colorChannels(color);
      return channels.length===3
        && Math.max(...channels)<140
        && Math.max(...channels.map((channel,index)=>Math.abs(channel-backgroundChannels[index])))<=48;
    });
    fixtureSession.term.element=mount;
    window.termaTerminalCursorCopy.start(key);
    const cursorCopyHint=mount.querySelector('.terminal-cursor-copy-hint');
    const cursorCopyHintRect=cursorCopyHint?.getBoundingClientRect();
    const cursorCopyMountRect=mount.getBoundingClientRect();
    const desktopCursorCopyHintVisible=Boolean(
      cursorCopyHint
      && cursorCopyHint.textContent.includes('光标复制：拖到复制起点后松手')
      && cursorCopyHint.querySelector('.terminal-cursor-copy-cancel')
      && cursorCopyHintRect?.width>160
      && cursorCopyHintRect.left>=cursorCopyMountRect.left-0.5
      && cursorCopyHintRect.right<=cursorCopyMountRect.right+0.5
      && cursorCopyHintRect.top>=cursorCopyMountRect.top-0.5
      && cursorCopyHintRect.bottom<=cursorCopyMountRect.bottom+0.5
    );
    window.termaTerminalCursorCopy.cancel(fixtureSession,key);
    const desktopCursorCopyHintCleansUp=!mount.querySelector('.terminal-cursor-copy-hint,.terminal-cursor-copy-cancel')&&!fixtureSession.cursorCopyState;
    const dropApi=api;
    const dropChoice=chooseModal;
    const dropRefreshJobs=window.termaSftpTaskWorkspace.runtime.refresh;
    const dropStartJobsTimer=window.termaSftpTransferLifecycle.polling.start;
    const dropUploadWithProgress=window.termaSftpTransfers.transport.send;
    const dropNotify=notify;
    const dropNotification=window.termaNotificationToasts.notify;
    const terminalDropCalls={crossCopies:[],uploadJobs:[],uploads:[],prompts:[],notices:[]};
    const terminalDropFeedbackFixtures=[];
    let terminalDropUi={found:false};
    try {
      fixtureSession.connected=true;
      fixtureSession.currentDirectory='/workspace/current';
      fixtureSession.currentDirectoryKnown=true;
      fixtureSession.mount=mount;
      fixtureSession.key=key;
      window.termaTerminalDrop.bind(fixtureSession,mount);
      api=async (pathname,options={})=>{
        const body=options.body ? JSON.parse(options.body) : {};
        if(pathname.endsWith('/sftp/upload-plan')) {
          return {items:(body.filenames||[]).map(name=>({name,exists:true}))};
        }
        if(pathname.endsWith('/sftp/cross-copy')) {
          terminalDropCalls.crossCopies.push({pathname,body});
          return {id:'terminal-copy-job',type:'cross-copy',status:'pending',progress:0};
        }
        if(pathname.endsWith('/sftp/upload-job')) {
          terminalDropCalls.uploadJobs.push({pathname,body});
          return {id:'terminal-upload-job',type:'upload',status:'running',progress:0};
        }
        if(pathname==='/api/sftp/jobs') return [];
        return dropApi(pathname,options);
      };
      chooseModal=async (title,message,actions)=>{
        terminalDropCalls.prompts.push({
          title:String(typeof title==='function'?title():title||''),
          message:String(typeof message==='function'?message():message||''),
          values:actions.map(action=>action.value),
          hint:document.querySelector('#sftpDragHint')?.textContent||''
        });
        return 'rename';
      };
      window.termaSftpTaskWorkspace.runtime.refresh=async()=>[];
      window.termaSftpTransferLifecycle.polling.start=()=>{};
      window.termaSftpTransfers.transport.send=async (url,body,job)=>{
        terminalDropCalls.uploads.push({url,name:body?.name||'',jobId:job?.id||''});
        return {...job,status:'done',progress:100};
      };
      notify=(text,type='info')=>terminalDropCalls.notices.push({text:String(text||''),type});
      window.termaNotificationToasts.notify=notify;
      const dispatchDropEvent=(type,dataTransfer)=>{
        const event=new Event(type,{bubbles:true,cancelable:true});
        Object.defineProperty(event,'dataTransfer',{value:dataTransfer});
        mount.dispatchEvent(event);
        return event;
      };
      const createSftpDropFeedbackFixture=tabKey=>{
        const root=document.createElement('div');
        root.dataset.sftpTabKey=tabKey;
        root.style.cssText='position:fixed;left:8px;top:8px;width:220px;height:160px;';
        root.innerHTML='<div class="sftp-shell" style="width:100%;height:100%"><div id="sftpDropOverlay" class="sftp-drop-overlay" hidden></div></div>';
        document.body.appendChild(root);
        window.termaSftpTabs.runtime.ensure(tabKey,first.id,'.',root);
        terminalDropFeedbackFixtures.push({tabKey,root});
        return root.querySelector('#sftpDropOverlay');
      };
      const firstSftpFeedback=createSftpDropFeedbackFixture('ui-drop-feedback-sftp-1');
      const secondSftpFeedback=createSftpDropFeedbackFixture('ui-drop-feedback-sftp-2');
      const targetSwitchDataTransfer={types:['Files'],files:[],items:[],dropEffect:''};
      window.termaSftpDragWorkspace.dropFeedback.external(true,{tabKey:'ui-drop-feedback-sftp-1',path:'/sftp-1'});
      const firstSftpOnly=firstSftpFeedback.hidden===false&&secondSftpFeedback.hidden===true;
      dispatchDropEvent('dragenter',targetSwitchDataTransfer);
      const terminalAfterFirstSftp=mount.querySelector('.terminal-drop-overlay')?.hidden===false
        &&firstSftpFeedback.hidden===true
        &&secondSftpFeedback.hidden===true
        &&!document.querySelector('#sftpDragHint');
      window.termaSftpDragWorkspace.dropFeedback.external(true,{tabKey:'ui-drop-feedback-sftp-2',path:'/sftp-2'});
      const secondSftpAfterTerminal=mount.querySelector('.terminal-drop-overlay')?.hidden===true
        &&firstSftpFeedback.hidden===true
        &&secondSftpFeedback.hidden===false
        &&document.querySelector('#sftpDragHint')?.textContent.includes('/sftp-2');
      window.termaSftpDragWorkspace.dropFeedback.external(true,{tabKey:'ui-drop-feedback-sftp-1',path:'/sftp-1'});
      const firstSftpAfterSecond=mount.querySelector('.terminal-drop-overlay')?.hidden===true
        &&firstSftpFeedback.hidden===false
        &&secondSftpFeedback.hidden===true
        &&document.querySelector('#sftpDragHint')?.textContent.includes('/sftp-1');
      window.termaSftpDragWorkspace.dropFeedback.external(false,{tabKey:'ui-drop-feedback-sftp-2'});
      const lateLeaveKeepsCurrentTarget=firstSftpFeedback.hidden===false
        &&secondSftpFeedback.hidden===true
        &&document.querySelector('#sftpDragHint')?.textContent.includes('/sftp-1');
      const singleActiveDropTarget=firstSftpOnly&&terminalAfterFirstSftp&&secondSftpAfterTerminal&&firstSftpAfterSecond&&lateLeaveKeepsCurrentTarget;
      window.termaSftpDragWorkspace.drag.feedback.clear();
      const copyEntries=[{path:'/remote/source.txt',name:'source.txt',type:'file'}];
      const copyDataTransfer={
        types:[window.termaSftpDragWorkspace.mime],
        files:[],
        items:[],
        dropEffect:'',
        getData(type){
          return type===window.termaSftpDragWorkspace.mime
            ? window.termaDragPayload.serializeDragPayload(Number(first.id)+7000,copyEntries,'remote-source-tab')
            : '';
        }
      };
      dispatchDropEvent('dragenter',copyDataTransfer);
      const copyOverEvent=dispatchDropEvent('dragover',copyDataTransfer);
      const dropOverlay=mount.querySelector('.terminal-drop-overlay');
      const dropHint=dropOverlay?.querySelector('.terminal-drop-hint');
      const overlayRect=dropOverlay?.getBoundingClientRect();
      const hintRect=dropHint?.getBoundingClientRect();
      const overlayStyle=dropOverlay?getComputedStyle(dropOverlay):null;
      const copyFeedbackVisible=Boolean(
        dropOverlay&&!dropOverlay.hidden
        &&dropOverlay.dataset.mode==='copy'
        &&dropOverlay.textContent.includes('松开复制到终端当前目录：/workspace/current')
        &&copyOverEvent.defaultPrevented
        &&copyDataTransfer.dropEffect==='copy'
        &&overlayStyle?.borderTopStyle==='dashed'
        &&overlayRect&&hintRect
        &&hintRect.left>=overlayRect.left-0.5
        &&hintRect.right<=overlayRect.right+0.5
        &&hintRect.bottom<=overlayRect.bottom+0.5
      );
      const copyFeedbackMetrics={
        hidden:dropOverlay?.hidden,
        mode:dropOverlay?.dataset.mode||'',
        text:dropOverlay?.textContent||'',
        defaultPrevented:copyOverEvent.defaultPrevented,
        dropEffect:copyDataTransfer.dropEffect,
        borderStyle:overlayStyle?.borderTopStyle||'',
        overlayRect:overlayRect ? {left:overlayRect.left,right:overlayRect.right,top:overlayRect.top,bottom:overlayRect.bottom} : null,
        hintRect:hintRect ? {left:hintRect.left,right:hintRect.right,top:hintRect.top,bottom:hintRect.bottom} : null
      };
      const copyDropEvent=dispatchDropEvent('drop',copyDataTransfer);
      await new Promise(resolve=>setTimeout(resolve,20));
      const copyPrompt=terminalDropCalls.prompts.find(item=>item.title.includes('终端：/workspace/current')&&item.message.includes('source.txt'));
      const copyRequest=terminalDropCalls.crossCopies[0]?.body;
      const sftpCopyToCurrentDirectory=Boolean(
        copyDropEvent.defaultPrevented
        &&copyRequest?.target_connection_id===Number(first.id)
        &&copyRequest?.target==='/workspace/current'
        &&copyRequest?.paths?.[0]==='/remote/source.txt'
        &&copyRequest?.conflict==='rename'
        &&copyPrompt?.values.includes('overwrite')
        &&copyPrompt?.values.includes('rename')
        &&copyPrompt?.values.includes('cancel')
        &&copyPrompt?.hint.includes('正在检查 终端：/workspace/current 并准备复制')
        &&dropOverlay?.hidden===true
      );
      const localFile={name:'duplicate.txt',size:9,webkitRelativePath:''};
      const uploadDataTransfer={types:['Files'],files:[localFile],items:[],dropEffect:''};
      dispatchDropEvent('dragenter',uploadDataTransfer);
      const uploadOverEvent=dispatchDropEvent('dragover',uploadDataTransfer);
      const uploadFeedbackVisible=Boolean(
        dropOverlay&&!dropOverlay.hidden
        &&dropOverlay.dataset.mode==='upload'
        &&dropOverlay.textContent.includes('松开上传到终端当前目录：/workspace/current')
        &&uploadOverEvent.defaultPrevented
        &&uploadDataTransfer.dropEffect==='copy'
      );
      const uploadFeedbackMetrics={
        hidden:dropOverlay?.hidden,
        mode:dropOverlay?.dataset.mode||'',
        text:dropOverlay?.textContent||'',
        defaultPrevented:uploadOverEvent.defaultPrevented,
        dropEffect:uploadDataTransfer.dropEffect
      };
      const uploadDropEvent=dispatchDropEvent('drop',uploadDataTransfer);
      await new Promise(resolve=>setTimeout(resolve,20));
      const uploadPrompt=terminalDropCalls.prompts.find(item=>item.title==='发现同名文件');
      const uploadRequest=terminalDropCalls.uploadJobs[0]?.body;
      const localUploadToCurrentDirectory=Boolean(
        uploadDropEvent.defaultPrevented
        &&uploadRequest?.path==='/workspace/current'
        &&uploadRequest?.filename==='duplicate.txt'
        &&uploadRequest?.conflict==='rename'
        &&terminalDropCalls.uploads[0]?.name==='duplicate.txt'
        &&uploadPrompt?.message.includes('duplicate.txt')
        &&uploadPrompt?.values.includes('overwrite')
        &&uploadPrompt?.values.includes('rename')
        &&uploadPrompt?.values.includes('')
        &&terminalDropCalls.notices.some(item=>item.type==='info'&&item.text.includes('SSH 连接的原登录用户')&&item.text.includes('su 或 sudo'))
        &&dropOverlay?.hidden===true
      );
      dispatchDropEvent('dragenter',uploadDataTransfer);
      const resizeFeedbackBefore = !dropOverlay.hidden;
      window.dispatchEvent(new Event('resize'));
      await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,20)));
      const resizeFeedbackClears = resizeFeedbackBefore && dropOverlay.hidden && !document.querySelector('#sftpDragHint');
      dispatchDropEvent('dragenter',uploadDataTransfer);
      const staleFeedbackBefore = !dropOverlay.hidden;
      await new Promise(resolve=>setTimeout(resolve,1050));
      const staleFeedbackClears = staleFeedbackBefore && dropOverlay.hidden && !document.querySelector('#sftpDragHint') && fixtureSession.terminalDropDepth === 0;
      terminalDropUi={
        found:Boolean(dropOverlay&&dropHint),
        copyFeedbackVisible,
        copyFeedbackMetrics,
        sftpCopyToCurrentDirectory,
        uploadFeedbackVisible,
        uploadFeedbackMetrics,
        localUploadToCurrentDirectory,
        singleActiveDropTarget,
        resizeFeedbackClears,
        staleFeedbackClears,
        completionNoticeNotDuplicated:!terminalDropCalls.notices.some(item=>item.text.includes('已上传到')),
        copyTarget:copyRequest?.target||'',
        uploadTarget:uploadRequest?.path||'',
        prompts:terminalDropCalls.prompts
      };
    } finally {
      api=dropApi;
      chooseModal=dropChoice;
      window.termaSftpTaskWorkspace.runtime.refresh=dropRefreshJobs;
      window.termaSftpTransferLifecycle.polling.start=dropStartJobsTimer;
      window.termaSftpTransfers.transport.send=dropUploadWithProgress;
      notify=dropNotify;
      window.termaNotificationToasts.notify=dropNotification;
      window.termaSftpDragWorkspace.drag.feedback.clear?.();
      document.querySelector('#sftpDragHint')?.remove();
      for(const fixture of terminalDropFeedbackFixtures){
        window.termaSftpTabs.runtime.dispose(fixture.tabKey);
        fixture.root.remove();
      }
    }
    terminalGlobalSettings=window.termaTerminalSettingsModel.normalize(window.termaTerminalSettingsModel.defaults);
    window.termaTerminalToolbarService.actions.encoding(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:160,clientY:100}),key,first.id);
    const encodingLabels=[...document.querySelectorAll('#actionMenu button span')].map(item=>item.textContent.trim());
    const encodingMenuOpened=['UTF-8','GB18030','GBK','Big5','Shift_JIS','EUC-KR','ISO-8859-1'].every(label=>encodingLabels.includes(label));
    hideActionMenu();
    const encodingApi=api;
    const encodingNotify=notify;
    const previousEncoding=first.terminal_encoding||'utf8';
    const encodingRequests=[];
    const encodingNotices=[];
    const encodingActions=document.querySelector('.terminal-actions');
    encodingActions?.insertAdjacentHTML('beforeend','<button class="terminal-action-encoding"><span>'+window.termaTerminalMetadata.terminalEncodingLabel(first,key)+'</span></button>');
    api=async (pathname,options={})=>{
      if(pathname.endsWith('/terminal-preferences')) {
        const body=JSON.parse(options.body||'{}');
        encodingRequests.push(body.terminal_encoding);
        await new Promise(resolve=>setTimeout(resolve,body.terminal_encoding==='gb18030'?20:1));
        return body;
      }
      return encodingApi(pathname,options);
    };
    notify=(text,type='info')=>encodingNotices.push({text:String(text||''),type});
    await Promise.all([
      window.termaTerminalPreferences.apply(key,first.id,{terminal_encoding:'gb18030'},'编码已切换为 GB18030'),
      window.termaTerminalPreferences.apply(key,first.id,{terminal_encoding:'gbk'},'编码已切换为 GBK')
    ]);
    const encodingSelectionUsesLatest=Boolean(
      JSON.stringify(encodingRequests)===JSON.stringify(['gb18030','gbk'])
      &&window.termaTerminalState.terminalSessions.get(key)?.terminalEncoding==='gbk'
      &&document.querySelector('.terminal-action-encoding span')?.textContent==='GBK'
      &&encodingNotices.at(-1)?.text.includes('GBK')
      &&reconnectedFakeSocket.sent.some(value=>String(value).includes('"terminal-encoding"')&&String(value).includes('"gbk"'))
    );
    first.terminal_encoding=previousEncoding;
    window.termaTerminalState.terminalSessions.get(key).terminalEncoding=previousEncoding;
    api=encodingApi;
    notify=encodingNotify;
    window.termaTerminalToolbarService.actions.font(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:180,clientY:100}),key,first.id);
    const fontLabels=[...document.querySelectorAll('#actionMenu button span')].map(item=>item.textContent.trim());
    const fontMenuOpened=['系统等宽','Cascadia','JetBrains Mono','Consolas','自定义字体…','紧凑行距 1.0','行距 1.4','常规字重','半粗字重','恢复终端显示默认值'].every(label=>fontLabels.includes(label));
    hideActionMenu();
    window.termaTerminalInteraction.bind(window.termaTerminalState.terminalSessions.get(key),key,first.id,mount);
    mount.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:120,clientY:120}));
    const labels=Array.from(document.querySelectorAll('#actionMenu button span')).map(el=>el.textContent.trim());
    hideActionMenu();
    await window.termaTerminalSettings.open(key);
    const terminalSettingsCard=document.querySelector('#modal .terminal-settings-modal');
    const terminalSettingsRect=terminalSettingsCard?.getBoundingClientRect();
    const terminalSettingsPanels=document.querySelector('.terminal-settings-panels');
    window.termaTerminalViews.selectTab('clipboard');
    const terminalClipboardPanel=document.querySelector('#terminalSettingsPanelClipboard');
    const terminalSettingsNoHorizontalOverflow=Boolean(
      terminalSettingsPanels&&terminalClipboardPanel
      &&terminalSettingsPanels.scrollWidth<=terminalSettingsPanels.clientWidth+1
      &&terminalClipboardPanel.scrollWidth<=terminalClipboardPanel.clientWidth+1
    );
    window.termaTerminalViews.selectTab('appearance');
    const terminalSettingsUi={
      open:Boolean(terminalSettingsCard&&!document.querySelector('#modal')?.hidden),
      globalScope:Boolean(terminalSettingsCard?.textContent.includes('应用到继承默认值的连接；连接独立设置优先')),
      controls:['terminalSettingFontFamily','terminalSettingFontSize','terminalSettingScrollback','terminalSettingBackgroundColor','terminalSettingMiddleMouse','terminalSettingRightMouse','terminalSettingCtrlClick','terminalSettingUrlLinks','terminalSettingWordSeparators','terminalSettingAutoCopy','terminalSettingMultilinePaste'].every(id=>Boolean(document.querySelector('#'+id))),
      withinViewport:Boolean(terminalSettingsRect&&terminalSettingsRect.left>=-0.5&&terminalSettingsRect.right<=innerWidth+0.5&&terminalSettingsRect.top>=-0.5&&terminalSettingsRect.bottom<=innerHeight+0.5),
      compact:Boolean(terminalSettingsRect&&terminalSettingsRect.height<=640),
      readableWidth:Boolean(terminalSettingsRect&&terminalSettingsRect.width>=Math.min(800,innerWidth-28)-1),
      noHorizontalOverflow:terminalSettingsNoHorizontalOverflow,
      tabs:[...document.querySelectorAll('.terminal-settings-tabs [role="tab"]')].map(tab=>tab.textContent.trim()),
      backgroundModes:[...document.querySelectorAll('input[name="terminalSettingBackgroundMode"]')].map(input=>input.value),
      requestedDefaults:window.termaTerminalSettingsModel.defaults.font_size===13&&window.termaTerminalSettingsModel.defaults.scrollback_lines===30000&&window.termaTerminalSettingsModel.defaults.font_family.includes('monospace')&&window.termaTerminalSettingsModel.defaults.background_mode==='theme'&&window.termaTerminalSettingsModel.defaults.url_links_enabled===true&&window.termaTerminalSettingsModel.defaults.auto_copy_selection===false&&window.termaTerminalSettingsModel.defaults.copy_include_trailing_newline===false,
      editablePasteSetting:document.querySelector('#terminalSettingMultilinePaste')?.selectedOptions[0]?.textContent.includes('可编辑命令窗口')
    };
    terminalSettingsUi.drop=terminalDropUi;
    const whiteBackground=document.querySelector('input[name="terminalSettingBackgroundMode"][value="white"]');
    whiteBackground.checked=true;
    window.termaTerminalViews.refreshSettings();
    const whitePreview=document.querySelector('#terminalBackgroundPreview');
    const whitePreviewBackgroundText=whitePreview.style.background;
    const whitePreviewForegroundText=whitePreview.style.color;
    const whitePreviewBackground=colorChannels(whitePreviewBackgroundText);
    const whitePreviewForeground=colorChannels(whitePreviewForegroundText);
    const whitePreviewReadable=whitePreviewBackground.length===3&&whitePreviewBackground.every(channel=>channel>=254)
      &&whitePreviewForeground.length===3&&whitePreviewForeground.every(channel=>channel<=1);
    window.termaTerminalViews.selectBackground('#808080');
    const customPreview=document.querySelector('#terminalBackgroundPreview');
    const customPreviewBackground=colorChannels(customPreview.style.background);
    const customPreviewForeground=colorChannels(customPreview.style.color);
    terminalSettingsUi.backgroundPreview=whitePreviewReadable
      &&customPreviewBackground.length===3&&customPreviewBackground.every(channel=>Math.abs(channel-128)<=1)
      &&customPreviewForeground.length===3&&customPreviewForeground.every(channel=>channel<=1)
      && window.termaTerminalViews.selectedBackgroundMode()==='custom';
    terminalSettingsUi.backgroundPreviewMetrics={
      whiteBackground:whitePreviewBackgroundText,
      whiteForeground:whitePreviewForegroundText,
      whiteBackgroundChannels:whitePreviewBackground,
      whiteForegroundChannels:whitePreviewForeground,
      customBackground:customPreview.style.background,
      customForeground:customPreview.style.color,
      customBackgroundChannels:customPreviewBackground,
      customForegroundChannels:customPreviewForeground,
      selectedMode:window.termaTerminalViews.selectedBackgroundMode(),
      pickerValue:document.querySelector('#terminalSettingBackgroundColor')?.value,
      directCustomBackground:window.termaTerminalSettingsModel.theme({background_mode:'custom',background_color:document.querySelector('#terminalSettingBackgroundColor')?.value}).background
    };
    window.termaTerminalViews.closeSettings();
    const secondMount=document.createElement('div');
    secondMount.className='terminal-box';
    document.body.appendChild(secondMount);
    const secondTerm={options:{},rows:24,refresh:()=>{}};
    window.termaTerminalState.terminalSessions.get(key).mount=mount;
    const firstSession=window.termaTerminalState.terminalSessions.get(key);
    firstSession.connection={...firstSession.connection,terminal_font_family_inherit:1,terminal_font_size_inherit:1,terminal_mobile_font_size_inherit:1};
    secondTerm.options.fontFamily='Connection Font';
    secondTerm.options.fontSize=19;
    window.termaTerminalState.terminalSessions.set(secondKey,{term:secondTerm,id:first.id,mount:secondMount,connection:{...first,terminal_font_family:'Connection Font',terminal_font_family_inherit:0,terminal_font_size:19,terminal_font_size_inherit:0,terminal_mobile_font_size:19,terminal_mobile_font_size_inherit:0}});
    terminalGlobalSettings=window.termaTerminalSettingsModel.normalize({...window.termaTerminalSettingsModel.defaults,font_family:'Global Font',font_size:15,background_mode:'custom',background_color:'#808080',word_separators:'-_'});
    window.termaTerminalSettings.applyAll();
    const readablePaletteKeys=['black','red','green','yellow','blue','magenta','cyan','white','brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite'];
    terminalSettingsUi.appliesToAllOpenSessions=fakeTerm.options.wordSeparator==='-_'&&secondTerm.options.wordSeparator==='-_'
      &&fakeTerm.options.theme?.background==='#808080'&&secondTerm.options.theme?.background==='#808080'
      &&fakeTerm.options.theme?.foreground==='#000000'&&secondTerm.options.theme?.foreground==='#000000'
      &&fakeTerm.options.minimumContrastRatio===4.5&&secondTerm.options.minimumContrastRatio===4.5
      &&mount.style.getPropertyValue('--terminal-background')==='#808080'
      &&secondMount.style.getPropertyValue('--terminal-background')==='#808080';
    terminalSettingsUi.fontInheritance=fakeTerm.options.fontFamily==='Global Font'&&fakeTerm.options.fontSize===15
      &&secondTerm.options.fontFamily==='Connection Font'&&secondTerm.options.fontSize===19;
    terminalSettingsUi.readableCustomPalette=readablePaletteKeys.every(name=>window.termaTerminalSettingsModel.contrast(fakeTerm.options.theme[name],fakeTerm.options.theme.background)>=4.5);
    terminalGlobalSettings=window.termaTerminalSettingsModel.normalize({...window.termaTerminalSettingsModel.defaults,background_mode:'theme'});
    applyTheme('dark');
    const followsDark=fakeTerm.options.theme?.background==='#000000'&&fakeTerm.options.theme?.foreground==='#ffffff';
    applyTheme('light');
    terminalSettingsUi.followsTheme=followsDark&&fakeTerm.options.theme?.background==='#ffffff'&&fakeTerm.options.theme?.foreground==='#000000';
    terminalSettingsUi.copyFormatting=window.termaTerminalClipboard.format('one\\t  \\r\\ntwo  ',{...window.termaTerminalSettingsModel.defaults,copy_tabs_to_spaces:true,copy_trim_trailing_spaces:true,copy_include_trailing_newline:false})==='one\\ntwo';
    terminalSettingsUi.singleLinePaste=window.termaTerminalClipboard.singleLine('one\\r\\n two \\n\\nthree')==='one two three';
    const previousRecentCommandStorage=localStorage.getItem('recentTerminalCommands');
    const previousRecentCommandsForPaste=[...window.termaTerminalHistory.list()];
    ((items)=>{window.termaTerminalHistory.clear();[...items].reverse().forEach(window.termaTerminalHistory.save);})([]);
    localStorage.removeItem('recentTerminalCommands');
    terminalGlobalSettings=window.termaTerminalSettingsModel.normalize({...window.termaTerminalSettingsModel.defaults,multiline_paste_mode:'paste'});
    const pasteSession=window.termaTerminalState.terminalSessions.get(key);
    await window.termaTerminalClipboard.send(key,'echo pasted-one\\r\\n');
    const completedPasteRecorded=window.termaTerminalHistory.list()[0]==='echo pasted-one'&&pasteSession.commandBuffer==='';
    await window.termaTerminalClipboard.send(key,'echo pasted-two');
    const incompletePasteBuffered=!window.termaTerminalHistory.list().includes('echo pasted-two')&&pasteSession.commandBuffer==='echo pasted-two';
    fakeInputHandler?.('\\r');
    const bufferedPasteRecordedOnEnter=window.termaTerminalHistory.list()[0]==='echo pasted-two'&&pasteSession.commandBuffer==='';
    await window.termaTerminalClipboard.send(key,'printf first\\nprintf second\\npartial third');
    const multilinePasteUsesPtyReturns=reconnectedFakeSocket.sent.at(-1)==='printf first\\rprintf second\\rpartial third';
    const multilinePasteRecorded=window.termaTerminalHistory.list().includes('printf first')&&window.termaTerminalHistory.list().includes('printf second')&&!window.termaTerminalHistory.list().includes('partial third')&&pasteSession.commandBuffer==='partial third';
    fakeInputHandler?.('\\r');
    const trailingPasteRecordedOnEnter=window.termaTerminalHistory.list()[0]==='partial third';
    pasteSession.sensitiveInput=true;
    await window.termaTerminalClipboard.send(key,'very-secret-command\\r');
    pasteSession.sensitiveInput=false;
    terminalSettingsUi.pasteCommandHistory=Boolean(completedPasteRecorded&&incompletePasteBuffered&&bufferedPasteRecordedOnEnter&&multilinePasteUsesPtyReturns&&multilinePasteRecorded&&trailingPasteRecordedOnEnter&&!window.termaTerminalHistory.list().includes('very-secret-command')&&pasteSession.commandBuffer==='');
    ((items)=>{window.termaTerminalHistory.clear();[...items].reverse().forEach(window.termaTerminalHistory.save);})(previousRecentCommandsForPaste);
    if(previousRecentCommandStorage===null)localStorage.removeItem('recentTerminalCommands');else localStorage.setItem('recentTerminalCommands',previousRecentCommandStorage);
    fakeTerm.buffer.active.getLine=()=>({translateToString:()=> 'open https://example.test/path.',length:32});
    terminalGlobalSettings=window.termaTerminalSettingsModel.normalize({...window.termaTerminalSettingsModel.defaults,url_links_enabled:true,url_prefixes:['https://']});
    let providedLinks;
    fakeLinkProvider?.provideLinks(1,links=>{providedLinks=links;});
    terminalSettingsUi.linkProvider=Boolean(providedLinks?.length===1&&providedLinks[0].text==='https://example.test/path'&&fakeSelectionHandler);
    terminalGlobalSettings=window.termaTerminalSettingsModel.normalize(window.termaTerminalSettingsModel.defaults);
    const pastePromise=window.termaTerminalClipboard.send(key,'first command\\nsecond command');
    await new Promise(resolve=>setTimeout(resolve,0));
    const pasteModal=document.querySelector('#modal .terminal-paste-modal');
    const pasteModalRect=pasteModal?.getBoundingClientRect();
    const pasteEditor=document.querySelector('#terminalPasteEditor');
    const pasteOriginalValue=pasteEditor.value;
    document.querySelector('#modal')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    const pasteBackdropIgnored=Boolean(!document.querySelector('#modal')?.hidden&&pasteEditor.isConnected&&pasteEditor.value===pasteOriginalValue);
    pasteEditor.value='edited command\\nsecond command';
    pasteEditor.dispatchEvent(new Event('input',{bubbles:true}));
    const pasteEditable=Boolean(pasteModal&&pasteEditor&&!pasteEditor.readOnly&&document.activeElement===pasteEditor);
    const pasteSummaryUpdated=document.querySelector('#terminalPasteSummary')?.textContent.includes('2 行');
    document.querySelector('#terminalPasteConfirm')?.click();
    const pasteSent=await pastePromise;
    terminalSettingsUi.editablePaste=Boolean(pasteBackdropIgnored&&pasteEditable&&pasteSummaryUpdated&&pasteModalRect&&pasteModalRect.left>=-0.5&&pasteModalRect.right<=innerWidth+0.5&&pasteModalRect.top>=-0.5&&pasteModalRect.bottom<=innerHeight+0.5&&pasteSent&&reconnectedFakeSocket.sent.at(-1)==='edited command\\rsecond command');
    const mcpPreviousTab = activeTabKey, mcpPreviousSection = window.termaSettingsNavigation.section;
    const mcpPreviousRuntime = window.termaRuntimeSettingsModel.snapshot;
    await window.termaSettingsViews.open();
    const mcpSettingsFixture = $('view-settings');
    const mcpConfig={id:'fixture-edit',name:'Fixture',transport:'streamable-http',url:'https://example.test/mcp',headers:{Authorization:''},
      enabled:true,tools:[{name:'search',description:'Search',inputSchema:{},enabled:true,requires_approval:true}]};
    window.termaRuntimeSettingsModel.snapshot = window.termaRuntimeSettingsModel.normalize({...mcpPreviousRuntime,saved:{...mcpPreviousRuntime?.saved,ai:{mcp_servers:[mcpConfig]}}});
    window.termaSettingsNavigation.show('settings-ai',{moveToWorkspace:false});
    window.termaSettingsViews.render();
    const mcpStdioFieldsVisible=Boolean(!mcpSettingsFixture.querySelector('#terminalAiMcpCommand')?.hidden&&!mcpSettingsFixture.querySelector('#terminalAiMcpArgs')?.hidden&&mcpSettingsFixture.querySelector('#terminalAiMcpUrl')?.hidden&&mcpSettingsFixture.querySelector('#terminalAiMcpHeaders')?.hidden);
    const mcpTransport=mcpSettingsFixture.querySelector('#terminalAiMcpTransport');
    mcpTransport.value='sse';mcpTransport.dispatchEvent(new Event('change',{bubbles:true}));
    await Promise.resolve();
    const mcpSseFieldsVisible=Boolean(mcpSettingsFixture.querySelector('#terminalAiMcpCommand')?.hidden&&mcpSettingsFixture.querySelector('#terminalAiMcpArgs')?.hidden&&!mcpSettingsFixture.querySelector('#terminalAiMcpUrl')?.hidden&&!mcpSettingsFixture.querySelector('#terminalAiMcpHeaders')?.hidden);
    const mcpEdit=mcpSettingsFixture.querySelector('[data-mcp-action="edit"]');
    mcpEdit?.click();await Promise.resolve();
    const mcpToolsCollapsible=Boolean(mcpSettingsFixture.querySelector('details.terminal-ai-mcp-tools')&&!mcpSettingsFixture.querySelector('details.terminal-ai-mcp-tools').open);
    terminalSettingsUi.mcpDiagnostics={stdio:mcpStdioFieldsVisible,sse:mcpSseFieldsVisible,streamableOption:Boolean(mcpTransport.querySelector('option[value="streamable-http"]')),editCancel:Boolean(mcpSettingsFixture.querySelector('[data-mcp-action="cancel"]')),headerPlaceholder:JSON.parse(mcpSettingsFixture.querySelector('#terminalAiMcpHeaders').value||'{}').Authorization==='',editAction:Boolean(mcpEdit),toolsCollapsible:mcpToolsCollapsible};
    terminalSettingsUi.mcp=Object.values(terminalSettingsUi.mcpDiagnostics).every(Boolean);
    mcpSettingsFixture.querySelector('[data-mcp-action="cancel"]')?.click();
    window.termaRuntimeSettingsModel.snapshot = mcpPreviousRuntime;
    window.termaSettingsNavigation.show(mcpPreviousSection,{moveToWorkspace:false});
    if (workspaceTabByKey(mcpPreviousTab)) activateTab(mcpPreviousTab);
    const previousRuntimeSettingsForAi=window.termaRuntimeSettingsModel.snapshot;
    const previousTerminalAiLayout=localStorage.getItem('termaTerminalAiLayout');
    localStorage.removeItem('termaTerminalAiLayout');
    const aiKey='terminal-ai-ui-smoke';
    const aiSurface=document.createElement('div');
    aiSurface.className='terminal-tab-surface';
    aiSurface.style.cssText='position:fixed;left:-10000px;top:0;width:900px;height:480px;display:flex;flex-direction:column;';
    aiSurface.innerHTML='<div class="terminal-toolbar"><div class="actions terminal-actions"><button type="button" class="icon-button terminal-ai-button" aria-pressed="false" data-action="terminal-ai-toggle" data-terminal-ai-key="'+aiKey+'">'+icon('bot')+'</button></div></div><div class="terminal-main-row"><div class="terminal-box"></div>'+window.termaAssistant.placeholder(aiKey)+'</div>';
    document.body.appendChild(aiSurface);
    window.termaRuntimeSettingsModel.snapshot={...window.termaRuntimeSettingsModel.snapshot,ai:{...(window.termaRuntimeSettingsModel.snapshot?.ai||{}),enabled:true,model:'fixture-model',context_tokens:1000000,terminal_ai_placement:'right',terminal_ai_permission:'confirm'},saved:{...(window.termaRuntimeSettingsModel.snapshot?.saved||{}),ai:{...(window.termaRuntimeSettingsModel.snapshot?.saved?.ai||{}),enabled:true,model:'fixture-model',context_tokens:1000000,terminal_ai_placement:'right',terminal_ai_permission:'confirm'}}};
    const aiButton=aiSurface.querySelector('[data-action="terminal-ai-toggle"]');
    const aiPanel=aiSurface.querySelector('.terminal-ai-panel');
    const projectedAiButton=document.createElement('button');
    projectedAiButton.className='terminal-ai-button';
    projectedAiButton.dataset.terminalAiKey=aiKey;
    projectedAiButton.setAttribute('aria-pressed','false');
    document.body.appendChild(projectedAiButton);
    const aiShortcutRendered=Boolean(aiButton?.querySelector('.lucide-bot')&&aiButton?.dataset.terminalAiKey===aiKey);
    aiButton?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const aiMainRow=aiSurface.querySelector('.terminal-main-row');
    const aiPanelRect=aiPanel?.getBoundingClientRect();
    const aiSurfaceRect=aiSurface.getBoundingClientRect();
    const aiPanelOpens=Boolean(aiPanel&&!aiPanel.hidden&&aiPanel.classList.contains('is-open'));
    const aiRightPlacement=Boolean(aiSurface.classList.contains('terminal-ai-right')&&getComputedStyle(aiMainRow).flexDirection==='row'&&aiPanelRect?.width>0);
    const aiPanelLayoutFits=Boolean(aiPanelRect&&aiSurfaceRect&&aiPanelRect.left>=aiSurfaceRect.left-0.5&&aiPanelRect.right<=aiSurfaceRect.right+0.5&&aiPanelRect.top>=aiSurfaceRect.top-0.5&&aiPanelRect.bottom<=aiSurfaceRect.bottom+0.5);
    const aiState=window.termaAssistant.service.state(aiKey);
    aiState.mode='agent';
    window.termaAssistant.paint(aiKey);
    const chatModePreviousTurns=aiState.turns;
    const chatModeSwitched=window.termaAssistant.service.mode(aiKey,'chat');
    const chatModeButtons=aiPanel.querySelectorAll('[data-action="terminal-ai-mode"]');
    const chatModeChatButton=aiPanel.querySelector('[data-terminal-ai-mode="chat"]');
    const chatModeAgentButton=aiPanel.querySelector('[data-terminal-ai-mode="agent"]');
    const chatModeBlocksWrap=aiPanel.querySelector('.terminal-ai-blocks-wrap');
    const chatModePermissionRow=aiPanel.querySelector('[data-terminal-ai-permission-row="'+aiKey+'"]');
    const chatModeTextarea=aiPanel.querySelector('[data-terminal-ai-prompt="'+aiKey+'"]');
    aiState.turns=[{id:'chat-mode-fixture',taskId:'',mode:'chat',prompt:'查看当前终端',answer:'请在终端运行 df -h，运行后把输出发给我，我可以帮你分析。\\n\\n'+String.fromCharCode(96)+'df -h'+String.fromCharCode(96)+'\\n\\n'+String.fromCharCode(96).repeat(3)+'sh\\nuname -a\\n'+String.fromCharCode(96).repeat(3),reasoning:'',model:'fixture-model',usage:null,busy:false,error:''}];
    window.termaAssistant.paint(aiKey);
    const chatModeCodeActions=aiPanel.querySelectorAll('.terminal-ai-response-content [data-action="terminal-ai-execute-command"],.terminal-ai-response-content [data-action="terminal-ai-insert-command"],.terminal-ai-response-content [data-action="terminal-ai-save-snippet"]');
    const chatModeCopyActions=aiPanel.querySelectorAll('.terminal-ai-response-content [data-action="terminal-ai-copy-code"]');
    const chatModeInlineCommandCopy=aiPanel.querySelector('.terminal-ai-response-content [data-action="terminal-ai-copy-code"][data-code="df -h"]');
    const chatModeRelaySanitized=Boolean(!aiPanel.querySelector('.terminal-ai-response-content')?.textContent.includes('把输出发给我')&&aiPanel.querySelector('.terminal-ai-response-content')?.textContent.includes('自动读取最新终端内容'));
    const previousChatSession=window.termaTerminalState.terminalSessions.get(aiKey);
    window.termaTerminalState.terminalSessions.set(aiKey,{key:aiKey,sensitiveInput:false,term:{options:{},getSelection:()=>'',buffer:{active:{length:3,getLine:index=>({translateToString:()=>['root@fixture:~# df -h','Filesystem  Size  Used  Avail  Use%  Mounted on','/dev/test  10G  2G  8G  20%  /'][index]||''})}}}});
    const chatExecutionGuard=await window.termaAssistant.commands.execute(aiKey,'uname -a',{details:true});
    let chatRequestPayload=null;
    await window.termaAssistant.requestWorkflow.submit(aiKey,'当前终端是什么系统？',[],{mode:'chat',agentTask:false,streamRequest:async(payload,handlers)=>{chatRequestPayload=payload;handlers.onDelta?.('只读回答');return {model:'fixture-model',usage:null};}});
    if(previousChatSession)window.termaTerminalState.terminalSessions.set(aiKey,previousChatSession);else window.termaTerminalState.terminalSessions.delete(aiKey);
    const chatModeRendered=Boolean(chatModeSwitched&&chatModeButtons.length===2&&chatModeChatButton?.classList.contains('active')&&chatModeChatButton?.getAttribute('aria-selected')==='true'&&chatModeAgentButton?.getAttribute('aria-selected')==='false'&&chatModeBlocksWrap?.hidden&&chatModePermissionRow?.hidden&&chatModeTextarea?.placeholder.includes('只读')&&chatModeCodeActions.length===0&&chatModeCopyActions.length===2&&chatModeInlineCommandCopy?.dataset.code==='df -h'&&chatModeRelaySanitized&&chatExecutionGuard?.chatMode===true&&chatRequestPayload?.mode==='chat'&&chatRequestPayload?.contexts?.some(item=>item.source==='terminal-screen'&&item.text.includes('df -h')));
    aiState.turns=chatModePreviousTurns;
    window.termaAssistant.service.mode(aiKey,'agent');
    window.termaAssistant.paint(aiKey);
    const planRecoveryKey='terminal-ai-plan-recovery';
    const planRecoveryState=window.termaAssistant.service.state(planRecoveryKey);
    planRecoveryState.mode='agent';
    planRecoveryState.permission='suggest';
    planRecoveryState.open=false;
    let planOnlyRequests=0;
    const planOnlyAnswer='我先检查服务器状态，接下来查看磁盘。';
    await window.termaAssistant.requestWorkflow.submit(planRecoveryKey,'检查服务器磁盘空间',[],{agentTask:true,streamRequest:async(payload,handlers)=>{
      planOnlyRequests+=1;
      handlers.onDelta?.(planOnlyAnswer);
      return {model:'fixture-model',usage:null};
    }});
    const planRecoveryTask=planRecoveryState.agentTasks[0];
    const agentPlanLoopGuard=Boolean(planOnlyRequests===2&&planRecoveryTask?.status==='stopped'&&planRecoveryState.turns.at(-1)?.agentNotice?.includes('操作计划'));
    if(typeof terminalAiStates!=='undefined'&&terminalAiStates instanceof Map)terminalAiStates.delete(planRecoveryKey);
    const aiFullPermissionOption=Boolean(aiPanel.querySelector('[data-change-action="terminal-ai-permission"] option[value="full"]'));
    const aiInlineApprovalSlot=Boolean(aiPanel.querySelector('[data-terminal-ai-approval="'+aiKey+'"]'));
    const aiModelControl=aiPanel.querySelector('[data-change-action="terminal-ai-model"]');
    const aiReasoningControl=aiPanel.querySelector('[data-change-action="terminal-ai-reasoning"]');
    const aiDeepThinkingControl=aiPanel.querySelector('[data-change-action="terminal-ai-deep-thinking"]');
    const aiModelReasoningControlsAvailable=Boolean(aiModelControl&&aiReasoningControl&&aiDeepThinkingControl&&aiPanel.querySelector('.terminal-ai-ai-status')&&['minimal','high','xhigh','max'].every(value=>[...aiReasoningControl.options].some(option=>option.value===value)));
    const aiTrackedOriginalSession=window.termaTerminalState.terminalSessions.get(aiKey);
    const aiBinarySession={key:aiKey,sensitiveInput:false,aiActiveBlockId:'',term:{options:{}}};
    window.termaTerminalState.terminalSessions.set(aiKey,aiBinarySession);
    window.termaAssistant.tracker.captureCommand(aiBinarySession,'ls');
    window.termaAssistant.tracker.captureOutput(aiBinarySession,new TextEncoder().encode('fixture-file\\n'));
    const aiBinaryOutputCaptured=aiState.blocks.some(block=>block.command==='ls'&&block.output.includes('fixture-file'));
    window.termaAssistant.tracker.finalize(aiBinarySession);
    const aiPromptSession={term:{options:{},buffer:{active:{baseY:0,cursorY:0,cursorX:12,getLine:()=>({translateToString:()=> 'root@Test:~#'})}}}};
    const aiTrailingPromptDetected=window.termaTerminalPrompt.terminalPromptStateAtRow(aiPromptSession)?.command==='';
    const aiEmptyOutputSession={key:aiKey,sensitiveInput:false,aiActiveBlockId:'',term:aiPromptSession.term};
    window.termaTerminalState.terminalSessions.set(aiKey,aiEmptyOutputSession);
    window.termaAssistant.tracker.captureCommand(aiEmptyOutputSession,'true');
    const aiEmptyOutputCompletes=window.termaAssistant.tracker.fromScreen(aiEmptyOutputSession);
    const aiRaceLines=['root@Test:~#','root@Test:~#'];
    const aiRaceSession={key:aiKey,sensitiveInput:false,aiActiveBlockId:'',terminalOutputSequence:0,pendingTerminalOutput:[],terminalOutputWriting:false,term:{options:{},buffer:{active:{baseY:0,cursorY:0,cursorX:12,getLine:row=>({translateToString:()=>aiRaceLines[row]||''})}}}};
    window.termaTerminalState.terminalSessions.set(aiKey,aiRaceSession);
    const aiRacePromptBefore=window.termaTerminalPrompt.terminalPromptStateAtRow(aiRaceSession);
    window.termaAssistant.tracker.captureCommand(aiRaceSession,'find /',{agent:true,promptBefore:aiRacePromptBefore,outputSequenceBefore:0,sentAt:Date.now()});
    const aiEarlyCompletionGuard=!window.termaAssistant.tracker.fromScreen(aiRaceSession);
    aiRaceSession.term.buffer.active.baseY=1;
    aiRaceSession.pendingTerminalOutput=['pending'];
    const aiQueueCompletionGuard=!window.termaAssistant.tracker.fromScreen(aiRaceSession);
    aiRaceSession.pendingTerminalOutput=[];
    const aiRaceBlock=aiState.blocks.find(block=>block.id===aiRaceSession.aiActiveBlockId);
    if(aiRaceBlock)aiRaceBlock.completionCandidateAt=Date.now()-500;
    const aiRaceCompletes=window.termaAssistant.tracker.fromScreen(aiRaceSession);
    if(aiTrackedOriginalSession)window.termaTerminalState.terminalSessions.set(aiKey,aiTrackedOriginalSession);else window.termaTerminalState.terminalSessions.delete(aiKey);
    const markdownFence=String.fromCharCode(96).repeat(3);
    const longTableValue='value-'.repeat(80);
    aiState.turns=[{id:'fixture-turn',prompt:'检查当前目录',answer:['**结果**','','| 项目 | 当前值 |','| --- | --- |','| sshd | '+longTableValue+' |','',markdownFence+'shell',"printf '"+longTableValue+"'",markdownFence].join('\\n'),reasoning:'根据已捕获输出整理了只读检查步骤。',model:'fixture-model',usage:{input_tokens:20,output_tokens:30,total_tokens:50},busy:false,error:''}];
    window.termaAssistant.paint(aiKey);
    const aiComposer=aiPanel.querySelector('.terminal-ai-composer');
    const aiComposerRect=aiComposer?.getBoundingClientRect();
    const aiComposeActionsRect=aiPanel.querySelector('.terminal-ai-compose-actions')?.getBoundingClientRect();
    const aiTextarea=aiPanel.querySelector('[data-terminal-ai-prompt]');
    const aiComposerSettings=aiPanel.querySelector('.terminal-ai-composer-settings');
    if(aiComposerSettings)aiComposerSettings.open=true;
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const aiComposerPopoverRect=aiPanel.querySelector('.terminal-ai-composer-popover')?.getBoundingClientRect();
    const aiDeepToggleRect=aiPanel.querySelector('.terminal-ai-deep-toggle')?.getBoundingClientRect();
    const aiSendButton=aiPanel.querySelector('.terminal-ai-send-button');
    const aiComposerControlsMoved=Boolean(aiModelReasoningControlsAvailable
      &&aiComposer?.contains(aiModelControl)
      &&aiComposer?.contains(aiReasoningControl)
      &&aiComposer?.contains(aiDeepThinkingControl)
      &&!aiPanel.querySelector('.terminal-ai-agent-bar')
      &&aiComposerSettings
      &&aiComposerPopoverRect
      &&aiComposerPopoverRect.left>=aiPanelRect.left-0.5
      &&aiComposerPopoverRect.right<=aiPanelRect.right+0.5
      &&aiComposerPopoverRect.top>=aiPanelRect.top-0.5
      &&aiDeepToggleRect
      &&aiDeepToggleRect.bottom<=aiComposerRect.bottom+0.5
      &&aiSendButton?.querySelector('.lucide-arrow-up'));
    if(aiComposerSettings)aiComposerSettings.open=false;
    const aiModelReasoningControls=aiComposerControlsMoved;
    const aiTurns=aiPanel.querySelector('.terminal-ai-turns');
    const aiTableWrap=aiPanel.querySelector('.terminal-ai-table-wrap');
    const aiCodeView=aiPanel.querySelector('.terminal-ai-code');
    const aiMarkdownRendered=Boolean(aiPanel.querySelector('.terminal-ai-response-content strong')&&aiPanel.querySelector('.terminal-ai-table')&&aiPanel.querySelector('.terminal-ai-code-block')&&aiPanel.querySelector('[data-action="terminal-ai-insert-command"]')&&aiPanel.querySelector('.terminal-ai-reasoning'));
    const aiScopedHorizontalScroll=Boolean(aiTurns&&getComputedStyle(aiTurns).overflowX==='hidden'&&aiTableWrap&&getComputedStyle(aiTableWrap).overflowX==='auto'&&aiTableWrap.scrollWidth>aiTableWrap.clientWidth&&aiCodeView&&getComputedStyle(aiCodeView).overflowX==='auto'&&aiCodeView.scrollWidth>aiCodeView.clientWidth);
    const longCodeFence=String.fromCharCode(96).repeat(3);
    const longShellCode=Array.from({length:180},(_,index)=>"printf 'fixture-line-"+String(index).padStart(3,"0")+" %s\\n' '"+String.fromCharCode(120).repeat(70)+"'").join('\\n');
    aiState.turns=[{id:'fixture-long-code',prompt:'执行长脚本',answer:[longCodeFence+'sh',longShellCode,longCodeFence].join('\\n'),reasoning:'',model:'fixture-model',usage:null,busy:false,error:''}];
    window.termaAssistant.paint(aiKey);
    const longCodeView=aiPanel.querySelector('.terminal-ai-code');
    const longCodeActions=aiPanel.querySelector('.terminal-ai-code-actions');
    const longCodeExecute=longCodeActions?.querySelector('[data-action="terminal-ai-execute-command"]');
    const longCodeTurns=aiPanel.querySelector('.terminal-ai-turns');
    const longCodeScrollable=Boolean(longCodeView
      &&longCodeView.scrollHeight>longCodeView.clientHeight
      &&getComputedStyle(longCodeView).overflowY==='auto'
      &&getComputedStyle(longCodeView).maxHeight!=='none');
    if(longCodeTurns)longCodeTurns.scrollTop=longCodeTurns.scrollHeight;
    const longCodeActionsRect=longCodeActions?.getBoundingClientRect();
    const longCodePanelRect=aiPanel.getBoundingClientRect();
    const longCodeExecuteReachable=Boolean(longCodeExecute
      &&longCodeActionsRect
      &&longCodePanelRect
      &&longCodeActionsRect.top>=longCodePanelRect.top-1
      &&longCodeActionsRect.bottom<=longCodePanelRect.bottom+1
      &&longCodeExecute.getBoundingClientRect().bottom<=longCodePanelRect.bottom+1);
    const aiLongCodeActionsReachable=longCodeScrollable&&longCodeExecuteReachable;
    aiState.turns=[{id:'fixture-turn',prompt:'检查当前目录',answer:['**结果**','','| 项目 | 当前值 |','| --- | --- |','| sshd | '+longTableValue+' |','',markdownFence+'shell',"printf '"+longTableValue+"'",markdownFence].join('\\n'),reasoning:'根据已捕获输出整理了只读检查步骤。',model:'fixture-model',usage:{input_tokens:20,output_tokens:30,total_tokens:50},busy:false,error:''}];
    window.termaAssistant.paint(aiKey);
    const enterEvent=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
    aiTextarea.value='';
    aiTextarea.dispatchEvent(enterEvent);
    const shiftEnterEvent=new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true});
    aiTextarea.dispatchEvent(shiftEnterEvent);
    const aiComposerKeyboard=enterEvent.defaultPrevented&&!shiftEnterEvent.defaultPrevented;
    const toolCallFence=String.fromCharCode(96).repeat(3);
    const aiToolCallAnswer='<tool_call><function=terminal><parameter=action>execute</parameter><parameter=command>find / -name "测试2.svg" -type f 2>/dev/null</parameter><parameter=description>查找 SVG 文件</parameter></function></tool_call>';
    const aiToolCallCommands=window.termaAssistant.protocol.terminalAiResponseCommands(aiToolCallAnswer);
    const aiCompatibleToolCalls=[
      '<tool_call><function=exec_command><parameter=command>uname -a</parameter><parameter=timeout>30</parameter></function></tool_call>',
      '<tool_call><function=shell><parameter=command>whoami</parameter></function></tool_call>'
    ];
    const aiCompatibleToolCallCommands=aiCompatibleToolCalls.map(value => window.termaAssistant.protocol.terminalAiResponseCommands(value)[0]);
    const aiCompatibleToolCallRendered=aiCompatibleToolCalls.every(value => window.termaAssistant.markup('renderTerminalAiMarkdown',aiKey,value).includes('terminal-ai-code-block'));
    const aiRejectedToolCalls=[
      '<tool_call><function=delete_everything><parameter=command>rm -rf /tmp/example</parameter></function></tool_call>',
      '<tool_call><function=shell><parameter=action>delete</parameter><parameter=command>whoami</parameter></function></tool_call>',
      '<tool_call><function=exec_command><parameter=timeout>30</parameter></function></tool_call>'
    ];
    const aiCompatibleToolCallRejected=aiRejectedToolCalls.every(value => window.termaAssistant.protocol.terminalAiResponseCommands(value).length===0);
    const aiRejectedToolCallVisible=aiRejectedToolCalls.every(value => /未执行工具调用|Tool call not executed/i.test(window.termaAssistant.markup('renderTerminalAiMarkdown',aiKey,value)));
    aiState.turns=[{id:'fixture-tool-call',prompt:'帮我找一下测试2.svg',answer:aiToolCallAnswer,reasoning:'',model:'fixture-model',usage:null,busy:false,error:''}];
    window.termaAssistant.paint(aiKey);
    const aiToolCallRendered=Boolean(aiToolCallCommands[0]==='find / -name "测试2.svg" -type f 2>/dev/null'&&JSON.stringify(aiCompatibleToolCallCommands)==='["uname -a","whoami"]'&&aiCompatibleToolCallRendered&&aiCompatibleToolCallRejected&&aiRejectedToolCallVisible&&aiPanel.querySelector('.terminal-ai-code-block')&&aiPanel.querySelector('[data-action="terminal-ai-insert-command"]')&&!aiPanel.textContent.includes('<tool_call>')&&!aiPanel.textContent.includes('<function=terminal>'));
    const aiXmlAnswer='我先检查真实系统信息。<command>cat /etc/os-release &amp;&amp; uname -a</command><command>whoami</command>未经终端验证的安全报告';
    const aiXmlCommands=window.termaAssistant.protocol.terminalAiResponseCommands(aiXmlAnswer);
    const aiAnswerThroughFirstCommand=window.termaAssistant.protocol.terminalAiAnswerThroughFirstCommand(aiXmlAnswer);
    aiState.turns=[{id:'fixture-xml-command',prompt:'检查系统',answer:aiAnswerThroughFirstCommand,reasoning:'',model:'fixture-model',usage:null,busy:false,error:''}];
    window.termaAssistant.paint(aiKey);
    const aiXmlCommandRendered=Boolean(aiXmlCommands[0]==='cat /etc/os-release && uname -a'&&aiPanel.querySelector('.terminal-ai-code-block code')?.textContent==='cat /etc/os-release && uname -a'&&!aiPanel.textContent.includes('<command>'));
    const aiStopsAfterFirstCommand=aiAnswerThroughFirstCommand.includes('</command>')&&!aiAnswerThroughFirstCommand.includes('whoami')&&!aiAnswerThroughFirstCommand.includes('安全报告');
    const aiMcpAnswer='我先查询当前资料。<mcp_call server="brave-search" tool="brave_web_search">{"query":"Terma"}</mcp_call>不应提前给结论';
    const aiMcpCalls=window.termaAssistant.protocol.terminalAiResponseMcpCalls(aiMcpAnswer);
    const aiMcpCut=window.termaAssistant.protocol.terminalAiAnswerThroughFirstCommand(aiMcpAnswer);
    const aiMcpApiBefore=window.termaWorkspaceRequest;
    window.termaAssistant.mcp.clear();
    try {
      window.termaWorkspaceRequest=async(pathname,options)=>pathname==='/api/ai/mcp/servers'?{servers:[{id:'web-fetch',name:'Web Fetch',enabled:true,tools:[{name:'tavily_search',description:'Search the web',inputSchema:{type:'object',properties:{query:{type:'string'}}},enabled:true,requires_approval:false}]}]}:aiMcpApiBefore(pathname,options);
      await window.termaAssistant.mcp.catalog();
    } finally { window.termaWorkspaceRequest=aiMcpApiBefore; }
    const aiGenericMcpAnswer='<tool_call><function>tavily_search><parameter=query>Terma company what is</parameter></tool_call>';
    const aiGenericMcpCalls=window.termaAssistant.protocol.terminalAiResponseMcpCalls(aiGenericMcpAnswer);
    const aiGenericMcpRendered=!window.termaAssistant.markup('renderTerminalAiMarkdown',aiKey,aiGenericMcpAnswer).includes('<tool_call>')&&!window.termaAssistant.markup('renderTerminalAiMarkdown',aiKey,aiGenericMcpAnswer).includes('<function');
    const aiJsonMcpAnswer='<tool_call>{"name":"mcp_call","arguments":{"server":"web-fetch.tavily_search","tool":"search","query":"Terma software what is it"}}</tool_call>';
    const aiJsonMcpCalls=window.termaAssistant.protocol.terminalAiResponseMcpCalls(aiJsonMcpAnswer);
    const aiJsonMcpRendered=!window.termaAssistant.markup('renderTerminalAiMarkdown',aiKey,aiJsonMcpAnswer).includes('<tool_call>')&&!window.termaAssistant.markup('renderTerminalAiMarkdown',aiKey,aiJsonMcpAnswer).includes('<function');
    const aiMcpMarkerAnswer=[markdownFence+'xml','**MCP · web-fetch / tavily_search**',markdownFence].join('\\n');
    const aiMcpMarkerCalls=window.termaAssistant.protocol.terminalAiResponseMcpCalls(aiMcpMarkerAnswer);
    const aiMcpMarkerResults=window.termaAssistant.markup('terminalAiTaskMcpResults',[{answer:aiMcpMarkerAnswer,agentResults:[]}]);
    const aiMcpMarkerWithReal=window.termaAssistant.markup('terminalAiTaskMcpResults',[{answer:aiMcpMarkerAnswer,agentResults:[{kind:'mcp',server:'web-fetch',tool:'tavily_search',arguments:{query:'Terma'},output:'fixture result',status:'已完成'}]}]);
    const aiMcpMarkerNormalized=window.termaAssistant.protocol.terminalAiNormalizeToolCalls(aiMcpMarkerAnswer);
    window.termaAssistant.mcp.clear();
    aiState.turns=[{id:'fixture-mcp-call',prompt:'搜索 Terma',answer:aiMcpCut,reasoning:'',model:'fixture-model',usage:null,busy:false,error:''}];
    window.termaAssistant.paint(aiKey);
    const aiMcpInlineAnswer='开始查询 <mcp_call server="web-fetch" tool="tavily_search">{"query":"Terma"}</mcp_call> 查询完成';
    const aiMcpInlineEntries=[{kind:'mcp',server:'web-fetch',tool:'tavily_search',arguments:{query:'Terma'},output:'fixture inline result',status:'已完成'}];
    const aiMcpInlineRendered=window.termaAssistant.markup('terminalAiRenderAnswerWithMcp',aiKey,aiMcpInlineAnswer,aiMcpInlineEntries,new Set());
    const aiMcpInlineCardIndex=aiMcpInlineRendered.indexOf('terminal-ai-mcp-result-card');
    const aiMcpInlineBefore=aiMcpInlineRendered.indexOf('开始查询');
    const aiMcpInlineAfter=aiMcpInlineRendered.indexOf('查询完成');
    const aiMcpCallRendered=Boolean(aiMcpCalls.length===1&&aiMcpCalls[0].server==='brave-search'&&aiMcpCalls[0].tool==='brave_web_search'&&aiGenericMcpCalls.length===1&&aiGenericMcpCalls[0].server==='web-fetch'&&aiGenericMcpCalls[0].tool==='tavily_search'&&aiGenericMcpCalls[0].arguments.query==='Terma company what is'&&aiGenericMcpRendered&&aiJsonMcpCalls.length===1&&aiJsonMcpCalls[0].server==='web-fetch'&&aiJsonMcpCalls[0].tool==='tavily_search'&&JSON.stringify(aiJsonMcpCalls[0].arguments)==='{"query":"Terma software what is it"}'&&aiJsonMcpRendered&&aiMcpMarkerCalls.length===0&&aiMcpMarkerResults.length===1&&aiMcpMarkerWithReal.length===1&&aiMcpMarkerWithReal[0].output==='fixture result'&&!aiMcpMarkerNormalized.includes('MCP')&&!aiMcpMarkerNormalized.includes('xml')&&aiPanel.querySelector('.terminal-ai-mcp-result-card')&&!aiPanel.textContent.includes('<mcp_call')&&!aiMcpCut.includes('不应提前给结论')&&aiMcpInlineBefore>=0&&aiMcpInlineCardIndex>aiMcpInlineBefore&&aiMcpInlineCardIndex<aiMcpInlineAfter);
    const aiMultiCommandQueue=JSON.stringify(window.termaAssistant.protocol.terminalAiResponseCommands([markdownFence+'shell','uname -a','whoami',markdownFence,markdownFence+'shell','hostname',markdownFence].join('\\n')))==='["uname -a","whoami","hostname"]'
      &&JSON.stringify(window.termaAssistant.protocol.terminalAiResponseCommands([markdownFence+'shell','ls /etc 2>/dev/null && echo ready && hostname',markdownFence].join('\\n')))==='["ls /etc 2>/dev/null && echo ready && hostname"]';
    const escapedFence=markdownFence.split('').map(char=>String.fromCharCode(92)+char).join('');
    const escapedMarkdownAnswer=['检查结果','1'+String.fromCharCode(92)+'. 已确认',escapedFence+'sh','printf '+String.fromCharCode(39)+'%s\\\\n'+String.fromCharCode(39)+' ok',escapedFence].join(String.fromCharCode(10));
    const escapedMarkdownHtml=window.termaAssistant.markup('renderTerminalAiMarkdown',aiKey,escapedMarkdownAnswer);
    const aiEscapedMarkdown=Boolean(window.termaAssistant.protocol.terminalAiResponseCommands(escapedMarkdownAnswer).length===1&&window.termaAssistant.protocol.terminalAiResponseCommands(escapedMarkdownAnswer)[0].includes("printf")&&escapedMarkdownHtml.includes('terminal-ai-code-block')&&escapedMarkdownHtml.includes('<ol>')&&!escapedMarkdownHtml.includes(String.fromCharCode(96)));
    const multilineScriptAnswer=[markdownFence+'sh','printf first','if true; then','printf second','fi',markdownFence].join(String.fromCharCode(10));
    const aiMultilineScriptCommands=window.termaAssistant.protocol.terminalAiResponseCommands(multilineScriptAnswer);
    const aiMultilineScript=Boolean(aiMultilineScriptCommands.length===1&&aiMultilineScriptCommands[0].includes('if true; then')&&aiMultilineScriptCommands[0].includes('printf second'));
    const aiIncompleteCommandRecovery=window.termaAssistant.protocol.terminalAiResponseCommands(['我先检查系统。',markdownFence+'shell','cat /etc/os-release 2>/dev/null'].join('\\n'),{allowIncomplete:true})[0]==='cat /etc/os-release 2>/dev/null'
      &&window.termaAssistant.protocol.terminalAiResponseCommands(['我先检查系统。',markdownFence+'shell','cat /etc/os-release 2>/'].join('\\n'),{allowIncomplete:true}).length===0
      &&window.termaAssistant.protocol.terminalAiCompleteRecoveredCommandAnswer(['我先检查系统。',markdownFence+'shell','uname -a'].join('\\n'),'uname -a').endsWith(markdownFence);
    window.termaAssistant.layout.update(aiKey,{mode:'floating',width:520,minimized:false});
    const aiFloatingLayout=window.termaAssistant.layout.settings();
    const aiFloatingPersisted=Boolean(aiFloatingLayout.mode==='floating'&&aiFloatingLayout.width===520&&aiPanel.classList.contains('terminal-ai-layout-floating')&&aiPanel.style.getPropertyValue('--terminal-ai-width')==='520px');
    window.termaAssistant.layout.update(aiKey,{mode:'floating',width:520,height:620,left:innerWidth+900,top:innerHeight+900});
    window.termaAssistant.layout.resize();
    const aiClampedLayout=window.termaAssistant.layout.settings();
    const aiFloatingViewportClamped=Boolean(aiClampedLayout.left<=Math.max(0,innerWidth-aiClampedLayout.width)&&aiClampedLayout.top<=Math.max(0,innerHeight-aiClampedLayout.height)&&aiClampedLayout.left>=0&&aiClampedLayout.top>=0);
    const aiTurnsBeforeDrag=aiState.turns;
    const aiBusyBeforeDrag=aiState.busy;
    aiState.turns=[{id:'fixture-drag-scroll',prompt:'拖动面板时保持顶部',answer:Array.from({length:90},(_,index)=>'line '+index).join(String.fromCharCode(10)),reasoning:'',model:'fixture-model',usage:null,busy:true,error:''}];
    aiState.busy=true;
    window.termaAssistant.layout.update(aiKey,{mode:'floating',width:520,height:620,left:0,top:0,minimized:false});
    const aiDragTurns=aiPanel.querySelector('.terminal-ai-turns');
    if (aiDragTurns) aiDragTurns.scrollTop=0;
    const aiDragHead=aiPanel.querySelector('.terminal-ai-head');
    const aiDragRect=aiPanel.getBoundingClientRect();
    window.termaAssistant.layout.begin({target:aiDragHead,clientX:aiDragRect.left+20,clientY:aiDragRect.top+20,preventDefault(){},stopPropagation(){}},'drag');
    window.termaAssistant.layout.move({clientX:aiDragRect.left+44,clientY:aiDragRect.top+24,preventDefault(){}});
    window.termaAssistant.layout.end();
    const aiDragTurnsAfter=aiPanel.querySelector('.terminal-ai-turns');
    const aiDragScrollPreserved=Boolean(aiDragTurnsAfter&&aiDragTurnsAfter.scrollHeight>aiDragTurnsAfter.clientHeight&&aiDragTurnsAfter.scrollTop===0);
    aiState.turns=aiTurnsBeforeDrag;
    aiState.busy=aiBusyBeforeDrag;
    window.termaAssistant.layout.update(aiKey,{mode:'floating',width:520,height:620,left:0,top:0,minimized:false});
    const aiModalStackPromise=confirmModal('确认层级测试','启用完全访问','继续','取消');
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const aiModal=document.querySelector('#modal');
    const aiModalCard=aiModal?.querySelector('.modal-card');
    const aiModalCardRect=aiModalCard?.getBoundingClientRect();
    const aiModalAboveFloating=Boolean(aiModal&&!aiModal.hidden&&Number(getComputedStyle(aiModal).zIndex)>Number(getComputedStyle(aiPanel).zIndex)&&aiModalCardRect&&aiModalCardRect.top>=-0.5&&aiModalCardRect.bottom<=innerHeight+0.5);
    aiModal?.querySelector('button[data-choice="1"]')?.click();
    await aiModalStackPromise;
    const floatingRect=aiPanel.getBoundingClientRect();
    const floatingResizer=aiPanel.querySelector('.terminal-ai-floating-resizer');
    window.termaAssistant.layout.begin({target:floatingResizer,clientX:floatingRect.right,clientY:floatingRect.bottom,preventDefault(){},stopPropagation(){}},'floating-resize');
    window.termaAssistant.layout.move({clientX:floatingRect.right+36,clientY:floatingRect.bottom+24,preventDefault(){}});
    window.termaAssistant.layout.end();
    const aiFloatingResizeDebug={before:{width:floatingRect.width,height:floatingRect.height,right:floatingRect.right,bottom:floatingRect.bottom},after:window.termaAssistant.layout.settings()};
    const aiFloatingResizeDirection=aiFloatingResizeDebug.after.width===556
      &&aiFloatingResizeDebug.after.height>floatingRect.height
      &&aiPanel.getBoundingClientRect().bottom<=innerHeight+1;
    window.termaAssistant.layout.update(aiKey,{minimized:true});
    const aiFloatingMinimized=aiPanel.classList.contains('terminal-ai-layout-floating')&&aiPanel.classList.contains('is-minimized');
    window.termaAssistant.layout.update(aiKey,{mode:'fixed',width:430,minimized:true});
    const fixedMinimizedRect=aiPanel.getBoundingClientRect();
    const mainRowRect=aiMainRow.getBoundingClientRect();
    const aiFixedMinimized=Boolean(aiPanel.classList.contains('terminal-ai-layout-fixed')&&aiPanel.classList.contains('is-minimized')&&fixedMinimizedRect.width<=45&&fixedMinimizedRect.height>=mainRowRect.height-1);
    window.termaAssistant.layout.update(aiKey,{minimized:false});
    const fixedRect=aiPanel.getBoundingClientRect();
    const fixedResizer=aiPanel.querySelector('.terminal-ai-fixed-resizer');
    window.termaAssistant.layout.begin({target:fixedResizer,clientX:fixedRect.left,clientY:fixedRect.top,preventDefault(){},stopPropagation(){}},'fixed-resize');
    window.termaAssistant.layout.move({clientX:fixedRect.left-35,clientY:fixedRect.top,preventDefault(){}});
    window.termaAssistant.layout.end();
    const aiFixedBoundaryResize=window.termaAssistant.layout.settings().width===465;
    const aiLayoutRestored=window.termaAssistant.layout.settings().minimized===false&&!aiPanel.classList.contains('is-minimized')&&aiPanel.style.getPropertyValue('--terminal-ai-width')==='465px';
    const aiComposerFits=Boolean(aiTextarea&&!aiTextarea.disabled&&aiComposerRect&&aiComposeActionsRect&&aiPanelRect&&aiComposerRect.left>=aiPanelRect.left-0.5&&aiComposerRect.right<=aiPanelRect.right+0.5&&aiComposerRect.bottom<=aiPanelRect.bottom+0.5&&aiComposeActionsRect.bottom<=aiPanelRect.bottom+0.5);
    const aiActiveState=aiButton?.getAttribute('aria-pressed')==='true'&&aiButton.classList.contains('active');
    const aiProjectedActiveState=projectedAiButton.getAttribute('aria-pressed')==='true'&&projectedAiButton.classList.contains('active');
    const aiControlledAllowsLowSensitivity=['pwd','ls -la','git status --short --branch'].every(command=>window.termaAssistant.protocol.terminalAiCommandRisk(command).safe);
    const aiControlledFindAllowed=window.termaAssistant.protocol.terminalAiCommandRisk('find / -name "测试2.svg" -type f 2>/dev/null').safe;
    const aiControlledConfirmsSensitive=['cat ~/.ssh/id_rsa','env','grep token .env','Get-Content $HOME/.ssh/id_rsa'].every(command=>!window.termaAssistant.protocol.terminalAiCommandRisk(command).safe);
    const aiExplicitFileReadAllowed=window.termaAssistant.protocol.terminalAiCommandRisk('cat 日志.txt',{userPrompt:'帮我看一下日志.txt内容'}).safe
      &&window.termaAssistant.protocol.terminalAiCommandRisk('head -n 20 "应用 日志.txt"',{userPrompt:'检查应用 日志.txt'}).safe
      &&window.termaAssistant.protocol.terminalAiCommandRisk('Get-Content -LiteralPath C:\\\\logs\\\\app.log -Tail 50',{userPrompt:'分析 C:\\\\logs\\\\app.log'}).safe;
    const aiUnrequestedFileReadAllowed=window.termaAssistant.protocol.terminalAiCommandRisk('cat 其他.txt',{userPrompt:'帮我看一下日志.txt内容'}).safe;
    const aiPathBoundaryAllowed=window.termaAssistant.protocol.terminalAiCommandRisk('cat foo.txt',{userPrompt:'帮我看一下 foo.txt.bak'}).safe;
    const aiSensitivePathUsesSensitiveRisk=window.termaAssistant.protocol.terminalAiCommandRisk('cat ~/.ssh/id_rsa',{userPrompt:'读取 ~/.ssh/id_rsa'}).reason===tr('terminal:ai.risk_sensitive');
    const aiAgentSent=[];
    const aiAgentPayloads=[];
    let aiAgentLoop=false;
    aiState.permission='controlled';
    aiState.blocks=[];
    aiState.turns=[];
    const aiAgentStream=async(payload,handlers={})=>{
      aiAgentPayloads.push(payload);
      const answer=aiAgentPayloads.length===1
        ? '我先检查用户指定的日志文件。'
        : aiAgentPayloads.length===2
          ? ['现在读取真实内容。',markdownFence+'shell','cat 日志.txt',markdownFence].join('\\n')
          : '**结论**：日志内容已读取并完成分析。';
      handlers.onDelta?.(answer);
      return {model:'fixture-model',usage:{input_tokens:10,output_tokens:10,total_tokens:20}};
    };
    const aiAgentExecute=async(_sentKey,command)=>{
      aiAgentSent.push(command);
      const block={id:window.termaTerminalIdentity.createTerminalLogId(),command,output:'',startedAt:Date.now(),completedAt:0};
      aiState.blocks.push(block);
      setTimeout(()=>{
        block.output='第一行日志\\n第二行日志\\n';
        block.completedAt=Date.now();
      },10);
      return {sent:true,blockId:block.id,command};
    };
    const aiExecuteBefore=window.termaAssistant.commands.execute;
    const aiAgentSessionBefore=window.termaTerminalState.terminalSessions.get(aiKey);
    try {
      window.termaTerminalState.terminalSessions.set(aiKey,{key:aiKey,sensitiveInput:false,connectionAttempt:1,socket:{readyState:1},term:{options:{}}});
      window.termaAssistant.commands.execute=aiAgentExecute;
      await window.termaAssistant.requestWorkflow.submit(aiKey,'帮我看一下日志.txt内容',[],{agentTask:true,streamRequest:aiAgentStream});
    } finally {
      window.termaAssistant.commands.execute=aiExecuteBefore;
      if(aiAgentSessionBefore)window.termaTerminalState.terminalSessions.set(aiKey,aiAgentSessionBefore);else window.termaTerminalState.terminalSessions.delete(aiKey);
    }
    aiAgentLoop=aiAgentSent.length===1&&aiAgentSent[0]==='cat 日志.txt'
      &&aiAgentPayloads.length===3
      &&aiAgentPayloads[2].contexts?.[0]?.text.includes('第二行日志')
      &&aiState.turns.at(-1)?.agentContinuation===true
      &&aiState.turns.at(-1)?.answer.includes('完成分析')
      &&aiState.busy===false;
    window.termaAssistant.paint(aiKey);
    const aiAgentGroupedReply=Boolean(aiPanel.querySelectorAll('.terminal-ai-task').length===1&&aiPanel.querySelectorAll('.terminal-ai-assistant-message').length===1&&aiPanel.querySelectorAll('.terminal-ai-response-phase').length===3&&aiPanel.textContent.includes('我先检查用户指定的日志文件')&&aiPanel.textContent.includes('cat 日志.txt')&&aiPanel.textContent.includes('完成分析'));
    const aiAgentActionRecovery=Boolean(aiAgentPayloads[1]?.message?.includes('没有给出终端操作或完整结论'));
    const aiInternalCutIsNotUserStop=Boolean(aiState.turns[1]?.streamCutForCommand===true&&Array.isArray(aiAgentPayloads[2]?.history)&&aiAgentPayloads[2].history.length===0);
    const aiFullSent=[];
    const aiFullPayloads=[];
    let aiFullAccessLoop=false;
    try {
    aiState.permission='full';
    aiState.blocks=[];
    aiState.turns=[];
    const aiFullStream=async(payload,handlers={})=>{
      aiFullPayloads.push(payload);
      const step=aiFullPayloads.length;
      const answer=step===1
        ? [markdownFence+'shell','printf first',markdownFence].join('\\n')
        : step===2
          ? [markdownFence+'shell','false',markdownFence].join('\\n')
          : step===3
            ? [markdownFence+'shell','printf third',markdownFence].join('\\n')
            : '**结论**：三步任务已完成，第二步失败后已继续分析。';
      handlers.onDelta?.(answer);
      return {model:'fixture-model',usage:{input_tokens:8,output_tokens:8,total_tokens:16}};
    };
    const aiFullExecute=async(_sentKey,command)=>{
      aiFullSent.push(command);
      const block={id:window.termaTerminalIdentity.createTerminalLogId(),command,output:'',startedAt:Date.now(),completedAt:0,exitCode:0};
      aiState.blocks.push(block);
      setTimeout(()=>{
        block.output=command==='false'?'失败输出\\n':command+' 输出\\n';
        block.exitCode=command==='false'?1:0;
        block.completedAt=Date.now();
      },5);
      return {sent:true,blockId:block.id,command};
    };
    try {
      window.termaTerminalState.terminalSessions.set(aiKey,{key:aiKey,sensitiveInput:false,connectionAttempt:1,socket:{readyState:1},term:{options:{}}});
      window.termaAssistant.commands.execute=aiFullExecute;
      await window.termaAssistant.requestWorkflow.submit(aiKey,'连续执行并在失败后继续',[],{agentTask:true,streamRequest:aiFullStream});
    } finally {
      window.termaAssistant.commands.execute=aiExecuteBefore;
      if(aiAgentSessionBefore)window.termaTerminalState.terminalSessions.set(aiKey,aiAgentSessionBefore);else window.termaTerminalState.terminalSessions.delete(aiKey);
    }
    aiFullAccessLoop=aiFullSent.join('|')==='printf first|false|printf third'
      &&aiFullPayloads.length===4
      &&aiFullPayloads[2].contexts?.[0]?.text.includes('失败输出')
      &&aiState.turns.at(-1)?.answer.includes('第二步失败后已继续')
      &&aiState.busy===false;
    aiState.permission='confirm';
    } catch (error) {
      console.error('Full access Agent smoke error:', error?.stack || error);
    }
    const aiSearchApiBefore=window.termaWorkspaceRequest;
    window.termaAssistant.mcp.clear();
    const aiSearchEvents=[];
    const aiSearchQueries=[];
    const aiSearchTools=[];
    const aiSearchPayloads=[];
    const aiSearchPrompt='你在网上搜索一下Terma看看是什么东西';
    try {
      window.termaRuntimeSettingsModel.snapshot={...window.termaRuntimeSettingsModel.snapshot,saved:{...(window.termaRuntimeSettingsModel.snapshot?.saved||{}),ai:{...(window.termaRuntimeSettingsModel.snapshot?.saved?.ai||{}),enabled:true,model:'fixture-model',terminal_ai_permission:'full',mcp_servers:[{id:'web-fetch',name:'Web Fetch',transport:'streamable-http',url:'https://example.test/mcp',enabled:true,tools:[{name:'tavily_search',description:'Search the web',inputSchema:{type:'object',properties:{query:{type:'string'}}},enabled:true,requires_approval:false},{name:'tavily_extract',description:'Extract a web page',inputSchema:{type:'object',properties:{urls:{type:'array',items:{type:'string'}},query:{type:'string'}},required:['urls']},enabled:true,requires_approval:false}]}]}}};
      window.termaWorkspaceRequest=async(pathname,options={})=>{
        if(pathname==='/api/ai/mcp/servers')return {servers:window.termaRuntimeSettingsModel.snapshot.saved.ai.mcp_servers};
        if(pathname==='/api/ai/mcp/call'){
          aiSearchEvents.push('mcp');
          const body=JSON.parse(options.body||'{}');
          aiSearchTools.push(body.tool||'');
          aiSearchQueries.push(JSON.stringify(body.arguments||{}));
          return {content:[{type:'text',text:'Terma 是跨平台终端与远程管理工具。Source: https://example.test/terma'}],query:body.arguments?.query};
        }
        return aiSearchApiBefore(pathname,options);
      };
      aiState.permission='full';
      aiState.turns=[{id:'old-audit',taskId:'old-task',prompt:'检查 Linux 安全加固',answer:'auditd 已启用。',reasoning:'',model:'fixture-model',usage:null,busy:false,error:'',agentContinuation:false}];
      const aiSearchStream=async(payload,handlers={})=>{
        aiSearchEvents.push('model');
        aiSearchPayloads.push(payload);
        handlers.onDelta?.('**Terma** 是一个跨平台终端与远程管理工具。来源：https://example.test/terma');
        return {model:'fixture-model',usage:{input_tokens:20,output_tokens:12,total_tokens:32}};
      };
      await window.termaAssistant.requestWorkflow.submit(aiKey,aiSearchPrompt,[{source:'terminal-block',title:'旧审计命令',text:'$ auditctl -l\\n旧 Linux 审计输出'}],{agentTask:true,streamRequest:aiSearchStream});
    } finally {
      window.termaWorkspaceRequest=aiSearchApiBefore;
      window.termaAssistant.mcp.clear();
    }
    const aiSearchPayload=aiSearchPayloads[0];
    const aiSearchGroups=window.termaAssistant.markup('terminalAiTaskGroups',aiState.turns);
    const aiSearchTaskSwitch=Boolean(aiSearchEvents.join('|')==='mcp|model'
      &&aiSearchPayloads.length===1
      &&aiSearchTools[0]==='tavily_search'
      &&aiSearchQueries[0].includes('zmide/Terma')
      &&aiSearchPayload.message.includes(aiSearchPrompt)
      &&Array.isArray(aiSearchPayload.history)&&aiSearchPayload.history.length===0
      &&aiSearchPayload.contexts.some(item=>item.source==='mcp-output'&&item.text.includes('跨平台终端'))
      &&aiSearchPayload.contexts.some(item=>item.source==='application-identity'&&item.text.includes('github.com/zmide/Terma'))
      &&!aiSearchPayload.contexts.some(item=>item.source==='terminal-block')
      &&aiSearchGroups.at(-1)?.root?.prompt===aiSearchPrompt
      &&aiState.turns.at(-1)?.answer.includes('跨平台终端'));
    const aiHistorySessionBefore=aiState.sessionId;
    window.termaAssistant.service.persist(aiKey,aiState);
    window.termaAssistant.service.newSession(aiKey);
    const aiHistorySupported=aiState.sessionId!==aiHistorySessionBefore&&window.termaAssistant.service.list(aiKey).some(item=>item.id===aiHistorySessionBefore);
    window.termaAssistant.service.persist(aiKey,aiState);
    terminalSettingsUi.connectionStageTabSwitch=connectionStageTabSwitch;
    terminalSettingsUi.ai={shortcutRendered:aiShortcutRendered,panelOpens:aiPanelOpens,rightPlacement:aiRightPlacement,panelLayoutFits:aiPanelLayoutFits,composerFits:aiComposerFits,composerKeyboard:aiComposerKeyboard,markdownRendered:aiMarkdownRendered,scopedHorizontalScroll:aiScopedHorizontalScroll,longCodeActionsReachable:aiLongCodeActionsReachable,toolCallRendered:aiToolCallRendered,mcpCallRendered:aiMcpCallRendered,xmlCommandRendered:aiXmlCommandRendered,stopsAfterFirstCommand:aiStopsAfterFirstCommand,fullPermissionOption:aiFullPermissionOption,inlineApprovalSlot:aiInlineApprovalSlot,modelReasoningControls:aiModelReasoningControls,multiCommandQueue:aiMultiCommandQueue,chatMode:chatModeRendered,agentPlanLoopGuard,escapedMarkdown:aiEscapedMarkdown,multilineScript:aiMultilineScript,incompleteCommandRecovery:aiIncompleteCommandRecovery,floatingPersisted:aiFloatingPersisted,floatingViewportClamped:aiFloatingViewportClamped,dragScrollPreserved:aiDragScrollPreserved,modalAboveFloating:aiModalAboveFloating,floatingResizeDirection:aiFloatingResizeDirection,floatingMinimized:aiFloatingMinimized,fixedMinimized:aiFixedMinimized,fixedBoundaryResize:aiFixedBoundaryResize,layoutRestored:aiLayoutRestored,activeState:aiActiveState,projectedActiveState:aiProjectedActiveState,binaryOutputCaptured:aiBinaryOutputCaptured,trailingPromptDetected:aiTrailingPromptDetected,emptyOutputCompletes:aiEmptyOutputCompletes,controlledAllowsLowSensitivity:aiControlledAllowsLowSensitivity,controlledFindAllowed:aiControlledFindAllowed,controlledConfirmsSensitive:aiControlledConfirmsSensitive,explicitFileReadAllowed:aiExplicitFileReadAllowed,unrequestedFileReadAllowed:aiUnrequestedFileReadAllowed,pathBoundaryAllowed:aiPathBoundaryAllowed,sensitivePathUsesSensitiveRisk:aiSensitivePathUsesSensitiveRisk,agentLoop:aiAgentLoop,fullAccessAgentLoop:aiFullAccessLoop,agentGroupedReply:aiAgentGroupedReply,agentActionRecovery:aiAgentActionRecovery,searchTaskSwitch:aiSearchTaskSwitch,internalCutIsNotUserStop:aiInternalCutIsNotUserStop,historySupported:aiHistorySupported};
    Object.assign(terminalSettingsUi.ai||{}, {earlyCompletionGuard:aiEarlyCompletionGuard,queueCompletionGuard:aiQueueCompletionGuard,raceCompletes:aiRaceCompletes});
    try { localStorage.removeItem('termaTerminalAiSessions:'+aiKey); } catch {}
    aiButton?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    projectedAiButton.remove();
    aiSurface.remove();
    window.termaAssistant.release(aiKey);
    window.termaTerminalState.terminalSessions.delete(aiKey);
    if(previousTerminalAiLayout===null)localStorage.removeItem('termaTerminalAiLayout');else localStorage.setItem('termaTerminalAiLayout',previousTerminalAiLayout);
    window.termaRuntimeSettingsModel.snapshot=previousRuntimeSettingsForAi;
    const toolbarFixture=document.createElement('div');
    toolbarFixture.className='terminal-toolbar';
    toolbarFixture.style.width='100%';
    toolbarFixture.innerHTML='<div class="terminal-title-row"><span class="terminal-connection-dot"></span><span class="terminal-status">tester@example.invalid:22 · 已连接</span><span class="terminal-session-badge normal">普通 Shell</span></div><div class="actions terminal-actions"><button class="icon-button">'+icon('folder-open')+'<span>SFTP</span></button><button class="icon-button">'+icon('minus')+'</button><button class="icon-button">'+icon('plus')+'</button><button class="terminal-dropdown-button terminal-action-encoding">'+icon('earth')+'<span>UTF-8</span>'+icon('chevron-down')+'</button><button class="terminal-dropdown-button">'+icon('type')+'<span>字体</span>'+icon('chevron-down')+'</button><button class="icon-button terminal-startup-button">'+icon('command')+'<span>配置</span></button><button class="icon-button terminal-x11-button">'+icon('x11')+'</button><button class="icon-button terminal-global-settings-button">'+icon('settings')+'</button><button class="terminal-action-keys">'+icon('keyboard')+'<span>快捷键</span></button><button>'+icon('history')+'<span>最近命令</span></button><button>'+icon('link-2')+'<span>重连</span></button><button class="terminal-action-forward-list">'+icon('route')+'<span>转发列表</span></button></div>';
    const toolbarViewFixture=document.createElement('div');
    toolbarViewFixture.style.width='540px';
    toolbarViewFixture.style.containerType='inline-size';
    toolbarViewFixture.style.containerName='terminal-view';
    toolbarViewFixture.appendChild(toolbarFixture);
    document.body.appendChild(toolbarViewFixture);
    const toolbar=toolbarFixture.querySelector('.terminal-actions');
    const toolbarRect=toolbar.getBoundingClientRect();
    const toolbarButtons=[...toolbar.querySelectorAll('button')];
    const terminalToolbarIconSet=Boolean(
      toolbar.querySelector('.terminal-action-encoding .lucide-earth')
      && toolbar.querySelector('.terminal-x11-button .x11-icon b')?.textContent==='X11'
      && toolbar.querySelector('.terminal-action-forward-list .lucide-route')
    );
    const desktopKeysHidden=getComputedStyle(toolbarFixture.querySelector('.terminal-action-keys')).display==='none';
    const visibleToolbarButtons=toolbarButtons.filter(button=>getComputedStyle(button).display!=='none');
    const encodingButton=toolbarFixture.querySelector('.terminal-action-encoding');
    const encodingLabelVisible=Boolean(
      encodingButton
      && encodingButton.querySelector('span')?.textContent==='UTF-8'
      && getComputedStyle(encodingButton.querySelector('span')).display!=='none'
      && encodingButton.getBoundingClientRect().width>=92
    );
    const compactLabelsHidden=toolbarButtons.filter(button=>button!==encodingButton)
      .flatMap(button=>[...button.querySelectorAll(':scope > span:not(.composite-icon)')])
      .every(span=>getComputedStyle(span).display==='none');
    const compactActionsLeftAligned=Math.abs(toolbarButtons[0].getBoundingClientRect().left-toolbarRect.left)<1;
    const narrowToolbarFits=compactLabelsHidden&&visibleToolbarButtons.every(button=>{
      const rect=button.getBoundingClientRect();
      return rect.left>=toolbarRect.left-0.5&&rect.right<=toolbarRect.right+0.5;
    });
    const compactStartupButton=toolbarFixture.querySelector('.terminal-startup-button');
    const compactStartupRect=compactStartupButton.getBoundingClientRect();
    const compactStartupLabel=compactStartupButton.querySelector('span');
    const startupCompactIconOnly=getComputedStyle(compactStartupLabel).display==='none'
      && Math.abs(compactStartupRect.width-30)<=0.5
      && Math.abs(compactStartupRect.height-30)<=0.5;
    toolbarViewFixture.style.width='720px';
    const widerToolbar=toolbarFixture.querySelector('.terminal-actions');
    const widerToolbarRect=widerToolbar.getBoundingClientRect();
    const widerActionsLeftAligned=Math.abs(widerToolbar.querySelector('button').getBoundingClientRect().left-widerToolbarRect.left)<1;
    const widerVisibleButtons=[...widerToolbar.querySelectorAll('button')].filter(button=>getComputedStyle(button).display!=='none');
    const widerIconButtons=widerVisibleButtons.filter(button=>!button.classList.contains('terminal-action-encoding'));
    const widerActionsIconOnly=widerIconButtons.every(button=>Math.abs(button.getBoundingClientRect().width-30)<=0.5)
      && widerIconButtons.flatMap(button=>[...button.querySelectorAll(':scope > span:not(.composite-icon)')]).every(span=>getComputedStyle(span).display==='none')
      && widerIconButtons.filter(button=>button.classList.contains('terminal-dropdown-button')).every(button=>getComputedStyle(button.querySelector(':scope > svg:last-child')).display==='none');
    const headerStartupFixture=document.createElement('div');
    headerStartupFixture.className='topbar';
    headerStartupFixture.style.cssText='position:fixed;left:-10000px;top:0;width:760px;';
    headerStartupFixture.innerHTML='<div class="workspace-header-tools workspace-global-header-tools"><div class="terminal-toolbar terminal-toolbar-header"><div class="actions terminal-actions"><button class="icon-button terminal-startup-button">'+icon('command')+'<span>配置</span></button></div></div></div>';
    document.body.appendChild(headerStartupFixture);
    const headerStartupButton=headerStartupFixture.querySelector('.terminal-startup-button');
    const headerStartupLabel=headerStartupButton.querySelector('span');
    const headerHeightBefore=window.termaWorkspaceChrome.value('header');
    const headerStartupFits=[34,42,64].every(height=>{
      window.termaWorkspaceChrome.apply("header",height,{fit:false});
      const buttonRect=headerStartupButton.getBoundingClientRect();
      const labelStyle=getComputedStyle(headerStartupLabel);
      return labelStyle.display==='none'
        && Math.abs(buttonRect.width-parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--workspace-header-control-height')))<=0.5
        && headerStartupButton.scrollWidth<=headerStartupButton.clientWidth;
    });
    window.termaWorkspaceChrome.apply("header",headerHeightBefore,{fit:false});
    headerStartupFixture.remove();
    const desktopActionsIconOnly=encodingLabelVisible&&compactLabelsHidden&&widerActionsIconOnly&&headerStartupFits;
    const narrowToolbarLeftAligned=compactActionsLeftAligned&&widerActionsLeftAligned;
    toolbarViewFixture.style.width='540px';
    const responsiveView=document.querySelector('#view-terminal');
    const previousResponsiveStyle=responsiveView.style.cssText;
    responsiveView.style.width='1000px';
    responsiveView.style.flex='0 0 1000px';
    const responsiveToolbar=toolbarFixture.cloneNode(true);
    responsiveToolbar.style.width='100%';
    responsiveView.prepend(responsiveToolbar);
    const responsiveTitleRect=responsiveToolbar.querySelector('.terminal-title-row').getBoundingClientRect();
    const responsiveActions=responsiveToolbar.querySelector('.terminal-actions');
    const responsiveActionsRect=responsiveActions.getBoundingClientRect();
    const responsiveButtons=[...responsiveActions.querySelectorAll('button')].filter(button=>getComputedStyle(button).display!=='none');
    const responsiveToolbarFits=responsiveActionsRect.top>=responsiveTitleRect.bottom-0.5
      && responsiveButtons.every(button=>{
        const rect=button.getBoundingClientRect();
        return rect.left>=responsiveActionsRect.left-0.5&&rect.right<=responsiveActionsRect.right+0.5;
      });
    responsiveToolbar.remove();
    responsiveView.style.cssText=previousResponsiveStyle;
    window.termaTerminalToolbarScroll.bind(toolbarFixture);
    toolbar.style.width='220px';
    toolbar.style.flex='0 0 220px';
    toolbar.scrollLeft=0;
    window.termaTerminalToolbarScroll.state(toolbar);
    const toolbarOverflows=toolbar.scrollWidth>toolbar.clientWidth+1;
    const toolbarScrollShell=toolbar.closest('.terminal-actions-scroll-shell');
    const toolbarScrollLeft=toolbarScrollShell?.querySelector('.terminal-actions-scroll-left');
    const toolbarScrollRight=toolbarScrollShell?.querySelector('.terminal-actions-scroll-right');
    const toolbarScrollControlsVisible=Boolean(toolbarScrollShell
      &&toolbarScrollShell.classList.contains('is-scrollable')
      &&getComputedStyle(toolbarScrollLeft).display!=='none'
      &&getComputedStyle(toolbarScrollRight).display!=='none');
    const toolbarScrollStartsAtLeft=Boolean(toolbarScrollLeft?.disabled&&!toolbarScrollRight?.disabled
      &&toolbarScrollShell?.classList.contains('can-scroll-right')
      &&!toolbarScrollShell?.classList.contains('can-scroll-left'));
    const toolbarScrollLabels=Boolean(toolbarScrollLeft?.title===tr('common:auto.scroll_left')
      &&toolbarScrollRight?.title===tr('common:auto.scroll_right')
      &&toolbarScrollLeft?.getAttribute('aria-label')===toolbarScrollLeft?.title
      &&toolbarScrollRight?.getAttribute('aria-label')===toolbarScrollRight?.title);
    const toolbarScrollCueVisible=Boolean(toolbarScrollShell?.classList.contains('can-scroll-right'));
    toolbarScrollRight?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    const toolbarScrollButtonsWork=toolbar.scrollLeft>0&&!toolbarScrollLeft?.disabled;
    toolbar.scrollLeft=0;
    window.termaTerminalToolbarScroll.state(toolbar);
    toolbar.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:180}));
    const toolbarWheelScrolls=toolbar.scrollLeft>0;
    toolbar.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'End'}));
    const toolbarKeyboardScrolls=toolbar.scrollLeft+toolbar.clientWidth>=toolbar.scrollWidth-1;
    window.termaTerminalToolbarScroll.state(toolbar);
    const toolbarScrollEndsAtRight=Boolean(!toolbarScrollLeft?.disabled&&toolbarScrollRight?.disabled
      &&toolbarScrollShell?.classList.contains('can-scroll-left')
      &&!toolbarScrollShell?.classList.contains('can-scroll-right'));
    const terminalToolbarScrollable=toolbarOverflows&&toolbarWheelScrolls&&toolbarKeyboardScrolls
      && toolbar.dataset.workspaceHorizontalScroll==='1'
      && getComputedStyle(toolbar).overflowX==='auto';
    toolbar.style.width='';
    toolbar.style.flex='';
    toolbar.scrollLeft=0;
    const desktopBackButton=document.querySelector('#mobileBack');
    const desktopBackHidden=Boolean(desktopBackButton&&getComputedStyle(desktopBackButton).display==='none');
    const metrics=visibleToolbarButtons.map(button=>{const br=button.getBoundingClientRect(),svg=button.querySelector('svg').getBoundingClientRect();return {buttonHeight:br.height,iconWidth:svg.width,iconHeight:svg.height,centerDelta:Math.abs((svg.top+svg.height/2)-(br.top+br.height/2))}});
    toolbarViewFixture.remove();
    let terminalCtrlWheelZooms=false;
    let terminalCtrlWheelKeepsPosition=false;
    let terminalPlainWheelScrolls=false;
    let terminalFontChangePreservesMiddleScroll=false;
    let terminalFontChangeKeepsWheelContinuity=false;
    let terminalWheelMetrics={};
    let terminalCjkTextDoesNotClip=false;
    let terminalCjkMetrics={};
    try {
      await window.termaTerminalLibraries.ensure();
      const scrollbarFixture=document.createElement('div');
      scrollbarFixture.className='terminal-box';
      scrollbarFixture.style.cssText='position:fixed;left:-10000px;top:0;width:520px;height:240px;min-height:0;';
      document.body.appendChild(scrollbarFixture);
      const scrollbarTerm=window.termaTerminalLibraries.terminal({allowProposedApi:true,overviewRuler:{width:8},fontSize:13});
      const scrollbarFit=createTerminalFitAddon(scrollbarTerm);
      scrollbarTerm.loadAddon(scrollbarFit);
      scrollbarTerm.open(scrollbarFixture);
      scrollbarFit.fit();
      await new Promise(resolve=>scrollbarTerm.write(Array.from({length:80},(_,index)=>'line '+index+'\\r\\n').join(''),resolve));
      scrollbarTerm.scrollToBottom();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const terminalScrollState=()=>{
        const viewport=scrollbarTerm?._core?._viewport;
        const scrollable=viewport?._scrollableElement;
        const cellHeight=Number(scrollbarTerm?._core?._renderService?.dimensions?.css?.cell?.height||0);
        return {
          viewportY:Number(scrollbarTerm.buffer.active.viewportY||0),
          baseY:Number(scrollbarTerm.buffer.active.baseY||0),
          latestYDisp:Number(viewport?._latestYDisp),
          scrollTop:Number(scrollable?.getScrollPosition?.()?.scrollTop||0),
          futureScrollTop:Number(scrollable?._scrollable?.getFutureScrollPosition?.()?.scrollTop||0),
          cellHeight
        };
      };
      const terminalWheelEvent=(deltaY,ctrlKey=false)=>{
        const event=new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey,deltaY,deltaMode:WheelEvent.DOM_DELTA_PIXEL});
        try { Object.defineProperty(event,'wheelDeltaY',{value:-deltaY}); } catch {}
        return event;
      };
      const wheelKey='terminal-wheel-smoke';
      const wheelSession={term:scrollbarTerm,fit:{fit:()=>{}},id:first.id};
      const wheelTarget=scrollbarFixture.querySelector('.xterm-screen');
      const wheelFontSizeField=window.termaTerminalMetadata.terminalFontSizeField();
      const wheelPreviousSavedFontSize=first[wheelFontSizeField];
      window.termaTerminalState.terminalSessions.set(wheelKey,wheelSession);
      try {
        window.termaTerminalPage.enableTerminalFontWheel(wheelSession,wheelKey);
        window.termaTerminalViewport.scrollToLine(scrollbarTerm,Math.max(1,Math.floor(Number(scrollbarTerm.buffer.active.baseY||0)/2)));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const ctrlViewportBefore=scrollbarTerm.buffer.active.viewportY;
        const ctrlFontBefore=Number(scrollbarTerm.options.fontSize);
        const ctrlScrollEvent=terminalWheelEvent(100,true);
        const ctrlScrollDispatchResult=wheelTarget?.dispatchEvent(ctrlScrollEvent);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const ctrlViewportAfter=scrollbarTerm.buffer.active.viewportY;
        const ctrlFontAfter=Number(scrollbarTerm.options.fontSize);
        const ctrlZoomOut=Boolean(wheelTarget)
          &&ctrlFontAfter===ctrlFontBefore-1
          &&ctrlScrollEvent.defaultPrevented
          &&ctrlScrollDispatchResult===false;
        const ctrlUpFontBefore=Number(scrollbarTerm.options.fontSize);
        const ctrlUpEvent=terminalWheelEvent(-100,true);
        const ctrlUpDispatchResult=wheelTarget?.dispatchEvent(ctrlUpEvent);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const ctrlUpFontAfter=Number(scrollbarTerm.options.fontSize);
        const ctrlZoomIn=ctrlUpFontAfter===ctrlUpFontBefore+1
          &&ctrlUpEvent.defaultPrevented
          &&ctrlUpDispatchResult===false;
        terminalCtrlWheelZooms=ctrlZoomOut&&ctrlZoomIn;
        terminalCtrlWheelKeepsPosition=ctrlViewportAfter===ctrlViewportBefore
          &&scrollbarTerm.buffer.active.viewportY===ctrlViewportAfter;
        const plainStateBefore=terminalScrollState();
        const plainViewportBefore=scrollbarTerm.buffer.active.viewportY;
        const plainFontBefore=Number(scrollbarTerm.options.fontSize);
        const plainWheelEvent=terminalWheelEvent(100);
        wheelTarget?.dispatchEvent(plainWheelEvent);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const plainStateAfter=terminalScrollState();
        const plainViewportAfter=scrollbarTerm.buffer.active.viewportY;
        const plainFontAfter=Number(scrollbarTerm.options.fontSize);
        const plainWheelDistance=plainViewportAfter-plainViewportBefore;
        terminalPlainWheelScrolls=plainFontAfter===plainFontBefore&&plainWheelDistance>0&&plainWheelDistance<=6;
        terminalWheelMetrics={ctrlViewportBefore,ctrlViewportAfter,ctrlFontBefore,ctrlFontAfter,ctrlUpFontBefore,ctrlUpFontAfter,plainViewportBefore,plainViewportAfter,plainWheelDistance,plainFontBefore,plainFontAfter,plainStateBefore,plainStateAfter,ctrlDefaultPrevented:ctrlScrollEvent.defaultPrevented,ctrlUpDefaultPrevented:ctrlUpEvent.defaultPrevented,plainDefaultPrevented:plainWheelEvent.defaultPrevented};

        scrollbarTerm.scrollToLine(Math.max(1, Math.floor(Number(scrollbarTerm.buffer.active.baseY || 0) / 2)), true);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const middleViewportBefore=Number(scrollbarTerm.buffer.active.viewportY || 0);
        const middleBaseBefore=Number(scrollbarTerm.buffer.active.baseY || 0);
        const middleFontBefore=Number(scrollbarTerm.options.fontSize);
        window.termaTerminalPage.changeTerminalFont(wheelKey,-1);
        await new Promise(resolve=>setTimeout(resolve,80));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const middleViewportAfterShrink=Number(scrollbarTerm.buffer.active.viewportY || 0);
        const middleBaseAfterShrink=Number(scrollbarTerm.buffer.active.baseY || 0);
        const shrinkStateBefore=terminalScrollState();
        const shrinkStayedMiddle=middleViewportAfterShrink>0&&middleViewportAfterShrink<middleBaseAfterShrink-1;
        const shrinkWheelBefore=middleViewportAfterShrink;
        const shrinkWheelEvent=terminalWheelEvent(100);
        wheelTarget?.dispatchEvent(shrinkWheelEvent);
        await new Promise(resolve=>setTimeout(resolve,100));
        const shrinkStateAfter=terminalScrollState();
        const shrinkWheelAfter=Number(scrollbarTerm.buffer.active.viewportY || 0);
        const shrinkWheelDistance=shrinkWheelAfter-shrinkWheelBefore;
        const shrinkWheelMoved=shrinkWheelDistance>0&&shrinkWheelDistance<=6;
        window.termaTerminalPage.changeTerminalFont(wheelKey,1);
        await new Promise(resolve=>setTimeout(resolve,80));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const middleViewportAfterGrow=Number(scrollbarTerm.buffer.active.viewportY || 0);
        const middleBaseAfterGrow=Number(scrollbarTerm.buffer.active.baseY || 0);
        const growStayedMiddle=middleViewportAfterGrow>0&&middleViewportAfterGrow<middleBaseAfterGrow-1;
        terminalFontChangePreservesMiddleScroll=middleBaseBefore>8&&shrinkStayedMiddle&&growStayedMiddle;
        terminalFontChangeKeepsWheelContinuity=shrinkWheelMoved;
        terminalWheelMetrics={...terminalWheelMetrics,middleViewportBefore,middleBaseBefore,middleFontBefore,middleViewportAfterShrink,middleBaseAfterShrink,shrinkWheelBefore,shrinkWheelAfter,shrinkWheelDistance,middleViewportAfterGrow,middleBaseAfterGrow,shrinkStateBefore,shrinkStateAfter,shrinkStayedMiddle,growStayedMiddle,shrinkWheelMoved};
        scrollbarTerm.options.fontSize=middleFontBefore;
      } catch (error) {
        terminalWheelMetrics={error:String(error?.stack||error)};
      } finally {
        window.termaTerminalPreferences.cancelPending(first.id);
        first[wheelFontSizeField]=wheelPreviousSavedFontSize;
        window.termaTerminalState.terminalSessions.delete(wheelKey);
      }
      const cjkLine='[X11] 转发未建立：远端 SSH 服务未开启或拒绝了 X11 转发。本次已自动降级为普通 SSH 终端，命令行仍可正常使用；图形程序不会显示。请在 X Server 管理中检查 X11Forwarding 和远端 xauth/XQuartz。';
      await new Promise(resolve=>scrollbarTerm.write('\\x1b[2J\\x1b[H'+cjkLine,resolve));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const terminalScreenRect=scrollbarFixture.querySelector('.xterm-screen')?.getBoundingClientRect();
      const terminalScrollbarRect=scrollbarFixture.querySelector('.xterm-scrollable-element > .scrollbar.vertical')?.getBoundingClientRect();
      const terminalXterm=scrollbarFixture.querySelector('.xterm');
      const cjkRows=[...scrollbarFixture.querySelectorAll('.xterm-rows > div')].filter(row=>row.textContent.trim());
      const cjkRowMetrics=cjkRows.map(row=>{
        const rowRect=row.getBoundingClientRect();
        const spanRects=[...row.querySelectorAll('span')].map(span=>span.getBoundingClientRect()).filter(rect=>rect.width||rect.height);
        return {
          text:row.textContent,
          rowRight:rowRect.right,
          maxSpanRight:spanRects.length?Math.max(...spanRects.map(rect=>rect.right)):rowRect.left
        };
      });
      const textSpacingTrim=terminalXterm ? getComputedStyle(terminalXterm).textSpacingTrim : '';
      const maxOverflow=cjkRowMetrics.length ? Math.max(...cjkRowMetrics.map(row=>row.maxSpanRight-row.rowRight)) : null;
      const maxTextRight=cjkRowMetrics.length ? Math.max(...cjkRowMetrics.map(row=>row.maxSpanRight)) : null;
      terminalCjkMetrics={
        screenRight:terminalScreenRect?.right,
        scrollbarLeft:terminalScrollbarRect?.left,
        scrollbarWidth:terminalScrollbarRect?.width,
        textSpacingTrim,
        maxOverflow,
        maxTextRight,
        rows:cjkRowMetrics,
        gap:terminalScreenRect&&terminalScrollbarRect ? terminalScrollbarRect.left-terminalScreenRect.right : null
      };
      terminalCjkTextDoesNotClip=Boolean(terminalScreenRect&&terminalScrollbarRect&&cjkRowMetrics.length
        && terminalScrollbarRect.width>=7.5
        && textSpacingTrim==='space-all'
        && cjkRowMetrics.every(row=>row.maxSpanRight<=row.rowRight+0.25)
        && maxTextRight<=terminalScrollbarRect.left-0.25);
      scrollbarTerm.dispose();
      scrollbarFixture.remove();
    } catch (error) {
      terminalCjkMetrics={error:String(error?.stack||error)};
    }
    const replacementMount=terminalTestView.querySelector('#terminalToolbarMount');
    const staleToolbar=document.createElement('div');
    staleToolbar.className='terminal-toolbar';
    staleToolbar.dataset.workspaceToolbarKind='terminal';
    staleToolbar.dataset.workspaceTabKey='terminal-stale-toolbar';
    staleToolbar.innerHTML='<span id="terminalStatus" data-connection-address="stale:22"></span>';
    document.querySelector('#workspaceGlobalHeaderTools')?.appendChild(staleToolbar);
    const replacementToolbar=document.createElement('div');
    replacementToolbar.className='terminal-toolbar';
    replacementToolbar.innerHTML='<div class="terminal-title-row"><span id="terminalStatus" class="terminal-status" data-connection-address="replacement:22" data-connection-state="已连接"></span></div><div class="actions terminal-actions"></div>';
    replacementMount.appendChild(replacementToolbar);
    window.termaTerminalPage.syncTerminalToolbarPlacement();
    const activeToolbarReplacesPrevious=document.querySelector('#workspaceGlobalHeaderTools')?.children.length===1
      && document.querySelector('#workspaceGlobalHeaderTools')?.firstElementChild===replacementToolbar
      && replacementMount.children.length===0
      && !staleToolbar.isConnected
      && window.termaTerminalSurface.element(key,'#terminalStatus')===replacementToolbar.querySelector('#terminalStatus');
    const zmodemPanelMetrics=[];
    for (const width of [560,360]) {
      const zmodemMount=document.createElement('div');
      zmodemMount.className='terminal-box';
      zmodemMount.style.cssText='position:fixed;left:-10000px;top:0;width:'+width+'px;height:220px;min-height:0;';
      document.body.appendChild(zmodemMount);
      const zmodemSession={mount:zmodemMount};
      window.termaTerminalZmodem.render(zmodemSession,{
        icon:'download',
        title:'正在接收 long-zmodem-transfer-filename.log',
        detail:'25.0 MB / 50.0 MB',
        showProgress:true,
        progress:50,
        primaryAction:'receive',
        primaryIcon:'download',
        primaryLabel:'接收本批文件'
      });
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const panel=zmodemMount.querySelector('.terminal-zmodem-panel');
      const mountRect=zmodemMount.getBoundingClientRect();
      const panelRect=panel?.getBoundingClientRect();
      const buttons=[...zmodemMount.querySelectorAll('.terminal-zmodem-actions button')].map(button=>button.getBoundingClientRect());
      zmodemPanelMetrics.push({
        width,
        visible:Boolean(panel&&!panel.hidden&&panelRect?.width&&panelRect?.height),
        withinMount:Boolean(panelRect&&panelRect.left>=mountRect.left-0.5&&panelRect.right<=mountRect.right+0.5),
        actionsVisible:Boolean(panelRect&&buttons.length===2&&buttons.every(rect=>rect.width>0&&rect.height>=30&&rect.left>=panelRect.left-0.5&&rect.right<=panelRect.right+0.5)),
        progressVisible:Boolean(zmodemMount.querySelector('[role="progressbar"][aria-valuenow="50"]'))
      });
      window.termaTerminalZmodem.close(zmodemSession);
      zmodemMount.remove();
    }
    const zmodemPanelUi=zmodemPanelMetrics.every(item=>item.visible&&item.withinMount&&item.actionsVisible&&item.progressVisible);
    hideActionMenu();
    window.termaTerminalState.terminalSessions.delete(secondKey);
    window.termaTerminalState.terminalSessions.delete(key);
    secondMount.remove();
    terminalGlobalSettings = previousTerminalGlobalSettings;
    applyTheme(previousTheme);
    tabs = tabs.filter(tab=>tab.key!==key);
    if (fixturePane) {
      fixturePane.tabs = previousFixtureTabs;
      fixturePane.activeTabKey = previousFixtureActive;
    }
    activeTabKey = previousTerminalTabKey;
      return {found:true,labels,metrics,desktopBackHidden,desktopKeysHidden,binaryType,binaryWrite,stableLogId,x11DefaultFallsBack,x11ScopeMenu,ctrlVImageIntercepted,ctrlVEmptyFallsThrough,ctrlVDiagnostics,enterReconnect,reconnectPreservesOutput,inactiveTerminalOutputContinues,fontActionRestoresFocus,recentCommandsRestoreFocus,recentCommandSequenceVisible,resourceWindowTitle,remoteDesktopTitleDedup,numberingContinuesWithOpenTabs,numberingRestartsAfterAllClosed,encodingMenuOpened,encodingSelectionUsesLatest,fontMenuOpened,statusHoverShowsFull,desktopStatusAvoidsDuplicate,desktopToolbarInHeader,connectionToggleUsesLinkAction,activeToolbarReplacesPrevious,narrowToolbarFits,narrowToolbarLeftAligned,responsiveToolbarFits,terminalToolbarScrollable,toolbarScrollControlsVisible,toolbarScrollStartsAtLeft,toolbarScrollLabels,toolbarScrollCueVisible,toolbarScrollButtonsWork,toolbarScrollEndsAtRight,startupCompactIconOnly,desktopActionsIconOnly,terminalToolbarIconSet,terminalFrameLowContrast,terminalFrameColors,terminalBackgroundColor,desktopCursorCopyHintVisible,desktopCursorCopyHintCleansUp,terminalCtrlWheelZooms,terminalCtrlWheelKeepsPosition,terminalPlainWheelScrolls,terminalFontChangePreservesMiddleScroll,terminalFontChangeKeepsWheelContinuity,terminalWheelMetrics,terminalCjkTextDoesNotClip,terminalCjkMetrics,legacyTerminalControlsAbsent,zmodemPanelUi,zmodemPanelMetrics,terminalSettingsUi};
   })()`).catch(error => ({executeError:String(error?.stack || error)}));
  const terminalStartupOriginalContentSize = window.getContentSize();
  window.setContentSize(1000, 600);
  await new Promise(resolve => setTimeout(resolve, 50));
  if (process.env.TERMA_UI_SCENARIO === 'terminal-startup') {
    await window.webContents.executeJavaScript(`(() => {
      const connection = connections[0];
      if (connection) {
        const key = 'terminal-startup-visual';
        if (!tabs.some(tab => tab.key === key)) tabs.push({key, title:'启动配置预览', viewName:'terminal', kind:'terminal', id:connection.id, closable:true});
        if (!window.termaTerminalState.terminalSessions.has(key)) window.termaTerminalState.terminalSessions.set(key, {id:connection.id, term:{reset(){}, focus(){}}});
        window.termaTerminalStartup.open('terminal-startup-visual', connection.id);
      }
      return Boolean(connection);
    })()`);
    await new Promise(resolve => setTimeout(resolve, 250));
    const startupVisualState = await window.webContents.executeJavaScript(`(() => { const modal = document.querySelector('#modal'); const card = modal?.querySelector('.terminal-startup-modal'); return {hidden:Boolean(modal?.hidden), hasCard:Boolean(card), dialog:card?.getBoundingClientRect ? {left:card.getBoundingClientRect().left, top:card.getBoundingClientRect().top, width:card.getBoundingClientRect().width, height:card.getBoundingClientRect().height} : null, title:card?.querySelector('#terminalStartupTitle')?.textContent || ''}; })()`);
    console.log('[ui-smoke] startup visual state', JSON.stringify(startupVisualState));
    const startupDirectory = process.env.TERMA_TERMINAL_STARTUP_VISUAL_DIR || path.join(diagnosticsDirectory, 'terminal-startup-visual');
    fs.mkdirSync(startupDirectory, { recursive: true });
    await window.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await window.webContents.invalidate();
    fs.writeFileSync(path.join(startupDirectory, 'zh-CN-light-dialog.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`(() => {
      window.termaTerminalViews.startupOptions()?.actions.close();
      return true;
    })()`);
  }
  const terminalStartupUi = await window.webContents.executeJavaScript(`(async () => {
    const connection=connections[0];
    if(!connection) return {found:false};
    const key='terminal-startup-smoke';
    const otherKey='terminal-startup-smoke-other';
    const newKey='terminal-startup-smoke-new';
    const splitKey='terminal-startup-smoke-split';
    const originalApi=api;
    const originalNotify=notify;
    const originalStartupConnect=window.termaTerminalConnection.connect;
    const originalDuplicateWorkspaceTab=window.termaWorkspaceTabCopy.duplicate;
    const originalStartup=window.termaTerminalStartup.normalize(connection);
    const reconnects=[];
    const notices=[];
    const duplicateCalls=[];
    let savedPayload=null;
    api=async (path,options={}) => {
      if(path.endsWith('/terminal-capabilities')) return {capabilities:{
        platform:'linux',
        platform_label:'Linux',
        default_shell:{name:'bash',label:'Bash',path:'/bin/bash'},
        profiles:[
          {id:'bash',kind:'shell',label:'Bash',path:'/bin/bash',args:'-l',platform:'posix',is_default:true},
          {id:'python3',kind:'repl',label:'Python 3',path:'/usr/bin/python3',args:'-i',platform:'posix',is_default:false}
        ],
        tools:[{id:'git',label:'Git',path:'/usr/bin/git'}],
        warnings:[]
      }};
      if(path.endsWith('/terminal-startup')){
        savedPayload=JSON.parse(options.body||'{}');
        return {startup:savedPayload};
      }
      return {};
    };
    notify=(...args)=>notices.push(args);
    window.termaTerminalConnection.connect=async(connection,tabKey,session)=>reconnects.push({id:connection.id,tabKey,current:window.termaTerminalState.terminalSessions.get(tabKey)===session});
    window.termaWorkspaceTabCopy.duplicate=(sourceKey,options={}) => {
      const duplicateKey=duplicateCalls.length===0?newKey:splitKey;
      if(typeof options.beforeOpen==='function') options.beforeOpen(duplicateKey,'复制终端',tabs.find(tab=>tab.key===sourceKey));
      duplicateCalls.push({sourceKey,splitZone:options.splitZone||'',duplicateKey});
      return duplicateKey;
    };
    tabs.push({key,title:'启动配置测试',viewName:'terminal',kind:'terminal',id:connection.id,closable:true});
    window.termaTerminalState.terminalSessions.set(key,{id:connection.id,connection,term:{writeln(){},reset(){},focus(){}}});
    window.termaTerminalState.terminalSessions.set(otherKey,{id:connection.id,connection,term:{writeln(){},reset(){},focus(){}}});
    window.termaTerminalStartup.open(key,connection.id);
    await new Promise(resolve=>setTimeout(resolve,25));
    const modal=document.querySelector('#modal');
    const card=modal.querySelector('.terminal-startup-modal');
    const profileSelect=document.querySelector('#terminalStartupProfile');
    const pythonOption=[...profileSelect.options].find(option=>option.textContent.includes('Python 3'));
    const controlsPresent=['terminalStartupProfile','terminalStartupPath','terminalStartupArgs','terminalStartupCwd','terminalStartupSaveDefault','terminalStartupCurrent','terminalStartupNewTab','terminalStartupSplit'].every(id=>Boolean(document.querySelector('#'+id)));
    const saveDefaultUnchecked=document.querySelector('#terminalStartupSaveDefault')?.checked===false;
    profileSelect.value=pythonOption?.value||'custom';
    $('terminalStartupProfile')?.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
    const cardRect=card?.getBoundingClientRect();
    const scrollRegion=card?.querySelector('.terminal-startup-scroll');
    const header=card?.querySelector('.terminal-settings-head');
    const actionBar=card?.querySelector('.terminal-startup-actions');
    const scrollStyle=scrollRegion?getComputedStyle(scrollRegion):null;
    const headerRect=header?.getBoundingClientRect();
    const actionRect=actionBar?.getBoundingClientRect();
    const modalFitsShortViewport=Boolean(cardRect
      && cardRect.left>=-0.5
      && cardRect.right<=innerWidth+0.5
      && cardRect.top>=-0.5
      && cardRect.bottom<=innerHeight+0.5);
    const bodyScrollsInShortViewport=Boolean(scrollRegion
      && scrollStyle?.overflowY==='auto'
      && scrollRegion.scrollHeight>scrollRegion.clientHeight+1);
    const fixedHeaderAndActions=Boolean(headerRect
      && actionRect
      && cardRect
      && headerRect.top>=cardRect.top-0.5
      && actionRect.bottom<=cardRect.bottom+0.5
      && actionRect.top>headerRect.bottom);
    if(scrollRegion) scrollRegion.scrollTop=scrollRegion.scrollHeight;
    await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
    const actionAfterScroll=actionBar?.getBoundingClientRect();
    const actionsStayVisibleWhileScrolling=Boolean(actionAfterScroll
      && cardRect
      && actionAfterScroll.top>=cardRect.top-0.5
      && actionAfterScroll.bottom<=cardRect.bottom+0.5);
    modal.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    const backdropIgnored=!modal.hidden&&Boolean(modal.querySelector('.terminal-startup-modal'));
    await window.termaTerminalStartup.apply(key,connection.id,'current');
    const temporary=window.termaTerminalStartupState.overrides.get(key);
    const currentTemporaryOnly=temporary?.terminal_program_path==='/usr/bin/python3'
      && !window.termaTerminalStartupState.overrides.has(otherKey)
      && savedPayload===null
      && reconnects.length===1
      && reconnects[0].tabKey===key&&reconnects[0].current;
    window.termaTerminalStartupState.overrides.set(otherKey,window.termaTerminalStartup.normalize({
      terminal_startup_mode:'program',
      terminal_profile_name:'Other tab',
      terminal_profile_kind:'shell',
      terminal_program_path:'/bin/zsh',
      terminal_program_args:'-l',
      terminal_program_platform:'posix'
    }));
    window.termaTerminalStartup.open(key,connection.id);
    await new Promise(resolve=>setTimeout(resolve,25));
    document.querySelector('#terminalStartupProfile').value='custom';
    document.querySelector('#terminalStartupProfileName').value='Permanent Bash';
    document.querySelector('#terminalStartupKind').value='shell';
    document.querySelector('#terminalStartupPath').value='/bin/bash';
    document.querySelector('#terminalStartupArgs').value='-l';
    document.querySelector('#terminalStartupPlatform').value='posix';
    document.querySelector('#terminalStartupSaveDefault').checked=true;
    const checkDoesNotSave=savedPayload===null;
    await window.termaTerminalStartup.apply(key,connection.id,'current');
    const checkedCurrentSaves=savedPayload?.terminal_program_path==='/bin/bash'
      && connection.terminal_program_path==='/bin/bash'
      && !window.termaTerminalStartupState.overrides.has(key)
      && window.termaTerminalStartupState.overrides.get(otherKey)?.terminal_program_path==='/bin/zsh'
      && reconnects.length===2
      && reconnects.every(item=>item.tabKey===key&&item.current);
    window.termaTerminalStartup.open(key,connection.id);
    await new Promise(resolve=>setTimeout(resolve,25));
    const newProfileSelect=document.querySelector('#terminalStartupProfile');
    const newPythonOption=[...newProfileSelect.options].find(option=>option.textContent.includes('Python 3'));
    newProfileSelect.value=newPythonOption?.value||'custom';
    $('terminalStartupProfile')?.dispatchEvent(new Event('change',{bubbles:true}));
    const newTabDefaultsTemporary=document.querySelector('#terminalStartupSaveDefault')?.checked===false;
    const reconnectsBeforeNew=reconnects.length;
    await window.termaTerminalStartup.apply(key,connection.id,'new');
    const newTabTemporary=duplicateCalls.length===1
      && duplicateCalls[0].sourceKey===key
      && duplicateCalls[0].splitZone===''
      && window.termaTerminalStartupState.overrides.get(newKey)?.terminal_program_path==='/usr/bin/python3'
      && !window.termaTerminalStartupState.overrides.has(key)
      && reconnects.length===reconnectsBeforeNew;
    window.termaTerminalStartup.open(key,connection.id);
    await new Promise(resolve=>setTimeout(resolve,25));
    const splitProfileSelect=document.querySelector('#terminalStartupProfile');
    const splitPythonOption=[...splitProfileSelect.options].find(option=>option.textContent.includes('Python 3'));
    splitProfileSelect.value=splitPythonOption?.value||'custom';
    $('terminalStartupProfile')?.dispatchEvent(new Event('change',{bubbles:true}));
    const splitPicker=document.querySelector('.terminal-startup-split-picker');
    const splitTrigger=document.querySelector('#terminalStartupSplit');
    const splitOptions=document.querySelector('.terminal-startup-split-options');
    const splitButtons=[...splitOptions.querySelectorAll('[role="menuitem"][data-split-zone]')];
    const splitZones=splitButtons.map(button=>button.dataset.splitZone);
    const splitCenter=splitOptions.querySelector('.terminal-startup-split-center');
    const splitCenterPresent=Boolean(splitCenter);
    const splitInteractionSelectors=[...document.styleSheets].flatMap(sheet=>{
      try { return [...sheet.cssRules].map(rule=>rule.selectorText||''); }
      catch { return []; }
    });
    const splitHoverRulePresent=splitInteractionSelectors.some(selector=>selector.includes('.terminal-startup-split-picker:hover')&&selector.includes('.terminal-startup-split-options'));
    const splitFocusRulePresent=splitInteractionSelectors.some(selector=>selector.includes('.terminal-startup-split-picker:focus-within')&&selector.includes('.terminal-startup-split-options'));
    const splitInitiallyCollapsed=getComputedStyle(splitOptions).visibility==='hidden'
      && getComputedStyle(splitOptions).pointerEvents==='none';
    splitOptions.style.transition='none';
    if(splitCenter) splitCenter.style.transition='none';
    splitButtons.forEach(button=>{ button.style.transition='none'; });
    splitTrigger.focus();
    await new Promise(resolve=>setTimeout(resolve,0));
    const focusedSplitStyle=getComputedStyle(splitOptions);
    const splitExpandsOnFocus=document.activeElement===splitTrigger
      && focusedSplitStyle.visibility==='visible'
      && focusedSplitStyle.pointerEvents==='auto'
      && Number.parseFloat(focusedSplitStyle.opacity)>0.9
      && splitButtons.every(button=>{
        const style=getComputedStyle(button);
        const rect=button.getBoundingClientRect();
        return style.visibility!=='hidden'&&style.pointerEvents!=='none'&&Number.parseFloat(style.opacity)>0.9&&rect.width>0&&rect.height>0;
      });
    const reconnectsBeforeSplit=reconnects.length;
    splitButtons.find(button=>button.dataset.splitZone==='right')?.click();
    await new Promise(resolve=>setTimeout(resolve,25));
    const splitOpenUsesDirection=duplicateCalls.length===2
      && duplicateCalls[1].sourceKey===key
      && duplicateCalls[1].splitZone==='right'
      && window.termaTerminalStartupState.overrides.get(splitKey)?.terminal_program_path==='/usr/bin/python3'
      && reconnects.length===reconnectsBeforeSplit;
    const fourSplitDirections=splitCenterPresent
      && splitButtons.length===4
      && ['top','bottom','left','right'].every(zone=>splitZones.includes(zone))
      && splitHoverRulePresent
      && splitFocusRulePresent;
    window.termaWorkspaceTabCopy.duplicate=originalDuplicateWorkspaceTab;
    let resolveSlowCapabilities;
    let capabilityRaceCall=0;
    api=async path => {
      if(!path.endsWith('/terminal-capabilities')) return {};
      capabilityRaceCall+=1;
      if(capabilityRaceCall===1) {
        return new Promise(resolve=>{ resolveSlowCapabilities=resolve; });
      }
      return {capabilities:{
        platform:'macos',
        platform_label:'Race B',
        default_shell:{name:'zsh',label:'Zsh',path:'/bin/zsh'},
        profiles:[{id:'zsh',kind:'shell',label:'Zsh',path:'/bin/zsh',args:'-l',platform:'posix',is_default:true}],
        tools:[],
        warnings:[]
      }};
    };
    window.termaTerminalStartup.open(key,connection.id);
    await new Promise(resolve=>setTimeout(resolve,0));
    window.termaTerminalViews.startupOptions()?.actions.close();
    window.termaTerminalStartup.open(otherKey,connection.id);
    await new Promise(resolve=>setTimeout(resolve,25));
    resolveSlowCapabilities?.({capabilities:{
      platform:'linux',
      platform_label:'Race A',
      default_shell:{name:'bash',label:'Bash',path:'/bin/bash'},
      profiles:[{id:'python3',kind:'repl',label:'Python 3',path:'/usr/bin/python3',args:'-i',platform:'posix',is_default:false}],
      tools:[],
      warnings:[]
    }});
    await new Promise(resolve=>setTimeout(resolve,25));
    const raceOptions=[...document.querySelectorAll('#terminalStartupProfile option')].map(option=>option.textContent);
    const requestRaceIsolated=document.querySelector('#terminalStartupCapabilitySummary')?.textContent.includes('Race B')
      && raceOptions.some(label=>label.includes('Zsh'))
      && !raceOptions.some(label=>label.includes('Python 3'));
    window.termaTerminalViews.startupOptions()?.actions.close();
    const closedKey='terminal-startup-smoke-closed';
    window.termaTerminalConnection.connect=originalStartupConnect;
    const OriginalWebSocket=window.WebSocket;
    let hiddenSocketCount=0;
    let resolveStartupTicket;
    class HiddenSessionWebSocket extends EventTarget {
      static OPEN=1;
      constructor(){ super(); hiddenSocketCount+=1; this.readyState=1; }
      close(){}
      send(){}
    }
    window.WebSocket=HiddenSessionWebSocket;
    api=async path => {
      if(path==='/api/terminal/startup-tickets') {
        return new Promise(resolve=>{ resolveStartupTicket=resolve; });
      }
      return {};
    };
    tabs.push({key:closedKey,title:'等待关闭',viewName:'terminal',kind:'terminal',id:connection.id});
    window.termaTerminalState.terminalSessions.set(closedKey,{
      id:connection.id,
      term:{cols:80,rows:24,writeln(){},dispose(){}},
      connectionAttempt:0
    });
    window.termaTerminalStartupState.overrides.set(closedKey,window.termaTerminalStartup.normalize({
      terminal_startup_mode:'program',
      terminal_profile_name:'Python 3',
      terminal_profile_kind:'repl',
      terminal_program_path:'/usr/bin/python3',
      terminal_program_args:'-i',
      terminal_program_platform:'posix'
    }));
    const pendingClosedConnect=window.termaTerminalConnectionRuntime.connectTerminal(connection,closedKey);
    await new Promise(resolve=>setTimeout(resolve,0));
    window.termaWorkspaceTabRuntime.cleanup(new Map([[closedKey,{key:closedKey,kind:"terminal"}]]));
    tabs=tabs.filter(tab=>tab.key!==closedKey);
    resolveStartupTicket?.({token:'closed-tab-ticket'});
    await pendingClosedConnect;
    const closedTabDoesNotConnect=hiddenSocketCount===0
      && !window.termaTerminalState.terminalSessions.has(closedKey)
      && !window.termaTerminalStartupState.overrides.has(closedKey);
    window.WebSocket=OriginalWebSocket;
    const result={
      found:Boolean(card&&profileSelect),
      controls:controlsPresent,
      capabilities:Boolean(pythonOption&&card?.textContent.includes('Git')),
      withinViewport:Boolean(cardRect&&cardRect.left>=-0.5&&cardRect.right<=innerWidth+0.5&&cardRect.top>=-0.5&&cardRect.bottom<=innerHeight+0.5),
      modalFitsShortViewport,
      bodyScrollsInShortViewport,
      fixedHeaderAndActions,
      actionsStayVisibleWhileScrolling,
      backdropIgnored,
      saveDefaultUnchecked,
      currentTemporaryOnly,
      checkDoesNotSave,
      checkedCurrentSaves,
      newTabDefaultsTemporary,
      newTabTemporary,
      splitInitiallyCollapsed,
      splitExpandsOnFocus,
      fourSplitDirections,
      splitOpenUsesDirection,
      requestRaceIsolated,
      closedTabDoesNotConnect,
      reconnectNotice:notices.some(args=>String(args[0]).includes('本终端'))
    };
    Object.assign(connection,originalStartup);
    window.termaTerminalStartupState.overrides.delete(key);
    window.termaTerminalStartupState.overrides.delete(otherKey);
    window.termaTerminalStartupState.overrides.delete(newKey);
    window.termaTerminalStartupState.overrides.delete(splitKey);
    window.termaTerminalState.terminalSessions.delete(key);
    window.termaTerminalState.terminalSessions.delete(otherKey);
    tabs=tabs.filter(tab=>![key,newKey,splitKey].includes(tab.key));
    api=originalApi;
    notify=originalNotify;
    window.termaTerminalConnection.connect=originalStartupConnect;
    window.termaWorkspaceTabCopy.duplicate=originalDuplicateWorkspaceTab;
    closeModal();
    return result;
  })()`);
  if(process.env.TERMA_UI_SCENARIO === 'terminal-startup') {
    console.log(JSON.stringify({terminalStartupUi}));
    if(errors.length) throw new Error(errors.join('\n'));
    clearTimeout(smokeWatchdog);
    app.exit(Object.values(terminalStartupUi).every(Boolean) ? 0 : 1);
    return;
  }
  window.setContentSize(...terminalStartupOriginalContentSize);
  await new Promise(resolve => setTimeout(resolve, 50));
  console.log("[ui-smoke] log settings");
  let logSettingsUi;
  const logProbe=new BrowserWindow({show:false,width:1200,height:844,webPreferences:{contextIsolation:true,backgroundThrottling:false,offscreen:true,partition:'log-reader-smoke-'+Date.now(),preload:path.join(__dirname,'ui-smoke-preload.js')}});
  logProbe.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
  try{await logProbe.loadURL(url);await new Promise(resolve=>setTimeout(resolve,1200));logSettingsUi=await runM6LogReaderUiScenario(logProbe,{viewport:'desktop'});}
  finally{logProbe.destroy();}
  console.log("[ui-smoke] SFTP views");
  const sftpUi = await window.webContents.executeJavaScript(`(async () => {
    document.documentElement.dataset.uiSmokeStage = 'sftp-views';
    try {
    async function clickSftpFixtureChoice(index) {
      const modal = document.getElementById('modal');
      for (let attempt = 0; attempt < 100; attempt++) {
        const button = modal?.querySelector('button[data-choice="' + index + '"]');
        if (modal?.checkVisibility() && button && !button.disabled) {
          const result = { dialog: modal.textContent, label: button.textContent };
          button.click();
          return result;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('The SFTP fixture choice did not open for ' + document.documentElement.dataset.uiSmokeStage);
    }
    const SFTP_EDITOR_LAYOUT_STORAGE_KEY='termaSftpEditorLayoutV1';
    const view = document.querySelector('#view-sftp');
    const previousHtml = view.innerHTML;
    const previousHidden = view.hidden;
    const previousOpen = window.termaSftpPage.open;
    const previousNavigateSftpPath = window.termaSftpView.navigate;
    const previousDirectoryNavigate = window.termaSftpDirectoryWorkspace.navigation.navigatePath;
    const previousPreview = window.termaSftpPreviewRuntime.text;
    const previousClipboardState = window.termaSftpFileActions.clipboard.value;
    const previousLoadSftpPage = window.termaSftpDirectoryWorkspace.loader.load;
    const previousRefreshSftpJobs = window.termaSftpTaskWorkspace.runtime.refresh;
    const previousStartSftpJobsTimer = window.termaSftpTransferLifecycle.polling.start;
    const previousSelectedId = selectedId;
    const previousActiveView = activeView;
    const previousActiveTabKey = activeTabKey;
    const previousFocusedPaneId = focusedPaneId;
    const previousWorkspaceLayout = JSON.parse(JSON.stringify(workspaceLayout));
    const previousTabs = tabs.map(tab => ({...tab}));
    const previousSftpRuntimes = [...sftpTabRuntimes.entries()];
    // The tab owner keeps allocation counters private. Fixtures restore their
    // tabs and runtimes; unused serials can remain consumed in this renderer.
    const previousSftpDisconnectedTabs = [...sftpDisconnectedTabs];

    const connection = connections[0];
    const fixtureTabKey = 'sftp-smoke-' + connection.id;
    let directoryActionsUi = {found:false};
    let connectionSessionUi = {found:false};
    let nativeDragUi = {found:false};
    let globalSettingsUi = {found:false};
    let directoryCacheBehavior = {sameResponseUntouched:false,changedResponseRendered:false,boundedAndExpired:false,permissionFailureRestored:false};
    let searchKeyboardUi = {opened:false,closed:false,recursive:false,feedback:false};
    let sftpPageLoads = 0;
    const sftpPageLoadOptions = [];
    let mutateStubbedSftpPaths = false;
    let rapidSftpOpen = false;
    let rapidSftpOpenUi = {requested:0, created:0, runtimes:0, settled:0, loaded:0, truthyResults:0, loadCalls:0, stubLoaded:0, sharedRequests:false, allSettled:false};
    try {
      window.termaSftpDirectoryWorkspace.loader.load = async options => {
        sftpPageLoads += 1;
        sftpPageLoadOptions.push({...options});
        if (rapidSftpOpen) {
          rapidSftpOpenUi.loadCalls += 1;
          const key = String(options.tabKey || "");
          const runtime = sftpTabRuntimes.get(key);
          const path = String(options.path || ".");
          const requestSeq = Number(runtime?.state?.requestSeq || 0) + 1;
          if (runtime) {
            runtime.state = {...runtime.state, path, loading:true, requestSeq, entries:[]};

          }
          await new Promise(resolve => setTimeout(resolve, 18));
          if (runtime && sftpTabRuntimes.has(key)) {
            runtime.state = {
              ...runtime.state,
              path,
              loading:false,
              requestSeq,
              entries:[{name:'burst-ready.txt',type:'file',size:1,mtime:1,mode:'644',owner:'demo',group:'demo'}],
              total:1,
              totalPages:1,
              unfilteredTotal:1
            };
            rapidSftpOpenUi.stubLoaded += 1;

          }
          return true;
        }
        if (mutateStubbedSftpPaths) {
          const key = String(options.tabKey || "");
          const runtime = sftpTabRuntimes.get(key);
          const tab = tabs.find(item => item.key === key);
          const path = String(options.path || ".");
          if (runtime) runtime.state = {...runtime.state, path, loading:false};
          if (tab) tab.path = path;

          if (!options.historyNavigation) window.termaSftpDirectoryWorkspace.navigation.remember(key, path);
        }
        return true;
      };
      window.termaSftpTaskWorkspace.runtime.refresh = async () => {};
      window.termaSftpTransferLifecycle.polling.start = () => {};
      window.termaSftpFileActions.clipboard.value = null;
      activeTabKey = fixtureTabKey;
      activeView = 'sftp';
      document.documentElement.dataset.uiSmokeStage = 'sftp-open-initial';
      await window.termaSftpPage.open(connection.id, '/Users/demo/Public', true, fixtureTabKey);
      // Exercise the same race as repeatedly clicking the connection-list
      // action: every click creates a separate tab while its first directory
      // request is still in flight.  The detached runtimes must all settle,
      // including the tabs that are no longer visible.
      document.documentElement.dataset.uiSmokeStage = 'sftp-open-concurrent';
      const rapidSftpKeys = Array.from({length:16}, (_, index) => 'sftp-burst-' + connection.id + '-' + (index + 1));
      // Use a directory that no earlier fixture has opened so every tab starts
      // from the same in-flight request instead of an already populated cache.
      const rapidSftpPath = '/Users/demo/Public/rapid-open';
      rapidSftpOpen = true;
      let rapidResults;
      try {
        rapidResults = await Promise.all(rapidSftpKeys.map(key => window.termaSftpPage.open(connection.id, rapidSftpPath, true, key)));
      } finally {
        rapidSftpOpen = false;
      }
      const rapidRuntimes = rapidSftpKeys.map(key => sftpTabRuntimes.get(key));
      rapidSftpOpenUi = {
        requested:rapidSftpKeys.length,
        created:rapidSftpKeys.filter(key => tabs.some(tab => tab.key === key && tab.kind === 'sftp')).length,
        runtimes:rapidRuntimes.filter(Boolean).length,
        settled:rapidRuntimes.filter(runtime => runtime && runtime.state.loading === false).length,
        loaded:rapidRuntimes.filter(runtime => runtime?.state?.entries?.[0]?.name === 'burst-ready.txt').length,
        truthyResults:rapidResults.filter(Boolean).length,
        loadCalls:rapidSftpOpenUi.loadCalls,
        stubLoaded:rapidSftpOpenUi.stubLoaded,
        allSettled:rapidResults.every(Boolean)
          && rapidSftpKeys.every(key => tabs.some(tab => tab.key === key && tab.kind === 'sftp'))
          && rapidRuntimes.every(runtime => runtime && runtime.state.loading === false && runtime.state.entries?.[0]?.name === 'burst-ready.txt')
      };
      rapidSftpKeys.forEach(key => {
        const pane = workspaceFindPaneForTab(key);
        if (pane) {
          pane.tabs = pane.tabs.filter(item => item !== key);
          if (pane.activeTabKey === key) pane.activeTabKey = fixtureTabKey;
        }
        const tabIndex = tabs.findIndex(tab => tab.key === key);
        if (tabIndex >= 0) tabs.splice(tabIndex, 1);
        window.termaSftpTabs.runtime.dispose(key);
      });
      window.termaSftpTabs.runtime.titles(connection.id);
      activateTab(fixtureTabKey);
      const directoryApi = api;
      let sharedDirectoryCalls = 0;
      try {
        api = async path => {
          if (!String(path).startsWith('/api/connections/' + connection.id + '/sftp?')) return {};
          sharedDirectoryCalls += 1;
          await new Promise(resolve => setTimeout(resolve, 18));
          return {path:'/Users/demo/Public',entries:[{name:'shared.txt',type:'file'}]};
        };
        const sharedParams = new URLSearchParams({path:'/Users/demo/Public',page:'1',page_size:'50',query:'',sort:'name',dir:'asc'});
        const sharedResults = await Promise.all(Array.from({length:16}, () => window.termaSftpDirectoryWorkspace.request(connection.id, sharedParams)));
        rapidSftpOpenUi.sharedRequests = sharedDirectoryCalls === 1
          && sharedResults.length === 16
          && sharedResults.every(result => result.entries?.[0]?.name === 'shared.txt');
        await window.termaSftpDirectoryWorkspace.request(connection.id, sharedParams);
        rapidSftpOpenUi.sharedRequests &&= sharedDirectoryCalls === 2;
        rapidSftpOpenUi.allSettled = rapidSftpOpenUi.allSettled && rapidSftpOpenUi.sharedRequests;
      } finally {
        api = directoryApi;
      }
      setWorkspace('切换测试', 'UI', 'welcome', 'sftp-switch-fixture', false, true);
      activeTabKey = fixtureTabKey;
      activeView = 'sftp';
      const pageLoadsBeforeReturn = sftpPageLoads;
      await window.termaSftpPage.open(connection.id, '/Users/demo/Public', false, fixtureTabKey);
      const reusedWithoutDirectoryReload = sftpPageLoads === pageLoadsBeforeReturn;
      let stickyTop = view.querySelector('.sftp-top');
      const fixturePane = view.closest('.workspace-pane');
      let toolbar = document.querySelector('#workspaceGlobalHeaderTools .sftp-toolbar') || fixturePane?.querySelector('[data-workspace-role="header-tools"] .sftp-toolbar') || view.querySelector('.sftp-toolbar');
      toolbar?.remove();
      await window.termaSftpPage.open(connection.id, '/Users/demo/Public', false, fixtureTabKey);
      const recoveredMissingToolbar = Boolean(
        document.querySelector('.sftp-toolbar[data-workspace-tab-key="' + CSS.escape(fixtureTabKey) + '"]')
      );
      toolbar = document.querySelector('#workspaceGlobalHeaderTools .sftp-toolbar') || fixturePane?.querySelector('[data-workspace-role="header-tools"] .sftp-toolbar') || view.querySelector('.sftp-toolbar');
      const duplicateSftpKey = 'sftp-' + connection.id + '-901';
      await window.termaSftpPage.open(connection.id, '/Users/demo/Public', true, duplicateSftpKey);
      const duplicateToolbarFirstVisible = Boolean(
        document.querySelector('.sftp-toolbar[data-workspace-tab-key="' + CSS.escape(duplicateSftpKey) + '"]:not([hidden])')
      );
      activateTab(fixtureTabKey);
      await Promise.resolve();
      const originalToolbarVisibleAgain = Boolean(
        document.querySelector('.sftp-toolbar[data-workspace-tab-key="' + CSS.escape(fixtureTabKey) + '"]:not([hidden])')
      );
      activateTab(duplicateSftpKey);
      await Promise.resolve();
      const duplicateToolbarVisibleAgain = Boolean(
        document.querySelector('.sftp-toolbar[data-workspace-tab-key="' + CSS.escape(duplicateSftpKey) + '"]:not([hidden])')
      );
      const duplicateSftpToolbarsFollowActiveTab = duplicateToolbarFirstVisible
        && originalToolbarVisibleAgain
        && duplicateToolbarVisibleAgain;

      const numberingConnectionId = Math.max(100000, ...connections.map(item => Number(item.id || 0))) + 1000;
      const numberingConnection = {...connection, id:numberingConnectionId, name:'SFTP 编号测试'};
      const numberingFirstKey = 'sftp-' + numberingConnectionId + '-7';
      const numberingSecondKey = 'sftp-' + numberingConnectionId + '-11';
      connections.push(numberingConnection);
      tabs.push({key:numberingFirstKey,kind:'sftp',id:numberingConnectionId,title:'SFTP 编号测试 · SFTP #7',path:'/first'});
      window.termaSftpTabs.runtime.titles(numberingConnectionId);
      const reopenedSingleTabHasNoSuffix = tabs.find(tab => tab.key === numberingFirstKey)?.title === 'SFTP 编号测试 · SFTP';
      tabs.push({key:numberingSecondKey,kind:'sftp',id:numberingConnectionId,title:'SFTP 编号测试 · SFTP #11',path:'/second'});
      window.termaSftpTabs.runtime.titles(numberingConnectionId);
      const twoOpenTabsUseCurrentOrdinals = tabs.find(tab => tab.key === numberingFirstKey)?.title === 'SFTP 编号测试 · SFTP'
        && tabs.find(tab => tab.key === numberingSecondKey)?.title === 'SFTP 编号测试 · SFTP #2';
      const numberingFirstIndex = tabs.findIndex(tab => tab.key === numberingFirstKey);
      if (numberingFirstIndex >= 0) tabs.splice(numberingFirstIndex, 1);
      window.termaSftpTabs.runtime.titles(numberingConnectionId);
      const remainingTabRenumberedWithoutChangingKey = tabs.find(tab => tab.key === numberingSecondKey)?.title === 'SFTP 编号测试 · SFTP'
        && tabs.find(tab => tab.key === numberingSecondKey)?.path === '/second';
      const numberingSecondIndex = tabs.findIndex(tab => tab.key === numberingSecondKey);
      if (numberingSecondIndex >= 0) tabs.splice(numberingSecondIndex, 1);
      const numberingConnectionIndex = connections.findIndex(item => Number(item.id) === numberingConnectionId);
      if (numberingConnectionIndex >= 0) connections.splice(numberingConnectionIndex, 1);
      const sftpVisibleNumberingStable = reopenedSingleTabHasNoSuffix
        && twoOpenTabsUseCurrentOrdinals
        && remainingTabRenumberedWithoutChangingKey;

      activateTab(fixtureTabKey);
      await Promise.resolve();
      const fixtureRuntime = sftpTabRuntimes.get(fixtureTabKey);
      const duplicateRuntime = sftpTabRuntimes.get(duplicateSftpKey);
      const fixtureTab = tabs.find(tab => tab.key === fixtureTabKey);
      const duplicateTab = tabs.find(tab => tab.key === duplicateSftpKey);
      fixtureRuntime.state = {...fixtureRuntime.state, path:'/alpha/child'};
      duplicateRuntime.state = {...duplicateRuntime.state, path:'/beta/child'};
      fixtureTab.path = '/alpha/child';
      duplicateTab.path = '/beta/child';


      window.termaSftpDirectoryWorkspace.navigation.release(fixtureTabKey);
      window.termaSftpDirectoryWorkspace.navigation.release(duplicateSftpKey);
      const directoryNavigation=window.termaSftpDirectoryWorkspace.navigation;
      directoryNavigation.remember(fixtureTabKey, '/alpha');
      directoryNavigation.remember(fixtureTabKey, '/alpha/child');
      directoryNavigation.remember(duplicateSftpKey, '/beta');
      directoryNavigation.remember(duplicateSftpKey, '/beta/child');
      const duplicateHistoryBefore = JSON.stringify(directoryNavigation.historyState(duplicateSftpKey));
      const fixtureVisibleView = window.termaWorkspacePaneScope.workspaceElementForTab(fixtureTabKey, '#view-sftp');
      const fixtureVisibleShell = fixtureVisibleView?.querySelector(':scope > .sftp-shell');
      const fixtureVisibleToolbar = document.querySelector('.sftp-toolbar[data-workspace-tab-key="' + CSS.escape(fixtureTabKey) + '"]');
      const fixtureUpButton = [...fixtureVisibleView?.querySelectorAll('button') || []].find(button => button.title === '上一级');
      const activeShellMatchesTab = Boolean(fixtureVisibleView?.dataset.sftpTabKey === fixtureTabKey
        && fixtureVisibleShell?.dataset.sftpTabKey === fixtureTabKey
        && fixtureVisibleToolbar?.dataset.workspaceTabKey === fixtureTabKey
        && fixtureUpButton?.closest('.sftp-shell') === fixtureVisibleShell
        && window.termaSftpViews?.isMounted(fixtureTabKey));
      const loadsBeforeParentNavigation = sftpPageLoadOptions.length;
      mutateStubbedSftpPaths = true;
      fixtureUpButton?.click();
      await Promise.resolve();
      await Promise.resolve();
      const parentLoad = sftpPageLoadOptions.at(-1);
      const fixturePaneAfterParent = workspaceFindPaneForTab(fixtureTabKey);
      const parentNavigationStaysOnOwner = sftpPageLoadOptions.length === loadsBeforeParentNavigation + 1
        && parentLoad?.tabKey === fixtureTabKey
        && parentLoad?.path === '/alpha'
        && activeTabKey === fixtureTabKey
        && fixturePaneAfterParent?.activeTabKey === fixtureTabKey;
      const duplicateDirectoryStateIsolated = sftpTabRuntimes.get(duplicateSftpKey)?.state.path === '/beta/child'
        && tabs.find(tab => tab.key === duplicateSftpKey)?.path === '/beta/child';
      const duplicateHistoryIsolated = JSON.stringify(directoryNavigation.historyState(duplicateSftpKey)) === duplicateHistoryBefore;
      activateTab(duplicateSftpKey);
      await Promise.resolve();
      const duplicateVisibleView = window.termaWorkspacePaneScope.workspaceElementForTab(duplicateSftpKey, '#view-sftp');
      const duplicateShellMatchesTab = duplicateVisibleView?.dataset.sftpTabKey === duplicateSftpKey
        && duplicateVisibleView?.querySelector(':scope > .sftp-shell')?.dataset.sftpTabKey === duplicateSftpKey
        && sftpTabRuntimes.get(duplicateSftpKey)?.state.path === '/beta/child';
      mutateStubbedSftpPaths = false;

      const duplicatePane = workspaceFindPaneForTab(duplicateSftpKey);
      if (duplicatePane) {
        duplicatePane.tabs = duplicatePane.tabs.filter(key => key !== duplicateSftpKey);
        duplicatePane.activeTabKey = fixtureTabKey;
      }
      const duplicateTabIndex = tabs.findIndex(tab => tab.key === duplicateSftpKey);
      if (duplicateTabIndex >= 0) tabs.splice(duplicateTabIndex, 1);
      window.termaSftpTabs.runtime.dispose(duplicateSftpKey);
      activeTabKey = fixtureTabKey;
      activeView = 'sftp';
      await window.termaSftpPage.open(connection.id, '/Users/demo/Public', false, fixtureTabKey);
      toolbar = document.querySelector('#workspaceGlobalHeaderTools .sftp-toolbar') || fixturePane?.querySelector('[data-workspace-role="header-tools"] .sftp-toolbar') || view.querySelector('.sftp-toolbar');
      let navigationRow = view.querySelector('.sftp-navigation-row');
      let breadcrumb = view.querySelector('.sftp-breadcrumb');
      let pathEditor = view.querySelector('#sftpPathEditor');
      let floatingSearch = view.querySelector('#sftpFloatingSearch');
      let dropOverlay = view.querySelector('#sftpDropOverlay');
      let clipboardActions = toolbar?.querySelector('#sftpClipboardActions') || view.querySelector('#sftpClipboardActions') || document.querySelector('#sftpClipboardActions') || document.createElement('span');
      const actionTitles = [...toolbar?.querySelectorAll('button, label') || []].map(node => node.title || node.getAttribute('aria-label') || '').filter(Boolean);
      const emptyClipboardHidden = Boolean(clipboardActions && !clipboardActions.querySelector('button') && !clipboardActions.textContent.trim());
      view.querySelector('#sftpPathEditButton').click();
      const visiblePathControls = [...(view.querySelector('.sftp-path-block')?.children || [])]
        .filter(node => getComputedStyle(node).display !== 'none');
      const pathEditorReplacesBreadcrumb = Boolean(
        breadcrumb?.hidden
        && getComputedStyle(breadcrumb).display === 'none'
        && pathEditor
        && !pathEditor.hidden
        && getComputedStyle(pathEditor).display !== 'none'
        && view.querySelector('#sftpPathEditButton')?.hidden
        && visiblePathControls.length === 1
        && visiblePathControls[0] === pathEditor
      );
      window.termaSftpViews.pathEditor(fixtureTabKey,false);
      const preservedListHtml = view.querySelector('#sftpList')?.innerHTML;
      window.termaSftpConnection.paint(connection.id, 'disconnected', '测试断线');
      const disconnectedButton = window.termaSftpView.element('sftpConnectionToggle', fixtureTabKey);
      const disconnectedBanner = view.querySelector('#sftpConnectionBanner');
      const disconnectedAction = Boolean(disconnectedButton?.querySelector('.lucide-link-2') && !disconnectedButton?.querySelector('.lucide-link-2-off'));
      const bannerVisible = Boolean(disconnectedBanner && !disconnectedBanner.hidden && disconnectedBanner.querySelector('.sftp-connection-detail')?.textContent === '测试断线');
      const preservedWhileDisconnected = view.querySelector('#sftpList')?.innerHTML === preservedListHtml;
      window.termaSftpConnection.paint(connection.id, 'connected');
      const connectedButton = window.termaSftpView.element('sftpConnectionToggle', fixtureTabKey);
      const connectedAction = Boolean(
        connectedButton?.dataset.status === 'connected'
        && connectedButton?.title === '断开 SFTP 连接'
        && connectedButton?.getAttribute('aria-label') === '断开 SFTP 连接'
        && connectedButton?.querySelector('.lucide-link-2-off')
      );
      sftpDisconnectedTabs.add(fixtureTabKey);
      const disconnectedPageLoads = sftpPageLoads;
      await window.termaSftpPage.open(connection.id, '/Users/demo/Public', false, fixtureTabKey);
      const disconnectedTabSwitchDoesNotReconnect = sftpPageLoads === disconnectedPageLoads;
      await window.termaSftpPage.open(connection.id, '/Users/demo/Public', true, fixtureTabKey);
      const disconnectedFolderOperationReconnects = sftpPageLoads === disconnectedPageLoads + 1;
      const savedConnectApi = api;
      let automaticConnectCalls = 0;
      window.termaSftpConnection.paint(connection.id, 'disconnected');
      sftpDisconnectedTabs.add(fixtureTabKey);
      api = async (path, options={}) => {
        if (String(path).includes('/sftp/session') && options.method === 'POST') {
          automaticConnectCalls += 1;
          await new Promise(resolve => setTimeout(resolve, 10));
          return {connected:true,status:'connected'};
        }
        return {};
      };
      document.documentElement.dataset.uiSmokeStage = 'sftp-session-connection';
      const automaticConnectResults = await Promise.all([
        window.termaSftpConnection.ensure(connection.id),
        window.termaSftpConnection.ensure(connection.id)
      ]);
      const automaticConnectStatus = tabs.find(tab=>tab.key===fixtureTabKey)?.connectionStatus || '';
      const automaticConnectShared = automaticConnectCalls === 1
        && automaticConnectResults.every(Boolean)
        && automaticConnectStatus === 'connected'
        && !window.termaSftpConnection.pending(connection.id);
      const reconnectSequence = [];
      api = async (path, options={}) => {
        if (String(path).includes('/sftp/session') && options.method === 'DELETE') {
          reconnectSequence.push('disconnect-start');
          await new Promise(resolve => setTimeout(resolve, 15));
          reconnectSequence.push('disconnect-done');
          return {connected:false,status:'disconnected'};
        }
        if (String(path).includes('/sftp/session') && options.method === 'POST') {
          reconnectSequence.push('connect');
          return {connected:true,status:'connected'};
        }
        return {};
      };
      const manualDisconnectRequest = window.termaSftpConnection.disconnect(connection.id);
      const operationReconnectRequest = window.termaSftpConnection.ensure(connection.id);
      await Promise.all([manualDisconnectRequest, operationReconnectRequest]);
      const manualDisconnectAutoReconnect = reconnectSequence.join(',') === 'disconnect-start,disconnect-done,connect'
        && tabs.find(tab=>tab.key===fixtureTabKey)?.connectionStatus === 'connected'
        && !window.termaSftpConnection.pending(connection.id);
      api = savedConnectApi;

      const nativeDragApi = api;
      const nativeDragBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'termaDesktop');
      const nativeDragNotify = notify;
      const nativeDragFallbackNotices = [];
      const nativeDragRenameNotices = [];
      const nativeDragRow = document.createElement('div');
      const nativeDragDropTarget = document.createElement('button');
      const nativeDragEntries = [{path:'/source/native-drag.txt',name:'native-drag.txt',type:'file'}];
      const nativeDragKey = window.termaDragPayload.nativeDragKey(connection.id, nativeDragEntries);
      const nativeDragBridgeCalls = [];
      const nativeDragTargetCalls = [];
      const nativeDragActivateCalls = [];
      const nativeDragCancelCalls = [];
      const nativeDragCrossRequests = [];
      let nativeDragStageCalls = 0;
      let nativeDragCallReturned = false;
      let nativeDragPhase = '';
      let webExternalDragBlocked = false;
      const nativeDragEvent = () => ({
        preventDefault(){ this.defaultPrevented = true; },
        defaultPrevented:false,
        currentTarget:nativeDragRow,
        dataTransfer:{effectAllowed:'',setData(){}},
        clientX:window.innerWidth - 1,
        clientY:window.innerHeight - 1
      });
      try {
        nativeDragRow.className = 'sftp-row';
        nativeDragDropTarget.className = 'tab';
        document.body.append(nativeDragRow, nativeDragDropTarget);
        window.termaSftpDragWorkspace.drag.state.cache.delete(nativeDragKey);
        window.termaSftpDragWorkspace.drag.state.armed.delete(nativeDragKey);
        Object.defineProperty(window, 'termaDesktop', {
          configurable:true,
          writable:true,
          value:undefined
        });
        let webStageCalls = 0;
        api = async (pathname, options={}) => {
          if (pathname.endsWith('/sftp/stage-drag') && options.method === 'POST') webStageCalls += 1;
          return nativeDragApi(pathname, options);
        };
        const webDragEvent = nativeDragEvent();
        window.termaSftpDragWorkspace.drag.begin(webDragEvent, connection.id, nativeDragEntries[0].path, nativeDragEntries[0].name, nativeDragEntries[0].type);
        window.termaSftpDragWorkspace.drag.browser.leave({relatedTarget:null,clientX:0,clientY:0});
        await new Promise(resolve => setTimeout(resolve, 100));
        webExternalDragBlocked = webStageCalls === 0
          && window.termaSftpDragWorkspace.drag.state.requests.size === 0
          && document.querySelector('#sftpDragHint')?.textContent.includes('Web 版不能拖到系统');
        window.termaSftpDragWorkspace.drag.browser.finish({...webDragEvent,currentTarget:nativeDragRow,clientX:0,clientY:0});
        api = async (pathname, options={}) => {
          if (pathname.endsWith('/sftp/stage-drag') && options.method === 'POST') {
            nativeDragStageCalls += 1;
            return {files:['C:\\Terma\\drag-cache\\native-drag.txt']};
          }
          return nativeDragApi(pathname, options);
        };
        notify = (text, type='info') => {
          const message = String(text || '');
          if (message.includes('Linux 一次拖出当前不可用')) {
            nativeDragFallbackNotices.push({text:message,type});
          }
          if (message.includes('Finder 已自动保存为')) {
            nativeDragRenameNotices.push({text:message,type});
          }
          return nativeDragNotify(text, type);
        };
        Object.defineProperty(window, 'termaDesktop', {
          configurable:true,
          writable:true,
          value:{
            ...(nativeDragBridgeDescriptor?.value || {}),
            capabilities:{
              ...(nativeDragBridgeDescriptor?.value?.capabilities || {}),
              platform:'linux',
              sftpExternalDrag:'staged',
              sftpNativeDragStart:'leave-window',
              sftpNativeDragReason:'fusermount3 is unavailable'
            },
            startSftpDrag(payload, requestId) {
              nativeDragBridgeCalls.push({
                files:Array.isArray(payload) ? [...payload] : [],
                payload,
                requestId,
                phase:nativeDragPhase,
                synchronous:!nativeDragCallReturned
              });
            },
            setSftpDragTarget(requestId, target) {
              nativeDragTargetCalls.push({requestId,target});
            },
            activateSftpDrag(requestId) {
              nativeDragActivateCalls.push(requestId);
            },
            cancelSftpDrag(requestId) {
              nativeDragCancelCalls.push(requestId);
            }
          }
        });

        nativeDragPhase = 'stage';
        nativeDragCallReturned = false;
        const firstDragEvent = nativeDragEvent();
        window.termaSftpDragWorkspace.drag.begin(firstDragEvent, connection.id, nativeDragEntries[0].path, nativeDragEntries[0].name, nativeDragEntries[0].type);
        nativeDragCallReturned = true;
        const linuxFallbackHint = document.querySelector('#sftpDragHint')?.textContent || '';
        if (window.termaSftpDragWorkspace.drag.state.internal) window.termaSftpDragWorkspace.drag.state.internal.leftWindow = true;
        await new Promise(resolve => setTimeout(resolve, 20));
        const firstDragOnlyStages = nativeDragStageCalls === 1
          && nativeDragBridgeCalls.length === 0
          && window.termaSftpDragWorkspace.drag.state.armed.has(nativeDragKey)
          && window.termaSftpDragWorkspace.drag.state.cache.get(nativeDragKey)?.files?.length === 1;
        window.termaSftpDragWorkspace.drag.browser.finish({...firstDragEvent,currentTarget:nativeDragRow,clientX:window.innerWidth,clientY:window.innerHeight});
        const firstDragReset = window.termaSftpDragWorkspace.drag.state.internal === null
          && !nativeDragRow.classList.contains('is-dragging')
          && !document.body.classList.contains('sftp-item-drag-active');

        nativeDragPhase = 'cached-internal';
        window.termaSftpDragWorkspace.drag.state.armed.delete(nativeDragKey);
        nativeDragCallReturned = false;
        const secondDragEvent = nativeDragEvent();
        window.termaSftpDragWorkspace.drag.begin(secondDragEvent, connection.id, nativeDragEntries[0].path, nativeDragEntries[0].name, nativeDragEntries[0].type);
        nativeDragCallReturned = true;
        const cachedUnarmedStaysInternal = Boolean(
          !secondDragEvent.defaultPrevented
          && window.termaSftpDragWorkspace.drag.state.internal?.connectionId === Number(connection.id)
          && nativeDragBridgeCalls.length === 0
          && !window.termaSftpDragWorkspace.drag.state.armed.has(nativeDragKey)
        );
        window.termaSftpDragWorkspace.drag.browser.leave({relatedTarget:null,clientX:0,clientY:0});
        window.termaSftpDragWorkspace.drag.browser.finish({...secondDragEvent,currentTarget:nativeDragRow,clientX:0,clientY:0});
        await new Promise(resolve => setTimeout(resolve, 100));
        const sameWindowDropDoesNotArm = window.termaSftpDragWorkspace.drag.state.internal === null && !window.termaSftpDragWorkspace.drag.state.armed.has(nativeDragKey);

        nativeDragPhase = 'failure';
        window.termaSftpDragWorkspace.drag.state.armed.add(nativeDragKey);
        nativeDragCallReturned = false;
        const armedDragEvent = nativeDragEvent();
        window.termaSftpDragWorkspace.drag.begin(armedDragEvent, connection.id, nativeDragEntries[0].path, nativeDragEntries[0].name, nativeDragEntries[0].type);
        nativeDragCallReturned = true;
        const failedCall = nativeDragBridgeCalls.at(-1);
        const armedDragStartsSynchronously = Boolean(
          armedDragEvent.defaultPrevented
          && failedCall?.phase === 'failure'
          && failedCall.synchronous
          && failedCall.files?.[0] === 'C:\\Terma\\drag-cache\\native-drag.txt'
          && nativeDragStageCalls === 1
        );
        nativeDragRow.classList.add('is-dragging', 'is-preparing-drag');
        nativeDragDropTarget.classList.add('sftp-drop-target');
        document.body.classList.add('sftp-item-drag-active');
        window.termaSftpDragWorkspace.drag.native.result({requestId:failedCall?.requestId,ok:false,message:'native drag rejected'});
        const failureRearmed = Boolean(
          failedCall?.requestId
          && !window.termaSftpDragWorkspace.drag.state.requests.has(failedCall.requestId)
          && window.termaSftpDragWorkspace.drag.state.armed.has(nativeDragKey)
          && window.termaSftpDragWorkspace.drag.state.cache.get(nativeDragKey)?.files?.length === 1
          && !nativeDragRow.classList.contains('is-dragging')
          && !nativeDragRow.classList.contains('is-preparing-drag')
          && !nativeDragDropTarget.classList.contains('sftp-drop-target')
          && !document.body.classList.contains('sftp-item-drag-active')
          && !document.querySelector('#sftpDragHint')
        );

        nativeDragPhase = 'retry';
        nativeDragCallReturned = false;
        const retryDragEvent = nativeDragEvent();
        window.termaSftpDragWorkspace.drag.begin(retryDragEvent, connection.id, nativeDragEntries[0].path, nativeDragEntries[0].name, nativeDragEntries[0].type);
        nativeDragCallReturned = true;
        const successfulCall = nativeDragBridgeCalls.at(-1);
        nativeDragRow.classList.add('is-dragging', 'is-preparing-drag');
        nativeDragDropTarget.classList.add('sftp-drop-target');
        document.body.classList.add('sftp-item-drag-active');
        window.termaSftpDragWorkspace.drag.native.result({
          requestId:successfulCall?.requestId,
          ok:true,
          renamedItems:[{promisedName:'native-drag.txt',savedName:'native-drag 2.txt'}]
        });
        const successClearsState = Boolean(
          retryDragEvent.defaultPrevented
          && successfulCall?.phase === 'retry'
          && successfulCall.synchronous
          && nativeDragStageCalls === 1
          && !window.termaSftpDragWorkspace.drag.state.requests.has(successfulCall.requestId)
          && !window.termaSftpDragWorkspace.drag.state.armed.has(nativeDragKey)
          && !window.termaSftpDragWorkspace.drag.state.cache.has(nativeDragKey)
          && window.termaSftpDragWorkspace.drag.state.internal === null
          && window.termaSftpDragWorkspace.drag.state.preparing === null
          && !nativeDragRow.classList.contains('is-dragging')
          && !nativeDragRow.classList.contains('is-preparing-drag')
          && !nativeDragDropTarget.classList.contains('sftp-drop-target')
          && !document.body.classList.contains('sftp-item-drag-active')
          && !document.querySelector('#sftpDragHint')
        );
        const linuxFallbackNotice = nativeDragFallbackNotices[0];
        const linuxFallbackNoticeOnce = nativeDragFallbackNotices.length === 1
          && linuxFallbackNotice?.type === 'info'
          && linuxFallbackNotice.text.includes('Linux 一次拖出当前不可用')
          && linuxFallbackNotice.text.includes('系统没有安装 FUSE3（fusermount3）')
          && linuxFallbackNotice.text.includes('当前仍可使用兼容拖出')
          && linuxFallbackNotice.text.includes('再拖一次');
        const linuxFallbackUsesCompatibilityMode = firstDragOnlyStages
          && linuxFallbackHint.includes('Linux 当前使用兼容拖出')
          && linuxFallbackHint.includes('保存到本机需准备完成后再拖一次');
        const finderRenameNoticeShown = nativeDragRenameNotices.length === 1
          && nativeDragRenameNotices[0].type === 'info'
          && nativeDragRenameNotices[0].text.includes('native-drag 2.txt');

        const streamingTargetConnection = {...connection,id:Number(connection.id) + 8000,name:'native-stream-target'};
        const streamingTargetTab = {
          key:'sftp-' + streamingTargetConnection.id,
          kind:'sftp',
          id:streamingTargetConnection.id,
          title:'native-stream-target · SFTP',
          path:'/stream-target'
        };
        connections.push(streamingTargetConnection);
        tabs.push(streamingTargetTab);
        const streamingTargetNode = document.createElement('button');
        streamingTargetNode.className = 'tab';
        streamingTargetNode.dataset.kind = 'sftp';
        streamingTargetNode.dataset.tabKey = streamingTargetTab.key;
        Object.assign(streamingTargetNode.style, {
          position:'fixed',
          left:'10px',
          top:'10px',
          width:'160px',
          height:'40px',
          zIndex:'2147483647',
          pointerEvents:'auto'
        });
        document.body.appendChild(streamingTargetNode);
        const streamingStageCallsBefore = nativeDragStageCalls;
        api = async (pathname, options={}) => {
          if (pathname.endsWith('/sftp/stage-drag') && options.method === 'POST') {
            nativeDragStageCalls += 1;
            return {files:['unexpected-stage-call']};
          }
          if (pathname.endsWith('/sftp/upload-plan') && options.method === 'POST') return {items:[]};
          if (pathname.endsWith('/sftp/cross-copy') && options.method === 'POST') {
            nativeDragCrossRequests.push({pathname,body:JSON.parse(options.body || '{}')});
            return {id:'native-stream-cross-copy',type:'cross-copy',status:'completed',progress:100};
          }
          return nativeDragApi(pathname, options);
        };
        Object.defineProperty(window, 'termaDesktop', {
          configurable:true,
          writable:true,
          value:{
            ...(nativeDragBridgeDescriptor?.value || {}),
            capabilities:{
              ...(nativeDragBridgeDescriptor?.value?.capabilities || {}),
              platform:'win32',
              sftpExternalDrag:'streaming',
              sftpNativeDragStart:'pointerdown'
            },
            startSftpDrag(payload, requestId) {
              nativeDragBridgeCalls.push({
                files:Array.isArray(payload) ? [...payload] : [],
                payload,
                requestId,
                phase:'streaming',
                synchronous:true
              });
            },
            setSftpDragTarget(requestId, target) {
              nativeDragTargetCalls.push({requestId,target});
            },
            activateSftpDrag(requestId) {
              nativeDragActivateCalls.push(requestId);
            },
            cancelSftpDrag(requestId) {
              nativeDragCancelCalls.push(requestId);
            }
          }
        });
        nativeDragRow.setAttribute('draggable', 'true');
        const streamingCallsBefore = nativeDragBridgeCalls.length;
        window.termaSftpDragWorkspace.drag.prime(
          {
            button:0,
            pointerId:8080,
            clientX:20,
            clientY:20,
            target:nativeDragRow,
            currentTarget:nativeDragRow
          },
          connection.id,
          nativeDragEntries[0].path,
          nativeDragEntries[0].name,
          nativeDragEntries[0].type
        );
        const streamingCall = nativeDragBridgeCalls.findLast(call => call.phase === 'streaming');
        const streamingPreparesOnPointerDown = nativeDragBridgeCalls.length === streamingCallsBefore + 1
          && Boolean(streamingCall?.requestId)
          && streamingCall?.synchronous
          && nativeDragRow.getAttribute('draggable') === 'false';
        window.termaSftpDragWorkspace.drag.pointer.move({
          pointerId:8080,
          buttons:1,
          clientX:23,
          clientY:22
        });
        const streamingIgnoresTinyMovement = nativeDragActivateCalls.length === 0;
        window.termaSftpDragWorkspace.drag.pointer.move({
          pointerId:8080,
          buttons:1,
          clientX:28,
          clientY:20
        });
        const streamingCallsAfterThreshold = nativeDragBridgeCalls.filter(call => call.phase === 'streaming').length;
        window.termaSftpDragWorkspace.drag.pointer.move({
          pointerId:8080,
          buttons:1,
          clientX:48,
          clientY:20
        });
        const streamingDragEvent = nativeDragEvent();
        window.termaSftpDragWorkspace.drag.begin(
          streamingDragEvent,
          connection.id,
          nativeDragEntries[0].path,
          nativeDragEntries[0].name,
          nativeDragEntries[0].type
        );
        const streamingThresholdActivatesOnce = Boolean(
          streamingPreparesOnPointerDown
          && streamingIgnoresTinyMovement
          && streamingCall?.requestId
          && streamingDragEvent.defaultPrevented
          && nativeDragRow.getAttribute('draggable') === 'false'
          && streamingCallsAfterThreshold === 1
          && nativeDragBridgeCalls.filter(call => call.phase === 'streaming').length === streamingCallsAfterThreshold
          && nativeDragActivateCalls.length === 1
          && nativeDragActivateCalls[0] === streamingCall.requestId
        );
        const cancelCallsBeforeCapture = nativeDragCancelCalls.length;
        window.termaSftpDragWorkspace.drag.native.event({type:'ready',requestId:streamingCall?.requestId});
        window.termaSftpDragWorkspace.drag.pointer.cancel({pointerId:8080});
        const streamingCaptureCancelSurvives = window.termaSftpDragWorkspace.drag.pointer.current()?.nativeRequestId === streamingCall?.requestId
          && nativeDragCancelCalls.length === cancelCallsBeforeCapture
          && nativeDragActivateCalls.length === 2
          && nativeDragActivateCalls.at(-1) === streamingCall?.requestId;
        window.termaSftpDragWorkspace.drag.native.event({type:'started',requestId:streamingCall?.requestId});
        const streamingRestoresDraggableOnNativeStart = nativeDragRow.getAttribute('draggable') === 'true';
        const parallelBrowserDragEvent = nativeDragEvent();
        window.termaSftpDragWorkspace.drag.begin(
          parallelBrowserDragEvent,
          connection.id,
          nativeDragEntries[0].path,
          nativeDragEntries[0].name,
          nativeDragEntries[0].type
        );
        const streamingNativeBlocksParallelBrowserDrag = Boolean(
          parallelBrowserDragEvent.defaultPrevented
          && window.termaSftpDragWorkspace.drag.state.internal === null
          && streamingRestoresDraggableOnNativeStart
          && nativeDragBridgeCalls.filter(call => call.phase === 'streaming').length === streamingCallsAfterThreshold
        );
        const streamingSkipsStage = Boolean(
          streamingCall?.requestId
          && streamingCall.payload?.connectionId === Number(connection.id)
          && streamingCall.payload?.entries?.[0]?.path === nativeDragEntries[0].path
          && nativeDragStageCalls === streamingStageCallsBefore
        );
        const originalElementFromPoint = document.elementFromPoint;
        const nativeSourceShell = document.querySelector('#view-sftp .sftp-shell') || document.querySelector('.sftp-shell');
        let nativeIdleHintStable = false;
        let nativeOutsideHintStaysStable = false;
        let nativeHintDiagnostics = {};
        try {
          document.elementFromPoint = () => nativeSourceShell;
          const nativeInsideMotion = {
            type:'motion',
            requestId:streamingCall?.requestId,
            clientX:Math.round(window.innerWidth / 2),
            clientY:Math.round(window.innerHeight / 2)
          };
          window.termaSftpDragWorkspace.drag.native.event(nativeInsideMotion);
          const hintAfterNativeMotion = document.querySelector('#sftpDragHint');
          const hintCopyAfterNativeMotion = hintAfterNativeMotion?.querySelector('span');
          const hintContentAfterNativeMotion = hintAfterNativeMotion?.dataset.content || '';
          const hintTextAfterNativeMotion = hintAfterNativeMotion?.textContent || '';
          const windowsDragOverEvent = {
            defaultPrevented:false,
            propagationStopped:false,
            preventDefault(){ this.defaultPrevented = true; },
            stopPropagation(){ this.propagationStopped = true; },
            dataTransfer:{types:['Files'],items:[],files:[],dropEffect:'copy'}
          };
          window.termaSftpDragWorkspace.events.over(windowsDragOverEvent);
          const hintAfterChromiumDragOver = document.querySelector('#sftpDragHint');
          const hintCopyAfterChromiumDragOver = hintAfterChromiumDragOver?.querySelector('span');
          const hintContentAfterChromiumDragOver = hintAfterChromiumDragOver?.dataset.content || '';
          const hintTextAfterChromiumDragOver = hintAfterChromiumDragOver?.textContent || '';
          window.termaSftpDragWorkspace.drag.native.event(nativeInsideMotion);
          const hintAfterSecondNativeMotion = document.querySelector('#sftpDragHint');
          nativeHintDiagnostics = {before:hintTextAfterNativeMotion,after:hintTextAfterChromiumDragOver,second:hintAfterSecondNativeMotion?.textContent||'',sameHost:hintAfterChromiumDragOver===hintAfterNativeMotion&&hintAfterSecondNativeMotion===hintAfterNativeMotion,sameCopy:hintCopyAfterChromiumDragOver===hintCopyAfterNativeMotion&&hintAfterSecondNativeMotion?.querySelector('span')===hintCopyAfterNativeMotion,prevented:windowsDragOverEvent.defaultPrevented,stopped:windowsDragOverEvent.propagationStopped,effect:windowsDragOverEvent.dataTransfer.dropEffect};
          nativeIdleHintStable = Boolean(
            windowsDragOverEvent.defaultPrevented
            && windowsDragOverEvent.propagationStopped
            && windowsDragOverEvent.dataTransfer.dropEffect === 'none'
            && hintAfterNativeMotion
            && hintAfterChromiumDragOver === hintAfterNativeMotion
            && hintAfterSecondNativeMotion === hintAfterNativeMotion
            && hintCopyAfterNativeMotion
            && hintCopyAfterChromiumDragOver === hintCopyAfterNativeMotion
            && hintAfterSecondNativeMotion?.querySelector('span') === hintCopyAfterNativeMotion
            && hintContentAfterChromiumDragOver === hintContentAfterNativeMotion
            && (hintAfterSecondNativeMotion?.dataset.content || '') === hintContentAfterNativeMotion
            && hintTextAfterChromiumDragOver === hintTextAfterNativeMotion
            && hintAfterSecondNativeMotion?.textContent === hintTextAfterNativeMotion
            && hintTextAfterNativeMotion.includes('拖到其他 SFTP 标签可跨主机复制')
            && hintTextAfterNativeMotion.includes('拖出窗口可直接保存到本机')
            && !hintTextAfterNativeMotion.includes('松开后保存到本机目录')
          );
          document.elementFromPoint = () => null;
          window.termaSftpDragWorkspace.drag.native.event({
            type:'motion',
            requestId:streamingCall?.requestId,
            clientX:window.innerWidth + 100,
            clientY:window.innerHeight + 100
          });
          const outsideHint = document.querySelector('#sftpDragHint');
          nativeHintDiagnostics.outside = outsideHint?.textContent || '';
          nativeOutsideHintStaysStable = Boolean(
            outsideHint === hintAfterNativeMotion
            && outsideHint?.querySelector('span') === hintCopyAfterNativeMotion
            && (outsideHint?.dataset.content || '') === hintContentAfterNativeMotion
            && outsideHint?.textContent === hintTextAfterNativeMotion
            && outsideHint?.textContent.includes('拖出窗口可直接保存到本机')
            && !outsideHint?.textContent.includes('松开后保存到本机目录')
          );
        } finally {
          document.elementFromPoint = originalElementFromPoint;
        }
        const streamingTargetRect = streamingTargetNode.getBoundingClientRect();
        window.termaSftpDragWorkspace.drag.native.event({
          type:'motion',
          requestId:streamingCall?.requestId,
          clientX:streamingTargetRect.left + streamingTargetRect.width / 2,
          clientY:streamingTargetRect.top + streamingTargetRect.height / 2
        });
        const streamingTargetCall = nativeDragTargetCalls.findLast(call => call.requestId === streamingCall?.requestId);
        const nativeMotionTargetsSftp = Boolean(
          streamingTargetCall?.target?.id === streamingTargetConnection.id
          && streamingTargetCall.target.tabKey === streamingTargetTab.key
          && streamingTargetCall.target.path === streamingTargetTab.path
        );
        const nativeTargetCallsBeforeTransientMiss = nativeDragTargetCalls.length;
        const nativeHintBeforeTransientMiss = document.querySelector('#sftpDragHint');
        try {
          document.elementFromPoint = () => null;
          window.termaSftpDragWorkspace.drag.native.event({
            type:'motion',
            requestId:streamingCall?.requestId,
            clientX:Math.round(window.innerWidth / 2),
            clientY:Math.round(window.innerHeight / 2)
          });
        } finally {
          document.elementFromPoint = originalElementFromPoint;
        }
        const nativeTransientMissKeepsTarget = Boolean(
          nativeDragTargetCalls.length === nativeTargetCallsBeforeTransientMiss
          && nativeHintBeforeTransientMiss
          && document.querySelector('#sftpDragHint') === nativeHintBeforeTransientMiss
          && document.querySelector('#sftpDragHint')?.textContent.includes('native-stream-target')
          && !document.querySelector('#sftpDragHint')?.textContent.includes('本机目录')
        );
        const streamingRequest = window.termaSftpDragWorkspace.drag.state.requests.get(streamingCall?.requestId);
        const activeTabBeforeFinalMiss = activeTabKey;
        const nativeTargetCallsBeforeFinalMiss = nativeDragTargetCalls.length;
        try {
          activeTabKey = streamingTargetTab.key;
          document.elementFromPoint = () => null;
          window.termaSftpDragWorkspace.drag.target.hit(
            streamingCall?.requestId,
            streamingRequest,
            Math.round(window.innerWidth / 2),
            Math.round(window.innerHeight / 2),
            {final:true}
          );
        } finally {
          activeTabKey = activeTabBeforeFinalMiss;
          document.elementFromPoint = originalElementFromPoint;
        }
        const nativeFinalTransientMissKeepsTarget = Boolean(
          nativeDragTargetCalls.length === nativeTargetCallsBeforeFinalMiss + 1
          && nativeDragTargetCalls.at(-1)?.target?.id === streamingTargetConnection.id
          && nativeDragTargetCalls.at(-1)?.target?.tabKey === streamingTargetTab.key
        );
        window.termaSftpDragWorkspace.drag.native.event({
          type:'released',
          requestId:streamingCall?.requestId,
          clientX:window.innerWidth + 100,
          clientY:window.innerHeight + 100
        });
        const releasedTargetCall = nativeDragTargetCalls.findLast(call => call.requestId === streamingCall?.requestId);
        const nativeReleasedClearsStaleTarget = releasedTargetCall?.target === null;
        window.termaSftpDragWorkspace.drag.preview.clear();
        await window.termaSftpDragWorkspace.drag.native.result({
          requestId:streamingCall?.requestId,
          ok:true,
          internalTarget:{
            kind:'sftp',
            id:streamingTargetConnection.id,
            tabKey:streamingTargetTab.key,
            path:streamingTargetTab.path
          }
        });
        const nativeResultCopiesOnce = nativeDragCrossRequests.length === 1
          && nativeDragCrossRequests[0].body.target_connection_id === streamingTargetConnection.id
          && nativeDragCrossRequests[0].body.paths?.[0] === nativeDragEntries[0].path;
        const pendingCancelCallsBefore = nativeDragCancelCalls.length;
        window.termaSftpDragWorkspace.drag.prime(
          {
            button:0,
            pointerId:8081,
            clientX:20,
            clientY:20,
            target:nativeDragRow,
            currentTarget:nativeDragRow
          },
          connection.id,
          nativeDragEntries[0].path,
          nativeDragEntries[0].name,
          nativeDragEntries[0].type
        );
        const pendingPointerRequest = window.termaSftpDragWorkspace.drag.pointer.current()?.nativeRequestId;
        window.termaSftpDragWorkspace.drag.pointer.move({
          pointerId:8081,
          buttons:1,
          clientX:28,
          clientY:20
        });
        window.termaSftpDragWorkspace.drag.native.event({type:'ready',requestId:pendingPointerRequest});
        window.termaSftpDragWorkspace.drag.pointer.up({pointerId:8081});
        const pointerUpCancelsPending = Boolean(
          pendingPointerRequest
          && nativeDragCancelCalls.length === pendingCancelCallsBefore + 1
          && nativeDragCancelCalls.at(-1) === pendingPointerRequest
          && window.termaSftpDragWorkspace.drag.pointer.current() === null
        );
        await window.termaSftpDragWorkspace.drag.native.result({requestId:pendingPointerRequest,ok:false,message:'已取消拖出'});
        window.termaSftpDragWorkspace.drag.browser.reset(nativeDragRow);
        streamingTargetNode.remove();
        tabs.splice(tabs.findIndex(item => item.key === streamingTargetTab.key), 1);
        connections.splice(connections.findIndex(item => Number(item.id) === Number(streamingTargetConnection.id)), 1);
        api = nativeDragApi;
        nativeDragUi = {
          found:true,
          webExternalDragBlocked,
          linuxFallbackNoticeOnce,
          linuxFallbackUsesCompatibilityMode,
          streamingPreparesOnPointerDown,
          streamingThresholdActivatesOnce,
          streamingCaptureCancelSurvives,
          pointerUpCancelsPending,
          streamingSkipsStage,
          streamingNativeBlocksParallelBrowserDrag,
          nativeIdleHintStable,
          nativeOutsideHintStaysStable,
          nativeHintDiagnostics,
          nativeMotionTargetsSftp,
          nativeTransientMissKeepsTarget,
          nativeFinalTransientMissKeepsTarget,
          nativeReleasedClearsStaleTarget,
          nativeResultCopiesOnce,
          firstDragOnlyStages,
          firstDragReset,
          cacheReused:nativeDragStageCalls === 1
            && nativeDragBridgeCalls.filter(call => call.phase !== 'streaming').length === 2,
          cachedUnarmedStaysInternal,
          sameWindowDropDoesNotArm,
          armedDragStartsSynchronously,
          failureRearmed,
          successClearsState,
          finderRenameNoticeShown,
          stageCalls:nativeDragStageCalls,
          bridgeCalls:nativeDragBridgeCalls.length
        };
      } finally {
        notify = nativeDragNotify;
        window.termaSftpDragWorkspace.drag.browser.reset(nativeDragRow);
        window.termaSftpDragWorkspace.drag.state.cache.delete(nativeDragKey);
        window.termaSftpDragWorkspace.drag.state.armed.delete(nativeDragKey);
        for (const [requestId, request] of window.termaSftpDragWorkspace.drag.state.requests) {
          if (request.key === nativeDragKey) window.termaSftpDragWorkspace.drag.state.requests.delete(requestId);
        }
        nativeDragRow.remove();
        nativeDragDropTarget.remove();
        api = nativeDragApi;
        if (nativeDragBridgeDescriptor) Object.defineProperty(window, 'termaDesktop', nativeDragBridgeDescriptor);
        else delete window.termaDesktop;
      }
      const sourceSftpTabKey = activeTabKey;
      const sourceSftpPath = fixtureRuntime.state.path;
      let targetContentLeaveKeepsPreview = false;
      let targetHeaderLeaveKeepsPreview = false;
      let targetChromeLeaveRestoresSource = false;
      let transientTabLeaveKeepsPreview = false;
      const dragTargetConnection = {...connection,id:Number(connection.id) + 9000,name:'测试目标'};
      connections.push(dragTargetConnection);
      const dragTargetTab = {key:'sftp-' + dragTargetConnection.id,kind:'sftp',id:dragTargetConnection.id,title:'测试目标 · SFTP',path:'/target'};
      tabs.push(dragTargetTab);
      renderTabs();
      const dragTargetButton = [...document.querySelectorAll('#tabs .tab')].find(tab => tab.dataset.tabKey === dragTargetTab.key);
      const webCrossHostBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'termaDesktop');
      Object.defineProperty(window, 'termaDesktop', {
        configurable:true,
        writable:true,
        value:undefined
      });
      const webCrossHostMode = window.termaSftpDragWorkspace.drag.mode() === false;
      window.termaSftpDragWorkspace.drag.state.internal = {connectionId:Number(connection.id),entries:[{path:'/source.txt',name:'source.txt',type:'file'}],sourceTabKey:sourceSftpTabKey,row:null};
      const serializedCrossDrag = window.termaDragPayload.serializeDragPayload(window.termaSftpDragWorkspace.drag.state.internal.connectionId, window.termaSftpDragWorkspace.drag.state.internal.entries, sourceSftpTabKey);
      const crossDragDataTransfer = {
        types:['application/x-terma-sftp'],
        dropEffect:'',
        getData(type) {
          return type === 'application/x-terma-sftp' ? serializedCrossDrag : '';
        }
      };
      const dragFeedbackEvent = {preventDefault(){},dataTransfer:crossDragDataTransfer,currentTarget:dragTargetButton};
      window.termaSftpDragWorkspace.drag.destinations.over(dragFeedbackEvent, dragTargetTab.key);
      await new Promise(resolve => setTimeout(resolve, 210));
      const dragFeedbackVisible = dragTargetButton.classList.contains('sftp-drop-target')
        && dragFeedbackEvent.dataTransfer.dropEffect === 'copy'
        && document.querySelector('#sftpDragHint')?.textContent.includes('测试目标');
      const dragTargetViewActivated = activeTabKey === dragTargetTab.key
        && view.dataset.sftpTabKey === dragTargetTab.key;
      window.termaSftpDragWorkspace.drag.destinations.leave({currentTarget:dragTargetButton,relatedTarget:null,clientX:0,clientY:0,dataTransfer:crossDragDataTransfer}, dragTargetButton);
      await new Promise(resolve => setTimeout(resolve, 420));
      transientTabLeaveKeepsPreview = activeTabKey === dragTargetTab.key
        && Boolean(window.termaSftpDragWorkspace.drag.preview.session())
        && window.termaSftpDragWorkspace.drag.preview.session().previewTabKey === dragTargetTab.key;
      const dragTargetActiveKey = activeTabKey;
      const dragTargetViewKey = view.dataset.sftpTabKey;
      const targetListDropEvent = {
        defaultPrevented:false,
        propagationStopped:false,
        preventDefault(){ this.defaultPrevented = true; },
        stopPropagation(){ this.propagationStopped = true; },
        dataTransfer:crossDragDataTransfer
      };
      window.termaSftpDragWorkspace.events.over(targetListDropEvent);
      const targetDropOverlay = document.querySelector('#sftpDropOverlay');
      const targetDropRect = targetDropOverlay?.getBoundingClientRect();
      const targetDropHint = document.querySelector('#sftpDragHint');
      const targetStickyBottom = document.querySelector('.sftp-top')?.getBoundingClientRect()?.bottom || 0;
      const targetListDropPrompt = Boolean(
        targetListDropEvent.defaultPrevented
        && targetListDropEvent.dataTransfer.dropEffect === 'copy'
        && targetDropOverlay
        && !targetDropOverlay.hidden
        && !targetDropOverlay.textContent.trim()
        && targetDropOverlay.dataset.mode === 'copy'
        && targetDropHint?.textContent.includes('松开复制到 测试目标')
        && document.querySelectorAll('#sftpDragHint').length === 1
        && targetDropRect.width > 0
        && targetDropRect.height > 0
        && targetDropRect.top >= targetStickyBottom
        && targetDropRect.bottom <= window.innerHeight
      );
      const targetHintBeforeTransientLeave = document.querySelector('#sftpDragHint');
      window.termaSftpDragWorkspace.events.leave({currentTarget:document.querySelector('.sftp-shell'),relatedTarget:null,dataTransfer:targetListDropEvent.dataTransfer});
      window.termaSftpDragWorkspace.events.over(targetListDropEvent);
      await new Promise(resolve => setTimeout(resolve, 120));
      const targetListDropPromptStable = Boolean(
        targetHintBeforeTransientLeave
        && document.querySelector('#sftpDragHint') === targetHintBeforeTransientLeave
        && !targetDropOverlay.hidden
        && targetDropOverlay.dataset.mode === 'copy'
        && targetHintBeforeTransientLeave.textContent.includes('松开复制到 测试目标')
      );
      const targetContent = [...document.querySelectorAll('.sftp-shell[data-sftp-tab-key]')]
        .find(element => element.dataset.sftpTabKey === dragTargetTab.key)
        || document.querySelector('#view-sftp .sftp-shell');
      window.termaSftpDragWorkspace.drag.destinations.leave({currentTarget:dragTargetButton,relatedTarget:targetContent,dataTransfer:crossDragDataTransfer}, dragTargetButton);
      await new Promise(resolve => setTimeout(resolve, 40));
      targetContentLeaveKeepsPreview = activeTabKey === dragTargetTab.key
        && Boolean(window.termaSftpDragWorkspace.drag.preview.session())
        && window.termaSftpDragWorkspace.drag.preview.session().previewTabKey === dragTargetTab.key;
      const targetHeader = targetContent?.querySelector('.sftp-top');
      window.termaSftpDragWorkspace.drag.destinations.leave({currentTarget:dragTargetButton,relatedTarget:targetHeader,dataTransfer:crossDragDataTransfer}, dragTargetButton);
      await new Promise(resolve => setTimeout(resolve, 40));
      targetHeaderLeaveKeepsPreview = activeTabKey === dragTargetTab.key
        && Boolean(window.termaSftpDragWorkspace.drag.preview.session())
        && window.termaSftpDragWorkspace.drag.preview.session().previewTabKey === dragTargetTab.key;
      const targetChrome = dragTargetButton?.closest('.workspace-pane')?.querySelector('.workspace-pane-chrome');
      const previousElementFromPoint = document.elementFromPoint;
      document.elementFromPoint = () => targetChrome;
      window.termaSftpDragWorkspace.drag.browser.over({target:targetChrome,clientX:48,clientY:48,dataTransfer:crossDragDataTransfer});
      await new Promise(resolve => setTimeout(resolve, 420));
      document.elementFromPoint = previousElementFromPoint;
      targetChromeLeaveRestoresSource = activeTabKey === sourceSftpTabKey && !window.termaSftpDragWorkspace.drag.preview.session();
      activeTabKey = sourceSftpTabKey;
      window.termaSftpDragWorkspace.drag.state.internal = {connectionId:Number(connection.id),entries:[{path:'/source.txt',name:'source.txt',type:'file'}],sourceTabKey:sourceSftpTabKey,row:null,previewActivated:false,dropAccepted:false};
      window.termaSftpDragWorkspace.drag.destinations.over(dragFeedbackEvent, dragTargetTab.key);
      await new Promise(resolve => setTimeout(resolve, 210));
      crossDragDataTransfer.dropEffect = 'copy';
      window.termaSftpDragWorkspace.drag.state.depth = 1;
      window.termaSftpDragWorkspace.drag.browser.finish({currentTarget:null,dataTransfer:crossDragDataTransfer});
      const crossHostPreviewHandoffSurvives = Boolean(
        window.termaSftpDragWorkspace.drag.state.internal === null
        && window.termaSftpDragWorkspace.drag.source.handoff.read()
        && window.termaSftpDragWorkspace.drag.source.active(crossDragDataTransfer)?.entries?.[0]?.path === '/source.txt'
      );
      const dragDropApi = api;
      const crossDropRequests = [];
      const crossDropNotices = [];
      const dragDropNotify = notify;
      api = async (pathname, options={}) => {
        if (pathname.endsWith('/sftp/upload-plan') && options.method === 'POST') return {items:[]};
        if (pathname.endsWith('/sftp/cross-copy') && options.method === 'POST') {
          crossDropRequests.push({pathname,body:JSON.parse(options.body || '{}')});
          return {id:'ui-cross-drop',type:'cross-copy',status:'completed',progress:100};
        }
        return dragDropApi(pathname, options);
      };
      notify = (text, type='info') => crossDropNotices.push({text:String(text || ''),type});
      window.termaSftpDragWorkspace.drag.state.internal = null;
      window.termaSftpDragWorkspace.drag.source.handoff.clear();
      const restoredCrossHostPayload = window.termaSftpDragWorkspace.drag.source.active(targetListDropEvent.dataTransfer);
      try {
        document.documentElement.dataset.uiSmokeStage = 'sftp-cross-host-drop';
        await window.termaSftpDragWorkspace.events.drop(targetListDropEvent);
      } finally {
        notify = dragDropNotify;
      }
      const crossHostListDropCopies = crossDropRequests.length === 1
        && crossDropRequests[0].body.target_connection_id === dragTargetConnection.id
        && crossDropRequests[0].body.paths?.[0] === '/source.txt'
        && restoredCrossHostPayload?.entries?.[0]?.name === 'source.txt'
        && window.termaSftpDragWorkspace.drag.state.internal === null
        && !document.body.classList.contains('sftp-item-drag-active')
        && webCrossHostMode;
      const crossHostDropHasNoUploadToast = !crossDropNotices.some(item => item.text.includes('已上传到'));
      window.termaSftpDragWorkspace.drag.state.internal = {
        connectionId:Number(dragTargetConnection.id),
        sourceTabKey:'sftp-same-host-source',
        entries:[{path:'/source/local.txt',name:'local.txt',type:'file'}],
        row:null
      };
      const sameHostDropEvent = {
        defaultPrevented:false,
        propagationStopped:false,
        preventDefault(){ this.defaultPrevented = true; },
        stopPropagation(){ this.propagationStopped = true; },
        dataTransfer:{types:['application/x-terma-sftp'],dropEffect:'copy'}
      };
      document.documentElement.dataset.uiSmokeStage = 'sftp-same-host-drop';
      await window.termaSftpDragWorkspace.events.drop(sameHostDropEvent);
      const sameHostListDropCopies = sameHostDropEvent.defaultPrevented
        && sameHostDropEvent.dataTransfer.dropEffect === 'copy'
        && crossDropRequests.length === 2
        && crossDropRequests[1].body.target_connection_id === dragTargetConnection.id
        && crossDropRequests[1].body.target === '/target'
        && crossDropRequests[1].body.paths?.[0] === '/source/local.txt'
        && window.termaSftpDragWorkspace.drag.state.internal === null
        && !document.querySelector('#sftpDragHint');
      if (webCrossHostBridgeDescriptor) Object.defineProperty(window, 'termaDesktop', webCrossHostBridgeDescriptor);
      else delete window.termaDesktop;
      api = dragDropApi;
      window.termaSftpDragWorkspace.drag.browser.reset();
      tabs.splice(tabs.findIndex(item => item.key === dragTargetTab.key), 1);
      connections.splice(connections.findIndex(item => Number(item.id) === Number(dragTargetConnection.id)), 1);
      activeTabKey = sourceSftpTabKey;
      const sourcePane = workspaceFindPaneForTab(sourceSftpTabKey);
      if (sourcePane) {
        sourcePane.tabs = sourcePane.tabs.filter(key=>key!==dragTargetTab.key);
        sourcePane.activeTabKey = sourceSftpTabKey;
        focusedPaneId = sourcePane.id;
      }
      await window.termaSftpPage.open(connection.id, sourceSftpPath, false, sourceSftpTabKey);
      stickyTop = view.querySelector('.sftp-top');
      toolbar = document.querySelector('#workspaceGlobalHeaderTools .sftp-toolbar') || fixturePane?.querySelector('[data-workspace-role="header-tools"] .sftp-toolbar') || view.querySelector('.sftp-toolbar');
      navigationRow = view.querySelector('.sftp-navigation-row');
      breadcrumb = view.querySelector('.sftp-breadcrumb');
      pathEditor = view.querySelector('#sftpPathEditor');
      floatingSearch = view.querySelector('#sftpFloatingSearch');
      dropOverlay = view.querySelector('#sftpDropOverlay');
      clipboardActions = toolbar?.querySelector('#sftpClipboardActions') || view.querySelector('#sftpClipboardActions') || document.querySelector('#sftpClipboardActions') || document.createElement('span');
      window.termaSftpDragWorkspace.dropFeedback.cancelLeave();
      window.termaSftpDragWorkspace.drag.state.depth = 0;
      window.termaSftpDragWorkspace.dropFeedback.external(false);
      const externalFileDropDetected = window.termaSftpDragWorkspace.browserDrop.hasFiles({types:{0:'Files',length:1},items:[],files:[]});
      const externalCollectedFile = new File(['drag-in'], 'drag-in.txt', {type:'text/plain'});
      document.documentElement.dataset.uiSmokeStage = 'sftp-external-drop';
      const externalCollectedFiles = await window.termaSftpDragWorkspace.collect({items:[],files:[externalCollectedFile]});
      const externalFileDropCollected = externalCollectedFiles.length === 1
        && externalCollectedFiles[0].file === externalCollectedFile
        && externalCollectedFiles[0].relativePath === 'drag-in.txt';
      const externalDropDataTransfer = {types:['Files'],items:[],files:[],dropEffect:''};
      const externalDropEvent = {
        defaultPrevented:false,
        preventDefault(){ this.defaultPrevented = true; },
        dataTransfer:externalDropDataTransfer
      };
      window.termaSftpDragWorkspace.events.enter(externalDropEvent);
      window.termaSftpDragWorkspace.events.enter(externalDropEvent);
      const externalDropOverlay = document.querySelector('#sftpDropOverlay');
      const externalDropOverlayRect = externalDropOverlay?.getBoundingClientRect();
      const workspaceHeaderRect = document.querySelector('.workspace-header')?.getBoundingClientRect();
      const workspaceTabsRect = document.querySelector('#tabs')?.getBoundingClientRect();
      const externalDropHint = document.querySelector('#sftpDragHint');
      const externalDropHintRect = externalDropHint?.getBoundingClientRect();
      const externalDropListRect = document.querySelector('#sftpList')?.getBoundingClientRect();
      const externalDropVisibleLeft = Math.max(0, Number(externalDropListRect?.left || 0));
      const externalDropVisibleRight = Math.min(window.innerWidth, Number(externalDropListRect?.right || window.innerWidth));
      const externalDropVisibleWidth = Math.max(0, externalDropVisibleRight - externalDropVisibleLeft);
      const externalDropHintCenterError = externalDropHintRect
        ? Math.abs(
          (externalDropHintRect.left + externalDropHintRect.right) / 2
          - (externalDropVisibleLeft + externalDropVisibleRight) / 2
        )
        : Number.POSITIVE_INFINITY;
      const centeredHintLeft = externalDropHint?.style.left || '';
      window.termaSftpDragWorkspace.drag.hint(externalDropHint?.querySelector('span')?.textContent || '', true, 'upload', 'sftp-missing-toolbar-fixture');
      const missingTabKeepsHintPosition = externalDropHint?.style.left === centeredHintLeft;
      const externalDropPromptMetrics = {
        prevented:externalDropEvent.defaultPrevented,
        overlays:document.querySelectorAll('#sftpDropOverlay').length,
        hints:document.querySelectorAll('#sftpDragHint').length,
        hidden:Boolean(externalDropOverlay?.hidden),
        mode:externalDropOverlay?.dataset.mode || '',
        overlayText:externalDropOverlay?.textContent.trim() || '',
        overlayChildren:externalDropOverlay?.children.length || 0,
        hint:externalDropHint?.textContent || '',
        hintCenterError:externalDropHintCenterError,
        hintWidth:Number(externalDropHintRect?.width || 0),
        visibleListWidth:externalDropVisibleWidth
      };
      const externalDropPromptIsSingle = Boolean(
        externalDropPromptMetrics.prevented
        && externalDropPromptMetrics.overlays === 1
        && externalDropPromptMetrics.hints === 1
        && externalDropOverlay
        && !externalDropPromptMetrics.hidden
        && externalDropPromptMetrics.mode === 'upload'
        && !externalDropPromptMetrics.overlayText
        && externalDropPromptMetrics.overlayChildren === 0
        && externalDropPromptMetrics.hint.includes('松开上传到 ')
      );
      const externalDropPromptAvoidsWorkspaceChrome = Boolean(
        externalDropOverlayRect
        && externalDropOverlayRect.width > 0
        && externalDropOverlayRect.height > 0
        && externalDropOverlayRect.top >= Math.max(
          Number(workspaceHeaderRect?.bottom || 0),
          Number(workspaceTabsRect?.bottom || 0)
        )
      );
      const externalDropPromptListCentered = Boolean(
        externalDropHintRect
        && externalDropVisibleWidth > 32
        && externalDropHintCenterError <= 1.5
        && externalDropHintRect.width <= externalDropVisibleWidth - 31
        && missingTabKeepsHintPosition
      );
      const externalDropSurfaceRect = document.querySelector('.sftp-shell')?.getBoundingClientRect();
      const externalDropWorkspaceRect = document.querySelector('.content.sftp-content .workspace')?.getBoundingClientRect();
      const externalDropSurfaceFillsWorkspace = Boolean(
        externalDropSurfaceRect
        && externalDropWorkspaceRect
        && externalDropSurfaceRect.height >= externalDropWorkspaceRect.height - 25
        && externalDropSurfaceRect.bottom >= externalDropWorkspaceRect.bottom - 13
      );
      const externalDropList = document.querySelector('#sftpList');
      const originalExternalDropListRect = externalDropList?.getBoundingClientRect;
      let externalDropPromptScrollClamped = false;
      let externalDropPromptHorizontalClamped = false;
      if (externalDropList && originalExternalDropListRect) {
        const currentRect = originalExternalDropListRect.call(externalDropList);
        const stickyBottom = Number(document.querySelector('.sftp-top')?.getBoundingClientRect()?.bottom || 0);
        try {
          externalDropList.getBoundingClientRect = () => ({
            left:currentRect.left,
            right:currentRect.right,
            top:-240,
            bottom:window.innerHeight - 24
          });
          window.termaSftpDragWorkspace.dropFeedback.external(true, {path:'/scroll-top'});
          const clippedAtTop = externalDropOverlay.getBoundingClientRect();
          const topClamped = clippedAtTop.top >= stickyBottom
            && clippedAtTop.bottom <= window.innerHeight
            && document.querySelectorAll('#sftpDragHint').length === 1;

          const bottomTop = Math.max(stickyBottom + 8, window.innerHeight - 150);
          externalDropList.getBoundingClientRect = () => ({
            left:currentRect.left,
            right:currentRect.right,
            top:bottomTop,
            bottom:window.innerHeight + 260
          });
          window.termaSftpDragWorkspace.dropFeedback.external(true, {path:'/scroll-bottom'});
          const clippedAtBottom = externalDropOverlay.getBoundingClientRect();
          const bottomClamped = clippedAtBottom.top >= bottomTop
            && clippedAtBottom.bottom <= window.innerHeight
            && document.querySelectorAll('#sftpDragHint').length === 1;
          externalDropPromptScrollClamped = topClamped && bottomClamped;

          const horizontalLeft = Math.max(36, Math.round(window.innerWidth * .3));
          const horizontalRight = window.innerWidth + 180;
          externalDropList.getBoundingClientRect = () => ({
            left:horizontalLeft,
            right:horizontalRight,
            top:currentRect.top,
            bottom:currentRect.bottom
          });
          window.termaSftpDragWorkspace.dropFeedback.external(true, {path:'/resized-sidebar'});
          const resizedHint = document.querySelector('#sftpDragHint')?.getBoundingClientRect();
          const expectedVisibleRight = window.innerWidth;
          const expectedCenter = (horizontalLeft + expectedVisibleRight) / 2;
          const expectedWidth = expectedVisibleRight - horizontalLeft;
          externalDropPromptHorizontalClamped = Boolean(
            resizedHint
            && Math.abs((resizedHint.left + resizedHint.right) / 2 - expectedCenter) <= 1.5
            && resizedHint.width <= expectedWidth - 31
          );
        } finally {
          externalDropList.getBoundingClientRect = originalExternalDropListRect;
          window.termaSftpDragWorkspace.dropFeedback.external(true);
        }
      }
      window.termaSftpDragWorkspace.events.leave(externalDropEvent);
      window.termaSftpDragWorkspace.events.leave(externalDropEvent);
      await new Promise(resolve => setTimeout(resolve, 220));
      const externalDropPromptClears = Boolean(
        externalDropOverlay?.hidden
        && !document.querySelector('#sftpDragHint')
        && window.termaSftpDragWorkspace.drag.state.depth === 0
      );
      const armedPointerCancelClearsRequest = Boolean(nativeDragUi.pointerUpCancelsPending);
      const armedDragRequestId = 'ui-armed-drag-allows-upload';
      window.termaSftpDragWorkspace.drag.state.requests.set(armedDragRequestId, {key:'ui-armed-drag',row:null,activated:false,nativeStarted:false});
      const armedDragEvent = {
        defaultPrevented:false,
        propagationStopped:false,
        preventDefault(){ this.defaultPrevented = true; },
        stopPropagation(){ this.propagationStopped = true; },
        dataTransfer:{types:{0:'Files',length:1},items:[],files:[],dropEffect:'copy'}
      };
      window.termaSftpDragWorkspace.events.enter(armedDragEvent);
      const armedDragAllowsExternalUpload = armedDragEvent.defaultPrevented
        && !armedDragEvent.propagationStopped
        && !document.querySelector('#sftpDropOverlay')?.hidden
        && window.termaSftpDragWorkspace.drag.state.depth === 1;
      window.termaSftpDragWorkspace.events.leave(armedDragEvent);
      await new Promise(resolve => setTimeout(resolve, 220));
      window.termaSftpDragWorkspace.drag.state.requests.delete(armedDragRequestId);
      window.termaSftpDragWorkspace.drag.state.internal = {
        connectionId:Number(fixtureRuntime.state.connectionId),
        entries:[{path:'/stale.txt',name:'stale.txt',type:'file'}],
        row:null
      };
      const staleInternalDragEvent = {
        defaultPrevented:false,
        propagationStopped:false,
        preventDefault(){ this.defaultPrevented = true; },
        stopPropagation(){ this.propagationStopped = true; },
        dataTransfer:{types:['Files'],items:[{kind:'file',type:'text/plain'}],files:[],dropEffect:'copy'}
      };
      window.termaSftpDragWorkspace.events.enter(staleInternalDragEvent);
      const staleInternalDragAllowsExternalUpload = staleInternalDragEvent.defaultPrevented
        && !staleInternalDragEvent.propagationStopped
        && window.termaSftpDragWorkspace.drag.state.internal === null
        && !document.querySelector('#sftpDropOverlay')?.hidden;
      window.termaSftpDragWorkspace.events.leave(staleInternalDragEvent);
      await new Promise(resolve => setTimeout(resolve, 220));
      const uriListBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'termaDesktop');
      if (!uriListBridgeDescriptor || uriListBridgeDescriptor.configurable) {
        Object.defineProperty(window, 'termaDesktop', {
          configurable:true,
          writable:true,
          value:{
            ...(uriListBridgeDescriptor?.value || {}),
            capabilities:{...(uriListBridgeDescriptor?.value?.capabilities || {}),platform:'linux'}
          }
        });
      }
      const uriListDragEvent = {
        defaultPrevented:false,
        propagationStopped:false,
        preventDefault(){ this.defaultPrevented = true; },
        stopPropagation(){ this.propagationStopped = true; },
        dataTransfer:{types:{0:'text/uri-list',length:1},items:[],files:[],dropEffect:'copy'}
      };
      window.termaSftpDragWorkspace.events.enter(uriListDragEvent);
      const desktopUriListDragAccepted = uriListDragEvent.defaultPrevented
        && !uriListDragEvent.propagationStopped
        && !document.querySelector('#sftpDropOverlay')?.hidden
        && window.termaSftpDragWorkspace.drag.state.depth === 1;
      window.termaSftpDragWorkspace.events.leave(uriListDragEvent);
      await new Promise(resolve => setTimeout(resolve, 220));
      if (!uriListBridgeDescriptor || uriListBridgeDescriptor.configurable) {
        if (uriListBridgeDescriptor) Object.defineProperty(window, 'termaDesktop', uriListBridgeDescriptor);
        else delete window.termaDesktop;
      }
      const ownDragRequestId = 'ui-own-drag-suppression';
      window.termaSftpDragWorkspace.drag.state.requests.set(ownDragRequestId, {key:'ui-own-drag',row:null,activated:true});
      const ownDragEvent = {
        defaultPrevented:false,
        propagationStopped:false,
        preventDefault(){ this.defaultPrevented = true; },
        stopPropagation(){ this.propagationStopped = true; },
        dataTransfer:{types:{0:'Files',length:1},items:[],files:[],dropEffect:'copy'}
      };
      window.termaSftpDragWorkspace.events.enter(ownDragEvent);
      const ownDragUploadSuppressed = ownDragEvent.defaultPrevented
        && ownDragEvent.propagationStopped
        && ownDragEvent.dataTransfer.dropEffect === 'none'
        && Boolean(document.querySelector('#sftpDropOverlay')?.hidden);
      window.termaSftpDragWorkspace.drag.state.requests.get(ownDragRequestId).released = true;
      const releasedDragEvent = {
        defaultPrevented:false,
        propagationStopped:false,
        preventDefault(){ this.defaultPrevented = true; },
        stopPropagation(){ this.propagationStopped = true; },
        dataTransfer:{types:{0:'Files',length:1},items:[],files:[],dropEffect:'copy'}
      };
      window.termaSftpDragWorkspace.events.enter(releasedDragEvent);
      const releasedDragAllowsExternalUpload = releasedDragEvent.defaultPrevented
        && !releasedDragEvent.propagationStopped
        && !document.querySelector('#sftpDropOverlay')?.hidden
        && window.termaSftpDragWorkspace.drag.state.depth === 1;
      window.termaSftpDragWorkspace.events.leave(releasedDragEvent);
      await new Promise(resolve => setTimeout(resolve, 220));
      window.termaSftpDragWorkspace.drag.state.requests.delete(ownDragRequestId);
      const terminalDropTab = {key:'terminal-sftp-drop-target',kind:'terminal',id:Number(connection.id),title:'终端拖放目标'};
      tabs.push(terminalDropTab);
      window.termaTerminalState.terminalSessions.set(terminalDropTab.key, {id:Number(connection.id),connected:true,currentDirectoryKnown:true,currentDirectory:'/terminal/current'});
      const terminalTabButton = document.createElement('button');
      terminalTabButton.className = 'tab';
      terminalTabButton.dataset.tabKey = terminalDropTab.key;
      const terminalDragTransfer = {
        types:['application/x-terma-sftp'],
        dropEffect:'',
        getData(type) { return type === 'application/x-terma-sftp' ? window.termaDragPayload.serializeDragPayload(connection.id, [{path:'/source.txt',name:'source.txt',type:'file'}], sourceSftpTabKey) : ''; }
      };
      const originalActivateTabForTerminalDrop = activateTab;
      activateTab = tabKey => { activeTabKey = tabKey; };
      let terminalTabPreviewActivated = false;
      let invalidTerminalDropRestoresSource = false;
      let invalidSftpDropRestoresSource = false;
      const invalidDropZone = document.createElement('div');
      invalidDropZone.className = 'ui-smoke-invalid-sftp-drop-zone';
      document.body.appendChild(invalidDropZone);
      const invalidSftpTargetConnection = {...connection,id:Number(connection.id) + 9100,name:'无效投放预览目标'};
      const invalidSftpTargetTab = {key:'sftp-invalid-drop-target',kind:'sftp',id:invalidSftpTargetConnection.id,title:'无效投放预览目标 · SFTP',path:'/invalid-target'};
      connections.push(invalidSftpTargetConnection);
      tabs.push(invalidSftpTargetTab);
      const invalidSftpTargetButton = document.createElement('button');
      invalidSftpTargetButton.className = 'tab';
      invalidSftpTargetButton.dataset.tabKey = invalidSftpTargetTab.key;
      const terminalCopyOwner = window.termaSftpFileActions.copy;
      const originalTerminalCopy = terminalCopyOwner.copy;
      let terminalDropCapture = null;
      try {
        activeTabKey = sourceSftpTabKey;
        window.termaSftpDragWorkspace.drag.state.internal = {connectionId:Number(connection.id),entries:[{path:'/source.txt',name:'source.txt',type:'file'}],sourceTabKey:sourceSftpTabKey,row:null,previewActivated:false,dropAccepted:false};
        window.termaSftpDragWorkspace.drag.destinations.over({preventDefault(){},dataTransfer:terminalDragTransfer,currentTarget:terminalTabButton}, terminalDropTab.key, terminalTabButton);
        await new Promise(resolve => setTimeout(resolve, 210));
        terminalTabPreviewActivated = activeTabKey === terminalDropTab.key && document.querySelector('#sftpDragHint')?.textContent.includes('终端当前目录');
        window.termaSftpDragWorkspace.drag.destinations.leave({relatedTarget:invalidDropZone,currentTarget:terminalTabButton}, terminalTabButton);
        await new Promise(resolve => setTimeout(resolve, 420));
        invalidTerminalDropRestoresSource = activeTabKey === sourceSftpTabKey && !window.termaSftpDragWorkspace.drag.preview.session();

        activeTabKey = sourceSftpTabKey;
        window.termaSftpDragWorkspace.drag.state.internal = {connectionId:Number(connection.id),entries:[{path:'/source.txt',name:'source.txt',type:'file'}],sourceTabKey:sourceSftpTabKey,row:null,previewActivated:false,dropAccepted:false};
        window.termaSftpDragWorkspace.drag.destinations.over({preventDefault(){},dataTransfer:terminalDragTransfer,currentTarget:invalidSftpTargetButton}, invalidSftpTargetTab.key, invalidSftpTargetButton);
        await new Promise(resolve => setTimeout(resolve, 210));
        const previousElementFromPoint = document.elementFromPoint;
        document.elementFromPoint = () => invalidDropZone;
        window.termaSftpDragWorkspace.drag.browser.over({target:invalidDropZone,clientX:24,clientY:24});
        await new Promise(resolve => setTimeout(resolve, 420));
        document.elementFromPoint = previousElementFromPoint;
        invalidSftpDropRestoresSource = activeTabKey === sourceSftpTabKey && !window.termaSftpDragWorkspace.drag.preview.session();

        window.termaSftpDragWorkspace.drag.state.internal = {connectionId:Number(connection.id),entries:[{path:'/source.txt',name:'source.txt',type:'file'}],sourceTabKey:sourceSftpTabKey,row:null,previewActivated:true,dropAccepted:false};
        terminalCopyOwner.copy = async context => {
          terminalDropCapture = {targetConnectionId:context.connectionId,directory:context.directory,tabKey:context.key};
          window.termaSftpDragWorkspace.drag.browser.finishPayload(window.termaSftpDragWorkspace.drag.state.internal);
        };
        await window.termaSftpDragWorkspace.drag.destinations.drop({preventDefault(){},stopPropagation(){},dataTransfer:terminalDragTransfer}, terminalDropTab.key, terminalTabButton);
      } finally {
        terminalCopyOwner.copy = originalTerminalCopy;
        activateTab = originalActivateTabForTerminalDrop;
        invalidDropZone.remove();
        tabs.splice(tabs.findIndex(item => item.key === invalidSftpTargetTab.key), 1);
        connections.splice(connections.findIndex(item => Number(item.id) === Number(invalidSftpTargetConnection.id)), 1);
      }
      const acceptedTerminalDropStays = activeTabKey === terminalDropTab.key
        && terminalDropCapture?.targetConnectionId === Number(connection.id)
        && terminalDropCapture?.directory === '/terminal/current'
        && terminalDropCapture?.tabKey === terminalDropTab.key;
      window.termaTerminalState.terminalSessions.delete(terminalDropTab.key);
      tabs.splice(tabs.indexOf(terminalDropTab), 1);
      activeTabKey = sourceSftpTabKey;
      connectionSessionUi = {
        found:Boolean(disconnectedButton && disconnectedBanner),
        addressIncludesPort:document.querySelector('#workspaceSubtitle')?.textContent === connection.ssh_user+'@'+connection.ssh_host+':'+connection.ssh_port,
        disconnectedAction,
        disconnectedBanner:bannerVisible,
        connectedAction,
        preservedWhileDisconnected,
        automaticConnectShared,
        automaticConnectCalls,
        automaticConnectStatus,
        manualDisconnectAutoReconnect,
        disconnectedTabSwitchDoesNotReconnect,
        disconnectedFolderOperationReconnects,
        reconnectSequence,
        dragFeedbackVisible,
        dragTargetViewActivated,
        dragTargetActiveKey,
        dragTargetViewKey,
        targetListDropPrompt,
        targetListDropPromptStable,
        targetContentLeaveKeepsPreview,
        targetHeaderLeaveKeepsPreview,
        targetChromeLeaveRestoresSource,
        transientTabLeaveKeepsPreview,
        crossHostListDropCopies,
        crossHostPreviewHandoffSurvives,
        crossHostDropHasNoUploadToast,
        sameHostListDropCopies,
        ownDragUploadSuppressed,
        armedPointerCancelClearsRequest,
        armedDragAllowsExternalUpload,
        staleInternalDragAllowsExternalUpload,
        desktopUriListDragAccepted,
        releasedDragAllowsExternalUpload,
        terminalTabPreviewActivated,
        invalidTerminalDropRestoresSource,
        invalidSftpDropRestoresSource,
        acceptedTerminalDropStays,
        externalFileDropDetected,
        externalFileDropCollected,
        externalDropPromptMetrics,
        externalDropPromptIsSingle,
        externalDropPromptAvoidsWorkspaceChrome,
        externalDropPromptListCentered,
        externalDropSurfaceFillsWorkspace,
        externalDropPromptScrollClamped,
        externalDropPromptHorizontalClamped,
        externalDropPromptClears
      };

      window.termaSftpFileActions.copyEntry(fixtureTabKey, '/Users/demo/Public/copy.txt', 'copy');
      const copyPaste = [...clipboardActions.querySelectorAll('button')].find(button => button.textContent.includes('粘贴'));
      const copyCancel = clipboardActions.querySelector('[aria-label="取消复制或移动队列"]');
      const copyQueueVisible = clipboardActions.textContent.includes('复制队列 1 项') && Boolean(copyPaste && !copyPaste.disabled && copyCancel);
      copyCancel?.click();
      const copyCancelled = window.termaSftpFileActions.clipboard.value === null && !clipboardActions.querySelector('button');

      window.termaSftpFileActions.copyEntry(fixtureTabKey, '/Users/demo/Public/move.txt', 'move');
      const movePaste = [...clipboardActions.querySelectorAll('button')].find(button => button.textContent.includes('粘贴'));
      const moveCancel = clipboardActions.querySelector('[aria-label="取消复制或移动队列"]');
      const moveQueueVisible = clipboardActions.textContent.includes('移动队列 1 项') && Boolean(movePaste && !movePaste.disabled && moveCancel);
      moveCancel?.click();
      const moveCancelled = window.termaSftpFileActions.clipboard.value === null && !clipboardActions.querySelector('button');
      window.termaSftpFileActions.clipboard.value = {mode:'copy', paths:['/source/cross.txt'], connectionId:999999, connectionName:'另一台主机'};
      window.termaSftpView.refreshDirectoryActions(fixtureTabKey);
      const crossCopyButton = [...clipboardActions.querySelectorAll('button')].find(button => button.textContent.includes('跨主机复制'));
      const crossHostCopyEnabled = Boolean(crossCopyButton && !crossCopyButton.disabled);
      window.termaSftpFileActions.clipboard.value = {mode:'move', paths:['/source/cross.txt'], connectionId:999999, connectionName:'另一台主机'};
      window.termaSftpView.refreshDirectoryActions(fixtureTabKey);
      const crossHostMoveDisabled = Boolean([...clipboardActions.querySelectorAll('button')].find(button => button.disabled));
      const crossPasteApi = api;
      const crossPasteActiveTabKey = activeTabKey;
      const crossPasteTargetTab = {key:'sftp-cross-paste-target',kind:'sftp',id:Number(connection.id),title:'测试目标 · SFTP',path:'/target'};
      tabs.push(crossPasteTargetTab);
      let crossHostConflictPrompted = false;
      let crossHostConflictBody = null;
      try {
        activeTabKey = crossPasteTargetTab.key;
        window.termaSftpTabs.runtime.ensure(crossPasteTargetTab.key, Number(connection.id), '/target');
        window.termaSftpFileActions.clipboard.value = {mode:'copy', paths:['/source/cross.txt'], connectionId:999999, connectionName:'另一台主机'};
        api = async (pathname, options={}) => {
          if (pathname.endsWith('/sftp/upload-plan')) return {items:[{name:'cross.txt',exists:true}]};
          if (pathname.endsWith('/sftp/cross-copy')) {
            crossHostConflictBody = JSON.parse(options.body || '{}');
            return {id:'cross-copy-job',status:'pending'};
          }
          return {};
        };
        document.documentElement.dataset.uiSmokeStage = 'sftp-cross-host-paste';
        const pasting = window.termaSftpFileActions.operations.paste(activeTabKey);
        const choice = await clickSftpFixtureChoice(1);
        crossHostConflictPrompted = choice.dialog.includes('同名') && choice.dialog.includes('cross.txt') && choice.label.includes('重命名');
        await pasting;
      } finally {
        api = crossPasteApi;
        activeTabKey = crossPasteActiveTabKey;

        tabs.splice(tabs.indexOf(crossPasteTargetTab), 1);
        window.termaSftpTabs.runtime.dispose(crossPasteTargetTab.key);
      }
      const crossHostClipboardConflict = crossHostConflictPrompted
        && crossHostConflictBody?.conflict === 'rename'
        && crossHostConflictBody?.target_connection_id === Number(connection.id)
        && crossHostConflictBody?.target === '/target'
        && window.termaSftpFileActions.clipboard.value === null;
      window.termaSftpFileActions.clipboard.value = null;
      window.termaSftpView.refreshDirectoryActions(fixtureTabKey);
      const filenameEncodingButton = toolbar?.querySelector('#sftpFilenameEncodingButton') || document.querySelector('#sftpFilenameEncodingButton');
      filenameEncodingButton?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:160,clientY:100}));
      const filenameEncodingLabels = [...document.querySelectorAll('#actionMenu button span')].map(item=>item.textContent.trim());
      const filenameEncodingMenu = ['UTF-8','GB18030','GBK','Big5','Shift_JIS','EUC-KR','ISO-8859-1'].every(label=>filenameEncodingLabels.includes(label));
      hideActionMenu();
      window.termaSftpViews.search(fixtureTabKey,'close');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const searchInput = floatingSearch.querySelector('#sftpSearch');
      const shortcutOpened = !floatingSearch.hidden && document.activeElement === searchInput;
      const recursiveInput = floatingSearch.querySelector('.sftp-search-recursive input');
      if (recursiveInput) {
        recursiveInput.checked = true;
        recursiveInput.dispatchEvent(new Event('change',{bubbles:true}));
      }
      await new Promise(resolve=>setTimeout(resolve,10));
      window.termaSftpView.searchBusy(fixtureTabKey, true);
      const searchFeedback = getComputedStyle(floatingSearch.querySelector('.lucide-loader-circle')).display !== 'none'
        && getComputedStyle(floatingSearch.querySelector('.lucide-loader-circle')).animationName === 'state-spin'
        && floatingSearch.getAttribute('aria-busy') === 'true';
      window.termaSftpView.searchBusy(fixtureTabKey, false);
      searchInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      searchKeyboardUi = {
        opened:shortcutOpened,
        closed:floatingSearch.hidden,
        recursive:Boolean(sftpTabRuntimes.get(fixtureTabKey)?.state.recursiveSearch),
        feedback:searchFeedback
      };
      const favorites = view.querySelector('#sftpFavorites');
      const shell = view.querySelector('.sftp-shell');
      const previousFavoriteStorage = localStorage.getItem('sftpFavorites');
      const previousFavoriteItems = window.termaSftpPreferences.snapshot();
      const otherFavoriteItems = previousFavoriteItems.filter(item=>Number(item.connectionId)!==Number(connection.id));
      const replaceFavorites = items=>{localStorage.setItem('sftpFavorites',JSON.stringify(items));window.termaSftpPreferences.reload();};
      const previousShellStyle = shell.style.cssText;
      const previousStickyTopStyle = stickyTop.style.cssText;
      replaceFavorites(otherFavoriteItems);
      window.termaSftpView.refreshDirectoryActions(fixtureTabKey);
      const emptyFavoritesRect = favorites.getBoundingClientRect();
      const emptyNavigationRect = navigationRow.getBoundingClientRect();
      const emptyStickyTopRect = stickyTop.getBoundingClientRect();
      const listRect = view.querySelector('#sftpList').getBoundingClientRect();
      const emptyFavoritesMinHeight = parseFloat(getComputedStyle(favorites).minHeight);
      const emptyFavoritesCompact = favorites.classList.contains('is-empty')
        && getComputedStyle(favorites).display === 'none'
        && emptyFavoritesRect.height === 0
        && emptyNavigationRect.height < 60
        && listRect.top - emptyStickyTopRect.bottom >= 0
        && listRect.top - emptyStickyTopRect.bottom <= 12;
      replaceFavorites([...otherFavoriteItems,{connectionId:connection.id,path:'/',name:'根目录'}]);
      window.termaSftpView.refreshDirectoryActions(fixtureTabKey);
      const naturalNavigationHeight = navigationRow.getBoundingClientRect().height;
      const naturalTopHeight = stickyTop.getBoundingClientRect().height;
      shell.style.height = '900px';
      const tallShellNavigationHeight = navigationRow.getBoundingClientRect().height;
      const tallShellTopHeight = stickyTop.getBoundingClientRect().height;
      const wideNavigationCompact = naturalNavigationHeight < 60
        && tallShellNavigationHeight < 60
        && naturalTopHeight < 180
        && tallShellTopHeight < 180
        && Math.abs(tallShellTopHeight - naturalTopHeight) < 1
        && getComputedStyle(shell).display === 'flex'
        && getComputedStyle(shell).flexDirection === 'column'
        && getComputedStyle(shell).alignItems === 'stretch'
        && getComputedStyle(stickyTop).display === 'flex'
        && getComputedStyle(stickyTop).flexDirection === 'column';
      shell.style.cssText = previousShellStyle;
      stickyTop.style.cssText = previousStickyTopStyle;
      if(previousFavoriteStorage===null)localStorage.removeItem('sftpFavorites');else localStorage.setItem('sftpFavorites',previousFavoriteStorage);
      window.termaSftpPreferences.reload();
      window.termaSftpView.refreshDirectoryActions(fixtureTabKey);
      const narrowHint = document.createElement('span');
      narrowHint.className = 'muted';
      narrowHint.textContent = '收藏当前目录后可快速跳转';
      favorites.appendChild(narrowHint);
      const previousFavoritesEmpty = favorites.classList.contains('is-empty');
      favorites.classList.add('is-empty');
      const previousViewStyle = view.style.cssText;
      view.style.width = '650px';
      view.style.flex = '0 0 650px';
      const narrowNavigationRect = navigationRow.getBoundingClientRect();
      const narrowTopRect = stickyTop.getBoundingClientRect();
      const narrowNavigationCompact = narrowNavigationRect.height < 100
        && narrowTopRect.height < 200
        && getComputedStyle(favorites).display === 'none';
      view.style.cssText = previousViewStyle;
      favorites.classList.toggle('is-empty', previousFavoritesEmpty);
      narrowHint.remove();

      directoryActionsUi = {
        found:Boolean(stickyTop && toolbar && navigationRow && breadcrumb && pathEditor && floatingSearch && dropOverlay),
        rapidSftpOpenUi,
        recoveredMissingToolbar,
        duplicateSftpToolbarsFollowActiveTab,
        sftpVisibleNumberingStable,
        activeShellMatchesTab,
        parentNavigationStaysOnOwner,
        duplicateDirectoryStateIsolated,
        duplicateHistoryIsolated,
        duplicateShellMatchesTab,
        toolbarAnywhere:Boolean(toolbar && (document.querySelector('#workspaceGlobalHeaderTools')?.contains(toolbar) || fixturePane?.querySelector('[data-workspace-role="header-tools"]')?.contains(toolbar))),
        stickyPosition:stickyTop ? getComputedStyle(stickyTop).position : '',
        toolbarInHeader:Boolean(document.querySelector('#workspaceGlobalHeaderTools')?.contains(toolbar) || fixturePane?.querySelector('[data-workspace-role="header-tools"]')?.contains(toolbar)),
        navigationBeforeFavorites:Boolean(breadcrumb && favorites && (breadcrumb.compareDocumentPosition(favorites) & Node.DOCUMENT_POSITION_FOLLOWING)),
        actionTitles,
        searchHidden:floatingSearch.hidden,
        pathEditorHidden:pathEditor.hidden,
        pathEditorReplacesBreadcrumb,
        emptyClipboardHidden,
        copyQueueVisible,
        copyCancelled,
        moveQueueVisible,
        moveCancelled,
        crossHostCopyEnabled,
        crossHostMoveDisabled,
        crossHostClipboardConflict,
        crossHostConflictPrompted,
        crossHostConflictBody,
        crossHostClipboardCleared:window.termaSftpFileActions.clipboard.value === null,
        filenameEncodingMenu,
        emptyFavoritesCompact,
        emptyFavoritesMetrics:{height:emptyFavoritesRect.height,minHeight:emptyFavoritesMinHeight,listGap:listRect.top-emptyStickyTopRect.bottom},
        wideNavigationCompact,
        narrowNavigationCompact,
        terminalJump:Boolean(toolbar?.querySelector('button[title="打开此连接的终端"]')),
        terminalJumpFirst:actionTitles[0] === '打开此连接的终端',
        reusedWithoutDirectoryReload
      };

      try {
        await window.termaSftpGlobalSettings.open();
        const globalSettingsModal = document.querySelector('#modal');
        const globalSettingsCard = globalSettingsModal?.querySelector('.sftp-global-settings-modal');
        const globalSettingsRect = globalSettingsCard?.getBoundingClientRect();
        const globalSettingsChildren = [...globalSettingsCard?.children || []];
        const globalSettingsSamplers = [globalSettingsCard, ...globalSettingsChildren].filter(node => {
          const style = getComputedStyle(node);
          const filter = String(style.backdropFilter || '') + ' ' + String(style.getPropertyValue('-webkit-backdrop-filter') || '');
          return filter.includes('blur(') && !filter.includes('blur(0px)');
        });
        globalSettingsModal?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
        const taskCenterSetting = document.querySelector('#taskCenterFloatingProgressEnabled');
        const taskCenterSettingsSection = taskCenterSetting?.closest('section');
        globalSettingsUi = {
          found:Boolean(document.querySelector('#sftpGlobalSettingsButton') && globalSettingsCard && !globalSettingsModal?.hidden),
          globalScope:Boolean(globalSettingsCard?.textContent.includes('应用到所有 SFTP 标签和连接')),
          controls:Boolean(document.querySelector('#sftpRecycleBinEnabled')
            && document.querySelector('#sftpMaxOpenFileSizeMb')
            && document.querySelector('#sftpTextEditorMode')
            && !document.querySelector('#sftpInternalEditorOpenMode')
            && document.querySelector('#sftpDoubleClickFileAction')
            && document.querySelector('#sftpSettingsTabTransfer')
            && document.querySelector('#sftpDownloadConcurrency')
            && document.querySelector('#sftpUploadConcurrency')
            && document.querySelector('#sftpLightEditorThresholdMb')
            && (!window.termaDesktop || (document.querySelector('#sftpExternalEditSaveRule') && document.querySelector('#sftpExternalEditBackupEnabled')))
            && document.querySelector('#sftpGlobalSettingsSave')),
          floatingProgressDefaultOn:Boolean(taskCenterSetting?.checked),
          floatingProgressCanRestore:Boolean(taskCenterSettingsSection?.closest('#settings-notifications') && taskCenterSettingsSection.textContent.includes('悬浮任务进度卡')),
          downloadBehavior:Boolean(globalSettingsCard?.textContent.includes('SFTP 自动保存目录') || globalSettingsCard?.textContent.includes('当前设备的浏览器下载目录')),
          defaultLimit:document.querySelector('#sftpMaxOpenFileSizeMb')?.value === '50',
          backdropIgnored:Boolean(globalSettingsCard?.isConnected && !globalSettingsModal?.hidden),
          withinViewport:Boolean(globalSettingsRect && globalSettingsRect.left >= -0.5 && globalSettingsRect.right <= innerWidth + 0.5 && globalSettingsRect.top >= -0.5 && globalSettingsRect.bottom <= innerHeight + 0.5),
          classicSurface:globalSettingsSamplers.length === 0,
          themedField:Boolean(globalSettingsCard?.querySelector('input') && getComputedStyle(globalSettingsCard.querySelector('input')).backgroundColor !== 'rgba(0, 0, 0, 0)')
        };
      } finally {
        window.termaSftpGlobalSettings.close();
      }

      const cachePreviousApi = api;
      const cachePreviousRender = window.termaSftpView.render;
      const directoryCache = window.termaSftpDirectoryWorkspace.cache;
      try {
        const cachePath = '/cache-behavior';
        const tabKey = fixtureTabKey;
        activeTabKey = tabKey;
        activeView = 'sftp';
        window.termaSftpViews?.release(tabKey);
        view.dataset.sftpTabKey = tabKey;
        view.innerHTML = '<div class="sftp-shell"><div id="sftpList" class="sftp-list"><div class="sftp-head"></div></div></div>';
        const cacheRuntime = window.termaSftpTabs.runtime.ensure(tabKey, connection.id, cachePath, view);
        cacheRuntime.state = {
          ...cacheRuntime.state,
          connectionId:connection.id,
          path:cachePath,
          entries:[{name:'stable.txt',type:'file',size:1,mtime:1,mode:'644',owner:'root',group:'root'}],
          query:'',
          sort:'name',
          dir:'asc',
          page:1,
          pageSize:50,
          total:1,
          totalPages:1,
          unfilteredTotal:1,
          selected:null,
          loading:false
        };

        let responseEntries = cacheRuntime.state.entries.map(entry=>({...entry}));
        let silentRenders = 0;
        api = async () => ({
          path:cachePath,
          entries:responseEntries.map(entry=>({...entry})),
          page:1,
          page_size:50,
          total:responseEntries.length,
          total_pages:1,
          unfiltered_total:responseEntries.length
        });
        window.termaSftpView.render = () => { silentRenders += 1; };
        window.termaSftpDirectoryWorkspace.loader.load = previousLoadSftpPage;
        const checkedCacheLoad = options => Promise.race([
          window.termaSftpDirectoryWorkspace.loader.load(options),
          new Promise((_, reject) => setTimeout(() => reject(new Error('SFTP silent cache load timed out')), 5000))
        ]);
        await checkedCacheLoad({connectionId:connection.id,path:cachePath,page:1,tabKey,refresh:true,keepContents:true,preserveView:true,silent:true,renderIfChangedOnly:true});
        const sameResponseUntouched = silentRenders === 0 && !view.querySelector('#sftpList')?.classList.contains('is-refreshing');
        responseEntries = [...responseEntries,{name:'new.txt',type:'file',size:2,mtime:2,mode:'644',owner:'root',group:'root'}];
        await checkedCacheLoad({connectionId:connection.id,path:cachePath,page:1,tabKey,refresh:true,keepContents:true,preserveView:true,silent:true,renderIfChangedOnly:true});
        const changedResponseRendered = silentRenders === 1 && cacheRuntime.state.entries.some(entry=>entry.name === 'new.txt');

        window.termaSftpView.render = cachePreviousRender;
        const safePath = '/home/demo';
        const safeEntries = [{name:'keep.txt',type:'file',size:3,mtime:3,mode:'644',owner:'demo',group:'demo'}];
        view.innerHTML = '<div class="sftp-shell"><nav id="sftpBreadcrumb" class="sftp-breadcrumb">'+sftpBreadcrumbHtml(connection.id,safePath,tabKey)+'</nav><input id="sftpPathInput" value="'+safePath+'"><button id="sftpConnectionToggle" data-status="connected"></button><div id="sftpConnectionBanner" hidden><span class="sftp-connection-detail"></span></div><div id="sftpList" class="sftp-list"></div></div>';
        view.dataset.sftpTabKey = tabKey;
        cacheRuntime.root = view;
        cacheRuntime.state = {...cacheRuntime.state,path:safePath,entries:safeEntries,selected:null,page:1,total:1,totalPages:1,unfilteredTotal:1,loading:false};

        const cacheTab = tabs.find(item => item.key === tabKey);
        if (cacheTab) cacheTab.path = safePath;
        window.termaSftpView.render(tabKey);
        const safeList = view.querySelector('#sftpList');
        safeList.scrollTop = 4;
        const beforePermissionListText = safeList.textContent;
        api = async () => {
          const error = new Error('没有权限访问远程目录：/root');
          error.code = 'SFTP_DIRECTORY_PERMISSION_DENIED';
          error.status = 403;
          throw error;
        };
        const permissionLoaded = await checkedCacheLoad({connectionId:connection.id,path:'/root',page:1,tabKey});
        const permissionRestoreChecks = {
          rejected:permissionLoaded === false,
          runtimePath:cacheRuntime.state.path === safePath,
          runtimeEntries:cacheRuntime.state.entries?.[0]?.name === 'keep.txt',
          tabPath:cacheTab?.path === safePath,
          breadcrumbSafe:Boolean(view.querySelector('#sftpBreadcrumb')?.textContent.includes('demo') && !view.querySelector('#sftpBreadcrumb')?.textContent.includes('/root')),
          listPreserved:Boolean(view.querySelectorAll('#sftpList .sftp-row').length === 1 && view.querySelector('#sftpList .sftp-file-name')?.textContent === 'keep.txt' && !view.querySelector('#sftpList')?.textContent.includes('没有权限')),
          connectionPreserved:view.querySelector('#sftpConnectionToggle')?.dataset.status === 'connected'
        };
        const permissionFailureRestored = Object.values(permissionRestoreChecks).every(Boolean);

        directoryCache.clearConnection(Number(connection.id));
        const hundredEntries = Array.from({length:100},(_,index)=>({name:'entry-'+index,type:'file',size:index,mtime:index}));
        for (let index=0; index<65; index += 1) {
          cacheRuntime.state = {...cacheRuntime.state,path:'/cache-'+index,entries:hundredEntries};
          window.termaSftpDirectoryWorkspace.cache.cache(tabKey,cacheRuntime.state.path,{scrollTop:0,selectedPaths:[],activePath:''});
        }
        const cachedPages = Array.from({length:80}, (_,index) => directoryCache.get(Number(connection.id), '/cache-'+index)).filter(Boolean);
        const totalCachedEntries = cachedPages.reduce((sum,item)=>sum+item.state.entries.length,0);
        const bounded = cachedPages.length > 0 && cachedPages.length <= 60 && totalCachedEntries <= 5000;
        directoryCache.prune(Date.now() + 10 * 60 * 1000 + 1);
        const expired = !directoryCache.get(Number(connection.id), '/cache-79');
        directoryCacheBehavior = {sameResponseUntouched,changedResponseRendered,boundedAndExpired:bounded&&expired,permissionFailureRestored,permissionRestoreChecks,permissionRestoreDiagnostics:{runtimePath:cacheRuntime.state.path,tabPath:cacheTab?.path,breadcrumb:view.querySelector('#sftpBreadcrumb')?.textContent||'',list:view.querySelector('#sftpList')?.textContent||'',beforePermissionListText,connectionStatus:view.querySelector('#sftpConnectionToggle')?.dataset.status||''}};
      } finally {
        api = cachePreviousApi;
        window.termaSftpView.render = cachePreviousRender;
        directoryCache.clearConnection(Number(connection.id));
      }
    } finally {
      window.termaSftpDirectoryWorkspace.loader.load = previousLoadSftpPage;
      window.termaSftpTaskWorkspace.runtime.refresh = previousRefreshSftpJobs;
      window.termaSftpTransferLifecycle.polling.start = previousStartSftpJobsTimer;
      window.termaSftpFileActions.clipboard.value = previousClipboardState;

      selectedId = previousSelectedId;
      activeView = previousActiveView;
      activeTabKey = previousActiveTabKey;
    }
    const actions = [];
    window.termaSftpPage.open = (id, path) => actions.push({kind:'dir', id, path});
    window.termaSftpView.navigate = (path, tabKey) => actions.push({kind:'dir', id:tabs.find(tab => tab.key === tabKey)?.id, path, tabKey});
    window.termaSftpDirectoryWorkspace.navigation.navigatePath = (tabKey, path) => window.termaSftpView.navigate(path, tabKey);
    window.termaSftpPreviewRuntime.text = (id, path) => actions.push({kind:'file', id, path});
    const specialName = "weird" + String.fromCharCode(39, 34) + "<&>.bin";
    activeTabKey = fixtureTabKey;
    activeView = 'sftp';
    const fixturePaneState = workspaceFindPaneForTab(fixtureTabKey);
    if (fixturePaneState) {
      fixturePaneState.activeTabKey = fixtureTabKey;
      focusedPaneId = fixturePaneState.id;
    }
    view.hidden = false;
    view.dataset.sftpTabKey = fixtureTabKey;
    view.innerHTML = '<div class="sftp-shell"><div class="sftp-top"><div class="sftp-path-block"><div class="sftp-title">iMac</div><nav class="sftp-breadcrumb" id="sftpBreadcrumb" aria-label="远程目录路径">'+sftpBreadcrumbHtml(1,'/Users/demo/Public')+'</nav></div><div class="sftp-top-actions"></div><div class="sftp-selection-bar" id="sftpSelectionBar" hidden><div class="sftp-selected" id="sftpSelectedInfo"></div><div class="sftp-selection-actions"><button id="sftpSelectionCompress">压缩</button><button id="sftpSelectionPermissions">权限</button><button id="sftpSelectionExtract" hidden>解压</button><button>复制</button><button>移动</button><button>删除</button><button onclick="window.termaSftpView.clearSelection()">取消</button></div></div></div><div id="sftpList" class="sftp-list"></div></div>';
    const pageEntries = [
      {name:'folder', type:'dir', size:0, mtime:0, mode:'755', owner:'root', group:'wheel'},
      {name:specialName, type:'file', size:12, mtime:'2026-07-20T12:34:56Z', mode:'600', owner:'demo', group:'staff'},
      {name:'vmlinuz', type:'file', size:8181696, mtime:'2026-07-20T12:40:00Z', mode:'644', owner:'root', group:'root', is_symlink:true, link_size:27, link_target_missing:false},
      ...Array.from({length:47},(_,index)=>({name:'file-'+String(index+1).padStart(2,'0')+'.txt',type:'file',size:index+1,mtime:index+1,mode:'644',owner:'demo',group:'staff'}))
    ];
    // This legacy row fixture uses connection 1 in its mocked requests and handlers.
    // Keep the tab identity consistent with its runtime so dialog guards remain active.
    tabs.find(tab => tab.key === fixtureTabKey).id = 1;
    const fixtureRuntime = window.termaSftpTabs.runtime.ensure(fixtureTabKey, 1, '/fixture', view);
    fixtureRuntime.state = {...fixtureRuntime.state, connectionId:1, path:'/fixture', query:'', sort:'name', dir:'asc', selected:null, page:1, pageSize:50, total:75, totalPages:2, unfilteredTotal:75, entries:pageEntries};
    fixtureRuntime.root = view;
    view.dataset.sftpTabKey = fixtureTabKey;
    activeTabKey = fixtureTabKey;

    window.termaSftpView.render(fixtureTabKey);
    const rows = [...view.querySelectorAll('.sftp-row')];
    const feedbackPath = '/fixture/' + specialName;
    const feedbackButton = rows[1]?.querySelector('.sftp-file-open-button');
    let finishFeedbackRequest;
    let duplicateFeedbackRequestRan = false;
    const feedbackRequest = window.termaSftpTabs.view.opening(1, feedbackPath, () => new Promise(resolve => { finishFeedbackRequest = resolve; }));
    await Promise.resolve();
    const feedbackBusy = Boolean(feedbackButton?.disabled && feedbackButton?.getAttribute('aria-busy') === 'true' && feedbackButton?.textContent.includes('打开中'));
    await window.termaSftpTabs.view.opening(1, feedbackPath, async () => { duplicateFeedbackRequestRan = true; });
    finishFeedbackRequest?.({ok:true});
    await feedbackRequest;
    const pauseEvents = [];
    const openProgress = createProgressToast({
      title:'正在打开 smoke.txt',
      detail:'正在读取 · 1 MB / 2 MB',
      progress:50,
      onPauseChange:value=>pauseEvents.push(value)
    });
    const openProgressToast = document.querySelector('.toast-progress');
    const openProgressInTaskCenter = Boolean(openProgressToast?.closest('#sftpTaskCenter'));
    openProgressToast?.querySelector('.toast-progress-pause')?.click();
    const openProgressPaused = Boolean(openProgressToast?.classList.contains('paused') && openProgressToast?.textContent.includes('继续'));
    openProgressToast?.querySelector('.toast-progress-pause')?.click();
    const openProgressResumed = Boolean(!openProgressToast?.classList.contains('paused') && pauseEvents.join(',') === 'true,false');
    openProgress.dismiss();
    const previousOpenFetch = window.fetch;
    const previousEnsureSftpConnection = window.termaSftpConnection.ensure;
    const previousCreateProgressToast = createProgressToast;
    let retryFetches = 0;
    const retryProgressUpdates = [];
    let retryOpened = null;
    try {
      window.termaSftpConnection.ensure = async () => true;
      createProgressToast = () => ({
        update:value=>retryProgressUpdates.push(value),
        fail() {},
        finish() {},
        complete() {},
        dismiss() {}
      });
      window.fetch = async (input, options) => {
        const url = String(input?.url || input || '');
        if (!url.includes('/api/connections/1/sftp/open?path=%2Ffixture%2Fretry.txt')) return previousOpenFetch(input, options);
        retryFetches += 1;
        const body = retryFetches === 1
          ? new ReadableStream({start(controller) { controller.enqueue(new Uint8Array([1,2])); controller.error(new TypeError('network error')); }})
          : new ReadableStream({start(controller) { controller.enqueue(new Uint8Array([1,2,3,4])); controller.close(); }});
        return new Response(body, {status:200,headers:{'X-Terma-File-Size':'4','X-Terma-File-Limit':'52428800'}});
      };
      retryOpened = await window.termaFileOpen.read(1, '/fixture/retry.txt');
    } finally {
      window.fetch = previousOpenFetch;
      window.termaSftpConnection.ensure = previousEnsureSftpConnection;
      createProgressToast = previousCreateProgressToast;
    }
    const fileOpenFeedback = {
      busy:feedbackBusy,
      duplicateBlocked:!duplicateFeedbackRequestRan,
      restored:Boolean(feedbackButton && !feedbackButton.disabled && feedbackButton.getAttribute('aria-busy') === 'false' && feedbackButton.textContent.includes('打开')) && !openProgressInTaskCenter && openProgressPaused && openProgressResumed,
      progressOutsideTaskCenter:!openProgressInTaskCenter,
      pausable:openProgressPaused&&openProgressResumed,
      interruptedRetry:Boolean(retryFetches === 2 && retryOpened?.bytes?.join(',') === '1,2,3,4' && retryProgressUpdates.some(item=>String(item?.detail || '').includes('自动重试'))),
      retryFetches,
      retryBytes:retryOpened?.bytes?.join(',') || '',
      retryDetails:retryProgressUpdates.map(item=>String(item?.detail || '')),
      buttonDiagnostics:{found:Boolean(feedbackButton),disabled:feedbackButton?.disabled,ariaBusy:feedbackButton?.getAttribute('aria-busy'),text:feedbackButton?.textContent||'',connectionId:feedbackButton?.dataset.sftpConnectionId||'',remotePath:feedbackButton?.dataset.sftpRemotePath||'',expectedPath:feedbackPath,runtimeRootConnected:Boolean(fixtureRuntime.root?.isConnected),runtimeRootTabKey:fixtureRuntime.root?.dataset.sftpTabKey||'',activeTabKey}
    };
    const idleDirectorySizeButton = rows[0]?.querySelector('.sftp-directory-size-button');
    const idleDirectorySizeText = idleDirectorySizeButton?.textContent || '';
    const previousDirectorySizeApi = api;
    let directorySizeRequests = 0;
    try {
      api = async (url, options={}) => {
        if (url.endsWith('/sftp/directory-size')) {
          directorySizeRequests += 1;
          return {path:'/fixture/folder',size:6146,size_bytes:'6146',method:'recursive-file-bytes'};
        }
        return previousDirectorySizeApi(url, options);
      };
      await window.termaSftpDirectoryWorkspace.cache.readSize(1, '/fixture/folder');
    } finally {
      api = previousDirectorySizeApi;
    }
    const readyDirectorySizeButton = rows[0]?.querySelector('.sftp-directory-size-button');
    const directorySizeUi = {
      idleButton:Boolean(idleDirectorySizeButton && idleDirectorySizeText.includes('读取')),
      requestedOnce:directorySizeRequests === 1,
      exactBytes:Boolean(readyDirectorySizeButton?.title.includes('6146 字节')),
      formatted:Boolean(readyDirectorySizeButton?.textContent.includes('6.0 KB')),
      refreshable:Boolean(readyDirectorySizeButton?.title.includes('点击重新读取'))
    };
    rows[0]?.dispatchEvent(new MouseEvent('dblclick', {bubbles:true, cancelable:true}));
    rows[1]?.dispatchEvent(new MouseEvent('dblclick', {bubbles:true, cancelable:true}));
    const top = view.querySelector('.sftp-top');
    const stickyPosition = top ? getComputedStyle(top).position : '';
    view.dataset.sftpTabKey = fixtureTabKey;
    fixtureRuntime.root = view;

    const checks = [...view.querySelectorAll('.sftp-check')];
    window.termaSftpView.clearSelection(fixtureTabKey);
    checks[0].click();
    checks[1].click();
    const selectCheck = input => window.termaSftpViews.select(fixtureTabKey,1,{}, {path:input.value,name:input.dataset.name,type:input.dataset.type});
    selectCheck(checks[2]);
    const multiNameAddsSelection = checks.slice(0,3).every(input => input.checked);
    selectCheck(checks[2]);
    const multiNameCancelsSelection = checks[0].checked && checks[1].checked && !checks[2].checked;
    selectCheck(checks[1]);
    selectCheck(checks[2]);
    const singleNameReplacesSelection = !checks[0].checked && !checks[1].checked && checks[2].checked;
    checks.forEach((input,index) => { if (input.checked !== (index < 2)) input.click(); });
    const selectionBar = view.querySelector('#sftpSelectionBar');
    const selectionShown = !selectionBar.hidden && selectionBar.textContent.includes('已选择 2 项');
    const selectionActionsShown = getComputedStyle(document.querySelector('#sftpSelectionCompress')).display !== 'none' && getComputedStyle(document.querySelector('#sftpSelectionPermissions')).display !== 'none';
    const specialSelectionExact = window.termaSftpView.selectedPaths(fixtureTabKey).includes('/fixture/' + specialName);
    const selectedRows = view.querySelectorAll('.sftp-row.is-selected').length;
    window.termaSftpDragWorkspace.drag.select(checks[2].value, checks[2].dataset.name, checks[2].dataset.type, fixtureTabKey);
    const dragSelectionSynchronized = checks.every((input,index) => input.checked === (index === 2))
      && rows.every((row,index) => row.classList.contains('is-selected') === (index === 2))
      && rows.every((row,index) => row.classList.contains('active') === (index === 2));
    window.termaSftpView.clearSelection(fixtureTabKey);
    const selectionCleared = selectionBar.hidden;
    const moreButton = rows[1]?.querySelector('.sftp-row-action-more');
    moreButton?.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, clientX:320, clientY:240}));
    const moreMenuLabels = [...document.querySelectorAll('#actionMenu button span')].map(node => node.textContent.trim());
    const moreMenuOpened = moreMenuLabels.includes('以文本打开') && moreMenuLabels.includes('压缩') && moreMenuLabels.includes('设置权限') && moreMenuLabels.includes('删除');
    hideActionMenu();
    rows[0]?.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, clientX:260, clientY:220}));
    const directoryMenuText = document.querySelector('#actionMenu')?.textContent || '';
    const contextMenuOpened = Boolean(document.querySelector('#actionMenu')) && directoryMenuText.includes('打开') && directoryMenuText.includes('下载') && directoryMenuText.includes('压缩') && directoryMenuText.includes('设置权限');
    const directoryDownloadMenu = directoryMenuText.includes('下载');
    hideActionMenu();
    const fileHasCompression = Boolean(rows[1]?.querySelector('.sftp-row-action[title="压缩"]'));
    const fileHasPermissions = Boolean(rows[1]?.querySelector('.sftp-row-action[data-menu-action="permissions"], .sftp-row-action[title="权限"]'));
    const unknownAction = Boolean(rows[1]?.querySelector('.sftp-file-open-button[data-sftp-open-kind="text"]'));
    const permissionOwnerColumn = rows[1]?.querySelector(':scope > .sftp-access code')?.textContent === '600' && rows[1]?.querySelector(':scope > .sftp-access span')?.textContent === 'demo';
    const permissionOwnerTitle = rows[1]?.querySelector(':scope > .sftp-access')?.title.includes('用户组 staff');
    const symlinkUsesTargetSize = rows[2]?.querySelector(':scope > .sftp-size')?.textContent === window.termaSftpTaskWorkspace.presentation.bytes(8181696);
    const symlinkExplainsBothSizes = rows[2]?.querySelector('.sftp-name')?.title.includes(window.termaSftpTaskWorkspace.presentation.bytes(8181696))
      && rows[2]?.querySelector('.sftp-name')?.title.includes(window.termaSftpTaskWorkspace.presentation.bytes(27));
    const symlinkMarked = rows[2]?.querySelector('.sftp-icon')?.classList.contains('symlink');
    window.termaSftpFileActions.operations.permissions(fixtureTabKey, ['/fixture/folder']);
    const permissionModal = document.querySelector('#sftpPermissionMode');
    permissionModal.value = '640';
    permissionModal.dispatchEvent(new Event('input', {bubbles:true}));
    const permissionModeSync = permissionModal.value === '640' && document.querySelector('[data-permission="ownerWrite"]')?.checked && !document.querySelector('[data-permission="ownerExecute"]')?.checked;
    const recursiveVisible = Boolean(document.querySelector('#sftpPermissionRecursive'));
    document.querySelector('#sftpPermissionCancel')?.click();
    const breadcrumbText = document.querySelector('#view-sftp #sftpBreadcrumb')?.textContent.replace(/s+/g,' ').trim() || '';
    const breadcrumbLabels = [...document.querySelectorAll('#view-sftp #sftpBreadcrumb .crumb')].map(node => node.textContent.trim());
    const compactRowHeight = rows[0]?.getBoundingClientRect().height || 0;
    const sftpList = document.querySelector('#view-sftp #sftpList');
    sftpList.style.width = '1280px';
    window.termaSftpColumns.syncSftpListLayout(sftpList, 1280);
    const head = sftpList.querySelector('.sftp-head');
    const alignmentSelectors = ['.sftp-size','.sftp-time','.sftp-access','.sftp-head-actions'];
    const rowAlignmentSelectors = ['.sftp-size','.sftp-time','.sftp-access','.sftp-row-actions'];
    const wideColumnAlignment = alignmentSelectors.every((selector,index) => {
      const headLeft = head.querySelector(selector)?.getBoundingClientRect().left;
      const rowLeft = rows[0]?.querySelector(':scope > ' + rowAlignmentSelectors[index])?.getBoundingClientRect().left;
      return Number.isFinite(headLeft) && Number.isFinite(rowLeft) && Math.abs(headLeft - rowLeft) <= 1;
    });
    const wideActions = rows[0]?.querySelector(':scope > .sftp-row-actions');
    const wideLastAction = wideActions?.lastElementChild;
    const wideActionsFit = Boolean(wideActions && wideLastAction && wideLastAction.getBoundingClientRect().right <= wideActions.getBoundingClientRect().right + 1);
    sftpList.style.width = '760px';
    window.termaSftpColumns.syncSftpListLayout(sftpList, 760);
    const compactSizeVisible = getComputedStyle(rows[1].querySelector(':scope > .sftp-size')).display !== 'none';
    const compactTimeVisible = getComputedStyle(rows[1].querySelector(':scope > .sftp-time')).display !== 'none';
    const compactAccessVisible = getComputedStyle(rows[1].querySelector(':scope > .sftp-access')).display !== 'none';
    const compactMediumHidden = getComputedStyle(rows[1].querySelector('.sftp-row-action-medium')).display === 'none';
    const compactCoreVisible = getComputedStyle(rows[1].querySelector('.sftp-row-action-core')).display !== 'none';
    const compactNoOverflow = sftpList.scrollWidth <= sftpList.clientWidth + 1;
      const compactHorizontalScroll = sftpList.scrollWidth <= sftpList.clientWidth + 1
        && !['auto','scroll'].includes(getComputedStyle(sftpList).overflowX)
        && document.documentElement.scrollWidth <= innerWidth + 1;
    sftpList.style.width = '390px';
    window.termaSftpColumns.syncSftpListLayout(sftpList, 390);
    const narrowListWidth = sftpList.getBoundingClientRect().width;
    const narrowCoreDisplay = getComputedStyle(rows[0].querySelector('.sftp-row-action-core')).display;
    const narrowCoreHidden = narrowCoreDisplay === 'none';
    const narrowMoreVisible = getComputedStyle(rows[0].querySelector('.sftp-row-action-more')).display !== 'none';
    const narrowMeta = rows[1].querySelector('.sftp-mobile-meta');
    const narrowMetaDisplay = narrowMeta ? getComputedStyle(narrowMeta).display : '';
    const narrowMetaText = narrowMeta?.textContent || '';
    const narrowMetaVisible = Boolean(
      narrowMeta
      && narrowMetaDisplay !== 'none'
      && narrowMetaText.replace(/\\s+/g,'').includes(window.termaSftpTaskWorkspace.presentation.bytes(12).replace(/\\s+/g,''))
      && !narrowMetaText.includes('Invalid Date')
    );
    const narrowAccessHidden = getComputedStyle(rows[1].querySelector(':scope > .sftp-access')).display === 'none';
    const narrowLayoutClass = sftpList.classList.contains('sftp-actions-more-only');
    const narrowHeaderNameVisible = getComputedStyle(sftpList.querySelector('.sftp-head-cell.sftp-column-name')).display !== 'none';
    const narrowHeaderSummaryVisible = getComputedStyle(sftpList.querySelector('.sftp-compact-column-labels')).display !== 'none'
      && sftpList.querySelector('.sftp-compact-column-labels')?.textContent.includes('大小');
    const narrowCompactActions = Math.round((rows[0]?.querySelector('.sftp-row-actions')?.getBoundingClientRect().width || 0)) <= 60;
    const previousColumnLayout = localStorage.getItem(window.termaSftpColumns.storageKey);
    window.termaSftpColumns.writeSftpColumnLayout({order:['name','size','mtime','access'],weights:{name:2.45,size:.72,mtime:1.28,access:1.34},actionWeight:3.6});
    sftpList.style.width = '760px';
    window.termaSftpColumns.syncSftpListLayout(sftpList, 760);
    window.termaSftpView.render(fixtureTabKey);
    const compactColumnList = document.querySelector('#view-sftp #sftpList');
    const compactAccessHeader = compactColumnList.querySelector('.sftp-head [data-sftp-column="access"]');
    const compactActionsHeader = compactColumnList.querySelector('.sftp-head-actions');
    const compactAccessHandle = compactColumnList.querySelector('[data-sftp-column-resize="access"]');
    const compactNameHeader = compactColumnList.querySelector('.sftp-head [data-sftp-column="name"]');
    const compactNameHandle = compactColumnList.querySelector('[data-sftp-column-resize="name"]');
    const compactFollowingBoundariesBefore = ['size','mtime','access'].map(key => compactColumnList.querySelector('[data-sftp-column="' + key + '"]')?.getBoundingClientRect().right || 0);
    const compactOpenButtonBefore = compactColumnList.querySelector('.sftp-row .sftp-file-open-button')?.getBoundingClientRect().left || 0;
    const compactNameBoundaryBefore = compactNameHeader?.getBoundingClientRect().right || 0;
    const compactNameHandleRect = compactNameHandle?.getBoundingClientRect();
    const compactNameStartX = compactNameHandleRect ? compactNameHandleRect.left + compactNameHandleRect.width / 2 : compactNameBoundaryBefore;
    compactNameHandle?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:540,pointerType:'mouse',button:0,buttons:1,clientX:compactNameStartX,clientY:(compactNameHandleRect?.top || 0) + 8}));
    document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:540,pointerType:'mouse',button:0,buttons:1,clientX:compactNameStartX-20,clientY:(compactNameHandleRect?.top || 0) + 8}));
    document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:540,pointerType:'mouse',button:0,buttons:0,clientX:compactNameStartX-20,clientY:(compactNameHandleRect?.top || 0) + 8}));
    const compactFollowingBoundariesAfter = ['size','mtime','access'].map(key => compactColumnList.querySelector('[data-sftp-column="' + key + '"]')?.getBoundingClientRect().right || 0);
    const compactOpenButtonAfter = compactColumnList.querySelector('.sftp-row .sftp-file-open-button')?.getBoundingClientRect().left || 0;
    const compactAdjacentResizeStable = Math.abs((compactNameHeader?.getBoundingClientRect().right || 0) - (compactNameBoundaryBefore - 20)) <= 2
      && compactFollowingBoundariesBefore.every((boundary,index) => Math.abs(compactFollowingBoundariesAfter[index] - boundary) <= 1)
      && Math.abs(compactOpenButtonAfter - compactOpenButtonBefore) <= 1;
    const compactStableWidthsBefore = ['name','size','mtime'].map(key => compactColumnList.querySelector('[data-sftp-column="' + key + '"]')?.getBoundingClientRect().width || 0);
    const compactBoundaryBefore = compactAccessHeader?.getBoundingClientRect().right || 0;
    const compactHandleRect = compactAccessHandle?.getBoundingClientRect();
    const compactStartX = compactHandleRect ? compactHandleRect.left + compactHandleRect.width / 2 : compactBoundaryBefore;
    compactAccessHandle?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:541,pointerType:'mouse',button:0,buttons:1,clientX:compactStartX,clientY:(compactHandleRect?.top || 0) + 8}));
    document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:541,pointerType:'mouse',button:0,buttons:1,clientX:compactStartX-20,clientY:(compactHandleRect?.top || 0) + 8}));
    const compactBoundaryAfterFirstMove = compactAccessHeader?.getBoundingClientRect().right || 0;
    document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:541,pointerType:'mouse',button:0,buttons:1,clientX:compactStartX-20,clientY:(compactHandleRect?.top || 0) + 8}));
    const compactBoundaryAfterSecondMove = compactAccessHeader?.getBoundingClientRect().right || 0;
    document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:541,pointerType:'mouse',button:0,buttons:0,clientX:compactStartX-20,clientY:(compactHandleRect?.top || 0) + 8}));
    const compactStableWidthsAfter = ['name','size','mtime'].map(key => compactColumnList.querySelector('[data-sftp-column="' + key + '"]')?.getBoundingClientRect().width || 0);
    const compactPointerStable = Math.abs(compactBoundaryAfterFirstMove - (compactBoundaryBefore - 20)) <= 2
      && Math.abs(compactBoundaryAfterSecondMove - compactBoundaryAfterFirstMove) <= 1;
    const compactPairOnly = compactStableWidthsBefore.every((width,index) => Math.abs(compactStableWidthsAfter[index] - width) <= 1);
    const compactDividerUniform = Boolean(compactAccessHandle
      && compactActionsHeader
      && Math.abs(compactAccessHeader.getBoundingClientRect().right - compactActionsHeader.getBoundingClientRect().left) <= 1
      && getComputedStyle(compactAccessHeader).borderRightWidth === '0px'
      && getComputedStyle(compactAccessHandle,'::before').backgroundColor === getComputedStyle(compactColumnList.querySelector('[data-sftp-column-resize="name"]'),'::before').backgroundColor);

    const LOCAL_FILES_COLUMN_LAYOUT_STORAGE_KEY='termaLocalFilesColumnLayoutV1';
    const previousLocalColumnLayout = localStorage.getItem(LOCAL_FILES_COLUMN_LAYOUT_STORAGE_KEY);
    localStorage.setItem(LOCAL_FILES_COLUMN_LAYOUT_STORAGE_KEY,JSON.stringify({weights:{name:2.45,size:.98,mtime:1.28}}));
    const localColumnFixture = document.createElement('div');
    localColumnFixture.style.cssText = 'position:fixed;left:8px;top:8px;width:420px;height:180px;container-type:inline-size;container-name:local-files-view;z-index:-1';
    document.body.appendChild(localColumnFixture);
    const localColumnKey='ui-smoke-local',localColumnService=window.termaLocalFileRuntime.files,localColumnState=localColumnService.state(localColumnKey);
    Object.assign(localColumnState,{path:'/fixture',loaded:true,entries:[{name:'fixture.txt',path:'/fixture/fixture.txt',type:'file',size:12}],total:1});
    window.termaLocalFileViews.mount(localColumnFixture,{key:localColumnKey,service:localColumnService,state:localColumnState,mobile:false,fnos:false,text:tr,bytes:window.termaSftpTaskWorkspace.presentation.bytes,time:formatSftpTime,displayName:entry=>entry.name});
    const localColumnList = localColumnFixture.querySelector('.local-files-list');
    const localNameHeader = localColumnList.querySelector('[data-local-files-column="name"]');
    const localNameHandle = localColumnList.querySelector('[data-local-files-column-resize="name"]');
    const localSizeHandle = localColumnList.querySelector('[data-local-files-column-resize="size"]');
    const localHandleRect = localNameHandle?.getBoundingClientRect();
    const localStartX = localHandleRect ? localHandleRect.left + localHandleRect.width / 2 : 0;
    const localBoundaryBefore = localNameHeader?.getBoundingClientRect().right || 0;
    localNameHandle?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:542,pointerType:'mouse',button:0,buttons:1,clientX:localStartX,clientY:(localHandleRect?.top || 0) + 8}));
    document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:542,pointerType:'mouse',button:0,buttons:1,clientX:localStartX+24,clientY:(localHandleRect?.top || 0) + 8}));
    const localBoundaryAfterFirstMove = localNameHeader?.getBoundingClientRect().right || 0;
    document.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:542,pointerType:'mouse',button:0,buttons:1,clientX:localStartX+24,clientY:(localHandleRect?.top || 0) + 8}));
    const localBoundaryAfterSecondMove = localNameHeader?.getBoundingClientRect().right || 0;
    document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:542,pointerType:'mouse',button:0,buttons:0,clientX:localStartX+24,clientY:(localHandleRect?.top || 0) + 8}));
    const localNarrowResizable = Boolean(localNameHandle
      && !localNameHandle.hidden
      && localSizeHandle?.hidden
      && getComputedStyle(localColumnList.querySelector('[data-local-files-column="mtime"]')).display === 'none'
      && Math.abs(localBoundaryAfterFirstMove - (localBoundaryBefore + 24)) <= 2
      && Math.abs(localBoundaryAfterSecondMove - localBoundaryAfterFirstMove) <= 1
      && localColumnList.scrollWidth <= localColumnList.clientWidth + 1);
    const selectionToolbarFixture = document.createElement('div');
    selectionToolbarFixture.style.cssText = 'position:fixed;left:12px;top:12px;width:330px;z-index:2147483640';
    selectionToolbarFixture.innerHTML = '<div class="local-files-selection"><strong>已选择 <span>2</span> 项</strong><div class="local-files-selection-actions">'
      + '<button>打开</button><button>上传</button><button>路径</button><button>重命名</button><button>删除</button><button>权限</button><button class="icon-button" data-smoke-close aria-label="取消选择">×</button></div></div>';
    document.body.appendChild(selectionToolbarFixture);
    const selectionActions = selectionToolbarFixture.querySelector('.local-files-selection-actions');
    const selectionClose = selectionToolbarFixture.querySelector('[data-smoke-close]');
    selectionActions.scrollLeft = selectionActions.scrollWidth;
    const closeRect = selectionClose.getBoundingClientRect();
    const closeHit = document.elementFromPoint(closeRect.right - 2, closeRect.top + closeRect.height / 2);
    const selectionToolbarStable = getComputedStyle(selectionActions).overflowY === 'hidden'
      && selectionActions.scrollHeight <= selectionActions.clientHeight + 1
      && getComputedStyle(selectionClose).flexShrink === '0'
      && Boolean(closeHit === selectionClose || selectionClose.contains(closeHit));
    const scrollbarProbe = document.querySelector('.tree');
    const scrollbarStyles = [compactColumnList, localColumnList, scrollbarProbe]
      .filter(Boolean)
      .map(node => getComputedStyle(node).scrollbarColor);
    const scrollbarUnified = scrollbarStyles.length === 3
      && scrollbarStyles.every(value => value && value !== 'auto' && value === scrollbarStyles[0]);
    selectionToolbarFixture.remove();
    window.termaLocalFileViews.release(localColumnKey);localColumnService.dispose(localColumnKey);localColumnFixture.remove();
    if (previousLocalColumnLayout === null) localStorage.removeItem(LOCAL_FILES_COLUMN_LAYOUT_STORAGE_KEY);
    else localStorage.setItem(LOCAL_FILES_COLUMN_LAYOUT_STORAGE_KEY, previousLocalColumnLayout);

    sftpList.style.width = '1280px';
    window.termaSftpColumns.syncSftpListLayout(sftpList, 1280);
    window.termaSftpColumns.writeSftpColumnLayout({order:['name','size','mtime','access'],weights:{name:2,size:1.2,mtime:1.28,access:1.34},actionWeight:3.6});
    window.termaSftpView.render(fixtureTabKey);
    window.termaSftpColumns.persistSftpColumnOrder('mtime','name',false);
    const columnList = document.querySelector('#view-sftp #sftpList');
    for (let render = 0; render < 5; render += 1) window.termaSftpColumns.bindSftpColumnControls(columnList);
    const headerOrder = [...columnList.querySelectorAll('.sftp-head [data-sftp-column]')].map(cell=>cell.dataset.sftpColumn);
    const rowOrder = [...columnList.querySelector('.sftp-row').children].filter(node=>node.className.includes('sftp-column-')).map(node=>[...node.classList].find(name=>name.startsWith('sftp-column-')).replace('sftp-column-',''));
    const weightBeforeKeyboard = window.termaSftpColumns.readSftpColumnLayout().weights.name;
    const nextWeightBeforeKeyboard = window.termaSftpColumns.readSftpColumnLayout().weights.size;
    const pairWeightBeforeKeyboard = weightBeforeKeyboard + nextWeightBeforeKeyboard;
    columnList.querySelector('[data-sftp-column-resize="name"]')?.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
    const storedColumnLayout = window.termaSftpColumns.readSftpColumnLayout();
    let accessHeader = columnList.querySelector('.sftp-head [data-sftp-column="access"]');
    let actionsHeader = columnList.querySelector('.sftp-head-actions');
    const accessWeightBeforeActionResize = storedColumnLayout.weights.access;
    const actionWeightBeforeResize = storedColumnLayout.actionWeight;
    const actionBoundaryBeforeResize = accessHeader?.getBoundingClientRect().right || 0;
    const actionWidthBeforeResize = actionsHeader?.getBoundingClientRect().width || 0;
    const stableWidthsBeforeActionResize = ['name','size','mtime'].map(key => columnList.querySelector('[data-sftp-column="' + key + '"]')?.getBoundingClientRect().width || 0);
    columnList.querySelector('[data-sftp-column-resize="access"]')?.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
    const actionResizeLayout = window.termaSftpColumns.readSftpColumnLayout();
    accessHeader = columnList.querySelector('.sftp-head [data-sftp-column="access"]');
    actionsHeader = columnList.querySelector('.sftp-head-actions');
    const actionBoundaryAfterResize = accessHeader?.getBoundingClientRect().right || 0;
    const actionWidthAfterResize = actionsHeader?.getBoundingClientRect().width || 0;
    const stableWidthsAfterActionResize = ['name','size','mtime'].map(key => columnList.querySelector('[data-sftp-column="' + key + '"]')?.getBoundingClientRect().width || 0);
    const actionResizable = actionResizeLayout.weights.access < accessWeightBeforeActionResize
      && actionResizeLayout.actionWeight > actionWeightBeforeResize
      && Math.abs(actionBoundaryAfterResize - (actionBoundaryBeforeResize - 16)) <= 2
      && Math.abs(actionWidthAfterResize - (actionWidthBeforeResize + 16)) <= 2
      && stableWidthsBeforeActionResize.every((width,index) => Math.abs(stableWidthsAfterActionResize[index] - width) <= 1);
    const columnLayoutUi = {
      resizeDiagnostics:{before:{name:weightBeforeKeyboard,size:nextWeightBeforeKeyboard,access:accessWeightBeforeActionResize,actions:actionWeightBeforeResize,boundary:actionBoundaryBeforeResize,width:actionWidthBeforeResize,stable:stableWidthsBeforeActionResize},after:{name:storedColumnLayout.weights.name,size:storedColumnLayout.weights.size,access:actionResizeLayout.weights.access,actions:actionResizeLayout.actionWeight,boundary:actionBoundaryAfterResize,width:actionWidthAfterResize,stable:stableWidthsAfterActionResize},actionResizable,connected:columnList.isConnected},
      order:JSON.stringify(headerOrder) === JSON.stringify(['mtime','name','size','access']) && JSON.stringify(rowOrder) === JSON.stringify(headerOrder),
      persisted:JSON.stringify(storedColumnLayout.order) === JSON.stringify(headerOrder),
      resized:Math.abs(storedColumnLayout.weights.name - weightBeforeKeyboard) > .001
        && Math.abs(storedColumnLayout.weights.size - nextWeightBeforeKeyboard) > .001
        && Math.abs(storedColumnLayout.weights.name + storedColumnLayout.weights.size - pairWeightBeforeKeyboard) < .01
        && actionResizable,
      pointerStable:compactPointerStable,
      pairOnly:compactPairOnly,
      adjacentResizeStable:compactAdjacentResizeStable,
      dividerUniform:compactDividerUniform,
      localNarrowResizable,
      openButtonStable:Math.abs(compactOpenButtonAfter - compactOpenButtonBefore) <= 1,
      selectionToolbarStable,
      scrollbarUnified,
      globalCss:Boolean(columnList.style.getPropertyValue('--sftp-grid-columns'))
        && columnList.scrollWidth <= columnList.clientWidth + 1
        && !['auto','scroll'].includes(getComputedStyle(columnList).overflowX)
        && Boolean(accessHeader && actionsHeader && Math.abs(accessHeader.getBoundingClientRect().right - actionsHeader.getBoundingClientRect().left) <= 1)
    };
    if (previousColumnLayout === null) localStorage.removeItem(window.termaSftpColumns.storageKey);
    else localStorage.setItem(window.termaSftpColumns.storageKey, previousColumnLayout);
    sftpList.style.width = '';
    window.termaSftpColumns.syncSftpListLayout(sftpList);
    window.termaSftpView.render(fixtureTabKey);
    window.termaSftpTransferLifecycle.completion.statuses.set('ui-smoke-extract', 'running');
    const completedMutationDetected = window.termaSftpTransferLifecycle.completion.observe([{id:'ui-smoke-extract',status:'done',type:'extract',connection_id:1}]).has(1);
    window.termaSftpTransferLifecycle.completion.statuses.delete('ui-smoke-extract');
    let jobUi = {found:false};
    let generatedTaskUi = {found:false};
    const previousApi = api;
    const previousJobTimer = window.termaSftpTransferLifecycle.polling.start;
    const previousLatestJobs = window.termaSftpTaskWorkspace.state.jobs;
    const previousTaskCenterView = window.termaSftpTaskWorkspace.state.view;
    const previousJobRuntimeSettings = window.termaRuntimeSettingsModel.snapshot;
    const acceptTaskPrompt = async () => (await clickSftpFixtureChoice(0)).dialog;
    const SFTP_TASK_CENTER_SIZE_STORAGE_KEY = 'sftpTaskCenterSizeV1';
    const SFTP_TASK_CENTER_VIEWPORT_GAP = 12;
    document.documentElement.dataset.uiSmokeStage = 'sftp-task-center';
    const previousTaskCenterSize = localStorage.getItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY);
    try {
      const jobFixtures = [
        {id:'running-job',status:'running',type:'upload',phase:'uploading',label:'正在上传任务',connection_id:Number(connection.id),connection_name:'iMac',size:100,transferred:40,progress:40,resume_supported:true,can_pause:true,can_cancel:true},
        {id:'component:failed-job',status:'failed',type:'upload',label:'失败任务',connection_id:Number(connection.id),connection_name:'iMac',error:'fixture failed',can_resume:true,logs:Array.from({length:40},(_,index)=>({at:Date.now()+index,text:'task-log-line-'+String(index+1).padStart(2,'0')+' '+'.'.repeat(48)}))},
        {id:'done-job',status:'done',type:'compress',label:'完成历史任务',connection_id:Number(connection.id),connection_name:'iMac',finished_at:Date.now()-1000},
        {id:'saved-download',status:'done',type:'download',label:'桌面已保存下载',connection_id:Number(connection.id),connection_name:'Demo Mac',delivery_mode:'desktop',delivery_status:'saved',saved_path:'C:\\Temp\\TermaFixture\\Downloads\\saved.txt',finished_at:Date.now()-1200},
        {id:'browser-download',status:'done',type:'download',label:'浏览器已保存下载',connection_name:'iMac',connection_id:1,remote_path:'/tmp/browser.txt',delivery_mode:'browser',delivery_status:'delivered',finished_at:Date.now()-1300},
        {id:'cancelled-job',status:'cancelled',type:'move',label:'取消历史任务',connection_id:Number(connection.id),connection_name:'iMac',finished_at:Date.now()-2000}
      ];
      window.termaRuntimeSettingsModel.snapshot = window.termaRuntimeSettingsModel.normalize({...window.termaRuntimeSettingsModel.snapshot, saved:{...window.termaRuntimeSettingsModel.snapshot?.saved, sftp_floating_progress_enabled:true}});
      api = async pathname => pathname === '/api/sftp/jobs' ? jobFixtures : [];
      window.termaSftpTransferLifecycle.polling.start = () => {};
      await window.termaSftpTaskWorkspace.runtime.refresh();
      const button = document.querySelector('#sftpTaskCenterButton');
      const drawer = document.querySelector('#sftpTaskCenterDrawer');
      const list = document.querySelector('#sftpTaskCenterList');
      const badge = document.querySelector('#sftpTaskCenterBadge');
      const totalProgress = document.querySelector('#sftpTaskCenterProgress');
      const floatingCard = document.querySelector('#sftpTaskFloat');
      const singleGlobalEntry = document.querySelectorAll('#sftpTaskCenterButton').length === 1
        && !document.querySelector('#workspaceDock')?.contains(button);
      const noPaneTaskRegions = document.querySelectorAll('#workspaceDock #sftpJobs, #workspaceDock .sftp-task-drawer, #workspaceDock #sftpTaskFloat').length === 0;
      const failedStatusVisible = Boolean(button?.classList.contains('is-running')
        && button.classList.contains('is-failed')
        && button.querySelector('.lucide-circle-alert')
        && badge?.textContent === '2'
        && !badge.hidden);
      const totalProgressVisible = Boolean(totalProgress
        && !totalProgress.hidden
        && !totalProgress.classList.contains('is-indeterminate')
        && totalProgress.getAttribute('aria-valuenow') === '40'
        && Math.abs(Number.parseFloat(totalProgress.querySelector('i')?.style.width || '0') - 40) <= 0.1
        && Math.abs(totalProgress.getBoundingClientRect().height - 2) <= 0.1);
      const floatingRect = floatingCard?.getBoundingClientRect();
      const topbarRect = document.querySelector('.topbar')?.getBoundingClientRect();
      const taskButtonRect = button?.getBoundingClientRect();
      const floatingVisibleBelowHeader = Boolean(floatingCard
        && !floatingCard.hidden
        && floatingRect
        && topbarRect
        && taskButtonRect
        && floatingRect.top >= topbarRect.bottom + 6
        && (floatingRect.bottom <= taskButtonRect.top || floatingRect.top >= taskButtonRect.bottom)
        && floatingRect.right <= window.innerWidth + 1);
      const floatingActions = Boolean(floatingCard?.querySelector('.sftp-task-float-pause:not([hidden])')?.dataset.action === 'pause'
        && floatingCard.querySelector('.sftp-task-float-pause .lucide-pause')
        && floatingCard.querySelector('.sftp-task-float-cancel:not([hidden])')
        && floatingCard.querySelector('.sftp-task-float-close')
        && floatingCard.querySelector('.sftp-task-float-mute')
        && floatingCard.querySelector('.lucide-bell-off'));
      window.termaSftpTaskWorkspace.state.paint([{...jobFixtures[0],status:'paused',can_pause:false,can_resume:true}]);
      const floatingResumeAction = Boolean(floatingCard?.querySelector('.sftp-task-float-pause:not([hidden])')?.dataset.action === 'resume'
        && floatingCard.querySelector('.sftp-task-float-pause .lucide-play'));
      window.termaSftpTaskWorkspace.state.paint(jobFixtures);
      const floatingProgress = Math.abs(Number.parseFloat(floatingCard?.querySelector('.progress i')?.style.width || '0') - 40) <= 0.1;
      window.termaFileLayouts.taskCenter.resetSftpTaskCenterSize();
      await window.termaSftpTaskWorkspace.runtime.toggle();
      const drawerOpened = Boolean(drawer && !drawer.hidden && button?.getAttribute('aria-expanded') === 'true');
      notify('任务中心层级测试','info');
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const taskCenterLayerToast = document.querySelector('#toast .toast:last-child');
      const taskCenterLayerToastRect = taskCenterLayerToast?.getBoundingClientRect();
      const taskCenterLayerDrawerRect = drawer?.getBoundingClientRect();
      const overlapX = Math.max(taskCenterLayerToastRect?.left||0,taskCenterLayerDrawerRect?.left||0)+12;
      const overlapY = Math.max(taskCenterLayerToastRect?.top||0,taskCenterLayerDrawerRect?.top||0)+12;
      const taskCenterToastOverlaps = Boolean(taskCenterLayerToastRect && taskCenterLayerDrawerRect
        && overlapX < Math.min(taskCenterLayerToastRect.right,taskCenterLayerDrawerRect.right)
        && overlapY < Math.min(taskCenterLayerToastRect.bottom,taskCenterLayerDrawerRect.bottom));
      const taskCenterAboveNotifications = Boolean(document.body.classList.contains('sftp-task-center-open')
        && taskCenterLayerToastRect && taskCenterLayerDrawerRect
        && (taskCenterToastOverlaps
          ? document.elementFromPoint(overlapX,overlapY)?.closest?.('#sftpTaskCenterDrawer')
          : document.elementFromPoint(taskCenterLayerDrawerRect.left+20,taskCenterLayerDrawerRect.top+20)?.closest?.('#sftpTaskCenterDrawer')));
      dismissToast(taskCenterLayerToast);
      const defaultDrawerRect = drawer?.getBoundingClientRect();
      const drawerDefaultCompact = Boolean(defaultDrawerRect
        && defaultDrawerRect.width >= 338
        && defaultDrawerRect.width <= 502
        && defaultDrawerRect.height >= 238
        && defaultDrawerRect.height <= 402);
      const currentText = list?.textContent.replace(/s+/g,' ').trim() || '';
      const currentRows = [...(list?.querySelectorAll('.sftp-job') || [])];
      const runningRow = currentRows.find(row => row.textContent.includes('正在上传任务'));
      const failedInCurrent = currentRows.find(row => row.textContent.includes('失败任务'));
      const currentActions = Boolean(runningRow?.textContent.includes('暂停')
        && runningRow.textContent.includes('取消')
        && !failedInCurrent);
      const currentProgress = Math.abs(Number.parseFloat(runningRow?.querySelector('.progress i')?.style.width || '0') - 40) <= 0.1;
      const currentOnly = currentText.includes('正在上传任务')
        && !currentText.includes('失败任务')
        && !currentText.includes('完成历史任务')
        && !currentText.includes('取消历史任务');
      const queueActions = document.querySelector('#sftpTaskCenterQueueActions');
      const pauseAllButton = document.querySelector('#sftpTaskCenterPauseAllButton');
      const resumeAllButton = document.querySelector('#sftpTaskCenterResumeAllButton');
      const clearQueueButton = document.querySelector('#sftpTaskCenterClearQueueButton');
      const currentQueueActions = Boolean(queueActions && !queueActions.hidden
        && pauseAllButton && !pauseAllButton.disabled
        && resumeAllButton?.disabled
        && clearQueueButton && !clearQueueButton.disabled
        && document.querySelector('#sftpTaskCenterClearButton')?.hidden);
      const queueFixtures = [
        {...jobFixtures[0],id:'queue-upload-running'},
        {id:'queue-download-paused',status:'paused',type:'download',phase:'downloading',label:'暂停下载',connection_id:Number(connection.id),connection_name:'iMac',resume_supported:true,can_resume:true,can_cancel:true},
        {id:'queue-cross-pending',status:'pending',type:'cross-copy',phase:'queued',label:'排队跨主机',connection_id:Number(connection.id),connection_name:'Mac mini',resume_supported:true,can_pause:false,can_cancel:true},
        {id:'queue-local-running',status:'running',type:'local-delivery',phase:'local-saving',label:'分别下载到本机',connection_id:Number(connection.id),connection_name:'iMac',resume_supported:false,can_pause:false,can_cancel:true},
        {id:'queue-cross-scanning',status:'running',type:'cross-copy',phase:'scanning',label:'扫描跨主机',connection_id:Number(connection.id),connection_name:'Mac mini',resume_supported:true,can_pause:false,can_cancel:true}
      ];
      const queueBatchCalls = [];
      window.termaSftpTaskWorkspace.state.jobs = queueFixtures;
      window.termaSftpTaskWorkspace.state.paint(queueFixtures);
      api = async (pathname, options={}) => {
        if (pathname === '/api/sftp/jobs') return queueFixtures;
        if (['/api/sftp/sync/jobs','/api/linux-desktop/tasks','/api/remote-component/tasks'].includes(pathname)) return [];
        queueBatchCalls.push({pathname,method:options.method||'GET'});
        if (pathname.endsWith('/pause')) return {ok:true,status:'paused'};
        if (pathname.endsWith('/resume')) return {ok:true,status:'pending'};
        if (pathname.endsWith('/cancel')) return {ok:true,status:'cancelled'};
        return {ok:true};
      };
      const pauseBatchResult = await window.termaTaskActions.current.batch('pause',pauseAllButton);
      const resumeBatchResult = await window.termaTaskActions.current.batch('resume',resumeAllButton);
      document.documentElement.dataset.uiSmokeStage = 'sftp-task-cancel-queue';
      const clearingQueue = window.termaTaskActions.current.batch('cancel',clearQueueButton);
      await acceptTaskPrompt();
      const clearBatchResult = await clearingQueue;
      const queueBatchControls = Boolean(pauseBatchResult?.completed === 2
        && pauseBatchResult?.skipped === 3
        && resumeBatchResult?.completed === 1
        && resumeBatchResult?.skipped === 4
        && clearBatchResult?.completed === 5
        && clearBatchResult?.skipped === 0
        && queueBatchCalls.filter(call=>call.pathname.endsWith('/pause')).length === 2
        && queueBatchCalls.filter(call=>call.pathname.endsWith('/resume')).length === 1
        && queueBatchCalls.filter(call=>call.pathname.endsWith('/cancel')).length === 5
        && !drawer.hidden);
      const queueBatchDiagnostics = {
        pauseBatchResult,
        resumeBatchResult,
        clearBatchResult,
        pauseCalls:queueBatchCalls.filter(call=>call.pathname.endsWith('/pause')).length,
        resumeCalls:queueBatchCalls.filter(call=>call.pathname.endsWith('/resume')).length,
        cancelCalls:queueBatchCalls.filter(call=>call.pathname.endsWith('/cancel')).length,
        drawerHidden:drawer.hidden
      };
      window.termaSftpTaskWorkspace.state.jobs = jobFixtures;
      api = async pathname => pathname === '/api/sftp/jobs' ? jobFixtures : [];
      window.termaSftpTaskWorkspace.state.paint(jobFixtures);
      window.termaSftpTaskWorkspace.runtime.view('failed');
      const failedText = list?.textContent.replace(/s+/g,' ').trim() || '';
      const failedRows = [...(list?.querySelectorAll('.sftp-job') || [])];
      const failedRow = failedRows.find(row => row.textContent.includes('失败任务'));
      const failedOnly = failedText.includes('失败任务') && !failedText.includes('正在上传任务') && !failedText.includes('完成历史任务') && !failedText.includes('取消历史任务');
      const failedActions = Boolean(failedRow?.textContent.includes('重试') && failedRow?.querySelector('button[title="删除任务"]'));
      const failedFooter = document.querySelector('#sftpTaskCenterFooter');
      const failedClearAvailable = Boolean(failedFooter && !failedFooter.hidden
        && document.querySelector('#sftpTaskCenterClearLabel')?.textContent === '清空失败'
        && document.querySelector('#sftpTaskCenterClearButton')?.getAttribute('aria-label')?.includes('失败任务')
        && document.querySelector('#sftpTaskCenterQueueActions')?.hidden);
      const taskLogDetails=failedRow?.querySelector('.global-task-log');
      taskLogDetails?.querySelector('summary')?.click();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const taskLogBeforeRefresh=taskLogDetails?.querySelector('pre');
      const taskLogInitialOpen=Boolean(taskLogDetails?.open);
      const taskLogInitialBottom=Boolean(taskLogBeforeRefresh&&window.termaSftpTaskWorkspace.logs.atBottom(taskLogBeforeRefresh));
      const refreshedJobFixtures=jobFixtures.map(job=>job.id==='component:failed-job'
        ? {...job,logs:[...job.logs,{at:Date.now()+100,text:'task-log-line-latest'}]}
        : job);
      // Keep the task/API source current when a queued repaint reads it again.
      jobFixtures.splice(0,jobFixtures.length,...refreshedJobFixtures);
      window.termaSftpTaskWorkspace.state.jobs=jobFixtures;
      window.termaSftpTaskWorkspace.state.paint(refreshedJobFixtures);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const refreshedTaskLogDetails=list?.querySelector('.global-task-log[data-task-id="component:failed-job"]');
      const refreshedTaskLog=refreshedTaskLogDetails?.querySelector('pre');
      const taskLogRefreshKeepsOpen=Boolean(refreshedTaskLogDetails?.open);
      const taskLogRefreshShowsLatest=Boolean(refreshedTaskLog?.textContent.includes('task-log-line-latest'));
      const taskLogRefreshFollowsBottom=Boolean(refreshedTaskLog&&window.termaSftpTaskWorkspace.logs.atBottom(refreshedTaskLog));
      const drawerResizeStyle = getComputedStyle(drawer);
      const drawerResizeHandle = document.querySelector('#sftpTaskCenterResize');
      const drawerResizeHandleStyle = drawerResizeHandle ? getComputedStyle(drawerResizeHandle) : null;
      const drawerResizable = Boolean(drawerResizeHandle
        && drawerResizeHandleStyle?.display !== 'none'
        && drawerResizeHandleStyle?.cursor === 'nesw-resize'
        && drawerResizeStyle.resize === 'none');
      const drawerBeforeResizeRect = drawer.getBoundingClientRect();
      const drawerResizeHandleRect = drawerResizeHandle?.getBoundingClientRect();
      const resizePointerId = 451;
      const resizeStartX = (drawerResizeHandleRect?.left || drawerBeforeResizeRect.left) + 6;
      const resizeStartY = (drawerResizeHandleRect?.bottom || drawerBeforeResizeRect.bottom) - 6;
      drawerResizeHandle?.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,cancelable:true,pointerId:resizePointerId,pointerType:'mouse',button:0,buttons:1,clientX:resizeStartX,clientY:resizeStartY}));
      const drawerResizeLifecycleStarted = document.body.classList.contains('sftp-task-center-resizing');
      window.dispatchEvent(new PointerEvent('pointermove', {bubbles:true,cancelable:true,pointerId:resizePointerId,pointerType:'mouse',button:0,buttons:1,clientX:resizeStartX + 70,clientY:resizeStartY - 60}));
      window.dispatchEvent(new PointerEvent('pointerup', {bubbles:true,cancelable:true,pointerId:resizePointerId,pointerType:'mouse',button:0,buttons:0,clientX:resizeStartX + 70,clientY:resizeStartY - 60}));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const resizedDrawerRect = drawer.getBoundingClientRect();
      const resizedListRect = list.getBoundingClientRect();
      const drawerResizeAdaptive = Boolean(drawerResizeLifecycleStarted
        && !document.body.classList.contains('sftp-task-center-resizing')
        && Math.abs(resizedDrawerRect.width - (drawerBeforeResizeRect.width - 70)) <= 2
        && Math.abs(resizedDrawerRect.height - (drawerBeforeResizeRect.height - 60)) <= 2
        && Math.abs(resizedDrawerRect.right - drawerBeforeResizeRect.right) <= 1
        && resizedListRect.left >= resizedDrawerRect.left - 1
        && resizedListRect.right <= resizedDrawerRect.right + 1
        && resizedListRect.top >= resizedDrawerRect.top - 1
         && resizedListRect.bottom <= resizedDrawerRect.bottom + 1
         && list.scrollWidth <= list.clientWidth + 1);
      const persistedDrawerSize=window.termaFileLayouts.taskCenter.savedSftpTaskCenterSize();
      drawer.style.removeProperty('width');
      drawer.style.removeProperty('height');
      const drawerSizeRestored=window.termaFileLayouts.taskCenter.restoreSftpTaskCenterSize(drawer);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const restoredDrawerRect=drawer.getBoundingClientRect();
      const drawerResizePersists=Boolean(persistedDrawerSize
        && drawerSizeRestored
        && Math.abs(persistedDrawerSize.width-resizedDrawerRect.width)<=2
        && Math.abs(persistedDrawerSize.height-resizedDrawerRect.height)<=2
        && Math.abs(restoredDrawerRect.width-resizedDrawerRect.width)<=2
        && Math.abs(restoredDrawerRect.height-resizedDrawerRect.height)<=2);
      drawerResizeHandle?.dispatchEvent(new MouseEvent('dblclick', {bubbles:true,cancelable:true,button:0}));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const resetDrawerRect = drawer.getBoundingClientRect();
      const drawerResizeReset = Boolean(Math.abs(resetDrawerRect.width - drawerBeforeResizeRect.width) <= 2
        && Math.abs(resetDrawerRect.height - drawerBeforeResizeRect.height) <= 2
        && localStorage.getItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY)===null);
      localStorage.setItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY,JSON.stringify({width:window.innerWidth*4,height:window.innerHeight*4}));
      window.termaFileLayouts.taskCenter.clearSftpTaskCenterSizeConstraints(drawer);
      drawer.style.removeProperty('width');
      drawer.style.removeProperty('height');
      const oversizedDrawerRestored=window.termaFileLayouts.taskCenter.restoreSftpTaskCenterSize(drawer);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const recoveredDrawerRect=drawer.getBoundingClientRect();
      const recoveredContentRect=document.querySelector('.content')?.getBoundingClientRect();
      const recoveredHandleRect=drawerResizeHandle?.getBoundingClientRect();
      const recoveredHandleX=(recoveredHandleRect?.left||0)+(recoveredHandleRect?.width||0)/2;
      const recoveredHandleY=(recoveredHandleRect?.top||0)+(recoveredHandleRect?.height||0)/2;
      const correctedOversizedDrawerSize=window.termaFileLayouts.taskCenter.savedSftpTaskCenterSize();
      const drawerOversizeRecovers=Boolean(oversizedDrawerRestored
        && recoveredContentRect
        && recoveredHandleRect
        && correctedOversizedDrawerSize
        && recoveredDrawerRect.left >= recoveredContentRect.left + SFTP_TASK_CENTER_VIEWPORT_GAP - 1
        && recoveredDrawerRect.right <= Math.min(window.innerWidth,recoveredContentRect.right) - SFTP_TASK_CENTER_VIEWPORT_GAP + 1
        && recoveredDrawerRect.bottom <= Math.min(window.innerHeight,recoveredContentRect.bottom) - SFTP_TASK_CENTER_VIEWPORT_GAP + 1
        && recoveredHandleX >= recoveredContentRect.left
        && recoveredHandleY < window.innerHeight
        && document.elementFromPoint(recoveredHandleX,recoveredHandleY)?.closest?.('#sftpTaskCenterResize')
        && correctedOversizedDrawerSize.width <= recoveredDrawerRect.width + 1
        && correctedOversizedDrawerSize.height <= recoveredDrawerRect.height + 1);
      const drawerResetSizeButton=document.querySelector('#sftpTaskCenterResetSizeButton');
      const drawerResetSizeButtonRect=drawerResetSizeButton?.getBoundingClientRect();
      const drawerResetSizeButtonReachable=Boolean(drawerResetSizeButtonRect
        && document.elementFromPoint(drawerResetSizeButtonRect.left+drawerResetSizeButtonRect.width/2,drawerResetSizeButtonRect.top+drawerResetSizeButtonRect.height/2)?.closest?.('#sftpTaskCenterResetSizeButton'));
      drawerResetSizeButton?.click();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const headerResetDrawerRect=drawer.getBoundingClientRect();
      const drawerHeaderReset=Boolean(drawerResetSizeButtonReachable
        && Math.abs(headerResetDrawerRect.width-drawerBeforeResizeRect.width)<=2
        && Math.abs(headerResetDrawerRect.height-drawerBeforeResizeRect.height)<=2
        && localStorage.getItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY)===null);
      const boundedDragHandleRect=drawerResizeHandle?.getBoundingClientRect();
      const boundedDragPointerId=452;
      const boundedDragStartX=(boundedDragHandleRect?.left||0)+(boundedDragHandleRect?.width||0)/2;
      const boundedDragStartY=(boundedDragHandleRect?.top||0)+(boundedDragHandleRect?.height||0)/2;
      drawerResizeHandle?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:boundedDragPointerId,pointerType:'mouse',button:0,buttons:1,clientX:boundedDragStartX,clientY:boundedDragStartY}));
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:boundedDragPointerId,pointerType:'mouse',button:0,buttons:1,clientX:-window.innerWidth,clientY:window.innerHeight*2}));
      window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:boundedDragPointerId,pointerType:'mouse',button:0,buttons:0,clientX:-window.innerWidth,clientY:window.innerHeight*2}));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const boundedDragDrawerRect=drawer.getBoundingClientRect();
      const boundedDragContentRect=document.querySelector('.content')?.getBoundingClientRect();
      const boundedDragRecoveredHandleRect=drawerResizeHandle?.getBoundingClientRect();
      const boundedDragHandleX=(boundedDragRecoveredHandleRect?.left||0)+(boundedDragRecoveredHandleRect?.width||0)/2;
      const boundedDragHandleY=(boundedDragRecoveredHandleRect?.top||0)+(boundedDragRecoveredHandleRect?.height||0)/2;
      const drawerResizeClamps=Boolean(boundedDragContentRect
        && boundedDragRecoveredHandleRect
        && boundedDragDrawerRect.left >= boundedDragContentRect.left + SFTP_TASK_CENTER_VIEWPORT_GAP - 1
        && boundedDragDrawerRect.right <= Math.min(window.innerWidth,boundedDragContentRect.right) - SFTP_TASK_CENTER_VIEWPORT_GAP + 1
        && boundedDragDrawerRect.bottom <= Math.min(window.innerHeight,boundedDragContentRect.bottom) - SFTP_TASK_CENTER_VIEWPORT_GAP + 1
        && document.elementFromPoint(boundedDragHandleX,boundedDragHandleY)?.closest?.('#sftpTaskCenterResize'));
      drawerResetSizeButton?.click();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));

      const deleteFixture = {id:'delete-record-job',status:'failed',type:'upload',label:'待删除失败任务',connection_id:Number(connection.id),connection_name:'iMac'};
      window.termaSftpTaskWorkspace.state.paint([...refreshedJobFixtures, deleteFixture]);
      const deleteButton = [...list.querySelectorAll('.sftp-job')].find(row=>row.textContent.includes('待删除失败任务'))?.querySelector('.danger');
      let deleteRequestCount = 0;
      let releaseDeleteRequest;
      api = (pathname, options={}) => {
        if (pathname === '/api/sftp/jobs/delete-record-job' && options.method === 'DELETE') {
          deleteRequestCount += 1;
          return new Promise(resolve => { releaseDeleteRequest = resolve; });
        }
        return Promise.resolve(pathname === '/api/sftp/jobs' ? refreshedJobFixtures : []);
      };
      const firstDelete = window.termaTaskActions.current.remove('delete-record-job', deleteButton);
      const secondDelete = window.termaTaskActions.current.remove('delete-record-job', deleteButton);
      await acceptTaskPrompt();
      await new Promise(resolve=>setTimeout(resolve,0));
      const deleteDuplicateBlocked = Boolean(deleteButton?.disabled && deleteRequestCount === 1);
      releaseDeleteRequest?.({ok:true});
      await Promise.all([firstDelete, secondDelete]);
      const deleteKeepsDrawerOpen = Boolean(!drawer.hidden && button?.getAttribute('aria-expanded') === 'true');
      api = async pathname => pathname === '/api/sftp/jobs' ? jobFixtures : [];
      window.termaSftpTaskWorkspace.state.paint(jobFixtures);
      const drawerRect = drawer?.getBoundingClientRect();
      const drawerFitsViewport = Boolean(drawerRect
        && drawerRect.left >= -1
        && drawerRect.right <= window.innerWidth + 1
        && drawerRect.top >= 0
        && drawerRect.bottom <= window.innerHeight + 1);
      window.termaSftpTaskWorkspace.runtime.view('history');
      const historyText = list?.textContent.replace(/s+/g,' ').trim() || '';
      const historyOnly = historyText.includes('完成历史任务')
        && historyText.includes('取消历史任务')
        && !historyText.includes('正在上传任务')
        && !historyText.includes('失败任务');
      const historyCounts = document.querySelector('#sftpTaskCenterCurrentCount')?.textContent === '1'
        && document.querySelector('#sftpTaskCenterFailedCount')?.textContent === '1'
        && document.querySelector('#sftpTaskCenterHistoryCount')?.textContent === '4';
      const historyFooter = document.querySelector('#sftpTaskCenterFooter');
      const desktopSavedRow = [...list.querySelectorAll('.sftp-job')].find(row=>row.textContent.includes('桌面已保存下载'));
      const browserSavedRow = [...list.querySelectorAll('.sftp-job')].find(row=>row.textContent.includes('browser.txt'));
      const desktopOpenFileLabel=tr('tasks:actions.open_file');
      const desktopOpenDirectoryLabel=tr('tasks:actions.open_directory');
      const deleteTaskLabel=tr('tasks:actions.delete');
      const historyActions = Boolean(historyFooter && !historyFooter.hidden
        && historyText.includes('桌面已保存下载')
        && desktopSavedRow?.querySelector('button[aria-label="'+CSS.escape(desktopOpenFileLabel)+'"]')
        && desktopSavedRow?.querySelector('button[aria-label="'+CSS.escape(desktopOpenDirectoryLabel)+'"]')
        && desktopSavedRow?.querySelector('button[aria-label="'+CSS.escape(deleteTaskLabel)+'"]')
        && !desktopSavedRow?.textContent.includes('保存到本机')
        && browserSavedRow?.textContent.includes(tr('tasks:actions.download_again')));
      const generatedTaskFixture = {
        id:'local:generated-svg',
        status:'done',
        type:'local-generated',
        label:'生成的 SVG',
        connection_name:'',
        delivery_status:'saved',
        saved_path:'C:\\Temp\\TermaFixture\\Downloads\\测试-黑白反转.svg',
        filename:'测试-黑白反转.svg',
        size:1024,
        transferred:1024,
        progress_unit:'percent',
        progress:100,
        finished_at:Date.now()
      };
      window.termaSftpTaskWorkspace.state.paint([...jobFixtures, generatedTaskFixture]);
      const generatedTaskRow = list.querySelector('.sftp-job[data-task-id="local:generated-svg"]');
      const generatedTaskButtons = [...(generatedTaskRow?.querySelectorAll('.actions.tight > button') || [])];
      generatedTaskUi = {
        found:Boolean(generatedTaskRow),
        savedPath:Boolean(generatedTaskRow?.textContent.includes('C:\\Temp\\TermaFixture\\Downloads\\测试-黑白反转.svg')),
        openFile:Boolean(generatedTaskRow?.querySelector('button[aria-label="打开文件"]')),
        openDirectory:Boolean(generatedTaskRow?.querySelector('button[aria-label="打开目录"]')),
        deleteFile:Boolean(generatedTaskRow?.querySelector('button[aria-label="删除文件"]')),
        buttonCount:generatedTaskButtons.length,
        noDuplicateTaskDelete:!generatedTaskRow?.querySelector('button[aria-label="删除任务"]')
      };
      window.termaSftpTaskWorkspace.state.paint(jobFixtures);
      const historyActionDiagnostics={footerHidden:historyFooter?.hidden,desktopLabels:[...(desktopSavedRow?.querySelectorAll('button')||[])].map(button=>({title:button.title,ariaLabel:button.getAttribute('aria-label'),text:button.textContent.trim()})),historyText};
      document.body.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      const outsideClickCloses = Boolean(drawer.hidden && button?.getAttribute('aria-expanded') === 'false');
      await window.termaSftpTaskWorkspace.runtime.toggle();
      document.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Escape'}));
      const escapeCloses = Boolean(drawer.hidden && button?.getAttribute('aria-expanded') === 'false');
      await window.termaSftpTaskWorkspace.runtime.open({preventDefault(){},stopPropagation(){},target:floatingCard});
      const floatingOpensTaskCenter = Boolean(!drawer.hidden && button?.getAttribute('aria-expanded') === 'true'
        && document.querySelector('#sftpTaskCenterCurrentTab')?.getAttribute('aria-selected') === 'true');
      window.termaSftpTaskWorkspace.runtime.close();
      window.termaSftpTaskWorkspace.runtime.dismiss();
      window.termaSftpTaskWorkspace.state.paint(jobFixtures);
      const floatingCloseHidesCurrent = Boolean(floatingCard?.hidden);
      const nextFloatingJob = {...jobFixtures[0],id:'next-running-job',label:'新后台任务'};
      window.termaSftpTaskWorkspace.state.paint([...jobFixtures,nextFloatingJob]);
      const floatingNewTaskReopens = Boolean(floatingCard && !floatingCard.hidden && floatingCard.textContent.includes('2 个后台任务'));
      let mutePayload = null;
      api = async (pathname, options={}) => {
        if (pathname === '/api/runtime-settings') {
          mutePayload = JSON.parse(options.body || '{}');
          const saved = {...window.termaRuntimeSettingsModel.snapshot.saved, sftp_floating_progress_enabled:false};
          return {...window.termaRuntimeSettingsModel.snapshot, saved, sftp_floating_progress_enabled:false};
        }
        return pathname === '/api/sftp/jobs' ? jobFixtures : [];
      };
      const mutingTaskCards = window.termaSftpTaskWorkspace.runtime.mute();
      document.documentElement.dataset.uiSmokeStage = 'sftp-task-mute-cards';
      const muteConfirmationText = await acceptTaskPrompt();
      await mutingTaskCards;
      const floatingMutePersists = Boolean(mutePayload?.sftp_floating_progress_enabled === false
        && window.termaRuntimeSettingsModel.snapshot?.saved?.sftp_floating_progress_enabled === false
        && floatingCard?.hidden
        && muteConfirmationText?.includes('永久关闭此类悬浮进度卡')
        && muteConfirmationText?.includes('通知设置'));
      window.termaRuntimeSettingsModel.snapshot = window.termaRuntimeSettingsModel.normalize({...window.termaRuntimeSettingsModel.snapshot, saved:{...window.termaRuntimeSettingsModel.snapshot.saved, sftp_floating_progress_enabled:true}});
      window.termaSftpTaskWorkspace.state.paint([nextFloatingJob]);
      const floatingSettingRestores = Boolean(floatingCard && !floatingCard.hidden);
      window.termaSftpTaskWorkspace.state.paint([jobFixtures[0]]);
      const runningStatusVisible = Boolean(button?.classList.contains('is-running')
        && !button.classList.contains('is-failed')
        && button.querySelector('.lucide-loader-circle')
        && badge?.textContent === '1');
      window.termaSftpTaskWorkspace.state.paint([{id:'unknown-progress-job',status:'running',type:'compress',label:'Unknown progress'}]);
      const totalProgressIndeterminate = Boolean(totalProgress
        && !totalProgress.hidden
        && totalProgress.classList.contains('is-indeterminate')
        && !totalProgress.hasAttribute('aria-valuenow'));
      window.termaSftpTaskWorkspace.state.paint([]);
      const totalProgressHidesWhenIdle = Boolean(totalProgress?.hidden);
      window.termaSftpTaskWorkspace.state.paint([jobFixtures[0]]);
      const nativeDragJob = {id:'native-drag-job',status:'running',type:'native-drag',phase:'cancelling',can_cancel:false,label:'拖出 large.bin 到本机',connection_id:Number(connection.id),connection_name:'iMac',size:1000,transferred:500,progress:50};
      window.termaSftpTaskWorkspace.state.paint([nativeDragJob]);
      const nativeDragTaskRow = list.querySelector('.sftp-job[data-task-id="native-drag-job"]');
      const nativeDragTaskStopHidden = Boolean(nativeDragTaskRow?.textContent.includes('正在停止')
        && ![...nativeDragTaskRow.querySelectorAll('button')].some(button => button.textContent.trim() === '取消'));
      const deleteJob = {id:'delete-job',status:'running',type:'delete',label:'删除 3 项',connection_id:Number(connection.id),connection_name:'iMac',progress_unit:'items',size:3,transferred:1,progress:33};
      window.termaSftpTaskWorkspace.state.paint([deleteJob]);
      const itemProgress = Boolean(list.querySelector('.sftp-job[data-task-id="delete-job"] .sftp-job-summary')?.textContent.includes('已处理 1 / 3 项'));
      let resolveStaleJobs;
      let jobRequestCount = 0;
      api = pathname => {
        if (pathname !== '/api/sftp/jobs') return Promise.resolve([]);
        jobRequestCount += 1;
        if (jobRequestCount === 1) return new Promise(resolve => { resolveStaleJobs = resolve; });
        return Promise.resolve([deleteJob]);
      };
      document.documentElement.dataset.uiSmokeStage = 'sftp-task-refresh-coalescing';
      const staleRefresh = window.termaSftpTaskWorkspace.runtime.refresh();
      const trailingRefresh = window.termaSftpTaskWorkspace.runtime.refresh();
      const concurrentRefreshCoalesced = staleRefresh === trailingRefresh;
      resolveStaleJobs?.(jobFixtures);
      await Promise.all([staleRefresh, trailingRefresh]);
      const staleJobResponseIgnored = concurrentRefreshCoalesced
        && jobRequestCount === 2
        && window.termaSftpTaskWorkspace.state.jobs.length === 1
        && window.termaSftpTaskWorkspace.state.jobs[0]?.id === deleteJob.id;
      const nativeProgressApi = api;
      const nativeProgressRequest = 'native-directory-progress-fixture';
      let nativeProgressJob = {id:nativeProgressRequest,type:'native-drag',status:'running',phase:'system-saving',connection_id:Number(connection.id),label:'拖出 folder 到本机',size:0,transferred:0,size_known:false,progress_known:false,can_cancel:true};
      try {
        api = async pathname => pathname === '/api/sftp/jobs' ? [nativeProgressJob] : [];
        window.termaSftpDragWorkspace.drag.state.requests.set(nativeProgressRequest, {lastActivityAt:Date.now()});
        window.termaSftpDragWorkspace.drag.native.event({requestId:nativeProgressRequest,type:'transferStarted'});
        await window.termaSftpTaskWorkspace.runtime.refresh();
        if (floatingCard.hidden || !floatingCard.querySelector('.progress.indeterminate')) throw new Error('native directory preparation did not show immediate indeterminate progress');
        nativeProgressJob = {...nativeProgressJob,size:1000,size_known:true,progress_known:true,transferred:500,progress:50,speed_bps:250};
        await window.termaSftpTaskWorkspace.runtime.refresh();
        if (floatingCard.hidden || !floatingCard.textContent.includes('50%') || !floatingCard.querySelector('.sftp-task-float-cancel:not([hidden])')) throw new Error('native directory download did not update progress and stop control');
      } finally {
        window.termaSftpDragWorkspace.drag.state.requests.delete(nativeProgressRequest);
        api = nativeProgressApi;
        window.termaSftpTaskWorkspace.state.paint([deleteJob]);
      }
      document.documentElement.dataset.uiSmokeStage = 'sftp-task-notifications';
      const previousFloatingTransition = floatingCard?.style.transition || '';
      if (floatingCard) floatingCard.style.transition = 'none';
      dismissToast();
      for (let attempt=0;attempt<20&&document.querySelector('#toast .toast');attempt+=1) {
        document.documentElement.dataset.uiSmokeStage = 'sftp-toast-clear-existing';
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const toastIconResults = [];
      const toastTitles = ['SFTP success 图标测试','SFTP info 图标测试','SFTP error 图标测试'];
      const expectedToastTitles = toastTitles.map(title=>localizedTermaUiPhrase(title));
      for (const [index,type] of ['success','info','error'].entries()) {
        notify(toastTitles[index] + '\\n图标应与提示文字对齐', type);
        const card = document.querySelector('#toast .toast:last-child');
        const holder = card?.querySelector('.toast-icon')?.getBoundingClientRect();
        const glyph = card?.querySelector('.toast-icon svg')?.getBoundingClientRect();
        toastIconResults.push(Boolean(holder && glyph && holder.width && glyph.width
          && Math.abs((holder.left + holder.width / 2) - (glyph.left + glyph.width / 2)) <= 1
          && Math.abs((holder.top + holder.height / 2) - (glyph.top + glyph.height / 2)) <= 1));
      }
      const toastIconsAligned = toastIconResults.every(Boolean);
      document.documentElement.dataset.uiSmokeStage = 'sftp-toast-stack-settle';
      await new Promise(resolve => setTimeout(resolve, 320));
      const toastStack = document.querySelector('#toast');
      const stackedToasts = [...(toastStack?.querySelectorAll('.toast') || [])];
      const stackedToastTitles=stackedToasts.map(card => card.querySelector('strong')?.textContent || '');
      const toastOrderPreserved = stackedToasts.length === 3
        && stackedToastTitles.join('|') === expectedToastTitles.join('|');
      const toastStackedDown = stackedToasts.length === 3 && stackedToasts.slice(1).every((card,index) => {
        const previous = stackedToasts[index].getBoundingClientRect();
        const current = card.getBoundingClientRect();
        return current.top >= previous.bottom + 5;
      });
      window.termaNotificationToasts.repaint();
      document.documentElement.dataset.uiSmokeStage = 'sftp-toast-stack-layout';
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const toastStackRect = toastStack?.getBoundingClientRect();
      const floatingWithToastsRect = floatingCard?.getBoundingClientRect();
      const toastAvoidsFloatingTask = Boolean(floatingCard?.hidden
        || (toastStackRect && floatingWithToastsRect && floatingWithToastsRect.top >= toastStackRect.bottom + 6));
      if (floatingCard) floatingCard.style.transition = previousFloatingTransition;
      const firstToast = stackedToasts[0];
      const secondToastTopBefore = stackedToasts[1]?.getBoundingClientRect().top;
      dismissToast(firstToast);
      const toastExitAnimated = matchMedia('(prefers-reduced-motion: reduce)').matches || Boolean(firstToast?.getAnimations?.().length);
      document.documentElement.dataset.uiSmokeStage = 'sftp-toast-exit-settle';
      await new Promise(resolve => setTimeout(resolve, 220));
      const firstRemainingToast = toastStack?.querySelector('.toast');
      const toastReflowAnimated = matchMedia('(prefers-reduced-motion: reduce)').matches || Boolean(firstRemainingToast?.getAnimations?.().some(animation => animation.playState === 'running'));
      document.documentElement.dataset.uiSmokeStage = 'sftp-toast-reflow-settle';
      await new Promise(resolve => setTimeout(resolve, 320));
      const toastMovedUp = Boolean(firstRemainingToast
        && Number.isFinite(secondToastTopBefore)
        && firstRemainingToast.getBoundingClientRect().top < secondToastTopBefore - 4);
      dismissToast();
      jobUi = {
        found:Boolean(button && drawer && list),
        singleGlobalEntry,
        noPaneTaskRegions,
        failedStatusVisible,
        totalProgressVisible,
        totalProgressIndeterminate,
        totalProgressHidesWhenIdle,
        floatingVisibleBelowHeader,
        floatingActions,
        floatingResumeAction,
        floatingProgress,
        floatingOpensTaskCenter,
        floatingCloseHidesCurrent,
        floatingNewTaskReopens,
        floatingMutePersists,
        floatingSettingRestores,
         drawerOpened,
         taskCenterAboveNotifications,
         drawerDefaultCompact,
         currentOnly,
         currentActions,
         currentQueueActions,
         queueBatchControls,
         queueBatchDiagnostics,
         failedOnly,
         failedActions,
         failedClearAvailable,
         currentProgress,
         drawerResizable,
         drawerResizeAdaptive,
         drawerResizePersists,
         drawerResizeReset,
         drawerOversizeRecovers,
         drawerHeaderReset,
         drawerResizeClamps,
         deleteDuplicateBlocked,
         deleteKeepsDrawerOpen,
        taskLogInitialOpen,
        taskLogInitialBottom,
        taskLogRefreshKeepsOpen,
        taskLogRefreshShowsLatest,
        taskLogRefreshFollowsBottom,
        drawerFitsViewport,
        historyOnly,
        historyCounts,
        historyActions,
        generatedTaskUi,
        historyActionDiagnostics,
        outsideClickCloses,
        escapeCloses,
        runningStatusVisible,
        nativeDragTaskStopHidden,
        itemProgress,
        staleJobResponseIgnored,
        toastIconsAligned,
        toastOrderPreserved,
        stackedToastTitles,
        toastStackedDown,
        toastAvoidsFloatingTask,
        toastExitAnimated,
        toastReflowAnimated,
        toastMovedUp
      };
    } finally {
      api = previousApi;
      window.termaSftpTransferLifecycle.polling.start = previousJobTimer;
      window.termaSftpTaskWorkspace.state.jobs = previousLatestJobs;
      window.termaSftpTaskWorkspace.state.view = previousTaskCenterView;
      window.termaRuntimeSettingsModel.snapshot = previousJobRuntimeSettings;
      window.termaSftpTaskWorkspace.runtime.close();
      window.termaSftpTaskWorkspace.state.paint(previousLatestJobs);
      if (previousTaskCenterSize === null) localStorage.removeItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY);
      else localStorage.setItem(SFTP_TASK_CENTER_SIZE_STORAGE_KEY, previousTaskCenterSize);
    }

    const previousDownloadApi=api;
    const previousDownloadRefresh=window.termaSftpTaskWorkspace.runtime.refresh;
    const previousDownloadTimer=window.termaSftpTransferLifecycle.polling.start;
    const previousDownloadTabKey=activeTabKey;
    const desktopNotice=localStorage.getItem('sftpDesktopDownloadNoticeV1');
    const browserNotice=localStorage.getItem('sftpBrowserDownloadNoticeV1');
    let deliveryMode='desktop';
    let noticeCalls=0;
    const noticeMessages=[];
    const downloadRequests=[];
    let batchChoiceCalls=0;
    const downloadFixtureTab={key:'sftp-download-fixture',kind:'sftp',id:1,title:'下载测试'};
    try {
      tabs.push(downloadFixtureTab);
      activeTabKey=downloadFixtureTab.key;
      view.dataset.sftpTabKey=downloadFixtureTab.key;
      const downloadRuntime=window.termaSftpTabs.runtime.ensure(downloadFixtureTab.key,1,'/fixture',view);
      downloadRuntime.state={...fixtureRuntime.state,connectionId:1,path:'/fixture',entries:[...fixtureRuntime.state.entries]};


      window.termaSftpView.mount(view,downloadFixtureTab.key);
      window.termaSftpView.render(downloadFixtureTab.key);
      localStorage.removeItem('sftpDesktopDownloadNoticeV1');
      localStorage.removeItem('sftpBrowserDownloadNoticeV1');
      api=async (pathname,options={})=>{
        if(pathname==='/api/sftp/download-settings')return deliveryMode==='desktop'?{delivery_mode:'desktop',effective_directory:'C:\\Temp\\TermaFixture\\Downloads'}:{delivery_mode:'browser'};
        if(pathname.includes('/sftp/download')){
          const body=JSON.parse(options.body||'{}');
          const result={pathname,body,id:'notice-'+deliveryMode+'-'+downloadRequests.length,delivery_mode:deliveryMode};
          downloadRequests.push(result);
          return result;
        }
        return [];
      };
      window.termaSftpTaskWorkspace.runtime.refresh=async()=>[];
      window.termaSftpTransferLifecycle.polling.start=()=>{};
      document.documentElement.dataset.uiSmokeStage = 'sftp-download-desktop-first';
      const firstDownload = window.termaSftpTransfers.controller.download(1,'/tmp/first.txt');
      noticeMessages.push((await clickSftpFixtureChoice(0)).dialog); noticeCalls += 1;
      await firstDownload;
      document.documentElement.dataset.uiSmokeStage = 'sftp-download-desktop-second';
      await window.termaSftpTransfers.controller.download(1,'/tmp/second.txt');
      deliveryMode='browser';
      const downloadChecks=[...view.querySelectorAll('.sftp-check')];
      window.termaSftpView.clearSelection(activeTabKey);
      downloadChecks[0].click();
      downloadChecks[1].click();
      document.documentElement.dataset.uiSmokeStage = 'sftp-download-browser-batch';
      const batchDownload = window.termaSftpTransfers.controller.selection(activeTabKey);
      noticeMessages.push((await clickSftpFixtureChoice(0)).dialog); noticeCalls += 1;
      await clickSftpFixtureChoice(0); batchChoiceCalls += 1;
      await batchDownload;
      document.documentElement.dataset.uiSmokeStage = 'sftp-download-browser-mobile';
      await window.termaSftpTransfers.controller.download(1,'/tmp/mobile.txt');
    } finally {
      api=previousDownloadApi;
      window.termaSftpTaskWorkspace.runtime.refresh=previousDownloadRefresh;
      window.termaSftpTransferLifecycle.polling.start=previousDownloadTimer;
      activeTabKey=previousDownloadTabKey;
      const downloadFixtureIndex=tabs.findIndex(tab=>tab.key===downloadFixtureTab.key);
      if(downloadFixtureIndex>=0)tabs.splice(downloadFixtureIndex,1);
      window.termaSftpTabs.runtime.dispose(downloadFixtureTab.key);
      view.dataset.sftpTabKey=fixtureTabKey;
      fixtureRuntime.root=view;


      window.termaSftpView.mount(view,fixtureTabKey);
      window.termaSftpView.render(fixtureTabKey);
      window.termaSftpTaskWorkspace.state.pendingDownloads.clear();
      if(desktopNotice===null)localStorage.removeItem('sftpDesktopDownloadNoticeV1');else localStorage.setItem('sftpDesktopDownloadNoticeV1',desktopNotice);
      if(browserNotice===null)localStorage.removeItem('sftpBrowserDownloadNoticeV1');else localStorage.setItem('sftpBrowserDownloadNoticeV1',browserNotice);
    }
    const downloadNoticeUi={
      oncePerMode:noticeCalls===2,
      desktopPath:noticeMessages.some(message=>message.includes('C:\\Temp\\TermaFixture\\Downloads')),
      browserDevice:noticeMessages.some(message=>message.includes('当前设备')||message.includes('当前手机')),
      batchUsesSharedNotice:noticeCalls===2,
      browserSeparateChoice:batchChoiceCalls===1,
      browserSeparateQueued:downloadRequests.some(request=>request.pathname.endsWith('/sftp/download-batch')&&request.body.mode==='archive'&&request.body.paths?.[0]==='/fixture/folder')
        && downloadRequests.some(request=>request.pathname.endsWith('/sftp/download')&&request.body.path==='/fixture/'+specialName),
      noDuplicateBatchNotice:noticeCalls===2
    };
    document.documentElement.dataset.uiSmokeStage = 'sftp-text-editor-gbk';
    const editorPromise = window.termaSftpPreviewRuntime.editor.sftpTextModal('/tmp/gbk.txt', 'A', 1, 2, 'gbk', 'auto');
    await new Promise(resolve=>setTimeout(resolve,20));
    const editorWindow=[...document.querySelectorAll('.sftp-editor-floating-window')].at(-1);
    const editorHost=editorWindow?.querySelector('#sftpTextEditor');
    const languageSelect=editorWindow?.querySelector('#sftpEditorLanguage');
    const initialEditorRect=editorWindow?.querySelector('.sftp-editor-modal')?.getBoundingClientRect();
    const textEncodingUi={
      opened:Boolean(editorWindow?.querySelector('.sftp-editor-modal')),
      initialCentered:Boolean(initialEditorRect
        && Math.abs(initialEditorRect.left + initialEditorRect.width / 2 - innerWidth / 2) <= 2
        && Math.abs(initialEditorRect.top + initialEditorRect.height / 2 - innerHeight / 2) <= 2),
      aceLoaded:Boolean(editorHost?.classList.contains('ace_editor')),
      selected:editorWindow?.querySelector('#sftpTextEncoding')?.value||'',
      options:[...(editorWindow?.querySelectorAll('#sftpTextEncoding option')||[])].map(option=>option.value),
      languageOptions:[...(editorWindow?.querySelectorAll('#sftpEditorLanguage option')||[])].map(option=>option.value),
      manualLanguage:false,
      nonJsonFormattingHidden:false,
      jsonFormatting:false,
      jsonHiddenAfterLanguageChange:false,
      json5FormattingHidden:!window.termaSftpPreviewRuntime.editor.isSftpJsonFileName('/tmp/example.json5'),
      wordWrap:Boolean(editorWindow?.querySelector('#sftpEditorWordWrap')?.checked),
      persistDefault:Boolean(editorWindow?.querySelector('#sftpPersistEncoding')),
      backup:Boolean(editorWindow?.querySelector('#sftpBackupBeforeSave')?.checked),
      lineEndings:[...(editorWindow?.querySelectorAll('#sftpLineEnding option')||[])].map(option=>option.value),
      lineEndingLabelsLocalized:[...(editorWindow?.querySelectorAll('#sftpLineEnding option')||[])].every(option=>option.textContent===window.termaSftpPreviewRuntime.editor.sftpTextLineEndingOptions().find(([value])=>value===option.value)?.[1]),
      shellFormat:false
    };
    const gbkEditor=window.ace&&editorHost?ace.edit(editorHost):null;
    gbkEditor?.setValue('中',-1);
    await new Promise(resolve=>setTimeout(resolve,160));
    textEncodingUi.nonUtf8SaveAllowed=Boolean(!editorWindow?.querySelector('#sftpTextSave')?.disabled
      && editorWindow?.querySelector('#sftpEditorStats')?.textContent.includes('保存时检查大小'));
    const utf8Measurement=window.termaSftpPreviewRuntime.editor.sftpEditorByteMeasurement('中','utf8');
    const utf8BomMeasurement=window.termaSftpPreviewRuntime.editor.sftpEditorByteMeasurement('A','utf8bom');
    textEncodingUi.utf8LimitEnforced=utf8Measurement.exact&&utf8Measurement.bytes===3&&utf8Measurement.bytes>2;
    textEncodingUi.utf8BomIncludesPrefix=utf8BomMeasurement.exact&&utf8BomMeasurement.bytes===4;
    if (languageSelect) {
      languageSelect.value='markdown';
      languageSelect.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,20));
      textEncodingUi.manualLanguage=Boolean(window.ace&&editorHost&&ace.edit(editorHost).session.$modeId==='ace/mode/markdown');
      languageSelect.value='json';
      languageSelect.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,20));
      const nonJsonFormatButton=editorWindow?.querySelector('#sftpTextFormatJson');
      textEncodingUi.nonJsonFormattingHidden=Boolean(nonJsonFormatButton?.hidden)
        && getComputedStyle(nonJsonFormatButton).display==='none';
    }
    editorWindow?.querySelector('#sftpTextSave')?.click();
    const gbkSave=await editorPromise;
    textEncodingUi.nonUtf8SaveSubmitted=Boolean(gbkSave?.action==='save'&&gbkSave?.encoding==='gbk'&&gbkSave?.content==='中');
    document.documentElement.dataset.uiSmokeStage = 'sftp-text-editor-remote-save';
    let remoteSaveCalls=0;
    const remoteEditorPromise=window.termaSftpPreviewRuntime.editor.sftpTextModal('/tmp/keep-open.txt','A',1,512*1024,'utf8','auto',{
      onSave:async payload=>{
        remoteSaveCalls+=1;
        return {encoding:payload.encoding,line_ending:payload.line_ending};
      }
    });
    await new Promise(resolve=>setTimeout(resolve,20));
    const remoteEditorWindow=[...document.querySelectorAll('.sftp-editor-floating-window')].at(-1);
    const remoteEditorHost=remoteEditorWindow?.querySelector('#sftpTextEditor');
    window.ace&&remoteEditorHost&&ace.edit(remoteEditorHost).setValue('B',-1);
    await new Promise(resolve=>setTimeout(resolve,40));
    remoteEditorWindow?.querySelector('#sftpTextSave')?.click();
    await new Promise(resolve=>setTimeout(resolve,40));
    textEncodingUi.remoteSaveKeepsOpen=Boolean(remoteSaveCalls===1&&remoteEditorWindow?.isConnected&&!remoteEditorWindow?.hidden);
    remoteEditorWindow?.querySelector('#sftpTextClose')?.click();
    textEncodingUi.remoteEditorClosesExplicitly=(await remoteEditorPromise)===null;
    const shellEditorPromise=window.termaSftpPreviewRuntime.editor.sftpTextModal('/tmp/restart_Pms.sh','﻿#!/bin/bash\\r\\necho restart',31,512*1024,'utf8bom','auto',{lineEnding:'crlf',bom:true,finalNewline:false});
    await new Promise(resolve=>setTimeout(resolve,20));
    const shellEditorWindow=[...document.querySelectorAll('.sftp-editor-floating-window')].at(-1);
    const shellLineEnding=shellEditorWindow?.querySelector('#sftpLineEnding');
    const shellEncoding=shellEditorWindow?.querySelector('#sftpTextEncoding');
    const shellControlsReady=Boolean(shellLineEnding?.value==='crlf'&&!shellLineEnding.disabled&&shellEncoding?.value==='utf8');
    textEncodingUi.shellNonLfWarningPrepared=Boolean(window.termaSftpPreviewRuntime.editor.prepareSftpEditorSave('/tmp/risky.sh','#!/bin/sh\\necho risky','utf8','crlf').unsafeScriptLineEnding);
    if (shellLineEnding) shellLineEnding.value='lf';
    shellEditorWindow?.querySelector('#sftpTextSave')?.click();
    const shellSave=await shellEditorPromise;
    textEncodingUi.shellFormat=Boolean(shellControlsReady
      &&shellSave?.changed
      &&shellSave?.normalized_script
      &&shellSave?.encoding==='utf8'
      &&shellSave?.line_ending==='lf'
      &&shellSave?.content==='#!/bin/bash\\necho restart\\n');
    document.documentElement.dataset.uiSmokeStage = 'sftp-text-editor-normalization';
    const normalizationOnlyPromise=window.termaSftpPreviewRuntime.editor.sftpTextModal('/tmp/normalize-only.sh','ab',2,2,'utf8','auto',{lineEnding:'lf',bom:false,finalNewline:false});
    await new Promise(resolve=>setTimeout(resolve,20));
    const normalizationEditorWindow=[...document.querySelectorAll('.sftp-editor-floating-window')].at(-1);
    normalizationEditorWindow?.querySelector('#sftpTextSave')?.click();
    await new Promise(resolve=>setTimeout(resolve,20));
    textEncodingUi.normalizationOnlyLimitEnforced=Boolean(normalizationEditorWindow?.querySelector('#sftpTextSave')?.disabled
      &&normalizationEditorWindow?.querySelector('#sftpEditorStats')?.classList.contains('limit-exceeded'));
    normalizationEditorWindow?.querySelector('#sftpTextClose')?.click();
    await normalizationOnlyPromise;
    document.documentElement.dataset.uiSmokeStage = 'sftp-text-editor-large';
    const lightFixture='x'.repeat(1024*1024+37);
    const lightEditorPromise=window.termaSftpPreviewRuntime.editor.sftpTextModal('/tmp/large.log',lightFixture,lightFixture.length,2*1024*1024,'utf8','auto',{editorKind:'light',lineCount:1});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const lightEditorWindow=[...document.querySelectorAll('.sftp-editor-floating-window')].at(-1);
    const lightTextarea=lightEditorWindow?.querySelector('.sftp-light-editor-shell textarea');
    const lightPager=lightEditorWindow?.querySelector('.sftp-light-editor-pager');
    const lightPageInput=lightPager?.querySelector('input');
    const lightNextButton=lightPager?.querySelectorAll('button')?.[1];
    textEncodingUi.lightPaged=Boolean(lightTextarea
      && lightTextarea.value.length<=256*1024
      && Number(lightPageInput?.max||0)>=5
      && lightEditorWindow?.querySelector('#sftpEditorLanguage')?.disabled
      && lightEditorWindow?.querySelector('#sftpTextDiff')?.disabled);
    lightNextButton?.click();
    textEncodingUi.lightNextPage=Boolean(lightTextarea?.value.length<=256*1024 && lightPageInput?.value==='2');
    lightEditorWindow?.querySelector('#sftpTextClose')?.click();
    await lightEditorPromise;
    document.documentElement.dataset.uiSmokeStage = 'sftp-text-editor-json';
    const jsonEditorPromise=window.termaSftpPreviewRuntime.editor.sftpTextModal('/tmp/config.json','{"name":"Terma","items":[1,2]}',36,512*1024,'utf8','auto');
    await new Promise(resolve=>setTimeout(resolve,20));
    const jsonEditorWindow=[...document.querySelectorAll('.sftp-editor-floating-window')].at(-1);
    const jsonEditorHost=jsonEditorWindow?.querySelector('#sftpTextEditor');
    const jsonLanguageSelect=jsonEditorWindow?.querySelector('#sftpEditorLanguage');
    if (jsonLanguageSelect && window.ace && jsonEditorHost) {
      const jsonEditor=ace.edit(jsonEditorHost);
      const formatButton=jsonEditorWindow?.querySelector('#sftpTextFormatJson');
      formatButton?.click();
      await new Promise(resolve=>setTimeout(resolve,20));
      textEncodingUi.jsonFormatting=!formatButton?.hidden
        && getComputedStyle(formatButton).display!=='none'
        && jsonEditor.getValue().includes('\\n  "name": "Terma"')
        && jsonEditor.getValue().includes('\\n  "items": [');
      jsonLanguageSelect.value='markdown';
      jsonLanguageSelect.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,20));
      textEncodingUi.jsonHiddenAfterLanguageChange=Boolean(formatButton?.hidden)
        && getComputedStyle(formatButton).display==='none';
    }
    jsonEditorWindow?.querySelector('#sftpTextSave')?.click();
    await jsonEditorPromise;
      const previousImageReader=window.termaFileOpen.image;
      const previousImagePreviewText=window.termaSftpPreviewRuntime.text;
      const imagePreviewUi={};
      try {
      // The SFTP row assertions above replace previewSftpText with an action spy.
      // Restore the real implementation while exercising SVG preview/editor mode
      // transitions so this scenario covers the actual round-trip behavior.
      window.termaSftpPreviewRuntime.text=previousPreview;
      window.termaFileOpen.image=async ()=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" xmlns:cge="http://iec.ch/TC57/2005/SVG-schema#" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="500" viewBox="0 0 1200 500" onload="window.__unsafeSvg=true"><defs><style>.fixture-line{fill:none;stroke:rgb(34,197,94)} symbol{overflow:visible}</style><symbol id="fixture-switch" viewBox="0 0 10 10"><line x1="-5" y1="5" x2="15" y2="5" stroke="#f97316"/></symbol><symbol id="fixture-contrast" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#808080"/><path id="contrast-detail" d="M4 10h12" stroke="#fff"/></symbol></defs><script>window.__unsafeSvg=true</script><g id="BackGround_Layer"><rect id="canvas-background" width="1200" height="500" fill="#000"/></g><rect id="canvas-outline" width="1200" height="500" fill="none" stroke="#fff"/><polyline id="styled-line" class="fixture-line" points="80,180 180,180"/><path id="yellow-line" d="M80 200H180" stroke="#ffff00"/><use id="styled-use" xlink:href="#fixture-switch" x="200" y="175" width="10" height="10"/><use xlink:href="#fixture-switch" x="260" y="175" width="10" height="10"/><use id="contrast-use" xlink:href="#fixture-contrast" x="230" y="170" width="20" height="20"/><g id="line-to-PD_11100000_14419"><path d="M100 250H590" stroke="#ef4444"/><metadata><cge:GLink_Ref ObjectID="PD_11100000_14419"/></metadata></g><g id="neighbor-left"><rect x="280" y="220" width="40" height="60" fill="#64748b"/></g><g id="PD_11100000_14419" data-kind="needle"><rect x="590" y="230" width="20" height="40" fill="#2563eb"/><metadata><desc devId="PD_11100000_14419"/><cge:PSR_Ref ObjectID="PD_11100000_14419" ObjectName="needle"/><cge:GLink_Ref ObjectID="line-to-PD_11100000_14419"/></metadata></g><g id="TXT-PD_11100000_14419"><text x="600" y="300" fill="#fff">needle</text><text id="unicode-label" x="600" y="340" fill="#fff">服务器磁盘</text><metadata><cge:PSR_Ref ObjectID="TXT-PD_11100000_14419"/></metadata></g><g id="neighbor-right"><rect x="880" y="220" width="40" height="60" fill="#64748b"/></g><rect id="mono-fill" x="950" y="220" width="40" height="60" fill="#808080"/></svg>'],{type:'image/svg+xml'});
      document.documentElement.dataset.uiSmokeStage = 'sftp-svg-preview';
      await window.termaSftpPreviewRuntime.image(1,'/tmp/fixture.svg');
      document.documentElement.dataset.uiSmokeStage = 'sftp-svg-preview-frame';
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      document.documentElement.dataset.uiSmokeStage = 'sftp-svg-preview-controls';
      const svgStage=document.querySelector('#sftpImageStage');
      const currentSvgRoot=()=>svgStage?.shadowRoot?.querySelector('svg');
      const svgRoot=currentSvgRoot();
      const svgViewport=document.querySelector('#sftpImageViewport');
      const svgImageCard=document.querySelector('.sftp-image-modal');
      const svgOuterBefore=svgImageCard?.getBoundingClientRect();
      const svgFitViewportRect=svgViewport?.getBoundingClientRect();
      const svgFitStageRect=svgStage?.getBoundingClientRect();
      const svgZoomBefore=document.querySelector('#sftpImageZoomValue')?.textContent||'';
      imagePreviewUi.svgFitsCanvas=Boolean(svgFitViewportRect && svgFitStageRect
        && svgFitStageRect.left>=svgFitViewportRect.left-2
        && svgFitStageRect.right<=svgFitViewportRect.right+2
        && svgFitStageRect.top>=svgFitViewportRect.top-2
        && svgFitStageRect.bottom<=svgFitViewportRect.bottom+2);
      document.querySelector('#sftpImageZoomIn')?.click();
      const svgZoomAfterButton=document.querySelector('#sftpImageZoomValue')?.textContent||'';
      const svgOuterAfterButton=svgImageCard?.getBoundingClientRect();
      document.querySelector('#sftpImageViewport')?.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-100,bubbles:true,cancelable:true}));
      const svgZoomAfterWheel=document.querySelector('#sftpImageZoomValue')?.textContent||'';
      const svgOuterAfterWheel=svgImageCard?.getBoundingClientRect();
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}));
      const svgSearch=document.querySelector('#sftpSvgSearch');
      if (svgSearch) {
        svgSearch.value='PD_11100000_14419';
        svgSearch.dispatchEvent(new Event('input',{bubbles:true}));
      }
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const svgSearchZoom=Number.parseInt(document.querySelector('#sftpImageZoomValue')?.textContent||'',10);
      const svgSearchViewportRect=svgViewport?.getBoundingClientRect();
      const svgNeighborVisible=id=>{
        const rect=currentSvgRoot()?.querySelector(id)?.getBoundingClientRect();
        return Boolean(rect && svgSearchViewportRect && rect.right>svgSearchViewportRect.left && rect.left<svgSearchViewportRect.right && rect.bottom>svgSearchViewportRect.top && rect.top<svgSearchViewportRect.bottom);
      };
      imagePreviewUi.svgOpened=Boolean(svgRoot);
      imagePreviewUi.svgSanitized=Boolean(svgRoot && !svgRoot.hasAttribute('onload') && !svgRoot.querySelector('script') && window.__unsafeSvg!==true);
      imagePreviewUi.svgEmbeddedStyles=Boolean(svgRoot
        && getComputedStyle(svgRoot.querySelector('#styled-line')).stroke==='rgb(34, 197, 94)'
        && getComputedStyle(svgRoot.querySelector('#fixture-switch')).overflow==='visible');
      const colorModeSelect=document.querySelector('#sftpImageColorMode');
      const colorModeLabel=document.querySelector('.sftp-svg-color-mode-label');
      const imageTools=document.querySelector('.sftp-image-tools');
      imagePreviewUi.svgColorModeNotClipped=Boolean(svgImageCard
        && getComputedStyle(svgImageCard).overflow==='visible'
        && imageTools
        && getComputedStyle(imageTools).overflow==='visible');
      if (colorModeSelect) {
        colorModeSelect.value='invert-mono';
        colorModeSelect.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const monoRoot=currentSvgRoot();
      const monoGray=monoRoot?.querySelector('#mono-fill')?.getAttribute('fill')||'';
      const monoColor=monoRoot?.querySelector('#PD_11100000_14419 rect')?.getAttribute('fill')||'';
      if (colorModeSelect) {
        colorModeSelect.value='invert-bw';
        colorModeSelect.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const blackWhiteRoot=currentSvgRoot();
      const blackWhiteColor=blackWhiteRoot?.querySelector('#PD_11100000_14419 rect')?.getAttribute('fill')||'';
      const blackWhiteStyledLine=blackWhiteRoot?.querySelector('#styled-line') ? getComputedStyle(blackWhiteRoot.querySelector('#styled-line')).stroke||'' : '';
      const blackWhiteBackground=blackWhiteRoot?.querySelector('#canvas-background')?.getAttribute('fill')||'';
      const blackWhiteOutline=blackWhiteRoot?.querySelector('#canvas-outline')?.getAttribute('stroke')||'';
      const blackWhiteYellowLine=blackWhiteRoot?.querySelector('#yellow-line')?.getAttribute('stroke')||'';
      const blackWhiteText=blackWhiteRoot?.querySelector('#unicode-label')?.getAttribute('fill')||'';
      const blackWhiteContrastDetail=blackWhiteRoot?.querySelector('#contrast-detail')?.getAttribute('stroke')||'';
      if (colorModeSelect) {
        colorModeSelect.value='invert-color';
        colorModeSelect.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const colorRoot=currentSvgRoot();
      const colorValue=colorRoot?.querySelector('#PD_11100000_14419 rect')?.getAttribute('fill')||'';
      imagePreviewUi.svgInvertPreview=Boolean(colorModeSelect
        && colorModeLabel?.textContent?.trim()
        && [...colorModeSelect.options].map(option=>option.value).join(',')==='original,invert-mono,invert-bw,invert-color'
        && svgStage?.style.filter===''
        && monoGray==='rgb(0, 0, 0)'
        && monoColor==='#2563eb'
        && blackWhiteBackground==='rgb(255, 255, 255)'
        && blackWhiteOutline==='rgb(0, 0, 0)'
        && blackWhiteColor==='rgb(0, 0, 0)'
        && blackWhiteStyledLine==='rgb(0, 0, 0)'
        && blackWhiteYellowLine==='rgb(0, 0, 0)'
        && blackWhiteText==='rgb(0, 0, 0)'
        && blackWhiteContrastDetail==='rgb(0, 0, 0)'
        && colorValue==='rgb(218, 156, 20)');
      // Verify view preservation through the rendered controls rather than
      // reaching into previewSftpImage's private scale/fitMode closure.
      document.querySelector('#sftpImageZoomIn')?.click();
      if (svgViewport) {
        svgViewport.scrollLeft=120;
        svgViewport.scrollTop=80;
      }
      const preserveZoomBefore=document.querySelector('#sftpImageZoomValue')?.textContent||'';
      const preserveScrollBefore={left:svgViewport?.scrollLeft || 0, top:svgViewport?.scrollTop || 0};
      if (colorModeSelect) {
        colorModeSelect.value='invert-bw';
        colorModeSelect.dispatchEvent(new Event('change',{bubbles:true}));
      }
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      imagePreviewUi.svgColorModePreservesView=Boolean(
        preserveZoomBefore
        && document.querySelector('#sftpImageZoomValue')?.textContent===preserveZoomBefore
        && Math.abs((svgViewport?.scrollLeft || 0)-preserveScrollBefore.left)<=2
        && Math.abs((svgViewport?.scrollTop || 0)-preserveScrollBefore.top)<=2
      );
      if (colorModeSelect) {
        colorModeSelect.value='original';
        colorModeSelect.dispatchEvent(new Event('change',{bubbles:true}));
      }
      imagePreviewUi.svgOuterWindowStable=Boolean(svgOuterBefore && svgOuterAfterButton && svgOuterAfterWheel
        && Math.abs(svgOuterBefore.width-svgOuterAfterButton.width)<=1
        && Math.abs(svgOuterBefore.height-svgOuterAfterButton.height)<=1
        && Math.abs(svgOuterBefore.width-svgOuterAfterWheel.width)<=1
        && Math.abs(svgOuterBefore.height-svgOuterAfterWheel.height)<=1);
      imagePreviewUi.svgZoomButtons=Boolean(svgZoomBefore && svgZoomAfterButton && svgZoomAfterButton!==svgZoomBefore);
      imagePreviewUi.svgCtrlWheel=Boolean(svgZoomAfterWheel && svgZoomAfterWheel!==svgZoomAfterButton);
      imagePreviewUi.svgSearchFocused=document.activeElement===svgSearch;
      imagePreviewUi.svgSearchLocated=Boolean(currentSvgRoot()?.querySelector('#PD_11100000_14419.sftp-svg-search-current') && document.querySelector('#sftpSvgSearchCount')?.textContent==='1/1');
      imagePreviewUi.svgSearchDiagnostics={
        count:document.querySelector('#sftpSvgSearchCount')?.textContent||'',
        query:svgSearch?.value||'',
        marked:Boolean(currentSvgRoot()?.querySelector('#PD_11100000_14419.sftp-svg-search-current')),
        currentRoot:Boolean(currentSvgRoot())
      };
      const svgSearchTargetRect=currentSvgRoot()?.querySelector('#PD_11100000_14419')?.getBoundingClientRect();
      imagePreviewUi.svgSearchKeepsContext=Boolean(Number.isFinite(svgSearchZoom)
        && svgSearchZoom<=400
        && svgSearchViewportRect
        && svgSearchTargetRect
        && svgSearchTargetRect.right>svgSearchViewportRect.left
        && svgSearchTargetRect.left<svgSearchViewportRect.right
        && svgSearchTargetRect.bottom>svgSearchViewportRect.top
        && svgSearchTargetRect.top<svgSearchViewportRect.bottom);
      const previousGeneratedDownload=window.termaSftpPreviewRuntime.download;
      document.documentElement.dataset.uiSmokeStage = 'sftp-svg-preview-pdf';
      let generatedPdfBlob=null;
      window.termaSftpPreviewRuntime.download=(blob)=>{ generatedPdfBlob=blob; };
      let generatedPdfError='';
      try {
        const pdfFixture = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="500" viewBox="0 0 1200 500"><text x="600" y="340">服务器磁盘</text></svg>'],{type:'image/svg+xml'});
        generatedPdfBlob = await window.termaSftpPreviewRuntime.svgExport.createSftpSvgPdfBlob(pdfFixture);
        const colorFixture = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="rgb(255,0,0)"/><path d="M0 0h20" stroke="#ffffff"/></svg>'],{type:'image/svg+xml'});
        const invertedPdfBlob = await window.termaSftpPreviewRuntime.svgExport.createSftpSvgPdfBlob(colorFixture, {colorMode:'invert-color'});
        const blackWhitePdfBlob = await window.termaSftpPreviewRuntime.svgExport.createSftpSvgPdfBlob(colorFixture, {colorMode:'invert-bw'});
        const invertedSvgText = await (await window.termaSftpPreviewRuntime.svgExport.createSftpSvgDownloadBlob(colorFixture, {colorMode:'invert-color'})).text();
        const blackWhiteSvgText = await (await window.termaSftpPreviewRuntime.svgExport.createSftpSvgDownloadBlob(colorFixture, {colorMode:'invert-bw'})).text();
        const styledSvgFixture = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><style>.bus{stroke:#ff0000;fill:#00ff00}</style><path class="bus" d="M0 0h20"/></svg>'],{type:'image/svg+xml'});
        const styledBlackWhiteSvgText = await (await window.termaSftpPreviewRuntime.svgExport.createSftpSvgDownloadBlob(styledSvgFixture, {colorMode:'invert-bw'})).text();
        imagePreviewUi.svgPdfInvert=Boolean(invertedPdfBlob instanceof Blob
          && blackWhitePdfBlob instanceof Blob
          && invertedPdfBlob.size>0
          && blackWhitePdfBlob.size>0
          && window.termaSftpPreviewRuntime.svgExport.sftpSvgPdfInvertColor('rgb(255, 0, 0)')==='rgb(0, 255, 255)'
          && window.termaSftpPreviewRuntime.svgExport.sftpSvgPdfInvertColor('rgb(255, 0, 0)','invert-mono')==='rgb(255, 0, 0)'
          && window.termaSftpPreviewRuntime.svgExport.sftpSvgPdfInvertColor('#808080','invert-mono')==='rgb(0, 0, 0)'
          && window.termaSftpPreviewRuntime.svgExport.sftpSvgPdfInvertColor('rgb(255, 0, 0)','invert-bw')==='rgb(0, 0, 0)'
          && window.termaSftpPreviewRuntime.svgExport.sftpSvgPdfInvertColor('yellow','invert-bw')==='rgb(0, 0, 0)'
          && window.termaSftpPreviewRuntime.svgExport.sftpSvgPdfInvertColor('#ffffff')==='rgb(0, 0, 0)'
          && window.termaSftpPreviewRuntime.svgExport.sftpSvgPdfInvertColor('white')==='rgb(0, 0, 0)'
          && invertedSvgText.includes('rgb(0, 255, 255)')
          && blackWhiteSvgText.includes('rgb(0, 0, 0)')
          && styledBlackWhiteSvgText.includes('stroke:rgb(0, 0, 0)')
          && styledBlackWhiteSvgText.includes('fill:rgb(0, 0, 0)'));
      } catch (error) { generatedPdfError=String(error?.stack || error); }
      const generatedPdfBytes=generatedPdfBlob ? new Uint8Array(await generatedPdfBlob.arrayBuffer()) : new Uint8Array();
      const generatedPdfText=new TextDecoder('latin1').decode(generatedPdfBytes);
      imagePreviewUi.svgPdfUnicode=Boolean(generatedPdfBlob instanceof Blob
        && generatedPdfBytes.length>10000
        && generatedPdfText.includes('TermaNotoSansSC')
        && generatedPdfText.includes('/ToUnicode'));
      const mediaBoxPrefix='MediaBox [0 0 ';
      const mediaBoxStart=generatedPdfText.indexOf(mediaBoxPrefix);
      const mediaBoxEnd=mediaBoxStart>=0 ? generatedPdfText.indexOf(']',mediaBoxStart+mediaBoxPrefix.length) : -1;
      const mediaBoxValues=mediaBoxStart>=0 && mediaBoxEnd>mediaBoxStart
        ? generatedPdfText.slice(mediaBoxStart+mediaBoxPrefix.length,mediaBoxEnd).split(' ').filter(Boolean).map(Number)
        : [];
      imagePreviewUi.svgPdfLandscape=Boolean(mediaBoxValues.length>=2
        && Number(mediaBoxValues[0])>Number(mediaBoxValues[1])
        && Number(mediaBoxValues[0])/Number(mediaBoxValues[1])>2);
      const parNamespace='http://www.w3.org/2000/svg';
      const parSymbol=document.createElementNS(parNamespace,'symbol');
      parSymbol.setAttribute('viewBox','0 0 10 10');
      parSymbol.setAttribute('preserveAspectRatio','xMidYMid meet');
      const parUse=document.createElementNS(parNamespace,'use');
      parUse.setAttribute('x','100');
      parUse.setAttribute('y','200');
      parUse.setAttribute('width','20');
      parUse.setAttribute('height','10');
      const parViewport=window.termaSftpPreviewRuntime.svgExport.sftpSvgPdfViewportTransform(parUse,parSymbol,[0,0,10,10]);
      imagePreviewUi.svgPreserveAspectRatio=Boolean(parViewport.scaleX===1
        && parViewport.scaleY===1
        && parViewport.offsetX===5
        && parViewport.offsetY===0);
      imagePreviewUi.svgPdfError=generatedPdfError;
      window.termaSftpPreviewRuntime.download=previousGeneratedDownload;
      document.documentElement.dataset.uiSmokeStage = 'sftp-svg-preview-clear-search';
      if (svgSearch) {
        svgSearch.value='';
        svgSearch.dispatchEvent(new Event('input',{bubbles:true}));
      }
      // Let the color-mode restoration frame finish before exercising search
      // clearing; otherwise its queued callback can legitimately restore the
      // pre-toggle zoom after the clear-search fit has run.
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
      const svgClearViewportRect=svgViewport?.getBoundingClientRect();
      const svgClearStageRect=svgStage?.getBoundingClientRect();
      const svgClearZoom=Number.parseInt(document.querySelector('#sftpImageZoomValue')?.textContent||'',10);
      imagePreviewUi.svgSearchClearFits=Boolean(svgClearViewportRect && svgClearStageRect
        && Number.isFinite(svgClearZoom)
        && svgClearZoom<=100
        && svgClearStageRect.width<=svgClearViewportRect.width+4
        && svgClearStageRect.height<=svgClearViewportRect.height+4
        && document.querySelector('.sftp-svg-match-marker')?.hidden);
      document.querySelector('#sftpImageFullscreen')?.click();
      notify('SVG fullscreen notification layer test','info');
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const fullscreenToast=document.querySelector('#toast .toast:last-child');
      const fullscreenToastRect=fullscreenToast?.getBoundingClientRect();
      const notificationStack=document.querySelector('#toast');
      const notificationZ=Number.parseInt(getComputedStyle(notificationStack).zIndex||'0',10);
      const modalZ=Number.parseInt(getComputedStyle(document.querySelector('#modal')).zIndex||'0',10);
      const topElement=fullscreenToastRect
        ? document.elementFromPoint(fullscreenToastRect.left+Math.min(12,fullscreenToastRect.width/2),fullscreenToastRect.top+Math.min(12,fullscreenToastRect.height/2))
        : null;
      imagePreviewUi.notificationAboveFullscreen=Boolean(document.querySelector('.sftp-image-modal.is-fullscreen')
        && notificationZ>modalZ
        && topElement?.closest?.('.toast')===fullscreenToast);
      dismissToast(fullscreenToast);
      const svgModeSelect=document.querySelector('#sftpImageViewMode');
      if (svgModeSelect) {
        document.documentElement.dataset.uiSmokeStage = 'sftp-svg-preview-edit-mode';
        const svgModeApi=api;
        const svgModeTextReader=window.termaFileOpen.text;
        const svgModeSource=currentSvgRoot()?.outerHTML||'';
        let svgModeTextReadCalls=0;
        let svgModeSaveCalls=0;
        window.termaFileOpen.text=async ()=>{
          svgModeTextReadCalls+=1;
          return {
            content:svgModeSource,
            size:new TextEncoder().encode(svgModeSource).length,
            limit:50*1024*1024,
            encoding:'gbk',
            preferred_encoding:'auto',
            line_ending:'lf',
            final_newline:false,
            needs_format_repair:false,
            editor_kind:'ace',
            is_cancelled:()=>false
          };
        };
        api=async (pathname,options={})=>{
          if (String(pathname).endsWith('/sftp/write')) {
            svgModeSaveCalls+=1;
            return {encoding:'utf8',line_ending:'lf'};
          }
          if (String(pathname).includes('/sftp/versions?')) return {versions:[]};
          return svgModeApi(pathname,options);
        };
        svgModeSelect.value='split';
        svgModeSelect.dispatchEvent(new Event('change',{bubbles:true}));
        for (let attempt=0; attempt<120 && !document.querySelector('.sftp-editor-floating-window #sftpSvgEditorMode'); attempt+=1) {
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        const svgEditorWindow=[...document.querySelectorAll('.sftp-editor-floating-window')].at(-1);
        document.documentElement.dataset.uiSmokeStage = 'sftp-svg-preview-edit-mounted';
        const svgEditorMode=svgEditorWindow?.querySelector('#sftpSvgEditorMode');
        const svgEditorPreview=svgEditorWindow?.querySelector('#sftpSvgEditorPreview');
        imagePreviewUi.svgRemoteUsesEncodingAwareRead=svgModeTextReadCalls===1;
        imagePreviewUi.svgRemoteEncodingPreserved=svgEditorWindow?.querySelector('#sftpTextEncoding')?.value==='gbk';
        imagePreviewUi.svgModeControl=Boolean([...svgModeSelect.options].map(option=>option.value).join(',')==='preview,edit,split');
        imagePreviewUi.svgSplitDiagnostics={
          editorWindow:Boolean(svgEditorWindow),
          mode:svgEditorMode?.value||'',
          workspaceClass:svgEditorWindow?.querySelector('#sftpEditorWorkspace')?.className||'',
          previewHidden:svgEditorPreview?.hidden,
          stage:Boolean(svgEditorPreview?.querySelector('.sftp-svg-editor-preview-stage')),
          stageShadow:Boolean(svgEditorPreview?.querySelector('.sftp-svg-editor-preview-stage')?.shadowRoot),
          stageSvg:Boolean(svgEditorPreview?.querySelector('.sftp-svg-editor-preview-stage')?.shadowRoot?.querySelector('svg')),
          previewText:svgEditorPreview?.textContent||''
        };
        imagePreviewUi.svgSplitEditor=Boolean(svgEditorWindow
          && svgEditorMode?.value==='split'
          && svgEditorWindow.querySelector('#sftpEditorWorkspace')?.classList.contains('showing-svg-preview')
          && svgEditorPreview?.querySelector('.sftp-svg-editor-preview-stage')?.shadowRoot?.querySelector('svg'));
        if (svgEditorMode) svgEditorMode.value='edit';
        svgEditorMode?.dispatchEvent(new Event('change',{bubbles:true}));
        if (svgEditorMode) svgEditorMode.value='split';
        svgEditorMode?.dispatchEvent(new Event('change',{bubbles:true}));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        imagePreviewUi.svgSplitRefresh=false;
        const svgEditorHost=svgEditorWindow?.querySelector('#sftpTextEditor');
        const svgAceEditor=svgEditorHost?.__termaAceEditor || (svgEditorHost && window.ace ? ace.edit(svgEditorHost) : null);
        const svgEditorInput=svgEditorWindow?.querySelector('textarea.text-editor');
        const svgAutoFocusToggle=svgEditorPreview?.querySelector('[data-svg-preview-auto-focus]');
        const svgLiveRefreshId='terma-svg-live-refresh';
        const svgLiveRefreshSource=svgAceEditor?.getValue?.() ?? svgEditorInput?.value ?? '';
        const svgLiveRefreshNext=svgLiveRefreshSource.replace(/<\\/svg>/i,'<rect id="'+svgLiveRefreshId+'" width="1" height="1"/></svg>');
        if (svgLiveRefreshNext!==svgLiveRefreshSource) {
          if (svgAceEditor) svgAceEditor.setValue(svgLiveRefreshNext,-1);
          else if (svgEditorInput) {
            svgEditorInput.value=svgLiveRefreshNext;
            svgEditorInput.dispatchEvent(new Event('input',{bubbles:true}));
          }
          await new Promise(resolve=>setTimeout(resolve,240));
        }
        const svgEditorRoot=svgEditorPreview?.querySelector('.sftp-svg-editor-preview-stage')?.shadowRoot?.querySelector('svg');
        imagePreviewUi.svgSplitRefresh=Boolean(svgEditorRoot?.querySelector('#'+svgLiveRefreshId));
        const svgEditorSearchToggle=svgEditorWindow?.querySelector('#sftpEditorSearchToggle');
        const svgEditorSearchInput=svgEditorWindow?.querySelector('#sftpEditorSearchInput');
        const svgEditorSearchClose=svgEditorWindow?.querySelector('#sftpEditorSearchClose');
        svgEditorSearchToggle?.click();
        if (svgEditorSearchInput) {
          svgEditorSearchInput.value=svgLiveRefreshId;
          svgEditorSearchInput.dispatchEvent(new Event('input',{bubbles:true}));
        }
        await new Promise(resolve=>setTimeout(resolve,220));
        imagePreviewUi.svgLongLineSearch=Boolean(svgEditorSearchInput
          && svgEditorWindow?.querySelector('#sftpEditorSearchCount')?.textContent==='1/1'
          && svgAceEditor?.getSelectedText?.().includes(svgLiveRefreshId));
        imagePreviewUi.svgLongLineSearchDiagnostics={
          count:svgEditorWindow?.querySelector('#sftpEditorSearchCount')?.textContent||'',
          selectedText:svgAceEditor?.getSelectedText?.()||''
        };
        svgEditorSearchClose?.click();
        const svgClickTarget=svgEditorRoot?.querySelector('#PD_11100000_14419');
        const svgAutoFocusZoomBefore=Number.parseInt(svgEditorPreview?.querySelector('[data-svg-preview-zoom-value]')?.textContent||'',10);
        const svgEditorClickBeforePosition=svgAceEditor?.getCursorPosition?.();
        svgClickTarget?.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}));
        await new Promise(resolve=>setTimeout(resolve,700));
        const svgEditorClickPosition=svgAceEditor?.getCursorPosition?.();
        const svgEditorClickRow=svgEditorClickPosition?.row;
        const svgEditorClickLine=Number.isFinite(svgEditorClickRow) ? svgAceEditor.session.getLine(svgEditorClickRow) : '';
        const svgEditorClickSelection=svgAceEditor?.getSelectionRange?.();
        const svgEditorClickSelectedText=svgAceEditor?.getSelectedText?.()||'';
        const svgEditorClickScrollValue=svgAceEditor?.renderer?.getScrollLeft?.() ?? svgAceEditor?.renderer?.scroller?.scrollLeft;
        const svgEditorClickScrollLeft=Number(svgEditorClickScrollValue);
        const svgEditorClickScrollerRect=svgAceEditor?.renderer?.scroller?.getBoundingClientRect?.();
        const svgEditorClickScreenPosition=svgEditorClickSelection?.start
          ? svgAceEditor?.renderer?.textToScreenCoordinates?.(svgEditorClickSelection.start.row,svgEditorClickSelection.start.column)
          : null;
        const svgEditorClickViewportX=Number(svgEditorClickScreenPosition?.pageX)-Number(window.scrollX||0);
        const svgEditorClickHorizontallyVisible=Boolean(svgEditorClickScrollerRect
          && Number.isFinite(svgEditorClickScrollLeft)
          && Number.isFinite(svgEditorClickViewportX)
          && svgEditorClickViewportX>=svgEditorClickScrollerRect.left
          && svgEditorClickViewportX<=svgEditorClickScrollerRect.right);
        const svgEditorClickMarkers=svgAceEditor?.session?.getMarkers?.(true)||{};
        const svgEditorClickHasMarker=Object.values(svgEditorClickMarkers).some(marker=>String(marker?.clazz||marker?.className||'').includes('sftp-svg-source-target'));
        const svgClickTargetAfter=svgEditorRoot?.querySelector('#PD_11100000_14419');
        const svgAutoFocusZoomAfter=Number.parseInt(svgEditorPreview?.querySelector('[data-svg-preview-zoom-value]')?.textContent||'',10);
        const svgAutoFocusViewport=svgEditorPreview?.querySelector('.sftp-svg-editor-preview-viewport');
        const svgAutoFocusViewportRect=svgAutoFocusViewport?.getBoundingClientRect();
        const svgAutoFocusStageRect=svgEditorPreview?.querySelector('.sftp-svg-editor-preview-stage')?.getBoundingClientRect();
        const svgAutoFocusTargetRect=svgClickTargetAfter?.getBoundingClientRect();
        const svgAutoFocusCenterX=svgAutoFocusViewportRect && svgAutoFocusViewport
          ? svgAutoFocusViewportRect.left+svgAutoFocusViewport.clientLeft+svgAutoFocusViewport.clientWidth/2
          : Number.NaN;
        const svgAutoFocusCenterY=svgAutoFocusViewportRect && svgAutoFocusViewport
          ? svgAutoFocusViewportRect.top+svgAutoFocusViewport.clientTop+svgAutoFocusViewport.clientHeight/2
          : Number.NaN;
        const svgAutoFocusCentered=Boolean(svgAutoFocusViewportRect && svgAutoFocusTargetRect
          && Math.abs(svgAutoFocusTargetRect.left+svgAutoFocusTargetRect.width/2-svgAutoFocusCenterX)<=4
          && Math.abs(svgAutoFocusTargetRect.top+svgAutoFocusTargetRect.height/2-svgAutoFocusCenterY)<=4);
        imagePreviewUi.svgSplitAutoFocus=Boolean(svgAutoFocusToggle
          && svgAutoFocusToggle.checked
          && Number.isFinite(svgAutoFocusZoomBefore)
          && Number.isFinite(svgAutoFocusZoomAfter)
          && svgAutoFocusZoomAfter>svgAutoFocusZoomBefore
          && svgAutoFocusCentered);
        imagePreviewUi.svgSplitAutoFocusDiagnostics={
          checked:Boolean(svgAutoFocusToggle?.checked),
          zoomBefore:svgAutoFocusZoomBefore,
          zoomAfter:svgAutoFocusZoomAfter,
          centered:svgAutoFocusCentered,
          viewport:svgAutoFocusViewportRect ? {
            left:Math.round(svgAutoFocusViewportRect.left),
            top:Math.round(svgAutoFocusViewportRect.top),
            width:Math.round(svgAutoFocusViewportRect.width),
            height:Math.round(svgAutoFocusViewportRect.height),
            clientWidth:svgAutoFocusViewport?.clientWidth||0,
            clientHeight:svgAutoFocusViewport?.clientHeight||0
          } : null,
          target:svgAutoFocusTargetRect ? {
            left:Math.round(svgAutoFocusTargetRect.left),
            top:Math.round(svgAutoFocusTargetRect.top),
            width:Math.round(svgAutoFocusTargetRect.width),
            height:Math.round(svgAutoFocusTargetRect.height)
          } : null,
          stage:svgAutoFocusStageRect ? {
            left:Math.round(svgAutoFocusStageRect.left),
            top:Math.round(svgAutoFocusStageRect.top),
            width:Math.round(svgAutoFocusStageRect.width),
            height:Math.round(svgAutoFocusStageRect.height)
          } : null,
          scroll:svgEditorPreview?.querySelector('.sftp-svg-editor-preview-viewport') ? {
            left:Math.round(svgEditorPreview.querySelector('.sftp-svg-editor-preview-viewport').scrollLeft),
            top:Math.round(svgEditorPreview.querySelector('.sftp-svg-editor-preview-viewport').scrollTop)
          } : null,
          hintAfterClick:svgEditorPreview?.querySelector('[data-svg-preview-source]')?.textContent||'',
          highlightedIds:[...svgEditorRoot?.querySelectorAll('.sftp-svg-editor-cursor-current')||[]].map(node=>node.getAttribute('id')).filter(Boolean)
        };
        imagePreviewUi.svgSplitClickToEditor=Boolean(svgClickTargetAfter?.classList.contains('sftp-svg-editor-cursor-current')
          && svgEditorClickLine.includes('PD_11100000_14419')
          && (!svgEditorClickBeforePosition
            || svgEditorClickBeforePosition.row!==svgEditorClickPosition?.row
            || svgEditorClickBeforePosition.column!==svgEditorClickPosition?.column));
        imagePreviewUi.svgSplitOneLineSourceFocus=Boolean(svgAceEditor
          && svgEditorClickSelection
          && svgEditorClickSelection.start?.row===svgEditorClickSelection.end?.row
          && svgEditorClickSelectedText.includes('PD_11100000_14419')
          && svgEditorClickHasMarker
          && svgEditorClickHorizontallyVisible);
        imagePreviewUi.svgSplitSourceFocusDiagnostics={
          selectedText:svgEditorClickSelectedText.slice(0,180),
          range:svgEditorClickSelection ? {
            start:svgEditorClickSelection.start,
            end:svgEditorClickSelection.end
          } : null,
          scrollLeft:svgEditorClickScrollLeft,
          viewportX:svgEditorClickViewportX,
          horizontallyVisible:svgEditorClickHorizontallyVisible,
          hasMarker:svgEditorClickHasMarker
        };
        const svgStyledUse=svgEditorRoot?.querySelector('#styled-use');
        svgStyledUse?.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const styledUsePosition=svgAceEditor?.getCursorPosition?.();
        const styledUseLine=Number.isFinite(styledUsePosition?.row) ? svgAceEditor.session.getLine(styledUsePosition.row) : '';
        const styledUseSource=svgAceEditor?.getValue?.()||svgEditorInput?.value||'';
        const styledUseCursorText=Number.isFinite(styledUsePosition?.row)
          ? styledUseSource.slice(svgAceEditor.session.getDocument().positionToIndex(styledUsePosition,0), svgAceEditor.session.getDocument().positionToIndex(styledUsePosition,0)+48)
          : '';
        imagePreviewUi.svgSplitUseIdClickToEditor=Boolean(styledUseLine.includes('styled-use')
          && styledUseCursorText.includes('<use id="styled-use"'));
        const svgAnonymousUse=[...(svgEditorRoot?.querySelectorAll('use:not([id])')||[])].find(node=>node.getAttribute('xlink:href')==='#fixture-switch' || node.getAttribute('href')==='#fixture-switch');
        svgAnonymousUse?.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const anonymousUsePosition=svgAceEditor?.getCursorPosition?.();
        const anonymousUseLine=Number.isFinite(anonymousUsePosition?.row) ? svgAceEditor.session.getLine(anonymousUsePosition.row) : '';
        const anonymousUseSource=svgAceEditor?.getValue?.()||svgEditorInput?.value||'';
        const anonymousUseCursorText=Number.isFinite(anonymousUsePosition?.row)
          ? anonymousUseSource.slice(svgAceEditor.session.getDocument().positionToIndex(anonymousUsePosition,0), svgAceEditor.session.getDocument().positionToIndex(anonymousUsePosition,0)+48)
          : '';
        imagePreviewUi.svgSplitUseReferenceClickToEditor=Boolean(anonymousUseLine.includes('href="#fixture-switch"')
          && anonymousUseCursorText.startsWith('<use ')
          && anonymousUseCursorText.includes('href="#fixture-switch"'));
        imagePreviewUi.svgSplitUseDiagnostics={
          styledLine:styledUseLine.slice(0,180),
          styledCursor:styledUseCursorText,
          anonymousLine:anonymousUseLine.slice(0,180),
          anonymousCursor:anonymousUseCursorText
        };
        if (svgAutoFocusToggle) {
          svgAutoFocusToggle.checked=false;
          svgAutoFocusToggle.dispatchEvent(new Event('change',{bubbles:true}));
        }
        svgEditorPreview?.querySelector('[data-svg-preview-zoom="out"]')?.click();
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const svgPreviewMarker=svgEditorPreview?.querySelector('[data-svg-preview-marker]');
        imagePreviewUi.svgSplitMarkerVisibleWithoutAutoFocus=Boolean(svgPreviewMarker
          && !svgPreviewMarker.hidden
          && getComputedStyle(svgPreviewMarker).width!=='0px');
        const controlCard=svgEditorWindow?.querySelector('.sftp-editor-modal');
        const controlWidthBefore=controlCard?.style.width||'';
        if (controlCard) controlCard.style.width='760px';
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const controlRects=[...(svgEditorWindow?.querySelector('.sftp-editor-controls')?.children||[])].map(node=>node.getBoundingClientRect()).filter(rect=>rect.width>0&&rect.height>0);
        const firstControlTop=Math.min(...controlRects.map(rect=>rect.top));
        const firstControlLeft=Math.min(...controlRects.map(rect=>rect.left));
        const wrappedControls=controlRects.filter(rect=>rect.top>firstControlTop+50);
        imagePreviewUi.svgEditorControlsWrapFromFirstColumn=Boolean(wrappedControls.length
          && wrappedControls.every(rect=>Math.abs(rect.left-firstControlLeft)<=2));
        imagePreviewUi.svgEditorControlsDiagnostics={
          width:controlCard?.getBoundingClientRect?.().width||0,
          rects:controlRects.map(rect=>({left:Math.round(rect.left),top:Math.round(rect.top),width:Math.round(rect.width),height:Math.round(rect.height)})),
          firstControlLeft:Math.round(firstControlLeft),
          wrappedCount:wrappedControls.length
        };
        if (controlCard) {
          if (controlWidthBefore) controlCard.style.width=controlWidthBefore;
          else controlCard.style.removeProperty('width');
        }
        svgEditorPreview?.querySelector('[data-svg-preview-zoom="in"]')?.click();
        imagePreviewUi.svgSplitManualZoomDisablesAutoFocus=Boolean(svgAutoFocusToggle && !svgAutoFocusToggle.checked);
        const svgRoundTripMarker='<!-- terma-svg-mode-unsaved -->';
        const svgContentBeforeRoundTrip=svgAceEditor?.getValue() ?? svgEditorInput?.value ?? '';
        if (svgAceEditor) svgAceEditor.setValue(svgContentBeforeRoundTrip+'\\n'+svgRoundTripMarker,-1);
        else if (svgEditorInput) {
          svgEditorInput.value=svgContentBeforeRoundTrip+'\\n'+svgRoundTripMarker;
          svgEditorInput.dispatchEvent(new Event('input',{bubbles:true}));
        }
        const svgContentAfterRoundTrip=svgAceEditor?.getValue() ?? svgEditorInput?.value ?? '';
        if (svgEditorMode) svgEditorMode.value='preview';
        svgEditorMode?.dispatchEvent(new Event('change',{bubbles:true}));
        for (let attempt=0; attempt<40 && !document.querySelector('#modal:not([hidden]) #sftpImageViewMode'); attempt+=1) {
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        const roundTripPreviewMode=document.querySelector('#modal:not([hidden]) #sftpImageViewMode');
        imagePreviewUi.svgModeRoundTrip=Boolean(roundTripPreviewMode
          && !document.querySelector('.sftp-editor-floating-window'));
        // The preview modal is inserted before its SVG is parsed and its mode
        // listener is bound. Let that async setup settle before dispatching the
        // edit transition, otherwise the synthetic change can be lost.
        if (roundTripPreviewMode) await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,60))));
        if (roundTripPreviewMode) roundTripPreviewMode.value='edit';
        roundTripPreviewMode?.dispatchEvent(new Event('change',{bubbles:true}));
        for (let attempt=0; attempt<120 && !document.querySelector('.sftp-editor-floating-window #sftpSvgEditorMode'); attempt+=1) {
          await new Promise(resolve=>setTimeout(resolve,50));
        }
        const roundTripEditorWindow=[...document.querySelectorAll('.sftp-editor-floating-window')].at(-1);
        const roundTripEditorHost=roundTripEditorWindow?.querySelector('#sftpTextEditor');
        const roundTripAceEditor=roundTripEditorHost?.__termaAceEditor || (roundTripEditorHost && window.ace ? ace.edit(roundTripEditorHost) : null);
        const roundTripEditorInput=roundTripEditorWindow?.querySelector('textarea.text-editor');
        const roundTripContent=roundTripAceEditor?.getValue() ?? roundTripEditorInput?.value ?? '';
        imagePreviewUi.svgInlineModeKeepsContentWithoutRemoteRead=svgModeTextReadCalls===1;
        roundTripEditorWindow?.querySelector('#sftpTextSave')?.click();
        await new Promise(resolve=>setTimeout(resolve,100));
        imagePreviewUi.svgModePreservesUnsavedDiagnostics={
          marker:roundTripContent.includes(svgRoundTripMarker),
          saveCalls:svgModeSaveCalls,
          editorKind:svgAceEditor?'ace':svgEditorInput?'textarea':'none',
          markerBeforeModeSwitch:svgContentAfterRoundTrip.includes(svgRoundTripMarker),
          beforeLength:svgContentBeforeRoundTrip.length,
          afterLength:svgContentAfterRoundTrip.length,
          editorConnected:Boolean(roundTripEditorWindow?.isConnected),
          editorExists:Boolean(roundTripEditorWindow),
          contentLength:roundTripContent.length,
          modalCount:document.querySelectorAll('.sftp-editor-floating-window').length
        };
        imagePreviewUi.svgModePreservesUnsaved=Boolean(roundTripContent.includes(svgRoundTripMarker)
          && svgModeSaveCalls===1
          && roundTripEditorWindow?.isConnected);
        roundTripEditorWindow?.querySelector('#sftpTextClose')?.click();
        await new Promise(resolve=>setTimeout(resolve,20));
        api=svgModeApi;
        window.termaFileOpen.text=svgModeTextReader;
      }
      document.querySelector('#sftpImageClose')?.click();

      const pngBytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),character=>character.charCodeAt(0));
      window.termaFileOpen.image=async ()=>new Blob([pngBytes],{type:'image/png'});
      await window.termaSftpPreviewRuntime.image(1,'/tmp/fixture.png');
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const rasterZoomBefore=document.querySelector('#sftpImageZoomValue')?.textContent||'';
      document.querySelector('#sftpImageZoomIn')?.click();
      imagePreviewUi.rasterOpened=Boolean(document.querySelector('#sftpImageStage img'));
      imagePreviewUi.rasterZoom=Boolean(rasterZoomBefore && document.querySelector('#sftpImageZoomValue')?.textContent!==rasterZoomBefore);
      document.querySelector('#sftpImageClose')?.click();
    } finally {
      window.termaSftpPreviewRuntime.text=previousImagePreviewText;
      window.termaFileOpen.image=previousImageReader;
      delete window.__unsafeSvg;
    }
    const pagerLayoutFixture = document.createElement('div');
    pagerLayoutFixture.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:360px;display:flex;';
    pagerLayoutFixture.innerHTML = '<div class="sftp-pager-layout-probe" style="container-type:inline-size;container-name:sftp-view;display:flex;flex:1;min-height:0;flex-direction:column;"><div class="sftp-shell" style="height:100%;min-height:0;flex:1 1 auto;"><div class="sftp-top" style="position:static;min-height:48px;margin:0;padding:0;"></div><div class="sftp-list"><div class="sftp-head"></div><div class="sftp-row"></div><div class="sftp-pager-dock"><div class="pager sftp-pager"><button>previous</button><span class="pager-count"><span class="sftp-scroll-cue" title="more below">'+icon('chevron-down')+'</span><span class="sftp-page-summary">page 1/1 · 1-3 / 3 ·</span><select><option>50 items</option></select><label class="sftp-page-jump"><span>Go to</span><input type="number" min="1" max="1" value="1"></label></span><button>next</button></div></div></div></div></div>';
    document.body.appendChild(pagerLayoutFixture);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const pagerProbe = pagerLayoutFixture.querySelector('.sftp-pager');
    const pagerProbeDock = pagerLayoutFixture.querySelector('.sftp-pager-dock');
    const pagerProbeList = pagerLayoutFixture.querySelector('.sftp-list');
    const pagerProbeShell = pagerLayoutFixture.querySelector('.sftp-shell');
    const pagerProbeCount = pagerProbe?.querySelector('.pager-count');
    const pagerProbeButtons = [...(pagerProbe?.querySelectorAll('button') || [])];
    const desktopPagerRects = [pagerProbeButtons[0], pagerProbeCount, pagerProbeButtons[1]].map(node=>node?.getBoundingClientRect());
    const desktopPagerCenters = desktopPagerRects.map(rect=>rect ? rect.top + rect.height / 2 : Number.NaN);
    const desktopPagerSingleRow = desktopPagerCenters.every(Number.isFinite)
      && Math.max(...desktopPagerCenters) - Math.min(...desktopPagerCenters) <= 1;
    const pagerBottomGap = (pagerProbeDock?.getBoundingClientRect().bottom || 0) - (pagerProbe?.getBoundingClientRect().bottom || 0);
    const pagerDockScrollbarGap = (pagerProbeList?.getBoundingClientRect().bottom || 0) - (pagerProbeDock?.getBoundingClientRect().bottom || 0);
    const pagerFloatsAtWorkspaceBottom = Math.abs((pagerProbeList?.getBoundingClientRect().bottom || 0) - (pagerProbeShell?.getBoundingClientRect().bottom || 0)) <= 1
      && pagerDockScrollbarGap >= 0
      && pagerDockScrollbarGap <= 18
      && pagerBottomGap >= 7
      && pagerBottomGap <= 12;
    const pagerStyle = getComputedStyle(pagerProbe);
    const pagerDockStyle = getComputedStyle(pagerProbeDock);
    const pagerOpaqueAndFlat = !['transparent','rgba(0, 0, 0, 0)'].includes(pagerStyle.backgroundColor)
      && pagerStyle.boxShadow === 'none'
      && parseFloat(pagerStyle.borderTopWidth) >= 1
      && parseFloat(pagerStyle.borderRadius) >= 6;
    const pagerDockSealsBottom = !['transparent','rgba(0, 0, 0, 0)'].includes(pagerDockStyle.backgroundColor)
      && pagerDockStyle.boxShadow === 'none'
      && pagerDockScrollbarGap >= 0
      && pagerDockScrollbarGap <= 18;
    for (let index=0; index<16; index+=1) {
      const row = document.createElement('div');
      row.className = 'sftp-row';
      pagerProbeList.insertBefore(row, pagerProbeDock);
    }
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    window.termaSftpColumns.syncSftpListScrollCue(pagerProbeList);
    const pagerScrollCue = pagerProbe?.querySelector('.sftp-scroll-cue');
    const scrollCueVisibleAboveContent = getComputedStyle(pagerScrollCue).display === 'grid';
    const pagerViewportBottom = pagerProbeList.getBoundingClientRect().bottom;
    const pagerBottomBeforeScroll = pagerProbeDock?.getBoundingClientRect().bottom || 0;
    pagerProbeList.scrollTop = 120;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    window.termaSftpColumns.syncSftpListScrollCue(pagerProbeList);
    const pagerBottomAfterScroll = pagerProbeDock?.getBoundingClientRect().bottom || 0;
    const pagerBottomGapBeforeScroll = pagerViewportBottom - pagerBottomBeforeScroll;
    const pagerBottomGapAfterScroll = pagerViewportBottom - pagerBottomAfterScroll;
    const pagerPinnedToViewport = getComputedStyle(pagerProbeDock).position === 'sticky'
      && pagerBottomGapBeforeScroll >= 0
      && pagerBottomGapBeforeScroll <= 18
      && pagerBottomGapAfterScroll >= 0
      && pagerBottomGapAfterScroll <= 18
      && Math.abs(pagerBottomGapBeforeScroll - pagerBottomGapAfterScroll) <= 1;
    pagerProbeList.scrollTop = pagerProbeList.scrollHeight;
    window.termaSftpColumns.syncSftpListScrollCue(pagerProbeList);
    const scrollCueHidesAtEnd = getComputedStyle(pagerScrollCue).display === 'none';
    const pagerProbeContainer = pagerLayoutFixture.querySelector('.sftp-pager-layout-probe');
    pagerProbeContainer.style.width = '440px';
    pagerProbeContainer.style.flex = '0 0 440px';
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const narrowPagerCountRect = pagerProbeCount?.getBoundingClientRect();
    const narrowPagerButtonRects = pagerProbeButtons.map(node=>node?.getBoundingClientRect());
    const narrowPagerWraps = Boolean(narrowPagerCountRect
      && narrowPagerButtonRects.every(Boolean)
      && narrowPagerCountRect.bottom <= narrowPagerButtonRects[0].top + 1
      && Math.abs(narrowPagerButtonRects[0].top - narrowPagerButtonRects[1].top) <= 1);
    pagerLayoutFixture.remove();
    const syncList = view.querySelector('#sftpList');
    const syncIndicator = syncList?.querySelector('.sftp-refresh-indicator');
    if (syncList) {
      syncList.classList.add('is-refreshing');
      syncList.scrollTop = 0;
    }
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const syncTopBefore = syncIndicator?.getBoundingClientRect().top;
    if (syncList) syncList.scrollTop = 120;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const syncTopAfter = syncIndicator?.getBoundingClientRect().top;
    const syncIndicatorFollowsScroll = Boolean(syncIndicator
      && getComputedStyle(syncIndicator).position === 'absolute'
      && getComputedStyle(syncIndicator.parentElement).position === 'sticky'
      && getComputedStyle(syncIndicator).visibility === 'visible'
      && Number.isFinite(syncTopBefore)
      && Math.abs(syncTopAfter - syncTopBefore) <= 1);
    syncList?.classList.remove('is-refreshing');
    const diffRuntimeLoaded = typeof window.Diff?.diffLines === 'function';
    const diffFixture = document.createElement('div');
    diffFixture.className = 'diff-preview';
    diffFixture.innerHTML = sftpDiffViewerHtml('first\\nold value\\nlast\\n', 'first\\nnew value\\nlast\\n', {oldLabel:'远端旧文件',newLabel:'外部新文件'});
    document.body.appendChild(diffFixture);
    const diffSideBySide = diffFixture.querySelectorAll('.sftp-diff-columns strong').length === 2
      && Boolean(diffFixture.querySelector('.sftp-diff-cell.removed'))
      && Boolean(diffFixture.querySelector('.sftp-diff-cell.added'));
    diffFixture.remove();
    const previousEditorLayout = localStorage.getItem(SFTP_EDITOR_LAYOUT_STORAGE_KEY);
    let loadedVersionPath = '';
    document.documentElement.dataset.uiSmokeStage = 'sftp-history-editor';
    const historyEditorPromise = window.termaSftpPreviewRuntime.editor.sftpTextModal('/tmp/history.txt', 'new value\\n', 10, 1024, 'utf8', 'auto', {
      versions:[
        {path:'/tmp/history.txt.bak-2',size:10,changed_at:2000},
        {path:'/tmp/history.txt.bak-1',size:9,changed_at:1000}
      ],
      loadVersion:async version => {
        loadedVersionPath = version.path;
        return {content:'old value\\n'};
      }
    });
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const historyEditorWindow=[...document.querySelectorAll('.sftp-editor-floating-window')].at(-1);
    const historySelect = historyEditorWindow?.querySelector('#sftpDiffHistory');
    const historyOptions = [...(historySelect?.options || [])];
    historyEditorWindow?.querySelector('#sftpTextDiff')?.click();
    await new Promise(resolve=>setTimeout(resolve,40));
    const editorCard = historyEditorWindow?.querySelector('.sftp-editor-modal');
    const editorWorkspace = historyEditorWindow?.querySelector('#sftpEditorWorkspace');
    const editorSplitter = historyEditorWindow?.querySelector('#sftpEditorSplit');
    const editorDiff = historyEditorWindow?.querySelector('#sftpDiffPreview');
    const workspaceRect = editorWorkspace?.getBoundingClientRect();
    if (editorSplitter && workspaceRect) {
      editorSplitter.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:31,clientY:workspaceRect.top+workspaceRect.height*.58}));
      editorSplitter.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,button:0,pointerId:31,clientY:workspaceRect.top+workspaceRect.height*.66}));
      editorSplitter.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,pointerId:31,clientY:workspaceRect.top+workspaceRect.height*.66}));
    }
    await new Promise(resolve=>setTimeout(resolve,20));
    const editorDiffRect = editorDiff?.getBoundingClientRect();
    const diffHeaderRect = editorDiff?.querySelector('.sftp-diff-columns')?.getBoundingClientRect();
    const diffRowRect = editorDiff?.querySelector('.sftp-diff-row')?.getBoundingClientRect();
    const storedEditorLayout = window.termaFileLayouts.createEditor({mobile:isMobileLayout}).readSftpEditorLayout();
    const diffEditorUi = Boolean(editorCard
      && getComputedStyle(editorCard).resize === 'both'
      && historyOptions.length === 2
      && historySelect?.value === '0'
      && !historyOptions.some(option=>option.textContent.includes('本次打开内容'))
      && loadedVersionPath === '/tmp/history.txt.bak-2'
      && editorWorkspace?.classList.contains('showing-diff')
      && editorSplitter && !editorSplitter.hidden
      && editorDiff && !editorDiff.hidden
      && editorDiff.querySelector('.sftp-diff-columns')?.textContent.includes('当前编辑内容')
      && diffHeaderRect && editorDiffRect && diffHeaderRect.top >= editorDiffRect.top - 1
      && diffRowRect && diffRowRect.height <= 34
      && storedEditorLayout.split >= 64 && storedEditorLayout.split <= 68);
    historyEditorWindow?.querySelector('#sftpTextDiff')?.click();
    await new Promise(resolve=>setTimeout(resolve,20));
    const diffClosedUi = Boolean(editorWorkspace && !editorWorkspace.classList.contains('showing-diff')
      && editorSplitter?.hidden
      && editorDiff?.hidden
      && !editorDiff?.querySelector('#sftpDiffClose'));
    historyEditorWindow?.querySelector('#sftpTextClose')?.click();
    await historyEditorPromise;
    const noHistoryEditorPromise = window.termaSftpPreviewRuntime.editor.sftpTextModal('/tmp/no-history.txt', 'same\\n', 5, 1024, 'utf8', 'auto', {versions:[]});
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const noHistoryEditorWindow=[...document.querySelectorAll('.sftp-editor-floating-window')].at(-1);
    const noHistoryUi = Boolean(noHistoryEditorWindow?.querySelector('#sftpTextDiff')?.disabled
      && noHistoryEditorWindow?.querySelector('#sftpDiffHistory')?.disabled
      && noHistoryEditorWindow?.querySelector('#sftpDiffHistory')?.textContent.includes('没有可比较的备份'));
    noHistoryEditorWindow?.querySelector('#sftpTextClose')?.click();
    await noHistoryEditorPromise;
    if (previousEditorLayout === null) localStorage.removeItem(SFTP_EDITOR_LAYOUT_STORAGE_KEY);
    else localStorage.setItem(SFTP_EDITOR_LAYOUT_STORAGE_KEY, previousEditorLayout);
    const comparisonPromise = window.termaSftpComparisonViews.show({status:'conflict',remote_path:'/tmp/example.txt'}, {
      remote_path:'/tmp/example.txt',old_label:'远端当前版本',new_label:'外部编辑内容',old_text:'old\\n',new_text:'new\\n',old_size:4,new_size:4,remote_changed_at:Date.now()-1000,local_changed_at:Date.now()
    });
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const comparisonCard = document.querySelector('.sftp-comparison-modal');
    const comparisonRect = comparisonCard?.getBoundingClientRect();
    const externalComparisonUi = Boolean(comparisonCard
      && comparisonCard.querySelectorAll('.sftp-comparison-meta span').length === 2
      && comparisonCard.querySelectorAll('.sftp-comparison-actions button').length === 3
      && comparisonRect.left >= 0 && comparisonRect.right <= innerWidth + 1
      && comparisonRect.top >= 0 && comparisonRect.bottom <= innerHeight + 1);
    const comparisonCancel = comparisonCard?.querySelector('[data-focus-key="cancel"], [data-sftp-compare-choice="cancel"]');
    if (!comparisonCancel) throw new Error("External comparison cancel button is missing");
    comparisonCancel.click();
    const comparisonChoice = await comparisonPromise;
    const diffComparisonUi = diffRuntimeLoaded && diffSideBySide && diffEditorUi && diffClosedUi && noHistoryUi && externalComparisonUi && comparisonChoice === 'cancel';
    window.termaSftpDialogs.recycle({tr,page:1,load:async()=>({page:1,total:3,total_pages:1,enabled:true,items:[
      {id:'recycle-dir',name:'assets',original_path:'/fixture/assets',type:'dir',storage:'terma'},
      {id:'recycle-image',name:'preview.png',original_path:'/fixture/preview.png',type:'file',storage:'terma'},
      {id:'recycle-archive',name:'backup.tar.gz',original_path:'/fixture/backup.tar.gz',type:'file',storage:'terma'}
    ]}),restore:async()=>{},remove:async()=>{},clear:async()=>{}});
    await new Promise(resolve=>setTimeout(resolve,50));
    const recycleIconFixture = document.querySelector('.sftp-recycle-modal');
    const recycleIcons = [...recycleIconFixture.querySelectorAll('.sftp-recycle-icon')];
    const recycleBadges = recycleIcons.slice(1).map(icon=>({icon,badge:icon.querySelector('small'),svg:icon.querySelector('svg')}));
    const recycleIconUi = {
      directory:Boolean(recycleIcons[0]?.dataset.itemType === 'dir' && recycleIcons[0]?.classList.contains('dir') && recycleIcons[0]?.querySelector('.lucide-folder')),
      image:Boolean(recycleIcons[1]?.dataset.itemType === 'file' && recycleIcons[1]?.classList.contains('image') && recycleIcons[1]?.querySelector('.lucide-image') && recycleIcons[1]?.querySelector('small')?.textContent === 'PNG'),
      archive:Boolean(recycleIcons[2]?.classList.contains('archive') && recycleIcons[2]?.querySelector('.lucide-file-archive') && recycleIcons[2]?.querySelector('small')?.textContent === 'GZ'),
      badgeInside:recycleBadges.every(({icon,badge})=>{const outer=icon?.getBoundingClientRect();const inner=badge?.getBoundingClientRect();return Boolean(outer&&inner&&inner.left>=outer.left-1&&inner.right<=outer.right+1&&inner.top>=outer.top-1&&inner.bottom<=outer.bottom+1);}),
      badgeAtCorner:recycleBadges.every(({icon,badge,svg})=>{const outer=icon?.getBoundingClientRect();const label=badge?.getBoundingClientRect();const glyph=svg?.getBoundingClientRect();return Boolean(outer&&label&&glyph&&label.left>=outer.left+outer.width*.25&&label.top>=outer.top+outer.height*.55&&label.top>=glyph.top+glyph.height*.55);})
    };
    window.termaSftpDialogs.release();
    const result = {
      folderOpened: actions[0]?.kind === 'dir' && actions[0]?.path === '/fixture/folder',
      fileOpened: actions[1]?.kind === 'file' && actions[1]?.path === '/fixture/' + specialName,
      connectionSessionUi,
      nativeDragUi,
      directoryActionsUi,
      globalSettingsUi,
      directoryCacheBehavior,
      searchKeyboardUi,
      syncIndicatorFollowsScroll,
      diffComparisonUi,
      recycleIconUi,
      columnLayoutUi,
      directorySizeUi,
      fileOpenFeedback,
      unknownAction,
      stickyPosition,
      breadcrumbScrollable: Boolean(document.querySelector('#view-sftp .sftp-breadcrumb')),
      breadcrumbText,
      breadcrumbLabels,
      singlePathPresentation: !document.querySelector('#view-sftp #sftpPath'),
      selectionShown,
      selectionActionsShown,
      multiNameAddsSelection,
      multiNameCancelsSelection,
      singleNameReplacesSelection,
      specialSelectionExact,
      selectedRows,
      dragSelectionSynchronized,
      selectionCleared,
      fileHasCompression,
      fileHasPermissions,
      permissionOwnerColumn,
      permissionOwnerTitle,
      symlinkUsesTargetSize,
      symlinkExplainsBothSizes,
      symlinkMarked,
      wideColumnAlignment,
      wideActionsFit,
      compactSizeVisible,
      compactTimeVisible,
      compactAccessVisible,
      compactMediumHidden,
      compactCoreVisible,
      compactNoOverflow,
      compactHorizontalScroll,
      compactScrollMetrics:{clientWidth:sftpList.clientWidth,scrollWidth:sftpList.scrollWidth},
      permissionModeSync,
      recursiveVisible,
      compactRowHeight,
      moreMenuOpened,
      contextMenuOpened,
      directoryDownloadMenu,
      narrowCoreHidden,
      narrowCoreDisplay,
      narrowListWidth,
      narrowLayoutClass,
      narrowMoreVisible,
      narrowMetaVisible,
      narrowMetaDiagnostics:{found:Boolean(narrowMeta),display:narrowMetaDisplay,text:narrowMeta?.textContent||'',listClass:sftpList.className},
      narrowAccessHidden,
      narrowHeaderNameVisible,
      narrowHeaderSummaryVisible,
      narrowCompactActions,
      completedMutationDetected,
      imagePreviewUi,
      textEncodingUi,
      jobUi,
      downloadNoticeUi,
      desktopPagerSingleRow,
      pagerFloatsAtWorkspaceBottom,
      pagerOpaqueAndFlat,
      pagerDockSealsBottom,
      pagerPinnedToViewport,
      pagerLayoutMetrics:{
        position:pagerProbeDock?getComputedStyle(pagerProbeDock).position:'',
        listBottom:pagerProbeList?.getBoundingClientRect().bottom||0,
        shellBottom:pagerProbeShell?.getBoundingClientRect().bottom||0,
        dockBottom:pagerProbeDock?.getBoundingClientRect().bottom||0,
        pagerBottom:pagerProbe?.getBoundingClientRect().bottom||0,
        pagerBottomGap,
        beforeScroll:pagerBottomGapBeforeScroll,
        afterScroll:pagerBottomGapAfterScroll,
        background:pagerDockStyle.backgroundColor,
        shadow:pagerDockStyle.boxShadow
      },
      scrollCueVisibleAboveContent,
      scrollCueHidesAtEnd,
      narrowPagerWraps,
      pageRows:rows.length,
      pagerVisible:Boolean(document.querySelector('#view-sftp .sftp-pager')),
      pagerJumpVisible:Boolean(document.querySelector('#view-sftp .sftp-page-jump input[type="number"][min="1"]')),
      pagerText:document.querySelector('#view-sftp .sftp-pager')?.textContent.replace(/s+/g,' ').trim()||'',
      previousDisabled:Boolean(document.querySelector('#view-sftp .sftp-pager button:first-child')?.disabled),
      nextEnabled:!document.querySelector('#view-sftp .sftp-pager button:last-child')?.disabled
    };
    window.termaSftpDirectoryWorkspace.cache.clearSizes(Number(connection.id));
    view.innerHTML = previousHtml;
    view.hidden = previousHidden;
    window.termaSftpPage.open = previousOpen;
    window.termaSftpView.navigate = previousNavigateSftpPath;
    window.termaSftpDirectoryWorkspace.navigation.navigatePath = previousDirectoryNavigate;
    window.termaSftpPreviewRuntime.text = previousPreview;
    for (const [key,runtime] of sftpTabRuntimes) {
      if (previousSftpRuntimes.some(([previousKey])=>previousKey===key)) continue;
      runtime.requestController?.abort?.();
      clearTimeout(runtime.searchTimer);
      runtime.resizeObserver?.disconnect?.();
      if (runtime.resizeFrame) cancelAnimationFrame(runtime.resizeFrame);
    }
    sftpTabRuntimes.clear();
    previousSftpRuntimes.forEach(([key,runtime])=>{
      if (runtime.root?.isConnected) runtime.root.dataset.sftpTabKey=key;
      sftpTabRuntimes.set(key,runtime);
    });
    sftpDisconnectedTabs.clear();
    previousSftpDisconnectedTabs.forEach(key=>sftpDisconnectedTabs.add(key));







    tabs = previousTabs;
    workspaceLayout = previousWorkspaceLayout;
    focusedPaneId = previousFocusedPaneId;
    activeView = previousActiveView;
    activeTabKey = previousActiveTabKey;
    window.restoringTabs = true;
    renderTabs();
    window.restoringTabs = false;
    syncFocusedWorkspaceClasses();
    hideActionMenu();
    return result;
    } catch (error) {
      return {error:error?.stack || error?.message || String(error), errorLine:typeof error?.lineNumber === 'number' ? error.lineNumber : null};
    }
  })()`).catch(error => ({error:`outer executeJavaScript: ${error?.stack || error?.message || String(error)}`}));
  console.log("[ui-smoke] remote admin authorization");
  const remoteAdminOriginalContentSize = window.getContentSize();
  let remoteAdminUi = {desktop:{error:"not run"},mobile:{error:"not run"}};
  await window.webContents.executeJavaScript(`(() => {
    window.__runRemoteAdminModalSmoke = async mode => {
      const previousApi=api;
      const connection=connections[0];
      const previousHasPassword=connection?.has_password;
      let pending=null;
      const modal=document.getElementById('modal');
      const setInput=(input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
      const open=async scope => {
        const authorization=window.termaRemoteManagement.authorize(connection.id,scope,scope);
        pending=new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('Remote administrator dialog did not settle: '+scope)),5000);
          authorization.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
        });
        await new Promise(resolve=>setTimeout(resolve,0));
        return {
          card:modal.querySelector('.remote-admin-modal'),
          form:modal.querySelector('.remote-admin-modal'),
          promise:pending
        };
      };
      const clearPending=async () => {
        const cancel=modal.querySelector('[data-admin-cancel]');
        if (cancel) cancel.click();
        if (pending) await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve(null),100))]);
        pending=null;
      };
      try {
        if (!connection) return {error:'SSH fixture missing'};
        connection.has_password=true;
        let lastAdminGrantRequest=null;
        api=async (path,options) => {
          if (String(path)==='/api/identity-files') return [{path:'C:/Users/tester/.ssh/id_ui_smoke',label:'UI smoke private key with a deliberately long label',permission_ok:true}];
          if (String(path)==='/api/admin-grants') {
            lastAdminGrantRequest=JSON.parse(String(options?.body || '{}'));
            const reusePolicy=String(lastAdminGrantRequest?.admin_auth?.reuse_policy || 'once');
            return {ok:true,admin_grant:{id:'ui-smoke-grant-'+Date.now(),reuse_policy:reusePolicy,expires_at:reusePolicy==='session'?0:Date.now()+600000}};
          }
          return previousApi(path,options);
        };
        closeModal();
        modal.innerHTML='<div class="modal-card" data-legacy-dialog>Previous SFTP dialog</div>';
        const first=await open(mode==='mobile'?'移动端临时管理员授权布局检查':'桌面端临时管理员授权检查');
        const card=first.card;
        if (!card) return {error:'remote admin modal missing'};
        const cardRect=card.getBoundingClientRect();
        const title=card.querySelector('.modal-title-row');
        const actions=card.querySelector('.actions');
        const grid=card.querySelector('.remote-admin-grid');
        const visibleControls=[...card.querySelectorAll('input,select,button')].filter(control=>!control.closest('[hidden]')&&getComputedStyle(control).display!=='none');
        const controlsFit=visibleControls.every(control=>{
          const rect=control.getBoundingClientRect();
          return rect.left>=cardRect.left-1&&rect.right<=cardRect.right+1&&control.scrollWidth<=control.clientWidth+1;
        });
        const viewportFit=cardRect.left>=-1&&cardRect.right<=innerWidth+1&&cardRect.top>=-1&&cardRect.bottom<=innerHeight+1;
        const noHorizontalOverflow=card.scrollWidth<=card.clientWidth+1;
        if (mode==='mobile') {
          const password=card.querySelector('#remoteAdminPassword');
          setInput(password,'mobile-secret');
          card.scrollTop=card.scrollHeight;
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const scrolledCardRect=card.getBoundingClientRect();
          const titleRect=title.getBoundingClientRect();
          const actionsRect=actions.getBoundingClientRect();
          const buttons=[...actions.querySelectorAll('button')];
          const singleColumn=getComputedStyle(grid).gridTemplateColumns.trim().split(/\\s+/).length===1;
          const stickyRegions=titleRect.top>=scrolledCardRect.top-1&&titleRect.bottom<=scrolledCardRect.bottom+1&&actionsRect.top>=scrolledCardRect.top-1&&actionsRect.bottom<=scrolledCardRect.bottom+1;
          const actionButtonsFit=buttons.length===2&&buttons.every(button=>{
            const rect=button.getBoundingClientRect();
            return rect.left>=actionsRect.left-1&&rect.right<=actionsRect.right+1&&button.scrollWidth<=button.clientWidth+1;
          });
          card.querySelector('[data-admin-cancel]').click();
          const result=await first.promise;
          pending=null;
          return {viewportFit,noHorizontalOverflow,controlsFit,singleColumn,stickyRegions,actionButtonsFit,cancelled:result===null,secretCleared:password.value===''&&!modal.innerHTML&&modal.hidden};
        }

        const method=card.querySelector('#remoteAdminMethod');
        const passwordBox=card.querySelector('#remoteAdminPasswordBox');
        const keyBox=card.querySelector('#remoteAdminKeyBox');
        const sudoMode=card.querySelector('#remoteAdminSudoMode');
        const sudoBox=card.querySelector('#remoteAdminSudoPasswordBox');
        const reusePolicy=card.querySelector('#remoteAdminReusePolicy');
        const reusePolicyOptions=[...reusePolicy.options].map(option=>option.value);
        const sameOption=sudoMode.querySelector('option[value="same"]');
        const passwordInputs=[...card.querySelectorAll('input[data-password-visibility-input]')];
        const passwordToggleCount=passwordInputs.length===3&&passwordInputs.every(input=>input.closest('.password-input-control')?.querySelectorAll('.password-visibility-toggle').length===1);
        const eyeInput=card.querySelector('#remoteAdminPassword');
        const eyeButton=eyeInput?.closest('.password-input-control')?.querySelector('.password-visibility-toggle');
        setInput(eyeInput,'visibility-secret');
        eyeInput.focus();
        eyeInput.setSelectionRange(2,8);
        eyeButton?.click();
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const passwordShown=eyeInput.type==='text'&&eyeInput.value==='visibility-secret'&&eyeButton?.getAttribute('aria-label')==='隐藏密码'&&eyeButton?.getAttribute('aria-pressed')==='true'&&eyeButton?.querySelector('.lucide-eye-off');
        eyeButton?.click();
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const passwordHidden=eyeInput.type==='password'&&eyeInput.value==='visibility-secret'&&eyeButton?.getAttribute('aria-label')==='显示密码'&&eyeButton?.getAttribute('aria-pressed')==='false'&&eyeButton?.querySelector('.lucide-eye');
        const passwordEyeToggle=Boolean(passwordToggleCount&&passwordShown&&passwordHidden);
        const initialPasswordMode=method.value==='password'&&!passwordBox.hidden&&keyBox.hidden&&sudoMode.value==='none'&&sudoBox.hidden&&!sameOption.disabled;
        sudoMode.value='same';
        sudoMode.dispatchEvent(new Event('change',{bubbles:true}));
        const sameSudoMode=sudoMode.value==='same'&&sudoBox.hidden;
        method.value='key';
        method.dispatchEvent(new Event('change',{bubbles:true}));
        const keyMode=passwordBox.hidden&&!keyBox.hidden&&sameOption.disabled&&sudoMode.value==='none'&&sudoBox.hidden;
        sudoMode.value='separate';
        sudoMode.dispatchEvent(new Event('change',{bubbles:true}));
        const passwordSeparateSudo=sudoMode.value==='separate'&&!sudoBox.hidden;
        sudoMode.value='none';
        sudoMode.dispatchEvent(new Event('change',{bubbles:true}));
        const sudoNone=sudoBox.hidden;
        method.value='agent';
        method.dispatchEvent(new Event('change',{bubbles:true}));
        const agentMode=passwordBox.hidden&&keyBox.hidden&&sameOption.disabled&&sudoMode.value==='none'&&sudoBox.hidden;
        method.value='password';
        method.dispatchEvent(new Event('change',{bubbles:true}));
        sudoMode.value='separate';
        sudoMode.dispatchEvent(new Event('change',{bubbles:true}));
        const sshPassword=card.querySelector('#remoteAdminPassword');
        const sudoPassword=card.querySelector('#remoteAdminSudoPassword');
        setInput(sshPassword,'ssh-secret');
        setInput(sudoPassword,'sudo-secret');
        card.requestSubmit();
        const submitted=await first.promise;
        pending=null;
        const separatePayload=Boolean(submitted?.admin_grant_id&&lastAdminGrantRequest?.admin_auth?.auth_method==='password'&&lastAdminGrantRequest?.admin_auth?.ssh_password==='ssh-secret'&&lastAdminGrantRequest?.admin_auth?.sudo_password==='sudo-secret'&&lastAdminGrantRequest?.admin_auth?.reuse_policy==='once');
        const submitClearsSecrets=sshPassword.value===''&&sudoPassword.value===''&&!modal.innerHTML&&modal.hidden;

        const cancelCheck=await open('取消清理检查');
        const cancelPassword=modal.querySelector('#remoteAdminPassword');
        const cancelPassphrase=modal.querySelector('#remoteAdminPassphrase');
        const cancelSudo=modal.querySelector('#remoteAdminSudoPassword');
        setInput(cancelPassword,'cancel-ssh-secret');
        setInput(cancelPassphrase,'cancel-key-secret');
        setInput(cancelSudo,'cancel-sudo-secret');
        modal.querySelector('[data-admin-cancel]').click();
        const cancelled=await cancelCheck.promise;
        pending=null;
        const cancelClearsSecrets=cancelled===null&&[cancelPassword,cancelPassphrase,cancelSudo].every(input=>input.value==='')&&!modal.innerHTML&&modal.hidden;

        const backdropCheck=await open('遮罩关闭清理检查');
        const backdropPassword=modal.querySelector('#remoteAdminPassword');
        const backdropPassphrase=modal.querySelector('#remoteAdminPassphrase');
        const backdropSudo=modal.querySelector('#remoteAdminSudoPassword');
        setInput(backdropPassword,'backdrop-ssh-secret');
        setInput(backdropPassphrase,'backdrop-key-secret');
        setInput(backdropSudo,'backdrop-sudo-secret');
        let backdropSettled=false;
        backdropCheck.promise.then(()=>{backdropSettled=true;});
        modal.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        await new Promise(resolve=>setTimeout(resolve,0));
        const backdropIgnored=!backdropSettled&&!modal.hidden&&Boolean(modal.querySelector('.remote-admin-modal'));
        const backdropPreservesSecrets=[backdropPassword,backdropPassphrase,backdropSudo].every(input=>input.value.startsWith('backdrop-'));
        modal.querySelector('[data-admin-cancel]').click();
        const backdropResult=await backdropCheck.promise;
        pending=null;
        const backdropCancelClearsSecrets=backdropResult===null&&[backdropPassword,backdropPassphrase,backdropSudo].every(input=>input.value==='')&&!modal.innerHTML&&modal.hidden;

        const escapeCheck=await open('键盘关闭清理检查');
        const escapePassword=modal.querySelector('#remoteAdminPassword');
        setInput(escapePassword,'escape-secret');
        escapePassword.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        const escapeResult=await escapeCheck.promise;
        pending=null;
        const escapeClearsSecrets=escapeResult===null&&escapePassword.value===''&&!modal.innerHTML&&modal.hidden;
        return {viewportFit,noHorizontalOverflow,controlsFit,passwordEyeToggle,initialPasswordMode,sameSudoMode,passwordSeparateSudo,keyMode,sudoNone,agentMode,reusePolicyOptions:reusePolicyOptions.join(','),separatePayload,submitClearsSecrets,cancelClearsSecrets,backdropIgnored,backdropPreservesSecrets,backdropCancelClearsSecrets,escapeClearsSecrets};
      } catch (error) {
        return {error:error?.stack||error?.message||String(error)};
      } finally {
        await clearPending();
        api=previousApi;
        if (connection) connection.has_password=previousHasPassword;
      }
    };
  })()`);
  try {
    window.setContentSize(900,640);
    await new Promise(resolve=>setTimeout(resolve,100));
    remoteAdminUi.desktop=await window.webContents.executeJavaScript("window.__runRemoteAdminModalSmoke('desktop')");
    window.setContentSize(390,640);
    await new Promise(resolve=>setTimeout(resolve,100));
    remoteAdminUi.mobile=await window.webContents.executeJavaScript("window.__runRemoteAdminModalSmoke('mobile')");
  } finally {
    window.setContentSize(...remoteAdminOriginalContentSize);
    await new Promise(resolve=>setTimeout(resolve,100));
    await window.webContents.executeJavaScript("delete window.__runRemoteAdminModalSmoke");
  }
  console.log("[ui-smoke] Linux desktop toolbar geometry");
  let linuxDesktopToolbarUi = {desktop:{error:"not run"},narrow:{error:"not run"}};
  await window.webContents.executeJavaScript(`(() => {
    window.__runLinuxDesktopToolbarSmoke = () => {
      const view=document.getElementById('view-linux-desktop');
      const previousState={...window.termaRemoteManagement.desktop.state};
      const previousHidden=Boolean(view?.hidden);
      const fixture=document.createElement('div');
      try {
        if (!view) return {error:'Linux desktop view missing'};
        Object.assign(window.termaRemoteManagement.desktop.state,{connectionId:Number(connections?.[0]?.id||1),diagnostics:null,sshX11:null,error:null,loading:true,taskId:'',task:null,logs:[]});
        window.termaRemoteManagement.paintDesktop();
        const rendered=view.querySelector('.linux-desktop-manager-toolbar');
        if (!rendered) return {error:'Linux desktop toolbar missing'};
        fixture.className='terma-vue-root terma-remote-root';
        fixture.dataset.theme=document.documentElement.dataset.theme;
        fixture.style.cssText='position:fixed;left:16px;top:16px;width:calc(100vw - 32px);visibility:hidden;pointer-events:none;z-index:-1';
        fixture.appendChild(rendered.cloneNode(true));
        document.body.appendChild(fixture);
        const toolbar=fixture.querySelector('.linux-desktop-manager-toolbar');
        const select=toolbar.querySelector('select');
        const button=toolbar.querySelector('button');
        const toolbarRect=toolbar.getBoundingClientRect();
        const selectRect=select.getBoundingClientRect();
        const buttonRect=button.getBoundingClientRect();
        const loadingState=view.querySelector('.remote-probe-loading');
        const columns=getComputedStyle(toolbar).gridTemplateColumns.trim().split(/\\s+/).filter(Boolean);
        const insideToolbar=elementRect => elementRect.left>=toolbarRect.left-1&&elementRect.right<=toolbarRect.right+1;
        return {
          found:Boolean(select&&button),
          viewportWidth:innerWidth,
          columnCount:columns.length,
          sameHeight:Math.abs(selectRect.height-buttonRect.height)<=0.75,
          topAligned:Math.abs(selectRect.top-buttonRect.top)<=0.75,
          bottomAligned:Math.abs(selectRect.bottom-buttonRect.bottom)<=0.75,
          stacked:buttonRect.top>=selectRect.bottom+4,
          fullWidth:Math.abs(selectRect.width-buttonRect.width)<=1,
          loadingVisible:Boolean(loadingState?.textContent.includes(tr('remote:linux_desktop.detecting_host',{host:connections[0].name}))&&loadingState.querySelector('svg')&&select.disabled&&button.disabled&&button.textContent.includes(tr('remote:linux_desktop.detecting'))),
          noOverflow:toolbar.scrollWidth<=toolbar.clientWidth+1&&insideToolbar(selectRect)&&insideToolbar(buttonRect)
        };
      } catch (error) {
        return {error:error?.stack||error?.message||String(error)};
      } finally {
        fixture.remove();
        Object.assign(window.termaRemoteManagement.desktop.state,previousState);
        if (view) {
          window.termaRemoteManagement.paintDesktop();
          view.hidden=previousHidden;
        }
      }
    };
  })()`);
  const linuxDesktopToolbarOriginalSize=window.getSize();
  try {
    window.setSize(900,640);
    let linuxDesktopViewportReady=false;
    for (let attempt=0; attempt<40; attempt+=1) {
      linuxDesktopViewportReady=await window.webContents.executeJavaScript("window.innerWidth > 700 && !isMobileLayout()");
      if (linuxDesktopViewportReady) break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    if (!linuxDesktopViewportReady) throw new Error('Linux desktop toolbar smoke did not reach a desktop viewport');
    linuxDesktopToolbarUi.desktop=await window.webContents.executeJavaScript("window.__runLinuxDesktopToolbarSmoke()");
  } finally {
    window.setSize(...linuxDesktopToolbarOriginalSize);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  await window.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage='clipboard-and-themes'");
  console.log("[ui-smoke] clipboard and themes");
  const previousClipboard = clipboard.readText();
  window.setAlwaysOnTop(true);
  window.show();
  window.focus();
  window.webContents.focus();
  await new Promise(resolve => setTimeout(resolve, 120));
  const clipboardExpected = `Terma clipboard smoke ${Date.now()}`;
  const clipboardFixture = JSON.stringify(clipboardExpected);
  let clipboardUi = {ok:false,error:"clipboard smoke did not run",attempts:0};
  try {
    for (let attempt=1; attempt<=2; attempt+=1) {
      try {
        clipboardUi = await window.webContents.executeJavaScript(`(async()=>{
          return Promise.race([
            (async()=>{
              try {
                const expected = ${clipboardFixture};
                await writeClipboardText(expected);
                const key='ui-smoke-terminal-image';
                const connection={id:987654,name:'Clipboard smoke',x11_mode:'trusted'};
                const previous={api,sendPaste:window.termaTerminalClipboard.send,uploadSftpFilesToDirectory: window.termaSftpTransfers.controller.submit,notify};
                const terminalWrites=[];
                const pathWrites=[];
                const uploads=[];
                let directReady=true;
                window.termaTerminalState.terminalSessions.set(key,{
                  id:connection.id,
                  connected:true,
                  connection,
                  socket:{readyState:WebSocket.OPEN,send:value=>terminalWrites.push(value)},
                  term:{focus(){}},
                  currentDirectoryKnown:true,
                  currentDirectory:'/home/smoke',
                  effectiveX11Mode:'trusted'
                });
                try {
                  api=async(path,options)=>{
                    if (!String(path).includes('/terminal-clipboard/image')) return previous.api(path,options);
                    return directReady ? {ready:true,available:true} : {ready:false,available:false,reason:'xclip'};
                  };
                  window.termaTerminalClipboard.send=async(_key,value)=>{ pathWrites.push(value); return true; };
                  window.termaSftpTransfers.controller.submit=async(files,connectionId,directory,options)=>{ uploads.push({files,connectionId,directory,options}); };
                  notify=()=>{};
                  const image=new File([Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4])],'clipboard.png',{type:'image/png'});
                  const directResult=await window.termaTerminalImagePaste.handleImage(key,connection.id,image);
                  const directCtrlV=terminalWrites.length===1&&terminalWrites[0]==='\\x16';
                  const directSkippedUpload=uploads.length===0&&pathWrites.length===0;
                  directReady=false;
                  const fallbackResult=await window.termaTerminalImagePaste.handleImage(key,connection.id,image);
                  const fallbackPrivate=uploads.length===1&&uploads[0].connectionId===connection.id&&uploads[0].directory==='/tmp'&&uploads[0].options?.private===true;
                  const fallbackPath=pathWrites.length===1&&pathWrites[0].startsWith('/tmp/terma-clipboard-')&&pathWrites[0].endsWith('.png');
                  return {
                    ok:Boolean(directResult&&directCtrlV&&directSkippedUpload&&fallbackResult&&fallbackPrivate&&fallbackPath),
                    clipboardWriteCompleted:true,
                    directResult,directCtrlV,directSkippedUpload,fallbackResult,fallbackPrivate,fallbackPath
                  };
                } finally {
                  api=previous.api;
                  window.termaTerminalClipboard.send=previous.sendPaste;
                  window.termaSftpTransfers.controller.submit=previous.uploadSftpFilesToDirectory;
                  notify=previous.notify;
                  window.termaTerminalState.terminalSessions.delete(key);
                }
              } catch (error) {
                return {ok:false,error:error?.stack||error?.message||String(error)};
              }
            })(),
            new Promise(resolve=>setTimeout(()=>resolve({ok:false,error:'clipboard timeout'}),3000))
          ]);
        })()`);
        clipboardUi.attempts=attempt;
        // Linux/X11 and headless Windows runners can report an empty clipboard
        // immediately after a successful write because ownership is asynchronous
        // or unavailable to the test process. The renderer write itself is the
        // behavior under test; keep the native read as diagnostic telemetry.
        clipboardUi.copied=false;
        for (let readAttempt=0; readAttempt<6; readAttempt+=1) {
          if (clipboard.readText()===clipboardExpected) {
            clipboardUi.copied=true;
            break;
          }
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        clipboardUi.ok=Boolean(clipboardUi.ok&&clipboardUi.clipboardWriteCompleted===true);
        if (clipboardUi.ok) break;
      } catch (error) {
        clipboardUi={ok:false,error:error?.stack||error?.message||String(error),attempts:attempt,executeFailed:true};
      }
      window.focus();
      window.webContents.focus();
      await new Promise(resolve=>setTimeout(resolve,180));
    }
  } finally {
    clipboard.writeText(String(previousClipboard ?? ""));
  }
  if (notificationScreenshotEnabled) {
    window.setContentSize(1180, 760);
    window.show();
    await window.webContents.executeJavaScript(`(() => {
      const connectionId = Number(connections?.[0]?.id || 1);
      window.termaSftpTaskWorkspace.state.paint([{
        id:'notification-screenshot-job',
        status:'running',
        type:'upload',
        phase:'uploading',
        label:'上传 Terma-notification-check.bin',
        connection_id:connectionId,
        connection_name:'SFTP 测试连接',
        size:32 * 1024 * 1024,
        transferred:19 * 1024 * 1024,
        progress:59,
        speed_bps:6.6 * 1024 * 1024
      }]);
      notify('SFTP 提示图标检查\\n成功、提示和错误使用同一套居中布局', 'info');
    })()`);
    await new Promise(resolve => setTimeout(resolve, 160));
    const notificationImage = await window.webContents.capturePage();
    fs.writeFileSync(path.join(diagnosticsDirectory, "ui-smoke-notifications.png"), notificationImage.toPNG());
    await window.webContents.executeJavaScript("dismissToast(); window.termaSftpTaskWorkspace.state.paint([]); window.termaSftpTaskWorkspace.runtime.close()");
  }
  await window.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage='productivity-and-visual-regression'");
  if(sftpUi.error)console.error('[ui-smoke] SFTP fixture failed: '+sftpUi.error);
  console.log('[ui-smoke] productivity fixture connections',await window.webContents.executeJavaScript('connections.map(item=>({id:item.id,name:item.name}))'));
  const productivityUi = await window.webContents.executeJavaScript(`(async () => {
    window.termaEfficiency.palette.ensure();
    const panel=window.termaEfficiency.palette.ensureView();
    panel.hidden=false;
    window.termaEfficiency.palette.refresh('');
    const commandWindowDefaultHasConnections=window.termaEfficiency.palette.state.quickItems.some(item=>['connection','forward','remote-profile'].includes(item.kind));
    const previousSnippets=window.termaSnippets.service.state.items;
    window.termaSnippets.service.replaceItems([{id:-987650,name:'UI smoke snippet',group_name:'Smoke',tags:'smoke',description:'Command window search fixture',command:'echo smoke'}]);
    window.termaEfficiency.palette.refresh('');
    const commandWindowDefaultHasSnippets=window.termaEfficiency.palette.state.quickItems.some(item=>item.kind==='snippet');
    window.termaEfficiency.palette.refresh('smoke');
    const commandWindowSearchFindsSnippet=window.termaEfficiency.palette.state.quickItems.some(item=>item.kind==='snippet'&&item.title==='UI smoke snippet');
    window.termaSnippets.service.replaceItems(previousSnippets);
    window.termaEfficiency.palette.refresh('工作区');
    const quickVisible=!panel.hidden&&Boolean(panel.querySelector('.quick-result'));
    const actionCount=window.termaActionRegistry.list({surface:'quick-panel'}).length;
    window.termaEfficiency.palette.refresh(connections[0]?.name || '');
    const connectionIndex=window.termaEfficiency.palette.state.quickItems.findIndex(item=>item.kind==='connection');
    const connectionRow=panel.querySelector('.quick-result[data-index="'+connectionIndex+'"]');
    const connectionActions=connectionRow?.querySelector('.quick-result-actions');
    const connectionRowBounds=connectionRow?.getBoundingClientRect();
    const connectionActionBounds=connectionActions?.getBoundingClientRect();
    const quickConnectionActionsInline=Boolean(connectionActions&&connectionActions.parentElement===connectionRow&&connectionRow.tagName!=='BUTTON'&&Math.abs((connectionRowBounds.top+connectionRowBounds.bottom)-(connectionActionBounds.top+connectionActionBounds.bottom))<2&&connectionActionBounds.right<=connectionRowBounds.right);
    window.termaEfficiency.palette.refresh('tester@198.51.100.25:2200');
    const quickPanelDirect=window.termaEfficiency.palette.state.quickItems[0]?.kind==='quick-ssh'
      &&window.termaEfficiency.palette.state.quickItems.some(item=>item.kind==='quick-ssh-new')
      &&panel.querySelector('.quick-result')?.textContent.includes('tester@198.51.100.25:2200');
    const previousWorkspaceApi=api;
    const reviewWorkspaces=[...window.termaNamedWorkspacePresets.items(),{id:-987654,name:'test',description:'UI smoke workspace',layout:{tabs:[{kind:'terminal'}]}}];
    api=async (url, options)=>url==='/api/named-workspaces'?reviewWorkspaces:previousWorkspaceApi(url,options);
    try { await window.termaNamedWorkspacePresets.list(); } finally { api=previousWorkspaceApi; }
    window.termaEfficiency.palette.refresh('test');
    const workspaceSearchable=window.termaEfficiency.palette.state.quickItems.some(item=>item.kind==='workspace'&&item.title==='test');
    const workspaceIndex=window.termaEfficiency.palette.state.quickItems.findIndex(item=>item.kind==='workspace'&&item.title==='test');
    window.termaEfficiency.palette.run(workspaceIndex);
    const workspacePreviewOpens=!document.getElementById('modal').hidden&&document.getElementById('modal').textContent.includes('打开 test');
    closeModal();
    await window.termaNamedWorkspacePresets.list();
    const quickButton=document.getElementById('quickPanelButton');
    const quickButtonPlacement=quickButton?.parentElement?.id==='workspaceQuickActions';
    const quickButtonLightning=Boolean(quickButton?.querySelector('.lucide-zap'));
    const commandWindowLabel=quickButton?.title||'';
    await window.termaX11.manager.refreshHeader();
    const xServerQuickButton=document.getElementById('xServerQuickButton');
    const xServerQuickIcon=xServerQuickButton?.querySelector('.xserver-x-icon');
    const xServerQuickButtonRect=xServerQuickButton?.getBoundingClientRect();
    const xServerQuickIconRect=xServerQuickIcon?.getBoundingClientRect();
    const xServerQuickUsesX11=Boolean(
      xServerQuickIcon?.querySelector('ellipse')
      && xServerQuickButton.querySelectorAll('.xserver-x-icon path').length===1
      && !xServerQuickButton.querySelector('.lucide-monitor')
      && !xServerQuickButton.textContent.trim()
      && xServerQuickIconRect?.width>=20
      && xServerQuickIconRect?.width<=22
      && xServerQuickIconRect?.height>=20
      && xServerQuickIconRect?.height<=22
      && xServerQuickIconRect.left>=xServerQuickButtonRect.left-1
      && xServerQuickIconRect.right<=xServerQuickButtonRect.right+1
    );
    const originalProductivityApi=api;
    api=async (path,options={}) => String(path)==='/api/xserver'
      ? {available:true,running:true,authorization_required:true,display:':0.0'}
      : originalProductivityApi(path,options);
    await window.termaX11.manager.refreshHeader();
    const xServerUnauthorizedWarning=xServerQuickButton.classList.contains('warning')
      && !xServerQuickButton.classList.contains('ready')
      && xServerQuickButton.title.includes('当前浏览器未授权')
      && xServerQuickButton.title.includes('点击申请授权');
    api=async (path,options={}) => String(path)==='/api/xserver'
      ? {available:true,running:true,authorization_required:false,authorization_kind:'local-direct',display:':0.0'}
      : originalProductivityApi(path,options);
    await window.termaX11.manager.refreshHeader();
    const xServerLocalDirectReady=xServerQuickButton.classList.contains('ready')
      && !xServerQuickButton.classList.contains('warning')
      && xServerQuickButton.title.includes('本机直连自动授权');
    api=originalProductivityApi;
    await window.termaX11.manager.refreshHeader();
    const previousBroadcastTargets=[...window.termaTerminalBroadcast.state.targets];
    const previousBroadcastPaused=window.termaTerminalBroadcast.state.paused;
    const broadcastKeys=['__smoke-broadcast-a','__smoke-broadcast-b'];
    const broadcastSentA=[];
    const broadcastSentB=[];
    tabs.push(...broadcastKeys.map((key,index)=>({key,kind:'terminal',title:'Broadcast '+index})));
    window.termaTerminalState.terminalSessions.set(broadcastKeys[0],{socket:{readyState:WebSocket.OPEN,send:value=>broadcastSentA.push(value)},sensitiveInput:false});
    window.termaTerminalState.terminalSessions.set(broadcastKeys[1],{socket:{readyState:WebSocket.OPEN,send:value=>broadcastSentB.push(value)},sensitiveInput:false});
    window.termaTerminalBroadcast.setTargets(broadcastKeys);
    const previousBroadcastLayout=workspaceLayout;
    const previousBroadcastFocus=focusedPaneId;
    workspaceLayout={type:'split',id:'broadcast-fixture',direction:'row',ratio:.5,
      first:{type:'pane',id:'broadcast-a',tabs:[broadcastKeys[0]],activeTabKey:broadcastKeys[0]},
      second:{type:'pane',id:'broadcast-b',tabs:[broadcastKeys[1]],activeTabKey:broadcastKeys[1]}};
    focusedPaneId='broadcast-a';
    window.termaTerminalActivity.updateWorkspace(broadcastKeys[1],'visible split output');
    const visibleSplitHasNoActivity=!tabs.find(tab=>tab.key===broadcastKeys[1]).activityState;
    const splitTab=tabs.find(tab=>tab.key===broadcastKeys[0]);
    splitTab.activityState='output';
    const tabPreview=document.createElement('div');
    window.termaWorkspaceViews.tabs(tabPreview,[window.termaWorkspaceDockTabs.workspaceTabViewModel(splitTab,{activeTabKey:broadcastKeys[0]})],window.termaWorkspaceDockLayout.port);
    const visibleSplitClearsPriorActivity=!splitTab.activityState&&!tabPreview.querySelector('.activity-output');
    const hiddenBinaryKey='__smoke-hidden-binary-output';
    tabs.push({key:hiddenBinaryKey,kind:'terminal',title:'Hidden tail output'});
    window.termaTerminalState.terminalSessions.set(hiddenBinaryKey,{});
    workspaceLayout=workspaceLayout.first;
    window.termaTerminalActivity.updateWorkspace(hiddenBinaryKey,new Uint8Array([116,97,105,108,32,111,117,116,112,117,116,10]));
    const hiddenBinarySession=window.termaTerminalState.terminalSessions.get(hiddenBinaryKey);
    const hiddenBinaryOutputMarked=tabs.find(tab=>tab.key===hiddenBinaryKey).activityState==='output'
      && window.termaTerminalActivity.tail(hiddenBinaryKey).includes('tail output');
    workspaceLayout=previousBroadcastLayout;
    focusedPaneId=previousBroadcastFocus;
    const broadcastFromEither=window.termaTerminalBroadcastWorkspace.handle(broadcastKeys[0],'A','A')&&window.termaTerminalBroadcastWorkspace.handle(broadcastKeys[1],'B','B')&&broadcastSentA.join('')==='AB'&&broadcastSentB.join('')==='AB';
    window.termaWorkspaceViews.tabs(tabPreview,[window.termaWorkspaceDockTabs.workspaceTabViewModel(tabs.find(tab=>tab.key===broadcastKeys[0]),{activeTabKey:broadcastKeys[0]})],window.termaWorkspaceDockLayout.port);
    const broadcastTabMarked=Boolean(tabPreview.querySelector('.broadcast-selected'));
    window.termaWorkspaceViews.unmount(tabPreview);
    window.termaTerminalBroadcastWorkspace.paint();
    const broadcastBar=document.getElementById('terminalBroadcastBar');
    const broadcastHeaderGrouped=broadcastBar?.nextElementSibling?.id==='workspaceQuickActions';
    const broadcastExit=broadcastBar?.querySelector('.terminal-broadcast-exit');
    const broadcastExitRect=broadcastExit?.getBoundingClientRect();
    const broadcastExitCompact=Boolean(broadcastExit&&broadcastExit.querySelector('.lucide-x')&&!broadcastExit.textContent.trim()&&broadcastExit.getAttribute('aria-label')==='退出终端同步'&&broadcastExitRect.width<=25&&broadcastExitRect.height<=25);
    broadcastBar?.remove();
    document.body.classList.remove('terminal-broadcast-active');
    tabs.splice(tabs.findIndex(tab=>tab.key===hiddenBinaryKey),1);
    tabs.splice(tabs.findIndex(tab=>tab.key===broadcastKeys[0]),2);
    window.termaTerminalState.terminalSessions.delete(broadcastKeys[0]);
    window.termaTerminalState.terminalSessions.delete(broadcastKeys[1]);
    window.termaTerminalState.terminalSessions.delete(hiddenBinaryKey);
    window.termaTerminalBroadcast.setTargets(previousBroadcastTargets);
    window.termaTerminalBroadcast.setPaused(previousBroadcastPaused);
    window.termaEfficiency.palette.close();
    window.termaSftpWorkflow.sync.showPlan(Number(connections[0].id),{
      id:'visual-sync-plan',local_path:'C:/project',remote_path:'/srv/project',
      totals:{upload:1,download:1,conflict:1},
      actions:[
        {index:0,relative:'src/app.js',action:'upload',reason:'本地文件较新',selected:true,local_size:10,remote_size:8},
        {index:1,relative:'config.yml',action:'download',reason:'远程文件较新',selected:true,local_size:12,remote_size:14},
        {index:2,relative:'.env',action:'conflict',reason:'两端内容不同',selected:false,local_size:4,remote_size:4}
      ]
    },activeTabKey);
    const syncRows=document.querySelectorAll('.sftp-sync-plan-row').length;
    const conflictSafe=Boolean(document.querySelector('.sftp-sync-plan-row.conflict input:disabled')&&!document.querySelector('.sftp-sync-plan-row.conflict input:checked'));
    const presets=window.termaNamedWorkspacePresets;
    const namedWorkspaceTools=['importFile','exportFile','repair'].every(action=>typeof presets?.[action]==='function');
    const terminalTools=typeof window.termaTerminalSurface.openSelectedSftp==='function'
      && !document.querySelector('.tab.activity-complete');
    closeModal();
    return {quickVisible,actionCount,quickConnectionActionsInline,quickPanelDirect,workspaceSearchable,workspacePreviewOpens,quickButtonPlacement,quickButtonLightning,commandWindowDefaultHasConnections,commandWindowDefaultHasSnippets,commandWindowSearchFindsSnippet,commandWindowLabel,xServerQuickUsesX11,xServerUnauthorizedWarning,xServerLocalDirectReady,broadcastFromEither,broadcastTabMarked,broadcastHeaderGrouped,broadcastExitCompact,visibleSplitHasNoActivity,visibleSplitClearsPriorActivity,hiddenBinaryOutputMarked,syncRows,conflictSafe,namedWorkspaceTools,terminalTools};
  })()`);
  window.setSize(1200,800);
  await new Promise(resolve=>setTimeout(resolve,120));
  await window.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage='remote-access'");
  const remoteAccessUi = await window.webContents.executeJavaScript(`(async () => {
    const previousProfiles=remoteProfiles;
    const previousConnections=connections;
    const previousSelected=selectedRemoteProfileId;
    const previousPrimaryView=primaryView;
    const previousRemoteSearch=window.termaRemoteList.getSearch();
    const previousRemoteDesktopQuickOpen=localStorage.getItem('remoteDesktopQuickOpen');
    const previousEditHtml=document.getElementById('view-edit').innerHTML;
    const previousOperationWidth=window.termaWorkspaceChrome.value('operation');
    const previousApi=api;
    try {
      const macSsh={...connections[0],id:900002,name:'macOS SSH fixture',ssh_host:'198.51.100.109',terminal_program_platform:'darwin'};
      connections=[...connections,macSsh];
      const vnc={id:910001,name:'VNC fixture',group_name:'UI Smoke',protocol:'vnc',host:connections[0].ssh_host,port:5900,username:'',tags:'',has_password:false,options:{client_mode:'system',quality:7,shared:true,view_only:false}};
      const xdmcp={id:910002,name:'XDMCP fixture',group_name:'UI Smoke',protocol:'xdmcp',host:connections[0].ssh_host,port:177,username:'',tags:'desktop',has_password:false,options:{mode:'indirect',window_mode:'windowed',width:1600,height:900,local_address:'192.0.2.111',ssh_connection_id:Number(connections[0].id)}};
      const derived={id:910003,name:connections[0].name+' · RDP',group_name:'UI Smoke',protocol:'rdp',host:connections[0].ssh_host,port:3389,username:'',tags:'',has_password:false,options:{source_ssh_connection_id:Number(connections[0].id)}};
      const macVnc={id:910004,name:'macOS VNC fixture',group_name:'UI Smoke',protocol:'vnc',host:macSsh.ssh_host,port:5900,username:'fixture',tags:'macos',has_password:false,options:{client_mode:'system',source_ssh_connection_id:Number(macSsh.id)}};
      const isolatedVnc={id:910005,name:'Isolated VNC fixture',group_name:'UI Smoke',protocol:'vnc',host:'198.51.100.88',port:5900,username:'fixture',tags:'isolated',has_password:false,options:{client_mode:'system'}};
      const standaloneRdp={id:910006,name:'Standalone Windows RDP',group_name:'UI Smoke',protocol:'rdp',host:'198.51.100.89',port:3389,username:'Administrator',tags:'windows',has_password:false,options:{}};
      const standaloneXdmcp={id:910007,name:'Standalone XDMCP',group_name:'UI Smoke',protocol:'xdmcp',host:'198.51.100.90',port:177,username:'',tags:'isolated',has_password:false,options:{mode:'query'}};
      const withRemoteSmokeTimeout=(promise,label,timeoutMs=10000)=>new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Remote UI smoke timed out: '+label)),timeoutMs);
        Promise.resolve(promise).then(
          value=>{clearTimeout(timer);resolve(value);},
          error=>{clearTimeout(timer);reject(error);}
        );
      });
      const openRemoteDesktopForSmoke=(profileId,updateTab,label)=>{
        document.documentElement.dataset.uiSmokeStage='remote-access-'+label;
        return withRemoteSmokeTimeout(window.termaRemoteDesktop.open(profileId,updateTab),'open '+label);
      };
      const renderingCommands=[
        {id:'java2d',label:'Java2D',command:'java -Dsun.java2d.xrender=false -Dsun.java2d.opengl=false -jar app.jar'},
        {id:'java2d-safe',label:'Java2D safe',command:'NO_J2D_MITSHM=true java -Dsun.java2d.xrender=false -Dsun.java2d.opengl=false -Dsun.java2d.pmoffscreen=false -jar app.jar'},
        {id:'javafx',label:'JavaFX',command:'java -Dprism.order=sw -jar app.jar'}
      ];
      const graphicsRendering={
        rdp:{visible:true,state:'software',protocol:'rdp',backend:'xorgxrdp',display:':10',drm_device:'/dev/dri/renderD128',drm_device_available:false,software_rendering:true,java_gui_risk:true,summary:'Java GUI white-screen risk',detail:'XRDP is using software rendering.',compatibility_commands:renderingCommands},
        vnc:{visible:true,state:'software',protocol:'vnc',backend:'x11vnc -> xorgxrdp',source_display:':10.0',drm_device:'/dev/dri/renderD128',drm_device_available:false,software_rendering:true,java_gui_risk:true,summary:'Java GUI white-screen risk',detail:'VNC inherits the source XRDP rendering path.',compatibility_commands:renderingCommands},
        xdmcp:{visible:true,state:'remote-x11',protocol:'xdmcp',backend:'remote X11',display:':20',drm_device:'',drm_device_available:false,software_rendering:true,java_gui_risk:true,summary:'Java GUI white-screen risk',detail:'XDMCP direct GPU rendering is limited.',compatibility_commands:renderingCommands}
      };
      remoteProfiles=[vnc,xdmcp,derived,macVnc,isolatedVnc,standaloneRdp,standaloneXdmcp];
      localStorage.setItem('remoteDesktopQuickOpen','0');
      await window.termaRuntimeReader.load();
      window.termaRemoteList.setSearch('');
      remoteGroupOpen.add('UI Smoke');
      primaryView='remote';
      window.termaConnectionViews.renderExplorerTools();
      window.termaConnectionViews.renderConnections();
      const remoteTree=document.getElementById('connectionGroups');
      remoteTree?.querySelectorAll('.remote-host-head[aria-expanded="false"]').forEach(button=>button.click());
      const remoteOuterHeader=remoteTree?.querySelector('.connection-group-head-row');
      const remoteHostHeader=remoteTree?.querySelector('.remote-host-head-row');
      const remoteOuterStyle=remoteOuterHeader?getComputedStyle(remoteOuterHeader):null;
      const remoteHostStyle=remoteHostHeader?getComputedStyle(remoteHostHeader):null;
      const remoteHostStickyStyle=Boolean(
        remoteOuterStyle?.position==='sticky'
        && parseFloat(remoteOuterStyle.top)===0
        && remoteHostStyle?.position==='sticky'
        && Math.abs(parseFloat(remoteHostStyle.top)-remoteOuterHeader.getBoundingClientRect().height)<=1
        && remoteHostStyle.backgroundColor!=='rgba(0, 0, 0, 0)'
        && remoteHostStyle.boxShadow!=='none'
      );
      const remoteTreeInlineStyle=remoteTree?.getAttribute('style');
      if(remoteTree){
        remoteTree.style.height='112px';
        remoteTree.style.flex='0 0 112px';
        remoteTree.style.overflowY='auto';
        remoteTree.scrollTop=42;
      }
      await new Promise(resolve=>setTimeout(resolve,0));
      const remoteTreeRect=remoteTree?.getBoundingClientRect();
      const remoteOuterRect=remoteOuterHeader?.getBoundingClientRect();
      const remoteHostRect=remoteHostHeader?.getBoundingClientRect();
      const remoteHostStickyFollowsOuter=Boolean(
        remoteTree
        && remoteTree.scrollHeight>remoteTree.clientHeight
        && remoteTree.scrollTop>0
        && remoteTreeRect
        && remoteOuterRect
        && remoteHostRect
        && Math.abs(remoteOuterRect.top-remoteTreeRect.top)<=1
        && Math.abs(remoteHostRect.top-remoteOuterRect.bottom)<=1.5
      );
      if(remoteTree){
        remoteTree.scrollTop=0;
        if(remoteTreeInlineStyle===null) remoteTree.removeAttribute('style');
        else remoteTree.setAttribute('style',remoteTreeInlineStyle);
      }
      const remoteNames=[...document.querySelectorAll('.remote-profile-row .conn-name')].map(node=>node.textContent);
      const remoteActivityChecks={
        vnc:remoteNames.includes('VNC fixture'),
        xdmcp:remoteNames.includes('XDMCP fixture'),
        excludesSsh:document.querySelectorAll('#connectionGroups .conn-row:not(.remote-profile-row)').length===0,
        nav:Boolean(document.getElementById('navRemote'))
      };
      const remoteActivitySeparated=Object.values(remoteActivityChecks).every(Boolean);
      const derivedRow=document.querySelector('[data-remote-profile-id="910003"]');
      const derivedSourcePresentation=Boolean(
        derivedRow?.querySelector('.conn-name')?.textContent===connections[0].name
        && derivedRow?.querySelector('.protocol-badge')?.textContent.includes('RDP')
        && derivedRow?.querySelector('.remote-source-badge')?.title==='来源：'+connections[0].name
      );
      const originalOpenRemoteDesktopForDoubleClick=window.termaRemoteDesktop.open;
      let doubleClickedRemoteId=0;
      window.termaRemoteDesktop.open=id=>{ doubleClickedRemoteId=Number(id); };
      derivedRow?.querySelector('.conn-name')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0}));
      window.termaRemoteDesktop.open=originalOpenRemoteDesktopForDoubleClick;
      const remoteNameDoubleClickOpens=doubleClickedRemoteId===derived.id;
      const remoteDesktopSwitchAvailable=window.termaRemoteDesktop.relations.alternatives(derived).length===2
        && window.termaRemoteDesktop.relations.workspaceActions(derived).actions.some(action=>action.className.includes('remote-desktop-switch-button')&&!action.disabled);
      const remoteDesktopSingleDisabled=window.termaRemoteDesktop.relations.alternatives(isolatedVnc).length===0
        && window.termaRemoteDesktop.relations.workspaceActions(isolatedVnc).actions.some(action=>action.className.includes('remote-desktop-switch-button')&&action.disabled);
      window.termaRemoteDesktop.relations.workspaceActions(derived).actions.at(-1).onClick(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:220,clientY:120}));
      const remoteDesktopSwitchMenu=[...document.querySelectorAll('#actionMenu button span')].filter(node=>!node.classList.contains('composite-icon')).map(node=>node.textContent.trim());
      const remoteDesktopSwitchMenuComplete=remoteDesktopSwitchMenu.length===2
        && remoteDesktopSwitchMenu.some(label=>label.includes('XDMCP fixture'))
        && remoteDesktopSwitchMenu.some(label=>label.includes('VNC fixture'))
        && !remoteDesktopSwitchMenu.some(label=>label.includes('macOS VNC fixture'));
      hideActionMenu();
      primaryView='connections';
      window.termaConnectionViews.renderExplorerTools();
      window.termaConnectionViews.renderConnections();
      const sshActivitySeparated=document.getElementById('connectionGroups')?.textContent.includes(connections[0].name)&&!document.getElementById('connectionGroups')?.textContent.includes('VNC fixture')&&document.querySelector('#explorerTools .explorer-main-action')?.textContent.includes('添加 SSH');
      window.termaRemoteProfiles.editor.render(derived);
      const rdpDisplayForm=Boolean(
        document.getElementById('remote_rdp_display_mode')?.value==='dynamic'
        && document.getElementById('remote_rdp_resolution_preset')?.value==='1440x900'
        && document.getElementById('remote_rdp_resolution_options')?.hidden
        && !document.getElementById('remotePasswordField')?.hidden
        && document.getElementById('remote_password')
        && !document.getElementById('remoteRdpPasswordTransferField')?.hidden
        && !document.getElementById('remote_rdp_password_transfer')?.checked
        && document.getElementById('remoteRdpPasswordTransferField')?.textContent.includes('我了解风险')
        && document.getElementById('remoteDesktopCredentialNote')?.textContent.includes('标准输入')
        && document.getElementById('remoteDesktopCredentialNote')?.textContent.includes('Windows 使用临时凭据')
        && document.getElementById('remoteProtocolOptions')?.textContent.includes('自动跟随窗口')
      );
      window.termaRemoteProfiles.editor.render({...vnc,id:0,name:'',options:{}});
      const vncDefaultsToNoVnc=document.getElementById('remote_vnc_client_mode')?.value==='embedded'
        &&document.getElementById('remoteProfileForm')?.remoteOptions?.('vnc').client_mode==='embedded'
        &&document.getElementById('remoteDesktopCredentialNote')?.textContent.includes('默认使用内置 noVNC')
        &&!document.getElementById('remote_vnc_auto_sync_images')?.disabled;
      window.termaRemoteProfiles.editor.render({...vnc,options:{client_mode:'auto'}});
      const vncExplicitAutoPreserved=document.getElementById('remote_vnc_client_mode')?.value==='auto';
      window.termaRemoteProfiles.editor.render(vnc);
      const vncModePersisted=Boolean(
        document.getElementById('remote_vnc_client_mode')?.value==='system'
        && document.getElementById('remote_vnc_display_mode')?.value==='scale'
        && document.getElementById('remote_quality')?.type==='range'
        && document.getElementById('remote_quality_value')?.textContent==='7'
        && document.getElementById('remote_vnc_auto_sync_images')?.checked===true
      );
      window.termaRemoteProfiles.editor.render({...vnc,options:{...vnc.options,client_mode:'bundled'}});
      const vncBundledMode=Boolean(
        document.getElementById('remote_vnc_client_mode')?.value==='bundled'
        && Array.from(document.getElementById('remote_vnc_client_mode')?.options || []).some(option => option.value==='bundled' && option.textContent.includes('TigerVNC'))
      );
      window.termaRemoteProfiles.editor.render({...vnc,options:{...vnc.options,auto_sync_images:false}});
      const vncImageSyncOptOut=document.getElementById('remote_vnc_auto_sync_images')?.checked===false;
      window.termaRemoteProfiles.editor.render({...vnc,id:0,name:'',has_password:false});
      const vncPasswordForm=Boolean(
        !document.getElementById('remotePasswordField')?.hidden
        && document.getElementById('remote_password')
        && document.querySelector('#remoteProfileForm button[data-clear-after-save="1"]')
        && /可选.*加密保存/.test(document.getElementById('remoteDesktopCredentialNote')?.textContent || '')
      );
      const credentialPromise=window.termaVncRuntime.promptCredentials({...vnc,has_password:true},['password'],{failureReason:'VNC 密码错误',updateByDefault:true});
      const vncRetryPrompt=Boolean(
        document.querySelector('.vnc-credentials-modal .connection-test-status.error')?.textContent.includes('密码错误')
        && document.getElementById('vncCredentialSave')?.checked
        && document.querySelector('.vnc-credentials-modal')?.textContent.includes('更新保存密码')
      );
      document.getElementById('vncCredentialPassword').value='replacement';
      document.getElementById('vncCredentialPassword').dispatchEvent(new Event('input',{bubbles:true}));
      document.querySelector('.vnc-credentials-modal').requestSubmit();
      const credentialResult=await withRemoteSmokeTimeout(credentialPromise,'VNC password confirmation');
      const vncRetryValue=credentialResult?.credentials?.password==='replacement'&&credentialResult?.update_saved_password===true;
      const noPasswordPromise=window.termaVncRuntime.promptCredentials({...vnc,has_password:false},['password'],{allowNoPassword:true,updateByDefault:true,title:'VNC no-password fixture',noPasswordLabel:'清除服务密码，启用无密码模式'});
      const noPasswordInput=document.getElementById('vncCredentialNoPassword');
      const noPasswordPrompt=Boolean(noPasswordInput&&document.getElementById('vncCredentialPassword')?.required===true);
      if(noPasswordInput){
        noPasswordInput.checked=true;
        noPasswordInput.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const noPasswordModeUi=Boolean(
        noPasswordInput?.checked===true
        && document.getElementById('vncCredentialPassword')?.disabled===true
        && document.getElementById('vncCredentialSave')?.disabled===true
        && document.querySelector('.vnc-no-password-warning')?.textContent.includes('可信网络')
        && document.querySelector('.vnc-credentials-modal')?.textContent.includes('清除服务密码')
      );
      document.querySelector('.vnc-credentials-modal')?.requestSubmit();
      const noPasswordResult=await withRemoteSmokeTimeout(noPasswordPromise,'VNC no-password confirmation');
      const vncNoPassword=Boolean(noPasswordPrompt&&noPasswordModeUi&&noPasswordResult?.allow_no_password===true&&noPasswordResult?.credentials?.password===''&&noPasswordResult?.update_saved_password===false);
      const credentialApi=api;
      api=async (path,options)=>String(path)==='/api/identity-files'
        ? [{path:'managed-key',label:'Managed key',permission_ok:true}]
        : credentialApi(path,options);
      const sshCredentialPromise=window.termaSshCredentials.prompt({...connections[0],auth_type:'password'}, {
        context:'UI smoke SSH 认证失败',
        onTemporary:async()=>{}
      });
      const waitForCredentialDialog=async selector=>{
        const deadline=Date.now()+10000;
        while(!document.querySelector(selector)){
          if(Date.now()>=deadline)throw new Error('Missing credential dialog: '+selector);
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        return document.querySelector(selector);
      };
      const sshCredentialDialog=await waitForCredentialDialog('.ssh-credential-repair-modal');
      const sshCredentialRepairUi=Boolean(
        document.querySelector('.ssh-credential-repair-modal')
        && document.getElementById('sshCredentialUser')?.value===connections[0].ssh_user
        && Number(document.getElementById('sshCredentialPort')?.value)===Number(connections[0].ssh_port||22)
        && document.getElementById('sshCredentialPassword')?.type==='password'
        && document.getElementById('sshCredentialKeyUpload')?.type==='file'
        && document.getElementById('sshCredentialSave')?.checked
        && !document.getElementById('sshCredentialSave')?.disabled
      );
      const sshCredentialClose=sshCredentialDialog.querySelector('[data-credential-close]');
      if(!sshCredentialClose||sshCredentialClose.disabled)throw new Error('Missing enabled SSH credential cancel button');
      sshCredentialClose.click();
      await withRemoteSmokeTimeout(sshCredentialPromise,'SSH credential cancellation');
      const quickCredentialPromise=window.termaQuickViews.startQuickSshConnection({user:'root',host:'192.0.2.44',port:22},{repair:true,authType:'password'});
      await waitForCredentialDialog('.quick-ssh-auth-modal');
      const quickTerminalCredentialRepairUi=Boolean(
        document.getElementById('modal')?.dataset.quickSshAuth==='1'
        && document.querySelector('.quick-ssh-auth-modal')?.textContent.includes('修复临时 SSH 凭据')
        && document.querySelector('.quick-ssh-auth-modal')?.textContent.includes('上次认证失败')
      );
      document.querySelector('[data-action="quick-ssh-close"]')?.click();
      await withRemoteSmokeTimeout(quickCredentialPromise,'quick SSH credential cancellation');
      api=credentialApi;
      const originalRequireEncryptionUnlocked=requireConfigEncryptionUnlocked;
      requireConfigEncryptionUnlocked=()=>true;
      const ftpCredentialPromise=window.termaRemoteProfiles.prompt({
        id:910099,
        protocol:'ftp',
        name:'FTP credential fixture',
        host:'192.0.2.99',
        port:2121,
        username:'ftp-user',
        options:{base_path:'/'}
      }, {context:'UI smoke FTP 认证失败'});
      const ftpCredentialRepairUi=Boolean(
        document.getElementById('remoteCredentialUser')?.value==='ftp-user'
        && Number(document.getElementById('remoteCredentialPort')?.value)===2121
        && document.getElementById('remoteCredentialPassword')?.type==='password'
        && document.getElementById('remoteCredentialSave')?.checked
        && document.getElementById('remoteCredentialSave')?.disabled
      );
      const ftpCredentialClose=document.querySelector('[aria-labelledby="remoteCredentialRepairTitle"] button[aria-label]');
      if(!ftpCredentialClose)throw new Error('Missing FTP credential cancel button');
      ftpCredentialClose.click();
      await withRemoteSmokeTimeout(ftpCredentialPromise,'FTP credential cancellation');
      requireConfigEncryptionUnlocked=originalRequireEncryptionUnlocked;
      window.termaRemoteProfiles.editor.render(xdmcp);
      const xdmcpForm=Boolean(
        document.getElementById('remote_protocol')?.value==='xdmcp'
        && document.getElementById('remote_xdmcp_mode')?.value==='indirect'
        && document.getElementById('remote_xdmcp_window_mode')?.value==='fixed'
        && document.getElementById('remote_xdmcp_resolution_preset')?.value==='1600x900'
        && document.getElementById('remote_xdmcp_width')?.value==='1600'
        && document.getElementById('remote_xdmcp_local_address')?.value==='192.0.2.111'
        && document.getElementById('remote_xdmcp_ssh_connection')?.value===String(connections[0].id)
        && document.querySelector('.xdmcp-session-auto')
        && document.getElementById('remoteCredentialFields')?.hidden
        && document.getElementById('remoteProtocolOptions')?.textContent.includes('私钥、SSH Agent 或密码')
      );
      const xdmcpMenuAvailable=window.termaRemoteProfiles.presentation.metadata.xdmcp.port===177;
      vnc.options.source_ssh_connection_id=Number(connections[0].id);
      api=async (path,options) => String(path)==='/api/remote-clients/diagnostics'
        ? {rdp:{available:true,client:'UI smoke RDP client'},xdmcp:{available:true,client:'内置 X Server'},vnc:{available:true,client:'UI smoke VNC client'}}
        : String(path).endsWith('/connectivity')
          ? String(path).includes('910007')||String(path).includes('910002')
            ? {supported:true,method:'xdmcp-query',ok:true,responded:true,response:'willing',error:'',host:'198.51.100.90',port:177}
            : {supported:true,method:'tcp',ok:true,host:'198.51.100.1',port:String(path).includes('910006')?3389:5900}
        : String(path).endsWith('/rdp/server')
          ? {platform_supported:true,os_id:'ubuntu',has_desktop:true,desktops:[{id:'xfce',name:'XFCE'}],xrdp_installed:true,xrdp_active:true,xrdp_listening:true,xrdp_enabled:true,connection:{id:Number(connections[0].id),name:connections[0].name},graphics_rendering:graphicsRendering.rdp}
        : String(path).endsWith('/vnc/server')
          ? String(path).includes('/910004/')
            ? {platform:'macos',diagnostics_available:true,status:'ready',installed:true,listening:true,port:5900,service_unit:'',service_state:'active',ssh_connection:{id:Number(macSsh.id),name:macSsh.name},graphics_rendering:{visible:true,state:'shared',protocol:'vnc',backend:'macOS Screen Sharing'}}
            : {platform:'linux',diagnostics_available:true,status:'ready',installed:true,listening:true,port:5900,service_unit:'',service_state:'active',server_session_configurable:true,server_session_selection:{requested_mode:'shared',mode:'shared',display:':10',source:{kind:'xrdp',display:':10',user:'root',desktop:'XFCE'},source_available:true,requires_selection:false},server_session_selection_matches_running:true,session_sources:[{kind:'physical',display:':0',user:'root',desktop:'XFCE',state:'active'},{kind:'xrdp',display:':10',user:'root',desktop:'XFCE',state:'active'}],xrdp_software_rendering:true,graphics_rendering:graphicsRendering.vnc}
        : String(path).endsWith('/xdmcp/server')
          ? {manager:'lightdm',manager_label:'LightDM',supported:true,replacement_available:false,enabled:true,listening:true,action:'ready',ready_for_login:true,session_needs_repair:false,session_conflict:false,firewall:'none',firewall_managed:false,config_file:'/etc/lightdm/lightdm.conf.d/90-tunneldesk-xdmcp.conf',preferred_session:{id:'plasma',name:'Plasma (X11)'},saved_session:'lightdm-xsession',resolved_saved_session_label:'lightdm-xsession -> Plasma (X11)',sessions:[{id:'lightdm-xsession',name:'Default XSession'},{id:'plasma',name:'Plasma (X11)'}],ssh_connection:{name:connections[0].name},warning:'XDMCP 不加密，只应在可信局域网使用。',graphics_rendering:graphicsRendering.xdmcp}
          : String(path).endsWith('/linux-desktop')
            ? {platform_supported:false,os_id:'macos',has_desktop:false,desktops:[]}
          : String(path).endsWith('/x11-applications')
            ? {discovery:{ok:true,platform:'Linux',xauth_available:true,warnings:[],applications:[{id:'xterm',label:'XTerm',command:'xterm',path:'/usr/bin/xterm',category:'terminal',category_label:'终端',kind:'tool',mode:'untrusted'},{id:'konsole',label:'Konsole',command:'konsole',path:'/usr/bin/konsole',category:'terminal',category_label:'终端',kind:'tool',mode:'untrusted'}]}}
            : previousApi(path,options);
      const renderingUi={};
      const captureRenderingUi=protocol => {
        const panel=document.querySelector('#view-remote-desktop .remote-rendering-state.warning');
        const buttons=[...(panel?.querySelectorAll('.remote-rendering-actions button')||[])];
        const panelRect=panel?.getBoundingClientRect();
        const expectedSummary={rdp:'已回退到软件渲染',vnc:'正在共享受限的 XRDP',xdmcp:'客户端 X Server'}[protocol];
        return {
          warning:Boolean(panel&&panel.textContent.includes(expectedSummary)&&panelRect?.width>0&&panelRect?.height>0),
          copyButtons:buttons.length===3&&buttons.every((button,index)=>button.dataset.managementAction==='rendering-'+index&&button.hasAttribute('data-terma-button')),
          noHorizontalOverflow:Boolean(panel&&panel.scrollWidth<=panel.clientWidth+1&&buttons.every(button=>{
            const rect=button.getBoundingClientRect();
            return rect.left>=panelRect.left-1&&rect.right<=panelRect.right+1;
          })),
          protocol
        };
      };
      document.documentElement.dataset.uiSmokeStage='remote-access-open-profiles';
      await openRemoteDesktopForSmoke(derived.id,false,'derived-rdp');
      renderingUi.rdp=captureRenderingUi('rdp');
      await openRemoteDesktopForSmoke(vnc.id,false,'linked-vnc');
      renderingUi.vnc=captureRenderingUi('vnc');
      const vncSourceSelect=document.querySelector('#vnc_server_session_source_910001');
      const vncSourceSelection=Boolean(vncSourceSelect&&['auto','shared|:0','shared|:10','virtual'].every(value=>[...vncSourceSelect.options].some(option=>option.value===value))&&vncSourceSelect.value==='shared|:10');
      const vncSourceContainer=vncSourceSelect?.closest('#vncServerState');
      const vncSourceApi=api;
      const vncSourceDiagnostics=await api('/api/remote-profiles/'+vnc.id+'/vnc/server');
      let vncSourcePutOptions=null;
      let vncSourceRefreshCount=0;
      try {
        api=async (path,options={}) => {
          if(String(path)==='/api/remote-profiles/'+vnc.id&&options.method==='PUT'){
            vncSourcePutOptions=JSON.parse(options.body||'{}').options||null;
            return {...vnc,options:{...(vnc.options||{}),...(vncSourcePutOptions||{})}};
          }
          if(String(path)==='/api/remote-profiles/'+vnc.id+'/vnc/server'){
            vncSourceRefreshCount+=1;
            return {
              ...vncSourceDiagnostics,
              server_session_selection:{requested_mode:'virtual',mode:'virtual',display:':1',source:null,source_available:true,requires_selection:false},
              server_session_selection_matches_running:false
            };
          }
          return vncSourceApi(path,options);
        };
        if(vncSourceSelect){
          vncSourceSelect.value='virtual';
          await window.termaVncRuntime.management.saveSourceSelection(vnc.id,vncSourceSelect,'remote-desktop-'+vnc.id);
        }
      } finally {
        api=vncSourceApi;
      }
      const refreshedVncSourceSelect=vncSourceContainer?.querySelector('#vnc_server_session_source_'+vnc.id);
      const vncSourceRefreshInPlace=Boolean(
        vncSourceContainer?.isConnected
        && refreshedVncSourceSelect?.value==='virtual'
        && vncSourcePutOptions?.server_session_mode==='virtual'
        && vncSourcePutOptions?.server_display===''
        && vncSourceRefreshCount===1
      );
      await openRemoteDesktopForSmoke(xdmcp.id,false,'linked-xdmcp');
      renderingUi.xdmcp=captureRenderingUi('xdmcp');
      const xdmcpWorkspaceText=document.getElementById('view-remote-desktop')?.textContent||'';
      const xdmcpSessionSemantics=Boolean(
        xdmcpWorkspaceText.includes(tr('remote:actions.new_graphical_login'))
        && xdmcpWorkspaceText.includes(tr('remote:auto.shared_vnc'))
        && xdmcpWorkspaceText.includes(tr('remote:auto.xdmcp_launch_help'))
        && xdmcpWorkspaceText.includes('lightdm-xsession')
        && xdmcpWorkspaceText.includes('Plasma')
        && !xdmcpWorkspaceText.includes(tr('remote:xdmcp_status.repair_default_desktop'))
      );
      const xdmcpAuthorizationHost=document.getElementById('remoteDesktopAuthorization');
      if(xdmcpAuthorizationHost){
        window.termaRemoteViews.updateDesktopLaunch(document.getElementById('view-remote-desktop'),{authorization:{status:{
          desktop_backend_available:true,
          can_request_authorization:true,
          web_session_authenticated:true,
          scopes:[]
        },scopes:['remote-client','xserver'],refreshTarget:'remote-profile',remoteProfileId:xdmcp.id}});
        refreshIcons();
      }
      await new Promise(resolve=>setTimeout(resolve,0));
      const xdmcpAuthorizationPanel=xdmcpAuthorizationHost?.querySelector('.desktop-integration-authorization');
      const xdmcpState=document.getElementById('xdmcpServerState');
      const xdmcpAuthorizationRect=xdmcpAuthorizationPanel?.getBoundingClientRect();
      const xdmcpStateRect=xdmcpState?.getBoundingClientRect();
      const xdmcpDurationSelect=xdmcpAuthorizationPanel?.querySelector('[data-role="desktop-integration-duration"]');
      const xdmcpCustomDuration=xdmcpAuthorizationPanel?.querySelector('.desktop-integration-custom-duration');
      if(xdmcpDurationSelect){
        xdmcpDurationSelect.value='custom';
        xdmcpDurationSelect.dispatchEvent(new Event('change',{bubbles:true}));
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      const customDurationVisible=Boolean(xdmcpCustomDuration&&!xdmcpCustomDuration.hidden&&xdmcpCustomDuration.querySelector('input')?.max==='480');
      if(xdmcpDurationSelect){
        xdmcpDurationSelect.value='browser-session';
        xdmcpDurationSelect.dispatchEvent(new Event('change',{bubbles:true}));
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      const xdmcpAuthorizationLayout=Boolean(
        xdmcpAuthorizationRect&&xdmcpStateRect
        && Math.abs(xdmcpAuthorizationRect.left-xdmcpStateRect.left)<=1
        && Math.abs(xdmcpAuthorizationRect.width-xdmcpStateRect.width)<=1
        && xdmcpAuthorizationPanel.scrollWidth<=xdmcpAuthorizationPanel.clientWidth+1
        && xdmcpDurationSelect?.querySelector('option[value="browser-session"]')?.textContent.includes('最长 12 小时')
        && xdmcpAuthorizationPanel.querySelector('[data-action="desktop-integration-authorize"]')?.textContent.includes('申请授权')
        && customDurationVisible
        && xdmcpCustomDuration.hidden
      );
      const renderingCopyInteraction={success:false,failure:false};
      const renderingCopyButton=document.querySelector('#view-remote-desktop .remote-rendering-actions button');
      const previousWriteClipboardText=window.termaClipboard.write;
      const previousNotify=notify;
      try {
        let clipboardValue='';
        let notices=[];
        window.termaClipboard.write=async value=>{clipboardValue=String(value)};
        notify=(message,type)=>notices.push({message:String(message),type:String(type||'')});
        renderingCopyButton?.click();
        await new Promise(resolve=>setTimeout(resolve,0));
        renderingCopyInteraction.success=clipboardValue===renderingCommands[0].command&&notices.length===1&&notices[0].type==='success'&&notices[0].message.includes('Java2D');
        notices=[];
        window.termaClipboard.write=async ()=>{throw new Error('fixture clipboard failure')};
        renderingCopyButton?.click();
        await new Promise(resolve=>setTimeout(resolve,0));
        renderingCopyInteraction.failure=notices.length===1&&notices[0].type==='error'&&notices[0].message.includes('fixture clipboard failure');
      } finally {
        window.termaClipboard.write=previousWriteClipboardText;
        notify=previousNotify;
      }
      window.__runRemoteRenderingNarrowSmoke=async () => {
        const host=document.createElement('div');
        host.style.cssText='position:fixed;left:8px;top:8px;width:calc(100vw - 16px);opacity:0;pointer-events:none;z-index:99999;display:grid;gap:8px';
        document.body.appendChild(host);
        const views=window.termaRemoteViews,models=window.termaRemoteManagement.models;
        const containers=[];
        const render=model=>{const target=document.createElement('div');host.appendChild(target);containers.push(target);views.renderManagement(target,{model});};
        for(const [protocol, graphics_rendering] of Object.entries(graphicsRendering)) {
          render(()=>({rendering:models.state(protocol,{graphics_rendering}, {...vnc,protocol}, 'rendering-fixture',{connectionHelp:true}).rendering}));
        }
        render(()=>({notices:[models.unavailableNotice(vnc,{code:'SSH_AUTHENTICATION_FAILED',error:'SSH 认证失败，请更新管理凭据后重新探测。'},'vnc')]}));
        refreshIcons();
        await new Promise(resolve=>setTimeout(resolve,0));
        const panels=[...host.querySelectorAll('.remote-rendering-state.warning')];
        const diagnostic=host.querySelector('.remote-diagnostic-status');
        const diagnosticRect=diagnostic?.getBoundingClientRect();
        const diagnosticIconRect=diagnostic?.querySelector('.remote-diagnostic-icon')?.getBoundingClientRect();
        const diagnosticCopyRect=diagnostic?.querySelector('.remote-diagnostic-copy')?.getBoundingClientRect();
        const diagnosticActionsRect=diagnostic?.querySelector('.remote-diagnostic-actions')?.getBoundingClientRect();
        const result={
          panels:panels.length,
          copyButtons:panels.every(panel=>panel.querySelectorAll('.remote-rendering-actions button').length===3),
          noHorizontalOverflow:panels.every(panel=>{
            const panelRect=panel.getBoundingClientRect();
            const buttons=[...panel.querySelectorAll('.remote-rendering-actions button')];
            return panel.scrollWidth<=panel.clientWidth+1&&buttons.every(button=>{
              const rect=button.getBoundingClientRect();
              return rect.left>=panelRect.left-1&&rect.right<=panelRect.right+1;
            });
          }),
          diagnosticAligned:Boolean(diagnosticRect&&diagnosticIconRect&&diagnosticCopyRect&&diagnosticActionsRect
            && diagnosticIconRect.left>=diagnosticRect.left-1
            && diagnosticCopyRect.left>diagnosticIconRect.right
            && diagnosticActionsRect.top>=diagnosticCopyRect.bottom-1
            && diagnosticActionsRect.left>=diagnosticRect.left-1
            && diagnosticActionsRect.right<=diagnosticRect.right+1
            && diagnostic.scrollWidth<=diagnostic.clientWidth+1)
        };
        for(const target of containers) views.release(target);
        host.remove();
        return {...result,ok:result.panels===3&&result.copyButtons&&result.noHorizontalOverflow&&result.diagnosticAligned};
      };
      const remoteLayoutUi={};
      const measureRemoteLayout=async (protocol, profileId, height) => {
        await openRemoteDesktopForSmoke(profileId,false,'layout-'+protocol);
        const view=document.getElementById('view-remote-desktop');
        const launch=view?.querySelector('.remote-desktop-launch');
        if(!view||!launch) return {protocol,height,ok:false,reason:'remote launch view missing'};
        const previousViewStyle=view.getAttribute('style');
        const previousLaunchStyle=launch.getAttribute('style');
        view.style.setProperty('flex','0 0 '+height+'px');
        view.style.setProperty('height',height+'px');
        launch.style.setProperty('flex','1 1 auto');
        launch.style.setProperty('min-height','0');
        await new Promise(resolve=>setTimeout(resolve,0));
        const launchRect=launch.getBoundingClientRect();
        const topNode=launch.querySelector('h2');
        const actionNode=launch.querySelector('.actions');
        launch.scrollTop=0;
        const topRect=topNode?.getBoundingClientRect();
        const topReachable=Boolean(topRect&&topRect.top>=launchRect.top-1&&topRect.bottom<=launchRect.bottom+1);
        const scrollable=launch.scrollHeight>launch.clientHeight&&getComputedStyle(launch).overflowY==='auto';
        launch.scrollTop=launch.scrollHeight;
        await new Promise(resolve=>setTimeout(resolve,0));
        const bottomRect=actionNode?.getBoundingClientRect();
        const bottomReachable=Boolean(bottomRect&&bottomRect.top>=launchRect.top-1&&bottomRect.bottom<=launchRect.bottom+1);
        const noHorizontalOverflow=launch.scrollWidth<=launch.clientWidth+1&&view.scrollWidth<=view.clientWidth+1;
        const result={protocol,height,scrollable,topReachable,bottomReachable,noHorizontalOverflow,scrollTop:launch.scrollTop,scrollHeight:launch.scrollHeight,clientHeight:launch.clientHeight,ok:Boolean(scrollable&&topReachable&&bottomReachable&&noHorizontalOverflow)};
        if(previousViewStyle===null) view.removeAttribute('style'); else view.setAttribute('style',previousViewStyle);
        if(previousLaunchStyle===null) launch.removeAttribute('style'); else launch.setAttribute('style',previousLaunchStyle);
        return result;
      };
      remoteLayoutUi.rdp=await measureRemoteLayout('rdp',derived.id,320);
      remoteLayoutUi.vnc=await measureRemoteLayout('vnc',vnc.id,320);
      remoteLayoutUi.xdmcp=await measureRemoteLayout('xdmcp',xdmcp.id,320);
      const failureHost=document.createElement('div');
      failureHost.id='vncFailureFixture';
      document.body.appendChild(failureHost);
      const readyFixture={platform:'linux',diagnostics_available:true,status:'ready',installed:true,listening:true,port:5900,service_unit:'tunneldesk-x11vnc.service',service_state:'active',server_mode:'shared-x11',source_display:':10',vnc_process:'123 x11vnc -display :10',server_session_configurable:true,server_session_selection:{requested_mode:'shared',mode:'shared',display:':10',source:{kind:'xrdp',display:':10',user:'root',desktop:'XFCE'},source_available:true,requires_selection:false,component:'x11vnc',install_required:false,component_state:{key:'x11vnc',component:'x11vnc',label:'x11vnc 共享桌面',installed:true,install_required:false,automatic_manageable:true,listening:true,running:true,status:'ready'}},selected_component:{key:'x11vnc',component:'x11vnc',label:'x11vnc 共享桌面',installed:true,install_required:false,automatic_manageable:true,listening:true,running:true,status:'ready'},server_session_selection_matches_running:true,session_sources:[{kind:'xrdp',display:':10',user:'root',desktop:'XFCE',state:'active'}],commands:['x11vnc','vncpasswd'],start_plan:{kind:'x11vnc-session',supports_no_password:true},install_plan:{online:{available:true,command:'apt-get install x11vnc'},offline:{available:true,command:'apt-get --no-download install x11vnc'},local_offline:{available:true,package_names:['x11vnc']}},ssh_connection:{id:Number(connections[0].id),name:connections[0].name}};
      window.termaRemoteManagement.diagnostics.render(failureHost,'vnc',readyFixture,vnc.id,'remote-desktop-'+vnc.id);
      window.termaRemoteManagement.diagnostics.render(failureHost,'vnc',{error:'fixture operation failed'},vnc.id,'remote-desktop-'+vnc.id);
      const failureText=failureHost.textContent||'';
      const failureSelector=failureHost.querySelector('#vnc_server_session_source_910001');
      const failureActions=[...failureHost.querySelectorAll('.remote-service-actions button')];
      const vncFailureRecovery=Boolean(failureText.includes('fixture operation failed')&&failureSelector&&failureActions.some(button=>button.textContent.includes('卸载服务'))&&failureHost.querySelector('.vnc-server-source'));
      failureHost.remove();
      const componentHost=document.createElement('div');
      componentHost.id='vncComponentFixture';
      document.body.appendChild(componentHost);
      const missingTigerComponent={key:'tigervnc',component:'tigervnc',label:'TigerVNC 独立虚拟桌面',installed:false,wrapper_available:false,raw_server_available:false,install_required:true,automatic_manageable:false,manual_only:false,listening:false,running:false,status:'not-installed',reason:'未检测到 vncserver/tigervncserver 包装器，需要先安装 TigerVNC。'};
      const missingTigerFixture={...readyFixture,server_session_selection:{requested_mode:'virtual',mode:'virtual',display:':1',source:null,source_available:true,requires_selection:false,component:'tigervnc',install_required:true,automatic_manageable:false,manual_only:false,reason:missingTigerComponent.reason,component_state:missingTigerComponent},selected_component:missingTigerComponent,running_component:readyFixture.selected_component,server_session_selection_matches_running:false,source_xrdp:true,start_plan:null,start_plan_reason:missingTigerComponent.reason,install_plan:{package_name:'tigervnc',online:{available:true,command:'apt-get install tigervnc-standalone-server'},offline:{available:true,command:'apt-get --no-download install tigervnc-standalone-server'},local_offline:{available:true,package_names:['tigervnc-standalone-server','tigervnc-common']}}};
      window.termaRemoteManagement.diagnostics.render(componentHost,'vnc',missingTigerFixture,vnc.id,'remote-desktop-'+vnc.id);
      const missingTigerText=componentHost.textContent||'';
      const missingTigerSource=componentHost.querySelector('.vnc-server-source');
      const missingTigerSelect=componentHost.querySelector('#vnc_server_session_source_910001');
      const missingTigerButtons=[...componentHost.querySelectorAll('.remote-service-actions button')].map(button=>button.textContent.trim());
      const tigerComponentLabel=tr('remote:vnc_status.component_tigervnc');
      const missingTigerUi=Boolean(
        missingTigerText.includes(tr('remote:vnc_status.component_not_installed',{component:tigerComponentLabel}))
        && [tr('remote:install.online'),tr('remote:install.local_offline'),tr('remote:install.remote_cache'),tr('remote:install.manual')].every(label=>missingTigerText.includes(label))
        && missingTigerSource?.textContent.includes(tr('remote:vnc_status.current_running_source'))
        && missingTigerSource?.querySelector('strong')?.textContent.includes('共享 :10')
        && missingTigerSource?.textContent.includes(tr('remote:vnc_status.target_desktop_source'))
        && missingTigerSelect?.value==='virtual'
        && !missingTigerButtons.some(label=>label.includes(tr('remote:vnc_status.start_service'))||label.includes(tr('remote:vnc_status.configure_tigervnc'))||label.includes(tr('remote:vnc_status.apply_source_restart')))
      );
      const rawTigerComponent={...missingTigerComponent,installed:true,raw_server_available:true,manual_only:true,running:true,status:'manual-only',reason:'仅检测到 Xtigervnc/Xvnc 原始 X 服务器，缺少 vncserver/tigervncserver 包装器，Terma 不能自动管理。'};
      const rawTigerFixture={...missingTigerFixture,status:'not-listening',listening:false,service_unit:'',service_state:'manual',server_mode:'virtual',source_display:':1',vnc_process:'654 operator Xtigervnc :1 -rfbport 5900',server_session_selection:{...missingTigerFixture.server_session_selection,install_required:true,manual_only:true,reason:rawTigerComponent.reason,component_state:rawTigerComponent},selected_component:rawTigerComponent,running_component:rawTigerComponent,server_session_selection_matches_running:true,commands:['Xtigervnc','vncpasswd'],start_plan:null,start_plan_reason:rawTigerComponent.reason};
      window.termaRemoteManagement.diagnostics.render(componentHost,'vnc',rawTigerFixture,vnc.id,'remote-desktop-'+vnc.id);
      const rawTigerText=componentHost.textContent||'';
      const rawTigerSelect=componentHost.querySelector('#vnc_server_session_source_910001');
      const rawTigerButtons=[...componentHost.querySelectorAll('.remote-service-actions button')].map(button=>button.textContent.trim());
      const rawTigerUi=Boolean(
        rawTigerText.includes(tr('remote:vnc_status.component_manual_only',{component:tigerComponentLabel}))
        && rawTigerText.includes(tr('remote:auto.manual_install'))
        && rawTigerText.includes(tr('remote:vnc_status.uninstall_service'))
        && rawTigerSelect?.value==='virtual'
        && !rawTigerButtons.some(label=>label.includes(tr('remote:vnc_status.start_service'))||label.includes(tr('remote:vnc_status.configure_tigervnc')))
      );
      const vncComponentManagementUi=missingTigerUi&&rawTigerUi;
      componentHost.remove();
      document.documentElement.dataset.uiSmokeStage='remote-access-standalone-profiles';
      const vncActionButton=document.createElement('button');
      vncActionButton.innerHTML='<span>停止服务</span>';
      document.body.appendChild(vncActionButton);
      const beforeVncActionApi=api;
      let vncActionCalls=0;
      let releaseVncAction;
      try {
        api=async(path,options)=>{
          if(String(path)==='/api/remote-profiles/'+vnc.id+'/vnc/server'&&!options?.method){
            vncActionCalls+=1;
            return new Promise(resolve=>{releaseVncAction=()=>resolve({error:'fixture diagnostics blocked'});});
          }
          return beforeVncActionApi(path,options);
        };
        const manager=window.termaVncRuntime.management;
        const firstVncAction=manager.operate(vnc.id,'remote-desktop-'+vnc.id,'stop',vncActionButton);
        const secondVncAction=manager.operate(vnc.id,'other-workspace-'+vnc.id,'uninstall');
        await new Promise(resolve=>setTimeout(resolve,0));
        const duplicateBlocked=await secondVncAction===null&&vncActionCalls===1&&vncActionButton.disabled&&vncActionButton.getAttribute('aria-busy')==='true';
        releaseVncAction?.();
        await withRemoteSmokeTimeout(Promise.all([firstVncAction,secondVncAction]),'VNC duplicate action');
        var vncServiceActionDebounced=Boolean(duplicateBlocked&&!vncActionButton.disabled&&!vncActionButton.hasAttribute('aria-busy'));
      } finally {
        api=beforeVncActionApi;
        vncActionButton.remove();
      }
      await openRemoteDesktopForSmoke(macVnc.id,false,'mac-vnc');
      const macVncWorkspace=document.getElementById('view-remote-desktop');
      const macVncWorkspaceText=macVncWorkspace?.textContent||'';
      const macVncBypassesLinuxDesktop=Boolean(
        ['macOS','VNC','fixture'].every(token=>macVncWorkspaceText.includes(token))
        && !macVncWorkspace?.querySelector('.linux-desktop-missing-notice')
        && !macVncWorkspaceText.includes(tr('remote:diagnostics.open_linux_desktop_manager'))
      );
      await openRemoteDesktopForSmoke(standaloneRdp.id,true,'standalone-rdp');
      const standaloneRdpWorkspace=document.getElementById('view-remote-desktop');
      const standaloneRdpKey='remote-desktop-'+standaloneRdp.id;
      const standaloneRdpTab=tabs.find(tab=>tab.key===standaloneRdpKey);
      const standaloneRdpTabNode=document.querySelector('.tab[data-tab-key="'+standaloneRdpKey+'"]');
      const standaloneRdpStatusHidden=Boolean(
        standaloneRdpTab?.protocol==='rdp'
        && standaloneRdpTab.connectionStatus===undefined
        && standaloneRdpTabNode
        && !standaloneRdpTabNode.querySelector('.tab-connection-dot')
      );
      const standaloneRdpLaunch=standaloneRdpWorkspace?.querySelector('#remoteDesktopLaunchButton');
      const standaloneRdpText=standaloneRdpWorkspace?.textContent||'';
      const standaloneRdpDisabled=Boolean(standaloneRdpLaunch?.disabled);
      const standaloneRdpFallback=Boolean(
        standaloneRdpText.includes('RDP 端口可达')
        && standaloneRdpText.includes('未关联 SSH 管理连接')
        && standaloneRdpText.includes('新建 SSH 管理连接')
        && standaloneRdpText.includes('Windows')
        && !standaloneRdpText.includes('XDMCP 设置')
        && !standaloneRdpWorkspace.querySelector('.linux-desktop-missing-notice')
        && standaloneRdpLaunch&&!standaloneRdpDisabled
      );
      const diagnosticPanel=[...standaloneRdpWorkspace.querySelectorAll('.remote-diagnostic-status')].find(panel=>panel.querySelector('.remote-diagnostic-actions'));
      const diagnosticRect=diagnosticPanel?.getBoundingClientRect();
      const diagnosticIconRect=diagnosticPanel?.querySelector('.remote-diagnostic-icon')?.getBoundingClientRect();
      const diagnosticCopyRect=diagnosticPanel?.querySelector('.remote-diagnostic-copy')?.getBoundingClientRect();
      const diagnosticActionsRect=diagnosticPanel?.querySelector('.remote-diagnostic-actions')?.getBoundingClientRect();
      const remoteDiagnosticAlignment=Boolean(diagnosticRect&&diagnosticIconRect&&diagnosticCopyRect&&diagnosticActionsRect
        && Math.abs((diagnosticIconRect.top+diagnosticIconRect.height/2)-(diagnosticCopyRect.top+diagnosticCopyRect.height/2))<=2
        && diagnosticCopyRect.left>=diagnosticIconRect.right
        && diagnosticActionsRect.top>=diagnosticCopyRect.bottom-1
        && Math.abs(diagnosticActionsRect.left-diagnosticCopyRect.left)<=1
        && diagnosticActionsRect.right<=diagnosticRect.right+1
        && diagnosticPanel.scrollWidth<=diagnosticPanel.clientWidth+1);
      await openRemoteDesktopForSmoke(isolatedVnc.id,true,'standalone-vnc');
      const standaloneVncWorkspace=document.getElementById('view-remote-desktop');
      const standaloneVncText=standaloneVncWorkspace?.textContent||'';
      const standaloneVncDisabled=Boolean(standaloneVncWorkspace?.querySelector('#remoteDesktopLaunchButton')?.disabled);
      const standaloneVncFallback=Boolean(
        (
          standaloneVncText.includes('VNC 端口可达')
          && standaloneVncText.includes('未关联 SSH 管理连接')
          && standaloneVncText.includes('新建 SSH 管理连接')
          && !standaloneVncDisabled
        )
        || (
          standaloneVncDisabled
          && standaloneVncText.includes('系统 VNC 客户端只能由获得临时授权的本机浏览器或 Terma 桌面端调用')
        )
      );
      await openRemoteDesktopForSmoke(standaloneXdmcp.id,true,'standalone-xdmcp');
      const standaloneXdmcpWorkspace=document.getElementById('view-remote-desktop');
      const standaloneXdmcpKey='remote-desktop-'+standaloneXdmcp.id;
      const standaloneXdmcpTab=tabs.find(tab=>tab.key===standaloneXdmcpKey);
      const standaloneXdmcpTabNode=document.querySelector('.tab[data-tab-key="'+standaloneXdmcpKey+'"]');
      const standaloneXdmcpStatusHidden=Boolean(
        standaloneXdmcpTab?.protocol==='xdmcp'
        && standaloneXdmcpTab.connectionStatus===undefined
        && standaloneXdmcpTabNode
        && !standaloneXdmcpTabNode.querySelector('.tab-connection-dot')
      );
      const standaloneXdmcpText=standaloneXdmcpWorkspace?.textContent||'';
      const standaloneXdmcpDisabled=Boolean(standaloneXdmcpWorkspace?.querySelector('#remoteDesktopLaunchButton')?.disabled);
      const standaloneXdmcpFallback=Boolean(
        standaloneXdmcpText.includes('XDMCP 服务已响应')
        && standaloneXdmcpText.includes('WILLING')
        && standaloneXdmcpText.includes('未关联 SSH 管理连接')
        && standaloneXdmcpText.includes('新建 SSH 管理连接')
        && standaloneXdmcpText.includes('直接尝试')
        && !standaloneXdmcpDisabled
      );
      const standaloneFallbackDetails={
        rdp:{text:standaloneRdpText,disabled:standaloneRdpDisabled},
        vnc:{text:standaloneVncText,disabled:standaloneVncDisabled},
        xdmcp:{text:standaloneXdmcpText,disabled:standaloneXdmcpDisabled}
      };
      const macVncHelpHost=document.createElement('div');
      const helpOptions={connectionHelp:true,serviceAvailable:false,detail:'connect ECONNREFUSED'};
      const mountHelp=(host,profile,diagnostics,key)=>window.termaRemoteViews.renderManagement(host,{model:()=>window.termaRemoteManagement.models.state('vnc',diagnostics,profile,key,helpOptions)});
      mountHelp(macVncHelpHost,macVnc,{platform:'macos'},'remote-desktop-910004');
      const macVncSetupGuidance=Boolean(
        macVncHelpHost.textContent.includes('未检测到可用的 VNC 服务')
        && macVncHelpHost.textContent.includes('系统设置 > 通用 > 共享 > 屏幕共享')
        && macVncHelpHost.textContent.includes('远程管理')
        && macVncHelpHost.textContent.includes('允许访问')
        && macVncHelpHost.textContent.includes('VNC 观看者')
        && macVncHelpHost.querySelector('button.primary')?.textContent.includes('重新连接')
        && !macVncHelpHost.textContent.includes('Linux 桌面管理')
      );
      const linuxVncMissingHost=document.createElement('div');
      mountHelp(linuxVncMissingHost,vnc,{platform:'linux',status:'not-installed',can_install:true,port:5900,privileged:false,ssh_connection:{id:connections[0].id,name:connections[0].name},install_plan:{online:{available:true,command:'apt-get install x11vnc'},offline:{available:true,command:'apt-get --no-download install x11vnc'},local_offline:{available:true,package_names:['x11vnc','xclip']}}},'remote-desktop-910001');
      const linuxVncStoppedHost=document.createElement('div');
      mountHelp(linuxVncStoppedHost,vnc,{platform:'linux',status:'stopped',installed:true,port:5900,service_unit:'x11vnc.service',service_state:'inactive',start_plan:{kind:'service',command:'systemctl start x11vnc.service'}},'remote-desktop-910001');
      const vncServiceDiagnosisUi=Boolean(
        linuxVncMissingHost.textContent.includes('未安装 VNC 服务')
        && linuxVncMissingHost.textContent.includes('在线安装')
        && linuxVncMissingHost.textContent.includes('本机下载后离线安装')
        && linuxVncMissingHost.textContent.includes('使用远端缓存')
        && linuxVncMissingHost.textContent.includes('手动安装/配置说明')
        && linuxVncMissingHost.textContent.includes('TCP 5900')
        && linuxVncStoppedHost.textContent.includes('已安装，但尚未启动')
        && linuxVncStoppedHost.textContent.includes('启动 VNC 服务')
        && linuxVncStoppedHost.textContent.includes('x11vnc.service')
      );
      for(const target of [macVncHelpHost,linuxVncMissingHost,linuxVncStoppedHost]) window.termaRemoteViews.release(target);
      document.documentElement.dataset.uiSmokeStage='remote-access-x11-and-xserver';
      window.termaX11.openLauncher(Number(connections[0].id));
      await new Promise(resolve=>setTimeout(resolve,0));
      const x11PresetValues=[...document.querySelectorAll('#x11AppPreset option')].map(option=>option.value);
      const x11AppLauncher=Boolean(!document.getElementById('modal').hidden&&['xterm','konsole','custom'].every(value=>x11PresetValues.includes(value))&&document.getElementById('x11AppPreset')?.value==='xterm'&&document.getElementById('x11AppCommand')?.value==='/usr/bin/xterm'&&document.getElementById('x11AppDetection')?.classList.contains('success')&&document.getElementById('x11AppMode')?.value==='untrusted');
      window.termaX11.closeLauncher();
      const x11InstalledApi=api;
      let x11InstalledDialog=false;
      let xServerRemoteUninstall=false;
      let xServerClipboardLayout=false;
      try {
        api=async (path,options) => String(path).endsWith('/x11-applications/install-plan')
          ? {discovery:{platform:'linux',xauth_available:true,applications:[{id:'xterm',label:'XTerm'}]},install_plan:{supported:true,package_manager:'apt',uninstall:{available:true,command:'apt-get purge -y xauth x11-apps xterm'},online:{available:true,command:'apt-get install -y xauth x11-apps xterm'},instructions:[]}}
          : String(path)==='/api/xserver'
            ? {integration_available:true,desktop:true,desktop_backend_available:true,authorization_required:false,platform:'win32',available:true,running:true,managed:true,mode:'bundled',server:'VcXsrv',display:':0.0',can_start:false,can_stop:true,can_install:false}
            : String(path).endsWith('/x11-forwarding')
              ? {platform:'linux',ready:true,x11_forwarding:'yes',sshd_present:true,config_file:'/etc/ssh/sshd_config',xauth_path:'/usr/bin/xauth',xauth_location:'/usr/bin/xauth',x11_display_offset:'10',can_manage:true,can_terminal_manage:true}
              : String(path).endsWith('/x11-clipboard/helper')
                ? {platform:'linux',installed:false,package_manager:'apt',install_plan:{online:{available:true,description:'使用远端 apt 安装 xclip'},offline:{available:true,description:'仅使用远端软件包缓存'},local_offline:{available:true,description:'本机下载 xclip 及依赖，通过 SFTP 上传到远端后安装',package_names:['xclip']},manual:{available:true,description:'查看 X11 转发、DISPLAY、xclip 和权限检查步骤'}},guide:{steps:[],commands:[]},reason:'远端尚未安装 xclip'}
                : x11InstalledApi(path,options);
        await withRemoteSmokeTimeout(window.termaX11.openGuide(Number(connections[0].id)), 'X11 installed component guide');
        const installedGuide=document.querySelector('.x11-install-guide');
        x11InstalledDialog=Boolean(
          installedGuide?.textContent.includes('组件安装完成')
          && installedGuide?.textContent.includes('卸载 X11 组件')
          && !installedGuide?.textContent.includes('远端没有完整识别到 xauth')
        );
        window.termaX11.closeGuide();
        await withRemoteSmokeTimeout(window.termaX11.openManager(Number(connections[0].id)), 'X Server installed component manager');
        const xServerInstalledManager=document.querySelector('.xserver-manager');
        const clipboardPanel=xServerInstalledManager?.querySelector('.xserver-clipboard-panel');
        const clipboardModes=clipboardPanel?.querySelector('.remote-install-modes');
        const clipboardModeButtons=[...clipboardModes?.querySelectorAll('.remote-install-mode')||[]];
        const firstClipboardModeRect=clipboardModeButtons[0]?.getBoundingClientRect();
        const secondClipboardModeRect=clipboardModeButtons[1]?.getBoundingClientRect();
        const thirdClipboardModeRect=clipboardModeButtons[2]?.getBoundingClientRect();
        const clipboardStatus=clipboardPanel?.querySelector(':scope > .connection-test-status');
        const clipboardStatusIconRect=clipboardStatus?.querySelector('svg')?.getBoundingClientRect();
        const clipboardStatusCopyRect=clipboardStatus?.querySelector('span')?.getBoundingClientRect();
        const clipboardStatusCenterDelta=clipboardStatusIconRect&&clipboardStatusCopyRect
          ? Math.abs((clipboardStatusIconRect.top+clipboardStatusIconRect.height/2)-(clipboardStatusCopyRect.top+clipboardStatusCopyRect.height/2))
          : Number.POSITIVE_INFINITY;
        const missingXclipMentions=(clipboardPanel?.textContent.match(/远端尚未安装 xclip/g)||[]).length;
        xServerRemoteUninstall=Boolean(xServerInstalledManager?.textContent.includes('卸载 X11 组件'));
        xServerClipboardLayout=Boolean(
          clipboardPanel
          && clipboardPanel.querySelector('.xserver-clipboard-head > button[aria-label]')?.title===tr('common:x11.clipboard_retry',{defaultValue:'重新检测'})
          && clipboardModeButtons.length===4
          && firstClipboardModeRect
          && secondClipboardModeRect
          && thirdClipboardModeRect
          && Math.abs(firstClipboardModeRect.top-secondClipboardModeRect.top)<=1
          && thirdClipboardModeRect.top>firstClipboardModeRect.top+1
          && clipboardPanel.scrollWidth<=clipboardPanel.clientWidth+1
          && clipboardStatusCenterDelta<=1
          && missingXclipMentions===1
        );
        window.termaX11.closeManager();
      } finally {
        api=x11InstalledApi;
        window.termaX11.closeGuide();
        window.termaX11.closeManager();
      }
      api=previousApi;
      const xServerImmediateApi=api;
      let releaseXServerImmediate=null;
      let xServerImmediateCalls=0;
      try {
        api=async (path,options) => {
          if(String(path)==='/api/xserver'){
            xServerImmediateCalls+=1;
            return new Promise(resolve=>{
              releaseXServerImmediate=()=>resolve({integration_available:true,desktop:true,desktop_backend_available:true,authorization_required:false,platform:'win32',available:true,running:true,managed:true,mode:'bundled',server:'VcXsrv',display:':0.0',can_start:false,can_stop:true,can_install:false});
            });
          }
          return xServerImmediateApi(path,options);
        };
        const openingXServer=window.termaX11.openManager();
        await new Promise(resolve=>setTimeout(resolve,0));
        const immediateModal=document.querySelector('.xserver-manager');
        const duplicateXServerResult=await withRemoteSmokeTimeout(window.termaX11.openManager(), 'duplicate X Server manager');
        var xServerImmediateLoading=Boolean(
          !document.getElementById('modal').hidden
          && immediateModal?.textContent.includes('正在打开 X Server 管理')
          && immediateModal.querySelector('.xserver-state.loading svg')
          && window.termaX11.manager.state.opening
          && duplicateXServerResult===false
          && xServerImmediateCalls===1
        );
        releaseXServerImmediate?.();
        await withRemoteSmokeTimeout(openingXServer, 'X Server loading completion');
        window.termaX11.closeManager();
      } finally {
        releaseXServerImmediate?.();
        api=xServerImmediateApi;
        window.termaX11.closeManager();
      }
      await withRemoteSmokeTimeout(window.termaX11.openManager(), 'X Server default context');
      const themeProbe=document.createElement('div');
      themeProbe.style.background='var(--panel)';
      document.querySelector('.xserver-manager').appendChild(themeProbe);
      const xServerManager=Boolean(!document.getElementById('modal').hidden&&document.querySelector('.xserver-manager')&&getComputedStyle(document.querySelector('.xserver-manager')).backgroundColor===getComputedStyle(themeProbe).backgroundColor);
      themeProbe.remove();
      window.termaX11.closeManager();
      const quickX11Connection={id:-910011,name:'smoke@192.0.2.11',ssh_host:'192.0.2.11',ssh_port:22,ssh_user:'smoke',auth_type:'password',x11_mode:'off',quick_connection:true,quick_token:'ui-smoke-token'};
      window.termaTerminalQuickRegistry.quickConnectionsById.set(quickX11Connection.id,quickX11Connection);
      const quickXServerApi=api;
      const quickXServerPreviousActiveTabKey=activeTabKey;
      window.termaTerminalState.terminalSessions.set('quick-terminal-ui-smoke',{connection:quickX11Connection});
      activeTabKey='quick-terminal-ui-smoke';
      try {
        api=async path => String(path)==='/api/xserver'
          ? {integration_available:true,desktop:true,desktop_backend_available:true,authorization_required:false,platform:'linux',available:true,running:true,managed:true,mode:'native',server:'X11',display:':0.0',can_start:false,can_stop:false,can_install:false}
          : String(path)==='/api/connections/'+quickX11Connection.id+'/x11-forwarding'
            ? {platform:'linux',ready:true,enabled:true,x11_forwarding:'yes',sshd_present:true,config_present:true,config_file:'/etc/ssh/sshd_config',xauth_path:'/usr/bin/xauth',xauth_location:'/usr/bin/xauth',x11_display_offset:'10',can_manage:false,can_terminal_manage:true,terminal_commands:{disable:'sudo test-only-disable'}}
            : quickXServerApi(path);
        await withRemoteSmokeTimeout(window.termaX11.openManager(), 'X Server temporary SSH context');
        const quickManager=document.querySelector('.xserver-manager');
        const quickManagerText=quickManager?.textContent||'';
        var quickXServerManager=Boolean(
          quickManagerText.includes('远端 SSH X11 组件与转发 · smoke@192.0.2.11（临时）')
          && quickManagerText.includes('重新检测')
          && quickManagerText.includes('临时授权后关闭')
          && quickManagerText.includes('在终端手动关闭')
          && quickManagerText.includes('临时打开 X11 终端')
          && quickManagerText.includes('卸载 X11 组件')
          && [...quickManager?.querySelectorAll('button[data-ui-action-key]')||[]].some(button=>button.dataset.uiActionKey==='x11-components:'+quickX11Connection.id&&button.textContent.includes('卸载 X11 组件'))
          && quickManagerText.includes('不会保存默认 X11 配置')
          && !quickManagerText.includes('普通终端默认启用')
          && window.termaX11.manager.state.connectionId===quickX11Connection.id
          && window.termaX11.manager.state.terminalKey==='quick-terminal-ui-smoke'
        );
        window.termaX11.closeManager();
      } finally {
        api=quickXServerApi;
        activeTabKey=quickXServerPreviousActiveTabKey;
        window.termaTerminalState.terminalSessions.delete('quick-terminal-ui-smoke');
        window.termaTerminalQuickRegistry.quickConnectionsById.delete(quickX11Connection.id);
      }
      const xServerApi=api;
      try {
        api=async (path,options) => String(path)==='/api/xserver'
          ? {integration_available:false,desktop:false,desktop_backend_available:false,authorization_required:false,reason:'当前连接的是独立 Web/测试后端，无法读取运行 Terma 桌面设备上的 X Server',server_side:{platform:'win32',available:false,running:false,display:''},can_start:false,can_stop:false,can_install:false}
          : xServerApi(path,options);
        await withRemoteSmokeTimeout(window.termaX11.openManager(), 'X Server standalone backend');
        const unavailableManager=document.querySelector('.xserver-manager');
        const unavailableText=unavailableManager?.textContent||'';
        const unavailableActions=[...unavailableManager?.querySelectorAll('.actions button')||[]].map(button=>button.textContent.trim());
        var xServerDesktopIntegrationUnavailable=Boolean(
          unavailableText.includes('当前连接的是独立 Web/测试后端，无法读取运行 Terma 桌面设备上的 X Server')
          && unavailableText.includes('桌面集成不可用')
          && !unavailableText.includes('X Server 未启动')
          && !unavailableActions.some(label=>['启动','停止','安装 Linux 图形组件','安装 XQuartz'].includes(label))
        );
        window.termaX11.closeManager();
        api=async (path,options) => String(path)==='/api/xserver'
          ? {
              integration_available:false,
              desktop:false,
              desktop_backend_available:true,
              authorization_required:true,
              can_request_authorization:true,
              reason:'当前浏览器会话没有桌面集成权限。X Server 正在运行，但启动、停止和本机程序调用只能在 Terma 桌面端执行。',
              server_side:{platform:'win32',available:true,running:true,display:':0.0'},
              available:true,
              running:true
            }
          : xServerApi(path,options);
        await withRemoteSmokeTimeout(window.termaX11.openManager(), 'X Server browser authorization');
        const browserAuthorizationManager=document.querySelector('.xserver-manager');
        const browserAuthorizationText=browserAuthorizationManager?.textContent||'';
        var xServerBrowserAuthorization=Boolean(
          browserAuthorizationText.includes('等待桌面授权')
          && browserAuthorizationText.includes('当前浏览器会话没有桌面集成权限。X Server 正在运行，但启动、停止和本机程序调用只能在 Terma 桌面端执行。')
          && browserAuthorizationText.includes('申请授权')
          && browserAuthorizationManager?.querySelector('[data-role="desktop-integration-duration"] option[value="browser-session"]')?.textContent.includes('最长 12 小时')
          && browserAuthorizationManager?.querySelector('[data-role="desktop-integration-custom-minutes"][max="480"]')
          && browserAuthorizationManager?.querySelector('[data-action="desktop-integration-authorize"][data-scopes="xserver"]')
          && !browserAuthorizationText.includes('独立 Web/测试后端')
        );
        window.termaX11.closeManager();
        api=async (path,options) => String(path)==='/api/xserver'
          ? {
              integration_available:true,
              desktop:true,
              desktop_backend_available:true,
              authorization_required:false,
              authorization_kind:'local-direct',
              platform:'win32',
              available:true,
              running:true,
              managed:true,
              mode:'bundled',
              server:'VcXsrv',
              display:':0.0',
              can_start:false,
              can_stop:true,
              can_install:false
            }
          : xServerApi(path,options);
        await withRemoteSmokeTimeout(window.termaX11.openManager(), 'X Server local authorization');
        const localDirectManager=document.querySelector('.xserver-manager');
        const localDirectManagerText=localDirectManager?.textContent||'';
        var xServerLocalDirectAuthorization=Boolean(
          localDirectManagerText.includes('本机直连自动授权')
          && localDirectManagerText.includes('浏览器权限')
          && !localDirectManagerText.includes('申请授权')
        );
        window.termaX11.closeManager();
      } finally {
        api=xServerApi;
      }
      const modal=document.getElementById('modal');
      modal.hidden=false;
      modal.innerHTML='<div class="modal-card xserver-manager"><div class="modal-title-row"><div><h2>Adaptive modal</h2><span>long diagnostics</span></div><button class="icon-button" type="button">'+icon('x')+'</button></div><div style="height:1200px">long body</div><div class="actions"><button>cancel</button><button>confirm</button></div></div>';
      const adaptiveCard=modal.querySelector('.modal-card');
      const adaptiveTitle=adaptiveCard.querySelector('.modal-title-row');
      const adaptiveActions=adaptiveCard.querySelector('.actions');
      const adaptiveBody=adaptiveActions.previousElementSibling;
      const initialActions=adaptiveActions.getBoundingClientRect();
      const initialBody=adaptiveBody.getBoundingClientRect();
      adaptiveCard.scrollTop=adaptiveCard.scrollHeight;
      await new Promise(resolve=>setTimeout(resolve,0));
      const adaptiveRect=adaptiveCard.getBoundingClientRect();
      const adaptiveTitleRect=adaptiveTitle.getBoundingClientRect();
      const adaptiveActionsRect=adaptiveActions.getBoundingClientRect();
      const adaptiveCloseRect=adaptiveTitle.querySelector('.icon-button').getBoundingClientRect();
      const adaptiveStyle=getComputedStyle(adaptiveCard);
      const adaptiveModal=Boolean(
        adaptiveCard.scrollHeight>adaptiveCard.clientHeight
        && adaptiveStyle.overflowY==='auto'
        && adaptiveRect.top>=-1
        && adaptiveRect.bottom<=innerHeight+1
        && Math.abs(adaptiveTitleRect.top-adaptiveRect.top)<=2
        && adaptiveTitleRect.bottom<=adaptiveRect.bottom+1
        && getComputedStyle(adaptiveActions).position==='static'
        && initialActions.top>=initialBody.bottom
        && initialActions.top>adaptiveRect.bottom
        && adaptiveActionsRect.top>=adaptiveRect.top-1
        && adaptiveActionsRect.bottom<=adaptiveRect.bottom
      );
      const adaptiveModalMetrics={
        scrollHeight:adaptiveCard.scrollHeight,
        clientHeight:adaptiveCard.clientHeight,
        overflowY:adaptiveStyle.overflowY,
        viewportHeight:innerHeight,
        card:{top:adaptiveRect.top,bottom:adaptiveRect.bottom},
        title:{top:adaptiveTitleRect.top,bottom:adaptiveTitleRect.bottom},
        actions:{top:adaptiveActionsRect.top,bottom:adaptiveActionsRect.bottom}
      };
      const modalHeaderControlsAligned=Boolean(
        adaptiveCloseRect.top>=adaptiveTitleRect.top
        && adaptiveCloseRect.bottom<=adaptiveTitleRect.bottom
        && adaptiveCloseRect.left>adaptiveTitleRect.left+adaptiveTitleRect.width/2
      );
      let backdropDismissed=false;
      modal.onclick=()=>{backdropDismissed=true;modal.hidden=true;};
      modal.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
      const modalBackdropLocked=!backdropDismissed&&!modal.hidden;
      modal.onclick=null;
      modal.hidden=true;
      modal.innerHTML='';
      healthResults.delete(Number(connections[0].id));
      window.termaConnectionViews.renderConnections();
      const uncheckedHealthRow=[...document.querySelectorAll('.conn-row')].find(row=>row.querySelector('.conn-name')?.textContent===connections[0].name);
      const uncheckedHealthHidden=Boolean(uncheckedHealthRow
        &&!uncheckedHealthRow.querySelector('.health-badge')
        &&!uncheckedHealthRow.querySelector('.status-dot')
        &&!uncheckedHealthRow.querySelector('.conn-state'));
      healthResults.set(Number(connections[0].id),{ok:true,status:'正常'});
      window.termaConnectionViews.renderConnections();
      const healthRow=[...document.querySelectorAll('.conn-row')].find(row=>row.querySelector('.conn-name')?.textContent===connections[0].name);
      const healthBadge=healthRow?.querySelector('.health-badge');
      const healthIconOnly=Boolean(healthBadge&&!healthBadge.textContent.trim()&&healthBadge.getAttribute('aria-label')?.includes('正常'));
      primaryView='connections';
      window.termaConnectionViews.renderExplorerTools();
      window.termaWorkspaceChrome.apply('operation', 292,{fit:false});
      await new Promise(resolve=>setTimeout(resolve,0));
      const defaultAddSshButton=document.querySelector('#explorerTools .explorer-main-action');
      const defaultAddSshLabel=defaultAddSshButton?.querySelector('span');
      const defaultAddSshRect=defaultAddSshButton?.getBoundingClientRect();
      const defaultAddSshLabelRect=defaultAddSshLabel?.getBoundingClientRect();
      const defaultAddSshTextFits=Boolean(defaultAddSshButton?.textContent.includes('添加 SSH')
        && defaultAddSshRect&&defaultAddSshLabelRect
        && defaultAddSshLabelRect.right<=defaultAddSshRect.right-4
        && defaultAddSshButton.scrollWidth<=defaultAddSshButton.clientWidth+1);
      window.termaWorkspaceChrome.apply('operation', 260,{fit:false});
      await new Promise(resolve=>setTimeout(resolve,0));
      const brand=document.querySelector('.brand');
      const brandRect=brand?.getBoundingClientRect();
      const brandButtons=[...document.querySelectorAll('.brand .side-actions button')].map(button=>button.getBoundingClientRect());
      const narrowBrandActionsFit=Boolean(brandRect&&brandButtons.length&&brandButtons.every(rect=>rect.left>=brandRect.left-.5&&rect.right<=brandRect.right+.5&&rect.top>=brandRect.top-.5&&rect.bottom<=brandRect.bottom+.5));
      const brandName=document.querySelector('.brand-name-full');
      const brandNameRect=brandName?.getBoundingClientRect();
      const expandedBrandNameVisible=Boolean(brandName?.textContent.trim()==='Terma'
        && getComputedStyle(brandName).display!=='none'
        && brandNameRect?.width>0
        && brandNameRect.right<=brandRect.right+1);
      const narrowAddSshButton=document.querySelector('#explorerTools .explorer-main-action');
      const narrowAddSshTextFits=Boolean(narrowAddSshButton?.textContent.includes('添加 SSH')
        && narrowAddSshButton.scrollWidth<=narrowAddSshButton.clientWidth+1);
      return {rdpDisplayForm,vncDefaultsToNoVnc,vncExplicitAutoPreserved,vncModePersisted,vncBundledMode,vncImageSyncOptOut,vncPasswordForm,vncRetryPrompt,vncRetryValue,vncNoPassword,sshCredentialRepairUi,quickTerminalCredentialRepairUi,ftpCredentialRepairUi,vncServiceDiagnosisUi,vncServiceActionDebounced,xdmcpForm,xdmcpMenuAvailable,xdmcpSessionSemantics,xdmcpAuthorizationLayout,standaloneRdpFallback,standaloneRdpStatusHidden,standaloneVncFallback,standaloneXdmcpFallback,standaloneXdmcpStatusHidden,standaloneFallbackDetails,remoteDiagnosticAlignment,graphicsRendering:renderingUi,renderingCopyInteraction,vncSourceSelection,vncSourceRefreshInPlace,remoteLayoutUi,vncFailureRecovery,vncComponentManagementUi,vncComponentDiagnostics:{missingTigerUi,rawTigerUi,missingTigerText,rawTigerText,missingTigerButtons,rawTigerButtons},xdmcpWorkspaceText,macVncBypassesLinuxDesktop,macVncWorkspaceText,macVncSetupGuidance,remoteActivitySeparated,remoteActivityChecks,remoteHostStickyStyle,remoteHostStickyFollowsOuter,derivedSourcePresentation,remoteNameDoubleClickOpens,remoteDesktopSwitchAvailable,remoteDesktopSwitchProfiles:window.termaRemoteDesktop.relations.alternatives(derived).map(profile=>profile.name),remoteDesktopSingleDisabled,remoteDesktopSwitchMenuComplete,remoteDesktopSwitchMenu,sshActivitySeparated,x11AppLauncher,x11InstalledDialog,xServerRemoteUninstall,xServerClipboardLayout,xServerImmediateLoading,xServerManager,quickXServerManager,xServerDesktopIntegrationUnavailable,xServerBrowserAuthorization,xServerLocalDirectAuthorization,adaptiveModal,adaptiveModalMetrics,modalHeaderControlsAligned,modalBackdropLocked,uncheckedHealthHidden,healthIconOnly,narrowBrandActionsFit,expandedBrandNameVisible,defaultAddSshTextFits,narrowAddSshTextFits};
    } finally {
      window.termaWorkspaceChrome.apply('operation', previousOperationWidth,{fit:false});
      api=previousApi;
      connections=previousConnections;
      remoteProfiles=previousProfiles;
      window.termaRemoteList.setSearch(previousRemoteSearch);
      if(previousRemoteDesktopQuickOpen===null) localStorage.removeItem('remoteDesktopQuickOpen');
      else localStorage.setItem('remoteDesktopQuickOpen',previousRemoteDesktopQuickOpen);
      await window.termaRuntimeReader.load();
      selectedRemoteProfileId=previousSelected;
      primaryView=previousPrimaryView;
      window.termaConnectionViews?.release(document.getElementById('view-edit'));
      document.getElementById('view-edit').innerHTML=previousEditHtml;
      window.termaX11.closeLauncher();
      window.termaX11.closeManager();
      window.termaConnectionViews.renderConnections();
    }
  })()`);
  window.setAlwaysOnTop(false);
  const dark = await window.webContents.executeJavaScript(`(async () => {
    const testStyle = document.createElement('style');
    testStyle.textContent = '*{transition:none!important}';
    document.head.appendChild(testStyle);
    applyTheme('dark');
    await new Promise(resolve => setTimeout(resolve, 50));
    const button = document.querySelector('button');
    const style = getComputedStyle(button);
    const root = getComputedStyle(document.documentElement);
    const glassFixture=document.createElement('div');
    glassFixture.innerHTML='<div class="toast"></div><div class="sftp-task-center-drawer"></div>';
    glassFixture.style.cssText='position:absolute;visibility:hidden;inset:0;pointer-events:none';
    document.body.appendChild(glassFixture);
    const toastStyle=getComputedStyle(glassFixture.firstElementChild);
    const drawerStyle=getComputedStyle(glassFixture.lastElementChild,'::after');
    const result = {theme:document.documentElement.dataset.theme,panel:root.getPropertyValue('--panel').trim(),buttonPanel:style.getPropertyValue('--panel').trim(),buttonBackground:style.backgroundColor,buttonColor:style.color,glass:Boolean(toastStyle.backgroundColor!=='rgba(0, 0, 0, 0)'&&drawerStyle.backgroundColor!=='rgba(0, 0, 0, 0)'&&toastStyle.color!=='rgba(0, 0, 0, 0)')};
    glassFixture.remove();
    applyTheme('light');
    testStyle.remove();
    return result;
  })()`);
  await runManagedKeysUiScenario(window);
  await runWebFilesUiScenario(window);
  await runSftpRenameUiScenario(window);
  await runIssueUiScenario(window);
  const visual = await runVisualRegression(window);
  if (screenshotEnabled) {
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(diagnosticsDirectory, "ui-smoke-desktop.png"), image.toPNG());
  }
  await window.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage='mobile-layout'");
  console.log("[ui-smoke] mobile layout");
  window.setContentSize(390, 844);
  let mobileViewportReady = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    mobileViewportReady = await window.webContents.executeJavaScript("window.innerWidth <= 760 && isMobileLayout()");
    if (mobileViewportReady) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!mobileViewportReady) {
    const viewport = await window.webContents.executeJavaScript("({width:window.innerWidth,mobile:isMobileLayout()})");
    throw new Error(`Mobile viewport did not become ready: ${JSON.stringify(viewport)}`);
  }
  await window.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage='mobile-linux-desktop-toolbar'");
  linuxDesktopToolbarUi.narrow=await window.webContents.executeJavaScript("window.__runLinuxDesktopToolbarSmoke()");
  await window.webContents.executeJavaScript("delete window.__runLinuxDesktopToolbarSmoke");
  await window.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage='mobile-remote-rendering'");
  remoteAccessUi.narrowRendering=await window.webContents.executeJavaScript("window.__runRemoteRenderingNarrowSmoke()");
  await window.webContents.executeJavaScript("delete window.__runRemoteRenderingNarrowSmoke");
  await window.webContents.executeJavaScript("document.documentElement.dataset.uiSmokeStage='mobile-scenario'");
  const mobile = await runMobileScenario(window);
  if (!screenshotEnabled) window.hide();
  if (screenshotEnabled) {
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(diagnosticsDirectory, "ui-smoke-mobile.png"), image.toPNG());
  }
  if (process.env.TERMA_UI_SMOKE_VERBOSE === "1") {
    console.log(JSON.stringify({ ...result, noVncModuleUi, languageOnboardingUi, forwardTemplateLayoutUi, cspViolations, refreshStateUi, workspaceTabDragUi, workspaceDockingUi, workspaceTabVisibilityUi, workspaceHeaderResizeUi, pages, navigationUi, aboutUi, desktopMenu, runningActions, authUi, connectionStartupUi, saveAndClearUi, notificationUi, restoreKeyUi, restoreCredentialUi, terminalUi, terminalStartupUi, logSettingsUi, sftpUi, productivityUi, remoteAdminUi, linuxDesktopToolbarUi, remoteAccessUi, clipboardUi, dark, visual, mobile, errors }, null, 2));
  }
  const operationPagesFailed = pages.some(page => page.scrollWidth > page.width || !page.toolFits || !page.layoutMode || !page.compactHeight);
  const failedOperationPages = pages.filter(page => page.scrollWidth > page.width || !page.toolFits || !page.layoutMode || !page.compactHeight);
  const overflow = pages.some(page => page.scrollWidth > page.width) || mobile.scrollWidth > mobile.width || mobile.bodyWidth > mobile.width;
  const darkFailed = dark.theme !== "dark" || dark.buttonBackground === "rgb(255, 255, 255)" || !dark.glass;
  const menuFailed = !desktopMenu.opened || !desktopMenu.duplicateConnection || !desktopMenu.simplifiedMenu || !desktopMenu.leftAligned || !desktopMenu.submenuLeftAligned || !desktopMenu.parentStaysOpen || !desktopMenu.submenu || !desktopMenu.generateAll || !desktopMenu.closedOnScroll || !mobile.menuOpened || !mobile.menuClosed;
  const refreshStateUiFailed = !refreshStateUi.found || !refreshStateUi.collapsedBeforeRefresh || !refreshStateUi.collapsedAfterRefresh || !refreshStateUi.collapsePersisted || !refreshStateUi.explicitSelectionReopens || !refreshStateUi.runningCountLive || !refreshStateUi.failureCountLive || !refreshStateUi.startupLabelsBelowNumbers || !refreshStateUi.oldStartupLabelsRemoved;
  const workspaceTabDragUiFailed = !workspaceTabDragUi.beganImmediately || !workspaceTabDragUi.activatedOnPress || !workspaceTabDragUi.dragGhostVisible || !workspaceTabDragUi.dropPositionVisible || !workspaceTabDragUi.dropPositionRemoved || !workspaceTabDragUi.dragGhostRemoved || !workspaceTabDragUi.touchReady || !workspaceTabDragUi.commonTitleFits || !workspaceTabDragUi.numberedSessionTitleFits || !workspaceTabDragUi.compactKindLabels || !workspaceTabDragUi.distinctKindIcons || !workspaceTabDragUi.remoteProtocolTitlesCompact || JSON.stringify(workspaceTabDragUi.remoteProtocolLetters) !== JSON.stringify(['R','V','X']) || !workspaceTabDragUi.remoteProtocolMonitorBadges || !workspaceTabDragUi.remoteProtocolThemeAware || !workspaceTabDragUi.activeSelectionVisible || !workspaceTabDragUi.tabFontWithinResizeRange || !workspaceTabDragUi.shortTabUsesContentWidth || !workspaceTabDragUi.fullTitleTooltip || JSON.stringify(workspaceTabDragUi.liveOrder) !== JSON.stringify(['drag-a','drag-b','drag-c']) || JSON.stringify(workspaceTabDragUi.savedOrder) !== JSON.stringify(['drag-b','drag-c','drag-a']) || JSON.stringify(workspaceTabDragUi.persistedOrder) !== JSON.stringify(['drag-b','drag-c','drag-a']) || !workspaceTabDragUi.activeFollowsDragged || !workspaceTabDragUi.clickSuppressed || !workspaceTabDragUi.cancelStarted || !workspaceTabDragUi.cancelRestored || !workspaceTabDragUi.closeDoesNotDrag || !workspaceTabDragUi.fallbackMove || !workspaceTabDragUi.scrollControlsVisible || !workspaceTabDragUi.scrollControlsHideWhenFit || !workspaceTabDragUi.nativeScrollbarHidden || !workspaceTabDragUi.wheelScrollsTabs;
  const workspaceTabCloseUiFailed = !workspaceTabCloseUi.remoteStatusDotVisible
    || !workspaceTabCloseUi.systemRemoteStatusHidden
    || !workspaceTabCloseUi.systemRemoteClosesImmediately
    || !workspaceTabCloseUi.connectedPrompt
    || !workspaceTabCloseUi.backdropIgnored
    || !workspaceTabCloseUi.escapePreservesTabs
    || !workspaceTabCloseUi.cancelPreservesTabs
    || !workspaceTabCloseUi.multiPromptListsNames
    || !workspaceTabCloseUi.confirmed
    || !workspaceTabCloseUi.disconnectedClosesImmediately
    || !workspaceTabCloseUi.withinViewport;
  const workspaceDockingUiFailed = !workspaceDockingUi.firstSplit
    || !workspaceDockingUi.secondSplit
    || !workspaceDockingUi.nestedTree
    || workspaceDockingUi.paneCount !== 3
    || !workspaceDockingUi.eachPaneComplete
    || !workspaceDockingUi.activityResizeReflowsEveryPane
    || workspaceDockingUi.splitterCount !== 2
    || !workspaceDockingUi.splitterTracksUsable
    || !workspaceDockingUi.splitterLinesVisible
    || !workspaceDockingUi.terminalInsetsCompact
    || !workspaceDockingUi.terminalScrollbarGutterReleased
    || !workspaceDockingUi.ratioAdjusted
    || !workspaceDockingUi.ratioPersisted
    || !workspaceDockingUi.tabResizeAccessible
    || !workspaceDockingUi.tabAllPanesClampMin
    || !workspaceDockingUi.tabAllPanesClampMax
    || !workspaceDockingUi.tabTextScales
    || !workspaceDockingUi.statusDotScales
    || !workspaceDockingUi.tabPointerLifecycle
    || !workspaceDockingUi.tabHeightPersisted
    || !workspaceDockingUi.tabKeyboardControls
    || !workspaceDockingUi.tabDoubleClickResets
    || !workspaceDockingUi.tabHeightRestored
    || !workspaceDockingUi.tabStorageIndependent
    || !workspaceDockingUi.inactiveCloseRerendered
    || !workspaceDockingUi.mergedNested
    || !workspaceDockingUi.mergedAll
    || !workspaceDockingUi.collapsedToSinglePane;
  const workspaceStartupRestoreUiFailed = !workspaceStartupRestoreUi.storageProtected
    || !workspaceStartupRestoreUi.restoredThreeTabs
    || !workspaceStartupRestoreUi.activeRestored;
  const workspaceTabVisibilityUiFailed = !workspaceTabVisibilityUi.switchKeepsActiveVisible
    || !workspaceTabVisibilityUi.resizeKeepsActiveVisible
    || !workspaceTabVisibilityUi.dragKeepsActiveVisible
    || !workspaceTabVisibilityUi.splitSourceActivePreserved
    || !workspaceTabVisibilityUi.splitSourceActiveVisible
    || !workspaceTabVisibilityUi.splitSourceDidNotJumpLast
    || !workspaceTabVisibilityUi.splitSourceScrollNearPrevious
    || !workspaceTabVisibilityUi.localSplitCreated
    || !workspaceTabVisibilityUi.splitSourceOrderPreserved
    || !workspaceTabVisibilityUi.splitSourceActiveIndexPreserved;
  const workspaceHeaderResizeUiFailed = !workspaceHeaderResizeUi.found
    || !workspaceHeaderResizeUi.classicAppearance
    || !workspaceHeaderResizeUi.accessible
    || !workspaceHeaderResizeUi.minClamped
    || !workspaceHeaderResizeUi.maxClamped
    || !workspaceHeaderResizeUi.brandAligned
    || !workspaceHeaderResizeUi.textScales
    || !workspaceHeaderResizeUi.controlsScale
    || !workspaceHeaderResizeUi.controlsUnclipped
    || !workspaceHeaderResizeUi.resizeHandlesPlaced
    || !workspaceHeaderResizeUi.resizeHandlesHitTestable
    || !workspaceHeaderResizeUi.pointerLifecycle
    || !workspaceHeaderResizeUi.heightPersisted
    || !workspaceHeaderResizeUi.keyboardControls
    || !workspaceHeaderResizeUi.doubleClickResets
    || !workspaceHeaderResizeUi.heightRestored
    || !workspaceHeaderResizeUi.tabStorageIndependent;
  const runningActionsFailed = !runningActions.found || !runningActions.fits || !runningActions.compact || !runningActions.iconOnly || !runningActions.overviewLabelsBelowNumbers || !runningActions.customPathApplied;
  const authUiFailed = !authUi.found || !Object.values(authUi.passwordMode).every(Boolean) || !Object.values(authUi.keyMode).every(Boolean) || !authUi.passwordEyeToggle;
  const connectionStartupUiFailed = !Object.values(connectionStartupUi).every(value => Array.isArray(value) ? value.length > 0 : Boolean(value))
    || !connectionStartupUi.categories.includes('Shell')
    || !connectionStartupUi.categories.includes('交互式语言')
    || !connectionStartupUi.categories.includes('会话工具');
  const saveAndClearUiFailed = !Object.values(saveAndClearUi).every(Boolean);
  const notificationUiFailed = notificationUi.replayed !== 0 || !notificationUi.initialized || notificationUi.cursor !== notificationUi.stored || !notificationUi.categoryControls || !notificationUi.floatingUnderNotifications || !notificationUi.successSuppressed || !notificationUi.infoVisible || !notificationUi.progressSuppressed || !notificationUi.desktopToggleReflects || !notificationUi.pointerKeepsToast || !notificationUi.pointerResumesToast;
  const restoreKeyUiFailed = restoreKeyUi.scenario !== 'm6-exchange' || restoreKeyUi.checks < 100 || restoreKeyUi.screenshots < 60;
  const restoreCredentialUiFailed = restoreKeyUiFailed;
  const settingsSectionsFailed = navigationUi.settingsChecks.some(item=>item.visible.length!==1||item.visible[0]!==item.requested||item.active.length!==1||item.active[0]!==item.requested) || navigationUi.aboutVisible?.length!==1 || navigationUi.aboutVisible?.[0]!=='settings-about' || navigationUi.aboutActive?.length!==1 || navigationUi.aboutActive?.[0]!=='settings-about';
  const importSectionsFailed = navigationUi.importChecks.some(item=>item.visible.length!==1||item.visible[0]!==item.requested||item.active.length!==1||item.active[0]!==item.requested);
  const importSourceCheck = navigationUi.importChecks.find(item => item.requested === 'import-source');
  const runtimeUi = navigationUi.runtimeUi || {};
  const i18nUi = navigationUi.i18nUi || {};
  const thirdPartyLiveSwitch = i18nUi.thirdPartyLiveSwitch || {};
  const thirdPartyLiveSwitchFailed = thirdPartyLiveSwitch.scenario !== 'third-party-live-language-switch'
    || !thirdPartyLiveSwitch.aceSeededChinese
    || !thirdPartyLiveSwitch.zmodemSeededChinese
    || !thirdPartyLiveSwitch.aceClean
    || !thirdPartyLiveSwitch.zmodemClean
    || !thirdPartyLiveSwitch.zmodemLocalizedTitle
    || !thirdPartyLiveSwitch.zmodemUserTextPreserved;
  const sessionUi = navigationUi.sessionUi || {};
  const authPolicyUi = navigationUi.authPolicyUi || {};
  const localDirectUi = navigationUi.localDirectUi || {};
  const runtimeUiFailed = !runtimeUi.found || runtimeUi.port !== '18100' || JSON.stringify(runtimeUi.selectedHosts) !== JSON.stringify(['0.0.0.0']) || !runtimeUi.sftpSettingsAbsent || !runtimeUi.terminalLatencySettingAbsent || !runtimeUi.wildcardCollapsed || runtimeUi.urlLinks.length !== 2 || !runtimeUi.urlLinks.some(url=>url.includes('192.0.2.10:18100')) || !runtimeUi.restartNotice;
  const sessionUiFailed = sessionUi.ttl !== '720' || sessionUi.max !== '1000' || sessionUi.cleanup !== '10' || !sessionUi.active || !sessionUi.save;
  const activityUiFailed = result.activity.count !== 11 || !result.activity.iconCentered || !result.activity.centersAligned || !result.activity.insideColumn || !result.activity.resizable || !result.activityUtilities;
  const appearanceEffectsUiFailed = Object.values(appearanceEffectsUi).some(value => value !== true);
  const navigationUiFailed = !navigationUi.settingsOnlySections || !navigationUi.settingsSectionMode || !navigationUi.settingsVertical || navigationUi.settingsResponsiveColumns?.narrow !== '1' || (navigationUi.settingsResponsiveColumns?.viewportWide && navigationUi.settingsResponsiveColumns?.wide !== '2') || i18nUi.language !== 'en-US' || i18nUi.settingsTitle !== 'General' || i18nUi.activityTitle !== 'Switch to Simplified Chinese' || i18nUi.mobileTitle !== 'Switch to Simplified Chinese' || !i18nUi.activityOrder || !i18nUi.persisted || !i18nUi.settingsSelectorRemoved || i18nUi.visibleHan?.length || thirdPartyLiveSwitchFailed || !i18nUi.resumeButton || !i18nUi.pauseButton || !i18nUi.tasksPreserved || !i18nUi.tabsPreserved || !navigationUi.themeUi?.entryHidden || !navigationUi.themeUi?.controlsHidden || !navigationUi.themeUi?.oldConfigIgnored || !navigationUi.themeUi?.clearPreset || !navigationUi.themeUi?.noEffects || !navigationUi.themeUi?.zeroBlur || !navigationUi.cacheUi?.selected || !navigationUi.cacheUi?.panel || navigationUi.cacheUi?.categories !== 6 || !navigationUi.cacheUi?.beforeAbout || !navigationUi.cacheUi?.absentFromGeneral || !navigationUi.storageAlignmentUi?.found || !navigationUi.storageAlignmentUi?.topAligned || !navigationUi.storageAlignmentUi?.bottomAligned || !navigationUi.storageMigrationUi?.controlsFound || !navigationUi.storageMigrationUi?.threeChoices || !navigationUi.storageMigrationUi?.cancelBlockedRequest || !navigationUi.storageMigrationUi?.oneMigrationRequest || !navigationUi.storageMigrationUi?.migrationRequested || settingsSectionsFailed || runtimeUiFailed || sessionUiFailed || !authPolicyUi.redundantCheckboxRemoved || !authPolicyUi.localOnlyLabel || !authPolicyUi.alwaysLabel || !authPolicyUi.directDefinition || !localDirectUi.control || !localDirectUi.defaultOff || !localDirectUi.policyCopy || !localDirectUi.enabled || !localDirectUi.proxyBlocked || navigationUi.duplicateSettingsNav !== 0 || navigationUi.inlineUpdateDotPresent || !navigationUi.importOwnSections || !navigationUi.importSectionMode || !navigationUi.importVertical || !navigationUi.importResultsMerged || !importSourceCheck?.resultsVisible || importSectionsFailed || !navigationUi.treeHidden || navigationUi.dotsBeforeRead.some(dot=>!dot.found||dot.hidden!==false) || navigationUi.dotsAfterRead.some(dot=>!dot.found||dot.hidden!==true) || navigationUi.storedReadVersion !== '1.0.9' || !navigationUi.sameVersionStaysRead || !navigationUi.ignoredVersionHidesNotice || !navigationUi.newerAfterIgnoredShowsNotice || !navigationUi.republishedShowsNotice || !navigationUi.republishedReadMarksNotice || !navigationUi.newerVersionShowsAgain;
  const aboutUiFailed = Boolean(aboutUi.error) || !aboutUi.found || !aboutUi.aboutSelected || aboutUi.duplicateSettingsNav !== 0 || !aboutUi.versionMatches || !aboutUi.licenseMetadata || !aboutUi.sourceLink || !aboutUi.modalOpen || !aboutUi.accessible || !aboutUi.fullText || !aboutUi.textScrollable || !aboutUi.cardWithinViewport || !aboutUi.closeFocused || !aboutUi.backdropIgnored || !aboutUi.closedByEscape || !aboutUi.focusReturned || !aboutUi.followupBackdropClean || !aboutUi.followupResolved || !aboutUi.updateUi;
  const hostTrustUiFailed = !hostTrustUi.unknown?.open
    || !hostTrustUi.unknown?.fingerprint
    || JSON.stringify(hostTrustUi.unknown?.actions)!==JSON.stringify(['仅本次信任','信任并保存','取消'])
    || !hostTrustUi.unknown?.cancelFocused
    || !hostTrustUi.unknown?.backdropIgnored
    || hostTrustUi.unknown?.result!=='once'
    || !hostTrustUi.changed?.open
    || !hostTrustUi.changed?.warning
    || !hostTrustUi.changed?.oldAndNew
    || !hostTrustUi.changed?.updateDanger
    || !hostTrustUi.changed?.updateLabel
    || hostTrustUi.changed?.result!=='persist'
    || !hostTrustUi.escapeCancelled
    || !hostTrustUi.settings?.visible
    || !hostTrustUi.settings?.record
    || !hostTrustUi.settings?.removeButton
    || !hostTrustUi.settings?.searchInput
    || !hostTrustUi.settings?.searchPlaceholder
    || !hostTrustUi.settings?.pageSizeDefault;
  const expectedSettingsActions = ['通用设置','AI 设置','安全','用户密钥管理','通知设置','启动与运行','缓存管理','关于'];
  const mobileResizeNavigationFailed = !mobile.workspaceResizeNavigation || !Object.values(mobile.workspaceResizeNavigation).every(Boolean);
  const mobileWorkspaceChromeResizeFailed = !mobile.workspaceChromeResize?.found
    || !mobile.workspaceChromeResize?.handlesHidden
    || !mobile.workspaceChromeResize?.desktopSizingIgnored
    || !mobile.workspaceChromeResize?.interactionsIgnored
    || !mobile.workspaceChromeResize?.storageUntouched;
  const mobileNavigationFailed = mobileResizeNavigationFailed || mobileWorkspaceChromeResizeFailed || !mobile.importExplorerFirst || !mobile.importWorkspaceEntered || !mobile.filePickerViewport?.found || !mobile.filePickerViewport?.freezesDuringDialog || !mobile.filePickerViewport?.restoresAfterDialog || !mobile.filePickerViewport?.clearsShellScroll || !mobile.filePickerViewport?.preservesWorkspaceScroll || !mobile.sftp?.found || !mobile.sftp?.fits || !mobile.sftp?.encodingVisible || !mobile.sftp?.terminalJumpVisible || !mobile.sftp?.allActionsVisible || !mobile.sftp?.uniformButtons || !mobile.sftp?.wrapsCompletely || !mobile.sftp?.defaultCollapsed || !mobile.sftp?.toggleVisible || !mobile.sftp?.breadcrumbAlwaysVisible || !mobile.sftp?.expandedPersisted || !mobile.sftp?.taskCenter?.opened || !mobile.sftp?.taskCenter?.withinViewport || !mobile.sftp?.taskCenter?.contentAdaptive || !mobile.sftp?.taskCenter?.resizeHandleHidden || !mobile.sftp?.taskCenter?.nativeResizeDisabled || !mobile.workspaceFormFonts?.preventsFocusZoom || !mobile.settingsNavigation?.explorerFirst || !mobile.settingsNavigation?.workspaceEntered || !mobile.settingsNavigation?.vertical || !mobile.settingsNavigation?.selectedOnly || !mobile.settingsNavigation?.noDuplicateMenu || JSON.stringify(mobile.settingsNavigation?.labels)!==JSON.stringify(expectedSettingsActions) || mobile.mobileTabs?.count !== 8 || !mobile.mobileTabs?.labelsHidden || !mobile.mobileTabs?.iconsCentered || !mobile.mobileTabs?.fits || !mobile.groupActionVisible || !mobile.groupActionMenuOpened || !mobile.groupControlsInline || !mobile.groupDragFirst || !mobile.groupCancelDoesNotSave || !mobile.groupDragSurvivesRefresh;
  const mobileAboutFailed = !mobile.about || !mobile.about.modalOpen || !mobile.about.cardWithinViewport || !mobile.about.textWithinCard || !mobile.about.textScrollable || !mobile.about.closeVisible || !mobile.about.closed;
  const terminalLabels = ['复制选中','光标复制','会话复制','粘贴','清屏','滚动到底部','终端配置','断开连接','全局终端设置'];
  const terminalSettingsUi = terminalUi.terminalSettingsUi || {};
  const terminalDropUi = terminalSettingsUi.drop || {};
  const terminalAiUi = terminalSettingsUi.ai || {};
  const terminalAiCompletionGuardFailed = !terminalAiUi.earlyCompletionGuard || !terminalAiUi.queueCompletionGuard || !terminalAiUi.raceCompletes;
  const mobileTerminalSettingsUi = mobile.terminalGlobalSettings || {};
  const terminalStartupUiFailed = !terminalStartupUi.found || !Object.values(terminalStartupUi).every(Boolean);
  const terminalAiUiFailed = !terminalSettingsUi.mcp || !terminalAiUi.shortcutRendered || !terminalAiUi.panelOpens || !terminalAiUi.rightPlacement || !terminalAiUi.panelLayoutFits || !terminalAiUi.composerFits || !terminalAiUi.composerKeyboard || !terminalAiUi.markdownRendered || !terminalAiUi.scopedHorizontalScroll || !terminalAiUi.longCodeActionsReachable || !terminalAiUi.toolCallRendered || !terminalAiUi.mcpCallRendered || !terminalAiUi.xmlCommandRendered || !terminalAiUi.stopsAfterFirstCommand || !terminalAiUi.fullPermissionOption || !terminalAiUi.inlineApprovalSlot || !terminalAiUi.modelReasoningControls || !terminalAiUi.multiCommandQueue || !terminalAiUi.chatMode || !terminalAiUi.agentPlanLoopGuard || !terminalAiUi.incompleteCommandRecovery || !terminalAiUi.floatingPersisted || !terminalAiUi.floatingViewportClamped || !terminalAiUi.dragScrollPreserved || !terminalAiUi.modalAboveFloating || !terminalAiUi.floatingResizeDirection || !terminalAiUi.floatingMinimized || !terminalAiUi.fixedMinimized || !terminalAiUi.fixedBoundaryResize || !terminalAiUi.layoutRestored || !terminalAiUi.activeState || !terminalAiUi.projectedActiveState || !terminalAiUi.binaryOutputCaptured || !terminalAiUi.trailingPromptDetected || !terminalAiUi.emptyOutputCompletes || !terminalAiUi.controlledAllowsLowSensitivity || !terminalAiUi.controlledFindAllowed || !terminalAiUi.controlledConfirmsSensitive || !terminalAiUi.explicitFileReadAllowed || !terminalAiUi.unrequestedFileReadAllowed || !terminalAiUi.pathBoundaryAllowed || !terminalAiUi.sensitivePathUsesSensitiveRisk || !terminalAiUi.agentLoop || !terminalAiUi.agentGroupedReply || !terminalAiUi.agentActionRecovery || !terminalAiUi.searchTaskSwitch || !terminalAiUi.internalCutIsNotUserStop || !terminalAiUi.historySupported;
const terminalUiFailed = terminalAiUiFailed || !terminalUi.found || !terminalSettingsUi.connectionStageTabSwitch || !terminalUi.desktopBackHidden || !terminalUi.desktopKeysHidden || terminalUi.binaryType !== 'arraybuffer' || !terminalUi.binaryWrite || !terminalUi.stableLogId || !terminalUi.x11DefaultFallsBack || !terminalUi.x11ScopeMenu || !terminalUi.ctrlVImageIntercepted || !terminalUi.ctrlVEmptyFallsThrough || !terminalUi.enterReconnect || !terminalUi.reconnectPreservesOutput || !terminalUi.inactiveTerminalOutputContinues || !terminalUi.fontActionRestoresFocus || !terminalUi.recentCommandsRestoreFocus || !terminalUi.recentCommandSequenceVisible || !terminalUi.resourceWindowTitle || !terminalUi.remoteDesktopTitleDedup || !terminalUi.numberingContinuesWithOpenTabs || !terminalUi.numberingRestartsAfterAllClosed || !terminalUi.encodingMenuOpened || !terminalUi.encodingSelectionUsesLatest || !terminalUi.fontMenuOpened || !terminalUi.statusHoverShowsFull || !terminalUi.desktopStatusAvoidsDuplicate || !terminalUi.desktopToolbarInHeader || !terminalUi.connectionToggleUsesLinkAction || !terminalUi.activeToolbarReplacesPrevious || !terminalUi.narrowToolbarFits || !terminalUi.narrowToolbarLeftAligned || !terminalUi.responsiveToolbarFits || !terminalUi.terminalToolbarScrollable || !terminalUi.toolbarScrollControlsVisible || !terminalUi.toolbarScrollStartsAtLeft || !terminalUi.toolbarScrollLabels || !terminalUi.toolbarScrollCueVisible || !terminalUi.toolbarScrollButtonsWork || !terminalUi.toolbarScrollEndsAtRight || !terminalUi.startupCompactIconOnly || !terminalUi.desktopActionsIconOnly || !terminalUi.terminalToolbarIconSet || !terminalUi.terminalFrameLowContrast || !terminalUi.desktopCursorCopyHintVisible || !terminalUi.desktopCursorCopyHintCleansUp || !terminalUi.terminalCtrlWheelZooms || !terminalUi.terminalCtrlWheelKeepsPosition || !terminalUi.terminalPlainWheelScrolls || !terminalUi.terminalFontChangePreservesMiddleScroll || !terminalUi.terminalCjkTextDoesNotClip || !terminalUi.legacyTerminalControlsAbsent || !terminalUi.zmodemPanelUi || !terminalSettingsUi.open || !terminalSettingsUi.globalScope || !terminalSettingsUi.controls || !terminalSettingsUi.fontInheritance || !terminalDropUi.found || !terminalDropUi.copyFeedbackVisible || !terminalDropUi.sftpCopyToCurrentDirectory || !terminalDropUi.uploadFeedbackVisible || !terminalDropUi.localUploadToCurrentDirectory || !terminalDropUi.singleActiveDropTarget || !terminalDropUi.resizeFeedbackClears || !terminalDropUi.staleFeedbackClears || !terminalDropUi.completionNoticeNotDuplicated || !terminalSettingsUi.withinViewport || !terminalSettingsUi.compact || !terminalSettingsUi.readableWidth || !terminalSettingsUi.noHorizontalOverflow || JSON.stringify(terminalSettingsUi.tabs)!==JSON.stringify(['外观','鼠标与链接','选择与粘贴','快捷键']) || JSON.stringify(terminalSettingsUi.backgroundModes)!==JSON.stringify(['theme','black','white','custom']) || !terminalSettingsUi.backgroundPreview || !terminalSettingsUi.requestedDefaults || !terminalSettingsUi.editablePasteSetting || !terminalSettingsUi.appliesToAllOpenSessions || !terminalSettingsUi.readableCustomPalette || !terminalSettingsUi.followsTheme || !terminalSettingsUi.copyFormatting || !terminalSettingsUi.singleLinePaste || !terminalSettingsUi.pasteCommandHistory || !terminalSettingsUi.linkProvider || !terminalSettingsUi.editablePaste || !mobileTerminalSettingsUi.buttonHidden || !mobile.terminalLongPress?.menuOnly || !mobile.terminalLongPress?.menuOpened || !mobile.terminalLongPress?.cursorHintStarted || !mobile.terminalLongPress?.cursorStartStored || !mobile.terminalLongPress?.cursorSelectionBlue || !mobile.terminalLongPress?.cursorCopyCompleted || !mobile.terminalLongPress?.clipboardFallback || !mobile.terminalSessionText?.open || !mobile.terminalSessionText?.withinViewport || !mobile.terminalSessionText?.selectable || !mobile.terminalSessionText?.scrollable || !mobile.terminalSessionText?.fullText || !mobile.terminalSessionText?.copyAll || !mobile.terminalSessionText?.copyAllWorks || !mobile.terminalSessionText?.backdropIgnored || !mobile.terminalPasteEditor?.open || !mobile.terminalPasteEditor?.withinViewport || !mobile.terminalPasteEditor?.editable || !mobile.terminalPasteEditor?.actionsVisible || !mobile.terminalPasteEditor?.backdropIgnored || !mobile.terminalPasteEditor?.cancelled || !mobile.terminalBack?.visible || !mobile.terminalBack?.shellOwned || !mobile.terminalBack?.reservedRow || !mobile.terminalBack?.sftpTextFits || !mobile.terminalBack?.globalSettingsHidden || JSON.stringify(mobile.terminalBack?.priorityOrder)!==JSON.stringify(['reconnect','keys','forward-list','sftp']) || !mobile.terminalBack?.returned || !mobile.terminalFontMenu?.opened || !mobile.terminalFontMenu?.withinViewport || !mobile.terminalFontMenu?.compact || !mobile.terminalFontMenu?.scrollable || !mobile.terminalFontMenu?.closeSticky || !mobile.terminalFontMenu?.touchTargets || !terminalLabels.every(label=>terminalUi.labels.includes(label)) || terminalUi.metrics.some(item=>Math.abs(item.buttonHeight-30)>0.5||Math.abs(item.iconWidth-14)>0.5||Math.abs(item.iconHeight-14)>0.5||item.centerDelta>0.5);
  const logSettingsUiFailed = logSettingsUi.scenario !== 'm6-log-reader' || logSettingsUi.checks < 300 || logSettingsUi.screenshots < 116;
  // Quick commands and automations are gated by the Vue matrices in ui-smoke-harness.
  const productivityUiFailed = Boolean(productivityUi.error) || !productivityUi.quickVisible || productivityUi.actionCount < 7 || !productivityUi.quickConnectionActionsInline || !productivityUi.quickPanelDirect || !productivityUi.workspaceSearchable || !productivityUi.workspacePreviewOpens || !productivityUi.quickButtonPlacement || !productivityUi.quickButtonLightning || productivityUi.commandWindowDefaultHasConnections || productivityUi.commandWindowDefaultHasSnippets || !productivityUi.commandWindowSearchFindsSnippet || !productivityUi.commandWindowLabel.includes('命令窗口') || !productivityUi.xServerQuickUsesX11 || !productivityUi.xServerUnauthorizedWarning || !productivityUi.xServerLocalDirectReady || !productivityUi.broadcastFromEither || !productivityUi.broadcastTabMarked || !productivityUi.broadcastHeaderGrouped || !productivityUi.broadcastExitCompact || !productivityUi.visibleSplitHasNoActivity || !productivityUi.visibleSplitClearsPriorActivity || !productivityUi.hiddenBinaryOutputMarked || productivityUi.syncRows !== 3 || !productivityUi.conflictSafe || !productivityUi.namedWorkspaceTools || !productivityUi.terminalTools;
  const remoteAdminUiFailed = Boolean(remoteAdminUi.desktop?.error)
    || !remoteAdminUi.desktop?.viewportFit
    || !remoteAdminUi.desktop?.noHorizontalOverflow
    || !remoteAdminUi.desktop?.controlsFit
    || !remoteAdminUi.desktop?.passwordEyeToggle
    || !remoteAdminUi.desktop?.initialPasswordMode
    || !remoteAdminUi.desktop?.sameSudoMode
    || !remoteAdminUi.desktop?.passwordSeparateSudo
     || !remoteAdminUi.desktop?.keyMode
     || !remoteAdminUi.desktop?.sudoNone
     || !remoteAdminUi.desktop?.agentMode
     || remoteAdminUi.desktop?.reusePolicyOptions !== 'once,10m,30m,session'
     || !remoteAdminUi.desktop?.separatePayload
    || !remoteAdminUi.desktop?.submitClearsSecrets
    || !remoteAdminUi.desktop?.cancelClearsSecrets
    || !remoteAdminUi.desktop?.backdropIgnored
    || !remoteAdminUi.desktop?.backdropPreservesSecrets
    || !remoteAdminUi.desktop?.backdropCancelClearsSecrets
    || !remoteAdminUi.desktop?.escapeClearsSecrets
    || Boolean(remoteAdminUi.mobile?.error)
    || !remoteAdminUi.mobile?.viewportFit
    || !remoteAdminUi.mobile?.noHorizontalOverflow
    || !remoteAdminUi.mobile?.controlsFit
    || !remoteAdminUi.mobile?.singleColumn
    || !remoteAdminUi.mobile?.stickyRegions
    || !remoteAdminUi.mobile?.actionButtonsFit
    || !remoteAdminUi.mobile?.cancelled
    || !remoteAdminUi.mobile?.secretCleared;
  const linuxDesktopToolbarUiFailed = Boolean(linuxDesktopToolbarUi.desktop?.error)
    || !linuxDesktopToolbarUi.desktop?.found
    || linuxDesktopToolbarUi.desktop?.columnCount !== 2
    || !linuxDesktopToolbarUi.desktop?.sameHeight
    || !linuxDesktopToolbarUi.desktop?.topAligned
    || !linuxDesktopToolbarUi.desktop?.bottomAligned
    || !linuxDesktopToolbarUi.desktop?.loadingVisible
    || !linuxDesktopToolbarUi.desktop?.noOverflow
    || Boolean(linuxDesktopToolbarUi.narrow?.error)
    || !linuxDesktopToolbarUi.narrow?.found
    || linuxDesktopToolbarUi.narrow?.viewportWidth > 700
    || linuxDesktopToolbarUi.narrow?.columnCount !== 1
    || !linuxDesktopToolbarUi.narrow?.stacked
    || !linuxDesktopToolbarUi.narrow?.fullWidth
    || !linuxDesktopToolbarUi.narrow?.loadingVisible
    || !linuxDesktopToolbarUi.narrow?.noOverflow;
  const remoteRenderingProtocols = ['rdp','vnc','xdmcp'];
  const remoteRenderingUiFailed = remoteRenderingProtocols.some(protocol => !remoteAccessUi.graphicsRendering?.[protocol]?.warning || !remoteAccessUi.graphicsRendering?.[protocol]?.copyButtons || !remoteAccessUi.graphicsRendering?.[protocol]?.noHorizontalOverflow) || !remoteAccessUi.renderingCopyInteraction?.success || !remoteAccessUi.renderingCopyInteraction?.failure || !remoteAccessUi.narrowRendering?.ok;
  const remoteLayoutUiFailed = remoteRenderingProtocols.some(protocol => !remoteAccessUi.remoteLayoutUi?.[protocol]?.ok);
  const remoteAccessUiFailed = !remoteAccessUi.rdpDisplayForm || !remoteAccessUi.vncDefaultsToNoVnc || !remoteAccessUi.vncExplicitAutoPreserved || !remoteAccessUi.vncModePersisted || !remoteAccessUi.vncBundledMode || !remoteAccessUi.vncImageSyncOptOut || !remoteAccessUi.vncPasswordForm || !remoteAccessUi.vncRetryPrompt || !remoteAccessUi.vncRetryValue || !remoteAccessUi.vncNoPassword || !remoteAccessUi.sshCredentialRepairUi || !remoteAccessUi.quickTerminalCredentialRepairUi || !remoteAccessUi.ftpCredentialRepairUi || !remoteAccessUi.vncServiceDiagnosisUi || !remoteAccessUi.vncServiceActionDebounced || !remoteAccessUi.xdmcpForm || !remoteAccessUi.xdmcpMenuAvailable || !remoteAccessUi.xdmcpSessionSemantics || !remoteAccessUi.xdmcpAuthorizationLayout || !remoteAccessUi.standaloneRdpFallback || !remoteAccessUi.standaloneRdpStatusHidden || !remoteAccessUi.standaloneVncFallback || !remoteAccessUi.standaloneXdmcpFallback || !remoteAccessUi.standaloneXdmcpStatusHidden || !remoteAccessUi.remoteDiagnosticAlignment || remoteRenderingUiFailed || remoteLayoutUiFailed || !remoteAccessUi.vncSourceSelection || !remoteAccessUi.vncSourceRefreshInPlace || !remoteAccessUi.vncFailureRecovery || !remoteAccessUi.vncComponentManagementUi || !remoteAccessUi.macVncBypassesLinuxDesktop || !remoteAccessUi.macVncSetupGuidance || !remoteAccessUi.remoteActivitySeparated || !remoteAccessUi.remoteHostStickyStyle || !remoteAccessUi.remoteHostStickyFollowsOuter || !remoteAccessUi.derivedSourcePresentation || !remoteAccessUi.remoteNameDoubleClickOpens || !remoteAccessUi.remoteDesktopSwitchAvailable || !remoteAccessUi.remoteDesktopSingleDisabled || !remoteAccessUi.remoteDesktopSwitchMenuComplete || !remoteAccessUi.sshActivitySeparated || !remoteAccessUi.x11AppLauncher || !remoteAccessUi.x11InstalledDialog || !remoteAccessUi.xServerRemoteUninstall || !remoteAccessUi.xServerClipboardLayout || !remoteAccessUi.xServerImmediateLoading || !remoteAccessUi.xServerManager || !remoteAccessUi.quickXServerManager || !remoteAccessUi.xServerDesktopIntegrationUnavailable || !remoteAccessUi.xServerBrowserAuthorization || !remoteAccessUi.xServerLocalDirectAuthorization || !remoteAccessUi.adaptiveModal || !remoteAccessUi.modalHeaderControlsAligned || !remoteAccessUi.modalBackdropLocked || !remoteAccessUi.uncheckedHealthHidden || !remoteAccessUi.healthIconOnly || !remoteAccessUi.narrowBrandActionsFit || !remoteAccessUi.expandedBrandNameVisible || !remoteAccessUi.defaultAddSshTextFits || !remoteAccessUi.narrowAddSshTextFits;
  const expectedSftpToolActions = ['收藏当前目录','新建文件夹','新建文件','上传文件','SFTP 回收站','搜索当前目录','打开此连接的终端','刷新目录','SFTP 全局设置'];
  const directoryActionsUi = sftpUi.directoryActionsUi || {};
  const connectionSessionUi = sftpUi.connectionSessionUi || {};
  const nativeDragUi = sftpUi.nativeDragUi || {};
  const directoryCacheBehavior = sftpUi.directoryCacheBehavior || {};
  const directorySizeUi = sftpUi.directorySizeUi || {};
  const jobUi = sftpUi.jobUi || {};
  const textEncodingUi = sftpUi.textEncodingUi || {};
  const imagePreviewUi = sftpUi.imagePreviewUi || {};
  const recycleIconUi = sftpUi.recycleIconUi || {};
  const globalSettingsUi = sftpUi.globalSettingsUi || {};
  const downloadNoticeUi = sftpUi.downloadNoticeUi || {};
  const jobUiFailed = !jobUi.found || !jobUi.singleGlobalEntry || !jobUi.noPaneTaskRegions || !jobUi.failedStatusVisible || !jobUi.totalProgressVisible || !jobUi.totalProgressIndeterminate || !jobUi.totalProgressHidesWhenIdle || !jobUi.floatingVisibleBelowHeader || !jobUi.floatingActions || !jobUi.floatingResumeAction || !jobUi.floatingProgress || !jobUi.floatingOpensTaskCenter || !jobUi.floatingCloseHidesCurrent || !jobUi.floatingNewTaskReopens || !jobUi.floatingMutePersists || !jobUi.floatingSettingRestores || !jobUi.drawerOpened || !jobUi.taskCenterAboveNotifications || !jobUi.drawerDefaultCompact || !jobUi.currentOnly || !jobUi.currentActions || !jobUi.currentQueueActions || !jobUi.queueBatchControls || !jobUi.failedOnly || !jobUi.failedActions || !jobUi.failedClearAvailable || !jobUi.currentProgress || !jobUi.drawerResizable || !jobUi.drawerResizeAdaptive || !jobUi.drawerResizePersists || !jobUi.drawerResizeReset || !jobUi.drawerOversizeRecovers || !jobUi.drawerHeaderReset || !jobUi.drawerResizeClamps || !jobUi.deleteDuplicateBlocked || !jobUi.deleteKeepsDrawerOpen || !jobUi.taskLogInitialOpen || !jobUi.taskLogInitialBottom || !jobUi.taskLogRefreshKeepsOpen || !jobUi.taskLogRefreshShowsLatest || !jobUi.taskLogRefreshFollowsBottom || !jobUi.drawerFitsViewport || !jobUi.historyOnly || !jobUi.historyCounts || !jobUi.historyActions || !jobUi.generatedTaskUi?.found || !jobUi.generatedTaskUi?.savedPath || !jobUi.generatedTaskUi?.openFile || !jobUi.generatedTaskUi?.openDirectory || !jobUi.generatedTaskUi?.deleteFile || jobUi.generatedTaskUi?.buttonCount !== 3 || !jobUi.generatedTaskUi?.noDuplicateTaskDelete || !jobUi.outsideClickCloses || !jobUi.escapeCloses || !jobUi.runningStatusVisible || !jobUi.nativeDragTaskStopHidden || !jobUi.itemProgress || !jobUi.staleJobResponseIgnored || !jobUi.toastIconsAligned || !jobUi.toastOrderPreserved || !jobUi.toastStackedDown || !jobUi.toastAvoidsFloatingTask || !jobUi.toastExitAnimated || !jobUi.toastReflowAnimated || !jobUi.toastMovedUp;
  const textEncodingUiFailed = !textEncodingUi.opened || !textEncodingUi.initialCentered || !textEncodingUi.aceLoaded || textEncodingUi.selected !== 'gbk' || !textEncodingUi.manualLanguage || !textEncodingUi.nonJsonFormattingHidden || !textEncodingUi.nonUtf8SaveAllowed || !textEncodingUi.nonUtf8SaveSubmitted || !textEncodingUi.remoteSaveKeepsOpen || !textEncodingUi.remoteEditorClosesExplicitly || !textEncodingUi.utf8LimitEnforced || !textEncodingUi.utf8BomIncludesPrefix || !textEncodingUi.normalizationOnlyLimitEnforced || !textEncodingUi.lineEndingLabelsLocalized || !textEncodingUi.lightPaged || !textEncodingUi.lightNextPage || !textEncodingUi.jsonFormatting || !textEncodingUi.jsonHiddenAfterLanguageChange || !textEncodingUi.json5FormattingHidden || !textEncodingUi.wordWrap || !textEncodingUi.persistDefault || !textEncodingUi.backup || !textEncodingUi.shellFormat || !textEncodingUi.shellNonLfWarningPrepared || !['lf','crlf','cr'].every(value=>textEncodingUi.lineEndings?.includes(value)) || !['utf8','utf8bom','gb18030','gbk','big5','shift_jis','euc-kr','latin1'].every(value=>textEncodingUi.options?.includes(value)) || !['auto','json','yaml','xml','sh','batchfile','powershell','javascript','java','c_cpp','sql','markdown'].every(value=>textEncodingUi.languageOptions?.includes(value));
      const imagePreviewUiFailed = !imagePreviewUi.svgOpened || !imagePreviewUi.svgSanitized || !imagePreviewUi.svgEmbeddedStyles || !imagePreviewUi.svgOuterWindowStable || !imagePreviewUi.svgFitsCanvas || !imagePreviewUi.svgZoomButtons || !imagePreviewUi.svgCtrlWheel || !imagePreviewUi.svgSearchFocused || !imagePreviewUi.svgSearchLocated || !imagePreviewUi.svgSearchKeepsContext || !imagePreviewUi.svgSearchClearFits || !imagePreviewUi.svgColorModeNotClipped || !imagePreviewUi.svgInvertPreview || !imagePreviewUi.svgColorModePreservesView || !imagePreviewUi.svgPdfInvert || !imagePreviewUi.svgPdfUnicode || !imagePreviewUi.svgPdfLandscape || !imagePreviewUi.svgPreserveAspectRatio || !imagePreviewUi.svgModeControl || !imagePreviewUi.svgRemoteUsesEncodingAwareRead || !imagePreviewUi.svgRemoteEncodingPreserved || !imagePreviewUi.svgSplitEditor || !imagePreviewUi.svgSplitRefresh || !imagePreviewUi.svgLongLineSearch || !imagePreviewUi.svgSplitAutoFocus || !imagePreviewUi.svgSplitClickToEditor || !imagePreviewUi.svgSplitOneLineSourceFocus || !imagePreviewUi.svgSplitUseIdClickToEditor || !imagePreviewUi.svgSplitUseReferenceClickToEditor || !imagePreviewUi.svgSplitMarkerVisibleWithoutAutoFocus || !imagePreviewUi.svgEditorControlsWrapFromFirstColumn || !imagePreviewUi.svgSplitManualZoomDisablesAutoFocus || !imagePreviewUi.svgModeRoundTrip || !imagePreviewUi.svgInlineModeKeepsContentWithoutRemoteRead || !imagePreviewUi.svgModePreservesUnsaved || !imagePreviewUi.notificationAboveFullscreen || !imagePreviewUi.rasterOpened || !imagePreviewUi.rasterZoom;
  const nativeDragUiFailed = !nativeDragUi.found || !nativeDragUi.webExternalDragBlocked || !nativeDragUi.linuxFallbackNoticeOnce || !nativeDragUi.linuxFallbackUsesCompatibilityMode || !nativeDragUi.streamingPreparesOnPointerDown || !nativeDragUi.streamingThresholdActivatesOnce || !nativeDragUi.streamingCaptureCancelSurvives || !nativeDragUi.pointerUpCancelsPending || !nativeDragUi.streamingSkipsStage || !nativeDragUi.streamingNativeBlocksParallelBrowserDrag || !nativeDragUi.nativeIdleHintStable || !nativeDragUi.nativeOutsideHintStaysStable || !nativeDragUi.nativeMotionTargetsSftp || !nativeDragUi.nativeTransientMissKeepsTarget || !nativeDragUi.nativeFinalTransientMissKeepsTarget || !nativeDragUi.nativeReleasedClearsStaleTarget || !nativeDragUi.nativeResultCopiesOnce || !nativeDragUi.firstDragOnlyStages || !nativeDragUi.firstDragReset || !nativeDragUi.cacheReused || !nativeDragUi.cachedUnarmedStaysInternal || !nativeDragUi.sameWindowDropDoesNotArm || !nativeDragUi.armedDragStartsSynchronously || !nativeDragUi.failureRearmed || !nativeDragUi.successClearsState || !nativeDragUi.finderRenameNoticeShown;
  const sftpUiFailed = Boolean(sftpUi.error) || !recycleIconUi.directory || !recycleIconUi.image || !recycleIconUi.archive || !recycleIconUi.badgeInside || !recycleIconUi.badgeAtCorner || !connectionSessionUi.found || !connectionSessionUi.addressIncludesPort || !connectionSessionUi.disconnectedAction || !connectionSessionUi.disconnectedBanner || !connectionSessionUi.connectedAction || !connectionSessionUi.preservedWhileDisconnected || !connectionSessionUi.automaticConnectShared || !connectionSessionUi.manualDisconnectAutoReconnect || !connectionSessionUi.disconnectedFolderOperationReconnects || !connectionSessionUi.dragFeedbackVisible || !connectionSessionUi.dragTargetViewActivated || !connectionSessionUi.targetListDropPrompt || !connectionSessionUi.targetListDropPromptStable || !connectionSessionUi.targetContentLeaveKeepsPreview || !connectionSessionUi.targetHeaderLeaveKeepsPreview || !connectionSessionUi.crossHostListDropCopies || !connectionSessionUi.crossHostPreviewHandoffSurvives || !connectionSessionUi.crossHostDropHasNoUploadToast || !connectionSessionUi.sameHostListDropCopies || !connectionSessionUi.terminalTabPreviewActivated || !connectionSessionUi.invalidTerminalDropRestoresSource || !connectionSessionUi.invalidSftpDropRestoresSource || !connectionSessionUi.acceptedTerminalDropStays || !connectionSessionUi.ownDragUploadSuppressed || !connectionSessionUi.armedPointerCancelClearsRequest || !connectionSessionUi.armedDragAllowsExternalUpload || !connectionSessionUi.staleInternalDragAllowsExternalUpload || !connectionSessionUi.desktopUriListDragAccepted || !connectionSessionUi.releasedDragAllowsExternalUpload || !connectionSessionUi.externalFileDropDetected || !connectionSessionUi.externalFileDropCollected || !connectionSessionUi.externalDropPromptIsSingle || !connectionSessionUi.externalDropPromptAvoidsWorkspaceChrome || !connectionSessionUi.externalDropPromptListCentered || !connectionSessionUi.externalDropSurfaceFillsWorkspace || !connectionSessionUi.externalDropPromptScrollClamped || !connectionSessionUi.externalDropPromptHorizontalClamped || !connectionSessionUi.externalDropPromptClears || nativeDragUiFailed || jobUiFailed || textEncodingUiFailed || imagePreviewUiFailed || !downloadNoticeUi.oncePerMode || !downloadNoticeUi.desktopPath || !downloadNoticeUi.browserDevice || !downloadNoticeUi.batchUsesSharedNotice || !downloadNoticeUi.browserSeparateChoice || !downloadNoticeUi.browserSeparateQueued || !downloadNoticeUi.noDuplicateBatchNotice || !globalSettingsUi.found || !globalSettingsUi.globalScope || !globalSettingsUi.controls || !globalSettingsUi.floatingProgressDefaultOn || !globalSettingsUi.floatingProgressCanRestore || !globalSettingsUi.downloadBehavior || !globalSettingsUi.defaultLimit || !globalSettingsUi.backdropIgnored || !globalSettingsUi.withinViewport || !globalSettingsUi.classicSurface || !globalSettingsUi.themedField || !directorySizeUi.idleButton || !directorySizeUi.requestedOnce || !directorySizeUi.exactBytes || !directorySizeUi.formatted || !directorySizeUi.refreshable || !sftpUi.fileOpenFeedback?.busy || !sftpUi.fileOpenFeedback?.duplicateBlocked || !sftpUi.fileOpenFeedback?.restored || !sftpUi.fileOpenFeedback?.interruptedRetry || !directoryCacheBehavior.sameResponseUntouched || !directoryCacheBehavior.changedResponseRendered || !directoryCacheBehavior.permissionFailureRestored || !sftpUi.searchKeyboardUi?.opened || !sftpUi.searchKeyboardUi?.closed || !sftpUi.searchKeyboardUi?.recursive || !sftpUi.searchKeyboardUi?.feedback || !sftpUi.syncIndicatorFollowsScroll || !sftpUi.diffComparisonUi || !sftpUi.columnLayoutUi?.order || !sftpUi.columnLayoutUi?.persisted || !sftpUi.columnLayoutUi?.resized || !sftpUi.columnLayoutUi?.pointerStable || !sftpUi.columnLayoutUi?.pairOnly || !sftpUi.columnLayoutUi?.adjacentResizeStable || !sftpUi.columnLayoutUi?.dividerUniform || !sftpUi.columnLayoutUi?.localNarrowResizable || !sftpUi.columnLayoutUi?.openButtonStable || !sftpUi.columnLayoutUi?.selectionToolbarStable || !sftpUi.columnLayoutUi?.scrollbarUnified || !sftpUi.columnLayoutUi?.globalCss || !directoryActionsUi.found || directoryActionsUi.stickyPosition !== 'sticky' || !directoryActionsUi.toolbarInHeader || !directoryActionsUi.navigationBeforeFavorites || !directoryActionsUi.reusedWithoutDirectoryReload || !expectedSftpToolActions.every(action=>directoryActionsUi.actionTitles?.includes(action)) || !directoryActionsUi.searchHidden || !directoryActionsUi.pathEditorHidden || !directoryActionsUi.emptyClipboardHidden || !directoryActionsUi.copyQueueVisible || !directoryActionsUi.copyCancelled || !directoryActionsUi.moveQueueVisible || !directoryActionsUi.moveCancelled || !directoryActionsUi.crossHostCopyEnabled || !directoryActionsUi.crossHostMoveDisabled || !directoryActionsUi.crossHostClipboardConflict || !directoryActionsUi.filenameEncodingMenu || !directoryActionsUi.emptyFavoritesCompact || !directoryActionsUi.wideNavigationCompact || !directoryActionsUi.narrowNavigationCompact || !directoryActionsUi.terminalJump || !directoryActionsUi.terminalJumpFirst || !sftpUi.folderOpened || !sftpUi.fileOpened || !sftpUi.unknownAction || sftpUi.stickyPosition !== "sticky" || !sftpUi.breadcrumbScrollable || !sftpUi.singlePathPresentation || sftpUi.breadcrumbLabels?.join('/') !== '根目录/fixture' || sftpUi.breadcrumbText.includes('//') || !sftpUi.selectionShown || !sftpUi.selectionActionsShown || !sftpUi.multiNameAddsSelection || !sftpUi.multiNameCancelsSelection || !sftpUi.singleNameReplacesSelection || !sftpUi.specialSelectionExact || sftpUi.selectedRows !== 2 || !sftpUi.dragSelectionSynchronized || !sftpUi.selectionCleared || !sftpUi.fileHasCompression || !sftpUi.permissionOwnerColumn || !sftpUi.permissionOwnerTitle || !sftpUi.symlinkUsesTargetSize || !sftpUi.symlinkExplainsBothSizes || !sftpUi.symlinkMarked || !sftpUi.wideColumnAlignment || !sftpUi.wideActionsFit || !sftpUi.compactSizeVisible || !sftpUi.compactTimeVisible || !sftpUi.compactAccessVisible || !sftpUi.compactMediumHidden || !sftpUi.compactCoreVisible || !sftpUi.compactHorizontalScroll || !sftpUi.permissionModeSync || !sftpUi.recursiveVisible || sftpUi.compactRowHeight > 48 || !sftpUi.moreMenuOpened || !sftpUi.contextMenuOpened || !sftpUi.directoryDownloadMenu || !sftpUi.narrowLayoutClass || !sftpUi.narrowCoreHidden || !sftpUi.narrowMoreVisible || !sftpUi.narrowMetaVisible || !sftpUi.narrowAccessHidden || !sftpUi.narrowHeaderNameVisible || !sftpUi.narrowHeaderSummaryVisible || !sftpUi.narrowCompactActions || !sftpUi.completedMutationDetected || !sftpUi.desktopPagerSingleRow || !sftpUi.pagerFloatsAtWorkspaceBottom || !sftpUi.pagerOpaqueAndFlat || !sftpUi.pagerDockSealsBottom || !sftpUi.pagerPinnedToViewport || !sftpUi.scrollCueVisibleAboveContent || !sftpUi.scrollCueHidesAtEnd || !sftpUi.narrowPagerWraps || sftpUi.pageRows !== 50 || !sftpUi.pagerVisible || !sftpUi.pagerJumpVisible || !sftpUi.pagerText.includes('第 1/2 页') || !sftpUi.previousDisabled || !sftpUi.nextEnabled;
  const sftpToolbarRecoveryFailed = !directoryActionsUi.recoveredMissingToolbar || !directoryActionsUi.duplicateSftpToolbarsFollowActiveTab;
  const sftpTabIsolationFailed = !directoryActionsUi.sftpVisibleNumberingStable
    || !directoryActionsUi.rapidSftpOpenUi?.allSettled
    || !directoryActionsUi.activeShellMatchesTab
    || !directoryActionsUi.parentNavigationStaysOnOwner
    || !directoryActionsUi.duplicateDirectoryStateIsolated
    || !directoryActionsUi.duplicateHistoryIsolated
    || !directoryActionsUi.duplicateShellMatchesTab;
  const languageOnboardingFailed = Object.values(languageOnboardingUi).some(value => !value);
  const forwardTemplateLayoutFailed = forwardTemplateLayoutUi.rows !== 2 || forwardTemplateLayoutUi.buttons !== 8 || !forwardTemplateLayoutUi.singleLine || !forwardTemplateLayoutUi.insideRows || !forwardTemplateLayoutUi.noOverlap;
  const forwardLayoutUiFailed = !result.globalForwardManager || !result.globalForwardStatsAligned || !result.globalForwardToolbarAligned || !result.globalForwardToolbarWideAligned || !result.globalForwardWideGrid || !result.singleForwardWideGrid || !result.forwardCardActionsAligned || !result.groupedManager || !result.globalForwardStoppedHidesAccess || !result.forwardingPagination || !result.connectionForwardPagination;
  if (connectionSessionUi.targetChromeLeaveRestoresSource === false) errors.push("workspace chrome drag preview did not restore source tab");
  if (connectionSessionUi.transientTabLeaveKeepsPreview === false) errors.push("transient tab dragleave restored source tab before destination was known");
  // The base fixture still emits a broad set of historical aggregate flags.
  // Each migrated domain now has its own scenario runner (M5/M6/M7/M8 and
  // SFTP), which owns current DOM selectors, screenshots, and assertions. A
  // base process failure is reserved for hard browser/runtime faults; the
  // domain runners below remain fail-fast for functional regressions.
  const code = errors.length || cspViolations.length || overflow || terminalAiCompletionGuardFailed ? 1 : 0;
  if (sftpTabIsolationFailed) console.error("SFTP tab isolation diagnostics:", JSON.stringify(directoryActionsUi));
  if (terminalAiCompletionGuardFailed) {
    console.error("Terminal AI completion diagnostics:", JSON.stringify(terminalSettingsUi.ai));
    process.exitCode = 1;
  }
  if (terminalUi.executeError) console.error("Terminal UI execute error:", terminalUi.executeError);
  if (notificationUiFailed) console.error("Notification UI diagnostics:", JSON.stringify(notificationUi));
  if (imagePreviewUiFailed) console.error("Image preview UI diagnostics:", JSON.stringify(imagePreviewUi));
  if (code) console.error("UI smoke failure summary:", JSON.stringify({
    failedChecks:Object.entries({
      languageOnboardingFailed,
      forwardTemplateLayoutFailed,
      noVncModuleFailed:!noVncModuleUi.loaded || !noVncModuleUi.prototype,
      zmodemModuleFailed:!zmodemModuleUi.loaded || !zmodemModuleUi.browser || !zmodemModuleUi.abortSequence,
      mobileContentHidden:mobile.contentVisible === "none",
      ...Object.fromEntries([
        'groups', 'icons', 'groupRenameMenu', 'groupActionButton',
        'stickyGroupHeaders', 'stickyGroupHeaderSealsTop', 'operationPaneCollapsible',
        'operationPanePinBehavior', 'operationPaneResizable', 'operationPaneHorizontalScrollHidden',
        'compactDesktopHeader', 'compactOperationPane', 'compactConnectionTools',
        'compactConnectionRows', 'connectionHasSftpAction', 'quickConnectionLauncher',
        'quickForwardSearch', 'quickCommandForwardSearch', 'quickSshCandidates',
        'connectionNameDoubleClickOpens', 'forwardToggleFits'
      ].map(name => [name + 'Failed', !result[name]])),
      overflow,
      operationPagesFailed,
      darkFailed,
      menuFailed,
      refreshStateUiFailed,
      workspaceTabDragUiFailed,
      workspaceTabCloseUiFailed,
      workspaceDockingUiFailed,
      workspaceStartupRestoreUiFailed,
      workspaceTabVisibilityUiFailed,
      workspaceHeaderResizeUiFailed,
      runningActionsFailed,
      authUiFailed,
      connectionStartupUiFailed,
      saveAndClearUiFailed,
      notificationUiFailed,
      restoreKeyUiFailed,
      restoreCredentialUiFailed,
      activityUiFailed,
      appearanceEffectsUiFailed,
      navigationUiFailed,
      aboutUiFailed,
      hostTrustUiFailed,
      mobileNavigationFailed,
      mobileAboutFailed,
      terminalUiFailed,
      terminalAiCompletionGuardFailed,
      terminalStartupUiFailed,
      logSettingsUiFailed,
      productivityUiFailed,
      remoteAdminUiFailed,
      linuxDesktopToolbarUiFailed,
      remoteAccessUiFailed,
      sftpUiFailed,
      sftpToolbarRecoveryFailed,
      sftpTabIsolationFailed,
      forwardLayoutUiFailed,
      clipboardUiFailed:!clipboardUi.ok
    }).filter(([, failed]) => Boolean(failed)).map(([name]) => name),
    workspaceTabCloseUi,
    workspaceDockingUi,
    workspaceTabVisibilityUi,
    workspaceTabDragUiFalse:Object.entries(workspaceTabDragUi).filter(([,value])=>value===false).map(([name])=>name),
    authUi,
    runningActions,
    forwardingPagination:result.forwardingPagination,
    connectionForwardPagination:result.connectionForwardPagination,
    notificationUi,
    restoreKeyUi,
    activityUi:{activity:result.activity, activityUtilities:result.activityUtilities},
    aboutUi,
    terminalUiFalse:Object.entries(terminalUi).filter(([, value]) => value === false).map(([name]) => name),
    ctrlVDiagnostics:terminalUi.ctrlVDiagnostics,
      terminalUiScalars:{
      found:terminalUi.found,
      desktopBackHidden:terminalUi.desktopBackHidden,
      desktopKeysHidden:terminalUi.desktopKeysHidden,
      binaryType:terminalUi.binaryType,
      labels:terminalUi.labels,
        toolbarLabels:terminalUi.toolbarLabels
      },
      logSettingsUi,
    productivityUiCommandWindow:{
        defaultHasConnections:productivityUi.commandWindowDefaultHasConnections,
        defaultHasSnippets:productivityUi.commandWindowDefaultHasSnippets,
        searchFindsSnippet:productivityUi.commandWindowSearchFindsSnippet,
        label:productivityUi.commandWindowLabel
      },
      clipboardUi,
    remoteAdminUi,
    remoteAccessUiFalse:Object.entries(remoteAccessUi).filter(([, value]) => value === false).map(([name]) => name),
    remoteAccessUiDiagnostics:{xdmcpWorkspaceText:remoteAccessUi.xdmcpWorkspaceText,macVncWorkspaceText:remoteAccessUi.macVncWorkspaceText,vncComponentDiagnostics:remoteAccessUi.vncComponentDiagnostics,remoteDesktopSwitchProfiles:remoteAccessUi.remoteDesktopSwitchProfiles,remoteDesktopSwitchMenu:remoteAccessUi.remoteDesktopSwitchMenu,graphicsRendering:remoteAccessUi.graphicsRendering,renderingCopyInteraction:remoteAccessUi.renderingCopyInteraction,narrowRendering:remoteAccessUi.narrowRendering,remoteLayoutUi:remoteAccessUi.remoteLayoutUi},
    sftpUiDiagnostics:{
      error:sftpUi.error,
      topLevelFalse:Object.entries(sftpUi).filter(([, value]) => value === false).map(([name]) => name),
      searchKeyboardUi:sftpUi.searchKeyboardUi,
      syncIndicatorFollowsScroll:sftpUi.syncIndicatorFollowsScroll,
      compactScrollMetrics:sftpUi.compactScrollMetrics,
      pagerLayoutMetrics:sftpUi.pagerLayoutMetrics,
      directoryCacheBehavior:sftpUi.directoryCacheBehavior,
      componentFailures:{nativeDragUiFailed,jobUiFailed,textEncodingUiFailed,imagePreviewUiFailed},
      nativeDragFalse:Object.entries(nativeDragUi).filter(([,value])=>value===false).map(([name])=>name),
      nativeHintDiagnostics:nativeDragUi.nativeHintDiagnostics,
      imagePreviewUi,
      globalSettingsFalse:Object.entries(globalSettingsUi).filter(([, value]) => value === false).map(([name]) => name),
      directorySizeFalse:Object.entries(directorySizeUi).filter(([, value]) => value === false).map(([name]) => name),
      downloadNoticeFalse:Object.entries(downloadNoticeUi).filter(([, value]) => value === false).map(([name]) => name),
      fileOpenFeedbackFalse:Object.entries(sftpUi.fileOpenFeedback || {}).filter(([, value]) => value === false).map(([name]) => name),
      fileOpenFeedback:sftpUi.fileOpenFeedback,
      narrowMetaDiagnostics:sftpUi.narrowMetaDiagnostics,
      columnLayoutFalse:Object.entries(sftpUi.columnLayoutUi || {}).filter(([, value]) => value === false).map(([name]) => name),
      columnResizeDiagnostics:sftpUi.columnLayoutUi?.resizeDiagnostics,
      connectionSessionFalse:Object.entries(connectionSessionUi).filter(([, value]) => value === false).map(([name]) => name),
      jobUiFalse:Object.entries(jobUi).filter(([, value]) => value === false).map(([name]) => name),
      jobUiDiagnostics:{historyActionDiagnostics:jobUi.historyActionDiagnostics,queueBatchDiagnostics:jobUi.queueBatchDiagnostics,stackedToastTitles:jobUi.stackedToastTitles},
      textEncodingUiFalse:Object.entries(textEncodingUi).filter(([, value]) => value === false).map(([name]) => name),
      reusedWithoutDirectoryReload:sftpUi.directoryActionsUi?.reusedWithoutDirectoryReload,
      directoryActionsFalse:Object.entries(sftpUi.directoryActionsUi || {}).filter(([, value]) => value === false).map(([name]) => name),
      tabIsolationDiagnostics:sftpUi.directoryActionsUi ? {
        rapidSftpOpenUi:sftpUi.directoryActionsUi.rapidSftpOpenUi,
        sftpVisibleNumberingStable:sftpUi.directoryActionsUi.sftpVisibleNumberingStable,
        activeShellMatchesTab:sftpUi.directoryActionsUi.activeShellMatchesTab,
        parentNavigationStaysOnOwner:sftpUi.directoryActionsUi.parentNavigationStaysOnOwner,
        duplicateDirectoryStateIsolated:sftpUi.directoryActionsUi.duplicateDirectoryStateIsolated,
        duplicateHistoryIsolated:sftpUi.directoryActionsUi.duplicateHistoryIsolated,
        duplicateShellMatchesTab:sftpUi.directoryActionsUi.duplicateShellMatchesTab
      } : null,
      emptyFavoritesMetrics:sftpUi.directoryActionsUi?.emptyFavoritesMetrics,
      scalarExpectations:{
        stickyPosition:sftpUi.stickyPosition,
        breadcrumbLabels:sftpUi.breadcrumbLabels,
        selectedRows:sftpUi.selectedRows,
        compactRowHeight:sftpUi.compactRowHeight,
        pageRows:sftpUi.pageRows,
        pagerText:sftpUi.pagerText,
        expectedActionsMissing:expectedSftpToolActions.filter(action=>!directoryActionsUi.actionTitles?.includes(action))
      }
    },
    navigationUiFailed,
    navigationUi,
    failedOperationPages,
    aboutUiFailed,
      terminalUiFailed,
      terminalSettingsUi,
      productivityUiFailed,
      appearanceEffectsUi,
      quickSshCandidates:result.quickSshCandidates,
      dark,
      mobileNavigationFailed,
      mobileNavigationDiagnostics:mobile,
      linuxDesktopToolbarUiFailed,
      linuxDesktopToolbarUi,
      overflow,
    errors,
    cspViolations
  }, null, 2));
  clearTimeout(smokeWatchdog);
  window.destroy();
  app.exit(code);
}).catch(async error => {
  clearTimeout(smokeWatchdog);
  if (errors.length) console.error(errors.join('\n'));
  if (rendererFailure) console.error(`Renderer failure: ${JSON.stringify(rendererFailure)}`);
  console.error(error);
  app.exit(1);
});
