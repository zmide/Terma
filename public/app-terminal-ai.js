const terminalAiStates = new Map();
const TERMINAL_AI_MAX_BLOCKS = 24;
const TERMINAL_AI_MAX_BLOCK_OUTPUT = 12000;
const TERMINAL_AI_MAX_TURNS = 20;
const TERMINAL_AI_COMMAND_WAIT_MS = 120000;
const TERMINAL_AI_COMPLETION_STABILITY_MS = 120;
let terminalAiLogController = null;
function terminalAiSettingsValue() {
  return runtimeSettings?.saved?.ai || runtimeSettings?.ai || {};
}
function terminalAiDefaultPermission() {
  const value = terminalAiSettingsValue().terminal_ai_permission;
  return ["suggest", "confirm", "controlled", "full"].includes(value) ? value : "confirm";
}
function terminalAiDefaultMode() {
  const value = terminalAiSettingsValue().terminal_ai_mode;
  return value === "chat" ? "chat" : "agent";
}
function terminalAiModeLabel(mode) {
  return mode === "chat"
    ? tr("terminal:ai.mode_chat", {defaultValue:"聊天"})
    : tr("terminal:ai.mode_agent", {defaultValue:"Agent"});
}
function terminalAiIsChatMode(key) {
  return terminalAiStateForKey(key).mode === "chat";
}
function terminalAiModeHint(mode) {
  return mode === "chat"
    ? tr("terminal:ai.mode_chat_hint", {defaultValue:"只读取当前终端内容，一问一答，不执行命令"})
    : tr("terminal:ai.mode_agent_hint", {defaultValue:"可按计划分析、执行命令并等待真实终端结果"});
}
function terminalAiSetMode(key, mode) {
  const state = terminalAiStateForKey(key);
  const next = mode === "chat" ? "chat" : "agent";
  if (state.mode === next) return true;
  if (state.busy) {
    notify(tr("terminal:ai.mode_busy", {defaultValue:"当前 AI 请求仍在进行，请先停止后再切换模式"}), "info");
    renderTerminalAiPanel(key);
    return false;
  }
  state.mode = next;
  if (next === "chat") {
    state.pendingApproval = null;
    state.approvalResolver = null;
    state.agentWaitingForInput = null;
    state.agentQueue = [];
  }
  terminalAiPersistState(key, state);
  renderTerminalAiPanel(key);
  return true;
}
function terminalAiStateForKey(key) {
  const normalized = String(key || "");
  if (!terminalAiStates.has(normalized)) terminalAiStates.set(normalized, {
    open:false,
    mode:terminalAiDefaultMode(),
    blocks:[],
    turns:[],
    busy:false,
    requestId:0,
    selectedBlockId:"",
    permission:terminalAiDefaultPermission(),
    model:String(terminalAiSettingsValue().model || "").trim(),
    modelCustom:false,
    reasoning_effort:["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(terminalAiSettingsValue().reasoning_effort || "").toLowerCase()) ? String(terminalAiSettingsValue().reasoning_effort).toLowerCase() : "none",
    deep_thinking:terminalAiSettingsValue().deep_thinking === true,
    error:"",
    sessionId:"",
    sessionTitle:"",
    sessionCreatedAt:0,
    historyLoaded:false,
    pendingApproval:null,
    approvalResolver:null,
    agentQueue:[],
    agentPreflightResults:[],
    attachments:[],
    agentWaitingForInput:null,
    agentTasks:[], activeTaskId:"", taskPlanCollapsed:false
  });
  const state = terminalAiStates.get(normalized);
  if (!state.model && terminalAiSettingsValue().model) state.model = String(terminalAiSettingsValue().model).trim();
  if (!["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(state.reasoning_effort || "").toLowerCase())) state.reasoning_effort = "none";
  if (!state.historyLoaded) terminalAiRestoreState(normalized, state);
  return state;
}
function terminalAiHistoryStorageKey(key) {
  return `termaTerminalAiSessions:${String(key || "")}`;
}
function terminalAiNewSessionId() {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function terminalAiSessionTitle(prompt="") {
  const value = String(prompt || "").replace(/\s+/g, " ").trim();
  return value ? value.slice(0, 48) : tr("terminal:ai.new_session", {defaultValue:"新会话"});
}
function terminalAiPersistState(key, state=terminalAiStateForKey(key)) {
  if (!state?.historyLoaded || !state.sessionId) return;
  try {
    const raw = localStorage.getItem(terminalAiHistoryStorageKey(key));
    const sessions = Array.isArray(JSON.parse(raw || "[]")) ? JSON.parse(raw || "[]") : [];
    const snapshot = {
      id:state.sessionId,
      title:state.sessionTitle || tr("terminal:ai.new_session", {defaultValue:"新会话"}),
      createdAt:Number(state.sessionCreatedAt || Date.now()),
      updatedAt:Date.now(),
      turns:state.turns.slice(-TERMINAL_AI_MAX_TURNS).map(turn => ({...turn, busy:false})),
      blocks:state.blocks.slice(-TERMINAL_AI_MAX_BLOCKS).map(block => ({...block, output:terminalAiStripControl(block.output || "").slice(-TERMINAL_AI_MAX_BLOCK_OUTPUT), completedAt:block.completedAt || 0})),
      mode:state.mode === "chat" ? "chat" : "agent", agentTasks:typeof terminalAiSerializeTasks === "function" ? terminalAiSerializeTasks(state.agentTasks) : state.agentTasks, activeTaskId:String(state.activeTaskId || ""), taskPlanCollapsed:state.taskPlanCollapsed === true
    };
    const next = [snapshot, ...sessions.filter(item => String(item?.id || "") !== state.sessionId)].slice(0, 30);
    localStorage.setItem(terminalAiHistoryStorageKey(key), JSON.stringify(next));
  } catch {}
}
function terminalAiRestoreState(key, state) {
  state.historyLoaded = true;
  state.sessionId = terminalAiNewSessionId();
  state.sessionTitle = tr("terminal:ai.new_session", {defaultValue:"新会话"});
  state.sessionCreatedAt = Date.now();
  try {
    const parsed = JSON.parse(localStorage.getItem(terminalAiHistoryStorageKey(key)) || "[]");
    const latest = Array.isArray(parsed) ? parsed[0] : null;
    if (latest?.id) {
      state.sessionId = String(latest.id);
      state.sessionTitle = String(latest.title || tr("terminal:ai.new_session", {defaultValue:"新会话"}));
      state.sessionCreatedAt = Number(latest.createdAt || Date.now());
      state.turns = Array.isArray(latest.turns) ? latest.turns.slice(-TERMINAL_AI_MAX_TURNS).map(turn => ({...turn, busy:false})) : [];
      state.blocks = Array.isArray(latest.blocks) ? latest.blocks.slice(-TERMINAL_AI_MAX_BLOCKS) : [];
      state.mode = latest.mode === "chat" ? "chat" : "agent";
      state.agentTasks = typeof terminalAiNormalizeTasks === "function" ? terminalAiNormalizeTasks(latest.agentTasks) : (Array.isArray(latest.agentTasks) ? latest.agentTasks : []); state.activeTaskId = String(latest.activeTaskId || ""); state.taskPlanCollapsed = latest.taskPlanCollapsed === true;
      state.selectedBlockId = state.blocks.at(-1)?.id || "";
    }
  } catch {}
}
function terminalAiListSessions(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(terminalAiHistoryStorageKey(key)) || "[]");
    return Array.isArray(parsed) ? parsed.filter(item => item?.id) : [];
  } catch { return []; }
}
function terminalAiNewSession(key) {
  const state = terminalAiStateForKey(key);
  state.controller?.abort?.();
  state.requestId += 1;
  settleTerminalAiApproval(key, false);
  terminalAiPersistState(key, state);
  state.sessionId = terminalAiNewSessionId();
  state.sessionTitle = tr("terminal:ai.new_session", {defaultValue:"新会话"});
  state.sessionCreatedAt = Date.now();
  state.turns = [];
  state.blocks = [];
  state.selectedBlockId = "";
  state.error = "";
  state.pendingApproval = null;
  state.approvalResolver = null;
  state.agentQueue = [];
  state.agentPreflightResults = [];
  state.agentWaitingForInput = null;
  state.agentTasks = []; state.activeTaskId = ""; state.taskPlanCollapsed = false;
  state.attachments = [];
  renderTerminalAiPanel(key);
}
function terminalAiHistoryModal(key, options={}) {
  if (options.persist !== false) terminalAiPersistState(key);
  const sessions = terminalAiListSessions(key);
  const modal = $("modal");
  const empty = `<div class="terminal-ai-history-empty">${esc(tr("terminal:ai.history_empty", {defaultValue:"暂无已保存的 AI 会话"}))}</div>`;
  const rows = sessions.map(item => `<div class="terminal-ai-history-row"><button type="button" data-action="terminal-ai-history-load" data-terminal-ai-key="${escAttr(key)}" data-session-id="${escAttr(item.id)}"><span class="terminal-ai-history-icon">${icon("message-square")}</span><span><b>${esc(item.title || tr("terminal:ai.new_session", {defaultValue:"新会话"}))}</b><small>${esc(new Date(Number(item.updatedAt || item.createdAt || Date.now())).toLocaleString(document.documentElement.lang || undefined, {hour12:false}))}</small></span></button><button class="icon-button danger" type="button" data-action="terminal-ai-history-delete" data-terminal-ai-key="${escAttr(key)}" data-session-id="${escAttr(item.id)}" title="${escAttr(tr("terminal:ai.history_delete", {defaultValue:"删除会话"}))}" aria-label="${escAttr(tr("terminal:ai.history_delete", {defaultValue:"删除会话"}))}">${icon("trash-2")}</button></div>`).join("");
  modal.innerHTML = `<div class="modal-card terminal-ai-history-modal" role="dialog" aria-modal="true" aria-labelledby="terminalAiHistoryTitle"><div class="modal-title-row"><h2 id="terminalAiHistoryTitle">${esc(tr("terminal:ai.history_title", {defaultValue:"AI 会话历史"}))}</h2><button class="icon-button" type="button" data-action="terminal-ai-modal-close" title="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}" aria-label="${escAttr(tr("common:actions.close", {defaultValue:"关闭"}))}">${icon("x")}</button></div><div class="terminal-ai-history-list">${rows || empty}</div><div class="actions"><button type="button" data-action="terminal-ai-new-session" data-terminal-ai-key="${escAttr(key)}">${icon("plus")}<span>${esc(tr("terminal:ai.new_session", {defaultValue:"新建会话"}))}</span></button></div></div>`;
  modal.hidden = false;
  refreshIcons();
}
function terminalAiLoadSession(key, sessionId) {
  const state = terminalAiStateForKey(key);
  const session = terminalAiListSessions(key).find(item => String(item.id) === String(sessionId));
  if (!session) return;
  terminalAiPersistState(key, state);
  state.sessionId = String(session.id);
  state.sessionTitle = String(session.title || tr("terminal:ai.new_session", {defaultValue:"新会话"}));
  state.sessionCreatedAt = Number(session.createdAt || Date.now());
  state.mode = session.mode === "chat" ? "chat" : "agent";
  state.turns = Array.isArray(session.turns) ? session.turns.slice(-TERMINAL_AI_MAX_TURNS).map(turn => ({...turn, busy:false})) : [];
  state.blocks = Array.isArray(session.blocks) ? session.blocks.slice(-TERMINAL_AI_MAX_BLOCKS) : [];
  state.agentTasks = typeof terminalAiNormalizeTasks === "function" ? terminalAiNormalizeTasks(session.agentTasks) : (Array.isArray(session.agentTasks) ? session.agentTasks : []); state.activeTaskId = String(session.activeTaskId || ""); state.taskPlanCollapsed = session.taskPlanCollapsed === true;
  state.selectedBlockId = state.blocks.at(-1)?.id || "";
  state.error = "";
  $("modal").hidden = true;
  $("modal").innerHTML = "";
  renderTerminalAiPanel(key);
}
function terminalAiDeleteSession(key, sessionId) {
  const sessions = terminalAiListSessions(key).filter(item => String(item.id) !== String(sessionId));
  try { localStorage.setItem(terminalAiHistoryStorageKey(key), JSON.stringify(sessions)); } catch {}
  const state = terminalAiStateForKey(key);
  if (String(state.sessionId) === String(sessionId)) {
    state.sessionId = terminalAiNewSessionId();
    state.sessionTitle = tr("terminal:ai.new_session", {defaultValue:"新会话"});
    state.sessionCreatedAt = Date.now();
    state.turns = [];
    state.blocks = [];
    state.agentTasks = []; state.activeTaskId = ""; state.taskPlanCollapsed = false;
    state.selectedBlockId = "";
    state.error = "";
    renderTerminalAiPanel(key);
  }
  terminalAiHistoryModal(key, {persist:false});
}
function terminalAiConfigured() {
  return terminalAiSettingsValue().enabled === true;
}
function terminalAiModelConfigured() {
  return Boolean(String(terminalAiSettingsValue().model || "").trim());
}
function terminalAiPlacement() {
  return terminalAiSettingsValue().terminal_ai_placement === "bottom" ? "bottom" : "right";
}
function terminalAiElementForKey(key, selector=".terminal-ai-panel") {
  const normalized = String(key || "");
  const cached = typeof terminalSurfaceCache !== "undefined" ? terminalSurfaceCache.get(normalized)?.querySelector(selector) : null;
  if (cached) return cached;
  const escaped = typeof workspaceCssEscape === "function" ? workspaceCssEscape(normalized) : CSS.escape(normalized);
  const direct = document.querySelector(`.terminal-ai-panel[data-terminal-ai-key="${escaped}"]`);
  if (direct && (selector === ".terminal-ai-panel" || direct.matches(selector))) return direct;
  return typeof terminalElementForKey === "function" ? terminalElementForKey(normalized, selector) : null;
}
function applyTerminalAiPlacement(key) {
  const panel = terminalAiElementForKey(key);
  const surface = panel?.closest?.(".terminal-tab-surface");
  if (surface) surface.classList.toggle("terminal-ai-right", terminalAiPlacement() === "right");
  return surface;
}
function syncTerminalAiPlacements() {
  for (const [key, state] of terminalAiStates) {
    if (!state.permission) state.permission = terminalAiDefaultPermission();
    applyTerminalAiPlacement(key);
  }
  document.querySelectorAll(".terminal-ai-panel[data-terminal-ai-key]").forEach(panel => {
    const key = panel.dataset.terminalAiKey || "";
    const surface = panel.closest(".terminal-tab-surface");
    if (surface) surface.classList.toggle("terminal-ai-right", terminalAiPlacement() === "right");
    if (key && terminalAiStates.has(key)) renderTerminalAiPanel(key);
  });
}
function terminalAiPanelHtml(key) {
  const state = terminalAiStateForKey(key);
  const layout = terminalAiLayoutSettings();
  const chatMode = state.mode === "chat";
  return `<section class="terminal-ai-panel${state.open ? " is-open" : ""}${chatMode ? " terminal-ai-mode-chat" : " terminal-ai-mode-agent"}" data-terminal-ai-key="${escAttr(key)}"${state.open ? "" : " hidden"}>
    <div class="terminal-ai-head" data-pointerdown-action="terminal-ai-drag"><div class="terminal-ai-title"><span class="terminal-ai-mark">${icon("bot")}</span><div class="terminal-ai-title-copy"><strong>${esc(tr("terminal:ai.title", {defaultValue:"终端 AI"}))}</strong><div class="terminal-ai-title-meta"><span data-terminal-ai-session-title="${escAttr(key)}">${esc(state.sessionTitle || tr("terminal:ai.new_session", {defaultValue:"新会话"}))}</span><small data-terminal-ai-session-usage="${escAttr(key)}"></small></div></div></div><div class="terminal-ai-head-actions"><button class="icon-button" type="button" data-action="terminal-ai-new-session" data-terminal-ai-key="${escAttr(key)}" title="${escAttr(tr("terminal:ai.new_session", {defaultValue:"新建会话"}))}" aria-label="${escAttr(tr("terminal:ai.new_session", {defaultValue:"新建会话"}))}">${icon("plus")}</button><button class="icon-button" type="button" data-action="terminal-ai-history" data-terminal-ai-key="${escAttr(key)}" title="${escAttr(tr("terminal:ai.history_title", {defaultValue:"AI 会话历史"}))}" aria-label="${escAttr(tr("terminal:ai.history_title", {defaultValue:"AI 会话历史"}))}">${icon("history")}</button><button class="icon-button" type="button" data-action="terminal-ai-minimize" data-terminal-ai-key="${escAttr(key)}" title="${escAttr(layout.minimized ? tr("terminal:ai.restore", {defaultValue:"恢复 AI 面板"}) : tr("terminal:ai.minimize", {defaultValue:"最小化 AI 面板"}))}" aria-label="${escAttr(layout.minimized ? tr("terminal:ai.restore", {defaultValue:"恢复 AI 面板"}) : tr("terminal:ai.minimize", {defaultValue:"最小化 AI 面板"}))}">${icon(layout.minimized ? "bot" : "minus")}</button><button class="icon-button" type="button" data-action="terminal-ai-close" data-terminal-ai-key="${escAttr(key)}" title="${escAttr(tr("terminal:ai.close", {defaultValue:"关闭终端 AI"}))}" aria-label="${escAttr(tr("terminal:ai.close", {defaultValue:"关闭终端 AI"}))}">${icon("x")}</button></div></div>
    <div class="terminal-ai-mode-row"><div class="terminal-ai-mode-switch" role="tablist" aria-label="${escAttr(tr("terminal:ai.mode", {defaultValue:"AI 模式"}))}"><button class="terminal-ai-mode-option${chatMode ? " active" : ""}" type="button" role="tab" aria-selected="${chatMode ? "true" : "false"}" data-action="terminal-ai-mode" data-terminal-ai-mode="chat" data-terminal-ai-key="${escAttr(key)}">${icon("message-circle") }<span>${esc(tr("terminal:ai.mode_chat", {defaultValue:"聊天"}))}</span></button><button class="terminal-ai-mode-option${chatMode ? "" : " active"}" type="button" role="tab" aria-selected="${chatMode ? "false" : "true"}" data-action="terminal-ai-mode" data-terminal-ai-mode="agent" data-terminal-ai-key="${escAttr(key)}">${icon("bot") }<span>${esc(tr("terminal:ai.mode_agent", {defaultValue:"Agent"}))}</span></button></div><span class="terminal-ai-mode-hint" data-terminal-ai-mode-hint="${escAttr(key)}">${esc(terminalAiModeHint(state.mode))}</span></div>
    <div class="terminal-ai-body" data-terminal-ai-body="${escAttr(key)}">
      <details class="terminal-ai-blocks-wrap"${chatMode ? " hidden" : ""}><summary><span>${icon("square-terminal")}<b>${esc(tr("terminal:ai.blocks", {defaultValue:"命令记录"}))}</b></span><span class="terminal-ai-block-count" data-terminal-ai-count="${escAttr(key)}">${state.blocks.length}</span></summary><div class="terminal-ai-blocks" data-terminal-ai-blocks="${escAttr(key)}"></div></details>
      <div class="terminal-ai-turns" data-terminal-ai-turns="${escAttr(key)}"></div>
      <div class="terminal-ai-approval-slot" data-terminal-ai-approval="${escAttr(key)}"${chatMode ? " hidden" : ""}></div>
      <div class="terminal-ai-attachments" data-terminal-ai-attachments="${escAttr(key)}"></div><input class="terminal-ai-attachment-input" type="file" multiple hidden accept=".txt,.log,.json,.csv,.md,.markdown,.sh,.bash,.conf,.ini,.yaml,.yml,.xml,.ts,.js,.tsx,.jsx,.html,.css" data-change-action="terminal-ai-attachments-select" data-terminal-ai-key="${escAttr(key)}">
      <div class="terminal-ai-task-dock" data-terminal-ai-task-dock="${escAttr(key)}" hidden></div>
      <form class="terminal-ai-composer" data-submit-action="terminal-ai-submit" data-terminal-ai-key="${escAttr(key)}">
        <textarea data-terminal-ai-prompt="${escAttr(key)}" data-keydown-action="terminal-ai-prompt-keydown" data-terminal-ai-key="${escAttr(key)}" rows="3" maxlength="6000" placeholder="${escAttr(chatMode ? tr("terminal:ai.chat_prompt_placeholder", {defaultValue:"询问当前终端内容，AI 只读回答…"}) : tr("terminal:ai.prompt_placeholder", {defaultValue:"描述任务，或让 AI 检查、排错并给出下一步…"}))}"></textarea>
        <div class="terminal-ai-compose-actions">
          <div class="terminal-ai-compose-config">
            <details class="terminal-ai-composer-settings">
              <summary title="${escAttr(tr("terminal:ai.composer_settings", {defaultValue:"模型与推理设置"}))}"><span data-terminal-ai-composer-model="${escAttr(key)}">${esc(state.model || tr("terminal:ai.model_unselected", {defaultValue:"未选择模型"}))}</span><small data-terminal-ai-composer-reasoning="${escAttr(key)}">${esc(terminalAiReasoningLabel(state.reasoning_effort))}</small>${icon("chevron-up")}</summary>
              <div class="terminal-ai-composer-popover">
                <div class="terminal-ai-popover-row terminal-ai-model-control"><label for="terminalAiModel-${escAttr(key)}">${esc(tr("terminal:ai.model", {defaultValue:"模型"}))}</label><select id="terminalAiModel-${escAttr(key)}" data-change-action="terminal-ai-model" data-terminal-ai-key="${escAttr(key)}">${terminalAiPanelModelOptions(state)}</select><input class="terminal-ai-model-custom" data-input-action="terminal-ai-model-custom" data-terminal-ai-key="${escAttr(key)}" value="${esc(state.model || "")}" placeholder="${escAttr(tr("terminal:ai.model_custom_placeholder", {defaultValue:"手动输入模型名称"}))}" hidden disabled></div>
                <div class="terminal-ai-popover-row"><label for="terminalAiReasoning-${escAttr(key)}">${esc(tr("terminal:ai.reasoning_effort", {defaultValue:"推理强度"}))}</label><select id="terminalAiReasoning-${escAttr(key)}" data-change-action="terminal-ai-reasoning" data-terminal-ai-key="${escAttr(key)}"><option value="none">${esc(tr("settings:ai.reasoning_none", {defaultValue:"关闭"}))}</option><option value="minimal">${esc(tr("settings:ai.reasoning_minimal", {defaultValue:"最低"}))}</option><option value="low">${esc(tr("settings:ai.reasoning_low", {defaultValue:"低"}))}</option><option value="medium">${esc(tr("settings:ai.reasoning_medium", {defaultValue:"中"}))}</option><option value="high">${esc(tr("settings:ai.reasoning_high", {defaultValue:"高"}))}</option><option value="xhigh">${esc(tr("settings:ai.reasoning_xhigh", {defaultValue:"极高"}))}</option><option value="max">${esc(tr("settings:ai.reasoning_max", {defaultValue:"最大"}))}</option></select></div>
                <details class="terminal-ai-composer-advanced"><summary><span>${esc(tr("terminal:ai.advanced", {defaultValue:"高级"}))}</span>${icon("chevron-down")}</summary><div>
                  <div class="terminal-ai-popover-row terminal-ai-permission-row" data-terminal-ai-permission-row="${escAttr(key)}"><label for="terminalAiPermission-${escAttr(key)}">${esc(tr("terminal:ai.permission", {defaultValue:"执行权限"}))}</label><select id="terminalAiPermission-${escAttr(key)}" data-change-action="terminal-ai-permission" data-terminal-ai-key="${escAttr(key)}"><option value="suggest">${esc(tr("terminal:ai.permission_suggest", {defaultValue:"仅建议"}))}</option><option value="confirm">${esc(tr("terminal:ai.permission_confirm", {defaultValue:"逐步确认"}))}</option><option value="controlled">${esc(tr("terminal:ai.permission_controlled", {defaultValue:"受控自动"}))}</option><option value="full">${esc(tr("terminal:ai.permission_full", {defaultValue:"完全访问"}))}</option></select><span class="terminal-ai-control-hint" data-terminal-ai-permission-hint="${escAttr(key)}"></span></div>
                  <div class="terminal-ai-popover-row"><label for="terminalAiLayout-${escAttr(key)}">${esc(tr("terminal:ai.layout", {defaultValue:"布局"}))}</label><select id="terminalAiLayout-${escAttr(key)}" data-change-action="terminal-ai-layout-mode" data-terminal-ai-key="${escAttr(key)}" title="${escAttr(tr("terminal:ai.layout_hint", {defaultValue:"拖动标题栏移动，拖动边界调整大小"}))}"><option value="fixed" ${layout.mode === "fixed" ? "selected" : ""}>${esc(tr("terminal:ai.layout_fixed", {defaultValue:"固定"}))}</option><option value="floating" ${layout.mode === "floating" ? "selected" : ""}>${esc(tr("terminal:ai.layout_floating", {defaultValue:"悬浮"}))}</option></select></div>
                </div></details>
              </div>
            </details>
            <label class="terminal-ai-deep-toggle"><input type="checkbox" data-change-action="terminal-ai-deep-thinking" data-terminal-ai-key="${escAttr(key)}" ${state.deep_thinking ? "checked" : ""}>${icon("brain")}<span>${esc(tr("terminal:ai.deep_thinking", {defaultValue:"深度思考"}))}</span></label>
            <span class="terminal-ai-ai-status sr-only" data-terminal-ai-ai-status="${escAttr(key)}"></span>
          </div>
          <div class="terminal-ai-compose-buttons"><button class="icon-button" type="button" data-action="terminal-ai-attachment-open" data-terminal-ai-key="${escAttr(key)}" title="${escAttr(tr("terminal:ai.add_attachment", {defaultValue:"添加上下文附件"}))}" aria-label="${escAttr(tr("terminal:ai.add_attachment", {defaultValue:"添加上下文附件"}))}">${icon("paperclip")}</button><button type="button" data-action="terminal-ai-stop" data-terminal-ai-key="${escAttr(key)}" data-terminal-ai-stop="${escAttr(key)}" hidden>${icon("square")}<span>${esc(tr("terminal:ai.stop", {defaultValue:"停止"}))}</span></button><button class="primary icon-button terminal-ai-send-button" type="submit" data-terminal-ai-send="${escAttr(key)}" title="${escAttr(tr("terminal:ai.send", {defaultValue:"发送"}))}" aria-label="${escAttr(tr("terminal:ai.send", {defaultValue:"发送"}))}">${icon("arrow-up")}<span class="sr-only">${esc(tr("terminal:ai.send", {defaultValue:"发送"}))}</span></button></div>
        </div>
        <span class="terminal-ai-context-note" data-terminal-ai-context-note="${escAttr(key)}"></span>
      </form>
    </div><span class="terminal-ai-fixed-resizer" data-pointerdown-action="terminal-ai-resize" data-terminal-ai-key="${escAttr(key)}" aria-hidden="true"></span><span class="terminal-ai-floating-resizer" data-pointerdown-action="terminal-ai-resize" data-terminal-ai-key="${escAttr(key)}" aria-hidden="true"></span>
  </section>`;
}
function terminalAiApprovalHtml(key, approval) {
  if (!approval) return "";
  if (approval.kind === "mcp") {
    const argumentsText = JSON.stringify(approval.arguments && typeof approval.arguments === "object" ? approval.arguments : {}, null, 2);
    return `<div class="terminal-ai-approval terminal-ai-mcp-approval" role="alert"><div class="terminal-ai-approval-head">${icon("shield-alert")}<strong>${esc(tr("terminal:ai.mcp_approval_title", {defaultValue:"调用工具前需要确认"}))}</strong></div><div class="terminal-ai-mcp-approval-title">${esc(tr("terminal:ai.mcp_call_title", {tool:approval.tool, defaultValue:`调用工具 ${approval.tool}`}))}</div><div class="terminal-ai-mcp-meta"><span>${esc(tr("terminal:ai.mcp_server", {defaultValue:"服务器"}))}</span><code>${esc(approval.server)}</code><span>${esc(tr("terminal:ai.mcp_tool", {defaultValue:"工具"}))}</span><code>${esc(approval.tool)}</code></div><pre>${esc(argumentsText)}</pre><p>${esc(approval.reason || tr("terminal:ai.mcp_approval_reason", {defaultValue:"MCP 工具可访问外部服务或修改数据，需要确认"}))}</p><div class="terminal-ai-approval-actions"><button class="primary" type="button" data-action="terminal-ai-approval-approve" data-terminal-ai-key="${escAttr(key)}">${icon("play")}<span>${esc(tr("terminal:ai.approval_approve", {defaultValue:"执行此调用"}))}</span></button><button type="button" data-action="terminal-ai-approval-reject" data-terminal-ai-key="${escAttr(key)}">${icon("x")}<span>${esc(tr("terminal:ai.approval_reject", {defaultValue:"拒绝"}))}</span></button><button type="button" data-action="terminal-ai-approval-stop" data-terminal-ai-key="${escAttr(key)}">${icon("square")}<span>${esc(tr("terminal:ai.approval_stop", {defaultValue:"停止任务"}))}</span></button></div></div>`;
  }
  const progress = approval.total > 1 ? ` (${approval.index}/${approval.total})` : "";
  const review = approval.review || null;
  const reviewRows = review ? [
    review.impact ? `<div><span>${esc(tr("terminal:ai.review_impact_label", {defaultValue:"影响"}))}</span><strong>${esc(review.impact)}</strong></div>` : "",
    review.files?.length ? `<div><span>${esc(tr("terminal:ai.review_files_label", {defaultValue:"涉及文件"}))}</span><code>${esc(review.files.join("\n"))}</code></div>` : "",
    review.services?.length ? `<div><span>${esc(tr("terminal:ai.review_services_label", {defaultValue:"涉及服务"}))}</span><code>${esc(review.services.join(", "))}</code></div>` : "",
    review.packages?.length ? `<div><span>${esc(tr("terminal:ai.review_packages_label", {defaultValue:"软件包"}))}</span><code>${esc(review.packages.join(", "))}</code></div>` : "",
    review.steps?.length > 1 ? `<div><span>${esc(tr("terminal:ai.review_steps_label", {defaultValue:"执行步骤"}))}</span><ol>${review.steps.map(step => `<li><code>${esc(step)}</code></li>`).join("")}</ol></div>` : "",
    review.residual?.length ? `<div><span>${esc(tr("terminal:ai.review_residual_label", {defaultValue:"执行后复核"}))}</span><ul>${review.residual.map(item => `<li>${esc(item)}</li>`).join("")}</ul></div>` : "",
    review.backupNote ? `<div class="terminal-ai-review-backup"><span>${esc(tr("terminal:ai.review_checkpoint_label", {defaultValue:"检查点"}))}</span><strong>${esc(review.backupNote)}</strong>${review.backupDirectory ? `<code>${esc(review.backupDirectory)}</code>` : ""}</div>` : ""
  ].filter(Boolean).join("") : "";
  const reviewHtml = reviewRows ? `<section class="terminal-ai-change-review"><div class="terminal-ai-change-review-title">${icon("file-diff")}<strong>${esc(tr("terminal:ai.review_title", {defaultValue:"执行前改动审阅"}))}</strong></div><div class="terminal-ai-change-review-grid">${reviewRows}</div></section>` : "";
  const insertButton = `<button type="button" data-action="terminal-ai-approval-insert" data-terminal-ai-key="${escAttr(key)}">${icon("arrow-down-to-line")}<span>${esc(tr("terminal:ai.approval_insert", {defaultValue:"仅放入终端"}))}</span></button>`;
  return `<div class="terminal-ai-approval" role="alert"><div class="terminal-ai-approval-head">${icon("shield-alert")}<strong>${esc(tr("terminal:ai.approval_title", {defaultValue:"需要确认后继续"}))}${esc(progress)}</strong></div><code>${esc(approval.command)}</code>${reviewHtml}<p>${esc(approval.reason || tr("terminal:ai.approval_default_reason", {defaultValue:"此命令可能改变系统或访问敏感资源"}))}</p><div class="terminal-ai-approval-actions"><button class="primary" type="button" data-action="terminal-ai-approval-approve" data-terminal-ai-key="${escAttr(key)}">${icon("play")}<span>${esc(tr("terminal:ai.approval_approve", {defaultValue:"执行此命令"}))}</span></button>${insertButton}<button type="button" data-action="terminal-ai-approval-reject" data-terminal-ai-key="${escAttr(key)}">${icon("x")}<span>${esc(tr("terminal:ai.approval_reject", {defaultValue:"拒绝并换方案"}))}</span></button><button type="button" data-action="terminal-ai-approval-stop" data-terminal-ai-key="${escAttr(key)}">${icon("square")}<span>${esc(tr("terminal:ai.approval_stop", {defaultValue:"停止任务"}))}</span></button></div></div>`;
}
function renderTerminalAiPanel(key) {
  const panel = terminalAiElementForKey(key);
  if (!panel) return;
  const state = terminalAiStateForKey(key);
  const surface = applyTerminalAiPlacement(key);
  applyTerminalAiLayout(key);
  panel.hidden = !state.open;
  panel.classList.toggle("is-open", state.open);
  const chatMode = state.mode === "chat";
  panel.classList.toggle("terminal-ai-mode-chat", chatMode);
  panel.classList.toggle("terminal-ai-mode-agent", !chatMode);
  panel.querySelectorAll(`[data-terminal-ai-mode][data-terminal-ai-key="${CSS.escape(String(key))}"]`).forEach(button => {
    const selected = String(button.dataset.terminalAiMode || "") === state.mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });
  const modeHint = panel.querySelector(`[data-terminal-ai-mode-hint="${CSS.escape(String(key))}"]`);
  if (modeHint) modeHint.textContent = terminalAiModeHint(state.mode);
  document.querySelectorAll(`.terminal-ai-button[data-terminal-ai-key="${CSS.escape(String(key))}"]`).forEach(toolbarButton => {
    toolbarButton.classList.toggle("active", state.open);
    toolbarButton.setAttribute("aria-pressed", state.open ? "true" : "false");
  });
  const blocks = panel.querySelector(`[data-terminal-ai-blocks="${CSS.escape(String(key))}"]`);
  if (blocks) blocks.innerHTML = state.blocks.length ? state.blocks.slice().reverse().map(block => terminalAiBlockHtml(key, block, state.selectedBlockId, {chatMode})).join("") : `<div class="terminal-ai-empty">${esc(tr("terminal:ai.empty_blocks", {defaultValue:"执行命令后，这里会显示命令和已捕获的输出"}))}</div>`;
  const blocksWrap = panel.querySelector(".terminal-ai-blocks-wrap");
  if (blocksWrap) blocksWrap.hidden = chatMode;
  const count = panel.querySelector(`[data-terminal-ai-count="${CSS.escape(String(key))}"]`);
  if (count) count.textContent = String(state.blocks.length);
  const permission = panel.querySelector(`[data-change-action="terminal-ai-permission"][data-terminal-ai-key="${CSS.escape(String(key))}"]`);
  if (permission) permission.value = state.permission;
  const permissionHint = panel.querySelector(`[data-terminal-ai-permission-hint="${CSS.escape(String(key))}"]`);
  if (permissionHint) permissionHint.textContent = terminalAiPermissionHint(state.permission);
  const permissionRow = panel.querySelector(`[data-terminal-ai-permission-row="${CSS.escape(String(key))}"]`);
  if (permissionRow) permissionRow.hidden = chatMode;
  const modelSelect = panel.querySelector(`[data-change-action="terminal-ai-model"][data-terminal-ai-key="${CSS.escape(String(key))}"]`);
  const modelCustom = panel.querySelector(`[data-input-action="terminal-ai-model-custom"][data-terminal-ai-key="${CSS.escape(String(key))}"]`);
  if (modelSelect) {
    const currentModel = String(state.model || "");
    modelSelect.innerHTML = terminalAiPanelModelOptions(state);
    modelSelect.value = [...modelSelect.options].some(option => option.value === currentModel) ? currentModel : (currentModel ? "__custom__" : "");
  }
  if (modelCustom) {
    const custom = modelSelect?.value === "__custom__";
    modelCustom.hidden = !custom;
    modelCustom.disabled = !custom;
    if (custom && document.activeElement !== modelCustom) modelCustom.value = state.model || "";
  }
  const reasoning = panel.querySelector(`[data-change-action="terminal-ai-reasoning"][data-terminal-ai-key="${CSS.escape(String(key))}"]`);
  if (reasoning) reasoning.value = state.reasoning_effort || "none";
  const composerModel = panel.querySelector(`[data-terminal-ai-composer-model="${CSS.escape(String(key))}"]`);
  if (composerModel) composerModel.textContent = state.model || tr("terminal:ai.model_unselected", {defaultValue:"未选择模型"});
  const composerReasoning = panel.querySelector(`[data-terminal-ai-composer-reasoning="${CSS.escape(String(key))}"]`);
  if (composerReasoning) composerReasoning.textContent = terminalAiReasoningLabel(state.reasoning_effort);
  const deepThinking = panel.querySelector(`[data-change-action="terminal-ai-deep-thinking"][data-terminal-ai-key="${CSS.escape(String(key))}"]`);
  if (deepThinking) deepThinking.checked = state.deep_thinking === true;
  const aiStatus = panel.querySelector(`[data-terminal-ai-ai-status="${CSS.escape(String(key))}"]`);
  if (aiStatus) aiStatus.textContent = tr("terminal:ai.ai_status", {model:state.model || tr("terminal:ai.model_unselected", {defaultValue:"未选择"}), effort:terminalAiReasoningLabel(state.reasoning_effort), deep:state.deep_thinking ? tr("terminal:ai.enabled", {defaultValue:"已开启"}) : tr("terminal:ai.disabled_short", {defaultValue:"未开启"}), defaultValue:`${state.model || "未选择"} · ${terminalAiReasoningLabel(state.reasoning_effort)} · ${state.deep_thinking ? "深度思考" : "普通思考"}`});
  const approval = panel.querySelector(`[data-terminal-ai-approval="${CSS.escape(String(key))}"]`);
  if (approval) {
    approval.hidden = chatMode;
    approval.innerHTML = !chatMode && state.pendingApproval
    ? terminalAiApprovalHtml(key, state.pendingApproval)
    : !chatMode && state.agentWaitingForInput
      ? "<div class=\"terminal-ai-waiting-input\" role=\"alert\">" + icon("terminal-square") + "<div><strong>" + esc(tr("terminal:ai.waiting_input_title", {defaultValue:"终端正在等待人工输入"})) + "</strong><span>" + esc(typeof terminalAiWaitingInputCopy === "function" ? terminalAiWaitingInputCopy(state).hint : tr("terminal:ai.waiting_input_hint", {defaultValue:"请按终端提示输入内容。Terma 已暂停 Agent，不会继续发送命令。"})) + "</span><code>" + esc(state.agentWaitingForInput.command || "") + "</code><form class=\"terminal-ai-waiting-input-form\" data-submit-action=\"terminal-ai-waiting-input-submit\" data-terminal-ai-key=\"" + escAttr(key) + "\"><input type=\"text\" data-terminal-ai-waiting-input=\"" + escAttr(key) + "\" autocomplete=\"off\" autocapitalize=\"none\" spellcheck=\"false\" placeholder=\"" + escAttr(typeof terminalAiWaitingInputCopy === "function" ? terminalAiWaitingInputCopy(state).placeholder : tr("terminal:ai.waiting_input_placeholder", {defaultValue:"输入终端所需内容"})) + "\"><button class=\"primary\" type=\"submit\">" + icon("send") + "<span>" + esc(tr("terminal:ai.waiting_input_send", {defaultValue:"发送到终端"})) + "</span></button></form><small class=\"terminal-ai-waiting-input-privacy\">" + esc(tr("terminal:ai.waiting_input_privacy", {defaultValue:"内容只发送到终端，不会提交给 AI"})) + "</small></div></div>"
      : "";
  }
  const attachmentView = panel.querySelector(`[data-terminal-ai-attachments="${CSS.escape(String(key))}"]`);
  if (attachmentView) attachmentView.innerHTML = state.attachments.length
    ? state.attachments.map((item, index) => `<span class="terminal-ai-attachment" title="${escAttr(item.name)}">${icon("paperclip")}<span>${esc(item.name)}</span><small>${terminalAiFormatTokens(Math.round(item.text.length / 4))}</small><button type="button" class="icon-button" data-action="terminal-ai-attachment-remove" data-terminal-ai-key="${escAttr(key)}" data-attachment-index="${index}" title="${escAttr(tr("terminal:ai.remove_attachment", {defaultValue:"移除附件"}))}" aria-label="${escAttr(tr("terminal:ai.remove_attachment", {defaultValue:"移除附件"}))}">${icon("x")}</button></span>`).join("")
    : "";
  const taskDock = panel.querySelector(`[data-terminal-ai-task-dock="${CSS.escape(String(key))}"]`);
  if (taskDock && typeof terminalAiTaskDockHtml === "function") {
    const dockHtml = chatMode ? "" : terminalAiTaskDockHtml(key);
    taskDock.innerHTML = dockHtml;
    taskDock.hidden = !dockHtml;
    const details = taskDock.querySelector("[data-terminal-ai-task-dock-details=\"true\"]");
    if (details) details.addEventListener("toggle", () => {
      const current = terminalAiStateForKey(key);
      current.taskPlanCollapsed = !details.open;
      terminalAiPersistState(key, current);
    });
  }
  const turns = panel.querySelector(`[data-terminal-ai-turns="${CSS.escape(String(key))}"]`);
  if (turns) {
    const previousScrollTop = turns.scrollTop;
    const previousScrollHeight = turns.scrollHeight;
    const previousClientHeight = turns.clientHeight;
    const wasNearBottom = !previousScrollHeight || previousScrollHeight - previousScrollTop - previousClientHeight < 48;
    turns.innerHTML = state.error
      ? `<div class="terminal-ai-error">${icon("circle-alert")}<span>${esc(state.error)}</span></div>`
      : state.turns.length
        ? terminalAiTurnsHtml(key, state.turns)
        : `<div class="terminal-ai-welcome">${icon(chatMode ? "message-circle" : "message-square-text")}<span>${esc(chatMode ? tr("terminal:ai.chat_welcome", {defaultValue:"询问当前终端内容，AI 只读取上下文并回答，不执行命令。"}) : tr("terminal:ai.welcome", {defaultValue:"直接描述任务。Agent 可以结合已选终端内容或命令输出，逐步给出检查和修复操作。"}))}</span></div>`;
    if (state.busy && wasNearBottom) turns.scrollTop = turns.scrollHeight;
    else if (previousScrollHeight) turns.scrollTop = Math.min(previousScrollTop, Math.max(0, turns.scrollHeight - turns.clientHeight));
  }
  const contexts = terminalAiContextForKey(key);
  const latestUsageTurn = [...state.turns].reverse().find(turn => terminalAiTurnUsage(turn).available);
  const contextTokens = latestUsageTurn ? terminalAiTurnUsage(latestUsageTurn).input : 0;
  const windowTokens = Number(terminalAiSettingsValue().context_tokens) || 1000000;
  const note = panel.querySelector(`[data-terminal-ai-context-note="${CSS.escape(String(key))}"]`);
  if (note) {
    note.textContent = contextTokens
      ? tr("terminal:ai.context_usage", {window:terminalAiFormatTokens(windowTokens), selected:terminalAiFormatTokens(contextTokens), defaultValue:`上下文上限 ${terminalAiFormatTokens(windowTokens)} · 本次请求输入 ${terminalAiFormatTokens(contextTokens)} tokens`})
      : tr("terminal:ai.context_pending", {window:terminalAiFormatTokens(windowTokens), defaultValue:`上下文上限 ${terminalAiFormatTokens(windowTokens)} · 本次请求输入待接口返回`});
    const contextHint = tr("terminal:ai.context_usage_hint", {defaultValue:"本次请求输入由模型接口统计，包含系统提示、会话历史、当前问题和已选上下文；上下文上限是 Terma 的配置预算，不是本会话累计用量。"});
    note.title = contextHint;
    note.setAttribute("aria-label", contextHint);
  }
  const sessionUsage = state.turns.reduce((sum, turn) => {
    const usage = terminalAiTurnUsage(turn);
    return sum + (usage.available ? usage.total : 0);
  }, 0);
  const usage = panel.querySelector(`[data-terminal-ai-session-usage="${CSS.escape(String(key))}"]`);
  if (usage) {
    usage.textContent = sessionUsage
      ? tr("terminal:ai.session_tokens", {tokens:terminalAiFormatTokens(sessionUsage), defaultValue:`本会话累计 ${terminalAiFormatTokens(sessionUsage)} tokens`})
      : (state.turns.length ? tr("terminal:ai.session_tokens_pending", {defaultValue:"本会话累计 Token 待接口返回"}) : "Agent");
    const sessionHint = tr("terminal:ai.session_usage_hint", {defaultValue:"本会话累计用量是所有已返回轮次的输入 token 与输出 token 之和。"});
    usage.title = sessionHint;
    usage.setAttribute("aria-label", sessionHint);
  }
  const sessionTitle = panel.querySelector(`[data-terminal-ai-session-title="${CSS.escape(String(key))}"]`);
  if (sessionTitle) sessionTitle.textContent = state.sessionTitle || tr("terminal:ai.new_session", {defaultValue:"新会话"});
  const prompt = panel.querySelector(`[data-terminal-ai-prompt="${CSS.escape(String(key))}"]`);
  if (prompt) {
    prompt.disabled = state.busy;
    prompt.placeholder = chatMode
      ? tr("terminal:ai.chat_prompt_placeholder", {defaultValue:"询问当前终端内容，AI 只读回答…"})
      : tr("terminal:ai.prompt_placeholder", {defaultValue:"描述任务，或让 AI 检查、排错并给出下一步…"});
  }
  const send = panel.querySelector(`[data-terminal-ai-send="${CSS.escape(String(key))}"]`);
  if (send) send.disabled = state.busy;
  const stop = panel.querySelector(`[data-terminal-ai-stop="${CSS.escape(String(key))}"]`);
  if (stop) stop.hidden = !state.busy;
  refreshIcons();
}
function finalizeTerminalAiActiveBlock(session) {
  if (!session?.aiActiveBlockId) return false;
  const state = terminalAiStateForKey(session.key);
  const block = state.blocks.find(item => item.id === session.aiActiveBlockId);
  if (!block) { session.aiActiveBlockId = ""; return false; }
  // An SSH trust/password prompt is still interactive even when the shell
  // reports a prompt-like line. Keep the block open and pause the Agent until
  // the user answers in the terminal.
  if (terminalAiBlockNeedsInput(block)) {
    terminalAiMarkWaitingForInput(session.key, block);
    return false;
  }
  block.completedAt = block.completedAt || Date.now();
  session.aiActiveBlockId = "";
  if (session.agentCommandInFlight?.blockId === block.id) session.agentCommandInFlight = null;
  terminalAiPersistState(session.key, state);
  if (state.open && !state.busy) renderTerminalAiPanel(session.key);
  return true;
}
function terminalAiMarkSessionEnded(session) {
  if (!session?.aiActiveBlockId || typeof terminalAiStateForKey !== "function") return false;
  const state = terminalAiStateForKey(session.key);
  const block = state.blocks.find(item => String(item.id) === String(session.aiActiveBlockId));
  if (!block || block.completedAt) return false;
  const output = terminalAiStripControl(block.output || "");
  const exitCode = output.match(/(?:退出码|exit\s+code)\s*[:：]?\s*(-?\d+)/i)?.[1];
  if (exitCode !== undefined) block.exitCode = Number(exitCode);
  block.sessionEndedAt = Date.now();
  block.waitingForInput = false;
  block.completedAt = block.sessionEndedAt;
  if (state.agentWaitingForInput?.blockId === block.id) state.agentWaitingForInput = null;
  session.aiActiveBlockId = "";
  session.agentCommandInFlight = null;
  terminalAiPersistState(session.key, state);
  if (state.open) renderTerminalAiPanel(session.key);
  return true;
}
function terminalAiMarkWaitingForInput(key, block, metadata={}) {
  if (!block || block.completedAt) return null;
  const state = terminalAiStateForKey(key);
  block.waitingForInput = true;
  state.agentWaitingForInput = {
    ...(state.agentWaitingForInput || {}),
    blockId:block.id,
    command:block.command,
    ...metadata
  };
  terminalAiPersistState(key, state);
  if (state.open) renderTerminalAiPanel(key);
  return state.agentWaitingForInput;
}
function finalizeTerminalAiBlockFromScreen(session) {
  if (!session?.aiActiveBlockId) return false;
  if (session.terminalOutputWriting || session.pendingTerminalOutput?.length) return false;
  const prompt = typeof terminalPromptStateAtRow === "function" ? terminalPromptStateAtRow(session) : null;
  if (!prompt || prompt.command) return false;
  const state = terminalAiStateForKey(session.key);
  const block = state.blocks.find(item => item.id === session.aiActiveBlockId);
  if (!block) return false;
  if (terminalAiBlockNeedsInput(block)) return false;
  if (!terminalAiAgentHasFreshPrompt(session, block, prompt)) return false;
  if (block.agentCommand) {
    const now = Date.now();
    block.completionCandidateAt = Number(block.completionCandidateAt || now);
    if (now - block.completionCandidateAt < TERMINAL_AI_COMPLETION_STABILITY_MS) {
      terminalAiScheduleStableCompletion(session, block);
      return false;
    }
  }
  return finalizeTerminalAiActiveBlock(session);
}
function terminalAiBlockNeedsInput(block) {
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
function captureTerminalAiBlockCommand(session, command, metadata={}) {
  if (!terminalAiConfigured() || !session || session.sensitiveInput || !String(command || "").trim()) return;
  if (session.aiActiveBlockId) {
    const state = terminalAiStateForKey(session.key);
    const previous = state.blocks.find(item => item.id === session.aiActiveBlockId);
    const finalized = previous?.agentCommand
      ? finalizeTerminalAiBlockFromScreen(session)
      : finalizeTerminalAiActiveBlock(session);
    if (previous?.agentCommand && !finalized) return;
  }
  const state = terminalAiStateForKey(session.key);
  const block = {
    id:createTerminalLogId(),
    command:typeof terminalAiCommandText === "function" ? terminalAiCommandText(String(command).trim()) : String(command).trim(),
    output:"",
    startedAt:Number(metadata.sentAt || Date.now()),
    sentAt:Number(metadata.sentAt || Date.now()),
    completedAt:0,
    agentCommand:metadata.agent === true,
    promptBefore:metadata.promptBefore || null,
    outputSequenceBefore:Number(metadata.outputSequenceBefore || 0)
  };
  state.blocks.push(block);
  if (state.blocks.length > TERMINAL_AI_MAX_BLOCKS) state.blocks.splice(0, state.blocks.length - TERMINAL_AI_MAX_BLOCKS);
  session.aiActiveBlockId = block.id;
  state.selectedBlockId = block.id;
  terminalAiPersistState(session.key, state);
  if (state.open) renderTerminalAiPanel(session.key);
}
function terminalAiDecodedOutput(session, value) {
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
function captureTerminalAiBlockOutput(session, value) {
  if (!terminalAiConfigured() || !session || session.sensitiveInput || !session.aiActiveBlockId) return;
  const text = terminalAiDecodedOutput(session, value);
  if (!text) return;
  const state = terminalAiStateForKey(session.key);
  const block = state.blocks.find(item => item.id === session.aiActiveBlockId);
  if (!block) return;
  block.output = `${block.output || ""}${text}`.slice(-TERMINAL_AI_MAX_BLOCK_OUTPUT);
  block.lastOutputAt = Date.now();
  block.outputSequence = Number(session.terminalOutputSequence || 0);
  if (terminalAiBlockNeedsInput(block)) terminalAiMarkWaitingForInput(session.key, block);
  terminalAiPersistState(session.key, state);
  if (state.open && !state.busy) {
    clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(() => renderTerminalAiPanel(session.key), 120);
  }
}
function toggleTerminalAiPanel(key) {
  const state = terminalAiStateForKey(key);
  state.open = !state.open;
  renderTerminalAiPanel(key);
  if (state.open && !terminalAiConfigured()) notify(tr("terminal:ai.disabled", {defaultValue:"请先在设置中启用终端 AI"}), "info");
  if (state.open) setTimeout(() => terminalAiElementForKey(key)?.querySelector(`[data-terminal-ai-prompt="${CSS.escape(String(key))}"]`)?.focus(), 0);
}

function terminalAiHistory(state, currentTurnId, currentTaskId="") {
  const previous = state.turns.filter(turn => turn.id !== currentTurnId && (!currentTaskId || String(turn.taskId || "") !== String(currentTaskId)));
  return terminalAiTaskGroups(previous).slice(-6).flatMap(group => {
    const sourceTurn = [...group.steps].reverse().find(turn => turn.answer && !turn.error);
    const rawAnswer = terminalAiDeduplicateRepeatedText(sourceTurn?.answer || "");
    const answer = sourceTurn?.mode === "chat" ? terminalAiNormalizeChatAnswer(rawAnswer) : rawAnswer;
    return answer ? [{role:"user", content:group.root.prompt}, {role:"assistant", content:answer}] : [];
  });
}

async function streamTerminalAiTurn(key, prompt, contexts, options={}) {
  const state = terminalAiStateForKey(key);
  const requestPrompt = String(prompt || "").trim();
  const turn = {id:createTerminalLogId(), taskId:String(options.taskId || ""), mode:options.mode === "chat" || state.mode === "chat" ? "chat" : "agent", prompt:String(options.displayPrompt || requestPrompt).trim(), contextText:(contexts || []).map(item => item.text || "").join("\n"), answer:"", reasoning:"", model:"", usage:null, busy:true, error:"", agentContinuation:options.agentContinuation === true, agentNotice:"", streamCutForCommand:false, agentResults:Array.isArray(state.agentPreflightResults) ? state.agentPreflightResults.splice(0) : []};
  state.turns.push(turn);
  if (!state.turns.slice(0, -1).some(item => !item.agentContinuation) || !state.sessionTitle || state.sessionTitle === tr("terminal:ai.new_session", {defaultValue:"新会话"})) {
    state.sessionTitle = terminalAiSessionTitle(turn.prompt);
  }
  if (state.turns.length > TERMINAL_AI_MAX_TURNS) state.turns.splice(0, state.turns.length - TERMINAL_AI_MAX_TURNS);
  renderTerminalAiPanel(key);
  try {
    const request = options.streamRequest || streamTerminalAiRequest;
    const result = await request({message:requestPrompt, contexts, history:Array.isArray(options.history) ? options.history : terminalAiHistory(state, turn.id, turn.taskId), locale:normalizeTermaLanguage(document.documentElement.lang), permission:state.permission, mode:turn.mode, ai:{model:state.model || terminalAiSettingsValue().model || "", reasoning_effort:state.reasoning_effort, deep_thinking:state.deep_thinking}}, {
      signal:options.controller.signal,
      onDelta:delta => {
        if (state.requestId !== options.requestId) return;
        turn.answer += delta;
        const keepStreaming = options.onActions
          ? options.onActions(turn.answer, turn)
          : options.onCommands?.(terminalAiResponseCommands(turn.answer), turn);
        if (keepStreaming === false) {
          turn.streamCutForCommand = true;
          turn.answer = terminalAiAnswerThroughFirstCommand(turn.answer);
        }
        renderTerminalAiPanel(key);
        return keepStreaming;
      },
      onReasoning:delta => {
        if (state.requestId !== options.requestId) return;
        turn.reasoning += delta;
      }
    });
    if (state.requestId !== options.requestId) return turn;
    turn.model = String(result.model || "");
    turn.usage = result.usage || null;
    if (typeof terminalAiTaskRecordAnswer === "function" && options.taskId) terminalAiTaskRecordAnswer(key, turn.taskId, turn.answer);
  } catch (error) {
    if (state.requestId === options.requestId && !options.controller.signal.aborted) turn.error = error.message || tr("terminal:ai.request_failed", {defaultValue:"AI 请求失败"});
  } finally {
    turn.busy = false;
    terminalAiPersistState(key, state);
    if (state.requestId === options.requestId) renderTerminalAiPanel(key);
  }
  return turn;
}

function terminalAiAgentContinuationPrompt(originalPrompt, results) {
  const items = (Array.isArray(results) ? results : [{command:results, output:""}]).map(item => {
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

function terminalAiAnswerNeedsActionRecovery(value) {
  const visible = terminalAiNormalizeToolCalls(value).replace(/\s+/g, " ").trim();
  if (!visible || visible.length > 800 || terminalAiResponseCommands(value).length || terminalAiResponseMcpCalls(value).length) return false;
  if (/(?:结论|已完成|无需|不能|无法|不需要|final answer|completed|no need|cannot)/i.test(visible)) return false;
  return /(?:我(?:先|来|将)|先|接下来|下一步|让我|开始).{0,80}(?:检查|收集|查看|确认|获取|执行|排查|inspect|collect|check|run)/i.test(visible);
}

function terminalAiAgentActionRecoveryPrompt(originalPrompt, previousAnswer) {
  return tr("terminal:ai.agent_action_recovery_prompt", {
    task:String(originalPrompt || ""),
    answer:String(previousAnswer || "").slice(0, 1200),
    defaultValue:`继续完成用户的原始任务。你上一轮只说明了计划，没有给出终端操作或完整结论。若需要检查，请立即只返回一条完整的 shell 代码块；若不需要终端，请直接给出完整最终结论。不要再次只写开场说明。原始任务：${originalPrompt}\n上一轮：${String(previousAnswer || "").slice(0, 1200)}`
  });
}

async function executeTerminalAiMcpCall(key, call, options={}) {
  const state = terminalAiStateForKey(key);
  if (state.permission === "suggest") return {called:false, denied:false, output:""};
  const configuredServer = (Array.isArray(terminalAiSettingsValue().mcp_servers) ? terminalAiSettingsValue().mcp_servers : [])
    .find(server => String(server?.id) === String(call?.server));
  const configuredTool = configuredServer?.tools?.find(tool => String(tool?.name) === String(call?.tool));
  if (!configuredServer || !configuredTool || configuredTool.enabled === false) return {called:false, denied:true, unsupported:true, output:""};
  const label = `MCP ${call.server}.${call.tool}\n${JSON.stringify(call.arguments || {}, null, 2)}`;
  if (configuredTool?.requires_approval !== false) {
    const approved = await requestTerminalAiApproval(key, label, {kind:"mcp", server:call.server, tool:call.tool, arguments:call.arguments || {}, reason:tr("terminal:ai.mcp_approval_reason", {defaultValue:"MCP 工具可访问外部服务或修改数据，需要确认"})}, options);
    if (!approved) return {called:false, denied:true, output:""};
  }
  const result = await api("/api/ai/mcp/call", {method:"POST", body:JSON.stringify({server_id:call.server, tool:call.tool, arguments:call.arguments || {}})});
  return {called:true, denied:false, output:terminalAiRedactAttachment(JSON.stringify(result, null, 2))};
}

async function submitTerminalAiRequest(key, prompt, contexts, options={}) {
  const state = terminalAiStateForKey(key);
  if (!terminalAiConfigured()) {
    state.error = tr("terminal:ai.disabled", {defaultValue:"请先在设置中启用终端 AI"});
    renderTerminalAiPanel(key);
    return;
  }
  if (!terminalAiModelConfigured()) {
    state.error = tr("terminal:ai.model_required", {defaultValue:"请先在设置中选择 AI 模型"});
    renderTerminalAiPanel(key);
    return;
  }
  const originalPrompt = String(prompt || "").trim();
  if (!originalPrompt) return;
  const chatMode = state.mode === "chat" || options.mode === "chat";
  if (chatMode && state.busy) {
    notify(tr("terminal:ai.chat_busy", {defaultValue:"上一条聊天回复仍在生成，请稍候"}), "info");
    return;
  }
  if (!state.turns.length) state.sessionTitle = terminalAiSessionTitle(originalPrompt);
  state.controller?.abort?.();
  state.busy = true;
  state.error = "";
  if (options.agentTask !== true || !options.taskId) state.agentWaitingForInput = null;
  const requestId = ++state.requestId;
  const suppliedContexts = Array.isArray(contexts) ? contexts : [];
  const chatContexts = chatMode && typeof terminalAiContextForKey === "function" ? terminalAiContextForKey(key, "chat") : [];
  const contextKeys = new Set();
  const mergedChatContexts = [...chatContexts, ...suppliedContexts].filter(item => {
    if (!item || typeof item !== "object") return false;
    const identity = `${String(item.source || "")}\n${String(item.title || "")}\n${String(item.text || "")}`;
    if (contextKeys.has(identity)) return false;
    contextKeys.add(identity);
    return true;
  }).slice(0, 8);
  const requestContexts = chatMode ? mergedChatContexts : suppliedContexts;
  const agentContexts = options.agentTask === true ? [...suppliedContexts, ...(typeof terminalAiAgentTargetContexts === "function" ? terminalAiAgentTargetContexts(key) : []), ...(typeof terminalAiPlatformContext === "function" ? [terminalAiPlatformContext()] : [])] : requestContexts;
  const task = options.agentTask === true && !chatMode && typeof terminalAiBeginTask === "function" ? terminalAiBeginTask(key, options.displayPrompt || originalPrompt, agentContexts, String(options.taskId || "")) : null;
  const taskId = options.agentTask === true && !chatMode ? String(options.taskId || task?.id || createTerminalLogId()) : "";
  const controller = new AbortController();
  state.controller = controller;
  renderTerminalAiPanel(key);
  let currentPrompt = originalPrompt;
  let currentContexts = agentContexts;
  let mcpContexts = [];
  let continuation = false;
  let awaitingActionRecovery = false;
  let searchAttempted = false;
  const executedCommands = typeof terminalAiTaskAttemptedCommands === "function"
    ? terminalAiTaskAttemptedCommands(state, taskId)
    : new Set();
  const executedCommandResults = new Map();
  const explicitSearch = options.agentTask === true && terminalAiExplicitSearchIntent(originalPrompt);
  try {
    if (options.agentTask === true) {
      try {
        mcpContexts = await terminalAiMcpContexts();
        currentContexts = [...currentContexts, ...mcpContexts];
      } catch {}
      if (explicitSearch) {
        // A fresh web-research request is not a continuation of the selected
        // terminal command. Keep explicit attachments, but remove stale shell
        // selection/block context and isolate it from older task history.
        currentContexts = currentContexts.filter(item => !["terminal-selection", "terminal-block"].includes(String(item?.source || "")));
        const projectIdentity = terminalAiProjectIdentityContext(originalPrompt);
        if (projectIdentity) {
          mcpContexts = [projectIdentity, ...mcpContexts];
          currentContexts = [projectIdentity, ...currentContexts];
        }
        if (state.permission !== "suggest") {
          const searchCall = terminalAiSearchCallForPrompt(originalPrompt);
          if (searchCall) {
            searchAttempted = true;
            const resultEntry = await terminalAiRunMcpTaskAction(key, taskId, searchCall, {index:1, total:1});
            currentPrompt = terminalAiAgentContinuationPrompt(originalPrompt, [resultEntry]);
            state.agentPreflightResults = [...(state.agentPreflightResults || []), resultEntry];
            currentContexts = [{source:"mcp-output", title:`MCP ${resultEntry.server}.${resultEntry.tool}`, text:`${tr("terminal:ai.agent_status_label", {defaultValue:"状态"})}：${resultEntry.status}\n${terminalAiStripControl(resultEntry.output || "")}`}, ...currentContexts];
          }
        }
      }
    }
    while (!controller.signal.aborted && state.requestId === requestId) {
      if (options.agentTask !== true) {
        const turn = await streamTerminalAiTurn(key, currentPrompt, currentContexts, {requestId, taskId, mode:chatMode ? "chat" : "agent", controller, agentContinuation:continuation, streamRequest:options.streamRequest});
        if (!turn || turn.error || controller.signal.aborted || state.requestId !== requestId) break;
        break;
      }
      const seenCommands = new Set(); let repeatedCommand = ""; let repeatedResult = null; let repeatedNotice = "";
      const seenMcpCalls = new Set();
      const results = [];
      let commandIndex = 0;
      let commandRunner = Promise.resolve();
      const enqueueCommands = commands => {
        if (state.permission === "suggest") return true;
        for (const command of (Array.isArray(commands) ? commands : [])) {
          const normalized = String(command || "").trim();
          if (!normalized || seenCommands.has(normalized)) continue;
          seenCommands.add(normalized);
          const index = ++commandIndex;
          const plannedRisk = terminalAiCommandRisk(normalized, {userPrompt:originalPrompt});
          const taskStep = typeof terminalAiTaskPrepareAction === "function"
            ? terminalAiTaskPrepareAction(key, taskId, {kind:"command", command:normalized, status:"pending", risk:plannedRisk.reason, checkpoint:!plannedRisk.safe})
            : null;
          state.agentQueue.push(normalized);
          commandRunner = commandRunner.then(async () => {
            let resultEntry = {command:normalized, output:"", status:tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"})};
            try {
              if (controller.signal.aborted || state.requestId !== requestId) return;
              const risk = plannedRisk;
              const automatic = state.permission === "full" || (state.permission === "controlled" && risk.safe);
              const executeCommand = options.executeCommand || executeTerminalAiCommand;
              if (executedCommands.has(normalized)) {
                repeatedCommand = normalized;
                repeatedNotice = tr("terminal:ai.agent_repeated", {defaultValue:"检测到重复命令，已跳过本次执行并准备总结。"});
                repeatedResult = executedCommandResults.get(normalized) || null;
                resultEntry.status = repeatedNotice;
                resultEntry.duplicate = true;
                if (typeof terminalAiTaskCompleteAction === "function") terminalAiTaskCompleteAction(key, taskId, taskStep, "skipped", resultEntry.status);
                return;
              }
              executedCommands.add(normalized);
              const execution = await executeCommand(key, normalized, {auto:automatic, details:true, risk, taskId, checkpointId:taskStep?.checkpointId || "", signal:controller.signal, userPrompt:originalPrompt, index, total:Math.max(index, state.agentQueue.length)});
              if (!execution?.sent) {
                resultEntry.status = execution?.error || (execution?.denied ? tr("terminal:ai.agent_denied", {defaultValue:"用户拒绝执行"}) : tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"}));
                resultEntry.sessionEnded = Boolean(execution?.sessionEnded);
                resultEntry.syntaxError = Boolean(execution?.syntaxError);
                if (typeof terminalAiTaskCompleteAction === "function") terminalAiTaskCompleteAction(key, taskId, taskStep, execution?.denied ? "needs-confirmation" : "failed", resultEntry.status);
              } else if (!execution.blockId) {
                resultEntry.status = tr("terminal:ai.agent_capture_missing", {defaultValue:"命令已发送但未捕获输出"});
                if (typeof terminalAiTaskCompleteAction === "function") terminalAiTaskCompleteAction(key, taskId, taskStep, "failed", resultEntry.status);
              } else {
                const completed = await waitForTerminalAiCommandCompletion(key, execution.blockId, {signal:controller.signal});
                if (completed) {
                  const status = completed.waitingForInput
                    ? tr("terminal:ai.waiting_input", {defaultValue:"等待终端输入，已暂停自动操作"})
                    : completed.timedOutAt
                      ? tr("terminal:ai.timed_out_paused", {defaultValue:"等待命令完成超时，Agent 已暂停；确认终端命令结束后再继续任务"})
                      : completed.exitCode && completed.exitCode !== 0
                        ? tr("terminal:ai.agent_exit_code", {code:completed.exitCode, defaultValue:`退出码 ${completed.exitCode}`})
                        : tr("terminal:ai.completed", {defaultValue:"已完成"});
                  resultEntry = {command:execution.command, output:completed.output || "", status, waitingForInput:Boolean(completed.waitingForInput), incomplete:Boolean(completed.timedOutAt), sessionEnded:Boolean(completed.sessionEndedAt)};
                  executedCommandResults.set(normalized, resultEntry);
                  const taskStepStatus = completed.waitingForInput || completed.timedOutAt
                    ? "waiting"
                    : (completed.timedOutAt || (completed.exitCode && completed.exitCode !== 0) ? "failed" : "success");
                  if (typeof terminalAiTaskCompleteAction === "function") terminalAiTaskCompleteAction(key, taskId, taskStep, taskStepStatus, taskStepStatus === "success" ? "" : status);
                  if (completed.waitingForInput) {
                    terminalAiMarkWaitingForInput(key, completed, {taskId, originalPrompt, contexts:currentContexts});
                  }
                  if (completed.timedOutAt && typeof terminalAiTaskForId === "function") {
                    const task = terminalAiTaskForId(state, taskId);
                    if (task) {
                      task.status = "waiting";
                      task.error = status;
                      task.updatedAt = Date.now();
                    }
                  }
                }
              }
            } catch (error) {
              resultEntry.status = String(error?.message || tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"}));
              if (typeof terminalAiTaskCompleteAction === "function") terminalAiTaskCompleteAction(key, taskId, taskStep, "failed", resultEntry.status);
            } finally {
              results.push(resultEntry);
              const queueIndex = state.agentQueue.indexOf(normalized);
              if (queueIndex >= 0) state.agentQueue.splice(queueIndex, 1);
              renderTerminalAiPanel(key);
            }
          });
          // One model turn produces at most one terminal action. Real output is
          // returned before the model is allowed to choose the next command.
          return false;
        }
        return true;
      };
      const enqueueMcpCalls = calls => {
        if (state.permission === "suggest") return true;
        for (const call of (Array.isArray(calls) ? calls : [])) {
          if (!call?.key || seenMcpCalls.has(call.key)) continue;
          seenMcpCalls.add(call.key);
          const index = ++commandIndex;
          const queueLabel = "MCP " + call.server + "." + call.tool;
          const taskStep = typeof terminalAiTaskPrepareAction === "function"
            ? terminalAiTaskPrepareAction(key, taskId, {kind:"mcp", label:queueLabel, status:"pending", risk:tr("terminal:ai.mcp_approval_reason", {defaultValue:"MCP 工具可能访问外部服务或修改数据"}), checkpoint:true, checkpointReason:tr("terminal:ai.mcp_approval_reason", {defaultValue:"MCP 工具调用前"})})
            : null;
          state.agentQueue.push(queueLabel);
          commandRunner = commandRunner.then(async () => {
            let resultEntry = {kind:"mcp", server:call.server, tool:call.tool, arguments:call.arguments || {}, output:"", status:tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"})};
            try {
              if (controller.signal.aborted || state.requestId !== requestId) return;
              const execution = await executeTerminalAiMcpCall(key, call, {index, total:Math.max(index, state.agentQueue.length)});
              resultEntry.output = execution.output || "";
              resultEntry.status = execution.unsupported
                ? tr("terminal:ai.mcp_unsupported", {tool:call.tool, defaultValue:`未执行：未发现或未启用工具 ${call.tool}`})
                : execution.called
                ? tr("terminal:ai.completed", {defaultValue:"已完成"})
                : execution.denied
                  ? tr("terminal:ai.agent_denied", {defaultValue:"用户拒绝执行"})
                  : tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"});
              if (typeof terminalAiTaskCompleteAction === "function") terminalAiTaskCompleteAction(key, taskId, taskStep, execution.called ? "success" : execution.denied ? "needs-confirmation" : "failed", execution.called ? "" : resultEntry.status);
            } catch (error) {
              resultEntry.status = String(error?.message || tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"}));
              if (typeof terminalAiTaskCompleteAction === "function") terminalAiTaskCompleteAction(key, taskId, taskStep, "failed", resultEntry.status);
            } finally {
              results.push(resultEntry);
              const queueIndex = state.agentQueue.indexOf(queueLabel);
              if (queueIndex >= 0) state.agentQueue.splice(queueIndex, 1);
              renderTerminalAiPanel(key);
            }
          });
          return false;
        }
        return true;
      };
      const enqueueActions = (answer, actionOptions={}) => {
        const mcpCalls = terminalAiResponseMcpCalls(answer);
        return mcpCalls.length ? enqueueMcpCalls(mcpCalls) : enqueueCommands(terminalAiResponseCommands(answer, actionOptions));
      };
      const turn = await streamTerminalAiTurn(key, currentPrompt, currentContexts, {requestId, taskId, mode:"agent", controller, agentContinuation:continuation, displayPrompt:continuation ? undefined : (options.displayPrompt || originalPrompt), history:explicitSearch ? [] : undefined, streamRequest:options.streamRequest, onActions:enqueueActions});
      // Some compatible gateways finish after sending a complete command body
      // but omit the closing protocol tag or code fence. Recover only after the
      // stream ends and only when the single command is syntactically complete.
      if (turn) {
        const completeActions = terminalAiResponseCommands(turn.answer);
        const recoveredActions = completeActions.length ? completeActions : terminalAiResponseCommands(turn.answer, {allowIncomplete:true});
        if (!completeActions.length && recoveredActions.length) {
          turn.answer = terminalAiCompleteRecoveredCommandAnswer(turn.answer, recoveredActions[0]);
          turn.recoveredIncompleteAction = true;
        }
        enqueueActions(turn.answer, {allowIncomplete:true});
      }
      await commandRunner;
      if (turn) turn.agentResults = [...(Array.isArray(turn.agentResults) ? turn.agentResults : []), ...results];
      if (turn) renderTerminalAiPanel(key);
      const endedResult = results.find(item => item.sessionEnded);
      if (endedResult) {
        const endedMessage = tr("terminal:ai.agent_session_ended", {defaultValue:"终端会话已结束，已停止继续执行；请重新连接后恢复任务。"});
        if (turn) {
          turn.agentNotice = endedMessage;
          turn.error = endedResult.status || endedMessage;
        }
        terminalAiPersistState(key, state);
        renderTerminalAiPanel(key);
        break;
      }
      if (repeatedCommand) {
        const previous = repeatedResult || executedCommandResults.get(repeatedCommand) || (() => {
          const block = [...state.blocks].reverse().find(item => String(item?.command || "").trim() === repeatedCommand);
          return block ? {command:repeatedCommand, output:block.output || "", status:tr("terminal:ai.completed", {defaultValue:"已完成"})} : {command:repeatedCommand, output:"", status:tr("terminal:ai.agent_output_missing", {defaultValue:"未找到上一轮输出"})};
        })();
        if (turn) turn.agentNotice = repeatedNotice || tr("terminal:ai.agent_repeated", {defaultValue:"检测到重复命令，已跳过本次执行并准备总结。"});
        const summaryPrompt = typeof terminalAiDuplicateSummaryPrompt === "function"
          ? terminalAiDuplicateSummaryPrompt(originalPrompt, repeatedCommand, previous)
          : `${originalPrompt}\nThe command has already run. Here is the trusted terminal output:\n${String(previous.output || "").slice(-8000)}\nReturn only a final summary; do not output or execute commands.`;
        const summaryTurn = await streamTerminalAiTurn(key, summaryPrompt, [{source:"terminal-agent-output", title:repeatedCommand, text:`$ ${repeatedCommand}\n${terminalAiStripControl(previous.output || "")}`}, ...mcpContexts], {requestId, taskId, controller, agentContinuation:true, history:[], streamRequest:options.streamRequest});
        if (summaryTurn && !summaryTurn.error) summaryTurn.agentNotice = tr("terminal:ai.agent_summary_after_duplicate", {defaultValue:"已复用第一次执行的真实输出，完成收尾总结。"});
        if (summaryTurn?.error && turn && !turn.error) turn.agentNotice = repeatedNotice;
        terminalAiPersistState(key, state);
        renderTerminalAiPanel(key);
        break;
      }
      if (controller.signal.aborted || state.requestId !== requestId || turn?.error) break;
      if (results.some(item => item.waitingForInput || item.incomplete)) break;
      if (!results.length) {
        // Some models acknowledge a search request without emitting the MCP
        // protocol block. For an explicit web-search intent, select one
        // discovered search tool and execute it through the normal permission
        // path, then return the real result to the model.
        if (!searchAttempted && state.permission !== "suggest") {
          const searchCall = terminalAiSearchCallForPrompt(originalPrompt);
          if (searchCall) {
            searchAttempted = true;
            const resultEntry = await terminalAiRunMcpTaskAction(key, taskId, searchCall, {index:1, total:1});
            results.push(resultEntry);
            if (turn) turn.agentResults = [...(Array.isArray(turn.agentResults) ? turn.agentResults : []), resultEntry];
          }
        }
        if (results.length) {
          currentPrompt = terminalAiAgentContinuationPrompt(originalPrompt, results);
          currentContexts = [...results.map(item => ({source:"mcp-output", title:`MCP ${item.server}.${item.tool}`, text:`${item.status ? `${tr("terminal:ai.agent_status_label", {defaultValue:"状态"})}：${item.status}\n` : ""}${terminalAiStripControl(item.output || "")}`})), ...mcpContexts];
          continuation = true;
          terminalAiPersistState(key, state);
          continue;
        }
        if (!awaitingActionRecovery && terminalAiAnswerNeedsActionRecovery(turn?.answer || "")) {
          awaitingActionRecovery = true;
          currentPrompt = terminalAiAgentActionRecoveryPrompt(originalPrompt, turn.answer);
          currentContexts = [...mcpContexts];
          continuation = true;
          terminalAiPersistState(key, state);
          continue;
        }
        // Give a planning-only response one correction turn. If the model
        // still returns no action, stop the task instead of asking forever and
        // showing the same preamble repeatedly.
        if (awaitingActionRecovery && terminalAiAnswerNeedsActionRecovery(turn?.answer || "")) {
          const stopNotice = tr("terminal:ai.agent_action_missing", {defaultValue:"模型连续只返回操作计划，没有给出命令或最终结论，本轮已停止以避免空转。"});
          if (turn) turn.agentNotice = stopNotice;
          if (typeof terminalAiTaskMarkStopped === "function" && taskId) terminalAiTaskMarkStopped(key);
          terminalAiPersistState(key, state);
          renderTerminalAiPanel(key);
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
      terminalAiPersistState(key, state);
    }
  } finally {
    if (state.requestId === requestId) {
      state.controller = null;
      state.busy = false;
      if (options.agentTask === true && typeof terminalAiTaskFinish === "function") { const failedTurn = [...state.turns].reverse().find(item => String(item?.taskId || "") === taskId && item?.error); terminalAiTaskFinish(key, taskId, {error:failedTurn?.error || ""}); }
      renderTerminalAiPanel(key);
    }
  }
}

function stopTerminalAiRequest(key) {
  const state = terminalAiStateForKey(key);
  const session = terminalSessions.get(key);
  if (typeof terminalAiTaskMarkStopped === "function") terminalAiTaskMarkStopped(key);
  settleTerminalAiApproval(key, false);
  state.controller?.abort?.();
  state.controller = null;
  state.requestId += 1;
  state.busy = false;
  state.agentQueue = [];
  state.agentPreflightResults = [];
  state.agentWaitingForInput = null;
  if (session) session.agentCommandInFlight = null;
  const turn = state.turns.at(-1);
  if (turn?.busy) turn.busy = false;
  renderTerminalAiPanel(key);
}

async function submitTerminalAiPrompt(key) {
  const panel = terminalAiElementForKey(key);
  const promptElement = panel?.querySelector(`[data-terminal-ai-prompt="${CSS.escape(String(key))}"]`);
  const prompt = String(promptElement?.value || "").trim();
  if (!prompt) return;
  if (promptElement) promptElement.value = "";
  const state = terminalAiStateForKey(key);
  return submitTerminalAiRequest(key, prompt, terminalAiContextForKey(key), state.mode === "chat" ? {mode:"chat", agentTask:false} : {agentTask:true});
}

async function askTerminalAiForBlock(key, blockId, action) {
  const state = terminalAiStateForKey(key);
  const block = state.blocks.find(item => String(item.id) === String(blockId));
  if (!block) return;
  state.selectedBlockId = block.id;
  const prompts = {
    explain:tr("terminal:ai.explain_prompt", {defaultValue:"解释这条命令和实际输出，重点说明错误、有效结果和下一步排查方向。"}),
    summarize:tr("terminal:ai.summarize_prompt", {defaultValue:"总结这条命令的实际结果，并指出值得注意的异常。"}),
    fix:tr("terminal:ai.fix_prompt", {defaultValue:"根据这条命令的实际输出给出安全的修复步骤；每个建议命令单独放在 shell 代码块中，并说明风险。"}),
    continue:tr("terminal:ai.continue_prompt", {defaultValue:"继续分析这条命令的最新输出，并给出下一步最合适的检查或处理命令。"})
  };
  state.open = true;
  renderTerminalAiPanel(key);
  await submitTerminalAiRequest(key, prompts[action] || prompts.explain, [{source:"terminal-block", title:block.command, text:`$ ${block.command}\n${terminalAiStripControl(block.output || "")}`}], {agentTask:false});
}

function terminalAiCommandTokens(command) {
  const source = String(command || "").trim();
  const tokens = [];
  let token = "";
  let quote = "";
  for (const character of source) {
    if (quote) {
      if (character === quote) quote = "";
      else token += character;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (token) { tokens.push(token); token = ""; }
      continue;
    }
    token += character;
  }
  if (quote) return [];
  if (token) tokens.push(token);
  return tokens;
}

function terminalAiReadOnlyFilePath(command) {
  const tokens = terminalAiCommandTokens(command);
  const executable = (tokens[0] || "").split(/[\\/]/).pop().replace(/\.(?:exe|cmd|bat|com)$/i, "").toLowerCase();
  const args = tokens.slice(1);
  const paths = [];
  const takeNumericOption = (index, token) => {
    if (/^(?:-n|-c|--lines|--bytes)$/i.test(token) && /^\d+$/.test(args[index + 1] || "")) return 1;
    return 0;
  };
  if (["cat", "head", "tail"].includes(executable)) {
    let optionsEnded = false;
    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (!optionsEnded && token === "--") { optionsEnded = true; continue; }
      if (!optionsEnded && executable === "cat" && (/^-[AbenstuvET]+$/.test(token) || /^--(?:number|number-nonblank|squeeze-blank|show-ends|show-tabs|show-nonprinting|show-all)$/.test(token))) continue;
      if (!optionsEnded && ["head", "tail"].includes(executable)) {
        if (/^(?:-q|-v|--quiet|--silent|--verbose)$/i.test(token) || /^-\d+$/.test(token) || /^--(?:lines|bytes)=\d+$/i.test(token)) continue;
        const consumed = takeNumericOption(index, token);
        if (consumed) { index += consumed; continue; }
        if (/^(?:-f|-F|--follow|--retry|--pid)/i.test(token)) return "";
      }
      if (!optionsEnded && token.startsWith("-")) return "";
      paths.push(token);
    }
  } else if (["get-content", "gc"].includes(executable)) {
    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (/^-(?:literalpath|path)$/i.test(token)) {
        if (!args[index + 1]) return "";
        paths.push(args[index + 1]);
        index += 1;
        continue;
      }
      if (/^-(?:tail|totalcount|head|readcount)$/i.test(token) && /^\d+$/.test(args[index + 1] || "")) { index += 1; continue; }
      if (/^-(?:raw|wait)$/i.test(token)) {
        if (/^-wait$/i.test(token)) return "";
        continue;
      }
      if (token.startsWith("-")) return "";
      paths.push(token);
    }
  } else if (executable === "type") {
    paths.push(...args);
  } else {
    return "";
  }
  if (paths.length !== 1 || !paths[0] || /[*?\[\]{}]/.test(paths[0])) return "";
  return paths[0];
}

function terminalAiReadOnlyFind(command) {
  let text = String(command || "").trim();
  if (!/^find(?:\s|$)/i.test(text)) return "";
  // Only discard stderr; other shell operators remain blocked below.
  text = text.replace(/\s+2>\s*\/dev\/null\s*$/i, "").trim();
  const tokens = terminalAiCommandTokens(text);
  if (!tokens.length || tokens[0].toLowerCase() !== "find") return "";
  const args = tokens.slice(1);
  if (!args.length) return "";
  const path = args.shift();
  if (!path || path.startsWith("-")) return "";
  let hasPredicate = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index].toLowerCase();
    if (["-maxdepth", "-mindepth"].includes(token)) {
      if (!/^\d+$/.test(args[index + 1] || "")) return "";
      index += 1;
      continue;
    }
    if (token === "-type") {
      if (!/^[fdl]$/i.test(String(args[index + 1] || ""))) return "";
      hasPredicate = true;
      index += 1;
      continue;
    }
    if (["-name", "-iname"].includes(token)) {
      const pattern = args[index + 1] || "";
      if (!pattern || /[;|&<>`$()]/.test(pattern)) return "";
      hasPredicate = true;
      index += 1;
      continue;
    }
    if (token === "-print") { hasPredicate = true; continue; }
    if (["-depth", "-xdev", "-mount", "-noleaf"].includes(token)) continue;
    // Explicitly reject actions and arbitrary expression/composition syntax.
    return "";
  }
  return hasPredicate ? path : "";
}

function terminalAiSensitivePath(path) {
  const normalized = String(path || "").trim().replace(/\\/g, "/").toLowerCase();
  return /(?:^|\/)(?:\.ssh|\.gnupg|\.aws|\.azure|\.kube)(?:\/|$)/.test(normalized)
    || /(?:^|[\/._-])(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|authorized_keys|known_hosts|credentials?|secrets?|tokens?|passwords?|passwd|shadow)(?:$|[\/._-])/i.test(normalized)
    || /(?:^|\/)\.env(?:\.|$)/i.test(normalized)
    || /\.(?:pem|p12|pfx|key|kdbx)$/i.test(normalized);
}

function terminalAiPromptMentionsPath(prompt, path) {
  const source = String(prompt || "").toLowerCase().replace(/\\/g, "/");
  const normalized = String(path || "").trim().toLowerCase().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9._~/:+-])${escaped}(?=$|[^a-z0-9._~/:+-])`, "i").test(source);
}

function terminalAiCommandRisk(command, context={}) {
  const text = String(command || "").trim();
  if (!text || /[\r\n]/.test(text)) return {safe:false, reason:tr("terminal:ai.risk_multiline", {defaultValue:"多行命令需要人工确认"})};
  if (/(?:^|\s)(?:sudo|doas|runas|su)(?:\s|$)/i.test(text)) return {safe:false, reason:tr("terminal:ai.risk_privilege", {defaultValue:"命令会提升权限"})};
  const findPath = terminalAiReadOnlyFind(text);
  if (findPath) return {safe:true, reason:"", path:findPath};
  const stderrOnly = text.replace(/\s+2>\s*\/dev\/null\b/gi, "").trim();
  if (stderrOnly !== text && !stderrOnly) return {safe:true, reason:""};
  if (/(?:\$\(|`)/.test(stderrOnly)) return {safe:false, reason:tr("terminal:ai.risk_shell", {defaultValue:"命令包含命令替换"})};
  if (/(?:&&|\|\||[;&])/.test(stderrOnly)) {
    const parts = terminalAiSplitShellCommands(stderrOnly);
    if (parts.length > 1 && parts.every(part => terminalAiCommandRisk(part, context).safe)) return {safe:true, reason:""};
    return {safe:false, reason:tr("terminal:ai.risk_shell", {defaultValue:"命令包含组合执行或重定向"})};
  }
  if (/[<>]/.test(stderrOnly)) return {safe:false, reason:tr("terminal:ai.risk_shell", {defaultValue:"命令包含重定向"})};
  if (/\|/.test(stderrOnly)) {
    const parts = stderrOnly.split("|").map(item => item.trim()).filter(Boolean);
    if (parts.length > 1 && parts.every(part => terminalAiCommandRisk(part, context).safe)) return {safe:true, reason:""};
    return {safe:false, reason:tr("terminal:ai.risk_shell", {defaultValue:"命令包含组合执行或重定向"})};
  }
  const commandTokens = terminalAiCommandTokens(text);
  if (commandTokens.slice(1).some(token => terminalAiSensitivePath(token))) return {safe:false, reason:tr("terminal:ai.risk_sensitive", {defaultValue:"命令会读取密钥、凭据或其他敏感文件"})};
  const executable = (text.match(/^["']?([^"'\s]+)/)?.[1] || "").split(/[\\/]/).pop().replace(/\.(?:exe|cmd|bat|com)$/i, "").toLowerCase();
  if (["rm", "del", "erase", "rmdir", "remove-item", "mv", "move", "cp", "copy", "chmod", "chown", "kill", "pkill", "taskkill", "sc", "dnf", "yum", "pacman", "apk", "brew", "winget", "choco", "pip", "npm", "pnpm", "yarn", "curl", "wget", "invoke-webrequest", "iwr", "invoke-restmethod", "irm", "ssh", "scp", "sftp", "rsync", "docker", "podman", "kubectl", "terraform"].includes(executable)) return {safe:false, reason:tr("terminal:ai.risk_change", {defaultValue:"命令可能修改系统、访问网络或改变远端状态"})};
  const readPath = terminalAiReadOnlyFilePath(text);
  if (readPath) {
    if (terminalAiSensitivePath(readPath)) return {safe:false, reason:tr("terminal:ai.risk_sensitive", {defaultValue:"命令会读取密钥、凭据或其他敏感文件"}), path:readPath};
    return {safe:true, reason:"", path:readPath};
  }
  const safe = [
    /^(?:pwd|whoami|date|uptime|id|get-location)$/i,
    /^uname(?:\s+-(?:a|s|r|m|n|v|o))?$/i,
    /^(?:hostname|hostnamectl|ls|dir|get-childitem|df|free|ps|top|vmstat|iostat|stat|file|du|ip|ss|netstat|grep|egrep|fgrep|sed|awk|cut|sort|uniq|wc|head|tail|cat|echo|printf|true|false|which|whereis|type|mount|lsblk|lscpu|last|who|w|journalctl|dmesg)(?:\s|$)/i,
    /^(?:systemctl\s+(?:is-active|is-enabled|status|show|cat|list-units|list-sockets|list-timers)\b|service\s+\S+\s+status\b)/i,
    /^(?:dpkg\s+-l|rpm\s+-qa|apt-cache\s+(?:policy|show)|nft\s+(?:list|show)\b|iptables\s+-[LSnv])/i,
    /^git\s+(?:status|diff|log|show|branch|tag|remote|rev-parse|describe)(?:\s|$)/i
  ].some(pattern => pattern.test(text));
  return {safe, reason:safe ? "" : tr("terminal:ai.risk_unknown", {defaultValue:"该命令不在只读自动执行清单中"})};
}
function terminalAiShellQuote(value) {
  const text = String(value || "");
  if (text.startsWith("~/")) return `"$HOME/${text.slice(2).replace(/[`"\\$]/g, "\\$&")}"`;
  return "'" + text.replace(/'/g, "'\\\"'\\\"'") + "'";
}

function terminalAiCommandReview(command, risk={}, options={}) {
  const text = String(command || "").trim();
  const steps = (typeof terminalAiSplitShellCommands === "function" ? terminalAiSplitShellCommands(text) : [text]).filter(Boolean).slice(0, 12);
  const tokens = terminalAiCommandTokens(text);
  const executable = String(tokens[0] || "").split(/[\\/]/).pop().replace(/\.(?:exe|cmd|bat|com)$/i, "").toLowerCase();
  const files = new Set();
  const services = new Set();
  const addFile = value => {
    const item = String(value || "").trim().replace(/^['"]|['"]$/g, "");
    if (!item || item === "." || item === ".." || item.startsWith("-") || /[*?\[\]{}$()`;]/.test(item)) return;
    if (/^(?:true|false|yes|no|on|off)$/i.test(item)) return;
    files.add(item);
  };
  for (const match of text.matchAll(/(?:>>?|<)\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g)) addFile(match[1] || match[2] || match[3]);
  const args = tokens.slice(1).filter(token => token !== "--" && !token.startsWith("-"));
  if (["rm", "del", "erase", "rmdir", "remove-item", "mv", "move", "cp", "copy", "chmod", "chown", "mkdir", "md", "touch", "tee"].includes(executable)) args.forEach(addFile);
  if (["sed", "perl", "python", "python3", "powershell", "pwsh"].includes(executable) && /(?:^|\s)(?:-i|--in-place|set-content|out-file|add-content)(?:\s|$)/i.test(text)) args.slice(-2).forEach(addFile);
  if (/\b(?:systemctl|service)\s+(?:enable|disable|start|stop|restart|reload|mask|unmask)\b/i.test(text)) {
    const service = text.match(/\b(?:systemctl|service)\s+(?:enable|disable|start|stop|restart|reload|mask|unmask)\s+([^\s;&|]+)/i)?.[1];
    if (service) services.add(service);
  }
  const packageChange = text.match(/\b(?:apt(?:-get)?|dnf|yum|pacman|zypper|apk|brew|winget|choco|npm|pnpm|yarn|pip)\s+(?:install|remove|uninstall|erase|upgrade|update)\b([^;&|]*)/i)?.[1];
  const packages = packageChange ? packageChange.trim().split(/\s+/).filter(item => item && !item.startsWith("-")).slice(0, 12) : [];
  const kind = services.size ? "service" : packages.length ? "package" : files.size ? "file" : "system";
  const fileList = [...files].slice(0, 8);
  const checkpointId = String(options.checkpointId || "pending").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "pending";
  const sensitive = fileList.some(item => terminalAiSensitivePath(item));
  const unsafeBackupPath = fileList.some(item => /^(?:\/$|~\/?$|\/(?:etc|var|usr|home|root|tmp|opt|bin|sbin|proc|sys|dev)\/?$)/i.test(item));
  const backupSupported = Boolean(fileList.length && fileList.length <= 8 && !sensitive && !unsafeBackupPath && !risk.safe);
  const backupDirectory = `~/.terma/checkpoints/${checkpointId}`;
  const backupCommand = backupSupported
    ? `set -eu; d=\"$HOME/.terma/checkpoints/${checkpointId}\"; mkdir -p \"$d\"; ${fileList.map((item, index) => `if [ -e ${terminalAiShellQuote(item)} ] || [ -L ${terminalAiShellQuote(item)} ]; then cp -a ${terminalAiShellQuote(item)} \"$d/item-${index}\"; else : > \"$d/item-${index}.absent\"; fi`).join("; ")}; printf '%s\\n' ${fileList.map((item, index) => `${index}:${item}`).map(terminalAiShellQuote).join(" ")} > \"$d/manifest\"; printf '%s\\n' TERMA_CHECKPOINT_READY`
    : "";
  const rollbackCommand = backupSupported
    ? `set -eu; d=\"$HOME/.terma/checkpoints/${checkpointId}\"; ${fileList.map((item, index) => `if [ -e \"$d/item-${index}.absent\" ]; then rm -rf -- ${terminalAiShellQuote(item)}; elif [ -e \"$d/item-${index}\" ] || [ -L \"$d/item-${index}\" ]; then rm -rf -- ${terminalAiShellQuote(item)}; cp -a \"$d/item-${index}\" ${terminalAiShellQuote(item)}; fi`).join("; ")}; printf '%s\\n' TERMA_CHECKPOINT_ROLLED_BACK`
    : "";
  const impact = kind === "file"
    ? tr("terminal:ai.review_file_impact", {defaultValue:"会修改或删除远端文件"})
    : kind === "service"
      ? tr("terminal:ai.review_service_impact", {defaultValue:"会改变远端服务状态"})
      : kind === "package"
        ? tr("terminal:ai.review_package_impact", {defaultValue:"会安装、升级或移除软件包"})
        : tr("terminal:ai.review_system_impact", {defaultValue:"可能改变系统或访问外部资源"});
  return {
    kind,
    impact,
    steps,
    files:fileList,
    services:[...services].slice(0, 8),
    packages,
    backupCommand,
    rollbackCommand,
    backupDirectory:backupSupported ? backupDirectory : "",
    backupStatus:backupSupported ? "pending" : (sensitive ? "sensitive-skipped" : unsafeBackupPath ? "unsafe-skipped" : "unavailable"),
    backupNote:sensitive
      ? tr("terminal:ai.review_sensitive_backup", {defaultValue:"检测到敏感路径，不自动复制远端文件内容"})
      : unsafeBackupPath
        ? tr("terminal:ai.review_unsafe_backup", {defaultValue:"路径范围过大或过于危险，不自动复制远端内容"})
      : backupSupported
        ? tr("terminal:ai.review_backup_ready", {defaultValue:"执行前会先创建远端检查点备份"})
        : tr("terminal:ai.review_backup_unavailable", {defaultValue:"当前命令无法自动生成可靠的文件备份"}),
    residual:(kind === "file" ? [tr("terminal:ai.review_residual_files", {defaultValue:"重新检查文件内容和权限"})] : kind === "service" ? [tr("terminal:ai.review_residual_service", {defaultValue:"重新检查服务状态和监听端口"})] : kind === "package" ? [tr("terminal:ai.review_residual_package", {defaultValue:"重新检查软件包版本和依赖状态"})] : [tr("terminal:ai.review_residual_system", {defaultValue:"重新检查关键系统状态和命令输出"})]),
    risk:String(risk.reason || "").slice(0, 240)
  };
}

function requestTerminalAiApproval(key, command, risk, meta={}) {
  const state = terminalAiStateForKey(key);
  state.pendingApproval = {
    command:String(command || ""),
    kind:risk?.kind === "mcp" ? "mcp" : "command",
    server:String(risk?.server || ""),
    tool:String(risk?.tool || ""),
    arguments:risk?.arguments && typeof risk.arguments === "object" ? risk.arguments : null,
    reason:String(risk?.reason || ""),
    review:risk?.review || (risk?.kind === "mcp" ? null : terminalAiCommandReview(command, risk, {checkpointId:meta.checkpointId})),
    index:Math.max(1, Number(meta.index || 1)),
    total:Math.max(1, Number(meta.total || 1))
  };
  renderTerminalAiPanel(key);
  return new Promise(resolve => { state.approvalResolver = resolve; });
}

function settleTerminalAiApproval(key, approved) {
  const state = terminalAiStateForKey(key);
  const resolver = state.approvalResolver;
  state.approvalResolver = null;
  state.pendingApproval = null;
  renderTerminalAiPanel(key);
  resolver?.(approved === true);
}

async function terminalAiRunCheckpointBackup(key, taskId, checkpointId="", signal=null) {
  if (!taskId || !checkpointId || typeof terminalAiTaskForId !== "function") return true;
  const state = terminalAiStateForKey(key);
  const task = terminalAiTaskForId(state, taskId);
  const checkpoint = task?.checkpoints?.find(item => String(item.id) === String(checkpointId));
  if (!checkpoint?.backupCommand || checkpoint.backupStatus === "ready") return true;
  if (checkpoint.backupStatus === "running") return false;
  const session = terminalSessions.get(key);
  if (!session) return false;
  checkpoint.backupStatus = "running";
  checkpoint.backupStartedAt = Date.now();
  terminalAiPersistState(key, state);
  renderTerminalAiPanel(key);
  const startedAt = Date.now();
  const sent = sendTerminalData(key, `${checkpoint.backupCommand}\r`, {trackCommand:true, focus:false});
  const block = sent ? state.blocks.slice().reverse().find(item => item.command === checkpoint.backupCommand && Number(item.startedAt || 0) >= startedAt - 5) : null;
  if (!sent || !block?.id) {
    checkpoint.backupStatus = "failed";
    checkpoint.backupError = tr("terminal:ai.task_checkpoint_send_failed", {defaultValue:"检查点备份命令未发送"});
    terminalAiPersistState(key, state);
    renderTerminalAiPanel(key);
    return false;
  }
  const completed = await waitForTerminalAiCommandCompletion(key, block.id, {signal});
  const failed = !completed || completed.waitingForInput || completed.timedOutAt || (completed.exitCode && completed.exitCode !== 0);
  checkpoint.backupStatus = failed ? "failed" : "ready";
  checkpoint.verified = !failed;
  checkpoint.backupFinishedAt = Date.now();
  if (failed) checkpoint.backupError = String(completed?.output || tr("terminal:ai.task_checkpoint_failed", {defaultValue:"检查点备份失败，原命令未执行"})).slice(-400);
  terminalAiPersistState(key, state);
  renderTerminalAiPanel(key);
  if (failed) notify(tr("terminal:ai.task_checkpoint_failed", {defaultValue:"检查点备份失败，原命令未执行"}), "error");
  return !failed;
}

async function insertTerminalAiCommand(key, command) {
  const value = terminalAiCommandFromCodeBlock(command);
  if (!value) return;
  if (sendTerminalData(key, value, {trackCommand:false})) notify(tr("terminal:ai.inserted", {defaultValue:"命令已放入终端输入区，请确认后执行"}), "success");
}

function insertPendingTerminalAiApproval(key) {
  const state = terminalAiStateForKey(key);
  const approval = state.pendingApproval;
  if (!approval?.command) return false;
  const sent = sendTerminalData(key, terminalAiCommandFromCodeBlock(approval.command), {trackCommand:false, focus:true});
  if (!sent) return false;
  settleTerminalAiApproval(key, false);
  notify(tr("terminal:ai.approval_inserted", {defaultValue:"命令已放入终端输入区，未自动执行"}), "success");
  return true;
}
