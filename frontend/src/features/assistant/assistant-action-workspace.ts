import {assistantServices} from '@/features/assistant/installed-services';
import {snippetsServices} from '@/features/snippets/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {closeModal} from '@/features/workspace/workspace-modal-host';
import {copyText} from '@/shared/clipboard-service';
import {applicationState} from '@/shared/application-state';
import {terminalAiDeduplicateRepeatedText,terminalAiNormalizeChatAnswer} from './response-text';
import type {EventRegistry} from '@/shared/actions/event-registry';
import {confirmModal} from '@/shared/workspace-prompts';
import {terminalCommands} from './terminal-command-workspace';

async function copyTerminalAiResponse(key: string, turnId="") {
  const state = assistantServices.termaAssistant.service.state(key);
  const turn = state.turns.find(item => String(item.id) === String(turnId)) || state.turns.at(-1);
  if (!turn) return;
  const taskId = String(turn.taskId || "");
  const answer = taskId
    ? terminalAiDeduplicateRepeatedText(state.turns.filter(item => String(item.taskId || "") === taskId).map(item => String(item.answer || "").trim()).filter(Boolean).join("\n\n"))
    : terminalAiDeduplicateRepeatedText(String(turn.answer || ""));
  const visibleAnswer = turn.mode === "chat" || state.mode === "chat"
    ? terminalAiNormalizeChatAnswer(answer)
    : answer;
  if (visibleAnswer) await copyText(visibleAnswer);
}

async function copyTerminalAiCode(value: string) {
  if (value) await copyText(String(value));
}

