import type {Api,Translate} from '../operations/operations-types';
import type {RunningForward} from '../operations/running-forwards';
export interface Forward extends RunningForward {connection_id:number;restore?:number;url_scheme?:string;url_path?:string}
export interface Connection {id:number;name:string;ssh_host:string;ssh_port?:number;group_name:string;sort_order?:number;forwards:Forward[]}
export interface Template extends Omit<Forward,'id'|'connection_id'> {id:string;name:string}
export interface ForwardPort {
  api:Api;tr:Translate;connections():Connection[];templates():Template[];locale():string;
  stored(key:string):string|null;store(key:string,value:string):void;groupName(name:string):string;groups():string[];
  reload():Promise<unknown>;reloadTemplates():Promise<unknown>;scope():()=>boolean;scopeOwner():object|null;
  access(forward:Forward):string;quality(forward:Forward):string;copy(text:string):Promise<unknown>;logs(time:number):void;
  diagnose(id:number):Promise<unknown>;
  repair(id:number,error:unknown):Promise<unknown>;openConnection(id:number):void;notify(text:string,kind:'info'|'success'|'error'):void;
}
export interface Draft {connection_id:number;mode:string;bind_host:string;bind_port:string;target_host:string;target_port:string;service_name:string;service_type:string;service_note:string;group_name:string;url_scheme:string;url_path:string}
export type Payload=Omit<Draft,'connection_id'|'bind_port'|'target_port'>&{bind_port:number;target_port:number|null};
export interface Row {connection:Connection;forward:Forward;title:string;mode:string;rule:string;status:string}
export const validId=(id:number)=>Number.isSafeInteger(id)&&id>0;
export const active=(f:Forward)=>['running','reconnecting'].includes(f.status||'');
export const signature=(c:Connection,f:Forward)=>JSON.stringify([c.id,f.id,f.mode,f.bind_host,f.bind_port,f.target_host,f.target_port]);
const endpoint=(host='',port=0)=>`${host.includes(':')&&!host.startsWith('[')?'['+host+']':host}:${port}`;
export function draft(connectionId:number,value?:Partial<Omit<Forward,'id'>>&{name?:string}):Draft{return {connection_id:connectionId,mode:value?.mode||'local',bind_host:value?.bind_host||'127.0.0.1',bind_port:value?.bind_port?String(value.bind_port):'',target_host:value?.target_host||'127.0.0.1',target_port:value?.target_port?String(value.target_port):'',service_name:value?.service_name||value?.name||'',service_type:value?.service_type||'',service_note:value?.service_note||'',group_name:value?.group_name||'',url_scheme:value?.url_scheme||'',url_path:value?.url_path||''};}
export function payload(value:Draft,tr:Translate):Payload {
  const port=(s:string)=>/^\d+$/.test(s.trim())&&Number(s)>=1&&Number(s)<=65535;
  if(!validId(value.connection_id))throw Error(tr('connections:forwards.select_connection'));
  if(!['local','remote','socks'].includes(value.mode)||!port(value.bind_port)||value.mode!=='socks'&&!port(value.target_port)||!['','http','https'].includes(value.url_scheme)||value.url_path.length>2048||value.group_name.length>128||[value.bind_host,value.target_host,value.service_name,value.service_note,value.group_name,value.url_path].some(v=>/[\u0000-\u001f\u007f]/.test(v)))throw Error(tr('connections:forward_pages.invalid'));
  const {connection_id:_,...data}=value;return {...data,bind_host:value.bind_host.trim()||'127.0.0.1',target_host:value.mode==='socks'?'':value.target_host.trim()||'127.0.0.1',bind_port:Number(value.bind_port),target_port:value.mode==='socks'?null:Number(value.target_port),service_name:value.service_name.trim(),service_note:value.service_note.trim(),group_name:value.group_name.trim(),url_path:value.url_path.trim()};
}
export function rows(port:Pick<ForwardPort,'connections'|'tr'>):Row[]{return port.connections().flatMap(connection=>(connection.forwards||[]).filter(f=>validId(f.id)).map(forward=>{
  const mode=forward.mode==='socks'?'SOCKS5':port.tr('connections:forwards.'+(forward.mode==='remote'?'remote_forward':'local_forward'));
  const service=forward.service_type==='other'?port.tr('common:auto.other'):({web:'Web',mysql:'MySQL',redis:'Redis',ssh:'SSH',socks:'SOCKS5'}[forward.service_type||'']||forward.service_type||'');
  return {connection,forward,title:forward.service_name||service||mode,mode,status:port.tr('connections:forwards.'+(['running','reconnecting','failed'].includes(forward.status||'')?forward.status:'stopped')),rule:forward.mode==='socks'?endpoint(forward.bind_host,forward.bind_port):port.tr('connections:forwards.'+(forward.mode==='remote'?'remote_listener':'local_listener'),{bind:endpoint(forward.bind_host,forward.bind_port),target:endpoint(forward.target_host,forward.target_port)})};
}));}
export function paginate<T>(items:T[],page:number,size:number){const pageSize=[12,24,48,96].includes(size)?size:12,pages=Math.max(1,Math.ceil(items.length/pageSize)),current=Math.min(pages,Math.max(1,Math.floor(page)||1));return {items:items.slice((current-1)*pageSize,current*pageSize),total:items.length,page:current,size:pageSize,pages,first:items.length?(current-1)*pageSize+1:0,last:Math.min(current*pageSize,items.length)};}
export function filterRows(items:Row[],query:string,status:string,connectionId:number,locale:string){const needle=query.trim().toLocaleLowerCase(),rank:Record<string,number>={failed:0,reconnecting:1,running:2,stopped:3};return items.filter(r=>(!connectionId||r.connection.id===connectionId)&&(status==='all'||(r.forward.status||'stopped')===status)&&(!needle||[r.connection.name,r.connection.ssh_host,r.title,r.mode,r.status,r.rule,r.forward.service_note,r.forward.group_name,r.forward.url_path].join(' ').toLocaleLowerCase().includes(needle))).sort((a,b)=>(rank[a.forward.status||'stopped']??4)-(rank[b.forward.status||'stopped']??4)||a.connection.name.localeCompare(b.connection.name,locale,{numeric:true})||a.title.localeCompare(b.title,locale,{numeric:true}));}
