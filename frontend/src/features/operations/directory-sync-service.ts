import {connectionId,errorMessage,identifier,remotePath,request,type Api,type ModalBinding,type SyncJob,type SyncModel,type SyncPlan,type Translate} from './operations-types';
export interface SyncActions {
  close():void;compare():Promise<unknown>;execute():Promise<unknown>;
  change(key:'mode'|'useHash'|'excludes',value:string|boolean):void;select(index:number,checked:boolean):void;selectAll(checked:boolean):void;direction(index:number,value:string):void;
}
interface Port {
  api:Api;desktop():boolean;choose():Promise<string>;pickerCurrent():()=>boolean;capture(id:number,key:string):()=>boolean;name(id:number):string;
  view(model:SyncModel,actions:SyncActions,closed:()=>void):ModalBinding;wait(ms:number):Promise<void>;
  tr:Translate;notify(message:string,kind:'info'|'success'|'error'):void;refreshJobs():Promise<unknown>;tasks():void;
}
interface Owner {model:SyncModel;binding:ModalBinding|null;valid():boolean;version:number}
export function createDirectorySyncService(port:Port){
  let owner:Owner|null=null,opening=0,choosing=false,disposed=false;
  const visible=(value:Owner)=>owner===value&&value.binding?.alive()===true;
  const stale=(value:Owner)=>{if(visible(value)){value.model.error=port.tr('sftp:sync.target_changed');value.model.busy=false;value.model.phase='error';value.binding?.paint();}return false;};
  function mount(id:number,path:string,key:string,local:string){
    const value:Owner={model:{connectionId:id,tabKey:key,connectionName:port.name(id),localPath:local,remotePath:path,mode:'bidirectional',useHash:false,excludes:'',phase:'options',error:'',busy:false,plan:null,selected:new Set(),overrides:new Map()},binding:null,valid:port.capture(id,key),version:0};
    owner=value;
    const actions:SyncActions={close:()=>value.binding?.close(),compare:()=>compare(id,key),execute:()=>execute(id,value.model.plan?.id||'',key),
      change(key,next){if(!visible(value)||value.model.busy)return;if(key==='useHash')value.model.useHash=Boolean(next);else if(key==='mode'&&['upload','download','bidirectional'].includes(String(next)))value.model.mode=String(next);else if(key==='excludes')value.model.excludes=String(next);value.binding?.paint();},
      select(index,checked){if(!visible(value)||value.model.busy)return;const item=value.model.plan?.actions.find(item=>item.index===index);if(!item||item.action==='conflict'&&!value.model.overrides.has(index))return;if(checked)value.model.selected.add(index);else value.model.selected.delete(index);value.binding?.paint();},
      selectAll(checked){selectAll(checked);},direction(index,next){direction(index,next);}};
    value.binding=port.view(value.model,actions,()=>{value.version++;if(owner===value)owner=null;});return value;
  }
  async function open(id:number,path='.',key=''){
    if(!port.desktop()){port.notify(port.tr('sftp:sync.desktop_only'),'info');return false;}
    if(disposed||choosing||!connectionId(id)||!remotePath(path))return false;
    const ticket=++opening,valid=port.capture(id,key),picker=port.pickerCurrent();choosing=true;
    try{const local=await port.choose();if(!local)return false;if(ticket!==opening||!valid()||!picker()){port.notify(port.tr('sftp:sync.target_changed'),'info');return false;}mount(id,path,key,local);return true;}
    catch(error){port.notify(errorMessage(error,port.tr('sftp:sync.choose_local_failed')),'error');return false;}
    finally{if(ticket===opening)choosing=false;}
  }
  function setPlan(value:Owner,plan:SyncPlan){
    if(!identifier(plan?.id)||!remotePath(plan.local_path)||!remotePath(plan.remote_path)||!Array.isArray(plan.actions)||plan.actions.length>20000||plan.actions.some(item=>!Number.isSafeInteger(item.index)||item.index<0||!['upload','download','conflict'].includes(item.action)||!remotePath(item.relative))||new Set(plan.actions.map(item=>item.index)).size!==plan.actions.length)throw new Error(port.tr('sftp:sync.compare_failed'));
    value.model.plan={...plan,actions:plan.actions.map(item=>({...item}))};value.model.selected=new Set(plan.actions.filter(item=>item.action!=='conflict'&&item.selected).map(item=>item.index));value.model.overrides=new Map();value.model.phase='plan';value.model.error='';value.model.busy=false;value.binding?.paint();
  }
  function showPlan(id:number,plan:SyncPlan,key=''){if(disposed)return;const value=mount(id,plan.remote_path||'.',key,plan.local_path||'');try{setPlan(value,plan);}catch(error){value.model.phase='error';value.model.error=errorMessage(error,port.tr('sftp:sync.compare_failed'));value.binding?.paint();}}
  async function compare(id:number,key=''){
    const value=owner;if(!value||!visible(value)||value.model.busy||value.model.connectionId!==id||value.model.tabKey!==key)return false;
    if(!value.valid())return stale(value);
    const model=value.model,version=++value.version;model.busy=true;model.error='';model.phase='scanning';value.binding?.paint();
    const valid=()=>visible(value)&&value.version===version;
    try{
      let job=await request<SyncJob>(port.api,`/api/connections/${id}/sftp/sync/plan`,{method:'POST',body:JSON.stringify({local_path:model.localPath,remote_path:model.remotePath,mode:model.mode,use_hash:model.useHash,excludes:model.excludes})});
      void port.refreshJobs().catch(()=>{});
      if(!identifier(job?.id))throw new Error(port.tr('sftp:sync.compare_failed'));
      while(['running','pending'].includes(job.status)){
        if(!valid())return false;if(!value.valid())return stale(value);
        await port.wait(600);if(!valid())return false;if(!value.valid())return stale(value);
        job=await request<SyncJob>(port.api,`/api/sftp/sync/jobs/${encodeURIComponent(job.id)}`);
      }
      if(!valid())return false;if(!value.valid())return stale(value);
      if(job.status==='cancelled'){value.binding?.close();return false;}
      if(job.status!=='completed'||!job.plan_result)throw new Error(job.errors?.[0]?.error||port.tr('sftp:sync.compare_failed'));
      setPlan(value,job.plan_result);return true;
    }catch(error){if(valid()){model.error=errorMessage(error,port.tr('sftp:sync.compare_failed'));model.phase='error';}return false;}
    finally{if(valid()){model.busy=false;value.binding?.paint();}}
  }
  function selectAll(checked:boolean){const value=owner;if(!value||!visible(value)||value.model.busy)return;for(const item of value.model.plan?.actions||[])if(item.action!=='conflict'||value.model.overrides.has(item.index)){if(checked)value.model.selected.add(item.index);else value.model.selected.delete(item.index);}value.binding?.paint();}
  function direction(index:number,next:string){const value=owner;if(!value||!visible(value)||value.model.busy||value.model.plan?.actions.find(item=>item.index===index)?.action!=='conflict')return;
    if(next==='upload'||next==='download'){value.model.overrides.set(index,next);value.model.selected.add(index);}else{value.model.overrides.delete(index);value.model.selected.delete(index);}value.binding?.paint();}
  async function execute(id:number,planId:string,key=''){
    const value=owner,model=value?.model;if(!value||!model||!visible(value)||model.busy||id!==model.connectionId||key!==model.tabKey||!model.plan||model.plan.id!==planId)return false;
    if(!value.valid())return stale(value);
    const selected=model.plan.actions.filter(item=>model.selected.has(item.index)&&(item.action!=='conflict'||model.overrides.has(item.index))).map(item=>item.index);
    if(!selected.length){port.notify(port.tr('sftp:sync.select_one'),'info');return false;}
    const overrides=Object.fromEntries([...model.overrides].filter(([index])=>selected.includes(index)));model.busy=true;model.error='';value.binding?.paint();
    try{const job=await request<SyncJob>(port.api,`/api/connections/${id}/sftp/sync/execute`,{method:'POST',body:JSON.stringify({plan_id:planId,selected_indexes:selected,overrides})});
      if(!identifier(job?.id))throw new Error(port.tr('sftp:sync.start_failed'));
      const owned=visible(value);if(owned)value.binding?.close();port.notify(port.tr('sftp:sync.started',{count:job.total||selected.length}),'success');if(owned)port.tasks();await port.refreshJobs().catch(()=>{});return true;
    }catch(error){if(visible(value)){model.error=errorMessage(error,port.tr('sftp:sync.start_failed'));model.busy=false;value.binding?.paint();}return false;}
  }
  return {open,compare,execute,showPlan,selectAll,direction,model:()=>owner?.model||null,dispose(){disposed=true;opening++;choosing=false;owner?.binding?.close();owner=null;}};
}
