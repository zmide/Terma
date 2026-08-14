import { IncomingMessage, ServerResponse } from "node:http";

const {
  applyForwardTemplate,
  deleteForwardTemplate,
  insertForwardTemplate,
  listForwardTemplates,
  updateForwardTemplate
} = require("../db");

interface ForwardTemplateOperations {
  applyForwardTemplate(id: string, connectionIds: unknown[]): unknown;
  deleteForwardTemplate(id: string): unknown;
  insertForwardTemplate(data: any): number;
  listForwardTemplates(): unknown;
  updateForwardTemplate(id: string, data: any): unknown;
}

interface ForwardTemplateRouteDependencies {
  createConfigSnapshot(reason: string): unknown;
  operations?: ForwardTemplateOperations;
  readJson(request: IncomingMessage): Promise<any>;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
}

const defaultOperations: ForwardTemplateOperations = {
  applyForwardTemplate,
  deleteForwardTemplate,
  insertForwardTemplate,
  listForwardTemplates,
  updateForwardTemplate
};

export async function handleForwardTemplateRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: ForwardTemplateRouteDependencies
): Promise<boolean> {
  const method = request.method || "GET";
  const operations = dependencies.operations || defaultOperations;

  if (pathname === "/api/forward-templates") {
    if (method === "GET") {
      dependencies.sendJson(response, operations.listForwardTemplates());
      return true;
    }
    if (method === "POST") {
      const id = operations.insertForwardTemplate(await dependencies.readJson(request));
      dependencies.sendJson(response, {id}, 201);
      return true;
    }
    return false;
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "api" || parts[1] !== "forward-templates") return false;
  const id = parts[2];

  if (method === "PUT" && parts.length === 3) {
    operations.updateForwardTemplate(id, await dependencies.readJson(request));
    dependencies.sendJson(response, {ok:true});
    return true;
  }
  if (method === "DELETE" && parts.length === 3) {
    operations.deleteForwardTemplate(id);
    dependencies.sendJson(response, {ok:true});
    return true;
  }
  if (method === "POST" && parts.length === 4 && parts[3] === "apply") {
    const data = await dependencies.readJson(request);
    dependencies.createConfigSnapshot("批量应用转发模板前自动快照");
    dependencies.sendJson(response, operations.applyForwardTemplate(id, data.connection_ids || []));
    return true;
  }

  return false;
}
