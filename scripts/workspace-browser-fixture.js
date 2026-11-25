const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Fixtures import the same compiled owners as production. These aliases exist
// only in the isolated renderer created by the UI harness.
function attachWorkspaceBrowserFixture(window) {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../frontend/dist/.vite/manifest.json'), 'utf8'));
  const urls = [...new Set(Object.values(manifest)
    .filter(entry => !entry.isEntry && entry.file.endsWith('.js'))
    .map(entry => '/about-vue-assets/' + path.basename(entry.file)))];
  assert.ok(urls.length, 'Missing compiled workspace modules');
  const ts=require('typescript-legacy');
  const terminalNamespaces={
    termaTerminalMetadata:'terminal/terminal-metadata',termaTerminalEngineView:'terminal/terminal-engine-view',
    termaTerminalPage:'terminal/terminal-page',termaTerminalInputActions:'terminal/terminal-input-actions',
    termaTerminalConnectionRuntime:'terminal/terminal-connection-runtime',termaTerminalPrompt:'terminal/terminal-prompt',
    termaTerminalQuickRegistry:'terminal/terminal-quick-registry',termaTerminalIdentity:'terminal/terminal-identity'
  };
  const namespaceExports=Object.fromEntries(Object.entries(terminalNamespaces).map(([name,relative])=>{
    const source=fs.readFileSync(path.join(__dirname,'../frontend/src/features',relative+'.ts'),'utf8');
    const tree=ts.createSourceFile(relative,source,ts.ScriptTarget.Latest,true);
    const names=tree.statements.filter(node=>node.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword))
      .flatMap(node=>ts.isFunctionDeclaration(node)&&node.name?[node.name.text]:ts.isVariableStatement(node)?
        node.declarationList.declarations.filter(value=>ts.isIdentifier(value.name)).map(value=>value.name.text):[]);
    return [name,names];
  }));
  const evaluate = window.webContents.executeJavaScript.bind(window.webContents);
  let ready = Promise.resolve(), resolveReady, rejectReady;
  window.webContents.on('did-start-loading', () => {
    ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    ready.catch(() => {});
  });
  window.webContents.on('did-finish-load', () => {
    evaluate(`(async () => {
      if (!document.getElementById('workspaceDock')) return;
      const retired = ['termaWorkspaceDockTabs', 'termaWorkspaceDockLayout', 'workspaceLayout', 'workspaceGroups', 'activeWorkspaceGroupId', 'workspaceGroupSerial',
        'termaApplicationState', 'termaWorkspaceDom', 'termaConnectionSelection', 'termaWorkspaceLanguage',
        'termaTerminalState','termaTerminalMetadata','termaTerminalLibraries','termaTerminalDisplayActions',
        'termaTerminalDrop','termaTerminalEngineView','termaTerminalPage','termaTerminalInputActions',
        'termaTerminalConnectionRuntime','termaTerminalAuthentication','termaSshCredentials','termaTerminalPrompt',
        'termaTerminalInputTarget','termaTerminalQuickRegistry','termaTerminalIdentity','termaTerminalHistory','termaTerminalTextDialogs'];
      for (const name of retired) if (name in window) throw new Error('Retired workspace bridge is still installed: ' + name);
      const modules = await Promise.all(${JSON.stringify(urls)}.map(url => import(url)));
      const owners = new Map();
      for (const current of modules) for (const name of Object.keys(current)) {
        if (owners.has(name) && owners.get(name)[name] !== current[name]) throw new Error('Ambiguous compiled fixture export: ' + name);
        owners.set(name, current);
      }
      const serviceOwners=[{"name":"sharedServices","keys":["termaNotificationEventContext","termaActionRegistry","termaEventRegistry","termaSharedApi","termaSharedApiClient","termaPublicErrors","termaWorkspaceRequest","termaApplicationLifecycle","termaBootstrapBackground","termaBootstrapRuntime","termaClipboard","termaDesktopIntegration","termaFormControls","termaI18nRuntime","termaStateRegistry","termaIcons","termaUiActions","termaUiSnapshots","termaViewport","termaWorkspaceRefresh"]},{"name":"assistantServices","keys":["termaAssistant","termaAssistantPlatformAdapter"]},{"name":"batchServices","keys":["termaBatch"]},{"name":"connectionsServices","keys":["termaConnectionBulkActions","termaConnectionController","termaConnectionCredentials","termaConnectionFormActions","termaConnectionFormWorkspace","termaConnectionGroups","termaConnectionGroupDrag","termaConnectionHealthActions","termaConnectionHealthBatch","termaConnectionList","termaConnectionMenu","termaConnectionViews","termaConnectionLocalizationReady","termaConnectionSave","termaConnectionTerminal","termaConnectionValidationActions","termaConnectionValidationService"]},{"name":"dataExchangeServices","keys":["termaExchange","termaSshConfigDiscovery"]},{"name":"efficiencyServices","keys":["termaEfficiency","termaNotificationEvents","termaNotificationPollingContext","termaNotificationPolling","termaNotificationState","termaNotificationToasts","termaSystemNotifications","termaTerminalActivity","termaTerminalBroadcast"]},{"name":"filesServices","keys":["termaBrowserFiles","termaFileDeliveryRefresh","termaFileLayouts","termaLocalFileRuntime","termaFileTransferRuntime","termaLocalFileViews","termaSftpColumns","termaSftpConnection","termaSftpDirectoryWorkspace","termaDragHandoff","termaDragPayload","termaSftpDragWorkspace","termaDroppedFiles","termaAceLocalization","termaEditorDocument","termaSftpEntryActions","termaSftpFileKind","termaSftpFilePresentation","termaFileOpen","termaSftpFileActions","termaSftpWorkflow","termaGeneratedFiles","termaSftpPage","termaSftpPreferences","termaPreviewModel","termaSftpPreviewRuntime","termaSftpRecycle","termaSftpDialogs","termaSftpTasks","termaSftpComparisonViews","termaSftpEditorViews","termaSftpGlobalSettings","termaSftpMenus","termaSftpPreviewViews","termaSftpViews","termaSvgEngine","termaSvgSource","termaTaskActions","termaSftpTaskWorkspace","termaSftpTransferLifecycle","termaSftpTransfers","termaSftpTabs","termaSftpView","termaWorkspaceTransfer"]},{"name":"forwardsServices","keys":["termaForwardWorkspace","termaForwardRuntime","termaForwardActions","termaForwardGlobal","termaForwardPages"]},{"name":"logsServices","keys":["termaLogList","termaLogMaintenance","termaLogReader"]},{"name":"operationsServices","keys":["termaRunning"]},{"name":"quickServices","keys":["termaCommandNavigation","termaNamedWorkspacePresets","termaNamedWorkspaces","termaQuickConnectActions","termaQuickConnectSearch","termaQuickForwardPresentation","termaQuickViews","termaQuickLocalizationReady","termaQuickSshService","termaQuickSshFlow"]},{"name":"remoteServices","keys":["termaRemoteClients","termaRemoteManagement","termaRemoteList","termaRemoteProfiles","termaRemoteDesktop","termaRemoteViews","termaRemoteTransport","termaVncDetached","termaVncRuntime"]},{"name":"sessionEfficiencyServices","keys":["termaSessionEfficiency","termaTerminalBroadcastWorkspace"]},{"name":"settingsServices","keys":["termaMountVueAbout","termaUnmountVueAbout","termaDesktopStorage","termaKeyWizard","termaLanguageSettings","termaManagedKeys","termaProgramCache","termaRuntimeSettingsModel","termaRuntimeReader","termaSettingsViews","termaRefreshVueSettings","termaUnmountVueSettings","termaSettingsNavigation","termaSettingsRequests","termaSettingsService","termaTrustedHosts","termaUpdateStatus","termaUpdateDownloads","termaUpdateNotice"]},{"name":"snippetsServices","keys":["termaSnippets"]},{"name":"terminalServices","keys":["termaTerminalClipboard","termaTerminalCommandTracking","termaTerminalConnection","termaTerminalControls","termaTerminalDisplayMenu","termaTerminalActionMenu","termaTerminalKeys","termaTerminalCursorCopy","termaTerminalViews","termaTerminalDirectory","termaTerminalImagePaste","termaTerminalInteraction","termaTerminalKeysService","termaTerminalOutputFlow","termaTerminalPreferences","termaTerminalSessionCore","termaTerminalSettingsModel","termaTerminalSettings","termaTerminalShortcuts","termaTerminalStartupState","termaTerminalStartup","termaTerminalSurface","termaTerminalToolbar","termaTerminalToolbarScroll","termaTerminalToolbarService","termaTerminalTransport","termaTerminalViewport","termaTerminalZmodemView","termaTerminalZmodem"]},{"name":"workspaceServices","keys":["termaWorkspaceChrome","termaWorkspaceDrag","termaWorkspaceGroups","termaWorkspaceLayout","termaWorkspaceMobile","termaWorkspacePaneScope","termaWorkspacePersistence","termaWorkspaceViews","termaWorkspaceShell","termaWorkspaceState","termaWorkspaceTabActions","termaWorkspaceTabCopy","termaWorkspaceTabRuntime","termaWorkspaceToolbar"]},{"name":"x11Services","keys":["termaX11TerminalMenu","termaX11"]}];
      for(const owner of serviceOwners)for(const name of owner.keys)if(name in window)throw new Error('Business browser bridge remains installed: '+name);
      const module = {};
      for (const name of owners.keys()) Object.defineProperty(module, name, {enumerable:true, get:() => owners.get(name)[name]});
      for(const owner of serviceOwners){
        const services=module[owner.name];
        if(!services)throw new Error('Missing compiled service owner: '+owner.name);
        for(const name of owner.keys)Object.defineProperty(window,name,{configurable:true,
          get:()=>services[name],set:value=>{services[name]=value;}
        });
      }
      window.isUiActionInFlight=(...args)=>window.termaUiActions.isInFlight(...args);
      if (!module.workspaceDockState || !module.dockTabs || !module.dockViewPort || !module.applicationState) throw new Error('Workspace fixture requires the actual compiled owners');
      window.termaApplicationState = module.applicationState;
      for(const property of ['restoringTabs','workspaceRestorePending'])Object.defineProperty(window,property,{
        configurable:true,get:()=>module.applicationState[property],set:value=>{module.applicationState[property]=value;}
      });
      window.termaWorkspaceDom = {$: module.$};
      window.termaConnectionSelection = {currentConnection:module.currentConnection,selectConnection:module.selectConnection,noteConnectionUsage:module.noteConnectionUsage};
      const language = {};
      for (const name of ['termaI18nLanguageRevision','termaDomRenderer','normalizeTermaLanguage',
        'rememberTermaRawUiPhrase','isTermaRawUiPhrase','loadTermaI18nResources','currentTermaI18nResources',
        'ensureTermaI18nResourceBundles','rebuildTermaI18nPhraseIndex','termaI18nSkipped','translatedTermaPhrase',
        'applyTermaAutomaticTranslations','tr','applyTermaTranslations','registerTermaI18nRenderer',
        'syncTermaLanguageControls','setTermaLanguage','i18nReady']) {
        if (name in module) Object.defineProperty(language,name,{enumerable:true,get:()=>module[name]});
      }
      if (!('i18nReady' in language)) Object.defineProperty(language,'i18nReady',{
        enumerable:true,get:()=>window.termaI18nRuntime.ready()
      });
      window.termaWorkspaceLanguage = language;
      // Thin helpers may be inlined by Rollup. Use their installed public service.
      const serviceActions={
        updateTerminalConnectionToggle:key=>window.termaTerminalToolbar.refresh(key),
        changeTerminalFont:(...args)=>window.termaTerminalSurface.changeFont(...args),
        enableTerminalFontWheel:(...args)=>window.termaTerminalInteraction.enableFontWheel(...args),
        pasteTerminalText:key=>window.termaTerminalClipboard.paste(key),
        toggleTerminalConnection:(...args)=>window.termaTerminalToolbarService.actions.connection(...args),
        openTerminalSessionMenu:(...args)=>window.termaSessionEfficiency.menu(...args),
        terminateTerminalPersistence:(key,options={})=>{
          const tab=module.workspaceTabByKey(key);
          return tab?window.termaSessionEfficiency.service.terminate(tab,options):Promise.resolve(false);
        },
        showTerminalContextMenu:(event,key,id)=>window.termaTerminalInteraction.mouse(
          'context_menu',event,module.terminalSessions.get(key),key,id),
        terminalViewForKey:(key='')=>{
          const scope=window.termaWorkspacePaneScope,pane=module.workspaceFindPaneForTab(key);
          return (pane?scope.workspacePaneElement(pane.id):scope.currentWorkspaceDomScope())
            ?.querySelector('#view-terminal')||document.getElementById('view-terminal');
        }
      };
      const requireExport=name=>{
        if(name in serviceActions)return serviceActions[name];
        if (!(name in module)) throw new Error('Missing compiled owner export: '+name);
        return module[name];
      };
      const hostTrustDialog=requireExport('createSshHostTrustDialogService')({
        mount:values=>requireExport('openSettingsDialog')('host-trust',values),
        close:()=>{
          const modal=document.getElementById('modal');
          if(modal?.dataset.termaSettingsDialog!=='host-trust')return;
          requireExport('unmountSettingsDialog')();modal.hidden=true;
        }
      });
      window.termaWorkspaceRequestPort={
        get fetch(){return window.fetch.bind(window);},
        set fetch(value){window.fetch=value;},
        confirmHost:hostTrustDialog.open
      };
      for(const name of ['chooseModal','inputModal','confirmModal','openTerminal','sendTerminalData','focusTerminalSession','sftpTabRuntimes']) {
        window[name]=requireExport(name);
      }
      for(const name of Object.keys(module)) {
        if(name!=='api' && typeof module[name]==='function' && !(name in window))window[name]=module[name];
      }
      for(const [alias,owner,field]of [['notify','termaNotificationToasts','notify'],
        ['copyText','termaClipboard','copy'],['writeClipboardText','termaClipboard','write']]) {
        const services=owner==='termaClipboard'?module.sharedServices:module.efficiencyServices;
        Object.defineProperty(window,alias,{configurable:true,get:()=>services[owner][field],set:value=>{services[owner][field]=value;}});
      }
      window.closeModal=requireExport('closeWorkspaceModal');
      for(const [name,fields]of Object.entries(${JSON.stringify(namespaceExports)})){
        const owner={};
        for(const field of fields)Object.defineProperty(owner,field,{enumerable:true,get:()=>requireExport(field)});
        window[name]=owner;
      }
      window.termaTerminalState={terminalSessions:requireExport('terminalSessions'),terminalSurfaceCache:requireExport('terminalSurfaceCache'),terminalCounts:requireExport('terminalCounts')};
      for(const [name,field]of Object.entries({termaTerminalLibraries:'terminalLibraries',
        termaTerminalDrop:'terminalDrop',termaTerminalAuthentication:'terminalAuthentication',termaSshCredentials:'sshCredentialRuntime',termaTerminalHistory:'terminalHistory'})){
        Object.defineProperty(window,name,{configurable:true,get:()=>requireExport(field)});
      }
      window.termaTerminalInputTarget={capture:(...args)=>requireExport('captureTerminalSessionInput')(...args)};
      window.termaTerminalTextDialogs={
        recent:key=>window.termaTerminalToolbarService.actions.recent(key),
        session:key=>{
          const session=module.terminalSessions.get(key);
          if(!session)throw new Error('Missing fixture terminal session');
          serviceActions.showTerminalContextMenu(new MouseEvent('contextmenu',{clientX:32,clientY:32}),key,session.id);
          const action=[...document.querySelectorAll('#actionMenu button')]
            .find(button=>button.textContent.trim()===module.tr('terminal:context_menu.session_copy'));
          if(!action)throw new Error('Missing actual terminal session-copy action');
          action.click();
        }
      };
      for (const property of Object.keys(module.workspaceDockState)) {
        if (property === 'focusedPaneId') continue;
        Object.defineProperty(window, property, {configurable:true,
          get:() => module.workspaceDockState[property], set:value => {module.workspaceDockState[property] = value;}
        });
      }
      const names = [
        'WORKSPACE_GROUP_MAIN_ID', 'WORKSPACE_MIN_SPLIT_RATIO', 'WORKSPACE_MAX_SPLIT_RATIO',
        'WORKSPACE_MAX_RESTORE_DEPTH', 'WORKSPACE_MAX_RESTORE_NODES', 'workspacePaneNodes',
        'workspaceLeaves', 'workspaceFindSplit', 'workspaceNextPaneId', 'workspaceNextSplitId',
        'workspaceVisiblePanes', 'workspaceDockElement', 'workspacePaneHistoryService',
        'renderTabs', 'saveFocusedSftpPaneState', 'focusWorkspacePane', 'syncFocusedWorkspaceClasses',
        'workspaceReplacePaneWithSplit', 'normalizeWorkspaceLayoutAfterMutation', 'setPaneActiveKey',
        'addTab', 'renderWorkspacePaneContent', 'closeTabsByKey', 'moveWorkspaceTab'
      ];
      for (const name of names) {
        if (!(name in module)) throw new Error('Missing compiled fixture export: ' + name);
        window[name] = module[name];
      }
      window.termaWorkspaceDockTabs = module.dockTabs;
      window.termaWorkspaceDockLayout = {port:module.dockViewPort};
      window.syncResponsivePane = () => window.dispatchEvent(new Event('resize'));
    })()`).then(resolveReady, rejectReady);
  });
  window.webContents.executeJavaScript = async (...args) => {
    await ready;
    return evaluate(...args);
  };
}

module.exports = {attachWorkspaceBrowserFixture};
