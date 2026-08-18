import path from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { publicErrorBody } from "../public-error";

interface SftpTransferRouteDependencies {
  authorizeConnectionId(request: IncomingMessage, value: string): number;
  clearRemoteRecycleItems(connectionId: number): Promise<any>;
  compressJob(connectionId: number, paths: string[], target: string, filename: string, encoding?: string): any;
  connectSftpSession(connectionId: number, options: any): Promise<any>;
  copyJob(connectionId: number, paths: string[], target: string): any;
  copyRemotePaths(connectionId: number, paths: string[], target: string): Promise<any>;
  createNativeSftpDragTicket(connectionId: number, paths: string[], options: any): Promise<any>;
  createRemoteFile(connectionId: number, remotePath: string): Promise<any>;
  crossCopyJob(sourceId: number, targetId: number, paths: string[], target: string, conflict: string, entries: any[]): any;
  deletePathsJob(connectionId: number, paths: string[], recycle: boolean): any;
  deleteRemoteRecycleItem(connectionId: number, id: string, storage: string): Promise<any>;
  disconnectSftpSession(connectionId: number, options: any): any;
  extractJob(connectionId: number, remotePath: string, target: string, options?: any): any;
  extractRemoteArchive(connectionId: number, remotePath: string, target: string, options?: any): Promise<any>;
  getDesktopIntegration(): any;
  invalidateRemoteDirectoryCache(connectionId: number): void;
  isDesktopRequest(request: IncomingMessage): boolean;
  listRemoteDir(connectionId: number, remotePath: string, options: any): Promise<any>;
  listRemoteFileVersions(connectionId: number, remotePath: string, limit: number): Promise<any>;
  listRemoteRecycleItems(connectionId: number): Promise<any[]>;
  makeRemoteDir(connectionId: number, remotePath: string): Promise<any>;
  moveJob(connectionId: number, paths: string[], target: string): any;
  moveRemotePaths(connectionId: number, paths: string[], target: string): Promise<any>;
  normalizeRemotePermissionRequest(paths: any, mode: any, recursive: any, owner: any, group: any): any;
  planRemoteUploads(connectionId: number, remotePath: string, filenames: string[]): Promise<any>;
  prepareSftpWriteContent(content: string, encoding: string, remotePath?: string, lineEnding?: string): {content: Buffer; encoding?: string; line_ending?: string | null; normalized_script?: boolean};
  readJson(request: IncomingMessage): Promise<any>;
  readRemoteBinaryFile(connectionId: number, remotePath: string, maximumBytes: number): Promise<any>;
  readRemoteDirectorySize(connectionId: number, remotePath: string): Promise<any>;
  readRemoteTextFile(connectionId: number, remotePath: string, encoding: string, maximumBytes: number): Promise<any>;
  readRuntimeSettings(file: string): any;
  receiveUploadJobContent(id: string, request: IncomingMessage): Promise<any>;
  renameRemotePath(connectionId: number, from: string, to: string): Promise<any>;
  resolveRemoteUploadTarget(connectionId: number, directory: string, filename: string, conflict: string): Promise<any>;
  restoreRemoteRecycleItem(connectionId: number, id: string, storage: string): Promise<any>;
  runtimeSettingsFile: string;
  safeUploadName(name: string): string;
  send(response: ServerResponse, status: number, data: unknown, headers?: Record<string, string>): void;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  setRemotePermissions(connectionId: number, paths: string[], mode: string, recursive: boolean, owner: string, group: string): Promise<any>;
  sftpSessionStatus(connectionId: number): any;
  stageSftpPaths(connectionId: number, paths: string[]): Promise<any>;
  startArchiveDownloadJob(connectionId: number, paths: string[], options: any): any;
  startDownloadJob(connectionId: number, remotePath: string, options: any): any;
  startLocalDeliveryJob(connectionId: number, paths: string[], target: string, conflict: string, options: any): any;
  startSyncJob(planId: string, selectedIndexes: number[], overrides: any): any;
  startSyncPlanningJob(connectionId: number, data: any): any;
  startUploadReceiveJob(connectionId: number, remotePath: string, filename: string, size: number, options: any): any;
  stopExternalEditsForConnection(connectionId: number): void;
  streamRemoteFile(connectionId: number, remotePath: string, response: ServerResponse, request: IncomingMessage): void;
  updateSftpTextEncoding(connectionId: number, encoding: string): any;
  writeRemoteFile(connectionId: number, remotePath: string, content: Buffer, options: any): Promise<any>;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

export async function handleSftpTransferRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: SftpTransferRouteDependencies
): Promise<boolean> {
  const method = request.method || "GET";
  const desktopIntegration = dependencies.getDesktopIntegration();
  if (method === "POST" && pathname === "/api/sftp/sync/choose-directory") {
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.chooseSyncDirectory) {
      dependencies.sendJson(response, publicErrorBody("SFTP_LOCAL_SYNC_DESKTOP_ONLY", "本地目录同步只能在本机桌面端中使用"), 403);
      return true;
    }
    dependencies.sendJson(response, {path:await Promise.resolve(desktopIntegration.chooseSyncDirectory())});
    return true;
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[0] !== "api" || parts[1] !== "connections" || parts[3] !== "sftp") return false;
  const connectionId = dependencies.authorizeConnectionId(request, parts[2]);

  if (method === "POST" && parts.length === 6 && parts[4] === "sync" && parts[5] === "plan") {
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.chooseSyncDirectory) {
      dependencies.sendJson(response, publicErrorBody("SFTP_LOCAL_SYNC_DESKTOP_ONLY", "本地目录同步只能在本机桌面端中使用"), 403);
      return true;
    }
    dependencies.sendJson(response, dependencies.startSyncPlanningJob(connectionId, await dependencies.readJson(request)), 202);
    return true;
  }
  if (method === "POST" && parts.length === 6 && parts[4] === "sync" && parts[5] === "execute") {
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.chooseSyncDirectory) {
      dependencies.sendJson(response, publicErrorBody("SFTP_LOCAL_SYNC_DESKTOP_ONLY", "本地目录同步只能在本机桌面端中使用"), 403);
      return true;
    }
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, dependencies.startSyncJob(data.plan_id, data.selected_indexes, data.overrides), 202);
    return true;
  }
  if (parts.length === 5 && parts[4] === "session") {
    if (method === "GET") {
      dependencies.sendJson(response, dependencies.sftpSessionStatus(connectionId));
      return true;
    }
    if (method === "POST") {
      dependencies.sendJson(response, await dependencies.connectSftpSession(connectionId, {explicit:true}));
      return true;
    }
    if (method === "DELETE") {
      const url = new URL(request.url || pathname, "http://terma.invalid");
      dependencies.stopExternalEditsForConnection(connectionId);
      dependencies.sendJson(response, dependencies.disconnectSftpSession(connectionId, {remember:url.searchParams.get("forget") !== "1"}));
      return true;
    }
  }
  if (method === "GET" && parts.length === 5 && parts[4] === "versions") {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    dependencies.sendJson(response, await dependencies.listRemoteFileVersions(connectionId, url.searchParams.get("path") || "", Number(url.searchParams.get("limit") || 10)));
    return true;
  }
  if (method === "GET" && parts.length === 4) {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    const result = await dependencies.listRemoteDir(connectionId, url.searchParams.get("path") || ".", {
      page:url.searchParams.get("page"),
      page_size:url.searchParams.get("page_size"),
      query:url.searchParams.get("query"),
      sort:url.searchParams.get("sort"),
      dir:url.searchParams.get("dir"),
      recursive:url.searchParams.get("recursive"),
      refresh:url.searchParams.get("refresh")
    });
    dependencies.send(response, 200, result, {"Cache-Control":"no-store"});
    return true;
  }
  if (method === "POST" && parts[4] === "download") {
    const data = await dependencies.readJson(request);
    const saved = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const desktop = Boolean(dependencies.isDesktopRequest(request) && desktopIntegration?.getDownloadDirectory);
    const defaultDirectory = desktop ? await Promise.resolve(desktopIntegration.getDownloadDirectory()) : "";
    dependencies.sendJson(response, dependencies.startDownloadJob(connectionId, data.path || "", {
      deliveryMode:desktop ? "desktop" : "browser",
      autoSaveDirectory:desktop ? (saved.sftp_download_directory || defaultDirectory) : ""
    }), 202);
    return true;
  }
  if (method === "POST" && parts[4] === "download-batch") {
    const data = await dependencies.readJson(request);
    const paths = Array.isArray(data.paths) ? data.paths : [];
    const saved = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile);
    const desktop = Boolean(dependencies.isDesktopRequest(request) && desktopIntegration?.getDownloadDirectory);
    const defaultDirectory = desktop ? await Promise.resolve(desktopIntegration.getDownloadDirectory()) : "";
    const targetDirectory = desktop ? (saved.sftp_download_directory || defaultDirectory) : "";
    if (data.mode === "separate") {
      if (!desktop || !targetDirectory) {
        dependencies.sendJson(response, publicErrorBody("SFTP_SEPARATE_DOWNLOAD_DESKTOP_ONLY", "分别下载文件和目录仅支持本机桌面版；当前设备请使用打包下载"), 400);
        return true;
      }
      dependencies.sendJson(response, dependencies.startLocalDeliveryJob(connectionId, paths, targetDirectory, "rename", {
        label:"批量下载到本机",
        deliveryMode:"download-directory"
      }), 202);
      return true;
    }
    dependencies.sendJson(response, dependencies.startArchiveDownloadJob(connectionId, paths, {
      deliveryMode:desktop ? "desktop" : "browser",
      autoSaveDirectory:targetDirectory,
      filename:data.filename || "",
      encoding:data.encoding || "default"
    }), 202);
    return true;
  }
  if (method === "GET" && parts[4] === "download") {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    dependencies.streamRemoteFile(connectionId, url.searchParams.get("path") || "", response, request);
    return true;
  }
  if (method === "GET" && parts[4] === "trash" && parts.length === 5) {
    dependencies.sendJson(response, {
      enabled:dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile).sftp_recycle_bin_enabled,
      items:await dependencies.listRemoteRecycleItems(connectionId)
    });
    return true;
  }
  if (method === "GET" && parts[4] === "read") {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    const remotePath = url.searchParams.get("path") || "";
    const maximumBytes = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile).sftp_max_open_file_size_mb * 1024 * 1024;
    const result = await dependencies.readRemoteTextFile(connectionId, remotePath, url.searchParams.get("encoding") || "", maximumBytes);
    dependencies.send(response, 200, {path:remotePath, ...result}, {"Cache-Control":"no-store"});
    return true;
  }
  if (method === "GET" && parts[4] === "preview-image") {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    const remotePath = url.searchParams.get("path") || "";
    const extension = path.posix.extname(remotePath).toLowerCase();
    const imageTypes = new Map([
      [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
      [".gif", "image/gif"], [".webp", "image/webp"], [".bmp", "image/bmp"],
      [".ico", "image/x-icon"], [".svg", "image/svg+xml"]
    ]);
    const contentType = imageTypes.get(extension);
    if (!contentType) {
      dependencies.sendJson(response, publicErrorBody("SFTP_IMAGE_PREVIEW_UNSUPPORTED", "该文件不是支持预览的图片格式", { extension }), 415);
      return true;
    }
    const maximumBytes = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile).sftp_max_open_file_size_mb * 1024 * 1024;
    const result = await dependencies.readRemoteBinaryFile(connectionId, remotePath, maximumBytes);
    dependencies.send(response, 200, result.content, {
      "Content-Type":contentType,
      "Content-Disposition":`inline; filename="${encodeURIComponent(path.posix.basename(remotePath) || "preview")}"`,
      "Cache-Control":"no-store"
    });
    return true;
  }
  if (method === "POST" && parts[4] === "upload-plan") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, await dependencies.planRemoteUploads(connectionId, data.path || ".", data.filenames || []));
    return true;
  }
  if (method === "POST" && parts[4] === "native-drag") {
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration) {
      dependencies.sendJson(response, publicErrorBody("SFTP_DRAG_OUT_DESKTOP_ONLY", "拖出到本机只能在桌面版中使用"), 403);
      return true;
    }
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, await dependencies.createNativeSftpDragTicket(connectionId, data.paths || [], {platform:String(data.platform || process.platform)}));
    return true;
  }
  if (method === "POST" && parts[4] === "stage-drag") {
    if (!dependencies.isDesktopRequest(request) || !desktopIntegration) {
      dependencies.sendJson(response, publicErrorBody("SFTP_DRAG_OUT_DESKTOP_ONLY", "拖出到本机仅能在桌面版中使用"), 403);
      return true;
    }
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, await dependencies.stageSftpPaths(connectionId, data.paths || []));
    return true;
  }
  if (method === "POST" && parts[4] === "upload-job") {
    const data = await dependencies.readJson(request);
    const directory = String(data.path || ".");
    const filename = dependencies.safeUploadName(data.filename || "upload.bin");
    const conflict = ["overwrite", "rename"].includes(data.conflict) ? data.conflict : "error";
    const target = await dependencies.resolveRemoteUploadTarget(connectionId, directory, filename, conflict);
    if (target.exists && conflict === "error") {
      dependencies.sendJson(response, {...publicErrorBody("SFTP_TARGET_CONFLICT", "目标目录已存在同名项目", { name:target.name }), conflict:true, name:target.name}, 409);
      return true;
    }
    const result = dependencies.startUploadReceiveJob(connectionId, target.path, filename, Math.max(0, Number(data.size || 0)), {
      conflict,
      sizeKnown:Object.prototype.hasOwnProperty.call(data, "size"),
      privateMode:data.private === true
    });
    dependencies.sendJson(response, {...result, remote_path:target.path, renamed:target.renamed}, 201);
    return true;
  }
  if (method === "POST" && parts[4] === "upload") {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    const directory = url.searchParams.get("path") || ".";
    const filename = decodeURIComponent(String(request.headers["x-file-name"] || url.searchParams.get("filename") || "upload.bin"));
    const conflict = ["overwrite", "rename"].includes(url.searchParams.get("conflict") || "") ? String(url.searchParams.get("conflict")) : "error";
    const target = await dependencies.resolveRemoteUploadTarget(connectionId, directory, filename, conflict);
    if (target.exists && conflict === "error") {
      dependencies.sendJson(response, {...publicErrorBody("SFTP_TARGET_CONFLICT", "目标目录已存在同名项目", { name:target.name }), conflict:true, name:target.name}, 409);
      return true;
    }
    const started = dependencies.startUploadReceiveJob(connectionId, target.path, filename, Math.max(0, Number(request.headers["content-length"] || 0)), {
      conflict,
      sizeKnown:request.headers["content-length"] !== undefined
    });
    try {
      const result = await dependencies.receiveUploadJobContent(started.id, request);
      dependencies.invalidateRemoteDirectoryCache(connectionId);
      dependencies.sendJson(response, {...result, remote_path:target.path, renamed:target.renamed}, 202);
    } catch (error) {
      if (!hasErrorCode(error, "SFTP_UPLOAD_CANCELLED")) throw error;
      if (!response.destroyed && !response.writableEnded) {
        dependencies.sendJson(response, {ok:true, status:"cancelled", id:started.id}, 409);
      }
    }
    return true;
  }

  const data = await dependencies.readJson(request);
  if (method === "POST" && parts[4] === "directory-size") {
    dependencies.send(response, 200, await dependencies.readRemoteDirectorySize(connectionId, data.path), {"Cache-Control":"no-store"});
    return true;
  }
  if (method === "POST" && parts[4] === "trash" && parts[5] === "restore") {
    const result = await dependencies.restoreRemoteRecycleItem(connectionId, data.id, data.storage);
    dependencies.invalidateRemoteDirectoryCache(connectionId);
    dependencies.sendJson(response, result);
    return true;
  }
  if (method === "POST" && parts[4] === "trash" && parts[5] === "delete") {
    dependencies.sendJson(response, await dependencies.deleteRemoteRecycleItem(connectionId, data.id, data.storage));
    return true;
  }
  if (method === "POST" && parts[4] === "trash" && parts[5] === "clear") {
    dependencies.sendJson(response, await dependencies.clearRemoteRecycleItems(connectionId));
    return true;
  }
  if (method === "POST" && parts[4] === "mkdir") {
    const result = await dependencies.makeRemoteDir(connectionId, data.path);
    dependencies.invalidateRemoteDirectoryCache(connectionId);
    dependencies.sendJson(response, result);
    return true;
  }
  if (method === "POST" && parts[4] === "create-file") {
    const result = await dependencies.createRemoteFile(connectionId, data.path);
    dependencies.invalidateRemoteDirectoryCache(connectionId);
    dependencies.sendJson(response, result);
    return true;
  }
  if (method === "POST" && parts[4] === "delete") {
    const recycleEnabled = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile).sftp_recycle_bin_enabled;
    const requestedPaths = Array.isArray(data.paths) ? data.paths : [data.path];
    const result = dependencies.deletePathsJob(connectionId, requestedPaths, recycleEnabled);
    dependencies.invalidateRemoteDirectoryCache(connectionId);
    dependencies.sendJson(response, result, 202);
    return true;
  }
  if (method === "POST" && parts[4] === "rename") {
    const result = await dependencies.renameRemotePath(connectionId, data.from, data.to);
    dependencies.invalidateRemoteDirectoryCache(connectionId);
    dependencies.sendJson(response, result);
    return true;
  }
  if (method === "POST" && parts[4] === "copy") {
    const result = data.background
      ? dependencies.copyJob(connectionId, data.paths || [], data.target)
      : await dependencies.copyRemotePaths(connectionId, data.paths || [], data.target);
    dependencies.invalidateRemoteDirectoryCache(connectionId);
    dependencies.sendJson(response, result);
    return true;
  }
  if (method === "POST" && parts[4] === "cross-copy") {
    const targetConnectionId = Number(data.target_connection_id);
    if (targetConnectionId < 0 && targetConnectionId !== connectionId) {
      dependencies.sendJson(response, publicErrorBody("SFTP_CROSS_TEMPORARY_CONNECTION_FORBIDDEN", "不能把文件跨会话复制到另一个临时连接"), 403);
      return true;
    }
    const result = dependencies.crossCopyJob(connectionId, targetConnectionId, data.paths || [], data.target || ".", data.conflict || "error", data.entries || []);
    dependencies.invalidateRemoteDirectoryCache(targetConnectionId);
    dependencies.sendJson(response, result, 202);
    return true;
  }
  if (method === "POST" && parts[4] === "move") {
    const result = data.background
      ? dependencies.moveJob(connectionId, data.paths || [], data.target)
      : await dependencies.moveRemotePaths(connectionId, data.paths || [], data.target);
    dependencies.invalidateRemoteDirectoryCache(connectionId);
    dependencies.sendJson(response, result);
    return true;
  }
  if (method === "POST" && parts[4] === "extract") {
    const result = data.background
      ? dependencies.extractJob(connectionId, data.path, data.target, {encoding:data.encoding, overwrite:data.overwrite})
      : await dependencies.extractRemoteArchive(connectionId, data.path, data.target, {encoding:data.encoding, overwrite:data.overwrite});
    dependencies.invalidateRemoteDirectoryCache(connectionId);
    dependencies.sendJson(response, result);
    return true;
  }
  if (method === "POST" && parts[4] === "compress") {
    const paths = Array.isArray(data.paths) ? data.paths : [data.path];
    const result = dependencies.compressJob(connectionId, paths, data.target, data.filename || data.name || "", data.encoding || "default");
    dependencies.invalidateRemoteDirectoryCache(connectionId);
    dependencies.sendJson(response, result, 202);
    return true;
  }
  if (method === "POST" && ["permissions", "chmod"].includes(parts[4])) {
    const permissionRequest = dependencies.normalizeRemotePermissionRequest(data.paths, data.mode, data.recursive, data.owner, data.group);
    dependencies.sendJson(response, await dependencies.setRemotePermissions(
      connectionId,
      permissionRequest.paths,
      permissionRequest.mode,
      permissionRequest.recursive,
      permissionRequest.owner,
      permissionRequest.group
    ));
    return true;
  }
  if (method === "POST" && parts[4] === "write") {
    const prepared = dependencies.prepareSftpWriteContent(data.content, data.encoding || "utf8", data.path, data.line_ending);
    const result = await dependencies.writeRemoteFile(connectionId, data.path, prepared.content, {backup:Boolean(data.backup)});
    if (data.persist_default) dependencies.updateSftpTextEncoding(connectionId, prepared.encoding || data.encoding || "utf8");
    dependencies.invalidateRemoteDirectoryCache(connectionId);
    dependencies.sendJson(response, {...result, encoding:prepared.encoding || data.encoding || "utf8", line_ending:prepared.line_ending, normalized_script:prepared.normalized_script});
    return true;
  }

  return false;
}
