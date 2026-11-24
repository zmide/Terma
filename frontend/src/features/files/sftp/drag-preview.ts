export interface PreviewDrag {sourceTabKey:string;dropAccepted?:boolean;acceptedTabKey?:string;previewActivated?:boolean;previewTabKey?:string}
interface PreviewTab {key:string;kind:string;title?:string}
interface PreviewSession {
  drag:PreviewDrag;sourceTabKey:string;previewTabKey:string;accepted:boolean;acceptedTabKey:string;
  invalidTargetTimer:ReturnType<typeof setTimeout>|0;lastValidTargetAt:number;startedAt:number;
  lastClientX?:number;lastClientY?:number;lastDragTarget?:EventTarget|null;lastRelatedTarget?:EventTarget|null;
}
interface PreviewPort {
  active():string;tabs():PreviewTab[];payload():PreviewDrag|null;activate(key:string):void;
  view(key:string):HTMLElement|null;terminalKey(node:Element):string;
  hint(message:string|(()=>string),target:boolean,action:string,key:string):void;
  text(key:string,values?:Record<string,unknown>):string;
}
const GRACE=360;
/** Owns hover activation and source restoration without borrowing the active pane's state. */
export function createDragPreview(port:PreviewPort){
  let session:PreviewSession|null=null,previewKey='',timer:ReturnType<typeof setTimeout>|0=0,revision=0;
  function clear(){revision++;if(timer)clearTimeout(timer);timer=0;previewKey='';}
  function begin(drag:PreviewDrag|null,key:string){
    if(!drag?.sourceTabKey)return null;
    if(!session||session.drag!==drag||session.sourceTabKey!==drag.sourceTabKey){
      if(session?.invalidTargetTimer)clearTimeout(session.invalidTargetTimer);
      session={drag,sourceTabKey:drag.sourceTabKey,previewTabKey:key,accepted:false,acceptedTabKey:'',invalidTargetTimer:0,lastValidTargetAt:Date.now(),startedAt:Date.now()};
    }else session.previewTabKey=key;
    return session;
  }
  function node(target:EventTarget|null|undefined):Element|null{
    if(!target)return null;const candidate=target as Node;
    return candidate.nodeType===1?candidate as Element:candidate.parentElement||null;
  }
  function targetKey(target:EventTarget|null|undefined){
    const element=node(target);if(!element)return '';
    const tab=element.closest<HTMLElement>('.tab[data-tab-key]');if(tab)return tab.dataset.tabKey||'';
    const sftp=element.closest<HTMLElement>('.sftp-shell[data-sftp-tab-key], .sftp-shell[data-tab-key], #view-sftp');
    if(sftp)return sftp.dataset.sftpTabKey||sftp.dataset.tabKey||sftp.dataset.workspaceTabKey||'';
    const local=element.closest<HTMLElement>('.local-files-shell[data-local-files-tab-key], .local-files-shell[data-tab-key], #view-local-files');
    return local?(local.dataset.localFilesTabKey||local.dataset.tabKey||local.dataset.workspaceTabKey||''):port.terminalKey(element);
  }
  function paneElement(owner:PreviewSession|null=session){return owner?.previewTabKey?port.view(owner.previewTabKey):null;}
  function inside(element:Element|null,x?:number,y?:number){
    if(!element||!Number.isFinite(Number(x))||!Number.isFinite(Number(y)))return false;
    const rect=element.getBoundingClientRect();return Number(x)>=rect.left&&Number(x)<=rect.right&&Number(y)>=rect.top&&Number(y)<=rect.bottom;
  }
  function paneTarget(target:EventTarget|null,owner:PreviewSession|null=session,x?:number,y?:number){const pane=paneElement(owner),element=node(target);return Boolean(pane&&(element&&pane.contains(element)||inside(pane,x,y)));}
  function validInternal(target:EventTarget|null){
    const element=node(target);if(!element)return false;
    const tab=element.closest<HTMLElement>('.tab[data-tab-key]');
    if(tab){const key=tab.dataset.tabKey||'';if(key===session?.sourceTabKey)return false;return port.tabs().some(item=>item.key===key&&['sftp','terminal','local-files'].includes(item.kind));}
    return Boolean(element.closest('.sftp-shell, #view-sftp, .terminal-box, .terminal-drop-overlay, .sftp-drop-overlay, .local-files-shell, #view-local-files, .local-files-drop-overlay'));
  }
  function validTarget(target:EventTarget|null,owner:PreviewSession|null=session){return validInternal(target)&&(!targetKey(target)||targetKey(target)!==owner?.sourceTabKey);}
  function clearSession(drag?:PreviewDrag|null){
    if(!session||drag&&session.drag!==drag&&session.sourceTabKey!==drag.sourceTabKey)return;
    if(session.invalidTargetTimer)clearTimeout(session.invalidTargetTimer);session=null;
  }
  function restore(drag?:PreviewDrag|null){
    if(drag?.dropAccepted||session?.accepted||!drag?.previewActivated&&!session)return;
    const key=drag?.sourceTabKey||session?.sourceTabKey;
    clear();clearSession(drag);
    if(key&&port.active()!==key&&port.tabs().some(tab=>tab.key===key))port.activate(key);
  }
  function invalid(event?:{clientX?:number;clientY?:number;target?:EventTarget|null;relatedTarget?:EventTarget|null}|null){
    const owner=session;if(!owner||owner.accepted)return;
    if(Number.isFinite(Number(event?.clientX))&&Number.isFinite(Number(event?.clientY))){owner.lastClientX=Number(event?.clientX);owner.lastClientY=Number(event?.clientY);}
    if(event?.target)owner.lastDragTarget=event.target;if(event?.relatedTarget)owner.lastRelatedTarget=event.relatedTarget;
    if(owner.invalidTargetTimer)clearTimeout(owner.invalidTargetTimer);
    owner.invalidTargetTimer=setTimeout(()=>{
      owner.invalidTargetTimer=0;if(session!==owner||owner.accepted)return;
      const hit=Number.isFinite(owner.lastClientX)&&Number.isFinite(owner.lastClientY)?document.elementFromPoint(owner.lastClientX!,owner.lastClientY!):null;
      const target=hit||owner.lastDragTarget||owner.lastRelatedTarget||null;
      if(owner.previewTabKey&&targetKey(target)===owner.previewTabKey||validTarget(target,owner)||paneTarget(target,owner,owner.lastClientX,owner.lastClientY)){owner.lastValidTargetAt=Date.now();return;}
      if(Date.now()-owner.lastValidTargetAt<GRACE){invalid();return;}restore(owner.drag);
    },GRACE);
  }
  function accept(drag:PreviewDrag|null,key=''){if(!drag)return;drag.dropAccepted=true;drag.acceptedTabKey=key;clear();clearSession(drag);}
  function preview(key:string,options:{immediate?:boolean}={}){
    if(port.active()===key||previewKey===key&&timer)return;clear();previewKey=key;const ownerRevision=revision;
    const activate=()=>{
      if(ownerRevision!==revision)return;
      timer=0;const drag=port.payload(),tab=port.tabs().find(item=>item.key===key);
      if(!drag||drag.dropAccepted||!tab||!['sftp','terminal'].includes(tab.kind)||tab.key===drag.sourceTabKey){clear();return;}
      begin(drag,key);drag.previewActivated=true;drag.previewTabKey=key;port.activate(key);
      requestAnimationFrame(()=>{
        if(ownerRevision!==revision)return;
        const current=port.payload(),target=port.tabs().find(item=>item.key===key);
        if(current!==drag||current.dropAccepted||port.active()!==key||!target||!['sftp','terminal'].includes(target.kind)){
          // An old animation frame must not cancel a new drag's hover timer.
          if(session?.drag===drag&&session.previewTabKey===key){clear();clearSession(drag);}
          return;
        }
        [...document.querySelectorAll<HTMLElement>('.tab[data-tab-key]')].find(item=>item.dataset.tabKey===key)?.classList.add('sftp-drop-target');
        const label=target.kind==='terminal'?port.text('sftp:drag.terminal_current_directory'):target.title||'';
        port.hint(()=>port.text('sftp:transfer.drop_copy_to',{target:target.kind==='terminal'?port.text('sftp:drag.terminal_current_directory'):label}),true,'copy',key);
      });
    };
    if(options.immediate)activate();else timer=setTimeout(activate,120);
  }
  return {clear,begin,node,targetKey,paneElement,inside,paneTarget,validInternal,validTarget,invalid,clearSession,accept,restore,preview,session:()=>session,dispose(){clear();clearSession();}};
}
