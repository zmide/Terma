import { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

interface LogRouteDependencies {
  listLogs(): unknown;
  readLog(path: string): string;
  readRawLog(path: string): string;
  readLogWindow(path: string, options: Record<string, unknown>): Promise<unknown>;
  searchLogs(query: string): Promise<unknown>;
  getLogSettings(): unknown;
  updateLogSettings(value: unknown): unknown;
  enforceConfiguredLogRetention(): unknown;
  deleteLogs(paths: unknown[]): unknown;
  previewLogsOlderThan(days: number): unknown;
  deleteLogsOlderThan(days: number): unknown;
  getDesktopIntegration(): any;
  isDesktopRequest(request: IncomingMessage): boolean;
  resolveLogPath(path: string): string;
  readJson(request: IncomingMessage): Promise<any>;
  send(response: ServerResponse, status: number, data: unknown, headers?: Record<string, string>): void;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
}

export async function handleLogRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: LogRouteDependencies
): Promise<boolean> {
  const method = request.method || "GET";
  if (method === "GET" && pathname === "/api/logs") {
    dependencies.sendJson(response, dependencies.listLogs());
    return true;
  }
  if (method === "GET" && pathname === "/api/logs/read") {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    const logPath = url.searchParams.get("path") || "";
    const raw = url.searchParams.get("raw") === "1";
    if (url.searchParams.get("download") === "1") {
      dependencies.send(response, 200, raw ? dependencies.readRawLog(logPath) : dependencies.readLog(logPath), {
        "Content-Type": "text/plain; charset=utf-8"
      });
      return true;
    }
    const result = await dependencies.readLogWindow(logPath, {
      raw,
      beforeOffset: url.searchParams.has("before") ? Number(url.searchParams.get("before")) : undefined,
      line: url.searchParams.has("line") ? Number(url.searchParams.get("line")) : undefined,
      ...(url.searchParams.has("limit") ? { limitBytes: Number(url.searchParams.get("limit")) } : {}),
      query: url.searchParams.get("query") || "",
      contextLines: Number(url.searchParams.get("context") || 2),
      maxMatches: Number(url.searchParams.get("max_matches") || 50)
    });
    dependencies.sendJson(response, result);
    return true;
  }
  if (method === "GET" && pathname === "/api/logs/search") {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    dependencies.sendJson(response, await dependencies.searchLogs(url.searchParams.get("query") || ""));
    return true;
  }
  if (method === "GET" && pathname === "/api/logs/settings") {
    dependencies.sendJson(response, dependencies.getLogSettings());
    return true;
  }
  if (method === "GET" && pathname === "/api/logs/cleanup-preview") {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    dependencies.sendJson(response, dependencies.previewLogsOlderThan(Number(url.searchParams.get("days") || 0)));
    return true;
  }
  if (method === "PUT" && pathname === "/api/logs/settings") {
    dependencies.sendJson(response, dependencies.updateLogSettings(await dependencies.readJson(request)));
    return true;
  }
  if (method === "POST" && pathname === "/api/logs/cleanup") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, data && data.days !== undefined ? dependencies.deleteLogsOlderThan(Number(data.days)) : dependencies.enforceConfiguredLogRetention());
    return true;
  }
  if (method === "POST" && pathname === "/api/logs/open-external") {
    if (!dependencies.isDesktopRequest(request)) { dependencies.sendJson(response, {error:"外部编辑器只能在本机桌面端中使用"}, 403); return true; }
    const desktop = dependencies.getDesktopIntegration();
    if (!desktop?.openExternalFile) { dependencies.sendJson(response, {error:"桌面端外部编辑器不可用"}, 503); return true; }
    const data = await dependencies.readJson(request);
    try {
      const file = dependencies.resolveLogPath(data?.path || "");
      dependencies.sendJson(response, await desktop.openExternalFile(file, data?.editor || {}));
    } catch (error) { dependencies.sendJson(response, {error:error instanceof Error ? error.message : String(error)}, 400); }
    return true;
  }
  if (method === "POST" && pathname === "/api/logs/delete") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, dependencies.deleteLogs(Array.isArray(data.paths) ? data.paths : []));
    return true;
  }
  return false;
}
