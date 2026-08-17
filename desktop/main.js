const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, ipcMain, nativeImage, nativeTheme, screen, shell } = require("electron");
const { createDesktopBrowserAuthorizationPromptGate } = require("./browser-authorization-prompt");
const { createNativeSftpDrag } = require("./native-sftp-drag");
const { createRemoteClientAdapter } = require("./remote-clients");
const { createXServerRuntime } = require("./xserver-runtime");
const { copyLegacyProfileMissing, mergeLegacyRuntime, removeCreatedFiles } = require("./brand-data-migration");
const { legacyBrandWindowsAppRunning } = require("./windows-brand-process");
const {
  runtimeRoot:desktopStorageRuntimeRoot,
  createDesktopStorageTransition,
  completeDesktopStorageTransition,
  finalizeDesktopStorageTransition,
  rollbackDesktopStorageTransition
} = require("./storage-migration");

const PRODUCT_NAME = "Terma";
const LEGACY_PRODUCT_NAME = "TunnelDesk";
const PRODUCT_ID = "terma";
const LEGACY_PRODUCT_ID = "tunneldesk";
const APP_USER_MODEL_ID = "com.zmide.terma";
const LEGACY_APP_USER_MODEL_ID = "com.zmide.tunneldesk";
const TOAST_ACTIVATOR_CLSID = "{75F75A3C-FD87-47D7-B50D-15D5C636B26E}";
const BRAND_MIGRATION_VERSION = 2;

app.setName(PRODUCT_NAME);

let startServer = null;
let shutdown = null;
let parseServerArgs = null;
let DATA_DIR = "";
let LOG_DIR = "";
let PROJECT_SSH_DIR = "";
let PID_FILE = "";
let WEB_URL_FILE = "";
let DEFAULT_HOST = "127.0.0.1";
let DEFAULT_PORT = 8088;
let reserveNativeSftpDragTicket = null;
let deliverNativeSftpDragTicketItem = null;
let releaseNativeSftpDragTicket = null;
let beginNativeSftpDragJob = null;
let recordNativeSftpDragBytes = null;
let finishNativeSftpDragJob = null;
let discardNativeSftpDragJob = null;
let setNativeSftpDragCancelHandler = null;
let waitForSftpTransferStart = null;
let SETTINGS_FILE = "";
let BOOT_SETTINGS_FILE = "";
let dataPath = "";
let sshPath = "";
const DISPLAY_CLIENT_ARG = "--terma-display-client";
const LEGACY_DISPLAY_CLIENT_ARG = "--tunneldesk-display-client";
const DISPLAY_CLIENT_URL_ENV = "TERMA_DISPLAY_CLIENT_URL";
const LEGACY_DISPLAY_CLIENT_URL_ENV = "TUNNELDESK_DISPLAY_CLIENT_URL";
const DESKTOP_INTERFACE_LANGUAGE_ENV = "TERMA_INTERFACE_LANGUAGE";
const DESKTOP_TOKEN_ENV = "TERMA_DESKTOP_AUTH_TOKEN";
const LEGACY_DESKTOP_TOKEN_ENV = "TUNNELDESK_DESKTOP_AUTH_TOKEN";
const DISPLAY_CLIENT_AUTH_MESSAGE = "desktop-auth-token";
const DISPLAY_CLIENT_AUTH_TIMEOUT_MS = 10 * 1000;
const LINUX_DISPLAY_SESSION_KEYS = [
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "DBUS_SESSION_BUS_ADDRESS",
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_ID",
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "XDG_SESSION_DESKTOP",
  "DESKTOP_SESSION",
  "GDMSESSION",
  "SESSION_MANAGER"
];
const displayClientMode = process.platform === "linux" && (process.argv.includes(DISPLAY_CLIENT_ARG) || process.argv.includes(LEGACY_DISPLAY_CLIENT_ARG));
let desktopAuthToken = displayClientMode ? "" : crypto.randomBytes(32).toString("base64url");
delete process.env[DESKTOP_TOKEN_ENV];
delete process.env[LEGACY_DESKTOP_TOKEN_ENV];
const localLinuxDisplaySession = captureLinuxDisplaySession();
const localLinuxDisplayKey = linuxDisplaySessionKey(localLinuxDisplaySession);
let displayClientProfileDir = "";
if (displayClientMode) {
  displayClientProfileDir = path.join(app.getPath("temp"), `${PRODUCT_ID}-display-client-${process.pid}`);
  app.setPath("userData", displayClientProfileDir);
  app.setPath("sessionData", displayClientProfileDir);
}
let xServerRuntime = null;
const remoteClientAdapter = displayClientMode ? null : createRemoteClientAdapter({
  getDataDir:()=>DATA_DIR,
  shell,
  getXServerDiagnostics:()=>xServerRuntime?.diagnostics?.() || null,
  getLanguage:()=>desktopInterfaceLanguage
});

let mainWindow = null;
const auxiliaryDesktopWindows = new Set();
const detachedVncWindows = new Map();
let startupWindow = null;
const desktopBrowserAuthorizationPromptGate = createDesktopBrowserAuthorizationPromptGate();
let tray = null;
let webUrl = "";
let quitting = false;
let pendingWindowReveal = false;
let startupRevealScheduled = false;
let desktopStartupInProgress = true;
let pendingDisplayClientUrl = "";
let displayClientAuthRejected = false;
let displayClientAuthTimer = null;
let trayStateTimer = null;
let desktopNotificationTimer = null;
let desktopNotificationCursor = 0;
let desktopNotificationCursorInitialized = false;
let desktopNotificationPreferences = null;
let desktopNotificationPreferencesReadAt = 0;
let desktopInterfaceLanguage = normalizeDesktopNotificationLanguage(process.env[DESKTOP_INTERFACE_LANGUAGE_ENV]);
let trayState = { runningConnections: 0, runningForwards: 0, failedForwards: 0, totalForwards: 0, online: false };
let pendingStorageMigrationNotice = "";
let legacyBrandMigration = { status:"not-checked", source:"", target:"", backup:"", message:"" };
let nativeSftpDrag = null;
let linuxNotificationProbe = { checkedAt: 0, available: false };
const pendingDisplayClientSessions = new Map();
const displayClientProcesses = new Map();
const nativeSftpDragSessions = new Map();
const NATIVE_SFTP_DRAG_SESSION_TIMEOUT_MS = 70 * 60 * 1000;
const NATIVE_SFTP_DRAG_CANCEL_GRACE_MS = 90 * 1000;
const NATIVE_SFTP_DRAG_MAC_COMPLETION_GRACE_MS = 3000;
const NATIVE_SFTP_DRAG_WINDOWS_TARGET_ACK_TIMEOUT_MS = 2000;
const NATIVE_SFTP_DRAG_DEBUG = process.env.TERMA_NATIVE_DRAG_DEBUG === "1" || process.env.TUNNELDESK_NATIVE_DRAG_DEBUG === "1";

const START_IN_TRAY_ARG = "--start-in-tray";
const STORAGE_MIGRATION_VERSION = 2;
const TRANSIENT_DATA_FILES = new Set(["web.pid", "web.url", "web.json", "shutdown.token"]);

const singleInstanceLocked = displayClientMode || app.requestSingleInstanceLock({
  termaDisplaySession: localLinuxDisplaySession
});
if (!singleInstanceLocked) {
  app.exit(0);
}

if (displayClientMode) {
  process.on("message", handleDisplayClientControlMessage);
  process.on("disconnect", () => {
    quitting = true;
    app.quit();
  });
} else {
  app.on("second-instance", handleSecondInstance);
}

function configureWindowsAppIdentity() {
  if (process.platform !== "win32") return;
  app.setAppUserModelId(app.isPackaged ? APP_USER_MODEL_ID : process.execPath);
  if (typeof app.setToastActivatorCLSID === "function") app.setToastActivatorCLSID(TOAST_ACTIVATOR_CLSID);
}

function normalizeLinuxDisplaySession(value = {}) {
  const session = {};
  for (const key of LINUX_DISPLAY_SESSION_KEYS) {
    const item = value && typeof value === "object" ? value[key] : undefined;
    if (typeof item !== "string" || !item || item.includes("\0") || item.length > 8192) continue;
    session[key] = item;
  }
  return session;
}

function captureLinuxDisplaySession(environment = process.env) {
  if (process.platform !== "linux") return {};
  return normalizeLinuxDisplaySession(environment);
}

function linuxDisplaySessionKey(session = {}) {
  const normalized = normalizeLinuxDisplaySession(session);
  const display = String(normalized.DISPLAY || "").trim();
  if (display) return `x11:${display}`;
  const waylandDisplay = String(normalized.WAYLAND_DISPLAY || "").trim();
  if (waylandDisplay) return `wayland:${waylandDisplay}`;
  const sessionId = String(normalized.XDG_SESSION_ID || "").trim();
  return sessionId ? `session:${sessionId}` : "";
}

function displayClientUrl(value = process.env[DISPLAY_CLIENT_URL_ENV] || process.env[LEGACY_DISPLAY_CLIENT_URL_ENV]) {
  try {
    const target = new URL(String(value || "").trim());
    if (target.protocol !== "http:" && target.protocol !== "https:") return "";
    if (target.username || target.password) return "";
    return target.href;
  } catch {
    return "";
  }
}

function displayClientSpawnArguments() {
  const args = process.argv.slice(1).filter(arg => arg !== START_IN_TRAY_ARG && arg !== DISPLAY_CLIENT_ARG && arg !== LEGACY_DISPLAY_CLIENT_ARG);
  return [...args, DISPLAY_CLIENT_ARG];
}

function displayClientEnvironment(session, url) {
  const environment = { ...process.env };
  for (const key of LINUX_DISPLAY_SESSION_KEYS) delete environment[key];
  Object.assign(environment, normalizeLinuxDisplaySession(session));
  environment[DISPLAY_CLIENT_URL_ENV] = url;
  environment[DESKTOP_INTERFACE_LANGUAGE_ENV] = desktopInterfaceLanguage;
  delete environment[DESKTOP_TOKEN_ENV];
  delete environment[LEGACY_DISPLAY_CLIENT_URL_ENV];
  delete environment[LEGACY_DESKTOP_TOKEN_ENV];
  return environment;
}

function normalizeDesktopAuthToken(value) {
  const token = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : "";
}

function deliverDisplayClientAuthToken(child, key = "") {
  const token = normalizeDesktopAuthToken(desktopAuthToken);
  if (!child || child.exitCode !== null || child.killed || typeof child.send !== "function" || !token) return false;
  try {
    child.send({ type:DISPLAY_CLIENT_AUTH_MESSAGE, token }, error => {
      if (!error) return;
      console.error(`${PRODUCT_NAME} display client ${key || "IPC"} authentication failed: ${error.message}`);
      try { child.kill?.(); } catch {}
    });
    return true;
  } catch (error) {
    console.error(`${PRODUCT_NAME} display client ${key || "IPC"} authentication failed: ${error.message}`);
    try { child.kill?.(); } catch {}
    return false;
  }
}

function focusDisplayClientProcess(child) {
  if (!child || child.exitCode !== null || child.killed || typeof child.send !== "function") return false;
  try {
    child.send({ type:"show" });
    return true;
  } catch {
    return false;
  }
}

function launchDisplayClient(session) {
  const normalized = normalizeLinuxDisplaySession(session);
  const key = linuxDisplaySessionKey(normalized);
  if (!key) return false;

  const existing = displayClientProcesses.get(key);
  if (focusDisplayClientProcess(existing)) return true;
  if (existing) displayClientProcesses.delete(key);

  const targetUrl = displayClientUrl(webUrl);
  if (!targetUrl) {
    pendingDisplayClientSessions.set(key, normalized);
    return false;
  }

  let child;
  try {
    child = spawn(process.execPath, displayClientSpawnArguments(), {
      env: displayClientEnvironment(normalized, targetUrl),
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true
    });
  } catch (error) {
    console.error(`failed to open ${PRODUCT_NAME} on ${key}: ${error.message}`);
    return false;
  }
  if (!deliverDisplayClientAuthToken(child, key)) return false;
  displayClientProcesses.set(key, child);
  const forget = () => {
    if (displayClientProcesses.get(key) === child) displayClientProcesses.delete(key);
  };
  child.once?.("error", error => {
    forget();
    console.error(`${PRODUCT_NAME} display client ${key} failed: ${error.message}`);
  });
  child.once?.("exit", forget);
  return true;
}

function requestDisplayClient(session) {
  const normalized = normalizeLinuxDisplaySession(session);
  const key = linuxDisplaySessionKey(normalized);
  if (!key) return false;
  if (!webUrl) {
    pendingDisplayClientSessions.set(key, normalized);
    return true;
  }
  return launchDisplayClient(normalized);
}

function flushPendingDisplayClients() {
  if (!webUrl) return 0;
  const sessions = [...pendingDisplayClientSessions.values()];
  pendingDisplayClientSessions.clear();
  for (const session of sessions) launchDisplayClient(session);
  return sessions.length;
}

function handleSecondInstance(_event, _commandLine, _workingDirectory, additionalData = {}) {
  const requestedSession = normalizeLinuxDisplaySession(additionalData?.termaDisplaySession || additionalData?.tunneldeskDisplaySession);
  const requestedKey = linuxDisplaySessionKey(requestedSession);
  if (process.platform === "linux" && requestedKey && requestedKey !== localLinuxDisplayKey) {
    requestDisplayClient(requestedSession);
    return;
  }
  showWindow();
  notify(desktopUiText(
    `${PRODUCT_NAME} 已在运行，已切换到现有窗口`,
    `${PRODUCT_NAME} is already running; switched to the existing window`
  ));
}

function handleDisplayClientControlMessage(message) {
  if (!message || typeof message !== "object") return;
  if (message.type === DISPLAY_CLIENT_AUTH_MESSAGE) {
    if (!displayClientMode || desktopAuthToken || displayClientAuthRejected) return;
    const token = normalizeDesktopAuthToken(message.token);
    if (!token) {
      displayClientAuthRejected = true;
      if (pendingDisplayClientUrl) failDisplayClientStartup(desktopUiText(
        "显示客户端收到的桌面认证令牌无效，请在当前图形会话中重新启动 Terma。",
        "The display client received an invalid desktop authentication token. Restart Terma in the current graphical session."
      ));
      return;
    }
    desktopAuthToken = token;
    if (pendingDisplayClientUrl) completeDisplayClientStartup();
    return;
  }
  if (message.type === "show") {
    showWindow();
    return;
  }
  if (message.type === "quit") {
    quitting = true;
    app.quit();
  }
}

function cleanupDisplayClientProfile() {
  if (!displayClientMode || !displayClientProfileDir) return;
  try {
    const temporaryRoot = path.resolve(app.getPath("temp"));
    const target = path.resolve(displayClientProfileDir);
    const relative = path.relative(temporaryRoot, target);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      fs.rmSync(target, { recursive:true, force:true });
    }
  } catch {}
}

function removeLegacyElectronShortcut() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const shortcutPaths = [
    path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Electron.lnk"),
    path.join(process.env.PROGRAMDATA || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs", "Electron.lnk")
  ];
  for (const shortcutPath of shortcutPaths) {
    try {
      const bytes = fs.existsSync(shortcutPath) ? fs.readFileSync(shortcutPath) : null;
      if (!bytes) continue;
      const text = bytes.toString("utf16le") + bytes.toString("utf8");
      if (/tunneldesk/i.test(text) && /electron\.exe/i.test(text)) fs.unlinkSync(shortcutPath);
    } catch (error) {
      console.warn(`failed to remove legacy shortcut ${shortcutPath}: ${error.message}`);
    }
  }
}

