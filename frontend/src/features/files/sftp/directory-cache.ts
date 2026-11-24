import { directoryKey, directoryPath, cloneDirectoryState, cloneScrollState, type SftpDirectoryState, type SftpScrollState } from './directory-state';
type Snapshot = { state:SftpDirectoryState; viewState:SftpScrollState|null; needsReload:boolean; cachedAt:number; lastAccess:number };
export interface SizeRecord { status:'loading'|'ready'|'error'; sizeBytes?:string; error?:string; updatedAt?:number; lastAccess?:number }
interface CachePort {
  state(key:string):SftpDirectoryState|null;
  capture(key:string):SftpScrollState|null;
  connection(key:string):number;
  siblings(key:string,id:number):boolean;
  readSize(id:number,path:string):Promise<{size_bytes?:string;size?:number}>;
  changed(id:number,path:string):void;
  tr(key:string,params?:Record<string,unknown>):string;
  localize(value:string):string;
  bytes(size:number):string;
  error(message:string):void;
}
export function createDirectoryCache(port:CachePort) {
  const views = new Map<string,Snapshot>(), aliases = new Map<string,string>(), sizes = new Map<string,SizeRecord>();
  const epochs = new Map<number,number>();
  let generation = 0;
  const ttl = 10*60*1000;
  function remove(key:string) { views.delete(key); for(const [alias,target] of aliases)if(alias===key||target===key)aliases.delete(alias); }
  function prune(now=Date.now()) {
    for(const [key,value] of views)if(now-(value.lastAccess||value.cachedAt)>ttl)remove(key);
    let count=[...views.values()].reduce((n,v)=>n+v.state.entries.length,0);
    while(views.size>60||count>5000){const key=views.keys().next().value;if(key===undefined)break;count-=views.get(key)?.state.entries.length||0;remove(key);}
  }
  function pruneSizes(now=Date.now()) {
    for(const [key,v] of sizes)if(v.status!=='loading'&&now-(v.lastAccess||v.updatedAt||0)>ttl)sizes.delete(key);
    while(sizes.size>200){const key=sizes.keys().next().value;if(key===undefined)break;sizes.delete(key);}
  }
  function getSize(id:number,path:string) { pruneSizes();const key=directoryKey(id,path),record=sizes.get(key);if(!record)return null;record.lastAccess=Date.now();sizes.delete(key);sizes.set(key,record);return record; }
  function setSize(id:number,path:string,record:SizeRecord){const key=directoryKey(id,path),now=Date.now();sizes.delete(key);sizes.set(key,{...record,updatedAt:now,lastAccess:now});pruneSizes(now);}
  function clearSizes(id:number){for(const key of sizes.keys())if(key.startsWith(`${id}\0`))sizes.delete(key);}
  function clearConnection(id:number){if(!id)return;epochs.set(id,(epochs.get(id)||0)+1);for(const key of views.keys())if(key.startsWith(`${id}\0`))remove(key);for(const key of aliases.keys())if(key.startsWith(`${id}\0`))aliases.delete(key);clearSizes(id);}
  function clear(){generation++;views.clear();aliases.clear();sizes.clear();epochs.clear();}
  function get(id:number,path:string){prune();const requested=directoryKey(id,path),key=aliases.get(requested)||requested;const value=views.get(key);if(!value)return null;value.lastAccess=Date.now();views.delete(key);views.set(key,value);return value;}
  function cache(key:string,requestedPath='',scroll:SftpScrollState|null=null){
    const source=port.state(key);if(!source?.connectionId||source.loading)return null;
    const state=cloneDirectoryState(source),canonical=directoryKey(state.connectionId,state.path),now=Date.now();remove(canonical);
    const value:Snapshot={state,viewState:cloneScrollState(scroll||port.capture(key)),needsReload:false,cachedAt:now,lastAccess:now};
    views.set(canonical,value);aliases.set(canonical,canonical);aliases.set(directoryKey(state.connectionId,requestedPath||source.path),canonical);prune(now);return value;
  }
  function presentation(record:SizeRecord|null){
    const tr=port.tr;
    if(record?.status==='loading')return {className:'is-loading',label:tr('sftp:auto.reading'),title:tr('sftp:auto.directory_size_reading'),disabled:true,iconName:'loader-circle'};
    if(record?.status==='ready'){const bytes=String(record.sizeBytes||'0');return {className:'is-ready',label:port.bytes(Number(bytes)),title:tr('sftp:auto.directory_size_ready',{bytes}),disabled:false,iconName:'refresh-cw'};}
    if(record?.status==='error')return {className:'is-error',label:tr('common:actions.retry'),title:tr('sftp:auto.directory_size_failed',{error:port.localize(record.error||tr('sftp:auto.unknown'))}),disabled:false,iconName:'circle-alert'};
    return {className:'is-idle',label:tr('sftp:auto.read'),title:tr('sftp:auto.directory_size_hint'),disabled:false,iconName:'calculator'};
  }
  async function readSize(id:number,path:string){
    if(getSize(id,path)?.status==='loading')return;
    const epoch=epochs.get(id)||0, requestGeneration=generation;
    const current=()=>generation===requestGeneration&&(epochs.get(id)||0)===epoch;
    setSize(id,path,{status:'loading'});port.changed(id,path);
    try{const result=await port.readSize(id,path);if(!current())return;
      const sizeBytes=String(result?.size_bytes??result?.size??'');if(!/^\d+$/.test(sizeBytes))throw new Error(port.tr('sftp:auto.directory_size_invalid'));
      setSize(id,path,{status:'ready',sizeBytes});
    }catch(error){if(!current())return;const message=error instanceof Error?error.message:port.tr('sftp:auto.directory_size_read_failed');setSize(id,path,{status:'error',error:message});port.error(message);}
    port.changed(id,path);
  }
  return {get,cache,remove,prune,getSize,setSize,clearSizes,pruneSizes,presentation,readSize,clearConnection,clear,
    resolve:(id:number,path:string)=>aliases.get(directoryKey(id,path))||directoryKey(id,path),
    clearTab:(key:string)=>{const id=port.connection(key);if(id&&!port.siblings(key,id))clearConnection(id);}};
}
