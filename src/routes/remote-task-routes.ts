import { IncomingMessage, ServerResponse } from "node:http";

interface RemoteTaskRouteDependencies {
  authorizeConnection(request: IncomingMessage, id: number): any;
  clearFinishedLinuxDesktopTasks(): any;
  configureRdpServerForConnection(connection: any, data: any): Promise<any>;
  createRemoteAdminGrant(connection: any, data: any, scope: string): any;
  deleteLinuxDesktopTask(id: string): boolean;
  detectLinuxDesktopForConnection(connection: any): Promise<any>;
  getConnection(id: number): any;
  handoffRemotePrivilegeGrant(grant: any, start: () => any): any;
  issueRemoteAdminGrant(connection: any, data: any): Promise<any>;
  linuxDesktopTaskView(task: any): any;
  linuxDesktopTasks: Map<string, any>;
  listLinuxDesktopTasks(): any;
  readJson(request: IncomingMessage): Promise<any>;
  remoteOfflineTasks: {
    clearFinished(): any;
    list(): any[];
    remove(id: string): boolean;
  };
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  startLinuxDesktopInstall(connectionId: number, desktopId: string, action: string, grant: any, mode?: string): any;
}

function connectionId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new Error("SSH 连接 ID 无效");
  return id;
}

export async function handleRemoteTaskRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: RemoteTaskRouteDependencies
): Promise<boolean> {
  const method = request.method || "GET";
  if (method === "GET" && pathname === "/api/linux-desktop/tasks") {
    dependencies.sendJson(response, dependencies.listLinuxDesktopTasks());
    return true;
  }
  if (method === "POST" && pathname === "/api/linux-desktop/tasks/clear-finished") {
    dependencies.sendJson(response, dependencies.clearFinishedLinuxDesktopTasks());
    return true;
  }
  if (method === "POST" && pathname === "/api/admin-grants") {
    const data = await dependencies.readJson(request);
    const id = Number(data.connection_id || data.id || 0);
    const connection = dependencies.authorizeConnection(request, id);
    dependencies.sendJson(response, await dependencies.issueRemoteAdminGrant(connection, data), 201);
    return true;
  }
  if (method === "GET" && pathname === "/api/remote-component/tasks") {
    dependencies.sendJson(response, dependencies.remoteOfflineTasks.list());
    return true;
  }
  if (method === "POST" && pathname === "/api/remote-component/tasks/clear-finished") {
    dependencies.sendJson(response, dependencies.remoteOfflineTasks.clearFinished());
    return true;
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api") return false;
  if (parts.length === 4 && parts[1] === "connections" && parts[3] === "rdp-server") {
    const id = connectionId(parts[2]);
    const connection = dependencies.getConnection(id);
    if (method === "GET") {
      dependencies.sendJson(response, await dependencies.detectLinuxDesktopForConnection(connection));
      return true;
    }
    if (method === "POST") {
      const result = await dependencies.configureRdpServerForConnection(connection, await dependencies.readJson(request));
      dependencies.sendJson(response, result, result?.task ? 202 : 200);
      return true;
    }
  }
  if (parts.length === 4 && parts[1] === "connections" && parts[3] === "linux-desktop" && method === "GET") {
    const connection = dependencies.getConnection(connectionId(parts[2]));
    dependencies.sendJson(response, await dependencies.detectLinuxDesktopForConnection(connection));
    return true;
  }
  if (parts.length === 5 && parts[1] === "connections" && parts[3] === "linux-desktop" && parts[4] === "install" && method === "POST") {
    const id = connectionId(parts[2]);
    const data = await dependencies.readJson(request);
    const connection = dependencies.getConnection(id);
    const requestedMode = String(data.mode || data.install_mode || data.action || "online").toLowerCase();
    const mode = ["local-offline", "install-local-offline", "offline-local"].includes(requestedMode)
      ? "local-offline"
      : ["offline", "install-offline"].includes(requestedMode)
        ? "offline"
        : ["online", "install", "install-online"].includes(requestedMode)
          ? "online"
          : "";
    if (!mode) throw new Error("Linux 桌面安装方式无效");
    const grantScope = mode === "local-offline"
      ? "linux-desktop.install-local-offline"
      : mode === "offline"
        ? "linux-desktop.install-offline"
        : "linux-desktop.install";
    const grant = dependencies.createRemoteAdminGrant(connection, data, grantScope);
    const task = dependencies.handoffRemotePrivilegeGrant(grant, () => dependencies.startLinuxDesktopInstall(id, data.desktop_id, "install", grant, mode));
    dependencies.sendJson(response, task, 202);
    return true;
  }
  if (parts.length === 5 && parts[1] === "connections" && parts[3] === "linux-desktop" && parts[4] === "uninstall" && method === "POST") {
    const id = connectionId(parts[2]);
    const data = await dependencies.readJson(request);
    const connection = dependencies.getConnection(id);
    const grant = dependencies.createRemoteAdminGrant(connection, data, "linux-desktop.uninstall");
    const task = dependencies.handoffRemotePrivilegeGrant(grant, () => dependencies.startLinuxDesktopInstall(id, data.desktop_id, "uninstall", grant));
    dependencies.sendJson(response, task, 202);
    return true;
  }
  if (parts.length === 4 && parts[1] === "linux-desktop" && parts[2] === "tasks") {
    const task = dependencies.linuxDesktopTasks.get(parts[3]);
    if (!task) {
      dependencies.sendJson(response, {error:"桌面管理任务不存在或已过期"}, 404);
      return true;
    }
    if (method === "GET") {
      dependencies.sendJson(response, dependencies.linuxDesktopTaskView(task));
      return true;
    }
    if (method === "DELETE") {
      dependencies.sendJson(response, {removed:dependencies.deleteLinuxDesktopTask(parts[3])});
      return true;
    }
  }
  if (parts.length === 4 && parts[1] === "remote-component" && parts[2] === "tasks") {
    const task = dependencies.remoteOfflineTasks.list().find(item => String(item.id) === String(parts[3]));
    if (!task) {
      dependencies.sendJson(response, {error:"远端组件任务不存在或已过期"}, 404);
      return true;
    }
    if (method === "GET") {
      dependencies.sendJson(response, task);
      return true;
    }
    if (method === "DELETE") {
      dependencies.sendJson(response, {removed:dependencies.remoteOfflineTasks.remove(parts[3])});
      return true;
    }
  }

  return false;
}
