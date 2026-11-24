import {remoteServices} from '@/features/remote/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {forwardDialog} from '../forwards/ForwardForms';
import {createVncSessionService} from './vnc-session-service';
import type {VncCredentials, VncRfb, VncSession, VncSessionPort} from './vnc-types';
import {createVncFullscreen} from './vnc-fullscreen';
import {createVncClipboardService} from './vnc-clipboard-service';
import {captureVncHandoffScope, createVncWindowService, vncWindowEnvironment} from './vnc-window-service';
import {createVncManagementService,vncServerEndpoint} from './vnc-management-service';
import {createVncLocalClipboard} from './vnc-local-clipboard';
import {createVncClipboardModel} from './vnc-clipboard-model';
import {createVncClipboardImages, type VncClipboardImageHost} from './vnc-clipboard-images';
import {createVncClipboardText} from './vnc-clipboard-text';
import {createVncClipboardPolling} from './vnc-clipboard-polling';
import {createVncClipboardToolbar} from './vnc-clipboard-toolbar';
import {createVncClipboardHelper} from './vnc-clipboard-helper';
import {applyVncDisplay, createVncPresentation, hasActiveVncRendering} from './vnc-presentation';
import {createVncWorkspace} from './vnc-workspace';
import {createVncCredentialPrompt, vncServerPublicKeyFingerprint} from './vnc-credentials';
import {updateRemoteVncFullscreenControl} from './RemoteDesktopViews';
import {managementAction, remoteServerActionKey, syncRemoteAction} from './management-ui-runtime';
import type {RemoteProfile} from './profile-model';
import {remoteManagementHost as host, openRemoteActionMenu} from './remote-host';

type NoVncClient = VncRfb & EventTarget & {
  _fail?: (details?: string) => unknown;
  __termaFailureEventPatched?: boolean;
};
type NoVncClass = {
  new(screen: HTMLElement, url: string, options: { shared: boolean; credentials?: VncCredentials }): NoVncClient;
  prototype: NoVncClient;
};

function patchNoVncFailureEvents(Rfb: NoVncClass) {
  const originalFail = Rfb.prototype?._fail;
  if (typeof originalFail !== 'function' || Rfb.prototype.__termaFailureEventPatched) return Rfb;
  Rfb.prototype._fail = function (details) {
    try {
      this.dispatchEvent(new CustomEvent('termafailure', {detail:{reason:String(details || '')}}));
    } catch {
      // The optional diagnostic event must allow the vendor to close the connection.
    }
    return originalFail.call(this, details);
  };
  Object.defineProperty(Rfb.prototype, '__termaFailureEventPatched', {value:true});
  return Rfb;
}

