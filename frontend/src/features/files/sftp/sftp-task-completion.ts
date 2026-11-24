export interface CompletionJob {
  id?:unknown;type?:string;status?:string;phase?:string;current?:string;current_i18n_key?:string;
  connection_id?:number;finished_at?:number|string|null;can_pause?:boolean;can_cancel?:boolean;
  progress?:number;transferred?:number;size?:number;
  delivery_status?:string;saved_path?:string;target_directory?:string;
}
interface CompletionEvent {level?:string;action?:{sftp_job_id?:unknown;download_job_id?:unknown;connection_id?:number}}
interface CompletionPort {
  jobs():CompletionJob[];
  queueDirectory(connectionId:number):void;
  flushDirectories():void;
  localDelivery(job:CompletionJob):void;
  changed():void;
}
const active=new Set(['running','pending','paused']);
const terminal=new Set(['done','failed','cancelled']);
const mutations=new Set(['upload','copy','cross-copy','move','extract','compress','delete','sync','local-delivery']);
/** Notifications may precede authoritative task paths; only a poll completes local delivery. */
export function createSftpTaskCompletion(port:CompletionPort){
  const statuses=new Map<string,string>();
  function track(job:CompletionJob){
    if(job?.id)statuses.set(String(job.id),terminal.has(job.status||'')?'pending':job.status||'running');
  }
  function settle(event:CompletionEvent){
    const id=String(event?.action?.sftp_job_id||event?.action?.download_job_id||'');if(!id)return false;
    const job=port.jobs().find(item=>String(item.id||'')===id);if(!job||!active.has(job.status||''))return false;
    const failed=event.level==='error';job.status=failed?'failed':'done';job.phase='';
    if(job.type==='native-drag'){job.current='';job.current_i18n_key='';}
    job.finished_at=job.finished_at||Date.now();job.can_pause=false;job.can_cancel=false;
    if(!failed){job.progress=100;if(Number(job.size||0)>0)job.transferred=Number(job.size);}
    const connectionId=Number(job.connection_id||event.action?.connection_id||0);
    if(connectionId&&mutations.has(job.type||'')){port.queueDirectory(connectionId);port.flushDirectories();}
    if(!['local-delivery','download'].includes(job.type||''))statuses.set(id,job.status);
    port.changed();return true;
  }
  function observe(jobs:CompletionJob[]){
    const refresh=new Set<number>(),visible=new Set<string>();
    for(const job of jobs){
      const id=String(job.id||'');if(!id)continue;visible.add(id);const previous=statuses.get(id);
      if(previous&&previous!==job.status&&terminal.has(job.status||'')){
        const connectionId=Number(job.connection_id||0);
        if(connectionId&&mutations.has(job.type||''))refresh.add(connectionId);
        if(['local-delivery','download'].includes(job.type||''))port.localDelivery(job);
      }
      statuses.set(id,job.status||'');
    }
    for(const id of statuses.keys())if(!visible.has(id)&&statuses.size>80)statuses.delete(id);
    return refresh;
  }
  function complete<T extends CompletionJob>(jobs:T[],deliver:(jobs:T[])=>unknown){
    deliver(jobs);
    for(const id of observe(jobs))port.queueDirectory(id);
    port.flushDirectories();
  }
  return {track,settle,observe,complete,statuses,dispose(){statuses.clear();}};
}
