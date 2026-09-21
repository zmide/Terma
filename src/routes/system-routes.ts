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
