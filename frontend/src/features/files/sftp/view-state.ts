import type {SftpDirectoryState,SftpScrollState} from './directory-state';
import type {SftpTabRuntime} from './tab-runtime';
interface SavedView {state:SftpDirectoryState;viewState:SftpScrollState|null;needsReload:boolean}
interface Port {
 runtime(key:string):SftpTabRuntime|undefined;
 root(key:string):HTMLElement|null;capture(key:string):SftpScrollState|null;cache(key:string,path:string,state:SftpScrollState|null):void;
 runtimes():Iterable<SftpTabRuntime>;paint(key:string):void;
}
export function createSftpViewState(port:Port){
 const snapshots=new Map<string,SavedView>(), openingFiles=new Set<string>();
 const openKey=(id:number,path:string)=>`${Number(id)}\0${path}`;
 const copy=(state:SftpDirectoryState,seq=state.requestSeq):SftpDirectoryState=>({...state,entries:state.entries.map(item=>({...item})),selected:state.selected?{...state.selected}:null,loading:false,requestSeq:seq});
 function remember(key:string,path=''){
  const runtime=port.runtime(key),view=port.root(key);if(!runtime||view?.dataset.sftpTabKey!==key||!view.querySelector('.sftp-shell'))return;
  const state=port.capture(key);port.cache(key,path||runtime.state.path,state);
  snapshots.set(key,{needsReload:runtime.state.loading,state:copy(runtime.state),viewState:state});
 }
 function restore(cached:SavedView,runtime:SftpTabRuntime){
  if(!cached?.state)return false;
  runtime.state=copy(cached.state,Math.max(runtime.state.requestSeq,cached.state.requestSeq)+1);
  return true;
 }
 const paint=(id:number)=>{for(const runtime of port.runtimes())if(Number(runtime.connectionId)===id)port.paint(runtime.tabKey);};
 async function opening<T>(id:number,path:string,run:()=>Promise<T>):Promise<T|null>{
  const key=openKey(id,path);if(openingFiles.has(key))return null;
  openingFiles.add(key);paint(id);
  try{return await run();}finally{openingFiles.delete(key);paint(id);}
 }
 return {remember,restore,opening,paint,
  cached:(key:string)=>snapshots.get(key),release:(key:string)=>snapshots.delete(key),
  isOpening:(id:number,path:string)=>openingFiles.has(openKey(id,path))};
}



export interface InstalledFeaturesFilesSftpViewStateServices {
  termaSftpTabs: {
   runtime: ReturnType<typeof import('./tab-runtime').createSftpTabRuntime>;
   view: ReturnType<typeof createSftpViewState>;
  };
}
