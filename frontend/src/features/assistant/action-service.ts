import type {AssistantState} from './assistant-model';

export type ActionKind='command'|'mcp';
export type ActionStatus='queued'|'running'|'success'|'failed'|'waiting'|'stopped'|'skipped';
export interface ActionInput {kind:ActionKind;taskId:string;label:string;command?:string;server?:string;tool?:string;key?:string}
export interface ActionRecord extends ActionInput {id:string;status:ActionStatus;startedAt:number;endedAt:number;output:string;error:string}
export interface ActionPort {state(key:string):AssistantState;id():string;now():number;changed(key:string):void;render(key:string):void}
const text=(value:unknown,max=100000)=>String(value||'').slice(0,max);
export function createActionService(port:ActionPort){
  const records=new Map<string,ActionRecord[]>();
  const list=(key:string)=>{const rows=records.get(key)||[];if(!records.has(key))records.set(key,rows);return rows;};
  function identity(input:ActionInput){return input.kind==='command'?`command:${input.taskId}:${text(input.command,100000).trim()}`:`mcp:${input.taskId}:${input.server||''}:${input.tool||''}:${input.key||''}`;}
  function begin(key:string,input:ActionInput){const rows=list(key),idKey=identity(input);const duplicate=rows.find(item=>identity(item)===idKey&&['queued','running','success','waiting'].includes(item.status));if(duplicate)return {accepted:false,duplicate:true,record:duplicate};const record:ActionRecord={...input,id:port.id(),status:'queued',startedAt:0,endedAt:0,output:'',error:''};rows.push(record);rows.splice(0,Math.max(0,rows.length-40));record.status='running';record.startedAt=port.now();port.changed(key);return {accepted:true,duplicate:false,record};}
  function finish(key:string,id:string,status:ActionStatus,patch:Partial<ActionRecord>={}){const record=list(key).find(item=>item.id===id);if(!record)return null;Object.assign(record,patch,{status,endedAt:port.now()});port.changed(key);if(port.state(key).open)port.render(key);return record;}
  function stop(key:string){for(const record of list(key))if(['queued','running','waiting'].includes(record.status)){record.status='stopped';record.endedAt=port.now();}port.changed(key);if(port.state(key).open)port.render(key);}
  function active(key:string){return list(key).filter(item=>['queued','running','waiting'].includes(item.status));}
  function clear(key:string){records.delete(key);}
  return {begin,finish,stop,active,records:(key:string)=>list(key).slice(),clear,dispose(){records.clear();}};
}
