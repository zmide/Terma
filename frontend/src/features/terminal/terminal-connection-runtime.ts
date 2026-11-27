import {terminalServices} from '@/features/terminal/installed-services';
import {connectionsServices} from '@/features/connections/installed-services';
import {openQuickTerminal} from '@/features/terminal/terminal-page';
import {terminalSessions} from './terminal-session-state';
import type {TerminalConnection} from './terminal-connection-service';
import type {TerminalAuthenticationConnection} from './terminal-authentication-service';
import type {TerminalSessionCoreSession} from './terminal-session-core-service';
import {quickConnectionsById,quickTerminalConnections} from './terminal-quick-registry';
import type {QuickTerminalConnection} from './terminal-quick-registry';
import {translate as tr} from '../../shared/i18n/runtime';
import {setWorkspaceTabConnectionStatus} from '../workspace/workspace-dock-runtime';

export function updateTerminalConnectionStatus(_connection:unknown,key:string,state='connecting') {
  const normalized=['connected','reconnecting','disconnected','authentication','authorization'].includes(state)?state:'connecting';
  const connectionStatus=normalized==='connected'?'connected':normalized==='disconnected'?'disconnected':'connecting';
  terminalServices.termaTerminalToolbarService?.status.set(String(key),normalized);
  setWorkspaceTabConnectionStatus(key,connectionStatus);
  terminalServices.termaTerminalToolbar?.refresh(key);
  window.dispatchEvent(new CustomEvent('terma:terminal-toolbar-ready'));
}
export function terminalSessionNeedsAutomaticConnection(session:Pick<TerminalSessionCoreSession,'socket'|'connectionAttempt'>|null|undefined) {
  return !!session&&!session.socket&&Number(session.connectionAttempt||0)===0;
}
export function terminalSessionConnectionStatus(session:Partial<Pick<TerminalSessionCoreSession,'socket'|'connected'|'autoReconnectPending'|'connectionPending'>>|null|undefined) {
  const state=session?.socket?.readyState;
  if(session?.connected||state===WebSocket.OPEN)return 'connected';
  if(session?.autoReconnectPending)return 'reconnecting';
  if(session?.connectionPending||state===WebSocket.CONNECTING)return 'connecting';
  return 'disconnected';
}
export async function connectTerminal(connection:TerminalConnection,key:string,options:{auto?:boolean;initial?:boolean}={}) {
  const session=terminalSessions.get(key);
  if(!session)return;
  const core=terminalServices.termaTerminalSessionCore!;
  const attempt=core.beginConnection(session,{auto:!!options.auto,initial:!!options.initial});
  try{return await terminalServices.termaTerminalConnection!.connect(connection,key,session,attempt);}
  finally{core.finishConnection(connection,key,session,attempt,{auto:!!options.auto,isCurrent:()=>terminalSessions.get(key)===session});}
}
export function reconnectTerminal(id:number,key=`terminal-${id}-1`) {
  const session=terminalSessions.get(key);
  const connection=session?.connection||connectionsServices.termaConnectionController?.current(id);
  if(!connection)return;
  if(session)session.term.writeln(`\r\n${tr('terminal:system.reconnecting_preserved')}\r\n`);
  void connectTerminal(connection as TerminalConnection,key);
  terminalServices.termaTerminalSurface!.focus(key);
}
export function resumeQuickTerminalWithTicket(key:string,connection:TerminalAuthenticationConnection,token:string) {
  const session=terminalSessions.get(key);
  if(!session){
    if(typeof connection.name!=='string'||typeof connection.ssh_host!=='string'
      ||typeof connection.ssh_user!=='string'||typeof connection.ssh_port!=='number'
      ||!Number.isSafeInteger(connection.id)||Number(connection.id)>=0)return false;
    return openQuickTerminal({...connection,id:Number(connection.id),name:connection.name,
      ssh_host:connection.ssh_host,ssh_user:connection.ssh_user,ssh_port:connection.ssh_port},token);
  }
  const next={...session.connection,...connection,
    id:Number(connection.id||session.connection.id||0),quick_connection:true,quick_token:String(token||''),
    terminal_font_family_inherit:1,terminal_font_size_inherit:1,terminal_mobile_font_size_inherit:1};
  if(!Number.isSafeInteger(next.id)||next.id>=0)throw Error(tr('terminal:errors.invalid_quick_connection_id'));
  const previous=Number(session.connection.id||0);
  session.connection=next;session.id=next.id;session.quickToken=String(token||'');
  if(previous<0&&previous!==next.id)quickConnectionsById.delete(previous);
  quickConnectionsById.set(next.id,next as QuickTerminalConnection);
  quickTerminalConnections.set(key,next as QuickTerminalConnection);
  session.term.writeln(`\r\n${tr('terminal:system.reconnecting_preserved')}\r\n`);
  void connectTerminal(next,key);terminalServices.termaTerminalSurface!.focus(key);
}
export function disconnectTerminal(key:string) {
  const session=terminalSessions.get(key);if(!session)return;
  session.connectionAttempt=Number(session.connectionAttempt||0)+1;
  session.connectionPending=false;
  terminalServices.termaTerminalSessionCore!.prepareClose(session,key);
  const socket=session.socket;session.connected=false;
  try{socket?.close(1000,'user disconnect');}
  catch{console.warn('[terminal-connection] disconnect');}
  updateTerminalConnectionStatus(session.connection,key,'disconnected');
  terminalServices.termaTerminalSurface!.focus(key);
}
export function toggleTerminalConnection(id:number,key=`terminal-${id}-1`) {
  const session=terminalSessions.get(key);
  if(session?.connected||session?.connectionPending||session?.socket?.readyState===WebSocket.CONNECTING)disconnectTerminal(key);
  else reconnectTerminal(id,key);
}


