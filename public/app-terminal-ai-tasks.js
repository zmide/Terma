/**
 * Task-level Agent planning, checkpoints, and recovery.
 * This layer stores metadata only; existing bounded command blocks retain
 * terminal output and sensitive input is never copied into checkpoints.
 */
const TERMINAL_AI_MAX_TASKS = 20;
const TERMINAL_AI_MAX_TASK_STEPS = 40;
const TERMINAL_AI_MAX_CHECKPOINTS = 16;
const TERMINAL_AI_MAX_TASK_PLAN = 20;

function terminalAiNormalizeTasks(value) {
  const source = Array.isArray(value) ? value : [];
  return source.filter(task => task && task.id).slice(0, TERMINAL_AI_MAX_TASKS).map(task => ({
    ...task,
    plan:Array.isArray(task.plan) ? task.plan.slice(0, TERMINAL_AI_MAX_TASK_PLAN) : [],
    steps:Array.isArray(task.steps) ? task.steps.slice(-TERMINAL_AI_MAX_TASK_STEPS) : [],
    checkpoints:Array.isArray(task.checkpoints) ? task.checkpoints.slice(0, TERMINAL_AI_MAX_CHECKPOINTS) : [],
    status:String(task.status || "completed"),
    durationMs:Math.max(0, Number(task.durationMs || 0)),
    activeStartedAt:Math.max(0, Number(task.activeStartedAt || 0)),
    resultSummary:String(task.resultSummary || "").slice(0, 360)
  }));
}

function terminalAiSerializeTasks(value) {
  return terminalAiNormalizeTasks(value).map(task => ({
    ...task,
    durationMs:Math.max(0, Number(task.durationMs || 0)),
    activeStartedAt:0,
    resultSummary:String(task.resultSummary || "").slice(0, 360),
    contextSources:(Array.isArray(task.contextSources) ? task.contextSources : []).slice(0, 8),
    steps:(Array.isArray(task.steps) ? task.steps : []).map(step => ({
      id:String(step.id || ""), kind:String(step.kind || "action"), label:String(step.label || "").slice(0, 240),
      command:typeof terminalAiCommandText === "function" ? terminalAiCommandText(step.command || "") : String(step.command || "").slice(0, 100000), status:String(step.status || "pending"), startedAt:Number(step.startedAt || 0),
      endedAt:Number(step.endedAt || 0), checkpointId:String(step.checkpointId || ""), error:String(step.error || "").slice(0, 400), risk:String(step.risk || "").slice(0, 240)
    })),
    checkpoints:(Array.isArray(task.checkpoints) ? task.checkpoints : []).map(item => ({
      id:String(item.id || ""), createdAt:Number(item.createdAt || 0), reason:String(item.reason || "").slice(0, 160),
      command:typeof terminalAiCommandText === "function" ? terminalAiCommandText(item.command || "") : String(item.command || "").slice(0, 100000), risk:String(item.risk || "").slice(0, 240), blockCount:Number(item.blockCount || 0),
      stepCount:Number(item.stepCount || 0), outputHash:String(item.outputHash || "").slice(0, 32), verified:item.verified === true,
      backupCommand:typeof terminalAiCommandText === "function" ? terminalAiCommandText(item.backupCommand || "") : String(item.backupCommand || "").slice(0, 100000),
      rollbackCommand:typeof terminalAiCommandText === "function" ? terminalAiCommandText(item.rollbackCommand || "") : String(item.rollbackCommand || "").slice(0, 100000),
      backupStatus:String(item.backupStatus || "none").slice(0, 32), rollbackStatus:String(item.rollbackStatus || "none").slice(0, 32), backupNote:String(item.backupNote || "").slice(0, 240)
    }))
  }));
}

function terminalAiTaskHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function terminalAiTaskStatusLabel(status) {
  const key = String(status || "pending");
  const labels = {
    pending:tr("terminal:ai.task_pending", {defaultValue:"等待中"}),
    running:tr("terminal:ai.task_running", {defaultValue:"执行中"}),
    success:tr("terminal:ai.task_success", {defaultValue:"成功"}),
    completed:tr("terminal:ai.task_completed", {defaultValue:"已完成"}),
    failed:tr("terminal:ai.task_failed", {defaultValue:"失败"}),
    skipped:tr("terminal:ai.task_skipped", {defaultValue:"跳过"}),
    waiting:tr("terminal:ai.task_waiting", {defaultValue:"等待输入"}),
    "needs-confirmation":tr("terminal:ai.task_needs_confirmation", {defaultValue:"需确认"}),
    stopped:tr("terminal:ai.task_stopped", {defaultValue:"已停止"})
  };
  return labels[key] || labels.pending;
}

function terminalAiTaskStateClass(status) {
  return ["success", "completed"].includes(String(status || "")) ? "success"
    : ["failed", "stopped"].includes(String(status || "")) ? "failed"
      : ["waiting", "needs-confirmation"].includes(String(status || "")) ? "waiting"
        : String(status || "pending");
}