function legacyBrandUserDataPath() {
  return path.join(app.getPath("appData"), LEGACY_PRODUCT_NAME);
}

function brandMigrationMetadataPath() {
  return path.join(app.getPath("userData"), "brand-migration.json");
}

function readBrandMigrationMetadata() {
  try {
    const value = JSON.parse(fs.readFileSync(brandMigrationMetadataPath(), "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function writeBrandMigrationMetadata(value) {
  const destination = brandMigrationMetadataPath();
  fs.mkdirSync(path.dirname(destination), { recursive:true });
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporary, destination);
  } finally {
    try { fs.rmSync(temporary, { force:true }); } catch {}
  }
}

function legacyBrandAppRunning() {
  try {
    if (process.platform === "win32") {
      return legacyBrandWindowsAppRunning({
        spawnSync,
        currentPid:process.pid,
        currentUserData:app.getPath("userData"),
        legacyUserData:legacyBrandUserDataPath()
      });
    }
    for (const processName of [LEGACY_PRODUCT_NAME, LEGACY_PRODUCT_ID]) {
      const result = spawnSync("pgrep", ["-x", processName], { encoding:"utf8" });
      if (result.status === 0 && Boolean(String(result.stdout || "").trim())) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function brandMigrationRuntimePaths() {
  if (dataPath && sshPath) return { dataDir:dataPath, sshDir:sshPath };
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "desktop-settings.json"), "utf8"));
  } catch {}
  return resolveRuntimePaths({
    ...defaultDesktopSettings(),
    ...(stored && typeof stored === "object" ? stored : {})
  });
}

function inspectLegacyBrandMigration() {
  const source = legacyBrandUserDataPath();
  const targetProfile = app.getPath("userData");
  const runtime = brandMigrationRuntimePaths();
  const target = path.dirname(runtime.dataDir);
  const metadata = readBrandMigrationMetadata();
  const sourceAvailable = source !== targetProfile && runtimeHasPersistentData(path.join(source, "runtime"));
  const targetHasData = runtimeHasPersistentData(target);
  return {
    ...legacyBrandMigration,
    source,
    target,
    target_profile:targetProfile,
    target_data_dir:runtime.dataDir,
    target_ssh_dir:runtime.sshDir,
    source_available:sourceAvailable,
    target_has_data:targetHasData,
    legacy_running:sourceAvailable && legacyBrandAppRunning(),
    completed:Boolean(metadata?.status === "migrated"),
    last_migration:metadata || null
  };
}

function migrateLegacyBrandUserData(options = {}) {
  const source = legacyBrandUserDataPath();
  const targetProfile = app.getPath("userData");
  const runtime = options.target_data_dir && options.target_ssh_dir
    ? { dataDir:path.resolve(options.target_data_dir), sshDir:path.resolve(options.target_ssh_dir) }
    : brandMigrationRuntimePaths();
  const target = path.dirname(runtime.dataDir);
  const result = {
    status:"not-needed",
    source,
    target,
    backup:"",
    message:""
  };
  if (path.resolve(source) === path.resolve(targetProfile) || !runtimeHasPersistentData(path.join(source, "runtime"))) {
    legacyBrandMigration = result;
    return result;
  }
  if (legacyBrandAppRunning()) {
    result.status = "legacy-running";
    result.message = desktopUiText(
      "检测到旧版程序仍在运行。请先退出旧版，再迁移数据。",
      "The legacy application is still running. Quit it before migrating data."
    );
    legacyBrandMigration = result;
    return result;
  }
  const previousMigration = readBrandMigrationMetadata();
  if (!options.manual && previousMigration?.status === "migrated" && Number(previousMigration?.migration_version || 0) >= BRAND_MIGRATION_VERSION) {
    result.status = "already-migrated";
    result.backup = String(previousMigration.backup || "");
    result.message = desktopUiText(
      "旧版数据已经完成合并，可在设置中手动重新检查。",
      "Legacy data has already been merged. You can run the check again manually in Settings."
    );
    legacyBrandMigration = result;
    return result;
  }
  const createdProfileFiles = copyLegacyProfileMissing(source, targetProfile);
  try {
    const migration = mergeLegacyRuntime({
      sourceDataDir:path.join(source, "runtime", "data"),
      sourceSshDir:path.join(source, "runtime", ".ssh"),
      targetDataDir:runtime.dataDir,
      targetSshDir:runtime.sshDir,
      backupParent:targetProfile
    });
    result.backup = migration.backupRoot || "";
    result.summary = migration.summary;
    result.ssh = migration.ssh;
    const metadata = {
      status:"migrated",
      migration_version:BRAND_MIGRATION_VERSION,
      migrated_at:new Date().toISOString(),
      source,
      target,
      target_profile:targetProfile,
      target_data_dir:runtime.dataDir,
      target_ssh_dir:runtime.sshDir,
      backup:result.backup,
      legacy_product:LEGACY_PRODUCT_NAME,
      product:PRODUCT_NAME,
      preserved_legacy_directory:true,
      merged_with_current:true,
      counts:migration.summary,
      ssh:migration.ssh
    };
    let metadataWarning = "";
    try { writeBrandMigrationMetadata(metadata); }
    catch (metadataError) {
      metadataWarning = desktopUiText(
        `（迁移记录写入失败：${metadataError.message || metadataError}）`,
        ` (failed to write the migration record: ${metadataError.message || metadataError})`
      );
    }
    result.status = "migrated";
    result.message = desktopUiText(
      `已将 ${LEGACY_PRODUCT_NAME} 数据合并到 ${PRODUCT_NAME}，当前数据和旧目录都已保留。${metadataWarning}`,
      `${LEGACY_PRODUCT_NAME} data was merged into ${PRODUCT_NAME}. Current data and the legacy directory were both preserved.${metadataWarning}`
    );
    legacyBrandMigration = result;
    return result;
  } catch (error) {
    removeCreatedFiles(createdProfileFiles);
    result.backup = String(error.migrationBackup || "");
    result.status = "failed";
    result.message = desktopUiText(
      `旧版数据合并失败，当前 Terma 数据未被替换：${error.message || error}${result.backup ? `；当前数据备份：${result.backup}` : ""}`,
      `Legacy data could not be merged. Current Terma data was not replaced: ${error.message || error}${result.backup ? `; current data backup: ${result.backup}` : ""}`
    );
    legacyBrandMigration = result;
    return result;
  }
}

function migrateLegacyBrandData(value = {}) {
  const preview = inspectLegacyBrandMigration();
  if (!preview.source_available) return {
    ok:false,
    ...preview,
    error:desktopUiText("未发现可迁移的旧版数据", "No legacy data is available to migrate")
  };
  if (preview.legacy_running) return {
    ok:false,
    ...preview,
    error:desktopUiText("旧版程序仍在运行，请退出后再迁移", "The legacy application is still running; quit it before migrating")
  };
  if (preview.target_has_data && !Boolean(value.merge_current || value.replace_current)) {
    return {
      ok:false,
      ...preview,
      needs_merge_confirmation:true,
      needs_replace_confirmation:true,
      error:desktopUiText(
        "Terma 已有数据，确认后会先完整备份，再合并旧版连接、分组、远程配置、工作区和密钥",
        "Terma already contains data. After confirmation, it will create a complete backup before merging legacy connections, groups, remote profiles, workspaces, and keys."
      )
    };
  }
  setTimeout(async () => {
    quitting = true;
    try { await Promise.resolve(shutdown?.()); } catch (error) { console.error(error); }
    const migrated = migrateLegacyBrandUserData({
      manual:true,
      force:true,
      target_data_dir:preview.target_data_dir,
      target_ssh_dir:preview.target_ssh_dir
    });
    if (migrated.status === "migrated") relaunchInForeground();
    else quitting = false;
    if (migrated.status === "migrated") app.exit(0);
  }, 250);
  return { ok:true, restart_required:true, ...preview };
}

function prepareLegacyBrandMigrationAtStartup(settings, runtime = resolveRuntimePaths(settings)) {
  const source = legacyBrandUserDataPath();
  const targetProfile = app.getPath("userData");
  const target = path.dirname(runtime.dataDir);
  const sourceAvailable = path.resolve(source) !== path.resolve(targetProfile)
    && runtimeHasPersistentData(path.join(source, "runtime"));
  if (!sourceAvailable) {
    legacyBrandMigration = { status:"not-needed", source, target, backup:"", message:"" };
    return legacyBrandMigration;
  }

  const targetHasData = runtimeHasPersistentData(target);
  if (String(settings?.dataMode || "") !== "user" || targetHasData) {
    legacyBrandMigration = {
      status:"available",
      source,
      target,
      backup:"",
      message:String(settings?.dataMode || "") === "user"
        ? desktopUiText(
          "检测到旧版数据；当前用户目录已有数据，请在迁移界面确认后合并。",
          "Legacy data was detected, and the current user directory already contains data. Confirm the merge in the migration view."
        )
        : desktopUiText(
          "检测到旧版数据；当前使用项目或自定义数据目录，请在迁移界面确认后合并。",
          "Legacy data was detected while a project or custom data directory is in use. Confirm the merge in the migration view."
        )
    };
    return legacyBrandMigration;
  }

  return migrateLegacyBrandUserData({
    target_data_dir:runtime.dataDir,
    target_ssh_dir:runtime.sshDir
  });
}

if (!displayClientMode) {
  xServerRuntime = createXServerRuntime({
    appIsPackaged:app.isPackaged,
    resourcesPath:process.resourcesPath,
    projectRoot:path.resolve(__dirname, ".."),
    userDataPath:app.getPath("userData"),
    getLanguage:()=>desktopInterfaceLanguage,
    readClipboardPng:() => {
      const result = readDesktopClipboardImage();
      return result.ok ? result.data : Buffer.alloc(0);
    },
    readClipboardFormats:() => {
      const result = readDesktopClipboardFormats();
      return result.ok
        ? {png:result.png, bmp:result.bmp}
        : {png:Buffer.alloc(0), bmp:Buffer.alloc(0)};
    }
  });
}
configureWindowsAppIdentity();

function iconPath(filename = process.platform === "win32" ? "icon.ico" : "icon.png") {
  return path.join(__dirname, "assets", filename);
}

function loadBackend(settings = prepareRuntimeSettings()) {
  const paths = resolveRuntimePaths(settings);
  dataPath = paths.dataDir;
  sshPath = paths.sshDir;
  process.env.TERMA_DATA_DIR = dataPath;
  process.env.TERMA_SSH_DIR = sshPath;
  ({ startServer, shutdown, parseArgs:parseServerArgs } = require("../dist/server"));
  ({ DATA_DIR, LOG_DIR, PROJECT_SSH_DIR, PID_FILE, WEB_URL_FILE, DEFAULT_HOST, DEFAULT_PORT } = require("../dist/config"));
  ({
    reserveNativeSftpDragTicket,
    deliverNativeSftpDragTicketItem,
    releaseNativeSftpDragTicket
  } = require("../dist/sftp-session"));
  ({
    beginNativeSftpDragJob,
    discardNativeSftpDragJob,
    finishNativeSftpDragJob,
    recordNativeSftpDragBytes,
    setNativeSftpDragCancelHandler,
    waitForSftpTransferStart
  } = require("../dist/sftp-jobs"));
}

function defaultDesktopSettings() {
  return {
    dataMode: app.isPackaged && !isWindowsPortable() ? "user" : "project",
    customDataDir: "",
    interfaceLanguage: desktopSystemSuggestedLanguage(),
    openAtLogin: false,
    minimizeToTray: true,
    startMinimizedToTray: false,
    showStartupNotification: true,
    xServerAutoStart: true
  };
}

function readSettings() {
  try {
    const settings = {
      ...defaultDesktopSettings(),
      ...JSON.parse(fs.readFileSync(SETTINGS_FILE || BOOT_SETTINGS_FILE, "utf8"))
    };
    settings.interfaceLanguage = normalizeDesktopNotificationLanguage(settings.interfaceLanguage);
    return settings;
  } catch {
    return defaultDesktopSettings();
  }
}

function settingsExists() {
  try {
    return fs.existsSync(SETTINGS_FILE || BOOT_SETTINGS_FILE);
  } catch {
    return false;
  }
}

function writeSettings(settings) {
  const settingsFile = SETTINGS_FILE || BOOT_SETTINGS_FILE;
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temporaryFile = `${settingsFile}.tmp-${process.pid || "desktop"}-${Date.now()}`;
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(settings, null, 2), "utf8");
    fs.renameSync(temporaryFile, settingsFile);
  } finally {
    try { fs.rmSync(temporaryFile, { force: true }); } catch {}
  }
}

function initializeDesktopSettingsFile() {
  BOOT_SETTINGS_FILE = path.join(app.getPath("userData"), "desktop-settings.json");
  SETTINGS_FILE = BOOT_SETTINGS_FILE;
  setDesktopInterfaceLanguage(readSettings().interfaceLanguage);
  return SETTINGS_FILE;
}

function ensureDesktopSettingsFile() {
  const firstRun = !settingsExists();
  if (firstRun) writeSettings(defaultDesktopSettings());
  return firstRun;
}

function isWindowsPortable() {
  return app.isPackaged
    && process.platform === "win32"
    && Boolean(String(process.env.PORTABLE_EXECUTABLE_DIR || "").trim());
}

function desktopStartupFailurePresentation(error, context = {}) {
  const text = (chinese, english) => desktopNotificationText(context.language || desktopInterfaceLanguage, chinese, english);
  const rawMessage = String(error?.message || error || text("Terma 启动失败", "Terma failed to start"));
  const platform = String(context.platform || process.platform);
  if (error?.code !== "INSECURE_STORAGE_PERMISSIONS" || platform !== "win32") {
    return {title:text(`${PRODUCT_NAME} 启动失败`, `${PRODUCT_NAME} failed to start`), message:rawMessage};
  }
  const portable = Object.prototype.hasOwnProperty.call(context, "portable")
    ? Boolean(context.portable)
    : isWindowsPortable();
  const dataDirectory = String(context.dataDir || dataPath || error?.path || "").trim();
  const failedPath = String(error?.path || "").trim();
  const detail = String(error?.detail || rawMessage).trim();
  const unsupportedAcl = error?.failure_kind === "unsupported-acl"
    || /does not support|not supported|unsupported|incorrect function|文件系统.*不支持|不支持.*(?:ACL|访问控制)|功能不受支持/i.test(detail);
  const mode = portable ? text("Windows 便携版", "Windows portable edition") : text("Windows 桌面版", "Windows desktop edition");
  const reason = unsupportedAcl
    ? text("当前磁盘或文件系统不支持 Windows ACL（访问控制列表）。", "The current disk or file system does not support Windows ACLs (access control lists).")
    : error?.failure_kind === "access-denied"
      ? text("当前 Windows 账户没有权限收紧该目录的访问控制。", "The current Windows account cannot tighten access control for this directory.")
      : text("Windows 无法为该目录建立并验证仅当前用户可访问的 ACL。", "Windows could not create and verify an ACL that restricts this directory to the current user.");
  const action = portable
    ? text("请将 Terma 便携版整个文件夹移动到本机 NTFS 磁盘后重试。", "Move the entire Terma portable folder to a local NTFS disk, then try again.")
    : text("请改用当前用户目录下的本机 NTFS 路径；如果使用了自定义数据目录，请将它迁移到受支持的位置。", "Use a local NTFS path under the current user profile. If a custom data directory is configured, move it to a supported location.");
  const lines = [
    text(
      "Terma 无法安全使用当前数据目录，因此已停止启动，避免 SSH 密码、私钥信息和远程连接凭据被其他本机用户读取。",
      "Terma stopped before startup because the current data directory cannot be used safely. This prevents other local users from reading SSH passwords, private-key information, or remote-connection credentials."
    ),
    "",
    text(`运行模式：${mode}`, `Run mode: ${mode}`),
    dataDirectory ? text(`数据目录：${dataDirectory}`, `Data directory: ${dataDirectory}`) : "",
    failedPath && path.resolve(failedPath) !== path.resolve(dataDirectory || failedPath)
      ? text(`失败路径：${failedPath}`, `Failed path: ${failedPath}`)
      : "",
    text(`检测结果：${reason}`, `Result: ${reason}`),
    text(`原始原因：${detail}`, `Original reason: ${detail}`),
    "",
    text("处理方法：", "How to resolve this:"),
    `1. ${action}`,
    text(
      "2. 不要把 data 和 .ssh 放在 FAT32、exFAT、部分网络共享或不支持 Windows ACL 的兼容文件系统中。",
      "2. Do not place data or .ssh on FAT32, exFAT, some network shares, or compatibility file systems without Windows ACL support."
    ),
    text(
      "3. 如果该位置本应支持 ACL，请确认当前 Windows 账户对目录拥有完全控制权限。",
      "3. If this location should support ACLs, confirm that the current Windows account has full control of the directory."
    ),
    "",
    text(
      "Terma 没有修改或删除现有连接数据，也不会自动降低安全要求。",
      "Terma did not modify or delete existing connection data, and it will not lower these security requirements automatically."
    )
  ].filter((line, index, values) => line || values[index - 1] !== "");
  return {
    title:text(`${PRODUCT_NAME} 数据目录权限不受支持`, `${PRODUCT_NAME} data-directory permissions are unsupported`),
    message:lines.join("\n")
  };
}

