interface FileKeyboardPort {
  active(): { key:string; kind:string } | null;
  blocked():boolean;
  search(key:string,action:'toggle'|'close'):void;
  selectAll(key:string):void;
}
/** One keyboard owner for the active file pane; dialogs and text selection keep their keys. */
export function installFileKeyboard(port:FileKeyboardPort, root:Document=document) {
  const keydown=(event:KeyboardEvent)=>{
    const tab=port.active();
    if(!tab||port.blocked()||event.defaultPrevented)return;
    const target=event.target instanceof Element?event.target:null;
    const editable=Boolean(target?.closest('input,textarea,select,[contenteditable="true"]'));
    if(tab.kind==='sftp'&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='f') {
      event.preventDefault();event.stopPropagation();port.search(tab.key,'toggle');
    }else if(tab.kind==='sftp'&&event.key==='Escape'&&target?.closest('.sftp-search')) {
      event.preventDefault();event.stopPropagation();port.search(tab.key,'close');
    }else if(tab.kind==='local-files'&&!editable&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key.toLowerCase()==='a') {
      event.preventDefault();event.stopPropagation();port.selectAll(tab.key);
    }
  };
  root.addEventListener('keydown',keydown,true);
  return ()=>root.removeEventListener('keydown',keydown,true);
}
