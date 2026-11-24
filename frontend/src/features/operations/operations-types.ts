export type Text = string | (() => string);
export type Translate = (key:string,values?:Record<string,unknown>)=>string;
export type Api = (url:string,options?:{method?:string;body?:string;signal?:AbortSignal})=>Promise<unknown>;
export const identifier=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value);
export const connectionId=(value:number)=>Number.isSafeInteger(value)&&value!==0;
export const remotePath=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=32768&&!value.includes('\0');
export function errorMessage(error:unknown,fallback:string){return error&&typeof error==='object'&&'message'in error&&typeof error.message==='string'?error.message:fallback;}
export async function request<T>(api:Api,url:string,options?:Parameters<Api>[1]){return await api(url,options) as T;}
export interface ModalBinding {alive():boolean;paint():void;close():void}
export interface ExternalSession {
  id:string;status:string;connection_id:number;connection_name:string;remote_path:string;local_path:string;
  updated_at?:number;can_compare?:boolean;
}
export interface ExternalComparison {old_text:string;new_text:string;remote_path?:string;remote_changed_at?:number;local_changed_at?:number;old_size?:number;new_size?:number}
export interface SyncAction {index:number;action:'upload'|'download'|'conflict';relative:string;reason?:string;selected?:boolean;local_size:number|null;remote_size:number|null}
export interface SyncPlan {id:string;local_path:string;remote_path:string;actions:SyncAction[];totals?:{upload?:number;download?:number;conflict?:number}}
export interface SyncJob {id:string;status:string;total?:number;errors?:{error?:string}[];plan_result?:SyncPlan}
export interface SyncModel {
  connectionId:number;tabKey:string;connectionName:string;localPath:string;remotePath:string;
  mode:string;useHash:boolean;excludes:string;phase:'options'|'scanning'|'plan'|'error';error:string;busy:boolean;
  plan:SyncPlan|null;selected:Set<number>;overrides:Map<number,'upload'|'download'>;
}