function desktopSystemSuggestedLanguage() {
  try {
    const country = String(app.getLocaleCountryCode?.() || "").toUpperCase();
    if (country) return country === "CN" ? "zh-CN" : "en-US";
    const locale = String(app.getLocale?.() || "").replace(/_/g, "-");
    const region = locale.split("-").find((part, index) => index > 0 && /^[a-z]{2}$/i.test(part));
    if (region) return String(region).toUpperCase() === "CN" ? "zh-CN" : "en-US";
  } catch {}
  return "en-US";
}

function sourceProjectRoot() {
  return path.resolve(__dirname, "..");
}

function userRuntimeRoot() {
  return path.join(app.getPath("userData"), "runtime");
}

function legacyPackagedRoot() {
  return path.dirname(process.execPath);
}

function projectRuntimeRoot() {
  if (isWindowsPortable()) return path.resolve(process.env.PORTABLE_EXECUTABLE_DIR);
  if (!app.isPackaged) return sourceProjectRoot();
  return userRuntimeRoot();
}

function resolveRuntimePaths(settings) {
  const root = settings.dataMode === "custom" && settings.customDataDir
    ? path.resolve(settings.customDataDir)
    : settings.dataMode === "project" && (!app.isPackaged || isWindowsPortable())
      ? projectRuntimeRoot()
      : userRuntimeRoot();
  return {
    dataDir: path.join(root, "data"),
    sshDir: path.join(root, ".ssh")
  };
}

function directoryHasPersistentFiles(directory, ignoredNames = null) {
  if (!fs.existsSync(directory)) return false;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredNames?.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (directoryHasPersistentFiles(fullPath)) return true;
    } else {
      return true;
    }
  }
  return false;
}

function runtimeHasPersistentData(root) {
  return directoryHasPersistentFiles(path.join(root, "data"), TRANSIENT_DATA_FILES)
    || directoryHasPersistentFiles(path.join(root, ".ssh"));
}

function copyRuntimeDirectory(sourceRoot, destinationRoot) {
  const sourceData = path.join(sourceRoot, "data");
  const sourceSsh = path.join(sourceRoot, ".ssh");
  fs.mkdirSync(destinationRoot, { recursive: true });
  if (fs.existsSync(sourceData)) {
    fs.cpSync(sourceData, path.join(destinationRoot, "data"), {
      recursive: true,
      filter: source => {
        const relative = path.relative(sourceData, source);
        if (!relative) return true;
        return !TRANSIENT_DATA_FILES.has(relative.split(path.sep)[0]);
      }
    });
  }
  if (fs.existsSync(sourceSsh)) fs.cpSync(sourceSsh, path.join(destinationRoot, ".ssh"), { recursive: true });
}

function uniqueMigrationPath(parent, prefix) {
  const base = path.join(parent, `${prefix}-${timestampName()}`);
  let candidate = base;
  let suffix = 2;
  while (fs.existsSync(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function migrateLegacyPackagedRuntime(settings) {
  if (!app.isPackaged || isWindowsPortable() || settings.dataMode !== "project") return settings;

  const sourceRoot = legacyPackagedRoot();
  const targetRoot = userRuntimeRoot();
  const sourceHasData = runtimeHasPersistentData(sourceRoot);
  const targetHasData = runtimeHasPersistentData(targetRoot);
  const migratedAt = new Date().toISOString();
  let status = "switched-to-user-runtime";
  let backupRoot = "";

  if (sourceHasData && targetHasData) {
    backupRoot = uniqueMigrationPath(app.getPath("userData"), "migration-conflict-backup");
    try {
      copyRuntimeDirectory(sourceRoot, backupRoot);
    } catch (error) {
      try { fs.rmSync(backupRoot, { recursive: true, force: true }); } catch {}
      throw error;
    }
    status = "conflict-backed-up";
    pendingStorageMigrationNotice = desktopUiText(
      `检测到旧程序目录和用户目录中都有旧版数据。现继续使用用户目录，旧程序数据已完整备份到：${backupRoot}`,
      `Legacy data was found in both the old program directory and the user directory. Terma will continue using the user directory; the old program data was fully backed up to: ${backupRoot}`
    );
  } else if (sourceHasData) {
    const stagingRoot = uniqueMigrationPath(app.getPath("userData"), "runtime-migration-staging");
    try {
      copyRuntimeDirectory(sourceRoot, stagingRoot);
      if (fs.existsSync(targetRoot)) fs.rmSync(targetRoot, { recursive: true, force: true });
      fs.renameSync(stagingRoot, targetRoot);
    } catch (error) {
      try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch {}
      throw error;
    }
    status = "migrated";
    pendingStorageMigrationNotice = desktopUiText(
      `旧版数据已从旧程序目录迁移到用户目录：${targetRoot}。旧目录仍保留，可用于回滚。`,
      `Legacy data was migrated from the old program directory to the user directory: ${targetRoot}. The old directory was preserved for rollback.`
    );
  }

  const migratedSettings = {
    ...settings,
    dataMode: "user",
    storageMigrationVersion: STORAGE_MIGRATION_VERSION,
    lastStorageMigration: {
      status,
      migratedAt,
      sourceRoot,
      targetRoot,
      backupRoot
    }
  };
  writeSettings(migratedSettings);
  return migratedSettings;
}

function validateDesktopStorageTransition(transition) {
  const sourceRoot = desktopStorageRuntimeRoot(resolveRuntimePaths(transition?.source_settings || {}));
  const targetRoot = desktopStorageRuntimeRoot(resolveRuntimePaths(transition?.target_settings || {}));
  if (path.relative(sourceRoot, path.resolve(String(transition?.source_root || ""))) !== ""
    || path.relative(targetRoot, path.resolve(String(transition?.target_root || ""))) !== "") {
    throw new Error(desktopUiText(
      "数据迁移状态与桌面路径设置不一致",
      "The data-migration state does not match the desktop path settings"
    ));
  }
  return transition;
}

function completedDesktopStorageSettings(transition) {
  const completedAt = new Date().toISOString();
  const settings = {
    ...transition.target_settings,
    lastStorageMigration:{
      status:"migrated",
      migratedAt:completedAt,
      sourceRoot:transition.source_root,
      targetRoot:transition.target_root,
      sourcePreserved:true
    }
  };
  delete settings.pendingStorageMigration;
  return settings;
}

function failedDesktopStorageSettings(transition, error) {
  const settings = {
    ...transition.source_settings,
    lastStorageMigration:{
      status:"failed",
      failedAt:new Date().toISOString(),
      sourceRoot:transition.source_root,
      targetRoot:transition.target_root,
      error:String(error?.message || error || desktopUiText("数据迁移失败", "Data migration failed")).slice(0, 500)
    }
  };
  delete settings.pendingStorageMigration;
  return settings;
}

function finishDesktopStorageTransition(transition) {
  validateDesktopStorageTransition(transition);
  completeDesktopStorageTransition(transition, {
    copyRuntimeDirectory,
    ignoredDataEntries:[...TRANSIENT_DATA_FILES]
  });
  const settings = completedDesktopStorageSettings(transition);
  writeSettings(settings);
  finalizeDesktopStorageTransition(transition);
  return settings;
}

function recoverPendingDesktopStorageMigration(settings) {
  const transition = settings?.pendingStorageMigration;
  if (!transition) return settings;
  try {
    const completed = finishDesktopStorageTransition(transition);
    pendingStorageMigrationNotice = desktopUiText(
      `数据已迁移到新路径：${transition.target_root}。原目录仍保留，可用于回退。`,
      `Data was migrated to the new location: ${transition.target_root}. The original directory was preserved for rollback.`
    );
    return completed;
  } catch (error) {
    try { rollbackDesktopStorageTransition(transition); } catch {}
    const rolledBack = failedDesktopStorageSettings(transition, error);
    writeSettings(rolledBack);
    pendingStorageMigrationNotice = desktopUiText(
      `数据路径迁移未完成，Terma 已继续使用原目录：${transition.source_root}。原因：${error.message || error}`,
      `Data-path migration did not complete. Terma will continue using the original directory: ${transition.source_root}. Reason: ${error.message || error}`
    );
    return rolledBack;
  }
}

function prepareRuntimeSettings() {
  const settings = readSettings();
  setDesktopInterfaceLanguage(settings.interfaceLanguage);
  return migrateLegacyPackagedRuntime(recoverPendingDesktopStorageMigration(settings));
}

function applyLoginSetting(settings) {
  if (!app.isPackaged && process.platform !== "darwin") return;
  const loginSettings = {
    openAtLogin: Boolean(settings.openAtLogin),
    path: process.execPath
  };
  if (process.platform === "win32") {
    loginSettings.args = settings.startMinimizedToTray ? [START_IN_TRAY_ARG] : [];
  }
  app.setLoginItemSettings(loginSettings);
}

function shouldStartInTray(settings) {
  if (!settings.startMinimizedToTray) return false;
  if (process.argv.includes(START_IN_TRAY_ARG)) return true;
  if (process.platform !== "darwin") return false;
  try {
    return Boolean(app.getLoginItemSettings().wasOpenedAtLogin);
  } catch {
    return false;
  }
}

function relaunchInForeground() {
  app.relaunch({ args: process.argv.slice(1).filter(arg => arg !== START_IN_TRAY_ARG) });
}

function readWebUrl() {
  try {
    return fs.readFileSync(WEB_URL_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

async function waitForWebUrl(timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const url = readWebUrl();
    if (url) return url;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(desktopUiText(
    `Web 服务已经启动，但 ${WEB_URL_FILE} 未在 ${Math.round(timeoutMs / 1000)} 秒内生成`,
    `The Web service started, but ${WEB_URL_FILE} was not created within ${Math.round(timeoutMs / 1000)} seconds`
  ));
}

function closeStartupWindow() {
  if (!startupWindow || startupWindow.isDestroyed?.()) return;
  try { startupWindow.destroy?.(); } catch {}
  startupWindow = null;
}

function createStartupWindow(settings = readSettings()) {
  if (!app.isPackaged || shouldStartInTray(settings) || startupWindow) return null;
  const language = normalizeDesktopNotificationLanguage(settings.interfaceLanguage || desktopInterfaceLanguage);
  const startupTitle = desktopNotificationText(language, `${PRODUCT_NAME} 正在启动`, `${PRODUCT_NAME} is starting`);
  const startupMessage = desktopNotificationText(language, "正在准备服务与工作区...", "Preparing services and workspace...");
  const window = startupWindow = new BrowserWindow({
    width:360,
    height:156,
    minWidth:360,
    minHeight:156,
    maxWidth:360,
    maxHeight:156,
    frame:false,
    resizable:false,
    show:false,
    alwaysOnTop:true,
    skipTaskbar:false,
    center:true,
    title:startupTitle,
    icon:iconPath(),
    backgroundColor:"#f4f6f8",
    webPreferences:{contextIsolation:true, nodeIntegration:false}
  });
  const html = `<!doctype html><meta charset="utf-8"><title>${startupTitle}</title><style>html,body{width:100%;height:100%;margin:0}body{box-sizing:border-box;display:grid;grid-template-columns:48px minmax(0,1fr);align-items:center;gap:16px;padding:28px 30px;color:#18212b;background:#f4f6f8;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}.mark{width:44px;height:44px;display:grid;place-items:center;border-radius:8px;color:#fff;background:#111827;font-size:20px;font-weight:700}.copy{min-width:0;display:grid;gap:7px}.copy strong,.copy span{min-width:0;overflow-wrap:anywhere}.copy strong{font-size:18px;line-height:1.2;letter-spacing:0}.copy span{color:#5f6b78;font-size:12px;line-height:1.35;letter-spacing:0}.line{height:3px;overflow:hidden;border-radius:2px;background:#d8dee6}.line i{display:block;width:42%;height:100%;background:#16825f;animation:load 1.1s ease-in-out infinite}@keyframes load{from{transform:translateX(-110%)}to{transform:translateX(250%)}}@media(prefers-color-scheme:dark){body{color:#eef2f6;background:#17202a}.mark{background:#0b1016}.copy span{color:#a6b0bb}.line{background:#34404c}}</style><div class="mark">T</div><div class="copy"><strong>${startupTitle}</strong><span>${startupMessage}</span><div class="line"><i></i></div></div>`;
  let revealed = false;
  const reveal = () => {
    if (revealed || startupWindow !== window || window.isDestroyed?.()) return;
    revealed = true;
    window.show();
  };
  window.once("ready-to-show", reveal);
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  window.once("closed", () => { if (startupWindow === window) startupWindow = null; });
  return window;
}

function createWindow(options = {}) {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    title: PRODUCT_NAME,
    icon: iconPath(),
    show: false,
    backgroundColor: "#f4f6f8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.js")
    }
  });
  if (process.platform === "win32") {
    mainWindow.setAppDetails({
      appId: APP_USER_MODEL_ID,
      appIconPath: iconPath("icon.ico"),
      appIconIndex: 0,
      relaunchDisplayName: PRODUCT_NAME
    });
  }
  if (options.openDesktopSettings) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow.webContents.executeJavaScript('openSettingsSection("settings-runtime")').catch(() => {});
    });
  }
  mainWindow.once("ready-to-show", () => {
    closeStartupWindow();
    if (options.displayClient) {
      pendingWindowReveal = false;
      startupRevealScheduled = false;
      bringMainWindowToFront();
      return;
    }
    const settings = readSettings();
    // A second launch can arrive while the first instance is still starting.
    // Do not hide the window for tray startup when that launch explicitly
    // asked us to reveal the existing instance.
    const revealRequested = pendingWindowReveal || startupRevealScheduled;
    pendingWindowReveal = false;
    startupRevealScheduled = false;
    if (shouldStartInTray(settings) && !revealRequested) mainWindow.hide();
    else bringMainWindowToFront();
  });
  mainWindow.webContents.once?.("did-finish-load", () => {
    closeStartupWindow();
    if (options.displayClient) {
      if (startupRevealScheduled) return;
      startupRevealScheduled = true;
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        pendingWindowReveal = false;
        startupRevealScheduled = false;
        bringMainWindowToFront();
      }, 120);
      return;
    }
    // macOS can occasionally skip ready-to-show for a hidden Electron
    // window launched from Finder or `open`. Reveal a normal manual launch
    // after the page is ready so the app cannot remain menu-bar-only.
    if (process.platform === "darwin" && !shouldStartInTray(readSettings()) && !startupRevealScheduled) {
      startupRevealScheduled = true;
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed() || !startupRevealScheduled) return;
        pendingWindowReveal = false;
        startupRevealScheduled = false;
        bringMainWindowToFront();
      }, 120);
      return;
    }
    if (!pendingWindowReveal || startupRevealScheduled) return;
    startupRevealScheduled = true;
    // Some Linux window managers never emit ready-to-show for an X11
    // renderer that was initially created hidden. Reveal after the page is
    // loaded so a second launch cannot remain stuck behind the notification.
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || !pendingWindowReveal) return;
      pendingWindowReveal = false;
      startupRevealScheduled = false;
      bringMainWindowToFront();
    }, 120);
  });
  loadWindowWithDesktopCookie(mainWindow).catch(error => {
    console.warn(`failed to install desktop authorization cookie: ${error.message}`);
    try { mainWindow.loadURL(webUrl); } catch {}
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|ftp|ssh|telnet):\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  const renderer = mainWindow.webContents;
  renderer.on?.("will-navigate", (event, url) => {
    if (urlBelongsToDesktop(url)) return;
    event.preventDefault();
    if (/^(https?|ftp|ssh|telnet):\/\//i.test(url)) shell.openExternal(url);
  });
  renderer.on?.("render-process-gone", () => cancelNativeSftpDragSessionsForSender(renderer, desktopUiText(
    "界面进程已结束，拖出任务已取消",
    "The renderer process ended; the drag-out task was cancelled"
  )));
  renderer.once?.("destroyed", () => cancelNativeSftpDragSessionsForSender(renderer, desktopUiText(
    "界面已关闭，拖出任务已取消",
    "The window closed; the drag-out task was cancelled"
  )));
  mainWindow.on("close", event => {
    if (options.displayClient) return;
    if (quitting || !readSettings().minimizeToTray) return;
    event.preventDefault();
    mainWindow.hide();
  });
  if (options.displayClient) {
    mainWindow.once("closed", () => {
      mainWindow = null;
      quitting = true;
      app.quit();
    });
  }
}

function desktopWindowForSender(event) {
  const sender = event?.sender;
  if (!sender || sender.isDestroyed?.()) return null;
  if (mainWindow && !mainWindow.isDestroyed() && sender === mainWindow.webContents) return mainWindow;
  for (const window of auxiliaryDesktopWindows) {
    if (!window.isDestroyed() && sender === window.webContents) return window;
  }
  return null;
}

function sanitizeAuxiliaryWindowTitle(value, fallback = PRODUCT_NAME) {
  const title = String(value || "").replace(/[\0\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
  return title || fallback;
}

function configureAuxiliaryDesktopWindow(window) {
  if (!window || window.isDestroyed()) return;
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|ftp|ssh|telnet):\/\//i.test(url)) shell.openExternal(url);
    return {action:"deny"};
  });
  window.webContents.on?.("will-navigate", (event, url) => {
    if (urlBelongsToDesktop(url)) return;
    event.preventDefault();
    if (/^(https?|ftp|ssh|telnet):\/\//i.test(url)) shell.openExternal(url);
  });
  window.webContents.on?.("render-process-gone", () => cancelNativeSftpDragSessionsForSender(window.webContents, desktopUiText(
    "VNC 窗口进程已结束，拖出任务已取消",
    "The VNC window renderer ended; the drag-out task was cancelled"
  )));
  window.once("closed", () => auxiliaryDesktopWindows.delete(window));
}

function activeDetachedVncWindow(profileId) {
  const id = Number(profileId);
  const window = detachedVncWindows.get(id);
  if (!window || window.isDestroyed()) {
    detachedVncWindows.delete(id);
    return null;
  }
  return window;
}

function closeDetachedVncWindowForProfile(profileId) {
  const id = Number(profileId);
  if (!Number.isInteger(id) || id <= 0) throw new Error(desktopUiText("VNC 连接编号无效", "The VNC profile ID is invalid"));
  const window = activeDetachedVncWindow(id);
  if (!window) return Promise.resolve({ok:true, profileId:id, closed:false});
  return new Promise(resolve => {
    window.once("closed", () => resolve({ok:true, profileId:id, closed:true}));
    window.close();
  });
}

async function createDetachedVncWindow(profileId) {
  const id = Number(profileId);
  if (!Number.isInteger(id) || id <= 0) throw new Error(desktopUiText("VNC 连接编号无效", "The VNC profile ID is invalid"));
  const profiles = await fetchJson("/api/remote-profiles");
  const profile = Array.isArray(profiles) ? profiles.find(item => Number(item?.id) === id) : null;
  if (!profile || profile.protocol !== "vnc") throw new Error(desktopUiText("VNC 连接不存在", "The VNC profile does not exist"));
  const existing = activeDetachedVncWindow(id);
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    if (!existing.isVisible()) existing.show();
    existing.focus();
    return {ok:true, profileId:id, reused:true};
  }
  const title = sanitizeAuxiliaryWindowTitle(`${profile.name || `VNC ${id}`}-vnc-${PRODUCT_NAME}`, `${PRODUCT_NAME}-vnc-${id}`);
  const window = new BrowserWindow({
    width:1280,
    height:820,
    minWidth:720,
    minHeight:480,
    title,
    icon:iconPath(),
    show:false,
    backgroundColor:"#111",
    webPreferences:{contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,"preload.js")}
  });
  auxiliaryDesktopWindows.add(window);
  detachedVncWindows.set(id, window);
  window.once("closed", () => {
    if (detachedVncWindows.get(id) === window) detachedVncWindows.delete(id);
  });
  if (process.platform === "win32") {
    window.setAppDetails({appId:APP_USER_MODEL_ID,appIconPath:iconPath("icon.ico"),appIconIndex:0,relaunchDisplayName:PRODUCT_NAME});
  }
  configureAuxiliaryDesktopWindow(window);
  window.on("page-title-updated", event => {
    event.preventDefault();
    if (!window.isDestroyed()) window.setTitle(title);
  });
  window.webContents.on("did-finish-load", () => { if (!window.isDestroyed()) window.setTitle(title); });
  window.once("ready-to-show", () => { if (!window.isDestroyed()) window.show(); });
  const target = new URL(webUrl);
  target.searchParams.set("termaVncWindow", String(id));
  try {
    await loadWindowWithDesktopCookie(window, target.href);
  } catch (error) {
    auxiliaryDesktopWindows.delete(window);
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
  return {ok:true, profileId:id, reused:false};
}

