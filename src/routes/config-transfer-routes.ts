import { IncomingMessage, ServerResponse } from "node:http";

interface ConfigTransferRouteDependencies {
  defaultExtraArgs: unknown;
  batchTest(tunnels: any[]): Promise<unknown>;
  createConfigSnapshot(reason: string): unknown;
  exportConfig(ids?: any[]): unknown;
  getPart(contentType: string | string[] | undefined, body: Buffer, name: string): {filename?: string; data: Buffer};
  parseConfigText(text: string): any;
  readBody(request: IncomingMessage): Promise<Buffer>;
  readJson(request: IncomingMessage): Promise<any>;
  saveImported(tunnels: any[], defaultExtraArgs: unknown): unknown;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
}

export async function handleConfigTransferRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: ConfigTransferRouteDependencies
): Promise<boolean> {
  const method = request.method || "GET";

  if (method === "GET" && pathname === "/api/export/config") {
    dependencies.sendJson(response, {config:dependencies.exportConfig()});
    return true;
  }
  if (method === "POST" && pathname === "/api/import/parse") {
    const body = await dependencies.readBody(request);
    const part = dependencies.getPart(request.headers["content-type"], body, "config");
    const parsed = dependencies.parseConfigText(part.data.toString("utf8"));
    parsed.filename = part.filename || "config";
    dependencies.sendJson(response, parsed);
    return true;
  }
  if (method === "POST" && pathname === "/api/import/parse-text") {
    const data = await dependencies.readJson(request);
    const parsed = dependencies.parseConfigText(data.text || "");
    parsed.filename = data.filename || "pasted-config";
    dependencies.sendJson(response, parsed);
    return true;
  }
  if (method === "POST" && pathname === "/api/import/test") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, await dependencies.batchTest(data.tunnels || []));
    return true;
  }
  if (method === "POST" && pathname === "/api/import/save") {
    const data = await dependencies.readJson(request);
    dependencies.createConfigSnapshot("批量导入前自动快照");
    dependencies.sendJson(response, dependencies.saveImported(data.tunnels || [], dependencies.defaultExtraArgs), 201);
    return true;
  }
  if (method === "POST" && pathname === "/api/export/config") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, {config:dependencies.exportConfig(data.ids || [])});
    return true;
  }

  return false;
}
