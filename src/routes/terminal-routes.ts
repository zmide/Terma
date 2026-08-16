import { IncomingMessage, ServerResponse } from "node:http";

interface TerminalRouteDependencies {
  authorizeConnection(request: IncomingMessage, connectionId: number): any;
  createQuickTerminalTicket(value: unknown, requestBinding: string): unknown;
  createTerminalStartupTicket(connectionId: unknown, startup: unknown): unknown;
  getConnection(id: number): any;
  isDesktopCapabilityRequest(request: IncomingMessage, scope: string): boolean;
  readBody(request: IncomingMessage, maxBytes?: number): Promise<Buffer>;
  readJson(request: IncomingMessage): Promise<any>;
  requestAuthenticationBinding(request: IncomingMessage): string;
  requireEncryptionUnlocked(): void;
  revokeQuickTerminalTicket(token: unknown, requestBinding: string): {ok: boolean; connection_id: number};
  closeQuickConnectionTerminals?(connectionId: number, reason?: string): unknown;
  disconnectSftpSession?(connectionId: number, options?: any): unknown;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  terminalClipboardImageMaxBytes: number;
  writeTerminalClipboardImage(connection: any, value: Buffer, options?: any): Promise<any>;
}

export async function handleTerminalRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: TerminalRouteDependencies
): Promise<boolean> {
  const clipboardImageMatch = pathname.match(/^\/api\/connections\/(-?\d+)\/terminal-clipboard\/image$/);
  if (request.method === "POST" && clipboardImageMatch) {
    const connectionId = Number(clipboardImageMatch[1]);
    const connection = dependencies.authorizeConnection(request, connectionId);
    const contentType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "image/png") {
      dependencies.sendJson(response, {error:"终端剪贴板直写仅接受 PNG 图片"}, 415);
      return true;
    }
    const requestedX11Mode = String(request.headers["x-terma-terminal-x11-mode"] || "").trim().toLowerCase();
    if (!["off", "trusted", "untrusted"].includes(requestedX11Mode)) {
      dependencies.sendJson(response, {error:"X11 模式无效"}, 400);
      return true;
    }
    if (requestedX11Mode === "off") {
      dependencies.sendJson(response, {ready:false, available:false, reason:"x11-disabled"});
      return true;
    }
    if (!dependencies.isDesktopCapabilityRequest(request, "xserver")) {
      dependencies.sendJson(response, {ready:false, available:false, reason:"desktop-integration-unavailable"});
      return true;
    }
    const image = await dependencies.readBody(request, dependencies.terminalClipboardImageMaxBytes + 1);
    const result = await dependencies.writeTerminalClipboardImage(connection, image, {x11Mode:requestedX11Mode});
    dependencies.sendJson(response, result);
    return true;
  }
  if (request.method === "POST" && pathname === "/api/terminal/quick-tickets") {
    const data = await dependencies.readJson(request);
    if (String(data?.auth_type || "") === "key") dependencies.requireEncryptionUnlocked();
    dependencies.sendJson(
      response,
      dependencies.createQuickTerminalTicket(data || {}, dependencies.requestAuthenticationBinding(request)),
      201
    );
    return true;
  }
  if (request.method === "DELETE" && pathname === "/api/terminal/quick-tickets") {
    const data = await dependencies.readJson(request);
    const result = dependencies.revokeQuickTerminalTicket(
      data?.token,
      dependencies.requestAuthenticationBinding(request)
    );
    if (result.ok && result.connection_id < 0) {
      dependencies.closeQuickConnectionTerminals?.(result.connection_id);
      dependencies.disconnectSftpSession?.(result.connection_id, {remember:false});
    }
    dependencies.sendJson(response, result);
    return true;
  }
  if (request.method === "POST" && pathname === "/api/terminal/startup-tickets") {
    const data = await dependencies.readJson(request);
    const connection = dependencies.getConnection(Number(data.connection_id));
    const requestedX11Mode = ["trusted", "untrusted", "off"].includes(String(data.startup?.x11_mode || ""))
      ? String(data.startup.x11_mode)
      : String(connection.x11_mode || "off");
    if (["trusted", "untrusted"].includes(requestedX11Mode)
      && !dependencies.isDesktopCapabilityRequest(request, "xserver")) {
      dependencies.sendJson(response, {
        error:"当前浏览器没有 X11 桌面集成授权，请重新申请授权后再打开 X11 终端",
        code:"DESKTOP_INTEGRATION_AUTH_REQUIRED",
        scopes:["xserver"]
      }, 403);
      return true;
    }
    dependencies.sendJson(
      response,
      dependencies.createTerminalStartupTicket(data.connection_id, data.startup || {}),
      201
    );
    return true;
  }
  return false;
}