function applyDesktopTheme(theme) {
  if (theme !== "dark" && theme !== "light") return;
  nativeTheme.themeSource = theme;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(theme === "dark" ? "#1e1e1e" : "#f4f6f8");
  }
}

function urlBelongsToDesktop(value) {
  try {
    return Boolean(webUrl) && new URL(String(value || "")).origin === new URL(webUrl).origin;
  } catch {
    return false;
  }
}

async function confirmDesktopBrowserAuthorization(request = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  await readDesktopNotificationPreferences(true).catch(() => null);
  const scopes = Array.isArray(request.scopes) ? request.scopes : [];
  const durationMode = request.duration_mode === "browser-session" ? "browser-session" : "timed";
  const durationMinutes = Math.max(1, Math.min(480, Number(request.duration_minutes) || 10));
  const durationLabel = durationMode === "browser-session"
    ? desktopUiText("本次浏览器会话（最长 12 小时）", "this browser session (up to 12 hours)")
    : desktopUiText(`${durationMinutes} 分钟`, `${durationMinutes} minutes`);
  const labels = [];
  if (scopes.includes("xserver")) labels.push(desktopUiText(
    "管理 X Server 与本机图形组件",
    "Manage the X Server and local graphical components"
  ));
  if (scopes.includes("remote-client")) labels.push(desktopUiText(
    "调用系统 RDP、VNC 与 XDMCP 客户端",
    "Launch system RDP, VNC, and XDMCP clients"
  ));
  const fallbackScope = desktopUiText("桌面图形集成", "Desktop graphical integration");
  const allowLabel = durationMode === "browser-session"
    ? desktopUiText("允许本次会话", "Allow this session")
    : desktopUiText(`允许 ${durationMinutes} 分钟`, `Allow for ${durationMinutes} minutes`);
  return desktopBrowserAuthorizationPromptGate.request(() => dialog.showMessageBox(mainWindow, {
    type:"question",
    title:desktopUiText("浏览器请求桌面集成", "Browser requests desktop integration"),
    message:desktopUiText(
      `是否允许当前本机浏览器在${durationLabel}内使用 Terma 桌面集成？`,
      `Allow the current local browser to use Terma desktop integration for ${durationLabel}?`
    ),
    detail:desktopUiText(
      `授权范围：\n${labels.length ? labels.map(label => `• ${label}`).join("\n") : `• ${fallbackScope}`}\n\n撤销或授权到期会关闭由该授权开启的 X11 终端；不会开放本地文件、数据目录、更新包或迁移能力。`,
      `Authorization scope:\n${labels.length ? labels.map(label => `• ${label}`).join("\n") : `• ${fallbackScope}`}\n\nRevoking or expiring this authorization closes X11 terminals opened by it. It does not grant access to local files, the data directory, update packages, or migration capabilities.`
    ),
    buttons:[desktopUiText("拒绝", "Deny"), allowLabel],
    defaultId:0,
    cancelId:0,
    noLink:true
  }).then(result => result.response === 1));
}

async function loadWindowWithDesktopCookie(window, targetUrl=webUrl) {
  if (!window || window.isDestroyed()) return;
  if (!String(targetUrl || "").trim()) return;
  if (desktopAuthToken) {
    const target = new URL(targetUrl);
    await window.webContents.session.cookies.set({
      url:`${target.origin}/`,
      name:"td_desktop",
      value:desktopAuthToken,
      path:"/",
      httpOnly:true,
      sameSite:"strict",
      secure:target.protocol === "https:"
    });
  }
  if (!window.isDestroyed()) await window.loadURL(targetUrl);
}

function rendererBelongsToDesktop(event) {
  return urlBelongsToDesktop(event.senderFrame?.url || event.sender?.getURL?.() || "");
}

function handleDesktopTheme(event, theme) {
  if (!rendererBelongsToDesktop(event)) return;
  applyDesktopTheme(theme);
}

function handleDesktopInterfaceLanguage(event, language) {
  if (!rendererBelongsToDesktop(event) || !["zh-CN", "en-US"].includes(String(language || ""))) return;
  setDesktopInterfaceLanguage(language, true);
  desktopNotificationPreferencesReadAt = 0;
}

function handleDesktopCapabilities(event) {
  const sourceWindow = desktopWindowForSender(event);
  const allowed = Boolean(sourceWindow && rendererBelongsToDesktop(event));
  event.returnValue = allowed
    ? displayClientMode
      ? {platform:process.platform, sftpExternalDrag:false, displayClient:true}
      : sourceWindow !== mainWindow
        ? {platform:process.platform, sftpExternalDrag:false, detachedVnc:true}
        : nativeSftpDrag?.capabilities?.() || {platform:process.platform, sftpExternalDrag:"staged"}
    : {platform:process.platform, sftpExternalDrag:false};
}

function sendSftpDragResult(event, requestId, ok, message="") {
  if (!event.sender.isDestroyed()) event.sender.send("terma:sftp-drag-result", {requestId, ok, message});
}

function sendSftpDragEvent(session, payload) {
  if (!session?.sender || session.sender.isDestroyed()) return;
  session.sender.send("terma:sftp-drag-event", {
    ...payload,
    requestId:session.requestId
  });
}

function normalizedNativeSftpDragEntries(payload) {
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  if (!entries.length || entries.length > 100) throw new Error(desktopUiText(
    "一次最多拖出 100 个文件或目录",
    "You can drag out at most 100 files or directories at a time"
  ));
  const unique = new Map();
  for (const entry of entries) {
    const remotePath = String(entry?.path || "").replace(/\\/g, "/");
    if (!remotePath || remotePath.includes("\0") || remotePath.length > 4096) throw new Error(desktopUiText(
      "拖出的远端路径无效",
      "The remote drag-out path is invalid"
    ));
    unique.set(remotePath, {
      path:remotePath,
      name:String(entry?.name || path.posix.basename(remotePath) || "download").slice(0, 512),
      type:entry?.type === "dir" || entry?.type === "directory" ? "directory" : "file",
      size:Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(entry?.size || 0))),
      mtime:Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(entry?.mtime || 0))),
      metadataKnown:Boolean(entry?.metadataKnown)
    });
  }
  return [...unique.values()];
}

function nativeDragClientPoint(nativeEvent) {
  if (Number.isFinite(nativeEvent?.clientX) && Number.isFinite(nativeEvent?.clientY)) {
    return {clientX:Number(nativeEvent.clientX), clientY:Number(nativeEvent.clientY)};
  }
  if (!Number.isFinite(nativeEvent?.screenX) || !Number.isFinite(nativeEvent?.screenY) || !mainWindow) return {};
  let point = {x:Number(nativeEvent.screenX), y:Number(nativeEvent.screenY)};
  try {
    if (process.platform === "win32" && typeof screen?.screenToDipPoint === "function") point = screen.screenToDipPoint(point);
  } catch {}
  try {
    const bounds = mainWindow.getContentBounds();
    const zoomFactor = Math.max(0.25, Number(mainWindow.webContents?.getZoomFactor?.() || 1));
    return {clientX:(point.x - bounds.x) / zoomFactor, clientY:(point.y - bounds.y) / zoomFactor};
  } catch {
    return {};
  }
}

function safeNativeSftpTarget(value, session) {
  if (!value || typeof value !== "object") return null;
  const id = Number(value.id);
  const tabKey = String(value.tabKey || "").slice(0, 256);
  const kind = value.kind === "terminal" ? "terminal" : value.kind === "local-files" ? "local-files" : "sftp";
  const targetPath = kind === "local-files"
    ? String(value.path || "").slice(0, 4096)
    : String(value.path || ".").replace(/\\/g, "/").slice(0, 4096);
  if ((kind !== "local-files" && (!Number.isInteger(id) || id <= 0)) || !tabKey || tabKey === session.sourceTabKey) return null;
  return {
    id:kind === "local-files" ? 1 : id,
    tabKey,
    path:targetPath || ".",
    title:String(value.title || (kind === "terminal"
      ? desktopUiText("终端", "Terminal")
      : kind === "local-files"
        ? desktopUiText("本地文件", "Local Files")
        : "SFTP")).slice(0, 256),
    kind
  };
}

function releaseNativeDragSession(session, options={}) {
  if (!session || session.released) return;
  if (session.pendingWrites > 0 && !session.abortController?.signal?.aborted) {
    try { session.abortController?.abort(); } catch {}
  }
  session.released = true;
  if (session.expiryTimer) clearTimeout(session.expiryTimer);
  if (session.cancelTimer) clearTimeout(session.cancelTimer);
  if (session.macCompletionTimer) clearTimeout(session.macCompletionTimer);
  if (session.windowsTargetTimer) clearTimeout(session.windowsTargetTimer);
  nativeSftpDragSessions.delete(session.requestId);
  if (!session.nativeOwnsTicket || options.forceTicketRelease) {
    try { releaseNativeSftpDragTicket?.(session.token); } catch {}
  }
}

