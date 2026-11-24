import type {RemoteAdminState} from './RemoteAdminDialog';
import {connectionStamp,type ManagementPort,type Identity} from './management-types';
interface Grant {id:string;reuse_policy?:string;expires_at?:number;scope?:string}
export function createAdminService(port:ManagementPort){
 const cache=new Map<string,{grant:Grant;connection:string}>();let prompting=false;
 const clear=(state:RemoteAdminState)=>{state.password='';state.passphrase='';state.sudoPassword='';};
 async function request(id:number,label:string,scope:string,valid:()=>boolean=()=>true):Promise<{admin_grant_id:string}|null>{
  const connection=port.connection(id);if(!Number.isSafeInteger(id)||!id||!connection)throw Error(port.tr('remote:admin.ssh_connection_missing'));
  if(!valid()||!port.unlocked(label))return null;
  const stamp=connectionStamp(connection),quick=!!connection.quick_connection||id<0,key=id+':'+scope,origin=port.scope();let owned=true;
  const cacheKey=cache.has(key)?key:id+':host:*',saved=cache.get(cacheKey),current=()=>{const next=port.connection(id);return owned&&valid()&&origin()&&!!next&&connectionStamp(next)===stamp;};
  if(saved&&(!current()||saved.connection!==stamp||Number(saved.grant.expires_at||0)>0&&Number(saved.grant.expires_at)<=port.now()))cache.delete(cacheKey);
  else if(saved&&!quick)return {admin_grant_id:saved.grant.id};
  if(prompting){port.notify(port.tr('common:notifications.credential_repair_open'),'info');return null;}
  prompting=true;let state:RemoteAdminState|undefined,accepted:Grant|undefined;
  try{
   let identities:Identity[]=[];try{const result=await port.api('/api/identity-files');if(Array.isArray(result))identities=result;}catch{}
   if(!current()||!port.unlocked(label))return null;
   state={user:connection.ssh_user||'root',method:connection.auth_type==='password'||connection.has_password?'password':identities.length?'key':'agent',password:'',key:identities.find(item=>item.permission_ok)?.path||identities[0]?.path||'',passphrase:'',sudoMode:'none',sudoPassword:'',reuse:'once',submitting:false};
   const draft=state;let validating=false;
   return await port.promptAdmin({state:draft,quick,identities:()=>identities.map(identity=>({value:identity.path,label:port.identityLabel(identity)})),labels:()=>{
    const labels:Record<string,string>={};for(const name of ['title','close','privacy_notice','ssh_user','auth_method','password','existing_key','ssh_password','once_placeholder','private_key','select_private_key','passphrase_optional','passphrase_empty','sudo_password','sudo_none','sudo_same','sudo_separate','sudo_empty','quick_once','reuse_label','reuse_once','reuse_10m','reuse_30m','reuse_session','validation_notice','cancel','validating','authorize_continue'])labels[name]=port.tr('remote:admin.'+name);
    return {...labels,show_password:port.tr('common:auto.show_password'),hide_password:port.tr('common:auto.hide_password'),scope:port.localize(label)+' · '+(connection.name||connection.ssh_host)};
   },submit:async()=>{
    if(validating)return null;
    const user=draft.user.trim(),method=draft.method;
    const invalid=!user?'user_required':method==='password'&&!draft.password?'password_required':method==='key'&&(!draft.key||!identities.some(item=>item.path===draft.key))?'key_required':'';
    if(invalid){port.notify(port.tr('remote:admin.'+invalid),'error');return null;}
    if(!['password','key','agent'].includes(method)||!['none','same','separate'].includes(draft.sudoMode)||!current()||!port.unlocked(label))return null;
    const reuse=quick?'once':['once','10m','30m','session'].includes(draft.reuse)?draft.reuse:'once';
    validating=true;try{
     const result=await port.api('/api/admin-grants',{method:'POST',headers:quick?port.quickHeaders(id):{},body:JSON.stringify({connection_id:id,scope,admin_auth:{ssh_user:user,auth_method:method,ssh_password:method==='password'?draft.password:'',identity_file:method==='key'?draft.key:'',private_key_passphrase:method==='key'?draft.passphrase:'',sudo_requested:true,sudo_password:draft.sudoMode==='same'&&method==='password'?draft.password:draft.sudoMode==='separate'?draft.sudoPassword:'',reuse_policy:reuse}})}) as {admin_grant?:Grant;admin_grant_id?:string};
     if(!current()||!port.unlocked(label))return null;
     accepted=result.admin_grant||{id:result.admin_grant_id||'',reuse_policy:reuse,scope};
     if(!accepted.id)throw Error(port.tr('remote:admin.grant_missing'));
     return {admin_grant_id:String(accepted.id)};
    }catch(error){if(current())port.notify(error instanceof Error?error.message:port.tr('remote:admin.failed'),'error');return null;}finally{validating=false;}
   },accept:value=>{
    if(!quick&&accepted&&accepted.id===value.admin_grant_id&&current()&&['10m','30m','session'].includes(accepted.reuse_policy||''))cache.set(accepted.scope==='host:*'?id+':host:*':key,{grant:{...accepted,id:String(accepted.id)},connection:stamp});
   }});
  }finally{owned=false;if(state)clear(state);prompting=false;}
 }
 return {request,clear:()=>cache.clear()};
}
