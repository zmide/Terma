import fs from "node:fs";
import path from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";

interface SftpDesktopDownloadRouteDependencies {
  runtimeSettingsFile: string;
  getDesktopIntegration(): any;
  isDesktopRequest(request: IncomingMessage): boolean;
  listSftpJobs(): any[];
  readBody(request: IncomingMessage, maxBytes?: number): Promise<Buffer>;
  readJson(request: IncomingMessage): Promise<any>;
  readRuntimeSettings(file: string): any;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
}

function decodeGeneratedFilename(value: unknown) {
  const source = String(value || "");
  try { return decodeURIComponent(source); }
  catch { return source; }
}

function safeGeneratedFilename(value: unknown, extension: ".pdf" | ".svg") {
  const source = decodeGeneratedFilename(value).trim();
  const basename = path.basename(source).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "");
  return basename.toLowerCase().endsWith(extension) ? basename : `${basename || "generated"}${extension}`;
}

function availableGeneratedPath(directory: string, filename: string) {
  const parsed = path.parse(filename);
  let target = path.join(directory, `${parsed.name}${parsed.ext}`);
  for (let index = 1; fs.existsSync(target); index += 1) {
    target = path.join(directory, `${parsed.name} (${index})${parsed.ext}`);
  }
  return target;
}

function generatedPathWithinDirectory(value: unknown, directory: string) {
  const target = path.resolve(String(value || ""));
  const root = path.resolve(directory);
  const relative = path.relative(root, target);
  return Boolean(relative && relative !== "." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
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
  if (method === "POST" && pathname === "/api/sftp/download-settings/save-generated") {
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.getDownloadDirectory) {
      dependencies.sendJson(response, {error:"生成文件保存仅能在本机桌面端使用"}, 403);
      return true;
    }
    const saved = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const defaultDirectory = await Promise.resolve(desktopIntegration.getDownloadDirectory());
    const directory = String(saved.sftp_download_directory || defaultDirectory || "").trim();
    if (!directory || !path.isAbsolute(directory)) {
      dependencies.sendJson(response, {error:"SFTP 下载目录无效"}, 400);
      return true;
    }
    const contentType = String(request.headers["content-type"] || "").toLowerCase();
    const extension = contentType.startsWith("application/pdf")
      ? ".pdf"
      : contentType.startsWith("image/svg+xml")
        ? ".svg"
        : "";
    if (!extension) {
      dependencies.sendJson(response, {error:"只允许保存 PDF 或 SVG 文件"}, 415);
      return true;
    }
    const filename = safeGeneratedFilename(request.headers["x-terma-generated-filename"] || `generated${extension}`, extension);
    try {
      fs.mkdirSync(directory, {recursive:true});
      const body = await dependencies.readBody(request, 50 * 1024 * 1024);
      if (!body.length) {
        dependencies.sendJson(response, {error:"生成文件内容为空"}, 400);
        return true;
      }
      const target = availableGeneratedPath(directory, filename);
      fs.writeFileSync(target, body, {flag:"wx", mode:0o600});
      dependencies.sendJson(response, {ok:true, path:target, directory:path.dirname(target), filename:path.basename(target), size:body.length}, 201);
    } catch (error: any) {
      dependencies.sendJson(response, {error:error?.message || "保存生成文件失败"}, 500);
    }
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
  if (method === "POST" && pathname === "/api/sftp/download-settings/delete-generated") {
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.trashLocalPath) {
      dependencies.sendJson(response, {error:"删除生成文件仅能在本机桌面端中使用"}, 403);
      return true;
    }
    const data = await dependencies.readJson(request);
    const saved = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const defaultDirectory = await Promise.resolve(desktopIntegration.getDownloadDirectory?.());
    const directory = String(saved.sftp_download_directory || defaultDirectory || "").trim();
    const target = String(data.path || "").trim();
    if (!directory || !path.isAbsolute(directory) || !generatedPathWithinDirectory(target, directory)) {
      dependencies.sendJson(response, {error:"生成文件路径无效"}, 400);
      return true;
    }
    try {
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        dependencies.sendJson(response, {error:"生成文件不存在或已被清理"}, 404);
        return true;
      }
    } catch {
      dependencies.sendJson(response, {error:"生成文件不存在或已被清理"}, 404);
      return true;
    }
    dependencies.sendJson(response, await Promise.resolve(desktopIntegration.trashLocalPath(target)));
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
