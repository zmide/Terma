import {sharedServices} from '@/shared/installed-services';
import {createTemporarySshConnection,type TemporarySshTicket} from '../connections/connection-credential-model';
import {workspaceAllTabs} from '../workspace/workspace-dock-state';
import type {WorkspaceTab} from '../workspace/workspace-tab-runtime';
import type {ManagementConnection} from '../remote/management-types';
import type {TerminalPreferences} from './terminal-preferences-service';
import {translate as tr} from '../../shared/i18n/runtime';

export type QuickTerminalConnection=ManagementConnection&Partial<TerminalPreferences>&{
  quick_connection?:boolean;quick_token?:string;[key:string]:unknown;
};
interface RegistryPort {
  tabs():readonly WorkspaceTab[];
  revoke(token:string):Promise<unknown>;
  failed():void;
}
export function createTerminalQuickRegistry(port:RegistryPort){
  const byKey=new Map<string,QuickTerminalConnection>(),byId=new Map<number,QuickTerminalConnection>();
  const token=(id:number)=>String(byId.get(Number(id))?.quick_token||'');
  const headers=(id:number,extra:Record<string,string>={})=>{
    const value=token(id);return value?{...extra,'X-Terma-Quick-Connection':value}:extra;
  };
  const inUse=(id:number)=>port.tabs().some(tab=>Number(tab.id)===Number(id)&&Boolean(tab.quick_connection||tab.kind==='quick-terminal'));
  function release(id:number){
    id=Number(id);if(!Number.isSafeInteger(id)||id>=0||inUse(id))return;
    const value=token(id);byId.delete(id);
    if(value)void port.revoke(value).catch(()=>port.failed());
  }
  function temporary(ticket:TemporarySshTicket){
    const value=createTemporarySshConnection(ticket);
    if(typeof value.ssh_host!=='string')throw new Error('temporary SSH credential creation failed');
    const connection=value as QuickTerminalConnection;
    byId.set(connection.id,connection);return connection;
  }
  return {byKey,byId,token,headers,inUse,release,temporary};
}
export const terminalQuickRegistry=createTerminalQuickRegistry({
  tabs:workspaceAllTabs,
  revoke:token=>sharedServices.termaWorkspaceRequest('/api/terminal/quick-tickets',{
    method:'DELETE',body:JSON.stringify({token}),skipSftpConnect:true,skipHostTrustPrompt:true
  }),
  failed:()=>console.warn('Temporary SSH credential cleanup failed')
});
export const quickConnectionsById=terminalQuickRegistry.byId;
export const quickTerminalConnections=terminalQuickRegistry.byKey;
export const quickConnectionRequestToken=terminalQuickRegistry.token;
export const quickConnectionRequestHeaders=terminalQuickRegistry.headers;
export const releaseQuickConnectionIfUnused=terminalQuickRegistry.release;
export function registerTemporarySshCredential(ticket:TemporarySshTicket){
  try{return terminalQuickRegistry.temporary(ticket);}
  catch{throw new Error(tr('connections:credentials.temporary_create_failed'));}
}


