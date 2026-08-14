import fs from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

interface FtpRouteDependencies {
  deleteFtpPath(id: number, remotePath: string, name: string, directory: boolean): Promise<any>;
  downloadFtpFile(id: number, remotePath: string, name: string): Promise<{cleanup(): void; name: string; path: string; size: number}>;
  getPart(contentType: string | string[] | undefined, body: Buffer, name: string): {data: Buffer; filename?: string};
  getRemoteProfile(id: number): any;
  listFtpDirectory(id: number, remotePath: string): Promise<any>;
  makeFtpDirectory(id: number, remotePath: string, name: string): Promise<any>;
  readBody(request: IncomingMessage): Promise<Buffer>;
  readJson(request: IncomingMessage): Promise<any>;
  renameFtpPath(id: number, remotePath: string, name: string, newName: string): Promise<any>;
  secureHeaders(headers?: Record<string, string | number>): Record<string, string | number>;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  uploadFtpFile(id: number, remotePath: string, name: string, data: Buffer): Promise<any>;
}

export async function handleFtpRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: FtpRouteDependencies
): Promise<boolean> {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[0] !== "api" || parts[1] !== "remote-profiles" || parts[3] !== "ftp") return false;

  const id = Number(parts[2]);
  if (!Number.isInteger(id) || id < 1) throw new Error("远程连接 ID 无效");
  const profile = dependencies.getRemoteProfile(id);
  if (profile.protocol !== "ftp") throw new Error("该连接不是 FTP 配置");
  const method = request.method || "GET";

  if (method === "GET" && parts.length === 4) {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    dependencies.sendJson(response, await dependencies.listFtpDirectory(id, url.searchParams.get("path") || ""));
    return true;
  }
  if (method === "POST" && parts.length === 5 && parts[4] === "mkdir") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, await dependencies.makeFtpDirectory(id, data.path, data.name), 201);
    return true;
  }
  if (method === "POST" && parts.length === 5 && parts[4] === "rename") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, await dependencies.renameFtpPath(id, data.path, data.name, data.new_name));
    return true;
  }
  if (method === "POST" && parts.length === 5 && parts[4] === "delete") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, await dependencies.deleteFtpPath(id, data.path, data.name, data.type === "directory"));
    return true;
  }
  if (method === "POST" && parts.length === 5 && parts[4] === "upload") {
    const body = await dependencies.readBody(request);
    const file = dependencies.getPart(request.headers["content-type"], body, "file");
    const remotePath = dependencies.getPart(request.headers["content-type"], body, "path").data.toString("utf8");
    dependencies.sendJson(response, await dependencies.uploadFtpFile(id, remotePath, file.filename || "upload.bin", file.data), 201);
    return true;
  }
  if (method === "GET" && parts.length === 5 && parts[4] === "download") {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    const item = await dependencies.downloadFtpFile(id, url.searchParams.get("path") || "/", url.searchParams.get("name") || "");
    response.writeHead(200, dependencies.secureHeaders({
      "Content-Type":"application/octet-stream",
      "Content-Length":item.size,
      "Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,
      "Cache-Control":"no-store"
    }));
    const stream = fs.createReadStream(item.path);
    const cleanup = () => item.cleanup();
    stream.once("close", cleanup);
    stream.once("error", error => response.destroy(error));
    response.once("close", cleanup);
    stream.pipe(response);
    return true;
  }

  return false;
}
