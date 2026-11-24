import {captureBulk,operateBulk,needsStop} from '../forwards/forward-bulk';
import {errorMessage,type Api,type Translate} from './operations-types';
export interface RunningForward {id:number;mode:string;status?:string;bind_host?:string;bind_port?:number;target_host?:string;target_port?:number;service_name?:string;service_type?:string;service_note?:string;group_name?:string;restore?:number;last_error?:string;updated_at?:number;pid?:number;started_at?:number;reconnect_count?:number}
export interface ForwardConnection {id:number;name:string;ssh_host?:string;forwards:RunningForward[]}
export interface ForwardRow {connection:ForwardConnection;forward:RunningForward;title:string;rule:string;mode:string;status:string;url:string;quality:string;failedAt:string}
export interface RunningPort {api:Api;tr:Translate;connections():ForwardConnection[];visible():boolean;locale():string;stored():string;store(value:string):void;quality(forward:RunningForward):string;access(forward:RunningForward):string;conflict(id:number):Promise<boolean|{accepted:boolean;bindPort?:number}>;reload():Promise<unknown>;manage(id:number):void;copy(value:string):Promise<unknown>;logs(time:number):void;notify(message:string,kind:'info'|'success'|'error'):void}
export interface RunningModel {query:string;busy:Set<number>;toolbar:''|'restore'|'stop';error:string}
const validId=(id:number)=>Number.isSafeInteger(id)&&id>0;
const active=(forward:RunningForward)=>['running','reconnecting','failed'].includes(forward.status||'');
const endpoint=(host='',port=0)=>`${host.includes(':')&&!host.startsWith('[')?'['+host+']':host}:${port}`;
export function safeForwardUrl(value:string){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}}
export function projectRunning(port:RunningPort,query=''){
  const label=(key:string,values?:Record<string,unknown>)=>port.tr('connections:forwards.'+key,values);
  const all:ForwardRow[]=[];
  for(const connection of port.connections())for(const forward of connection.forwards||[]){
    if(!validId(connection.id)||!validId(forward.id)||!active(forward))continue;
    const mode=forward.mode==='socks'?'SOCKS5':label(forward.mode==='remote'?'remote_forward':'local_forward');
    const service=forward.service_type==='other'?port.tr('common:auto.other'):({web:'Web',mysql:'MySQL',redis:'Redis',ssh:'SSH',socks:'SOCKS5'}[forward.service_type||'']||forward.service_type||'');
    const title=forward.service_name||service||mode;
    const rule=forward.mode==='socks'?endpoint(forward.bind_host,forward.bind_port):label(forward.mode==='remote'?'remote_listener':'local_listener',{bind:endpoint(forward.bind_host,forward.bind_port),target:endpoint(forward.target_host,forward.target_port)});
    const state=forward.status||'stopped';let failedAt='';const time=Number(forward.updated_at);
    if(state==='failed'&&Number.isFinite(time)&&time>0){const date=new Date(time>1e12?time:time*1000);if(Number.isFinite(date.getTime()))failedAt=label('failed_at',{time:date.toLocaleString(port.locale(),{hour12:false})});}
    all.push({connection,forward,title,mode,rule,status:label(state==='failed'?'failed':state),url:state==='running'?safeForwardUrl(port.access(forward)):'',quality:port.quality(forward),failedAt});
  }
  const rank:Record<string,number>={failed:0,reconnecting:1,running:2};all.sort((a,b)=>(rank[a.forward.status||'']??3)-(rank[b.forward.status||'']??3)||a.connection.name.localeCompare(b.connection.name,port.locale(),{numeric:true})||a.title.localeCompare(b.title,port.locale(),{numeric:true}));
  const needle=query.trim().toLocaleLowerCase();const rows=all.filter(row=>!needle||[row.connection.name,row.connection.ssh_host,row.title,row.rule,row.forward.service_note,row.status].some(value=>String(value||'').toLocaleLowerCase().includes(needle)));
  return {rows,total:all.length,counts:{running:all.filter(row=>row.forward.status==='running').length,reconnecting:all.filter(row=>row.forward.status==='reconnecting').length,failed:all.filter(row=>row.forward.status==='failed').length}};
}
export function createRunningForwards(port:RunningPort){
  const model:RunningModel={query:port.stored()||'',busy:new Set(),toolbar:'',error:''};let mounted=false,version=0,changed=()=>{};
  const visible=()=>mounted&&port.visible();
  const row=(id:number)=>projectRunning(port).rows.find(row=>row.forward.id===id);
  const locate=(id:number)=>{for(const connection of port.connections()){const forward=connection.forwards?.find(forward=>forward.id===id);if(forward)return {connection,forward};}return null;};
  const signature=(value:Pick<ForwardRow,'connection'|'forward'>)=>JSON.stringify([value.connection.id,value.forward.id,value.forward.mode,value.forward.bind_host,value.forward.bind_port,value.forward.target_host,value.forward.target_port]);
  async function reloadAccepted(generation:number){try{await port.reload();}catch{if(visible()&&version===generation)model.error=port.tr('connections:forward_manager.status_refresh_failed');}}
  const refresh=()=>{if(visible())changed();};
  async function command(id:number,kind:'stop'|'retry'){
    if(!visible()||!validId(id)||model.busy.has(id)||!!model.toolbar||!['stop','retry'].includes(kind))return false;const original=row(id);if(!original)return false;const captured={connection:{...original.connection},forward:{...original.forward}},generation=version;let expected=signature(captured);
    const targetCurrent=()=>{const value=locate(id);return !!value&&signature(value)===expected;};
    const current=()=>visible()&&version===generation&&targetCurrent();
    model.busy.add(id);model.error='';refresh();
    try{
      if(kind==='retry'&&['local','socks'].includes(original.forward.mode)){
        const result=await port.conflict(id),accepted=typeof result==='boolean'?result:result.accepted;
        const approvedPort=typeof result==='object'?result.bindPort:undefined;
        if(accepted&&approvedPort!==undefined&&Number.isSafeInteger(approvedPort)&&approvedPort>0&&approvedPort<=65535)expected=signature({...captured,forward:{...captured.forward,bind_port:approvedPort}});
        if(!current())return false;if(!accepted){port.notify(port.tr('common:notifications.forward_port_retry_cancelled',{name:original.title}),'info');return false;}
      }
      if(!current())return false;
      if(kind==='retry'){await port.api(`/api/forwards/${id}/stop`,{method:'POST'}).catch(()=>{});if(!targetCurrent())return false;await port.api(`/api/forwards/${id}/start`,{method:'POST'});}
      else await port.api(`/api/forwards/${id}/stop`,{method:'POST'});
      await reloadAccepted(generation);port.notify(port.tr(kind==='retry'?'common:notifications.forward_restarted_action':'common:notifications.forward_stopped_action'),'success');return true;
    }catch(error){await port.reload().catch(()=>{});const message=errorMessage(error,port.tr(kind==='retry'?'common:notifications.exact.forward_retry_failed_action':'common:notifications.exact.forward_operation_failed'));if(visible()&&version===generation)model.error=message;port.notify(message,'error');return false;}
    finally{model.busy.delete(id);refresh();}
  }
  async function toolbar(kind:'restore'|'stop'){
    if(!visible()||model.toolbar||model.busy.size)return false;
    const generation=version;model.toolbar=kind;model.error='';refresh();
    try{
      if(kind==='stop'){
        const ids=port.connections().flatMap(c=>c.forwards.filter(needsStop).map(f=>f.id));
        const result=await operateBulk(port,captureBulk(port,ids),'stop',()=>visible()&&version===generation);
        port.notify(port.tr('connections:forward_manager.bulk_result',result),result.failed||result.skipped?'error':'success');
      }else{
        const result=await port.api('/api/forwards/restore',{method:'POST'}) as {ok?:number;failed?:number};
        port.notify(port.tr('common:notifications.restore_forwards_result',{success:result.ok||0,failed:result.failed||0}),result.failed?'error':'success');
      }
      await reloadAccepted(generation);
      return true;
    }
    catch(error){if(visible()&&version===generation)model.error=errorMessage(error,port.tr('common:notifications.exact.forward_operation_failed'));return false;}
    finally{model.toolbar='';refresh();}
  }
  return {model,rows:()=>projectRunning(port,model.query),attach(listener:()=>void){mounted=true;version++;changed=listener;model.error='';},detach(){mounted=false;version++;changed=()=>{};},refresh,
    search(query:string){model.query=query;port.store(query);refresh();},command,toolbar,
    manage(id=0){if(visible()&&(id===0||row(id)))port.manage(id);},
    async copy(id:number){const value=row(id);if(!visible()||!value?.url)return false;try{await port.copy(value.url);return true;}catch(error){if(visible())model.error=errorMessage(error,port.tr('common:actions.copy'));refresh();return false;}},
    logs(id:number){const time=Number(row(id)?.forward.updated_at||0);if(visible()&&Number.isFinite(time)&&time>0)port.logs(time);}
  };
}
