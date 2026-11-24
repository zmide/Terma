import { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { publicError } from "../public-error";
import { assertServerFilesAccess } from '../services/server-files-access';
import { resolveServerPath, serverFileRoots } from '../services/server-files-service';
import { resolveServerDirectory } from '../services/server-files-service';
import fs from 'node:fs';
import path from 'node:path';

const defaultAutomations = require("../sftp-automations");

interface Dependencies {
  getDesktopIntegration(): any;
  isDesktopRequest(request: IncomingMessage): boolean;
  readJson(request: IncomingMessage): Promise<any>;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  automations?: any;
  authorizeConnectionId?(request: IncomingMessage, value: string): number;
}

function allowed(request: IncomingMessage, dependencies: Dependencies) {
  const desktop = dependencies.getDesktopIntegration?.();
  if (!dependencies.isDesktopRequest(request) || !desktop) return false;
  return true;
}

export async function handleSftpAutomationRoutes(request: IncomingMessage, response: ServerResponse, pathname: string, dependencies: Dependencies): Promise<boolean> {
  if (pathname !== "/api/sftp/automations" && !pathname.startsWith("/api/sftp/automations/")) return false;
  const desktop = allowed(request, dependencies);
  if (!desktop) assertServerFilesAccess(request);
  const operations = dependencies.automations || defaultAutomations;
  const validate = (item: any) => {
    if (!item) throw publicError('SFTP_AUTOMATION_NOT_FOUND','自动化任务不存在',{},404);
    dependencies.authorizeConnectionId?.(request,String(item.connection_id));
    if (!desktop) resolveServerPath(item.local_path,{missing:true,missingParents:true,mutable:item.direction!=='upload'});
    return item;
  };
  const prepare = (item: any) => {
    validate(item);
    return desktop ? item : {...item,options:{...item.options,server_files:true}};
  };
  const visible = (item: any) => { try {validate(item); return true;} catch {return false;} };
  const method = request.method || "GET";
  const url = new URL(request.url || pathname, "http://terma.invalid");
  const parts = pathname.split("/").filter(Boolean);
  if (method === 'GET' && pathname === '/api/sftp/automations/context') {
    dependencies.sendJson(response,{default_path:serverFileRoots().find(root=>root.root_kind==='workspace')?.directory || ''});
    return true;
  }
  if (method === "GET" && pathname === "/api/sftp/automations") {
    dependencies.sendJson(response, operations.listAutomations().filter(visible));
    return true;
  }
  if (method === "POST" && pathname === "/api/sftp/automations") {
    const item = operations.saveAutomation(prepare(await dependencies.readJson(request)));
    operations.syncAutomationSchedule(item.id, true);
    dependencies.sendJson(response, operations.getAutomation(item.id), 201);
    return true;
  }
  if (method === "GET" && pathname === "/api/sftp/automations/runs") {
    const ids = new Set(operations.listAutomations().filter(visible).map((item:any)=>Number(item.id)));
    dependencies.sendJson(response, operations.listAutomationRuns(0).filter((item:any)=>ids.has(Number(item.automation_id))));
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
    if (!Array.isArray(payload?.ids)) throw publicError('SFTP_AUTOMATION_INVALID','自动化任务 ID 无效');
    payload.ids.forEach((id:any)=>validate(operations.getAutomation(id)));
    dependencies.sendJson(response, operations.reorderAutomations(payload?.ids));
    return true;
  }
  if (parts.length < 4) return false;
  const id = Number(parts[3]);
  if (!Number.isSafeInteger(id) || id <= 0) {
    dependencies.sendJson(response, {error:"自动化任务 ID 无效"}, 400);
    return true;
  }
  const existing = validate(operations.getAutomation(id));
  if (method === 'GET' && parts.length === 5 && parts[4] === 'local-directory') {
    const directory = fs.statSync(existing.local_path).isDirectory() ? existing.local_path : path.dirname(existing.local_path);
    dependencies.sendJson(response,{path:resolveServerDirectory(directory)});
    return true;
  }
  if (method === "GET" && parts.length === 4) {
    const item = operations.getAutomation(id);
    dependencies.sendJson(response, item || {error:"自动化任务不存在"}, item ? 200 : 404);
    return true;
  }
  if (method === "PUT" && parts.length === 4) {
    const item = operations.saveAutomation(prepare({...existing,...await dependencies.readJson(request)}), id);
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
    if (!desktop && !existing.options?.server_files) operations.saveAutomation(prepare(existing),id);
    void operations.runAutomation(id, {reason:"manual"});
    dependencies.sendJson(response, {ok:true,status:"queued",automation_id:id}, 202);
    return true;
  }
  if (method === "POST" && parts.length === 5 && (parts[4] === "pause" || parts[4] === "enable")) {
    const enable = parts[4] === "enable";
    if (!desktop && enable && !existing.options?.server_files) operations.saveAutomation(prepare(existing),id);
    const item = operations.setScheduleState(id, {enabled:enable, next_run_at:null, last_status:enable ? "idle" : "paused"});
    operations.syncAutomationSchedule(id, true);
    dependencies.sendJson(response, item || {error:"自动化任务不存在"}, item ? 200 : 404);
    return true;
  }
  return false;
}
