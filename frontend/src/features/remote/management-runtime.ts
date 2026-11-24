import {sharedServices} from '@/shared/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {nextTerminalTabIndex,openTerminal} from '@/features/terminal/terminal-page';
import { terminalStartupOverrides } from '@/features/terminal/terminal-startup-state';
import {forwardDialog} from '../forwards/ForwardForms';
import type {RemoteManagementSshDraft} from '../connections/connection-form-service';
import {createAdminService} from './admin-service';
import {createManagementService} from './management-service';
import {createResourceProbe} from './resource-probe';
import {createDesktopService,type DesktopTask} from './desktop-service';
import {createDesktopLogView} from './desktop-log-view';
import {createProtocolService} from './protocol-service';
import {createRemoteManagementModelService,type RemoteManagementModelPort} from './remote-management-model-service';
import {createRemoteInstallGuideService,type RemoteGuideProtocol,type RemoteInstallGuidePort} from './install-guide-service';
import {createRemoteComponentTaskService} from './component-task-service';
import type {RemoteProfile} from './profile-model';
import {createGraphicsRenderingModel} from './graphics-rendering-model';
import {desktopLabel,linuxDesktopModel} from './linux-desktop-model';
import {rdpInstallPlan, vncServerReady, xdmcpInstallAction, xdmcpInstallPlan, xdmcpManagerLabel, xdmcpServerAction, xdmcpWarning} from './management-diagnostics';
import {createRemoteDiagnosticsView} from './remote-diagnostics-view';
import {createRemoteProtocolView} from './remote-protocol-view';
import {type RemoteManagementTaskNavigation, createRemoteComponentTaskPort, linuxDesktopActionKey, managementAction, remoteServerActionKey,
  remoteWorkspaceQuery, setRemoteComponentTaskHost, syncRemoteAction} from './management-ui-runtime';
import {x11RemoteActionKey} from '../x11/remote-service';
import {remoteManagementHost} from './remote-host';
type ModelPort = Omit<RemoteManagementModelPort, 'installModel' | 'protocolGuide' | 'renderingModel' | 'xdmcpConfigure'> & RemoteInstallGuidePort;