export function installVncRuntime(){
 let feature:ReturnType<typeof create>|undefined;
 const detached = () => Boolean(remoteServices.termaVncDetached);
 const endpoint: VncSessionPort['endpoint'] = profile => remoteServices.termaRemoteProfiles.presentation.endpoint(profile);
 const port = {
   tr: host.tr,
   localize: (value: unknown) => remoteServices.termaRemoteManagement.tasks.localize(value),
   desktop: () => window.termaDesktop as ReturnType<Parameters<typeof createVncLocalClipboard>[0]['desktop']>,
   activeWorkspace: (workspace: HTMLElement, key: string) => remoteServices.termaRemoteDesktop.scope.activeWorkspace(workspace, key)
 };
 const promptCredentials = createVncCredentialPrompt({
   tr: port.tr, notify: (message, kind) => efficiencyServices.termaNotificationToasts?.notify(message, kind),
   show: (state, owner) => remoteServices.termaRemoteViews?.promptVncCredentials(state, owner) ?? Promise.resolve(null),
   refresh: state => remoteServices.termaRemoteViews?.refreshVncCredentials(state)
 });
 const localClipboard = createVncLocalClipboard({ ...port, browser: () => navigator.clipboard,
   writeManualText: text => sharedServices.termaClipboard.write(text) });
 const clipboardModel = createVncClipboardModel({...port, bridgeCandidate: owner => current().helper.candidate(owner)});
 const toolbar = createVncClipboardToolbar(clipboardModel, document, port.activeWorkspace);
 let noVncRfbPromise: Promise<NoVncClass> | undefined;
 const noVncModulePath = '/vendor/novnc/core/rfb.js';
 const loadRfb = () => noVncRfbPromise ??= import(/* @vite-ignore */ noVncModulePath)
   .then(module => patchNoVncFailureEvents(module.default));
 function create(){
   const actions = sharedServices.termaUiActions, desktop = remoteServices.termaRemoteDesktop;
   const remote = remoteServices.termaRemoteManagement;
   const actionKey = (id: number) => remoteServerActionKey(id, 'vnc');
   const showManagement = (id: number) => desktop.open(id,false,true);
   const busy: VncSessionPort['busy'] = (button,value,label) => {
     if (button?.isConnected) actions.setButtonBusy(button,value,label);
   };
   const platform = (profile: RemoteProfile) => {
     const source = host.connection(Number(profile.options?.source_ssh_connection_id || profile.options?.ssh_connection_id || 0));
     return ['macos','darwin'].includes(String(source?.terminal_program_platform || '').toLowerCase()) ? 'macos' : '';
   };
   const sessionHost = {...host, activeView: desktop.activeView, icons: host.diagnostics.icons,
     afterHelp: (id: number) => syncRemoteAction(actionKey(id)),
     tabStatus: desktop.scope.markStatus, showMenu: openRemoteActionMenu,
     showManagement, busy, platform};
   const session = createVncSessionService({...sessionHost, controls: toolbar.controls, focus: toolbar.focus,
     screen: () => Object.assign(document.createElement('div'), {className:'vnc-screen'}),
     load: async () => {
       const RFB = await remoteServices.termaVncRuntime.loadRfb();
       return (owner, credentials) => {
         const url = new URL('/ws/vnc', location.href);
         url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
         url.searchParams.set('id', String(owner.profile.id));
         return new RFB(owner.screen, url.href, {shared:owner.profile.options?.shared !== false, credentials});
       };
     },
     endpoint,
     background: () => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#1e1e1e',
     readDiagnostics: id => sessionHost.api(vncServerEndpoint(id)) as ReturnType<VncSessionPort['readDiagnostics']>,
     prepareEmbedded: id => windows.embedded(id), closeFullscreen: key => fullscreen.close(key),
     confirm: (message, title, accept) => remoteServices.termaVncRuntime.confirm(message, title, accept),
     fallbackAvailable: async () => Boolean((await remoteServices.termaRemoteClients.diagnostics().catch(() => null))?.vnc?.available),
     fallback: (id, key) => remoteServices.termaRemoteClients.launch(id, key, null, 'system'),
     prompt: promptCredentials, fingerprint: vncServerPublicKeyFingerprint,
     cancelPrompt: owner => remoteServices.termaRemoteViews?.cancelVncCredentials(owner),
     render: (owner, _diagnostics, view, detached) => workspace.render(owner, view || undefined, detached),
     help: (owner, hidden) => {if (hidden) workspace.hideHelp(owner);},
     showHelp: (...args) => workspace.showHelp(...args),
     cursor: owner => presentation.cursor(owner), display: applyVncDisplay,
     paintStatus: (owner, text, state) => presentation.paintStatus(owner, text, state),
     scope: (id,key) => remoteServices.termaRemoteDesktop.captureVncOpen(id,key),
     readDesktop: profile => remoteServices.termaRemoteManagement.inspectLinux(profile) as ReturnType<VncSessionPort['readDesktop']>,
     save: (profile, password) => management.save(profile, password),
     clearClipboard: owner => {resetTransport(owner);clipboard.invalidate(owner);},
     startClipboard: owner => polling.start(owner), stopClipboard: owner => polling.stop(owner),
     clipboard: (owner, rfb, value) => text.event(owner, rfb, value),
     release: owner => {helper.release(owner);toolbar.release(owner);workspace.release(owner);}});
   const currentSession = session.current;
   const findSession = (key: string) => session.sessions.get(key);
   const candidate = (owner: Parameters<typeof currentSession>[0]): boolean => helper.candidate(owner);
   const feedback = {tr: host.tr, notify: host.notify, status: toolbar.status};
   const text = createVncClipboardText({...feedback, api: host.api, localize: port.localize, candidate,
     ...toolbar, current: currentSession, local: localClipboard, now: Date.now,
     stop: owner => polling.stop(owner), observe: (owner, snapshot) => images.observe(owner, snapshot)});
   const images = createVncClipboardImages({...feedback, api: host.api as VncClipboardImageHost['api'], visible: toolbar.visible,
     local: localClipboard, session: findSession,
     current: currentSession, transport: text.transport, unavailable: text.unavailable});
   const polling = createVncClipboardPolling({text, images, sessions: () => session.sessions.values(),
     interval: host.backgroundInterval, now: Date.now});
   const resetTransport = (owner: Parameters<typeof text.reset>[0]) => {text.reset(owner);images.reset(owner);};
   const clipboard = createVncClipboardService({...feedback, session: findSession, current: currentSession,
     focus: toolbar.focus, prompt: (owner, reason) => helper.promptText(owner, reason),
     unavailable: text.unavailable, bridge: candidate, sendText: text.send, poll: text.poll,
     start: polling.start, stop: polling.stop, readText: localClipboard.readText, writeText: localClipboard.writeText,
     readSnapshot: localClipboard.readSnapshot, sendImage: images.sendBytes});
   const fullscreen=createVncFullscreen({sessions: () => session.sessions, mode: () => host.setting('vnc_fullscreen_toolbar'),
     label: (owner, active, text) => updateRemoteVncFullscreenControl(owner.workspace, active, text),
     display: applyVncDisplay, focus: toolbar.focus, notify: sessionHost.notify, tr: sessionHost.tr});
   const windows=createVncWindowService({...host, ...vncWindowEnvironment(window), detached,
     disconnected: key => desktop.scope.markStatus(key, 'disconnected'),
     showManagement,
     closeSession: key => {session.close(key);remoteServices.termaRemoteTransport?.close(key);},
     closeTab: desktop.scope.closeTab,
     mountDetached: (profile, key) => {
       const root = remoteServices.termaRemoteViews?.detachedVncRoot();
       if (!root) return;
       desktop.scope.selectTab(key);
       session.mount(profile, key, null, root, true);
     },
     scope: (id, key) => captureVncHandoffScope(session.sessions, id, host.protocol.tabLifetime(key)),
     sessions: () => [...session.sessions.values()].map(owner => ({key: owner.key, profileId: Number(owner.profile.id)})),
     refreshDetached: (_profile, key) => {
       const target = document.getElementById('vncDetachedRoot'), owner = findSession(key);
       if (owner && target) workspace.render(owner, target, true);
     }});
   const question=forwardDialog(host);
   const management=createVncManagementService({...host,prompt:promptCredentials,
     connectionId:remote.connectionId, authorize:remote.authorize, busy,
     begin: (id,button,label) => actions.begin(actionKey(id),button,label),
     end: (id,button) => actions.end(actionKey(id),button),
     replace: (profile,updated) => host.replaceStoredProfile(Number(profile.id),updated),
     hasPassword: (profile,value) => {
       profile.has_password=value;
       const saved=host.profile(Number(profile.id));
       if(saved)saved.has_password=value;
     },
     capture: (id, key, target) => remote.captureView(id, 'vnc', key, target, workspace.managementViewer),
     launch:(...args)=>remoteServices.termaRemoteClients.launch(...args)},question.ask);
   const presentation=createVncPresentation({tr: sessionHost.tr, notify: sessionHost.notify,
     session: findSession, saveCursor: management.cursor, tabStatus: sessionHost.tabStatus, showMenu: sessionHost.showMenu});
   const t = (key: string, params?: Record<string, unknown>) => host.tr(`remote:clipboard.${key}`, params);
   const helper = createVncClipboardHelper({...host, ...toolbar, session: findSession, current: currentSession,
     localize:port.localize, authenticationFailure:error => connectionsServices.termaConnectionCredentials?.authenticationFailure(error) ?? false, action:managementAction,
     begin:actions.begin, end:actions.end,
     repair:(id,context,saved)=>host.repairCredentials(id,{context,onSaved:async () => {await saved();}}),
     prompt: options => remoteServices.termaRemoteViews?.promptClipboardHelper(options) ?? Promise.resolve(null),
     refresh: options => remoteServices.termaRemoteViews?.refreshClipboardHelper(options),
     finish: (options, value) => remoteServices.termaRemoteViews?.finishClipboardHelper(options, value),
     promptText: options => remoteServices.termaRemoteViews?.promptClipboardText(options) ?? Promise.resolve(null),
     guides: () => remoteServices.termaRemoteManagement.guides,
     confirm: async packageLabel => await question.ask({title: () => t('uninstall_helper_action'),
       message: () => t('confirm_uninstall', {package:packageLabel}),
       choices: [{value:'yes', label:() => t('uninstall'), danger:true}, {value:'', label:() => t('cancel')}]}) === 'yes',
     authorize: (...args) => remoteServices.termaRemoteManagement.authorize(...args),
     taskRequested: (...args) => remoteServices.termaRemoteManagement.tasks.requested(...args),
     watch: task => remoteServices.termaRemoteManagement.tasks.watch(task),
     taskError: task => remoteServices.termaRemoteManagement.tasks.errorLabel(task),
     reset: resetTransport, transport: text.transport, send: text.send, start: polling.start, stop: polling.stop});
   const workspace = createVncWorkspace({...sessionHost, endpoint, detached, presentation, clipboard:clipboardModel.presentation,
     controls:toolbar.controls, display:applyVncDisplay, session:findSession,
     jumpActions: profile => remoteServices.termaRemoteDesktop.relations.workspaceActions(profile),
     renderView: (target, options) => remoteServices.termaRemoteViews?.renderVncWorkspace(target, options),
     releaseView: target => remoteServices.termaRemoteViews?.release(target),
     presentDiagnostics: (...args) => remoteServices.termaRemoteManagement.diagnostics.present(...args),
     actions: (owner, detached, guard) => {
       const {profile, key} = owner, id = Number(profile.id);
       return {back:guard(() => session.management(id,key)), clipboardHelper:guard(() => helper.configure(key)),
         clipboardSync:guard(() => clipboard.operate(key,'sync')), clipboardSend:guard(() => clipboard.operate(key,'send')),
         clipboardSendImage:guard(() => images.send(key,true)), clipboardReceive:guard(() => clipboard.operate(key,'receive')),
         clipboardReceiveImage:guard(() => images.receive(key,true)), cursorMode:guard(event => presentation.menu(event,key)),
         fullscreen:guard(() => fullscreen.toggle(key)), newWindow:guard(() => windows.open(id,key)),
         closeWindow:guard(() => windows.closeSelf(key)), serviceManagement:guard(() => remoteServices.termaRemoteManagement.setupGuide(id,'vnc')),
         reconnect:guard(() => session.reconnect(id,key)),
         systemClient:guard(event => remoteServices.termaRemoteClients.launch(id,key,event.currentTarget as HTMLButtonElement)),
         settings:guard(() => detached ? windows.settings(id) : remoteServices.termaRemoteProfiles.editor.edit(id,true))};
     }});
   return {session,text,images,polling,helper,fullscreen,clipboard,windows,management,presentation,workspace,question,port:host};
 }
 const current=()=>feature||=create();
 remoteServices.termaVncRuntime={loadRfb,promptCredentials,display:applyVncDisplay,findSession:key=>feature?.session.sessions.get(key),
   get presentation(){return current().presentation;},
   get workspace(){return current().workspace;},
   refreshWorkspace(){
     const view = remoteServices.termaRemoteDesktop.activeView();
     if (feature) feature.workspace.refresh(view);
     else view?.__termaRemoteDesktopRefresh?.();
   },
   renderingActive:()=>hasActiveVncRendering(feature?.session.sessions.values() ?? [], Boolean(remoteServices.termaVncDetached)),localClipboard,clipboardModel,toolbar,get session(){return current().session;},get fullscreen(){return current().fullscreen;},get clipboard(){return current().clipboard;},get text(){return current().text;},get images(){return current().images;},get helper(){return current().helper;},get windows(){return current().windows;},get management(){return current().management;},
   refreshPolling: () => feature?.polling.refresh(),
   syncImagesAfterFocus: () => feature?.polling.afterFocus(),
   close:key=>feature?.session.close(key),confirm:async(message,title,accept)=>await current().question.ask({title,message,choices:[{value:'yes',label:accept},{value:'',label:()=>current().port.tr('common:actions.cancel')}]})==='yes'};
 window.addEventListener('terma:language-changed',()=>{feature?.session.refreshLabels();feature?.windows.refreshLabels();queueMicrotask(()=>feature?.fullscreen.refreshLabels());});
 window.addEventListener('beforeunload',()=>{feature?.session.dispose();feature?.clipboard.dispose();feature?.fullscreen.dispose();feature?.windows.dispose();feature?.management.dispose();});
}


