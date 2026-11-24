import type {VncSession,VncRfb} from './vnc-types';
import type {VncClipboardSnapshot} from './vnc-local-clipboard';
export interface VncClipboardPort {
 session(key:string):VncSession|undefined;current(session:VncSession):()=>boolean;tr(key:string,params?:Record<string,unknown>):string;notify(message:string,kind:'info'|'success'|'error'):void;
 unavailable(session:VncSession|undefined):string;
 readText():Promise<string>;writeText(value:string,manual:boolean):Promise<unknown>;prompt(session:VncSession,reason:string):Promise<string|null>;
 readSnapshot(images:boolean):Promise<VncClipboardSnapshot>;
 sendText(session:VncSession,text:string,announce:boolean):Promise<unknown>;sendImage(session:VncSession,image:Uint8Array,announce:boolean):Promise<unknown>;
 bridge(session:VncSession):boolean;poll(session:VncSession,force:boolean):Promise<unknown>;
 status(session:VncSession,text?:string,state?:string,timeout?:number):void;start(session:VncSession):void;stop(session:VncSession):void;focus(session:VncSession):void;
}
export function createVncClipboardService(port:VncClipboardPort){const actions=new Map<VncSession,Set<string>>(),revisions=new Map<VncSession,number>();let alive=true;const t=port.tr;
 const active=(session:VncSession,revision:number,lease:()=>boolean,rfb:VncRfb|null)=>()=>alive&&lease()&&port.session(session.key)===session&&session.rfb===rfb&&revisions.get(session)===revision;
 function invalidate(session:VncSession){revisions.set(session,Number(revisions.get(session)||0)+1);actions.delete(session);}
 async function operate(key:string,kind:'send'|'receive'|'sync'){
  const session=port.session(key);if(!session)return;const unavailable=kind==='receive'?'':port.unavailable(session);if(unavailable){port.notify(unavailable,'info');return;}
  const pending=actions.get(session)||new Set<string>();if(pending.has(kind))return;pending.add(kind);actions.set(session,pending);
  const revision=revisions.get(session)||0;revisions.set(session,revision);const current=active(session,revision,port.current(session),session.rfb);
  try{
   if(kind==='send'){let text:string|null;try{text=await port.readText();}catch(error){if(!current())return;const reason=error instanceof Error?error.message:t('remote:clipboard.browser_read_denied');text=await port.prompt(session,t('remote:clipboard.manual_paste_reason',{reason}));}
    if(!current()||port.unavailable(session))return;if(text===null){port.status(session,t('remote:clipboard.send_cancelled'),'',1600);return;}await port.sendText(session,text,true);if(current())port.focus(session);return;
   }
   if(kind==='receive'){
    if(port.bridge(session)){await port.poll(session,true);if(!current())return;}
    if(!session.remoteClipboardAvailable){port.notify(t('remote:clipboard.remote_content_missing'),'info');return;}
    const text=session.remoteClipboardText||'';if(!current())return;await port.writeText(text,true);if(!current())return;session.clipboardLastSeenLocal=text;session.remoteClipboardPending=false;session.clipboardPermissionBlocked=false;port.status(session,t('remote:clipboard.remote_read'),'success',2200);port.notify(t('remote:clipboard.remote_copied_local'),'success');return;
   }
   if(session.clipboardAutoSync){session.clipboardAutoSync=false;port.stop(session);port.status(session);port.notify(t('remote:clipboard.auto_sync_disabled'),'info');return;}
   const snapshot=await port.readSnapshot(session.clipboardAutoSyncImages);if(!current()||port.unavailable(session))return;session.clipboardPermissionBlocked=false;session.clipboardPermissionNoticeShown=false;session.clipboardAutoSync=true;
   if(snapshot.imageAvailable&&session.clipboardAutoSyncImages&&snapshot.image)await port.sendImage(session,snapshot.image,false);
   else if(!snapshot.imageAvailable&&snapshot.textAvailable){if(!session.remoteClipboardAvailable||snapshot.text!==session.remoteClipboardText)await port.sendText(session,snapshot.text,false);else session.clipboardLastSeenLocal=snapshot.text;}
   if(!current())return;port.start(session);port.status(session,t('remote:clipboard.auto_sync'),'active');port.notify(t(session.clipboardAutoSyncImages?'remote:clipboard.auto_sync_enabled_with_images':'remote:clipboard.auto_sync_enabled'),'success');
  }catch(error){if(!current())return;const reason=error instanceof Error?error.message:t('remote:clipboard.local_read_failed');if(kind==='sync'){session.clipboardAutoSync=false;session.clipboardPermissionBlocked=true;port.stop(session);port.status(session,t('remote:clipboard.permission_limited'),'error');port.notify(t('remote:clipboard.manual_buttons_available',{reason}),'info');}else{port.status(session,t(kind==='receive'?'remote:clipboard.remote_read_failed':'remote:clipboard.local_read_failed'),'error');port.notify(reason,'error');}}
  finally{pending.delete(kind);if(!pending.size&&actions.get(session)===pending)actions.delete(session);if(current())port.focus(session);}
 }
 return {operate,invalidate,dispose(){alive=false;actions.clear();revisions.clear();}};
}
