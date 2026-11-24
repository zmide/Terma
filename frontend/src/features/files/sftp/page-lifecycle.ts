import {directoryPath,type SftpDirectoryState,type SftpScrollState} from './directory-state';
import type {SftpTabRuntime,RestoreRuntimeOptions} from './tab-runtime';
import type {DirectoryLoadOptions} from './directory-loader';
interface CachedView {state:SftpDirectoryState;viewState:SftpScrollState|null;needsReload:boolean}
export interface SftpPageConnection {id:number;name:string;quick_connection?:boolean;ssh_user?:string;ssh_host?:string;ssh_port?:number;sftp_filename_encoding?:string;sftp_text_encoding?:string}
interface OpenOptions {paneId?:string;fast?:boolean}
interface Port {
  active():string;isSftp(key:string):boolean;pane():string;next(id:number):string;
  tab(key:string):{id:number;kind:string;path?:string}|undefined;openTab(id:number,path:string,key:string):unknown;
  connection(id:number):SftpPageConnection|null;select(id:number,reveal:boolean):SftpPageConnection|null;usage(id:number):void;
  view(key:string):HTMLElement|null;runtime(key:string):SftpTabRuntime|undefined;restore(key:string,options:RestoreRuntimeOptions):SftpTabRuntime|null;
  remember(key:string):void;watch(list:HTMLElement|null,key:string):void;disconnected(id:number):boolean;
  directory(id:number,path:string):CachedView|null;cached(key:string):CachedView|undefined;restoreCache(value:CachedView,runtime:SftpTabRuntime):boolean;
  rememberIndex(key:string,id:number):void;index(key:string,id:number):number;
  workspace(title:string,connection:SftpPageConnection,key:string,update:boolean,path:string,disconnected:boolean):void;
  unavailable(key:string,id:number,path:string):boolean;
  scroll(state:SftpScrollState|null,key:string):void;paint(key:string,part:'navigation'|'actions'|'list'):void;
  flush(key:string):void;list(key:string):HTMLElement|null;toolbar(key:string):void;jobs():void;session(key:string):Promise<unknown>;
  status(id:number):void;load(options:DirectoryLoadOptions):Promise<unknown>;
  mount(view:HTMLElement,key:string):boolean;register(key:string,toolbar:HTMLElement|null,mount:HTMLElement|null):void;
  place(key:string,toolbar:HTMLElement,mount:HTMLElement):void;visibility():void;mobile(key:string):void;
  feedback(key:string):void;history(key:string,path:string):void;
}
/** Owns detach/reattach and activation without invalidating reads in other panes. */
export function createSftpPageLifecycle(port:Port){
  function toolbar(key:string){
    if(!port.isSftp(key))return;
    const runtime=port.runtime(key),view=runtime?.root||port.view(key);
    if(!view||(view.dataset.sftpTabKey&&view.dataset.sftpTabKey!==key))return;
    const mount=view.querySelector<HTMLElement>('#sftpToolbarMount');
    const element=runtime?.toolbar||mount?.querySelector<HTMLElement>(':scope > .sftp-toolbar')||document.querySelector<HTMLElement>(`.sftp-toolbar[data-workspace-tab-key="${CSS.escape(key)}"]`);
    if(!mount||!element)return;
    view.dataset.workspaceTabKey=key;view.dataset.sftpTabKey=key;
    port.register(key,element,mount);if(runtime)runtime.toolbar=element;
    port.place(key,element,mount);port.visibility();port.mobile(key);
  }
  function detach(view:HTMLElement,key:string,previous:SftpTabRuntime){
    port.remember(key);
    const toolbar=previous.toolbar||document.querySelector<HTMLElement>(`.sftp-toolbar[data-workspace-tab-key="${CSS.escape(key)}"]`),home=view.querySelector('#sftpToolbarMount');
    if(toolbar&&home&&!home.contains(toolbar))home.appendChild(toolbar);
    previous.resizeObserver?.disconnect();if(previous.resizeFrame)cancelAnimationFrame(previous.resizeFrame);
    previous.resizeObserver=null;previous.resizeFrame=0;previous.root=null;previous.toolbar=toolbar;
    const detached=document.createElement('div');while(view.firstChild)detached.appendChild(view.firstChild);previous.detachedView=detached;
  }
  function preserveView(view:HTMLElement,key:string){
    const previous=port.runtime(key);
    if(previous?.root===view&&!previous.detachedView)detach(view,key,previous);
  }
  async function open(id:number,path='.',update=true,existing='',options:OpenOptions={}){
    options={...options,paneId:options.paneId||port.pane()};
    const connection=port.connection(id);if(!connection)return existing?port.unavailable(existing,id,path):false;
    if(!connection.quick_connection&&update)port.usage(id);
    const key=existing||(!update&&port.isSftp(port.active())?port.active():'')||port.next(id),view=port.view(key);
    if(!view)return false;
    const runtime=port.restore(key,{connectionId:id,path});if(!runtime)return false;
    let mountedKey=view.dataset.sftpTabKey||'';
    if(mountedKey&&mountedKey!==key){
      const previous=port.runtime(mountedKey);
      if(previous)detach(view,mountedKey,previous);
      else view.replaceChildren();
    }
    if(runtime.detachedView?.childNodes.length){
      while(runtime.detachedView.firstChild)view.appendChild(runtime.detachedView.firstChild);
      runtime.detachedView=null;view.dataset.workspaceTabKey=key;view.dataset.sftpTabKey=key;mountedKey=key;
      port.watch(view.querySelector('#sftpList'),key);
    }
    const shell=view.querySelector<HTMLElement>(':scope > .sftp-shell'),disconnected=port.disconnected(id)&&!update;
    const selected=port.select(id,update);if(!selected)return false;
    if(runtime.searchTimer!==null)clearTimeout(runtime.searchTimer);runtime.searchTimer=null;
    const directory=port.directory(id,path),cached=directory||(!update?port.cached(key):null);
    const toolbar=view.querySelector<HTMLElement>('#sftpToolbarMount > .sftp-toolbar')||document.querySelector<HTMLElement>(`.sftp-toolbar[data-workspace-tab-key="${CSS.escape(key)}"]`);
    const mounted=mountedKey===key&&shell?.dataset.sftpTabKey===key&&toolbar?.dataset.workspaceTabKey===key&&Number(runtime.state.connectionId)===id
      &&(directoryPath(runtime.state.path)===directoryPath(path)||directoryPath(directory?.state.path||'.')===directoryPath(runtime.state.path));
    port.rememberIndex(key,id);const index=port.index(key,id),title=`${selected.name} · SFTP${index>1?` #${index}`:''}`;
    const current=()=>port.runtime(key)===runtime;
    const later=(run:()=>void)=>requestAnimationFrame(()=>{if(current())run();});
    if(mounted){
      runtime.root=view;port.workspace(title,selected,key,update,runtime.state.path,disconnected);
      if(cached?.viewState)port.scroll(cached.viewState,key);
      if(!runtime.state.loading){port.paint(key,'navigation');port.paint(key,'actions');port.flush(key);
        if(runtime.renderedRequestSeq!==Number(runtime.state.requestSeq||0)||!port.list(key)?.querySelector('.sftp-head'))port.paint(key,'list');}
      port.toolbar(key);port.paint(key,'actions');
      if(update||options.fast)port.jobs();else later(port.jobs);
      if(disconnected){port.status(id);return true;}
      if(options.fast){later(()=>void port.session(key));return true;}
      if(update)return port.load({path:runtime.state.path,page:runtime.state.page,tabKey:key,silent:true,renderIfChangedOnly:true,paneId:options.paneId});
      later(()=>void port.session(key));return true;
    }
    const restored=Boolean(cached&&!cached.needsReload&&String(cached.state.path||'.')===String(path||'.')&&port.restoreCache(cached,runtime));
    if(!restored){runtime.state={...runtime.state,connectionId:id,path,entries:[],selected:null,page:1,total:0,totalPages:1,unfilteredTotal:0};}
    const display=restored?runtime.state.path:path;runtime.vueStatus='connecting';runtime.vueError='';runtime.vueListState=restored?null:{kind:'loading',detail:display};
    if(!port.mount(view,key))throw new Error('SFTP view is not installed');
    view.dataset.workspaceTabKey=key;view.dataset.sftpTabKey=key;
    const home=view.querySelector<HTMLElement>('#sftpToolbarMount'),mountedToolbar=home?.querySelector<HTMLElement>(':scope > .sftp-toolbar')||null;
    port.register(key,mountedToolbar,home);runtime.root=view;runtime.toolbar=mountedToolbar;
    port.workspace(title,selected,key,update,display,disconnected);port.toolbar(key);port.flush(key);port.feedback(key);port.history(key,display);port.paint(key,'navigation');port.jobs();
    if(disconnected||restored){
      if(disconnected)port.status(id);
      if(restored&&cached){port.paint(key,'actions');port.paint(key,'list');port.scroll(cached.viewState,key);}
      if(!disconnected)void port.session(key);return true;
    }
    return port.load({path,page:1,tabKey:key,paneId:options.paneId});
  }
  function duplicate(key:string,copyKey=''){
    const tab=port.tab(key);if(tab?.kind!=='sftp')return false;
    return port.openTab(tab.id,port.runtime(key)?.state.path||tab.path||'.',copyKey||port.next(tab.id));
  }
  return {open,toolbar,duplicate,preserveView};
}


export interface InstalledFeaturesFilesSftpPageLifecycleServices {
  termaSftpPage: ReturnType<typeof createSftpPageLifecycle>
}
