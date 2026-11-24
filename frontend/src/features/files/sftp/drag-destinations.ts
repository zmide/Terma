import {nativeDragKey} from './drag-payload';
import type {BrowserDrag, DragTab, FileDragEvent} from './browser-drag-runtime';
import type {LocalDragPayload} from '../local-drag';
import type {createDragPreview} from './drag-preview';
import type {NativeDragRequest} from './native-drag-runtime';
type Title=string|(()=>string);
interface CopyOptions {title?:Title;tabKey?:string;valid?:()=>boolean}
interface Terminal {connected:boolean;currentDirectoryKnown?:boolean;currentDirectory?:string}
interface Port {
  tab(key:string):DragTab|undefined;active():string;activate(key:string):void;
  localPayload(data?:DataTransfer|null):LocalDragPayload|null;payload(data?:DataTransfer|null):BrowserDrag|null;
  preview():ReturnType<typeof createDragPreview>;inside():void;
  hint(message:Title,target:boolean,action:string,key:string):void;text(key:string,values?:Record<string,unknown>):string;
  notify(message:string,kind:'error'):void;prepareClear():void;finish(drag:BrowserDrag):void;
  localUpload(payload:LocalDragPayload,tab:DragTab,key:string):Promise<unknown>;terminalUpload(payload:LocalDragPayload,tab:DragTab):Promise<unknown>;
  localCopy(drag:BrowserDrag,tab:DragTab):Promise<unknown>;
  session(key:string):Terminal|undefined;initializeTerminal(tab:DragTab,session:Terminal):Promise<string>;
  path(tab:DragTab):string;requests:Map<string,NativeDragRequest>;
  nativeTarget(id:string,request:NativeDragRequest,tab:DragTab):void;
  copy(drag:BrowserDrag,id:number,path:string,options:CopyOptions):Promise<unknown>;
  hintNode():HTMLElement|null;removeHint(node:HTMLElement|null):void;
}
/** Destination decisions retain the tab and directory that received the drop. */
export function createDragDestinations(port:Port){
  function touch(event:FileDragEvent,tab:DragTab,upload=false,element?:HTMLElement|null){
    event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';element?.classList.add('sftp-drop-target');
    port.hint(()=>port.text(upload?'sftp:transfer.drop_upload_to':'sftp:transfer.drop_copy_to',{target:tab.kind==='terminal'?port.text('sftp:drag.terminal_current_directory'):tab.title}),true,upload?'upload':'copy',tab.key);
    port.preview().preview(tab.key,{immediate:tab.kind==='terminal'});
  }
  function over(event:FileDragEvent,key:string,element = event.currentTarget instanceof HTMLElement ? event.currentTarget : null){
    const tab=port.tab(key);if(!tab)return;
    if(port.localPayload(event.dataTransfer)&&['sftp','terminal'].includes(tab.kind)){touch(event,tab,true,element);return;}
    const drag=port.payload(event.dataTransfer);if(!drag||!['sftp','terminal','local-files'].includes(tab.kind)||key===drag.sourceTabKey)return;
    port.inside();const session=port.preview().begin(drag,key);
    if(session){session.lastValidTargetAt=Date.now();session.lastRelatedTarget=element;if(Number.isFinite(event.clientX))session.lastClientX=event.clientX;if(Number.isFinite(event.clientY))session.lastClientY=event.clientY;if(session.invalidTargetTimer)clearTimeout(session.invalidTargetTimer);session.invalidTargetTimer=0;}
    touch(event,tab,false,element);
  }
  function leave(event:FileDragEvent,element = event.currentTarget instanceof HTMLElement ? event.currentTarget : null){
    if(element?.contains(event.relatedTarget as Node|null))return;
    element?.classList.remove('sftp-drop-target');const preview=port.preview(),session=preview.session();
    if(session&&session.previewTabKey===element?.dataset.tabKey){
      const usable=Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)&&(event.clientX!==0||event.clientY!==0);
      const related=event.relatedTarget||(usable?document.elementFromPoint(event.clientX!,event.clientY!):null);
      // Chromium emits an empty leave while the hovered pane is mounted.
      if(!related)return;
      if(preview.targetKey(related)===session.previewTabKey||preview.validTarget(related,session)||preview.paneTarget(related,session,event.clientX,event.clientY)){
        session.lastValidTargetAt=Date.now();session.lastRelatedTarget=related;if(session.invalidTargetTimer)clearTimeout(session.invalidTargetTimer);session.invalidTargetTimer=0;return;
      }
      preview.invalid({target:related,relatedTarget:related,clientX:event.clientX,clientY:event.clientY});return;
    }
    if(port.active()!==element?.dataset.tabKey)preview.clear();
  }
  async function directory(drag:BrowserDrag,id:number,path:string,options:CopyOptions={}){
    if(!drag?.entries.length||!Number.isSafeInteger(id)||id===0)return;
    const key=options.tabKey||'';port.preview().accept(drag,key);port.prepareClear();port.finish(drag);
    const title=()=>typeof options.title==='function'?options.title():options.title||port.text('sftp:drag.target_directory');
    port.hint(()=>port.text('sftp:drag.checking_target',{target:title()}),true,'copy',key);const hint=port.hintNode();
    try{return await port.copy(drag,id,path,{...options,title:()=>port.text('sftp:drag.target_same_name',{target:title()})});}
    catch(error){port.notify(error instanceof Error?error.message:port.text('sftp:drag.copy_failed'),'error');}
    finally{port.removeHint(hint);}
  }
  async function terminal(drag:BrowserDrag,tab:DragTab){
    const session=port.session(tab.key);if(!session?.connected)throw new Error(port.text('sftp:drag.terminal_disconnected'));
    const path=session.currentDirectoryKnown?session.currentDirectory:await port.initializeTerminal(tab,session);
    if(port.session(tab.key)!==session||!session.connected||port.tab(tab.key)!==tab)return;
    if(!path)throw new Error(port.text('sftp:drag.terminal_directory_unknown'));
    return directory(drag,tab.id,path,{title:()=>port.text('sftp:drag.terminal_target',{path}),tabKey:tab.key,
      valid:()=>port.session(tab.key)===session&&session.connected&&(!session.currentDirectoryKnown||session.currentDirectory===path)});
  }
  function remote(drag:BrowserDrag,tab:DragTab){
    if(!drag||tab.kind!=='sftp'||tab.key===drag.sourceTabKey)return;
    port.prepareClear();const path=port.path(tab),key=nativeDragKey(drag.connectionId,drag.entries);
    for(const [id,request] of [...port.requests].reverse()){
      if(request.connectionId===drag.connectionId&&nativeDragKey(request.connectionId,request.entries)===key){port.nativeTarget(id,request,{...tab,path});break;}
    }
    return directory(drag,tab.id,path,{title:tab.title,tabKey:tab.key});
  }
  async function drop(event:FileDragEvent,key:string,element = event.currentTarget instanceof HTMLElement ? event.currentTarget : null){
    const local=port.localPayload(event.dataTransfer),drag=port.payload(event.dataTransfer),tab=port.tab(key);element?.classList.remove('sftp-drop-target');
    if(!tab)return;
    if(local&&['sftp','terminal'].includes(tab.kind)){
      event.preventDefault();event.stopPropagation?.();
      try{if(tab.kind==='terminal')await port.terminalUpload(local,tab);else await port.localUpload(local,tab,key);}
      catch(error){port.notify(error instanceof Error?error.message:port.text('sftp:transfer.upload_local_failed'),'error');}return;
    }
    if(!drag||!['sftp','terminal','local-files'].includes(tab.kind)||key===drag.sourceTabKey)return;
    event.preventDefault();event.stopPropagation?.();port.preview().accept(drag,key);if(port.active()!==key)port.activate(key);
    try{if(tab.kind==='terminal')return await terminal(drag,tab);if(tab.kind==='local-files')return await port.localCopy(drag,tab);return await remote(drag,tab);}
    catch(error){port.notify(error instanceof Error?error.message:port.text(tab.kind==='terminal'?'sftp:drag.copy_to_terminal_failed':'sftp:drag.save_remote_failed'),'error');}
  }
  return {over,leave,drop,terminal,remote,directory};
}
