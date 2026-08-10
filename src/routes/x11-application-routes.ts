import { IncomingMessage, ServerResponse } from "node:http";

interface X11ApplicationRouteDependencies {
  authorizeConnection(request: IncomingMessage, connectionId: unknown): any;
  installForConnection(connection: any, data: any): Promise<any>;
  installPlanForConnection(connection: any): Promise<any>;
  listForConnection(connection: any): Promise<any>;
  readJson(request: IncomingMessage): Promise<any>;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  verifyForConnection(connection: any, command: unknown): Promise<any>;
}

export async function handleX11ApplicationRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: X11ApplicationRouteDependencies
): Promise<boolean> {
  if (request.method !== "POST") return false;
  const match = pathname.match(/^\/api\/connections\/(-?\d+)\/x11-applications(?:\/(install-plan|install|verify))?$/);
  if (!match) return false;

  const connection = dependencies.authorizeConnection(request, match[1]);
  const action = String(match[2] || "");
  if (!action) {
    dependencies.sendJson(response, {discovery:await dependencies.listForConnection(connection)});
    return true;
  }
  if (action === "install-plan") {
    dependencies.sendJson(response, await dependencies.installPlanForConnection(connection));
    return true;
  }
  const data = await dependencies.readJson(request);
  if (action === "install") {
    dependencies.sendJson(response, await dependencies.installForConnection(connection, data));
    return true;
  }
  dependencies.sendJson(response, {
    application:await dependencies.verifyForConnection(connection, data.command)
  });
  return true;
}