export function installRemoteManagement(seedSsh: (draft: RemoteManagementSshDraft) => boolean, taskCenter: RemoteManagementTaskNavigation){
 let feature:ReturnType<typeof create>|undefined;
 function create(){
  const port = {...remoteManagementHost, seedSsh};
  const actions = sharedServices.termaUiActions;
  const management = createManagementService(port);
  const modelPort: ModelPort = {
    tr: port.tr, connection: port.connection,
    authenticationFailure: error => connectionsServices.termaConnectionCredentials?.authenticationFailure(error) ?? false,
    endpoint: remoteServices.termaRemoteProfiles.presentation.endpoint,
    vncSaveSource: (...args) => remoteServices.termaVncRuntime.management.saveSourceSelection(...args),
    vncSession: key => remoteServices.termaVncRuntime.session.sessions.get(key),
    vncServerAction: (...args) => remoteServices.termaVncRuntime.management.operate(...args),
    vncInstallServer: (...args) => remoteServices.termaVncRuntime.management.install(...args),
    vncReconnect: (...args) => remoteServices.termaVncRuntime.session.reconnect(...args),
    vncOpenEmbedded: (...args) => remoteServices.termaVncRuntime.session.open(...args),
    launchDesktop: (id, key, button) => remoteServices.termaRemoteClients.launch(id, key, button),
    editProfile: id => remoteServices.termaRemoteProfiles.editor.edit(id, true),
    safeTaskText: (value, fallback) => tasks.safeText(value, fallback),
    localizeTaskText: value => tasks.localize(value),
    openLinuxDesktop: id => desktop.open(id),
    vncSessionKey: id => remoteServices.termaVncRuntime.session.keyForProfile(id),
    desktopLabel: id => desktopLabel(id, port.tr),
    installDesktop: (id, mode, button) => desktop.install(id, mode, button),
    action: managementAction, actionInFlight: actions.isInFlight, desktopActionKey: linuxDesktopActionKey,
    rdpActionKey: (id: number) => remoteServerActionKey(id, 'rdp'),
    xdmcpActionKey: (id: number) => remoteServerActionKey(id, 'xdmcp'),
    vncActionKey: (id: number) => remoteServerActionKey(id, 'vnc'),
    copy: (text: string) => sharedServices.termaClipboard.copy(text),
    notify: port.notify,
    managementConnectionId: management.connectionId,
    newManagementConnection: management.seed,
    repairManagementCredentials: (id: number, kind: string) => management.repairCredentials(id,kind,{
      repair: port.repairCredentials,
      invalidate: () => probe.invalidate(),
      refresh: (profileId, protocolKind) => protocolKind === 'vnc' ? remoteServices.termaVncRuntime.management.inspect(profileId) : protocol.inspect(profileId,protocolKind)
    }),
    linuxDesktop: (id: number) => desktop.open(management.connectionId(port.profile(id))),
    rdpInstallPlan, vncServerReady, xdmcpInstallAction, xdmcpInstallPlan,
    rdpInstallServer: (id: number, key: string, button: HTMLElement, mode: string) =>
      protocol.operate(id, 'rdp', 'install', mode, button, key),
    rdpServerAction: (id: number, key: string, action: string, button: HTMLElement) =>
      protocol.operate(id, 'rdp', action, 'online', button, key),
    xdmcpConfigure: (id, action, button, mode = 'online') =>
      protocol.operate(id, 'xdmcp', action, mode, button),
    rdpSetupGuide: (id: number) => setupGuide(id, 'rdp'),
    xdmcpInstallOptions: (id: number, action: string) => setupGuide(id, 'xdmcp', action),
    vncSetupGuide: (id: number) => setupGuide(id, 'vnc'),
    xdmcpSetupTerminal: openSetupTerminal,
    vncTemporaryPassword: (id: number, key: string, button: HTMLElement, mode: string) =>
      remoteServices.termaVncRuntime.management.launchWithTemporaryPassword(id, key, button, mode),
    xdmcpManagerLabel: d => xdmcpManagerLabel(d, port.tr),
    xdmcpAction: d => xdmcpServerAction(d, port.tr),
    xdmcpWarning: d => xdmcpWarning(d, port.tr)
  };
  const admin = createAdminService(port);
  const guides = createRemoteInstallGuideService(modelPort);
  const graphics = createGraphicsRenderingModel({
    tr: modelPort.tr,
    write: command => sharedServices.termaClipboard.write(command),
    busy: actions.setButtonBusy,
    notify: port.notify
  });
  const models = createRemoteManagementModelService({
    ...modelPort,
    installModel: guides.install,
    protocolGuide: guides.protocolGuide,
    renderingModel: diagnostics => graphics(diagnostics.graphics_rendering)
  });
  const probe = createResourceProbe(port);
  const question = forwardDialog(port);
  const log = createDesktopLogView();
  const desktop=createDesktopService({...port,probe:probe.desktop,authorize:admin.request,resetLog:log.reset,
    begin:(id,button,label)=>actions.begin(linuxDesktopActionKey(id),button,label),
    end:(id,button)=>actions.end(linuxDesktopActionKey(id),button),
    jobs:()=>{void taskCenter.refresh();},
    label:id=>desktopLabel(id,port.tr),options:openDesktopOptions,
    paint:()=>{if(port.desktopVisible())paintDesktop();},
    paintTask:task=>{const view=port.desktopVisible() && port.desktopView();if(view)paintDesktopTask(view,task);}
  },question.ask);
  const tasks=createRemoteComponentTaskService(createRemoteComponentTaskPort(port.tr, port.notify, taskCenter));
  const diagnostics = createRemoteDiagnosticsView({
    ...port.diagnostics, tr: port.tr, profile: port.profile, authenticationFailure: modelPort.authenticationFailure,
    actionKey:remoteServerActionKey, syncActions:syncRemoteAction, taskHost:setRemoteComponentTaskHost, query:remoteWorkspaceQuery,
    model: (...args) => models.state(...args),
    paint: (container, options) => remoteServices.termaRemoteViews?.renderManagement(container, options)
  });
  const capture = createRemoteProtocolView({
    ...port.protocol, scope: remoteServices.termaRemoteDesktop.scope, diagnostics, tasks, tr: port.tr,
    paint: (container, options) => remoteServices.termaRemoteViews?.renderManagement(container, options),
    taskHost: setRemoteComponentTaskHost
  });
  const protocol = createProtocolService({...port, ...port.protocol, capture,
    busy:(button,value,label)=>{if(button?.isConnected)actions.setButtonBusy(button,value,label);},
    begin:(id,kind,button,label)=>actions.begin(remoteServerActionKey(id,kind),button,label),
    end:(id,kind,button)=>actions.end(remoteServerActionKey(id,kind),button),
    connectionId: management.connectionId, authorize: admin.request}, question.ask);
  return {port,modelPort,admin,management,models,guides,tasks,probe,desktop,log,protocol,diagnostics,capture};
 }
 const current=()=>feature||=create();
 function paintDesktop() {
   const {port,modelPort,desktop,log} = current();
   const view = port.desktopView(), views = remoteServices.termaRemoteViews;
   if (!view || !views) return;
   const {task,connectionId} = desktop.state;
   if (task) log.capture(view.querySelector<HTMLElement>('#linuxDesktopTaskLog'));
   views.renderLinuxDesktop(view,linuxDesktopModel({
     ...port, action:modelPort.action, desktopActionKey:modelPort.desktopActionKey,
     actionInFlight:modelPort.actionInFlight, authenticationFailure:modelPort.authenticationFailure, repair:repairDesktop
   },desktop));
   syncRemoteAction(linuxDesktopActionKey(connectionId));
   syncRemoteAction(x11RemoteActionKey('forwarding',connectionId));
   if (task) paintDesktopTask(view,task);
 }
 function repairDesktop(id: number) {
   const {port,desktop,probe} = current();
   const active = port.scope();
   if (id < 1 || desktop.state.connectionId !== id) return false;
   return port.repairCredentials(id, {
     context:port.tr('common:notifications.exact.linux_desktop_probe_failed'),
     onSaved:async () => {
       probe.invalidate();
       if (active() && desktop.state.connectionId === id) await desktop.load();
     }
   });
 }
 function openDesktopOptions(id: string) {
   const {port,modelPort,desktop,guides} = current();
   const {connectionId,diagnostics} = desktop.state;
   if (!diagnostics?.desktop_install_plans?.[id]) return port.notify(port.tr('remote:linux_desktop.no_install_plan'),'info');
   const active = port.scope();
   const valid = () => active() && desktop.state.connectionId === connectionId && desktop.state.diagnostics === diagnostics;
   const views = remoteServices.termaRemoteViews;
   if (!views) return;
   const close = () => views.releaseDialog();
   views.showManagement({close,model:()=>guides.desktop(id,connectionId,diagnostics,valid,close)});
 }
 function paintDesktopTask(view: HTMLElement, task: DesktopTask) {
   const container = view.querySelector<HTMLElement>('#linuxDesktopInstallTask');
   const views = remoteServices.termaRemoteViews;
   if (!container || !views) return;
   const {log, tasks} = current();
   const logNode = () => container.querySelector<HTMLElement>('#linuxDesktopTaskLog');
   log.capture(logNode());
   views.renderLinuxTask(container, tasks.desktopModel(task, log.ensure(task), () => log.toggle(logNode())));
   log.restore(logNode(), task);
 }
 function setupGuide(id: number, kind: RemoteGuideProtocol, action = '') {
   const {port, management, guides} = current();
   const profile = port.profile(id);
   if (!profile || profile.protocol !== kind) return false;
   if (management.connectionId(profile)) return openGuide(id, kind, action);
   const views = remoteServices.termaRemoteViews;
   if (!views) return false;
   return guides.standalone(profile, kind, {
     show: options => views.showSetupGuide(options),
     close: () => views.releaseDialog(),
     manage: () => { if (port.profile(id)?.protocol === kind) management.seed(id); }
   });
 }
 function openSetupTerminal(id: number, command: string) {
   const {port} = current();
   const connection = port.connection(id);
   if (!connection) return port.notify(port.tr('remote:xdmcp_setup.ssh_management_missing'), 'error');
   if (!command.trim()) return port.notify(port.tr('remote:xdmcp_setup.no_auto_command'), 'info');
   const key = `terminal-${id}-${nextTerminalTabIndex(id)}`;
   const completionMessage = port.tr('remote:xdmcp_setup.shell_install_complete');
   const quotedMessage = `'${completionMessage.replace(/'/g, `'"'"'`)}'`;
   const startupCommand = `${command.trim()}; printf '\\n\\n%s\\n' ${quotedMessage}; exec "\${SHELL:-/bin/sh}"`;
   terminalStartupOverrides.set(key, {
     terminal_startup_mode: 'program',
     terminal_profile_name: port.tr('remote:xdmcp_setup.dependency_install'),
     terminal_profile_kind: 'tool',
     terminal_program_path: '/bin/sh',
     terminal_program_args: `-lc ${JSON.stringify(startupCommand)}`,
     terminal_working_directory: '',
     terminal_program_platform: 'posix',
     x11_mode: connection.x11_mode === 'trusted' ? 'trusted' : 'untrusted'
   });
   remoteServices.termaRemoteViews?.releaseDialog();
   openTerminal(id, true, key, port.tr('remote:xdmcp_setup.terminal_title', {name: connection.name}));
 }
 async function openGuide(id: number, kind: RemoteGuideProtocol, action: string) {
   const {port, modelPort, guides, protocol} = current();
   const profile = port.profile(id);
   const views = remoteServices.termaRemoteViews;
   if (!profile || profile.protocol !== kind || !views) return null;
   return guides.open(profile, kind, action, {
     show: options => views.showManagement(options),
     close: () => views.releaseDialog(),
     refresh: () => views.refreshManagement(),
     syncActions: syncRemoteAction,
     read: () => kind === 'vnc' ? remoteServices.termaVncRuntime.management.read(id) : protocol.read(id, kind),
     authenticationFailure: error => modelPort.authenticationFailure(error),
     repair: () => modelPort.repairManagementCredentials(id, kind)
   });
 }
 remoteServices.termaRemoteManagement={openGuide,setupGuide,vncServerReady,captureView:(...args)=>current().capture(...args),get diagnostics(){return current().diagnostics;},paintDesktop,paintDesktopTask,desktopLabel:id=>desktopLabel(id,current().port.tr),connectionId:profile=>current().management.connectionId(profile),seed:id=>current().management.seed(id),link:(id,connectionId,source)=>current().management.link(id,connectionId,source),authorize:(id,label,scope,valid)=>current().admin.request(id,label,scope,valid),inspectLinux:async profile=>{const id=current().management.connectionId(profile);if(!id)return null;try{return await current().probe.read(id,'linux-desktop');}catch{return null;}},invalidateProbe:()=>current().probe.invalidate(),get models(){return current().models;},get guides(){return current().guides;},get tasks(){return current().tasks;},get desktop(){return current().desktop;},get log(){return current().log;},get protocol(){return current().protocol;}};
 window.addEventListener('terma:language-changed',()=>{
   if(feature?.port.desktopView()?.querySelector('[data-linux-desktop-owned]'))paintDesktop();
 });
 window.addEventListener('beforeunload',()=>{feature?.tasks.dispose();feature?.protocol.dispose();feature?.desktop.dispose();feature?.admin.clear();});
}


