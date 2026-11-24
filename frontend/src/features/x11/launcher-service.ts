import {connectionStamp} from '../remote/management-types';
import {x11Error,type X11Port,type X11Application,type X11Discovery,type X11Result} from './x11-types';
import type {createX11TerminalService} from './terminal-service';
export interface LauncherState {id:number;name:string;command:string;args:string;mode:string;selected:string;applications:X11Application[];discovery:X11Discovery|null;loading:boolean;busy:boolean;error:string}
export function createX11Launcher(port:X11Port,terminal:ReturnType<typeof createX11TerminalService>,paint:()=>void){
 let state:LauncherState|null=null,request=0,alive=true,scope=()=>true;const t=port.tr;
 function current(own:LauncherState,stamp:string){return alive&&scope()&&state===own&&!!port.connection(own.id)&&connectionStamp(port.connection(own.id)!)===stamp;}
 async function detect(){const own=state,c=own&&port.connection(own.id);if(!own||!c||own.busy||!port.unlocked(t('common:x11.manager')))return false;const sequence=++request,stamp=connectionStamp(c);own.loading=true;own.error='';paint();
  try{const result=await port.api(`/api/connections/${own.id}/x11-applications`,{method:'POST',body:'{}'}) as X11Result;if(!current(own,stamp)||sequence!==request)return false;
   own.discovery=result.discovery||{};own.applications=(own.discovery.applications||[]).filter(item=>typeof item?.id==='string');if(!own.command){select(own.applications[0]?.id||'custom');}return true;
  }catch(e){if(current(own,stamp)&&sequence===request)own.error=x11Error(e,t('common:x11.detection_failed'));return false;}finally{if(state===own&&sequence===request){own.loading=false;paint();}}
 }
 function open(id:number){const c=port.connection(id);if(!alive||!c||!port.unlocked(t('common:x11.manager')))return false;request++;scope=port.scope();state={id,name:c.name||'',command:'',args:'',mode:c.x11_mode==='trusted'?'trusted':'untrusted',selected:'custom',applications:[],discovery:null,loading:false,busy:false,error:''};paint();void detect();return true;}
 function select(id:string){if(!state||state.busy)return;state.selected=id;const app=state.applications.find(item=>item.id===id);state.command=app?.path||app?.command||'';state.args=app?.args||'';if(app?.mode==='trusted')state.mode='trusted';paint();}
 function change(field:'command'|'args'|'mode',value:string){if(!state||state.busy)return;state[field]=field==='mode'?(value==='trusted'?'trusted':'untrusted'):value;}
 async function submit(){const own=state,c=own&&port.connection(own.id);if(!own||!c||own.busy||own.loading)return false;const stamp=connectionStamp(c),app=own.applications.find(item=>item.id===own.selected);own.busy=true;own.error='';paint();
  try{const result=await terminal.launch(own.id,{command:own.command,args:own.args,mode:own.mode,kind:app?.kind,label:app?.label||own.command},()=>current(own,stamp));if(current(own,stamp)&&result){close();return true;}return false;
  }catch(e){if(current(own,stamp))own.error=x11Error(e,t('common:x11.launch_failed'));return false;}finally{if(state===own){own.busy=false;if(current(own,stamp))paint();else close();}}
 }
 function close(){request++;state=null;paint();}
 return {get state(){return state;},open,detect,select,change,submit,close,dispose(){alive=false;close();}};
}
