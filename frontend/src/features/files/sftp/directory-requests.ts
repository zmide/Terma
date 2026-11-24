import type { SftpDirectoryPage } from './directory-state';
interface RequestPort { read(url:string,signal?:AbortSignal):Promise<SftpDirectoryPage> }
interface Queued { run:()=>Promise<SftpDirectoryPage>; signal:AbortSignal|null; resolve:(page:SftpDirectoryPage)=>void; reject:(error:unknown)=>void; cleanup:()=>void }
export function directoryAbortError(){const error=new Error('SFTP directory request aborted');error.name='AbortError';return error;}
export function waitForDirectory(request:Promise<SftpDirectoryPage>,signal:AbortSignal|null=null){
  if(!signal)return request;if(signal.aborted)return Promise.reject(directoryAbortError());
  return new Promise<SftpDirectoryPage>((resolve,reject)=>{const abort=()=>{cleanup();reject(directoryAbortError());};const cleanup=()=>signal.removeEventListener('abort',abort);
    signal.addEventListener('abort',abort,{once:true});request.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});});
}
export function createDirectoryRequests(port:RequestPort){
  const shared=new Map<string,Promise<SftpDirectoryPage>>(),queue:Queued[]=[];let active=0;
  function drain(){while(active<3&&queue.length){const item=queue.shift()!;item.cleanup();if(item.signal?.aborted){item.reject(directoryAbortError());continue;}active++;
    Promise.resolve().then(item.run).then(item.resolve,item.reject).finally(()=>{active--;drain();});}}
  function schedule(run:()=>Promise<SftpDirectoryPage>,signal:AbortSignal|null=null){
    if(signal?.aborted)return Promise.reject(directoryAbortError());
    return new Promise<SftpDirectoryPage>((resolve,reject)=>{
      const item:Queued={run,signal,resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)};
      const abort=()=>{const index=queue.indexOf(item);if(index<0)return;queue.splice(index,1);item.cleanup();reject(directoryAbortError());};
      signal?.addEventListener('abort',abort,{once:true});queue.push(item);drain();});
  }
  function request(id:number,params:URLSearchParams,signal:AbortSignal|null=null){
    const url=`/api/connections/${Number(id)}/sftp?${params}`;
    if(signal)return schedule(()=>port.read(url,signal),signal);
    let pending=shared.get(url);if(!pending){pending=schedule(()=>port.read(url)).finally(()=>{if(shared.get(url)===pending)shared.delete(url);});shared.set(url,pending);}return pending;
  }
  return {request,schedule,drain,wait:waitForDirectory};
}
