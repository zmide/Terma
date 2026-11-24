import type {BrowserFileDirectory, BrowserDirectoryHandle, BrowserEntry} from './browser-directory';

export interface FileTransferEntry {path:string;name:string;type?:string;size?:number;mtime?:number}
export interface FileTransferPayload {sourceTabKey?:string;paths:string[];entries:FileTransferEntry[]}
export interface RemoteFileTransfer {connectionId:number;entries:FileTransferEntry[]}
export interface FileTransferTarget {valid?():boolean;key?:string;kind?:string;id?:number;path?:string;title?:string}
export interface FileTransferContext {
  source:'native'|'server'|'browser';path:string;location:string;browser?:BrowserFileDirectory;
  valid():boolean;refresh():Promise<unknown>;status(message:string):void;
}
interface TransferJob {id?:string;type?:string;status?:string;[key:string]:unknown}
interface TransferResult {jobs?:TransferJob[];count?:number}
interface ConflictItem {name:string;exists?:boolean;type?:string;existing_type?:string}
interface TransferResponse {items?:ConflictItem[]}
export interface FileTransferPort {
  context(key:string):FileTransferContext|null;
  target(target:FileTransferTarget):{id:number;directory:string;valid():boolean}|null;
  request<T>(url:string,body:Record<string,unknown>,signal?:AbortSignal):Promise<T>;
  list(id:number,path:string,page:number,signal:AbortSignal):Promise<{entries:FileTransferEntry[];total_pages?:number}>;
  fetch(id:number,path:string,signal:AbortSignal):Promise<Response>;
  responseError(response:Response):Promise<Error>;
  conflict(id:number,path:string,entries:FileTransferEntry[],title?:()=>string):Promise<string>;
  choose(items:ConflictItem[],source:'native'|'server'|'browser'):Promise<string>;
  upload(files:Array<{file:File;relativePath:string}>,id:number,path:string,key:string,directories:string[]):Promise<unknown>;
  download(id:number,path:string,type:string):Promise<unknown>;
  track(job:TransferJob,key?:string,directory?:string):void;
  refreshJobs():Promise<unknown>;startJobs():void;
  text(key:string,values?:Record<string,unknown>):string;notify(message:string,kind:'info'|'success'):void;
}
const pathsValid=(paths:string[])=>Array.isArray(paths)&&paths.length>0&&paths.length<=1000&&paths.every(path=>typeof path==='string'&&path.length>0&&path.length<=32768&&!path.includes('\0'));
const connectionValid=(id:number)=>Number.isSafeInteger(id)&&id!==0;
export async function browserHandleKind(directory:BrowserDirectoryHandle,name:string):Promise<'file'|'dir'|''> {
  try{await directory.getFileHandle(name);return 'file';}catch(error){if(!['NotFoundError','TypeMismatchError'].includes((error as Error).name))throw error;}
  try{await directory.getDirectoryHandle(name);return 'dir';}catch(error){if(!['NotFoundError','TypeMismatchError'].includes((error as Error).name))throw error;}
  return '';
}

