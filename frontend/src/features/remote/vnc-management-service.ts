import {profileStamp,connectionStamp,type ManagementPort} from './management-types';
import type {RemoteProfile} from './profile-model';
import type {ProtocolView,ProtocolDiagnostics,ProtocolResult} from './protocol-service';
import type {VncCredentialResult, VncSessionPort} from './vnc-types';
import type {VncCursorMode} from './vnc-presentation';
import type {Ask} from '../forwards/forward-service';
export const vncServerEndpoint = (id: number) => `/api/remote-profiles/${id}/vnc/server`;
interface VncManagementDiagnostics extends ProtocolDiagnostics {start_plan?:{supports_no_password?:boolean;requires_vnc_password?:boolean};password_file?:string}
export interface VncManagementPort extends Omit<ManagementPort,'seedSsh'>, Pick<VncSessionPort,'prompt'> {connectionId(profile:RemoteProfile):number;capture(id:number,key:string,target:HTMLElement|null):ProtocolView;authorize(id:number,label:string,scope:string):Promise<{admin_grant_id:string}|null>;begin(id:number,button:HTMLElement|null,label:()=>string):boolean;end(id:number,button:HTMLElement|null):void;busy(button:HTMLElement|null,value:boolean,label?:string):void;replace(profile:RemoteProfile,updated:RemoteProfile):void;hasPassword(profile:RemoteProfile,value:boolean):void;launch(id:number,key:string,button:HTMLElement,mode:string,credentials:{password:string}):Promise<unknown>}
export function createVncManagementService(port:VncManagementPort,ask:Ask){const pending=new Set<number>(),requests=new Map<object,number>();let sequence=0,alive=true;const t=port.tr;
 function target(id:number){const profile=port.profile(id);if(!alive||!profile||profile.protocol!=='vnc'||!Number.isSafeInteger(id)||id<=0)return null;const stamp=profileStamp(profile),source=port.connectionId(profile),connection=port.connection(source),ssh=connection?connectionStamp(connection):'';return {profile,source,current:()=>alive&&!!port.profile(id)&&profileStamp(port.profile(id)!)===stamp&&port.connectionId(port.profile(id)!)===source&&(!source||!!port.connection(source)&&connectionStamp(port.connection(source)!)===ssh)};}
 async function read(id:number){const fixed=target(id);if(!fixed||!port.unlocked(t('remote:admin.remote_management')))return null;const d=await port.api(vncServerEndpoint(id)) as VncManagementDiagnostics;if(!fixed.current())return null;for(const source of [d?.connection_id,d?.ssh_connection?.id,d?.connection?.id])if(source!==undefined&&Number(source)!==fixed.source)throw Error(t('remote:admin.ssh_connection_missing'));return d;}
 async function inspect(id:number,button:HTMLElement|null=null,container:HTMLElement|null=null,provided?:ProtocolView){const fixed=target(id);if(!fixed)return null;const view=provided||port.capture(id,`remote-desktop-${id}`,container),request=++sequence;requests.set(view.owner,request);port.busy(button,true,t('remote:diagnostics.detecting'));if(view.current())view.loading();
  try{const endpoint=port.api(`/api/remote-profiles/${id}/connectivity`).catch(error=>({supported:true,ok:false,error:error instanceof Error?error.message:t('remote:diagnostics.port_probe_failed')}));let d:VncManagementDiagnostics;
   if(!fixed.source)d={diagnostics_available:false,management_available:false,status:'unmanaged',error:''};else try{d=await read(id)||{};}catch(error){const e=error as {message?:string;code?:string};d={error:e.message||t('remote:vnc_status.ssh_probe_failed'),code:e.code||'',connectionId:fixed.source};}
   d={...d,endpoint_probe:await endpoint};if(fixed.current()&&view.current()&&requests.get(view.owner)===request)view.render(d);return fixed.current()?d:null;
  }finally{if(requests.get(view.owner)===request)requests.delete(view.owner);port.busy(button,false);}
 }
 async function save(profile:RemoteProfile,password:string){const fixed=target(Number(profile.id));if(!fixed||!fixed.current()||!port.unlocked(t('remote:vnc_ui.save_password')))throw Error(t('remote:vnc_ui.encryption_locked'));const result=await port.api(`/api/remote-profiles/${profile.id}/vnc-credential`,{method:'PUT',body:JSON.stringify({password})}) as {has_password?:boolean};if(fixed.current())port.hasPassword(profile,Boolean(result.has_password));return result;}
 async function launchWithTemporaryPassword(id: number, key: string, button: HTMLElement, mode: string) {
   const fixed = target(id);
   if (!fixed) {
     port.notify(t('remote:vnc_status.connection_missing'), 'error');
     return null;
   }
   const tabCurrent = port.scope();
   const result = await port.prompt(fixed.profile, ['password'], {
     title: () => t('remote:vnc_ui.use_other_password_title', {name: fixed.profile.name}),
     submitLabel: () => t('remote:vnc_ui.use_other_password_submit'),
     updateByDefault: false,
     passwordStorageHint: () => t('remote:vnc_ui.temporary_password_hint')
   });
   if (!result) return null;
   try {
     const password = result.credentials.password;
     if (!password || !tabCurrent() || !fixed.current()) return null;
     if (result.update_saved_password) {
       try {
         await save(fixed.profile, password);
       } catch (error) {
         port.notify(t('remote:vnc_ui.password_save_failed', {error: error instanceof Error ? error.message : ''}), 'error');
       }
     }
     if (!tabCurrent() || !fixed.current()) return null;
     return port.launch(id, key, button, mode, {password});
   } finally {
     result.credentials.password = '';
   }
 }
 async function operate(id:number,key:string,action:string,button:HTMLElement|null=null){const fixed=target(id),allowed=['install','install-offline','install-local-offline','uninstall','start','stop','restart','enable','disable','change-password'];if(!fixed||!allowed.includes(action)||!port.unlocked(t('remote:admin.remote_management')))return null;if(!fixed.source){port.notify(t('remote:vnc_ui.no_ssh_management'),'error');return null;}
  const install=action.startsWith('install'),stop=['stop','disable'].includes(action),uninstall=action==='uninstall',change=action==='change-password',mode=()=>t('remote:vnc_ui.'+(action==='install-local-offline'?'mode_local_offline':action==='install-offline'?'mode_remote_cache':'mode_online'));
  const title=()=>install?t('remote:vnc_ui.install_service_action',{mode:mode()}):t('remote:vnc_ui.'+(change?'change_password_action':uninstall?'uninstall_service_action':stop?'stop_service_action':'start_service_action'));
  const busy=()=>t('remote:vnc_ui.'+(install?'installing':change?'changing_password':uninstall?'uninstalling':stop?'stopping':'starting'));
  if(pending.has(id)||!port.begin(id,button,busy)){port.notify(t('remote:vnc_ui.task_running'),'info');return null;}pending.add(id);let view:ProtocolView|undefined;const same=()=>fixed.current()&&view?.current();let secret='',noPassword=false,store=false,clear=false,credentials:VncCredentialResult|null=null;
  try{view=port.capture(id,key,null);const d=await read(id);if(!d||!same())return null;if(d.error)throw Error(d.error);const support=d.start_plan?.supports_no_password===true,requires=d.start_plan?.requires_vnc_password===true;
   if(change||['start','restart','enable'].includes(action)&&!fixed.profile.has_password&&!d.password_file&&(support||requires)){
    credentials=await port.prompt(fixed.profile,['password'],{failureReason:()=>t('remote:vnc_ui.'+(change?'change_password_hint':support?'password_missing_optional':'password_missing_required')),allowNoPassword:support,noPasswordLabel:()=>change?t('remote:vnc_ui.clear_service_password'):'',passwordStorageHint:()=>change?t('remote:vnc_ui.change_password_storage_hint'):'',updateByDefault:true,title:()=>t('remote:vnc_ui.'+(change?'change_service_password':support?'set_service_auth':'set_service_password')),submitLabel:()=>t('remote:vnc_ui.'+(change?'save_and_change':'save_continue'))});
    if(!credentials||!same())return null;noPassword=credentials.allow_no_password===true;if(noPassword&&!support)return null;secret=String(credentials.credentials.password||'');if(!secret&&!noPassword)return null;store=!noPassword&&!!credentials.update_saved_password&&!!secret;clear=noPassword||change&&!credentials.update_saved_password&&fixed.profile.has_password===true;
   }
   const message=()=>install?action==='install-local-offline'?t('remote:vnc_ui.confirm_local_offline_install'):t('remote:vnc_ui.confirm_remote_install',{mode:t(action==='install-offline'?'remote:vnc_ui.cache_offline':'remote:vnc_ui.online')}):t('remote:vnc_ui.'+(change?noPassword?'confirm_change_passwordless':'confirm_change_password':uninstall?'confirm_uninstall':stop?'confirm_stop':'confirm_start'));
   if(await ask({title,message,choices:[{value:'yes',label:()=>t('remote:vnc_ui.'+(install?'install':change?'save_and_change':uninstall?'uninstall':stop?'stop':'start')),danger:uninstall||stop||change&&noPassword},{value:'',label:()=>t('common:actions.cancel')}]})!=='yes'||!same()||!port.unlocked(title()))return null;
   let auth:null|{admin_grant_id:string}=null;if(d.privileged!==true){auth=await port.authorize(fixed.source,title(),`vnc.server.${action}`);if(!auth)return null;}if(!same()||!port.unlocked(title()))return null;view.pending(busy);
   const result=await port.api(vncServerEndpoint(id),{method:'POST',body:JSON.stringify({action,allow_no_password:noPassword,...(secret?{vnc_password:secret}:{}),...(auth?{admin_auth:auth}:{})})}) as ProtocolResult;
   if((store||clear)&&!result.task_conflict&&fixed.current()){try{await save(fixed.profile,clear?'':secret);}catch(error){port.notify(t('remote:vnc_ui.password_save_failed_after_submit',{error:error instanceof Error?error.message:''}),'info');}}
   secret='';if(credentials)credentials.credentials.password='';
   if(result.task){if(typeof result.task.id!=='string'||!result.task.id||result.task.id.length>200||Number(result.task.connection_id)!==fixed.source)throw Error(t('remote:admin.ssh_connection_missing'));const accepted=await view.watch(result,title(),active=>inspect(id,null,null,active));return accepted?result:null;}
   if(same())view.render(result.after||result.before||d);port.notify(t('remote:vnc_ui.'+(install?'install_complete':change?'change_password_complete':uninstall?'uninstall_complete':stop?'stop_complete':'configure_start_complete')),'success');return result;
  }catch(error){const message=error instanceof Error?error.message:t('remote:vnc_ui.operation_failed');if(same())view?.render({operation_error:message});port.notify(message,'error');return null;}
  finally{secret='';if(credentials)credentials.credentials.password='';try{view?.finish();}finally{pending.delete(id);port.end(id,button);}}
 }
 function install(id:number,key:string,button:HTMLElement|null=null,mode='online'){
  switch(mode){
   case 'online': return operate(id,key,'install',button);
   case 'offline': case 'install-offline': return operate(id,key,'install-offline',button);
   case 'local-offline': case 'install-local-offline': return operate(id,key,'install-local-offline',button);
   default: return null;
  }
 }
 async function updateOptions(fixed:NonNullable<ReturnType<typeof target>>,changes:Record<string,string>,errorKey:string){
  const id=Number(fixed.profile.id);
  const updated=await port.api(`/api/remote-profiles/${id}`,{method:'PUT',body:JSON.stringify({options:{...fixed.profile.options,...changes}})}) as RemoteProfile | null;
  if(!fixed.current())return false;
  if(Number(updated?.id)!==id||updated?.protocol!=='vnc')throw Error(t(errorKey));
  port.replace(fixed.profile,updated);return updated;
 }
 async function cursor(profile:RemoteProfile,mode:VncCursorMode){
  const id=Number(profile.id),fixed=target(id);
  if(!fixed||profileStamp(fixed.profile)!==profileStamp(profile)||pending.has(id))return false;
  pending.add(id);
  try{return await updateOptions(fixed,{cursor_mode:mode},'remote:notifications.profile_save_failed');}
  finally{pending.delete(id);}
 }
 async function source(id:number,value:string,key:string,container:HTMLElement|null=null){const fixed=target(id),[mode,display='']=value.split('|');if(!fixed||!mode||!['auto','shared','virtual'].includes(mode)||mode==='shared'&&display&&!/^:\d{1,4}(?:\.\d{1,2})?$/.test(display)||pending.has(id)||!port.unlocked(t('remote:admin.remote_management')))return false;const view=port.capture(id,key,container);pending.add(id);
  try{const updated=await updateOptions(fixed,{server_session_mode:mode,server_display:mode==='shared'?display:''},'remote:vnc_status.source_save_failed');if(!updated)return false;const stamp=profileStamp(updated),d=await read(id),saved=port.profile(id);if(d&&saved&&view.current()&&profileStamp(saved)===stamp)view.render(d);port.notify(t('remote:vnc_status.source_saved'),'success');return true;
  }catch(error){port.notify(error instanceof Error?error.message:t('remote:vnc_status.source_save_failed'),'error');return false;}finally{pending.delete(id);}
 }
 async function saveSourceSelection(id:number,select:HTMLSelectElement,key=`remote-desktop-${id}`){
  if(select.disabled)return false;
  select.disabled=true;
  try{return await source(id,select.value||'auto',key||`remote-desktop-${id}`,select.closest<HTMLElement>('#vncServerState'));}
  finally{if(select.isConnected)select.disabled=false;}
 }
 return {read,inspect,save,operate,install,source,saveSourceSelection,cursor,launchWithTemporaryPassword,dispose(){alive=false;requests.clear();}};
}