export interface InstalledFeaturesRemoteVncRuntimeServices {
  termaVncDetached?: boolean;
  termaVncRuntime:{loadRfb():Promise<NoVncClass>;promptCredentials:ReturnType<typeof createVncCredentialPrompt>;display:typeof applyVncDisplay;readonly presentation:ReturnType<typeof createVncPresentation>;readonly workspace:ReturnType<typeof createVncWorkspace>;refreshWorkspace():void;renderingActive():boolean;findSession(key:string):VncSession|undefined;readonly localClipboard:ReturnType<typeof createVncLocalClipboard>;readonly clipboardModel:ReturnType<typeof createVncClipboardModel>;readonly toolbar:ReturnType<typeof createVncClipboardToolbar>;readonly images:ReturnType<typeof createVncClipboardImages>;readonly text:ReturnType<typeof createVncClipboardText>;readonly helper:ReturnType<typeof createVncClipboardHelper>;readonly session:ReturnType<typeof createVncSessionService>;readonly fullscreen:ReturnType<typeof createVncFullscreen>;readonly clipboard:ReturnType<typeof createVncClipboardService>;readonly windows:ReturnType<typeof createVncWindowService>;readonly management:ReturnType<typeof createVncManagementService>;refreshPolling():void;syncImagesAfterFocus():Promise<void>|undefined;close(key:string):void;confirm(message:()=>string,title:()=>string,accept:()=>string):Promise<boolean>}
}
