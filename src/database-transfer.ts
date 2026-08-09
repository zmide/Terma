import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform, TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
const { ensurePrivateDirectory, ensurePrivateFile } = require("./storage-permissions");

export const DATABASE_BUNDLE_MAGIC = Buffer.from("TERMA-BACKUP-V3\n", "ascii");
export const LEGACY_DATABASE_BUNDLE_MAGIC = Buffer.from("TUNNELDESK-BACKUP-V2\n", "ascii");
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "ascii");
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_LEGACY_BYTES = 100 * 1024 * 1024;

export interface BundleSecurity {
  encryption_enabled: boolean;
  encryption_state: "disabled" | "enabled";
  encryption_version: 1 | 2;
  encryption_salt: string;
  encryption_check: string;
}

export interface DatabaseBundleMetadata {
  type: "terma-backup-v3";
  created_at: string;
  security: BundleSecurity | null;
}

export interface RestoreStage {
  token: string;
  database_path: string;
  upload_path: string | null;
  filename: string;
  size: number;
  format: "sqlite" | "bundle-v3" | "bundle-v2" | "bundle-v1" | "request-v1";
  security: BundleSecurity | null;
  legacy_identity_bindings: unknown[];
  legacy_credential_bindings: unknown[];
  created_at: number;
  expires_at: number;
}

class ByteLimit extends Transform {
  private total = 0;

  constructor(private readonly maximum: number) {
    super();
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.total += chunk.length;
    if (this.total > this.maximum) {
      callback(new Error("数据库备份超过 1 GB 上限"));
      return;
    }
    callback(null, chunk);
  }
}

function safeFilename(value: string): string {
  return path.basename(String(value || "backup.db")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "backup.db";
}

function readPrefix(file: string, length: number, position = 0): Buffer {
  const handle = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytes = fs.readSync(handle, buffer, 0, length, position);
    return buffer.subarray(0, bytes);
  } finally {
    fs.closeSync(handle);
  }
}

function assertSqlite(file: string): void {
  const header = readPrefix(file, SQLITE_HEADER.length);
  if (header.length !== SQLITE_HEADER.length || !header.equals(SQLITE_HEADER)) {
    throw new Error("请选择有效的 SQLite 数据库备份或 Terma 迁移包");
  }
}

function normalizeSecurity(value: unknown): BundleSecurity | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const enabled = Boolean(record.encryption_enabled);
  const state = String(record.encryption_state || (enabled ? "enabled" : "disabled"));
  const version = Number(record.encryption_version || (enabled ? 1 : 2));
  if (enabled && state !== "enabled") throw new Error("迁移包中的配置加密仍处于切换状态，不能恢复");
  if (!enabled && state !== "disabled") throw new Error("迁移包中的配置加密状态无效");
  if (enabled && ![1, 2].includes(version)) throw new Error("迁移包中的配置加密版本不受支持");
  const salt = String(record.encryption_salt || "");
  const check = String(record.encryption_check || "");
  if (enabled && (!salt || !check)) throw new Error("迁移包缺少配置加密校验信息");
  return {
    encryption_enabled:enabled,
    encryption_state:enabled ? "enabled" : "disabled",
    encryption_version:(version === 1 ? 1 : 2),
    encryption_salt:salt,
    encryption_check:check
  };
}

export function createDatabaseBundleHeader(metadata: DatabaseBundleMetadata): Buffer {
  const body = Buffer.from(JSON.stringify(metadata), "utf8");
  if (body.length > MAX_METADATA_BYTES) throw new Error("迁移包元数据过大");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length, 0);
  return Buffer.concat([DATABASE_BUNDLE_MAGIC, size, body]);
}

