import {translate as tr} from '../../shared/i18n/runtime';
import {escapeHtml as esc} from '../../shared/html-escape';
import {terminalAiWaitingInputCopy} from './response-context';
import {terminalAiCommandReviewCopy,type terminalAiCommandReview} from './command-review';
import type {ApprovalRequest} from './execution-service';
import type {AssistantState} from './assistant-model';
import type {WaitingInput} from './terminal-command-service';
type ApprovalView=Omit<ApprovalRequest,'review'> & {review?:Partial<ReturnType<typeof terminalAiCommandReview>>|null};
const escAttr=esc;
function approvalHtml(key:string, approval:ApprovalView|null,icon:(name:string)=>string) {
  if (!approval) return "";
  if (approval.kind === "mcp") {
    const argumentsText = JSON.stringify(approval.arguments && typeof approval.arguments === "object" ? approval.arguments : {}, null, 2);
    return `<div class="terminal-ai-approval terminal-ai-mcp-approval" role="alert"><div class="terminal-ai-approval-head">${icon("shield-alert")}<strong>${esc(tr("terminal:ai.mcp_approval_title", {defaultValue:"调用工具前需要确认"}))}</strong></div><div class="terminal-ai-mcp-approval-title">${esc(tr("terminal:ai.mcp_call_title", {tool:approval.tool, defaultValue:`调用工具 ${approval.tool}`}))}</div><div class="terminal-ai-mcp-meta"><span>${esc(tr("terminal:ai.mcp_server", {defaultValue:"服务器"}))}</span><code>${esc(approval.server)}</code><span>${esc(tr("terminal:ai.mcp_tool", {defaultValue:"工具"}))}</span><code>${esc(approval.tool)}</code></div><pre>${esc(argumentsText)}</pre><p>${esc(approval.reason || tr("terminal:ai.mcp_approval_reason", {defaultValue:"MCP 工具可访问外部服务或修改数据，需要确认"}))}</p><div class="terminal-ai-approval-actions"><button class="primary" type="button" data-action="terminal-ai-approval-approve" data-terminal-ai-key="${escAttr(key)}">${icon("play")}<span>${esc(tr("terminal:ai.approval_approve", {defaultValue:"执行此调用"}))}</span></button><button type="button" data-action="terminal-ai-approval-reject" data-terminal-ai-key="${escAttr(key)}">${icon("x")}<span>${esc(tr("terminal:ai.approval_reject", {defaultValue:"拒绝"}))}</span></button><button type="button" data-action="terminal-ai-approval-stop" data-terminal-ai-key="${escAttr(key)}">${icon("square")}<span>${esc(tr("terminal:ai.approval_stop", {defaultValue:"停止任务"}))}</span></button></div></div>`;
  }
  const progress = (approval.total||0) > 1 ? ` (${approval.index}/${approval.total})` : "";
  const source = approval.review;
  const review = source ? {...source,...(source.kind && source.backupStatus ? terminalAiCommandReviewCopy(source.kind,source.backupStatus) : {})} : null;
  const reviewRows = review ? [
    review.impact ? `<div><span>${esc(tr("terminal:ai.review_impact_label", {defaultValue:"影响"}))}</span><strong>${esc(review.impact)}</strong></div>` : "",
    review.files?.length ? `<div><span>${esc(tr("terminal:ai.review_files_label", {defaultValue:"涉及文件"}))}</span><code>${esc(review.files.join("\n"))}</code></div>` : "",
    review.services?.length ? `<div><span>${esc(tr("terminal:ai.review_services_label", {defaultValue:"涉及服务"}))}</span><code>${esc(review.services.join(", "))}</code></div>` : "",
    review.packages?.length ? `<div><span>${esc(tr("terminal:ai.review_packages_label", {defaultValue:"软件包"}))}</span><code>${esc(review.packages.join(", "))}</code></div>` : "",
    (review.steps?.length||0) > 1 ? `<div><span>${esc(tr("terminal:ai.review_steps_label", {defaultValue:"执行步骤"}))}</span><ol>${review.steps!.map(step => `<li><code>${esc(step)}</code></li>`).join("")}</ol></div>` : "",
    review.residual?.length ? `<div><span>${esc(tr("terminal:ai.review_residual_label", {defaultValue:"执行后复核"}))}</span><ul>${review.residual.map(item => `<li>${esc(item)}</li>`).join("")}</ul></div>` : "",
    review.backupNote ? `<div class="terminal-ai-review-backup"><span>${esc(tr("terminal:ai.review_checkpoint_label", {defaultValue:"检查点"}))}</span><strong>${esc(review.backupNote)}</strong>${review.backupDirectory ? `<code>${esc(review.backupDirectory)}</code>` : ""}</div>` : ""
  ].filter(Boolean).join("") : "";
  const reviewHtml = reviewRows ? `<section class="terminal-ai-change-review"><div class="terminal-ai-change-review-title">${icon("file-diff")}<strong>${esc(tr("terminal:ai.review_title", {defaultValue:"执行前改动审阅"}))}</strong></div><div class="terminal-ai-change-review-grid">${reviewRows}</div></section>` : "";
  const insertButton = `<button type="button" data-action="terminal-ai-approval-insert" data-terminal-ai-key="${escAttr(key)}">${icon("arrow-down-to-line")}<span>${esc(tr("terminal:ai.approval_insert", {defaultValue:"仅放入终端"}))}</span></button>`;
  return `<div class="terminal-ai-approval" role="alert"><div class="terminal-ai-approval-head">${icon("shield-alert")}<strong>${esc(tr("terminal:ai.approval_title", {defaultValue:"需要确认后继续"}))}${esc(progress)}</strong></div><code>${esc(approval.command)}</code>${reviewHtml}<p>${esc(approval.reason || tr("terminal:ai.approval_default_reason", {defaultValue:"此命令可能改变系统或访问敏感资源"}))}</p><div class="terminal-ai-approval-actions"><button class="primary" type="button" data-action="terminal-ai-approval-approve" data-terminal-ai-key="${escAttr(key)}">${icon("play")}<span>${esc(tr("terminal:ai.approval_approve", {defaultValue:"执行此命令"}))}</span></button>${insertButton}<button type="button" data-action="terminal-ai-approval-reject" data-terminal-ai-key="${escAttr(key)}">${icon("x")}<span>${esc(tr("terminal:ai.approval_reject", {defaultValue:"拒绝并换方案"}))}</span></button><button type="button" data-action="terminal-ai-approval-stop" data-terminal-ai-key="${escAttr(key)}">${icon("square")}<span>${esc(tr("terminal:ai.approval_stop", {defaultValue:"停止任务"}))}</span></button></div></div>`;
}
export function assistantPendingMarkup(key:string,state:AssistantState,icon:(name:string)=>string){const chatMode=state.mode==='chat',copy=terminalAiWaitingInputCopy(state);return !chatMode && state.pendingApproval
    ? approvalHtml(key, state.pendingApproval as ApprovalView,icon)
    : !chatMode && state.agentWaitingForInput
      ? "<div class=\"terminal-ai-waiting-input\" role=\"alert\">" + icon("terminal-square") + "<div><strong>" + esc(tr("terminal:ai.waiting_input_title", {defaultValue:"终端正在等待人工输入"})) + "</strong><span>" + esc(copy.hint) + "</span><code>" + esc((state.agentWaitingForInput as WaitingInput & {command?:string}).command || "") + "</code><form class=\"terminal-ai-waiting-input-form\" data-submit-action=\"terminal-ai-waiting-input-submit\" data-terminal-ai-key=\"" + escAttr(key) + "\"><input type=\"" + copy.inputType + "\" data-terminal-ai-waiting-input=\"" + escAttr(key) + "\" autocomplete=\"off\" autocapitalize=\"none\" spellcheck=\"false\" placeholder=\"" + escAttr(copy.placeholder) + "\"><button class=\"primary\" type=\"submit\">" + icon("send") + "<span>" + esc(tr("terminal:ai.waiting_input_send", {defaultValue:"发送到终端"})) + "</span></button></form><small class=\"terminal-ai-waiting-input-privacy\">" + esc(tr("terminal:ai.waiting_input_privacy", {defaultValue:"内容只发送到终端，不会提交给 AI"})) + "</small></div></div>"
      : "";
}
