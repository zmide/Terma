import fs from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

interface BackupRestoreRouteDependencies {
  clearConnectionHealthCache(): void;
  closeDatabase(): void;
  createConfigSnapshot(reason: string): any;
  createDatabaseBundleHeader(data: any): Buffer;
  databaseTransferStore: any;
  dbPath: string;
  deleteConfigSnapshot(id: string): any;
  ensurePrivateFile(file: string): void;
  exportDatabaseFile(includePasswords: boolean): {cleanup(): void; path: string; size: number};
  inspectRestoreDatabaseFile(databasePath: string, security: any, credentialBindings: any, identityBindings: any): any;
  listConfigSnapshots(): any[];
  lockEncryption(): void;
  normalizeRestoredCredentials(databasePath: string, identityBindings: any, credentialBindings: any, encryptedBundle: boolean, encryptedLegacy: boolean): any;
  readJson(request: IncomingMessage): Promise<any>;
  readSecuritySettings(): any;
  reconcileEncryptionStateAtStartup(options: any): any;
  reopenDatabase(): void;
  requireEncryptionUnlocked(): void;
  restoreConfigSnapshotById(id: string): any;
  secureHeaders(headers?: Record<string, string | number>): Record<string, string | number>;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  stopAllForwards(): void;
  writeSecuritySettings(settings: any): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handleBackupRestoreRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: BackupRestoreRouteDependencies
): Promise<boolean> {
  const method = request.method || "GET";
  if (method === "GET" && pathname === "/api/config-snapshots") {
    dependencies.sendJson(response, dependencies.listConfigSnapshots());
    return true;
  }
  if (method === "POST" && pathname === "/api/config-snapshots") {
    const data = await dependencies.readJson(request);
    dependencies.sendJson(response, dependencies.createConfigSnapshot(data.reason || "手动快照"), 201);
    return true;
  }
  const snapshotRestore = pathname.match(/^\/api\/config-snapshots\/([A-Za-z0-9-]+)\/restore$/);
  if (method === "POST" && snapshotRestore) {
    dependencies.requireEncryptionUnlocked();
    dependencies.createConfigSnapshot("回滚前自动快照");
    dependencies.stopAllForwards();
    const result = dependencies.restoreConfigSnapshotById(snapshotRestore[1]);
    dependencies.clearConnectionHealthCache();
    dependencies.sendJson(response, result);
    return true;
  }
  const snapshotDelete = pathname.match(/^\/api\/config-snapshots\/([A-Za-z0-9-]+)$/);
  if (method === "DELETE" && snapshotDelete) {
    dependencies.sendJson(response, dependencies.deleteConfigSnapshot(snapshotDelete[1]));
    return true;
  }
  if (method === "GET" && pathname === "/api/backup/database") {
    const url = new URL(request.url || pathname, "http://terma.invalid");
    const includePasswords = url.searchParams.get("include_passwords") === "1";
    const exported = dependencies.exportDatabaseFile(includePasswords);
    response.writeHead(200, {
      "Content-Type":"application/octet-stream",
      "Content-Length":exported.size,
      "Content-Disposition":`attachment; filename="terma-${Date.now()}${includePasswords ? "-with-passwords" : ""}.db"`,
      "X-Terma-Passwords-Included":includePasswords ? "1" : "0",
      ...dependencies.secureHeaders()
    });
    const stream = fs.createReadStream(exported.path);
    const cleanup = () => exported.cleanup();
    stream.on("error", error => response.destroy(error));
    stream.on("close", cleanup);
    response.on("close", cleanup);
    stream.pipe(response);
    return true;
  }
  if (method === "GET" && pathname === "/api/backup/bundle") {
    dependencies.requireEncryptionUnlocked();
    const security = dependencies.readSecuritySettings();
    const exported = dependencies.exportDatabaseFile(true);
    const header = dependencies.createDatabaseBundleHeader({
      type:"terma-backup-v3",
      created_at:new Date().toISOString(),
      security:{
        encryption_enabled:Boolean(security.encryption_enabled),
        encryption_state:security.encryption_state || (security.encryption_enabled ? "enabled" : "disabled"),
        encryption_version:Number(security.encryption_version || (security.encryption_enabled ? 1 : 3)),
        encryption_salt:security.encryption_salt || "",
        encryption_check:security.encryption_check || ""
      }
    });
    response.writeHead(200, dependencies.secureHeaders({
      "Content-Type":"application/octet-stream",
      "Content-Length":header.length + exported.size,
      "Content-Disposition":`attachment; filename="terma-backup-${Date.now()}.termabackup"`
    }));
    response.write(header);
    const stream = fs.createReadStream(exported.path);
    const cleanup = () => exported.cleanup();
    stream.on("error", error => response.destroy(error));
    stream.on("close", cleanup);
    response.on("close", cleanup);
    stream.pipe(response);
    return true;
  }
  if (method === "POST" && pathname === "/api/restore/database/check") {
    let stage: any = null;
    try {
      stage = await dependencies.databaseTransferStore.stage(request, String(request.headers["x-terma-filename"] || request.headers["x-tunneldesk-filename"] || "backup.db"));
      const inspection = dependencies.inspectRestoreDatabaseFile(
        stage.database_path,
        stage.security,
        stage.legacy_credential_bindings,
        stage.legacy_identity_bindings
      );
      dependencies.sendJson(response, {
        ...inspection,
        restore_token:stage.token,
        restore_format:stage.format,
        upload_expires_at:stage.expires_at
      });
      return true;
    } catch (error) {
      if (stage) dependencies.databaseTransferStore.discard(stage);
      throw error;
    }
  }
  if (method === "DELETE" && pathname === "/api/restore/database/stage") {
    const data = await dependencies.readJson(request);
    dependencies.databaseTransferStore.discard(String(data.restore_token || ""));
    dependencies.sendJson(response, {ok:true});
    return true;
  }
  if (method === "POST" && pathname === "/api/restore/database") {
    dependencies.requireEncryptionUnlocked();
    const data = await dependencies.readJson(request);
    const stage = dependencies.databaseTransferStore.take(String(data.restore_token || ""));
    const credentialBindings = Array.isArray(data.credential_bindings) && data.credential_bindings.length
      ? data.credential_bindings
      : stage.legacy_credential_bindings;
    const identityBindings = Array.isArray(data.identity_bindings) && data.identity_bindings.length
      ? data.identity_bindings
      : stage.legacy_identity_bindings;
    const previousSecurity = dependencies.readSecuritySettings();
    try {
      const identities = dependencies.normalizeRestoredCredentials(
        stage.database_path,
        identityBindings,
        credentialBindings,
        Boolean(stage.security?.encryption_enabled),
        Boolean(!stage.security && previousSecurity.encryption_enabled)
      );
      dependencies.createConfigSnapshot("恢复数据库前自动快照");
      dependencies.stopAllForwards();
      dependencies.closeDatabase();
      const backup = `${dependencies.dbPath}.bak-${Date.now()}`;
      const clearDatabaseSidecars = () => {
        for (const file of [`${dependencies.dbPath}-wal`, `${dependencies.dbPath}-shm`]) {
          try {
            if (fs.existsSync(file)) fs.unlinkSync(file);
          } catch {}
        }
      };
      if (fs.existsSync(dependencies.dbPath)) {
        fs.copyFileSync(dependencies.dbPath, backup);
        dependencies.ensurePrivateFile(backup);
      }
      try {
        clearDatabaseSidecars();
        fs.copyFileSync(stage.database_path, dependencies.dbPath);
        if (stage.security) {
          dependencies.writeSecuritySettings({
            encryption_enabled:Boolean(stage.security.encryption_enabled),
            encryption_state:stage.security.encryption_state || (stage.security.encryption_enabled ? "enabled" : "disabled"),
            encryption_version:Number(stage.security.encryption_version || (stage.security.encryption_enabled ? 1 : 3)),
            encryption_salt:stage.security.encryption_salt || "",
            encryption_check:stage.security.encryption_check || "",
            encryption_legacy_version:0,
            encryption_legacy_salt:"",
            encryption_legacy_check:""
          });
          dependencies.lockEncryption();
        }
        dependencies.reopenDatabase();
        dependencies.reconcileEncryptionStateAtStartup({required:true});
        dependencies.clearConnectionHealthCache();
        dependencies.sendJson(response, {
          ok:true,
          backup,
          restart_required:false,
          database_reopened:true,
          restore_format:stage.format,
          encrypted_bundle:Boolean(stage.security?.encryption_enabled),
          missing_identities:identities.missing,
          unresolved_identities:identities.unresolved,
          encrypted_identities:identities.encrypted,
          mapped_identities:identities.mappings,
          encrypted_fields:identities.encrypted_fields || 0
        });
        return true;
      } catch (error) {
        try {
          dependencies.closeDatabase();
          clearDatabaseSidecars();
          if (fs.existsSync(backup)) fs.copyFileSync(backup, dependencies.dbPath);
          dependencies.writeSecuritySettings(previousSecurity);
          dependencies.lockEncryption();
          dependencies.reopenDatabase();
        } catch (rollbackError) {
          console.error(`database restore rollback failed: ${errorMessage(rollbackError)}`);
        }
        throw error;
      }
    } finally {
      dependencies.databaseTransferStore.discard(stage);
    }
  }

  return false;
}
