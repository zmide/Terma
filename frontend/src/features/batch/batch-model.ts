import type {Api,Translate} from '../operations/operations-types';
export interface BatchConnection {id:number;name:string;ssh_host:string;ssh_user:string;ssh_port:number;group_name:string}
export interface CommandTemplate {id:string;name:string;command:string;description:string}
export interface BatchScope {owner:object;key:string;valid():boolean;active():boolean}
export interface BatchSocket {send(value:string):void;close():void;on(type:'open'|'message'|'error'|'close',listener:(event:{data?:unknown})=>void):()=>void}
export interface BatchPort {
  api:Api;tr:Translate;connections():BatchConnection[];visibleConnections():BatchConnection[];primary():string;selected():number;scope(key?:string):BatchScope|null;
  socket():BatchSocket;notify(text:string,kind:'info'|'error'|'success'):void;error(value:unknown,fallback:string):string;
  copy(text:string):Promise<unknown>;paste():Promise<string>;download(text:string,format:'txt'|'json'):void;openLog(path:string,label:string):void;
  groupName(name:string):string;open():void;
}
export interface BatchDraft {command:string;templateId:string;timeout:string;selected:Set<number>}
export interface BatchResult {id:number;name:string;host:string;output:string;ok:boolean|null;state:string;started:boolean;exit_code:number|null;error:string;issue:Record<string,unknown>|null;elapsed_ms:number|null}
export interface BatchRun {run_id:number;ids:number[];command:string;timeout_ms:number;started_at:string;finished_at:string|null;status:string;running:boolean;invalidated:boolean;log_path:string;log_label:string;ok_count:number;failed_count:number;results:Record<string,BatchResult>}
export const normalizeCommand=(command:string)=>command.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
export const dangerousCommand=(command:string)=>/\b(rm\s+(-[a-z]*r[a-z]*f|-rf|-[a-z]*f[a-z]*r)|mkfs|shutdown|reboot|poweroff|halt|chmod\s+-R\s+777|chown\s+-R)\b|dd\s+if=|:\s*\(\)\s*\{\s*:\s*\|\s*:\s*;\s*\}/i.test(command);
export function matchesRun(draft:BatchDraft,run:BatchRun|null){return !!run&&!run.invalidated&&normalizeCommand(draft.command)===run.command&&Number(draft.timeout)*1000===run.timeout_ms&&[...draft.selected].sort((a,b)=>a-b).join(',')===[...run.ids].sort((a,b)=>a-b).join(',');}
export const connectionSignature=(c:BatchConnection)=>JSON.stringify([c.id,c.ssh_host,c.ssh_port,c.ssh_user]);
export function resultStatus(port:BatchPort,item:BatchResult,run:BatchRun){const t=(key:string,values?:Record<string,unknown>)=>port.tr('terminal:batch.'+key,values),error=item.issue?port.error(item.issue,item.error):item.error;
  if(item.ok!==null)return t(item.ok?'result_success':'result_failure',{code:item.exit_code??'',error:error?' · '+error:''});
  if(item.state==='stopped')return t(item.started?'status_stopped':'status_stopped_not_started');
  if(item.state==='disconnected')return t(item.started?'status_disconnected_incomplete':'status_disconnected_not_started');
  return t(item.started?'status_running':run.running?'status_waiting':'status_incomplete');
}
export function runStatus(port:BatchPort,run:BatchRun){return port.tr('terminal:batch.'+({finished:'finished_summary',stopped:'stopped_results_kept',disconnected:'channel_disconnected_results_kept',error:'connection_failed'}[run.status]||'running'),{ok:run.ok_count,failed:run.failed_count});}
export function exportRun(port:BatchPort,run:BatchRun,format:'txt'|'json'){
  const results=run.ids.map(id=>run.results[id]!),data={...run,results:results.map(item=>({...item,error:item.issue?port.error(item.issue,item.error):item.error,issue:undefined}))};
  if(format==='json')return JSON.stringify(data,null,2);
  const t=(key:string)=>port.tr('terminal:batch.'+key);
  return [`${t('export_command')}: ${run.command}`,`${t('export_started')}: ${run.started_at}`,`${t('export_finished')}: ${run.finished_at||''}`,'',...results.flatMap(item=>[`===== ${item.name} · ${item.host} =====`,`${t('export_status')}: ${resultStatus(port,item,run)}`,item.error?`${t('export_error')}: ${item.issue?port.error(item.issue,item.error):item.error}`:'',item.output||t('no_output'),''])].join('\n');
}
