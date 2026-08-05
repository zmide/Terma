const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, ipcMain, nativeImage, nativeTheme, screen, shell } = require("electron");
const { createNativeSftpDrag } = require("./native-sftp-drag");
const { createRemoteClientAdapter } = require("./remote-clients");
const { createXServerRuntime } = require("./xserver-runtime");

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
let SETTINGS_FILE = "";
let BOOT_SETTINGS_FILE = "";
let dataPath = "";
let sshPath = "";
const DISPLAY_CLIENT_ARG = "--tunneldesk-display-client";
const DISPLAY_CLIENT_URL_ENV = "TUNNELDESK_DISPLAY_CLIENT_URL";
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
const displayClientMode = process.platform === "linux" && process.argv.includes(DISPLAY_CLIENT_ARG);
const localLinuxDisplaySession = captureLinuxDisplaySession();
const localLinuxDisplayKey = linuxDisplaySessionKey(localLinuxDisplaySession);
let displayClientProfileDir = "";
if (displayClientMode) {
  displayClientProfileDir = path.join(app.getPath("temp"), `tunneldesk-display-client-${process.pid}`);
  app.setPath("userData", displayClientProfileDir);
  app.setPath("sessionData", displayClientProfileDir);
}
let xServerRuntime = null;
const remoteClientAdapter = displayClientMode ? null : createRemoteClientAdapter({
  getDataDir:()=>DATA_DIR,
  shell,
  getXServerDiagnostics:()=>xServerRuntime?.diagnostics?.() || null
});

let mainWindow = null;
let tray = null;
let webUrl = "";
let quitting = false;
let pendingWindowReveal = false;
let startupRevealScheduled = false;
let desktopStartupInProgress = true;
let trayStateTimer = null;
let trayState = { runningConnections: 0, runningForwards: 0, failedForwards: 0, totalForwards: 0, online: false };
let pendingStorageMigrationNotice = "";
let nativeSftpDrag = null;
let linuxNotificationProbe = { checkedAt: 0, available: false };
const pendingDisplayClientSessions = new Map();
const displayClientProcesses = new Map();
const nativeSftpDragSessions = new Map();
const NATIVE_SFTP_DRAG_SESSION_TIMEOUT_MS = 70 * 60 * 1000;
const NATIVE_SFTP_DRAG_CANCEL_GRACE_MS = 90 * 1000;
const NATIVE_SFTP_DRAG_MAC_COMPLETION_GRACE_MS = 3000;
const NATIVE_SFTP_DRAG_WINDOWS_TARGET_ACK_TIMEOUT_MS = 2000;
const NATIVE_SFTP_DRAG_DEBUG = process.env.TUNNELDESK_NATIVE_DRAG_DEBUG === "1";

const APP_USER_MODEL_ID = "com.zmide.tunneldesk";
const TOAST_ACTIVATOR_CLSID = "{4BCB7691-AE54-4E32-B6D3-B22E3F4E3444}";
const START_IN_TRAY_ARG = "--start-in-tray";
const STORAGE_MIGRATION_VERSION = 1;
const TRANSIENT_DATA_FILES = new Set(["web.pid", "web.url", "web.json"]);

app.setName("TunnelDesk");
if (!displayClientMode) {
  xServerRuntime = createXServerRuntime({
    appIsPackaged:app.isPackaged,
    resourcesPath:process.resourcesPath,
    projectRoot:path.resolve(__dirname, ".."),
    userDataPath:app.getPath("userData")
  });
}
configureWindowsAppIdentity();