function terminalAiEnsureTaskState(state) {
  if (!state) return state;
  if (!Array.isArray(state.agentTasks)) state.agentTasks = [];
  state.agentTasks = state.agentTasks.filter(task => task && task.id).slice(0, TERMINAL_AI_MAX_TASKS);
  for (const task of state.agentTasks) {
    if (!Array.isArray(task.plan)) task.plan = [];
    if (!Array.isArray(task.steps)) task.steps = [];
    if (!Array.isArray(task.checkpoints)) task.checkpoints = [];
    task.status = String(task.status || "completed");
  }
  return state;
}

function terminalAiTaskForId(state, taskId) {
  terminalAiEnsureTaskState(state);
  return state && state.agentTasks.find(task => String(task.id) === String(taskId)) || null;
}

function terminalAiTaskAttemptedCommands(state, taskId) {
  const task = terminalAiTaskForId(state, taskId);
  return new Set((task?.steps || [])
    .filter(step => step.kind === "command" && step.command)
    .map(step => String(step.command).trim()));
}

function terminalAiDuplicateSummaryPrompt(originalPrompt, command, result={}) {
  const output = (typeof terminalAiStripControl === "function" ? terminalAiStripControl(result.output || "") : String(result.output || "")).slice(-8000);
  return tr("terminal:ai.agent_duplicate_summary_prompt", {task:String(originalPrompt || "").slice(0, 6000), command:String(command || "").slice(0, 100000), output, defaultValue:`原始任务：${String(originalPrompt || "")}。命令“${String(command || "")}”已经在本次任务中执行过，不能再次执行。第一次执行的唯一可信终端结果如下：\n${output}\n请只给出最终收尾总结：说明任务是否完成、实际结果、失败原因或用户下一步。不要输出命令、不要调用工具、不要重新执行任何操作。`});
}

function terminalAiAgentTargetContexts(activeKey="") {
  if (typeof tabs === "undefined" || !Array.isArray(tabs)) return [];
  const terminals = tabs.filter(tab => tab?.kind === "terminal").slice(0, 32).map(tab => {
    const session = typeof terminalSessions !== "undefined" ? terminalSessions.get(String(tab.key || "")) : null;
    const connection = session?.connection || (typeof currentConnection === "function" ? currentConnection(Number(tab.id || 0)) : null);
    const status = typeof terminalSessionConnectionStatus === "function" ? terminalSessionConnectionStatus(session) : String(tab.connectionStatus || "disconnected");
    return {key:String(tab.key || ""), title:String(tab.title || tab.key || ""), host:String(connection?.ssh_host || ""), user:String(connection?.ssh_user || ""), status, active:String(tab.key || "") === String(activeKey || "")};
  }).filter(item => item.key);
  if (terminals.length < 2) return [];
  const currentLabel = tr("terminal:ai.agent_current_target", {defaultValue:"当前"});
  const unknownHostLabel = tr("terminal:ai.agent_unknown_host", {defaultValue:"未识别主机"});
  const lines = terminals.map(item => `- ${item.active ? `[${currentLabel}] ` : ""}${item.title} · ${item.user ? `${item.user}@` : ""}${item.host || unknownHostLabel} · ${item.status}`).join("\n");
  return [{source:"terminal-targets", title:tr("terminal:ai.agent_targets_title", {defaultValue:"可用终端目标"}), text:`${tr("terminal:ai.agent_targets_hint", {defaultValue:"当前工作区有多个终端。涉及多主机时先说明目标和主机差异；没有明确授权时不要向多个主机执行写操作。"})}\n${lines}`}];
}

function terminalAiPlatformContext() {
  const userAgent = typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
  const platform = typeof navigator !== "undefined" ? String(navigator.platform || "") : "";
  const label = /windows/i.test(`${platform} ${userAgent}`) ? "Windows" : /macintosh|mac os/i.test(`${platform} ${userAgent}`) ? "macOS" : /linux|android/i.test(`${platform} ${userAgent}`) ? "Linux" : "未知平台";
  return {source:"client-platform", title:tr("terminal:ai.agent_platform_title", {defaultValue:"Terma 客户端平台"}), text:tr("terminal:ai.agent_platform_context", {platform:label, defaultValue:`Terma 客户端平台：${label}。终端命令必须以远端 shell 实际输出为准，无法确认 shell 时先探测，不要假设 bash、zsh 或 PowerShell。`})};
}

function terminalAiTaskDiagnostics(task, state) {
  const blocks = Array.isArray(state?.blocks) ? state.blocks : [];
  const rows = [];
  for (const step of Array.isArray(task?.steps) ? task.steps : []) {
    const command = String(step?.command || step?.label || "").trim();
    const block = [...blocks].reverse().find(item => String(item?.command || "").trim() === command);
    const output = typeof terminalAiStripControl === "function" ? terminalAiStripControl(block?.output || "") : String(block?.output || "");
    if (!output) continue;
    if (/\b(?:uptime|load average|负载|load)\b/i.test(command) || /load average|负载/i.test(output)) rows.push({kind:"system", label:tr("terminal:ai.diagnostic_system", {defaultValue:"系统负载"}), value:output.split(/\r?\n/).filter(Boolean).at(-1)});
    if (/\b(?:df|disk|磁盘)\b/i.test(command)) rows.push({kind:"disk", label:tr("terminal:ai.diagnostic_disk", {defaultValue:"磁盘空间"}), value:output.split(/\r?\n/).filter(Boolean).slice(-2).join(" · ")});
    if (/\b(?:ss|netstat|lsof|port|端口)\b/i.test(command)) rows.push({kind:"network", label:tr("terminal:ai.diagnostic_network", {defaultValue:"网络/端口"}), value:output.split(/\r?\n/).filter(Boolean).slice(-2).join(" · ")});
    if (/\b(?:systemctl|service)\b/i.test(command)) rows.push({kind:"service", label:tr("terminal:ai.diagnostic_service", {defaultValue:"服务状态"}), value:output.split(/\r?\n/).filter(Boolean).at(-1)});
    if (/^git\s+/i.test(command)) rows.push({kind:"git", label:tr("terminal:ai.diagnostic_git", {defaultValue:"Git 状态"}), value:output.split(/\r?\n/).filter(Boolean).slice(-2).join(" · ")});
  }
  return rows.slice(-12);
}

