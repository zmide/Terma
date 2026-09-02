/**
 * Event/action bindings for the terminal AI panel.
 * Loaded after app-terminal-ai.js so the controller stays below the frontend
 * module boundary while all action handlers remain available at runtime.
 */
async function copyTerminalAiResponse(key, turnId="") {
  const state = terminalAiStateForKey(key);
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

async function copyTerminalAiCode(value) {
  if (value) await copyText(String(value));
}

async function streamTerminalAiRequest(payload, handlers={}) {
  const response = await fetch("/api/ai/chat", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({...payload, stream:true}),
    signal:handlers.signal
  });
  if (!response.ok) throw await apiErrorFromResponse(response, tr("terminal:ai.request_failed", {defaultValue:"AI 请求失败"}));
  if (!response.body) throw new Error(tr("terminal:ai.empty_stream", {defaultValue:"AI 服务未返回流式内容"}));
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let donePayload = {};
  let streamDone = false;
  const consume = frame => {
    const lines = String(frame || "").split(/\r?\n/);
    let eventName = "message";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim() || "message";
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    const raw = dataLines.join("\n");
    if (raw === "[DONE]") { streamDone = true; return; }
    let data = {};
    try { data = JSON.parse(raw); } catch { return; }
    if (eventName === "error" || data.error_code) throw new Error(String(data.error || tr("terminal:ai.request_failed", {defaultValue:"AI 请求失败"})));
    if (eventName === "delta" && data.delta && handlers.onDelta?.(String(data.delta)) === false) {
      streamDone = true;
      void reader.cancel().catch(() => {});
    }
    if (eventName === "reasoning" && data.delta) handlers.onReasoning?.(String(data.delta));
    if (eventName === "done") { donePayload = data; handlers.onDone?.(data); streamDone = true; }
  };
  while (!streamDone) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value || new Uint8Array(), {stream:!chunk.done});
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || "";
    for (const frame of frames) {
      consume(frame);
      if (streamDone) break;
    }
    if (chunk.done) {
      if (buffer.trim()) consume(buffer);
      break;
    }
  }
  return donePayload;
}

function terminalAiPromptSignature(prompt) {
  if (!prompt) return "";
  return `${Number(prompt.row || 0)}|${String(prompt.command || "")}|${Number(prompt.cursor || 0)}`;
}
function terminalAiAgentHasFreshPrompt(session, block, prompt) {
  if (!block?.agentCommand) return true;
  const before = block.promptBefore;
  if (before && prompt) return terminalAiPromptSignature(before) !== terminalAiPromptSignature(prompt);
  return Number(session?.terminalOutputSequence || 0) > Number(block.outputSequenceBefore || 0)
    && Number(block.lastOutputAt || 0) >= Number(block.sentAt || block.startedAt || 0);
}
function terminalAiScheduleStableCompletion(session, block) {
  if (!session || !block || block.completionTimer) return;
  block.completionTimer = setTimeout(() => {
    block.completionTimer = 0;
    if (session.aiActiveBlockId === block.id) finalizeTerminalAiBlockFromScreen(session);
  }, TERMINAL_AI_COMPLETION_STABILITY_MS);
}

