import {filesServices} from '@/features/files/installed-services';
import {sharedServices} from '@/shared/installed-services';
import {canPauseSftpTask,canResumeSftpTask,canCancelSftpTask,type SftpTask,type SftpTaskAction} from './sftp-task-service';
import {sftpTaskCollections,sftpTaskQueue,type TaskRecord} from './sftp-task-model';
import {saveSftpBrowserBlob} from './sftp-download-transport';

type Result={ok?:boolean;status?:string;error?:string;message?:string;message_code?:string;message_params?:Record<string,unknown>;removed?:number;total?:number;[key:string]:unknown};
interface ActionPort {
  begin(key:string,button:HTMLElement|null,label:string|(()=>string)):boolean;end(key:string,button:HTMLElement|null):void;
  text(key:string,values?:Record<string,unknown>):string;
  message(message?:string,code?:string,params?:Record<string,unknown>):string;
  notify(message:string,kind:'error'|'info'|'success'):void;
  confirm(message:()=>string,title:()=>string,action:()=>string,cancel:()=>string,danger:boolean):Promise<boolean>;
  command(id:string,action:SftpTaskAction):Promise<Result|null>;
  queue():SftpTask[];failed():SftpTask[];
  batch(jobs:SftpTask[],run:(job:SftpTask)=>Promise<Result|null>):Promise<PromiseSettledResult<Result|null>[]>;
  refresh():Promise<unknown>;remove(id:string):Promise<unknown>;
  api(url:string,request?:{method:string;body?:string}):Promise<Result>;desktop():boolean;clearGenerated():number;
  saveReport?(report:Result,filename:string):void|Promise<void>;
  drawer():{open:boolean;restore():void};
}
const errorText=(error:unknown)=>error instanceof Error?error.message:'';
export function createTaskActions(port:ActionPort){
  const pending=new Set<string>(),t=port.text;
  async function busy<T>(key:string,button:HTMLElement|null,label:string,failure:string,operation:()=>Promise<T>,keepDrawer=false){
    if(pending.has(key)||!port.begin(key,button,()=>t(label)))return null;
    pending.add(key);const drawer=keepDrawer?port.drawer():null;
    try{return await operation();}
    catch(error){port.notify(errorText(error)||t(failure),'error');return null;}
    finally{pending.delete(key);port.end(key,button);if(drawer?.open)drawer.restore();}
  }
  const confirm=(name:string,values?:Record<string,unknown>,action?:string)=>port.confirm(
    ()=>t(`tasks:dialogs.${name}_message`,values),()=>t(`tasks:dialogs.${name}_title`),
    ()=>t(action||`tasks:dialogs.${name}_action`),()=>t('common:actions.cancel'),true);
  function single(id:string,action:SftpTaskAction,button:HTMLElement|null=null){
    const label=action==='cancel'?'stopping':action==='pause'?'pausing':'processing';
    const failure=action==='cancel'?'tasks:notifications.clear_queue_failed':`sftp:task_ui.${action}_failed`;
    return busy(`sftp-task:${action}:${id}`,button,`sftp:task_ui.${label}`,failure,async()=>{
      const result=await port.command(id,action);
      if(action==='resume'){
        if(!result)return;
        if(result.error||result.ok===false){port.notify(result.error||t(failure),'error');return;}
        port.notify(t('sftp:task_ui.resumed'),'success');
      }else if(result?.ok===false||result?.error){
        port.notify(action==='cancel'?port.message(result.message,result.message_code,result.message_params)||t('sftp:task_ui.stop_rejected'):result.error||t(failure),action==='cancel'?'info':'error');
      }
      await port.refresh();
    });
  }
  function batch(action:SftpTaskAction,button:HTMLElement|null=null){
    const suffix=action==='cancel'?'clear-queue':`${action}-all`;
    return busy(`sftp-task:${suffix}`,button,`sftp:task_ui.${action==='cancel'?'stopping':action==='pause'?'pausing':'processing'}`,
      action==='cancel'?'tasks:notifications.clear_queue_failed':`sftp:task_ui.${action}_failed`,async()=>{
        const queue=port.queue(),eligible=action==='pause'?canPauseSftpTask:action==='resume'?canResumeSftpTask:canCancelSftpTask;
        const candidates=queue.filter(eligible);
        if(action==='cancel'){
          if(!candidates.length)return {completed:0,skipped:queue.length};
          if(!await confirm('clear_queue',{count:candidates.length}))return null;
        }
        const results=await port.batch(candidates,job=>port.command(String(job.id),action));
        const completed=results.filter(result=>{
          if(result.status!=='fulfilled'||!result.value)return false;
          const value=result.value;
          return action==='pause'?value.status==='paused':action==='resume'?value.ok!==false&&!value.error:value.ok!==false&&['cancelled','cancelling'].includes(value.status||'');
        }).length;
        const skipped=queue.length-completed;await port.refresh();
        port.notify(t(skipped?'tasks:notifications.queue_partial':`tasks:notifications.queue_${action==='pause'?'paused':action==='resume'?'resumed':'cleared'}`,{completed,skipped,count:completed}),skipped?'info':'success');
        return {completed,skipped};
      });
  }
  function remove(id:string,button:HTMLElement|null=null){
    return busy(`sftp-task:delete:${id}`,button,'sftp:task_ui.deleting','sftp:task_ui.delete_failed',async()=>{
      if(!await confirm('delete',undefined,'common:actions.delete'))return null;
      await port.remove(id);await port.refresh();
    },true);
  }
  function clearFailed(button:HTMLElement|null=null){
    return busy('sftp-task:clear-failed',button,'sftp:task_ui.clearing','sftp:task_ui.clear_failed_failed',async()=>{
      const failed=port.failed();if(!failed.length||!await confirm('clear_failed',{count:failed.length}))return null;
      const results=await Promise.allSettled(failed.map(job=>port.remove(String(job.id))));
      const removed=results.filter(result=>result.status==='fulfilled'&&result.value!==null&&(result.value as Result)?.ok!==false).length,rejected=results.length-removed;
      await port.refresh();port.notify(t(rejected?'sftp:task_ui.failed_tasks_partially_deleted':'sftp:task_ui.failed_tasks_deleted',{removed,rejected,count:removed}),rejected?'error':'success');
    },true);
  }
  function clearHistory(button:HTMLElement|null=null){
    return busy('sftp-task:clear-history',button,'sftp:task_ui.clearing','sftp:task_ui.clear_history_failed',async()=>{
      if(!await confirm('clear_history'))return null;
      const first=await port.api('/api/sftp/jobs/clear-finished',{method:'POST'});
      let count=Number(first.removed||0);
      const endpoints=[...(port.desktop()?['/api/sftp/sync/jobs/clear-finished']:[]),'/api/linux-desktop/tasks/clear-finished','/api/remote-component/tasks/clear-finished'];
      for(const endpoint of endpoints){const result=await port.api(endpoint,{method:'POST'}).catch(()=>({removed:0}));count+=Number(result.removed||0);}
      count+=port.clearGenerated();port.notify(t('sftp:task_ui.history_cleared',{count}),'success');await port.refresh();
    },true);
  }
  function sync(id:string,action:'retry'|'export',button:HTMLElement|null=null){
    if((action!=='retry'&&action!=='export')||!id||id.length>4000||/[\u0000-\u001f\u007f]/.test(id))return Promise.resolve(null);
    const retry=action==='retry',failure=retry?'sftp:task_ui.sync_retry_failed':'sftp:task_ui.export_failed';
    return busy(`sftp-task:sync-${action}:${id}`,button,retry?'sftp:task_ui.retrying':'sftp:task_ui.exporting',failure,async()=>{
      const route=`/api/sftp/sync/jobs/${encodeURIComponent(id)}`;
      const result=await port.api(retry?`${route}/retry`:route,retry?{method:'POST',body:'{}'}:undefined);
      if(!result||typeof result!=='object'||Array.isArray(result)||result.ok===false||result.error)
        throw new Error(result?.error||result?.message||t(failure));
      if(retry){
        const total=Number(result.total),count=Number.isFinite(total)&&total>=0?total:0;
        port.notify(t('sftp:task_ui.sync_retried',{count}),'success');await port.refresh();
      }else{
        const filename=`terma-sync-${id.replace(/[<>:"/\\|?*]/g,'_').slice(0,200)}.json`;
        if(port.saveReport)await port.saveReport(result,filename);
        else saveSftpBrowserBlob(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),filename);
      }
      return result;
    });
  }
  function floatAction(button:HTMLElement|null){
    const id=button?.dataset.jobId,action=button?.dataset.action;
    if(!id||(action!=='pause'&&action!=='resume'))return Promise.resolve(null);
    return single(id,action,button);
  }
  return {single,batch,remove,clearFailed,clearHistory,sync,floatAction,isPending:(key:string)=>pending.has(key)};
}
export type TaskActionHost = Pick<ActionPort,'text'|'message'|'notify'|'confirm'|'api'|'refresh'> & {
  jobs(): TaskRecord[];
  abortUpload(id: string): void;
  paint(): void;
};

