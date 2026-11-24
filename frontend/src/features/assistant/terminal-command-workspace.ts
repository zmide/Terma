import {assistantServices} from '@/features/assistant/installed-services';
import {tr} from '@/shared/i18n/workspace-bootstrap';
import {notify} from '@/features/efficiency/notification-actions';
import {sendTerminalData} from '@/features/terminal/terminal-input-actions';
import {terminalSessions} from '@/features/terminal/terminal-session-state';
import {terminalPromptStateAtRow} from '@/features/terminal/terminal-prompt';
import {assistantScope} from './assistant-runtime-host';
import {terminalAiBlockNeedsInput} from './terminal-ai-tracker';
import {terminalAiCommandFromCodeBlock,terminalAiCommandSyntaxIssue} from './response-commands';
import {terminalAiCommandRisk} from './command-review';
import {terminalAiStripControl} from './response-text';
import {TERMINAL_AI_COMMAND_WAIT_MS,TERMINAL_AI_COMPLETION_STABILITY_MS,createTerminalCommandService, type CommandSession, type CommandPort} from './terminal-command-service';

export const terminalCommands = createTerminalCommandService({
  state: key => assistantServices.termaAssistant.service.state(key),
  session: key => terminalSessions.get(key),
  current: (key, state, session) => terminalSessions.get(key) === session && assistantServices.termaAssistant.service.has(key)
    && assistantServices.termaAssistant.service.state(key) === state,
  scope: assistantScope,
  command: value => terminalAiCommandFromCodeBlock(value),
  syntax: value => terminalAiCommandSyntaxIssue(value),
  risk: (command, userPrompt) => terminalAiCommandRisk(command, {userPrompt}),
  prompt: session => terminalPromptStateAtRow(session),
  finalize: session => { assistantServices.termaAssistant.tracker.fromScreen(session); },
  approve: (...args) => assistantServices.termaAssistant.interactions.approve(...args),
  backup: (...args) => assistantServices.termaAssistant.checkpoints.backup(...args),
  send: (...args) => sendTerminalData(...args),
  needsInput: block => terminalAiBlockNeedsInput(block),
  markWaiting: (key, block) => assistantServices.termaAssistant.tracker.waiting(key, block),
  render: key => assistantServices.termaAssistant.paint(key),
  persist: (key, state) => { assistantServices.termaAssistant.service.persist(key, state); },
  submit: (...args) => assistantServices.termaAssistant.requestWorkflow.submit(...args),
  strip: value => terminalAiStripControl(value),
  tr: (...args) => tr(...args),
  notify: (...args) => notify(...args),
  now: () => Date.now(),
  get waitMs() { return TERMINAL_AI_COMMAND_WAIT_MS; },
  get stabilityMs() { return TERMINAL_AI_COMPLETION_STABILITY_MS; },
  schedule: (callback, delay) => setTimeout(callback, delay)
});
