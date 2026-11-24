import type {Api,Translate} from '../operations/operations-types';
import type {Question} from '../forwards/forward-service';
export const sections=['import-source','import-export','configSnapshots'] as const;
export type Section=typeof sections[number];
export const section=(value:string):Section=>sections.includes(value as Section)?value as Section:'import-source';
export const sectionKey=(value:Section)=>'settings:auto.'+({'import-source':'ssh_config_import_export','import-export':'database_import_export',configSnapshots:'config_snapshots'}[value]);
export interface ImportRow extends Record<string,unknown> {name?:string;connection_name?:string;connection_id?:number;binding_id?:string;ssh_host?:string;ssh_user?:string;ssh_port?:number;sort_order?:number;identity_name?:string;identity_file?:string;missing_identity?:boolean;old_path?:string;key_name?:string;extra_args?:string;original_auth_type?:string;has_password?:boolean;password_encrypted?:boolean;identity_encrypted?:boolean;forwards?:{bind_host:string;bind_port:number;target_host:string;target_port:number}[]}
export interface Parsed {tunnels:ImportRow[];missing_keys:string[];count?:number}
export interface TestResult {ok?:boolean;output?:string}
export interface TestResponse {results:TestResult[];ok:number;failed:number}
export interface Candidate extends Record<string,unknown> {path:string;name:string}
export interface IdentityInfo {items:Candidate[];upload_directory:string}
export interface Credential {connection_id:number;binding_id?:string;identity_path?:string;identity_name?:string;auth_type?:'key'|'password';password_action?:'preserve'|'clear'|'replace';password?:string;sort_order?:number}
export interface BindingOptions {subtitle?:string;subtitleKey?:string;finish_label?:string;finishKey?:string;upload_directory?:string;password_replacement_allowed?:boolean}
export interface Security {encryption_enabled?:boolean;encryption_ready?:boolean}
export interface RestoreCheck {restore_token:string;connections:ImportRow[];unresolved_identities?:{connection_id:number}[];encrypted_bundle?:boolean;upload_directory?:string;password_replacement_allowed?:boolean}
export interface Snapshot {id:string;reason:string;created_at:number|string;counts?:{connections?:number;forwards?:number;templates?:number}}
export interface Selection {connections:boolean;remote_profiles:boolean;forwards:boolean;command_snippets:boolean;passwords:boolean}
export interface ExchangeScope {key:string;owner:object;valid():boolean;element():HTMLElement|null}
export interface ExchangePort {api:Api;http(url:string,options?:RequestInit):Promise<Response>;tr:Translate;error(value:unknown,fallback:string):string;phrase(value:string):string;responseError(response:Response,fallback:string):Promise<Error>;notify(text:string,kind:'success'|'info'|'error'):void;reload():Promise<unknown>;security():Promise<Security>;unlocked(context:string):boolean;upload(file:File):Promise<Candidate>;identityLabel(item:Candidate):string;clipboard(value:string):Promise<void>;open(update:boolean):ExchangeScope|null;current():ExchangeScope|null;scope(key:string):ExchangeScope|null;heading(key:string,value:Section,move:boolean):void;reason(value:string):string}
export type Ask=(question:Question)=>Promise<string>;
export type Bind=(items:ImportRow[],mode:'identity'|'credential',options:BindingOptions,signal?:AbortSignal)=>Promise<Credential[]|null>;
export { filenameFromPath as identityName } from '../../shared/file-path';
export const hasSelection=(s:Partial<Selection>)=>Boolean(s.connections||s.remote_profiles||s.forwards||s.command_snippets);
export const validOrder=(value:unknown)=>Number.isInteger(Number(value))&&Number(value)>=1&&Number(value)<=2147483647;
export const unboundCount=(check:RestoreCheck,bindings:Credential[]=[])=>{const resolved=new Set(bindings.filter(b=>b.auth_type==='password'||b.auth_type==='key'&&b.identity_path).map(b=>Number(b.connection_id)));return (check.unresolved_identities||[]).filter(r=>!resolved.has(Number(r.connection_id))).length;};
