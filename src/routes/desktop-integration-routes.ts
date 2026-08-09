import { IncomingMessage, ServerResponse } from "node:http";

const DESKTOP_INTEGRATION_SCOPES = new Set(["xserver", "remote-client"]);

interface DesktopIntegrationRouteDependencies {
  getDesktopIntegration(): any;
  isDesktopRequest(request: IncomingMessage): boolean;
  isDesktopCapabilityRequest(request: IncomingMessage, scope: string): boolean;
  localDirectDesktopIntegrationStatus(request: IncomingMessage, scope?: string): any;
  isDirectLoopbackRequest(request: IncomingMessage): boolean;
  hasAuthenticatedWebSession(request: IncomingMessage): boolean;
  createDesktopBrowserGrant(request: IncomingMessage, scopes: string[], options?: any): any;
  desktopBrowserGrantCookie(request: IncomingMessage, token: string, maxAgeSeconds?: number | null): string;
  desktopBrowserGrantStatus(request: IncomingMessage): any;
  revokeDesktopBrowserGrant(request: IncomingMessage): boolean;
  closeDesktopBrowserGrantSessions?(grantId: string, reason?: string): number;
  refreshDesktopBrowserGrantSessions?(grantId: string, expiresAt: number): number;
  readJson(request: IncomingMessage): Promise<any>;
  send(response: ServerResponse, status: number, data: unknown, headers?: Record<string, string>): void;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  x11RuntimeDiagnostics(): any;
  platform?: NodeJS.Platform;
}

function normalizeDesktopIntegrationScopes(value: unknown): string[] {
  const requested = Array.isArray(value) ? value : ["xserver", "remote-client"];
  return [...new Set(requested
    .map(scope => String(scope || "").trim().toLowerCase())
    .filter(scope => DESKTOP_INTEGRATION_SCOPES.has(scope)))];
}

function normalizeDesktopIntegrationDuration(value: any = {}) {
  const mode = String(value.authorization_mode || "timed").trim().toLowerCase();
  if (mode === "browser-session") return { mode, durationMinutes:0, browserSession:true };
  if (mode !== "timed") throw new Error("桌面集成授权时长类型无效");
  const durationMinutes = value.duration_minutes === undefined ? 10 : Number(value.duration_minutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 480) {
    throw new Error("桌面集成授权时长必须是 1 到 480 分钟");
  }
  return { mode, durationMinutes, browserSession:false };
}

export function desktopIntegrationStatus(
  request: IncomingMessage,
  dependencies: DesktopIntegrationRouteDependencies
) {
  const desktopIntegration = dependencies.getDesktopIntegration();
  const nativeDesktop = dependencies.isDesktopRequest(request);
  const grant = dependencies.desktopBrowserGrantStatus(request);
  const desktopBackendAvailable = Boolean(desktopIntegration);
  const directLoopback = dependencies.isDirectLoopbackRequest(request);
  const webSession = dependencies.hasAuthenticatedWebSession(request);
  const localDirect = dependencies.localDirectDesktopIntegrationStatus(request);
  const localDirectAuthorized = Boolean(localDirect.authorized);
  const temporaryAuthorized = Boolean(grant.authorized) && !localDirectAuthorized;
  const authorized = nativeDesktop || localDirectAuthorized || temporaryAuthorized;
  return {
    desktop_backend_available:desktopBackendAvailable,
    native_desktop:nativeDesktop,
    authorized,
    authorization_required:desktopBackendAvailable && !authorized,
    authorization_kind:nativeDesktop ? "native" : localDirectAuthorized ? "local-direct" : temporaryAuthorized ? "temporary" : "none",
    authorization_id:temporaryAuthorized ? String(grant.grant_id || "") : "",
    authorization_browser_session:temporaryAuthorized && Boolean(grant.browser_session),
    authorization_expires_at:temporaryAuthorized ? Number(grant.expires_at || 0) : 0,
    authorization_remaining_seconds:temporaryAuthorized ? Number(grant.remaining_seconds || 0) : 0,
    scopes:nativeDesktop || localDirectAuthorized ? [...DESKTOP_INTEGRATION_SCOPES] : temporaryAuthorized ? [...(grant.scopes || [])] : [],
    can_request_authorization:desktopBackendAvailable && !authorized && directLoopback && webSession,
    local_direct_authorized:localDirectAuthorized,
    local_direct_available:Boolean(localDirect.available),
    local_direct_enabled:Boolean(localDirect.enabled),
    local_direct_blocked_reason:String(localDirect.blocked_reason || ""),
    local_direct_listen_hosts:[...(localDirect.actual_listen_hosts || [])],
    direct_loopback:directLoopback,
    web_session_authenticated:webSession
  };
}

