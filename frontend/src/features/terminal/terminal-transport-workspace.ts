import {terminalServices} from '@/features/terminal/installed-services';
import {assistantServices} from '@/features/assistant/installed-services';
import {efficiencyServices} from '@/features/efficiency/installed-services';
import {sessionEfficiencyServices} from '@/features/session-efficiency/installed-services';
import {quickServices} from '@/features/quick/installed-services';
import {api} from '@/shared/api/workspace-request';
import {notify} from '@/features/efficiency/notification-actions';
import {isMobileLayout} from '@/shared/browser-ui';
import {applicationState} from '@/shared/application-state';
import {terminalReconnectInput} from '@/features/terminal/terminal-input-actions';
import {updateTerminalConnectionStatus,reconnectTerminal} from '@/features/terminal/terminal-connection-runtime';
import {terminalAuthentication} from './terminal-authentication-workspace';
import {terminalSessions} from './terminal-session-state';
import type {TerminalSession} from './terminal-session-state';
import type {TerminalConnectionPort} from './terminal-connection-service';
import type {TerminalTransportPort} from './terminal-transport-service';
import {terminalViewport} from './terminal-viewport-service';
import {terminalDirectory} from './terminal-directory-workspace';
import {terminalStartupOverrides} from './terminal-startup-state';
import {workspaceHasTabKey, workspaceTabByKey} from '../workspace/workspace-dock-state';
import {translate as tr} from '../../shared/i18n/runtime';


export function ownedTerminalSession(candidate:object) {
  const key='key' in candidate?candidate.key:'';
  const session=terminalSessions.get(String(key||''));
  return session===candidate?session:undefined;
}
function applySession(candidate:object,action:(session:TerminalSession)=>unknown) {
  const session=ownedTerminalSession(candidate);
  if(session)action(session);
}

export const terminalTransportPort:TerminalTransportPort={
  openState:WebSocket.OPEN,
  isCurrent:(key,session)=>terminalSessions.get(key)===session&&workspaceHasTabKey(key),
  tr:key=>tr(key),
  markConnected:session=>terminalServices.termaTerminalSessionCore!.markConnected(session),
  syncOutput:session=>applySession(session,owned=>terminalServices.termaTerminalOutputFlow!.sync(owned)),
  updateStatus:(connection,key,state)=>updateTerminalConnectionStatus(connection,key,state),
  scheduleDirectory:(session,connection,key,delay)=>applySession(session,owned=>terminalDirectory.schedule(owned,connection,key,delay)),
  cancelDirectory:session=>applySession(session,owned=>terminalDirectory.cancel(owned,true)),
  initializeZmodem:session=>applySession(session,owned=>terminalServices.termaTerminalZmodem.initialize(owned)),
  closeZmodem:session=>applySession(session,owned=>terminalServices.termaTerminalZmodem.close(owned)),
  consumeZmodem:(session,data)=>{const owned=ownedTerminalSession(session);return owned?terminalServices.termaTerminalZmodem.consume(owned,data):false;},
  prepareZmodemInput:(session,data)=>{const owned=ownedTerminalSession(session);return owned?terminalServices.termaTerminalZmodem.prepareInput(owned,data):false;},
  takeZmodemInput:(session,data)=>{const owned=ownedTerminalSession(session);return owned?terminalServices.termaTerminalZmodem.takePreparedInput(owned,data):data;},
  markEnded:session=>applySession(session,owned=>assistantServices.termaAssistant.tracker.ended(owned)),
  authenticationFailure:(session,data)=>terminalAuthentication.authenticationFailureChunk(session,data),
  updateSmartState:(key,data)=>efficiencyServices.termaTerminalActivity?.updateWorkspace(key,data),
  queueOutput:(session,data)=>applySession(session,owned=>terminalServices.termaTerminalOutputFlow!.queue(owned,data)),
  fitMobile:()=>{if(isMobileLayout())terminalViewport.schedule();},
  supportsReconnect:(connection,session)=>terminalServices.termaTerminalSessionCore!.supportsAutoReconnect(connection,session),
  scheduleReconnect:(connection,key,session)=>{terminalServices.termaTerminalSessionCore!.scheduleAutoReconnect(connection,key,session);},
  repairCredentials:(connection,key)=>terminalAuthentication.repair(connection,key,terminalSessions.get(key),()=>terminalSessions.get(key)),
  interceptPaste:(key,id,data)=>terminalServices.termaTerminalImagePaste!.interceptCtrlV(key,id,data),
  ctrlActive:()=>applicationState.terminalCtrlArmed||applicationState.terminalCtrlLocked,
  transformInput:(key,data)=>terminalServices.termaTerminalKeysService!.transformInput(key,data),
  trackCommand:(session,data)=>applySession(session,owned=>terminalServices.termaTerminalCommandTracking!.trackCommand(owned,data)),
  broadcastInput:(key,outgoing,data)=>sessionEfficiencyServices.termaTerminalBroadcastWorkspace?.handle(key,outgoing,data)??false,
  reconnectInput:data=>terminalReconnectInput(data),
  reconnect:(id,key)=>reconnectTerminal(id,key),
  reportError:operation=>{console.warn('[terminal-transport]',operation);notify(tr('terminal:system.websocket_failed'),'error');},
};

export const terminalConnectionPort:Omit<TerminalConnectionPort,'openXServer'>={
  isCurrent:terminalTransportPort.isCurrent,
  api:(path,options)=>api(path,options),
  tr:(key,params)=>tr(key,params),
  notify:(message,kind)=>notify(message,kind),
  updateStatus:(connection,key,state)=>updateTerminalConnectionStatus(connection,key,state),
  quickAuthentication:(connection,key)=>{
    if(document.getElementById('modal')?.dataset.quickSshAuth!=='1')
      void quickServices.termaQuickViews!.startQuickSshConnection(
        {user:connection.ssh_user,host:connection.ssh_host,port:connection.ssh_port},
        {reconnectKey:key,authType:connection.auth_type});
  },
  cancelDirectory:terminalTransportPort.cancelDirectory,
  closeZmodem:terminalTransportPort.closeZmodem,
  releaseTransport:session=>terminalServices.termaTerminalTransport!.release(session),
  bindTransport:(connection,key,session,socket,attempt)=>{terminalServices.termaTerminalTransport!.bind(connection,key,session,socket,attempt);},
  openSocket:url=>new WebSocket(url),
  closeSocket:socket=>socket.close(),
  title:key=>workspaceTabByKey(key)?.title||'',
  startupOverride:key=>terminalStartupOverrides.get(key)||null,
  scrollbackLines:()=>terminalServices.termaTerminalSettings!.current().scrollback_lines,
  location:()=>({protocol:location.protocol,host:location.host}),
  language:()=>document.documentElement.lang==='en-US'?'en-US':'zh-CN',
  reportError:operation=>console.warn('[terminal-connection]',operation),
};
