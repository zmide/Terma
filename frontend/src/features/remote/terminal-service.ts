import {profileStamp} from './management-types';
import type {RemoteProfile} from './profile-model';
export interface RemoteSocket {
  readyState:number;binaryType:string;send(value:string):void;close():void;
  onopen:(()=>void)|null;onclose:(()=>void)|null;onerror:(()=>void)|null;onmessage:((event:{data:unknown})=>void)|null;
}
export interface RemoteEngine {
  element?:HTMLElement;cols:number;rows:number;options:{theme?:unknown};
  open(mount:HTMLElement):void;loadAddon(addon:unknown):void;write(value:string|Uint8Array):void;focus():void;dispose():void;
  onData(listener:(value:string)=>void):{dispose():void};
}
export interface RemoteTerminalSession {
  key:string;profile:RemoteProfile;term:RemoteEngine;fit:{fit():void};socket:RemoteSocket|null;connected:boolean;
  logId:string;mount?:HTMLElement|null;resizeObserver?:{disconnect():void}|null;dataSubscription?:{dispose():void};timer?:ReturnType<typeof setTimeout>;
}
export interface RemoteTerminalState {profile:RemoteProfile;status:'connecting'|'connected'|'disconnected'|'error';draft:string;error:string;view?:HTMLElement}
export interface RemoteTerminalPort {
  profile(id:number):RemoteProfile|undefined;unlocked(label:string):boolean;tr(key:string,params?:Record<string,unknown>):string;
  workspace(profile:RemoteProfile,key:string,title:string,update:boolean,status:string):HTMLElement;
  paint(key:string,state:RemoteTerminalState):void;release(key:string,state:RemoteTerminalState):void;retained(view:HTMLElement):boolean;canFocus?(view:HTMLElement,key:string):boolean;
  load():Promise<void>;engine(profile:RemoteProfile,key:string):RemoteTerminalSession;socket(profile:RemoteProfile,session:RemoteTerminalSession):RemoteSocket;
  observe(mount:HTMLElement,resize:()=>void):{disconnect():void};tabStatus(key:string,status:Exclude<RemoteTerminalState['status'],'error'>):void;tabExists(key:string):boolean;theme():unknown;
}
export function createRemoteTerminalService(port:RemoteTerminalPort){
  const sessions=new Map<string,RemoteTerminalSession>(),views=new Map<string,RemoteTerminalState>(),counts=new Map<number,number>(),attaches=new Map<RemoteTerminalState,{view:HTMLElement;promise:Promise<void>}>();let alive=true;
  const valid=(p:RemoteProfile|undefined)=>!!p&&Number.isSafeInteger(p.id)&&Number(p.id)>0&&['telnet','serial'].includes(p.protocol);
  const current=(key:string,state:RemoteTerminalState)=>alive&&views.get(key)===state&&valid(port.profile(Number(state.profile.id)))&&profileStamp(port.profile(Number(state.profile.id))!)===profileStamp(state.profile);
  const visible=(key:string,state:RemoteTerminalState)=>state.view?.dataset.remoteTerminalKey===key&&(state.view.isConnected||port.retained(state.view));
  const canFocus=(key:string,state:RemoteTerminalState)=>visible(key,state)&&state.view?.checkVisibility?.()!==false&&port.canFocus?.(state.view!,key)!==false;
  const paint=(key:string)=>{const state=views.get(key);if(state&&current(key,state)&&visible(key,state))port.paint(key,state);};
  function status(key:string,value:RemoteTerminalState['status'],error=''){const state=views.get(key);if(!state||!current(key,state))return;state.status=value;state.error=error;paint(key);port.tabStatus(key,value==='error'?'disconnected':value);}
  function next(id:number){let index=Number(counts.get(id)||0)+1;while(port.tabExists(`remote-terminal-${id}-${index}`)||views.has(`remote-terminal-${id}-${index}`))index++;counts.set(id,index);return index;}
  function detach(session:RemoteTerminalSession){session.resizeObserver?.disconnect();session.resizeObserver=null;if(session.timer)clearTimeout(session.timer);session.timer=undefined;session.term.element?.remove();session.mount=null;}
  function disconnect(session:RemoteTerminalSession){const socket=session.socket;session.socket=null;session.connected=false;if(socket){socket.onopen=null;socket.onclose=null;socket.onerror=null;socket.onmessage=null;try{socket.close();}catch{}}}
  function open(id:number,update=true,key='',title=''){
    const profile=port.profile(id);if(!valid(profile)||!profile||!alive||!port.unlocked(port.tr('remote:actions.open_terminal')))return null;
    const index=key?0:next(id);key||=`remote-terminal-${id}-${index}`;title||=`${profile.name||''}${index>1?' #'+index:''}`;
    let state=views.get(key);if(state&&profileStamp(state.profile)!==profileStamp(profile)){close(key);state=undefined;}
    if(!state){state={profile:structuredClone(profile),status:sessions.get(key)?.connected?'connected':'connecting',draft:'',error:''};views.set(key,state);}
    const view=port.workspace(profile,key,title,update,state.status);
    for(const [otherKey,other]of views)if(otherKey!==key&&other.view===view){const session=sessions.get(otherKey);if(session)detach(session);}
    state.view=view;view.dataset.remoteTerminalKey=key;paint(key);void attach(profile,key).catch(error=>{if(current(key,state!))status(key,'error',error instanceof Error?error.message:String(error));});return key;
  }
  function attach(profile:RemoteProfile,key:string):Promise<void>{
    const state=views.get(key),view=state?.view;if(!state||!view||!current(key,state))return Promise.resolve();const existing=attaches.get(state);if(existing?.view===view)return existing.promise;
    const entry={view,promise:Promise.resolve()};attaches.set(state,entry);
    entry.promise=(async()=>{
      await port.load();if(!current(key,state)||attaches.get(state)!==entry||!visible(key,state)||state.view!==view||!port.unlocked(port.tr('remote:actions.open_terminal')))return;
      const mount=view.querySelector<HTMLElement>('[data-remote-terminal-mount]');if(!mount)return;
      let session=sessions.get(key);
      if(!session){session=port.engine(profile,key);sessions.set(key,session);const own=session;
        own.dataSubscription=own.term.onData(value=>{if(sessions.get(key)===own&&current(key,state)&&own.socket?.readyState===1&&port.unlocked(port.tr('remote:actions.open_terminal')))try{own.socket.send(value);}catch{status(key,'error');}});
      }
      const own=session;detach(own);own.profile=state.profile;own.mount=mount;own.term.options.theme=port.theme();
      if(own.term.element)mount.appendChild(own.term.element);else own.term.open(mount);
      const resize=()=>{if(!current(key,state)||sessions.get(key)!==own||own.mount!==mount||!canFocus(key,state))return;try{own.fit.fit();if(own.socket?.readyState===1)own.socket.send(JSON.stringify({type:'resize',cols:own.term.cols,rows:own.term.rows}));}catch{}};
      own.resizeObserver=port.observe(mount,resize);status(key,own.connected?'connected':'connecting');
      own.timer=setTimeout(()=>{own.timer=undefined;if(!current(key,state)||sessions.get(key)!==own||own.mount!==mount)return;resize();if(canFocus(key,state))own.term.focus();if(!own.socket||own.socket.readyState>=2)connect(own.profile,key);},0);
    })().catch(error=>{if(current(key,state)&&attaches.get(state)===entry)throw error;}).finally(()=>{if(attaches.get(state)===entry)attaches.delete(state);});return entry.promise;
  }
  function connect(profile:RemoteProfile,key:string){const own=sessions.get(key),state=views.get(key);if(!own||!state||!current(key,state)||profileStamp(profile)!==profileStamp(state.profile)||!port.unlocked(port.tr('remote:actions.open_terminal')))return false;
    disconnect(own);let socket:RemoteSocket;try{socket=port.socket(profile,own);}catch(error){status(key,'error',error instanceof Error?error.message:String(error));return false;}
    own.socket=socket;socket.binaryType='arraybuffer';const live=()=>current(key,state)&&sessions.get(key)===own&&own.socket===socket;status(key,'connecting');
    socket.onopen=()=>{if(!live())return;own.connected=true;status(key,'connected');try{socket.send(JSON.stringify({type:'resize',cols:own.term.cols,rows:own.term.rows}));}catch{status(key,'error');}if(canFocus(key,state))own.term.focus();};
    socket.onmessage=async event=>{if(!live())return;const data=event.data;if(data instanceof Blob){const bytes=await data.arrayBuffer();if(live())own.term.write(new Uint8Array(bytes));}else if(data instanceof ArrayBuffer)own.term.write(new Uint8Array(data));else own.term.write(String(data));};
    socket.onerror=()=>{if(live())status(key,'error');};socket.onclose=()=>{if(!live())return;disconnect(own);status(key,'disconnected');};return true;
  }
  function reconnect(id:number,key:string){const profile=port.profile(id);if(!valid(profile)||!profile)return false;const own=sessions.get(key);if(!own)return open(id,false,key)!==null;const state=views.get(key);if(!state||!current(key,state))return open(id,false,key)!==null;state.error='';own.term.write(`\r\n${port.tr('remote:terminal.reconnecting_notice')}\r\n`);return connect(profile,key);}
  function draft(key:string,value:string){const state=views.get(key);if(state&&current(key,state))state.draft=value;}
  function send(key:string){const own=sessions.get(key),state=views.get(key);if(!own||!state||!current(key,state)||own.socket?.readyState!==1||!port.unlocked(port.tr('remote:actions.open_terminal')))return false;try{own.socket.send(state.draft+'\r');state.draft='';paint(key);return true;}catch{status(key,'error');return false;}}
  function close(key:string){const state=views.get(key),own=sessions.get(key);views.delete(key);sessions.delete(key);if(state){attaches.delete(state);state.draft='';state.error='';port.release(key,state);}if(own){detach(own);disconnect(own);own.dataSubscription?.dispose();own.term.dispose();}}
  return {sessions,views,counts,next,open,attach,connect,reconnect,status,paint,draft,send,close,refresh(){for(const key of views.keys())paint(key);},theme(){for(const own of sessions.values())own.term.options.theme=port.theme();},dispose(){for(const key of new Set([...views.keys(),...sessions.keys()]))close(key);alive=false;}};
}
