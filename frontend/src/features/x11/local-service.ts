import {connectionStamp} from '../remote/management-types';
import {x11Error,type X11Port,type X11Diagnostics,type X11Snapshot} from './x11-types';
export function createXServerService(port:X11Port){
 const state={connectionId:0,terminalKey:'',revision:0,opening:false,busy:false,suspended:0,kind:'manager' as 'manager'|'settings',snapshot:null as X11Snapshot|null,error:''};
 let alive=true,request=0,read:Promise<boolean>|null=null,mutation=false,headerRead:Promise<unknown>|null=null,timer:ReturnType<typeof setTimeout>|undefined,off:(()=>void)|undefined;
 const t=port.tr,visible=()=>state.kind==='settings'?port.manager.settingsVisible():port.manager.visible();
 const paint=()=>{if(!visible()&&!port.manager.canRestore())return;if(state.kind==='settings')port.manager.settings(state.snapshot?.diagnostics,state.error);else if(state.error)port.manager.error(state.error,()=>void refresh());else if(state.snapshot)port.manager.paint(state.snapshot);else port.manager.loading();};
 function close(force=false){if(state.suspended&&!force)return;state.revision++;request++;read=null;state.opening=false;state.snapshot=null;state.error='';port.manager.close();}
 async function refresh(){if(!alive)return false;const sequence=++request,revision=state.revision,id=state.connectionId,c=port.connection(id),stamp=c?connectionStamp(c):'',kind=state.kind;
  const current=()=>alive&&sequence===request&&revision===state.revision&&kind===state.kind&&(!id||!!port.connection(id)&&connectionStamp(port.connection(id)!)===stamp);
  state.opening=true;state.error='';
  const pending=(async()=>{try{const remote=async(endpoint:string)=>{if(!c)return null;if(!port.unlocked(t('remote:admin.remote_management')))return {error:t('remote:admin.ssh_connection_missing')};try{return await port.api(`/api/connections/${id}/${endpoint}`) as X11Diagnostics;}catch(e){return {error:x11Error(e),connectionId:id};}};
   const [diagnostics,sshX11,x11Clipboard]=await Promise.all([port.api('/api/xserver') as Promise<X11Diagnostics>,remote('x11-forwarding'),remote('x11-clipboard/helper')]);
   if(!current()||!visible())return false;state.snapshot={diagnostics,sshX11,x11Clipboard,connection:c?structuredClone(c):null};paint();port.header(diagnostics);return true;
  }catch(e){if(current()&&visible()){state.error=x11Error(e,t('common:x11.server_status_failed'));paint();}return false;}finally{if(current())state.opening=false;if(sequence===request)read=null;}})();read=pending;return pending;
 }
 async function open(id=0,key='',kind:'manager'|'settings'='manager'){
  if(!alive||!Number.isSafeInteger(id)||id!==0&&!port.connection(id)||visible()&&state.kind===kind)return false;const context=id?{connectionId:id,terminalKey:key}:kind==='settings'?{connectionId:0,terminalKey:''}:port.activeContext();
  close(true);state.connectionId=context.connectionId;state.terminalKey=context.terminalKey;state.kind=kind;state.snapshot=null;state.error='';if(kind==='settings')port.manager.settings();else port.manager.loading();return refresh();
 }
 async function hold<T>(work:()=>Promise<T>){state.suspended++;try{return await work();}finally{state.suspended--;}}
 function restore(){if(port.manager.canRestore()){paint();return true;}return visible();}
 async function ready(current=()=>true){
  try{let d=await port.api('/api/xserver') as X11Diagnostics;if(!alive||!current())return false;
   if(d.authorization_required){if(!await hold(()=>port.desktopAuthorize())||!current())return false;d=await port.api('/api/xserver') as X11Diagnostics;}
   if(!current()||d.authorization_required||d.integration_available===false){port.notify(port.reason(d,t('common:x11.standalone_backend_unavailable')),'error');return false;}
   if(d.can_start&&!d.available){d=await port.api('/api/xserver',{method:'POST',body:'{}'}) as X11Diagnostics;if(!current())return false;}
   if(d.available)return true;return await hold(()=>port.ask({title:()=>t('common:x11.server_not_ready_title'),message:()=>t('common:x11.server_not_ready_confirm',{reason:port.reason(d)}),choices:[{value:'yes',label:()=>t('common:x11.continue_anyway')},{value:'',label:()=>t('common:actions.cancel')}]}))==='yes'&&current();
  }catch(e){port.notify(x11Error(e,t('common:x11.server_status_failed')),'error');return false;}
 }
 async function operate(action:string,button:HTMLElement|null=null){
  if(!['start','stop','install'].includes(action)||mutation||!alive||!visible())return null;mutation=true;state.busy=true;const revision=state.revision,kind=state.kind,current=()=>alive&&state.revision===revision&&state.kind===kind;
  const busy=()=>t(action==='start'?'common:x11.starting_server':action==='stop'?'common:x11.stopping_server':'common:auto.installing');port.busy(button,true,busy);
  try{const before=await port.api('/api/xserver') as X11Diagnostics;if(!current()||before.authorization_required||before.integration_available===false||!before[`can_${action}`])return null;
   const linux=before.platform==='linux',title=()=>t(action==='stop'?'common:x11.stop_server_title':linux?'common:x11.install_linux_components_title':'common:x11.install_local_xquartz_title');
   if(action!=='start'&&await hold(()=>port.ask({title,message:()=>t(action==='stop'?'common:x11.stop_server_confirm':linux?'common:x11.install_linux_components_confirm':'common:x11.install_local_xquartz_confirm'),choices:[{value:'yes',label:()=>t(action==='stop'?'common:auto.stop':'common:actions.install'),danger:action==='stop'},{value:'',label:()=>t('common:actions.cancel')}]}))!=='yes')return null;
   if(!current()||!restore())return null;
   const latest=await port.api('/api/xserver') as X11Diagnostics;if(!current()||latest.authorization_required||latest.integration_available===false||latest.platform!==before.platform||!latest[`can_${action}`])return null;
   const result=await port.api(action==='install'?'/api/xserver/install':'/api/xserver',{method:action==='stop'?'DELETE':'POST',body:'{}'}) as {restart_required?:boolean};
   port.notify(t(action==='start'?'common:x11.server_started':action==='stop'?'common:x11.server_stopped':linux?'common:x11.linux_components_installed':result.restart_required?'common:x11.xquartz_installed_restart':'common:x11.xquartz_installed'),'success');if(current()&&visible())await refresh();void refreshHeader();return result;
  }catch(e){port.notify(x11Error(e,t('common:x11.server_status_failed')),'error');if(current()&&visible())await refresh();return null;}finally{mutation=false;state.busy=false;port.busy(button,false);if(current())restore();else if(visible())paint();}
 }
 function refreshHeader(){if(headerRead)return headerRead;const sequence=state.revision;headerRead=(async()=>{try{const d=await port.api('/api/xserver') as X11Diagnostics;if(alive&&sequence===state.revision)port.header(d);}catch{if(alive&&sequence===state.revision)port.header(null,true);}finally{headerRead=null;}})();return headerRead;}
 function schedule(){if(timer)port.cancel(timer);if(alive)timer=port.schedule(()=>{timer=undefined;if(!port.hidden())void refreshHeader();schedule();},30000);}
 function poll(){if(off||!alive)return;off=port.listen(()=>{if(!port.hidden())void refreshHeader();schedule();});void refreshHeader();schedule();}
 return {state,open,close,refresh,hold,restore,ready,operate,refreshHeader,poll,paint,dispose(){alive=false;close(true);if(timer)port.cancel(timer);off?.();off=undefined;}};
}
