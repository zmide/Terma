import type {VncSession} from './vnc-types';
import {normalizeVncFullscreenToolbarMode} from '../settings/runtime-settings-model';
export interface VncFullscreenPort {sessions():ReadonlyMap<string,VncSession>;mode():unknown;label(session:VncSession,active:boolean,text:string):void;display(session:VncSession):void;focus(session:VncSession):void;notify(message:string,kind:'info'|'error'):void;tr(key:string):string}
export function createVncFullscreen(port:VncFullscreenPort,doc:Document=document){
 let key='',timer:ReturnType<typeof setTimeout>|undefined,alive=true,revision=0;const root=doc.documentElement;
 const mode=()=>normalizeVncFullscreenToolbarMode(port.mode());
 const paintLabel=(session:VncSession,active:boolean)=>port.label(session,active,port.tr(active?'remote:vnc_ui.exit_fullscreen':'remote:vnc_ui.enter_fullscreen'));
 function sync(){if(!alive)return;const session=port.sessions().get(key),active=doc.fullscreenElement===root&&!!session?.viewport?.isConnected;
  const activeMode=mode();
  for(const item of port.sessions().values()){const selected=active&&item===session;item.viewport?.classList.toggle('vnc-fullscreen-active',selected);item.workspace?.classList.toggle('vnc-fullscreen-active',selected);for(const value of ['always','never','edge'])item.workspace?.classList.toggle('vnc-fullscreen-toolbar-'+value,selected&&activeMode===value);paintLabel(item,selected);}
  root.classList.toggle('vnc-fullscreen-document',active);root.classList.remove('vnc-fullscreen-toolbar-edge-visible');clearTimeout(timer);
  if(!active){if(!doc.fullscreenElement||doc.fullscreenElement===root)key='';return;}
  requestAnimationFrame(()=>{if(alive&&port.sessions().get(key)===session&&session){port.display(session);port.focus(session);}});
 }
 function edge(){const session=port.sessions().get(key),element=doc.fullscreenElement;if(!element||mode()!=='edge'||!session?.workspace?.isConnected)return null;return (element===root||element.contains(session.workspace)||session.workspace.contains(element))&&session.workspace.classList.contains('vnc-fullscreen-toolbar-edge')?session:null;}
 function hide(delay=500){clearTimeout(timer);timer=setTimeout(()=>root.classList.remove('vnc-fullscreen-toolbar-edge-visible'),delay);}
 function pointer(event:Event){const session=edge();if(!session)return;const e=event as PointerEvent,target=e.target instanceof Element?e.target:null;
  if(target?.closest('.vnc-fullscreen-toolbar-edge-zone')||e.clientY<=1){root.classList.add('vnc-fullscreen-toolbar-edge-visible');clearTimeout(timer);}
  else if(root.classList.contains('vnc-fullscreen-toolbar-edge-visible')){if(e.clientY<=Math.max(52,session.workspace?.querySelector('.vnc-toolbar')?.getBoundingClientRect().bottom||0))clearTimeout(timer);else hide();}
 }
 async function toggle(next:string){const session=port.sessions().get(next);if(!session?.viewport||!alive)return;if(doc.fullscreenElement){await doc.exitFullscreen?.();return;}if(!root.requestFullscreen){port.notify(port.tr('remote:vnc_ui.fullscreen_unsupported'),'info');return;}
  const request=++revision;key=next;session.viewport.classList.add('vnc-fullscreen-active');try{await root.requestFullscreen();if(!alive||request!==revision||port.sessions().get(next)!==session){if(doc.fullscreenElement===root)await doc.exitFullscreen?.();return;}sync();}
  catch(error){if(request!==revision)return;session.viewport.classList.remove('vnc-fullscreen-active');key='';port.notify(error instanceof Error?error.message:port.tr('remote:vnc_ui.fullscreen_failed'),'error');}
 }
 function close(next:string){if(key!==next)return;revision++;key='';clearTimeout(timer);for(const s of port.sessions().values()){s.viewport?.classList.remove('vnc-fullscreen-active');s.workspace?.classList.remove('vnc-fullscreen-active','vnc-fullscreen-toolbar-always','vnc-fullscreen-toolbar-never','vnc-fullscreen-toolbar-edge');paintLabel(s,false);}root.classList.remove('vnc-fullscreen-document','vnc-fullscreen-toolbar-edge-visible');if(doc.fullscreenElement===root)void doc.exitFullscreen?.().catch(()=>{});}
 doc.addEventListener('fullscreenchange',sync);for(const type of ['pointerover','pointermove','mouseover','mousemove'])doc.addEventListener(type,pointer,true);
 return {sync,toggle,close,hide,edge,pointer,get key(){return key;},refreshLabels(){for(const session of port.sessions().values())paintLabel(session,key===session.key&&doc.fullscreenElement===root);},dispose(){close(key);alive=false;clearTimeout(timer);doc.removeEventListener('fullscreenchange',sync);for(const type of ['pointerover','pointermove','mouseover','mousemove'])doc.removeEventListener(type,pointer,true);}};
}
