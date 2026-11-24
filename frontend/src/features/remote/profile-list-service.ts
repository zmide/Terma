import {isRemoteProtocol,type RemoteProfile} from './profile-model';
import type {RemoteServicePort} from './profile-service';
import type {Ask} from '../forwards/forward-service';
export interface ListProfile extends RemoteProfile {id:number;name:string;group_name:string}
export interface RemoteListPort extends RemoteServicePort {
 profiles():ListProfile[];profile(id:number):ListProfile|undefined;connection(id:number):{id:number;group_name?:string}|undefined;
 reload():Promise<void>;paint():void;scope():()=>boolean;reveal(id:number):void;showRemote():void;deleted(id:number):void;
 groups():{name:string;open:boolean}[];setGroup(name:string,open:boolean):void;saveGroups():void;
}
export function createRemoteListService(port:RemoteListPort,ask:Ask,storage:Pick<Storage,'getItem'|'setItem'>){
 const searchKey='remoteConnectionSearch';
 let search=storage.getItem(searchKey)||'';
 function setSearch(value:string){search=value||'';storage.setItem(searchKey,search);port.paint();}
 function visible(){
  const profiles=port.profiles(),query=search.trim().toLowerCase();
  return query ? profiles.filter(profile=>[profile.name,profile.group_name,profile.tags,profile.protocol,profile.host,
    profile.port,profile.username,profile.options?.path].some(value=>String(value??'').toLowerCase().includes(query))) : profiles;
 }
 const pending=new Map<string,Promise<unknown>>(),t=port.tr;
 const idFor=(id:number)=>{if(!Number.isSafeInteger(id)||id<1)throw Error('Invalid remote profile');return id;};
 function run<T>(key:string,operation:()=>Promise<T>):Promise<T|undefined>{const existing=pending.get(key);if(existing)return existing as Promise<T>;
  if(!port.unlocked(t('remote:auto.save_connection')))return Promise.resolve(undefined);
  const work=operation().finally(()=>{pending.delete(key);port.paint();});pending.set(key,work);port.paint();return work;
 }
 const fingerprint=(profile:ListProfile)=>JSON.stringify([profile.id,profile.protocol,profile.name,profile.host,profile.port,profile.username,profile.group_name,profile.options]);
 async function generate(connectionId:number,protocol:string){idFor(connectionId);if(!port.connection(connectionId)||protocol!=='all'&&(!isRemoteProtocol(protocol)||protocol==='serial'))return;
  const current=port.scope();return run('connection:'+connectionId,async()=>{
   const result=await port.api(`/api/connections/${connectionId}/remote-profiles`,{method:'POST',body:JSON.stringify({protocol})}) as {id?:number;name?:string;created?:boolean;created_count?:number;existing_count?:number;results?:{id:number;created?:boolean}[]};
   await port.reload();const items=Array.isArray(result.results)?result.results:[],selected=protocol==='all'?(items.find(item=>item.created)||items[0])?.id:result.id;
   if(current()){if(selected)port.reveal(selected);port.showRemote();}
   if(protocol==='all'){const created=Number(result.created_count||0),existing=Number(result.existing_count||0);port.notify(t(created?'remote:notifications.generated_many':'remote:notifications.all_existing',{created,existing,existingSuffix:existing?t('remote:notifications.existing_suffix',{count:existing}):''}),created?'success':'info');}
   else port.notify(t(result.created===false?'remote:notifications.existing_switched':'remote:notifications.generated',{name:result.name||''}),result.created===false?'info':'success');
   return result;
  });
 }
 function favorite(id:number,value:boolean){idFor(id);if(!port.profile(id))return Promise.resolve();return run('profile:'+id,async()=>{await port.api(`/api/remote-profiles/${id}/flags`,{method:'POST',body:JSON.stringify({favorite:Boolean(value)})});await port.reload();});}
 function duplicate(id:number){idFor(id);if(!port.profile(id))return Promise.resolve();const current=port.scope();return run('profile:'+id,async()=>{const result=await port.api(`/api/remote-profiles/${id}/duplicate`,{method:'POST'}) as {name:string};await port.reload();if(current())port.reveal(id);port.notify(t('remote:notifications.duplicated',{name:result.name}),'success');return result;});}
 function remove(id:number){idFor(id);const profile=port.profile(id);if(!profile)return Promise.resolve(false);const before=fingerprint(profile);
  return run('profile:'+id,async()=>{const answer=await ask({title:()=>t('remote:dialogs.delete_title'),message:()=>t('remote:dialogs.delete_message',{name:profile.name}),choices:[{value:'yes',label:()=>t('common:actions.delete'),danger:true},{value:'',label:()=>t('common:actions.cancel')}]});
   if(answer!=='yes'||!port.unlocked(t('remote:actions.delete')))return false;const current=port.profile(id);if(!current||fingerprint(current)!==before)return false;
   await port.api(`/api/remote-profiles/${id}`,{method:'DELETE'});port.deleted(id);await port.reload();port.notify(t('remote:notifications.deleted'),'success');return true;
  });
 }
 function toggleGroup(name:string){if(!port.groups().some(group=>group.name===name))return;port.setGroup(name,!port.groups().find(group=>group.name===name)!.open);port.saveGroups();port.paint();}
 return {generate,favorite,duplicate,remove,toggleGroup,getSearch:()=>search,setSearch,visible,busy:(id:number)=>pending.has('profile:'+id)};
}
