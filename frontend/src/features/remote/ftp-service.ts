import {profileStamp} from './management-types';
import type {RemoteProfile} from './profile-model';
import type {RemoteFtpEntry} from './RemoteFtpView';

export interface FtpState {
  key:string;profileId:number;profile:RemoteProfile;path:string;pathDraft:string;entries:RemoteFtpEntry[];
  loading:boolean;busy:boolean;error:string;view?:HTMLElement;navigation:number;draftRevision:number;
}
export interface FtpRequest {method?:string;body?:string;signal?:AbortSignal}
export interface FtpPort {
  profile(id:number):RemoteProfile|undefined;unlocked(context:string):boolean;tr(key:string,params?:Record<string,unknown>):string;
  api(url:string,options?:FtpRequest):Promise<unknown>;
  upload(id:number,path:string,file:File,signal:AbortSignal):Promise<unknown>;
  download(id:number,path:string,name:string):void;
  authenticationFailure(error:unknown):boolean;
  repair(id:number,options:{context:()=>string;error:unknown;current():boolean;signal:AbortSignal}):Promise<{saved?:boolean;profile?:RemoteProfile}|false|null>;
  input(intent:'create'|'rename',name:string,signal:AbortSignal):Promise<string>;
  confirm(name:string,type:string,signal:AbortSignal):Promise<boolean>;
  paint(state:FtpState):void;release(state:FtpState):void;persist(state:FtpState):void;resetUpload(state:FtpState):void;
  workspace(profile:RemoteProfile,state:FtpState,update:boolean):HTMLElement;
  notify(message:string,kind:'error'|'success'):void;
}
const validName=(name:string)=>!!name&&name!=='.'&&name!=='..'&&!/[\\/\0\r\n]/.test(name)&&new TextEncoder().encode(name).length<=255;
const repairTarget=(p:RemoteProfile)=>JSON.stringify([p.id,p.protocol,p.host,p.options]);
export function createFtpService(port:FtpPort){
  const states=new Map<string,FtpState>(),reads=new Map<FtpState,{path:string;controller:AbortController;promise:Promise<boolean>}>(),operations=new Map<FtpState,AbortController>(),downloads=new Map<FtpState,Map<string,{controller:AbortController;promise:Promise<boolean>}>>();let alive=true;
  const owned=(s:FtpState)=>alive&&states.get(s.key)===s;
  const fixed=(s:FtpState)=>!!port.profile(s.profileId)&&profileStamp(port.profile(s.profileId)!)===profileStamp(s.profile);
  const paint=(s:FtpState)=>{if(owned(s))port.paint(s);};
  const cancelDownloads=(s:FtpState)=>{for(const item of downloads.get(s)?.values()||[])item.controller.abort();downloads.delete(s);};
  function ensure(key:string,profile:RemoteProfile,path=''){
    if(!alive||profile.protocol!=='ftp'||!Number.isSafeInteger(profile.id)||Number(profile.id)<1)return null;
    let s=states.get(key);if(s&&profileStamp(s.profile)!==profileStamp(profile)){close(key);s=undefined;}
    if(!s){const initial=path||String(profile.options?.base_path||'/');s={key,profileId:Number(profile.id),profile:structuredClone(profile),path:initial,pathDraft:initial,entries:[],loading:false,busy:false,error:'',navigation:0,draftRevision:0};states.set(key,s);}return s;
  }
  function draft(key:string,value:string){const s=states.get(key);if(s){s.pathDraft=value;s.draftRevision++;}}
  function lease(s:FtpState,controller:AbortController,navigation=s.navigation){let stamp=profileStamp(s.profile);const current=()=>owned(s)&&!controller.signal.aborted&&s.navigation===navigation&&!!port.profile(s.profileId)&&profileStamp(port.profile(s.profileId)!)===stamp;return {current,acceptRepair(profile:RemoteProfile){stamp=profileStamp(profile);s.profile=structuredClone(profile);}};}
  async function request<T>(s:FtpState,controller:AbortController,context:()=>string,action:()=>Promise<T>,guard:ReturnType<typeof lease>,skip=false):Promise<T|null>{
    if(!guard.current()||!port.unlocked(context()))return null;
    try{return await action();}catch(error){
      if(!guard.current())return null;
      if(skip||!port.authenticationFailure(error))throw error;
      const target=repairTarget(s.profile),repaired=await port.repair(s.profileId,{context,error,current:guard.current,signal:controller.signal});
      if(!repaired||!repaired.saved||!owned(s)||controller.signal.aborted)return null;
      const profile=port.profile(s.profileId);
      if(!profile||!repaired.profile||profileStamp(profile)!==profileStamp(repaired.profile)||repairTarget(profile)!==target)return null;
      guard.acceptRepair(profile);
      if(!guard.current()||!port.unlocked(context()))return null;
      return action();
    }
  }
  function load(key:string,pathValue:string|null=null,refresh=false):Promise<boolean>{
    const s=states.get(key);if(!s||!owned(s)||!fixed(s)||!port.unlocked(port.tr('sftp:ftp.auth.directory')))return Promise.resolve(false);
    const target=pathValue===null?s.path:String(pathValue||'/'),existing=reads.get(s);
    if(existing?.path===target&&!refresh)return existing.promise;
    existing?.controller.abort();operations.get(s)?.abort();cancelDownloads(s);s.navigation++;const controller=new AbortController(),guard=lease(s,controller),draftRevision=s.draftRevision;
    s.loading=true;s.error='';paint(s);
    const entry={path:target,controller,promise:Promise.resolve(false)};reads.set(s,entry);
    entry.promise=(async()=>{
      try{const result=await request(s,controller,()=>port.tr('sftp:ftp.auth.directory'),()=>port.api(`/api/remote-profiles/${s.profileId}/ftp?path=${encodeURIComponent(target)}${refresh?'&refresh=1':''}`,{signal:controller.signal}) as Promise<{path?:string;entries?:RemoteFtpEntry[]}>,guard);
        if(!result||!guard.current())return false;s.path=typeof result.path==='string'?result.path:target;if(s.draftRevision===draftRevision)s.pathDraft=s.path;
        s.entries=Array.isArray(result.entries)?result.entries.filter(e=>typeof e?.name==='string'&&typeof e?.type==='string'):[];port.persist(s);return true;
      }catch(error){if(guard.current()){s.error=error instanceof Error?error.message:String(error);throw error;}return false;}
      finally{if(reads.get(s)===entry){reads.delete(s);if(owned(s)){s.loading=false;paint(s);}}}
    })();return entry.promise;
  }
  function parent(key:string){const s=states.get(key);if(!s||s.path==='/')return Promise.resolve(false);const parts=s.path.split('/').filter(Boolean);parts.pop();return load(key,'/'+parts.join('/'));}
  function openDirectory(key:string,name:string){
    const state=states.get(key);
    if(!state||!validName(name)||!state.entries.some(entry=>entry.type==='directory'&&entry.name===name))return Promise.resolve(false);
    return load(key,`${state.path.replace(/\/$/,'')}/${name}`);
  }
  async function mutate(key:string,kind:'create'|'rename'|'delete'|'upload',name='',type='',files:File[]=[]){
    if(!['create','rename','delete','upload'].includes(kind))return false;files=[...files];
    const s=states.get(key);if(!s||!owned(s)||!fixed(s)||s.busy||s.loading||!port.unlocked(port.tr(`sftp:ftp.auth.${kind}`)))return false;
    if((kind==='rename'||kind==='delete')&&(!validName(name)||!s.entries.some(e=>e.name===name&&(kind!=='delete'||e.type===type))))return false;
    if(kind==='upload'&&(!files.length||files.some(f=>!validName(f.name))))return false;
    const controller=new AbortController(),guard=lease(s,controller),path=s.path;operations.set(s,controller);s.busy=true;paint(s);
    try{
      let value='';if(kind==='create'||kind==='rename'){value=(await port.input(kind,name,controller.signal)).trim();if(!value||kind==='rename'&&value===name)return false;if(!validName(value))throw Error(port.tr('sftp:inline_rename.invalid_name'));}
      if(kind==='delete'&&!await port.confirm(name,type,controller.signal))return false;
      if(!guard.current())return false;
      const context=()=>port.tr(`sftp:ftp.auth.${kind}`,{name});
      if(kind==='upload'){
        for(const file of files){const result=await request(s,controller,()=>port.tr('sftp:ftp.auth.upload',{name:file.name}),()=>port.upload(s.profileId,path,file,controller.signal),guard);if(!result||!guard.current())return false;}
        port.resetUpload(s);port.notify(port.tr('sftp:ftp.upload.completed',{count:files.length}),'success');
      }else{
        const body=kind==='create'?{path,name:value}:kind==='rename'?{path,name,new_name:value}:{path,name,type};
        const result=await request(s,controller,context,()=>port.api(`/api/remote-profiles/${s.profileId}/ftp/${kind==='create'?'mkdir':kind}`,{method:'POST',body:JSON.stringify(body),signal:controller.signal}),guard);if(!result||!guard.current())return false;
      }
      // Release this operation before its own refresh starts a new navigation.
      operations.delete(s);s.busy=false;await load(key,null,true);return true;
    }finally{if(operations.get(s)===controller)operations.delete(s);if(owned(s)){s.busy=false;paint(s);}}
  }
  function download(key:string,name:string):Promise<boolean>{const s=states.get(key);if(!s||!validName(name)||!s.entries.some(e=>e.name===name&&e.type!=='directory')||!fixed(s))return Promise.resolve(false);
    let group=downloads.get(s);if(group?.has(name))return group.get(name)!.promise;if(!group){group=new Map();downloads.set(s,group);}
    const controller=new AbortController(),guard=lease(s,controller),path=s.path,entry={controller,promise:Promise.resolve(false)};group.set(name,entry);
    entry.promise=(async()=>{const result=await request(s,controller,()=>port.tr('sftp:ftp.auth.download',{name}),()=>port.api(`/api/remote-profiles/${s.profileId}/ftp?path=${encodeURIComponent(path)}`,{signal:controller.signal}),guard);
      if(!result||!guard.current())return false;port.download(s.profileId,path,name);return true;
    })().finally(()=>{if(group?.get(name)===entry)group.delete(name);if(!group?.size&&downloads.get(s)===group)downloads.delete(s);});return entry.promise;
  }
  function close(key:string){const s=states.get(key);if(!s)return;states.delete(key);reads.get(s)?.controller.abort();reads.delete(s);operations.get(s)?.abort();operations.delete(s);cancelDownloads(s);s.pathDraft='';s.entries=[];s.error='';s.loading=false;s.busy=false;port.release(s);}
  function open(id:number,path='',update=true,key=`ftp-${id}`){const profile=port.profile(id);if(!profile||profile.protocol!=='ftp'||!port.unlocked(port.tr('remote:actions.open_files')))return null;const state=ensure(key,profile,path);if(!state)return null;state.view=port.workspace(profile,state,update);state.view.dataset.ftpTabKey=key;paint(state);void load(key,path||null).catch(error=>{if(owned(state)&&fixed(state))port.notify(error instanceof Error?error.message:String(error),'error');});return state;}
  return {states,ensure,open,draft,load,parent,openDirectory,mutate,download,close,paint,refresh(){for(const s of states.values())paint(s);},dispose(){for(const key of [...states.keys()])close(key);alive=false;}};
}
