import {translate as tr} from '../../shared/i18n/runtime';
import {terminalAiCommandFromCodeBlock} from './response-commands';
import {terminalAiStripControl} from './response-text';
import {terminalAiCommandReview} from './command-review';
import type {createConversationService} from './conversation-service';
import type {createExecutionService} from './execution-service';
import type {createRequestWorkflow} from './request-workflow';
import type {CommandOptions,CommandRisk,CommandSession,WaitingInput} from './terminal-command-service';

export interface InteractionPort {
  service:ReturnType<typeof createConversationService>;
  execution:ReturnType<typeof createExecutionService>;
  request:ReturnType<typeof createRequestWorkflow>;
  render(key:string):void;
  current(session:CommandSession):boolean;
  send(key:string,value:string,options:{trackCommand:boolean;focus?:boolean}):boolean;
  resume(key:string,waiting:WaitingInput,baseline:string):void;
  notify(message:string,level:'success'):void;
  now():number;
}

export function createAssistantInteractions(port:InteractionPort) {
  async function askBlock(key:string,blockId='',action='explain') {
    const state=port.service.state(key),block=state.blocks.find(item=>item.id===String(blockId));
    if (!block) return;
    state.selectedBlockId=block.id;
    const prompts={
      explain:tr('terminal:ai.explain_prompt'),
      summarize:tr('terminal:ai.summarize_prompt'),
      fix:tr('terminal:ai.fix_prompt'),
      continue:tr('terminal:ai.continue_prompt')
    };
    const prompt=prompts[action as keyof typeof prompts]||prompts.explain;
    state.open=true;
    port.render(key);
    return port.request.submit(key,prompt,[{source:'terminal-block',title:block.command,text:`$ ${block.command}\n${terminalAiStripControl(block.output||'')}`}],{agentTask:false});
  }

  function approve(key:string,command:string,risk:CommandRisk,options:CommandOptions={}) {
    const mcp=risk.kind==='mcp';
    return port.execution.requestApproval(key,{
      command:String(command||''),kind:mcp?'mcp':'command',
      server:String(risk.server||''),tool:String(risk.tool||''),
      arguments:risk.arguments&&typeof risk.arguments==='object'?risk.arguments as Record<string,unknown>:null,
      reason:String(risk.reason||''),
      review:risk.review&&typeof risk.review==='object'?risk.review as Record<string,unknown>:mcp?null:terminalAiCommandReview(command,risk,{checkpointId:options.checkpointId}),
      index:Math.max(1,Number((options as Record<string,unknown>).index||1)),
      total:Math.max(1,Number((options as Record<string,unknown>).total||1))
    });
  }

  function insert(key:string,command:string) {
    const value=terminalAiCommandFromCodeBlock(command);
    if (!value||!port.send(key,value,{trackCommand:false})) return false;
    port.notify(tr('terminal:ai.inserted'),'success');
    return true;
  }

  function insertPending(key:string) {
    if (!port.service.has(key)) return false;
    const state=port.service.state(key),approval=state.pendingApproval as {kind?:string;command?:string}|null;
    if (!approval?.command||approval.kind==='mcp'||state.mode==='chat'||!port.execution.pendingCurrent(key)) return false;
    const value=terminalAiCommandFromCodeBlock(approval.command);
    if (!value||!port.send(key,value,{trackCommand:false,focus:true})) return false;
    port.execution.settleApproval(key,false);
    port.notify(tr('terminal:ai.approval_inserted'),'success');
    return true;
  }

  function resolveWaiting(session:CommandSession,input:string) {
    const key=session.key;
    if (!key||session.sensitiveInput||!String(input||'').trim()||!port.current(session)||!port.service.has(key)) return false;
    const state=port.service.state(key),waiting=state.agentWaitingForInput as WaitingInput|null;
    if (!waiting||String(waiting.blockId||'')!==String(session.aiActiveBlockId||'')) return false;
    const block=state.blocks.find(item=>item.id===waiting.blockId),baseline=String(block?.output||'');
    if (block) {
      block.waitingForInput=false;
      block.inputProvidedAt=port.now();
      block.inputProvided=String(input).slice(0,200);
    }
    state.agentWaitingForInput=null;
    port.service.persist(key,state);
    if (state.open) port.render(key);
    if (waiting.taskId) port.resume(key,waiting,baseline);
    return true;
  }

  return {askBlock,approve,insert,insertPending,resolveWaiting,settle:port.execution.settleApproval};
}
