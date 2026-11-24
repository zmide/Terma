import type {ManagementConnection} from '../remote/management-types';
import type {Question} from '../forwards/forward-service';
import type {TerminalAuthenticationSession} from '../terminal/terminal-authentication-service';
export interface X11Connection extends ManagementConnection {x11_mode?:string;quick_token?:string;[key:string]:unknown}
export interface X11Session extends TerminalAuthenticationSession {connection:X11Connection;connected?:boolean;id?:number}
export interface X11Application {id:string;path?:string;command?:string;args?:string;mode?:string;kind?:string;label?:string;category?:string;category_label?:string}
export interface X11Diagnostics {available?:boolean;can_start?:boolean;can_stop?:boolean;can_install?:boolean;authorization_required?:boolean;integration_available?:boolean;desktop_backend_available?:boolean;root?:boolean;can_manage?:boolean;requires_password?:boolean;platform?:string;error?:string;connectionId?:number;connection_id?:number;[key:string]:unknown}
export interface X11Discovery {applications?:X11Application[];platform?:string;xauth_available?:boolean;install_plan?:Record<string,unknown>;warnings?:unknown[];[key:string]:unknown}
export interface X11Result {task?:{id:string;connection_id:number;status?:string;error?:string;[key:string]:unknown};discovery?:X11Discovery;install_plan?:Record<string,unknown>;application?:X11Application;restart_required?:boolean;[key:string]:unknown}
export interface X11Snapshot {diagnostics:X11Diagnostics;sshX11:X11Diagnostics|null;x11Clipboard:X11Diagnostics|null;connection:X11Connection|null}
export interface X11Port {
 api(url:string,options?:{method?:string;body?:string;signal?:AbortSignal}):Promise<unknown>;
 tr(key:string,params?:Record<string,unknown>):string;notify(message:string,kind:'success'|'error'|'info'):void;localize(message:string):string;
 unlocked(label:string):boolean;connection(id:number):X11Connection|undefined;session(key:string):X11Session|undefined;sessionKey(id:number,preferred?:string):string;
 activeContext():{connectionId:number;terminalKey:string};scope():()=>boolean;
 ask(question:Question):Promise<string>;authorize(id:number,title:string,scope:string):Promise<{admin_grant_id:string}|null>;desktopAuthorize():Promise<boolean>;
 begin(key:string,button:HTMLElement|null,label:()=>string):boolean;end(key:string,button:HTMLElement|null):void;busy(button:HTMLElement|null,value:boolean,label?:()=>string):void;
 watch(result:X11Result,title:string,container:()=>HTMLElement|null,current:()=>boolean):Promise<boolean>;
 reload():Promise<unknown>;next(id:number):string;startup(connection:X11Connection,key?:string):Record<string,unknown>;override(key:string,value:Record<string,unknown>):void;openTerminal(id:number,key:string,title:string):string|undefined;reconnect(id:number,key:string):void;quickTerminal(connection:X11Connection,token:string,title:string):void;
 updateTerminal(key:string,connection:X11Connection):void;send(key:string,command:string):boolean;activate(key:string):void;focus(key:string):void;copy(text:string):Promise<void>;
 manager:{loading():void;paint(snapshot:X11Snapshot):void;error(message:string,retry:()=>void):void;close():void;visible():boolean;canRestore():boolean;settings(diagnostics?:X11Diagnostics,error?:string):void;settingsVisible():boolean};
 guide:{paint(id:number,result:X11Result):void;close():void;visible(id:number):boolean};
 header(snapshot:X11Diagnostics|null,error?:boolean):void;reason(diagnostics:X11Diagnostics,fallback?:string):string;
 listen(listener:()=>void):()=>void;hidden():boolean;schedule(callback:()=>void,delay:number):ReturnType<typeof setTimeout>;cancel(timer:ReturnType<typeof setTimeout>):void;
 restore(source:string,id:number):boolean;owner():()=>boolean;manual(id:number,command:string,kind:'install'|'configure'|'guide',action?:string,remoteXQuartz?:boolean):string|undefined;
 beforeOpen():void;
 repair(id:number):Promise<unknown>;refreshLinux():Promise<unknown>;
}
export const x11Error=(error:unknown,fallback='')=>error instanceof Error?error.message:String((error as {message?:string})?.message||fallback);