export function installTaskActions(host: TaskActionHost) {
  let owner: ReturnType<typeof createTaskActions> | undefined;
  const create = () => {
    const tasks = filesServices.termaSftpTasks!, controls = sharedServices.termaUiActions;
    const generated = filesServices.termaGeneratedFiles.current();
    return createTaskActions({
      ...host, begin:controls.begin, end:controls.end,
      queue:()=>sftpTaskQueue(host.jobs()), failed:()=>sftpTaskCollections(host.jobs()).failed,
      command:(id,action)=>tasks.run(host,id,action), batch:tasks.batch,
      remove:id=>tasks.remove({api:host.api,generated:generated.remove},id),
      desktop:()=>Boolean(window.termaDesktop), clearGenerated:generated.clear,
      drawer() {
        const drawer=document.getElementById('sftpTaskCenterDrawer');
        return {open:drawer?.hidden === false,restore() {
          if (!drawer) return;
          drawer.hidden=false;
          document.getElementById('sftpTaskCenterButton')?.setAttribute('aria-expanded','true');
          host.paint();
        }};
      }
    });
  };
  filesServices.termaTaskActions={get current(){return owner ||= create();}};
}


export interface InstalledFeaturesFilesSftpTaskActionsServices {
  termaTaskActions:{readonly current: ReturnType<typeof createTaskActions>};
}
