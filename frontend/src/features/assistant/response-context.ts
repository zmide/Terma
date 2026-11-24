import {TERMINAL_AI_MAX_BLOCK_OUTPUT} from './assistant-model';
import {translate as tr} from '../../shared/i18n/runtime';
import type {AssistantState} from './assistant-model';
import {terminalAiStripControl,terminalAiRedactAttachment} from './response-text';
export interface BufferSession {sensitiveInput?:boolean;term?:{buffer?:{active?:{length:number;getLine(index:number):{translateToString(trim?:boolean):string}|undefined}}}}
const TERMINAL_AI_SCREEN_MAX_LINES=240, TERMINAL_AI_SCREEN_MAX_CHARS=24000;
export function terminalAiWaitingInputCopy(state:Pick<AssistantState,'blocks'|'agentWaitingForInput'>) {
  const waiting = state?.agentWaitingForInput && typeof state.agentWaitingForInput === 'object' ? state.agentWaitingForInput as Record<string,unknown> : {};
  const blocks = Array.isArray(state?.blocks) ? state.blocks : [];
  const block = blocks.find(item => String(item?.id || "") === String(waiting.blockId || ""));
  const output = terminalAiStripControl(block?.output || waiting.output || "").slice(-1600);
  const command = String(waiting.command || block?.command || "");
  const promptTail = output.split(/\n/).map(line => line.trim()).filter(Boolean).slice(-3).join("\n");
  const passwordPrompt = /(?:password|passphrase|pass phrase|密码|口令)/i.test(promptTail);
  const sshPrompt = /(?:yes\s*\/\s*no|fingerprint|continue\s+connecting|主机指纹|连接.*继续)/i.test(promptTail)
    || (!passwordPrompt && /(?:fingerprint|主机指纹)/i.test(output));
  const choicePrompt = /(?:\[[yYnN](?:\s*\/\s*[yYnN]){1,2}\]|\((?:y|n)(?:\s*\/\s*(?:y|n))?\)|\b(?:y\s*\/\s*n|Y\/n|y\/N)\b|(?:删除|覆盖|替换|确认|继续).{0,40}(?:[?？]|[yYnN]))/i.test(promptTail)
    || /(?:\brm(?:\s+-[^\s]*)*\b|--interactive|overwrite|delete|remove|confirm)/i.test(command);
  if (passwordPrompt) return {
    inputType:'password' as const,
    hint:tr("terminal:ai.waiting_input_password_hint", {defaultValue:"请按终端提示输入密码或口令。Terma 已暂停 Agent，不会继续发送命令。"}),
    placeholder:tr("terminal:ai.waiting_input_password_placeholder", {defaultValue:"输入密码或口令"})
  };
  if (sshPrompt) return {
    inputType:'text' as const,
    hint:tr("terminal:ai.waiting_input_ssh_hint", {defaultValue:"请按提示输入 yes、no 或完整主机指纹。Terma 已暂停 Agent，不会继续发送命令。"}),
    placeholder:tr("terminal:ai.waiting_input_ssh_placeholder", {defaultValue:"输入 yes、no 或主机指纹"})
  };
  if (choicePrompt) return {
    inputType:'text' as const,
    hint:tr("terminal:ai.waiting_input_choice_hint", {defaultValue:"请按终端提示输入 y 或 n。Terma 已暂停 Agent，不会继续发送命令。"}),
    placeholder:tr("terminal:ai.waiting_input_choice_placeholder", {defaultValue:"输入 y 或 n"})
  };
  return {
    inputType:'text' as const,
    hint:tr("terminal:ai.waiting_input_hint", {defaultValue:"请按终端提示输入内容。Terma 已暂停 Agent，不会继续发送命令。"}),
    placeholder:tr("terminal:ai.waiting_input_placeholder", {defaultValue:"输入终端所需内容"})
  };
}

export function terminalAiCurrentBufferText(session:BufferSession|undefined) {
  if (session?.sensitiveInput) return "";
  const buffer = session?.term?.buffer?.active;
  if (!buffer) return "";
  const length = Math.max(0, Number(buffer.length) || 0);
  const start = Math.max(0, length - TERMINAL_AI_SCREEN_MAX_LINES);
  const lines = [];
  for (let index = start; index < length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) || "");
  }
  let text = lines.join("\n").replace(/\s+$/, "");
  if (text.length > TERMINAL_AI_SCREEN_MAX_CHARS) {
    text = `[... ${tr("terminal:ai.current_context_older", {defaultValue:"更早的终端内容已省略"})} ...]\n${text.slice(-TERMINAL_AI_SCREEN_MAX_CHARS)}`;
  }
  return terminalAiRedactAttachment(text);
}

export function terminalAiAgentContinuationPrompt(originalPrompt:unknown, results:unknown) {
  const items = ((Array.isArray(results) ? results : [{command:results, output:""}]) as {kind?:string;server?:string;tool?:string;status?:string;command?:unknown;output?:unknown}[]).map(item => {
    if (item?.kind === "mcp") {
      const label = `${item.server}.${item.tool}`;
      const status = item?.status ? `\n${tr("terminal:ai.agent_status_label", {defaultValue:"状态"})}：${item.status}` : "";
      return `\n${tr("terminal:ai.agent_mcp_label", {defaultValue:"MCP 工具"})}：${label}${status}\n${tr("terminal:ai.agent_output_label", {defaultValue:"真实工具输出"})}：\n${String(item.output || "").slice(-TERMINAL_AI_MAX_BLOCK_OUTPUT)}`;
    }
    const command = String(item?.command || "").trim();
    const output = terminalAiStripControl(item?.output || "");
    const status = item?.status ? `\n${tr("terminal:ai.agent_status_label", {defaultValue:"状态"})}：${item.status}` : "";
    return `\n${tr("terminal:ai.agent_command_label", {defaultValue:"命令"})}：${command}${status}\n${tr("terminal:ai.agent_output_label", {defaultValue:"真实终端输出"})}：\n${output.slice(-TERMINAL_AI_MAX_BLOCK_OUTPUT)}`;
  }).join("\n");
  return tr("terminal:ai.agent_continue_prompt", {
    task:String(originalPrompt || ""),
    command:items,
    defaultValue:`继续完成用户的原始任务。Terma 在检测到上一条完整命令后按 Agent 协议结束了该次流式响应，这不是用户停止任务，也不是网络中断。下面是该命令及真实终端输出：${items}\n请根据输出继续分析和操作：如果任务已经完成，直接给出最终结论且不要再提供命令；如果仍需检查，只提供下一条需要执行的命令。命令失败时请分析原因并继续尝试，不要因为单条命令失败就终止。原始任务：${originalPrompt}`
  });
}

export function terminalAiAgentActionRecoveryPrompt(originalPrompt:unknown, previousAnswer:unknown) {
  return tr("terminal:ai.agent_action_recovery_prompt", {
    task:String(originalPrompt || ""),
    answer:String(previousAnswer || "").slice(0, 1200),
    defaultValue:`继续完成用户的原始任务。你上一轮只说明了计划，没有给出终端操作或完整结论。若需要检查，请立即只返回一条完整的 shell 代码块；若不需要终端，请直接给出完整最终结论。不要再次只写开场说明。原始任务：${originalPrompt}\n上一轮：${String(previousAnswer || "").slice(0, 1200)}`
  });
}
