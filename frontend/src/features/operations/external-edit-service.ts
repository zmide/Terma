import {connectionId,errorMessage,identifier,remotePath,request,type Api,type ExternalComparison,type ExternalSession,type Text,type Translate} from './operations-types';
interface Progress {update(value:{title:string;detail:string}):void;finish(message:string,linger?:number):void;fail(message:string):void}
export interface ExternalEditPort {
  api:Api;desktop():boolean;hidden():boolean;vnc():boolean;stored(key:string):string|null;settings():Record<string,unknown>;
  tr:Translate;notify(message:string,kind:'info'|'success'|'error'):void;
  choose(title:Text,message:Text,actions:{label:Text;value:string;className?:string}[]):Promise<unknown>;
  input(title:Text,label:Text,value:string):Promise<string|null>;
  compare(session:ExternalSession,comparison:ExternalComparison):Promise<string>;
  progress(title:string,detail:string):Progress;language?(listener:()=>void):()=>void;
  refresh(id:number):void;modalFree?():boolean;available?(listener:()=>void):()=>void;
  timers?:{set(run:()=>void,delay:number):ReturnType<typeof setTimeout>;clear(timer:ReturnType<typeof setTimeout>):void};
}
type Queued={session:ExternalSession;generation:number};
export function parseExternalEditorArguments(value:string){return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(argument=>argument.replace(/^"|"$/g,''))||[];}
export function createExternalEditService(port:ExternalEditPort){
  const timers=new Map<string,ReturnType<typeof setTimeout>>(),generations=new Map<string,number>(),prompts=new Map<string,Queued>(),signatures=new Map<string,string>(),observed=new Map<string,string>(),opening=new Set<string>();
  const queue:Queued[]=[];let active=false,disposed=false;
  const clock=port.timers||{set:(run:()=>void,after:number)=>setTimeout(run,after),clear:(timer:ReturnType<typeof setTimeout>)=>clearTimeout(timer)},tr=port.tr;
  const generation=(id:string)=>generations.get(id)||0;
  const current=(id:string,value:number)=>!disposed&&generation(id)===value;
  const modalFree=()=>port.modalFree?.()!==false;
  const unwatch=port.available?.(()=>{if(modalFree())void drain();});
  const delay=()=>port.hidden()?8000:port.vnc()?3000:1200;
  function stopPolling(id:string){if(!identifier(id))return;const timer=timers.get(id);if(timer!==undefined)clock.clear(timer);timers.delete(id);generations.set(id,generation(id)+1);}
  function schedule(id:string,version:number,after=delay()){
    if(!identifier(id)||!current(id,version))return;
    const old=timers.get(id);if(old!==undefined)clock.clear(old);
    timers.set(id,clock.set(()=>{timers.delete(id);void poll(id,version).then(keep=>{if(keep&&current(id,version))schedule(id,version);}).catch(()=>{if(current(id,version))schedule(id,version);});},Math.max(0,after)));
  }
  function start(id:string){if(!identifier(id)||disposed)return;stopPolling(id);schedule(id,generation(id),1200);}
  function settings(){return {mode:port.stored('sftpExternalEditorMode')||'system',path:port.stored('sftpExternalEditorPath')||'',args:parseExternalEditorArguments(port.stored('sftpExternalEditorArgs')||'')};}
  function policy(){const saved=port.settings();return {save_rule:saved.sftp_external_edit_save_rule==='overwrite'?'overwrite':'prompt',backup_on_auto_save:saved.sftp_external_edit_backup_enabled!==false};}
  async function open(id:number,path:string){
    if(!port.desktop()){port.notify(tr('sftp:external_edit.desktop_only'),'info');return false;}
    if(disposed||!connectionId(id)||!remotePath(path))return false;
    const key=JSON.stringify([id,path]);if(opening.has(key))return false;opening.add(key);
    const text=()=>({title:tr('sftp:external_edit.opening',{name:path.split('/').pop()||path}),detail:tr('sftp:external_edit.preparing_copy')});
    let progress:Progress|undefined,unlisten:(()=>void)|undefined;
    try{progress=port.progress(text().title,text().detail);unlisten=port.language?.(()=>progress?.update(text()));const captured=policy();
      const session=await request<ExternalSession>(port.api,`/api/connections/${id}/sftp/external-edit`,{method:'POST',body:JSON.stringify({path,editor:settings(),...captured})});
      if(!identifier(session.id))throw new Error(tr('sftp:external_edit.open_failed'));
      progress.finish(tr(`sftp:external_edit.opened_${captured.save_rule}`),3500);start(session.id);return true;
    }catch(error){const message=errorMessage(error,tr('sftp:external_edit.open_failed'));if(progress)progress.fail(message);else port.notify(message,'error');return false;}finally{opening.delete(key);unlisten?.();}
  }
  async function poll(id:string,version=generation(id)){
    if(!identifier(id)||!current(id,version))return false;
    let session:ExternalSession;
    try{session=await request<ExternalSession>(port.api,`/api/sftp/external-edits/${encodeURIComponent(id)}`);}
    catch{if(current(id,version))stopPolling(id);return false;}
    if(!current(id,version)||session?.id!==id)return false;
    if(session.status==='synced'){
      const signature=`${session.status}:${session.updated_at||''}`;
      if(observed.get(id)!==signature){observed.set(id,signature);port.notify(tr('sftp:external_edit.uploaded',{path:session.remote_path}),'success');if(connectionId(session.connection_id))port.refresh(session.connection_id);}
    }
    if(['modified','conflict'].includes(session.status))await prompt(session);
    return current(id,version);
  }
  async function prompt(session:ExternalSession,force=false){
    const id=session?.id;if(!identifier(id)||disposed||!['modified','conflict'].includes(session.status)||prompts.has(id))return;
    const signature=`${session.status}:${session.updated_at||''}`;if(!force&&signatures.get(id)===signature)return;
    const entry={session:{...session},generation:generation(id)};signatures.set(id,signature);prompts.set(id,entry);queue.push(entry);return drain();
  }
  async function drain(){
    if(active||disposed)return;active=true;
    try{while(queue.length&&!disposed&&modalFree()){
      const entry=queue.shift()!,session=entry.session,id=session.id,valid=()=>current(id,entry.generation),conflict=session.status==='conflict';
      try{
        if(!valid())continue;
        const actions=[...(session.can_compare?[{label:()=>tr('sftp:external_edit.compare'),value:'compare'}]:[]),
          {label:()=>tr(conflict?'sftp:external_edit.overwrite_backup':'sftp:external_edit.save_remote'),value:conflict?'overwrite':'save',className:conflict?'danger':'primary'},
          {label:()=>tr('sftp:external_edit.save_as_remote'),value:'save_as',className:conflict?'primary':''},
          {label:()=>tr('sftp:external_edit.postpone'),value:'cancel'}];
        let choice=await port.choose(()=>tr(conflict?'sftp:external_edit.conflict_title':'sftp:external_edit.modified_title'),()=>`${session.connection_name}\n${session.remote_path}\n\n${tr(conflict?'sftp:external_edit.conflict_message':'sftp:external_edit.modified_message')}`,actions);
        if(!valid())continue;
        if(choice==='compare'&&!session.can_compare)continue;
        if(choice==='compare'){
          const comparison=await request<ExternalComparison>(port.api,`/api/sftp/external-edits/${encodeURIComponent(id)}/comparison`);if(!valid())continue;
          if(!modalFree())continue;
          choice=await port.compare(session,comparison);if(!valid())continue;
        }
        if(!['save','overwrite','save_as','cancel'].includes(String(choice)))continue;
        const payload:{action:string;remote_path?:string}={action:String(choice)};
        if(choice==='save_as'){if(!modalFree())continue;const path=await port.input(()=>tr('sftp:external_edit.save_as_remote'),()=>tr('sftp:external_edit.remote_path'),`${session.remote_path}.local`);if(!valid()||!path)continue;if(!remotePath(path))throw new Error(tr('sftp:external_edit.invalid_remote_path'));payload.remote_path=path;}
        if(!valid())continue;
        const resolved=await request<ExternalSession>(port.api,`/api/sftp/external-edits/${encodeURIComponent(id)}/resolve`,{method:'POST',body:JSON.stringify(payload)});
        if(!valid())continue;
        const key=resolved.status==='conflict'?'conflict_pending':choice==='cancel'?'changes_not_saved':choice==='save_as'?'saved_as_remote':choice==='overwrite'?'overwritten_backup':'saved_backup';
        port.notify(tr(`sftp:external_edit.${key}`),resolved.status==='conflict'||choice==='cancel'?'info':'success');
        if(resolved.status==='synced'&&connectionId(resolved.connection_id))port.refresh(resolved.connection_id);
      }catch(error){if(valid())port.notify(errorMessage(error,tr('sftp:external_edit.save_failed')),'error');}
      finally{if(prompts.get(id)===entry)prompts.delete(id);}
    }}finally{active=false;}
  }
  async function byId(id:string){if(!identifier(id)||disposed)return;const version=generation(id);const session=await request<ExternalSession>(port.api,`/api/sftp/external-edits/${encodeURIComponent(id)}`);if(current(id,version))return prompt(session,true);}
  async function stop(id:string){
    if(!identifier(id)||disposed)return false;
    await port.api(`/api/sftp/external-edits/${encodeURIComponent(id)}`,{method:'DELETE'});stopPolling(id);signatures.delete(id);observed.delete(id);prompts.delete(id);
    for(let index=queue.length-1;index>=0;index--)if(queue[index].session.id===id)queue.splice(index,1);
    return true;
  }
  return {open,poll,prompt,drain,byId,stop,start,stopPolling,schedule,settings,policy,delay,pending:()=>queue.length,
    dispose(){disposed=true;unwatch?.();for(const id of timers.keys())stopPolling(id);queue.length=0;prompts.clear();generations.clear();signatures.clear();observed.clear();opening.clear();}};
}
