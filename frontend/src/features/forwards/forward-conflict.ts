import {request} from '../operations/operations-types';
import {payload,draft,rows,signature,type Connection,type ForwardPort,type Row} from './forward-model';
import type {Ask} from './forward-service';
export type ForwardConflictPort=Pick<ForwardPort,'api'|'tr'|'connections'|'reload'>;
export interface PortDiagnosis {
  occupied:boolean;host?:string;port?:number;remote?:boolean;
  processes?:{pid:number;name?:string;path?:string}[];
}

export async function confirmForwardPortOwners(port:Pick<ForwardPort,'api'|'tr'>,diagnosis:PortDiagnosis,alive:()=>boolean,ask:Ask){
  const endpoint={host:diagnosis.host,port:diagnosis.port};
  const processes=(diagnosis.processes||[]).map(process=>({...process})),t=port.tr;
  if(!alive()||!processes.length||!endpoint.host||typeof endpoint.port!=='number'||!Number.isSafeInteger(endpoint.port)||endpoint.port<1||endpoint.port>65535)return false;
  const owners=processes.map(process=>`${process.name||t('connections:forwards.unknown_process')} PID ${process.pid}${process.path?'\n'+process.path:''}`).join('\n');
  const general=await ask({title:()=>t('connections:forwards.close_owners_title'),message:()=>owners+'\n\n'+t('connections:forwards.close_owners_question'),choices:[{value:'yes',label:()=>t('connections:forwards.try_close'),danger:true},{value:'',label:()=>t('common:actions.cancel')}]});
  if(general!=='yes'||!alive())return false;
  for(const process of processes){
    if(!Number.isSafeInteger(process.pid)||process.pid<=0)continue;
    const confirmed=await ask({title:()=>t('connections:forwards.close_process_title'),message:()=>t('connections:forwards.close_process_confirm',{name:process.name||t('connections:forwards.unknown_process'),pid:process.pid}),choices:[{value:'yes',label:()=>t('connections:forwards.close_process_action'),danger:true},{value:'',label:()=>t('connections:forwards.skip')}]});
    if(!alive())return false;
    if(confirmed!=='yes')continue;
    await port.api('/api/ports/kill',{method:'POST',body:JSON.stringify({pid:process.pid,...endpoint})});
    if(!alive())return false;
  }
  return true;
}

/** Every process action remains bound to the diagnosed endpoint and an explicit PID confirmation. */
export async function resolveForwardConflict(port:ForwardConflictPort,original:Row,alive:()=>boolean,find:()=>Row|undefined,ask:Ask){
  if(original.forward.mode==='remote')return true;
  const t=port.tr,snapshot={...original,connection:{...original.connection},forward:{...original.forward}};let expected=signature(snapshot.connection,snapshot.forward);
  const current=()=>{const row=find();return alive()&&!!row&&signature(row.connection,row.forward)===expected;};
  const endpoint={host:snapshot.forward.bind_host||'127.0.0.1',port:snapshot.forward.bind_port};
  const diagnose=()=>request<{occupied:boolean;processes?:{pid:number;name?:string;path?:string}[]}>(port.api,'/api/ports/diagnose',{method:'POST',body:JSON.stringify(endpoint)});
  let result=await diagnose();if(!current())return false;if(!result.occupied)return true;
  const owners=(result.processes||[]).map(p=>`${p.name||t('connections:forwards.unknown_process')} PID ${p.pid}${p.path?'\n'+p.path:''}`).join('\n');
  const choice=await ask({title:()=>t('connections:forwards.port_conflict_handling'),message:()=>t('connections:forwards.port_occupied',{owners:owners||t('connections:forwards.processes_unidentified')}),choices:[{value:'kill',label:()=>t('navigation:menus.forward_try_close_owner'),danger:true},{value:'recommend',label:()=>t('navigation:menus.forward_use_recommended_port')},{value:'',label:()=>t('common:actions.cancel')}]});
  if(!choice||!current())return false;
  if(choice==='kill'){
    if(!await confirmForwardPortOwners(port,{...result,...endpoint},current,ask))return false;
  }else if(choice==='recommend'){
    const result=await request<{recommended_port:number}>(port.api,'/api/ports/recommend',{method:'POST',body:JSON.stringify(endpoint)}),bindPort=result.recommended_port;
    if(!current()||!Number.isSafeInteger(bindPort)||bindPort<1||bindPort>65535)return false;
    const answer=await ask({title:()=>t('connections:forwards.port_conflict_title'),message:()=>t('common:notifications.recommended_port',{port:bindPort}),choices:[{value:'yes',label:()=>t('navigation:menus.forward_save_recommended',{port:bindPort})},{value:'',label:()=>t('common:actions.cancel')}]});
    if(answer!=='yes'||!current())return false;
    await port.api(`/api/forwards/${snapshot.forward.id}`,{method:'PUT',body:JSON.stringify({...payload(draft(snapshot.connection.id,snapshot.forward),t),bind_port:bindPort})});
    expected=signature(snapshot.connection,{...snapshot.forward,bind_port:bindPort});endpoint.port=bindPort;await port.reload();if(!current())return false;
  }
  result=await diagnose();return current()&&!result.occupied;
}

export function createForwardConflictService(port:ForwardConflictPort){
  const find=(id:number)=>rows(port).find(row=>row.forward.id===id);
  async function prepareForward(id:number,ask:Ask,alive=()=>true){
    const original=find(id);
    return !!original&&await resolveForwardConflict(port,original,alive,()=>find(id),ask);
  }
  async function prepare(connection:Connection,ask:Ask,alive=()=>true){
    const captured=connection.forwards.map(forward=>({...forward}));
    const expected=new Map(captured.map(forward=>[forward.id,signature(connection,forward)]));
    const current=(exceptId=0)=>{
      const now=port.connections().find(value=>value.id===connection.id);
      return alive()&&!!now&&now.forwards.length===captured.length&&now.forwards.every(forward=>expected.has(forward.id)&&(forward.id===exceptId||expected.get(forward.id)===signature(now,forward)));
    };
    for(const forward of captured.filter(value=>value.status!=='running'&&['local','socks'].includes(value.mode))){
      if(!current()||!await prepareForward(forward.id,ask,()=>current(forward.id)))return false;
      const next=find(forward.id);
      if(!next)return false;
      expected.set(forward.id,signature(next.connection,next.forward));
    }
    return current();
  }
  return {prepare,prepareForward};
}

