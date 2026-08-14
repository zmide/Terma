import { IncomingMessage, ServerResponse } from "node:http";

interface LocalControlRouteDependencies {
  getDesktopIntegration(): any;
  getNativeSftpDragTicket(token: string): Promise<any>;
  hasShutdownToken(request: IncomingMessage): boolean;
  isAuthenticated(request: IncomingMessage): boolean;
  isDesktopRequest(request: IncomingMessage): boolean;
  isDirectLoopbackRequest(request: IncomingMessage): boolean;
  releaseNativeSftpDragTicket(token: string): boolean;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  shutdown(): void;
  streamNativeSftpDragContent(request: IncomingMessage, response: ServerResponse, token: string, index: number): Promise<any>;
}

export async function handleLocalControlRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: LocalControlRouteDependencies
): Promise<boolean> {
  const method = request.method || "GET";
  const desktopIntegration = dependencies.getDesktopIntegration();
  if (method === "POST" && pathname === "/api/shutdown") {
    const sourceWebRequest = !desktopIntegration && dependencies.isDirectLoopbackRequest(request) && dependencies.isAuthenticated(request);
    if (!dependencies.hasShutdownToken(request) && !dependencies.isDesktopRequest(request) && !sourceWebRequest) {
      dependencies.sendJson(response, {error:"Forbidden"}, 403);
      return true;
    }
    dependencies.sendJson(response, {ok:true});
    dependencies.shutdown();
    return true;
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[0] !== "api" || parts[1] !== "sftp" || parts[2] !== "native-drag") return false;
  if (method === "GET" && parts.length === 6 && parts[4] === "content") {
    if (!dependencies.isDirectLoopbackRequest(request) || !desktopIntegration) {
      dependencies.sendJson(response, {error:"原生拖出内容只能由本机桌面端读取"}, 403);
      return true;
    }
    await dependencies.streamNativeSftpDragContent(request, response, parts[3], Number(parts[5]));
    return true;
  }
  if (method === "GET" && parts.length === 4) {
    if (!dependencies.isDirectLoopbackRequest(request) || !desktopIntegration) {
      dependencies.sendJson(response, {error:"原生拖出凭据只能由本机桌面端读取"}, 403);
      return true;
    }
    dependencies.sendJson(response, await dependencies.getNativeSftpDragTicket(parts[3]));
    return true;
  }
  if (method === "DELETE" && parts.length === 4) {
    if (!dependencies.isDirectLoopbackRequest(request) || !desktopIntegration) {
      dependencies.sendJson(response, {error:"原生拖出凭据只能由本机桌面端使用"}, 403);
      return true;
    }
    dependencies.sendJson(response, {ok:dependencies.releaseNativeSftpDragTicket(parts[3])});
    return true;
  }

  return false;
}
