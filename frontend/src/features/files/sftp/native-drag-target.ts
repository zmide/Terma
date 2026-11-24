import {nativeDragTarget} from './native-drag-adapter';
import type {NativeDragRequest,NativeTarget} from './native-drag-runtime';

interface TargetTab {kind:string;id:number;key:string;path?:string;title?:string}
interface TargetSession {id:number;key:string;mount?:HTMLElement|null;connected?:boolean;currentDirectoryKnown?:boolean;currentDirectory?:string}
interface TargetPort {
  tabs():TargetTab[];active():string;sourceKey(node:Element|null,fallback?:string):string;
  state(key:string):{connectionId:number;path:string}|undefined;
  localState(key:string):{path:string}|undefined;localRoot(key:string):HTMLElement|null;
  sessions():Iterable<TargetSession>;terminalState(session:TargetSession,active:boolean):void;
  terminalLabel(session:TargetSession):string;
  send(id:string,target:NativeTarget|null,final:boolean):void;
  preview(key:string):void;clearPreview():void;
  external(active:boolean,options:{title?:string;path?:string;tabKey?:string;keepHint?:boolean}):void;
  hint(message:string|(()=>string),target:boolean,action:string,key:string):void;
  sourceHint():string;text(key:string,values?:Record<string,unknown>):string;
}
const MISS_GRACE_MS=180;
/** Resolves native pointer hits to a specific open pane, preserving its directory snapshot. */
export function createNativeDragTarget(port:TargetPort){
  function update(id:string,request:NativeDragRequest,value:Record<string,unknown>|null,final=false){
    const target=nativeDragTarget(value),key=target?`${target.kind}\0${target.id}\0${target.tabKey}\0${target.path}`:'';
    if(target)request.nativeTargetMissedAt=0;
    if(request.nativeTargetKey===key&&!final)return;
    request.nativeTargetKey=key;request.nativeTarget=target;port.send(id,target,final);
  }
  function feedback(target:NativeTarget|null|undefined){
    if(!target)return;
    if(target.kind==='terminal'){
      for(const session of port.sessions())port.terminalState(session,session.key===target.tabKey);return;
    }
    if(target.kind==='local-files'){
      const overlay=port.localRoot(target.tabKey)?.querySelector<HTMLElement>('.local-files-drop-overlay');if(overlay)overlay.hidden=false;
      port.hint(()=>port.text('sftp:drag.drop_save_to',{target:target.title}),true,'copy',target.tabKey);return;
    }
    const state=port.state(target.tabKey);
    if(state&&Number(state.connectionId)===target.id)port.external(true,{title:port.text('sftp:transfer.drop_copy_to',{target:target.title}),path:target.path||state.path||'.',tabKey:target.tabKey});
    else port.hint(()=>port.text('sftp:transfer.drop_copy_to',{target:target.title}),true,'copy',target.tabKey);
  }
  function clearHighlights(){document.querySelectorAll('.tab.sftp-drop-target').forEach(tab=>tab.classList.remove('sftp-drop-target'));}
  function hit(id:string,request:NativeDragRequest,x?:number,y?:number,options:{final?:boolean}={}){
    const positioned=Number.isFinite(x)&&Number.isFinite(y),inside=positioned&&x!>=0&&y!>=0&&x!<=window.innerWidth&&y!<=window.innerHeight;
    const now=performance.now(),node=inside?document.elementFromPoint(x!,y!):null;
    const tabNode=node?.closest<HTMLElement>(".tab[data-kind='sftp'], .tab[data-kind='local-files']");
    const tabs=port.tabs();let target:TargetTab|undefined=tabNode?tabs.find(tab=>tab.key===tabNode.dataset.tabKey):undefined;
    if(!target&&node?.closest('.sftp-shell'))target=tabs.find(tab=>tab.kind==='sftp'&&tab.key===port.sourceKey(node,''));
    if(!target&&node?.closest('.local-files-shell')){
      const key=node.closest<HTMLElement>('.local-files-shell')?.dataset.localFilesTabKey,tab=tabs.find(tab=>tab.key===key&&tab.kind==='local-files');
      if(tab){const state=port.localState(tab.key),path=state?.path||tab.path||port.text('sftp:drag.desktop');target={kind:'local-files',id:1,key:tab.key,path:state?.path||tab.path||'',title:port.text('sftp:drag.local_files_target',{path})};}
    }
    if(!target&&node){
      const session=[...port.sessions()].find(item=>item.mount?.contains(node));
      if(session?.connected&&session.currentDirectoryKnown)target={kind:'terminal',id:Number(session.id),key:session.key,path:session.currentDirectory||'.',title:port.text('sftp:drag.terminal_target',{path:port.terminalLabel(session)})};
    }
    if(target&&target.key!==request.sourceTabKey){
      clearHighlights();
      if(['sftp','local-files'].includes(target.kind)){
        tabNode?.classList.add('sftp-drop-target');if(!options.final&&tabNode&&target.key!==port.active())port.preview(target.key);
      }
      const state=target.kind==='sftp'?port.state(target.key):undefined;
      const path=state&&Number(state.connectionId)===Number(target.id)?state.path:target.path||'.';
      const resolved={...target,path};request.nativeTargetSeenAt=now;update(id,request,resolved,!!options.final);
      if(!options.final)feedback(request.nativeTarget);return resolved;
    }
    const transient=!node||node===document.body||node===document.documentElement||!!node.closest('#view-sftp');
    if(options.final&&inside&&transient&&request.nativeTarget&&port.sourceKey(node,port.active())===request.nativeTarget.tabKey&&now-Number(request.nativeTargetSeenAt||0)<MISS_GRACE_MS){
      request.nativeTargetMissedAt=0;update(id,request,{...request.nativeTarget},true);return request.nativeTarget;
    }
    if(!options.final&&request.nativeTarget){
      if(!request.nativeTargetMissedAt)request.nativeTargetMissedAt=now;
      if(now-request.nativeTargetMissedAt<MISS_GRACE_MS){feedback(request.nativeTarget);return request.nativeTarget;}
    }
    request.nativeTargetMissedAt=0;clearHighlights();port.clearPreview();
    for(const session of port.sessions())port.terminalState(session,false);
    port.external(false,{keepHint:true});update(id,request,null,!!options.final);
    if(!options.final)port.hint(()=>port.sourceHint(),false,'',request.sourceTabKey);return null;
  }
  return {update,feedback,hit};
}
