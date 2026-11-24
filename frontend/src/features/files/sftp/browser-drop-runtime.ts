import {hasInternalPayload, transferTypes} from './drag-payload';
import type {BrowserDrag, DragTab, FileDragEvent} from './browser-drag-runtime';
import type {LocalDragPayload} from '../local-drag';
import type {DroppedFile} from './dropped-files';
interface DropOptions {tabKey:string;keepHint?:boolean;title?:string|(()=>string);path?:string}
interface Port {
  internal():BrowserDrag|null;handoff():BrowserDrag|null;requests():Iterable<BrowserDrag>;nativeActive(value:BrowserDrag):boolean;
  platform():string;clearHandoff():void;reset(row?:HTMLElement|null):void;
  payload(data?:DataTransfer|null):BrowserDrag|null;localPayload(data?:DataTransfer|null):LocalDragPayload|null;
  tab(key:string):DragTab|undefined;target(drag:BrowserDrag,key:string):DragTab|undefined;
  path(tab:DragTab):string;root(key:string):HTMLElement|null;overlay(key:string):HTMLElement|null;
  depth(value:number):void;external(active:boolean,options:DropOptions):void;
  cancelLeave():void;leave(options:DropOptions):void;activity():void;inside():void;
  sourceHint():string;hint(message:string|(()=>string),target:boolean,action:string,key:string):void;
  text(key:string,values?:Record<string,unknown>):string;notify(message:string,kind:'error'):void;
  local(payload:LocalDragPayload,tab:DragTab,key:string):Promise<unknown>;
  copy(payload:BrowserDrag,tab:DragTab):Promise<unknown>;finish(payload:BrowserDrag):void;
  current(key:string,id:number,path:string):()=>boolean;
  collect(data:DataTransfer):Promise<DroppedFile[]>;
  upload(files:DroppedFile[],id:number,path:string,options:{tabKey:string;isCurrent:()=>boolean}):Promise<unknown>;
}
/** Routes local, remote and external drops without using the focused tab as the destination. */
export function createBrowserDropRuntime(port:Port){
  function hasFiles(data?:DataTransfer|null){return transferTypes(data).includes('files')||Boolean(data?.files?.length)||Array.from(data?.items||[]).some(item=>item.kind==='file')||Boolean(port.platform()&&transferTypes(data).includes('text/uri-list'));}
  function own(data?:DataTransfer|null){return Boolean((port.internal()||port.handoff())&&(!data||hasInternalPayload(data)))||[...port.requests()].some(port.nativeActive);}
  function stale(data?:DataTransfer|null){if(hasInternalPayload(data)||!hasFiles(data))return;port.clearHandoff();if(port.internal()&&![...port.requests()].some(port.nativeActive))port.reset(port.internal()?.row);}
  function transition(event:FileDragEvent){const shell=event.currentTarget,related=event.relatedTarget;try{return Boolean(shell instanceof Node&&related instanceof Node&&shell.contains(related));}catch{return false;}}
  function suppress(event:FileDragEvent,key:string){if(!own(event.dataTransfer))return false;port.cancelLeave();event.preventDefault();event.stopPropagation?.();if(event.dataTransfer)event.dataTransfer.dropEffect='none';port.depth(0);port.external(false,{tabKey:key,keepHint:true});return true;}
  function feedback(drag:BrowserDrag,key:string){const target=port.target(drag,key);if(target)port.external(true,{title:()=>port.text('sftp:transfer.drop_copy_to',{target:target.title}),path:port.path(target),tabKey:key});return target;}
  function ownOver(event:FileDragEvent,enter:boolean,key:string){
    const drag=port.payload(event.dataTransfer);if(!drag)return false;
    port.inside();event.preventDefault();event.stopPropagation?.();const target=feedback(drag,key);
    if(event.dataTransfer)event.dataTransfer.dropEffect=target?'copy':'none';
    if(target){if(enter)port.depth(1);}else{port.depth(0);port.external(false,{keepHint:true,tabKey:key});port.hint(()=>port.sourceHint(),false,'',key);}return true;
  }
  function localOver(event:FileDragEvent,key:string){
    const payload=port.localPayload(event.dataTransfer),tab=port.tab(key);if(!payload||tab?.kind!=='sftp')return false;
    event.preventDefault();event.stopPropagation?.();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';
    port.external(true,{title:()=>port.text('sftp:transfer.drop_upload_to',{target:tab.title}),path:port.path(tab),tabKey:key});return true;
  }
  function over(event:FileDragEvent,key:string,enter=false){
    port.activity();if(localOver(event,key))return;stale(event.dataTransfer);
    const within=enter&&transition(event);if(ownOver(event,enter&&!within,key))return;
    if(own(event.dataTransfer))return suppress(event,key);if(!hasFiles(event.dataTransfer))return;
    event.preventDefault();if(enter){if(!within)port.depth(1);}else if(event.dataTransfer)event.dataTransfer.dropEffect='copy';
    port.external(true,{tabKey:key});
  }
  function leave(event:FileDragEvent,key:string){
    if(transition(event))return;
    if(port.payload(event.dataTransfer)){port.depth(0);port.leave({keepHint:true,tabKey:key});return;}
    if(own(event.dataTransfer))return suppress(event,key);
    const shell=event.currentTarget instanceof Element?event.currentTarget:null;
    if(!hasFiles(event.dataTransfer)&&!shell?.classList.contains('is-drag-over')&&port.overlay(key)?.hidden!==false)return;
    port.depth(0);port.leave({tabKey:key});
  }
  async function drop(event:FileDragEvent,key:string){
    const local=port.localPayload(event.dataTransfer);
    if(local){
      event.preventDefault();event.stopPropagation?.();port.external(false,{tabKey:key});const tab=port.tab(key);
      try{if(tab?.kind==='sftp')await port.local(local,tab,key);}catch(error){port.notify(error instanceof Error?error.message:port.text('sftp:transfer.upload_local_failed'),'error');}return;
    }
    stale(event.dataTransfer);const drag=port.payload(event.dataTransfer);
    if(drag){event.preventDefault();event.stopPropagation?.();const target=port.target(drag,key);port.cancelLeave();port.depth(0);port.external(false,{tabKey:key});if(target)await port.copy(drag,target);else port.finish(drag);return;}
    if(suppress(event,key)||!event.dataTransfer||!hasFiles(event.dataTransfer))return;
    event.preventDefault();port.cancelLeave();port.depth(0);port.external(false,{tabKey:key});
    try{
      const tab=port.tab(key);if(tab?.kind!=='sftp')return;const id=Number(tab.id),path=port.path(tab),current=port.current(key,id,path);
      const files=await port.collect(event.dataTransfer);if(!current())return;if(!files.length)throw new Error(port.text('sftp:transfer.no_upload_files'));
      await port.upload(files,id,path,{tabKey:key,isCurrent:current});
    }catch(error){port.notify(error instanceof Error?error.message:port.text('sftp:transfer.read_drop_failed'),'error');}
  }
  return {hasFiles,own,stale,transition,suppress,ownOver,localOver,over,leave,drop,restore(key:string){const drag=port.payload();if(drag)feedback(drag,key);}};
}
