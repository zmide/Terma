import type {AssistantState} from './assistant-model';

export interface TerminalExecution {sent:boolean;blockId?:string;command?:string;error?:string;denied?:boolean;sessionEnded?:boolean;syntaxError?:boolean;[key:string]:unknown}
export interface TerminalCompletion {output?:string;waitingForInput?:boolean;timedOutAt?:number;exitCode?:number;sessionEndedAt?:number;[key:string]:unknown}
export interface TerminalActionPort {
  state(key:string):AssistantState;
  execute(key:string,command:string,options:Record<string,unknown>):Promise<TerminalExecution>;
  wait(key:string,blockId:string,signal?:AbortSignal):Promise<TerminalCompletion|null>;
  stop(key:string):void;
  changed(key:string):void;
}
export interface TerminalActionResult {execution:TerminalExecution;completion:TerminalCompletion|null;status:'sent'|'failed'|'waiting'|'completed'|'cancelled'}
export function createTerminalActionService(port:TerminalActionPort){
  const active=new Map<string,string>();
  async function run(key:string,command:string,options:Record<string,unknown>={}):Promise<TerminalActionResult>{
    if(active.has(key))return {execution:{sent:false,command,error:'busy'},completion:null,status:'failed'};
    if(!String(command||'').trim())return {execution:{sent:false,command,error:'empty-command'},completion:null,status:'failed'};
    const token=`${String(options.taskId||'')}:${String(command).slice(0,100000)}`;active.set(key,token);port.changed(key);
    try{
      const execution=await port.execute(key,command,options);
      if(!execution?.sent)return {execution:execution||{sent:false,command},completion:null,status:'failed'};
      if(!execution.blockId)return {execution,completion:null,status:'sent'};
      const completion=await port.wait(key,String(execution.blockId),options.signal as AbortSignal|undefined);
      if(!completion)return {execution,completion:null,status:'cancelled'};
      return {execution,completion,status:completion.waitingForInput||completion.timedOutAt?'waiting':'completed'};
    }finally{if(active.get(key)===token){active.delete(key);port.changed(key);}}
  }
  function stop(key:string){active.delete(key);port.stop(key);port.changed(key);}
  function busy(key:string){return active.has(key);}
  function dispose(key:string){active.delete(key);}
  return {run,stop,busy,dispose,disposeAll(){active.clear();}};
}
