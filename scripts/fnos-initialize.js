"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");

function main() {
  if (process.env.TERMA_DISTRIBUTION !== "fnos") throw new Error("This helper requires the fnOS distribution");
  require(path.join(root, "scripts/node-runtime-check.js"));
  if (process.exitCode) throw new Error("The Node.js runtime is not supported");
  const { DATA_DIR, PROJECT_SSH_DIR, RUNTIME_SETTINGS_FILE } = require(path.join(root, "dist/config.js"));
  const action = process.argv[2];
  if (action === "ready") {
    const status = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "startup-status.json"), "utf8"));
    if (!["ready", "warning"].includes(status.state) || Number(status.port) !== 8088) process.exitCode = 1;
    return;
  }
  if (!["install", "upgrade", "check", "backup"].includes(action)) throw new Error("Unknown lifecycle action");
  const platformAction = String(process.env.TRIM_APP_STATUS || "").toUpperCase();
  const installing = action === "install" && (platformAction === "INSTALL" || (!platformAction && !process.env.TRIM_OLD_APPVER));
  if (["install", "upgrade", "backup"].includes(action)) console.log(`fnOS lifecycle: ${action}, operation=${platformAction || "unspecified"}, initialize_password=${installing}`);
  // A real reinstall uses its new wizard password. Reused install callbacks
  // during an upgrade must ignore persisted wizard values from earlier runs.
  const password = installing ? process.env.wizard_web_password || "" : "";
  if (installing && (password.length < 12 || password.length > 4096 || password.includes("\0") || password !== process.env.wizard_web_password_confirm)) {
    throw new Error("Use matching Web passwords of at least 12 characters / Web 密码至少 12 个字符且两次输入必须一致");
  }
  for (const directory of [DATA_DIR, PROJECT_SSH_DIR]) {
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error("Private storage cannot be a symbolic link");
    fs.mkdirSync(directory, {recursive:true, mode:0o700});
    fs.chmodSync(directory, 0o700);
  }
  const security = require(path.join(root, "dist/security.js"));
  if (installing) {
    security.setPassword(password);
    delete process.env.wizard_web_password;
    delete process.env.wizard_web_password_confirm;
  }
  if (!fs.existsSync(RUNTIME_SETTINGS_FILE)) {
    const { readRuntimeSettings, writeRuntimeSettings } = require(path.join(root, "dist/runtime-settings.js"));
    writeRuntimeSettings(RUNTIME_SETTINGS_FILE, {...readRuntimeSettings(RUNTIME_SETTINGS_FILE), listen_hosts:["0.0.0.0"], listen_port:8088});
    fs.chmodSync(RUNTIME_SETTINGS_FILE, 0o600);
  }
  security.updateSecurityOptions({auth_mode:"always", lan_auth_enabled:true,
    allow_disable_lan_auth:false, local_direct_desktop_integration_enabled:false, manage_user_ssh_keys_enabled:false});
  const settings = security.readSecuritySettings();
  if (!settings.password_hash && !settings.token_hash) throw new Error("Web access has not been initialized");
  for (const command of ["ssh", "ssh-keygen"]) {
    const probe = process.platform === "win32"
      ? spawnSync("where.exe", [command])
      : spawnSync("/bin/sh", ["-c", 'command -v "$1" >/dev/null', "sh", command]);
    if (probe.status !== 0) throw new Error(`Required command is missing: ${command}`);
  }
  if (action === "backup") {
    const { DatabaseSync } = require("node:sqlite");
    const databaseFile = path.join(DATA_DIR, "tunnels.db");
    if (fs.existsSync(databaseFile)) {
      const database = new DatabaseSync(databaseFile);
      try {
        const result = database.prepare("PRAGMA quick_check").get();
        if (Object.values(result)[0] !== "ok") throw new Error("Database integrity check failed");
        database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally { database.close(); }
    }
    const variableRoot = fs.realpathSync(process.env.TRIM_PKGVAR);
    if (path.dirname(fs.realpathSync(DATA_DIR)) !== variableRoot || path.dirname(fs.realpathSync(PROJECT_SSH_DIR)) !== variableRoot) throw new Error("Unexpected backup source");
    const directory = path.join(variableRoot, "backups");
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error("Invalid backup directory");
    fs.mkdirSync(directory, {recursive:true, mode:0o700});
    const archive = path.join(directory, `terma-${Date.now()}-${require("node:crypto").randomBytes(4).toString("hex")}.tar.gz`);
    const result = spawnSync("tar", ["-czf", archive, "-C", variableRoot, "data", "ssh"], {stdio:["ignore", "ignore", "pipe"]});
    if (result.status !== 0) throw new Error("Unable to create the private upgrade backup");
    fs.chmodSync(archive, 0o600);
  }
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