/** Owns transfer snapshots and cancellation; host and remote capabilities stay in explicit ports. */
export function createFileTransferService(port:FileTransferPort) {
  const active=new Map<string,AbortController>();
  async function upload(payload:FileTransferPayload,target:FileTransferTarget) {
    if(!pathsValid(payload?.paths)||target.valid?.()===false)return false;
    const context=port.context(payload.sourceTabKey||''),destination=port.target(target);
    if(!context||!context.valid()||!destination||!connectionValid(destination.id)||!destination.valid())return false;
    const paths=[...payload.paths],entries=payload.entries.map(item=>({...item})),valid=()=>target.valid?.()!==false&&context.valid()&&destination.valid();
    if(context.source==='browser') {
      const files=await context.browser!.collect(entries as BrowserEntry[]);
      if(!valid())return false;
      return port.upload(files,destination.id,destination.directory,target.key||'',files.directories);
    }
    const conflict=await port.conflict(destination.id,destination.directory,entries,target.title?()=>port.text('navigation:transfer.target_conflict_title',{target:target.title}):undefined);
    if(!valid()||!['error','rename','overwrite'].includes(conflict))return false;
    const result=await port.request<TransferResult>('/api/'+(context.source==='native'?'local-files':'server-files')+'/upload',{connection_id:destination.id,paths,target:destination.directory,conflict});
    for(const job of result.jobs||[])port.track(job);
    await port.refreshJobs();port.startJobs();
    port.notify(port.text('navigation:transfer.upload_started',{count:result.count||paths.length,target:destination.directory}),'success');return true;
  }
  async function receive(drag:RemoteFileTransfer|null,target:FileTransferTarget|undefined) {
    const paths=drag?.entries?.map(item=>item.path);
    if(!drag||!paths||!connectionValid(Number(drag.connectionId))||!pathsValid(paths))return false;
    const key=target?.key||'',context=port.context(key);
    if(!context||!context.valid()||!context.path||context.location==='computer')throw new Error(port.text('navigation:transfer.open_local_directory'));
    const entries=drag.entries.map(item=>({...item})),id=Number(drag.connectionId),directory=context.path;
    if(context.source!=='browser') {
      const endpoint='/api/'+(context.source==='native'?'local-files':'server-files');
      const plan=await port.request<TransferResponse>(endpoint+'/receive-plan',{connection_id:id,paths,target:directory});
      if(!context.valid())return false;
      const conflicts=(plan.items||[]).map((item,index)=>({...item,existing_type:item.type,type:entries[index]?.type||'file'})).filter(item=>item.exists);
      const conflict=conflicts.length?await port.choose(conflicts,context.source):context.source==='native'?'error':'rename';
      if(!context.valid()||!['error','rename','overwrite'].includes(conflict))return false;
      const job=await port.request<TransferJob>(endpoint+'/receive',{connection_id:id,paths:[...paths],target:directory,conflict});
      port.track(job,key,directory);await port.refreshJobs();port.startJobs();
      port.notify(port.text(entries.length===1?'common:notifications.background_transfer_target_one':'common:notifications.background_transfer_target_other',{count:entries.length,target:directory}),'info');return true;
    }
    const browser=context.browser!;
    const status=context.status;
    if(!browser.writable){for(const entry of entries){if(!context.valid())return false;await port.download(id,entry.path,entry.type||'file');}return true;}
    active.get(key)?.abort();const controller=new AbortController();active.set(key,controller);
    const current=()=>{controller.signal.throwIfAborted();if(!context.valid())throw new DOMException('Directory changed','AbortError');};
    let count=0;const renamed:Array<{source:string;target:string}>=[];
    try {
      await browser.writeAllowed();current();const root=await browser.directory(directory);current();
      const conflicts:ConflictItem[]=[];
      for(const entry of entries){const name=browser.receiveName(entry.name),kind=await browserHandleKind(root,name);current();if(kind)conflicts.push({...entry,type:entry.type||'file',existing_type:kind});}
      const conflict=conflicts.length?await port.choose(conflicts,'browser'):'rename';current();
      if(!['rename','overwrite'].includes(conflict))return false;
      // Overwrite applies only to file/file collisions; folders always keep both trees.
      if(conflict==='overwrite'&&conflicts.some(item=>item.type!=='file'||item.existing_type!=='file'))return false;
      async function save(entry:FileTransferEntry,parent:BrowserDirectoryHandle,relative='',depth=0):Promise<void> {
        current();if(++count>1000||depth>64)throw new Error(port.text('sftp:web_files.transfer_limit'));
        const name=browser.receiveName(entry.name);let destination=name;
        if(entry.type==='dir') {
          for(let number=1;await browserHandleKind(parent,destination);number++){current();destination=name+' ('+number+')';}
          current();if(destination!==entry.name)renamed.push({source:relative+entry.name,target:relative+destination});
          const directoryHandle=await parent.getDirectoryHandle(destination,{create:true});current();
          for(let page=1;;page++) {
            if(page>50)throw new Error(port.text('sftp:web_files.transfer_limit'));
            const listing=await port.list(id,entry.path,page,controller.signal);current();
            if(!Array.isArray(listing.entries)||listing.entries.length>1000)throw new Error(port.text('sftp:web_files.invalid_path'));
            for(const child of listing.entries){if(!['dir','file'].includes(child.type||''))throw new Error(port.text('sftp:web_files.invalid_path'));browser.validateName(child.name);await save({...child,path:entry.path.replace(/\/+$/,'')+'/'+child.name},directoryHandle,relative+destination+'/',depth+1);}
            if(page>=Number(listing.total_pages||1))break;
          }
        } else {
          if(entry.type&&entry.type!=='file')throw new Error(port.text('sftp:web_files.invalid_path'));
          if(conflict!=='overwrite')for(let number=1;await browserHandleKind(parent,destination);number++){current();destination=browser.numberedName(name,number);}
          const existing=await browserHandleKind(parent,destination);current();
          if(existing==='dir')throw new Error(port.text('sftp:web_files.invalid_path'));
          if(destination!==entry.name)renamed.push({source:relative+entry.name,target:relative+destination});
          const response=await port.fetch(id,entry.path,controller.signal);current();
          if(!response.ok)throw await port.responseError(response);
          if(!response.body)throw new Error(port.text('sftp:web_files.transfer_failed'));
          const handle=await parent.getFileHandle(destination,{create:true}),writer=await handle.createWritable();
          try{current();await response.body.pipeTo(writer,{signal:controller.signal});}
          catch(error){await writer.abort().catch(()=>{});if(!existing)await parent.removeEntry(destination).catch(()=>{});throw error;}
        }
        current();status(port.text(renamed.length?'sftp:web_files.received_renamed':'sftp:web_files.received',{count,renamed:renamed.length}));
      }
      for(const entry of entries)await save(entry,root);
      current();await context.refresh();
      const message=port.text(renamed.length?'sftp:web_files.received_renamed':'sftp:web_files.received',{count,renamed:renamed.length})+(renamed.length?'\n'+renamed.slice(0,6).map(item=>port.text('tasks:notifications.file_renamed',item)).join('\n'):'');
      if(context.valid())context.status(message);port.notify(message,renamed.length?'info':'success');return true;
    } finally {if(active.get(key)===controller)active.delete(key);}
  }
  async function desktop(id:number,paths:string[]){if(!connectionValid(Number(id))||!pathsValid(paths))return;const job=await port.request<TransferJob>('/api/local-files/receive-desktop',{connection_id:Number(id),paths:[...paths]});port.track(job);await port.refreshJobs();port.startJobs();port.notify(port.text(paths.length===1?'common:notifications.background_transfer_desktop_one':'common:notifications.background_transfer_desktop_other',{count:paths.length}),'info');return job;}
  return {upload,receive,desktop,context:port.context,dispose(key:string){active.get(key)?.abort();active.delete(key);}};
}
