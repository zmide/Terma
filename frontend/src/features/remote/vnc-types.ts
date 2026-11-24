import type {RemoteProfile} from './profile-model';
import type {ManagementPort} from './management-types';
import type {VncCredentialRequest} from './vnc-credentials';
export interface VncCredentials {username?:string;target?:string;password?:string}
export interface VncCredentialResult {credentials:VncCredentials;update_saved_password?:boolean;allow_no_password?:boolean}
export interface VncEvent {detail?:{reason?:string;clean?:boolean;types?:string[];text?:string;publickey?:unknown}}
export interface VncRfb {viewOnly:boolean;qualityLevel:number;background:string;disconnect():void;sendCredentials(credentials:VncCredentials):void;approveServer?():void;sendCtrlAltDel():void;clipboardPasteFrom(text:string):void;focus?(options?:FocusOptions):void;addEventListener(name:string,listener:(event:VncEvent)=>void):void;removeEventListener?(name:string,listener:(event:VncEvent)=>void):void;
 scaleViewport?:boolean;resizeSession?:boolean;showDotCursor?:boolean;
 _clipboardServerCapabilitiesFormats?:Record<number,unknown>;_clipboardServerCapabilitiesActions?:Record<number,unknown>}
export interface VncDiagnostics {platform?:string;os_id?:string;has_desktop?:boolean;platform_supported?:boolean;[key:string]:unknown}
export interface VncOpenScope {current():boolean; showMissingDesktop(profile:RemoteProfile):void}
export interface VncSession {
 key:string;profile:RemoteProfile;rfb:VncRfb|null;screen:HTMLElement;connecting:boolean;connected:boolean;
 presentation?:string;workspace?:HTMLElement|null;viewport?:HTMLElement|null;status?:HTMLElement|null;help?:HTMLElement|null;
 statusText?:string;statusState?:string;statusKey?:string;statusParams?:Record<string,unknown>;
 helpState?:{serviceAvailable:boolean;detail:string;diagnostics:VncDiagnostics|null;connectionAttempt:boolean}|null;
 connectionRevision?:number;diagnosticToken?:number;authRetrying?:boolean;everConnected?:boolean;failureDetail?:string;systemFallbackStarted?:boolean;
 nextCredentials?:VncCredentials|null;remotePlatform?:string;vncServerDiagnostics?:VncDiagnostics|null;
 clipboardAutoSync:boolean;clipboardAutoSyncImages:boolean;clipboardRemoteOperationId?:number;remoteClipboardAvailable:boolean;remoteClipboardPending:boolean;remoteClipboardText?:string;
 clipboardTransport?:string;clipboardTransportChecked?:boolean;remoteClipboardBridgeLastSeen?:string;
 clipboardBridgeTool?:string;clipboardBridgeError?:string;clipboardBridgeConnectionName?:string;clipboardStatusText?:string;clipboardStatusState?:string;
 clipboardLastSeenLocal?:string;clipboardLastSentText?:string;clipboardPermissionBlocked?:boolean;clipboardPermissionNoticeShown?:boolean;
 clipboardBridgeConnectionId?:number;clipboardBridgeResolvedBy?:string;clipboardPendingUnicodeText?:string;
 clipboardRemoteWriteNoticeShown?:boolean;lastInteractionAt?:number;
 [key:string]:unknown;
}
export interface VncSessionPort extends Pick<ManagementPort,'api'|'tr'|'notify'|'profile'|'unlocked'> {
 screen():HTMLElement;scope(id:number,key:string):VncOpenScope;
 load():Promise<(session:VncSession,credentials:VncCredentials|undefined)=>VncRfb>;
 render(session:VncSession,diagnostics:VncDiagnostics|null,view:HTMLElement|null,detached:boolean):void;
 paintStatus(session:VncSession,text:string,state:string):void;
 controls(session:VncSession):void;clearClipboard(session:VncSession):void;stopClipboard(session:VncSession):void;startClipboard(session:VncSession):void;
 help(session:VncSession,hidden:boolean):void;
 showHelp(session:VncSession,available:boolean,detail:string,diagnostics:VncDiagnostics|null):void;
 readDiagnostics(id:number):Promise<VncDiagnostics|null>;readDesktop(profile:RemoteProfile):Promise<VncDiagnostics|null>;
 prepareEmbedded(id:number):Promise<boolean>;showManagement(id:number):unknown;
 busy(button:HTMLElement|null,value:boolean,label?:string):void;focus(session:VncSession):void;endpoint(profile:RemoteProfile):string;
 cursor(session:VncSession):void;display(session:VncSession):void;background():string;
 platform(profile:RemoteProfile):string;
 prompt(profile:RemoteProfile,types:string[],options?:VncCredentialRequest):Promise<VncCredentialResult|null>;
 cancelPrompt(session:VncSession):void;
 save(profile:RemoteProfile,password:string):Promise<unknown>;
 fingerprint(value:unknown):Promise<string>;
 confirm(message:()=>string,title:()=>string,accept:()=>string):Promise<boolean>;
 clipboard(session:VncSession,rfb:VncRfb,text:string):Promise<unknown>;
 fallbackAvailable():Promise<boolean>;fallback(id:number,key:string):Promise<unknown>;
 closeFullscreen(key:string):void;release(session:VncSession):void;
}