export class DatabaseTransferStore {
  private readonly directory: string;
  private readonly stages = new Map<string, RestoreStage>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    dataDirectory: string,
    private readonly ttlMs = 30 * 60 * 1000,
    private readonly maximumBytes = 1024 * 1024 * 1024
  ) {
    this.directory = path.join(dataDirectory, "restore-staging");
    ensurePrivateDirectory(this.directory);
    this.cleanupExpired();
    this.timer = setInterval(() => this.cleanupExpired(), Math.max(1000, Math.min(this.ttlMs, 5 * 60 * 1000)));
    this.timer.unref?.();
  }

  async stage(input: Readable, filename = "backup.db"): Promise<RestoreStage> {
    this.cleanupExpired();
    const token = crypto.randomUUID();
    const upload = path.join(this.directory, `${token}.upload`);
    const database = path.join(this.directory, `${token}.db`);
    try {
      await pipeline(input, new ByteLimit(this.maximumBytes), fs.createWriteStream(upload, { flags: "wx", mode:0o600 }));
      ensurePrivateFile(upload);
      const stat = fs.statSync(upload);
      if (stat.size < SQLITE_HEADER.length) throw new Error("数据库文件为空或无效");
      const parsed = await this.extract(upload, database, stat.size);
      assertSqlite(database);
      const created = Date.now();
      const stage: RestoreStage = {
        token,
        database_path: database,
        upload_path: fs.existsSync(upload) ? upload : null,
        filename: safeFilename(filename),
        size: fs.statSync(database).size,
        format: parsed.format,
        security: parsed.security,
        legacy_identity_bindings: parsed.identityBindings,
        legacy_credential_bindings: parsed.credentialBindings,
        created_at: created,
        expires_at: created + this.ttlMs
      };
      this.stages.set(token, stage);
      return stage;
    } catch (error) {
      try { fs.rmSync(upload, { force: true }); } catch {}
      try { fs.rmSync(database, { force: true }); } catch {}
      throw error;
    }
  }

  get(token: string): RestoreStage {
    this.cleanupExpired();
    const stage = this.stages.get(String(token || ""));
    if (!stage) throw new Error("恢复文件已过期或已使用，请重新选择文件");
    return stage;
  }

  take(token: string): RestoreStage {
    const stage = this.get(token);
    this.stages.delete(stage.token);
    return stage;
  }

  discard(stageOrToken: RestoreStage | string): void {
    const stage = typeof stageOrToken === "string" ? this.stages.get(stageOrToken) : stageOrToken;
    if (!stage) return;
    this.stages.delete(stage.token);
    for (const file of [stage.upload_path, stage.database_path]) {
      if (!file) continue;
      try { fs.rmSync(file, { force: true }); } catch {}
    }
  }

  cleanupExpired(now = Date.now()): number {
    let removed = 0;
    for (const stage of this.stages.values()) {
      if (stage.expires_at > now) continue;
      this.discard(stage);
      removed += 1;
    }
    if (!fs.existsSync(this.directory)) return removed;
    for (const entry of fs.readdirSync(this.directory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(this.directory, entry.name);
      try {
        if (now - fs.statSync(file).mtimeMs > this.ttlMs) fs.rmSync(file, { force: true });
      } catch {}
    }
    return removed;
  }

  private async extract(
    upload: string,
    database: string,
    size: number
  ): Promise<{
    format: RestoreStage["format"];
    security: BundleSecurity | null;
    identityBindings: unknown[];
    credentialBindings: unknown[];
  }> {
    const prefix = readPrefix(upload, Math.max(SQLITE_HEADER.length, DATABASE_BUNDLE_MAGIC.length + 4, LEGACY_DATABASE_BUNDLE_MAGIC.length + 4));
    if (prefix.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) {
      fs.renameSync(upload, database);
      return { format: "sqlite", security: null, identityBindings: [], credentialBindings: [] };
    }
    const magic = prefix.subarray(0, DATABASE_BUNDLE_MAGIC.length).equals(DATABASE_BUNDLE_MAGIC)
      ? DATABASE_BUNDLE_MAGIC
      : prefix.subarray(0, LEGACY_DATABASE_BUNDLE_MAGIC.length).equals(LEGACY_DATABASE_BUNDLE_MAGIC)
        ? LEGACY_DATABASE_BUNDLE_MAGIC
        : null;
    if (magic) {
      if (prefix.length < magic.length + 4) throw new Error("迁移包头部不完整");
      const metadataLength = prefix.readUInt32BE(magic.length);
      if (!metadataLength || metadataLength > MAX_METADATA_BYTES) throw new Error("迁移包元数据长度无效");
      const databaseOffset = magic.length + 4 + metadataLength;
      if (databaseOffset + SQLITE_HEADER.length > size) throw new Error("迁移包内容不完整");
      const metadataBody = readPrefix(upload, metadataLength, magic.length + 4);
      let metadata: Record<string, unknown>;
      try {
        metadata = JSON.parse(metadataBody.toString("utf8")) as Record<string, unknown>;
      } catch {
        throw new Error("迁移包元数据无效");
      }
      const legacyBundle = magic.equals(LEGACY_DATABASE_BUNDLE_MAGIC);
      const expectedType = legacyBundle ? "tunneldesk-backup-v2" : "terma-backup-v3";
      if (metadata.type !== expectedType) throw new Error("不支持的迁移包版本");
      await pipeline(fs.createReadStream(upload, { start: databaseOffset }), fs.createWriteStream(database, { flags: "wx", mode:0o600 }));
      ensurePrivateFile(database);
      return {
        format: legacyBundle ? "bundle-v2" : "bundle-v3",
        security: normalizeSecurity(metadata.security),
        identityBindings: [],
        credentialBindings: []
      };
    }
    if (size > Math.min(MAX_LEGACY_BYTES, this.maximumBytes)) {
      throw new Error("旧版 JSON/Base64 迁移包超过 100 MB，请在原设备升级后重新导出");
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(fs.readFileSync(upload, "utf8")) as Record<string, unknown>;
    } catch {
      throw new Error("请选择有效的 SQLite 数据库备份或 Terma 迁移包");
    }
    const identityBindings = Array.isArray(parsed.identity_bindings) ? parsed.identity_bindings : [];
    const credentialBindings = Array.isArray(parsed.credential_bindings) ? parsed.credential_bindings : [];
    let payload = parsed;
    let format: RestoreStage["format"] = "bundle-v1";
    if (parsed.type === "tunneldesk-restore-request-v1" && typeof parsed.payload_base64 === "string") {
      format = "request-v1";
      try {
        payload = JSON.parse(Buffer.from(parsed.payload_base64, "base64").toString("utf8")) as Record<string, unknown>;
      } catch {
        const raw = Buffer.from(parsed.payload_base64, "base64");
        fs.writeFileSync(database, raw, { mode:0o600 });
        ensurePrivateFile(database);
        return { format, security: null, identityBindings, credentialBindings };
      }
    }
    if (payload.type !== "tunneldesk-backup-v1" || typeof payload.database_base64 !== "string") {
      throw new Error("旧版迁移包格式无效");
    }
    fs.writeFileSync(database, Buffer.from(payload.database_base64, "base64"), { mode:0o600 });
    ensurePrivateFile(database);
    return {
      format,
      security: normalizeSecurity(payload.security),
      identityBindings,
      credentialBindings
    };
  }
}
