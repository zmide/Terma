export const TERMINAL_AI_COMMAND_WAIT_MS=120000,TERMINAL_AI_COMPLETION_STABILITY_MS=120;
import type {AssistantState, Block, Context} from './assistant-model';
import type {TerminalExecution} from './terminal-action-service';
import {terminalAiWaitingInputCopy} from './response-context';

export interface CommandSession {
  key?: string;
  socket?: {readyState?: number} | null;
  connectionAttempt?: number;
  sensitiveInput?: boolean;
  remoteSessionEnded?: boolean;
  commandBuffer?: string;
  aiActiveBlockId?: string;
  agentCommandInFlight?: {blockId: string; command?: string; startedAt?: number} | null;
  terminalOutputSequence?: number;
}
export interface CommandPrompt {row?: number; command?: string; cursor?: number}
export interface CommandRisk {safe: boolean; reason?: string; [key: string]: unknown}
export interface CommandOptions {
  auto?: boolean; details?: boolean; forceApproval?: boolean; risk?: CommandRisk;
  userPrompt?: string; taskId?: string; checkpointId?: string; signal?: AbortSignal;
}
export interface WaitingInput {taskId?: string; blockId?: string; originalPrompt?: string; contexts?: Context[]}
export interface CommandPort {
  state(key: string): AssistantState;
  session(key: string): CommandSession | undefined;
  current(key: string, state: AssistantState, session: CommandSession): boolean;
  scope(key: string): () => boolean;
  command(value: string): string;
  syntax(value: string): string;
  risk(command: string, prompt?: string): CommandRisk;
  prompt(session: CommandSession): CommandPrompt | null;
  finalize(session: CommandSession): void;
  approve(key: string, command: string, risk: CommandRisk, options: CommandOptions): Promise<boolean>;
  backup(key: string, taskId: string, checkpointId: string, signal?: AbortSignal): Promise<boolean>;
  send(key: string, text: string, options: {trackCommand: boolean; agentCommand?: string; focus: boolean}): boolean;
  needsInput(block: Block): boolean;
  markWaiting(key: string, block: Block): void;
  render(key: string): void;
  persist(key: string, state: AssistantState): void;
  submit(key: string, prompt: string, contexts: Context[], options: Record<string, unknown>): Promise<unknown>;
  strip(value: string): string;
  tr(key: string, params?: Record<string, unknown>): string;
  notify(message: string, level: 'info' | 'error' | 'success'): void;
  now(): number;
  waitMs: number;
  stabilityMs: number;
  schedule(callback: () => void, delay: number): unknown;
}

