import type {AssistantState,Context} from './assistant-model';
import type {ApprovalRequest} from './execution-service';
import type {createTaskService,TaskStep} from './task-service';
import type {McpCall,McpResult} from './mcp-service';
import {terminalAiCommandReview} from './command-review';
import {terminalAiRedactAttachment} from './response-text';
import {terminalAiTaskRecoveryPrompt} from './task-presentation';

interface Options {signal?:AbortSignal;index?:number;total?:number}
export interface TaskActionInput extends Partial<TaskStep> {checkpoint?:boolean;checkpointReason?:string}
export interface TerminalTarget {key:string;title:string;host:string;user:string;status:string}
export interface TaskWorkflowPort {
  state(key:string):AssistantState;
  has(key:string):boolean;
  tasks:ReturnType<typeof createTaskService>;
  scope(key:string):()=>boolean;
  settings():Record<string,unknown>;
  approve(key:string,request:ApprovalRequest):Promise<boolean>;
  call(call:McpCall,signal?:AbortSignal):Promise<McpResult>;
  contexts(key:string):Context[];
  targets():TerminalTarget[];
  commandBusy(key:string):boolean;
  submit(key:string,prompt:string,contexts:Context[],options:Record<string,unknown>):Promise<unknown>;
  persist(key:string,state:AssistantState):void;
  render(key:string):void;
  notify(message:string,kind:'info'):void;
  tr(key:string,params?:Record<string,unknown>):string;
}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function createTaskWorkflow(port:TaskWorkflowPort) {
  function capture(key:string,signal?:AbortSignal) {
    const state=port.state(key),session=state.sessionId,request=state.requestId,scope=port.scope(key);
    return {state,current:()=>port.has(key)&&port.state(key)===state&&state.sessionId===session&&state.requestId===request&&!signal?.aborted&&scope()};
  }
  function prepare(key:string,taskId:string,input:TaskActionInput={}) {
    const step=port.tasks.prepareAction(key,taskId,input);
    if(step&&input.checkpoint===true) {
      const command=input.command||input.label||'',reason=input.checkpointReason||input.risk||'';
      const review=terminalAiCommandReview(command,{safe:false,reason},{checkpointId:step.id});
      const checkpoint=port.tasks.checkpoint(key,taskId,command,{...review,reason});
      if(checkpoint)port.tasks.updateStep(key,taskId,step.id,{checkpointId:checkpoint.id});
    }
    return step;
  }
  function configured(call:McpCall) {
    const servers=port.settings().mcp_servers;
    const server=Array.isArray(servers)?servers.map(record).find(item=>String(item.id)===call.server):undefined;
    const tool=Array.isArray(server?.tools)?server.tools.map(record).find(item=>String(item.name)===call.tool):undefined;
    return server&&server.enabled!==false&&tool&&tool.enabled!==false?{server,tool,stamp:JSON.stringify(server)}:null;
  }
  async function executeMcp(key:string,call:McpCall,options:Options={}) {
    const {state,current}=capture(key,options.signal);
    const denied=(unsupported=false):McpResult=>({called:false,denied:true,unsupported,output:'',server:call.server,tool:call.tool});
    const allowed=()=>current()&&state.mode!=='chat'&&state.permission!=='suggest'&&!state.agentWaitingForInput;
    if(!allowed()||state.pendingApproval)return denied();
    const initial=configured(call);
    if(!initial)return denied(true);
    if(initial.tool.requires_approval!==false) {
      const approved=await port.approve(key,{
        command:`MCP ${call.server}.${call.tool}\n${JSON.stringify(call.arguments||{},null,2)}`,
        kind:'mcp',server:call.server,tool:call.tool,arguments:call.arguments,
        reason:port.tr('terminal:ai.mcp_approval_reason',{defaultValue:'MCP 工具可访问外部服务或修改数据，需要确认'}),
        index:Math.max(1,Number(options.index)||1),total:Math.max(1,Number(options.total)||1)
      });
      if(!approved)return denied();
    }
    if(!allowed()||state.pendingApproval||configured(call)?.stamp!==initial.stamp)return denied();
    const result=await port.call(call,options.signal);
    return current()?{...result,output:terminalAiRedactAttachment(JSON.stringify(result,null,2))}:denied();
  }
  async function runMcp(key:string,taskId:string,call:McpCall,options:Options={}) {
    const {current}=capture(key,options.signal),task=port.tasks.task(key,taskId);
    const result={kind:'mcp',server:call.server,tool:call.tool,arguments:call.arguments||{},output:'',status:port.tr('terminal:ai.agent_not_executed',{defaultValue:'未执行'})};
    if(!current())return result;
    const reason=port.tr('terminal:ai.mcp_approval_reason',{defaultValue:'MCP 工具可能访问外部服务或修改数据'});
    const step=prepare(key,taskId,{kind:'mcp',label:`MCP ${call.server}.${call.tool}`,status:'pending',risk:reason,checkpoint:true,checkpointReason:reason});
    let execution:McpResult|null=null;
    try {
      execution=await executeMcp(key,call,options);
      result.output=execution.output||'';
      result.status=execution.unsupported?port.tr('terminal:ai.mcp_unsupported',{tool:call.tool,defaultValue:`未执行：未发现或未启用工具 ${call.tool}`}):execution.called?port.tr('terminal:ai.completed',{defaultValue:'已完成'}):execution.denied?port.tr('terminal:ai.agent_denied',{defaultValue:'用户拒绝执行'}):result.status;
    } catch(error) {
      result.status=error instanceof Error?error.message:port.tr('terminal:ai.agent_not_executed',{defaultValue:'未执行'});
    }
    if(current()&&port.tasks.task(key,taskId)===task)port.tasks.completeAction(key,taskId,step,execution?.called?'success':execution?.denied?'needs-confirmation':'failed',execution?.called?'':result.status);
    return result;
  }
  function resume(key:string,taskId:string) {
    const state=port.tasks.ensureState(port.state(key)),task=port.tasks.task(key,taskId);
    if(!task||state.busy||state.mode==='chat'||!['failed','stopped','waiting'].includes(task.status))return;
    if(port.commandBusy(key)) {
      port.notify(port.tr('terminal:ai.command_busy',{defaultValue:'上一条 Agent 命令仍在执行，已等待终端返回提示符'}),'info');
      return;
    }
    task.status='running';task.error='';state.agentWaitingForInput=null;state.activeTaskId=task.id;
    port.persist(key,state);port.render(key);
    return port.submit(key,terminalAiTaskRecoveryPrompt(task),port.contexts(key),{agentTask:true,taskId:task.id,resume:true,displayPrompt:task.prompt});
  }
  function targetContexts(activeKey=''):Context[] {
    const terminals=port.targets().filter(item=>item.key).slice(0,32);
    if(terminals.length<2)return [];
    const current=port.tr('terminal:ai.agent_current_target',{defaultValue:'当前'}),unknown=port.tr('terminal:ai.agent_unknown_host',{defaultValue:'未识别主机'});
    const lines=terminals.map(item=>`- ${item.key===activeKey?`[${current}] `:''}${item.title} · ${item.user?`${item.user}@`:''}${item.host||unknown} · ${item.status}`).join('\n');
    return [{source:'terminal-targets',title:port.tr('terminal:ai.agent_targets_title',{defaultValue:'可用终端目标'}),text:port.tr('terminal:ai.agent_targets_hint',{defaultValue:'当前工作区有多个终端。涉及多主机时先说明目标和主机差异；没有明确授权时不要向多个主机执行写操作。'})+'\n'+lines}];
  }
  return {prepare,executeMcp,runMcp,resume,targetContexts};
}
