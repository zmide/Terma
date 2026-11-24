import {INTERNAL_DRAG_MIME, nativeDragKey, serializeDragPayload, type DragEntry} from './drag-payload';
import type {createDragPreview} from './drag-preview';

export interface BrowserDrag {
  connectionId:number; entries:DragEntry[]; sourceTabKey:string; row?:HTMLElement|null;
  browserDragEnded?:boolean; leftWindow?:boolean; leaveWindowTimer?:ReturnType<typeof setTimeout>|0;
  nativeFiles?:string[]|null; nativeStarted?:boolean; previewActivated?:boolean; previewTabKey?:string;
  dropAccepted?:boolean; acceptedTabKey?:string;
}
export interface FileDragEvent {
  currentTarget?:EventTarget|null; target?:EventTarget|null; relatedTarget?:EventTarget|null;
  clientX?:number; clientY?:number; dataTransfer?:DataTransfer|null;
  preventDefault():void; stopPropagation?():void;
}
export interface DragTab {key:string;kind:string;id:number;path?:string;title?:string}
type Mode='streaming'|'staged'|false;
interface Port {
  drag():BrowserDrag|null;setDrag(value:BrowserDrag|null):void;
  preparing():symbol|null;setPreparing(value:symbol|null):void;
  requests:Map<string,BrowserDrag>;armed:Set<string>;
  nativeActive(request:BrowserDrag):boolean;
  mode():Mode;mobile():boolean;
  preview():ReturnType<typeof createDragPreview>;
  pointer():{current():{row:HTMLElement|null;nativeRequestId:string}|null;activate():void;clear():void};
  select(path:string,name:string,type:string,key:string):DragEntry[];
  cache(id:number,entries:DragEntry[]):{files:string[]}|null;
  stage(id:number,entries:DragEntry[]):Promise<{files:string[]}>;
  start(row:HTMLElement|null,id:number,entries:DragEntry[],cached:{files:string[]}|null,mode:Exclude<Mode,false>,key?:string):unknown;
  clearHandoff():void;remember(value:BrowserDrag):unknown;
  clearVisuals(row?:HTMLElement|null):void;fallback():void;
  sourceHint():string;text(key:string,values?:Record<string,unknown>):string;
  hint(message:string|(()=>string),target?:boolean,action?:string,key?:string):void;
  notify(message:string,kind:'error'|'info'):void;
  active():string;tab(key:string):DragTab|undefined;path(tab:DragTab):string;depth():number;
  external(active:boolean,options:{title?:string|(()=>string);path?:string;tabKey?:string}):void;
  hasInternal(transfer?:DataTransfer|null):boolean;
}

