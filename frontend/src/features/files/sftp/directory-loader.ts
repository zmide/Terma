import {directorySignature,type SftpDirectoryState,type SftpScrollState,type SftpDirectoryPage} from './directory-state';
export interface DirectoryRuntime {
  tabKey:string;connectionId:number;state:SftpDirectoryState;root:HTMLElement|null;requestController:AbortController|null;
  vueListState:{kind:string;detail?:string}|null;renderedRequestSeq:number;searchTimer:number|null;
}
export interface DirectoryLoadOptions {
  tabKey?:string;connectionId?:number;path?:string;page?:number;keepContents?:boolean;preserveView?:boolean;refresh?:boolean;
  silent?:boolean;renderIfChangedOnly?:boolean;historyNavigation?:boolean;paneId?:string;continuous?:boolean;
}
interface LoaderPort {
  active():string;tab(key:string):{id:number;path?:string}|null;
  runtime(key:string):DirectoryRuntime|null;ensure(key:string,id:number,path:string):DirectoryRuntime|null;
  capture(key:string):SftpScrollState|null;restore(state:SftpScrollState,key:string):void;
  list(key:string):HTMLElement|null;render(key:string,part?:string):void;
  request(id:number,params:URLSearchParams,signal:AbortSignal|null):Promise<SftpDirectoryPage>;
  session(id:number):Promise<{connected?:boolean}>;
  connected(id:number,status:string,error?:string):void;
  history(key:string,path:string,navigating:boolean):void;
  remember(key:string,path:string):void;saveTabs():void;search(key:string,loading:boolean):void;flush(key:string):void;
  tr(key:string):string;error(message:string):void;
}
export function createDirectoryLoader(port:LoaderPort){
  async function load(options:DirectoryLoadOptions={}){
    const key=String(options.tabKey||port.active()||''),tab=port.tab(key);
    const id=Number(options.connectionId||port.runtime(key)?.connectionId||tab?.id||0);if(!id)return false;
    const runtime=port.ensure(key,id,options.path||tab?.path||'.');if(!runtime)return false;
    const previous=runtime.state,path=options.path||previous.path||'.',page=Math.max(1,Number(options.page||previous.page||1));
    const query=String(previous.query||''),recursive=!!(previous.recursiveSearch&&query.trim());
    const sort=['name','size','mtime'].includes(previous.sort)?previous.sort:'name',dir=previous.dir==='desc'?'desc':'asc';
    const pageSize=[25,50,100,200].includes(Number(previous.pageSize))?Number(previous.pageSize):50;
    const list=port.list(key),hadView=!!list?.querySelector('.sftp-head'),previousView=hadView?port.capture(key):null;
    const same=previous.connectionId===id&&String(previous.path||'.')===String(path||'.');
    const keep=hadView&&same&&options.keepContents!==false,preserve=!!(options.preserveView??options.refresh)&&keep,silent=!!options.silent&&keep;
    runtime.requestController?.abort();const controller=new AbortController(),sequence=(previous.requestSeq||0)+1;
    runtime.requestController=controller;runtime.state={...previous,loading:true,requestSeq:sequence,selected:preserve?previous.selected:null};
    runtime.vueListState=keep?null:{kind:'loading',detail:path};
    if(!silent){list?.classList.toggle('is-refreshing',keep);list?.setAttribute('aria-busy','true');if(!keep)port.render(key,'list');}
    if(query)port.search(key,true);
    const current=()=>port.runtime(key)===runtime&&runtime.state.requestSeq===sequence;
    const params=new URLSearchParams({path,page:String(page),page_size:String(pageSize),query,sort,dir});
    if(recursive)params.set('recursive','1');if(options.refresh)params.set('refresh','1');
    try{
      const data=await port.request(id,params,controller.signal);if(!current()||controller.signal.aborted)return false;
      const mounted=!!runtime.root?.isConnected&&runtime.root.dataset.sftpTabKey===key;
      const view=preserve&&mounted?port.capture(key):null;
      if(tab)tab.path=data.path;
      const next:SftpDirectoryState={...runtime.state,connectionId:id,path:data.path,entries:(data.entries||[]).map(e=>({...e})),selected:preserve?runtime.state.selected:null,
        page:Number(data.page||1),pageSize:Number(data.page_size||pageSize),total:Number(data.total||0),totalPages:Number(data.total_pages||1),unfilteredTotal:Number(data.unfiltered_total||0),recursiveSearch:!!previous.recursiveSearch,recursiveSearchTruncated:!!data.truncated,paged:!!data.paged,
        sort:data.sort&&['name','size','mtime'].includes(data.sort)?data.sort:sort,dir:data.dir==='desc'?'desc':dir,loading:false,requestSeq:sequence,
        listRevision:(previous.listRevision||0)+(options.continuous?0:1)};
      const changed=!options.renderIfChangedOnly||directorySignature(runtime.state)!==directorySignature(next);
      runtime.state=next;runtime.vueListState=null;if(!changed)runtime.renderedRequestSeq=sequence;
      port.connected(id,'connected');port.history(key,data.path,!!options.historyNavigation);
      if(changed&&mounted){port.render(key,'navigation');port.render(key,'actions');port.render(key,'list');if(view)port.restore(view,key);}
      port.remember(key,path);port.saveTabs();return true;
    }catch(caught){
      const error=caught as {name?:string;code?:string;message?:string};
      if(error?.name==='AbortError'||error?.code==='SSH_CREDENTIAL_REPAIR_REDIRECTED'||!current()||controller.signal.aborted)return false;
      let connected=['SFTP_DIRECTORY_PERMISSION_DENIED','SFTP_DIRECTORY_NOT_FOUND','SFTP_DIRECTORY_ACCESS_FAILED'].includes(error?.code||'');
      if(!connected){try{connected=!!(await port.session(id)).connected;}catch{}}
      if(!current()||controller.signal.aborted)return false;
      const message=error?.message||'';runtime.state={...previous,loading:false,requestSeq:sequence};runtime.vueListState=hadView?null:{kind:'error',detail:message};
      if(tab)tab.path=previous.path;port.connected(id,connected?'connected':'disconnected',message||port.tr('sftp:auto.connection_disconnected'));
      if(port.list(key)&&runtime.root?.dataset.sftpTabKey===key){
        if(hadView){port.render(key,'navigation');port.render(key,'actions');port.render(key,'list');if(previousView)port.restore(previousView,key);if(!silent)port.error(message||port.tr('sftp:auto.directory_sync_failed'));}
        else port.render(key,'list');
      }
      return false;
    }finally{
      if(current()){
        runtime.state.loading=false;if(runtime.requestController===controller)runtime.requestController=null;
        if(!silent){list?.classList.remove('is-refreshing');list?.setAttribute('aria-busy','false');}port.search(key,false);
        queueMicrotask(()=>{if(current())port.flush(key);});
      }
    }
  }
  return {load};
}
