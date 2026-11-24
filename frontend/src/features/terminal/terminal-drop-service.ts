import type {TerminalDirectorySession} from './terminal-directory-service';
import type {FileTransferPayload} from '../files/file-transfer-service';
import type {DroppedFile} from '../files/sftp/dropped-files';
import type {BrowserDrag} from '../files/sftp/browser-drag-runtime';
import {connectionStamp,type ManagementConnection} from '../remote/management-types';
export interface TerminalDropSession extends TerminalDirectorySession {key:string;id:number;terminalDropDepth?:number;connection?:ManagementConnection}
type Files=DroppedFile[];
export interface TerminalDropPort {
 current(session:TerminalDropSession):boolean;
 initialize(session:TerminalDropSession,id:number):Promise<string>;
 local(data:DataTransfer|null):FileTransferPayload|null;
 remote(data:DataTransfer|null):BrowserDrag|null;
 hasFiles(data:DataTransfer|null):boolean;
 collect(data:DataTransfer|null,signal:AbortSignal):Promise<Files>;
 copy(drag:BrowserDrag,id:number,path:string,key:string,valid:()=>boolean):Promise<unknown>;
 uploadLocal(payload:FileTransferPayload,id:number,path:string,key:string,valid:()=>boolean):Promise<unknown>;
 uploadFiles(files:Files,id:number,path:string,key:string,valid:()=>boolean):Promise<unknown>;
 finish(drag:BrowserDrag):void;
 feedback(session:TerminalDropSession,enabled:boolean,mode:'upload'|'copy'):void;
 inside():void;
 text(key:string,params?:Record<string,unknown>):string;
 notify(message:string,kind:'error'|'info'):void;
 icon():string;
}
export function createTerminalDropService(port:TerminalDropPort) {
 const bindings=new Map<TerminalDropSession,{mount:HTMLElement;controller:AbortController;pending:Set<AbortController>}>();
 function clear(session:TerminalDropSession) {session.terminalDropDepth=0;port.feedback(session,false,'upload');}
 function capture(session:TerminalDropSession) {
  const {socket,connectionAttempt}=session,id=session.id,stamp=session.connection?connectionStamp(session.connection):'';
  return ()=>port.current(session)&&!!session.connected&&session.id===id&&session.socket===socket&&session.connectionAttempt===connectionAttempt&&(session.connection?connectionStamp(session.connection):'')===stamp;
 }
 async function destination(session:TerminalDropSession,valid:()=>boolean) {
  if(!valid())throw new Error(port.text('terminal:drop.not_connected'));
  const directory=session.currentDirectoryKnown?session.currentDirectory:await port.initialize(session,session.id);
  if(!valid())return '';
  if(!directory)throw new Error(port.text('terminal:drop.directory_unknown'));
  return directory;
 }
 async function uploadLocal(payload:FileTransferPayload,session:TerminalDropSession) {
  const current=capture(session),directory=await destination(session,current);
  if(!directory||!current()||session.currentDirectory!==directory)return false;
  return port.uploadLocal(payload,session.id,directory,session.key,()=>current()&&session.currentDirectory===directory);
 }
 async function drop(session:TerminalDropSession,data:DataTransfer|null,signal:AbortSignal) {
  const remote=port.remote(data),local=port.local(data),current=capture(session);
  const live=()=>!signal.aborted&&current();
  if(!remote&&!local&&!port.hasFiles(data))return false;
  clear(session);
  if(!live()){if(remote)port.finish(remote);if(port.current(session)&&!signal.aborted&&!session.connected)port.notify(port.text('terminal:drop.not_connected'),'error');return false;}
  let sftpUpload=false;
  try {
  // Snapshot Chromium drop entries while the drop callback still owns access.
  const collected=!remote&&!local?port.collect(data,signal).then(files=>({files,error:null}),error=>({files:null,error})):null;
   const directory=await destination(session,live),valid=()=>live()&&session.currentDirectory===directory;
   if(!directory||!valid())return false;
   if(local)return await port.uploadLocal(local,session.id,directory,session.key,valid);
   if(remote)return await port.copy(remote,session.id,directory,session.key,valid);
   const result=await collected;
   if(result?.error)throw result.error;
   const files=result?.files||[];
   if(!valid())return false;
   if(!files.length)throw new Error(port.text('terminal:drop.no_upload_files'));
   port.notify(port.text('terminal:drop.sftp_login_identity_hint'),'info');
   sftpUpload=true;
   return await port.uploadFiles(files,session.id,directory,session.key,valid);
  } catch(error) {
   const detail=error instanceof Error?error.message:port.text('terminal:drop.upload_failed');
   if(live())port.notify(sftpUpload?port.text('terminal:drop.upload_failed_identity_hint',{error:detail}):detail,'error');
   return false;
  } finally {if(remote)port.finish(remote);}
 }
 function release(session:TerminalDropSession) {
  const binding=bindings.get(session);if(!binding)return;
  bindings.delete(session);binding.controller.abort();for(const operation of binding.pending)operation.abort();
  clear(session);
 }
 function bind(session:TerminalDropSession,mount:HTMLElement) {
  if(bindings.get(session)?.mount===mount)return;
  release(session);
  const controller=new AbortController(),pending=new Set<AbortController>();bindings.set(session,{mount,controller,pending});
  if(!mount.querySelector('.terminal-drop-overlay')) {
   const overlay=document.createElement('div'),hint=document.createElement('div'),label=document.createElement('span');
   overlay.className='terminal-drop-overlay';overlay.hidden=true;hint.className='terminal-drop-hint';hint.innerHTML=port.icon();
   label.className='terminal-drop-label';label.textContent=port.text('terminal:drop.upload_hint');hint.append(label);overlay.append(hint);mount.append(overlay);
  }
  const accepts=(event:DragEvent)=>port.current(session)&&!!(port.remote(event.dataTransfer)||port.local(event.dataTransfer)||port.hasFiles(event.dataTransfer));
  const over=(event:DragEvent)=>{if(!accepts(event))return;event.preventDefault();event.stopPropagation();port.inside();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';session.terminalDropDepth=1;port.feedback(session,true,port.remote(event.dataTransfer)?'copy':'upload');};
  mount.addEventListener('dragenter',over,{signal:controller.signal});mount.addEventListener('dragover',over,{signal:controller.signal});
  window.addEventListener('terma:language-changed',()=>{
   const overlay=mount.querySelector<HTMLElement>('.terminal-drop-overlay');
   if(overlay&&!overlay.hidden)port.feedback(session,true,overlay.dataset.mode==='copy'?'copy':'upload');
  },{signal:controller.signal});
  mount.addEventListener('dragleave',event=>{if(!(event.relatedTarget instanceof Node)||!mount.contains(event.relatedTarget))clear(session);},{signal:controller.signal});
  mount.addEventListener('drop',event=>{if(!accepts(event))return;event.preventDefault();event.stopPropagation();const operation=new AbortController();pending.add(operation);void drop(session,event.dataTransfer,operation.signal).finally(()=>pending.delete(operation));},{signal:controller.signal});
 }
 return {bind,drop,uploadLocal,clear,release,dispose(){for(const session of bindings.keys())release(session);}};
}