/** Browser drag lifecycle, staging and handoff have one owner. Engine/IPC calls remain ports. */
export function createBrowserDragRuntime(port:Port){
  let rowRelease:(()=>void)|null=null;
  const element=(target:EventTarget|null|undefined)=>target instanceof HTMLElement?target:null;
  function unbind(){
    document.removeEventListener('dragenter',over,true);document.removeEventListener('dragover',over,true);document.removeEventListener('dragleave',leave,true);
    rowRelease?.();rowRelease=null;
  }
  function detach(){
    unbind();const drag=port.drag();if(drag?.leaveWindowTimer)clearTimeout(drag.leaveWindowTimer);
    port.setPreparing(null);port.setDrag(null);
  }
  function reset(row?:HTMLElement|null){const previous=port.drag();detach();port.clearVisuals(row||previous?.row);}
  function inside(){const drag=port.drag();if(!drag)return;if(drag.leaveWindowTimer)clearTimeout(drag.leaveWindowTimer);drag.leaveWindowTimer=0;drag.leftWindow=false;}
  function over(event:FileDragEvent){
    inside();const preview=port.preview(),session=preview.session();if(!session||session.accepted)return;
    const x=Number(event.clientX),y=Number(event.clientY);
    if(Number.isFinite(x)&&Number.isFinite(y)){session.lastClientX=x;session.lastClientY=y;}
    if(event.target){session.lastDragTarget=event.target;session.lastRelatedTarget=event.target;}
    if(preview.validTarget(event.target||null,session)||preview.paneTarget(event.target||null,session,x,y)){
      session.lastValidTargetAt=Date.now();if(session.invalidTargetTimer)clearTimeout(session.invalidTargetTimer);session.invalidTargetTimer=0;return;
    }
    preview.invalid(event);
  }
  function leave(event:FileDragEvent){
    const drag=port.drag();if(!drag||event.relatedTarget)return;
    const x=Number(event.clientX),y=Number(event.clientY);
    if(!(x<=0||y<=0||x>=innerWidth||y>=innerHeight))return;
    if(drag.leaveWindowTimer)clearTimeout(drag.leaveWindowTimer);
    drag.leaveWindowTimer=setTimeout(()=>{
      if(port.drag()!==drag)return;drag.leaveWindowTimer=0;drag.leftWindow=true;const mode=port.mode();
      if(mode==='streaming'&&!drag.nativeStarted){port.start(drag.row||null,drag.connectionId,drag.entries,null,mode,drag.sourceTabKey);return;}
      const key=mode==='staged'&&!drag.nativeStarted?(drag.nativeFiles?.length?'staged_ready':'staged_preparing'):'web_external_unavailable';
      port.hint(()=>port.text(`sftp:drag.${key}`));
    },80);
  }
  async function prepare(id:number,entries:DragEntry[],row:HTMLElement|null){
    if(port.mode()!=='staged'||!entries.length)return;
    const drag=port.drag(),token=Symbol('sftp-stage');port.setPreparing(token);row?.classList.add('is-preparing-drag');
    try{
      const staged=await port.stage(id,entries);
      // A second drag must not receive the first drag's staged content.
      if(port.preparing()!==token||!drag||port.drag()!==drag)return;
      drag.nativeFiles=staged.files;
      if(drag.leftWindow){
        port.armed.add(nativeDragKey(id,entries));
        if(drag.browserDragEnded)port.notify(port.text('sftp:drag.content_ready_drag_again'),'info');
        else port.hint(()=>port.text('sftp:drag.ready_for_external'));
      }else if(!drag.browserDragEnded)port.hint(()=>port.text('sftp:drag.cross_host_hint'));
    }catch(error){if(port.preparing()===token)port.notify(error instanceof Error?error.message:port.text('sftp:drag.prepare_failed'),'error');}
    finally{
      // A late stage request must not clear a new drag's visual state.
      if(port.preparing()===token){row?.classList.remove('is-preparing-drag');port.setPreparing(null);if(drag?.browserDragEnded&&port.drag()===drag)reset(row);}
    }
  }
  function begin(event:FileDragEvent,id:number,path:string,name:string,type:string,key:string){
    if(port.mobile()||!event.dataTransfer)return event.preventDefault();
    port.clearHandoff();port.preview().clearSession();const row=element(event.currentTarget),pointer=port.pointer().current();
    if(pointer?.row===row&&pointer.nativeRequestId){event.preventDefault();port.pointer().activate();return;}
    if([...port.requests.values()].some(request=>request.row===row&&port.nativeActive(request))){event.preventDefault();return;}
    port.pointer().clear();
    const entries=port.select(path,name,type,key),mode=port.mode();if(!entries.length){event.preventDefault();return;}
    if(mode==='staged')port.fallback();const cached=mode==='staged'?port.cache(id,entries):null;
    if(mode==='staged'&&cached&&port.armed.has(nativeDragKey(id,entries))){event.preventDefault();port.start(row,id,entries,cached,mode,key);return;}
    const previous=port.drag();if(previous)reset(previous.row);else unbind();
    const drag:BrowserDrag={connectionId:id,entries,sourceTabKey:key,row,browserDragEnded:false,leftWindow:false,leaveWindowTimer:0,nativeFiles:cached?.files||null,nativeStarted:false,previewActivated:false,previewTabKey:'',dropAccepted:false,acceptedTabKey:''};
    port.setDrag(drag);
    const ended=()=>{if(port.drag()!==drag||drag.nativeStarted)return;if(!drag.dropAccepted)port.preview().restore(drag);reset(row);};
    row?.addEventListener('dragend',ended,{once:true});rowRelease=()=>row?.removeEventListener('dragend',ended);
    document.addEventListener('dragenter',over,true);document.addEventListener('dragover',over,true);document.addEventListener('dragleave',leave,true);
    event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData(INTERNAL_DRAG_MIME,serializeDragPayload(id,entries,key));
    row?.classList.add('is-dragging');document.body.classList.add('sftp-item-drag-active');port.hint(()=>port.sourceHint(),false,'',key);
    if(mode==='staged'&&!cached?.files.length)void prepare(id,entries,row);
  }
  function finish(event:FileDragEvent){
    const drag=port.drag();if(drag?.nativeStarted){detach();return;}
    const tab=port.tab(port.active()),transfer=event.dataTransfer;
    if(drag&&port.hasInternal(transfer)&&tab?.kind==='sftp'&&tab.id!==drag.connectionId&&(transfer?.dropEffect==='copy'||port.depth()>0)){
      const snapshot={connectionId:drag.connectionId,entries:drag.entries,sourceTabKey:drag.sourceTabKey};reset(element(event.currentTarget));
      if(port.remember(snapshot))port.external(true,{title:()=>port.text('sftp:transfer.drop_copy_to',{target:tab.title}),path:port.path(tab),tabKey:tab.key});return;
    }
    if(port.mode()==='staged'&&drag?.leftWindow){
      if(drag.nativeFiles?.length){port.armed.add(nativeDragKey(drag.connectionId,drag.entries));port.notify(port.text('sftp:drag.content_ready_drag_again'),'info');}
      if(port.preparing()){drag.browserDragEnded=true;port.clearVisuals(element(event.currentTarget));return;}
    }
    port.preview().restore(drag);reset(element(event.currentTarget));
  }
  function finishPayload(drag:BrowserDrag|null){
    if(!drag)return;port.clearHandoff();if(port.drag()===drag){reset(drag.row);return;}
    for(const [id,request] of port.requests){if(request===drag){port.requests.delete(id);break;}}port.clearVisuals(drag.row);
  }
  return {begin,finish,prepare,reset,detach,inside,over,leave,finishPayload,dispose:()=>reset()};
}
