import {connectionsServices} from '@/features/connections/installed-services';
import {terminalServices} from '@/features/terminal/installed-services';
import {isMobileLayout} from '@/shared/browser-ui';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {translate as tr} from '../../shared/i18n/runtime';
import type {ManagementConnection} from '../remote/management-types';
import type {TerminalPreferences} from './terminal-preferences-service';
import type {ConnectionControllerRecord} from '../connections/connection-controller-service';

type Connection=ManagementConnection&Partial<TerminalPreferences>&Record<string,unknown>;

export const terminalEncodingOptions=[
  ['utf8','UTF-8'],['gb18030','GB18030'],['gbk','GBK'],['big5','Big5'],
  ['shift_jis','Shift_JIS'],['euc-kr','EUC-KR'],['latin1','ISO-8859-1']
] as const;
export const terminalFontOptions:[string,string][]=[
  ['ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',tr('terminal:display.system_font')],
  ['Cascadia Mono, Cascadia Code, Consolas, monospace','Cascadia'],
  ['JetBrains Mono, Consolas, monospace','JetBrains Mono'],
  ['Consolas, monospace','Consolas'],['Menlo, Monaco, monospace','Menlo / Monaco'],
  ['DejaVu Sans Mono, monospace','DejaVu Sans Mono'],['Noto Sans Mono, monospace','Noto Sans Mono']
];
export function localizedTerminalFontOptions(){
  return terminalFontOptions.map(([value,label],index)=>[value,index===0?tr('terminal:display.system_font'):label] as const);
}
export function terminalSessionEncoding(key:string,connection?:Partial<TerminalPreferences>|null){
  return terminalSessions.get(key)?.terminalEncoding||connection?.terminal_encoding||'utf8';
}
export function terminalEncodingLabel(connection:Partial<TerminalPreferences>,key=''){
  return terminalEncodingOptions.find(([value])=>value===terminalSessionEncoding(key,connection))?.[1]||'UTF-8';
}
export function terminalConnectionStateLabel(state='connecting'){
  const name=['connected','reconnecting','disconnected','authentication','authorization'].includes(state)?state:'connecting';
  return tr(`terminal:connection_state.${name}`);
}
export function terminalActionConnection(key:string,connectionId:number):Connection|null{
  const session=terminalSessions.get(String(key||''))?.connection;
  if(session)return session;
  const connection=connectionsServices.termaConnectionController!.current(connectionId);
  return isConnection(connection)?connection:null;
}
function isConnection(value:ConnectionControllerRecord|undefined):value is Connection{return !!value&&'ssh_host' in value&&typeof value.ssh_host==='string';}


export function terminalFontSizeField() {
  return isMobileLayout() ? "terminal_mobile_font_size" : "terminal_font_size";
}

export function terminalFontSizeInheritField() {
  return isMobileLayout() ? "terminal_mobile_font_size_inherit" : "terminal_font_size_inherit";
}

export function terminalFontFamilyForConnection(connection?:Partial<TerminalPreferences>&{quick_connection?:unknown}|null) {
  if (connection?.quick_connection || Number(connection?.terminal_font_family_inherit || 0) === 1) {
    return terminalServices.termaTerminalSettings!.current().font_family;
  }
  return connection?.terminal_font_family || terminalServices.termaTerminalSettings!.current().font_family;
}

export function terminalFontSizeForCurrentLayout(connection?:Partial<TerminalPreferences>&{quick_connection?:unknown}|null) {
  if (connection?.quick_connection || Number(connection?.[terminalFontSizeInheritField()] || 0) === 1) {
    return terminalServices.termaTerminalSettings!.current().font_size;
  }
  return Number(connection?.[terminalFontSizeField()]) || terminalServices.termaTerminalSettings!.current().font_size;
}
