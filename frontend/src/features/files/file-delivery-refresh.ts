import {filesServices} from '@/features/files/installed-services';
import type {LocalFileState} from './local-file-service';

interface DeliveryJob {id?:unknown;type?:string;status?:string;delivery_status?:string;saved_path?:string;target_directory?:string}
interface DeliveryPort {
  states():Iterable<[string,LocalFileState]>;
  load(key:string,state:LocalFileState):Promise<unknown>|void;
  failed(error:unknown):void;
}
export function deliveryPathKey(value:string){
  const path=String(value||'').replace(/\\/g,'/').replace(/\/+$/,'');return /^[a-z]:|^\/\//i.test(path)?path.toLowerCase():path;
}
export function deliveryDirectory(job:DeliveryJob){
  if(job.type==='local-delivery')return String(job.target_directory||job.saved_path||'');
  if(job.type!=='download'||job.delivery_status!=='saved'||!job.saved_path)return '';
  const file=job.saved_path.replace(/\\/g,'/');return file.slice(0,file.lastIndexOf('/')+1);
}
/** Refresh physical aliases after the task poll, without cancelling a newer navigation. */
export function createFileDeliveryRefresh(port:DeliveryPort){
  const targets=new Map<string,{tabKey:string;directory:string}>();
  function track(job:DeliveryJob,key:string,directory:string){if(job.id&&key)targets.set(String(job.id),{tabKey:key,directory});}
  function refresh(job:DeliveryJob){
    if(!job||!['done','failed','cancelled'].includes(job.status||''))return;
    const id=String(job.id||''),target=targets.get(id);if(id)targets.delete(id);
    if(job.status!=='done')return;
    const directory=deliveryDirectory(job);
    for(const [key,state] of port.states()){
      if(!state.path||state.fileSource==='browser'||(state.loading||state.webLoading)&&state.webRequestedPath!==state.path)continue;
      const registered=state.fileSource==='server'&&target?.tabKey===key&&target.directory===state.path;
      const physical=state.fileSource==='server'?state.displayPath:state.path;
      if(!registered&&(!directory||deliveryPathKey(physical)!==deliveryPathKey(directory)))continue;
      try{Promise.resolve(port.load(key,state)).catch(error=>port.failed(error));}catch(error){port.failed(error);}
    }
  }
  return {track,refresh,targets,release(key:string){for(const [id,target] of targets)if(target.tabKey===key)targets.delete(id);},dispose(){targets.clear();}};
}
export function installFileDeliveryRefresh(){filesServices.termaFileDeliveryRefresh={create:createFileDeliveryRefresh,pathKey:deliveryPathKey,directory:deliveryDirectory};}


export interface InstalledFeaturesFilesFileDeliveryRefreshServices {
  termaFileDeliveryRefresh:{create:typeof createFileDeliveryRefresh;pathKey:typeof deliveryPathKey;directory:typeof deliveryDirectory}
}
