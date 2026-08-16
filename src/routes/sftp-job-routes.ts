import fs from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";

const defaultSftpJobs = require("../sftp-jobs");
const defaultSyncJobs = require("../sftp-sync");

interface SftpJobOperations {
  cancelSftpJob(id: string): unknown;
  clearFinishedSftpJobs(): unknown;
  deleteSftpJob(id: string): unknown;
  getSftpJobFile(id: string): { name: string; path: string };
  listSftpJobs(): unknown;
  markSftpJobDelivered(id: string): unknown;
  pauseSftpJob(id: string): unknown;
  receiveUploadJobContent(id: string, request: IncomingMessage): Promise<unknown>;
  resumeSftpJob(id: string): unknown;
}

interface SftpSyncJobOperations {
  cancelSyncJob(id: string): unknown;
  clearFinishedSyncJobs(): unknown;
  deleteSyncJob(id: string): unknown;
  getSyncJob(id: string): unknown;
  listSyncJobs(): unknown;
  retrySyncJob(id: string): unknown;
}

interface FileReadStream {
  on(event: string, listener: () => void): unknown;
  pipe(destination: ServerResponse): unknown;
}

interface SftpJobRouteDependencies {
  createReadStream?(file: string, options?: {start?: number; end?: number}): FileReadStream;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  sftpJobs?: SftpJobOperations;
  statFile?(file: string): { size: number };
  syncJobs?: SftpSyncJobOperations;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

export function parseHttpByteRange(header: string | string[] | undefined, size: number): {start:number; end:number} | null | false {
  if (header === undefined) return null;
  if (Array.isArray(header) || size <= 0) return false;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return false;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    return {start:Math.max(0, size - suffix), end:size - 1};
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= size) return false;
  return {start, end:Math.min(size - 1, requestedEnd)};
}

export async function handleSftpJobRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: SftpJobRouteDependencies
): Promise<boolean> {
  if (pathname !== "/api/sftp/jobs"
    && !pathname.startsWith("/api/sftp/jobs/")
    && pathname !== "/api/sftp/sync/jobs"
    && !pathname.startsWith("/api/sftp/sync/jobs/")) return false;

  const method = request.method || "GET";
  const parts = pathname.split("/").filter(Boolean);
  const sftpJobs = dependencies.sftpJobs || defaultSftpJobs;
  const syncJobs = dependencies.syncJobs || defaultSyncJobs;

  if (method === "GET" && pathname === "/api/sftp/jobs") {
    dependencies.sendJson(response, sftpJobs.listSftpJobs());
    return true;
  }
  if (method === "POST" && pathname === "/api/sftp/jobs/clear-finished") {
    dependencies.sendJson(response, sftpJobs.clearFinishedSftpJobs());
    return true;
  }
  if (parts.length === 5 && parts[0] === "api" && parts[1] === "sftp" && parts[2] === "jobs") {
    const jobId = parts[3];
    const action = parts[4];
    if (method === "PUT" && action === "content") {
      try {
        dependencies.sendJson(response, await sftpJobs.receiveUploadJobContent(jobId, request), 202);
      } catch (error) {
        if (!hasErrorCode(error, "SFTP_UPLOAD_CANCELLED")) throw error;
        if (!response.destroyed && !response.writableEnded) {
          dependencies.sendJson(response, {ok:true, status:"cancelled"}, 409);
        }
      }
      return true;
    }
    if (method === "POST" && action === "cancel") {
      dependencies.sendJson(response, sftpJobs.cancelSftpJob(jobId));
      return true;
    }
    if (method === "POST" && action === "pause") {
      dependencies.sendJson(response, sftpJobs.pauseSftpJob(jobId));
      return true;
    }
    if (method === "POST" && action === "resume") {
      dependencies.sendJson(response, sftpJobs.resumeSftpJob(jobId));
      return true;
    }
    if (method === "GET" && action === "fetch") {
      const item = sftpJobs.getSftpJobFile(jobId);
      const stat = (dependencies.statFile || fs.statSync)(item.path);
      const range = parseHttpByteRange(request.headers?.range, stat.size);
      if (range === false) {
        response.writeHead(416, {
          "Content-Range": `bytes */${stat.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store"
        });
        response.end();
        return true;
      }
      const partial = range !== null;
      const start = range?.start ?? 0;
      const end = range?.end ?? Math.max(0, stat.size - 1);
      response.writeHead(partial ? 206 : 200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": partial ? end - start + 1 : stat.size,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(item.name)}"`,
        "Accept-Ranges": "bytes",
        ...(partial ? {"Content-Range":`bytes ${start}-${end}/${stat.size}`} : {}),
        "Cache-Control": "no-store"
      });
      const stream = (dependencies.createReadStream || fs.createReadStream)(item.path, partial ? {start, end} : undefined);
      let responseFinished = false;
      let streamClosed = false;
      const markDelivered = () => {
        if (!partial && responseFinished && streamClosed) sftpJobs.markSftpJobDelivered(jobId);
      };
      response.on("finish", () => { responseFinished = true; markDelivered(); });
      stream.on("close", () => { streamClosed = true; markDelivered(); });
      stream.pipe(response);
      return true;
    }
  }
  if (method === "DELETE" && parts.length === 4 && parts[0] === "api" && parts[1] === "sftp" && parts[2] === "jobs") {
    dependencies.sendJson(response, sftpJobs.deleteSftpJob(parts[3]));
    return true;
  }

  if (method === "GET" && pathname === "/api/sftp/sync/jobs") {
    dependencies.sendJson(response, syncJobs.listSyncJobs());
    return true;
  }
  if (method === "POST" && pathname === "/api/sftp/sync/jobs/clear-finished") {
    dependencies.sendJson(response, syncJobs.clearFinishedSyncJobs());
    return true;
  }
  if (parts.length >= 5 && parts[0] === "api" && parts[1] === "sftp" && parts[2] === "sync" && parts[3] === "jobs") {
    const jobId = parts[4];
    if (method === "GET" && parts.length === 5) {
      dependencies.sendJson(response, syncJobs.getSyncJob(jobId));
      return true;
    }
    if (method === "DELETE" && parts.length === 5) {
      dependencies.sendJson(response, syncJobs.deleteSyncJob(jobId));
      return true;
    }
    if (method === "POST" && parts.length === 6 && parts[5] === "cancel") {
      dependencies.sendJson(response, syncJobs.cancelSyncJob(jobId));
      return true;
    }
    if (method === "POST" && parts.length === 6 && parts[5] === "retry") {
      dependencies.sendJson(response, syncJobs.retrySyncJob(jobId), 202);
      return true;
    }
  }

  return false;
}
