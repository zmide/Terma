import type {TerminalZmodemState} from './terminal-zmodem-service';
import type {TerminalZmodemViewModel} from './TerminalZmodemView';
import type {ZmodemRuntimePort, ZmodemRuntimeSession, ZmodemDetection, ZmodemLibrary, ZmodemUtils} from './terminal-zmodem-types';
import {createZmodemTransferService} from './terminal-zmodem-transfer-service';
type Panel = HTMLElement & {__termaZmodemSession?: ZmodemRuntimeSession};
function errorText(error: unknown) {return error instanceof Error ? error.message : String(error || '');}
export function createTerminalZmodemRuntime(port: ZmodemRuntimePort, utils: ZmodemUtils) {
  const tr=port.tr;
  let libraryPromise: Promise<ZmodemLibrary> | null = null;
  const {createState:terminalZmodemState,
    commandInfo:terminalZmodemCommandInfo,rzNeedsOverwrite:terminalZmodemRzNeedsOverwrite,
    rzInputWithOverwrite:terminalZmodemRzInputWithOverwrite}=utils;
  function current(session: ZmodemRuntimeSession, state: TerminalZmodemState, generation=state.generation) {
    return !state.closed && !state.cancelled && session.zmodemState===state && state.generation===generation && port.current(session);
  }
  const transfers=createZmodemTransferService(port,utils,{
    current, render:terminalZmodemRender, cancel:terminalZmodemCancel, finish:terminalZmodemFinish
  });
  const {acceptOffer:terminalZmodemAcceptOffer,offer:terminalZmodemOffer,chooseFiles:terminalZmodemChooseFiles}=transfers;
function terminalZmodemDetectTimeoutMs() { return utils.detectTimeoutMs; }

function terminalZmodemMaxFileBytes() { return utils.maxFileBytes; }

function terminalZmodemTakePreparedInput(session: ZmodemRuntimeSession, fallback: string) {
  const state = terminalZmodemState(session);
  const value = typeof state.preparedInput === "string" ? state.preparedInput : fallback;
  state.preparedInput = null;
  return value;
}

function ensureTerminalZmodemLibrary(): Promise<ZmodemLibrary> {
  const library = port.library();
  if (library?.Sentry) return Promise.resolve(library);
  if (!libraryPromise) libraryPromise = port.loadScript('/vendor/zmodem.js').then(() => {
    const loaded = port.library();
    if (!loaded?.Sentry) throw new Error(tr('terminal:zmodem.component_load_failed', {defaultValue:'ZMODEM 组件未正确加载'}));
    return loaded;
  }).catch(error => { libraryPromise = null; throw error; });
  return libraryPromise;
}

function terminalZmodemFocus(session: ZmodemRuntimeSession) {
  if (session.key) port.focus(session.key);
  else {
    const state=terminalZmodemState(session), generation=state.generation;
    setTimeout(() => { if (current(session,state,generation)) session.term?.focus?.(); }, 0);
  }
}

function terminalZmodemPanel(session: ZmodemRuntimeSession) {
  const state = terminalZmodemState(session);
  const mount = session.mount || session.term?.element?.closest?.(".terminal-box");
  if (!mount) return null;
  if (state.panel?.isConnected && state.panel.parentElement === mount) return state.panel;
  state.panel?.remove();
  const panel = document.createElement("section") as Panel;
  panel.className = "terminal-zmodem-panel";
  panel.hidden = true;
  panel.setAttribute("aria-live", "polite");
  panel.__termaZmodemSession = session;
  panel.addEventListener("click", event => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-zmodem-action]");
    if (!button) return;
    const action = button.dataset.zmodemAction;
    if (action === "cancel") terminalZmodemCancel(session, tr("terminal:zmodem.user_cancelled", {defaultValue:"用户取消"}));
    else if (action === "receive") void terminalZmodemAcceptOffer(session, true);
    else if (action === "send") void terminalZmodemChooseFiles(session);
  });
  mount.appendChild(panel);
  state.panel = panel;
  session.panel = panel;
  return panel;
}

