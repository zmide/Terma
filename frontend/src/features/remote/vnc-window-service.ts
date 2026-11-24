import {profileStamp} from './management-types';
import type {RemoteProfile} from './profile-model';
import type {VncSession} from './vnc-types';
export interface VncChild {closed:boolean;close():void;focus():void;location:{replace(url:string):void}}
interface PendingWindow {profileId:number;child:VncChild;status:'pending'|'committed'|'cancelled';claims:Set<object>}
export interface VncReservation {profileId:number;child:VncChild|null;created:boolean;blocked:boolean;pending?:boolean;committed?:boolean;released?:boolean;state?:PendingWindow;claim?:object}
export interface VncWindowPort {profile(id:number):RemoteProfile|undefined;scope(id:number,key:string):{current():boolean;tabCurrent():boolean};detached():boolean;native():boolean;unlocked(label:string):boolean;href():string;popup(id:number):VncChild|null;openNative(id:number,key:string):Promise<{ok?:boolean}>;closeNative(id:number):Promise<unknown>;closeSelf():Promise<unknown>;settings(id:number):Promise<boolean>;sessions():{key:string;profileId:number}[];disconnected(key:string):void;showManagement(id:number):Promise<unknown>;mountDetached(profile:RemoteProfile,key:string):void;refreshDetached(profile:RemoteProfile,key:string):void;closeSession(key:string):void;closeTab(key:string):void;tr(key:string):string;notify(message:string,kind:'error'|'info'):void}
type NativeVncWindow = {
  openVncWindow?(id: number, options: {key: string}): ReturnType<VncWindowPort['openNative']>;
  closeVncWindowForProfile?(id: number): ReturnType<VncWindowPort['closeNative']>;
  closeVncWindow?(): ReturnType<VncWindowPort['closeSelf']>;
  openRemoteProfileSettings?(id: number): Promise<{ok?: boolean} | undefined>;
};

export function vncWindowEnvironment(win: Window): Pick<VncWindowPort,
  'href' | 'native' | 'popup' | 'openNative' | 'closeNative' | 'closeSelf' | 'settings'> {
  const native = () => win.termaDesktop as NativeVncWindow | undefined;
  return {
    href: () => win.location.href,
    native: () => Boolean(native()?.openVncWindow),
    popup: id => win.open('', `terma-vnc-${id}`, 'popup,width=1280,height=820'),
    openNative: async (id,key) => await native()?.openVncWindow?.(id,{key}) ?? {ok:false},
    closeNative: async id => native()?.closeVncWindowForProfile?.(id),
    closeSelf: async () => {
      const bridge = native();
      if (bridge?.closeVncWindow) return bridge.closeVncWindow();
      win.close();
      return {ok:true};
    },
    settings: async id => {
      const bridge = native();
      if (bridge?.openRemoteProfileSettings) return (await bridge.openRemoteProfileSettings(id))?.ok !== false;
      const opener = win.opener as Window | null;
      if (!opener || opener.closed) return false;
      opener.focus?.();
      opener.postMessage({type:'terma:remote-profile-settings',profileId:id},win.location.origin);
      return true;
    }
  };
}

