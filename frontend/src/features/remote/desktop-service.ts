import {connectionStamp,type ManagementPort} from './management-types';
import type {DesktopDiagnostics,DesktopX11Status} from './resource-probe';
import type {Ask} from '../forwards/forward-service';
export interface DesktopTask {id:string;connection_id:number;status:string;action?:string;progress?:number;stage?:string;desktop_label?:string;error?:string;created_at?:number;updated_at?:number;logs?:{at?:number;stream?:string;text?:string}[]}
export interface DesktopPort extends ManagementPort {
 probe(id:number):Promise<{diagnostics:DesktopDiagnostics;sshX11:DesktopX11Status}>;
 authorize(id:number,label:string,scope:string):Promise<{admin_grant_id:string}|null>;
 paint():void;paintTask(task:DesktopTask):void;resetLog(id?:string):void;
 show(id:number,updateTab:boolean):void;selectTab(id:number):void;
 label(id:string):string;options(id:string):unknown;
 begin(id:number,button:HTMLElement|null,label:()=>string):boolean;end(id:number,button:HTMLElement|null):void;
 jobs():void;schedule(callback:()=>void,delay:number):unknown;unschedule(timer:unknown):void;
}
export const desktopTaskRunning=(task:DesktopTask|null|undefined)=>['running','pending','queued'].includes(String(task?.status||'').toLowerCase());
export function createDesktopService(port:DesktopPort,ask:Ask){
 const state={connectionId:0,diagnostics:null as DesktopDiagnostics|null,sshX11:null as DesktopX11Status|null,error:null as {message:string;code:string;issues:unknown[];connectionId:number}|null,loading:false,taskId:'',task:null as DesktopTask|null,logs:[] as NonNullable<DesktopTask['logs']>};
 const actions=new Set<number>(),monitors=new Map<string,{connectionId:number;task:DesktopTask|null;timer:unknown;promise:Promise<DesktopTask|null>;finish(task:DesktopTask|null):void}>();
 let selection=0,probeVersion=0,alive=true;const t=port.tr;
 const valid=(id:number)=>Number.isSafeInteger(id)&&!!id&&!!port.connection(id);
 const active=(id:number,version:number)=>alive&&state.connectionId===id&&selection===version;
 const checkedTask=(task:unknown,id:number,taskId?:string):DesktopTask=>{const value=task as DesktopTask;if(!value||typeof value.id!=='string'||!value.id||value.id.length>200||Number(value.connection_id)!==id||taskId&&value.id!==taskId)throw Error(t('remote:admin.ssh_connection_missing'));return value;};
 function monitorFor(id:number){return [...monitors.values()].filter(item=>item.connectionId===id&&desktopTaskRunning(item.task)).sort((a,b)=>Number(b.task?.updated_at||b.task?.created_at||0)-Number(a.task?.updated_at||a.task?.created_at||0))[0]||null;}
 function adopt(task:DesktopTask){state.taskId=task.id;state.task=task;state.logs=task.logs||[];port.resetLog(task.id);port.paint();}
 function choose(id:number){selection++;probeVersion++;state.connectionId=valid(id)?id:0;state.diagnostics=null;state.sshX11=null;state.error=null;state.loading=!!state.connectionId;state.taskId='';state.task=null;state.logs=[];const found=monitorFor(state.connectionId);if(found?.task)adopt(found.task);port.resetLog(found?.task?.id);}
 async function load(){const id=state.connectionId;if(!valid(id))return;const version=selection,request=++probeVersion,stamp=connectionStamp(port.connection(id)!);state.loading=true;state.error=null;port.paint();
  try{const result=await port.probe(id);if(!active(id,version)||request!==probeVersion||connectionStamp(port.connection(id)!)!==stamp)return;state.diagnostics=result.diagnostics;state.sshX11=result.sshX11;state.loading=false;port.paint();}
  catch(error){if(!active(id,version)||request!==probeVersion)return;const failure=error as {message?:string;code?:string;details?:{issues?:unknown[]};issues?:unknown[]};state.diagnostics=null;state.error={message:failure.message||t('common:notifications.exact.linux_desktop_probe_failed'),code:failure.code||'',issues:failure.details?.issues||failure.issues||[],connectionId:id};state.loading=false;port.paint();port.notify(port.localize(state.error.message),'error');}
 }
 async function restore(id:number){if(!valid(id)||monitorFor(id))return null;const version=selection;
  try{const result=await port.api('/api/linux-desktop/tasks');const task=(Array.isArray(result)?result:[]).filter((item:DesktopTask)=>Number(item.connection_id)===id&&desktopTaskRunning(item)).sort((a:DesktopTask,b:DesktopTask)=>Number(b.updated_at||b.created_at||0)-Number(a.updated_at||a.created_at||0))[0];if(!task||!alive)return null;checkedTask(task,id);if(active(id,version)&&!desktopTaskRunning(state.task))adopt(task);void poll(task.id,id,null,task);return task;}catch{return null;}
 }
 function open(id=0,updateTab=true){if(state.connectionId!==id)choose(id);port.show(state.connectionId,updateTab);port.paint();if(state.connectionId){void load();void restore(state.connectionId);}}
 function select(id:number){choose(id);port.selectTab(state.connectionId);port.paint();if(state.connectionId){void load();void restore(state.connectionId);}}
 async function operate(desktopId:string,action:'install'|'uninstall',mode='',button:HTMLElement|null=null){
  const id=state.connectionId,version=selection,connection=port.connection(id),diagnostics=state.diagnostics;if(!connection||!valid(id)){port.notify(t('remote:linux_desktop.select_management_connection'),'info');return null;}
  if(actions.has(id)){port.notify(t('remote:linux_desktop.task_running'),'info');return null;}
  if(action==='install'&&!mode)return port.options(desktopId);
  if(!/^[a-z][a-z0-9-]{0,39}$/.test(desktopId)||action==='install'&&!['online','offline','local-offline'].includes(mode))return null;
  if(!diagnostics||diagnostics.platform_supported===false||state.loading||!port.unlocked(t('remote:admin.remote_management')))return null;
  if(action==='install'&&!diagnostics.desktop_install_plans?.[desktopId])return null;
  if(action==='uninstall'&&!diagnostics.desktops?.some(item=>item.id===desktopId))return null;
  const stamp=connectionStamp(connection),same=()=>active(id,version)&&state.diagnostics===diagnostics&&!!port.connection(id)&&connectionStamp(port.connection(id)!)===stamp;
  const modeKey=mode==='local-offline'?'mode_local_offline':mode==='offline'?'mode_remote_cache':'mode_online',label=port.label(desktopId),title=()=>action==='uninstall'?t('remote:linux_desktop.uninstall_title'):t('remote:linux_desktop.install_mode_title',{mode:t('remote:linux_desktop.'+modeKey)});
  if(!port.begin(id,button,()=>t(action==='uninstall'?'common:auto.uninstalling':'common:auto.installing'))){port.notify(t('remote:linux_desktop.task_running'),'info');return null;}
  actions.add(id);
  let handedOff=false;
  try{
   const confirm=action==='uninstall'?'uninstall_confirm':mode==='local-offline'?'confirm_local_offline':mode==='offline'?'confirm_remote_cache':'confirm_online';
   if(await ask({title,message:()=>t('remote:linux_desktop.'+confirm,{desktop:label}),choices:[{value:'yes',label:()=>t(action==='uninstall'?'common:actions.remove':'common:actions.install'),danger:true},{value:'',label:()=>t('common:actions.cancel')}]})!=='yes'||!same()||!port.unlocked(title()))return null;
   let auth:null|{admin_grant_id:string}=null;const scope=action==='uninstall'?'linux-desktop.uninstall':mode==='local-offline'?'linux-desktop.install-local-offline':mode==='offline'?'linux-desktop.install-offline':'linux-desktop.install';
   if(!diagnostics.privileged){auth=await port.authorize(id,title(),scope);if(!auth)return null;}
   if(!same()||!port.unlocked(title()))return null;
   const task=checkedTask(await port.api(`/api/connections/${id}/linux-desktop/${action}`,{method:'POST',body:JSON.stringify({desktop_id:desktopId,...(action==='install'?{mode}:{}),...(auth?{admin_auth:auth}:{})})}),id);
   if(active(id,version))adopt(task);port.jobs();handedOff=true;void poll(task.id,id,button,task);return task;
  }catch(error){port.notify(error instanceof Error?error.message:t(action==='uninstall'?'remote:linux_desktop.uninstall_start_failed':'remote:linux_desktop.install_start_failed',{mode:t('remote:linux_desktop.'+modeKey)}),'error');return null;}
  finally{if(!handedOff){actions.delete(id);port.end(id,button);if(state.connectionId===id)port.paint();}}
 }
 function poll(taskId:string,id=state.connectionId,button:HTMLElement|null=null,initial:DesktopTask|null=null):Promise<DesktopTask|null>{
  if(!alive||!Number.isSafeInteger(id)||!id||!taskId||taskId.length>200)return Promise.resolve(null);const existing=monitors.get(taskId);if(existing)return existing.connectionId===id?existing.promise:Promise.resolve(null);
  let resolve!:(value:DesktopTask|null)=>void;const promise=new Promise<DesktopTask|null>(done=>{resolve=done;});
  const entry={connectionId:id,task:initial,timer:null as unknown,promise,finish:(task:DesktopTask|null)=>{if(entry.timer)port.unschedule(entry.timer);if(monitors.get(taskId)!==entry)return;monitors.delete(taskId);actions.delete(id);port.end(id,button);if(alive&&state.connectionId===id)port.paint();resolve(task);}};
  monitors.set(taskId,entry);actions.add(id);port.begin(id,button,()=>t('remote:linux_desktop.task_in_progress'));
  const visible=()=>alive&&state.connectionId===id&&state.taskId===taskId;
  const tick=async()=>{try{const task=checkedTask(await port.api('/api/linux-desktop/tasks/'+encodeURIComponent(taskId)),id,taskId);if(monitors.get(taskId)!==entry||!alive)return;entry.task=task;if(visible()){state.task=task;state.logs=task.logs||[];port.paintTask(task);}
    if(['done','failed','cancelled'].includes(task.status.toLowerCase())){port.jobs();if(visible()){state.taskId='';const action=t(task.action==='uninstall'?'remote:linux_desktop.action_uninstall':'remote:linux_desktop.action_install');if(task.status==='done'){port.notify(t('remote:linux_desktop.task_complete_redetect',{action}),'success');await load();}else{port.paint();port.notify(task.status==='cancelled'?t('remote:linux_desktop.task_cancelled',{action}):task.error||t('remote:linux_desktop.task_operation_failed',{action}),task.status==='cancelled'?'info':'error');}}entry.finish(task);return;}
    entry.timer=port.schedule(()=>void tick(),900);
   }catch(error){if(visible())port.notify(error instanceof Error?error.message:t('remote:linux_desktop.task_log_read_failed'),'error');entry.finish(null);}};
  void tick();return promise;
 }
 async function openTask(id:number,taskId:string){open(id);try{const task=checkedTask(await port.api('/api/linux-desktop/tasks/'+encodeURIComponent(taskId)),id,taskId);if(state.connectionId!==id)return null;adopt(task);if(desktopTaskRunning(task))void poll(task.id,id,null,task);return task;}catch(error){port.notify(error instanceof Error?error.message:t('remote:linux_desktop.task_log_read_failed'),'error');return null;}}
 function dispose(){alive=false;selection++;probeVersion++;for(const monitor of monitors.values())monitor.finish(null);}
 return {state,open,select,load,restore,poll,openTask,monitorFor,running:desktopTaskRunning,install:(id:string,mode='',button:HTMLElement|null=null)=>operate(id,'install',mode,button),uninstall:(id:string,button:HTMLElement|null=null)=>operate(id,'uninstall','',button),dispose};
}
