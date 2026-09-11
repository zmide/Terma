import { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { publicErrorBody } from "../public-error";

const defaultAutomations = require("../sftp-automations");

interface Dependencies {
  getDesktopIntegration(): any;
  isDesktopRequest(request: IncomingMessage): boolean;
  readJson(request: IncomingMessage): Promise<any>;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  automations?: any;
}

function allowed(request: IncomingMessage, dependencies: Dependencies) {
  const desktop = dependencies.getDesktopIntegration?.();
  if (!dependencies.isDesktopRequest(request) || !desktop) return false;
  return true;
}

export async function handleSftpAutomationRoutes(request: IncomingMessage, response: ServerResponse, pathname: string, dependencies: Dependencies): Promise<boolean> {
  if (pathname !== "/api/sftp/automations" && !pathname.startsWith("/api/sftp/automations/")) return false;
  if (!allowed(request, dependencies)) {
    dependencies.sendJson(response, publicErrorBody("SFTP_AUTOMATION_DESKTOP_ONLY", "SFTP 定时传输和文件夹同步仅在 Terma 桌面端运行；Web 端不会访问本机文件"), 403);
    return true;
  }
  const operations = dependencies.automations || defaultAutomations;
  const method = request.method || "GET";
  const url = new URL(request.url || pathname, "http://terma.invalid");
  const parts = pathname.split("/").filter(Boolean);
  if (method === "GET" && pathname === "/api/sftp/automations") {
    dependencies.sendJson(response, operations.listAutomations());
    return true;
  }
  if (method === "POST" && pathname === "/api/sftp/automations") {
    const item = operations.saveAutomation(await dependencies.readJson(request));
    operations.syncAutomationSchedule(item.id, true);
    dependencies.sendJson(response, operations.getAutomation(item.id), 201);
    return true;
  }
  if (method === "GET" && pathname === "/api/sftp/automations/runs") {
    dependencies.sendJson(response, operations.listAutomationRuns(0));
    return true;
  }
  if (method === "POST" && pathname === "/api/sftp/automations/cron-preview") {
    const payload = await dependencies.readJson(request);
    const cron = String(payload?.cron || payload?.cron_expression || "").trim();
    const fromMs = Number(payload?.from_ms || Date.now());
    const startAtMs = Number(payload?.start_at_ms || 0);
    const nextRuns = cron && typeof operations.previewCronRuns === "function" ? operations.previewCronRuns(cron, Number.isFinite(fromMs) ? fromMs : Date.now(), 3, Number.isFinite(startAtMs) ? startAtMs : 0) : [];
    dependencies.sendJson(response, {valid:Boolean(nextRuns.length),next_runs:nextRuns,cron});
    return true;
  }
  if (method === "POST" && pathname === "/api/sftp/automations/reorder") {
    const payload = await dependencies.readJson(request);
    dependencies.sendJson(response, operations.reorderAutomations(payload?.ids));
    return true;
  }
  if (parts.length < 4) return false;
  const id = Number(parts[3]);
  if (!Number.isSafeInteger(id) || id <= 0) {
    dependencies.sendJson(response, {error:"自动化任务 ID 无效"}, 400);
    return true;
  }
  if (method === "GET" && parts.length === 4) {
    const item = operations.getAutomation(id);
    dependencies.sendJson(response, item || {error:"自动化任务不存在"}, item ? 200 : 404);
    return true;
  }
  if (method === "PUT" && parts.length === 4) {
    const item = operations.saveAutomation(await dependencies.readJson(request), id);
    operations.syncAutomationSchedule(id, true);
    dependencies.sendJson(response, operations.getAutomation(item.id));
    return true;
  }
  if (method === "DELETE" && parts.length === 4) {
    dependencies.sendJson(response, operations.deleteAutomation(id));
    return true;
  }
  if (method === "GET" && parts.length === 5 && parts[4] === "runs") {
    dependencies.sendJson(response, typeof operations.listAutomationRunsPage === "function"
      ? operations.listAutomationRunsPage(id, Number(url.searchParams.get("page") || 1))
      : {items:operations.listAutomationRuns(id),total:0,page:1,page_size:100,total_pages:1,history_limit:300});
    return true;
  }
  if (method === "DELETE" && parts.length === 5 && parts[4] === "runs") {
    dependencies.sendJson(response, operations.clearAutomationRuns(id));
    return true;
  }
  if (method === "POST" && parts.length === 5 && parts[4] === "history-settings") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, operations.setAutomationHistoryLimit(id, data?.history_limit));
    return true;
  }
  if (method === "POST" && parts.length === 5 && parts[4] === "run") {
    void operations.runAutomation(id, {reason:"manual"});
    dependencies.sendJson(response, {ok:true,status:"queued",automation_id:id}, 202);
    return true;
  }
  if (method === "POST" && parts.length === 5 && (parts[4] === "pause" || parts[4] === "enable")) {
    const enable = parts[4] === "enable";
    const item = operations.setScheduleState(id, {enabled:enable, next_run_at:null, last_status:enable ? "idle" : "paused"});
    operations.syncAutomationSchedule(id, true);
    dependencies.sendJson(response, item || {error:"自动化任务不存在"}, item ? 200 : 404);
    return true;
  }
  return false;
}