export function xServerDiagnosticsWithoutDesktopIntegration(
  serverSide: any = {},
  integration: any = {},
  platform: NodeJS.Platform = process.platform
) {
  const desktopBackendAvailable = Boolean(integration.desktop_backend_available);
  const authorizationRequired = desktopBackendAvailable && Boolean(integration.authorization_required);
  const running = Boolean(serverSide?.running || serverSide?.available);
  const visibleRunning = desktopBackendAvailable && running;
  const reason = authorizationRequired
    ? running
      ? "当前浏览器会话没有桌面集成权限。X Server 正在运行，但启动、停止和本机程序调用只能在 Terma 桌面端执行。"
      : "当前浏览器会话没有桌面集成权限。请在 Terma 桌面端确认临时授权后，再启动 X Server 或调用本机程序。"
    : "当前连接的是独立 Web/测试后端，无法读取运行 Terma 桌面设备上的 X Server";
  return {
    platform,
    desktop:false,
    integration_available:false,
    desktop_backend_available:desktopBackendAvailable,
    authorization_required:authorizationRequired,
    can_request_authorization:Boolean(integration.can_request_authorization),
    authorization_kind:String(integration.authorization_kind || "none"),
    authorization_expires_at:Number(integration.authorization_expires_at || 0),
    available:visibleRunning,
    installed:Boolean(desktopBackendAvailable && (serverSide?.installed || running)),
    running:visibleRunning,
    managed:false,
    can_start:false,
    can_stop:false,
    can_install:false,
    mode:visibleRunning ? String(serverSide?.mode || "detected") : "unavailable",
    server:String(serverSide?.server || ""),
    display:String(serverSide?.display || ""),
    reason,
    server_side:serverSide
  };
}

export function remoteClientDiagnosticsWithoutDesktopIntegration(
  x11: any = {},
  integration: any = {},
  platform: NodeJS.Platform = process.platform
) {
  const desktopBackendAvailable = Boolean(integration.desktop_backend_available);
  const authorizationRequired = desktopBackendAvailable && Boolean(integration.authorization_required);
  const integrationReason = authorizationRequired
    ? "当前浏览器会话没有桌面集成权限；请在 Terma 桌面端确认临时授权"
    : "当前请求无法调用 Terma 桌面集成";
  const common = {
    available:false,
    client:"",
    executable:""
  };
  return {
    platform,
    desktop:false,
    integration_available:false,
    desktop_backend_available:desktopBackendAvailable,
    authorization_required:authorizationRequired,
    can_request_authorization:Boolean(integration.can_request_authorization),
    authorization_kind:String(integration.authorization_kind || "none"),
    authorization_expires_at:Number(integration.authorization_expires_at || 0),
    rdp:{...common, reason:`系统 RDP 客户端只能由获得临时授权的本机浏览器或 Terma 桌面端调用；${integrationReason}`},
    vnc:{...common, reason:`系统 VNC 客户端只能由获得临时授权的本机浏览器或 Terma 桌面端调用（内置 VNC 不受此限制）；${integrationReason}`},
    xdmcp:{
      ...common,
      can_install:false,
      install_label:platform === "darwin" ? "安装 XQuartz" : platform === "linux" ? "安装 Xephyr" : "",
      reason:String(x11?.reason || "").trim()
        ? `${String(x11.reason).trim()}；${integrationReason}`
        : `XDMCP 窗口只能由获得临时授权的本机浏览器或 Terma 桌面端调用；${integrationReason}`
    },
    x11,
    message:integrationReason
  };
}

