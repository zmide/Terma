import {connectionStamp,type ManagementPort} from './management-types';
import type {DesktopGuideDiagnostics} from './install-guide-service';
export interface DesktopSession { desktop_id?:string; name?:string; raw?:string; shared?:boolean; virtual?:boolean }
export interface DesktopDiagnostics extends DesktopGuideDiagnostics {
 privileged?:boolean; platform_supported?:boolean; has_desktop?:boolean; os_id?:string; display_manager?:string;
 desktops?:{id:string}[]; desktop_catalog?:{id:string;label?:string;icon?:string}[]; installable_desktops?:string[];
 desktop_usage?:Record<string,Record<string,boolean>>;
 desktop_selection?:Partial<Record<'system_default'|'account_default'|'xdmcp'|'rdp'|'vnc',{state?:string;session?:DesktopSession}>>;
 active_graphical_sessions?:DesktopSession[]; active_vnc_sessions?:DesktopSession[];
}
export interface DesktopX11Status {platform?:string;ready?:boolean;xquartz_installed?:boolean;error?:string;code?:string;connectionId?:number}
export function createResourceProbe(port:ManagementPort){
 const requests=new Map<string,Promise<unknown>>();let generation=0;
 function read(id:number,resource:'linux-desktop'|'x11-forwarding'){
  const connection=port.connection(id);if(!connection||!Number.isSafeInteger(id)||!id)return Promise.reject(Error(port.tr('remote:admin.ssh_connection_missing')));
  const key=generation+':'+resource+':'+connectionStamp(connection),existing=requests.get(key);if(existing)return existing;
  const work=port.api(`/api/connections/${id}/${resource}`).finally(()=>requests.delete(key));requests.set(key,work);return work;
 }
 async function desktop(id:number){const [diagnostics,sshX11]=await Promise.all([read(id,'linux-desktop'),read(id,'x11-forwarding').catch((error:unknown)=>({error:error instanceof Error?error.message:port.tr('common:notifications.exact.x11_config_probe_failed'),code:(error as {code?:string})?.code||'',connectionId:id}))]);return {diagnostics:diagnostics as DesktopDiagnostics,sshX11:sshX11 as DesktopX11Status};}
 return {desktop,read,invalidate:()=>{generation++;requests.clear();}};
}
