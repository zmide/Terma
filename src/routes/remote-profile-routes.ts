import { IncomingMessage, ServerResponse } from "node:http";

interface RemoteProfileRouteDependencies {
  configureRdpServerForConnection(connection: any, data: any): Promise<any>;
  configureVncClipboardHelperForProfile(profile: any, data: any): Promise<any>;
  configureVncServerForProfile(profile: any, data: any): Promise<any>;
  configureXdmcpServer(profile: any, data: any, dependencies: any): Promise<any>;
  createRemoteAdminGrant(connection: any, data: any, scope: string): any;
  deleteRemoteProfile(id: number): any;
  detectLinuxDesktopForConnection(connection: any): Promise<any>;
  detectXdmcpServer(profile: any, dependencies: any): Promise<any>;
  duplicateRemoteProfile(id: number): any;
  formatRemoteEndpoint(host: string, port: number): string;
  getConnection(id: number): any;
  getDesktopIntegration(): any;
  getRemoteProfile(id: number): any;
  getVncProfileCredential(id: number): any;
  insertRemoteProfile(data: any): number;
  inspectVncClipboardHelperForProfile(profile: any): Promise<any>;
  inspectVncServerForProfile(profile: any): Promise<any>;
  isDesktopCapabilityRequest(request: IncomingMessage, capability: string): boolean;
  listConnections(): any[];
  listRemoteProfiles(): any[];
  probeTcpEndpoint(host: string, port: number): Promise<any>;
  readJson(request: IncomingMessage): Promise<any>;
  readBody(request: IncomingMessage, maxBytes?: number): Promise<Buffer>;
  readVncRemoteClipboard(profile: any, dependencies: any): Promise<any>;
  readVncRemoteClipboardImage(profile: any, dependencies: any): Promise<any>;
  releaseRemoteAdminGrant(grant: any): void;
  remoteOfflineTasks: any;
  resolveManagementConnection(profile: any, dependencies: any): any;
  runRemotePrivilegeCommand(connection: any, command: string, options: any): Promise<any>;
  runSshCommandForConnection(connection: any, command: string, timeoutMs?: number): Promise<any>;
  runSshCommandForConnectionStreaming(connection: any, command: string, timeoutMs?: number, onChunk?: any, options?: any): Promise<any>;
  send(response: ServerResponse, status: number, data: unknown, headers?: Record<string, string>): void;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  startRemoteComponentCommandTask(options: any): any;
  testFtpProfile(id: number): Promise<any>;
  testRemoteTerminalProfile(id: number): Promise<any>;
  testVncProfile(id: number): Promise<any>;
  updateRemoteProfile(id: number, data: any): any;
  repairRemoteProfileManagementConnection(id: number, connectionId: number): any;
  updateRemoteProfileFlags(id: number, data: any): any;
  updateRemoteProfileUsage(id: number): any;
  updateVncProfileCredential(id: number, password: string): any;
  writeVncRemoteClipboard(profile: any, text: string, dependencies: any): Promise<any>;
  writeVncRemoteClipboardImage(profile: any, image: Buffer, dependencies: any): Promise<any>;
  xdmcpTaskResourceKey(connection: any, data: any, options: any): string;
}

