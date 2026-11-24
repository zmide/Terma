import {errorMessage,remotePath,request,type ModalBinding} from './operations-types';
import {draft,payload,positive,safeSync,status,intervalMaximum,parseStartTime} from './automation-model';
import {frequencies} from './automation-types';
import {createAutomationPicker} from './automation-picker';
import type {Automation,AutomationActions,AutomationModel,AutomationPort,Connection,Draft,Frequency,RunPage} from './automation-types';
interface Owner {binding:ModalBinding|null;model:AutomationModel;version:number;timer:ReturnType<typeof setTimeout>|null;cronTimer:ReturnType<typeof setTimeout>|null;cronVersion:number;actions:AutomationActions}
export function createAutomationService(port:AutomationPort){
  let owner:Owner|null=null,disposed=false;
  const clock=port.clock||{set:(run:()=>void,ms:number)=>setTimeout(run,ms),clear:(timer:ReturnType<typeof setTimeout>)=>clearTimeout(timer)};
  const alive=(value:Owner)=>!disposed&&owner===value&&value.binding?.alive()===true;
  const paint=(value:Owner)=>{if(alive(value))value.binding?.paint();};
  function stop(value:Owner){if(value.timer!==null)clock.clear(value.timer);value.timer=null;}
  function release(value:Owner){stop(value);if(value.cronTimer!==null)clock.clear(value.cronTimer);value.cronTimer=null;value.version++;value.cronVersion++;if(value.model.picker)value.model.picker.version++;if(owner===value)owner=null;}
  function openOwner(){
    if(disposed)return null;if(owner&&alive(owner))return owner;
    const model:AutomationModel={view:'manager',items:[],connections:[],defaultPath:'',loading:false,error:'',busy:new Set(),draft:null,picker:null,historyId:0,runs:{items:[],total:0,page:1,total_pages:1,history_limit:300},expanded:new Set(),filters:new Map(),confirm:null,sortBusy:false};
    const value:Owner={binding:null,model,version:0,timer:null,cronTimer:null,cronVersion:0,actions:null as unknown as AutomationActions};owner=value;
    const picker=createAutomationPicker(port,model,()=>alive(value),()=>paint(value));
    value.actions={close:()=>value.binding?.close(),manager:()=>manager(),edit:(id=0)=>edit(id),history:(id,page=1)=>history(id,page),save:()=>save(value),command:(id,kind)=>command(value,id,kind),confirm:(kind,id)=>{if(!alive(value)||!positive(id)||model.busy.size)return;stop(value);model.confirm={kind,id,busy:false,error:''};paint(value);},decide:accepted=>decide(value,accepted),limit:limit=>limitHistory(value,limit),local:id=>openLocal(value,id),remote:id=>{const item=model.items.find(item=>item.id===id);if(!item)return;value.binding?.close();port.openRemote(item.connection_id,item.remote_path);},change:(key,next)=>change(value,key,next),expand:(id,expanded)=>{if(expanded)model.expanded.add(id);else model.expanded.delete(id);},filter:(id,filter)=>{model.filters.set(id,filter);paint(value);},reorder:ids=>reorder(value,ids),sorting:active=>{model.sortBusy=active;if(active)stop(value);else schedule(value);},choose:picker.choose,browse:()=>picker.open('remote'),directory:picker.load,toggleDirectory:picker.toggle,pickerEdit:picker.edit,selectDirectory:picker.select,closePicker:picker.close,mkdir:picker.mkdir,preview:()=>preview(value)};
    value.binding=port.view(model,value.actions,()=>release(value),()=>{if(model.confirm){if(!model.confirm.busy)model.confirm=null;paint(value);schedule(value);return true;}if(model.picker){picker.close();return true;}return false;});return value;
  }
  async function load(value:Owner,version=value.version){
    const items=await request<Automation[]>(port.api,'/api/sftp/automations');if(!alive(value)||version!==value.version)return false;value.model.items=Array.isArray(items)?items.filter(item=>positive(item.id)&&positive(item.connection_id)):[];return true;
  }
  function schedule(value:Owner){
    stop(value);if(!alive(value)||value.model.view!=='manager'||value.model.confirm||value.model.sortBusy||value.model.busy.size)return;
    const version=value.version,after=port.hidden()?5000:value.model.items.some(item=>status(item)==='running')?900:3000;
    value.timer=clock.set(()=>{value.timer=null;if(!alive(value)||version!==value.version)return;void load(value,version).then(loaded=>{if(loaded)paint(value);}).catch(()=>{}).finally(()=>{if(alive(value)&&version===value.version)schedule(value);});},after);
  }
  async function resources(value:Owner){
    const version=value.version;const results=await Promise.all([request<Connection[]>(port.api,'/api/connections'),port.desktop()?Promise.resolve({default_path:''}):request<{default_path:string}>(port.api,'/api/sftp/automations/context')]);
    if(!alive(value)||value.version!==version)return false;value.model.connections=Array.isArray(results[0])?results[0].filter(item=>positive(item.id)):[];value.model.defaultPath=results[1].default_path||'';return true;
  }
  async function manager(){const value=openOwner();if(!value)return false;stop(value);const version=++value.version;value.cronVersion++;const model=value.model;model.view='manager';model.draft=null;model.picker=null;model.confirm=null;model.loading=true;model.error='';paint(value);
    try{await Promise.all([load(value,version),resources(value)]);return alive(value)&&value.version===version;}
    catch(error){if(alive(value)&&value.version===version)model.error=errorMessage(error,port.tr('sftp:automation.load_failed'));return false;}
    finally{if(alive(value)&&value.version===version){model.loading=false;paint(value);schedule(value);}}
  }
  async function edit(id=0){
    if(id!==0&&!positive(id))return false;const value=openOwner();if(!value)return false;stop(value);const version=++value.version,model=value.model;value.cronVersion++;model.view='form';model.historyId=id;model.draft=null;model.picker=null;model.confirm=null;model.loading=true;model.error='';paint(value);
    try{if(!model.connections.length)await resources(value);if(!alive(value)||value.version!==version)return false;
      let item=model.items.find(item=>item.id===id)||null;if(id&&!item)item=await request<Automation>(port.api,`/api/sftp/automations/${id}`);
      if(!alive(value)||value.version!==version)return false;if(id&&(!item||item.id!==id))throw Error(port.tr('sftp:automation.load_failed'));
      model.draft=draft(item,model.connections,model.defaultPath);if(model.draft.frequency==='cron')preview(value);return true;
    }catch(error){if(alive(value)&&value.version===version)model.error=errorMessage(error,port.tr('sftp:automation.load_failed'));return false;}
    finally{if(alive(value)&&value.version===version){model.loading=false;paint(value);}}
  }
  function change<K extends keyof Draft>(value:Owner,key:K,next:Draft[K]){const model=value.model,form=model.draft;if(!alive(value)||!form||model.busy.has('save'))return;
    if(key==='frequency'&&!frequencies.includes(next as Frequency)||key==='direction'&&!['upload','download','bidirectional'].includes(String(next)))return;
    form[key]=next;if(key==='frequency')form.interval=Math.min(form.interval,intervalMaximum(form.frequency));if(key==='notify')form.notifyAuto=false;if(key==='connectionId'){if(model.picker)model.picker.version++;model.picker=null;}
    if(['frequency','direction','propagateDeletes'].includes(key)&&form.notifyAuto)form.notify=!safeSync(form);
    if(['frequency','cron','startAt'].includes(key)){form.cronState='idle';form.cronRuns=[];preview(value);}paint(value);
  }
  function preview(value:Owner){
    if(value.cronTimer!==null)clock.clear(value.cronTimer);value.cronTimer=null;const form=value.model.draft,version=++value.cronVersion;
    if(!alive(value)||!form||form.frequency!=='cron'||!form.cron.trim()){if(form){form.cronState='idle';form.cronRuns=[];}paint(value);return;}
    if(!Number.isFinite(parseStartTime(form.startAt))){form.cronState='invalid';form.cronError=port.tr('sftp:automation.invalid_start');paint(value);return;}
    form.cronState='pending';form.cronError='';paint(value);const expression=form.cron,startAt=form.startAt;
    value.cronTimer=clock.set(()=>{value.cronTimer=null;void(async()=>{
      try{const result=await request<{valid:boolean;next_runs:number[]}>(port.api,'/api/sftp/automations/cron-preview',{method:'POST',body:JSON.stringify({cron:expression,from_ms:Date.now(),start_at_ms:parseStartTime(startAt)})});
        if(!alive(value)||value.cronVersion!==version||value.model.draft!==form||form.cron!==expression||form.startAt!==startAt)return;form.cronState=result.valid?'valid':'invalid';form.cronRuns=Array.isArray(result.next_runs)?result.next_runs:[];
      }catch(error){if(alive(value)&&value.cronVersion===version&&value.model.draft===form){form.cronState='invalid';form.cronError=errorMessage(error,port.tr('sftp:automation.cron_invalid'));}}
      finally{if(alive(value)&&value.cronVersion===version)paint(value);}
    })();},250);
  }
  async function save(value:Owner){
    const model=value.model,form=model.draft;if(!alive(value)||!form||model.busy.size||model.picker)return false;
    if(!form.name.trim()||!positive(form.connectionId)||!remotePath(form.localPath)||!remotePath(form.remotePath)){model.error=port.tr('sftp:automation.required_fields');paint(value);return false;}
    if(form.frequency==='cron'&&form.cronState!=='valid'){model.error=port.tr('sftp:automation.cron_save_invalid');paint(value);return false;}
    if(['once','specified_time'].includes(form.frequency)&&!form.startAt||!Number.isFinite(parseStartTime(form.startAt))){model.error=port.tr('sftp:automation.invalid_start');paint(value);return false;}
    const integer=(number:number,min:number,max:number)=>Number.isSafeInteger(number)&&number>=min&&number<=max;
    const seconds=form.countdownHours*3600+form.countdownMinutes*60+form.countdownSeconds;
    if(!integer(form.interval,1,intervalMaximum(form.frequency))||!integer(form.day,1,31)||!integer(form.month,1,12)||form.frequency==='weekly'&&(!form.weekdays.length||form.weekdays.some(day=>!integer(day,0,6)))||form.frequency==='half_hour'&&(!form.slots.length||form.slots.some(slot=>!integer(slot,0,47)))||form.frequency==='countdown'&&(!integer(form.countdownHours,0,744)||!integer(form.countdownMinutes,0,59)||!integer(form.countdownSeconds,0,59)||seconds<1||seconds>2678400)){model.error=port.tr('sftp:automation.invalid_schedule');paint(value);return false;}
    const version=value.version;model.busy.add('save');model.error='';paint(value);
    try{await port.api('/api/sftp/automations'+(form.id?'/'+form.id:''),{method:form.id?'PUT':'POST',body:JSON.stringify(payload(form))});if(alive(value)&&value.version===version&&model.draft===form){port.notify(port.tr('sftp:automation.saved'),'success');await manager();}return true;}
    catch(error){if(alive(value)&&value.version===version)model.error=errorMessage(error,port.tr('sftp:automation.save_failed'));return false;}
    finally{model.busy.delete('save');paint(value);schedule(value);}
  }
  async function history(id:number,page=1){
    if(!positive(id))return false;const value=openOwner();if(!value)return false;stop(value);const version=++value.version,model=value.model;value.cronVersion++;model.view='history';model.historyId=id;model.draft=null;model.picker=null;model.confirm=null;model.loading=true;model.error='';paint(value);
    try{const result=await request<RunPage|RunPage['items']>(port.api,`/api/sftp/automations/${id}/runs?page=${Math.max(1,Math.round(page)||1)}`);if(!alive(value)||value.version!==version)return false;
      model.runs=Array.isArray(result)?{items:result,total:result.length,page:1,total_pages:1,history_limit:300}:result;return true;
    }catch(error){if(alive(value)&&value.version===version)model.error=errorMessage(error,port.tr('sftp:automation.history_load_failed'));return false;}
    finally{if(alive(value)&&value.version===version){model.loading=false;paint(value);}}
  }
  async function command(value:Owner,id:number,kind:'run'|'enable'|'pause'){
    const key='item:'+id;if(!alive(value)||!positive(id)||!['run','enable','pause'].includes(kind)||value.model.busy.has(key)||value.model.confirm)return false;stop(value);value.model.busy.add(key);value.model.error='';paint(value);const version=value.version;
    try{await port.api(`/api/sftp/automations/${id}/${kind}`,{method:'POST',body:'{}'});if(alive(value)&&value.version===version)await load(value,version);return true;}
    catch(error){if(alive(value)&&value.version===version)value.model.error=errorMessage(error,port.tr(`sftp:automation.${kind==='run'?'run_failed':'toggle_failed'}`));return false;}
    finally{value.model.busy.delete(key);paint(value);schedule(value);}
  }
  async function decide(value:Owner,accepted:boolean){const confirm=value.model.confirm;if(!alive(value)||!confirm||confirm.busy)return false;if(!accepted){value.model.confirm=null;paint(value);schedule(value);return false;}confirm.busy=true;paint(value);const version=value.version;
    try{await port.api(`/api/sftp/automations/${confirm.id}`+(confirm.kind==='clear'?'/runs':''),{method:'DELETE'});if(alive(value)&&version===value.version&&value.model.confirm===confirm){value.model.confirm=null;if(confirm.kind==='clear')await history(confirm.id,1);else await manager();}return true;}
    catch(error){if(alive(value)&&value.model.confirm===confirm){confirm.error=errorMessage(error,port.tr(`sftp:automation.${confirm.kind==='clear'?'clear_history_failed':'delete_failed'}`));confirm.busy=false;paint(value);}return false;}
  }
  async function limitHistory(value:Owner,limit:number){if(!alive(value)||value.model.busy.has('limit')||!Number.isSafeInteger(limit)||limit<100||limit>5000)return false;value.model.busy.add('limit');paint(value);const version=value.version,id=value.model.historyId;
    try{await port.api(`/api/sftp/automations/${id}/history-settings`,{method:'POST',body:JSON.stringify({history_limit:limit})});if(alive(value)&&version===value.version)await history(id,1);return true;}
    catch(error){if(alive(value)&&version===value.version)value.model.error=errorMessage(error,port.tr('sftp:automation.history_limit_failed'));return false;}
    finally{value.model.busy.delete('limit');paint(value);}
  }
  async function reorder(value:Owner,ids:number[]){const model=value.model;if(!alive(value)||model.sortBusy||model.busy.size||ids.length!==model.items.length||new Set(ids).size!==ids.length||ids.some(id=>!positive(id)||!model.items.some(item=>item.id===id)))return false;stop(value);model.sortBusy=true;const previous=model.items,version=value.version;model.items=ids.map((id,index)=>({...previous.find(item=>item.id===id)!,sort_order:index+1}));paint(value);
    try{await port.api('/api/sftp/automations/reorder',{method:'POST',body:JSON.stringify({ids})});return true;}
    catch(error){if(alive(value)&&version===value.version){model.items=previous;model.error=errorMessage(error,port.tr('sftp:automation.sort_save_failed'));}return false;}
    finally{model.sortBusy=false;paint(value);schedule(value);}
  }
  async function openLocal(value:Owner,id:number){const item=value.model.items.find(item=>item.id===id);if(!item||!alive(value)||value.model.busy.has('local:'+id))return;const version=value.version;value.model.busy.add('local:'+id);paint(value);
    try{if(port.desktop())await port.openLocal(item.local_path);else{const result=await request<{path:string}>(port.api,`/api/sftp/automations/${id}/local-directory`);if(alive(value)&&value.version===version){value.binding?.close();port.openServer(result.path);}}}
    catch(error){if(alive(value)&&version===value.version)value.model.error=errorMessage(error,port.tr('sftp:automation.open_local_failed'));}
    finally{value.model.busy.delete('local:'+id);paint(value);}
  }
  return {manager,edit,history,model:()=>owner?.model||null,actions:()=>owner?.actions||null,stopRefresh(){if(owner)stop(owner);},startRefresh(){if(owner)schedule(owner);},refresh(){if(owner)paint(owner);},dispose(){disposed=true;owner?.binding?.close();owner=null;}};
}
