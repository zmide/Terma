import {classifyVncFailure,vncFailureTitleKey} from './management-diagnostics';
import {profileStamp} from './management-types';
import type {RemoteProfile} from './profile-model';
import type {VncSessionPort,VncSession,VncRfb,VncDiagnostics,VncEvent,VncCredentialResult,VncOpenScope} from './vnc-types';

function connectedProfileStamp(profile: RemoteProfile) {
  // The cursor policy is applied in place and cannot invalidate events from the same RFB.
  const {cursor_mode: _cursorMode, ...options} = profile.options || {};
  return profileStamp({...profile,options});
}

export function createVncSessionService(port:VncSessionPort){
 const sessions=new Map<string,VncSession>(),listeners=new Map<VncSession,(()=>void)[]>(),opens=new Map<string,{promise:Promise<boolean|null>;current():boolean}>();let alive=true;const t=port.tr;
 const valid=(profile:RemoteProfile)=>profile.protocol==='vnc'&&Number.isSafeInteger(profile.id)&&Number(profile.id)>0;
 const owned=(session:VncSession)=>alive&&sessions.get(session.key)===session;
 function lease(session:VncSession,revision=session.connectionRevision){const stamp=connectedProfileStamp(session.profile);return ()=>{const profile=port.profile(Number(session.profile.id));return owned(session)&&session.connectionRevision===revision&&!!profile&&connectedProfileStamp(profile)===stamp;};}
 function status(session:VncSession,text:string,state=''){if(!owned(session))return;session.statusKey='';session.statusParams=undefined;port.paintStatus(session,text,state);}
 function label(session:VncSession,key:string,state='',params?:Record<string,unknown>){if(!owned(session))return;session.statusKey=key;session.statusParams=params;port.paintStatus(session,t(key,params),state);}
 function unbind(session:VncSession){for(const off of listeners.get(session)||[])off();listeners.delete(session);}
 function reset(session:VncSession){session.clipboardRemoteOperationId=Number(session.clipboardRemoteOperationId||0)+1;session.remoteClipboardAvailable=false;session.remoteClipboardPending=false;session.remoteClipboardText='';session.clipboardLastSeenLocal=undefined;session.clipboardLastSentText=undefined;session.clipboardPendingUnicodeText=undefined;port.clearClipboard(session);port.stopClipboard(session);}
 function ensure(profile:RemoteProfile,key:string){let session=sessions.get(key);if(session&&Number(session.profile.id)!==Number(profile.id)){close(key);session=undefined;}
  if(!session){session={key,profile,rfb:null,screen:port.screen(),connecting:false,connected:false,clipboardAutoSync:!profile.options?.view_only,clipboardAutoSyncImages:profile.options?.auto_sync_images!==false,remoteClipboardAvailable:false,remoteClipboardPending:false};sessions.set(key,session);}return session;
 }
 function mount(profile:RemoteProfile,key:string,diagnostics:VncDiagnostics|null=null,view:HTMLElement|null=null,detached=false){if(!alive||!valid(profile))return null;const session=ensure(profile,key);session.profile=profile;session.presentation='viewer';session.clipboardAutoSyncImages=profile.options?.auto_sync_images!==false;session.vncServerDiagnostics=diagnostics||session.vncServerDiagnostics||null;
  if(session.rfb){session.rfb.qualityLevel=Math.max(0,Math.min(9,Number(profile.options?.quality??8)));session.rfb.viewOnly=Boolean(profile.options?.view_only);}
  const platform=diagnostics?.platform||diagnostics?.os_id||port.platform(profile)||session.remotePlatform||'';if(platform!==session.remotePlatform){session.remotePlatform=platform;port.clearClipboard(session);}
  port.render(session,diagnostics,view,detached);if(!session.rfb&&!session.connecting)void connect(profile,key);return session;
 }
 function open(id:number,key=`remote-desktop-${id}`,button:HTMLElement|null=null){const existing=opens.get(key);if(existing?.current())return existing.promise;const scope=port.scope(id,key),profile=port.profile(id),stamp=profile&&profileStamp(profile),entry={promise:Promise.resolve(null) as Promise<boolean|null>,current:()=>alive&&scope.current()&&!!port.profile(id)&&profileStamp(port.profile(id)!)===stamp};opens.set(key,entry);entry.promise=openImpl(id,key,button,()=>opens.get(key)===entry&&entry.current(),scope.showMissingDesktop).finally(()=>{if(opens.get(key)===entry)opens.delete(key);});return entry.promise;}
 async function openImpl(id:number,key:string,button:HTMLElement|null,scope:()=>boolean,showMissingDesktop:VncOpenScope['showMissingDesktop']){const profile=port.profile(id);if(!profile||!valid(profile)||!port.unlocked(t('remote:vnc_ui.connect')))return null;const stamp=profileStamp(profile),current=()=>alive&&scope()&&!!port.profile(id)&&profileStamp(port.profile(id)!)===stamp;
  port.busy(button,true,t('remote:vnc_ui.opening'));try{const session=sessions.get(key);if(session?.workspace&&(session.connected||session.connecting)){if(!await port.prepareEmbedded(id)||!current())return null;mount(profile,key);return true;}
   const [diagnostics,desktop]=await Promise.all([port.readDiagnostics(id).catch(()=>null),port.readDesktop(profile).catch(()=>null)]);if(!current())return null;
   if(desktop?.platform_supported!==false&&desktop?.has_desktop===false){showMissingDesktop(profile);return null;}
   if(!await port.prepareEmbedded(id)||!current()||!port.unlocked(t('remote:vnc_ui.connect')))return null;mount(profile,key,diagnostics||desktop);return true;
  }catch(error){if(current())port.notify(error instanceof Error?error.message:t('remote:vnc_ui.embedded_open_failed'),'error');return null;}finally{port.busy(button,false);}
 }
 async function credentials(session:VncSession,rfb:VncRfb,current:()=>boolean,options:Parameters<VncSessionPort['prompt']>[2]={},types=['password']):Promise<VncCredentialResult|null>{
  const result=await port.prompt(session.profile,types,{...options,owner:session});if(!result)return null;
  if(!current()||session.rfb!==rfb||!port.unlocked(t('remote:vnc_ui.connect'))){result.credentials.password='';return null;}
  if(result.update_saved_password){try{await port.save(session.profile,result.credentials.password||'');}catch(error){port.notify(error instanceof Error?error.message:t('remote:vnc_ui.password_save_failed'),'error');}}
  if(!current()||session.rfb!==rfb){result.credentials.password='';return null;}return result;
 }
 async function connect(profile:RemoteProfile,key:string){const session=sessions.get(key);if(!session||session.connecting||!valid(profile)||!port.profile(Number(profile.id))||profileStamp(port.profile(Number(profile.id))!)!==profileStamp(profile)||!port.unlocked(t('remote:vnc_ui.connect')))return;session.profile=profile;
  const revision=Number(session.connectionRevision||0)+1;session.connectionRevision=revision;session.diagnosticToken=Number(session.diagnosticToken||0)+1;const current=lease(session,revision);
  session.connecting=true;session.connected=false;session.failureDetail='';reset(session);port.controls(session);port.help(session,true);label(session,'remote:vnc_ui.connecting_endpoint','connecting',{endpoint:port.endpoint(profile)});
  let secret:VncCredentialResult['credentials']|null=session.nextCredentials||null;session.nextCredentials=null;
  try{const factory=await port.load();if(!current())return;unbind(session);const previous=session.rfb;session.rfb=null;try{previous?.disconnect();}catch{}session.screen.replaceChildren();
   if(!secret&&profile.has_password){const saved=await port.api(`/api/remote-profiles/${profile.id}/vnc-credential`,{method:'POST',body:'{}'}) as {has_password?:boolean;password?:string};if(!current()){saved.password='';return;}if(saved.has_password)secret={username:profile.username||'',password:saved.password||''};saved.password='';}
   if(!current()||!port.unlocked(t('remote:vnc_ui.connect')))return;
   const rfb=factory(session,secret?{...secret}:profile.username?{username:profile.username}:undefined);session.rfb=rfb;rfb.viewOnly=Boolean(profile.options?.view_only);rfb.qualityLevel=Math.max(0,Math.min(9,Number(profile.options?.quality??8)));rfb.background=port.background();port.display(session);port.cursor(session);
   const active=()=>current()&&session.rfb===rfb,on=(name:string,fn:(event:VncEvent)=>void)=>{const listener=(event:VncEvent)=>{if(active())fn(event);else if(name==='connect')rfb.disconnect();};rfb.addEventListener(name,listener);const list=listeners.get(session)||[];list.push(()=>rfb.removeEventListener?.(name,listener));listeners.set(session,list);};
   on('termafailure',event=>{const detail=String(event.detail?.reason||'').trim();if(!detail)return;session.failureDetail=detail;if(classifyVncFailure(detail).kind!=='generic')label(session,vncFailureTitleKey(detail),'error');});
   on('connect',()=>{session.connecting=false;session.connected=true;session.authRetrying=false;session.everConnected=true;port.help(session,true);label(session,profile.options?.view_only?'remote:vnc_ui.connected_view_only':'remote:vnc_ui.connected_control','connected');if(session.clipboardAutoSync&&!profile.options?.view_only)port.startClipboard(session);else port.controls(session);port.focus(session);});
   on('credentialsrequired',event=>{void credentials(session,rfb,active,{},event.detail?.types||['password']).then(result=>{if(!result){if(active())rfb.disconnect();return;}if(active())rfb.sendCredentials({...result.credentials});result.credentials.password='';}).catch(()=>{if(active())rfb.disconnect();});});
   on('serververification',event=>{void verify(session,rfb,event).catch(()=>{if(active())rfb.disconnect();});});
   on('securityfailure',event=>{void security(session,rfb,event.detail?.reason||t('remote:vnc_ui.auth_failed')).catch(()=>{if(active()){session.authRetrying=false;rfb.disconnect();}});});
   on('clipboard',event=>{void port.clipboard(session,rfb,event.detail?.text||'').catch(()=>{});});
   on('disconnect',event=>{session.rfb=null;session.connecting=false;session.connected=false;reset(session);unbind(session);if(session.authRetrying)return;if(event.detail?.clean)label(session,'remote:vnc_ui.session_ended');else void diagnose(profile,key,event.detail?.reason||session.failureDetail||'');});
  }catch(error){if(!current())return;session.connecting=false;session.connected=false;const rfb=session.rfb;session.rfb=null;unbind(session);try{rfb?.disconnect();}catch{}reset(session);status(session,error instanceof Error?error.message:t('remote:vnc_ui.embedded_start_failed'),'error');void diagnose(profile,key);
   if(profile.options?.client_mode!=='embedded'&&!session.systemFallbackStarted){session.systemFallbackStarted=true;if(await port.fallbackAvailable()&&current()){port.notify(t('remote:vnc_ui.fallback_system_client'),'info');await port.fallback(Number(profile.id),key).catch(()=>{});}}
  }finally{if(secret)secret.password='';if(owned(session)&&session.connectionRevision===revision&&!session.rfb)session.connecting=false;}
 }
 async function security(session:VncSession,rfb:VncRfb,reason:string){const current=lease(session);if(!current()||session.rfb!==rfb||session.authRetrying)return;if(classifyVncFailure(reason).kind!=='generic'){session.failureDetail=reason;label(session,vncFailureTitleKey(reason),'error');return;}
  session.authRetrying=true;status(session,reason||t('remote:vnc_ui.auth_failed'),'error');const result=await credentials(session,rfb,()=>current()&&session.rfb===rfb,{failureReason:reason,updateByDefault:true});
  if(!current()||session.rfb!==rfb){if(result)result.credentials.password='';return;}session.rfb=null;session.connectionRevision=Number(session.connectionRevision||0)+1;unbind(session);try{rfb.disconnect();}catch{}session.connecting=false;session.connected=false;reset(session);session.authRetrying=false;
  if(!result){label(session,'remote:vnc_ui.auth_retry_cancelled','error');return;}session.nextCredentials={...result.credentials};result.credentials.password='';void connect(session.profile,session.key);
 }
 async function verify(session:VncSession,rfb:VncRfb,event:VncEvent){const current=lease(session);const fingerprint=await port.fingerprint(event.detail?.publickey);if(!current()||session.rfb!==rfb)return;
  const accepted=await port.confirm(()=>t('remote:vnc_ui.server_verification_message',{endpoint:port.endpoint(session.profile),fingerprint:fingerprint||t('common:auto.unknown')}),()=>t('remote:vnc_ui.server_verification_title'),()=>t('remote:vnc_ui.server_verification_accept'));if(!current()||session.rfb!==rfb)return;if(accepted)rfb.approveServer?.();else rfb.disconnect();
 }
 async function diagnose(profile:RemoteProfile,key:string,disconnectDetail=''){const session=sessions.get(key);if(!session)return;const current=lease(session),token=Number(session.diagnosticToken||0)+1;session.diagnosticToken=token;label(session,'remote:vnc_ui.detecting_port','connecting');let diagnostics:VncDiagnostics|null=null,detail=disconnectDetail;
  try{diagnostics=await port.readDiagnostics(Number(profile.id));}catch(error){detail||=error instanceof Error?error.message:'';}
  if(!current()||session.diagnosticToken!==token||session.rfb||session.connecting)return;const available=diagnostics?.status==='ready'||diagnostics?.status==='reachable'||diagnostics?.listening===true;label(session,vncFailureTitleKey(detail),'error');port.showHelp(session,available,detail,diagnostics);const failure=classifyVncFailure(detail);
  if(profile.options?.client_mode==='auto'&&failure.kind==='unsupported-security'&&!session.systemFallbackStarted){session.systemFallbackStarted=true;if(await port.fallbackAvailable()&&current()&&!session.rfb&&!session.connecting){label(session,'remote:vnc_ui.fallback_system_client_unsupported','error');port.notify(t('remote:vnc_ui.fallback_system_client_unsupported'),'info');await port.fallback(Number(profile.id),key).catch(()=>{});}}
  else if(failure.kind==='too-many-security-failures'){session.systemFallbackStarted=true;label(session,'remote:vnc_ui.system_fallback_blocked_lockout','error');port.notify(t('remote:vnc_ui.system_fallback_blocked_lockout'),'info');}
  return {detail,diagnostics,serviceAvailable:available,failure};
 }
 function reconnect(id:number,key:string){const profile=port.profile(id),session=sessions.get(key);if(!profile||!session)return port.showManagement(id);session.connectionRevision=Number(session.connectionRevision||0)+1;unbind(session);const rfb=session.rfb;session.rfb=null;try{rfb?.disconnect();}catch{}session.connecting=false;session.connected=false;reset(session);void connect(profile,key);}
 function management(id:number,key:string){const session=sessions.get(key);if(session)session.presentation='management';return port.showManagement(id);}
 function close(key:string){opens.delete(key);const session=sessions.get(key);if(!session)return;session.connectionRevision=Number(session.connectionRevision||0)+1;session.diagnosticToken=Number(session.diagnosticToken||0)+1;port.cancelPrompt(session);port.closeFullscreen(key);sessions.delete(key);unbind(session);reset(session);if(session.nextCredentials)session.nextCredentials.password='';session.nextCredentials=null;session.connecting=false;session.connected=false;const rfb=session.rfb;session.rfb=null;try{rfb?.disconnect();}catch{}port.release(session);}
 function keyForProfile(id:number){for(const [key,session] of sessions)if(Number(session.profile.id)===id)return key;return `remote-desktop-${id}`;}
 return {sessions,open,mount,connect,reconnect,management,close,status,security,verify,diagnose,keyForProfile,current:lease,refreshLabels(){for(const s of sessions.values())if(s.statusKey)port.paintStatus(s,t(s.statusKey,s.statusParams),s.statusState||'');},dispose(){for(const key of [...sessions.keys()])close(key);alive=false;opens.clear();}};
}