export function createTerminalCommandService(port: CommandPort) {
  const signature = (prompt: CommandPrompt | null) => prompt
    ? `${Number(prompt.row || 0)}|${String(prompt.command || '')}|${Number(prompt.cursor || 0)}` : '';
  function freshPrompt(session: CommandSession, block: Block, prompt: CommandPrompt | null) {
    if (!block.agentCommand) return true;
    const before = block.promptBefore as CommandPrompt | undefined;
    if (before && prompt) return signature(before) !== signature(prompt);
    return Number(session.terminalOutputSequence || 0) > Number(block.outputSequenceBefore || 0)
      && Number(block.lastOutputAt || 0) >= Number(block.sentAt || block.startedAt || 0);
  }
  function stableCompletion(session: CommandSession, block: Block) {
    const key = session.key || '';
    if (!key || block.completionTimer || port.session(key) !== session) return;
    const owner = capture(key);
    block.completionTimer = port.schedule(() => {
      block.completionTimer = 0;
      if (owner.current() && session.aiActiveBlockId === block.id) port.finalize(session);
    }, port.stabilityMs);
  }
  function capture(key: string) {
    const state = port.state(key), session = port.session(key);
    const socket = session?.socket, attempt = session?.connectionAttempt, sessionId = state.sessionId, scope = port.scope(key);
    return {state, session, current: () => !!session && port.current(key, state, session)
      && session.socket === socket && session.connectionAttempt === attempt && state.sessionId === sessionId && scope()};
  }

  async function execute(key: string, command: string, options: CommandOptions = {}): Promise<TerminalExecution | boolean> {
    const owner = capture(key), {state, session} = owner;
    const value = port.command(command);
    if (!value || !session || !owner.current() || options.signal?.aborted) return false;
    const reject = (code: string, data: Partial<TerminalExecution> = {}, level: 'info' | 'error' = 'info') => {
      const error = port.tr(`terminal:ai.${code}`);
      if (options.details) return {sent: false, blockId: '', command: value, error, ...data};
      port.notify(error, level);
      return false;
    };
    if (state.mode === 'chat') return reject('chat_execution_disabled', {chatMode: true});
    const syntax = port.syntax(value);
    if (syntax) {
      if (options.details) return {sent: false, syntaxError: true, blockId: '', command: value, error: syntax};
      port.notify(syntax, 'error');
      return false;
    }
    const usable = () => owner.current() && !options.signal?.aborted && state.mode !== 'chat'
      && state.permission !== 'suggest' && !session.remoteSessionEnded && session.socket?.readyState === 1
      && !session.sensitiveInput && !session.agentCommandInFlight;
    if (session.remoteSessionEnded || session.socket?.readyState !== 1) return reject('agent_session_ended', {sessionEnded: true}, 'error');
    if (state.permission === 'suggest') return reject('execution_disabled');
    if (session.sensitiveInput) return reject('sensitive_blocked', {}, 'error');
    if (session.agentCommandInFlight) return reject('command_busy', {busy: true});
    const pendingInput = () => String(session.commandBuffer || '').trim() || String(port.prompt(session)?.command || '').trim();
    if (pendingInput()) return reject('command_input_pending', {busy: true, inputPending: true});
    const risk = options.risk || port.risk(value, options.userPrompt);
    if (state.permission !== 'full' && options.auto && !risk.safe) return false;
    if (options.forceApproval || (state.permission !== 'full' && !options.auto && (state.permission === 'confirm' || !risk.safe))) {
      const confirmed = await port.approve(key, value, risk, options);
      if (!owner.current() || options.signal?.aborted) return false;
      if (!confirmed) return options.details ? {sent: false, denied: true, blockId: '', command: value, risk} : false;
    }
    if (!usable() || pendingInput()) return false;
    if (options.taskId && !risk.safe && options.checkpointId) {
      const backedUp = await port.backup(key, options.taskId, options.checkpointId, options.signal);
      if (!owner.current() || options.signal?.aborted) return false;
      if (!backedUp) return options.details ? {sent: false, checkpointFailed: true, blockId: '', command: value, risk} : false;
    }
    if (!usable() || pendingInput()) return false;
    const startedAt = port.now();
    const sent = port.send(key, `${value}\r`, {trackCommand: true, agentCommand: value, focus: false});
    const block = sent ? state.blocks.slice().reverse().find(item => item.command === value && Number(item.startedAt || 0) >= startedAt - 5) : null;
    const blockId = block?.id || session.aiActiveBlockId || '';
    if (sent && blockId) session.agentCommandInFlight = {blockId, command: value, startedAt};
    if (sent && !options.auto) port.notify(port.tr('terminal:ai.executed'), 'success');
    if (sent) port.render(key);
    return options.details ? {sent, blockId, command: value, risk} : sent;
  }

  function wait(key: string, blockId: string, options: Pick<CommandOptions, 'signal'> = {}): Promise<Block | null> {
    const owner = capture(key), {state, session} = owner;
    return new Promise(resolve => {
      const startedAt = port.now();
      const clear = () => { if (session?.agentCommandInFlight?.blockId === blockId) session.agentCommandInFlight = null; };
      const poll = () => {
        if (!owner.current() || options.signal?.aborted) { clear(); resolve(null); return; }
        const block = state.blocks.find(item => String(item.id) === String(blockId));
        if (block && port.needsInput(block)) {
          port.markWaiting(key, block); clear(); resolve(block); return;
        }
        if (block?.completedAt) { port.render(key); clear(); resolve(block); return; }
        if (port.now() - startedAt >= port.waitMs) {
          if (block) { block.timedOutAt = port.now(); port.render(key); }
          resolve(block || null); return;
        }
        port.schedule(poll, 100);
      };
      poll();
    });
  }

  function stop(key: string, blockId: string) {
    const state = port.state(key), block = state.blocks.find(item => item.id === blockId);
    if (!block || block.completedAt || block.waitingForInput) return false;
    if (!port.send(key, '\x03', {trackCommand: false, focus: true})) return false;
    block.interruptRequestedAt = port.now();
    port.render(key);
    port.notify(port.tr('terminal:ai.command_interrupt_sent'), 'info');
    return true;
  }

  function resume(key: string, waiting: WaitingInput, baselineOutput: string) {
    const owner = capture(key), startedAt = port.now();
    const poll = () => {
      if (!owner.current()) return;
      if (owner.session?.sensitiveInput) {
        if (port.now() - startedAt < port.waitMs) port.schedule(poll, 120);
        return;
      }
      const {state} = owner;
      if (waiting.taskId && state.activeTaskId && state.activeTaskId !== waiting.taskId) return;
      if (state.busy) { if (port.now() - startedAt < port.waitMs) port.schedule(poll, 120); return; }
      const block = state.blocks.find(item => item.id === waiting.blockId);
      const changed = String(block?.output || '').length > baselineOutput.length;
      if ((changed && block && !port.needsInput(block)) || port.now() - startedAt >= port.waitMs) {
        if (!waiting.taskId) return;
        const contexts = block ? [{source: 'terminal-block', title: block.command, text: `$ ${block.command}\n${port.strip(block.output || '')}`},
          ...(waiting.contexts || []).filter(item => item.source !== 'terminal-block')] : waiting.contexts || [];
        const prompt = port.tr('terminal:ai.agent_input_provided');
        void port.submit(key, `${prompt}\n${waiting.originalPrompt || ''}`.trim(), contexts,
          {agentTask: true, taskId: waiting.taskId, resume: true, displayPrompt: waiting.originalPrompt || prompt});
        return;
      }
      port.schedule(poll, 120);
    };
    port.schedule(poll, 180);
  }

  async function input(key: string, rawValue: string) {
    const owner = capture(key), {state,session} = owner, waiting = state.agentWaitingForInput as WaitingInput | null;
    if (!waiting || !owner.current() || state.mode === 'chat' || session?.remoteSessionEnded
      || session?.socket?.readyState !== 1 || !waiting.blockId || session.aiActiveBlockId !== waiting.blockId) return false;
    const block = state.blocks.find(item => item.id === waiting.blockId);
    if (!block) return false;
    const raw = String(rawValue || '');
    const value = session.sensitiveInput || terminalAiWaitingInputCopy(state).inputType === 'password' ? raw : raw.trim();
    if (!value) { port.notify(port.tr('terminal:ai.waiting_input_required'), 'info'); return false; }
    const baseline = block.output || '';
    if (!port.send(key, `${value}\r`, {trackCommand: false, focus: true})) return false;
    if (block) block.waitingForInput = false;
    state.agentWaitingForInput = null;
    port.persist(key, state);
    port.render(key);
    resume(key, waiting, baseline);
    return true;
  }
  return {execute, wait, stop, resume, input, freshPrompt, stableCompletion, promptState:port.prompt, isCurrent:(session:CommandSession)=>!!session.key&&port.session(session.key)===session&&capture(session.key).current(), inFlight:(key:string)=>Boolean(port.session(key)?.agentCommandInFlight), scope: (key:string)=>capture(key).current};
}