const singleInstanceLocked = displayClientMode || app.requestSingleInstanceLock({
  tunneldeskDisplaySession: localLinuxDisplaySession
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

function displayClientUrl(value = process.env[DISPLAY_CLIENT_URL_ENV]) {
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
  const args = process.argv.slice(1).filter(arg => arg !== START_IN_TRAY_ARG && arg !== DISPLAY_CLIENT_ARG);
  return [...args, DISPLAY_CLIENT_ARG];
}

function displayClientEnvironment(session, url) {
  const environment = { ...process.env };
  for (const key of LINUX_DISPLAY_SESSION_KEYS) delete environment[key];
  Object.assign(environment, normalizeLinuxDisplaySession(session));
  environment[DISPLAY_CLIENT_URL_ENV] = url;
  return environment;
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
    console.error(`failed to open TunnelDesk on ${key}: ${error.message}`);
    return false;
  }
  displayClientProcesses.set(key, child);
  const forget = () => {
    if (displayClientProcesses.get(key) === child) displayClientProcesses.delete(key);
  };
  child.once?.("error", error => {
    forget();
    console.error(`TunnelDesk display client ${key} failed: ${error.message}`);
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
  const requestedSession = normalizeLinuxDisplaySession(additionalData?.tunneldeskDisplaySession);
  const requestedKey = linuxDisplaySessionKey(requestedSession);
  if (process.platform === "linux" && requestedKey && requestedKey !== localLinuxDisplayKey) {
    requestDisplayClient(requestedSession);
    return;
  }
  showWindow();
  notify("TunnelDesk 已在运行，已切换到现有窗口");
}

function handleDisplayClientControlMessage(message) {
  if (!message || typeof message !== "object") return;
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

function iconPath(filename = process.platform === "win32" ? "icon.ico" : "icon.png") {
  return path.join(__dirname, "assets", filename);
}

function loadBackend() {
  const settings = prepareRuntimeSettings();
  const paths = resolveRuntimePaths(settings);
  dataPath = paths.dataDir;
  sshPath = paths.sshDir;
  process.env.TUNNELDESK_DATA_DIR = dataPath;
  process.env.TUNNELDESK_SSH_DIR = sshPath;
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
    setNativeSftpDragCancelHandler
  } = require("../dist/sftp-jobs"));
}

function defaultDesktopSettings() {
  return {
    dataMode: app.isPackaged && !isWindowsPortable() ? "user" : "project",
    customDataDir: "",
    openAtLogin: false,
    minimizeToTray: true,
    startMinimizedToTray: false,
    showStartupNotification: true,
    xServerAutoStart: true
  };
}

function readSettings() {
  try {
    return {
      ...defaultDesktopSettings(),
      ...JSON.parse(fs.readFileSync(SETTINGS_FILE || BOOT_SETTINGS_FILE, "utf8"))
    };
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
  return SETTINGS_FILE;
}

function isWindowsPortable() {
  return app.isPackaged
    && process.platform === "win32"
    && Boolean(String(process.env.PORTABLE_EXECUTABLE_DIR || "").trim());
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
    pendingStorageMigrationNotice = `检测到旧程序目录和用户目录中都有 TunnelDesk 数据。现继续使用用户目录，旧程序数据已完整备份到：${backupRoot}`;
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
    pendingStorageMigrationNotice = `TunnelDesk 数据已从旧程序目录迁移到用户目录：${targetRoot}。旧目录仍保留，可用于回滚。`;
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

function prepareRuntimeSettings() {
  return migrateLegacyPackagedRuntime(readSettings());
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
  throw new Error(`Web 服务已经启动，但 ${WEB_URL_FILE} 未在 ${Math.round(timeoutMs / 1000)} 秒内生成`);
}

function createWindow(options = {}) {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    title: "TunnelDesk",
    icon: iconPath(),
    show: false,
    backgroundColor: "#f4f6f8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });
  if (process.platform === "win32") {
    mainWindow.setAppDetails({
      appId: "com.zmide.tunneldesk",
      appIconPath: iconPath("icon.ico"),
      appIconIndex: 0,
      relaunchDisplayName: "TunnelDesk"
    });
  }
  if (options.openDesktopSettings) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow.webContents.executeJavaScript('openSettingsSection("settings-runtime")').catch(() => {});
    });
  }
  mainWindow.once("ready-to-show", () => {
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
  mainWindow.loadURL(webUrl);
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
  renderer.on?.("render-process-gone", () => cancelNativeSftpDragSessionsForSender(renderer, "界面进程已结束，拖出任务已取消"));
  renderer.once?.("destroyed", () => cancelNativeSftpDragSessionsForSender(renderer, "界面已关闭，拖出任务已取消"));
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

function rendererBelongsToDesktop(event) {
  return urlBelongsToDesktop(event.senderFrame?.url || event.sender?.getURL?.() || "");
}

function handleDesktopTheme(event, theme) {
  if (!rendererBelongsToDesktop(event)) return;
  applyDesktopTheme(theme);
}

function handleDesktopCapabilities(event) {
  const allowed = Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents && rendererBelongsToDesktop(event));
  event.returnValue = allowed
    ? displayClientMode
      ? {platform:process.platform, sftpExternalDrag:false, displayClient:true}
      : nativeSftpDrag?.capabilities?.() || {platform:process.platform, sftpExternalDrag:"staged"}
    : {platform:process.platform, sftpExternalDrag:false};
}

function sendSftpDragResult(event, requestId, ok, message="") {
  if (!event.sender.isDestroyed()) event.sender.send("tunneldesk:sftp-drag-result", {requestId, ok, message});
}

function sendSftpDragEvent(session, payload) {
  if (!session?.sender || session.sender.isDestroyed()) return;
  session.sender.send("tunneldesk:sftp-drag-event", {
    ...payload,
    requestId:session.requestId
  });
}

function normalizedNativeSftpDragEntries(payload) {
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  if (!entries.length || entries.length > 100) throw new Error("一次最多拖出 100 个文件或目录");
  const unique = new Map();
  for (const entry of entries) {
    const remotePath = String(entry?.path || "").replace(/\\/g, "/");
    if (!remotePath || remotePath.includes("\0") || remotePath.length > 4096) throw new Error("拖出的远端路径无效");
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
    title:String(value.title || (kind === "terminal" ? "终端" : kind === "local-files" ? "本地文件" : "SFTP")).slice(0, 256),
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
      || (cancelled ? "已取消拖出" : terminal.message)
      || (ok ? "" : "无法完成系统拖放");
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
        message = terminal.type === "completed" ? "拖出未完成" : "已取消拖出";
      } else if (outcome?.status === "failed") {
        succeeded = false;
        message ||= "拖出下载失败";
      }
    } catch (error) {
      console.warn("Failed to finish SFTP native drag task:", error);
    }
  }
  if (!session.sender.isDestroyed()) {
    session.sender.send("tunneldesk:sftp-drag-result", {
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
    nativeSftpDrag?.completeWrite?.(nativeEvent.requestId, "桌面后端不支持按项目写入");
    return;
  }
  session.pendingWrites += 1;
  if (!session.nativeJobStarted) {
    try {
      const task = beginNativeSftpDragJob?.(session.token, session.ticket);
      session.nativeJobStarted = Boolean(task?.id);
      if (session.nativeJobStarted) sendSftpDragEvent(session, {type:"transferStarted"});
    } catch (error) {
      console.warn("Failed to start macOS SFTP native drag task:", error);
    }
  }
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
    session.contentErrors.push(String(nativeEvent.message || "SFTP 拖出文件读取失败"));
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
  scheduleNativeSftpDragCancelFallback(session, "已取消拖出");
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
    session.terminalEvent = {type:"cancelled", message:String(message || "已取消拖出")};
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
        scheduleNativeSftpDragCancelFallback(session, "已取消拖出");
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
    sendSftpDragResult(event, requestId, false, "拖出文件已失效，请重新准备后再试");
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
    const message = error?.message || "无法启动系统拖拽";
    sendSftpDragResult(event, requestId, false, message);
  }
}

function handleStreamingSftpStartDrag(event, payload, requestId) {
  if (nativeSftpDrag?.capabilities?.().sftpExternalDrag !== "streaming") {
    sendSftpDragResult(event, requestId, false, nativeSftpDrag?.probe?.reason || "当前桌面环境不支持一次拖出");
    return;
  }
  if (nativeSftpDragSessions.has(requestId)) return;
  let token = "";
  try {
    const connectionId = Number(payload?.connectionId);
    if (!Number.isInteger(connectionId) || connectionId <= 0) throw new Error("SFTP 连接无效");
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
        session.terminalEvent = {type:"error", message:"拖出操作已超时"};
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
    sendSftpDragResult(event, requestId, false, error?.message || "无法启动系统拖放");
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
  // gives the WM a real activation request without leaving TunnelDesk
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
  const res = await fetch(`${webUrl}${pathname}`, options);
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
    const failed = trayState.failedForwards ? `，异常 ${trayState.failedForwards} 条` : "";
    tray.setToolTip(`TunnelDesk：正在转发 ${trayState.runningForwards}/${trayState.totalForwards} 条${failed}`);
    refreshTrayMenu();
  }
}

async function startAllForwards() {
  const connections = await fetchJson("/api/connections");
  for (const connection of connections.filter(item => (item.forwards || []).length)) {
    await fetchJson(`/api/connections/${connection.id}/start-forwards`, { method: "POST" });
  }
  await updateTrayState().catch(() => {});
  notify("已启动全部连接转发");
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
  notify("已停止全部连接转发");
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
      title: "TunnelDesk",
      content: body,
      icon: nativeImage.createFromPath(iconPath("icon.ico")),
      largeIcon: true
    });
    return;
  }
  if (desktopNotificationsAvailable()) new Notification({ title: "TunnelDesk", body, icon: iconPath("icon.png") }).show();
}

