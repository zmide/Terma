import fs from "node:fs";
import path from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

interface SshRouteDependencies {
  userSshDir: string;
  projectSshDir: string;
  getConnection(id: number): any;
  listConnections(): any[];
  listTrustedHostsPage(options: {page: number; page_size: number; query?: string}): unknown;
  removeTrustedHost(id: unknown): unknown;
  acceptHostTrust(token: unknown, mode: unknown): unknown;
  ensureConnectionHostTrusted(connection: unknown): Promise<unknown>;
  listIdentityFiles(): unknown;
  identityPermissionStatus(path: string): unknown;
  repairIdentityFile(path: string): unknown;
  saveUploadedKey(filename: string, data: Buffer): unknown;
  parseConfigText(text: string): any;
  inspectExtraArgs(value: string, context: Record<string, unknown>): unknown;
  testSsh(connection: unknown): Promise<any>;
  terminalCapabilitiesForConnection(connection: unknown): Promise<unknown>;
  generateSshKey(data: unknown): unknown;
  listManagedKeys(userKeysEnabled: boolean): unknown;
  importManagedKey(filename: string, data: Buffer, scope: string, userKeysEnabled: boolean): unknown;
  deleteManagedKey(path: string, scope: string, userKeysEnabled: boolean, referencedPaths: string[]): unknown;
  managedKeyProperties(path: string, scope: string, userKeysEnabled: boolean): unknown;
  updateManagedKey(path: string, scope: string, userKeysEnabled: boolean, data: unknown): Promise<unknown>;
  managedPublicKey(path: string, scope: string, userKeysEnabled: boolean): unknown;
  manageUserSshKeysEnabled(): boolean;
  referencedIdentityPaths(): string[];
  allConnectionsHealth(options: {force: boolean}): Promise<unknown>;
  diagnosePortUsage(host: string, port: unknown): Promise<unknown>;
  recommendPort(host: string, port: number, excludeId: unknown): Promise<unknown>;
  configuredPortOwner(port: unknown, excludeId: unknown): unknown;
  killPortOwner(pid: unknown, port: unknown, host: unknown): Promise<any>;
  appendSystemLog(message: string): void;
  getPart(contentType: string | string[] | undefined, body: Buffer, name: string): {filename: string; data: Buffer};
  readBody(request: IncomingMessage): Promise<Buffer>;
  readJson(request: IncomingMessage): Promise<any>;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
}

