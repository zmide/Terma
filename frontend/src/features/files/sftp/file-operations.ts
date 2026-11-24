import {joinRemotePath,parentRemotePath} from './directory-state';
import type {SftpCopyEntry} from './sftp-copy-service';
export type SftpOperationEntry = SftpCopyEntry & {mode?:string;owner?:string;group?:string};
export function normalizePermissionMode(value:unknown){const mode=String(value??'').trim();return /^[0-7]{3}$/.test(mode)?mode:'';}
export function permissionModeToChecks(value:unknown){const mode=normalizePermissionMode(value),digits=mode?mode.split('').map(Number):[0,0,0];return{
  ownerRead:Boolean(digits[0]&4),ownerWrite:Boolean(digits[0]&2),ownerExecute:Boolean(digits[0]&1),
  groupRead:Boolean(digits[1]&4),groupWrite:Boolean(digits[1]&2),groupExecute:Boolean(digits[1]&1),
  publicRead:Boolean(digits[2]&4),publicWrite:Boolean(digits[2]&2),publicExecute:Boolean(digits[2]&1)
};}
export function permissionChecksToMode(checks:Record<string,boolean>){const digit=(read:boolean,write:boolean,execute:boolean)=>(read?4:0)+(write?2:0)+(execute?1:0);return`${digit(checks.ownerRead,checks.ownerWrite,checks.ownerExecute)}${digit(checks.groupRead,checks.groupWrite,checks.groupExecute)}${digit(checks.publicRead,checks.publicWrite,checks.publicExecute)}`;}
export function selectedPermissionMetadata(entries:SftpOperationEntry[]){const modes=entries.map(item=>normalizePermissionMode(item.mode)).filter(Boolean),owners=entries.map(item=>item.owner).filter(Boolean),groups=entries.map(item=>item.group).filter(Boolean);return{
  mode:modes.length===entries.length&&modes.every(item=>item===modes[0])?modes[0]:'',owner:owners.length===entries.length&&owners.every(item=>item===owners[0])?(owners[0] || ''):'',group:groups.length===entries.length&&groups.every(item=>item===groups[0])?(groups[0] || ''):'',
  mixedMode:modes.length>1&&new Set(modes).size>1,hasDirectory:entries.some(item=>item.type==='dir')
};}
export interface SftpOperationContext { tabKey:string;connectionId:number;path:string;valid():boolean }
interface Job { id:string|number;type?:string;status?:string;[key:string]:unknown }
interface SftpOperationPort {
  context(tabKey:string,id?:number):SftpOperationContext|null;
  tr(key:string,params?:Record<string,unknown>):string;notify(message:string,kind:'info'|'error'|'success'):void;
  input(context:SftpOperationContext,kind:'file'|'directory'|'rename',value?:string,apply?:(value:string)=>Promise<void>):Promise<string|null>;
  confirm(context:SftpOperationContext,kind:'delete'|'extract'|'compress',count:number,path?:string):Promise<boolean>;
  selected(context:SftpOperationContext):SftpOperationEntry[];
  entry(context:SftpOperationContext,path:string):SftpOperationEntry|null;
  api(url:string,options:{method:string;body:string}):Promise<Job>;
  track(job:Job):void;refresh(context:SftpOperationContext):void;
  archive(context:SftpOperationContext,options:{mode:'extract'|'compress';path?:string;target:string;filename?:string}):Promise<{target:string;filename?:string;encoding:string;overwrite?:boolean}|null>;
  permissions(context:SftpOperationContext,entries:SftpOperationEntry[]):void;
  archiveName(entries:SftpOperationEntry[]):string;
  fileName(path:string):string;validName(name:string,label:string):boolean;
  setClipboard(context:SftpOperationContext,mode:'copy'|'move',entries:SftpCopyEntry[]):boolean;
  clipboard():unknown;paste(context:SftpOperationContext):Promise<unknown>;cancelClipboard():boolean;
  pathBytes(context:SftpOperationContext,path:string):string;
}
export function createSftpFileOperations(port:SftpOperationPort){
  const {tr}=port;
  async function mkdir(key:string){const c=port.context(key);if(!c)return;const name=await port.input(c,'directory');if(!c.valid()||!name||!port.validName(name,tr('sftp:operations.directory_label')))return;
    try{await port.api(`/api/connections/${c.connectionId}/sftp/mkdir`,{method:'POST',body:JSON.stringify({path:joinRemotePath(c.path,name)})});if(!c.valid())return;port.notify(tr('sftp:operations.directory_created'),'success');port.refresh(c);}catch(e){port.notify(e instanceof Error?e.message:tr('sftp:operations.create_directory_failed'),'error');}}
  async function createFile(key:string){const c=port.context(key);if(!c)return;const name=await port.input(c,'file');if(!c.valid()||!name||!port.validName(name,tr('sftp:operations.file_label')))return;
    try{await port.api(`/api/connections/${c.connectionId}/sftp/create-file`,{method:'POST',body:JSON.stringify({path:joinRemotePath(c.path,name)})});if(!c.valid())return;port.notify(tr('sftp:operations.file_created'),'success');port.refresh(c);}catch(e){port.notify(e instanceof Error?e.message:tr('sftp:operations.create_file_failed'),'error');}}
  async function rename(key:string,id:number,path:string,oldName:string){const c=port.context(key,id);if(!c)return;
    const name=await port.input(c,'rename',oldName,async value=>{if(!c.valid()||value===oldName||!port.validName(value,tr('sftp:operations.name_label')))return;await port.api(`/api/connections/${id}/sftp/rename`,{method:'POST',body:JSON.stringify({from:path,to:joinRemotePath(parentRemotePath(path),value)})});});
    if(c.valid()&&name&&name!==oldName)port.refresh(c);}
  async function inlineRename(key:string,id:number,path:string,name:string){
    const c=port.context(key,id);
    if(!c?.valid()||!port.entry(c,path))throw new DOMException('Rename target expired','AbortError');
    if(!name||!port.validName(name,tr('sftp:operations.name_label')))throw new Error(tr('sftp:inline_rename.invalid_name'));
    await port.api(`/api/connections/${c.connectionId}/sftp/rename`,{method:'POST',body:JSON.stringify({from:path,to:joinRemotePath(parentRemotePath(path),name)})});
    if(c.valid())port.refresh(c);
  }
  async function remove(key:string,id:number,paths?:string[]){const c=port.context(key,id);if(!c)return;const entries=paths?paths.map(path=>port.entry(c,path)).filter((v):v is SftpCopyEntry=>!!v):port.selected(c);if(!entries.length){port.notify(tr('sftp:operations.select_items'),'info');return;}
    if(!c.valid()||!await port.confirm(c,'delete',entries.length,paths?.length===1?paths[0]:'')||!c.valid())return;
    try{const job=await port.api(`/api/connections/${id}/sftp/delete`,{method:'POST',body:JSON.stringify({paths:entries.map(x=>x.path),path_bytes:entries.map(x=>port.pathBytes(c,x.path))})});port.track(job);port.refresh(c);}catch(e){port.notify(e instanceof Error?e.message:tr('errors:request_failed'),'error');}}
  async function extract(key:string,id:number,path:string){const c=port.context(key,id);if(!c)return;const archive=await port.archive(c,{mode:'extract',path,target:c.path});if(!archive||!c.valid())return;
    try{const job=await port.api(`/api/connections/${id}/sftp/extract`,{method:'POST',body:JSON.stringify({path,target:archive.target,encoding:archive.encoding,overwrite:archive.overwrite,background:true})});port.track(job);port.refresh(c);}catch(e){port.notify(e instanceof Error?e.message:tr('errors:request_failed'),'error');}}
  async function compress(key:string,paths?:string[]){const c=port.context(key);if(!c)return;const entries=paths?paths.map(path=>port.entry(c,path)).filter((entry):entry is SftpCopyEntry=>!!entry):port.selected(c);if(!entries.length){port.notify(tr('sftp:operations.select_compress_items'),'info');return;}
    const archive=await port.archive(c,{mode:'compress',target:c.path,filename:port.archiveName(entries)});if(!archive||!c.valid())return;
    try{const job=await port.api(`/api/connections/${c.connectionId}/sftp/compress`,{method:'POST',body:JSON.stringify({paths:entries.map(x=>x.path),target:c.path,filename:archive.filename,encoding:archive.encoding})});port.track(job);port.refresh(c);}catch(e){port.notify(e instanceof Error?e.message:tr('sftp:operations.compress_failed'),'error');}}
  function setClipboard(key:string,id:number,mode:'copy'|'move',path?:string){const c=port.context(key,id);if(!c)return false;const entries=path?[port.entry(c,path)].filter((x):x is SftpCopyEntry=>!!x):port.selected(c);if(!entries.length){port.notify(tr('sftp:operations.select_items'),'info');return false;}return port.setClipboard(c,mode,entries);}
  function permissions(key:string,paths?:string[]){const c=port.context(key);if(!c)return;const entries=paths?paths.map(path=>port.entry(c,path)).filter((v):v is SftpCopyEntry=>!!v):port.selected(c);if(!entries.length){port.notify(tr('sftp:permissions_editor.select_items'),'info');return;}port.permissions(c,entries);}
  return {mkdir,createFile,rename,inlineRename,remove,extract,compress,setClipboard,permissions,clipboard:port.clipboard,cancelClipboard:port.cancelClipboard,
    normalizePermissionMode,permissionModeToChecks,permissionChecksToMode,selectedPermissionMetadata,
    paste:async(key:string)=>{const c=port.context(key);if(c?.valid())return port.paste(c);}};
}