function buildAppMenu() {
  const settings = readSettings();
  Menu.setApplicationMenu(null);
  applyLoginSetting(settings);
}

function createTray() {
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip("TunnelDesk");
    tray.on("double-click", showWindow);
    refreshTrayMenu();
  } catch (error) {
    console.warn(`tray unavailable: ${error.message}`);
  }
}

function refreshTrayMenu() {
  if (!tray) return;
  const statusLabel = trayState.online
    ? `正在转发：${trayState.runningForwards}/${trayState.totalForwards} 条，连接 ${trayState.runningConnections} 个${trayState.failedForwards ? `，异常 ${trayState.failedForwards} 条` : ""}`
    : "正在转发：状态读取中";
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 TunnelDesk", click: showWindow },
    { label: "在浏览器打开", click: () => shell.openExternal(webUrl) },
    { label: statusLabel, enabled: false },
    { type: "separator" },
    { label: "启动全部转发", click: () => startAllForwards().catch(showError) },
    { label: "停止全部转发", click: () => stopAllConnectionForwards().catch(showError) },
    { type: "separator" },
    { label: "打开 .ssh 目录", click: () => shell.openPath(PROJECT_SSH_DIR) },
    { label: "打开日志目录", click: () => shell.openPath(LOG_DIR) },
    { label: "导出日志", click: exportLogs },
    { type: "separator" },
    { label: "退出 TunnelDesk", click: quitApp }
  ]));
}

