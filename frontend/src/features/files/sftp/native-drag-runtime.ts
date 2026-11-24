import {nativeDragKey, type DragEntry} from './drag-payload';
import {nativeDragSnapshot, nativeDragTarget, type createNativeDragAdapter} from './native-drag-adapter';

type Mode = 'staged' | 'streaming';
export type NativeTarget = NonNullable<ReturnType<typeof nativeDragTarget>>;
export interface NativeDragRequest {
  key:string; mode:Mode; row:HTMLElement|null; sourceTabKey:string; connectionId:number;
  entries:DragEntry[]; files:string[]; activated:boolean; nativeReady:boolean;
  createdAt:number; lastActivityAt:number; nativeStarted?:boolean; released?:boolean; cancelled?:boolean;
  nativeTarget?:NativeTarget|null; nativeTargetKey?:string; nativeTargetSeenAt?:number; nativeTargetMissedAt?:number;
}
interface NativeEvent {requestId?:unknown;type?:string;clientX?:number;clientY?:number}
interface NativeResult {requestId?:unknown;ok?:boolean;message?:string;internalTarget?:Record<string,unknown>;renamedItems?:{savedName?:string}[]}
interface TargetTab {key:string;id:number;kind:string;path?:string}
interface NativeRuntimePort {
  requests:Map<string,NativeDragRequest>;armed:Set<string>;cache:Map<string,unknown>;
  adapter():ReturnType<typeof createNativeDragAdapter>;
  sourceKey(row:HTMLElement|null):string;
  internal():{row?:HTMLElement|null;nativeStarted?:boolean}|null;
  clearInternal(request:NativeDragRequest):void;
  clearVisuals(row:HTMLElement|null):void;hint(key:string):void;
  activity():void;preview(entries:DragEntry[],x?:number,y?:number):void;move(x:number,y:number):void;
  pointer():{ready(id:string):void;started(id:string):void;release(id:string):void};
  hit(id:string,request:NativeDragRequest,x?:number,y?:number,final?:boolean):unknown;
  refresh():Promise<unknown>;startTimer():void;
  target(kind:string,key:string):TargetTab|undefined;
  clearTerminal(key:string):void;
  local(request:NativeDragRequest,target:TargetTab):Promise<unknown>;
  remote(request:NativeDragRequest,target:TargetTab):Promise<unknown>;
  terminal(request:NativeDragRequest,id:number,path:string,title:string,key:string):Promise<unknown>;
  text(key:string,values?:Record<string,unknown>):string;
  notify(message:string,kind:'info'|'error'):void;
}