function terminalAiSanitizeWorkflowCommand(value) {
  let command = String(value || "").replace(/\r\n?/g, "\n");
  command = command.replace(/\b([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+)(?=[:\s\/])/g, "<user>@<host>");
  command = command.replace(/(?:\/home\/|\/Users\/|C:\\Users\\)[^\s'\";&|]+/gi, "<path>");
  command = command.replace(/\b(?:token|password|passwd|secret|api[_-]?key)\s*=\s*[^\s;&|]+/gi, match => match.replace(/=.*/, "=<secret>"));
  return command.slice(0, 100000);
}

async function openLogAiAssistant(tabKey=activeTabKey) {
  const state = currentLogViewerState(tabKey);
  const view = logViewerElement(tabKey);
  if (!state || !view) return;
  const selected = String(window.getSelection?.()?.toString?.() || "").trim();
  const context = (selected || state.text || "").slice(0, 16000);
  if (!context) return notify(tr("terminal:ai.log_empty", {defaultValue:"当前日志窗口没有可分析的内容"}), "info");
  const modal = $("modal");
  modal.innerHTML = `<div class="modal-card wide terminal-ai-log-modal" role="dialog" aria-modal="true" aria-labelledby="terminalAiLogTitle"><div class="modal-title-row"><div><h2 id="terminalAiLogTitle">${esc(tr("terminal:ai.log_title", {defaultValue:"日志 AI 分析"}))}</h2><span>${esc(tr("terminal:ai.log_privacy", {defaultValue:"发送前请检查上下文；日志中的密码、令牌和私钥会被自动遮蔽。"}))}</span></div><button class="icon-button" type="button" data-action="terminal-ai-modal-close" title="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}" aria-label="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}">${icon("x")}</button></div><label>${esc(tr("terminal:ai.log_context", {defaultValue:"发送给 AI 的日志上下文"}))}</label><textarea id="terminalAiLogContext" class="terminal-ai-log-context" rows="10" maxlength="16000">${esc(context)}</textarea><label>${esc(tr("terminal:ai.log_prompt_placeholder", {defaultValue:"例如：找出最可能的根因，并给出排查顺序"}))}</label><input id="terminalAiLogPrompt" value="" placeholder="${escAttr(tr("terminal:ai.log_prompt_placeholder", {defaultValue:"例如：找出最可能的根因，并给出排查顺序"}))}"><div id="terminalAiLogResponse" class="terminal-ai-log-response" hidden></div><div class="actions"><button class="primary" type="button" data-action="terminal-ai-log-submit">${icon("sparkles")}<span>${esc(tr("terminal:ai.log_analyze", {defaultValue:"分析日志"}))}</span></button><button type="button" data-action="terminal-ai-modal-close">${esc(tr("common:actions.cancel", {defaultValue:"取消"}))}</button></div></div>`;
  modal.hidden = false;
  refreshIcons();
}

async function submitLogAiAssistant() {
  if (!terminalAiConfigured()) return notify(tr("terminal:ai.disabled", {defaultValue:"请先在设置中启用终端 AI"}), "info");
  if (!terminalAiModelConfigured()) return notify(tr("terminal:ai.model_required", {defaultValue:"请先在设置中选择 AI 模型"}), "info");
  const context = String($("terminalAiLogContext")?.value || "").trim();
  const prompt = String($("terminalAiLogPrompt")?.value || "").trim() || tr("terminal:ai.log_prompt_placeholder", {defaultValue:"请分析这段日志并给出排查建议。"});
  const response = $("terminalAiLogResponse");
  const button = document.querySelector('[data-action="terminal-ai-log-submit"]');
  if (!context || !response) return;
  setButtonBusy(button, true, tr("terminal:ai.sending", {defaultValue:"请求中"}));
  response.hidden = false;
  let answer = "";
  try {
    terminalAiLogController?.abort?.();
    terminalAiLogController = new AbortController();
    response.textContent = "";
    await streamTerminalAiRequest({message:prompt, locale:normalizeTermaLanguage(document.documentElement.lang), permission:"suggest", contexts:[{source:"log", title:tr("terminal:ai.log_full_window", {defaultValue:"当前日志窗口"}), text:context}]}, {
      signal:terminalAiLogController.signal,
      onDelta:delta => { answer += delta; response.innerHTML = renderTerminalAiMarkdown("", answer, {actions:false}); response.scrollTop = response.scrollHeight; }
    });
  } catch (error) {
    if (!terminalAiLogController?.signal?.aborted) response.textContent = error.message || tr("terminal:ai.request_failed", {defaultValue:"AI 请求失败"});
  } finally {
    terminalAiLogController = null;
    setButtonBusy(button, false);
  }
}

async function executeTerminalAiCommand(key, command, options={}) {
  const state = terminalAiStateForKey(key);
  const session = terminalSessions.get(key);
  const value = terminalAiCommandFromCodeBlock(command);
  if (!value || !session) return false;
  if (state.mode === "chat") {
    const error = tr("terminal:ai.chat_execution_disabled", {defaultValue:"聊天模式只读终端内容，不执行命令；请切换到 Agent 模式"});
    if (options.details === true) return {sent:false, chatMode:true, blockId:"", command:value, error};
    notify(error, "info");
    return false;
  }
  const syntaxIssue = typeof terminalAiCommandSyntaxIssue === "function" ? terminalAiCommandSyntaxIssue(value) : "";
  if (syntaxIssue) {
    if (options.details === true) return {sent:false, syntaxError:true, blockId:"", command:value, error:syntaxIssue};
    notify(syntaxIssue, "error");
    return false;
  }
  if (session.remoteSessionEnded || !session.socket || session.socket.readyState !== WebSocket.OPEN) {
    const error = tr("terminal:ai.agent_session_ended", {defaultValue:"终端会话已结束，已停止继续执行；请重新连接后恢复任务。"});
    if (options.details === true) return {sent:false, sessionEnded:true, blockId:"", command:value, error};
    notify(error, "error");
    return false;
  }
  if (state.permission === "suggest") {
    notify(tr("terminal:ai.execution_disabled", {defaultValue:"当前为仅建议模式，不能直接执行命令"}), "info");
    return options.details === true ? {sent:false, blockId:"", command:value} : false;
  }
  if (session.sensitiveInput) {
    notify(tr("terminal:ai.sensitive_blocked", {defaultValue:"终端正在输入敏感信息，已阻止 Agent 发送命令"}), "error");
    return false;
  }
  if (session.agentCommandInFlight) {
    const details = {sent:false, busy:true, blockId:"", command:value};
    if (options.details === true) return details;
    notify(tr("terminal:ai.command_busy", {defaultValue:"上一条 Agent 命令仍在执行，已等待终端返回提示符"}), "info");
    return false;
  }
  const promptState = typeof terminalPromptStateAtRow === "function" ? terminalPromptStateAtRow(session) : null;
  const pendingInput = String(session.commandBuffer || "").trim() || String(promptState?.command || "").trim();
  if (pendingInput) {
    const details = {sent:false, busy:true, blockId:"", command:value, inputPending:true};
    if (options.details === true) return details;
    notify(tr("terminal:ai.command_input_pending", {defaultValue:"终端输入区还有未提交内容，请先执行或清空后再让 Agent 发送命令"}), "info");
    return false;
  }
  const risk = options.risk || terminalAiCommandRisk(value, {userPrompt:options.userPrompt});
  if (state.permission !== "full" && options.auto === true && !risk.safe) return false;
  if (state.permission !== "full" && options.auto !== true && (state.permission === "confirm" || !risk.safe)) {
    const confirmed = await requestTerminalAiApproval(key, value, risk, options);
    if (!confirmed) return options.details === true ? {sent:false, denied:true, blockId:"", command:value, risk} : false;
  }
  if (options.taskId && risk.safe !== true && options.checkpointId) {
    const backedUp = await terminalAiRunCheckpointBackup(key, options.taskId, options.checkpointId, options.signal);
    if (!backedUp) return options.details === true ? {sent:false, checkpointFailed:true, blockId:"", command:value, risk} : false;
  }
  const startedAt = Date.now();
  const sent = sendTerminalData(key, `${value}\r`, {trackCommand:true, agentCommand:value, focus:false});
  const block = sent ? state.blocks.slice().reverse().find(item => item.command === value && Number(item.startedAt || 0) >= startedAt - 5) : null;
  const blockId = block?.id || session.aiActiveBlockId || "";
  if (sent && blockId) session.agentCommandInFlight = {blockId, command:value, startedAt};
  if (sent && options.auto !== true) notify(tr("terminal:ai.executed", {defaultValue:"命令已发送到终端"}), "success");
  if (sent) renderTerminalAiPanel(key);
  return options.details === true ? {sent, blockId, command:value, risk} : sent;
}

function waitForTerminalAiCommandCompletion(key, blockId, options={}) {
  const state = terminalAiStateForKey(key);
  return new Promise(resolve => {
    const startedAt = Date.now();
    const check = () => {
      const session = terminalSessions.get(key);
      if (options.signal?.aborted) {
        if (session?.agentCommandInFlight?.blockId === String(blockId)) session.agentCommandInFlight = null;
        return resolve(null);
      }
      const block = state.blocks.find(item => String(item.id) === String(blockId));
      if (block && terminalAiBlockNeedsInput(block)) {
        terminalAiMarkWaitingForInput(key, block);
        if (session?.agentCommandInFlight?.blockId === String(blockId)) session.agentCommandInFlight = null;
        return resolve(block);
      }
      if (block?.completedAt) {
        renderTerminalAiPanel(key);
        if (session?.agentCommandInFlight?.blockId === String(blockId)) session.agentCommandInFlight = null;
        return resolve(block);
      }
      if (Date.now() - startedAt >= TERMINAL_AI_COMMAND_WAIT_MS) {
        if (block) {
          block.timedOutAt = Date.now();
          renderTerminalAiPanel(key);
        }
        return resolve(block || null);
      }
      setTimeout(check, 100);
    };
    check();
  });
}

async function maybeAutoExecuteTerminalAiCommand(key, turn, options={}) {
  const state = terminalAiStateForKey(key);
  if (state.permission === "suggest") return {status:"suggest"};
  const command = terminalAiResponseCommands(turn.answer)[0] || "";
  if (!command) return {status:"none"};
  const risk = terminalAiCommandRisk(command, {userPrompt:options.userPrompt});
  const automatic = state.permission === "full" || (state.permission === "controlled" && risk.safe);
  const executeCommand = options.executeCommand || executeTerminalAiCommand;
  const result = await executeCommand(key, command, {auto:automatic, details:true, risk, userPrompt:options.userPrompt});
  if (!result?.sent) return {status:"denied", command};
  return {status:"sent", command:result.command, blockId:result.blockId};
}

function stopTerminalAiBlock(key, blockId) {
  const state = terminalAiStateForKey(key);
  const block = state.blocks.find(item => String(item.id) === String(blockId || ""));
  if (!block || block.completedAt || block.waitingForInput) return false;
  const sent = sendTerminalData(key, String.fromCharCode(3), {trackCommand:false, focus:true});
  if (!sent) return false;
  block.interruptRequestedAt = Date.now();
  renderTerminalAiPanel(key);
  notify(tr("terminal:ai.command_interrupt_sent", {defaultValue:"已发送中止信号，等待终端返回提示符"}), "info");
  return true;
}

function terminalAiResumeAfterWaitingInput(key, waiting, baselineOutput) {
  const startedAt = Date.now();
  const poll = () => {
    const state = terminalAiStateForKey(key);
    if (waiting?.taskId && state.activeTaskId && String(state.activeTaskId) !== String(waiting.taskId)) return;
    if (state.busy) {
      if (Date.now() - startedAt < TERMINAL_AI_COMMAND_WAIT_MS) setTimeout(poll, 120);
      return;
    }
    const block = state.blocks.find(item => String(item.id) === String(waiting?.blockId || ""));
    const output = String(block?.output || "");
    const changed = output.length > Number(baselineOutput?.length || 0);
    const resolved = changed && block && !terminalAiBlockNeedsInput(block);
    if (resolved || Date.now() - startedAt >= TERMINAL_AI_COMMAND_WAIT_MS) {
      if (!waiting?.taskId) return;
      const context = block
        ? [{source:"terminal-block", title:block.command, text:`$ ${block.command}\n${terminalAiStripControl(block.output || "")}`}, ...(Array.isArray(waiting.contexts) ? waiting.contexts.filter(item => item?.source !== "terminal-block") : [])]
        : (Array.isArray(waiting.contexts) ? waiting.contexts : []);
      const prompt = tr("terminal:ai.agent_input_provided", {defaultValue:"用户已完成终端交互输入，请继续分析最新输出。"});
      void submitTerminalAiRequest(key, `${prompt}\n${String(waiting.originalPrompt || "")}`.trim(), context, {agentTask:true, taskId:waiting.taskId, resume:true, displayPrompt:waiting.originalPrompt || prompt});
      return;
    }
    setTimeout(poll, 120);
  };
  setTimeout(poll, 180);
}

async function submitTerminalAiWaitingInput(key, rawValue) {
  const state = terminalAiStateForKey(key);
  const waiting = state.agentWaitingForInput;
  const value = String(rawValue || "").trim();
  if (!waiting) return false;
  if (!value) {
    notify(tr("terminal:ai.waiting_input_required", {defaultValue:"请先输入要发送到终端的内容"}), "info");
    return false;
  }
  const block = state.blocks.find(item => String(item.id) === String(waiting.blockId || ""));
  const baseline = block?.output || "";
  if (!sendTerminalData(key, `${value}\r`, {trackCommand:false, focus:true})) return false;
  if (block) block.waitingForInput = false;
  state.agentWaitingForInput = null;
  terminalAiPersistState(key, state);
  renderTerminalAiPanel(key);
  terminalAiResumeAfterWaitingInput(key, waiting, baseline);
  return true;
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("terminal-ai-toggle", ({element}) => toggleTerminalAiPanel(element.dataset.terminalAiKey || activeTabKey));
  registerTermaAction("terminal-ai-close", ({element}) => { const key = element.dataset.terminalAiKey || activeTabKey; terminalAiStateForKey(key).open = false; renderTerminalAiPanel(key); });
  registerTermaAction("terminal-ai-mode", ({element}) => terminalAiSetMode(element.dataset.terminalAiKey || activeTabKey, element.dataset.terminalAiMode || "agent"));
  registerTermaAction("terminal-ai-minimize", ({element}) => {
    const key = element.dataset.terminalAiKey || activeTabKey;
    const layout = terminalAiLayoutSettings();
    updateTerminalAiLayout(key, {minimized:!layout.minimized});
  });
  registerTermaAction("terminal-ai-layout-mode", ({element}) => {
    const key = element.dataset.terminalAiKey || activeTabKey;
    const mode = element.value === "floating" ? "floating" : "fixed";
    const panel = terminalAiElementForKey(key);
    const rect = panel?.getBoundingClientRect?.();
    updateTerminalAiLayout(key, {mode, minimized:false, ...(mode === "floating" && rect ? {left:Math.max(0, Math.round(rect.left)), top:Math.max(0, Math.round(rect.top)), height:Math.max(260, Math.round(rect.height))} : {})});
  });
  registerTermaAction("terminal-ai-drag", ({event}) => terminalAiBeginPointer(event, "drag"));
  registerTermaAction("terminal-ai-resize", ({event, element}) => {
    const panel = element.closest(".terminal-ai-panel");
    terminalAiBeginPointer(event, panel?.classList.contains("terminal-ai-layout-floating") ? "floating-resize" : "fixed-resize");
  });
  registerTermaAction("terminal-ai-permission", async ({element}) => {
    const key = element.dataset.terminalAiKey || activeTabKey;
    const state = terminalAiStateForKey(key);
    const previous = state.permission;
    const next = ["suggest", "confirm", "controlled", "full"].includes(element.value) ? element.value : "confirm";
    if (next === "full" && previous !== "full") {
      const confirmed = await confirmModal(tr("terminal:ai.permission_full_warning", {defaultValue:"完全访问会允许 Agent 直接执行删除、写入、提权、安装、网络和服务变更等任何命令。仅在你完全信任当前任务和模型时启用。是否继续？"}), tr("terminal:ai.permission_full_title", {defaultValue:"启用完全访问"}), tr("terminal:ai.permission_full_enable", {defaultValue:"继续启用"}), tr("common:actions.cancel", {defaultValue:"取消"}));
      if (!confirmed) { element.value = previous; renderTerminalAiPanel(key); return; }
    }
    state.permission = next;
    if (next === "full" && state.pendingApproval && state.pendingApproval.kind !== "mcp") settleTerminalAiApproval(key, true);
    renderTerminalAiPanel(key);
  });
  registerTermaAction("terminal-ai-model", ({element}) => {
    const key = element.dataset.terminalAiKey || activeTabKey;
    const state = terminalAiStateForKey(key);
    if (element.value === "__custom__") {
      state.modelCustom = true;
      renderTerminalAiPanel(key);
      terminalAiElementForKey(key)?.querySelector(`[data-input-action="terminal-ai-model-custom"]`)?.focus();
      return;
    }
    state.modelCustom = false;
    state.model = String(element.value || "").trim();
    renderTerminalAiPanel(key);
  });
  registerTermaAction("terminal-ai-model-custom", ({element}) => {
    const key = element.dataset.terminalAiKey || activeTabKey;
    terminalAiStateForKey(key).model = String(element.value || "").trim().slice(0, 200);
  });
  registerTermaAction("terminal-ai-reasoning", ({element}) => {
    const key = element.dataset.terminalAiKey || activeTabKey;
    terminalAiStateForKey(key).reasoning_effort = ["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(element.value) ? element.value : "none";
    renderTerminalAiPanel(key);
  });
  registerTermaAction("terminal-ai-deep-thinking", ({element}) => {
    const key = element.dataset.terminalAiKey || activeTabKey;
    terminalAiStateForKey(key).deep_thinking = element.checked === true;
    renderTerminalAiPanel(key);
  });
  registerTermaAction("terminal-ai-select-block", ({element}) => { const key = element.dataset.terminalAiKey || activeTabKey; terminalAiStateForKey(key).selectedBlockId = element.dataset.blockId || ""; renderTerminalAiPanel(key); });
  registerTermaAction("terminal-ai-block-action", ({element}) => askTerminalAiForBlock(element.dataset.terminalAiKey || activeTabKey, element.dataset.blockId, element.dataset.aiAction));
  registerTermaAction("terminal-ai-block-stop", ({element}) => stopTerminalAiBlock(element.dataset.terminalAiKey || activeTabKey, element.dataset.blockId));
  registerTermaAction("terminal-ai-submit", ({event, element}) => { event.preventDefault(); return submitTerminalAiPrompt(element.dataset.terminalAiKey || activeTabKey); });
  registerTermaAction("terminal-ai-prompt-keydown", ({event, element}) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    return submitTerminalAiPrompt(element.dataset.terminalAiKey || activeTabKey);
  });
  registerTermaAction("terminal-ai-stop", ({event, element}) => { event.preventDefault(); event.stopPropagation(); stopTerminalAiRequest(element.dataset.terminalAiKey || activeTabKey); });
  registerTermaAction("terminal-ai-new-session", ({element}) => terminalAiNewSession(element.dataset.terminalAiKey || activeTabKey));
  registerTermaAction("terminal-ai-history", ({element}) => terminalAiHistoryModal(element.dataset.terminalAiKey || activeTabKey));
  registerTermaAction("terminal-ai-history-load", ({element}) => terminalAiLoadSession(element.dataset.terminalAiKey || activeTabKey, element.dataset.sessionId || ""));
  registerTermaAction("terminal-ai-history-delete", ({element}) => terminalAiDeleteSession(element.dataset.terminalAiKey || activeTabKey, element.dataset.sessionId || ""));
  registerTermaAction("terminal-ai-approval-approve", ({element}) => settleTerminalAiApproval(element.dataset.terminalAiKey || activeTabKey, true));
  registerTermaAction("terminal-ai-approval-insert", ({element}) => insertPendingTerminalAiApproval(element.dataset.terminalAiKey || activeTabKey));
  registerTermaAction("terminal-ai-approval-reject", ({element}) => settleTerminalAiApproval(element.dataset.terminalAiKey || activeTabKey, false));
  registerTermaAction("terminal-ai-approval-stop", ({element}) => stopTerminalAiRequest(element.dataset.terminalAiKey || activeTabKey));
  registerTermaAction("terminal-ai-waiting-input-submit", ({event, element}) => {
    event.preventDefault();
    const key = element.dataset.terminalAiKey || activeTabKey;
    const input = element.querySelector(`[data-terminal-ai-waiting-input="${CSS.escape(String(key))}"]`);
    const value = String(input?.value || "");
    return submitTerminalAiWaitingInput(key, value).then(sent => {
      if (sent && input) input.value = "";
    });
  });
  registerTermaAction("terminal-ai-attachment-open", ({element}) => terminalAiElementForKey(element.dataset.terminalAiKey || activeTabKey)?.querySelector(".terminal-ai-attachment-input")?.click());
  registerTermaAction("terminal-ai-attachments-select", ({element}) => addTerminalAiAttachments(element.dataset.terminalAiKey || activeTabKey, element.files));
  registerTermaAction("terminal-ai-attachment-remove", ({element}) => {
    const state = terminalAiStateForKey(element.dataset.terminalAiKey || activeTabKey);
    state.attachments.splice(Number(element.dataset.attachmentIndex || 0), 1);
    renderTerminalAiPanel(element.dataset.terminalAiKey || activeTabKey);
  });
  registerTermaAction("terminal-ai-insert-command", ({element}) => insertTerminalAiCommand(element.dataset.terminalAiKey || activeTabKey, element.dataset.command || ""));
  registerTermaAction("terminal-ai-execute-command", ({element}) => executeTerminalAiCommand(element.dataset.terminalAiKey || activeTabKey, element.dataset.command || ""));
  registerTermaAction("terminal-ai-copy-code", ({element}) => copyTerminalAiCode(element.dataset.code || ""));
  registerTermaAction("terminal-ai-save-snippet", ({element}) => {
    const command = String(element.dataset.command || "").trim();
    if (!command || typeof openCommandSnippetEditor !== "function") return;
    const parameterized = typeof commandSnippetVariables === "function" && commandSnippetVariables(command).length > 0;
    const sanitized = terminalAiSanitizeWorkflowCommand(command);
    openCommandSnippetEditor(0, {name:tr(parameterized ? "terminal:ai.ai_workflow_name" : "terminal:ai.ai_snippet_name", {defaultValue:parameterized ? "AI Workflow" : "AI 命令"}), command:sanitized, description:sanitized !== command ? tr("terminal:ai.workflow_scrub_hint", {defaultValue:"已移除主机、用户、路径和疑似密钥，请在保存前补充参数。"}) : "", returnTo:"terminal"});
  });
  registerTermaAction("terminal-ai-copy-response", ({element}) => copyTerminalAiResponse(element.dataset.terminalAiKey || activeTabKey, element.dataset.turnId || ""));
  registerTermaAction("terminal-ai-modal-close", () => { const modal = $("modal"); modal.hidden = true; modal.innerHTML = ""; });
  registerTermaAction("terminal-ai-log-submit", () => submitLogAiAssistant());
  registerTermaAction("log-ai-open", ({element}) => openLogAiAssistant(element.dataset.tabKey || activeTabKey));
}

if (typeof registerTermaI18nRenderer === "function") registerTermaI18nRenderer(() => {
  for (const [key, state] of terminalAiStates) if (state.open) renderTerminalAiPanel(key);
});
