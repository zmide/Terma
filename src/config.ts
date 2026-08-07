const path = require("node:path");
const fs = require("node:fs");

const BASE_DIR = path.resolve(__dirname, "..");
const STORAGE_SETTINGS_FILE = path.join(BASE_DIR, ".terma-storage.json");
const LEGACY_STORAGE_SETTINGS_FILE = path.join(BASE_DIR, ".tunneldesk-storage.json");
let storedRoot = "";
for (const settingsFile of [STORAGE_SETTINGS_FILE, LEGACY_STORAGE_SETTINGS_FILE]) {
  try {
    const stored = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    if (!stored?.root || !path.isAbsolute(String(stored.root))) continue;
    storedRoot = path.resolve(String(stored.root));
    if (settingsFile === LEGACY_STORAGE_SETTINGS_FILE && !fs.existsSync(STORAGE_SETTINGS_FILE)) {
      fs.writeFileSync(STORAGE_SETTINGS_FILE, JSON.stringify({ ...stored, migrated_from:"TunnelDesk" }, null, 2), "utf8");
    }
    break;
  } catch {}
}
const RUNTIME_ROOT = storedRoot || BASE_DIR;
const DATA_DIR = process.env.TERMA_DATA_DIR || process.env.TUNNELDESK_DATA_DIR || path.join(RUNTIME_ROOT, "data");
const LOG_DIR = path.join(DATA_DIR, "logs");
const DB_PATH = path.join(DATA_DIR, "tunnels.db");
const PUBLIC_DIR = path.join(BASE_DIR, "public");
const PROJECT_SSH_DIR = process.env.TERMA_SSH_DIR || process.env.TUNNELDESK_SSH_DIR || path.join(RUNTIME_ROOT, ".ssh");
const USER_SSH_DIR = path.join(require("node:os").homedir(), ".ssh");
const SSH_DIR = PROJECT_SSH_DIR;
const PID_FILE = path.join(DATA_DIR, "web.pid");
const WEB_URL_FILE = path.join(DATA_DIR, "web.url");
const WEB_INFO_FILE = path.join(DATA_DIR, "web.json");
const RUNTIME_SETTINGS_FILE = path.join(DATA_DIR, "runtime-settings.json");
const { resolveRuntimeSettings } = require("./runtime-settings");
const RUNTIME_SETTINGS = resolveRuntimeSettings(RUNTIME_SETTINGS_FILE);
const SSH_BIN = process.env.SSH_BIN || "ssh";
const DEFAULT_HOSTS = RUNTIME_SETTINGS.listen_hosts;
const DEFAULT_HOST = DEFAULT_HOSTS[0];
const DEFAULT_PORT = RUNTIME_SETTINGS.listen_port;
const DEFAULT_EXTRA_ARGS = "";

module.exports = {
  BASE_DIR,
  RUNTIME_ROOT,
  STORAGE_SETTINGS_FILE,
  LEGACY_STORAGE_SETTINGS_FILE,
  DATA_DIR,
  LOG_DIR,
  DB_PATH,
  PUBLIC_DIR,
  SSH_DIR,
  PROJECT_SSH_DIR,
  USER_SSH_DIR,
  PID_FILE,
  WEB_URL_FILE,
  WEB_INFO_FILE,
  RUNTIME_SETTINGS_FILE,
  SSH_BIN,
  DEFAULT_HOSTS,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_EXTRA_ARGS
};
