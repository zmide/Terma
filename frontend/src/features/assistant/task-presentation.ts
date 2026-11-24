import {translate as tr} from '../../shared/i18n/runtime';
import {terminalAiStripControl} from './response-text';
import type {AssistantState} from './assistant-model';
import type {TaskRecord} from './task-service';
export function terminalAiTaskStatusLabel(status:unknown) {
  const key = String(status || "pending");
  const labels:Record<string,string> = {
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

export function terminalAiTaskStateClass(status:unknown) {
  return ["success", "completed"].includes(String(status || "")) ? "success"
    : ["failed", "stopped"].includes(String(status || "")) ? "failed"
      : ["waiting", "needs-confirmation"].includes(String(status || "")) ? "waiting"
        : String(status || "pending");
}

export function terminalAiDuplicateSummaryPrompt(originalPrompt:unknown, command:unknown, result:{output?:unknown}={}) {
  const output = (terminalAiStripControl(result.output || "")).slice(-8000);
  return tr("terminal:ai.agent_duplicate_summary_prompt", {task:String(originalPrompt || "").slice(0, 6000), command:String(command || "").slice(0, 100000), output, defaultValue:`原始任务：${String(originalPrompt || "")}。命令“${String(command || "")}”已经在本次任务中执行过，不能再次执行。第一次执行的唯一可信终端结果如下：\n${output}\n请只给出最终收尾总结：说明任务是否完成、实际结果、失败原因或用户下一步。不要输出命令、不要调用工具、不要重新执行任何操作。`});
}

export function terminalAiTaskDiagnostics(task:TaskRecord, state:AssistantState) {
  const blocks = Array.isArray(state?.blocks) ? state.blocks : [];
  const rows = [];
  for (const step of Array.isArray(task?.steps) ? task.steps : []) {
    const command = String(step?.command || step?.label || "").trim();
    const block = [...blocks].reverse().find(item => String(item?.command || "").trim() === command);
    const output = terminalAiStripControl(block?.output || "");
    if (!output) continue;
    if (/\b(?:uptime|load average|负载|load)\b/i.test(command) || /load average|负载/i.test(output)) rows.push({kind:"system", label:tr("terminal:ai.diagnostic_system", {defaultValue:"系统负载"}), value:output.split(/\r?\n/).filter(Boolean).at(-1)});
    if (/\b(?:df|disk|磁盘)\b/i.test(command)) rows.push({kind:"disk", label:tr("terminal:ai.diagnostic_disk", {defaultValue:"磁盘空间"}), value:output.split(/\r?\n/).filter(Boolean).slice(-2).join(" · ")});
    if (/\b(?:ss|netstat|lsof|port|端口)\b/i.test(command)) rows.push({kind:"network", label:tr("terminal:ai.diagnostic_network", {defaultValue:"网络/端口"}), value:output.split(/\r?\n/).filter(Boolean).slice(-2).join(" · ")});
    if (/\b(?:systemctl|service)\b/i.test(command)) rows.push({kind:"service", label:tr("terminal:ai.diagnostic_service", {defaultValue:"服务状态"}), value:output.split(/\r?\n/).filter(Boolean).at(-1)});
    if (/^git\s+/i.test(command)) rows.push({kind:"git", label:tr("terminal:ai.diagnostic_git", {defaultValue:"Git 状态"}), value:output.split(/\r?\n/).filter(Boolean).slice(-2).join(" · ")});
  }
  return rows.slice(-12);
}

export function terminalAiTaskDurationLabel(value:unknown) {
  const seconds = Math.max(0, Math.round(Number(value || 0) / 1000));
  if (seconds < 60) return tr("terminal:ai.task_duration_seconds", {seconds, defaultValue:`${seconds} 秒`});
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder
    ? tr("terminal:ai.task_duration_minutes_seconds", {minutes, seconds:remainder, defaultValue:`${minutes} 分 ${remainder} 秒`})
    : tr("terminal:ai.task_duration_minutes", {minutes, defaultValue:`${minutes} 分`});
}

export function terminalAiTaskRecoveryPrompt(task:TaskRecord) {
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
