import { IncomingMessage, ServerResponse } from "node:http";

interface SftpExternalEditRouteDependencies {
  authorizeConnectionId(request: IncomingMessage, value: string): number;
  getDesktopIntegration(): any;
  getExternalEdit(id: string): any;
  getExternalEditComparison(id: string): Promise<any>;
  isDesktopRequest(request: IncomingMessage): boolean;
  listExternalEdits(): any[];
  readJson(request: IncomingMessage): Promise<any>;
  readRuntimeSettings(file: string): any;
  resolveExternalEdit(id: string, action: string, data: any): Promise<any>;
  runtimeSettingsFile: string;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  startExternalEdit(connectionId: number, remotePath: string, options: any): Promise<any>;
  stopExternalEdit(id: string): any;
}

export async function handleSftpExternalEditRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: SftpExternalEditRouteDependencies
): Promise<boolean> {
  const method = request.method || "GET";
  if (method === "GET" && pathname === "/api/sftp/external-edits") {
    if (!dependencies.isDesktopRequest(request)) {
      dependencies.sendJson(response, {error:"外部编辑会话只能在本机桌面端中查看"}, 403);
      return true;
    }
    dependencies.sendJson(response, dependencies.listExternalEdits());
    return true;
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts.length >= 3 && parts[0] === "api" && parts[1] === "sftp" && parts[2] === "external-edits") {
    if (!dependencies.isDesktopRequest(request)) {
      dependencies.sendJson(response, {error:"外部编辑会话只能在本机桌面端中处理"}, 403);
      return true;
    }
    if (method === "GET" && parts.length === 4) {
      dependencies.sendJson(response, dependencies.getExternalEdit(parts[3]));
      return true;
    }
    if (method === "GET" && parts.length === 5 && parts[4] === "comparison") {
      dependencies.sendJson(response, await dependencies.getExternalEditComparison(parts[3]));
      return true;
    }
    if (method === "DELETE" && parts.length === 4) {
      dependencies.sendJson(response, dependencies.stopExternalEdit(parts[3]));
      return true;
    }
    if (method === "POST" && parts.length === 5 && parts[4] === "resolve") {
      const data = await dependencies.readJson(request);
      dependencies.sendJson(response, await dependencies.resolveExternalEdit(parts[3], data.action, data));
      return true;
    }
    return false;
  }

  if (method === "POST" && parts.length === 5 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "sftp" && parts[4] === "external-edit") {
    const desktopIntegration = dependencies.getDesktopIntegration();
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.openExternalFile) {
      dependencies.sendJson(response, {error:"外部编辑器只能在本机桌面端中使用"}, 403);
      return true;
    }
    const connectionId = dependencies.authorizeConnectionId(request, parts[2]);
    const data = await dependencies.readJson(request);
    const settings = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    dependencies.sendJson(response, await dependencies.startExternalEdit(connectionId, data.path, {
      editor:data.editor || {},
      saveRule:data.save_rule || settings.sftp_external_edit_save_rule,
      backupOnAutoSave:data.backup_on_auto_save === undefined
        ? settings.sftp_external_edit_backup_enabled
        : data.backup_on_auto_save !== false,
      open:(file: string, editor: any) => desktopIntegration.openExternalFile(file, editor)
    }), 201);
    return true;
  }

  return false;
}
