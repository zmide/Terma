import {translate as tr} from '../../shared/i18n/runtime';
import {terminalAiCommandRisk} from './command-review';
import {terminalAiResponseCommands} from './response-commands';
import type {AssistantState,Context} from './assistant-model';
import type {ActionStatus} from './action-service';
import type {RequestPort,RequestResult} from './request-workflow';
type ResponseTools=RequestPort['tools'];
type QueuePort=Pick<RequestPort,'tasks'|'taskWorkflow'|'actions'|'terminalActions'|'tracker'|'tools'|'render'|'now'>;
export interface RequestRound {signal:AbortSignal;key:string;state:AssistantState;current():boolean;taskId:string;originalPrompt:string;currentContexts:Context[];executedCommands:Set<string>;executedCommandResults:Map<string,RequestResult>}
export function createRequestActionQueue(port:QueuePort,context:RequestRound) {
 const {key,state,current,taskId,originalPrompt,currentContexts,executedCommands,executedCommandResults}=context;
 const controller={signal:context.signal};
const seenCommands = new Set<string>(); let repeatedCommand = ""; let repeatedResult:RequestResult|null = null; let repeatedNotice = "";
const seenMcpCalls = new Set();
const results:RequestResult[] = [];
let commandIndex = 0;
let commandRunner = Promise.resolve();
const enqueueCommands = (commands:string[]) => {
  if (!current() || state.permission === "suggest") return true;
  for (const command of (Array.isArray(commands) ? commands : [])) {
    const normalized = String(command || "").trim();
    if (!normalized || seenCommands.has(normalized)) continue;
    seenCommands.add(normalized);
    const index = ++commandIndex;
    const plannedRisk = terminalAiCommandRisk(normalized, {userPrompt:originalPrompt});
    const taskStep = port.taskWorkflow.prepare(key, taskId, {kind:"command", command:normalized, status:"pending", risk:plannedRisk.reason, checkpoint:!plannedRisk.safe});
    state.agentQueue.push(normalized);
    commandRunner = commandRunner.then(async () => {
      let resultEntry:RequestResult = {command:normalized, output:"", status:tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"})};
      let actionLease:ReturnType<RequestPort["actions"]["begin"]>|null = null;
      let actionStatus:ActionStatus = "running";
      try {
        if (!current()) return;
        const actionApi = port.actions;
        actionLease = actionApi.begin(key, {kind:"command", taskId, label:normalized, command:normalized}) || null;
        if (actionLease && !actionLease.accepted) {
          repeatedCommand = normalized;
          repeatedNotice = tr("terminal:ai.agent_repeated", {defaultValue:"检测到重复命令，已跳过本次执行并准备总结。"});
          repeatedResult = executedCommandResults.get(normalized) || null;
          resultEntry.status = repeatedNotice;
          resultEntry.duplicate = true;
          actionStatus = "skipped";
          actionLease = null;
          port.tasks.completeAction(key, taskId, taskStep, "skipped", resultEntry.status);
          return;
        }
        const risk = plannedRisk;
        const automatic = state.permission === "full" || (state.permission === "controlled" && risk.safe);

        if (executedCommands.has(normalized)) {
          repeatedCommand = normalized;
          repeatedNotice = tr("terminal:ai.agent_repeated", {defaultValue:"检测到重复命令，已跳过本次执行并准备总结。"});
          repeatedResult = executedCommandResults.get(normalized) || null;
          resultEntry.status = repeatedNotice;
          resultEntry.duplicate = true;
          port.tasks.completeAction(key, taskId, taskStep, "skipped", resultEntry.status);
          return;
        }
        executedCommands.add(normalized);
        const actionOptions = {auto:automatic, details:true, risk, taskId, checkpointId:taskStep?.checkpointId || "", signal:controller.signal, userPrompt:originalPrompt, index, total:Math.max(index, state.agentQueue.length)};
        const actionRun = await port.terminalActions.run(key, normalized, actionOptions);
        if(!current())return;
        const execution = actionRun.execution;
        if (!execution?.sent) {
          resultEntry.status = execution?.error || (execution?.denied ? tr("terminal:ai.agent_denied", {defaultValue:"用户拒绝执行"}) : tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"}));
          actionStatus = "failed";
          resultEntry.sessionEnded = Boolean(execution?.sessionEnded);
          resultEntry.syntaxError = Boolean(execution?.syntaxError);
          port.tasks.completeAction(key, taskId, taskStep, execution?.denied ? "needs-confirmation" : "failed", resultEntry.status);
        } else if (!execution.blockId) {
          resultEntry.status = tr("terminal:ai.agent_capture_missing", {defaultValue:"命令已发送但未捕获输出"});
          actionStatus = "failed";
          port.tasks.completeAction(key, taskId, taskStep, "failed", resultEntry.status);
        } else {
          const completed = actionRun.completion;
          if (completed) {
            const status = completed.waitingForInput
              ? tr("terminal:ai.waiting_input", {defaultValue:"等待终端输入，已暂停自动操作"})
              : completed.timedOutAt
                ? tr("terminal:ai.timed_out_paused", {defaultValue:"等待命令完成超时，Agent 已暂停；确认终端命令结束后再继续任务"})
                : completed.exitCode && completed.exitCode !== 0
                  ? tr("terminal:ai.agent_exit_code", {code:completed.exitCode, defaultValue:`退出码 ${completed.exitCode}`})
                  : tr("terminal:ai.completed", {defaultValue:"已完成"});
            resultEntry = {command:execution.command || normalized, output:completed.output || "", status, waitingForInput:Boolean(completed.waitingForInput), incomplete:Boolean(completed.timedOutAt), sessionEnded:Boolean(completed.sessionEndedAt)};
            executedCommandResults.set(normalized, resultEntry);
            const taskStepStatus = completed.waitingForInput || completed.timedOutAt
              ? "waiting"
              : (completed.timedOutAt || (completed.exitCode && completed.exitCode !== 0) ? "failed" : "success");
            actionStatus = taskStepStatus;
            port.tasks.completeAction(key, taskId, taskStep, taskStepStatus, taskStepStatus === "success" ? "" : status);
            if (completed.waitingForInput) {
              const block=state.blocks.find(item=>item.id===execution.blockId);
              if(block)port.tracker.waiting(key, block, {taskId, originalPrompt, contexts:currentContexts});
            }
            if (completed.timedOutAt) {
              const task = port.tasks.forState(state, taskId);
              if (task) {
                task.status = "waiting";
                task.error = status;
                task.updatedAt = port.now();
              }
            }
          }
          else actionStatus = "failed";
        }
      } catch (error) {
        if(!current())return;
        resultEntry.status = String((error instanceof Error ? error.message : "") || tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"}));
        actionStatus = "failed";
        port.tasks.completeAction(key, taskId, taskStep, "failed", resultEntry.status);
      } finally {
        if(current()){
        results.push(resultEntry);
        if (actionLease?.record) port.actions.finish(key, actionLease.record.id, actionStatus, {output:String(resultEntry.output || ""), error:actionStatus === "failed" ? String(resultEntry.status || "") : ""});
        const queueIndex = state.agentQueue.indexOf(normalized);
        if (queueIndex >= 0) state.agentQueue.splice(queueIndex, 1);
        port.render(key);
        }
      }
    });
    // One model turn produces at most one terminal action. Real output is
    // returned before the model is allowed to choose the next command.
    return false;
  }
  return true;
};
const enqueueMcpCalls = (calls:ReturnType<ResponseTools["terminalAiResponseMcpCalls"]>) => {
  if (!current() || state.permission === "suggest") return true;
  for (const call of (Array.isArray(calls) ? calls : [])) {
    if (!call?.key || seenMcpCalls.has(call.key)) continue;
    seenMcpCalls.add(call.key);
    const index = ++commandIndex;
    const queueLabel = "MCP " + call.server + "." + call.tool;
    const taskStep = port.taskWorkflow.prepare(key, taskId, {kind:"mcp", label:queueLabel, status:"pending", risk:tr("terminal:ai.mcp_approval_reason", {defaultValue:"MCP 工具可能访问外部服务或修改数据"}), checkpoint:true, checkpointReason:tr("terminal:ai.mcp_approval_reason", {defaultValue:"MCP 工具调用前"})});
    state.agentQueue.push(queueLabel);
    commandRunner = commandRunner.then(async () => {
      let resultEntry:RequestResult = {kind:"mcp", server:call.server, tool:call.tool, arguments:call.arguments || {}, output:"", status:tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"})};
      let actionLease:ReturnType<RequestPort["actions"]["begin"]>|null = null;
      let actionStatus:ActionStatus = "running";
      try {
        if (!current()) return;
        const actionApi = port.actions;
        actionLease = actionApi.begin(key, {kind:"mcp", taskId, label:queueLabel, server:call.server, tool:call.tool, key:call.key}) || null;
        if (actionLease && !actionLease.accepted) {
          resultEntry.status = tr("terminal:ai.agent_repeated", {defaultValue:"检测到重复动作，已跳过本次执行并准备总结。"});
          actionStatus = "skipped";
          actionLease = null;
          port.tasks.completeAction(key, taskId, taskStep, "skipped", resultEntry.status);
          return;
        }
        const execution = await port.taskWorkflow.executeMcp(key, call, {index, total:Math.max(index, state.agentQueue.length), signal:controller.signal});
        if(!current())return;
        resultEntry.output = execution.output || "";
        resultEntry.status = execution.unsupported
          ? tr("terminal:ai.mcp_unsupported", {tool:call.tool, defaultValue:`未执行：未发现或未启用工具 ${call.tool}`})
          : execution.called
          ? tr("terminal:ai.completed", {defaultValue:"已完成"})
          : execution.denied
            ? tr("terminal:ai.agent_denied", {defaultValue:"用户拒绝执行"})
            : tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"});
        actionStatus = execution.called ? "success" : execution.denied ? "failed" : "failed";
        port.tasks.completeAction(key, taskId, taskStep, execution.called ? "success" : execution.denied ? "needs-confirmation" : "failed", execution.called ? "" : resultEntry.status);
      } catch (error) {
        if(!current())return;
        resultEntry.status = String((error instanceof Error ? error.message : "") || tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"}));
        actionStatus = "failed";
        port.tasks.completeAction(key, taskId, taskStep, "failed", resultEntry.status);
      } finally {
        if(current()){
        results.push(resultEntry);
        if (actionLease?.record) port.actions.finish(key, actionLease.record.id, actionStatus, {output:String(resultEntry.output || ""), error:actionStatus === "failed" ? String(resultEntry.status || "") : ""});
        const queueIndex = state.agentQueue.indexOf(queueLabel);
        if (queueIndex >= 0) state.agentQueue.splice(queueIndex, 1);
        port.render(key);
        }
      }
    });
    return false;
  }
  return true;
};
const enqueueActions = (answer:string, actionOptions:{allowIncomplete?:boolean}={}) => {
  const mcpCalls = port.tools.terminalAiResponseMcpCalls(answer);
  return mcpCalls.length ? enqueueMcpCalls(mcpCalls) : enqueueCommands(terminalAiResponseCommands(answer, actionOptions));
};

 return {enqueueActions,results,wait:()=>commandRunner,duplicate:()=>({repeatedCommand,repeatedResult,repeatedNotice})};
}