export async function handleDesktopIntegrationRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: DesktopIntegrationRouteDependencies
): Promise<boolean> {
  const method = request.method || "GET";
  const desktopIntegration = dependencies.getDesktopIntegration();
  const platform = dependencies.platform || process.platform;

  if (pathname === "/api/desktop-integration/status" && method === "GET") {
    dependencies.sendJson(response, desktopIntegrationStatus(request, dependencies));
    return true;
  }

  if (pathname === "/api/desktop-integration/authorize" && method === "POST") {
    const current = desktopIntegrationStatus(request, dependencies);
    const data = await dependencies.readJson(request);
    const requestedScopes = normalizeDesktopIntegrationScopes(data.scopes);
    const duration = normalizeDesktopIntegrationDuration(data);
    if (!requestedScopes.length) {
      dependencies.sendJson(response, {error:"没有可申请的桌面集成能力"}, 400);
      return true;
    }
    if (current.native_desktop || requestedScopes.every(scope => current.scopes.includes(scope))) {
      dependencies.sendJson(response, current);
      return true;
    }
    if (!desktopIntegration?.confirmDesktopBrowserAuthorization) {
      dependencies.sendJson(response, {error:"当前后端没有可确认授权的 Terma 桌面端"}, 409);
      return true;
    }
    if (!current.direct_loopback) {
      dependencies.sendJson(response, {error:"桌面集成临时授权只允许从本机浏览器申请"}, 403);
      return true;
    }
    if (!current.web_session_authenticated) {
      dependencies.sendJson(response, {error:"请先使用 Web 密码或访问 Token 登录，再申请桌面集成授权"}, 401);
      return true;
    }
    const scopes = [...new Set([...current.scopes, ...requestedScopes])];
    const approved = await Promise.resolve(desktopIntegration.confirmDesktopBrowserAuthorization({
      scopes,
      duration_mode:duration.mode,
      duration_minutes:duration.durationMinutes
    }));
    if (!approved) {
      dependencies.sendJson(response, {...current, approved:false});
      return true;
    }
    const grant = dependencies.createDesktopBrowserGrant(request, scopes, {
      browserSession:duration.browserSession,
      durationMs:duration.durationMinutes * 60 * 1000
    });
    if (current.authorization_id === grant.id) {
      dependencies.refreshDesktopBrowserGrantSessions?.(grant.id, grant.expiresAt);
    }
    dependencies.send(response, 200, {
      ...desktopIntegrationStatus(request, dependencies),
      approved:true,
      authorized:true,
      authorization_kind:"temporary",
      authorization_id:grant.id,
      authorization_browser_session:grant.browserSession,
      authorization_expires_at:grant.expiresAt,
      authorization_remaining_seconds:grant.maxAgeSeconds,
      scopes:grant.scopes
    }, {
      "Set-Cookie":dependencies.desktopBrowserGrantCookie(request, grant.token, grant.maxAgeSeconds)
    });
    return true;
  }

  if (pathname === "/api/desktop-integration/authorize" && method === "DELETE") {
    const current = desktopIntegrationStatus(request, dependencies);
    const revoked = dependencies.revokeDesktopBrowserGrant(request);
    const closedSessions = revoked && current.authorization_id && dependencies.closeDesktopBrowserGrantSessions
      ? dependencies.closeDesktopBrowserGrantSessions(current.authorization_id, "桌面集成授权已撤销")
      : 0;
    dependencies.send(response, 200, {ok:true, revoked, closed_sessions:closedSessions}, {
      "Set-Cookie":dependencies.desktopBrowserGrantCookie(request, "", 0)
    });
    return true;
  }

  const integration = desktopIntegrationStatus(request, dependencies);
  if (method === "GET" && pathname === "/api/remote-clients/diagnostics") {
    const authorized = dependencies.isDesktopCapabilityRequest(request, "remote-client");
    const scopedIntegration = {
      ...integration,
      authorized,
      authorization_required:Boolean(integration.desktop_backend_available && !authorized)
    };
    const x11 = dependencies.isDesktopCapabilityRequest(request, "xserver") && desktopIntegration?.xServerDiagnostics
      ? await Promise.resolve(desktopIntegration.xServerDiagnostics())
      : dependencies.x11RuntimeDiagnostics();
    if (!authorized || !desktopIntegration?.remoteClientDiagnostics) {
      dependencies.sendJson(response, remoteClientDiagnosticsWithoutDesktopIntegration(x11, scopedIntegration, platform));
      return true;
    }
    const xdmcp = {
      available:Boolean(x11?.xdmcp_available),
      client:x11?.xdmcp_available
        ? x11.platform === "darwin"
          ? "Terma 内置 XDMCP（XQuartz）"
          : x11.mode === "bundled"
            ? "Terma 内置 X Server"
            : x11.platform === "linux"
              ? "Terma XDMCP（Xephyr）"
              : x11.server || "X Server"
        : "",
      executable:x11?.xdmcp_available ? x11.xdmcp_client || x11.executable || "" : "",
      can_install:Boolean(x11?.can_install),
      install_label:platform === "darwin" ? "安装 XQuartz" : platform === "linux" ? "安装 Xephyr" : "",
      reason:x11?.xdmcp_available ? "" : String(x11?.reason || "未检测到可用的 XDMCP X Server")
    };
    dependencies.sendJson(response, {
      desktop:true,
      integration_available:true,
      ...scopedIntegration,
      ...(await Promise.resolve(desktopIntegration.remoteClientDiagnostics())),
      xdmcp,
      x11
    });
    return true;
  }

  if (method === "POST" && pathname === "/api/remote-clients/install") {
    if (!dependencies.isDesktopCapabilityRequest(request, "remote-client") || !desktopIntegration?.installRemoteClient) {
      dependencies.sendJson(response, {error:"客户端只能由获得临时授权的本机浏览器或 Terma 桌面端安装"}, 403);
      return true;
    }
    const protocol = String((await dependencies.readJson(request)).protocol || "").toLowerCase();
    if (protocol !== "rdp") {
      dependencies.sendJson(response, {error:"当前只支持安装 RDP 客户端"}, 400);
      return true;
    }
    dependencies.sendJson(response, await Promise.resolve(desktopIntegration.installRemoteClient(protocol)));
    return true;
  }

  if (method === "POST" && pathname === "/api/xserver/install") {
    if (!dependencies.isDesktopCapabilityRequest(request, "xserver")) {
      dependencies.sendJson(response, {error:"图形组件只能由获得临时授权的本机浏览器或 Terma 桌面端安装"}, 403);
      return true;
    }
    if (platform === "darwin" && desktopIntegration?.installXQuartz) {
      dependencies.sendJson(response, await Promise.resolve(desktopIntegration.installXQuartz()));
      return true;
    }
    if (platform === "linux" && desktopIntegration?.installLinuxGraphicsComponents) {
      dependencies.sendJson(response, await Promise.resolve(desktopIntegration.installLinuxGraphicsComponents()));
      return true;
    }
    dependencies.sendJson(response, {error:"当前平台没有可自动安装的图形组件"}, 403);
    return true;
  }

  if (pathname === "/api/xserver") {
    const authorized = dependencies.isDesktopCapabilityRequest(request, "xserver");
    const scopedIntegration = {
      ...integration,
      authorized,
      authorization_required:Boolean(integration.desktop_backend_available && !authorized)
    };
    if (method === "GET") {
      if (authorized && desktopIntegration?.xServerDiagnostics) {
        dependencies.sendJson(response, {
          ...(await Promise.resolve(desktopIntegration.xServerDiagnostics())),
          ...scopedIntegration,
          desktop:true,
          integration_available:true
        });
      } else {
        dependencies.sendJson(response, xServerDiagnosticsWithoutDesktopIntegration(
          dependencies.x11RuntimeDiagnostics(),
          scopedIntegration,
          platform
        ));
      }
      return true;
    }
    if (method === "POST") {
      if (!dependencies.isDesktopCapabilityRequest(request, "xserver") || !desktopIntegration?.startXServer) {
        dependencies.sendJson(response, {error:"X Server 只能由获得临时授权的本机浏览器或 Terma 桌面端启动"}, 403);
        return true;
      }
      dependencies.sendJson(response, await Promise.resolve(desktopIntegration.startXServer()));
      return true;
    }
    if (method === "DELETE") {
      if (!dependencies.isDesktopCapabilityRequest(request, "xserver") || !desktopIntegration?.stopXServer) {
        dependencies.sendJson(response, {error:"X Server 只能由获得临时授权的本机浏览器或 Terma 桌面端停止"}, 403);
        return true;
      }
      dependencies.sendJson(response, await Promise.resolve(desktopIntegration.stopXServer()));
      return true;
    }
  }

  return false;
}