function maybeFinishNativeDragSession(session) {
  if (!session?.terminalEvent || session.resultSent) return;
  const terminal = session.terminalEvent;
  // AppKit reports `ended` before Finder has finished consuming File Promise
  // contents. Once cancellation is accepted, wait for the native `cancelled`
  // event (or the long fallback timer) instead of turning the partial write
  // into a successful drag result.
  if (session.cancelling && terminal.type === "ended") return;
  const internalTarget = session.internalTarget;
  const isMacExternalDrop = process.platform === "darwin"
    && !internalTarget
    && terminal.type === "ended"
    && !["none", "unknown"].includes(String(terminal.operation || ""));
  if (session.pendingWrites > 0) return;
  if (isMacExternalDrop && session.completedItemIds.size < session.expectedWrites) return;
  if (isMacExternalDrop && !session.macCompletionGraceElapsed) {
    if (!session.macCompletionTimer) {
      session.macCompletionTimer = setTimeout(() => {
        session.macCompletionTimer = null;
        session.macCompletionGraceElapsed = true;
        maybeFinishNativeDragSession(session);
      }, NATIVE_SFTP_DRAG_MAC_COMPLETION_GRACE_MS);
    }
    return;
  }
  if (process.platform === "win32" && !session.windowsReleaseAcknowledged) {
    if (!session.windowsTargetTimer) {
      session.windowsTargetTimer = setTimeout(() => {
        session.windowsTargetTimer = null;
        session.windowsReleaseAcknowledged = true;
        maybeFinishNativeDragSession(session);
      }, NATIVE_SFTP_DRAG_WINDOWS_TARGET_ACK_TIMEOUT_MS);
    }
    return;
  }

  session.resultSent = true;
  const ok = Boolean(internalTarget)
    || terminal.type === "completed"
    || (terminal.type === "ended" && !["none", "unknown"].includes(String(terminal.operation || "")));
  const contentError = session.contentErrors.at(-1) || "";
  let cancelled = terminal.type === "cancelled" || terminal.operation === "none";
  let message = internalTarget
    ? ""
    : session.writeError
      || contentError
      || (cancelled ? desktopUiText("已取消拖出", "Drag-out cancelled") : terminal.message)
      || (ok ? "" : desktopUiText("无法完成系统拖放", "Could not complete the system drag-and-drop operation"));
  let succeeded = Boolean(internalTarget) || (ok && !session.writeError && !contentError);
  if (internalTarget) {
    try {
      discardNativeSftpDragJob?.(session.token);
    } catch (error) {
      console.warn("Failed to discard internal SFTP drag task:", error);
    }
  } else {
    try {
      const outcome = finishNativeSftpDragJob?.(
        session.token,
        cancelled ? "cancelled" : succeeded ? "done" : "failed",
        message
      );
      if (outcome?.status === "cancelled") {
        cancelled = true;
        succeeded = false;
        message = terminal.type === "completed"
          ? desktopUiText("拖出未完成", "Drag-out did not complete")
          : desktopUiText("已取消拖出", "Drag-out cancelled");
      } else if (outcome?.status === "failed") {
        succeeded = false;
        message ||= desktopUiText("拖出下载失败", "Drag-out download failed");
      }
    } catch (error) {
      console.warn("Failed to finish SFTP native drag task:", error);
    }
  }
  if (!session.sender.isDestroyed()) {
    session.sender.send("terma:sftp-drag-result", {
      requestId:session.requestId,
      ok:succeeded,
      message,
      internalTarget,
      renamedItems:[...session.renamedItems.values()]
    });
  }
  releaseNativeDragSession(session, {forceTicketRelease:process.platform === "linux"});
}

async function handleNativeSftpWriteRequest(session, nativeEvent) {
  if (!session || typeof deliverNativeSftpDragTicketItem !== "function") {
    nativeSftpDrag?.completeWrite?.(nativeEvent.requestId, desktopUiText(
      "桌面后端不支持按项目写入",
      "The desktop backend does not support per-item writes"
    ));
    return;
  }
  session.pendingWrites += 1;
  if (!session.nativeJobStarted) {
    try {
      const task = beginNativeSftpDragJob?.(session.token, session.ticket);
      session.nativeJobStarted = Boolean(task?.id);
      if (session.nativeJobStarted) {
        session.nativeJobStartPromise = Promise.resolve(waitForSftpTransferStart?.(task.id)).then(() => {
          sendSftpDragEvent(session, {type:"transferStarted"});
        });
      }
    } catch (error) {
      console.warn("Failed to start macOS SFTP native drag task:", error);
    }
  }
  if (session.nativeJobStartPromise) await session.nativeJobStartPromise;
  const itemId = String(nativeEvent.itemId || "");
  const targetPath = String(nativeEvent.targetPath || "");
  const deliveryKey = `${itemId}\0${targetPath}`;
  if (session.macCompletionTimer) clearTimeout(session.macCompletionTimer);
  session.macCompletionTimer = null;
  session.macCompletionGraceElapsed = false;
  try {
    let delivery = session.inflightDeliveries.get(deliveryKey);
    if (!session.completedDeliveries.has(deliveryKey) && !delivery) {
      delivery = deliverNativeSftpDragTicketItem(
        session.token,
        itemId,
        targetPath,
        String(nativeEvent.targetDirectory || ""),
        {
          signal:session.abortController?.signal || null,
          onProgress:bytes => recordNativeSftpDragBytes?.(session.token, bytes)
        }
      ).then((result) => {
        if (result?.renamed) {
          session.renamedItems.set(itemId, {
            promisedName:String(result.promised_name || ""),
            savedName:String(result.name || "")
          });
        }
        session.completedDeliveries.add(deliveryKey);
      }).finally(() => {
        if (session.inflightDeliveries.get(deliveryKey) === delivery) {
          session.inflightDeliveries.delete(deliveryKey);
        }
      });
      session.inflightDeliveries.set(deliveryKey, delivery);
    }
    if (delivery) await delivery;
    session.completedItemIds.add(itemId);
    session.completedWrites = session.completedItemIds.size;
    nativeSftpDrag?.completeWrite?.(nativeEvent.requestId, null);
  } catch (error) {
    const message = error?.message || String(error);
    const cancelled = session.cancelling
      && (error?.code === "SFTP_NATIVE_DRAG_CANCELLED" || error?.name === "AbortError" || error?.cancelled);
    if (!cancelled) {
      session.completedItemIds.add(itemId);
      session.completedWrites = session.completedItemIds.size;
      session.writeError ||= message;
    }
    nativeSftpDrag?.completeWrite?.(nativeEvent.requestId, cancelled ? null : message);
  } finally {
    session.pendingWrites = Math.max(0, session.pendingWrites - 1);
    maybeFinishNativeDragSession(session);
  }
}

function handleNativeSftpDragEvent(session, nativeEvent) {
  if (!session || session.released || !nativeEvent || typeof nativeEvent !== "object") return;
  if (NATIVE_SFTP_DRAG_DEBUG) {
    console.log("[native-sftp-drag] event", JSON.stringify({
      requestId:session.requestId,
      type:nativeEvent.type,
      message:nativeEvent.message || "",
      hresult:nativeEvent.hresult
    }));
  }
  if (nativeEvent.type === "consuming") {
    session.consuming = true;
    return;
  }
  if (nativeEvent.type === "contentComplete") {
    session.contentComplete = true;
    return;
  }
  if (nativeEvent.type === "motion" || nativeEvent.type === "started" || nativeEvent.type === "preparing" || nativeEvent.type === "ready" || nativeEvent.type === "released") {
    if (nativeEvent.type === "started") {
      session.nativeStarted = true;
      // The Linux helper owns ticket cleanup only after its FUSE mount is
      // ready. Startup failures before this event must still be released by
      // the desktop process.
      if (process.platform === "linux") session.nativeOwnsTicket = true;
    }
    if (nativeEvent.type === "released") session.uiReleased = true;
    sendSftpDragEvent(session, {
      type:nativeEvent.type,
      screenX:nativeEvent.screenX,
      screenY:nativeEvent.screenY,
      ...nativeDragClientPoint(nativeEvent)
    });
    if (process.platform !== "linux" && nativeEvent.type === "ready" && session.activated && !session.nativeStarted) {
      setImmediate(() => {
        if (session.released || session.terminalEvent || session.nativeStarted) return;
        try {
          const started = nativeSftpDrag?.activate?.(session.nativeId || session.requestId);
          if (NATIVE_SFTP_DRAG_DEBUG) {
            console.log("[native-sftp-drag] ready activation", JSON.stringify({requestId:session.requestId, started:Boolean(started)}));
          }
        } catch (error) {
          if (NATIVE_SFTP_DRAG_DEBUG) console.warn("[native-sftp-drag] ready activation failed", error);
        }
      });
    }
    return;
  }
  if (nativeEvent.type === "contentError") {
    session.contentErrors.push(String(nativeEvent.message || desktopUiText(
      "SFTP 拖出文件读取失败",
      "Failed to read a file for SFTP drag-out"
    )));
    console.warn("SFTP native drag content error:", nativeEvent.message || nativeEvent);
    return;
  }
  if (nativeEvent.type === "writeRequested") {
    void handleNativeSftpWriteRequest(session, nativeEvent);
    return;
  }
  if (nativeEvent.type === "ended" && nativeEvent.internalTargetJson) {
    try {
      session.internalTarget = safeNativeSftpTarget(JSON.parse(nativeEvent.internalTargetJson), session);
    } catch {}
  }
  if (nativeEvent.type === "ended" && !session.uiReleased) {
    session.uiReleased = true;
    sendSftpDragEvent(session, {
      type:"released",
      screenX:nativeEvent.screenX,
      screenY:nativeEvent.screenY,
      ...nativeDragClientPoint(nativeEvent)
    });
  }
  if (["completed", "cancelled", "ended", "error", "terminalError"].includes(nativeEvent.type)) {
    if (session.terminalEvent?.type === "cancelled" && nativeEvent.type === "ended") return;
    session.terminalEvent = nativeEvent;
    maybeFinishNativeDragSession(session);
  }
}

function handleSftpDragActivate(event, payload) {
  if (!rendererBelongsToDesktop(event) || !mainWindow || event.sender !== mainWindow.webContents) return;
  const session = nativeSftpDragSessions.get(String(payload?.requestId || ""));
  if (!session || session.sender !== event.sender || session.terminalEvent) return;
  session.activated = true;
  if (session.nativeId) {
    try {
      const started = nativeSftpDrag?.activate?.(session.nativeId);
      if (NATIVE_SFTP_DRAG_DEBUG) {
        console.log("[native-sftp-drag] activate", JSON.stringify({requestId:session.requestId, started:Boolean(started)}));
      }
    } catch (error) {
      if (NATIVE_SFTP_DRAG_DEBUG) console.warn("[native-sftp-drag] activate failed", error);
    }
  }
}

function handleSftpDragTarget(event, payload) {
  if (!rendererBelongsToDesktop(event) || !mainWindow || event.sender !== mainWindow.webContents) return;
  const session = nativeSftpDragSessions.get(String(payload?.requestId || ""));
  if (!session || session.sender !== event.sender) return;
  session.internalTarget = safeNativeSftpTarget(payload?.target, session);
  try { nativeSftpDrag?.setInternalTarget?.(session.nativeId || session.requestId, session.internalTarget); } catch {}
  if (payload?.final) {
    session.windowsReleaseAcknowledged = true;
    if (session.windowsTargetTimer) clearTimeout(session.windowsTargetTimer);
    session.windowsTargetTimer = null;
    maybeFinishNativeDragSession(session);
  }
}

function handleSftpDragCancel(event, payload) {
  if (!rendererBelongsToDesktop(event) || !mainWindow || event.sender !== mainWindow.webContents) return;
  const session = nativeSftpDragSessions.get(String(payload?.requestId || ""));
  if (!session || session.sender !== event.sender || !nativeSftpDragSessionCanCancel(session)) return;
  session.cancelling = true;
  let cancellationAccepted = false;
  try {
    cancellationAccepted = Boolean(nativeSftpDrag?.cancel?.(session.nativeId || session.requestId));
  } catch (error) {
    console.warn("SFTP native drag cancellation failed:", error);
  }
  if (!cancellationAccepted) {
    // macOS cannot cancel an NSDraggingSession after AppKit has taken ownership.
    // Keep the ticket and wait for the real terminal callback instead of
    // fabricating a cancellation while Finder may still request file content.
    session.cancelling = false;
    return;
  }
  session.abortController?.abort();
  scheduleNativeSftpDragCancelFallback(session, desktopUiText("已取消拖出", "Drag-out cancelled"));
}

function nativeSftpDragSessionCanCancel(session) {
  if (!session || session.released || session.resultSent) return false;
  if (!session.terminalEvent) return true;
  return process.platform === "darwin" && session.terminalEvent.type === "ended";
}

function scheduleNativeSftpDragCancelFallback(session, message) {
  if (!session || session.released || !nativeSftpDragSessionCanCancel(session)) return;
  if (session.cancelTimer) clearTimeout(session.cancelTimer);
  session.cancelTimer = setTimeout(() => {
    if (session.released || session.resultSent) return;
    if (session.terminalEvent && !(process.platform === "darwin" && session.terminalEvent.type === "ended")) return;
    session.terminalEvent = {
      type:"cancelled",
      message:String(message || desktopUiText("已取消拖出", "Drag-out cancelled"))
    };
    session.expectedWrites = session.completedItemIds.size;
    maybeFinishNativeDragSession(session);
  }, NATIVE_SFTP_DRAG_CANCEL_GRACE_MS);
}

function cancelNativeSftpDragSessionsForSender(sender, message) {
  for (const session of [...nativeSftpDragSessions.values()]) {
    if (session.sender !== sender || !nativeSftpDragSessionCanCancel(session)) continue;
    session.cancelling = true;
    let accepted = false;
    try {
      accepted = Boolean(nativeSftpDrag?.cancel?.(session.nativeId || session.requestId));
    } catch (error) {
      console.warn("SFTP native drag renderer cleanup failed:", error);
    }
    if (accepted) {
      session.abortController?.abort();
      scheduleNativeSftpDragCancelFallback(session, message);
    }
    else session.cancelling = false;
  }
}

function cancelNativeSftpDragByToken(token) {
  const key = String(token || "");
  if (!key) return false;
  for (const session of nativeSftpDragSessions.values()) {
    if (session.token !== key || !nativeSftpDragSessionCanCancel(session)) continue;
    session.cancelling = true;
    try {
      const accepted = Boolean(nativeSftpDrag?.cancel?.(session.nativeId || session.requestId));
      if (accepted) {
        session.abortController?.abort();
        scheduleNativeSftpDragCancelFallback(session, desktopUiText("已取消拖出", "Drag-out cancelled"));
      }
      else session.cancelling = false;
      return accepted;
    } catch {
      session.cancelling = false;
      return false;
    }
  }
  return false;
}

function handleStagedSftpStartDrag(event, payload, requestId) {
  const root = path.resolve(DATA_DIR, "sftp-drag");
  const validated = [...new Set((Array.isArray(payload?.files) ? payload.files : []).map(file => path.resolve(String(file || ""))).filter(file => {
    const relative = path.relative(root, file);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative) && fs.existsSync(file);
  }))];
  if (!validated.length) {
    sendSftpDragResult(event, requestId, false, desktopUiText(
      "拖出文件已失效，请重新准备后再试",
      "The prepared drag-out files have expired. Prepare them again and retry."
    ));
    return;
  }
  try {
    const dragIcon = nativeImage.createFromPath(iconPath("icon.png")).resize({width:16,height:16,quality:"best"});
    event.sender.startDrag({
      file:validated[0],
      files:validated,
      icon:dragIcon
    });
    sendSftpDragResult(event, requestId, true);
  } catch (error) {
    console.error("SFTP native drag failed:", error);
    const message = error?.message || desktopUiText("无法启动系统拖拽", "Could not start the system drag operation");
    sendSftpDragResult(event, requestId, false, message);
  }
}

