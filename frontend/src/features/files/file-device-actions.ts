import type {LocalEntry, LocalFileState} from './local-file-service';

interface DeviceContext {
  source:'native'|'server'|'browser'; path:string; displayPath:string; state:LocalFileState;
  valid():boolean; load(path:string):Promise<unknown>;
}
interface DeviceActionsPort {
  context(key:string):DeviceContext|null;
  selected(key:string):LocalEntry[];
  input(title:string|(()=>string),label:string|(()=>string),value:string):Promise<string|null|undefined>;
  resolve(path:string):Promise<{path:string}>;
  pick():Promise<File[]>;
  upload(path:string,file:File,signal:AbortSignal):Promise<void>;
  deliver(name:string,source:Blob|string):void;
  text(key:string):string; notify(message:string,kind:'info'|'error'):void;
}

/** Captures device, directory and selection before opening a browser/OS chooser. */
export function createFileDeviceActions(port:DeviceActionsPort){
  const pending=new Map<string,AbortController>();
  const current=(context:DeviceContext,signal?:AbortSignal)=>{
    signal?.throwIfAborted();
    if(!context.valid())throw new DOMException('Directory changed','AbortError');
  };
  async function path(key:string){
    const context=port.context(key);if(!context?.valid()||context.source==='native')return false;
    const value=await port.input(()=>port.text('sftp:web_files.go_to_folder'),()=>port.text('sftp:web_files.'+(context.source==='browser'?'relative_path_hint':'path')),context.displayPath);
    if(!value||!context.valid())return false;
    if(context.source==='server'){
      const result=await port.resolve(value);if(!context.valid())return false;
      await context.load(result.path);return true;
    }
    const directory=context.state.browserDirectory!;
    if(value!==directory.name&&!value.startsWith(directory.name+'/'))throw new Error(port.text('sftp:web_files.invalid_path'));
    const target='/browser'+value.slice(directory.name.length);directory.parts(target);
    if(!context.valid())return false;await context.load(target);return true;
  }
  async function choose(key:string,readonly=false){
    const context=port.context(key);if(context?.source!=='browser'||!context.valid())return false;
    const directory=context.state.browserDirectory!;
    await directory.choose(readonly?'readonly':undefined);
    // Choosing a root intentionally changes the directory capability; retain tab identity.
    if(context.state.browserDirectory!==directory||port.context(key)?.state!==context.state||context.state.path!==context.path||context.state.fileSource!=='browser')return false;
    await context.load('/browser');return true;
  }
  async function download(key:string){
    const context=port.context(key);if(!context?.valid()||context.source==='native')return false;
    const items=port.selected(key).map(entry=>({...entry}));
    for(const entry of items){
      if(!context.valid())return false;
      if(entry.type!=='file'){port.notify(port.text('sftp:web_files.download_file_only'),'info');continue;}
      const source=context.source==='browser'?await context.state.browserDirectory!.file(entry.path):'/api/server-files/download?'+new URLSearchParams({path:entry.path});
      if(!context.valid())return false;port.deliver(entry.name,source);
    }
    return true;
  }
  async function upload(key:string){
    const context=port.context(key);if(!context?.valid()||context.source==='native')return false;
    if(context.source==='browser'){port.notify(port.text('sftp:web_files.use_sftp_drop'),'info');return false;}
    if(pending.has(key))return false;
    const controller=new AbortController();pending.set(key,controller);
    try{
      const files=await port.pick();current(context,controller.signal);
      if(files.length>1000)throw new Error(port.text('sftp:web_files.transfer_limit'));
      for(const file of files){
        current(context,controller.signal);
        if(!file.name||file.name.length>4000||/[\x00/\\]/.test(file.name)||file.name==='.'||file.name==='..')throw new Error(port.text('sftp:web_files.invalid_path'));
        await port.upload(context.path,file,controller.signal);
      }
      current(context,controller.signal);
      if(files.length)await context.load(context.path);return files.length>0;
    }catch(error){if((error as Error).name!=='AbortError')throw error;return false;}
    finally{if(pending.get(key)===controller)pending.delete(key);}
  }
  return {path,choose,download,upload,dispose(key:string){pending.get(key)?.abort();pending.delete(key);}};
}
