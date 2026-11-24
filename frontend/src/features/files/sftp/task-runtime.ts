import {projectSftpTasks,type TaskRecord,type TaskProjectionPort} from './sftp-task-model';
interface TaskEvent {target?:EventTarget|null;preventDefault?():void;stopPropagation?():void}
interface Port extends TaskProjectionPort {
  api(url:string):Promise<unknown>;desktop():boolean;generated():unknown;now():number;
  jobs():TaskRecord[];publish(jobs:TaskRecord[]):void;paint():void;float():void;start():void;
  completed(jobs:TaskRecord[]):void;
  view(value:'current'|'failed'|'history'):void;
  finishResize():void;monitor(drawer:HTMLElement):void;restoreSize(drawer:HTMLElement):void;
  dismissed:Set<string>;confirm(message:()=>string,title:()=>string,accept:()=>string,cancel:()=>string):Promise<boolean>;
  floating():boolean;saveFloating():Promise<void>;notify(message:string,kind:'success'|'error'):void;
}
const active=new Set(['running','pending','paused']);
/** One owner for task snapshots, refresh coalescing and drawer/floating lifecycle. */
export function createTaskRuntime(port:Port){
  let pending:Promise<TaskRecord[]>|null=null,again=false,lastPoll=0,sequence=0,muting=false;
  async function perform(){
    const request=++sequence;
    const read=(url:string)=>port.api(url).catch(()=>[]);
    const [transfer,sync,desktop,component]=await Promise.all([
      read('/api/sftp/jobs'),port.desktop()?read('/api/sftp/sync/jobs'):Promise.resolve([]),
      read('/api/linux-desktop/tasks'),read('/api/remote-component/tasks')
    ]);
    if(request!==sequence)return port.jobs();
    const jobs=projectSftpTasks({transfer,sync,desktop,component,generated:port.generated()},port);
    lastPoll=port.now();port.publish(jobs);port.completed(jobs);port.paint();
    if(jobs.some(job=>active.has(job.status)))port.start();
    return jobs;
  }
  function refresh(){
    if(pending){again=true;return pending;}
    pending=(async()=>{let jobs:TaskRecord[];do{again=false;jobs=await perform();await Promise.resolve();}while(again);return jobs;})()
      .finally(()=>{pending=null;again=false;});
    return pending;
  }
  function stale(maxAge=2000){
    if(pending)return pending;
    const age=port.now()-lastPoll;
    return age>=0&&age<Math.max(0,Number(maxAge)||0)?Promise.resolve(port.jobs()):refresh();
  }
  function view(value:string){port.view(value==='history'||value==='failed'?value:'current');port.paint();}
  function close(){
    port.finishResize();const drawer=document.getElementById('sftpTaskCenterDrawer');if(drawer)drawer.hidden=true;
    document.body.classList.remove('sftp-task-center-open');document.getElementById('sftpTaskCenterButton')?.setAttribute('aria-expanded','false');
  }
  async function toggle(event?:TaskEvent){
    event?.preventDefault?.();event?.stopPropagation?.();
    const drawer=document.getElementById('sftpTaskCenterDrawer'),button=document.getElementById('sftpTaskCenterButton');
    if(!drawer||!button)return;if(!drawer.hidden)return close();
    drawer.hidden=false;document.body.classList.add('sftp-task-center-open');port.monitor(drawer);port.restoreSize(drawer);
    button.setAttribute('aria-expanded','true');port.paint();await refresh();
  }
  async function open(event?:TaskEvent){
    if(event?.target instanceof Element&&event.target.closest('.sftp-task-float-actions'))return;
    event?.preventDefault?.();event?.stopPropagation?.();view('current');
    if(document.getElementById('sftpTaskCenterDrawer')?.hidden)await toggle();else await refresh();
  }
  function dismiss(){
    for(const job of port.jobs())if(active.has(job.status)&&job.id)port.dismissed.add(String(job.id));
    const box=document.getElementById('sftpTaskFloat');if(box)box.hidden=true;
  }
  async function mute(){
    if(muting)return;muting=true;
    try{
      if(!await port.confirm(()=>port.tr('sftp:task_ui.mute_message'),()=>port.tr('sftp:task_ui.mute_title'),()=>port.tr('sftp:task_ui.mute_confirm'),()=>port.tr('common:actions.cancel')))return;
      await port.saveFloating();port.float();port.notify(port.tr('sftp:task_ui.muted'),'success');
    }catch(error){port.notify(error instanceof Error?error.message:port.tr('sftp:task_ui.mute_failed'),'error');}
    finally{muting=false;}
  }
  return {refresh,perform,stale,view,close,toggle,open,dismiss,mute,floating:port.floating,get lastPoll(){return lastPoll;}};
}