function terminalZmodemRender(session: ZmodemRuntimeSession, view: TerminalZmodemViewModel = {}) {
  const state=terminalZmodemState(session), panel=terminalZmodemPanel(session);
  if (!panel) return;
  state.view = view.hidden ? null : {...view,
    titleOptions:view.titleOptions ? {...view.titleOptions} : undefined,
    detailOptions:view.detailOptions ? {...view.detailOptions} : undefined,
    primaryLabelOptions:view.primaryLabelOptions ? {...view.primaryLabelOptions} : undefined};
  port.render(session, state.view || {hidden:true});
  panel.hidden=Boolean(view.hidden);
}

function syncTerminalZmodemLocalization(root: ParentNode = document) {
  const scope = root;
  const panels: Panel[] = [];
  if (scope instanceof HTMLElement && scope.matches(".terminal-zmodem-panel")) panels.push(scope as Panel);
  panels.push(...scope.querySelectorAll<Panel>(".terminal-zmodem-panel"));
  for (const panel of panels) {
    const session = panel.__termaZmodemSession;
    const view = session?.zmodemState?.view;
    if (view) terminalZmodemRender(session, view);
  }
}

function terminalZmodemSendBinaryMode(session: ZmodemRuntimeSession, enabled: boolean) {
  const socket = session.socket;
  session.zmodemBinaryMode = Boolean(enabled);
  if (socket?.readyState === 1) {
    socket.send(JSON.stringify({type:"terminal-binary-mode", enabled:Boolean(enabled)}));
  }
}

function terminalZmodemClearTimer(state: TerminalZmodemState) {
  if (state.timer != null) clearTimeout(state.timer);
  state.timer = null;
}

function terminalZmodemArm(session: ZmodemRuntimeSession, role: string) {
  const state = terminalZmodemState(session);
  terminalZmodemClearTimer(state);
  state.closed = false;
  state.generation++;
  const generation=state.generation;
  state.armed = true;
  state.cancelled = false;
  state.role = role;
  state.offeredFiles = 0;
  state.emptyReceive = false;
  state.armedOutputTail = "";
  terminalZmodemSendBinaryMode(session, true);
  terminalZmodemRender(session, {
    icon:role === "send" ? "upload" : "download",
    titleKey:role === "send" ? "terminal:zmodem.waiting_rz" : "terminal:zmodem.waiting_sz",
    titleOptions:{defaultValue:role === "send" ? "等待远端 rz 响应" : "等待远端 sz 响应"},
    detailKey:"terminal:zmodem.binary_mode_hint",
    detailOptions:{defaultValue:"已启用二进制传输模式；按 Ctrl+C 可取消"}
  });
  state.timer = setTimeout(() => {
    if (!current(session,state,generation) || !state.armed || state.active) return;
    state.timer=null;
    state.armed = false;
    terminalZmodemSendBinaryMode(session, false);
    terminalZmodemRender(session, {hidden:true});
    port.output(session, `\r\n${tr("terminal:zmodem.no_response_terminal", {defaultValue:"[未检测到 ZMODEM 响应，已恢复普通终端模式]"})}\r\n`);
    terminalZmodemFocus(session);
  }, terminalZmodemDetectTimeoutMs());
}

function terminalZmodemInputCommand(session: ZmodemRuntimeSession, data: string) {
  const raw = String(data || "");
  if (!/[\r\n]/.test(raw)) return "";
  const inline = raw.split(/[\r\n]/, 1)[0];
  const prompt = port.promptCommand(session);
  return inline.trim() || prompt || String(session.commandBuffer || "");
}

function terminalZmodemPrepareInput(session: ZmodemRuntimeSession, data: string) {
  const state = terminalZmodemState(session);
  state.preparedInput = null;
  if (state.cancelDraining) {
    if (String(data || "").includes("\x03")) terminalZmodemSendAbort(session);
    return true;
  }
  if (state.active || state.armed) {
    if (String(data || "").includes("\x03")) terminalZmodemCancel(session, "Ctrl+C");
    return true;
  }
  const commandInfo = terminalZmodemCommandInfo(terminalZmodemInputCommand(session, data));
  if (!commandInfo.role || !commandInfo.canStart) return false;
  const broadcastCount = port.broadcastCount();
  if (broadcastCount > 1) {
    port.notify(tr("terminal:zmodem.broadcast_blocked", {defaultValue:"终端同步期间不能启动 ZMODEM，请先退出终端同步"}), "error");
    return true;
  }
  if (!state.sentry) {
    port.notify(tr("terminal:zmodem.component_not_ready", {defaultValue:"ZMODEM 组件尚未就绪，请稍后重试"}), "error");
    return true;
  }
  if (terminalZmodemRzNeedsOverwrite(commandInfo)) state.preparedInput = terminalZmodemRzInputWithOverwrite(data);
  terminalZmodemArm(session, commandInfo.role);
  return false;
}