function handleStreamingSftpStartDrag(event, payload, requestId) {
  if (nativeSftpDrag?.capabilities?.().sftpExternalDrag !== "streaming") {
    sendSftpDragResult(event, requestId, false, nativeSftpDrag?.probe?.reason || desktopUiText(
      "当前桌面环境不支持一次拖出",
      "The current desktop environment does not support direct drag-out"
    ));
    return;
  }
  if (nativeSftpDragSessions.has(requestId)) return;
  let token = "";
  try {
    const connectionId = Number(payload?.connectionId);
    if (!Number.isInteger(connectionId) || connectionId <= 0) throw new Error(desktopUiText(
      "SFTP 连接无效",
      "The SFTP connection is invalid"
    ));
    const entries = normalizedNativeSftpDragEntries(payload);
    const ticket = reserveNativeSftpDragTicket(connectionId, entries.map(item => item.path), {
      platform:process.platform,
      entries
    });
    token = ticket.token;
    const baseUrl = webUrl.replace(/\/+$/, "");
    const session = {
      requestId,
      sender:event.sender,
      connectionId,
      sourceTabKey:String(payload?.sourceTabKey || "").slice(0, 256),
      entries,
      token,
      ticket,
      nativeId:"",
      internalTarget:null,
      pendingWrites:0,
      completedWrites:0,
      completedItemIds:new Set(),
      completedDeliveries:new Set(),
      inflightDeliveries:new Map(),
      renamedItems:new Map(),
      abortController:new AbortController(),
      expectedWrites:Array.isArray(ticket.top_level) ? ticket.top_level.length : entries.length,
      terminalEvent:null,
      resultSent:false,
      released:false,
      nativeOwnsTicket:false,
      nativeStarted:false,
      nativeJobStarted:false,
      nativeJobStartPromise:null,
      uiReleased:false,
      consuming:false,
      contentComplete:false,
      activated:false,
      cancelling:false,
      contentErrors:[],
      writeError:"",
      expiryTimer:null,
      cancelTimer:null,
      macCompletionTimer:null,
      macCompletionGraceElapsed:false,
      windowsTargetTimer:null,
      windowsReleaseAcknowledged:false
    };
    nativeSftpDragSessions.set(requestId, session);
    session.expiryTimer = setTimeout(() => {
      if (session.released) return;
      session.cancelling = true;
      try { nativeSftpDrag?.cancel?.(session.nativeId || session.requestId); } catch {}
      session.cancelTimer = setTimeout(() => {
        if (session.released || session.terminalEvent) return;
        session.terminalEvent = {
          type:"error",
          message:desktopUiText("拖出操作已超时", "The drag-out operation timed out")
        };
        session.expectedWrites = session.completedItemIds.size;
        maybeFinishNativeDragSession(session);
      }, NATIVE_SFTP_DRAG_CANCEL_GRACE_MS);
    }, NATIVE_SFTP_DRAG_SESSION_TIMEOUT_MS);
    const started = nativeSftpDrag.start({
      requestId,
      token,
      ticket,
      manifestUrl:`${baseUrl}/api/sftp/native-drag/${encodeURIComponent(token)}`,
      contentBaseUrl:`${baseUrl}/api/sftp/native-drag/${encodeURIComponent(token)}/content`,
      browserWindow:mainWindow,
      webContents:event.sender,
      zoomFactor:event.sender.getZoomFactor?.() || 1
    }, nativeEvent => handleNativeSftpDragEvent(session, nativeEvent));
    session.nativeId = started?.nativeId || requestId;
    if (session.activated) nativeSftpDrag?.activate?.(session.nativeId);
  } catch (error) {
    if (token) {
      try { releaseNativeSftpDragTicket?.(token); } catch {}
    }
    nativeSftpDragSessions.delete(requestId);
    console.error("SFTP streaming drag failed:", error);
    sendSftpDragResult(event, requestId, false, error?.message || desktopUiText(
      "无法启动系统拖放",
      "Could not start the system drag-and-drop operation"
    ));
  }
}

function handleSftpStartDrag(event, payload) {
  if (!rendererBelongsToDesktop(event) || !mainWindow || event.sender !== mainWindow.webContents) return;
  const requestId = String(payload?.requestId || "").slice(0, 128);
  if (!requestId) return;
  if (Array.isArray(payload?.files)) {
    handleStagedSftpStartDrag(event, payload, requestId);
    return;
  }
  handleStreamingSftpStartDrag(event, payload, requestId);
}

function bringMainWindowToFront() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();

  // Linux window managers may keep a hidden Electron window behind the
  // current workspace even after show()/focus(). Temporarily raising it
  // gives the WM a real activation request without leaving Terma
  // permanently above other applications.
  const temporarilyRaiseLinuxWindow = process.platform === "linux"
    && typeof mainWindow.setAlwaysOnTop === "function"
    && !(typeof mainWindow.isAlwaysOnTop === "function" && mainWindow.isAlwaysOnTop());
  const temporarilyShowOnAllLinuxWorkspaces = process.platform === "linux"
    && typeof mainWindow.setVisibleOnAllWorkspaces === "function";
  if (temporarilyRaiseLinuxWindow) {
    try { mainWindow.setAlwaysOnTop(true, "normal"); } catch {}
  }
  if (temporarilyShowOnAllLinuxWorkspaces) {
    try { mainWindow.setVisibleOnAllWorkspaces(true); } catch {}
  }
  mainWindow.show();
  if (process.platform === "win32" || process.platform === "linux") mainWindow.moveTop?.();
  try {
    if (process.platform === "darwin") app.focus?.({ steal:true });
    else if (process.platform === "win32") app.focus?.();
  } catch {}
  mainWindow.focus();
  if (temporarilyRaiseLinuxWindow) {
    try { mainWindow.setAlwaysOnTop(false, "normal"); } catch {}
  }
  if (temporarilyShowOnAllLinuxWorkspaces) {
    try { mainWindow.setVisibleOnAllWorkspaces(false); } catch {}
  }
  return true;
}

function showWindow() {
  if (bringMainWindowToFront()) return true;
  // `second-instance` may fire before app.whenReady() has finished starting
  // the backend and before the first BrowserWindow exists. Creating a window
  // at that point would load an empty URL and strand the real startup window.
  if (desktopStartupInProgress || !webUrl) {
    pendingWindowReveal = true;
    return false;
  }
  createWindow();
  return true;
}

function trayIcon() {
  const source = nativeImage.createFromPath(iconPath("icon.png"));
  const image = process.platform === "darwin"
    ? source.resize({ width: 18, height: 18, quality: "best" })
    : source;
  image.setTemplateImage(false);
  return image;
}

async function fetchJson(pathname, options = {}) {
  const headers = {
    ...(options.headers || {}),
    ...(desktopAuthToken ? {"X-Terma-Desktop-Token":desktopAuthToken} : {})
  };
  const res = await fetch(`${webUrl}${pathname}`, {...options, headers});
  if (!res.ok) throw new Error(await res.text() || res.statusText);
  return res.json();
}

async function updateTrayState() {
  if (!webUrl) return;
  const connections = await fetchJson("/api/connections");
  const forwards = connections.flatMap(connection => connection.forwards || []);
  trayState = {
    runningConnections: connections.filter(connection => (connection.forwards || []).some(forward => forward.status === "running")).length,
    runningForwards: forwards.filter(forward => forward.status === "running").length,
    failedForwards: forwards.filter(forward => forward.status === "failed").length,
    totalForwards: forwards.length,
    online: true
  };
  if (tray) {
    const tooltip = desktopUiText(
      `${PRODUCT_NAME}：正在转发 ${trayState.runningForwards}/${trayState.totalForwards} 条${trayState.failedForwards ? `，异常 ${trayState.failedForwards} 条` : ""}`,
      `${PRODUCT_NAME}: forwarding ${trayState.runningForwards}/${trayState.totalForwards}${trayState.failedForwards ? `; ${trayState.failedForwards} failed` : ""}`
    );
    tray.setToolTip(tooltip);
    refreshTrayMenu();
  }
}

async function startAllForwards() {
  const connections = await fetchJson("/api/connections");
  for (const connection of connections.filter(item => (item.forwards || []).length)) {
    await fetchJson(`/api/connections/${connection.id}/start-forwards`, { method: "POST" });
  }
  await updateTrayState().catch(() => {});
  notify(desktopUiText("已启动全部连接转发", "Started forwarding for all connections"));
}

function forwardNeedsStop(forward) {
  const status = String(forward?.status || "stopped");
  return status !== "stopped" || Boolean(Number(forward?.pid || 0)) || Boolean(Number(forward?.restore || 0));
}

async function stopAllConnectionForwards() {
  const connections = await fetchJson("/api/connections");
  for (const connection of connections.filter(item => (item.forwards || []).some(forwardNeedsStop))) {
    await fetchJson(`/api/connections/${connection.id}/stop-forwards`, { method: "POST" });
  }
  await updateTrayState().catch(() => {});
  notify(desktopUiText("已停止全部连接转发", "Stopped forwarding for all connections"));
}

function desktopNotificationsAvailable() {
  if (!Notification.isSupported()) return false;
  if (process.platform !== "linux") return true;
  const now = Date.now();
  if (now - linuxNotificationProbe.checkedAt < 30_000) return linuxNotificationProbe.available;
  let available = false;
  try {
    const probe = spawnSync("dbus-send", [
      "--session",
      "--dest=org.freedesktop.DBus",
      "--type=method_call",
      "--print-reply",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus.NameHasOwner",
      "string:org.freedesktop.Notifications"
    ], { encoding: "utf8", timeout: 1200, windowsHide: true });
    available = probe.status === 0 && /boolean\s+true\b/.test(String(probe.stdout || ""));
  } catch {}
  linuxNotificationProbe = { checkedAt: now, available };
  return available;
}

function notify(body) {
  if (process.platform === "win32" && tray && typeof tray.displayBalloon === "function") {
    tray.displayBalloon({
      title: PRODUCT_NAME,
      content: body,
      icon: nativeImage.createFromPath(iconPath("icon.ico")),
      largeIcon: true
    });
    return;
  }
  if (desktopNotificationsAvailable()) new Notification({ title:PRODUCT_NAME, body, icon:iconPath("icon.png") }).show();
}

function desktopWindowIsBackground() {
  return !mainWindow
    || mainWindow.isDestroyed()
    || mainWindow.isMinimized?.()
    || !mainWindow.isVisible?.()
    || !mainWindow.isFocused?.();
}

function normalizeDesktopNotificationLanguage(value) {
  return String(value || "") === "en-US" ? "en-US" : "zh-CN";
}

function setDesktopInterfaceLanguage(value, persist=false) {
  const language = normalizeDesktopNotificationLanguage(value);
  const changed = desktopInterfaceLanguage !== language;
  desktopInterfaceLanguage = language;
  process.env[DESKTOP_INTERFACE_LANGUAGE_ENV] = language;
  if (persist && (SETTINGS_FILE || BOOT_SETTINGS_FILE)) {
    const settings = readSettings();
    if (settings.interfaceLanguage !== language) {
      writeSettings({...settings, interfaceLanguage:language});
    }
  }
  if (changed && tray) refreshTrayMenu();
  return language;
}

function desktopNotificationText(language, chinese, english) {
  return normalizeDesktopNotificationLanguage(language) === "en-US" ? english : chinese;
}

function desktopUiText(chinese, english) {
  return desktopNotificationText(desktopInterfaceLanguage, chinese, english);
}

async function readDesktopNotificationPreferences(force=false) {
  const now = Date.now();
  if (!force && desktopNotificationPreferences && now - desktopNotificationPreferencesReadAt < 5000) {
    return desktopNotificationPreferences;
  }
  const [security, runtime] = await Promise.all([
    fetchJson("/api/security").catch(() => ({})),
    fetchJson("/api/runtime-settings").catch(() => ({}))
  ]);
  const display = runtime?.saved?.notification_display || runtime?.notification_display || {};
  const runtimeLanguage = runtime?.saved?.language || runtime?.language;
  const language = setDesktopInterfaceLanguage(runtimeLanguage || desktopInterfaceLanguage, Boolean(runtimeLanguage));
  desktopNotificationPreferences = {
    mode:String(security?.notification_mode || "on"),
    language,
    info:display?.info?.enabled !== false,
    success:display?.success?.enabled !== false,
    error:display?.error?.enabled !== false
  };
  desktopNotificationPreferencesReadAt = now;
  return desktopNotificationPreferences;
}

function desktopNotificationAllowed(event, preferences) {
  if (preferences?.mode !== "on") return false;
  const level = ["success", "error"].includes(String(event?.level)) ? String(event.level) : "info";
  return preferences?.[level] !== false;
}

function sendDesktopNotificationToRenderer(event, display) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send?.("terma:notification-event", {event, display:Boolean(display)});
}

function showBackendSystemNotification(event) {
  const title = String(event?.title || PRODUCT_NAME);
  const body = String(event?.message || "");
  if (desktopNotificationsAvailable()) {
    const notification = new Notification({title, body, icon:iconPath("icon.png")});
    notification.on?.("click", () => {
      showWindow();
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send?.("terma:notification-action", event?.action || null);
      }, 120);
    });
    notification.show();
    return;
  }
  if (process.platform === "win32" && tray && typeof tray.displayBalloon === "function") {
    tray.displayBalloon({
      title,
      content:body,
      icon:nativeImage.createFromPath(iconPath("icon.ico")),
      largeIcon:true
    });
  }
}

async function pollDesktopNotifications() {
  if (!webUrl || quitting) return;
  const preferences = await readDesktopNotificationPreferences(true);
  const events = await fetchJson(`/api/notifications?since=${encodeURIComponent(desktopNotificationCursor)}&language=${encodeURIComponent(preferences.language)}`);
  if (!desktopNotificationCursorInitialized) {
    desktopNotificationCursor = Array.isArray(events)
      ? events.reduce((latest, event) => Math.max(latest, Number(event?.id || 0)), 0)
      : 0;
    desktopNotificationCursorInitialized = true;
    return;
  }
  if (!Array.isArray(events) || !events.length) return;
  const updateStatus = events.some(event => event?.type === "update")
    ? await fetchJson("/api/updates/status").catch(() => ({}))
    : null;
  const background = desktopWindowIsBackground();
  for (const event of events) {
    desktopNotificationCursor = Math.max(desktopNotificationCursor, Number(event?.id || 0));
    const allowed = desktopNotificationAllowed(event, preferences)
      && !(event?.type === "update" && updateStatus?.update_ignored);
    sendDesktopNotificationToRenderer(event, allowed && !background);
    if (allowed && background) showBackendSystemNotification(event);
  }
}

function startDesktopNotificationBridge() {
  if (desktopNotificationTimer) clearInterval(desktopNotificationTimer);
  desktopNotificationCursorInitialized = false;
  void pollDesktopNotifications().catch(error => console.warn(`notification bridge initialization failed: ${error.message}`));
  desktopNotificationTimer = setInterval(() => {
    void pollDesktopNotifications().catch(error => console.warn(`notification bridge poll failed: ${error.message}`));
  }, 2500);
}

function stopDesktopNotificationBridge() {
  if (desktopNotificationTimer) clearInterval(desktopNotificationTimer);
  desktopNotificationTimer = null;
}

function buildAppMenu() {
  const settings = readSettings();
  Menu.setApplicationMenu(null);
  applyLoginSetting(settings);
}

function createTray() {
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip(PRODUCT_NAME);
    tray.on("double-click", showWindow);
    refreshTrayMenu();
    void readDesktopNotificationPreferences(true).catch(() => {});
  } catch (error) {
    console.warn(`tray unavailable: ${error.message}`);
  }
}