export interface InstalledFeaturesRemoteManagementRuntimeServices {
  termaRemoteManagement:{vncServerReady:typeof vncServerReady;captureView:ReturnType<typeof createRemoteProtocolView>;readonly diagnostics:ReturnType<typeof createRemoteDiagnosticsView>;openGuide(id:number,protocol:RemoteGuideProtocol,action:string):Promise<unknown>;setupGuide(id:number,protocol:RemoteGuideProtocol,action?:string):boolean|Promise<unknown>;paintDesktop():void;paintDesktopTask(view:HTMLElement,task:DesktopTask):void;desktopLabel(id:string):string;connectionId(profile:RemoteProfile|undefined):number;seed(id:number):boolean;link(id:number,connectionId:number,source?:{ssh_host:string}):Promise<boolean>;authorize(id:number,label:string,scope:string,valid?:()=>boolean):Promise<{admin_grant_id:string}|null>;inspectLinux(profile:RemoteProfile):Promise<unknown>;invalidateProbe():void;readonly models:ReturnType<typeof createRemoteManagementModelService>;readonly guides:ReturnType<typeof createRemoteInstallGuideService>;readonly tasks:ReturnType<typeof createRemoteComponentTaskService>;readonly desktop:ReturnType<typeof createDesktopService>;readonly log:ReturnType<typeof createDesktopLogView>;readonly protocol:ReturnType<typeof createProtocolService>};
}
