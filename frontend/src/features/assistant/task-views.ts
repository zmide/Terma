import {fallbackPlan} from './task-service';
import {translate as tr} from '../../shared/i18n/runtime';
import {escapeHtml as esc,escapeHtml as escAttr} from '../../shared/html-escape';
import {terminalAiTaskStateClass,terminalAiTaskStatusLabel,terminalAiTaskDurationLabel,terminalAiTaskDiagnostics} from './task-presentation';
import type {AssistantState} from './assistant-model';
import type {createTaskService,TaskRecord} from './task-service';
export function createTaskViews(port:{state(key:string):AssistantState;tasks:ReturnType<typeof createTaskService>;icon(name:string):string}) {
const icon=port.icon;
function terminalAiTaskPlanHtml(key:string, taskId:string, options:{dock?:boolean}={}) {
  const state = port.tasks.ensureState(port.state(key));
  const task = port.tasks.task(key, taskId);
  if (!task) return "";
  const completed = task.steps.filter(step => ["success", "completed"].includes(step.status)).length;
  const durationMs = Number(task.durationMs || 0) + (task.activeStartedAt ? Math.max(0, Date.now() - task.activeStartedAt) : 0);
  const resumable = ["failed", "stopped", "waiting"].includes(task.status);
  const defaults = task.planSource === 'fallback' ? fallbackPlan({tr},task.prompt) : [];
  const plan = task.plan.map(item => "<li class=\"terminal-ai-task-plan-item " + terminalAiTaskStateClass(item.status) + "\"><span class=\"terminal-ai-task-plan-icon\">" + icon(item.status === "success" ? "check" : item.status === "failed" ? "circle-alert" : item.status === "running" ? "loader-circle" : "circle") + "</span><span>" + esc(defaults.find(value => value.id === item.id)?.label || item.label) + "</span><small>" + esc(terminalAiTaskStatusLabel(item.status)) + "</small></li>").join("");
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
  const rollback = task.checkpoints.find(item => item.rollbackCommand && item.backupStatus === "ready" && item.verified === true && item.rollbackStatus !== "success");
  const rollbackHtml = rollback && ["failed", "stopped"].includes(task.status) ? "<button class=\"terminal-ai-task-rollback\" type=\"button\" data-action=\"terminal-ai-task-rollback\" data-terminal-ai-key=\"" + escAttr(key) + "\" data-task-id=\"" + escAttr(task.id) + "\" data-checkpoint-id=\"" + escAttr(rollback.id) + "\">" + icon("undo-2") + "<span>" + esc(tr("terminal:ai.task_rollback", {defaultValue:"回滚变更"})) + "</span></button>" : "";
  const open = options.dock ? state.taskPlanCollapsed !== true : task.status === "running";
  const title = task.title || tr("terminal:ai.task_plan_title", {defaultValue:"任务计划"});
  return "<details class=\"terminal-ai-task-plan\" data-terminal-ai-task-dock-details=\"" + (options.dock ? "true" : "false") + "\"" + (open ? " open" : "") + "><summary><span>" + icon("list-check") + "<b>" + esc(tr("terminal:ai.task_plan_title", {defaultValue:"任务计划"})) + "</b><small class=\"terminal-ai-task-plan-title\" title=\"" + escAttr(title) + "\">" + esc(title) + "</small></span><span class=\"terminal-ai-task-status " + terminalAiTaskStateClass(task.status) + "\">" + esc(terminalAiTaskStatusLabel(task.status)) + "</span></summary><div class=\"terminal-ai-task-plan-body\"><ol class=\"terminal-ai-task-plan-list\">" + plan + "</ol><div class=\"terminal-ai-task-meta\"><span>" + esc(tr("terminal:ai.task_progress", {completed:completed, total:task.steps.length, defaultValue:"已完成 " + completed + " 个步骤" + (task.steps.length ? " · 共 " + task.steps.length + " 个操作" : "")})) + "</span><span>" + esc(tr("terminal:ai.task_duration_total", {duration:terminalAiTaskDurationLabel(durationMs), defaultValue:"耗时 " + terminalAiTaskDurationLabel(durationMs)})) + "</span><span>" + esc(tr("terminal:ai.task_checkpoint_count", {count:task.checkpoints.length, defaultValue:"检查点 " + task.checkpoints.length + " 个"})) + "</span></div>" + summaryHtml + stepHtml + diagnosticsHtml + (task.error ? "<div class=\"terminal-ai-task-error\">" + icon("circle-alert") + "<span>" + esc(task.error) + "</span></div>" : "") + checkpointHtml + resumeHtml + rollbackHtml + "</div></details>";
}

function terminalAiTaskDockHtml(key:string) {
  const state = port.tasks.ensureState(port.state(key));
  const active = state.activeTaskId ? port.tasks.task(key, state.activeTaskId) : null;
  const task = active || (state.agentTasks as TaskRecord[]).slice().sort((a, b) => Number(b.updatedAt || b.startedAt || 0) - Number(a.updatedAt || a.startedAt || 0))[0];
  if (!task) return "";
  return "<div class=\"terminal-ai-task-dock-inner\">" + terminalAiTaskPlanHtml(key, task.id, {dock:true}) + "</div>";
}
return {plan:terminalAiTaskPlanHtml,dock:terminalAiTaskDockHtml};
}