function terminalZmodemSendAbort(session: ZmodemRuntimeSession) {
  const socket = session.socket;
  if (socket?.readyState !== 1) return;
  socket.send(new Uint8Array([...Array(8).fill(24), ...Array(10).fill(8)]));
}

function terminalZmodemFinish(session: ZmodemRuntimeSession, message = "") {
  const state = terminalZmodemState(session);
  state.finishedZsession = state.zsession;
  terminalZmodemClearTimer(state);
  state.generation++;
  state.active = false;
  state.armed = false;
  state.offer = null;
  state.zsession = null;
  state.acceptBatch = false;
  state.sending = false;
  state.picker?.remove();
  state.picker = null;
  state.cancelDraining = false;
  state.discardUntil = 0;
  state.armedOutputTail = "";
  terminalZmodemSendBinaryMode(session, false);
  terminalZmodemRender(session, {hidden:true});
  if (message) port.output(session, `\r\n[ZMODEM] ${message}\r\n`);
  terminalZmodemFocus(session);
}

function terminalZmodemCancel(session: ZmodemRuntimeSession, reason = "") {
  const state = terminalZmodemState(session);
  if (!state.active && !state.armed) return false;
  const resolvedReason = reason || tr("terminal:zmodem.cancelled", {defaultValue:"已取消"});
  state.cancelled = true;
  terminalZmodemClearTimer(state);
  terminalZmodemSendAbort(session);
  try {
    if (state.zsession && !state.zsession.aborted?.()) state.zsession.abort();
  } catch {}
  state.active = false;
  state.armed = false;
  state.offer = null;
  state.zsession = null;
  state.acceptBatch = false;
  state.sentry = null;
  state.cancelDraining = true;
  state.discardUntil = Date.now() + 500;
  state.armedOutputTail = "";
  terminalZmodemRender(session, {hidden:true});
  port.output(session, `\r\n${tr("terminal:zmodem.cancelled_terminal", {reason:resolvedReason, defaultValue:`[ZMODEM] 传输已取消（${resolvedReason}）`})}\r\n`);
  terminalZmodemFocus(session);
  state.timer = setTimeout(() => {
    state.cancelDraining = false;
    state.discardUntil = 0;
    terminalZmodemSendBinaryMode(session, false);
    initializeTerminalZmodem(session);
    terminalZmodemFocus(session);
  }, 500);
  return true;
}

function terminalZmodemObserveArmedOutput(session: ZmodemRuntimeSession, value: unknown) {
  const state = terminalZmodemState(session);
  if (!state.armed || !(value instanceof ArrayBuffer)) return;
  const bytes = new Uint8Array(value);
  const start = Math.max(0, bytes.length - 1200);
  let text = "";
  for (let index = start; index < bytes.length; index += 1) {
    const byte = bytes[index];
    text += byte === 10 || byte === 13 || byte === 9 || (byte >= 32 && byte <= 126)
      ? String.fromCharCode(byte)
      : " ";
  }
  state.armedOutputTail = `${state.armedOutputTail}${text}`.slice(-1200);
  const error = state.armedOutputTail.match(/(?:^|[\r\n])[ \t]*(?:l?sz|l?rz):\s*([^\r\n]+)/i);
  if (!error) return;
  const detail = String(error[1] || "").trim();
  const message = /is not a file|not a regular file/i.test(detail)
    ? tr("terminal:zmodem.no_files_received")
    : /need at least one file/i.test(detail)
    ? tr("terminal:zmodem.sz_file_required", {defaultValue:"sz 需要指定远端文件，例如 sz filename"})
    : /garbage on commandline/i.test(detail)
      ? tr("terminal:zmodem.rz_no_remote_filename", {defaultValue:"rz 用于接收本机文件，请直接运行 rz，不要附加远端文件名"})
      : /cannot open/i.test(detail)
        ? tr("terminal:zmodem.sz_cannot_open", {defaultValue:"远端 sz 未启动：文件不存在或无法读取"})
        : tr("terminal:zmodem.remote_program_not_started", {program:state.role === "send" ? "rz" : "sz", detail, defaultValue:`远端 ${state.role === "send" ? "rz" : "sz"} 未启动：${detail}`});
  terminalZmodemClearTimer(state);
  state.armed = false;
  state.active = false;
  state.armedOutputTail = "";
  terminalZmodemSendBinaryMode(session, false);
  terminalZmodemRender(session, {hidden:true});
  port.notify(message, "info");
  terminalZmodemFocus(session);
  return true;
}

