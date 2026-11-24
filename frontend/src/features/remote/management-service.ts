import {connectionStamp,normalizeManagementHost,profileStamp,type ManagementPort,type ManagementConnection} from './management-types';
import type {RemoteProfile} from './profile-model';
export type ManagementProtocol = 'rdp' | 'vnc' | 'xdmcp';
interface RepairPort {
 repair(id: number, options: {context: string; onSaved(): Promise<void>}): Promise<unknown>;
 refresh(id: number, protocol: ManagementProtocol): Promise<unknown>;
 invalidate(): void;
}
export function createManagementService(port:ManagementPort){
 const linking=new Map<number,string>(),pending=new Map<number,Promise<boolean>>();
 function connectionId(profile:RemoteProfile|undefined){
  if(!profile)return 0;const source=Number(profile.options?.source_ssh_connection_id||profile.options?.ssh_connection_id||0),host=normalizeManagementHost(profile.host);
  if(!host)return 0;const configured=port.connection(source);if(configured&&normalizeManagementHost(configured.ssh_host)===host)return source;
  const matches=port.connections().filter(item=>normalizeManagementHost(item.ssh_host)===host);return matches.length===1?matches[0]!.id:0;
 }
 function seed(id:number){const profile=port.profile(id);if(!profile||!port.unlocked(port.tr('remote:diagnostics.new_ssh_management_connection')))return false;
  const opened=port.seedSsh({profileId:id,group:profile.group_name||'默认分组',profileName:profile.name||'',name:port.tr('remote:management.generated_ssh_name',{name:profile.name}).slice(0,120),host:profile.host||'',port:22,user:profile.protocol==='rdp'?'':profile.username||''});
  if(opened)linking.set(id,profileStamp(profile));return opened;
 }
 function link(profileId:number,id:number,source?:Pick<ManagementConnection,'ssh_host'>){
  if(pending.has(profileId))return pending.get(profileId)!;
  const profile=port.profile(profileId),target=source||port.connection(id),stamp=linking.get(profileId);
  if(!profile||!Number.isSafeInteger(id)||id<1||stamp&&stamp!==profileStamp(profile)||!target||normalizeManagementHost(target.ssh_host)!==normalizeManagementHost(profile.host)||!port.unlocked(port.tr('remote:diagnostics.ssh_management_connection')))return Promise.resolve(false);
  const options={...profile.options,source_ssh_connection_id:id,...(profile.protocol==='xdmcp'?{ssh_connection_id:id}:{})};
  const work=port.api(`/api/remote-profiles/${profileId}`,{method:'PUT',body:JSON.stringify({protocol:profile.protocol,name:profile.name,group_name:profile.group_name,host:profile.host,port:profile.port,username:profile.username||'',tags:profile.tags||'',options})}).then(()=>{linking.delete(profileId);port.notify(port.tr('remote:management.linked_success',{name:profile.name}),'success');return true;}).finally(()=>pending.delete(profileId));pending.set(profileId,work);return work;
 }
 async function repairCredentials(id:number, protocol:string, repair:RepairPort) {
  const profile=port.profile(id), source=connectionId(profile), connection=port.connection(source);
  if(!profile || !connection || connection.quick_connection || !Number.isSafeInteger(source) || source<1 || !Number.isSafeInteger(id) || id<1 || profile.protocol!==protocol || (protocol!=='rdp' && protocol!=='vnc' && protocol!=='xdmcp')) {
   port.notify(port.tr('remote:management.connection_not_found'),'error');return false;
  }
  const active=port.scope(), target=profileStamp(profile);
  // Credentials themselves can change. Compare only the stable connection identity on return.
  const identity=(item:ManagementConnection)=>connectionStamp({...item,auth_type:undefined,has_password:undefined});
  const original=identity(connection);
  return repair.repair(source, {context:port.tr('remote:management.probe_auth_failed',{protocol:protocol.toUpperCase()}),onSaved:async()=>{
   repair.invalidate();
   const savedProfile=port.profile(id), savedConnection=port.connection(source);
   if(active() && savedProfile && profileStamp(savedProfile)===target && connectionId(savedProfile)===source && savedConnection && !savedConnection.quick_connection && identity(savedConnection)===original) await repair.refresh(id,protocol);
  }});
 }
 return {connectionId,seed,link,repairCredentials};
}
