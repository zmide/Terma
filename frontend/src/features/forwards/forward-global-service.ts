import type {Connection,ForwardPort} from './forward-model';
export interface ForwardGlobalPort extends Pick<ForwardPort,'api'|'tr'|'connections'|'reload'|'notify'>{prepare(connection:Connection):Promise<boolean>;setBusy(button:unknown,busy:boolean,text:string):void}
export interface ForwardGlobalResult {success:number;failed:number}
export function createForwardGlobalService(port:ForwardGlobalPort){
  let busy=false;
  const find=(id:number)=>port.connections().find(connection=>connection.id===id);
  const hasStoppable=(connection:Connection)=>connection.forwards.some(forward=>String(forward.status||'stopped')!=='stopped'||Boolean(Number(forward.pid||0))||Boolean(Number(forward.restore||0)));
  async function run(kind:'start'|'stop',button?:unknown){
    if(busy)return false;busy=true;const targets=port.connections().filter(connection=>kind==='start'?connection.forwards.length>0:hasStoppable(connection)).map(connection=>({id:connection.id,name:connection.name}));
    port.setBusy(button,true,port.tr(kind==='start'?'common:auto.starting':'common:auto.stopping'));
    try{
      if(!targets.length){port.notify(port.tr(kind==='start'?'common:notifications.exact.no_startable_forwards':'common:notifications.exact.no_stoppable_forwards'),'info');return true;}
      const result:ForwardGlobalResult={success:0,failed:0};
      for(const target of targets){
        try{
          const connection=find(target.id);if(!connection){result.failed++;continue;}
          if(kind==='start'&&!await port.prepare(connection)){result.failed++;continue;}
          await port.api(`/api/connections/${target.id}/${kind==='start'?'start':'stop'}-forwards`,{method:'POST'});result.success++;
        }catch(error){result.failed++;if(kind==='start')port.notify(port.tr('connections:forwards.connection_start_failed',{name:target.name,error:error instanceof Error?error.message:String(error),defaultValue:`${target.name} failed to start forwarding: ${error instanceof Error?error.message:String(error)}`}),'error');}
      }
      await port.reload();port.notify(port.tr(kind==='start'?'common:notifications.all_forwards_result':'common:notifications.stop_forwards_result',{success:result.success,failed:result.failed}),result.failed?'error':'success');return true;
    }finally{busy=false;port.setBusy(button,false,'');}
  }
  async function restore(){if(busy)return false;busy=true;try{const result=await port.api('/api/forwards/restore',{method:'POST'}) as {ok?:number;failed?:number};await port.reload();port.notify(port.tr('common:notifications.restore_forwards_result',{success:result.ok||0,failed:result.failed||0}),result.failed?'error':'success');return true;}catch(error){port.notify(error instanceof Error?error.message:String(error),'error');return false;}finally{busy=false;}}
  return {get busy(){return busy;},startAll:(button?:unknown)=>run('start',button),stopAll:(button?:unknown)=>run('stop',button),restore};
}
