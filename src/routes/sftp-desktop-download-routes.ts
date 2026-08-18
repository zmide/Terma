import fs from "node:fs";
import path from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";

interface SftpDesktopDownloadRouteDependencies {
  runtimeSettingsFile: string;
  getDesktopIntegration(): any;
  isDesktopRequest(request: IncomingMessage): boolean;
  listSftpJobs(): any[];
  readJson(request: IncomingMessage): Promise<any>;
  readRuntimeSettings(file: string): any;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
}

export async function handleSftpDesktopDownloadRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: SftpDesktopDownloadRouteDependencies
): Promise<boolean> {
  if (pathname !== "/api/sftp/download-settings" && !pathname.startsWith("/api/sftp/download-settings/")) return false;

  const method = request.method || "GET";
  const desktopIntegration = dependencies.getDesktopIntegration();
  if (method === "GET" && pathname === "/api/sftp/download-settings") {
    const saved = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const desktop = Boolean(dependencies.isDesktopRequest(request) && desktopIntegration?.getDownloadDirectory);
    const defaultDirectory = desktop ? await Promise.resolve(desktopIntegration.getDownloadDirectory()) : "";
    dependencies.sendJson(response, {
      delivery_mode:desktop ? "desktop" : "browser",
      configured_directory:desktop ? saved.sftp_download_directory : "",
      default_directory:defaultDirectory,
      effective_directory:desktop ? (saved.sftp_download_directory || defaultDirectory) : "",
      can_choose_directory:Boolean(desktop && desktopIntegration?.chooseDownloadDirectory),
      can_open_directory:Boolean(desktop && desktopIntegration?.openDownloadDirectory)
    });
    return true;
  }
  if (method === "POST" && pathname === "/api/sftp/download-settings/choose") {
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.chooseDownloadDirectory) {
      dependencies.sendJson(response, {error:"目录选择仅能在本机桌面端中使用"}, 403);
      return true;
    }
    dependencies.sendJson(response, {path:await Promise.resolve(desktopIntegration.chooseDownloadDirectory())});
    return true;
  }
  if (method === "POST" && pathname === "/api/sftp/download-settings/open") {
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.openDownloadDirectory) {
      dependencies.sendJson(response, {error:"打开目录仅能在本机桌面端中使用"}, 403);
      return true;
    }
    const data = await dependencies.readJson(request);
    const job = data.job_id ? dependencies.listSftpJobs().find(item => String(item.id) === String(data.job_id)) : null;
    const saved = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const savedPath = job?.delivery_status === "saved" && job.saved_path ? String(job.saved_path) : "";
    let directory = saved.sftp_download_directory || await Promise.resolve(desktopIntegration.getDownloadDirectory());
    if (savedPath) {
      try { directory = fs.existsSync(savedPath) && fs.statSync(savedPath).isDirectory() ? savedPath : path.dirname(savedPath); }
      catch { directory = path.dirname(savedPath); }
    }
    dependencies.sendJson(response, await Promise.resolve(desktopIntegration.openDownloadDirectory(directory)));
    return true;
  }
  if (method === "POST" && pathname === "/api/sftp/download-settings/open-file") {
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.openLocalPath) {
      dependencies.sendJson(response, {error:"打开文件仅能在本机桌面端中使用"}, 403);
      return true;
    }
    const data = await dependencies.readJson(request);
    const job = dependencies.listSftpJobs().find(item => String(item.id) === String(data.job_id || ""));
    if (!job || job.type !== "download" || job.delivery_status !== "saved" || !job.saved_path) {
      dependencies.sendJson(response, {error:"下载文件不存在或已被清理"}, 404);
      return true;
    }
    dependencies.sendJson(response, await Promise.resolve(desktopIntegration.openLocalPath(job.saved_path)));
    return true;
  }
  if (method === "POST" && pathname === "/api/sftp/download-settings/delete-file") {
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.trashLocalPath) {
      dependencies.sendJson(response, {error:"删除下载文件仅能在本机桌面端中使用"}, 403);
      return true;
    }
    const data = await dependencies.readJson(request);
    const job = dependencies.listSftpJobs().find(item => String(item.id) === String(data.job_id || ""));
    if (!job || job.type !== "download" || job.delivery_status !== "saved" || !job.saved_path) {
      dependencies.sendJson(response, {error:"下载文件不存在或已被清理"}, 404);
      return true;
    }
    dependencies.sendJson(response, await Promise.resolve(desktopIntegration.trashLocalPath(job.saved_path)));
    return true;
  }

  return false;
}