export function sanitizeWorkflowCommand(value: string) {
  let command = String(value || "").replace(/\r\n?/g, "\n");
  command = command.replace(/\b([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+)(?=[:\s\/])/g, "<user>@<host>");
  command = command.replace(/(?:\/home\/|\/Users\/|C:\\Users\\)[^\s'\";&|]+/gi, "<path>");
  command = command.replace(/\b(?:token|password|passwd|secret|api[_-]?key)\s*=\s*[^\s;&|]+/gi, match => match.replace(/=.*/, "=<secret>"));
  return command.slice(0, 100000);
}

export function installAssistantActions(registry: EventRegistry) {
  const registerTermaAction = (name: string, handler: (context: {event: Event; element: HTMLInputElement}) => unknown) => registry.register(name, context => handler({event: context.event, element: context.element as HTMLInputElement}));
  registerTermaAction('terminal-ai-task-resume',({element})=>assistantServices.termaAssistant.taskWorkflow.resume(element.dataset.terminalAiKey||applicationState.activeTabKey,element.dataset.taskId||''));
  registerTermaAction('terminal-ai-task-rollback',({element})=>assistantServices.termaAssistant.checkpoints.rollback(element.dataset.terminalAiKey||applicationState.activeTabKey,element.dataset.taskId||'',element.dataset.checkpointId||''));

  registerTermaAction("terminal-ai-toggle", ({event,element})=>assistantServices.termaAssistant.action('toggle',element,event));
  registerTermaAction("terminal-ai-close", ({event,element})=>assistantServices.termaAssistant.action('close',element,event));
  registerTermaAction("terminal-ai-mode", ({event,element})=>assistantServices.termaAssistant.action('mode',element,event));
  registerTermaAction("terminal-ai-minimize", ({event,element})=>assistantServices.termaAssistant.action('minimize',element,event));
  registerTermaAction("terminal-ai-layout-mode", ({event,element})=>assistantServices.termaAssistant.action('layout-mode',element,event));
  registerTermaAction("terminal-ai-drag", ({event,element})=>assistantServices.termaAssistant.action('drag',element,event));
  registerTermaAction("terminal-ai-resize", ({event,element})=>assistantServices.termaAssistant.action('resize',element,event));
  registerTermaAction("terminal-ai-permission", async ({element}) => {
    const key = element.dataset.terminalAiKey || applicationState.activeTabKey;
    const state = assistantServices.termaAssistant.service.state(key);
    const previous = state.permission;
    const sessionId = state.sessionId;
    const next = ["suggest", "confirm", "controlled", "full"].includes(element.value) ? element.value : "confirm";
    if (next === "full" && previous !== "full") {
      const confirmed = await confirmModal(tr("terminal:ai.permission_full_warning", {defaultValue:"完全访问会允许 Agent 直接执行删除、写入、提权、安装、网络和服务变更等任何命令。仅在你完全信任当前任务和模型时启用。是否继续？"}), tr("terminal:ai.permission_full_title", {defaultValue:"启用完全访问"}), tr("terminal:ai.permission_full_enable", {defaultValue:"继续启用"}), tr("common:actions.cancel", {defaultValue:"取消"}));
      if (!assistantServices.termaAssistant.service.has(key) || assistantServices.termaAssistant.service.state(key) !== state || state.sessionId !== sessionId) return;
      if (!confirmed) { element.value = previous; assistantServices.termaAssistant.paint(key); return; }
    }
    state.permission = next;
    const approval = state.pendingApproval as {kind?: string} | null;
    if (next === "full" && approval && approval.kind !== "mcp") assistantServices.termaAssistant.interactions.settle(key, true);
    assistantServices.termaAssistant.paint(key);
  });
  registerTermaAction("terminal-ai-model", ({event,element})=>assistantServices.termaAssistant.action('model',element,event));
  registerTermaAction("terminal-ai-model-custom", ({event,element})=>assistantServices.termaAssistant.action('model-custom',element,event));
  registerTermaAction("terminal-ai-reasoning", ({event,element})=>assistantServices.termaAssistant.action('reasoning',element,event));
  registerTermaAction("terminal-ai-deep-thinking", ({event,element})=>assistantServices.termaAssistant.action('deep-thinking',element,event));
  registerTermaAction("terminal-ai-select-block", ({event,element})=>assistantServices.termaAssistant.action('select-block',element,event));
  registerTermaAction("terminal-ai-block-action", ({element}) => assistantServices.termaAssistant.interactions.askBlock(element.dataset.terminalAiKey || applicationState.activeTabKey, element.dataset.blockId, element.dataset.aiAction));
  registerTermaAction("terminal-ai-block-stop", ({element}) => terminalCommands.stop(element.dataset.terminalAiKey || applicationState.activeTabKey, element.dataset.blockId || ''));
  registerTermaAction("terminal-ai-submit", ({event,element})=>assistantServices.termaAssistant.action('submit',element,event));
  registerTermaAction("terminal-ai-prompt-keydown", ({event,element})=>assistantServices.termaAssistant.action('prompt-keydown',element,event));
  registerTermaAction("terminal-ai-stop", ({event,element})=>assistantServices.termaAssistant.action('stop',element,event));
  registerTermaAction("terminal-ai-new-session", ({event,element})=>assistantServices.termaAssistant.action('new-session',element,event));
  registerTermaAction("terminal-ai-history", ({event,element})=>assistantServices.termaAssistant.action('history',element,event));
  registerTermaAction("terminal-ai-history-load", ({event,element})=>assistantServices.termaAssistant.action('history-load',element,event));
  registerTermaAction("terminal-ai-history-delete", ({event,element})=>assistantServices.termaAssistant.action('history-delete',element,event));
  registerTermaAction("terminal-ai-approval-approve", ({element}) => assistantServices.termaAssistant.interactions.settle(element.dataset.terminalAiKey || applicationState.activeTabKey, true));
  registerTermaAction("terminal-ai-approval-insert", ({element}) => assistantServices.termaAssistant.interactions.insertPending(element.dataset.terminalAiKey || applicationState.activeTabKey));
  registerTermaAction("terminal-ai-approval-reject", ({element}) => assistantServices.termaAssistant.interactions.settle(element.dataset.terminalAiKey || applicationState.activeTabKey, false));
  registerTermaAction("terminal-ai-approval-stop", ({element}) => assistantServices.termaAssistant.service.stop(element.dataset.terminalAiKey || applicationState.activeTabKey));
  registerTermaAction("terminal-ai-waiting-input-submit", ({event, element}) => {
    event.preventDefault();
    const key = element.dataset.terminalAiKey || applicationState.activeTabKey;
    const input = element.querySelector<HTMLInputElement>(`[data-terminal-ai-waiting-input="${CSS.escape(String(key))}"]`);
    const value = String(input?.value || "");
    return terminalCommands.input(key, value).then(sent => {
      if (sent && input) input.value = "";
    });
  });
  registerTermaAction("terminal-ai-attachment-open", ({event,element})=>assistantServices.termaAssistant.action('attachment-open',element,event));
  registerTermaAction("terminal-ai-attachments-select", ({event,element})=>assistantServices.termaAssistant.action('attachments-select',element,event));
  registerTermaAction("terminal-ai-attachment-remove", ({event,element})=>assistantServices.termaAssistant.action('attachment-remove',element,event));
  registerTermaAction("terminal-ai-insert-command", ({element}) => assistantServices.termaAssistant.interactions.insert(element.dataset.terminalAiKey || applicationState.activeTabKey, element.dataset.command || ""));
  registerTermaAction("terminal-ai-execute-command", ({element}) => terminalCommands.execute(element.dataset.terminalAiKey || applicationState.activeTabKey, element.dataset.command || ""));
  registerTermaAction("terminal-ai-copy-code", ({element}) => copyTerminalAiCode(element.dataset.code || ""));
  registerTermaAction("terminal-ai-save-snippet", ({element}) => {
    const command = String(element.dataset.command || "").trim();
    if (!command || !snippetsServices.termaSnippets) return;
    const parameterized = typeof snippetsServices.termaSnippets.model.variables === "function" && snippetsServices.termaSnippets.model.variables(command).length > 0;
    const sanitized = sanitizeWorkflowCommand(command);
    snippetsServices.termaSnippets.navigate("editor", 0, {name:tr(parameterized ? "terminal:ai.ai_workflow_name" : "terminal:ai.ai_snippet_name", {defaultValue:parameterized ? "AI Workflow" : "AI 命令"}), command:sanitized, description:sanitized !== command ? tr("terminal:ai.workflow_scrub_hint", {defaultValue:"已移除主机、用户、路径和疑似密钥，请在保存前补充参数。"}) : "", returnTo:"terminal"});
  });
  registerTermaAction("terminal-ai-copy-response", ({element}) => copyTerminalAiResponse(element.dataset.terminalAiKey || applicationState.activeTabKey, element.dataset.turnId || ""));
  registerTermaAction("terminal-ai-modal-close", () => closeModal());
  registerTermaAction("terminal-ai-log-submit", () => assistantServices.termaAssistant.submitLog());
  registerTermaAction("log-ai-open", ({element}) => assistantServices.termaAssistant.openLog(element.dataset.tabKey || applicationState.activeTabKey));
}
