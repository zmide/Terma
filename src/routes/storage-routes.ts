import { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

interface StorageRouteDependencies {
  dataDir: string;
  projectSshDir: string;
  baseDir: string;
  runtimeSettingsFile: string;
  getDesktopIntegration(): any;
  isDesktopRequest(request: IncomingMessage): boolean;
  isDirectLoopbackRequest(request: IncomingMessage): boolean;
  authRequired(request: IncomingMessage): boolean;
  readJson(request: IncomingMessage): Promise<any>;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  storageSettingsView(): unknown;
  saveWebStorageSettings(data: unknown): unknown;
  listLocalDirectories(path: string): unknown;
  runtimeSettingsView(): unknown;
  programCacheView(): any;
  clearProgramCache(category?: string): any;
  readRuntimeSettings(file: string): any;
  normalizeRuntimeSettings(data: unknown): any;
  checkRuntimeSettings(data: unknown): Promise<any>;
  writeRuntimeSettings(file: string, data: unknown): void;
}

export async function handleStorageRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: StorageRouteDependencies
): Promise<boolean> {
  const method = request.method || "GET";
  const desktopIntegration = dependencies.getDesktopIntegration();

  if (method === "GET" && pathname === "/api/desktop-settings") {
    const desktopRequest = dependencies.isDesktopRequest(request);
    const storageManagementAvailable = desktopRequest
      || (!desktopIntegration && (dependencies.isDirectLoopbackRequest(request) || dependencies.authRequired(request)));
    if (!storageManagementAvailable) {
      dependencies.sendJson(response, { available:false, storage_management_available:false });
      return true;
    }
    if (!desktopIntegration?.getSettings) {
      dependencies.sendJson(response, {
        available:false,
        storage_management_available:true,
        settings:{
          dataMode:process.env.TERMA_DATA_DIR || process.env.TERMA_SSH_DIR || process.env.TUNNELDESK_DATA_DIR || process.env.TUNNELDESK_SSH_DIR
            ? "environment"
            : "project",
          customDataDir:String(process.env.TERMA_DATA_DIR || process.env.TUNNELDESK_DATA_DIR || "")
        },
        paths:{ dataDir:dependencies.dataDir, sshDir:dependencies.projectSshDir },
        project_mode_available:true,
        project_mode_label:"项目所在文件夹",
        base_dir:dependencies.baseDir,
        storage:dependencies.storageSettingsView()
      });
      return true;
    }
    dependencies.sendJson(response, {
      available:true,
      storage_management_available:true,
      ...(await Promise.resolve(desktopIntegration.getSettings())),
      storage:dependencies.storageSettingsView()
    });
    return true;
  }

  if (method === "PUT" && pathname === "/api/desktop-settings") {
    if (!dependencies.isDesktopRequest(request)
      && (desktopIntegration || (!dependencies.isDirectLoopbackRequest(request) && !dependencies.authRequired(request)))) {
      dependencies.sendJson(response, { error:"远程修改数据路径需要启用 Web 密码并登录" }, 403);
      return true;
    }
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, desktopIntegration?.saveSettings
      ? await Promise.resolve(desktopIntegration.saveSettings(data))
      : dependencies.saveWebStorageSettings(data));
    return true;
  }

  if (method === "POST" && pathname === "/api/desktop-settings/choose-data-dir") {
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.chooseDataDir) {
      dependencies.sendJson(response, { error:"目录选择仅能在本机桌面版中使用" }, 403);
      return true;
    }
    dependencies.sendJson(response, { path:await Promise.resolve(desktopIntegration.chooseDataDir()) });
    return true;
  }

  if (method === "GET" && pathname === "/api/storage/directories") {
    if (!dependencies.isDesktopRequest(request)
      && (desktopIntegration || (!dependencies.isDirectLoopbackRequest(request) && !dependencies.authRequired(request)))) {
      dependencies.sendJson(response, { error:"远程浏览目录需要启用 Web 密码并登录" }, 403);
      return true;
    }
    const url = new URL(request.url || pathname, "http://terma.invalid");
    dependencies.sendJson(response, dependencies.listLocalDirectories(url.searchParams.get("path") || ""));
    return true;
  }

  if (method === "GET" && pathname === "/api/runtime-settings") {
    dependencies.sendJson(response, dependencies.runtimeSettingsView());
    return true;
  }

  if (method === "GET" && pathname === "/api/cache") {
    dependencies.sendJson(response, dependencies.programCacheView());
    return true;
  }

  if (method === "DELETE" && pathname === "/api/cache") {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    const category = String(url.searchParams.get("category") || "").trim();
    dependencies.sendJson(response, { ok:true, ...dependencies.clearProgramCache(category) });
    return true;
  }

  if (method === "PUT" && pathname === "/api/runtime-settings") {
    const current = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const data = await dependencies.readJson(request);
    const next = dependencies.normalizeRuntimeSettings({
      listen_hosts:data.listen_hosts ?? current.listen_hosts,
      listen_port:data.listen_port ?? current.listen_port,
      sftp_recycle_bin_enabled:data.sftp_recycle_bin_enabled ?? current.sftp_recycle_bin_enabled,
      sftp_floating_progress_enabled:data.sftp_floating_progress_enabled ?? current.sftp_floating_progress_enabled,
      sftp_max_open_file_size_mb:data.sftp_max_open_file_size_mb ?? current.sftp_max_open_file_size_mb,
      sftp_text_editor_mode:data.sftp_text_editor_mode ?? current.sftp_text_editor_mode,
      sftp_light_editor_threshold_mb:data.sftp_light_editor_threshold_mb ?? current.sftp_light_editor_threshold_mb,
      sftp_external_edit_save_rule:data.sftp_external_edit_save_rule ?? current.sftp_external_edit_save_rule,
      sftp_external_edit_backup_enabled:data.sftp_external_edit_backup_enabled ?? current.sftp_external_edit_backup_enabled,
      sftp_download_concurrency:data.sftp_download_concurrency ?? current.sftp_download_concurrency,
      sftp_upload_concurrency:data.sftp_upload_concurrency ?? current.sftp_upload_concurrency,
      sftp_download_directory:data.sftp_download_directory ?? current.sftp_download_directory,
      restore_workspace_tabs:data.restore_workspace_tabs ?? current.restore_workspace_tabs,
      workspace_toolbar_placement:data.workspace_toolbar_placement ?? current.workspace_toolbar_placement,
      terminal: data.terminal ?? current.terminal
    });
    if (data.sftp_download_directory !== undefined && desktopIntegration) {
      if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.validateDownloadDirectory) {
        dependencies.sendJson(response, { error:"下载目录只能在本机桌面端中修改" }, 403);
        return true;
      }
      await Promise.resolve(desktopIntegration.validateDownloadDirectory(next.sftp_download_directory));
    }
    if (data.listen_hosts !== undefined || data.listen_port !== undefined) {
      const availability = await dependencies.checkRuntimeSettings(next);
      if (!availability.available) {
        dependencies.sendJson(response, {
          error:availability.error || "监听地址或端口不可用",
          ...availability
        }, 409);
        return true;
      }
    }
    dependencies.writeRuntimeSettings(dependencies.runtimeSettingsFile, next);
    try { require("../sftp-jobs").refreshSftpTransferQueues?.(); } catch {}
    dependencies.sendJson(response, dependencies.runtimeSettingsView());
    return true;
  }

  if (method === "POST" && pathname === "/api/runtime-settings/check") {
    dependencies.sendJson(response, await dependencies.checkRuntimeSettings(await dependencies.readJson(request)));
    return true;
  }

  return false;
}