function refreshTrayMenu() {
  if (!tray) return;
  const statusLabel = trayState.online
    ? desktopUiText(
      `正在转发：${trayState.runningForwards}/${trayState.totalForwards} 条，连接 ${trayState.runningConnections} 个${trayState.failedForwards ? `，异常 ${trayState.failedForwards} 条` : ""}`,
      `Forwarding: ${trayState.runningForwards}/${trayState.totalForwards}; ${trayState.runningConnections} connections${trayState.failedForwards ? `; ${trayState.failedForwards} failed` : ""}`
    )
    : desktopUiText("正在转发：状态读取中", "Forwarding: reading status");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: desktopUiText(`打开 ${PRODUCT_NAME}`, `Open ${PRODUCT_NAME}`), click: showWindow },
    { label: desktopUiText("在浏览器打开", "Open in browser"), click: () => shell.openExternal(webUrl) },
    { label: statusLabel, enabled: false },
    { type: "separator" },
    { label: desktopUiText("启动全部转发", "Start all forwarding"), click: () => startAllForwards().catch(showError) },
    { label: desktopUiText("停止全部转发", "Stop all forwarding"), click: () => stopAllConnectionForwards().catch(showError) },
    { type: "separator" },
    { label: desktopUiText("打开 .ssh 目录", "Open .ssh directory"), click: () => shell.openPath(PROJECT_SSH_DIR) },
    { label: desktopUiText("打开日志目录", "Open log directory"), click: () => shell.openPath(LOG_DIR) },
    { label: desktopUiText("导出日志", "Export logs"), click: exportLogs },
    { type: "separator" },
    { label: desktopUiText(`退出 ${PRODUCT_NAME}`, `Quit ${PRODUCT_NAME}`), click: quitApp }
  ]));
}

function showError(error) {
  dialog.showErrorBox(PRODUCT_NAME, error.message || String(error));
}

async function exportLogs() {
  try {
    await readDesktopNotificationPreferences(true).catch(() => null);
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: desktopUiText("选择日志导出目录", "Select log export directory"),
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) return;
    const target = path.join(result.filePaths[0], `${PRODUCT_ID}-logs-${timestampName()}`);
    fs.mkdirSync(target, { recursive: true });
    if (fs.existsSync(LOG_DIR)) fs.cpSync(LOG_DIR, target, { recursive: true });
    notify(desktopUiText("日志已导出", "Logs exported"));
    shell.openPath(target);
  } catch (error) {
    showError(error);
  }
}

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function desktopSettingsView() {
  const settings = readSettings();
  const paths = resolveRuntimePaths(settings);
  return {
    settings,
    paths,
    xserver:xServerDiagnostics(),
    project_mode_available: !app.isPackaged || isWindowsPortable(),
    project_mode_label: isWindowsPortable()
      ? desktopUiText("便携程序所在文件夹", "Portable application folder")
      : desktopUiText("项目所在文件夹", "Project folder")
  };
}

function normalizeDesktopSettings(value) {
  const current = readSettings();
  const projectModeAvailable = !app.isPackaged || isWindowsPortable();
  const requestedMode = String(value?.dataMode || current.dataMode);
  const allowedModes = new Set(projectModeAvailable ? ["project", "user", "custom"] : ["user", "custom"]);
  if (!allowedModes.has(requestedMode)) throw new Error(desktopUiText("数据路径模式无效", "The data-path mode is invalid"));
  const customDataDir = String(value?.customDataDir || "").trim();
  if (requestedMode === "custom" && !customDataDir) throw new Error(desktopUiText(
    "请选择自定义数据根目录",
    "Select a custom data root directory"
  ));
  if (customDataDir.includes("\0")) throw new Error(desktopUiText("自定义数据目录无效", "The custom data directory is invalid"));
  return {
    ...current,
    dataMode: requestedMode,
    customDataDir: customDataDir ? path.resolve(customDataDir) : "",
    openAtLogin: Boolean(value?.openAtLogin),
    minimizeToTray: Boolean(value?.minimizeToTray),
    startMinimizedToTray: Boolean(value?.startMinimizedToTray),
    showStartupNotification: Boolean(value?.showStartupNotification),
    xServerAutoStart: value?.xServerAutoStart !== false
  };
}

function saveDesktopSettings(value) {
  const current = readSettings();
  const settings = normalizeDesktopSettings(value);
  const currentPaths = resolveRuntimePaths(current);
  const targetPaths = resolveRuntimePaths(settings);
  const pathChanged = path.relative(currentPaths.dataDir, targetPaths.dataDir) !== ""
    || path.relative(currentPaths.sshDir, targetPaths.sshDir) !== "";
  const transition = pathChanged && Boolean(value?.migrateData)
    ? createDesktopStorageTransition(current, settings, currentPaths, targetPaths)
    : null;
  if (transition) writeSettings({...current, pendingStorageMigration:transition});
  else writeSettings(settings);
  if (!transition) applyLoginSetting(settings);
  setTimeout(async () => {
    quitting = true;
    try {
      await Promise.resolve(shutdown());
      if (transition) applyLoginSetting(finishDesktopStorageTransition(transition));
    } catch (error) {
      if (transition) {
        try { rollbackDesktopStorageTransition(transition); } catch {}
        const rolledBack = failedDesktopStorageSettings(transition, error);
        writeSettings(rolledBack);
        applyLoginSetting(rolledBack);
        dialog.showErrorBox(
          desktopUiText("Terma 数据迁移失败", "Terma data migration failed"),
          desktopUiText(
            `数据没有切换到新路径，原目录仍然保留并会继续使用。\n\n${error.message || error}`,
            `Data was not switched to the new location. The original directory was preserved and will remain in use.\n\n${error.message || error}`
          )
        );
      } else {
        console.error(error);
      }
    }
    relaunchInForeground();
    app.exit(0);
  }, 500);
  return {
    ok:true,
    restart_required:true,
    migration_requested:Boolean(transition),
    data_dir:targetPaths.dataDir,
    ssh_dir:targetPaths.sshDir
  };
}

async function chooseDesktopDataDir() {
  await readDesktopNotificationPreferences(true).catch(() => null);
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: desktopUiText(`选择 ${PRODUCT_NAME} 数据根目录`, `Select ${PRODUCT_NAME} data root directory`),
    properties: ["openDirectory", "createDirectory"]
  });
  return result.canceled ? "" : result.filePaths[0];
}

function defaultDownloadDirectory() {
  return app.getPath("downloads");
}

function defaultDesktopDirectory() {
  return app.getPath("desktop");
}

function validateDownloadDirectory(value) {
  const target = path.resolve(String(value || defaultDownloadDirectory()));
  fs.mkdirSync(target, { recursive:true });
  if (!fs.statSync(target).isDirectory()) throw new Error(desktopUiText(
    "SFTP 下载路径不是目录",
    "The SFTP download path is not a directory"
  ));
  fs.accessSync(target, fs.constants.W_OK);
  return target;
}

async function chooseDownloadDirectory() {
  await readDesktopNotificationPreferences(true).catch(() => null);
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title:desktopUiText("选择 SFTP 自动保存目录", "Select SFTP automatic save directory"),
    defaultPath:defaultDownloadDirectory(),
    properties:["openDirectory", "createDirectory"]
  });
  return result.canceled ? "" : result.filePaths[0];
}

async function chooseSyncDirectory() {
  await readDesktopNotificationPreferences(true).catch(() => null);
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title:desktopUiText("选择本地同步目录", "Select local sync directory"),
    properties:["openDirectory", "createDirectory"]
  });
  return result.canceled ? "" : result.filePaths[0];
}

async function openDownloadDirectory(value) {
  const target = validateDownloadDirectory(value);
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
  return {ok:true, path:target};
}

async function openLocalPath(value) {
  const target = path.resolve(String(value || ""));
  if (!fs.existsSync(target)) throw new Error(desktopUiText(
    "本地文件或目录不存在",
    "The local file or directory does not exist"
  ));
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
  return {ok:true, path:target};
}

async function openVsCodeRemote(value={}) {
  const user = String(value.user || "").trim();
  const host = String(value.host || "").trim();
  const port = Number(value.port || 22);
  const remotePath = String(value.path || "").replace(/\\/g, "/").trim();
  if (!user || !host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error(desktopUiText(
    "VS Code Remote SSH 目标无效",
    "The VS Code Remote SSH target is invalid"
  ));
  const target = `${user}@${host}${port === 22 ? "" : `:${port}`}`;
  const suffix = remotePath ? `/${remotePath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}` : "";
  const uri = `vscode://vscode-remote/ssh-remote+${encodeURIComponent(target)}${suffix}`;
  await shell.openExternal(uri);
  return {ok:true};
}

async function openExternalFile(file, editor={}) {
  const target = path.resolve(String(file || ""));
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(desktopUiText(
    "外部编辑临时文件不存在",
    "The temporary file for external editing does not exist"
  ));
  const mode = String(editor.mode || "system");
  if (mode === "system") {
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return {ok:true, mode};
  }
  if (mode === "vscode") {
    await shell.openExternal(`vscode://file/${target.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/")}`);
    return {ok:true, mode};
  }
  if (mode !== "custom") throw new Error(desktopUiText("外部编辑器类型无效", "The external-editor type is invalid"));
  const executable = path.resolve(String(editor.path || ""));
  if (!path.isAbsolute(executable) || !fs.existsSync(executable) || !fs.statSync(executable).isFile()) throw new Error(desktopUiText(
    "自定义编辑器程序不存在",
    "The custom editor executable does not exist"
  ));
  const configuredArgs = Array.isArray(editor.args) ? editor.args.map(value => String(value)) : [];
  const args = configuredArgs.some(value => value.includes("${file}"))
    ? configuredArgs.map(value => value.replaceAll("${file}", target))
    : [...configuredArgs, target];
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {detached:true, stdio:"ignore", windowsHide:true});
    child.once("spawn", () => { child.unref(); resolve(null); });
    child.once("error", reject);
  });
  return {ok:true, mode};
}

function remoteClientDiagnostics() {
  return remoteClientAdapter.diagnostics();
}

async function openRemoteClient(profile={}) {
  if (process.platform === "darwin" && profile.protocol === "rdp") {
    const current = remoteClientAdapter.diagnostics().rdp;
    const passwordTransferNeedsXServer = Boolean(
      profile.password
      && profile.options?.allow_password_transfer
      && current.password_transfer_mode === "freerdp"
      && current.password_transfer_requires_xserver
    );
    if ((current.mode === "freerdp" && !current.available) || passwordTransferNeedsXServer) await xServerRuntime.start();
  }
  return remoteClientAdapter.open(profile);
}

async function installRemoteClient(protocol="") {
  if (process.platform === "linux" && protocol === "rdp") return xServerRuntime.installLinuxGraphicsComponents();
  return remoteClientAdapter.install(String(protocol || ""));
}

function xServerDiagnostics() {
  return {...xServerRuntime.diagnostics(), auto_start:readSettings().xServerAutoStart !== false};
}

async function startXServer() {
  const result = await xServerRuntime.start();
  writeSettings({...readSettings(), xServerAutoStart:true});
  return {...result, auto_start:true};
}

async function stopXServer() {
  const result = await xServerRuntime.stop({force:true});
  writeSettings({...readSettings(), xServerAutoStart:false});
  return {...result, auto_start:false};
}

async function installXQuartz() {
  return xServerRuntime.installXQuartz();
}

async function installLinuxGraphicsComponents() {
  return xServerRuntime.installLinuxGraphicsComponents();
}

function desktopProgramCacheInfo() {
  const remoteClient = remoteClientAdapter?.cacheInfo?.() || {};
  const xserver = xServerRuntime?.cacheInfo?.() || {};
  return {
    local_installers:{
      bytes:Number(remoteClient.bytes || 0) + Number(xserver.bytes || 0),
      files:Number(remoteClient.files || 0) + Number(xserver.files || 0),
      reclaimable_bytes:Number(remoteClient.reclaimable_bytes || 0) + Number(xserver.reclaimable_bytes || 0),
      reclaimable_files:Number(remoteClient.reclaimable_files || 0) + Number(xserver.reclaimable_files || 0),
      busy:Boolean(remoteClient.busy || xserver.busy),
      sources:{remote_client:remoteClient, xserver}
    }
  };
}

function clearDesktopProgramCache(category="") {
  if (String(category || "") !== "local_installers") throw new Error(desktopUiText(
    "未知的桌面缓存分类",
    "Unknown desktop cache category"
  ));
  remoteClientAdapter?.clearCache?.();
  xServerRuntime?.clearCache?.();
  return desktopProgramCacheInfo();
}

async function openXdmcp(profile={}) {
  return xServerRuntime.openXdmcp(profile);
}

async function testXdmcp(profile={}) {
  return xServerRuntime.testXdmcp(profile);
}

function validatedUpdatePackagePath(file) {
  const target = path.resolve(String(file || ""));
  const updateRoot = path.resolve(path.join(DATA_DIR, "updates"));
  const relative = path.relative(updateRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(target)) {
    throw new Error(desktopUiText("更新安装包路径无效", "The update-package path is invalid"));
  }
  const supported = process.platform === "win32"
    ? /\.exe$/i
    : process.platform === "darwin"
      ? /\.(?:dmg|zip)$/i
      : /\.(?:appimage|deb|rpm)$/i;
  if (!supported.test(target)) throw new Error(desktopUiText(
    "更新安装包类型与当前系统不匹配",
    "The update-package type does not match the current system"
  ));
  return target;
}

async function openUpdatePackage(file) {
  const target = validatedUpdatePackagePath(file);
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
  return { ok:true };
}

async function openUpdateDirectory(file) {
  const target = validatedUpdatePackagePath(file);
  shell.showItemInFolder(target);
  return { ok:true };
}

function quitApp() {
  quitting = true;
  if (trayStateTimer) clearInterval(trayStateTimer);
  stopDesktopNotificationBridge();
  try { setNativeSftpDragCancelHandler?.(null); } catch {}
  try { nativeSftpDrag?.dispose?.(); } catch {}
  for (const session of nativeSftpDragSessions.values()) releaseNativeDragSession(session);
  try {
    shutdown();
  } catch (error) {
    console.error(error);
  }
  setTimeout(() => app.quit(), 300);
}

function assertDesktopClipboardSender(event) {
  if (!desktopWindowForSender(event) || !rendererBelongsToDesktop(event)) {
    throw new Error(desktopUiText("剪贴板请求来源无效", "The clipboard request source is invalid"));
  }
}

const DESKTOP_CLIPBOARD_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const DESKTOP_CLIPBOARD_IMAGE_MAX_DIMENSION = 16384;
const DESKTOP_CLIPBOARD_IMAGE_MAX_PIXELS = 64 * 1024 * 1024;
const DESKTOP_CLIPBOARD_PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodeDesktopClipboardBmp(image, width, height) {
  if (!image || !width || !height) return Buffer.alloc(0);
  const pixels = image.toBitmap();
  const rowBytes = width * 4;
  const pixelBytes = rowBytes * height;
  const headerBytes = 14 + 40;
  if (!pixels || pixels.length < pixelBytes || headerBytes + pixelBytes > DESKTOP_CLIPBOARD_IMAGE_MAX_BYTES) return Buffer.alloc(0);
  const bmp = Buffer.alloc(headerBytes + pixelBytes);
  bmp.writeUInt16LE(0x4d42, 0);
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(headerBytes, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(32, 28);
  bmp.writeUInt32LE(0, 30);
  bmp.writeUInt32LE(pixelBytes, 34);
  bmp.writeInt32LE(2835, 38);
  bmp.writeInt32LE(2835, 42);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = row * rowBytes;
    const targetStart = headerBytes + (height - row - 1) * rowBytes;
    pixels.copy(bmp, targetStart, sourceStart, sourceStart + rowBytes);
  }
  return bmp;
}