export async function handleRemoteProfileRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: RemoteProfileRouteDependencies
): Promise<boolean> {
  const method = request.method || "GET";
  if (method === "GET" && pathname === "/api/remote-profiles") {
    dependencies.sendJson(response, dependencies.listRemoteProfiles());
    return true;
  }
  if (method === "POST" && pathname === "/api/remote-profiles") {
    dependencies.sendJson(response, {id:dependencies.insertRemoteProfile(await dependencies.readJson(request))}, 201);
    return true;
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "api" || parts[1] !== "remote-profiles") return false;
  if (parts[3] === "ftp") return false;
  const id = Number(parts[2]);
  if (!Number.isInteger(id) || id < 1) throw new Error("远程连接 ID 无效");

  if (method === "PUT" && parts.length === 3) {
    dependencies.sendJson(response, dependencies.updateRemoteProfile(id, await dependencies.readJson(request)));
    return true;
  }
  if (method === "DELETE" && parts.length === 3) {
    dependencies.sendJson(response, dependencies.deleteRemoteProfile(id));
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[3] === "flags") {
    dependencies.sendJson(response, dependencies.updateRemoteProfileFlags(id, await dependencies.readJson(request)));
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[3] === "usage") {
    dependencies.sendJson(response, dependencies.updateRemoteProfileUsage(id));
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[3] === "duplicate") {
    dependencies.sendJson(response, dependencies.duplicateRemoteProfile(id), 201);
    return true;
  }
  if (parts.length === 4 && parts[3] === "vnc-credential") {
    response.setHeader("Cache-Control", "no-store");
    if (method === "POST") {
      dependencies.sendJson(response, dependencies.getVncProfileCredential(id));
      return true;
    }
    if (method === "PUT") {
      dependencies.sendJson(response, dependencies.updateVncProfileCredential(id, (await dependencies.readJson(request)).password));
      return true;
    }
  }
  if (parts.length === 4 && parts[3] === "vnc-clipboard") {
    response.setHeader("Cache-Control", "no-store");
    const profile = dependencies.getRemoteProfile(id);
    const clipboardDependencies = {
      getConnection:dependencies.getConnection,
      listConnections:dependencies.listConnections,
      repairManagementConnection:(item: any, connectionId: number) => dependencies.repairRemoteProfileManagementConnection(item.id, connectionId),
      runSshCommandForConnection:dependencies.runSshCommandForConnection
    };
    if (method === "GET") {
      dependencies.sendJson(response, await dependencies.readVncRemoteClipboard(profile, clipboardDependencies));
      return true;
    }
    if (method === "POST") {
      dependencies.sendJson(response, await dependencies.writeVncRemoteClipboard(profile, (await dependencies.readJson(request)).text, clipboardDependencies));
      return true;
    }
  }
  if (parts.length === 5 && parts[3] === "vnc-clipboard" && parts[4] === "image") {
    response.setHeader("Cache-Control", "no-store");
    const profile = dependencies.getRemoteProfile(id);
    const clipboardDependencies = {
      getConnection:dependencies.getConnection,
      listConnections:dependencies.listConnections,
      repairManagementConnection:(item: any, connectionId: number) => dependencies.repairRemoteProfileManagementConnection(item.id, connectionId),
      runSshCommandForConnection:dependencies.runSshCommandForConnection,
      runSshCommandForConnectionStreaming:dependencies.runSshCommandForConnectionStreaming
    };
    if (method === "GET") {
      const result = await dependencies.readVncRemoteClipboardImage(profile, clipboardDependencies);
      dependencies.send(response, 200, result.data, {
        "Content-Type":"image/png",
        "X-Terma-Clipboard-Bytes":String(result.bytes || result.data?.length || 0),
        "X-Terma-Clipboard-Tool":String(result.tool || "")
      });
      return true;
    }
    if (method === "POST") {
      const contentType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
      if (contentType !== "image/png") {
        dependencies.sendJson(response, {error:"VNC 图片剪贴板仅接受 PNG 图片"}, 415);
        return true;
      }
      const image = await dependencies.readBody(request, 25 * 1024 * 1024 + 1);
      dependencies.sendJson(response, await dependencies.writeVncRemoteClipboardImage(profile, image, clipboardDependencies));
      return true;
    }
  }
  if (parts.length === 5 && parts[3] === "vnc-clipboard" && parts[4] === "helper") {
    response.setHeader("Cache-Control", "no-store");
    const profile = dependencies.getRemoteProfile(id);
    if (method === "GET") {
      dependencies.sendJson(response, await dependencies.inspectVncClipboardHelperForProfile(profile));
      return true;
    }
    if (method === "POST") {
      const result = await dependencies.configureVncClipboardHelperForProfile(profile, await dependencies.readJson(request));
      dependencies.sendJson(response, result, result?.task ? 202 : 200);
      return true;
    }
  }
  if (parts.length === 5 && parts[3] === "rdp" && parts[4] === "server") {
    const profile = dependencies.getRemoteProfile(id);
    if (profile.protocol !== "rdp") throw new Error("该连接不是 RDP 配置");
    const management = dependencies.resolveManagementConnection(profile, {
      getConnection:dependencies.getConnection,
      listConnections:dependencies.listConnections,
      repairManagementConnection:(item: any, connectionId: number) => dependencies.repairRemoteProfileManagementConnection(item.id, connectionId)
    });
    if (method === "GET") {
      dependencies.sendJson(response, await dependencies.detectLinuxDesktopForConnection(management));
      return true;
    }
    if (method === "POST") {
      const result = await dependencies.configureRdpServerForConnection(management, await dependencies.readJson(request));
      dependencies.sendJson(response, result, result?.task ? 202 : 200);
      return true;
    }
  }
  if (parts.length === 5 && parts[3] === "vnc" && parts[4] === "server") {
    const profile = dependencies.getRemoteProfile(id);
    if (profile.protocol !== "vnc") throw new Error("该连接不是 VNC 配置");
    if (method === "GET") {
      dependencies.sendJson(response, await dependencies.inspectVncServerForProfile(profile));
      return true;
    }
    if (method === "POST") {
      const result = await dependencies.configureVncServerForProfile(profile, await dependencies.readJson(request));
      dependencies.sendJson(response, result, result?.task ? 202 : 200);
      return true;
    }
  }
  if (method === "POST" && parts.length === 4 && parts[3] === "test") {
    const profile = dependencies.getRemoteProfile(id);
    if (profile.protocol === "ftp") {
      dependencies.sendJson(response, await dependencies.testFtpProfile(id));
      return true;
    }
    if (["telnet", "serial"].includes(profile.protocol)) {
      dependencies.sendJson(response, await dependencies.testRemoteTerminalProfile(id));
      return true;
    }
    if (profile.protocol === "vnc") {
      dependencies.sendJson(response, await dependencies.testVncProfile(id));
      return true;
    }
    const desktopIntegration = dependencies.getDesktopIntegration();
    if (profile.protocol === "xdmcp") {
      if (!dependencies.isDesktopCapabilityRequest(request, "remote-client") || !desktopIntegration?.testXdmcp) {
        dependencies.sendJson(response, {ok:false, protocol:"xdmcp", message:"XDMCP 只能由获得临时授权的本机浏览器或 Terma 桌面端检测"});
        return true;
      }
      dependencies.sendJson(response, await Promise.resolve(desktopIntegration.testXdmcp({
        id:profile.id,
        protocol:profile.protocol,
        host:profile.host,
        port:profile.port,
        options:profile.options
      })));
      return true;
    }
    const diagnostics = dependencies.isDesktopCapabilityRequest(request, "remote-client") && desktopIntegration?.remoteClientDiagnostics
      ? await Promise.resolve(desktopIntegration.remoteClientDiagnostics())
      : {desktop:false, [profile.protocol]:{available:false}};
    dependencies.sendJson(response, {
      ok:Boolean(diagnostics?.[profile.protocol]?.available),
      protocol:profile.protocol,
      client:diagnostics?.[profile.protocol]?.client || "",
      message:diagnostics?.[profile.protocol]?.available ? "系统客户端可用" : diagnostics?.[profile.protocol]?.reason || "当前设备未检测到可用客户端"
    });
    return true;
  }
  if (method === "GET" && parts.length === 5 && parts[3] === "xdmcp" && parts[4] === "server") {
    const profile = dependencies.getRemoteProfile(id);
    if (profile.protocol !== "xdmcp") throw new Error("该连接不是 XDMCP 配置");
    dependencies.sendJson(response, await dependencies.detectXdmcpServer(profile, {
      getConnection:dependencies.getConnection,
      listConnections:dependencies.listConnections,
      repairManagementConnection:(item: any, connectionId: number) => dependencies.repairRemoteProfileManagementConnection(item.id, connectionId),
      runSshCommandForConnection:dependencies.runSshCommandForConnection
    }));
    return true;
  }
  if (method === "POST" && parts.length === 5 && parts[3] === "xdmcp" && parts[4] === "server") {
    const profile = dependencies.getRemoteProfile(id);
    if (profile.protocol !== "xdmcp") throw new Error("该连接不是 XDMCP 配置");
    const data = await dependencies.readJson(request);
    const management = dependencies.resolveManagementConnection(profile, {
      getConnection:dependencies.getConnection,
      listConnections:dependencies.listConnections,
      repairManagementConnection:(item: any, connectionId: number) => dependencies.repairRemoteProfileManagementConnection(item.id, connectionId)
    });
    const requestedAction = String(data.action || "enable").toLowerCase();
    const grantScope = requestedAction.includes("local-offline") ? `xdmcp.${requestedAction}` : "xdmcp.configure";
    const grant = dependencies.createRemoteAdminGrant(management, data, grantScope);
    let deferGrantRelease = false;
    try {
      const configurationDependencies: any = {
        getConnection:dependencies.getConnection,
        listConnections:dependencies.listConnections,
        repairManagementConnection:(item: any, connectionId: number) => dependencies.repairRemoteProfileManagementConnection(item.id, connectionId),
        runSshCommandForConnection:dependencies.runSshCommandForConnection
      };
      if (grant) {
        configurationDependencies.runPrivilegedSshCommandForConnection = (connection: any, command: string, timeoutMs: number) => dependencies.runRemotePrivilegeCommand(connection, command, {
          grant_id:grant.id,
          scope:grantScope,
          timeout_ms:timeoutMs
        });
      }
      configurationDependencies.startRemoteOfflineInstall = (options: any) => dependencies.remoteOfflineTasks.startAptInstall({
        ...options,
        resource_key:dependencies.xdmcpTaskResourceKey(management, data, options),
        grant,
        elevate:true,
        scope:grantScope,
        release_grant:dependencies.releaseRemoteAdminGrant
      });
      configurationDependencies.startRemoteCommandTask = (options: any) => dependencies.startRemoteComponentCommandTask({
        connection:options.connection || management,
        component:options.component,
        componentLabel:options.component_label,
        action:options.action,
        actionLabel:options.action_label,
        mode:options.mode,
        resourceKey:dependencies.xdmcpTaskResourceKey(management, data, options),
        command:options.command,
        before:options.before,
        grant,
        scope:grantScope,
        timeoutMs:options.timeout_ms,
        verify:options.verify,
        validate:options.validate
      });
      const result = await dependencies.configureXdmcpServer(profile, data, configurationDependencies);
      deferGrantRelease = Boolean(result?.defer_grant_release);
      dependencies.sendJson(response, result, result?.task ? 202 : 200);
      return true;
    } finally {
      if (!deferGrantRelease) dependencies.releaseRemoteAdminGrant(grant);
    }
  }
  if (method === "POST" && parts.length === 4 && parts[3] === "launch") {
    const profile = dependencies.getRemoteProfile(id);
    if (!dependencies.isDesktopCapabilityRequest(request, "remote-client")) {
      dependencies.sendJson(response, {error:"系统图形客户端只能由获得临时授权的本机浏览器或 Terma 桌面端打开"}, 403);
      return true;
    }
    if (!["rdp", "vnc", "xdmcp"].includes(profile.protocol)) throw new Error("该连接不是图形桌面配置");
    const desktopIntegration = dependencies.getDesktopIntegration();
    const launcher = profile.protocol === "xdmcp" ? desktopIntegration?.openXdmcp : desktopIntegration?.openRemoteClient;
    if (!launcher) {
      dependencies.sendJson(response, {error:profile.protocol === "xdmcp" ? "当前桌面版不支持 XDMCP" : "当前桌面版不支持系统远程桌面客户端"}, 403);
      return true;
    }
    if (profile.protocol === "rdp") {
      const endpoint = await dependencies.probeTcpEndpoint(profile.host, profile.port || 3389);
      if (!endpoint.ok) {
        throw new Error(`无法从本机连接 RDP 服务 ${dependencies.formatRemoteEndpoint(profile.host, profile.port || 3389)}（${endpoint.error || "端口不可达"}）。请检查远端服务、防火墙和网络路由。`);
      }
    }
    const result = await Promise.resolve(launcher({
      id:profile.id,
      protocol:profile.protocol,
      host:profile.host,
      port:profile.port,
      username:profile.username,
      password:profile.password,
      options:profile.options
    }));
    dependencies.updateRemoteProfileUsage(id);
    dependencies.sendJson(response, result);
    return true;
  }

  return false;
}
