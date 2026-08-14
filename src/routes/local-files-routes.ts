import { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

const {
  chmodLocalPath,
  copyLocalPaths,
  createLocalEntry,
  deleteLocalPaths,
  listLocalDirectory,
  planLocalPathCopy,
  renameLocalPath,
  uploadLocalPaths
} = require("../local-files");
const { planSftpPathDelivery } = require("../sftp-session");
const { startLocalDeliveryJob } = require("../sftp-jobs");

interface LocalFilesRouteDependencies {
  getDesktopIntegration(): any;
  getHomeDirectory(): string;
  isDesktopRequest(request: IncomingMessage): boolean;
  readJson(request: IncomingMessage): Promise<any>;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
}

export async function handleLocalFilesRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: LocalFilesRouteDependencies
): Promise<boolean> {
  if (pathname !== "/api/local-files" && !pathname.startsWith("/api/local-files/")) return false;

  const desktopIntegration = dependencies.getDesktopIntegration();
  if (!dependencies.isDesktopRequest(request) || !desktopIntegration?.getDesktopDirectory) {
    dependencies.sendJson(response, { error:"本地文件只支持在 Terma 桌面端使用" }, 403);
    return true;
  }

  const method = request.method || "GET";
  if (method === "GET" && pathname === "/api/local-files") {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    const defaultDirectory = await Promise.resolve(desktopIntegration.getDesktopDirectory());
    const location = url.searchParams.get("location") || "directory";
    dependencies.sendJson(response, listLocalDirectory(location === "computer" ? "" : url.searchParams.get("path") || defaultDirectory, {
      defaultDirectory,
      location,
      page:url.searchParams.get("page"),
      page_size:url.searchParams.get("page_size"),
      query:url.searchParams.get("query"),
      sort:url.searchParams.get("sort"),
      dir:url.searchParams.get("dir")
    }));
    return true;
  }
  if (method === "GET" && pathname === "/api/local-files/locations") {
    dependencies.sendJson(response, {
      desktop:await Promise.resolve(desktopIntegration.getDesktopDirectory()),
      downloads:await Promise.resolve(desktopIntegration.getDownloadDirectory()),
      home:dependencies.getHomeDirectory()
    });
    return true;
  }
  if (method === "POST" && pathname === "/api/local-files/open") {
    if (!desktopIntegration?.openLocalPath) {
      dependencies.sendJson(response, { error:"当前桌面端不能打开本地文件" }, 403);
      return true;
    }
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, await Promise.resolve(desktopIntegration.openLocalPath(data.path || "")));
    return true;
  }
  if (method === "POST" && pathname === "/api/local-files/rename") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, renameLocalPath(data.path, data.new_name));
    return true;
  }
  if (method === "POST" && pathname === "/api/local-files/delete") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, deleteLocalPaths(data.paths || []));
    return true;
  }
  if (method === "POST" && pathname === "/api/local-files/create") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, createLocalEntry(data.directory, data.name, data.type));
    return true;
  }
  if (method === "POST" && pathname === "/api/local-files/chmod") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, chmodLocalPath(data.path, data.mode));
    return true;
  }
  if (method === "POST" && pathname === "/api/local-files/upload") {
    const data = await dependencies.readJson(request);
    const result = await uploadLocalPaths(Number(data.connection_id), data.paths || [], data.target || ".", data.conflict || "error");
    dependencies.sendJson(response, result, 202);
    return true;
  }
  if (method === "POST" && pathname === "/api/local-files/copy-plan") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, planLocalPathCopy(data.paths || [], data.target || ""));
    return true;
  }
  if (method === "POST" && pathname === "/api/local-files/copy") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, copyLocalPaths(data.paths || [], data.target || "", data.conflict || "error"));
    return true;
  }
  if (method === "POST" && pathname === "/api/local-files/receive-plan") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, planSftpPathDelivery(data.paths || [], data.target || ""));
    return true;
  }
  if (method === "POST" && pathname === "/api/local-files/receive") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, startLocalDeliveryJob(Number(data.connection_id), data.paths || [], data.target || "", data.conflict || "rename"), 202);
    return true;
  }
  if (method === "POST" && pathname === "/api/local-files/receive-desktop") {
    const data = await dependencies.readJson(request);
    const desktopDirectory = await Promise.resolve(desktopIntegration.getDesktopDirectory());
    dependencies.sendJson(response, startLocalDeliveryJob(Number(data.connection_id), data.paths || [], desktopDirectory, "rename", {
      label:"发送到桌面",
      deliveryMode:"desktop"
    }), 202);
    return true;
  }

  return false;
}