function terminalAiTaskFallbackPlan(prompt) {
  const source = String(prompt || "").toLowerCase();
  const verify = /(?:部署|安装|修复|修改|配置|重启|更新|删除|卸载|deploy|install|fix|configure|restart|update|remove)/i.test(source)
    ? tr("terminal:ai.task_plan_verify_change", {defaultValue:"验证变更结果并确认服务状态"})
    : tr("terminal:ai.task_plan_verify", {defaultValue:"核对结果并给出结论"});
  return [
    {id:"understand", label:tr("terminal:ai.task_plan_understand", {defaultValue:"理解任务并确认检查范围"}), status:"running"},
    {id:"inspect", label:tr("terminal:ai.task_plan_inspect", {defaultValue:"收集真实终端信息"}), status:"pending"},
    {id:"act", label:tr("terminal:ai.task_plan_act", {defaultValue:"执行必要的处理步骤"}), status:"pending"},
    {id:"verify", label:verify, status:"pending"}
  ];
}

function terminalAiTaskHasModelPlan(task) {
  return Boolean(task && Array.isArray(task.plan) && task.plan.some(item => String(item?.id || "").startsWith("model-")));
}

function terminalAiTaskAdvanceModelPlan(task, status) {
  if (!terminalAiTaskHasModelPlan(task)) return;
  const next = task.plan.find(item => ["pending", "running"].includes(String(item.status)));
  if (!next) return;
  const value = String(status || "");
  if (value === "running") {
    next.status = "running";
  } else if (["success", "completed"].includes(value)) {
    next.status = "success";
    const following = task.plan.find(item => item.status === "pending");
    if (following) following.status = "running";
  } else if (["failed", "stopped"].includes(value)) {
    next.status = value;
  } else if (["waiting", "needs-confirmation"].includes(value)) {
    next.status = value;
  }
}

function terminalAiExtractPlanFromAnswer(answer) {
  const source = String(answer || "").split(String.fromCharCode(96).repeat(3))[0].slice(0, 1800);
  const marker = source.match(/(?:计划|执行计划|步骤|plan|steps)\s*[:：]?([\s\S]*)/i);
  const body = marker ? marker[1] : source;
  const items = body.split(/\r?\n/).map(line => line.trim())
    .map(line => (line.match(/^(?:\d+[.)]|[-*])\s+(.+)$/) || [])[1] || "")
    .map(item => item.replace(/[_*]/g, "").replace(/\s+/g, " ").trim().slice(0, 180))
    .filter(item => item.length >= 4)
    .slice(0, TERMINAL_AI_MAX_TASK_PLAN);
  return [...new Set(items)];
}

function terminalAiBeginTask(key, prompt, contexts, existingId="") {
  const state = terminalAiEnsureTaskState(terminalAiStateForKey(key));
  const existing = existingId ? terminalAiTaskForId(state, existingId) : null;
  if (existing) {
    const now = Date.now();
    const previousStatus = existing.status;
    existing.status = "running";
    existing.error = "";
    existing.updatedAt = now;
    existing.resumedAt = now;
    existing.activeStartedAt = now;
    existing.resultSummary = "";
    existing.endedAt = 0;
    for (const item of existing.plan) {
      if (["failed", "stopped", "waiting", "needs-confirmation"].includes(String(item.status))) item.status = "pending";
    }
    const nextPlanStep = existing.plan.find(item => item.status === "pending");
    if (nextPlanStep) nextPlanStep.status = "running";
    existing.resumeFromStatus = previousStatus;
    state.activeTaskId = existing.id;
    terminalAiPersistState(key, state);
    return existing;
  }
  const id = createTerminalLogId();
  const now = Date.now();
  const task = {
    id,
    title:String(prompt || "").replace(/\s+/g, " ").trim().slice(0, 72) || tr("terminal:ai.new_session", {defaultValue:"新会话"}),
    prompt:String(prompt || "").trim().slice(0, 6000),
    status:"running",
    startedAt:now,
    updatedAt:now,
    activeStartedAt:now,
    durationMs:0,
    plan:terminalAiTaskFallbackPlan(prompt),
    planSource:"fallback",
    steps:[],
    checkpoints:[],
    contextSources:(Array.isArray(contexts) ? contexts : []).map(item => ({source:String(item && item.source || "").slice(0, 40), title:String(item && item.title || "").slice(0, 120)})).slice(0, 8),
    error:"",
    resultSummary:""
  };
  state.agentTasks = [task, ...state.agentTasks.filter(item => item.id !== id)].slice(0, TERMINAL_AI_MAX_TASKS);
  state.activeTaskId = id;
  terminalAiPersistState(key, state);
  return task;
}

