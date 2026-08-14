const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { DATA_DIR } = require("../config");
const databaseCore = require("./core");
const db = { exec(sql: string) { return databaseCore.getDatabase().exec(sql); } };

function exportDatabaseFile(includePasswords = false): any {
  const temporary = path.join(DATA_DIR, `database-export-${process.pid}-${Date.now()}.db`);
  let exportedDb = null;
  try {
    db.exec(`VACUUM INTO '${temporary.replace(/'/g, "''")}'`);
    if (!includePasswords) {
      exportedDb = new DatabaseSync(temporary);
      const table = exportedDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='connections'").get();
      if (table) {
        const columns = new Set(exportedDb.prepare("PRAGMA table_info(connections)").all().map((item: any) => item.name));
        if (columns.has("ssh_password")) exportedDb.exec("UPDATE connections SET ssh_password=NULL");
        if (columns.has("private_key_passphrase")) exportedDb.exec("UPDATE connections SET private_key_passphrase=NULL");
      }
      const remoteTable = exportedDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='remote_profiles'").get();
      if (remoteTable) exportedDb.exec("UPDATE remote_profiles SET password=NULL");
      exportedDb.close();
      exportedDb = null;
    }
    return {
      path: temporary,
      size: fs.statSync(temporary).size,
      cleanup() {
        try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
      }
    };
  } catch (error) {
    try { exportedDb?.close(); } catch {}
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function exportDatabaseBuffer(includePasswords = false): Buffer {
  const exported = exportDatabaseFile(includePasswords);
  try {
    return fs.readFileSync(exported.path);
  } finally {
    exported.cleanup();
  }
}

module.exports = { exportDatabaseBuffer, exportDatabaseFile };