function terminalZmodemDetected(session: ZmodemRuntimeSession, detection: ZmodemDetection) {
  const state = terminalZmodemState(session);
  try {
    if (state.closed || !port.current(session)) return;
    state.picker?.remove();
    state.picker=null;
    state.sending=false;
    const generation=++state.generation;
    state.finishedZsession = null;
    const zsession = detection.confirm();
    terminalZmodemClearTimer(state);
    state.active = true;
    state.armed = false;
    state.cancelled = false;
    state.role = detection.get_session_role();
    state.batchTransferred = 0;
    state.offeredFiles = 0;
    state.emptyReceive = false;
    state.zsession = zsession;
    terminalZmodemSendBinaryMode(session, true);
    zsession.on("session_end", () => {
      if (!current(session,state,generation) || state.zsession!==zsession) return;
      if (state.role === "receive" && !state.offeredFiles) {
        terminalZmodemEmptyReceive(session);
        return;
      }
      terminalZmodemFinish(session, state.role === "receive"
        ? tr("terminal:zmodem.receive_session_finished", {defaultValue:"接收会话已结束"})
        : tr("terminal:zmodem.send_session_finished", {defaultValue:"发送会话已结束"}));
    });
    if (state.role === "receive") {
      zsession.on("offer", offer => {if(current(session,state,generation) && state.zsession===zsession) terminalZmodemOffer(session, offer);});
      terminalZmodemRender(session, {
        icon:"download",
        titleKey:"terminal:zmodem.sz_detected",
        titleOptions:{defaultValue:"已检测到 sz"},
        detailKey:"terminal:zmodem.reading_remote_file",
        detailOptions:{defaultValue:"正在读取远端文件信息；按 Ctrl+C 可取消"}
      });
      Promise.resolve(zsession.start()).catch(error => {
        if (current(session,state,generation)) terminalZmodemCancel(session, errorText(error) || tr("terminal:zmodem.receive_start_failed", {defaultValue:"接收启动失败"}));
      });
    } else {
      terminalZmodemRender(session, {
        icon:"upload",
        titleKey:"terminal:zmodem.rz_detected",
        titleOptions:{defaultValue:"已检测到 rz"},
        detailKey:"terminal:zmodem.choose_files_hint",
        detailOptions:{defaultValue:"选择本机文件后开始上传；文件不会离开当前 SSH 会话"},
        primaryAction:"send",
        primaryIcon:"files",
        primaryLabelKey:"terminal:zmodem.choose_files",
        primaryLabelOptions:{defaultValue:"选择文件"}
      });
    }
  } catch (error) {
    terminalZmodemCancel(session, errorText(error) || String(error));
  }
}

function terminalZmodemEmptyReceive(session: ZmodemRuntimeSession) {
  const state = terminalZmodemState(session);
  if (!state.emptyReceive) {
    state.emptyReceive = true;
    const message = tr("terminal:zmodem.no_files_received");
    terminalZmodemFinish(session, message);
    port.notify(message, "info");
  }
  const previous = state.sentry;
  Promise.resolve().then(() => {
    if (!state.closed && port.current(session) && previous && state.sentry === previous && state.emptyReceive && !state.active && !state.armed) initializeTerminalZmodem(session);
  });
}