export async function handleSshRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: SshRouteDependencies
): Promise<boolean> {
  const method = request.method || "GET";

  if (method === "GET" && pathname === "/api/ssh/trusted-hosts") {
    const query = new URL(request.url || pathname, "http://terma.invalid").searchParams;
    dependencies.sendJson(response, dependencies.listTrustedHostsPage({
      page:Number(query.get("page") || 1),
      page_size:Number(query.get("page_size") || 5),
      query:String(query.get("q") || "")
    }));
    return true;
  }
  if (method === "DELETE" && pathname === "/api/ssh/trusted-hosts") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, dependencies.removeTrustedHost(data.id));
    return true;
  }
  if (method === "POST" && pathname === "/api/ssh/host-trust") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, dependencies.acceptHostTrust(data.token, data.mode));
    return true;
  }
  if (method === "POST" && pathname === "/api/ssh/preflight") {
    const data = await dependencies.readJson(request);
    const connection = data.connection_id ? dependencies.getConnection(Number(data.connection_id)) : data.connection;
    if (!connection) throw new Error("缺少 SSH 连接配置");
    dependencies.sendJson(response, await dependencies.ensureConnectionHostTrusted(connection));
    return true;
  }

  if (method === "GET" && pathname === "/api/identity-files") {
    dependencies.sendJson(response, dependencies.listIdentityFiles());
    return true;
  }
  if (method === "GET" && pathname === "/api/identity-files/info") {
    dependencies.sendJson(response, {
      items:dependencies.listIdentityFiles(),
      upload_directory:dependencies.projectSshDir
    });
    return true;
  }
  if (method === "POST" && pathname === "/api/identity-files/check") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, dependencies.identityPermissionStatus(data.path || ""));
    return true;
  }
  if (method === "POST" && pathname === "/api/identity-files/repair") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, dependencies.repairIdentityFile(data.path || ""));
    return true;
  }
  if (method === "POST" && pathname === "/api/identity-files") {
    const body = await dependencies.readBody(request);
    const part = dependencies.getPart(request.headers["content-type"], body, "key");
    dependencies.sendJson(response, dependencies.saveUploadedKey(part.filename, part.data), 201);
    return true;
  }

  if (method === "GET" && pathname === "/api/managed-keys") {
    dependencies.sendJson(response, dependencies.listManagedKeys(dependencies.manageUserSshKeysEnabled()));
    return true;
  }
  if (method === "POST" && pathname === "/api/managed-keys/import") {
    const body = await dependencies.readBody(request);
    const part = dependencies.getPart(request.headers["content-type"], body, "key");
    const url = new URL(request.url || pathname, "http://terma.invalid");
    const scope = String(url.searchParams.get("scope") || "project");
    dependencies.sendJson(response, dependencies.importManagedKey(part.filename, part.data, scope, dependencies.manageUserSshKeysEnabled()), 201);
    return true;
  }
  if (method === "POST" && pathname === "/api/managed-keys/properties") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, dependencies.managedKeyProperties(data.path || "", data.scope || "project", dependencies.manageUserSshKeysEnabled()));
    return true;
  }
  if (method === "PUT" && pathname === "/api/managed-keys/properties") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, await dependencies.updateManagedKey(data.path || "", data.scope || "project", dependencies.manageUserSshKeysEnabled(), data));
    return true;
  }
  if (method === "GET" && pathname === "/api/managed-keys/public") {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    dependencies.sendJson(response, dependencies.managedPublicKey(url.searchParams.get("path") || "", url.searchParams.get("scope") || "project", dependencies.manageUserSshKeysEnabled()));
    return true;
  }
  if (method === "DELETE" && pathname === "/api/managed-keys") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, dependencies.deleteManagedKey(data.path || "", data.scope || "project", dependencies.manageUserSshKeysEnabled(), dependencies.referencedIdentityPaths()));
    return true;
  }

  if (method === "GET" && pathname === "/api/ssh/config/detect") {
    const configPath = path.join(dependencies.userSshDir, "config");
    if (!fs.existsSync(configPath)) {
      dependencies.sendJson(response, { available:false, path:configPath, count:0, conflicts:[], text:"" });
      return true;
    }
    const text = fs.readFileSync(configPath, "utf8");
    const parsed = dependencies.parseConfigText(text);
    const existing = new Set(dependencies.listConnections().map(item => String(item.name).toLowerCase()));
    const conflicts = parsed.tunnels
      .filter(item => existing.has(String(item.name).toLowerCase()))
      .map(item => item.name);
    dependencies.sendJson(response, { available:true, path:configPath, count:parsed.count, conflicts, text });
    return true;
  }

  if (method === "POST" && pathname === "/api/ssh/extra-args/validate") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, dependencies.inspectExtraArgs(data.extra_args || "", {
      connect_timeout_seconds:data.connect_timeout_seconds,
      keepalive_interval_seconds:data.keepalive_interval_seconds,
      keepalive_count_max:data.keepalive_count_max,
      tcp_keepalive:data.tcp_keepalive
    }));
    return true;
  }

  if (method === "POST" && pathname === "/api/test-ssh") {
    const data = await dependencies.readJson(request);
    if (data.id && data.auth_type === "password" && !data.ssh_password) {
      try { data.ssh_password = dependencies.getConnection(Number(data.id)).ssh_password || ""; } catch {}
    }
    const result = await dependencies.testSsh(data);
    if (result.ok && data.discover_terminal === true) {
      try {
        result.capabilities = await dependencies.terminalCapabilitiesForConnection(data);
      } catch (error) {
        result.capabilities = {
          platform:"unknown",
          platform_label:"未知",
          default_shell:null,
          profiles:[],
          tools:[],
          warnings:[`SSH 已连接，但远端终端环境识别失败：${error instanceof Error ? error.message : String(error)}`]
        };
      }
    }
    dependencies.sendJson(response, result);
    return true;
  }

  if (method === "POST" && pathname === "/api/ssh/keys/generate") {
    dependencies.sendJson(response, dependencies.generateSshKey(await dependencies.readJson(request)), 201);
    return true;
  }

  if (method === "GET" && pathname === "/api/health") {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    dependencies.sendJson(response, await dependencies.allConnectionsHealth({ force:url.searchParams.get("refresh") === "1" }));
    return true;
  }
  if (method === "POST" && pathname === "/api/ports/diagnose") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, await dependencies.diagnosePortUsage(data.host || "127.0.0.1", data.port));
    return true;
  }
  if (method === "POST" && pathname === "/api/ports/recommend") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, await dependencies.recommendPort(
      data.host || "127.0.0.1",
      data.port ? Number(data.port) : 6000,
      data.exclude_id || 0
    ));
    return true;
  }
  if (method === "POST" && pathname === "/api/ports/check-forward") {
    const data = await dependencies.readJson(request);
    const host = data.host || "127.0.0.1";
    const start = data.port ? Number(data.port) : 6000;
    const configured = dependencies.configuredPortOwner(data.port, data.exclude_id || 0);
    const usage = await dependencies.diagnosePortUsage(host, data.port);
    const recommended = await dependencies.recommendPort(host, start, data.exclude_id || 0).catch(() => null);
    dependencies.sendJson(response, { configured, usage, recommended });
    return true;
  }
  if (method === "POST" && pathname === "/api/ports/kill") {
    const data = await dependencies.readJson(request);
    const result = await dependencies.killPortOwner(data.pid, data.port, data.host);
    dependencies.appendSystemLog(`已尝试关闭端口占用进程：${result.process?.name || "未知程序"} PID ${data.pid}`);
    dependencies.sendJson(response, result);
    return true;
  }

  return false;
}