function terminalAiTaskAddStep(key, taskId, input={}) {
  const state = terminalAiEnsureTaskState(terminalAiStateForKey(key));
  const task = terminalAiTaskForId(state, taskId);
  if (!task) return null;
  const step = {
    id:createTerminalLogId(),
    kind:String(input.kind || "action"),
    label:String(input.label || input.command || "").slice(0, 240),
    command:typeof terminalAiCommandText === "function" ? terminalAiCommandText(input.command || "") : String(input.command || "").slice(0, 100000),
    status:String(input.status || "pending"),
    startedAt:0,
    endedAt:0,
    checkpointId:String(input.checkpointId || ""),
    error:String(input.error || "").slice(0, 400),
    risk:String(input.risk || "").slice(0, 240)
  };
  task.steps.push(step);
  task.steps = task.steps.slice(-TERMINAL_AI_MAX_TASK_STEPS);
  task.updatedAt = Date.now();
  if (terminalAiTaskHasModelPlan(task)) {
    terminalAiTaskAdvanceModelPlan(task, step.status);
  } else if (step.kind === "command") {
    const inspect = task.plan.find(item => item.id === "inspect");
    const understand = task.plan.find(item => item.id === "understand");
    if (understand && understand.status === "running") understand.status = "success";
    if (inspect && inspect.status === "pending") inspect.status = "running";
  }
  terminalAiPersistState(key, state);
  if (state.open) renderTerminalAiPanel(key);
  return step;
}

function terminalAiTaskUpdateStep(key, taskId, stepId, patch={}) {
  const state = terminalAiEnsureTaskState(terminalAiStateForKey(key));
  const task = terminalAiTaskForId(state, taskId);
  const step = task && task.steps.find(item => String(item.id) === String(stepId));
  if (!task || !step) return null;
  Object.assign(step, patch);
  if (patch.status === "running" && !step.startedAt) step.startedAt = Date.now();
  if (["success", "completed", "failed", "stopped", "skipped", "waiting", "needs-confirmation"].includes(String(patch.status))) step.endedAt = Date.now();
  task.updatedAt = Date.now();
  const inspect = task.plan.find(item => item.id === "inspect");
  const act = task.plan.find(item => item.id === "act");
  if (terminalAiTaskHasModelPlan(task)) {
    terminalAiTaskAdvanceModelPlan(task, patch.status);
  } else if (step.kind === "command") {
    if (patch.status === "success" || patch.status === "completed") {
      if (inspect && inspect.status === "running") inspect.status = "success";
      if (act && act.status === "pending") act.status = "running";
    } else if (patch.status === "failed") {
      if (act && (act.status === "pending" || act.status === "running")) act.status = "failed";
    } else if (patch.status === "waiting" || patch.status === "needs-confirmation") {
      if (act && (act.status === "pending" || act.status === "running")) act.status = "waiting";
    }
  }
  terminalAiPersistState(key, state);
  if (state.open) renderTerminalAiPanel(key);
  return step;
}

function terminalAiTaskPrepareAction(key, taskId, input={}) {
  if (typeof terminalAiTaskAddStep !== "function") return null;
  const step = terminalAiTaskAddStep(key, taskId, input);
  if (!step) return null;
  terminalAiTaskUpdateStep(key, taskId, step.id, {status:"running"});
  if (input.checkpoint === true && typeof terminalAiTaskCreateCheckpoint === "function") {
    const command = input.command || input.label || "";
    const baseRisk = {reason:input.checkpointReason || input.risk || ""};
    const review = typeof terminalAiCommandReview === "function" ? terminalAiCommandReview(command, {safe:false, reason:baseRisk.reason}, {checkpointId:step.id}) : null;
    const checkpoint = terminalAiTaskCreateCheckpoint(key, taskId, command, {...baseRisk, ...(review || {})});
    if (checkpoint) terminalAiTaskUpdateStep(key, taskId, step.id, {checkpointId:checkpoint.id});
  }
  return step;
}

function terminalAiTaskCompleteAction(key, taskId, step, status, error="") {
  if (!step || typeof terminalAiTaskUpdateStep !== "function") return;
  terminalAiTaskUpdateStep(key, taskId, step.id, {status:String(status || "failed"), error:String(error || "")});
}

