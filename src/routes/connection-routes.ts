import path from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";

interface ConnectionRouteDependencies {
  all(sql: string): any[];
  appendSystemLog(message: string): void;
  bulkUpdateConnections(ids: number[], changes: any): any;
  clearConnectionHealthCache(id?: number): void;
  connectionHealth(id: number, options?: any): Promise<any>;
  createAllRemoteProfilesFromConnection(id: number): any;
  createConfigSnapshot(reason: string): any;
  createRemoteProfileFromConnection(id: number, protocol: string): any;
  defaultExtraArgs: string[];
  deleteConnection(id: number, stopForward: (id: number) => any): any;
  deleteForward(id: number, stopForward: (id: number) => any): any;
  deployGeneratedPublicKey(id: number, publicPath: string): Promise<any>;
  duplicateConnection(id: number, defaultExtraArgs: string[]): any;
  forwardLogLabel(id: string | number): string;
  getConnection(id: number): any;
  getDesktopIntegration(): any;
  getForward(id: number): any;
  insertConnection(data: any, defaultExtraArgs: string[]): number;
  insertForward(connectionId: number, data: any): number;
  inspectServer(id: number): Promise<any>;
  invalidateRemoteDirectoryCache(id: number): void;
  isDesktopRequest(request: IncomingMessage): boolean;
  listConnections(): any[];
  listIdentityFiles(): any[];
  readJson(request: IncomingMessage): Promise<any>;
  renameConnectionGroup(currentName: string, newName: string): any;
  reorderConnectionGroups(names: string[]): any;
  restorePreviousForwards(): Promise<any>;
  restoreStateSummary(): any;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  startConnectionForwards(id: number): Promise<any>;
  startForward(id: number): Promise<any>;
  stopConnectionForwards(id: number): any;
  stopExternalEditsForConnection(id: number): any;
  stopForward(id: number): any;
  terminalCapabilitiesForConnection(connection: any): Promise<any>;
  updateConnection(id: number, data: any, defaultExtraArgs: string[]): any;
  updateConnectionFlags(id: number, data: any): any;
  updateConnectionUsage(id: number, action: string): any;
  updateConnectionX11Mode(id: number, mode: string): any;
  updateForward(id: number, data: any): any;
  updateSftpFilenameEncoding(id: number, encoding: string): any;
  updateTerminalPreferences(id: number, data: any): any;
  updateTerminalStartup(id: number, data: any): any;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handleConnectionRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: ConnectionRouteDependencies
): Promise<boolean> {
  const method = request.method || "GET";
  if (method === "GET" && pathname === "/api/connections") {
    dependencies.sendJson(response, dependencies.listConnections());
    return true;
  }
  if (method === "GET" && pathname === "/api/forwards/restore-state") {
    dependencies.sendJson(response, dependencies.restoreStateSummary());
    return true;
  }
  if (method === "POST" && pathname === "/api/forwards/restore") {
    dependencies.sendJson(response, await dependencies.restorePreviousForwards());
    return true;
  }
  if (method === "POST" && pathname === "/api/connections") {
    const id = dependencies.insertConnection(await dependencies.readJson(request), dependencies.defaultExtraArgs);
    dependencies.sendJson(response, {id}, 201);
    return true;
  }
  if (method === "POST" && pathname === "/api/connections/bulk-delete") {
    const data = await dependencies.readJson(request);
    const ids = [...new Set((data.ids || []).map(Number).filter((id: number) => Number.isInteger(id) && id > 0))] as number[];
    if (!ids.length) throw new Error("请选择要删除的 SSH 连接");
    if (ids.length > 500) throw new Error("单次最多批量删除 500 个 SSH 连接");
    const existingIds = new Set(dependencies.listConnections().map((item: any) => item.id));
    if (ids.some(id => !existingIds.has(id))) throw new Error("部分 SSH 连接不存在，请刷新后重试");
    dependencies.createConfigSnapshot("批量删除 SSH 连接前自动快照");
    for (const id of ids) {
      dependencies.stopExternalEditsForConnection(id);
      dependencies.deleteConnection(id, dependencies.stopForward);
    }
    dependencies.sendJson(response, {ok:true, deleted:ids.length});
    return true;
  }
  if (method === "POST" && pathname === "/api/connections/bulk-update") {
    const data = await dependencies.readJson(request);
    const ids = [...new Set((data.ids || []).map(Number).filter((id: number) => Number.isInteger(id) && id > 0))] as number[];
    const changes = data.changes && typeof data.changes === "object" ? {...data.changes} : {};
    if (changes.auth?.type === "key") {
      const requestedPath = path.resolve(String(changes.auth.identity_file || ""));
      const allowed = dependencies.listIdentityFiles().some((item: any) => path.resolve(item.path).toLowerCase() === requestedPath.toLowerCase());
      if (!allowed) throw new Error("所选私钥不在允许的密钥目录中");
      changes.auth = {...changes.auth, identity_file:requestedPath};
    }
    const existingIds = new Set(dependencies.listConnections().map((item: any) => item.id));
    if (!ids.length || ids.some(id => !existingIds.has(id))) throw new Error("部分 SSH 连接不存在，请刷新后重试");
    dependencies.createConfigSnapshot("批量修改 SSH 连接前自动快照");
    if (Object.prototype.hasOwnProperty.call(changes, "ssh_port") || changes.auth) {
      for (const id of ids) dependencies.stopConnectionForwards(id);
    }
    const result = dependencies.bulkUpdateConnections(ids, changes);
    ids.forEach(dependencies.clearConnectionHealthCache);
    dependencies.sendJson(response, result);
    return true;
  }
  if (method === "POST" && pathname === "/api/connection-groups/rename") {
    const data = await dependencies.readJson(request);
    const currentName = String(data.current_name || "").trim();
    const newName = String(data.new_name || "").trim();
    if (!currentName || currentName.length > 100 || !newName || newName.length > 100) {
      throw new Error("分组名称长度必须在 1-100 个字符之间");
    }
    const groupNames = new Set(dependencies.all("SELECT group_name FROM connections UNION SELECT group_name FROM remote_profiles").map((item: any) => item.group_name));
    if (!groupNames.has(currentName)) throw new Error("分组不存在，请刷新后重试");
    if (currentName !== newName && groupNames.has(newName)) throw new Error("该分组名称已存在，请使用其他名称");
    if (currentName === newName) {
      dependencies.sendJson(response, {ok:true, updated:0, group_name:newName});
      return true;
    }
    dependencies.createConfigSnapshot("重命名 SSH 连接分组前自动快照");
    dependencies.sendJson(response, dependencies.renameConnectionGroup(currentName, newName));
    return true;
  }
  if (method === "POST" && pathname === "/api/connection-groups/reorder") {
    const data = await dependencies.readJson(request);
    dependencies.createConfigSnapshot("调整 SSH 连接分组顺序前自动快照");
    dependencies.sendJson(response, dependencies.reorderConnectionGroups(data.names));
    return true;
  }
  if (method === "POST" && pathname === "/api/forwards/bulk-delete") {
    const data = await dependencies.readJson(request);
    for (const id of data.ids || []) dependencies.deleteForward(id, dependencies.stopForward);
    dependencies.sendJson(response, {ok:true});
    return true;
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api") return false;

  if (method === "POST" && parts.length === 4 && parts[1] === "connections" && parts[3] === "duplicate") {
    const source = dependencies.getConnection(Number(parts[2]));
    const result = dependencies.duplicateConnection(source.id, dependencies.defaultExtraArgs);
    dependencies.appendSystemLog(`已复制 SSH 连接：${source.name} -> ${result.name}`);
    dependencies.sendJson(response, result, 201);
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[1] === "connections" && parts[3] === "usage") {
    dependencies.sendJson(response, dependencies.updateConnectionUsage(Number(parts[2]), (await dependencies.readJson(request)).action));
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[1] === "connections" && parts[3] === "flags") {
    dependencies.sendJson(response, dependencies.updateConnectionFlags(Number(parts[2]), await dependencies.readJson(request)));
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[1] === "connections" && parts[3] === "terminal-preferences") {
    dependencies.sendJson(response, dependencies.updateTerminalPreferences(Number(parts[2]), await dependencies.readJson(request)));
    return true;
  }
  if (method === "POST" && parts.length === 5 && parts[1] === "connections" && parts[3] === "ssh-key" && parts[4] === "deploy") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, await dependencies.deployGeneratedPublicKey(Number(parts[2]), data.public_path));
    return true;
  }
  if (method === "POST" && parts.length === 5 && parts[1] === "connections" && parts[3] === "external-tools" && parts[4] === "vscode") {
    const desktopIntegration = dependencies.getDesktopIntegration();
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.openVsCodeRemote) {
      dependencies.sendJson(response, {error:"VS Code Remote SSH 只能在本机桌面端中使用"}, 403);
      return true;
    }
    const connection = dependencies.getConnection(Number(parts[2]));
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, await Promise.resolve(desktopIntegration.openVsCodeRemote({
      user:connection.ssh_user,
      host:connection.ssh_host,
      port:connection.ssh_port,
      path:String(data.path || "")
    })));
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[1] === "connections" && parts[3] === "terminal-startup") {
    dependencies.sendJson(response, {startup:dependencies.updateTerminalStartup(Number(parts[2]), await dependencies.readJson(request))});
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[1] === "connections" && parts[3] === "x11-mode") {
    dependencies.sendJson(response, dependencies.updateConnectionX11Mode(Number(parts[2]), (await dependencies.readJson(request)).mode));
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[1] === "connections" && parts[3] === "remote-profiles") {
    const data = await dependencies.readJson(request);
    if (String(data.protocol || "").toLowerCase() === "all") {
      const result = dependencies.createAllRemoteProfilesFromConnection(Number(parts[2]));
      for (const item of result.results.filter((value: any) => value.created)) {
        dependencies.appendSystemLog(`已从 SSH 连接生成 ${item.protocol.toUpperCase()} 连接：${item.name}`);
      }
      dependencies.sendJson(response, result, result.created_count ? 201 : 200);
      return true;
    }
    const result = dependencies.createRemoteProfileFromConnection(Number(parts[2]), data.protocol);
    if (result.created) dependencies.appendSystemLog(`已从 SSH 连接生成 ${result.protocol.toUpperCase()} 连接：${result.name}`);
    dependencies.sendJson(response, result, result.created ? 201 : 200);
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[1] === "connections" && parts[3] === "terminal-capabilities") {
    dependencies.sendJson(response, {capabilities:await dependencies.terminalCapabilitiesForConnection(dependencies.getConnection(Number(parts[2])))});
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[1] === "connections" && parts[3] === "sftp-filename-encoding") {
    const id = Number(parts[2]);
    const result = dependencies.updateSftpFilenameEncoding(id, (await dependencies.readJson(request)).encoding);
    dependencies.invalidateRemoteDirectoryCache(id);
    dependencies.sendJson(response, result);
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[1] === "connections" && parts[3] === "forwards") {
    const connectionId = Number(parts[2]);
    const id = dependencies.insertForward(connectionId, await dependencies.readJson(request));
    dependencies.clearConnectionHealthCache(connectionId);
    dependencies.sendJson(response, {id}, 201);
    return true;
  }

  if (method === "POST" && parts.length === 4 && parts[1] === "connections") {
    if (parts[3] === "health") {
      dependencies.sendJson(response, await dependencies.connectionHealth(Number(parts[2]), {force:true}));
      return true;
    }
    if (parts[3] === "inspect") {
      dependencies.sendJson(response, await dependencies.inspectServer(Number(parts[2])));
      return true;
    }
    if (parts[3] === "start-forwards") {
      const connection = dependencies.getConnection(Number(parts[2]));
      try {
        await dependencies.startConnectionForwards(connection.id);
        dependencies.clearConnectionHealthCache(connection.id);
        dependencies.appendSystemLog(`已启动连接 ${connection.name} 的全部转发`);
      } catch (error) {
        dependencies.appendSystemLog(`连接 ${connection.name} 启动转发失败：${errorMessage(error)}`);
        throw error;
      }
    } else if (parts[3] === "stop-forwards") {
      const connection = dependencies.getConnection(Number(parts[2]));
      dependencies.stopConnectionForwards(connection.id);
      dependencies.clearConnectionHealthCache(connection.id);
      dependencies.appendSystemLog(`已停止连接 ${connection.name} 的全部转发`);
    } else {
      dependencies.sendJson(response, {error:"Not found"}, 404);
      return true;
    }
    dependencies.sendJson(response, {ok:true});
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[1] === "forwards") {
    if (parts[3] === "start") {
      const forward = dependencies.getForward(Number(parts[2]));
      const label = dependencies.forwardLogLabel(parts[2]);
      try {
        await dependencies.startForward(Number(parts[2]));
        dependencies.clearConnectionHealthCache(forward.connection_id);
        dependencies.appendSystemLog(`已启动转发：${label}`);
      } catch (error) {
        dependencies.appendSystemLog(`启动转发失败：${label}：${errorMessage(error)}`);
        throw error;
      }
    } else if (parts[3] === "stop") {
      const forward = dependencies.getForward(Number(parts[2]));
      dependencies.stopForward(Number(parts[2]));
      dependencies.clearConnectionHealthCache(forward.connection_id);
      dependencies.appendSystemLog(`已停止转发：${dependencies.forwardLogLabel(parts[2])}`);
    } else if (parts[3] === "health") {
      const forwardId = Number(parts[2]);
      const connection = dependencies.listConnections().find((item: any) => (item.forwards || []).some((forward: any) => forward.id === forwardId));
      if (!connection) {
        dependencies.sendJson(response, {error:"转发不存在"}, 404);
        return true;
      }
      const health = await dependencies.connectionHealth(connection.id);
      dependencies.sendJson(response, health.forwards.find((forward: any) => forward.id === forwardId) || {});
      return true;
    } else {
      dependencies.sendJson(response, {error:"Not found"}, 404);
      return true;
    }
    dependencies.sendJson(response, {ok:true});
    return true;
  }
  if (method === "PUT" && parts.length === 3 && parts[1] === "forwards") {
    const before = dependencies.getForward(Number(parts[2]));
    dependencies.updateForward(Number(parts[2]), await dependencies.readJson(request));
    dependencies.clearConnectionHealthCache(before.connection_id);
    dependencies.appendSystemLog(`已更新转发：${dependencies.forwardLogLabel(parts[2])}`);
    dependencies.sendJson(response, {ok:true, was_running:Boolean(before.pid)});
    return true;
  }
  if (method === "PUT" && parts.length === 3 && parts[1] === "connections") {
    dependencies.updateConnection(Number(parts[2]), await dependencies.readJson(request), dependencies.defaultExtraArgs);
    dependencies.clearConnectionHealthCache(Number(parts[2]));
    dependencies.sendJson(response, {ok:true});
    return true;
  }
  if (method === "DELETE" && parts.length === 3 && parts[1] === "connections") {
    const id = Number(parts[2]);
    dependencies.stopExternalEditsForConnection(id);
    dependencies.deleteConnection(id, dependencies.stopForward);
    dependencies.clearConnectionHealthCache(id);
    dependencies.sendJson(response, {ok:true});
    return true;
  }
  if (method === "DELETE" && parts.length === 3 && parts[1] === "forwards") {
    const forward = dependencies.getForward(Number(parts[2]));
    dependencies.deleteForward(Number(parts[2]), dependencies.stopForward);
    dependencies.clearConnectionHealthCache(forward.connection_id);
    dependencies.sendJson(response, {ok:true});
    return true;
  }

  return false;
}
