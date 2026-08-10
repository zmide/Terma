import { IncomingMessage, ServerResponse } from "node:http";

interface X11ForwardingRouteDependencies {
  authorizeConnection(request: IncomingMessage, connectionId: unknown): any;
  createRemoteAdminGrant(connection: any, data: any, scope: string): any;
  detectSshX11ForConnection(connection: any): Promise<any>;
  readJson(request: IncomingMessage): Promise<any>;
  releaseRemoteAdminGrant(grant: any): void;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  startSshX11ConfigurationTask(connection: any, action: unknown, grant?: any): Promise<any>;
}

export async function handleX11ForwardingRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: X11ForwardingRouteDependencies
): Promise<boolean> {
  const match = pathname.match(/^\/api\/connections\/(-?\d+)\/x11-forwarding$/);
  if (!match) return false;

  const connection = dependencies.authorizeConnection(request, match[1]);
  if (request.method === "GET") {
    dependencies.sendJson(response, await dependencies.detectSshX11ForConnection(connection));
    return true;
  }
  if (request.method !== "POST") return false;

  const data = await dependencies.readJson(request);
  const grant = dependencies.createRemoteAdminGrant(connection, data, "x11.sshd-config");
  try {
    const result = await dependencies.startSshX11ConfigurationTask(connection, data.action, grant);
    dependencies.sendJson(response, result, result?.task ? 202 : 200);
  } catch (error) {
    dependencies.releaseRemoteAdminGrant(grant);
    throw error;
  }
  return true;
}
