import type {AssistantState} from './assistant-model';
import type {TaskCheckpoint,TaskRecord} from './task-service';

export interface CheckpointResult {output:string;waitingForInput?:boolean;timedOutAt?:number;exitCode?:number}
export interface CheckpointPort {
  state(key:string):AssistantState;
  scope(key:string):()=>boolean;
  now():number;
  persist(key:string,state:AssistantState):void;
  changed(key:string):void;
  render(key:string):void;
  notify(key:string,message:string,level:'error'|'info'|'success'):void;
  send(key:string,command:string,signal?:AbortSignal):Promise<{sent:boolean;blockId:string}>;
  rollback(key:string,command:string,taskId:string,signal?:AbortSignal):Promise<{sent:boolean;blockId:string}>;
  wait(key:string,blockId:string,signal?:AbortSignal):Promise<CheckpointResult|null>;
}
function recordFor(state:AssistantState,taskId:string):TaskRecord|null{return(Array.isArray(state.agentTasks)?state.agentTasks:[]).find((item:any)=>String(item?.id)===String(taskId)) as TaskRecord|null||null;}
function checkpointFor(state:AssistantState,taskId:string,id:string):TaskCheckpoint|null{return recordFor(state,taskId)?.checkpoints?.find(item=>String(item.id)===String(id))||null;}
export function createCheckpointService(port:CheckpointPort){
  const running=new WeakSet<TaskCheckpoint>();
  async function run(key:string,taskId:string,checkpointId:string,kind:'backup'|'rollback',signal?:AbortSignal){
    const state=port.state(key),checkpoint=checkpointFor(state,taskId,checkpointId);if(!checkpoint)return false;
    const command=kind==='backup'?checkpoint.backupCommand:checkpoint.rollbackCommand;
    const currentStatus=kind==='backup'?checkpoint.backupStatus:checkpoint.rollbackStatus;
    const sessionId=state.sessionId,scope=port.scope(key);
    const current=()=>!signal?.aborted&&scope()&&port.state(key)===state&&state.sessionId===sessionId
      &&checkpointFor(state,taskId,checkpointId)===checkpoint
      &&(kind==='backup'?checkpoint.backupCommand:checkpoint.rollbackCommand)===command;
    if(!current()||running.has(checkpoint))return false;
    if(!command)return kind==='backup'&&['unavailable','sensitive-skipped','unsafe-skipped','none'].includes(currentStatus);
    if(kind==='rollback'&&(checkpoint.backupStatus!=='ready'||checkpoint.verified!==true))return false;
    if(kind==='backup'&&currentStatus==='ready'&&checkpoint.verified===true||kind==='rollback'&&currentStatus==='success')return true;
    const persist=()=>{checkpoint.updatedAt=port.now();port.persist(key,state);port.changed(key);if(state.open)port.render(key);};
    const failed=(message:string)=>{
      if(!current())return false;
      if(kind==='backup'){checkpoint.backupStatus='failed';checkpoint.verified=false;}else checkpoint.rollbackStatus='failed';
      checkpoint.error=message.slice(-400);persist();
      port.notify(key,kind==='backup'?'terminal:ai.task_checkpoint_failed':'terminal:ai.task_rollback_failed','error');return false;
    };
    running.add(checkpoint);
    if(kind==='backup'){checkpoint.backupStatus='running';checkpoint.verified=false;}else checkpoint.rollbackStatus='running';
    persist();
    try{
      const sent=await(kind==='backup'?port.send(key,command,signal):port.rollback(key,command,taskId,signal));
      if(!current())return false;
      if(!sent.sent||!sent.blockId)return failed('send-failed');
      const result=await port.wait(key,sent.blockId,signal);
      if(!current())return false;
      if(!result||result.waitingForInput||result.timedOutAt||result.exitCode!==undefined&&result.exitCode!==0)return failed(String(result?.output||`${kind}-failed`));
      checkpoint.error='';
      if(kind==='backup'){checkpoint.backupStatus='ready';checkpoint.verified=true;checkpoint.backupFinishedAt=port.now();}
      else{checkpoint.rollbackStatus='success';checkpoint.rollbackVerifiedAt=port.now();}
      persist();return true;
    }catch(error){return failed(error instanceof Error?error.message:String(error));}
    finally{running.delete(checkpoint);}
  }
  return {backup:(key:string,taskId:string,checkpointId:string,signal?:AbortSignal)=>run(key,taskId,checkpointId,'backup',signal),rollback:(key:string,taskId:string,checkpointId:string,signal?:AbortSignal)=>run(key,taskId,checkpointId,'rollback',signal)};
}
