import { DatabaseSync } from "node:sqlite";
import { applyDatabaseMigrations } from "./migrations";

const { DATA_DIR, DB_PATH, LOG_DIR } = require("../config");
const { ensurePrivateDirectory, ensurePrivateFile } = require("../storage-permissions");

let activeDatabase: DatabaseSync | null = null;

function secureDatabaseStorage() {
  ensurePrivateDirectory(DATA_DIR);
  ensurePrivateDirectory(LOG_DIR);
  for (const file of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) ensurePrivateFile(file);
}

export function openDatabase(): DatabaseSync {
  if (activeDatabase) return activeDatabase;
  secureDatabaseStorage();
  activeDatabase = new DatabaseSync(DB_PATH);
  ensurePrivateFile(DB_PATH);
  activeDatabase.exec("PRAGMA journal_mode=WAL");
  activeDatabase.exec("PRAGMA foreign_keys=ON");
  for (const file of [`${DB_PATH}-wal`, `${DB_PATH}-shm`]) ensurePrivateFile(file);
  applyDatabaseMigrations(activeDatabase);
  return activeDatabase;
}

export function getDatabase(): DatabaseSync {
  return activeDatabase || openDatabase();
}

export function closeDatabase(): void {
  if (!activeDatabase) return;
  activeDatabase.close();
  activeDatabase = null;
}

export function reopenDatabase(): DatabaseSync {
  closeDatabase();
  return openDatabase();
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function run(sql: string, params: any = {}): any {
  const statement = getDatabase().prepare(sql);
  return Array.isArray(params) ? statement.run(...params) : statement.run(params);
}

export function get(sql: string, params: any = {}): any {
  const statement = getDatabase().prepare(sql);
  return Array.isArray(params) ? statement.get(...params) : statement.get(params);
}

export function all(sql: string, params: any = {}): any[] {
  const statement = getDatabase().prepare(sql);
  return (Array.isArray(params) ? statement.all(...params) : statement.all(params)) as any[];
}

openDatabase();
