interface TerminalDropSession {key?:string;mount?:HTMLElement|null;terminalDropDepth?:number}
interface DropOptions {tabKey?:string;keepHint?:boolean;path?:string;title?:string|(()=>string)}
interface DropFeedbackPort {
  active():string;keys():Iterable<string>;root(key:string):HTMLElement|null;
  element(id:string,key:string):HTMLElement|null;path(key:string):string|undefined;
  terminals():Iterable<TerminalDropSession>;depth():number;resetDepth():void;ownDrag():boolean;
  activity():void;hint(message:string|(()=>string),target:boolean,action:string,key:string):void;removeHint():void;
  text(key:string,values:Record<string,unknown>):string;
}
/** Owns exactly one visible drop destination across file and terminal panes. */
export function createDropFeedback(port:DropFeedbackPort){
  let targetKind='',targetKey='',targetSession:TerminalDropSession|null=null,leaveTimer:ReturnType<typeof setTimeout>|0=0;
  function cancelLeave(){if(leaveTimer)clearTimeout(leaveTimer);leaveTimer=0;}
  function clearFile(key:string){
    port.root(key)?.querySelector('.sftp-shell')?.classList.remove('is-drag-over');
    const overlay=port.element('sftpDropOverlay',key);
    if(overlay){overlay.hidden=true;overlay.removeAttribute('style');overlay.dataset.mode='upload';}
  }
  function reset(){targetKind='';targetKey='';targetSession=null;}
  function focus(kind:string,key='',session:TerminalDropSession|null=null){
    const nextKind=kind==='terminal'?'terminal':'sftp';cancelLeave();
    if(nextKind==='terminal')port.resetDepth();
    for(const fileKey of port.keys()){if(nextKind==='sftp'&&fileKey===key)continue;clearFile(fileKey);}
    for(const item of port.terminals()){
      if(nextKind==='terminal'&&(item===session||key&&item.key===key))continue;
      item.terminalDropDepth=0;const overlay=item.mount?.querySelector<HTMLElement>('.terminal-drop-overlay');if(overlay)overlay.hidden=true;
    }
    if(nextKind==='terminal')port.removeHint();
    targetKind=nextKind;targetKey=key;targetSession=session;
  }
  function release(kind:string,key='',session:TerminalDropSession|null=null){
    const nextKind=kind==='terminal'?'terminal':'sftp';
    if(targetKind!==nextKind||!(nextKind==='terminal'?targetSession===session||key&&targetKey===key:targetKey===key))return false;
    reset();return true;
  }
  function external(active:boolean,options:DropOptions={}){
    const key=String(options.tabKey||port.active()||'');
    if(!active){
      const clears=options.tabKey?release('sftp',options.tabKey):true;
      if(!options.tabKey)reset();
      for(const fileKey of options.tabKey?[options.tabKey]:port.keys())clearFile(fileKey);
      if(!options.keepHint&&clears)port.removeHint();return;
    }
    cancelLeave();port.activity();focus('sftp',key);
    const shell=port.root(key)?.querySelector<HTMLElement>('.sftp-shell'),overlay=port.element('sftpDropOverlay',key);
    shell?.classList.add('is-drag-over');if(!overlay)return;
    overlay.hidden=false;const copy=port.ownDrag();overlay.dataset.mode=copy?'copy':'upload';
    const path=options.path||port.path(key)||'.';
    port.hint(()=>(typeof options.title==='function'?options.title():options.title)||port.text(copy?'sftp:transfer.drop_copy_to':'sftp:transfer.drop_upload_to',{target:path}),true,copy?'copy':'upload',key);
    const rect=(port.element('sftpList',key)||shell)?.getBoundingClientRect();if(!rect)return;
    const sticky=shell?.querySelector('.sftp-top')?.getBoundingClientRect();
    const left=Math.max(0,rect.left),top=Math.max(Math.max(0,Number(sticky?.bottom||0)+4),rect.top),right=Math.min(window.innerWidth,rect.right),bottom=Math.min(window.innerHeight,rect.bottom);
    if(right<=left||bottom<=top){overlay.hidden=true;return;}
    Object.assign(overlay.style,{left:`${left}px`,top:`${top}px`,width:`${right-left}px`,height:`${bottom-top}px`});
  }
  function scheduleLeave(options:DropOptions={}){
    cancelLeave();const snapshot={...options};leaveTimer=setTimeout(()=>{leaveTimer=0;if(port.depth()<=0)external(false,snapshot);},90);
  }
  return {focus,release,external,cancelLeave,scheduleLeave,dispose(){cancelLeave();external(false);}};
}
