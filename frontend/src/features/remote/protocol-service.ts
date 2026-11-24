import {connectionStamp,profileStamp,type ManagementPort} from './management-types';
import {endpointProbeFailure} from './management-diagnostics';
import {protocolOperation,type ManagedProtocol} from './protocol-policy';
import type {RemoteProfile} from './profile-model';
import type {Ask} from '../forwards/forward-service';
export interface ProtocolDiagnostics {privileged?:boolean;error?:string;code?:string;connectionId?:number;connection?:{id:number};ssh_connection?:{id:number};management_available?:boolean;endpoint_probe?:unknown;[key:string]:unknown}
export interface ProtocolTask {id:string;connection_id:number;[key:string]:unknown}
export interface ProtocolResult {task?:ProtocolTask;before?:ProtocolDiagnostics;after?:ProtocolDiagnostics;task_conflict?:boolean;conflict_same_action?:boolean;[key:string]:unknown}
export interface ProtocolView {owner:object;current():boolean;loading():void;render(diagnostics:ProtocolDiagnostics):void;pending(label:()=>string):void;finish():void;watch(result:ProtocolResult,title:string,done:(view:ProtocolView)=>Promise<unknown>):Promise<boolean>}
export interface ProtocolPort extends ManagementPort {
 connectionId(profile:RemoteProfile):number;
 authorize(id:number,label:string,scope:string):Promise<{admin_grant_id:string}|null>;
 capture(id:number,protocol:ManagedProtocol,key:string,container:HTMLElement|null):ProtocolView;
 busy(button:HTMLElement|null,value:boolean,label?:()=>string):void;
 begin(id:number,protocol:ManagedProtocol,button:HTMLElement|null,label:()=>string):boolean;
 end(id:number,protocol:ManagedProtocol,button:HTMLElement|null):void;
}
export function createProtocolService(port:ProtocolPort,ask:Ask){
 const mutations=new Set<string>(),requests=new Map<object,number>();let alive=true,sequence=0;
 const t=port.tr,validId=(id:number)=>Number.isSafeInteger(id)&&id>0;
 function target(id:number,protocol:ManagedProtocol){const profile=port.profile(id);if(!alive||!validId(id)||profile?.protocol!==protocol)return null;const source=port.connectionId(profile),connection=port.connection(source),stamp=profileStamp(profile),sshStamp=connection?connectionStamp(connection):'';
  return {source,current:()=>alive&&!!port.profile(id)&&profileStamp(port.profile(id)!)===stamp&&port.connectionId(port.profile(id)!)===source&&(!source||!!port.connection(source)&&connectionStamp(port.connection(source)!)===sshStamp)};
 }
 const errorMessage=(error:unknown,fallback:string)=>{const failure=error as {message?:string};return failure?.message||fallback;};
 async function read(id:number,protocol:ManagedProtocol){const fixed=target(id,protocol);if(!fixed||!fixed.source||!port.unlocked(t('remote:admin.remote_management')))return null;const diagnostics=await port.api(`/api/remote-profiles/${id}/${protocol}/server`) as ProtocolDiagnostics;
  if(!fixed.current())return null;
  const reported=[diagnostics?.connection?.id,diagnostics?.ssh_connection?.id,diagnostics?.connection_id].filter(value=>value!==undefined);
  if(!diagnostics||typeof diagnostics!=='object'||reported.some(value=>Number(value)!==fixed.source))throw Error(t('remote:admin.ssh_connection_missing'));
  return diagnostics;
 }
 async function inspect(id:number,protocol:ManagedProtocol,button:HTMLElement|null=null,container:HTMLElement|null=null,provided?:ProtocolView){
  const fixed=target(id,protocol);if(!fixed)return null;const view=provided||port.capture(id,protocol,`remote-desktop-${id}`,container),request=++sequence;requests.set(view.owner,request);
  port.busy(button,true,()=>t('remote:diagnostics.detecting'));if(view.current())view.loading();
  try{
   const endpoint=port.api(`/api/remote-profiles/${id}/connectivity`).catch(error=>endpointProbeFailure(error,protocol==='rdp'?'tcp':'xdmcp-query'));
   let diagnostics:ProtocolDiagnostics;
   if(!fixed.source)diagnostics={management_available:false,code:'REMOTE_MANAGEMENT_SSH_REQUIRED',error:t(`remote:${protocol==='rdp'?'rdp_status':'xdmcp_status'}.ssh_management_optional`)};
   else try{diagnostics=await read(id,protocol)||{error:t('remote:admin.ssh_connection_missing')};diagnostics={...diagnostics,management_available:true};}
   catch(error){const failure=error as {code?:string};diagnostics={management_available:true,error:errorMessage(error,t(`remote:${protocol==='rdp'?'rdp_status':'xdmcp_status'}.ssh_probe_failed`)),code:failure?.code||'',connectionId:fixed.source};}
   diagnostics={...diagnostics,endpoint_probe:await endpoint};
   if(fixed.current()&&view.current()&&requests.get(view.owner)===request)view.render(diagnostics);
   return fixed.current()?diagnostics:null;
  }finally{if(requests.get(view.owner)===request)requests.delete(view.owner);port.busy(button,false);}
 }
 async function operate(id:number,protocol:ManagedProtocol,action:string,mode='online',button:HTMLElement|null=null,key=`remote-desktop-${id}`){
  const policy=protocolOperation(protocol,action,mode,t),fixed=target(id,protocol),lock=`${protocol}:${id}`;
  if(!policy||!fixed||!fixed.source||!port.unlocked(t('remote:admin.remote_management')))return null;
  if(mutations.has(lock)||!port.begin(id,protocol,button,policy.busy)){port.notify(t(`remote:${protocol==='rdp'?'rdp_status':'xdmcp_setup'}.task_running`),'info');return null;}
  mutations.add(lock);const view=port.capture(id,protocol,key,null),same=()=>fixed.current()&&view.current();
  try{
   // Refresh privileges for this exact source; DOM diagnostics are presentation only.
   const diagnostics=await read(id,protocol);if(!diagnostics||!same())return null;if(diagnostics.error){view.render(diagnostics);port.notify(diagnostics.error,'error');return null;}
   if(await ask({title:policy.title,message:policy.message,choices:[{value:'yes',label:policy.confirm,danger:policy.danger},{value:'',label:()=>t('common:actions.cancel')}]})!=='yes'||!same()||!port.unlocked(policy.title()))return null;
   let auth:null|{admin_grant_id:string}=null;
   if(diagnostics.privileged!==true){auth=await port.authorize(fixed.source,policy.title(),policy.scope);if(!auth)return null;}
   if(!same()||!port.unlocked(policy.title()))return null;
   view.pending(policy.busy);
   const result=await port.api(`/api/remote-profiles/${id}/${protocol}/server`,{method:'POST',body:JSON.stringify({...policy.body,...(auth?{admin_auth:auth}:{})})}) as ProtocolResult;
   if(result.task){if(typeof result.task.id!=='string'||!result.task.id||result.task.id.length>200||Number(result.task.connection_id)!==fixed.source)throw Error(t('remote:admin.ssh_connection_missing'));
    const accepted=await view.watch(result,policy.title(),active=>inspect(id,protocol,null,null,active));return accepted?result:null;}
   if(same()){const after=result.after||result.before;if(after)view.render(after);else await inspect(id,protocol,null,null,view);}
   port.notify(policy.success(),'success');return result;
  }catch(error){const message=errorMessage(error,policy.failure());if(same())view.render({error:message,management_available:true,connectionId:fixed.source});port.notify(message,'error');return null;}
  finally{view.finish();mutations.delete(lock);port.end(id,protocol,button);}
 }
 return {read,inspect,operate,dispose(){alive=false;requests.clear();}};
}
