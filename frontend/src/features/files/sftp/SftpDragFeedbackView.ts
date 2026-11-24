import { h, render, Fragment } from 'vue';
import { settingsIcon } from '@/features/settings/settings-icon';

interface DragEntry {name?:string;path?:string;type?:string}
interface FeedbackViewPort {
  host(key:string):HTMLElement|null;
  text(key:string,values?:Record<string,unknown>):string;
}
/** A single Vue owner for transient drag hints and the pointer preview. */
export function createSftpDragFeedbackView(port:FeedbackViewPort){
  let hint:HTMLElement|null=null,preview:HTMLElement|null=null;
  let hintModel:{message:string|(()=>string);target:boolean;action:string;key:string}|null=null;
  let previewModel:{entries:DragEntry[];x:number;y:number}|null=null;
  function root(id:string,className:string){
    const element=document.createElement('div');element.id=id;element.className=className;
    element.setAttribute('data-i18n-skip','');document.body.appendChild(element);return element;
  }
  function removeHint(expected?:HTMLElement|null){
    if(expected&&hint!==expected)return;
    hintModel=null;
    if(hint){render(null,hint);hint.remove();hint=null;}
  }
  function removePreview(){previewModel=null;if(preview){render(null,preview);preview.remove();preview=null;}}
  function showHint(message:string|(()=>string),target=false,action='',key=''){
    hintModel={message,target,action,key};
    if(!hint?.isConnected){if(hint)render(null,hint);hint=root('sftpDragHint','sftp-drag-hint');hint.setAttribute('aria-live','polite');}
    hint.classList.toggle('is-target',target);
    const iconName=action==='upload'?'upload-cloud':target?'copy':'move';
    render(h(Fragment,null,[settingsIcon(iconName),h('span',null,typeof message==='function'?message():message)]),hint);
    const rect=port.host(key)?.getBoundingClientRect(),width=window.innerWidth||document.documentElement.clientWidth;
    const left=Math.max(0,Number(rect?.left)),right=Math.min(width,Number(rect?.right)),visible=Math.max(0,right-left);
    if(visible>0){
      const inset=Math.min(16,Math.max(4,visible/8));
      hint.style.left=`${left+visible/2}px`;hint.style.maxWidth=`${Math.max(1,Math.min(520,visible-inset*2))}px`;hint.dataset.positionTabKey=key;
    }else if(!hint.style.left){hint.style.left='50%';hint.style.maxWidth='min(520px,calc(100vw - 32px))';}
    return hint;
  }
  function movePreview(clientX:number,clientY:number){
    if(!preview)return;
    if(previewModel){previewModel.x=clientX;previewModel.y=clientY;}
    const inside=Number.isFinite(clientX)&&Number.isFinite(clientY)&&clientX>=0&&clientY>=0&&clientX<=window.innerWidth&&clientY<=window.innerHeight;
    preview.hidden=!inside;if(!inside)return;
    const width=Math.min(260,Math.max(1,window.innerWidth-24));
    preview.style.left=`${Math.max(8,Math.min(clientX+16,window.innerWidth-width-8))}px`;
    preview.style.top=`${Math.max(8,Math.min(clientY+18,window.innerHeight-62))}px`;
  }
  function showPreview(entries:DragEntry[],clientX:number,clientY:number){
    if(!entries.length)return;
    previewModel={entries:entries.map(entry=>({...entry})),x:clientX,y:clientY};
    if(!preview?.isConnected){if(preview)render(null,preview);preview=root('sftpDragPreview','sftp-drag-preview');}
    const first=entries[0],directory=['dir','directory'].includes(first.type||'');
    const name=first.name||first.path?.split('/').filter(Boolean).pop()||port.text('sftp:drag.remote_item');
    const summary=entries.length>1?port.text('sftp:auto.item_count',{count:entries.length}):port.text(directory?'sftp:drag.remote_directory':'sftp:drag.remote_file');
    render(h(Fragment,null,[
      h('span',{class:'sftp-drag-preview-icon'},settingsIcon(directory?'folder':'file')),
      h('span',{class:'sftp-drag-preview-copy'},[h('strong',{'data-i18n-skip':''},name),h('small',null,summary)]),
      entries.length>1?h('b',null,entries.length):null
    ]),preview);
    movePreview(clientX,clientY);
  }
  function language(){
    if(hintModel&&hint?.isConnected){const model=hintModel;showHint(model.message,model.target,model.action,model.key);}
    if(previewModel&&preview?.isConnected){const model=previewModel;showPreview(model.entries,model.x,model.y);}
  }
  window.addEventListener('terma:language-changed',language);
  return {showHint,showPreview,movePreview,removeHint,removePreview,hint:()=>hint,dispose(){window.removeEventListener('terma:language-changed',language);removeHint();removePreview();}};
}