function initializeTerminalZmodem(session: ZmodemRuntimeSession) {
  const state = terminalZmodemState(session);
  terminalZmodemClearTimer(state);
  state.closed = false;
  state.cancelled = false;
  state.generation++;
  state.picker?.remove();
  state.picker = null;
  state.sending = false;
  state.finishedZsession = null;
  state.active = false;
  state.armed = false;
  state.cancelled = false;
  state.cancelDraining = false;
  state.discardUntil = 0;
  state.batchTransferred = 0;
  state.zsession = null;
  state.offer = null;
  terminalZmodemRender(session, {hidden:true});
  if (!port.library()?.Sentry) {
    state.sentry = null;
    return false;
  }
  const library = port.library();
  if (!library) return false;
  const parser = new library.Sentry({
    to_terminal:octets => {
      if (!state.closed && state.sentry === parser && port.current(session)) port.output(session, new Uint8Array(octets));
    },
    sender:octets => {
      if (!state.closed && state.sentry===parser && port.current(session) && session.socket?.readyState === 1) session.socket.send(new Uint8Array(octets));
    },
    on_detect:detection => {if(!state.closed && state.sentry===parser && port.current(session)) terminalZmodemDetected(session, detection);},
    on_retract:() => {}
  });
  state.sentry = parser;
  return true;
}

function consumeTerminalZmodemOutput(session: ZmodemRuntimeSession, value: unknown) {
  const state = terminalZmodemState(session);
  if (state.cancelDraining && value instanceof ArrayBuffer && Date.now() <= state.discardUntil) return true;
  if (state.closed || !port.current(session) || !state.sentry || !(value instanceof ArrayBuffer)) return false;
  try {
    if (terminalZmodemObserveArmedOutput(session, value)) {
      initializeTerminalZmodem(session);
      return true;
    }
    state.sentry.consume(value);
  } catch (error) {
    if (/Peer aborted session|peer_aborted/i.test(errorText(error)) && (state.emptyReceive || state.role === "receive" && !state.offeredFiles && (state.active || state.armed))) {
      terminalZmodemEmptyReceive(session);
      return true;
    }
    if (!state.cancelled) {
      terminalZmodemCancel(session, errorText(error) || String(error));
      port.notify(errorText(error) || tr("terminal:zmodem.protocol_error", {defaultValue:"ZMODEM 协议错误"}), "error");
    }
  }
  return true;
}

function closeTerminalZmodem(session: ZmodemRuntimeSession) {
  if (!session?.zmodemState) return;
  const state = session.zmodemState;
  terminalZmodemClearTimer(state);
  if ((state.active || state.armed) && session.socket?.readyState === 1) {
    try { terminalZmodemCancel(session, tr("terminal:zmodem.terminal_closed", {defaultValue:"终端已关闭"})); } catch {}
  }
  terminalZmodemClearTimer(state);
  if (state.active || state.armed || state.cancelled) terminalZmodemSendBinaryMode(session, false);
  state.generation++;
  state.closed = true;
  state.cancelled = true;
  state.picker?.remove();
  state.picker = null;
  state.sending = false;
  state.preparedInput = null;
  state.panel?.remove();
  port.releaseView(session);
  if (session.panel === state.panel) session.panel = null;
  state.panel = null;
  state.view = null;
  state.sentry = null;
  state.zsession = null;
  state.active = false;
  state.armed = false;
  state.cancelDraining = false;
  state.discardUntil = 0;
  state.armedOutputTail = "";
}
return {...transfers,ensureLibrary:ensureTerminalZmodemLibrary,takePreparedInput:terminalZmodemTakePreparedInput,
 focus:terminalZmodemFocus,panel:terminalZmodemPanel,render:terminalZmodemRender,localize:syncTerminalZmodemLocalization,
 binaryMode:terminalZmodemSendBinaryMode,clearTimer:terminalZmodemClearTimer,arm:terminalZmodemArm,inputCommand:terminalZmodemInputCommand,
 prepareInput:terminalZmodemPrepareInput,sendAbort:terminalZmodemSendAbort,finish:terminalZmodemFinish,cancel:terminalZmodemCancel,
 observeArmedOutput:terminalZmodemObserveArmedOutput,detected:terminalZmodemDetected,emptyReceive:terminalZmodemEmptyReceive,
 initialize:initializeTerminalZmodem,consume:consumeTerminalZmodemOutput,close:closeTerminalZmodem};
}
