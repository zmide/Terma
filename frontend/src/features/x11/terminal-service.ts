import {connectionStamp} from '../remote/management-types';
import type {X11Port,X11Connection,X11Result} from './x11-types';
import type {createXServerService} from './local-service';
export interface X11Launch {command:string;args?:string;label?:string;kind?:string;mode?:string}
export function createX11TerminalService(port:X11Port,local:ReturnType<typeof createXServerService>){
 let alive=true;const locks=new Set<number>(),t=port.tr;
 const mode=(value:string)=>['trusted','untrusted'].includes(value)?value:'off';
 function target(id:number){const c=port.connection(id);if(!alive||!c||!Number.isSafeInteger(id)||!id)return null;const stamp=connectionStamp(c),scope=port.scope(),owner=port.owner();return {connection:structuredClone(c),current:()=>alive&&scope()&&owner()&&!!port.connection(id)&&connectionStamp(port.connection(id)!)===stamp};}
 const valid=()=>port.unlocked(t('common:x11.manager'));
 async function persist(id:number,value:string,current=()=>true){if(!['trusted','untrusted','off'].includes(value)||!current()||!valid()||port.connection(id)?.quick_connection||id<1)return false;await port.api(`/api/connections/${id}/x11-mode`,{method:'POST',body:JSON.stringify({mode:value})});if(!current())return false;await port.reload();return current();}
 function open(c:X11Connection,value:string){const key=port.next(c.id),title=`${c.name} · ${value==='off'?t('common:x11.ordinary_terminal'):value==='trusted'?t('common:auto.trusted_x11'):'X11'}`;port.override(key,{...port.startup(c),x11_mode:value});return port.openTerminal(c.id,key,title);}
 async function run(id:number,work:(fixed:NonNullable<ReturnType<typeof target>>)=>Promise<unknown>){const fixed=target(id);if(!fixed||locks.has(id)||!valid())return false;locks.add(id);try{return await work(fixed);}finally{locks.delete(id);}}
 async function change(id:number,value:string,scope:'current'|'new'|'next'='next',preferred=''){
  if(!['trusted','untrusted','off'].includes(value))return false;
  return run(id,async fixed=>{const key=scope==='current'?port.sessionKey(id,preferred):'',session=key?port.session(key):undefined;if(scope==='current'&&(!session||session.connection.quick_connection||Number(session.id)!==id))throw Error(t('common:x11.current_terminal_missing'));
   if(scope!=='next'&&value!=='off'&&!await local.ready(fixed.current)||!fixed.current()||!valid())return false;
   if(!await persist(id,value,fixed.current))return false;const c=port.connection(id)!;
   if(scope==='current'){if(port.session(key)!==session)return false;port.override(key,{...port.startup(c,key),x11_mode:value});port.updateTerminal(key,c);port.reconnect(id,key);return true;}
   if(scope==='new')return open(c,value);
   port.notify(t(value==='off'?'common:x11.default_forwarding_disabled':'common:x11.default_mode_saved',{mode:t(value==='trusted'?'common:auto.trusted_x11':'common:auto.untrusted_x11')}),'success');return true;
  });
 }
 async function temporary(id:number,value='untrusted'){return run(id,async fixed=>{const normalized=mode(value);if(fixed.connection.quick_connection)return quick(port.sessionKey(id),normalized);if(normalized!=='off'&&!await local.ready(fixed.current)||!fixed.current()||!valid())return false;return open(fixed.connection,normalized);});}
 async function quick(key:string,value='untrusted'){const session=port.session(key),token=session?.quickToken||session?.connection.quick_token;if(!session?.connection.quick_connection||!token||!valid())return false;const current=()=>alive&&port.session(key)===session&&(session.quickToken||session.connection.quick_token)===token,normalized=mode(value);if(normalized!=='off'&&!await local.ready(current)||!current()||!valid())return false;port.quickTerminal({...session.connection,x11_mode:normalized},token,`${session.connection.name} · X11`);return true;}
 async function launch(id:number,values:X11Launch,current=()=>true){return run(id,async fixed=>{
  const command=String(values.command||'').trim(),args=String(values.args||'').trim();if(!command||command.length>1024||/[\0\r\n]/.test(command))throw Error(t('common:x11.invalid_application'));if(args.length>4096||/[\0\r\n]/.test(args))throw Error(t('common:x11.invalid_application_args'));
  const same=()=>fixed.current()&&current(),verified=await port.api(`/api/connections/${id}/x11-applications/verify`,{method:'POST',body:JSON.stringify({command})}) as X11Result;
  const path=verified.application?.path||command;if(!same()||!await local.ready(same)||!same()||!valid())return false;
  if(path.length>1024||/[\0\r\n]/.test(path))throw Error(t('common:x11.invalid_application'));
  const key=port.next(id);port.override(key,{terminal_startup_mode:'program',terminal_profile_name:String(values.label||command).slice(0,120),terminal_profile_kind:values.kind||'custom',terminal_program_path:path,terminal_program_args:args,terminal_working_directory:'',terminal_program_platform:'posix',x11_mode:values.mode==='trusted'?'trusted':'untrusted'});
  if(!port.openTerminal(id,key,`${fixed.connection.name} · ${values.label||command}`))throw Error(t('common:x11.terminal_tab_create_failed'));port.notify(t('common:x11.application_started'),'success');return true;
 });}
 return {change,persist,temporary,quick,launch,dispose(){alive=false;}};
}
