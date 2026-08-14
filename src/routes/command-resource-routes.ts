import { IncomingMessage, ServerResponse } from "node:http";

const {
  deleteCommandSnippet,
  deleteNamedWorkspace,
  duplicateNamedWorkspace,
  insertCommandSnippet,
  insertNamedWorkspace,
  listCommandSnippets,
  listNamedWorkspaces,
  updateCommandSnippet,
  updateNamedWorkspace,
  useCommandSnippet,
  useNamedWorkspace
} = require("../db");
const {
  deleteCommandTemplate,
  listCommandTemplates,
  saveCommandTemplate,
  updateCommandTemplate
} = require("../commands");

interface CommandResourceOperations {
  deleteCommandSnippet(id: string): unknown;
  deleteCommandTemplate(id: string): unknown;
  deleteNamedWorkspace(id: string): unknown;
  duplicateNamedWorkspace(id: string): unknown;
  insertCommandSnippet(data: any): unknown;
  insertNamedWorkspace(data: any): unknown;
  listCommandSnippets(): unknown;
  listCommandTemplates(): unknown;
  listNamedWorkspaces(): unknown;
  saveCommandTemplate(data: any): unknown;
  updateCommandSnippet(id: string, data: any): unknown;
  updateCommandTemplate(id: string, data: any): unknown;
  updateNamedWorkspace(id: string, data: any): unknown;
  useCommandSnippet(id: string): unknown;
  useNamedWorkspace(id: string): unknown;
}

interface CommandResourceRouteDependencies {
  operations?: CommandResourceOperations;
  readJson(request: IncomingMessage): Promise<any>;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
}

const defaultOperations: CommandResourceOperations = {
  deleteCommandSnippet,
  deleteCommandTemplate,
  deleteNamedWorkspace,
  duplicateNamedWorkspace,
  insertCommandSnippet,
  insertNamedWorkspace,
  listCommandSnippets,
  listCommandTemplates,
  listNamedWorkspaces,
  saveCommandTemplate,
  updateCommandSnippet,
  updateCommandTemplate,
  updateNamedWorkspace,
  useCommandSnippet,
  useNamedWorkspace
};

export async function handleCommandResourceRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: CommandResourceRouteDependencies
): Promise<boolean> {
  const method = request.method || "GET";
  const operations = dependencies.operations || defaultOperations;

  if (method === "GET" && pathname === "/api/command-snippets") {
    dependencies.sendJson(response, operations.listCommandSnippets());
    return true;
  }
  if (method === "GET" && pathname === "/api/named-workspaces") {
    dependencies.sendJson(response, operations.listNamedWorkspaces());
    return true;
  }
  if (method === "GET" && pathname === "/api/command-templates") {
    dependencies.sendJson(response, operations.listCommandTemplates());
    return true;
  }
  if (method === "POST" && pathname === "/api/command-snippets") {
    dependencies.sendJson(response, operations.insertCommandSnippet(await dependencies.readJson(request)), 201);
    return true;
  }
  if (method === "POST" && pathname === "/api/named-workspaces") {
    dependencies.sendJson(response, operations.insertNamedWorkspace(await dependencies.readJson(request)), 201);
    return true;
  }
  if (method === "POST" && pathname === "/api/command-templates") {
    dependencies.sendJson(response, operations.saveCommandTemplate(await dependencies.readJson(request)), 201);
    return true;
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "api") return false;
  const id = parts[2];

  if (parts[1] === "command-snippets") {
    if (method === "PUT" && parts.length === 3) {
      dependencies.sendJson(response, operations.updateCommandSnippet(id, await dependencies.readJson(request)));
      return true;
    }
    if (method === "DELETE" && parts.length === 3) {
      dependencies.sendJson(response, operations.deleteCommandSnippet(id));
      return true;
    }
    if (method === "POST" && parts.length === 4 && parts[3] === "use") {
      dependencies.sendJson(response, operations.useCommandSnippet(id));
      return true;
    }
  }

  if (parts[1] === "named-workspaces") {
    if (method === "PUT" && parts.length === 3) {
      dependencies.sendJson(response, operations.updateNamedWorkspace(id, await dependencies.readJson(request)));
      return true;
    }
    if (method === "DELETE" && parts.length === 3) {
      dependencies.sendJson(response, operations.deleteNamedWorkspace(id));
      return true;
    }
    if (method === "POST" && parts.length === 4 && parts[3] === "duplicate") {
      dependencies.sendJson(response, operations.duplicateNamedWorkspace(id), 201);
      return true;
    }
    if (method === "POST" && parts.length === 4 && parts[3] === "use") {
      dependencies.sendJson(response, operations.useNamedWorkspace(id));
      return true;
    }
  }

  if (parts[1] === "command-templates" && parts.length === 3) {
    if (method === "PUT") {
      dependencies.sendJson(response, operations.updateCommandTemplate(id, await dependencies.readJson(request)));
      return true;
    }
    if (method === "DELETE") {
      dependencies.sendJson(response, operations.deleteCommandTemplate(id));
      return true;
    }
  }

  return false;
}