function showError(error) {
  dialog.showErrorBox("TunnelDesk", error.message || String(error));
}

async function exportLogs() {
  try {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: "选择日志导出目录",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) return;
    const target = path.join(result.filePaths[0], `tunneldesk-logs-${timestampName()}`);
    fs.mkdirSync(target, { recursive: true });
    if (fs.existsSync(LOG_DIR)) fs.cpSync(LOG_DIR, target, { recursive: true });
    notify("日志已导出");
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
    project_mode_label: isWindowsPortable() ? "便携程序所在文件夹" : "项目所在文件夹"
  };
}

function normalizeDesktopSettings(value) {
  const current = readSettings();
  const projectModeAvailable = !app.isPackaged || isWindowsPortable();
  const requestedMode = String(value?.dataMode || current.dataMode);
  const allowedModes = new Set(projectModeAvailable ? ["project", "user", "custom"] : ["user", "custom"]);
  if (!allowedModes.has(requestedMode)) throw new Error("数据路径模式无效");
  const customDataDir = String(value?.customDataDir || "").trim();
  if (requestedMode === "custom" && !customDataDir) throw new Error("请选择自定义数据根目录");
  if (customDataDir.includes("\0")) throw new Error("自定义数据目录无效");
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
  const settings = normalizeDesktopSettings(value);
  writeSettings(settings);
  applyLoginSetting(settings);
  setTimeout(async () => {
    quitting = true;
    try { await Promise.resolve(shutdown()); } catch (error) { console.error(error); }
    relaunchInForeground();
    app.exit(0);
  }, 500);
  return { ok:true, restart_required:true };
}

async function chooseDesktopDataDir() {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: "选择 TunnelDesk 数据根目录",
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
  if (!fs.statSync(target).isDirectory()) throw new Error("SFTP 下载路径不是目录");
  fs.accessSync(target, fs.constants.W_OK);
  return target;
}

async function chooseDownloadDirectory() {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title:"选择 SFTP 自动保存目录",
    defaultPath:defaultDownloadDirectory(),
    properties:["openDirectory", "createDirectory"]
  });
  return result.canceled ? "" : result.filePaths[0];
}

async function chooseSyncDirectory() {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title:"选择本地同步目录",
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
  if (!fs.existsSync(target)) throw new Error("本地文件或目录不存在");
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
  return {ok:true, path:target};
}