export function captureVncHandoffScope(sessions: ReadonlyMap<string, VncSession>, id: number, tabCurrent: () => boolean) {
  const matches = (session: VncSession) => Number(session.profile.id) === id;
  const owners = [...sessions.values()].filter(matches).map(session => ({session, revision: session.connectionRevision}));
  return {
    tabCurrent,
    current: () => tabCurrent() && [...sessions.values()].filter(matches).length === owners.length
      && owners.every(({session, revision}) => sessions.get(session.key) === session && matches(session)
        && session.connectionRevision === revision)
  };
}
export function createVncWindowService(port:VncWindowPort){const children=new Map<number,VncChild>(),pending=new Map<number,PendingWindow>(),opening=new Map<number,Promise<boolean>>();let alive=true,detachedId=0;
 const valid=(id:number)=>alive&&Number.isSafeInteger(id)&&id>0&&port.profile(id)?.protocol==='vnc';
 function active(id:number){const state=pending.get(id);if(!state||state.status!=='pending'||state.child.closed){if(pending.get(id)===state)pending.delete(id);return null;}return state;}
 function reserve(id:number):VncReservation|null {if(!valid(id)||port.native())return null;const state=active(id),claim={};if(state){state.claims.add(claim);return {profileId:id,child:state.child,created:false,blocked:false,pending:true,state,claim};}
  const existing=children.get(id);if(existing&&!existing.closed)return {profileId:id,child:existing,created:false,blocked:false,committed:true};const child=port.popup(id);if(!child)return {profileId:id,child:null,created:false,blocked:true};const next:PendingWindow={profileId:id,child,status:'pending',claims:new Set([claim])};children.set(id,child);pending.set(id,next);return {profileId:id,child,created:true,blocked:false,pending:true,state:next,claim};
 }
 function cancel(reservation:VncReservation|null){if(!reservation||reservation.released)return;reservation.released=true;const state=reservation.state;if(!state)return;if(reservation.claim)state.claims.delete(reservation.claim);if(state.status!=='pending'||state.claims.size)return;state.status='cancelled';if(pending.get(state.profileId)===state)pending.delete(state.profileId);if(!state.child.closed)state.child.close();if(children.get(state.profileId)===state.child)children.delete(state.profileId);}
 function commit(reservation:VncReservation|null,url:string){if(!reservation||reservation.blocked||reservation.released||!valid(reservation.profileId)||!reservation.child||reservation.child.closed)return null;
  const target=new URL(url,port.href()),current=new URL(port.href());if(target.origin!==current.origin||target.pathname!==current.pathname||target.searchParams.get('termaVncWindow')!==String(reservation.profileId))return null;
  const state=reservation.state;if(state?.status==='pending'){if(pending.get(state.profileId)!==state||!state.claims.has(reservation.claim!))return null;state.status='committed';pending.delete(state.profileId);state.child.location.replace(target.href);}else if(state?.status==='cancelled')return null;children.set(reservation.profileId,reservation.child);reservation.committed=true;return reservation.child;
 }
 async function close(id:number){if(!alive||!Number.isSafeInteger(id)||id<=0||port.detached())return {ok:false,closed:false};if(port.native())return port.closeNative(id);const child=children.get(id),state=pending.get(id);if(state)state.status='cancelled';pending.delete(id);children.delete(id);if(child&&!child.closed){child.close();return {ok:true,profileId:id,closed:true};}return {ok:true,profileId:id,closed:false};}
 async function prepare(id:number,preferredKey=''){
  if(!valid(id)||port.detached())return false;
  const sessions=port.sessions().filter(session=>session.profileId===id),keys=new Set<string>();
  if(preferredKey&&sessions.some(session=>session.key===preferredKey))keys.add(preferredKey);
  for(const session of sessions)if(!session.key.startsWith('detached-vnc-'))keys.add(session.key);
  if(!keys.size)return false;
  for(const key of keys){port.closeSession(key);port.disconnected(key);}
  await port.showManagement(id);return true;
 }
 function init(id:number){
  if(!alive)return false;
  if(!valid(id)){port.notify(port.tr('remote:vnc_ui.detached_profile_missing'),'error');return false;}
  detachedId=id;port.mountDetached(port.profile(id)!,`detached-vnc-${id}`);return true;
 }
 function refreshLabels(){if(valid(detachedId))port.refreshDetached(port.profile(detachedId)!,`detached-vnc-${detachedId}`);}
 function open(id:number,key='',options:{browserReservation?:VncReservation|null;closeDetectionTab?:boolean}={}){const existing=opening.get(id);if(existing){cancel(options.browserReservation||null);return existing;}const work=openImpl(id,key,options).finally(()=>{if(opening.get(id)===work)opening.delete(id);});opening.set(id,work);return work;}
 async function openImpl(id:number,key:string,options:{browserReservation?:VncReservation|null;closeDetectionTab?:boolean}){if(!valid(id)||!port.unlocked(port.tr('remote:vnc_ui.open_new_window')))return false;const stamp=profileStamp(port.profile(id)!),scope=port.scope(id,key),current=()=>valid(id)&&profileStamp(port.profile(id)!)===stamp;let reservation=options.browserReservation?.profileId===id?options.browserReservation:null;
  try{if(port.native()){const result=await port.openNative(id,key);if(result?.ok===false)throw Error(port.tr('remote:vnc_ui.detached_open_failed'));if(!current()||!scope.current())return false;await prepare(id,key);}
   else{reservation||=reserve(id);if(!reservation||reservation.blocked)throw Error(port.tr('remote:vnc_ui.detached_open_failed'));const url=new URL(port.href());url.searchParams.set('termaVncWindow',String(id));if(!current()||!scope.current()||!port.unlocked(port.tr('remote:vnc_ui.open_new_window')))return false;const child=commit(reservation,url.href);if(!child)throw Error(port.tr('remote:vnc_ui.detached_open_failed'));child.focus();await prepare(id,key);}
   if(current()&&scope.tabCurrent()&&options.closeDetectionTab&&key)port.closeTab(key);return true;
  }catch(error){cancel(reservation);port.notify(error instanceof Error?error.message:port.tr('remote:vnc_ui.detached_open_failed'),'error');return false;}finally{if(reservation&&!reservation.committed)cancel(reservation);}
 }
 async function embedded(id:number){if(port.detached())return true;try{await close(id);return valid(id);}catch(error){port.notify(error instanceof Error?error.message:port.tr('remote:vnc_ui.window_switch_failed'),'error');return false;}}
 async function closeSelf(key=''){if(key)port.closeSession(key);return port.closeSelf();}
 async function settings(id:number){if(!valid(id))return false;try{if(await port.settings(id))return true;}catch(error){port.notify(error instanceof Error?error.message:port.tr('remote:vnc_ui.connection_settings_failed'),'error');}port.notify(port.tr('remote:vnc_ui.connection_settings_unavailable'),'info');return false;}
 return {reserve,active,cancel,commit,close,open,prepare,init,refreshLabels,embedded,closeSelf,settings,dispose(){alive=false;for(const state of pending.values()){state.status='cancelled';if(!state.child.closed)state.child.close();}pending.clear();children.clear();opening.clear();}};
}
