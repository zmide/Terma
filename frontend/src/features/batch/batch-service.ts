import {errorMessage} from '../operations/operations-types';
import type {Ask} from '../forwards/forward-service';
import {connectionSignature,dangerousCommand,exportRun,matchesRun,normalizeCommand,type BatchPort,type BatchScope,type BatchRun,type CommandTemplate} from './batch-model';
export function createBatchService(port:BatchPort,scope:BatchScope,ask:Ask){
  const model={draft:{command:'',templateId:'',timeout:'60',selected:new Set<number>(port.selected()>0?[port.selected()]:[])},run:null as BatchRun|null,phase:'idle',error:'',errorKey:'',issue:null as unknown};
  let disposed=false,generation=0,changed=()=>{},socket:ReturnType<BatchPort['socket']>|null=null,off:(()=>void)[]=[];
  const alive=()=>!disposed&&scope.valid(),active=()=>alive()&&scope.active(),t=(key:string,values?:Record<string,unknown>)=>port.tr('terminal:batch.'+key,values);
  const refresh=()=>{if(alive())changed();},busy=()=>model.phase==='preparing'||!!model.run?.running;
  const cleanup=()=>{for(const remove of off)remove();off=[];const old=socket;socket=null;try{old?.close();}catch{/* Already closed. */}};
  function invalidate(){if(model.run&&!matchesRun(model.draft,model.run))model.run.invalidated=true;}
  function change(key:'command'|'templateId'|'timeout',value:string){if(busy()||!alive())return;model.draft[key]=value;invalidate();refresh();}
  function select(id:number){if(busy()||!alive()||!port.connections().some(c=>c.id===id))return;model.draft.selected.has(id)?model.draft.selected.delete(id):model.draft.selected.add(id);invalidate();refresh();}
  function selectAll(value:boolean){if(busy()||!alive())return;model.draft.selected=value?new Set(port.visibleConnections().map(c=>c.id)):new Set();invalidate();refresh();}
  function apply(template:CommandTemplate){if(busy()||!alive())return;model.draft.command=template.command;model.draft.templateId=String(template.id);invalidate();refresh();}
  function interrupt(kind:'stopped'|'disconnected'|'error'){
    const run=model.run;if(!run?.running)return;run.running=false;run.status=kind;run.finished_at=new Date().toISOString();for(const item of Object.values(run.results))if(item.ok===null)item.state=kind==='stopped'?'stopped':'disconnected';model.phase='idle';cleanup();refresh();
  }
  function receive(value:unknown,runId=model.run?.run_id){
    const run=model.run;if(!alive()||!run?.running||run.run_id!==runId||!value||typeof value!=='object')return;
    const message=value as Record<string,unknown>,id=Number(message.id),item=run.results[id];
    if(message.type==='ready')return;
    if(message.type==='meta'){const path=typeof message.log_path==='string'?message.log_path:'';if(path&&!path.startsWith('/')&&!path.includes('..')&&!/[\0\\:]/.test(path)&&path.length<4096){run.log_path=path;run.log_label=typeof message.log_label==='string'?message.log_label:'';}refresh();return;}
    if(message.type==='start'&&item){item.started=true;item.state='running';}
    else if(message.type==='data'&&item&&typeof message.data==='string')item.output+=message.data;
    else if(message.type==='exit'&&item&&typeof message.ok==='boolean'){item.ok=message.ok;item.state=message.ok?'success':'failed';item.exit_code=typeof message.exit_code==='number'&&Number.isFinite(message.exit_code)?message.exit_code:null;item.error=typeof message.error==='string'?message.error:'';item.issue=item.error?{...message}:null;item.elapsed_ms=typeof message.elapsed_ms==='number'?message.elapsed_ms:null;}
    else if(message.type==='done'){run.running=false;run.status='finished';run.finished_at=new Date().toISOString();run.ok_count=Number.isFinite(Number(message.ok))?Number(message.ok):0;run.failed_count=Number.isFinite(Number(message.failed))?Number(message.failed):0;model.phase='idle';cleanup();}
    else if(message.type==='error'){model.issue={...message};model.error=port.error(message,t('batch_failed'));interrupt('error');port.notify(model.error,'error');return;}
    refresh();
  }
  async function start(){
    if(!active()||busy())return false;const ids=[...model.draft.selected],connections=ids.map(id=>port.connections().find(c=>c.id===id));
    let command=normalizeCommand(model.draft.command);const timeout=Number(model.draft.timeout);
    model.error='';model.errorKey='';model.issue=null;
    if(!ids.length){model.errorKey='select_target_error';refresh();return false;}
    if(!command.trim()){model.errorKey='enter_command_error';refresh();return false;}
    if(connections.some(c=>!c)||ids.some(id=>!Number.isSafeInteger(id)||id<=0)){model.errorKey='targets_changed';refresh();return false;}
    if(!Number.isFinite(timeout)||timeout<5||timeout>600||command.includes('\0')||new TextEncoder().encode(JSON.stringify({ids,command,timeout_ms:timeout*1000})).length>256*1024){model.errorKey='invalid_input';refresh();return false;}
    const expected=connections.map(c=>connectionSignature(c!)),serial=++generation,current=()=>active()&&generation===serial&&ids.every((id,i)=>{const c=port.connections().find(c=>c.id===id);return !!c&&connectionSignature(c)===expected[i];});
    model.phase='preparing';model.error='';refresh();
    try{
      const lines=command.split('\n').map(v=>v.trim()).filter(Boolean),unique=[...new Set(lines)];
      if(lines.length>1&&unique.length===1){const answer=await ask({title:()=>t('repeated_command_title'),message:()=>t('repeated_command_message',{count:lines.length}),choices:[{value:'once',label:()=>t('run_once')},{value:'original',label:()=>t('run_original')},{value:'',label:()=>port.tr('common:actions.cancel')}]});if(!current()||!answer)return false;if(answer==='once')command=unique[0]!;}
      else if(lines.length>1){const answer=await ask({title:()=>t('confirm_title'),message:()=>t('multiline_message',{count:lines.length}),choices:[{value:'yes',label:()=>t('continue')},{value:'',label:()=>port.tr('common:actions.cancel')}]});if(!current()||answer!=='yes')return false;}
      if(dangerousCommand(command)){const answer=await ask({title:()=>t('dangerous_title'),message:()=>t('dangerous_message'),choices:[{value:'yes',label:()=>t('continue_run'),danger:true},{value:'',label:()=>port.tr('common:actions.cancel')}]});if(!current()||answer!=='yes')return false;}
      if(!current())return false;
      for(const id of ids){await port.api('/api/ssh/preflight',{method:'POST',body:JSON.stringify({connection_id:id})});if(!current())return false;}
      model.draft.command=command;cleanup();
      const run:BatchRun={run_id:serial,ids:[...ids],command,timeout_ms:timeout*1000,started_at:new Date().toISOString(),finished_at:null,status:'running',running:true,invalidated:false,log_path:'',log_label:'',ok_count:0,failed_count:0,results:Object.fromEntries(connections.map(c=>[c!.id,{id:c!.id,name:c!.name,host:`${c!.ssh_user}@${c!.ssh_host}:${c!.ssh_port}`,output:'',ok:null,state:'pending',started:false,exit_code:null,error:'',issue:null,elapsed_ms:null}]))};
      model.run=run;model.phase='connecting';const ws=socket=port.socket();
      const valid=()=>alive()&&model.run===run&&run.running&&socket===ws;
      off.push(ws.on('open',()=>{if(!valid())return;try{ws.send(JSON.stringify({ids,command,timeout_ms:timeout*1000}));model.phase='running';refresh();}catch(e){model.error=errorMessage(e,t('connection_failed'));interrupt('error');}}));
      off.push(ws.on('message',event=>{if(!valid())return;try{if(typeof event.data!=='string')throw Error('Invalid batch packet');receive(JSON.parse(event.data),serial);}catch{model.errorKey='connection_failed';interrupt('error');}}));
      off.push(ws.on('error',()=>{if(!valid())return;model.errorKey='connection_failed';interrupt('error');port.notify(t('connection_failed'),'error');}));
      off.push(ws.on('close',()=>{if(valid())interrupt('disconnected');}));refresh();return true;
    }catch(e){if(alive()&&generation===serial){model.issue=e;model.error=port.error(e,t('host_identity_failed'));interrupt('error');if(!(e&&typeof e==='object'&&'code'in e&&e.code==='SSH_HOST_TRUST_CANCELLED'))port.notify(model.error,'error');}return false;}
    finally{if(generation===serial&&model.phase==='preparing')model.phase='idle';refresh();}
  }
  return {model,scope,busy,active,receive,change,select,selectAll,apply,start,errorText:()=>model.errorKey?t(model.errorKey):model.issue?port.error(model.issue,t('batch_failed')):model.error,subscribe(listener:()=>void){changed=listener;},
    stop(){if(!alive())return;generation++;if(model.phase==='preparing'){model.phase='idle';refresh();}else interrupt('stopped');},
    export(format:'txt'|'json'){const run=model.run;if(!alive()||!run||run.status!=='finished'||!matchesRun(model.draft,run)){port.notify(t('no_export_results'),'info');return false;}port.download(exportRun(port,run,format),format);return true;},
    dispose(){if(disposed)return;disposed=true;generation++;cleanup();changed=()=>{};},refresh};
}
