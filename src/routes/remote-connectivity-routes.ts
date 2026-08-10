import { IncomingMessage, ServerResponse } from "node:http";

interface RemoteConnectivityRouteDependencies {
  getRemoteProfile(id: number): any;
  inspectRemoteProfileConnectivity(profile: any): Promise<any>;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
}

export async function handleRemoteConnectivityRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: RemoteConnectivityRouteDependencies
): Promise<boolean> {
  const match = pathname.match(/^\/api\/remote-profiles\/(\d+)\/connectivity$/);
  if (!match || request.method !== "GET") return false;
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("远程连接 ID 无效");
  const profile = dependencies.getRemoteProfile(id);
  dependencies.sendJson(response, await dependencies.inspectRemoteProfileConnectivity(profile));
  return true;
}
