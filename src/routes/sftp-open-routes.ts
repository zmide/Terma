import { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

interface SftpOpenRouteDependencies {
  authorizeConnectionId(request: IncomingMessage, connectionId: number): number;
  runtimeSettingsFile: string;
  readRuntimeSettings(file: string): {sftp_max_open_file_size_mb: number};
  secureHeaders(headers: Record<string, string | number>): Record<string, string | number>;
  streamRemoteOpenFile(
    connectionId: number,
    remotePath: string,
    maximumBytes: number,
    response: ServerResponse,
    request: IncomingMessage,
    secureResponseHeaders: (headers: Record<string, string | number>) => Record<string, string | number>
  ): void;
}

export function handleSftpOpenRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: SftpOpenRouteDependencies
): boolean {
  const match = /^\/api\/connections\/(-?\d+)\/sftp\/open$/.exec(pathname);
  if (request.method !== "GET" || !match) return false;
  const requestedConnectionId = Number(match[1]);
  if (!Number.isSafeInteger(requestedConnectionId) || requestedConnectionId === 0) return false;
  const connectionId = dependencies.authorizeConnectionId(request, requestedConnectionId);
  const url = new URL(request.url || pathname, "http://terma.invalid");
  const remotePath = url.searchParams.get("path") || "";
  const maximumMb = dependencies.readRuntimeSettings(dependencies.runtimeSettingsFile).sftp_max_open_file_size_mb;
  dependencies.streamRemoteOpenFile(
    connectionId,
    remotePath,
    maximumMb * 1024 * 1024,
    response,
    request,
    dependencies.secureHeaders
  );
  return true;
}
