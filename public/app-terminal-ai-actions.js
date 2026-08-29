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
  if (answer) await copyText(answer);
}

async function copyTerminalAiCode(value) {
  if (value) await copyText(String(value));
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("terminal-ai-toggle", ({element}) => toggleTerminalAiPanel(element.dataset.terminalAiKey || activeTabKey));
  registerTermaAction("terminal-ai-close", ({element}) => { const key = element.dataset.terminalAiKey || activeTabKey; terminalAiStateForKey(key).open = false; renderTerminalAiPanel(key); });
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
    terminalAiStateForKey(key).reasoning_effort = ["none", "low", "medium", "high"].includes(element.value) ? element.value : "none";
    renderTerminalAiPanel(key);
  });
  registerTermaAction("terminal-ai-deep-thinking", ({element}) => {
    const key = element.dataset.terminalAiKey || activeTabKey;
    terminalAiStateForKey(key).deep_thinking = element.checked === true;
    renderTerminalAiPanel(key);
  });
  registerTermaAction("terminal-ai-select-block", ({element}) => { const key = element.dataset.terminalAiKey || activeTabKey; terminalAiStateForKey(key).selectedBlockId = element.dataset.blockId || ""; renderTerminalAiPanel(key); });
  registerTermaAction("terminal-ai-block-action", ({element}) => askTerminalAiForBlock(element.dataset.terminalAiKey || activeTabKey, element.dataset.blockId, element.dataset.aiAction));
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
  registerTermaAction("terminal-ai-approval-reject", ({element}) => settleTerminalAiApproval(element.dataset.terminalAiKey || activeTabKey, false));
  registerTermaAction("terminal-ai-approval-stop", ({element}) => stopTerminalAiRequest(element.dataset.terminalAiKey || activeTabKey));
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
  registerTermaAction("terminal-ai-copy-response", ({element}) => copyTerminalAiResponse(element.dataset.terminalAiKey || activeTabKey, element.dataset.turnId || ""));
  registerTermaAction("terminal-ai-modal-close", () => { const modal = $("modal"); modal.hidden = true; modal.innerHTML = ""; });
  registerTermaAction("terminal-ai-log-submit", () => submitLogAiAssistant());
  registerTermaAction("log-ai-open", ({element}) => openLogAiAssistant(element.dataset.tabKey || activeTabKey));
}

if (typeof registerTermaI18nRenderer === "function") registerTermaI18nRenderer(() => {
  for (const [key, state] of terminalAiStates) if (state.open) renderTerminalAiPanel(key);
});
