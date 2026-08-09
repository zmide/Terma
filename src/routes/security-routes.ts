import { IncomingMessage, ServerResponse } from "node:http";

interface SecurityRouteDependencies {
  AuthenticationError: new (...args: any[]) => Error;
  readJson(request: IncomingMessage): Promise<any>;
  send(response: ServerResponse, status: number, data: unknown, headers?: Record<string, string>): void;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  publicAuthStatus(request: IncomingMessage): unknown;
  publicSecuritySettings(request: IncomingMessage): unknown;
  login(password: string, request: IncomingMessage): string;
  logout(request: IncomingMessage): void;
  sessionCookie(request: IncomingMessage, token: string, maxAgeSeconds?: number): string;
  updateSecurityOptions(value: unknown): unknown;
  setPassword(password: string): void;
  createSession(): string;
  setToken(): string;
  enableEncryption(password: string): unknown;
  beginDisableEncryption(): unknown;
  completeEncryptionEnable(): unknown;
  prepareEncryptionUpgrade(password: string): boolean;
  unlockEncryption(password: string): unknown;
  disableEncryption(): unknown;
  readSecuritySettings(): any;
  encryptStoredConnectionSecrets(): number;
  decryptStoredConnectionSecrets(): number;
  clearConfigSnapshots(): number;
}

export async function handlePublicAuthRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: SecurityRouteDependencies
): Promise<boolean> {
  if (request.method === "GET" && pathname === "/api/auth/status") {
    dependencies.sendJson(response, dependencies.publicAuthStatus(request));
    return true;
  }
  if (request.method !== "POST" || pathname !== "/api/auth/login") return false;
  const data = await dependencies.readJson(request);
  try {
    const token = dependencies.login(String(data.password || ""), request);
    dependencies.send(response, 200, { ok: true }, { "Set-Cookie": dependencies.sessionCookie(request, token) });
  } catch (error) {
    if (!(error instanceof dependencies.AuthenticationError)) throw error;
    const authenticationError = error as Error & { retryAfterSeconds?: number; statusCode?: number };
    const headers: Record<string, string> = authenticationError.retryAfterSeconds
      ? { "Retry-After": String(authenticationError.retryAfterSeconds) }
      : {};
    dependencies.send(response, authenticationError.statusCode || 401, { error: authenticationError.message }, headers);
  }
  return true;
}

export async function handleSecurityRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: SecurityRouteDependencies
): Promise<boolean> {
  if (request.method === "POST" && pathname === "/api/auth/logout") {
    dependencies.logout(request);
    dependencies.send(response, 200, { ok: true }, { "Set-Cookie": dependencies.sessionCookie(request, "", 0) });
    return true;
  }
  if (request.method === "GET" && pathname === "/api/security") {
    dependencies.sendJson(response, dependencies.publicSecuritySettings(request));
    return true;
  }
  if (request.method === "PUT" && pathname === "/api/security") {
    dependencies.updateSecurityOptions(await dependencies.readJson(request));
    dependencies.sendJson(response, dependencies.publicSecuritySettings(request));
    return true;
  }
  if (request.method === "POST" && pathname === "/api/security/password") {
    const data = await dependencies.readJson(request);
    dependencies.setPassword(String(data.password || ""));
    const token = dependencies.createSession();
    dependencies.send(response, 200, dependencies.publicSecuritySettings(request), {
      "Set-Cookie": dependencies.sessionCookie(request, token)
    });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/security/token") {
    const accessToken = dependencies.setToken();
    const sessionToken = dependencies.createSession();
    dependencies.send(response, 200, {
      ...(dependencies.publicSecuritySettings(request) as object),
      token: accessToken
    }, {
      "Set-Cookie": dependencies.sessionCookie(request, sessionToken)
    });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/security/encryption/enable") {
    const data = await dependencies.readJson(request);
    const result = dependencies.enableEncryption(String(data.password || ""));
    const encrypted_rows = dependencies.encryptStoredConnectionSecrets();
    dependencies.completeEncryptionEnable();
    const removed_snapshots = dependencies.clearConfigSnapshots();
    const settings = dependencies.readSecuritySettings();
    dependencies.sendJson(response, {
      ...(result as object),
      state:settings.encryption_state,
      version:settings.encryption_version,
      encrypted_rows,
      removed_snapshots
    });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/security/encryption/unlock") {
    const password = String((await dependencies.readJson(request)).password || "");
    const result = dependencies.unlockEncryption(password);
    dependencies.prepareEncryptionUpgrade(password);
    const settings = dependencies.readSecuritySettings();
    let transition_rows = 0;
    let removed_snapshots = 0;
    if (settings.encryption_state === "enabling") {
      transition_rows = dependencies.encryptStoredConnectionSecrets();
      dependencies.completeEncryptionEnable();
      removed_snapshots = dependencies.clearConfigSnapshots();
    } else if (settings.encryption_state === "disabling") {
      transition_rows = dependencies.decryptStoredConnectionSecrets();
      dependencies.disableEncryption();
      removed_snapshots = dependencies.clearConfigSnapshots();
    } else if (settings.encryption_state === "enabled") {
      transition_rows = dependencies.encryptStoredConnectionSecrets();
      if (transition_rows) removed_snapshots = dependencies.clearConfigSnapshots();
    }
    const finalSettings = dependencies.readSecuritySettings();
    dependencies.sendJson(response, {
      ...(result as object),
      state:finalSettings.encryption_state,
      version:finalSettings.encryption_version,
      key_rotated:Number((result as any)?.version || finalSettings.encryption_version) < Number(finalSettings.encryption_version || 0),
      transition_rows,
      removed_snapshots
    });
    return true;
  }
  if (request.method === "POST" && pathname === "/api/security/encryption/disable") {
    const data = await dependencies.readJson(request);
    const settings = dependencies.readSecuritySettings();
    if (settings.encryption_enabled) dependencies.unlockEncryption(String(data.password || ""));
    if (settings.encryption_enabled) dependencies.beginDisableEncryption();
    const decrypted_rows = settings.encryption_enabled ? dependencies.decryptStoredConnectionSecrets() : 0;
    const result = dependencies.disableEncryption();
    const removed_snapshots = dependencies.clearConfigSnapshots();
    dependencies.sendJson(response, { ...(result as object), decrypted_rows, removed_snapshots });
    return true;
  }
  return false;
}
