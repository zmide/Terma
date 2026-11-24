import type {AssistantState} from './assistant-model';

export type ExecutionPermission='suggest'|'confirm'|'controlled'|'full';
export interface ApprovalRequest {
  command:string;
  kind:'command'|'mcp';
  server?:string;
  tool?:string;
  arguments?:Record<string,unknown>|null;
  reason:string;
  review?:Record<string,unknown>|null;
  index:number;
  total:number;
}
export interface CheckpointRecord {id:string;command:string;reason:string;createdAt:number;status:'pending'|'ready'|'failed';verified:boolean;backupCommand:string;rollbackCommand:string}
export interface ExecutionState {
  state(key:string):AssistantState;
  id():string;
  now():number;
  scope(key:string):()=>boolean;
  changed(key:string):void;
  notify(key:string):void;
  stopTarget(key:string):void;
}
export function createExecutionService(port:ExecutionState){
  const pending=new Map<string,{token:string;state:AssistantState;sessionId:string;scope:()=>boolean;resolve:(value:boolean)=>void}>();
  const generations=new Map<string,number>();
  const generation=(key:string)=>generations.get(key)||0;
  const next=(key:string)=>{const value=generation(key)+1;generations.set(key,value);return value;};
  function requestApproval(key:string,request:ApprovalRequest){
    const state=port.state(key), scope=port.scope(key), token=port.id();
    const previous=pending.get(key); previous?.resolve(false);
    state.pendingApproval={...request,token};
    const result=new Promise<boolean>(resolve=>pending.set(key,{token,state,sessionId:state.sessionId,scope,resolve}));
    port.changed(key);
    return result;
  }
  function pendingCurrent(key:string) {
    const item=pending.get(key);if(!item)return false;
    const state=item.state,actual=String((state.pendingApproval as Record<string,unknown>|null)?.token||'');
    return !!actual&&item.token===actual&&item.scope()&&port.state(key)===state&&state.sessionId===item.sessionId&&state.mode!=='chat'&&state.permission!=='suggest';
  }
  function settleApproval(key:string,approved:boolean,token=''){
    const item=pending.get(key);if(!item)return false;
    const state=item.state,actual=String((state.pendingApproval as Record<string,unknown>|null)?.token||'');
    if(!item||!actual||item.token!==actual||(token&&token!==actual))return false;
    const valid=pendingCurrent(key);
    pending.delete(key);state.pendingApproval=null;if(valid)port.changed(key);item.resolve(approved===true&&valid);return approved!==true||valid;
  }
  function cancelPending(key:string) {
    const item=pending.get(key);if(!item)return;
    pending.delete(key);
    if((item.state.pendingApproval as Record<string,unknown>|null)?.token===item.token)item.state.pendingApproval=null;
    item.resolve(false);
  }
  function stop(key:string){
    next(key); cancelPending(key); const state=port.state(key); state.agentQueue=[]; state.agentWaitingForInput=null; port.stopTarget(key); port.changed(key);
  }
  function canExecute(key:string,command:string,options:{mode?:string;permission?:string;sessionId?:string}={}){
    const state=port.state(key),scope=port.scope(key),permission=(options.permission||state.permission) as ExecutionPermission;
    if(!scope()||options.sessionId&&options.sessionId!==state.sessionId)return {allowed:false,reason:'stale-target'};
    if(options.mode==='chat'||state.mode==='chat')return {allowed:false,reason:'chat-read-only'};
    if(permission==='suggest')return {allowed:false,reason:'suggest-only'};
    if(!String(command||'').trim())return {allowed:false,reason:'empty-command'};
    return {allowed:true,reason:''};
  }
  function checkpoint(input:Omit<CheckpointRecord,'id'|'createdAt'|'status'|'verified'>):CheckpointRecord{
    return {id:port.id(),createdAt:port.now(),status:'pending',verified:false,...input};
  }
  function dispose(key:string){next(key);cancelPending(key);}
  return {requestApproval,pendingCurrent,settleApproval,stop,canExecute,checkpoint,generation,dispose,disposeAll(){for(const key of pending.keys())dispose(key);}};
}