async function openVsCodeRemote(value={}) {
  const user = String(value.user || "").trim();
  const host = String(value.host || "").trim();
  const port = Number(value.port || 22);
  const remotePath = String(value.path || "").replace(/\\/g, "/").trim();
  if (!user || !host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("VS Code Remote SSH 目标无效");
  const target = `${user}@${host}${port === 22 ? "" : `:${port}`}`;
  const suffix = remotePath ? `/${remotePath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}` : "";
  const uri = `vscode://vscode-remote/ssh-remote+${encodeURIComponent(target)}${suffix}`;
  await shell.openExternal(uri);
  return {ok:true};
}

async function openExternalFile(file, editor={}) {
  const target = path.resolve(String(file || ""));
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error("外部编辑临时文件不存在");
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
  if (mode !== "custom") throw new Error("外部编辑器类型无效");
  const executable = path.resolve(String(editor.path || ""));
  if (!path.isAbsolute(executable) || !fs.existsSync(executable) || !fs.statSync(executable).isFile()) throw new Error("自定义编辑器程序不存在");
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
    if (current.mode === "freerdp" && !current.available) await xServerRuntime.start();
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
    throw new Error("更新安装包路径无效");
  }
  const supported = process.platform === "win32"
    ? /\.exe$/i
    : process.platform === "darwin"
      ? /\.(?:dmg|zip)$/i
      : /\.(?:appimage|deb|rpm)$/i;
  if (!supported.test(target)) throw new Error("更新安装包类型与当前系统不匹配");
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
  if (!mainWindow || mainWindow.isDestroyed() || event?.sender !== mainWindow.webContents || !rendererBelongsToDesktop(event)) {
    throw new Error("剪贴板请求来源无效");
  }
}

function registerDesktopClipboardHandlers() {
  ipcMain.handle("tunneldesk:clipboard-read", event => {
    assertDesktopClipboardSender(event);
    return clipboard.readText();
  });
  ipcMain.handle("tunneldesk:clipboard-write", (event, text) => {
    assertDesktopClipboardSender(event);
    clipboard.writeText(String(text ?? ""));
    return {ok:true};
  });
}

function startDisplayClient() {
  const targetUrl = displayClientUrl();
  if (!targetUrl) {
    dialog.showErrorBox("TunnelDesk", "无法连接已经运行的 TunnelDesk 后端，请在当前图形会话中重新启动。");
    quitting = true;
    app.exit(1);
    return false;
  }
  webUrl = targetUrl;
  Menu.setApplicationMenu(null);
  ipcMain.on("tunneldesk:capabilities", handleDesktopCapabilities);
  ipcMain.on("tunneldesk:set-theme", handleDesktopTheme);
  createWindow({ displayClient:true });
  desktopStartupInProgress = false;
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
  const firstRun = !settingsExists();
  loadBackend();
  const startupDesktopSettings = readSettings();
  if (startupDesktopSettings.xServerAutoStart) {
    try { await xServerRuntime.start(); } catch (error) { console.warn(`X Server auto-start skipped: ${error.message}`); }
  }
  nativeSftpDrag = createNativeSftpDrag({
    app,
    nativeImage,
    screen,
    iconPath:iconPath("icon.png"),
    platform:process.platform,
    debug:NATIVE_SFTP_DRAG_DEBUG
  });
  setNativeSftpDragCancelHandler?.(cancelNativeSftpDragByToken);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PROJECT_SSH_DIR, { recursive: true });
  try {
    const desktopServerArgs = { ...parseServerArgs(), pidFile:PID_FILE };
    const backend = startServer(desktopServerArgs, {
      exitOnShutdown: false,
      onShutdown: () => {
        quitting = true;
        if (trayStateTimer) clearInterval(trayStateTimer);
        trayStateTimer = null;
        setTimeout(() => app.quit(), 0);
      },
      desktopIntegration: {
        getSettings: desktopSettingsView,
        saveSettings: saveDesktopSettings,
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
    const message = error?.code === "TUNNELDESK_ALREADY_RUNNING"
      ? `${error.message}\n\n请使用已经打开的 TunnelDesk 窗口，或先停止已有无界面服务。`
      : (error?.message || String(error));
    dialog.showErrorBox("TunnelDesk 启动失败", message);
    quitting = true;
    app.exit(1);
    return;
  }
  buildAppMenu();
  ipcMain.on("tunneldesk:capabilities", handleDesktopCapabilities);
  ipcMain.on("tunneldesk:set-theme", handleDesktopTheme);
  ipcMain.on("tunneldesk:sftp-start-drag", handleSftpStartDrag);
  ipcMain.on("tunneldesk:sftp-drag-activate", handleSftpDragActivate);
  ipcMain.on("tunneldesk:sftp-drag-target", handleSftpDragTarget);
  ipcMain.on("tunneldesk:sftp-drag-cancel", handleSftpDragCancel);
  createTray();
  createWindow({ openDesktopSettings:firstRun });
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
        notify(`管理界面：${webUrl}\n转发启动：成功 ${success}，失败 ${failed}${failed ? "；详情请查看系统日志" : ""}`);
      } catch {
        notify(`管理界面已启动：${webUrl}`);
      }
    }, 2200);
  }
});

app.on("activate", showWindow);

app.on("before-quit", () => {
  quitting = true;
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