/** Owns native request settlement. IPC and the browser hit test are explicit ports. */
export function createNativeDragRuntime(port:NativeRuntimePort){
  const timers=new Set<ReturnType<typeof setTimeout>>();
  const sources=new WeakMap<NativeDragRequest,ReturnType<NativeRuntimePort['internal']>>();
  let disposed=false;
  function refreshLater(){
    const timer=setTimeout(()=>{timers.delete(timer);if(!disposed)void port.refresh().catch(()=>{});},250);timers.add(timer);
  }
  function clear(request:NativeDragRequest){
    const internal=port.internal(),source=sources.get(request);
    const otherRequests=[...port.requests.values()].filter(other=>other!==request&&!other.released&&!other.cancelled);
    // Settlement may finish after a new browser or native drag has started, even on the same row.
    if(internal&&internal!==source||otherRequests.length){
      if(request.row&&request.row!==internal?.row&&!otherRequests.some(other=>other.row===request.row))request.row.classList.remove('is-dragging','is-preparing-drag');
      return;
    }
    if(internal?.nativeStarted)port.clearInternal(request);
    port.clearVisuals(request.row);
  }
  function start(row:HTMLElement|null,id:number,entries:DragEntry[],cached:{files?:string[]}|null,mode:Mode,options:{armed?:boolean;sourceTabKey?:string}={}){
    if(disposed||!['staged','streaming'].includes(mode))return '';
    let snapshot:ReturnType<typeof nativeDragSnapshot>;
    try{snapshot=nativeDragSnapshot(id,entries);}catch{port.notify(port.text('sftp:drag.native_start_failed'),'error');return '';}
    const key=nativeDragKey(id,snapshot.entries),requestId=`${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if(mode==='staged')port.armed.delete(key);
    const request:NativeDragRequest={key,mode,row,sourceTabKey:options.sourceTabKey||port.sourceKey(row),connectionId:id,entries:snapshot.entries,files:mode==='staged'?[...(cached?.files||[])]:[],activated:!options.armed,nativeReady:false,createdAt:Date.now(),lastActivityAt:Date.now()};
    port.requests.set(requestId,request);
    const internal=port.internal();sources.set(request,internal?.row===row?internal:null);if(internal?.row===row)internal.nativeStarted=true;
    if(!options.armed){document.body.classList.add('sftp-item-drag-active');port.hint(request.sourceTabKey);}
    try{port.adapter().start(mode,id,request.entries,request.files,request.sourceTabKey,requestId);return requestId;}
    catch(error){
      port.requests.delete(requestId);if(mode==='staged')port.armed.add(key);
      if(internal?.row===row)internal.nativeStarted=false;
      port.clearVisuals(row);port.notify(error instanceof Error?error.message:port.text('sftp:drag.native_start_failed'),'error');return '';
    }
  }
  function event(value:NativeEvent){
    if(disposed)return;
    const id=String(value?.requestId||''),request=port.requests.get(id);if(!request)return;
    request.lastActivityAt=Date.now();
    if(['started','motion','released'].includes(value.type||''))port.activity();
    if(value.type==='transferStarted'){void port.refresh().catch(()=>{}).finally(()=>{if(!disposed)port.startTimer();});return;}
    if(value.type==='ready'){request.nativeReady=true;port.pointer().ready(id);if(request.activated)port.adapter().activate(id);return;}
    if(value.type==='started'){request.nativeStarted=true;port.pointer().started(id);port.preview(request.entries,value.clientX,value.clientY);return;}
    if(value.type==='released'){
      port.hit(id,request,value.clientX,value.clientY,true);request.released=true;port.pointer().release(id);clear(request);refreshLater();return;
    }
    if(value.type!=='motion'||!Number.isFinite(value.clientX)||!Number.isFinite(value.clientY))return;
    port.move(value.clientX!,value.clientY!);port.hit(id,request,value.clientX,value.clientY);
  }
  async function result(value:NativeResult){
    if(disposed)return;
    const id=String(value?.requestId||''),request=port.requests.get(id);if(!request)return;
    // Claim before delivery: duplicate or late IPC callbacks cannot copy twice.
    port.requests.delete(id);port.pointer().release(id);
    const target=value.internalTarget?nativeDragTarget(value.internalTarget):null;
    if(value.ok&&target&&target.tabKey!==request.sourceTabKey){
      const tab=port.target(target.kind,target.tabKey);
      // A closed target must not fall back to another tab on the same server.
      if(tab&&(target.kind==='local-files'||Number(tab.id)===target.id)&&(tab.path===undefined||tab.path===target.path)){
        const destination={...tab,path:target.path||tab.path||'.'};
        try{
          if(target.kind==='local-files')await port.local(request,destination);
          else if(target.kind==='terminal'){
            port.clearTerminal(target.tabKey);
            const path=target.path||'.',title=port.text('sftp:drag.terminal_target',{path:target.path||port.text('sftp:drag.current_directory')});
            await port.terminal(request,target.id,path,title,target.tabKey);
          }else await port.remote(request,destination);
        }catch(error){port.notify(error instanceof Error?error.message:port.text('sftp:drag.copy_failed'),'error');}
        finally{clear(request);}
        return;
      }
    }
    clear(request);void port.refresh().catch(()=>{});
    if(value.ok&&!value.internalTarget){
      if(request.mode==='staged'){port.armed.delete(request.key);port.cache.delete(request.key);}
      const renamed=(Array.isArray(value.renamedItems)?value.renamedItems:[]).filter(item=>typeof item?.savedName==='string'&&item.savedName);
      if(renamed.length){
        const names=renamed.slice(0,3).map(item=>item.savedName).join(port.text('sftp:drag.item_separator'));
        const suffix=renamed.length>3?port.text('sftp:drag.more_items',{count:renamed.length}):'';
        port.notify(port.text('sftp:drag.finder_renamed',{names,suffix}),'info');
      }
      return;
    }
    if(request.mode==='staged')port.armed.add(request.key);
    if(/取消|cancelled|canceled/i.test(String(value.message||'')))return;
    port.notify(value.message||port.text('sftp:drag.native_retry'),'error');
  }
  return {start,event,result,dispose(){disposed=true;for(const timer of timers)clearTimeout(timer);timers.clear();}};
}
