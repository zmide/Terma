import {errorMessage,request} from '../operations/operations-types';
import {rows,signature,validId,type ForwardPort} from './forward-model';
import {confirmForwardPortOwners,createForwardConflictService,resolveForwardConflict,type PortDiagnosis} from './forward-conflict';
import type {Ask} from './forward-service';

export interface ForwardActionScope {
  valid():boolean;
  refresh():void;
  focus():void;
}

export interface ForwardActionPort extends Pick<ForwardPort,'api'|'tr'|'connections'|'reload'|'notify'|'repair'> {
  ask:Ask;
  capture(connectionId?:number):ForwardActionScope;
  setBusy(button:unknown,busy:boolean,text:string):void;
  diagnosisMessage(diagnosis:PortDiagnosis):string;
}

export function createForwardActions(port:ForwardActionPort){
  const busy=new Set<number>(),conflicts=createForwardConflictService(port),t=port.tr;
  const find=(id:number)=>rows(port).find(row=>row.forward.id===id);

  async function command(id:number,kind:'start'|'stop',connectionLevel=false,button?:unknown){
    if(!validId(id)||!['start','stop'].includes(kind))return false;
    const row=connectionLevel?undefined:find(id);
    const connection=connectionLevel?port.connections().find(value=>value.id===id):row?.connection;
    if(!connection||busy.has(connection.id))return false;
    const scope=port.capture(connectionLevel?connection.id:undefined);
    if(!scope.valid())return false;
    if(connectionLevel&&kind==='start'&&!connection.forwards.length){
      port.notify(t('common:notifications.connection_no_forwards'),'info');
      scope.focus();
      return false;
    }
    const original=row?{...row,connection:{...row.connection},forward:{...row.forward}}:undefined;
    const current=()=>{
      const now=find(id);
      return scope.valid()&&!!original&&!!now&&signature(now.connection,now.forward)===signature(original.connection,original.forward);
    };
    busy.add(connection.id);
    port.setBusy(button,true,t(kind==='start'?'common:auto.starting':'common:auto.stopping'));
    try{
      if(connectionLevel){
        if(kind==='start'&&!await conflicts.prepare(connection,port.ask,scope.valid))return false;
        if(!scope.valid()||!port.connections().some(value=>value.id===connection.id))return false;
      }else{
        if(!original||!current())return false;
        if(kind==='start'){
          if(!await resolveForwardConflict(port,original,scope.valid,()=>find(id),port.ask))return false;
        }else if(!current())return false;
      }
      const url=connectionLevel?`/api/connections/${id}/${kind}-forwards`:`/api/forwards/${id}/${kind}`;
      await port.api(url,{method:'POST'});
      try{
        await port.reload();
        if(scope.valid())scope.refresh();
      }catch{
        port.notify(t('connections:forward_manager.status_refresh_failed'),'error');
      }
      const message=connectionLevel
        ?kind==='start'?'common:notifications.all_forwards_started':'common:notifications.all_forwards_stopped'
        :kind==='start'?'common:notifications.forward_started_action':'common:notifications.forward_stopped_action';
      port.notify(t(message),'success');
      return true;
    }catch(error){
      await port.reload().catch(()=>{});
      port.notify(errorMessage(error,t('common:notifications.exact.forward_operation_failed')),'error');
      if(connectionLevel&&kind==='start')await port.repair(connection.id,error).catch(()=>{});
      return false;
    }finally{
      busy.delete(connection.id);
      port.setBusy(button,false,'');
      scope.focus();
    }
  }

  async function diagnose(id:number,options:{button?:unknown;silent?:boolean;offerFix?:boolean}={}){
    const row=find(id);
    if(!validId(id)||!row||busy.has(row.connection.id))return;
    const original={...row,connection:{...row.connection},forward:{...row.forward}};
    const scope=port.capture(),endpoint={host:original.forward.bind_host||'127.0.0.1',port:original.forward.bind_port};
    const current=()=>{
      const now=find(id);
      return scope.valid()&&!!now&&signature(now.connection,now.forward)===signature(original.connection,original.forward);
    };
    if(!current())return;
    busy.add(row.connection.id);
    port.setBusy(options.button,true,t('connections:forwards.diagnosing'));
    try{
      if(original.forward.mode==='remote'){
        port.notify(t('common:notifications.remote_forward_port_note'),'info');
        return {occupied:false,remote:true};
      }
      const read=()=>request<PortDiagnosis>(port.api,'/api/ports/diagnose',{method:'POST',body:JSON.stringify(endpoint)});
      let result=await read();
      if(!current())return;
      if(result.occupied&&options.offerFix&&await confirmForwardPortOwners(port,{...result,...endpoint},current,port.ask)){
        result=await read();
        if(!current())return;
        const message=port.diagnosisMessage({...result,...endpoint});
        port.notify(result.occupied?t('common:notifications.port_still_occupied',{message}):message,result.occupied?'error':'success');
        return result;
      }
      if(!current())return;
      if(!options.silent){
        const message=port.diagnosisMessage({...result,...endpoint});
        const owners=(result.processes||[]).map(process=>`${process.name||t('connections:forwards.unknown_process')} PID ${process.pid}${process.path?'\n'+process.path:''}`).join('\n');
        port.notify(result.occupied?message+'\n'+(owners||t('connections:forwards.processes_unidentified')):message,result.occupied?'error':'success');
      }
      return result;
    }finally{
      busy.delete(row.connection.id);
      port.setBusy(options.button,false,'');
    }
  }

  return {
    command,
    diagnose,
    async prepareRetry(id:number,alive:()=>boolean){
      const accepted=await conflicts.prepareForward(id,port.ask,alive);
      return {accepted,bindPort:accepted?find(id)?.forward.bind_port:undefined};
    }
  };
}

