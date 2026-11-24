import {createRequestActionQueue} from './request-action-queue';
import {terminalAiAgentContinuationPrompt} from './response-context';
import {terminalAiAgentActionRecoveryPrompt} from './response-context';
import {terminalAiStripControl} from './response-text';
import {terminalAiResponseCommands} from './response-commands';
import {translate as tr} from '../../shared/i18n/runtime';
import type {Context} from './assistant-model';
import type {ConversationPort,createConversationService} from './conversation-service';
import type {createTaskService} from './task-service';
import type {createTaskWorkflow} from './task-workflow';
import type {createMcpService} from './mcp-service';
import type {createActionService} from './action-service';
import type {createTerminalActionService} from './terminal-action-service';
import type {createTerminalAiTracker} from './terminal-ai-tracker';
import type {createPlatformService} from './platform-service';
import type {createResponseTools} from './response-tools';
import * as taskPresentation from './task-presentation';
type ResponseTools=ReturnType<typeof createResponseTools>;
export interface RequestOptions {mode?:string;agentTask?:boolean;taskId?:string;displayPrompt?:string;resume?:boolean;streamRequest?:ConversationPort['request']}
export interface RequestResult extends Record<string,unknown> {kind?:string;command?:string;output:string;status:string;server?:string;tool?:string;arguments?:Record<string,unknown>;sessionEnded?:boolean;waitingForInput?:boolean;incomplete?:boolean;syntaxError?:boolean;duplicate?:boolean}
export interface RequestPort {
 service:ReturnType<typeof createConversationService>;
 tasks:ReturnType<typeof createTaskService>;
 taskWorkflow:ReturnType<typeof createTaskWorkflow>;
 mcp:ReturnType<typeof createMcpService>;
 actions:ReturnType<typeof createActionService>;
 terminalActions:ReturnType<typeof createTerminalActionService>;
 tracker:ReturnType<typeof createTerminalAiTracker>;
 platform:ReturnType<typeof createPlatformService>;
 tools:ResponseTools;
 settings():Record<string,unknown>;render(key:string):void;notify(message:string,level:'info'):void;id():string;now():number;scope(key:string):()=>boolean;
}
export function createRequestWorkflow(port:RequestPort) {
function terminalAiAnswerNeedsActionRecovery(value:unknown) {
  const visible = port.tools.terminalAiNormalizeToolCalls(value).replace(/\s+/g, " ").trim();
  if (!visible || visible.length > 800 || terminalAiResponseCommands(value).length || port.tools.terminalAiResponseMcpCalls(value).length) return false;
  if (/(?:结论|已完成|无需|不能|无法|不需要|final answer|completed|no need|cannot)/i.test(visible)) return false;
  return /(?:我(?:先|来|将)|先|接下来|下一步|让我|开始).{0,80}(?:检查|收集|查看|确认|获取|执行|排查|inspect|collect|check|run)/i.test(visible);
}
async function submit(key:string, prompt:string, contexts:Context[], options:RequestOptions={}) {
  const state = port.service.state(key);
  if (port.settings().enabled!==true) {
    state.error = tr("terminal:ai.disabled", {defaultValue:"请先在设置中启用终端 AI"});
    port.render(key);
    return;
  }
  if (!String(port.settings().model||"").trim()) {
    state.error = tr("terminal:ai.model_required", {defaultValue:"请先在设置中选择 AI 模型"});
    port.render(key);
    return;
  }
  const originalPrompt = String(prompt || "").trim();
  if (!originalPrompt) return;
  const chatMode = state.mode === "chat" || options.mode === "chat";
  if (chatMode && state.busy) {
    port.notify(tr("terminal:ai.chat_busy", {defaultValue:"上一条聊天回复仍在生成，请稍候"}), "info");
    return;
  }
  if (!state.turns.length) state.sessionTitle = port.service.title(originalPrompt);
  state.controller?.abort?.();
  state.busy = true;
  state.error = "";
  if (options.agentTask !== true || !options.taskId) state.agentWaitingForInput = null;
  const requestId = ++state.requestId;
  const suppliedContexts = Array.isArray(contexts) ? contexts : [];
  const chatContexts = chatMode ? port.service.contexts(key, "chat") : [];
  const contextKeys = new Set();
  const mergedChatContexts = [...chatContexts, ...suppliedContexts].filter(item => {
    if (!item || typeof item !== "object") return false;
    const identity = `${String(item.source || "")}\n${String(item.title || "")}\n${String(item.text || "")}`;
    if (contextKeys.has(identity)) return false;
    contextKeys.add(identity);
    return true;
  }).slice(0, 8);
  const requestContexts = chatMode ? mergedChatContexts : suppliedContexts;
  const agentContexts = options.agentTask === true ? [...suppliedContexts, ...port.taskWorkflow.targetContexts(key), port.platform.context()] : requestContexts;
  const task = options.agentTask === true && !chatMode ? port.tasks.begin(key, options.displayPrompt || originalPrompt, agentContexts, String(options.taskId || "")) : null;
  const taskId = options.agentTask === true && !chatMode ? String(options.taskId || task?.id || port.id()) : "";
  const controller = new AbortController();
  state.controller = controller;
  const sessionId=state.sessionId,scope=port.scope(key);
  const owned=()=>port.service.has(key)&&port.service.state(key)===state&&state.sessionId===sessionId&&state.requestId===requestId;
  const current=()=>owned()&&!controller.signal.aborted&&scope()&&(chatMode||state.mode!=="chat");
  port.render(key);
  let currentPrompt = originalPrompt;
  let currentContexts = agentContexts;
  let mcpContexts:Context[] = [];
  let continuation = false;
  let awaitingActionRecovery = false;
  let searchAttempted = false;
  const executedCommands = port.tasks.attemptedForState(state, taskId);
  const executedCommandResults = new Map<string,RequestResult>();
  const explicitSearch = options.agentTask === true && port.mcp.searchIntent(originalPrompt);
  try {
    if (options.agentTask === true) {
      try {
        mcpContexts = await port.mcp.contexts(controller.signal);
        if(!current())return;
        currentContexts = [...currentContexts, ...mcpContexts];
      } catch {
        // Optional tool discovery may fail; continue without a tool catalog.
        // Cancellation and ownership loss must still stop this request.
        if (!current()) return;
        mcpContexts = [];
      }
      if (explicitSearch) {
        // A fresh web-research request is not a continuation of the selected
        // terminal command. Keep explicit attachments, but remove stale shell
        // selection/block context and isolate it from older task history.
        currentContexts = currentContexts.filter(item => !["terminal-selection", "terminal-block"].includes(String(item?.source || "")));
        const projectIdentity = port.mcp.projectContext(originalPrompt);
        if (projectIdentity) {
          mcpContexts = [projectIdentity, ...mcpContexts];
          currentContexts = [projectIdentity, ...currentContexts];
        }
        if (state.permission !== "suggest") {
          const searchCall = port.mcp.searchCall(originalPrompt);
          if (searchCall) {
            searchAttempted = true;
            const resultEntry = await port.taskWorkflow.runMcp(key, taskId, searchCall, {index:1, total:1, signal:controller.signal});
            if(!current())return;
            currentPrompt = terminalAiAgentContinuationPrompt(originalPrompt, [resultEntry]);
            state.agentPreflightResults = [...(state.agentPreflightResults || []), resultEntry];
            currentContexts = [{source:"mcp-output", title:`MCP ${resultEntry.server}.${resultEntry.tool}`, text:`${tr("terminal:ai.agent_status_label", {defaultValue:"状态"})}：${resultEntry.status}\n${terminalAiStripControl(resultEntry.output || "")}`}, ...currentContexts];
          }
        }
      }
    }
    while (current()) {
      if (options.agentTask !== true) {
        const turn = await port.service.turn(key, currentPrompt, currentContexts, {requestId, taskId, mode:chatMode ? "chat" : "agent", controller, agentContinuation:continuation, streamRequest:options.streamRequest});
        if (!turn || turn.error || !current()) break;
        break;
      }
      const round=createRequestActionQueue(port,{key,state,current,taskId,originalPrompt,currentContexts,executedCommands,executedCommandResults,signal:controller.signal});
      const {enqueueActions,results}=round;
      const turn = await port.service.turn(key, currentPrompt, currentContexts, {requestId, taskId, mode:"agent", controller, agentContinuation:continuation, displayPrompt:continuation ? undefined : (options.displayPrompt || originalPrompt), history:explicitSearch ? [] : undefined, streamRequest:options.streamRequest, onActions:answer=>enqueueActions(answer)});
      // Some compatible gateways finish after sending a complete command body
      // but omit the closing protocol tag or code fence. Recover only after the
      // stream ends and only when the single command is syntactically complete.
      if (!current()) {await round.wait();break;}
      if (turn) {
        const completeActions = terminalAiResponseCommands(turn.answer);
        const recoveredActions = completeActions.length ? completeActions : terminalAiResponseCommands(turn.answer, {allowIncomplete:true});
        if (!completeActions.length && recoveredActions.length) {
          turn.answer = port.tools.terminalAiCompleteRecoveredCommandAnswer(turn.answer, recoveredActions[0]);
          turn.recoveredIncompleteAction = true;
        }
        enqueueActions(turn.answer, {allowIncomplete:true});
      }
      await round.wait();
      if(!current())break;
      if (turn) turn.agentResults = [...(Array.isArray(turn.agentResults) ? turn.agentResults : []), ...results];
      if (turn) port.render(key);
      const {repeatedCommand,repeatedResult,repeatedNotice}=round.duplicate();
      const endedResult = results.find(item => item.sessionEnded);
      if (endedResult) {
        const endedMessage = tr("terminal:ai.agent_session_ended", {defaultValue:"终端会话已结束，已停止继续执行；请重新连接后恢复任务。"});
        if (turn) {
          turn.agentNotice = endedMessage;
          turn.error = endedResult.status || endedMessage;
        }
        port.service.persist(key, state);
        port.render(key);
        break;
      }
      if (repeatedCommand) {
        const previous = repeatedResult || executedCommandResults.get(repeatedCommand) || (() => {
          const block = [...state.blocks].reverse().find(item => String(item?.command || "").trim() === repeatedCommand);
          return block ? {command:repeatedCommand, output:block.output || "", status:tr("terminal:ai.completed", {defaultValue:"已完成"})} : {command:repeatedCommand, output:"", status:tr("terminal:ai.agent_output_missing", {defaultValue:"未找到上一轮输出"})};
        })();
        if (turn) turn.agentNotice = repeatedNotice || tr("terminal:ai.agent_repeated", {defaultValue:"检测到重复命令，已跳过本次执行并准备总结。"});
        const summaryPrompt = taskPresentation.terminalAiDuplicateSummaryPrompt(originalPrompt, repeatedCommand, previous);
        const summaryTurn = await port.service.turn(key, summaryPrompt, [{source:"terminal-agent-output", title:repeatedCommand, text:`$ ${repeatedCommand}\n${terminalAiStripControl(previous.output || "")}`}, ...mcpContexts], {requestId, taskId, controller, agentContinuation:true, history:[], streamRequest:options.streamRequest});
        if (!current())break;
        if (summaryTurn && !summaryTurn.error) summaryTurn.agentNotice = tr("terminal:ai.agent_summary_after_duplicate", {defaultValue:"已复用第一次执行的真实输出，完成收尾总结。"});
        if (summaryTurn?.error && turn && !turn.error) turn.agentNotice = repeatedNotice;
        port.service.persist(key, state);
        port.render(key);
        break;
      }
      if (!current() || turn?.error) break;
      if (results.some(item => item.waitingForInput || item.incomplete)) break;
      if (!results.length) {
        // Some models acknowledge a search request without emitting the MCP
        // protocol block. For an explicit web-search intent, select one
        // discovered search tool and execute it through the normal permission
        // path, then return the real result to the model.
        if (!searchAttempted && state.permission !== "suggest") {
          const searchCall = port.mcp.searchCall(originalPrompt);
          if (searchCall) {
            searchAttempted = true;
            const resultEntry = await port.taskWorkflow.runMcp(key, taskId, searchCall, {index:1, total:1, signal:controller.signal});
            if(!current())return;
            results.push(resultEntry);
            if (turn) turn.agentResults = [...(Array.isArray(turn.agentResults) ? turn.agentResults : []), resultEntry];
          }
        }
        if (results.length) {
          currentPrompt = terminalAiAgentContinuationPrompt(originalPrompt, results);
          currentContexts = [...results.map(item => ({source:"mcp-output", title:`MCP ${item.server}.${item.tool}`, text:`${item.status ? `${tr("terminal:ai.agent_status_label", {defaultValue:"状态"})}：${item.status}\n` : ""}${terminalAiStripControl(item.output || "")}`})), ...mcpContexts];
          continuation = true;
          port.service.persist(key, state);
          continue;
        }
        if (!awaitingActionRecovery && terminalAiAnswerNeedsActionRecovery(turn?.answer || "")) {
          awaitingActionRecovery = true;
          currentPrompt = terminalAiAgentActionRecoveryPrompt(originalPrompt, turn?.answer || "");
          currentContexts = [...mcpContexts];
          continuation = true;
          port.service.persist(key, state);
          continue;
        }
        // Give a planning-only response one correction turn. If the model
        // still returns no action, stop the task instead of asking forever and
        // showing the same preamble repeatedly.
        if (awaitingActionRecovery && terminalAiAnswerNeedsActionRecovery(turn?.answer || "")) {
          const stopNotice = tr("terminal:ai.agent_action_missing", {defaultValue:"模型连续只返回操作计划，没有给出命令或最终结论，本轮已停止以避免空转。"});
          if (turn) turn.agentNotice = stopNotice;
          if (taskId) port.tasks.stop(key);
          port.service.persist(key, state);
          port.render(key);
          break;
        }
        break;
      }
      awaitingActionRecovery = false;
      currentPrompt = terminalAiAgentContinuationPrompt(originalPrompt, results);
      currentContexts = [...results.map(item => item.kind === "mcp"
        ? {source:"mcp-output", title:`MCP ${item.server}.${item.tool}`, text:`${item.status ? `${tr("terminal:ai.agent_status_label", {defaultValue:"状态"})}：${item.status}\n` : ""}${terminalAiStripControl(item.output || "")}`}
        : {source:"terminal-agent-output", title:tr("terminal:ai.agent_output_title", {command:item.command, defaultValue:`命令输出：${item.command}`}), text:`$ ${item.command}\n${item.status ? `${tr("terminal:ai.agent_status_label", {defaultValue:"状态"})}：${item.status}\n` : ""}${terminalAiStripControl(item.output || "")}`}), ...mcpContexts];
      continuation = true;
      port.service.persist(key, state);
    }
  } finally {
    if (owned()) {
      state.controller = null;
      state.busy = false;
      if (options.agentTask === true && !current()) {port.tasks.stop(key);port.actions.stop(key);state.agentQueue=[];}
      else if (options.agentTask === true) { const failedTurn = [...state.turns].reverse().find(item => String(item?.taskId || "") === taskId && item?.error); port.tasks.finish(key, taskId, failedTurn?.error || ""); }
      port.render(key);
    }
  }
}
 return {submit};
}
