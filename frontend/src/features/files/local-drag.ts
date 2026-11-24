import type {LocalEntry} from './local-file-service';
import type {FileTransferTarget} from './file-transfer-service';
import type {BrowserDrag} from './sftp/browser-drag-runtime';
export const LOCAL_FILE_DRAG_MIME='application/x-terma-local-files';
export interface LocalDragPayload {sourceTabKey:string;paths:string[];entries:{path:string;name:string;type:'file'|'dir';size:number}[]}
export function normalizeLocalDrag(value:unknown):LocalDragPayload|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const input=value as Record<string,unknown>;
  if(!Array.isArray(input.paths)||!input.paths.length||input.paths.length>1000||input.paths.some(path=>typeof path!=='string'||!path||path.length>32768||path.includes('\0')))return null;
  const paths=[...new Set(input.paths as string[])],supplied=Array.isArray(input.entries)?input.entries:[];
  return {sourceTabKey:typeof input.sourceTabKey==='string'?input.sourceTabKey:'',paths,entries:paths.map(path=>{
    const item=supplied.find(item=>item&&typeof item==='object'&&item.path===path) as Partial<LocalEntry>|undefined;
    return {path,name:typeof item?.name==='string'?item.name:path.split(/[\\/]/).pop()||path,type:item?.type==='dir'?'dir':'file',size:Number.isFinite(item?.size)?Math.max(0,Number(item!.size)):0};
  })};
}
export interface LocalDragPort {
  pick(key:string,path:string):LocalEntry[];
  preview(entries:LocalDragPayload['entries'],x:number,y:number):void;
  move(x:number,y:number):void;
  clear():void;
}
export function createLocalDrag(port:LocalDragPort){
  let current:LocalDragPayload|null=null,handoff:{payload:LocalDragPayload;expiresAt:number}|null=null,bound=false;
  function has(data:Pick<DataTransfer,'types'>|null){return Array.from(data?.types||[]).some(type=>type.toLowerCase()===LOCAL_FILE_DRAG_MIME);}
  function read(data:Pick<DataTransfer,'types'|'getData'>|null=null){
    if(handoff&&handoff.expiresAt<=Date.now())handoff=null;
    const retained=current||handoff?.payload||null;
    let text='',raw='';try{text=data?.getData('text/plain')||'';raw=data?.getData(LOCAL_FILE_DRAG_MIME)||'';}catch{/* Chromium protects the values while dragging. */}
    const matches=!!retained&&!!text&&text.replace(/\r\n/g,'\n')===retained.paths.join('\n').replace(/\r\n/g,'\n');
    if(!current&&!has(data)&&!matches)return null;
    try{if(raw){const parsed=normalizeLocalDrag(JSON.parse(raw));if(parsed)return parsed;}}catch{/* Malformed or protected payloads never replace the owned snapshot. */}
    return retained?normalizeLocalDrag(retained):null;
  }
  function finish(options:{immediate?:boolean}={}){
    if(!options.immediate&&current)handoff={payload:current,expiresAt:Date.now()+4000};
    current=null;if(options.immediate)handoff=null;port.clear();
  }
  function bind(){
    if(bound||typeof document==='undefined'||typeof document.addEventListener!=='function')return;bound=true;
    document.addEventListener('dragover',event=>{if(current)port.move(event.clientX,event.clientY);},true);
    document.addEventListener('dragend',()=>finish(),true);
    document.addEventListener('drop',()=>setTimeout(()=>finish({immediate:true}),0),true);
    window.addEventListener('pagehide',()=>finish({immediate:true}));
  }
  function begin(event:DragEvent,path:string,key:string,row:HTMLElement|null){
    const entries=port.pick(key,path),payload=normalizeLocalDrag({sourceTabKey:key,paths:entries.map(item=>item.path),entries});
    if(!payload||!event.dataTransfer){event.preventDefault();return false;}
    current=payload;handoff=null;event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData(LOCAL_FILE_DRAG_MIME,JSON.stringify(payload));event.dataTransfer.setData('text/plain',payload.paths.join('\n'));
    row?.classList.add('is-dragging');document.body?.classList.add('local-files-item-drag-active');port.preview(payload.entries,event.clientX,event.clientY);bind();return true;
  }
  return {begin,read,finish,has,bind};
}
interface LocalDropEvent {
  dataTransfer:DataTransfer|null;relatedTarget?:EventTarget|null;currentTarget?:EventTarget|null;
  preventDefault():void;stopPropagation():void;
}
interface LocalDropPort {
  payload(data:DataTransfer|null):BrowserDrag|null;location(key:string):string|undefined;
  overlay(key:string):HTMLElement|null;activity():void;tab(key:string):FileTransferTarget|undefined;
  receive(drag:BrowserDrag,target:FileTransferTarget|undefined):Promise<unknown>;
  text(key:string):string;notify(message:string,kind:'error'):void;
}
/** Owns remote drops onto native, server-device and browser-authorized file pages. */
export function createLocalDrop(port:LocalDropPort){
  const hide=(key:string)=>{const overlay=port.overlay(key);if(overlay)overlay.hidden=true;};
  function over(event:LocalDropEvent,key:string){
    const location=port.location(key);if(!port.payload(event.dataTransfer)||!location||location==='computer')return;
    port.activity();event.preventDefault();event.stopPropagation();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';
    port.overlay(key)?.removeAttribute('hidden');
  }
  function leave(event:LocalDropEvent,key:string,root=event.currentTarget){
    if(root instanceof Node&&event.relatedTarget instanceof Node&&root.contains(event.relatedTarget))return;
    hide(key);
  }
  async function drop(event:LocalDropEvent,key:string){
    const drag=port.payload(event.dataTransfer);hide(key);if(!drag)return;
    event.preventDefault();event.stopPropagation();
    try{return await port.receive(drag,port.tab(key));}
    catch(error){const message=error&&typeof error==='object'&&'message'in error&&typeof error.message==='string'?error.message:'';port.notify(message||port.text('sftp:local_files.save_remote_failed'),'error');return false;}
  }
  return {over,leave,drop};
}
