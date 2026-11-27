import type {LocalFileState,LocalEntry,LoadOptions} from './local-file-service';
type SelectionAction='open'|'rename'|'chmod'|'copy'|'delete';
interface Port {
  states:Map<string,LocalFileState>;desktop():boolean;selected(key:string):LocalEntry[];listed?(key:string):LocalEntry[];
  load(key:string,options:LoadOptions):Promise<unknown>;hidePath(key:string):void;
  select(key:string,path:string):void;open(path:string):Promise<unknown>;locations():Promise<Record<string,string>>;
  mutate(key:string,action:'rename'|'chmod'|'delete',paths:string[]):unknown;
  copy(value:string):unknown;text(key:string):string;notify(message:string,kind:'info'|'error'):void;
}
/** Native actions use only the original tab, entry and directory capability. */
export function createFileNativeActions(port:Port){
  const generations=new Map<string,number>();
  function context(key:string){
    const state=port.states.get(key);if(!state||state.fileSource||!port.desktop())return null;
    const path=state.path,location=state.location;
    return {state,valid:()=>port.states.get(key)===state&&!state.fileSource&&state.path===path&&state.location===location&&port.desktop()};
  }
  function navigate(key:string,path:string,computer=false){
    if(!context(key))return;generations.set(key,(generations.get(key)||0)+1);port.hidePath(key);
    return port.load(key,{path,location:computer?'computer':'directory',page:1});
  }
  async function activate(key:string,path:string){
    const source=context(key),item=(port.listed?.(key)||source?.state.entries)?.find(item=>item.path===path);if(!source||!item)return false;
    port.select(key,path);if(item.type!=='file')return navigate(key,item.path);
    try{if(source.valid())await port.open(item.path);return true;}
    catch(error){if(source.valid())port.notify(error instanceof Error?error.message:port.text('sftp:local_files.open_file_failed'),'error');return false;}
  }
  function selection(key:string,action:SelectionAction){
    const source=context(key);if(!source)return;
    const entries=port.selected(key).map(item=>({...item})),paths=entries.map(item=>item.path);
    if(action==='copy'){
      if(!paths.length)return port.notify(port.text('sftp:local_files.select_items'),'info');
      return port.copy(paths.join('\n'));
    }
    if(action==='delete')return port.mutate(key,'delete',paths);
    if(entries.length!==1){port.notify(port.text(`sftp:local_files.${action==='chmod'?'permissions':action}_one_only`),'info');return;}
    return action==='open'?activate(key,paths[0]):port.mutate(key,action,paths);
  }
  async function location(key:string,name:string){
    const source=context(key);if(!source)return false;
    const token=(generations.get(key)||0)+1;generations.set(key,token);
    const locations=await port.locations();
    if(!source.valid()||generations.get(key)!==token)return false;
    const path=locations[name]||locations.desktop;if(typeof path!=='string'||path.includes('\0'))return false;
    return navigate(key,path);
  }
  function parent(key:string){const source=context(key);if(!source)return;if(source.state.parentKind==='computer')return navigate(key,'',true);if(source.state.parent)return navigate(key,source.state.parent);}
  return {activate,selection,navigate,location,parent};
}