async function terminalAiRunMcpTaskAction(key, taskId, call, options={}) {
  const label = "MCP " + String(call?.server || "") + "." + String(call?.tool || "");
  const approvalReason = tr("terminal:ai.mcp_approval_reason", {defaultValue:"MCP 工具可能访问外部服务或修改数据"});
  const step = terminalAiTaskPrepareAction(key, taskId, {kind:"mcp", label, status:"pending", risk:approvalReason, checkpoint:true, checkpointReason:tr("terminal:ai.mcp_approval_reason", {defaultValue:"MCP 工具调用前"})});
  const result = {kind:"mcp", server:call?.server || "", tool:call?.tool || "", arguments:call?.arguments || {}, output:"", status:tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"})};
  let execution = null;
  try {
    execution = await executeTerminalAiMcpCall(key, call, options);
    result.output = execution?.output || "";
    result.status = execution?.unsupported
      ? tr("terminal:ai.mcp_unsupported", {tool:call?.tool, defaultValue:"未执行：未发现或未启用工具 " + String(call?.tool || "")})
      : execution?.called
        ? tr("terminal:ai.completed", {defaultValue:"已完成"})
        : execution?.denied
          ? tr("terminal:ai.agent_denied", {defaultValue:"用户拒绝执行"})
          : tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"});
  } catch (error) {
    result.status = String(error?.message || tr("terminal:ai.agent_not_executed", {defaultValue:"未执行"}));
  }
  terminalAiTaskCompleteAction(key, taskId, step, execution?.called ? "success" : execution?.denied ? "needs-confirmation" : "failed", execution?.called ? "" : result.status);
  return result;
}

function terminalAiTaskCreateCheckpoint(key, taskId, command, risk={}) {
  const state = terminalAiEnsureTaskState(terminalAiStateForKey(key));
  const task = terminalAiTaskForId(state, taskId);
  if (!task) return null;
  const blocks = state.blocks.slice(-8).map(block => ({
    id:String(block.id || ""),
    command:String(block.command || "").slice(0, 200),
    outputHash:terminalAiTaskHash(terminalAiStripControl(block.output || "")),
    completed:Boolean(block.completedAt)
  }));
  const checkpoint = {
    id:createTerminalLogId(),
    createdAt:Date.now(),
    reason:tr("terminal:ai.task_checkpoint_before_change", {defaultValue:"高风险操作前"}),
    command:typeof terminalAiCommandText === "function" ? terminalAiCommandText(command || "") : String(command || "").slice(0, 100000),
    risk:String(risk && risk.reason || "").slice(0, 240),
    blockCount:state.blocks.length,
    stepCount:task.steps.length,
    outputHash:terminalAiTaskHash(JSON.stringify(blocks)),
    verified:false,
    backupCommand:String(risk && risk.backupCommand || ""),
    rollbackCommand:String(risk && risk.rollbackCommand || ""),
    backupStatus:risk && risk.backupCommand ? "pending" : "none",
    rollbackStatus:"none",
    backupNote:String(risk && risk.backupNote || "").slice(0, 240)
  };
  task.checkpoints = [checkpoint, ...task.checkpoints].slice(0, TERMINAL_AI_MAX_CHECKPOINTS);
  task.updatedAt = Date.now();
  terminalAiPersistState(key, state);
  return checkpoint;
}

function terminalAiTaskRecordAnswer(key, taskId, answer) {
  const state = terminalAiEnsureTaskState(terminalAiStateForKey(key));
  const task = terminalAiTaskForId(state, taskId);
  if (!task) return;
  const extracted = terminalAiExtractPlanFromAnswer(answer);
  if (extracted.length >= 2 && task.planSource === "fallback") {
    task.plan = extracted.map((label, index) => ({id:"model-" + (index + 1), label, status:index === 0 ? "running" : "pending"}));
    task.planSource = "model";
  }
  task.updatedAt = Date.now();
  terminalAiPersistState(key, state);
}

function terminalAiTaskSummaryFromAnswer(answer) {
  const source = String(answer || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim();
  if (!source) return "";
  const fragments = (source.match(/[^。！？.!?]+(?:[。！？]|[.!?](?=\s|$)|$)/g) || [source])
    .map(item => item.trim()).filter(Boolean);
  const candidate = (fragments.slice().reverse().find(item => !/^(?:计划|执行计划|步骤|plan|steps)\b/i.test(item)) || fragments.at(-1) || source);
  return candidate.replace(/^[#>*\-\d.)\s]+/, "").trim().slice(0, 360);
}

function terminalAiTaskDurationLabel(value) {
  const seconds = Math.max(0, Math.round(Number(value || 0) / 1000));
  if (seconds < 60) return tr("terminal:ai.task_duration_seconds", {seconds, defaultValue:`${seconds} 秒`});
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder
    ? tr("terminal:ai.task_duration_minutes_seconds", {minutes, seconds:remainder, defaultValue:`${minutes} 分 ${remainder} 秒`})
    : tr("terminal:ai.task_duration_minutes", {minutes, defaultValue:`${minutes} 分`});
}

function terminalAiTaskFinish(key, taskId, options={}) {
  const state = terminalAiEnsureTaskState(terminalAiStateForKey(key));
  const task = terminalAiTaskForId(state, taskId);
  if (!task) return;
  const finishedAt = Date.now();
  if (task.activeStartedAt) {
    task.durationMs = Math.max(0, Number(task.durationMs || 0) + Math.max(0, finishedAt - task.activeStartedAt));
    task.activeStartedAt = 0;
  }
  if (options.error) {
    task.status = "failed";
    task.error = String(options.error).slice(0, 500);
  } else if (state.agentWaitingForInput && (
    state.agentWaitingForInput.taskId === task.id
    || state.agentWaitingForInput.blockId === state.blocks.at(-1)?.id
  )) {
    task.status = "waiting";
  } else if (!["stopped", "failed", "waiting"].includes(task.status)) {
    task.status = "completed";
    task.error = "";
  }
  const latestAnswer = [...state.turns].reverse().find(item => String(item?.taskId || "") === String(task.id) && String(item?.answer || "").trim());
  if (task.status === "completed" && latestAnswer) task.resultSummary = terminalAiTaskSummaryFromAnswer(latestAnswer.answer);
  else if (task.status !== "completed") task.resultSummary = "";
  const last = task.steps.at(-1);
  if (task.status === "completed") {
    for (const item of task.plan) {
      if (item.status === "running") item.status = "success";
      else if (item.status === "pending") item.status = "skipped";
    }
    const verify = task.plan.at(-1);
    if (verify) verify.status = "success";
  } else if (task.status === "failed") {
    const active = task.plan.find(item => ["running", "pending"].includes(item.status));
    if (active) active.status = "failed";
  } else if (task.status === "stopped") {
    for (const item of task.plan) if (["pending", "running"].includes(item.status)) item.status = "stopped";
  }
  if (last && task.status === "completed" && ["pending", "running"].includes(last.status)) last.status = "success";
  task.updatedAt = finishedAt;
  task.endedAt = finishedAt;
  terminalAiPersistState(key, state);
  if (state.open) renderTerminalAiPanel(key);
}

function terminalAiTaskMarkStopped(key) {
  const state = terminalAiEnsureTaskState(terminalAiStateForKey(key));
  const task = state.activeTaskId ? terminalAiTaskForId(state, state.activeTaskId) : null;
  if (!task || task.status !== "running") return;
  task.status = "stopped";
  task.error = tr("terminal:ai.task_stopped_detail", {defaultValue:"任务被用户停止，已保留已执行步骤和检查点。"});
  for (const item of task.plan) if (["pending", "running"].includes(item.status)) item.status = "stopped";
  const current = task.steps.find(item => ["pending", "running"].includes(item.status));
  if (current) { current.status = "stopped"; current.endedAt = Date.now(); }
  const stoppedAt = Date.now();
  if (task.activeStartedAt) {
    task.durationMs = Math.max(0, Number(task.durationMs || 0) + Math.max(0, stoppedAt - task.activeStartedAt));
    task.activeStartedAt = 0;
  }
  task.updatedAt = stoppedAt;
  task.endedAt = stoppedAt;
  terminalAiPersistState(key, state);
  if (state.open) renderTerminalAiPanel(key);
}

function terminalAiTaskRecoveryPrompt(task) {
  const steps = (task && task.steps || []).slice(-12).map((step, index) => (index + 1) + ". " + step.label + " [" + terminalAiTaskStatusLabel(step.status) + "]").join("\n");
  const checkpoints = (task && task.checkpoints || []).slice(0, 4).map(item => item.command + " (hash " + item.outputHash + ")").join("\n");
  return tr("terminal:ai.task_recovery_prompt", {
    task:String(task && task.prompt || ""),
    steps,
    checkpoints,
    status:terminalAiTaskStatusLabel(task && task.status),
    defaultValue:"继续完成原始任务：" + String(task && task.prompt || "") + "\n当前任务状态：" + terminalAiTaskStatusLabel(task && task.status) + "。\n已执行步骤：\n" + (steps || "暂无") + "\n检查点：\n" + (checkpoints || "暂无") + "\n请根据已有真实终端输出继续。不要重复已经成功的步骤；如需修改文件或改变系统，先说明风险并给出一条命令。"
  });
}

function terminalAiTaskResume(key, taskId) {
  const state = terminalAiEnsureTaskState(terminalAiStateForKey(key));
  const task = terminalAiTaskForId(state, taskId);
  if (!task || !["failed", "stopped", "waiting"].includes(task.status)) return;
  if (terminalSessions.get(key)?.agentCommandInFlight) {
    notify(tr("terminal:ai.command_busy", {defaultValue:"上一条 Agent 命令仍在执行，已等待终端返回提示符"}), "info");
    return;
  }
  const recoveryPrompt = terminalAiTaskRecoveryPrompt(task);
  task.status = "running";
  task.error = "";
  state.agentWaitingForInput = null;
  state.activeTaskId = task.id;
  terminalAiPersistState(key, state);
  renderTerminalAiPanel(key);
  return submitTerminalAiRequest(key, recoveryPrompt, terminalAiContextForKey(key), {agentTask:true, taskId:task.id, resume:true, displayPrompt:task.prompt});
}

async function terminalAiTaskRollback(key, taskId, checkpointId="") {
  const state = terminalAiEnsureTaskState(terminalAiStateForKey(key));
  const task = terminalAiTaskForId(state, taskId);
  const checkpoint = task?.checkpoints?.find(item => String(item.id) === String(checkpointId))
    || task?.checkpoints?.find(item => item.rollbackCommand && item.backupStatus === "ready");
  if (!task || !checkpoint?.rollbackCommand || checkpoint.backupStatus !== "ready") return false;
  const reason = tr("terminal:ai.task_rollback_reason", {defaultValue:"这会用执行前检查点覆盖当前文件，需要确认"});
  const execution = await executeTerminalAiCommand(key, checkpoint.rollbackCommand, {auto:false, details:true, taskId:task.id, risk:{safe:false, reason, review:{kind:"file", impact:tr("terminal:ai.task_rollback_impact", {defaultValue:"恢复检查点中的文件内容"}), files:[], services:[], packages:[], steps:[checkpoint.rollbackCommand], backupNote:tr("terminal:ai.task_rollback_backup_note", {defaultValue:"使用已验证的执行前备份"})}}});
  if (!execution?.sent || !execution.blockId) return false;
  const completed = await waitForTerminalAiCommandCompletion(key, execution.blockId, {});
  if (!completed || completed.waitingForInput || completed.timedOutAt || (completed.exitCode && completed.exitCode !== 0)) {
    checkpoint.rollbackStatus = "failed";
    checkpoint.rollbackError = String(completed?.output || tr("terminal:ai.task_rollback_failed", {defaultValue:"回滚命令未能确认成功"})).slice(-400);
    terminalAiPersistState(key, state);
    renderTerminalAiPanel(key);
    return false;
  }
  checkpoint.rollbackStatus = "success";
  checkpoint.rollbackVerifiedAt = Date.now();
  task.resultSummary = tr("terminal:ai.task_rollback_done", {defaultValue:"已根据执行前检查点恢复变更"});
  task.updatedAt = Date.now();
  terminalAiPersistState(key, state);
  renderTerminalAiPanel(key);
  notify(task.resultSummary, "success");
  return true;
}

function terminalAiTaskPlanHtml(key, taskId, options={}) {
  const state = terminalAiEnsureTaskState(terminalAiStateForKey(key));
  const task = terminalAiTaskForId(state, taskId);
  if (!task) return "";
  const completed = task.steps.filter(step => ["success", "completed"].includes(step.status)).length;
  const durationMs = Number(task.durationMs || 0) + (task.activeStartedAt ? Math.max(0, Date.now() - task.activeStartedAt) : 0);
  const resumable = ["failed", "stopped", "waiting"].includes(task.status);
  const plan = task.plan.map(item => "<li class=\"terminal-ai-task-plan-item " + terminalAiTaskStateClass(item.status) + "\"><span class=\"terminal-ai-task-plan-icon\">" + icon(item.status === "success" ? "check" : item.status === "failed" ? "circle-alert" : item.status === "running" ? "loader-circle" : "circle") + "</span><span>" + esc(item.label) + "</span><small>" + esc(terminalAiTaskStatusLabel(item.status)) + "</small></li>").join("");
  const checkpointRows = task.checkpoints.slice(0, 6).map(item => "<li><time>" + esc(new Date(item.createdAt).toLocaleTimeString(document.documentElement.lang || undefined, {hour12:false})) + "</time><code title=\"" + escAttr(item.command) + "\">" + esc(item.command) + "</code><small>" + esc(item.backupStatus === "ready" ? tr("terminal:ai.task_checkpoint_ready", {defaultValue:"已备份"}) : item.backupStatus === "failed" ? tr("terminal:ai.task_checkpoint_failed", {defaultValue:"备份失败"}) : item.backupStatus === "pending" ? tr("terminal:ai.task_checkpoint_pending", {defaultValue:"待备份"}) : esc(item.backupStatus || item.outputHash)) + "</small></li>").join("");
  const checkpointHtml = checkpointRows ? "<details class=\"terminal-ai-task-checkpoints\"><summary>" + icon("shield-check") + "<span>" + esc(tr("terminal:ai.task_checkpoints", {defaultValue:"检查点记录"})) + "</span></summary><ol>" + checkpointRows + "</ol></details>" : "";
  const stepRows = task.steps.map((step, index) => {
    const stepDuration = step.startedAt ? Math.max(0, (step.endedAt || Date.now()) - step.startedAt) : 0;
    return "<li><span class=\"terminal-ai-task-step-number\">" + (index + 1) + "</span><span class=\"terminal-ai-task-step-label\" title=\"" + escAttr(step.label) + "\">" + esc(step.label) + "</span><small>" + esc(terminalAiTaskDurationLabel(stepDuration)) + " · " + esc(terminalAiTaskStatusLabel(step.status)) + "</small></li>";
  }).join("");
  const stepHtml = stepRows ? "<details class=\"terminal-ai-task-step-records\" " + (options.dock && !state.taskPlanCollapsed ? "open" : "") + "><summary>" + icon("list-ordered") + "<span>" + esc(tr("terminal:ai.task_step_records", {defaultValue:"执行记录"})) + "</span><small>" + esc(String(task.steps.length)) + "</small></summary><ol>" + stepRows + "</ol></details>" : "";
  const diagnostics = terminalAiTaskDiagnostics(task, state);
  const diagnosticsHtml = diagnostics.length ? "<details class=\"terminal-ai-task-diagnostics\"><summary>" + icon("activity") + "<span>" + esc(tr("terminal:ai.task_diagnostics", {defaultValue:"诊断摘要"})) + "</span><small>" + esc(String(diagnostics.length)) + "</small></summary><div class=\"terminal-ai-task-diagnostic-grid\">" + diagnostics.map(item => "<div><strong>" + esc(item.label) + "</strong><span title=\"" + escAttr(item.value || "") + "\">" + esc(item.value || "") + "</span></div>").join("") + "</div></details>" : "";
  const summaryHtml = task.resultSummary ? "<div class=\"terminal-ai-task-result\">" + icon("check-check") + "<div><strong>" + esc(tr("terminal:ai.task_result_summary", {defaultValue:"最终结果"})) + "</strong><span>" + esc(task.resultSummary) + "</span></div></div>" : "";
  const resumeHtml = resumable ? "<button class=\"primary terminal-ai-task-resume\" type=\"button\" data-action=\"terminal-ai-task-resume\" data-terminal-ai-key=\"" + escAttr(key) + "\" data-task-id=\"" + escAttr(task.id) + "\">" + icon("play") + "<span>" + esc(tr("terminal:ai.task_resume", {defaultValue:"继续任务"})) + "</span></button>" : "";
  const rollback = task.checkpoints.find(item => item.rollbackCommand && item.backupStatus === "ready" && item.rollbackStatus !== "success");
  const rollbackHtml = rollback && ["failed", "stopped"].includes(task.status) ? "<button class=\"terminal-ai-task-rollback\" type=\"button\" data-action=\"terminal-ai-task-rollback\" data-terminal-ai-key=\"" + escAttr(key) + "\" data-task-id=\"" + escAttr(task.id) + "\" data-checkpoint-id=\"" + escAttr(rollback.id) + "\">" + icon("undo-2") + "<span>" + esc(tr("terminal:ai.task_rollback", {defaultValue:"回滚变更"})) + "</span></button>" : "";
  const open = options.dock ? state.taskPlanCollapsed !== true : task.status === "running";
  const title = task.title || tr("terminal:ai.task_plan_title", {defaultValue:"任务计划"});
  return "<details class=\"terminal-ai-task-plan\" data-terminal-ai-task-dock-details=\"" + (options.dock ? "true" : "false") + "\"" + (open ? " open" : "") + "><summary><span>" + icon("list-check") + "<b>" + esc(tr("terminal:ai.task_plan_title", {defaultValue:"任务计划"})) + "</b><small class=\"terminal-ai-task-plan-title\" title=\"" + escAttr(title) + "\">" + esc(title) + "</small></span><span class=\"terminal-ai-task-status " + terminalAiTaskStateClass(task.status) + "\">" + esc(terminalAiTaskStatusLabel(task.status)) + "</span></summary><div class=\"terminal-ai-task-plan-body\"><ol class=\"terminal-ai-task-plan-list\">" + plan + "</ol><div class=\"terminal-ai-task-meta\"><span>" + esc(tr("terminal:ai.task_progress", {completed:completed, total:task.steps.length, defaultValue:"已完成 " + completed + " 个步骤" + (task.steps.length ? " · 共 " + task.steps.length + " 个操作" : "")})) + "</span><span>" + esc(tr("terminal:ai.task_duration_total", {duration:terminalAiTaskDurationLabel(durationMs), defaultValue:"耗时 " + terminalAiTaskDurationLabel(durationMs)})) + "</span><span>" + esc(tr("terminal:ai.task_checkpoint_count", {count:task.checkpoints.length, defaultValue:"检查点 " + task.checkpoints.length + " 个"})) + "</span></div>" + summaryHtml + stepHtml + diagnosticsHtml + (task.error ? "<div class=\"terminal-ai-task-error\">" + icon("circle-alert") + "<span>" + esc(task.error) + "</span></div>" : "") + checkpointHtml + resumeHtml + rollbackHtml + "</div></details>";
}

function terminalAiTaskDockHtml(key) {
  const state = terminalAiEnsureTaskState(terminalAiStateForKey(key));
  const active = state.activeTaskId ? terminalAiTaskForId(state, state.activeTaskId) : null;
  const task = active || state.agentTasks.slice().sort((a, b) => Number(b.updatedAt || b.startedAt || 0) - Number(a.updatedAt || a.startedAt || 0))[0];
  if (!task) return "";
  return "<div class=\"terminal-ai-task-dock-inner\">" + terminalAiTaskPlanHtml(key, task.id, {dock:true}) + "</div>";
}

function terminalAiInjectTaskPlans(key, turnsElement) {
  if (!turnsElement || typeof terminalAiTaskPlanHtml !== "function") return;
  turnsElement.querySelectorAll(".terminal-ai-task[data-terminal-ai-task-id]").forEach(article => {
    if (article.querySelector(":scope > .terminal-ai-task-plan")) return;
    const taskId = article.dataset.terminalAiTaskId || "";
    const wrapper = document.createElement("div");
    wrapper.innerHTML = terminalAiTaskPlanHtml(key, taskId).trim();
    const plan = wrapper.firstElementChild;
    const userMessage = article.querySelector(":scope > .terminal-ai-user-message");
    if (plan && userMessage) article.insertBefore(plan, userMessage);
  });
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("terminal-ai-task-resume", ({element}) => terminalAiTaskResume(element.dataset.terminalAiKey || activeTabKey, element.dataset.taskId || ""));
  registerTermaAction("terminal-ai-task-rollback", ({element}) => terminalAiTaskRollback(element.dataset.terminalAiKey || activeTabKey, element.dataset.taskId || "", element.dataset.checkpointId || ""));
}
