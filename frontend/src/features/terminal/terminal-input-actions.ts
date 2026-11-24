import {terminalServices} from '@/features/terminal/installed-services';
import {notify} from '@/features/efficiency/notification-actions';
import {isMobileLayout} from '@/shared/browser-ui';
import {terminalSessions} from './terminal-session-state';
import {reconnectTerminal} from './terminal-connection-runtime';
import {terminalPromptStateAtRow} from './terminal-prompt';
import {terminalHistory} from './terminal-history';
import {translate as tr} from '../../shared/i18n/runtime';

export interface TerminalSendOptions {agentCommand?:string;trackCommand?:boolean;focus?:boolean}
export function terminalReconnectInput(data:unknown) {
  return ['\r','\n','\r\n'].includes(String(data||''));
}
export function sendTerminalData(key:string,data:string,options:TerminalSendOptions={}) {
  const session=terminalSessions.get(key);
  if(!session)return false;
  if(!session.socket||session.socket.readyState!==WebSocket.OPEN){
    if(terminalReconnectInput(data)){
      if(session.socket?.readyState!==WebSocket.CONNECTING)reconnectTerminal(session.id,key);
      return true;
    }
    notify(tr('terminal:notifications.not_connected'),'error');return false;
  }
  if(terminalServices.termaTerminalZmodem!.prepareInput(session,data))return true;
  const prepared=terminalServices.termaTerminalZmodem!.takePreparedInput(session,data);
  const capture=options.agentCommand?{
    promptBefore:terminalPromptStateAtRow(session),
    outputSequenceBefore:Number(session.terminalOutputSequence||0),sentAt:Date.now()
  }:null;
  session.socket.send(prepared);
  if(options.agentCommand)terminalServices.termaTerminalCommandTracking!.recordAgentCommand(session,options.agentCommand,capture||{});
  else if(options.trackCommand===true)terminalServices.termaTerminalCommandTracking!.trackCommand(session,prepared,{preferCommandBuffer:true,source:'paste'});
  if(options.focus??!isMobileLayout()){
    try{session.term.focus();}catch{console.warn('[terminal-input] released focus target');}
  }
  return true;
}
export function sendMobileTerminalInput(key:string) {
  const input=terminalServices.termaTerminalSurface.element(key,'#terminalMobileInput') as HTMLTextAreaElement|null;
  const command=String(input?.value||'');
  if(!input||!command.trim())return;
  const session=terminalSessions.get(key);
  if(session)void terminalServices.termaTerminalDirectory!.track(session,session.connection,key,command);
  sendTerminalData(key,`${command}\r`);terminalHistory.save(command);
  input.value='';input.focus();
}
export function handleMobileTerminalInput(event:KeyboardEvent,key:string) {
  if(event.key!=='Enter'||event.shiftKey)return;
  event.preventDefault();sendMobileTerminalInput(key);
}
export const transformTerminalInputForCtrl=(key:string,data:string)=>terminalServices.termaTerminalKeysService!.transformInput(key,data);
export const sendTerminalKey=(key:string,label:string)=>terminalServices.termaTerminalKeysService!.sendKey(key,label);
export const sendCtrlCombo=(key:string,letter:string)=>terminalServices.termaTerminalKeysService!.sendCtrl(key,letter);


