import type {RemoteProfile} from './profile-model';
import type {RemoteAdminOptions} from './RemoteAdminDialog';
export interface ManagementConnection {id:number;name?:string;ssh_host:string;ssh_port?:number;ssh_user?:string;auth_type?:string;has_password?:boolean;quick_connection?:boolean;terminal_program_platform?:string;x11_mode?:string}
export interface ManagementRequest {method?:string;body?:string|ArrayBuffer;headers?:Record<string,string>;responseType?:'json'|'arrayBuffer';signal?:AbortSignal}
export interface Identity {path:string;permission_ok?:boolean;[key:string]:unknown}
export interface ManagementPort {
 api(url:string,options?:ManagementRequest):Promise<unknown>;
 tr(key:string,params?:Record<string,unknown>):string;
 notify(message:string,kind:'success'|'error'|'info'):void;
 unlocked(context:string):boolean;
 connections():ManagementConnection[];connection(id:number):ManagementConnection|undefined;
 profile(id:number):RemoteProfile|undefined;
 quickHeaders(id:number):Record<string,string>;
 identityLabel(identity:Identity):string;
 promptAdmin(options:RemoteAdminOptions):Promise<{admin_grant_id:string}|null>;
 localize(message:string):string;
 scope():()=>boolean;
 now():number;
 seedSsh(draft:import('../connections/connection-form-service').RemoteManagementSshDraft):boolean;
}
export const normalizeManagementHost=(value:unknown)=>String(value||'').trim().toLowerCase().replace(/^\[|\]$/g,'');
export const connectionStamp=(connection:ManagementConnection)=>JSON.stringify([connection.id,normalizeManagementHost(connection.ssh_host),connection.ssh_port,connection.ssh_user,connection.auth_type,connection.has_password]);
export const profileStamp=(profile:RemoteProfile)=>JSON.stringify([profile.id,profile.protocol,profile.host,profile.port,profile.username,profile.name,profile.group_name,profile.options]);
