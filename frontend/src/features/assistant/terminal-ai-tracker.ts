import {TERMINAL_AI_MAX_BLOCKS,TERMINAL_AI_MAX_BLOCK_OUTPUT,type AssistantState,type Block} from './assistant-model';
import {TERMINAL_AI_COMPLETION_STABILITY_MS,type CommandSession,type CommandPrompt,type WaitingInput} from './terminal-command-service';
import {terminalAiStripControl} from './response-text';
import {terminalAiCommandText} from './response-commands';
export interface TrackingSession extends CommandSession {pendingTerminalOutput?:Array<string|Uint8Array>;terminalOutputWriting?:boolean;aiOutputDecoder?:TextDecoder}
interface CaptureMetadata {sentAt?:number;agent?:boolean;promptBefore?:CommandPrompt|null;outputSequenceBefore?:number}
export interface TrackerPort {
 state(key:string):AssistantState;
 current(session:TrackingSession):boolean;
 scope(key:string):()=>boolean;
 enabled():boolean;
 persist(key:string,state:AssistantState):void;
 render(key:string):void;
 prompt(session:TrackingSession):CommandPrompt|null;
 freshPrompt(session:TrackingSession,block:Block,prompt:CommandPrompt|null):boolean;
 stableCompletion(session:TrackingSession,block:Block):void;
 id():string;now():number;
}
const keyOf=(session:TrackingSession)=>String(session.key||'');
export function terminalAiBlockNeedsInput(block:Block|null|undefined) {
  if (!block || block.completedAt) return false;
  const command = String(block.command || "");
  const output = terminalAiStripControl(block.output || "").replace(/\r/g, "");
  if (/<<-?\s*["']?[A-Za-z_][A-Za-z0-9_]*["']?/m.test(command)) return /(?:^|\n)\s*>+\s*$/m.test(output);
  const tail = output.slice(-1600);
  const lastLine = tail.split(/\n/).at(-1)?.trim() || "";
  if (!lastLine) return false;
  const choicePrompt = /(?:\[[yYnN](?:\s*\/\s*[yYnN]){1,2}\]|\((?:y|n)(?:\s*\/\s*(?:y|n))?\)|\b(?:y\s*\/\s*n|yes\s*\/\s*no|y\/N|Y\/n)\b)/i;
  const questionPrompt = /(?:\?|？)\s*$/;
  const inputLabel = /(?:password|passphrase|pass phrase|verification code|security code|one[- ]time code|enter\s+[^\r\n]{0,90}|type\s+[^\r\n]{0,90}|press\s+(?:enter|return)|continue|proceed|overwrite|confirm|are\s+you\s+sure|please\s+choose|please\s+select|please\s+provide|please\s+enter|please\s+input|please\s+type|请输入|请先|请按|输入|确认|继续|覆盖|替换|删除|执行|选择|提供)[^\r\n]{0,120}/i;
  if (choicePrompt.test(lastLine)) return true;
  if (questionPrompt.test(lastLine) && inputLabel.test(lastLine)) return true;
  if (inputLabel.test(lastLine) && /[:：]\s*$/.test(lastLine)) return true;
  return /(?:please\s+type\s+['\"]?yes['\"]?\s*,?\s+['\"]?no['\"]?\s+or\s+the\s+fingerprint|type\s+['\"]?yes['\"]?\s*,?\s+['\"]?no['\"]?\s+or\s+the\s+fingerprint|are\s+you\s+sure\s+you\s+want\s+to\s+continue\s+connecting\s*\(yes\/no(?:\/\[fingerprint\])?\))/i.test(tail);
}
export function createTerminalAiTracker(port:TrackerPort) {
 const timers=new Map<string,ReturnType<typeof setTimeout>>();
 function disposeKey(key:string){clearTimeout(timers.get(key));timers.delete(key);}
 function scheduleRender(session:TrackingSession,state:AssistantState) {
  const key=keyOf(session),sessionId=state.sessionId,current=port.scope(key);disposeKey(key);
  timers.set(key,setTimeout(()=>{timers.delete(key);if(current()&&port.current(session)&&port.state(key)===state&&state.sessionId===sessionId&&state.open)port.render(key);},120));
 }
function finalizeTerminalAiActiveBlock(session:TrackingSession|null|undefined) {
  if (!session?.aiActiveBlockId || !port.current(session)) return false;
  const state = port.state(keyOf(session));
  const block = state.blocks.find(item => item.id === session.aiActiveBlockId);
  if (!block) { session.aiActiveBlockId = ""; return false; }
  // An SSH trust/password prompt is still interactive even when the shell
  // reports a prompt-like line. Keep the block open and pause the Agent until
  // the user answers in the terminal.
  if (terminalAiBlockNeedsInput(block)) {
    terminalAiMarkWaitingForInput(keyOf(session), block);
    return false;
  }
  block.completedAt = block.completedAt || port.now();
  session.aiActiveBlockId = "";
  if (session.agentCommandInFlight?.blockId === block.id) session.agentCommandInFlight = null;
  port.persist(keyOf(session), state);
  if (state.open && !state.busy) port.render(keyOf(session));
  return true;
}

function terminalAiMarkSessionEnded(session:TrackingSession|null|undefined) {
  if (!session?.aiActiveBlockId || !port.current(session)) return false;
  const state = port.state(keyOf(session));
  const block = state.blocks.find(item => String(item.id) === String(session.aiActiveBlockId));
  if (!block || block.completedAt) return false;
  const output = terminalAiStripControl(block.output || "");
  const exitCode = output.match(/(?:退出码|exit\s+code)\s*[:：]?\s*(-?\d+)/i)?.[1];
  if (exitCode !== undefined) block.exitCode = Number(exitCode);
  block.sessionEndedAt = port.now();
  block.waitingForInput = false;
  block.completedAt = block.sessionEndedAt;
  if ((state.agentWaitingForInput as WaitingInput|null)?.blockId === block.id) state.agentWaitingForInput = null;
  session.aiActiveBlockId = "";
  session.agentCommandInFlight = null;
  port.persist(keyOf(session), state);
  if (state.open) port.render(keyOf(session));
  return true;
}

function terminalAiMarkWaitingForInput(key:string, block:Block|null|undefined, metadata:Record<string,unknown>={}) {
  if (!block || block.completedAt) return null;
  const state = port.state(key);
  block.waitingForInput = true;
  state.agentWaitingForInput = {
    ...(state.agentWaitingForInput && typeof state.agentWaitingForInput==='object' ? state.agentWaitingForInput : {}),
    blockId:block.id,
    command:block.command,
    ...metadata
  };
  port.persist(key, state);
  if (state.open) port.render(key);
  return state.agentWaitingForInput;
}

function finalizeTerminalAiBlockFromScreen(session:TrackingSession|null|undefined) {
  if (!session?.aiActiveBlockId || !port.current(session)) return false;
  if (session.terminalOutputWriting || session.pendingTerminalOutput?.length) return false;
  const prompt = port.prompt(session);
  if (!prompt || prompt.command) return false;
  const state = port.state(keyOf(session));
  const block = state.blocks.find(item => item.id === session.aiActiveBlockId);
  if (!block) return false;
  if (terminalAiBlockNeedsInput(block)) return false;
  if (!port.freshPrompt(session, block, prompt)) return false;
  if (block.agentCommand) {
    const now = port.now();
    block.completionCandidateAt = Number(block.completionCandidateAt || now);
    if (now - block.completionCandidateAt < TERMINAL_AI_COMPLETION_STABILITY_MS) {
      port.stableCompletion(session, block);
      return false;
    }
  }
  return finalizeTerminalAiActiveBlock(session);
}

function captureTerminalAiBlockCommand(session:TrackingSession|undefined, command:unknown, metadata:CaptureMetadata={}) {
  if (!port.enabled() || !session || !port.current(session) || session.sensitiveInput || !String(command || "").trim()) return;
  if (session.aiActiveBlockId) {
    const state = port.state(keyOf(session));
    const previous = state.blocks.find(item => item.id === session.aiActiveBlockId);
    const finalized = previous?.agentCommand
      ? finalizeTerminalAiBlockFromScreen(session)
      : finalizeTerminalAiActiveBlock(session);
    if (previous?.agentCommand && !finalized) return;
  }
  const state = port.state(keyOf(session));
  const block = {
    id:port.id(),
    command:terminalAiCommandText(String(command).trim()),
    output:"",
    startedAt:Number(metadata.sentAt || port.now()),
    sentAt:Number(metadata.sentAt || port.now()),
    completedAt:0,
    agentCommand:metadata.agent === true,
    promptBefore:metadata.promptBefore || null,
    outputSequenceBefore:Number(metadata.outputSequenceBefore || 0)
  };
  state.blocks.push(block);
  if (state.blocks.length > TERMINAL_AI_MAX_BLOCKS) state.blocks.splice(0, state.blocks.length - TERMINAL_AI_MAX_BLOCKS);
  session.aiActiveBlockId = block.id;
  state.selectedBlockId = block.id;
  port.persist(keyOf(session), state);
  if (state.open) port.render(keyOf(session));
}

function terminalAiDecodedOutput(session:TrackingSession, value:unknown) {
  if (typeof value === "string") return value;
  const bytes = value instanceof Uint8Array
    ? value
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : null;
  if (!bytes?.byteLength) return "";
  try {
    if (!session.aiOutputDecoder) session.aiOutputDecoder = new TextDecoder("utf-8", {fatal:false});
    return session.aiOutputDecoder.decode(bytes, {stream:true});
  } catch {
    return "";
  }
}

function captureTerminalAiBlockOutput(session:TrackingSession|undefined, value:unknown) {
  if (!port.enabled() || !session || !port.current(session) || session.sensitiveInput || !session.aiActiveBlockId) return;
  const text = terminalAiDecodedOutput(session, value);
  if (!text) return;
  const state = port.state(keyOf(session));
  const block = state.blocks.find(item => item.id === session.aiActiveBlockId);
  if (!block) return;
  block.output = `${block.output || ""}${text}`.slice(-TERMINAL_AI_MAX_BLOCK_OUTPUT);
  block.lastOutputAt = port.now();
  block.outputSequence = Number(session.terminalOutputSequence || 0);
  if (terminalAiBlockNeedsInput(block)) terminalAiMarkWaitingForInput(keyOf(session), block);
  port.persist(keyOf(session), state);
  if (state.open && !state.busy) {
    scheduleRender(session,state);
  }
}
 return {needsInput:terminalAiBlockNeedsInput,finalize:finalizeTerminalAiActiveBlock,ended:terminalAiMarkSessionEnded,waiting:terminalAiMarkWaitingForInput,fromScreen:finalizeTerminalAiBlockFromScreen,captureCommand:captureTerminalAiBlockCommand,captureOutput:captureTerminalAiBlockOutput,disposeKey,dispose(){for(const key of timers.keys())disposeKey(key);}};
}
