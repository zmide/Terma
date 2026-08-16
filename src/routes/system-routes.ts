import { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

interface SystemRouteDependencies {
  aboutInfo(): any;
  batchRunCommands(ids: number[], command: string, data: any): Promise<any>;
  getDesktopIntegration(): any;
  getStartupStatus(): any;
  isDesktopRequest(request: IncomingMessage): boolean;
  listNotifications(since: number, language?: string): any[];
  listSerialPorts(): Promise<any>;
  readJson(request: IncomingMessage): Promise<any>;
  runtimeDiagnostics(): any;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
}

export async function handleSystemRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: SystemRouteDependencies
): Promise<boolean> {
  const method = request.method || "GET";
  if (method === "GET" && pathname === "/api/about") {
    dependencies.sendJson(response, dependencies.aboutInfo());
    return true;
  }
  if (method === "GET" && pathname === "/api/legacy-brand-migration") {
    const desktopIntegration = dependencies.getDesktopIntegration();
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.getLegacyBrandMigration) {
      dependencies.sendJson(response, {available:false, message:"旧版数据迁移仅能在运行 Terma 的本机桌面版中执行"});
      return true;
    }
    dependencies.sendJson(response, {available:true, ...await Promise.resolve(desktopIntegration.getLegacyBrandMigration())});
    return true;
  }
  if (method === "POST" && pathname === "/api/legacy-brand-migration") {
    const desktopIntegration = dependencies.getDesktopIntegration();
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.migrateLegacyBrandData) {
      dependencies.sendJson(response, {error:"旧版数据迁移仅能在运行 Terma 的本机桌面版中执行"}, 403);
      return true;
    }
    const result = await Promise.resolve(desktopIntegration.migrateLegacyBrandData(await dependencies.readJson(request) || {}));
    dependencies.sendJson(response, result, result?.ok ? 202 : 409);
    return true;
  }
  if (method === "GET" && pathname === "/api/diagnostics/runtime") {
    dependencies.sendJson(response, dependencies.runtimeDiagnostics());
    return true;
  }
  if (method === "GET" && pathname === "/api/startup-status") {
    dependencies.sendJson(response, dependencies.getStartupStatus());
    return true;
  }
  if (method === "GET" && pathname === "/api/notifications") {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    const language = ["zh-CN", "en-US"].includes(String(url.searchParams.get("language") || ""))
      ? String(url.searchParams.get("language"))
      : "zh-CN";
    dependencies.sendJson(response, dependencies.listNotifications(Number(url.searchParams.get("since") || 0), language));
    return true;
  }
  if (method === "GET" && pathname === "/api/serial/ports") {
    dependencies.sendJson(response, await dependencies.listSerialPorts());
    return true;
  }
  if (method === "POST" && pathname === "/api/commands/batch") {
    const data = await dependencies.readJson(request) || {};
    dependencies.sendJson(response, await dependencies.batchRunCommands(data.ids || [], data.command || "", data));
    return true;
  }

  return false;
}