function readDesktopClipboardImage() {
  const image = clipboard.readImage();
  if (!image || image.isEmpty()) return {ok:false, reason:"empty"};
  const size = image.getSize();
  const width = Math.max(0, Number(size?.width || 0));
  const height = Math.max(0, Number(size?.height || 0));
  if (!width || !height) return {ok:false, reason:"empty"};
  if (width > DESKTOP_CLIPBOARD_IMAGE_MAX_DIMENSION
    || height > DESKTOP_CLIPBOARD_IMAGE_MAX_DIMENSION
    || width * height > DESKTOP_CLIPBOARD_IMAGE_MAX_PIXELS) {
    return {
      ok:false,
      reason:"too_large",
      error:desktopUiText("剪贴板图片尺寸过大，无法安全粘贴", "The clipboard image dimensions are too large to paste safely")
    };
  }
  const data = image.toPNG();
  if (!data.length) return {ok:false, reason:"empty"};
  if (data.length > DESKTOP_CLIPBOARD_IMAGE_MAX_BYTES) {
    return {
      ok:false,
      reason:"too_large",
      error:desktopUiText("剪贴板图片超过 25 MB，无法粘贴到远端终端", "The clipboard image exceeds 25 MB and cannot be pasted into the remote terminal")
    };
  }
  return {ok:true, mime_type:"image/png", width, height, byte_length:data.length, data};
}

function readDesktopClipboardFormats() {
  const imageResult = readDesktopClipboardImage();
  if (!imageResult.ok) return {ok:false, reason:imageResult.reason || "empty"};
  const image = clipboard.readImage();
  const bmp = encodeDesktopClipboardBmp(image, imageResult.width, imageResult.height);
  return {
    ok:true,
    width:imageResult.width,
    height:imageResult.height,
    png:imageResult.data,
    bmp
  };
}

function readDesktopClipboardSnapshot(options={}) {
  const formats = clipboard.availableFormats().map(value => String(value || "").toLowerCase());
  const image = clipboard.readImage();
  const imageAvailable = Boolean(image && !image.isEmpty());
  const textAvailable = formats.some(format => format === "text"
    || format === "string"
    || format === "utf8_string"
    || format === "public.utf8-plain-text"
    || format.startsWith("text/plain"));
  const result = {
    text_available:textAvailable,
    text:textAvailable ? clipboard.readText() : "",
    image_available:imageAvailable
  };
  if (imageAvailable && options?.include_image === true) result.image = readDesktopClipboardImage();
  return result;
}

function writeDesktopClipboardImage(value) {
  const data = Buffer.isBuffer(value)
    ? value
    : value instanceof ArrayBuffer
      ? Buffer.from(value)
      : ArrayBuffer.isView(value)
        ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        : Array.isArray(value?.data)
          ? Buffer.from(value.data)
          : Buffer.alloc(0);
  if (!data.length) throw new Error(desktopUiText("剪贴板图片为空", "The clipboard image is empty"));
  if (data.length > DESKTOP_CLIPBOARD_IMAGE_MAX_BYTES) throw new Error(desktopUiText(
    "剪贴板图片超过 25 MB，无法写入本机剪贴板",
    "The clipboard image exceeds 25 MB and cannot be written to the local clipboard"
  ));
  if (data.length < DESKTOP_CLIPBOARD_PNG_SIGNATURE.length || !data.subarray(0, DESKTOP_CLIPBOARD_PNG_SIGNATURE.length).equals(DESKTOP_CLIPBOARD_PNG_SIGNATURE)) {
    throw new Error(desktopUiText("剪贴板图片不是有效的 PNG 数据", "The clipboard image is not valid PNG data"));
  }
  const image = nativeImage.createFromBuffer(data);
  if (image.isEmpty()) throw new Error(desktopUiText("剪贴板图片不是有效的 PNG 数据", "The clipboard image is not valid PNG data"));
  const size = image.getSize();
  const width = Math.max(0, Number(size?.width || 0));
  const height = Math.max(0, Number(size?.height || 0));
  if (!width || !height
    || width > DESKTOP_CLIPBOARD_IMAGE_MAX_DIMENSION
    || height > DESKTOP_CLIPBOARD_IMAGE_MAX_DIMENSION
    || width * height > DESKTOP_CLIPBOARD_IMAGE_MAX_PIXELS) {
    throw new Error(desktopUiText(
      "剪贴板图片尺寸过大，无法安全写入",
      "The clipboard image dimensions are too large to write safely"
    ));
  }
  clipboard.writeImage(image);
  return {ok:true, width, height, byte_length:data.length};
}

function registerDesktopClipboardHandlers() {
  ipcMain.handle("terma:clipboard-read", event => {
    assertDesktopClipboardSender(event);
    return clipboard.readText();
  });
  ipcMain.handle("terma:clipboard-write", (event, text) => {
    assertDesktopClipboardSender(event);
    clipboard.writeText(String(text ?? ""));
    return {ok:true};
  });
  ipcMain.handle("terma:clipboard-read-image", event => {
    assertDesktopClipboardSender(event);
    return readDesktopClipboardImage();
  });
  ipcMain.handle("terma:clipboard-read-snapshot", (event, options) => {
    assertDesktopClipboardSender(event);
    return readDesktopClipboardSnapshot(options && typeof options === "object" ? options : {});
  });
  ipcMain.handle("terma:clipboard-write-image", (event, data) => {
    assertDesktopClipboardSender(event);
    return writeDesktopClipboardImage(data);
  });
  ipcMain.handle("terma:vnc-open-window", async (event, payload={}) => {
    if (!desktopWindowForSender(event) || !rendererBelongsToDesktop(event)) {
      throw new Error(desktopUiText("VNC 窗口请求来源无效", "The VNC window request source is invalid"));
    }
    return createDetachedVncWindow(Number(payload?.profileId || 0));
  });
  ipcMain.handle("terma:vnc-close-profile-window", (event, payload={}) => {
    if (desktopWindowForSender(event) !== mainWindow || !rendererBelongsToDesktop(event)) {
      throw new Error(desktopUiText("VNC 窗口切换请求来源无效", "The VNC window switch request source is invalid"));
    }
    return closeDetachedVncWindowForProfile(Number(payload?.profileId || 0));
  });
  ipcMain.handle("terma:vnc-window-close", event => {
    const window = desktopWindowForSender(event);
    if (!window || window === mainWindow) return {ok:false};
    if (!window.isDestroyed()) window.close();
    return {ok:true};
  });
}

function failDisplayClientStartup(message) {
  if (displayClientAuthTimer) clearTimeout(displayClientAuthTimer);
  displayClientAuthTimer = null;
  pendingDisplayClientUrl = "";
  dialog.showErrorBox(PRODUCT_NAME, message);
  quitting = true;
  app.exit(1);
  return false;
}

function completeDisplayClientStartup() {
  const targetUrl = pendingDisplayClientUrl;
  if (!targetUrl || !normalizeDesktopAuthToken(desktopAuthToken)) {
    return failDisplayClientStartup(desktopUiText(
      `无法验证已经运行的 ${PRODUCT_NAME} 后端，请在当前图形会话中重新启动。`,
      `Could not verify the running ${PRODUCT_NAME} backend. Restart it in the current graphical session.`
    ));
  }
  if (displayClientAuthTimer) clearTimeout(displayClientAuthTimer);
  displayClientAuthTimer = null;
  pendingDisplayClientUrl = "";
  webUrl = targetUrl;
  Menu.setApplicationMenu(null);
  ipcMain.on("terma:capabilities", handleDesktopCapabilities);
  ipcMain.on("terma:set-theme", handleDesktopTheme);
  createWindow({ displayClient:true });
  desktopStartupInProgress = false;
  return true;
}

function startDisplayClient() {
  const targetUrl = displayClientUrl();
  if (!targetUrl) {
    return failDisplayClientStartup(desktopUiText(
      `无法连接已经运行的 ${PRODUCT_NAME} 后端，请在当前图形会话中重新启动。`,
      `Could not connect to the running ${PRODUCT_NAME} backend. Restart it in the current graphical session.`
    ));
  }
  pendingDisplayClientUrl = targetUrl;
  if (displayClientAuthRejected) {
    return failDisplayClientStartup(desktopUiText(
      "显示客户端收到的桌面认证令牌无效，请在当前图形会话中重新启动 Terma。",
      "The display client received an invalid desktop authentication token. Restart Terma in the current graphical session."
    ));
  }
  if (normalizeDesktopAuthToken(desktopAuthToken)) return completeDisplayClientStartup();
  if (!displayClientAuthTimer) {
    displayClientAuthTimer = setTimeout(() => {
      displayClientAuthTimer = null;
      if (pendingDisplayClientUrl && !desktopAuthToken) {
        failDisplayClientStartup(desktopUiText(
          "等待桌面认证令牌超时，请在当前图形会话中重新启动 Terma。",
          "Timed out while waiting for the desktop authentication token. Restart Terma in the current graphical session."
        ));
      }
    }, DISPLAY_CLIENT_AUTH_TIMEOUT_MS);
  }
  return true;
}

app.whenReady().then(async () => {
  registerDesktopClipboardHandlers();
  if (displayClientMode) {
    startDisplayClient();
    return;
  }
  configureWindowsAppIdentity();
  removeLegacyElectronShortcut();
  initializeDesktopSettingsFile();
  const firstRun = ensureDesktopSettingsFile();
  const startupDesktopSettings = prepareRuntimeSettings();
  createStartupWindow(startupDesktopSettings);
  try {
    const startupRuntime = resolveRuntimePaths(startupDesktopSettings);
    prepareLegacyBrandMigrationAtStartup(startupDesktopSettings, startupRuntime);
    loadBackend(startupDesktopSettings);
    if (startupDesktopSettings.xServerAutoStart) {
      try { await xServerRuntime.start(); } catch (error) { console.warn(`X Server auto-start skipped: ${error.message}`); }
    }
    nativeSftpDrag = createNativeSftpDrag({
      app,
      nativeImage,
      screen,
      iconPath:iconPath("icon.png"),
      platform:process.platform,
      debug:NATIVE_SFTP_DRAG_DEBUG,
      getLanguage:()=>desktopInterfaceLanguage
    });
    setNativeSftpDragCancelHandler?.(cancelNativeSftpDragByToken);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(PROJECT_SSH_DIR, { recursive: true });
    const desktopServerArgs = { ...parseServerArgs(), pidFile:PID_FILE };
    const backend = startServer(desktopServerArgs, {
      exitOnShutdown: false,
      desktopAuthToken,
      onShutdown: () => {
        quitting = true;
        if (trayStateTimer) clearInterval(trayStateTimer);
        trayStateTimer = null;
        stopDesktopNotificationBridge();
        setTimeout(() => app.quit(), 0);
      },
      desktopIntegration: {
        confirmDesktopBrowserAuthorization,
        getSettings: desktopSettingsView,
        saveSettings: saveDesktopSettings,
        getLegacyBrandMigration: inspectLegacyBrandMigration,
        migrateLegacyBrandData,
        chooseDataDir: chooseDesktopDataDir,
        getDownloadDirectory: defaultDownloadDirectory,
        getDesktopDirectory: defaultDesktopDirectory,
        validateDownloadDirectory,
        chooseDownloadDirectory,
        chooseSyncDirectory,
        openDownloadDirectory,
        openLocalPath,
        openVsCodeRemote,
        openExternalFile,
        remoteClientDiagnostics,
        openRemoteClient,
        installRemoteClient,
        xServerDiagnostics,
        startXServer,
        stopXServer,
        installXQuartz,
        installLinuxGraphicsComponents,
        programCacheInfo:desktopProgramCacheInfo,
        clearProgramCache:clearDesktopProgramCache,
        openXdmcp,
        testXdmcp,
        openUpdatePackage,
        openUpdateDirectory
      }
    });
    if (backend?.ready && typeof backend.ready.then === "function") await backend.ready;
    webUrl = await waitForWebUrl();
    flushPendingDisplayClients();
  } catch (error) {
    closeStartupWindow();
    const alreadyRunning = error?.code === "TERMA_ALREADY_RUNNING" || error?.code === "TUNNELDESK_ALREADY_RUNNING";
    const presentation = alreadyRunning
      ? {
        title:desktopUiText(`${PRODUCT_NAME} 启动失败`, `${PRODUCT_NAME} failed to start`),
        message:desktopUiText(
          `${error.message}\n\n请使用已经打开的 ${PRODUCT_NAME} 窗口，或先停止已有无界面服务。`,
          `${error.message}\n\nUse the ${PRODUCT_NAME} window that is already open, or stop the existing headless service first.`
        )
      }
      : desktopStartupFailurePresentation(error, {dataDir:dataPath});
    dialog.showErrorBox(presentation.title, presentation.message);
    quitting = true;
    app.exit(1);
    return;
  }
  buildAppMenu();
  ipcMain.on("terma:capabilities", handleDesktopCapabilities);
  ipcMain.on("terma:set-theme", handleDesktopTheme);
  ipcMain.on("terma:set-interface-language", handleDesktopInterfaceLanguage);
  ipcMain.on("terma:sftp-start-drag", handleSftpStartDrag);
  ipcMain.on("terma:sftp-drag-activate", handleSftpDragActivate);
  ipcMain.on("terma:sftp-drag-target", handleSftpDragTarget);
  ipcMain.on("terma:sftp-drag-cancel", handleSftpDragCancel);
  createTray();
  createWindow({ openDesktopSettings:firstRun });
  startDesktopNotificationBridge();
  desktopStartupInProgress = false;
  if (pendingStorageMigrationNotice) setTimeout(() => notify(pendingStorageMigrationNotice), 1200);
  updateTrayState().catch(() => {});
  trayStateTimer = setInterval(() => updateTrayState().catch(() => {}), 10000);
  const settings = readSettings();
  if (settings.showStartupNotification) {
    setTimeout(async () => {
      try {
        const status = await fetchJson("/api/startup-status");
        const success = Number(status.autostart?.ok || 0) + Number(status.restore?.ok || 0);
        const failed = Number(status.autostart?.failed || 0) + Number(status.restore?.failed || 0);
        const preferences = await readDesktopNotificationPreferences(true).catch(() => ({language:"zh-CN"}));
        const language = preferences.language;
        const management = desktopNotificationText(language, `管理界面：${webUrl}`, `Management interface: ${webUrl}`);
        const detail = failed
          ? desktopNotificationText(language, "；详情请查看系统日志", "; see System Logs for details")
          : "";
        const forwards = desktopNotificationText(
          language,
          `转发启动：成功 ${success}，失败 ${failed}${detail}`,
          `Forwarding startup: ${success} succeeded, ${failed} failed${detail}`
        );
        notify(`${management}\n${forwards}`);
      } catch {
        const preferences = await readDesktopNotificationPreferences(true).catch(() => ({language:"zh-CN"}));
        notify(desktopNotificationText(preferences.language, `管理界面已启动：${webUrl}`, `Management interface started: ${webUrl}`));
      }
    }, 2200);
  }
});

app.on("activate", showWindow);

app.on("before-quit", () => {
  quitting = true;
  stopDesktopNotificationBridge();
  if (!displayClientMode) {
    for (const child of displayClientProcesses.values()) {
      try { child.send?.({ type:"quit" }); } catch {}
    }
    displayClientProcesses.clear();
  }
  void xServerRuntime?.dispose?.().catch(() => {});
  try { nativeSftpDrag?.dispose?.(); } catch {}
  for (const session of nativeSftpDragSessions.values()) releaseNativeDragSession(session);
});

app.on("quit", cleanupDisplayClientProfile);
