import {connectionStamp} from '../remote/management-types';
import {x11Error,type X11Port,type X11Diagnostics,type X11Result} from './x11-types';
import type {createXServerService} from './local-service';

export function x11RemoteActionKey(area: 'components' | 'clipboard' | 'forwarding', id: number): string {
  return area === 'clipboard' ? `x11-clipboard-${id}` : `x11-${area}:${id}`;
}

export function createX11RemoteService(port:X11Port,local:ReturnType<typeof createXServerService>){
 const locks=new Set<string>();let alive=true;const t=port.tr;
 function target(id:number){const c=port.connection(id);if(!alive||!Number.isSafeInteger(id)||id===0||!c)return null;const stamp=connectionStamp(c),scope=port.scope(),owner=port.owner(),key=c.quick_connection?port.sessionKey(id):'',session=key?port.session(key):undefined,token=session?.quickToken||c.quick_token;
  if(c.quick_connection&&(!session||!token))return null;return {connection:c,current:()=>alive&&scope()&&owner()&&!!port.connection(id)&&connectionStamp(port.connection(id)!)===stamp&&(!c.quick_connection||port.session(key)===session&&(session?.quickToken||session?.connection.quick_token)===token)};}
 async function operate(id:number,area:Parameters<typeof x11RemoteActionKey>[0],mode:string,button:HTMLElement|null=null,source='xserver'){
  const fixed=target(id),uninstall=mode==='uninstall',forward=area==='forwarding';
  if(!fixed||!['components','clipboard','forwarding'].includes(area)||!(forward?['enable','disable']:['online','offline','local-offline','uninstall']).includes(mode)||!port.unlocked(t('remote:admin.remote_management')))return null;
  const action=forward?mode:uninstall?'uninstall':mode==='offline'?'install-offline':mode==='local-offline'?'install-local-offline':'install',lock=x11RemoteActionKey(area,id);
  const busy=()=>t(forward?(action==='enable'?'common:x11.enabling':'common:x11.disabling'):uninstall?'common:auto.uninstalling':'common:auto.installing');
  if(locks.has(lock)||!port.begin(lock,button,busy))return null;locks.add(lock);
  const endpoint=forward?'x11-forwarding':area==='clipboard'?'x11-clipboard/helper':'x11-applications/install',probe=area==='components'?'x11-applications/install-plan':endpoint;
  const label=()=>t(mode==='local-offline'?'common:x11.local_offline':mode==='offline'?'common:x11.remote_cache':'common:x11.online');
  const title=()=>forward?t(action==='enable'?'common:x11.enable_ssh_forwarding':'common:x11.disable_ssh_forwarding'):area==='clipboard'?t(uninstall?'common:x11.remove_xclip':mode==='local-offline'?'common:x11.local_offline_title':'common:x11.install_xclip',{mode:label()}):t(uninstall?'common:x11.remove_remote_components':'common:x11.install_components_title',{mode:label()});
  const message=()=>t(forward?(action==='enable'?'common:x11.enable_forwarding_confirm':'common:x11.disable_forwarding_confirm'):area==='clipboard'?(uninstall?'common:x11.remove_xclip_confirm':mode==='local-offline'?'common:x11.local_offline_confirm':mode==='offline'?'common:x11.remote_cache_confirm':'common:x11.online_confirm'):(uninstall?'common:x11.remove_components_confirm':mode==='local-offline'?'common:x11.install_components_local_confirm':mode==='offline'?'common:x11.install_components_cache_confirm':'common:x11.install_components_online_confirm'));
  try{
   const before=await port.api(`/api/connections/${id}/${probe}`,area==='components'?{method:'POST',body:'{}'}:undefined) as X11Diagnostics&X11Result;
   if(!fixed.current()||before.error||[before.connectionId,before.connection_id].some(value=>value!==undefined&&Number(value)!==id))return null;
   const plan=before.install_plan||before.discovery?.install_plan||{},requires=forward?!before.can_manage:area==='clipboard'?!before.root:uninstall||plan.requires_password!==false;
   if(await local.hold(()=>port.ask({title,message,choices:[{value:'yes',label:()=>t(forward?(action==='enable'?'common:auto.enable':'common:auto.disable'):uninstall?'common:actions.remove':'common:actions.install'),danger:uninstall||action==='disable'},{value:'',label:()=>t('common:actions.cancel')}]}))!=='yes'||!fixed.current()||!port.unlocked(title()))return null;
   const grant=forward?'x11.sshd-config':area==='clipboard'?`x11.clipboard.${action}`:uninstall?'x11.remote-uninstall':mode==='local-offline'?'x11.remote-install-local-offline':mode==='offline'?'x11.remote-install-offline':'x11.remote-install';
   const auth=requires?await local.hold(()=>port.authorize(id,title(),grant)):null;
   if(requires&&!auth||!fixed.current()||!port.unlocked(title())||!port.restore(source,id))return null;
   port.busy(button,true,busy);const result=await port.api(`/api/connections/${id}/${endpoint}`,{method:'POST',body:JSON.stringify({action,...(auth?{admin_auth:auth}:{})})}) as X11Result;
   if(result.task){if(typeof result.task.id!=='string'||!result.task.id||result.task.id.length>200||Number(result.task.connection_id)!==id)throw Error(t('remote:admin.ssh_connection_missing'));
    const container=()=>fixed.current()?document.getElementById(area==='clipboard'?'x11ClipboardTaskState':area==='components'?'x11InstallTaskState':'x11ForwardingTaskState'):null;
    const accepted=await port.watch(result,title(),container,fixed.current);if(!accepted)return null;
   }
   if(fixed.current()&&port.restore(source,id)){if(source==='xserver')await local.refresh();else if(source==='install-guide')await guide(id);else if(source==='linux-desktop')await port.refreshLinux();}
   return result;
  }catch(e){port.notify(x11Error(e,t('common:x11.server_status_failed')),'error');return null;}finally{locks.delete(lock);port.end(lock,button);if(fixed.current())port.restore(source,id);}
 }
 let guideState:null|{id:number;revision:number;result?:X11Result;loading:boolean;error:string}=null,guideRequest=0;
 async function guide(id:number){const fixed=target(id);if(!fixed)return null;const own={id,revision:++guideRequest,loading:true,error:''} as NonNullable<typeof guideState>;guideState=own;
  port.guide.paint(id,{});
  try{const result=await port.api(`/api/connections/${id}/x11-applications/install-plan`,{method:'POST',body:'{}'}) as X11Result;
   if(!fixed.current()||guideState!==own)return null;own.result=result;own.loading=false;port.guide.paint(id,result);return result;
  }catch(e){if(guideState===own&&fixed.current()){own.error=x11Error(e,t('common:x11.guide_load_failed'));own.loading=false;port.guide.paint(id,{error:own.error});}return null;}
 }
 function closeGuide(){guideState=null;guideRequest++;port.guide.close();}
 function restoreGuide(id:number){if(!guideState||guideState.id!==id)return false;port.guide.paint(id,guideState.result||(guideState.error?{error:guideState.error}:{}));return true;}
 async function configureTerminal(id:number,action:string,source='xserver'){
  const fixed=target(id);if(!fixed||!['enable','disable'].includes(action)||!port.unlocked(t('remote:admin.remote_management')))return;
  try{const d=await port.api(`/api/connections/${id}/x11-forwarding`) as X11Diagnostics,commands=d.terminal_commands as Record<string,string>|undefined,command=String(commands?.[action]||'').trim();
   if(!fixed.current())return;if(!command)throw Error(t('common:x11.interactive_command_missing'));if(source==='xserver')local.close(true);return port.manual(id,command,'configure',action);
  }catch(e){port.notify(x11Error(e,t('common:x11.config_terminal_open_failed')),'error');}
 }
 return {actionKey:x11RemoteActionKey,operate,guide,closeGuide,restoreGuide,get guideState(){return guideState;},configureTerminal,dispose(){alive=false;closeGuide();}};
}
