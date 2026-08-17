const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");
const { isLegacyBrandWindowsProcess } = require("../desktop/windows-brand-process");
const { createDesktopStorageTransition } = require("../desktop/storage-migration");

const root = path.resolve(__dirname, "..");
const desktopMainPath = path.join(root, "desktop", "main.js");
const desktopMainSource = fs.readFileSync(desktopMainPath, "utf8");
const desktopPreloadSource = fs.readFileSync(path.join(root, "desktop", "preload.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const readyMarker = "app.whenReady().then";
const readyIndex = desktopMainSource.indexOf(readyMarker);

assert.notEqual(readyIndex, -1, "desktop/main.js must contain the app.whenReady startup block");
assert.match(desktopMainSource, /org\.freedesktop\.Notifications/, "Linux notifications must verify the D-Bus service before showing");
assert.match(desktopMainSource, /desktopNotificationsAvailable\(\)/, "desktop notifications must use the availability probe");
assert.match(desktopMainSource, /startDesktopNotificationBridge\(\)/, "desktop startup must keep a main-process notification bridge active");
assert.match(desktopMainSource, /terma:notification-event/, "desktop notification events must be forwarded to the renderer");
assert.match(desktopPreloadSource, /onNotification\(callback\)/, "preload must expose the notification event bridge");
assert.match(desktopPreloadSource, /onNotificationAction\(callback\)/, "preload must expose notification actions without Node access");
assert.match(desktopPreloadSource, /setWindowTitle\(title\)[\s\S]*?terma:set-window-title/, "preload must expose the current resource title to the desktop window");
assert.match(desktopMainSource, /terma:set-window-title[\s\S]*?window !== mainWindow[\s\S]*?normalizeMainWindowTitle\(value\)[\s\S]*?window\.setTitle\(title\)/, "desktop window titles must stay scoped to the main renderer and normalize structural duplicates");
assert.match(appSource, /if \(!window\.termaDesktop\) pollNotifications\(\)/, "desktop renderer must not duplicate the main-process notification poll");
assert.match(desktopMainSource, /termaDisplaySession:\s*localLinuxDisplaySession/, "Linux second launches must report their graphical session with the Terma field");
assert.match(desktopMainSource, /additionalData\?\.termaDisplaySession\s*\|\|\s*additionalData\?\.tunneldeskDisplaySession/, "Linux second launches must still accept the legacy TunnelDesk field");
assert.match(desktopMainSource, /stdio:\s*\["ignore",\s*"ignore",\s*"ignore",\s*"ipc"\]/, "display clients must keep an IPC focus channel");
assert.match(desktopMainSource, /function createStartupWindow\(/, "packaged startup must provide an immediate startup window");
assert.match(desktopMainSource, /if \(!app\.isPackaged \|\| shouldStartInTray\(settings\)/, "the startup window must stay limited to packaged foreground launches");
assert.match(desktopMainSource, /show:false,[\s\S]*?window\.once\("ready-to-show", reveal\)/, "the packaged startup window must stay hidden until its content is ready");
assert.doesNotMatch(
  desktopMainSource.slice(0, readyIndex),
  /migrateLegacyBrandUserData\(\);/,
  "brand migration must not run before desktop storage settings are loaded"
);
assert.ok(
  desktopMainSource.indexOf("prepareLegacyBrandMigrationAtStartup(startupDesktopSettings, startupRuntime)")
    < desktopMainSource.indexOf("loadBackend(startupDesktopSettings)"),
  "eligible brand migration must finish before the backend opens the database"
);
assert.match(
  desktopMainSource.slice(readyIndex),
  /createStartupWindow\(startupDesktopSettings\);\s*try\s*\{[\s\S]*?loadBackend\(startupDesktopSettings\);[\s\S]*?\}\s*catch\s*\(error\)/,
  "desktop startup must catch backend-load failures and present them instead of leaving a hidden stalled process"
);

const testableSource = `${desktopMainSource.slice(0, readyIndex)}
globalThis.__desktopStartupTestApi = {
  START_IN_TRAY_ARG,
  DISPLAY_CLIENT_ARG,
  DISPLAY_CLIENT_URL_ENV,
  DESKTOP_TOKEN_ENV,
  DISPLAY_CLIENT_AUTH_MESSAGE,
  DISPLAY_CLIENT_AUTH_TIMEOUT_MS,
  displayClientMode,
  PRODUCT_NAME,
  PRODUCT_ID,
  legacyBrandUserDataPath,
  inspectLegacyBrandMigration,
  migrateLegacyBrandUserData,
  migrateLegacyBrandData,
  prepareLegacyBrandMigrationAtStartup,
  applyLoginSetting,
  shouldStartInTray,
  relaunchInForeground,
  createStartupWindow,
  closeStartupWindow,
  createWindow,
  bringMainWindowToFront,
  showWindow,
  normalizeLinuxDisplaySession,
  captureLinuxDisplaySession,
  linuxDisplaySessionKey,
  displayClientEnvironment,
  requestDisplayClient,
  flushPendingDisplayClients,
  handleSecondInstance,
  handleDisplayClientControlMessage,
  startDisplayClient,
  buildAppMenu,
  initializeDesktopSettingsFile,
  ensureDesktopSettingsFile,
  setDesktopInterfaceLanguage,
  handleDesktopInterfaceLanguage,
  getDesktopInterfaceLanguage: () => desktopInterfaceLanguage,
  isWindowsPortable,
  desktopStartupFailurePresentation,
  desktopNotificationAllowed,
  normalizeMainWindowTitle,
  userRuntimeRoot,
  legacyPackagedRoot,
  resolveRuntimePaths,
  prepareRuntimeSettings,
  desktopSettingsView,
  normalizeDesktopSettings,
  saveDesktopSettings,
  recoverPendingDesktopStorageMigration,
  setWebUrl: value => { webUrl = String(value || ""); },
  getWebUrl: () => webUrl,
  getPendingDisplayClientKeys: () => [...pendingDisplayClientSessions.keys()],
  getDisplayClientProcessKeys: () => [...displayClientProcesses.keys()],
  getDesktopAuthToken: () => desktopAuthToken,
  getPendingDisplayClientUrl: () => pendingDisplayClientUrl,
  getPendingStorageMigrationNotice: () => pendingStorageMigrationNotice
};`;

const temporaryRoots = [];
process.on("exit", () => {
  for (const directory of temporaryRoots) {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
  }
});

function createHarness({
  platform = "win32",
  argv = null,
  settings = { startMinimizedToTray: true },
  isPackaged = true,
  wasOpenedAtLogin = false,
  env = {},
  persistSettings = true,
  singleInstanceLock = true,
  legacyRunning = false,
  windowsProcesses = null,
  prepareFilesystem = null
} = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-desktop-check-"));
  temporaryRoots.push(temporaryRoot);
  const userData = path.join(temporaryRoot, "user-data");
  const appData = path.join(temporaryRoot, "appData");
  const legacyUserData = path.join(appData, "TunnelDesk");
  const defaultExecPath = platform === "darwin"
    ? path.join(temporaryRoot, "Applications", "Terma.app", "Contents", "MacOS", "terma")
    : path.join(temporaryRoot, "installed", platform === "win32" ? "terma.exe" : "terma");
  const processArgv = argv || [defaultExecPath];
  fs.mkdirSync(path.dirname(processArgv[0]), { recursive: true });
  const state = {
    loginSettings: [],
    relaunchOptions: [],
    windows: [],
    appEvents: new Map(),
    processEvents: new Map(),
    appFocusCalls: [],
    applicationMenus: [],
    ipcListeners: new Map(),
    singleInstanceRequests: [],
    appExitCalls: [],
    appQuitCount: 0,
    errorBoxes: [],
    appPathOverrides: new Map(),
    spawnCalls: [],
    scheduledTimeouts: [],
    desktopCookies: [],
    xServerRuntimeCreateCount: 0,
    temporaryRoot,
    appData,
    legacyUserData,
    userData,
    execPath: processArgv[0],
    settingsFile: path.join(userData, "desktop-settings.json")
  };
  if (typeof prepareFilesystem === "function") prepareFilesystem(state);
  if (persistSettings) {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(state.settingsFile, JSON.stringify(settings, null, 2), "utf8");
  }

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.visible = false;
      this.showCount = 0;
      this.hideCount = 0;
      this.restoreCount = 0;
      this.focusCount = 0;
      this.moveTopCount = 0;
      this.alwaysOnTop = false;
      this.alwaysOnTopCalls = [];
      this.visibleOnAllWorkspacesCalls = [];
      this.minimized = false;
      this.loadedUrl = "";
      this.onceHandlers = new Map();
      this.handlers = new Map();
      this.webContentsOnceHandlers = new Map();
      this.webContents = {
        session: {
          cookies: {
            set: details => {
              state.desktopCookies.push(details);
              return Promise.resolve();
            }
          }
        },
        once: (event, handler) => {
          this.webContentsOnceHandlers.set(event, handler);
        },
        on() {},
        getURL: () => this.loadedUrl || "",
        setWindowOpenHandler: handler => {
          this.windowOpenHandler = handler;
        }
      };
      state.windows.push(this);
    }

    setAppDetails(details) {
      this.appDetails = details;
    }

    loadURL(url) {
      this.loadedUrl = url;
    }

    once(event, handler) {
      this.onceHandlers.set(event, handler);
    }

    on(event, handler) {
      this.handlers.set(event, handler);
    }

    emitOnce(event) {
      const handler = this.onceHandlers.get(event);
      assert.ok(handler, `missing ${event} handler`);
      this.onceHandlers.delete(event);
      handler();
    }

    emitWebContentsOnce(event) {
      const handler = this.webContentsOnceHandlers.get(event);
      assert.ok(handler, `missing webContents ${event} handler`);
      this.webContentsOnceHandlers.delete(event);
      handler();
    }

    show() {
      this.visible = true;
      this.showCount += 1;
    }

    hide() {
      this.visible = false;
      this.hideCount += 1;
    }

    isMinimized() {
      return this.minimized;
    }

    restore() {
      this.minimized = false;
      this.restoreCount += 1;
    }

    focus() {
      this.focusCount += 1;
    }

    isAlwaysOnTop() {
      return this.alwaysOnTop;
    }

    setAlwaysOnTop(value) {
      this.alwaysOnTop = Boolean(value);
      this.alwaysOnTopCalls.push(this.alwaysOnTop);
    }

    setVisibleOnAllWorkspaces(value) {
      this.visibleOnAllWorkspacesCalls.push(Boolean(value));
    }

    moveTop() {
      this.moveTopCount += 1;
    }

    isDestroyed() {
      return false;
    }
  }

  const app = {
    isPackaged,
    setName() {},
    setPath: (name, value) => state.appPathOverrides.set(name, value),
    setAppUserModelId() {},
    setToastActivatorCLSID() {},
    requestSingleInstanceLock: value => {
      state.singleInstanceRequests.push(value);
      return singleInstanceLock;
    },
    on: (event, handler) => {
      const handlers = state.appEvents.get(event) || [];
      handlers.push(handler);
      state.appEvents.set(event, handlers);
    },
    exit: code => state.appExitCalls.push(code),
    quit: () => { state.appQuitCount += 1; },
    getPath: name => state.appPathOverrides.get(name) || (name === "userData" ? userData : path.join(temporaryRoot, name)),
    getLoginItemSettings: () => ({ wasOpenedAtLogin }),
    setLoginItemSettings: value => state.loginSettings.push(value),
    relaunch: value => state.relaunchOptions.push(value),
    focus: value => state.appFocusCalls.push(value)
  };

  const electron = {
    app,
    BrowserWindow: FakeBrowserWindow,
    Menu: {
      buildFromTemplate: template => template,
      setApplicationMenu: menu => state.applicationMenus.push(menu)
    },
    Notification: { isSupported: () => false },
    Tray: class {},
    dialog: {
      showErrorBox: (title, message) => state.errorBoxes.push({title, message})
    },
    ipcMain: {
      handle() {},
      on: (event, handler) => state.ipcListeners.set(event, handler)
    },
    nativeImage: {},
    nativeTheme: {},
    screen: {},
    shell: { openExternal() {} }
  };

  const context = vm.createContext({
    Buffer,
    URL,
    console,
    clearInterval,
    clearTimeout: timerId => {
      const timer = state.scheduledTimeouts[timerId - 1];
      if (timer) timer.cancelled = true;
    },
    setInterval,
    setTimeout: (handler, delay) => {
      state.scheduledTimeouts.push({handler, delay, cancelled:false});
      return state.scheduledTimeouts.length;
    },
    __dirname: path.dirname(desktopMainPath),
    process: {
      argv: [...processArgv],
      env: { ...env },
      execPath: processArgv[0],
      platform,
      pid: process.pid,
      on: (event, handler) => state.processEvents.set(event, handler)
    },
    require(id) {
      if (id === "electron") return electron;
      if (id === "node:crypto") return { randomBytes: size => Buffer.alloc(size, 0x5a) };
      if (id === "node:fs") return fs;
      if (id === "node:path") return path;
      if (id === "node:child_process") return {
        spawn: (command, args, options) => {
          const handlers = new Map();
          const child = {
            exitCode: null,
            killed: false,
            killCount: 0,
            messages: [],
            once(event, handler) { handlers.set(event, handler); },
            send(message, callback) {
              this.messages.push(message);
              if (typeof callback === "function") callback(null);
            },
            kill() {
              this.killed = true;
              this.killCount += 1;
            },
            emit(event, value) {
              const handler = handlers.get(event);
              if (handler) handler(value);
            }
          };
          state.spawnCalls.push({ command, args, options, child });
          return child;
        },
        spawnSync: (command, args) => {
          const executable = String(command || "").toLowerCase();
          const requested = (args || []).map(value => String(value).toLowerCase());
          const legacyProbe = executable.includes("tasklist") || executable.includes("pgrep");
          if (legacyRunning && legacyProbe && requested.some(value => value.includes("tunneldesk"))) {
            return {status:0, stdout:platform === "win32" ? "TunnelDesk.exe 123 Console" : "123", stderr:""};
          }
          if (platform === "win32" && executable.includes("powershell") && windowsProcesses !== null) {
            const processList = typeof windowsProcesses === "function" ? windowsProcesses(state) : windowsProcesses;
            return {status:0, stdout:JSON.stringify(processList || []), stderr:""};
          }
          return {status:1, stdout:"", stderr:""};
        }
      };
      if (id === "./browser-authorization-prompt") return require(path.join(root, "desktop", "browser-authorization-prompt.js"));
      if (id === "./native-sftp-drag") return {
        createNativeSftpDrag: () => ({
          probe: {available:false},
          capabilities: () => ({platform, sftpExternalDrag:"staged"}),
          dispose() {}
        })
      };
      if (id === "./remote-clients") return {
        createRemoteClientAdapter: () => ({
          diagnostics: () => ({platform, rdp:{available:false}, vnc:{available:false}}),
          open: async () => ({ok:true})
        })
      };
      if (id === "./xserver-runtime") return {
        createXServerRuntime: () => {
          state.xServerRuntimeCreateCount += 1;
          return {
            diagnostics: () => ({platform, installed:false, running:false}),
            start: async () => ({ok:true}),
            stop: async () => ({ok:true}),
            installXQuartz: async () => ({ok:true}),
            openXdmcp: async () => ({ok:true}),
            testXdmcp: async () => ({ok:true}),
            dispose: async () => {}
          };
        }
      };
      if (id === "./brand-data-migration") return require(path.join(root, "desktop", "brand-data-migration.js"));
      if (id === "./storage-migration") return require(path.join(root, "desktop", "storage-migration.js"));
      if (id === "./windows-brand-process") return require(path.join(root, "desktop", "windows-brand-process.js"));
      throw new Error(`unexpected require in desktop startup check: ${id}`);
    }
  });

  vm.runInContext(testableSource, context, { filename: desktopMainPath });
  if (!context.__desktopStartupTestApi.displayClientMode) context.__desktopStartupTestApi.initializeDesktopSettingsFile();
  return { api: context.__desktopStartupTestApi, state };
}

function check(name, callback) {
  callback();
  console.log(`PASS ${name}`);
}

check("Windows login startup receives the tray-only argument", () => {
  const { api, state } = createHarness();
  api.applyLoginSetting({ openAtLogin: true, startMinimizedToTray: true });
  assert.equal(state.loginSettings.length, 1);
  assert.equal(state.loginSettings[0].openAtLogin, true);
  assert.equal(state.loginSettings[0].path, state.execPath);
  assert.deepEqual(Array.from(state.loginSettings[0].args), [api.START_IN_TRAY_ARG]);
});

check("Windows foreground login startup omits the tray-only argument", () => {
  const { api, state } = createHarness();
  api.applyLoginSetting({ openAtLogin: true, startMinimizedToTray: false });
  assert.deepEqual(Array.from(state.loginSettings[0].args), []);
});

check("Existing Windows login settings are migrated during normal startup setup", () => {
  const { api, state } = createHarness({ settings: { openAtLogin: true, startMinimizedToTray: true } });
  api.buildAppMenu();
  assert.equal(state.loginSettings.length, 1);
  assert.equal(state.loginSettings[0].openAtLogin, true);
  assert.deepEqual(Array.from(state.loginSettings[0].args), [api.START_IN_TRAY_ARG]);
});

check("Packaged startup window waits for rendered content before becoming visible", () => {
  const { api, state } = createHarness({ settings:{startMinimizedToTray:false} });
  const window = api.createStartupWindow({startMinimizedToTray:false});
  assert.ok(window);
  assert.equal(window.options.show, false);
  assert.equal(window.visible, false);
  assert.equal(window.showCount, 0);
  assert.match(window.loadedUrl, /^data:text\/html/);
  window.emitOnce("ready-to-show");
  assert.equal(window.visible, true);
  assert.equal(window.showCount, 1);
  assert.equal(state.windows.length, 1);
});

check("Packaged startup window follows the persisted interface language", () => {
  const { api, state } = createHarness({
    settings:{startMinimizedToTray:false, interfaceLanguage:"en-US"}
  });
  api.setDesktopInterfaceLanguage("en-US", true);
  assert.equal(api.getDesktopInterfaceLanguage(), "en-US");
  const window = api.createStartupWindow({startMinimizedToTray:false, interfaceLanguage:"en-US"});
  assert.equal(window.options.title, "Terma is starting");
  const html = decodeURIComponent(String(window.loadedUrl).split(",", 2)[1] || "");
  assert.match(html, />Terma is starting</);
  assert.match(html, />Preparing services and workspace\.\.\.</);
  assert.equal(JSON.parse(fs.readFileSync(state.settingsFile, "utf8")).interfaceLanguage, "en-US");
});

function createMarkerDatabase(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO app_meta(key,value) VALUES(?,?)");
  for (const [key, value] of Object.entries(entries)) insert.run(key, value);
  db.close();
}

function markerValue(file, key) {
  const db = new DatabaseSync(file, { readOnly:true });
  try { return db.prepare("SELECT value FROM app_meta WHERE key=?").get(key)?.value; }
  finally { db.close(); }
}

check("Desktop application menu is hidden without changing tray menu setup", () => {
  const { api, state } = createHarness();
  api.buildAppMenu();
  assert.deepEqual(state.applicationMenus, [null]);
});

check("First desktop startup persists defaults so settings opens only once", () => {
  const { api, state } = createHarness({ platform:"linux", isPackaged:false, persistSettings:false });
  assert.equal(fs.existsSync(state.settingsFile), false);
  assert.equal(api.ensureDesktopSettingsFile(), true);
  assert.equal(fs.existsSync(state.settingsFile), true);
  assert.equal(JSON.parse(fs.readFileSync(state.settingsFile, "utf8")).dataMode, "project");
  assert.equal(api.ensureDesktopSettingsFile(), false);
});

check("Manual Windows launch remains visible even when login startup is configured for the tray", () => {
  const { api, state } = createHarness({
    argv: ["terma.exe"],
    settings: { startMinimizedToTray: true }
  });
  assert.equal(api.shouldStartInTray({ startMinimizedToTray: true }), false);
  api.createWindow();
  const window = state.windows[0];
  window.emitOnce("ready-to-show");
  assert.equal(window.visible, true);
  assert.equal(window.showCount, 1);
  assert.equal(window.hideCount, 0);
  assert.equal(window.restoreCount, 0);
  assert.equal(window.moveTopCount, 1);
  assert.equal(window.focusCount, 1);
  assert.equal(state.appFocusCalls.length, 1);
});

check("Desktop window uses the isolated native-theme bridge", () => {
  const { api, state } = createHarness();
  api.createWindow();
  const window = state.windows[0];
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.backgroundThrottling, false);
  assert.equal(window.options.webPreferences.preload, path.join(root, "desktop", "preload.js"));
});

check("Desktop interface language follows the trusted renderer immediately", () => {
  const { api, state } = createHarness({settings:{interfaceLanguage:"zh-CN"}});
  api.setWebUrl("http://127.0.0.1:8088");
  api.createWindow();
  api.handleDesktopInterfaceLanguage({
    senderFrame:{url:"http://127.0.0.1:8088/settings"}
  }, "en-US");
  assert.equal(api.getDesktopInterfaceLanguage(), "en-US");
  assert.equal(JSON.parse(fs.readFileSync(state.settingsFile, "utf8")).interfaceLanguage, "en-US");
  api.handleDesktopInterfaceLanguage({
    senderFrame:{url:"https://example.invalid/settings"}
  }, "zh-CN");
  assert.equal(api.getDesktopInterfaceLanguage(), "en-US");
});

check("Explicit Windows login launch starts in the tray", () => {
  const argv = ["terma.exe", "--start-in-tray"];
  const { api, state } = createHarness({ argv });
  assert.equal(api.shouldStartInTray({ startMinimizedToTray: true }), true);
  api.createWindow();
  const window = state.windows[0];
  window.emitOnce("ready-to-show");
  assert.equal(window.visible, false);
  assert.equal(window.showCount, 0);
  assert.equal(window.hideCount, 1);
  assert.equal(window.moveTopCount, 0);
  assert.equal(window.focusCount, 0);
  assert.equal(state.appFocusCalls.length, 0);
});

check("Foreground activation restores a minimized desktop window before focusing it", () => {
  const { api, state } = createHarness({ argv: ["terma.exe"] });
  api.createWindow();
  const window = state.windows[0];
  window.minimized = true;
  assert.equal(api.bringMainWindowToFront(), true);
  assert.equal(window.minimized, false);
  assert.equal(window.restoreCount, 1);
  assert.equal(window.showCount, 1);
  assert.equal(window.moveTopCount, 1);
  assert.equal(window.focusCount, 1);
});

check("Linux foreground activation raises a hidden window without leaving it always on top", () => {
  const { api, state } = createHarness({ platform: "linux", argv: ["terma"] });
  api.createWindow();
  const window = state.windows[0];
  window.hide();
  assert.equal(api.bringMainWindowToFront(), true);
  assert.equal(window.visible, true);
  assert.deepEqual(window.alwaysOnTopCalls, [true, false]);
  assert.deepEqual(window.visibleOnAllWorkspacesCalls, [true, false]);
  assert.equal(state.appFocusCalls.length, 0);
});

check("Linux single-instance registration includes the current DISPLAY session", () => {
  const { state } = createHarness({
    platform: "linux",
    env: {
      DISPLAY: ":0",
      XAUTHORITY: "/run/user/1000/xauth-main",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus"
    }
  });
  assert.equal(state.singleInstanceRequests.length, 1);
  const session = state.singleInstanceRequests[0].termaDisplaySession;
  assert.equal(session.DISPLAY, ":0");
  assert.equal(session.XAUTHORITY, "/run/user/1000/xauth-main");
  assert.equal(session.DBUS_SESSION_BUS_ADDRESS, "unix:path=/run/user/1000/bus");
});

check("A second launch on the same Linux DISPLAY focuses the existing window", () => {
  const { api, state } = createHarness({ platform:"linux", argv:["terma"], env:{DISPLAY:":0"} });
  api.setWebUrl("http://127.0.0.1:8088");
  api.createWindow();
  const window = state.windows[0];
  assert.equal(state.desktopCookies.length, 1);
  assert.equal(state.desktopCookies[0].name, "td_desktop");
  assert.equal(state.desktopCookies[0].httpOnly, true);
  assert.equal(state.desktopCookies[0].sameSite, "strict");
  window.emitOnce("ready-to-show");
  window.hide();
  const secondInstance = state.appEvents.get("second-instance")?.[0];
  secondInstance(null, [], "", {tunneldeskDisplaySession:{DISPLAY:":0"}});
  assert.equal(window.visible, true);
  assert.equal(state.spawnCalls.length, 0);
  assert.equal(state.appFocusCalls.length, 0);
});

check("A second launch on another Linux DISPLAY queues one isolated display client until the backend is ready", () => {
  const { api, state } = createHarness({
    platform:"linux",
    env:{
      DISPLAY:":0",
      XAUTHORITY:"/run/user/1000/xauth-main",
      DBUS_SESSION_BUS_ADDRESS:"unix:path=/run/user/1000/main-bus",
      XDG_SESSION_ID:"4"
    }
  });
  const secondInstance = state.appEvents.get("second-instance")?.[0];
  const targetSession = {
    DISPLAY:":3",
    XAUTHORITY:"/run/user/1000/xauth-xdmcp",
    DBUS_SESSION_BUS_ADDRESS:"unix:path=/run/user/1000/xdmcp-bus",
    XDG_SESSION_ID:"8",
    XDG_SESSION_TYPE:"x11"
  };
  secondInstance(null, [], "", {termaDisplaySession:targetSession});
  assert.deepEqual(Array.from(api.getPendingDisplayClientKeys()), ["x11::3"]);
  assert.equal(state.spawnCalls.length, 0);

  api.setWebUrl("http://127.0.0.1:8088");
  assert.equal(api.flushPendingDisplayClients(), 1);
  assert.equal(state.spawnCalls.length, 1);
  const spawned = state.spawnCalls[0];
  assert.equal(spawned.command, state.execPath);
  assert.equal(spawned.args.includes(api.DISPLAY_CLIENT_ARG), true);
  assert.deepEqual(Array.from(spawned.options.stdio), ["ignore", "ignore", "ignore", "ipc"]);
  assert.equal(spawned.options.env.DISPLAY, ":3");
  assert.equal(spawned.options.env.XAUTHORITY, "/run/user/1000/xauth-xdmcp");
  assert.equal(spawned.options.env.DBUS_SESSION_BUS_ADDRESS, "unix:path=/run/user/1000/xdmcp-bus");
  assert.equal(spawned.options.env[api.DISPLAY_CLIENT_URL_ENV], "http://127.0.0.1:8088/");
  assert.equal(spawned.options.env[api.DESKTOP_TOKEN_ENV], undefined);
  assert.equal(spawned.options.env.TUNNELDESK_DESKTOP_AUTH_TOKEN, undefined);
  assert.equal(spawned.child.messages.length, 1);
  assert.equal(spawned.child.messages[0].type, api.DISPLAY_CLIENT_AUTH_MESSAGE);
  assert.equal(spawned.child.messages[0].token, api.getDesktopAuthToken());

  secondInstance(null, [], "", {termaDisplaySession:targetSession});
  assert.equal(state.spawnCalls.length, 1);
  assert.equal(state.spawnCalls[0].child.messages.length, 2);
  assert.equal(state.spawnCalls[0].child.messages[1].type, "show");
  assert.deepEqual(Array.from(api.getDisplayClientProcessKeys()), ["x11::3"]);
});

check("Linux display-client mode skips the backend profile and handles an early focus request", () => {
  const { api, state } = createHarness({
    platform:"linux",
    argv:["terma", "--terma-display-client"],
    env:{
      DISPLAY:":3",
      TERMA_DISPLAY_CLIENT_URL:"http://127.0.0.1:8088",
      TERMA_DESKTOP_AUTH_TOKEN:"must-not-be-used"
    },
    persistSettings:false
  });
  assert.equal(api.displayClientMode, true);
  assert.equal(state.singleInstanceRequests.length, 0);
  assert.equal(state.xServerRuntimeCreateCount, 0);
  assert.notEqual(state.appPathOverrides.get("userData"), state.userData);
  assert.equal(state.appPathOverrides.get("sessionData"), state.appPathOverrides.get("userData"));
  assert.equal(fs.existsSync(state.settingsFile), false);

  const message = state.processEvents.get("message");
  assert.equal(typeof message, "function");
  message({type:"show"});
  assert.equal(state.windows.length, 0);
  assert.equal(api.startDisplayClient(), true);
  assert.equal(api.getWebUrl(), "");
  assert.equal(api.getDesktopAuthToken(), "");
  assert.equal(api.getPendingDisplayClientUrl(), "http://127.0.0.1:8088/");
  assert.equal(state.windows.length, 0);
  message({type:api.DISPLAY_CLIENT_AUTH_MESSAGE, token:"a".repeat(43)});
  assert.equal(api.getWebUrl(), "http://127.0.0.1:8088/");
  assert.equal(state.windows.length, 1);
  assert.equal(state.ipcListeners.has("terma:capabilities"), true);
  assert.equal(state.ipcListeners.has("terma:set-theme"), true);
  const window = state.windows[0];
  window.emitWebContentsOnce("did-finish-load");
  const revealTimer = state.scheduledTimeouts.find(timer => timer.delay === 120 && !timer.cancelled);
  assert.ok(revealTimer, "display client must schedule a did-finish-load reveal fallback");
  revealTimer.handler();
  assert.equal(window.visible, true);
  assert.equal(state.appFocusCalls.length, 0);
  assert.equal(fs.existsSync(state.settingsFile), false);
});

check("Linux display-client mode still accepts legacy TunnelDesk arguments and environment", () => {
  const { api, state } = createHarness({
    platform:"linux",
    argv:["tunneldesk", "--tunneldesk-display-client"],
    env:{
      DISPLAY:":4",
      TUNNELDESK_DISPLAY_CLIENT_URL:"http://127.0.0.1:8090",
      TUNNELDESK_DESKTOP_AUTH_TOKEN:"legacy-token-must-not-be-used"
    },
    persistSettings:false
  });
  assert.equal(api.displayClientMode, true);
  assert.equal(api.startDisplayClient(), true);
  assert.equal(state.windows.length, 0);
  state.processEvents.get("message")({type:api.DISPLAY_CLIENT_AUTH_MESSAGE, token:"b".repeat(43)});
  assert.equal(api.getWebUrl(), "http://127.0.0.1:8090/");
  assert.equal(state.windows.length, 1);
  assert.equal(state.xServerRuntimeCreateCount, 0);
});

check("Linux display-client mode rejects an invalid IPC token before opening a window", () => {
  const { api, state } = createHarness({
    platform:"linux",
    argv:["terma", "--terma-display-client"],
    env:{TERMA_DISPLAY_CLIENT_URL:"http://127.0.0.1:8088"},
    persistSettings:false
  });
  assert.equal(api.startDisplayClient(), true);
  state.processEvents.get("message")({type:api.DISPLAY_CLIENT_AUTH_MESSAGE, token:"short"});
  assert.equal(state.windows.length, 0);
  assert.deepEqual(state.appExitCalls, [1]);
  assert.match(state.errorBoxes[0].message, /认证令牌无效/);
});

check("Linux display-client mode exits when the IPC token does not arrive", () => {
  const { api, state } = createHarness({
    platform:"linux",
    argv:["terma", "--terma-display-client"],
    env:{TERMA_DISPLAY_CLIENT_URL:"http://127.0.0.1:8088"},
    persistSettings:false
  });
  assert.equal(api.startDisplayClient(), true);
  const timeout = state.scheduledTimeouts.find(timer => timer.delay === api.DISPLAY_CLIENT_AUTH_TIMEOUT_MS && !timer.cancelled);
  assert.ok(timeout, "display client must fail closed when the IPC token never arrives");
  timeout.handler();
  assert.equal(state.windows.length, 0);
  assert.deepEqual(state.appExitCalls, [1]);
  assert.match(state.errorBoxes[0].message, /等待桌面认证令牌超时/);
});

check("Second launch before the first window exists waits for ready-to-show", () => {
  const { api, state } = createHarness({ platform: "linux", argv: ["terma"] });
  const secondInstance = state.appEvents.get("second-instance")?.[0];
  assert.equal(typeof secondInstance, "function");
  secondInstance();
  assert.equal(state.windows.length, 0);
  api.createWindow();
  const window = state.windows[0];
  window.emitOnce("ready-to-show");
  assert.equal(window.visible, true);
  assert.equal(window.loadedUrl, "");
});

check("Second launch reveals a hidden Linux window", () => {
  const { api, state } = createHarness({ platform: "linux", argv: ["terma"] });
  api.createWindow();
  const window = state.windows[0];
  window.emitOnce("ready-to-show");
  window.hide();
  const secondInstance = state.appEvents.get("second-instance")?.[0];
  secondInstance();
  assert.equal(window.visible, true);
  assert.equal(window.alwaysOnTop, false);
});

check("macOS only starts in the tray for an actual login launch", () => {
  const loginLaunch = createHarness({ platform: "darwin", wasOpenedAtLogin: true });
  const manualLaunch = createHarness({ platform: "darwin", wasOpenedAtLogin: false });
  assert.equal(loginLaunch.api.shouldStartInTray({ startMinimizedToTray: true }), true);
  assert.equal(manualLaunch.api.shouldStartInTray({ startMinimizedToTray: true }), false);
});

check("macOS manual launch reveals after page load when ready-to-show is missing", () => {
  const { api, state } = createHarness({
    platform: "darwin",
    wasOpenedAtLogin: false,
    settings: { startMinimizedToTray: false }
  });
  api.createWindow();
  const window = state.windows[0];
  window.emitWebContentsOnce("did-finish-load");
  const revealTimer = state.scheduledTimeouts.find(timer => timer.delay === 120 && !timer.cancelled);
  assert.ok(revealTimer, "manual macOS launch must schedule a page-load reveal fallback");
  revealTimer.handler();
  assert.equal(window.visible, true);
  assert.equal(window.showCount, 1);
  assert.equal(state.appFocusCalls.length, 1);
  assert.equal(state.appFocusCalls[0].steal, true);
});

check("macOS login launch stays hidden when page load precedes ready-to-show", () => {
  const { api, state } = createHarness({
    platform: "darwin",
    wasOpenedAtLogin: true,
    settings: { startMinimizedToTray: true }
  });
  api.createWindow();
  const window = state.windows[0];
  window.emitWebContentsOnce("did-finish-load");
  assert.equal(state.scheduledTimeouts.some(timer => timer.delay === 120 && !timer.cancelled), false);
  assert.equal(window.visible, false);
  window.emitOnce("ready-to-show");
  assert.equal(window.hideCount, 1);
  assert.equal(window.visible, false);
});

check("Relaunch removes every tray-only argument and preserves other arguments", () => {
  const { api, state } = createHarness({
    argv: ["terma.exe", "app.asar", "--start-in-tray", "--inspect=9229", "--start-in-tray"]
  });
  api.relaunchInForeground();
  assert.equal(state.relaunchOptions.length, 1);
  assert.deepEqual(Array.from(state.relaunchOptions[0].args), ["app.asar", "--inspect=9229"]);
});

check("Unpackaged desktop keeps the repository runtime directories", () => {
  const { api } = createHarness({ isPackaged: false, persistSettings: false });
  const paths = api.resolveRuntimePaths({ dataMode: "project", customDataDir: "" });
  assert.equal(paths.dataDir, path.join(root, "data"));
  assert.equal(paths.sshDir, path.join(root, ".ssh"));
});

check("Packaged desktop defaults to the user runtime directory", () => {
  const { api, state } = createHarness({ platform: "linux", persistSettings: false });
  const settings = api.prepareRuntimeSettings();
  const paths = api.resolveRuntimePaths(settings);
  assert.equal(settings.dataMode, "user");
  assert.equal(paths.dataDir, path.join(state.userData, "runtime", "data"));
  assert.equal(paths.sshDir, path.join(state.userData, "runtime", ".ssh"));
  assert.equal(api.desktopSettingsView().project_mode_available, false);
});

check("Packaged Terma automatically migrates persistent TunnelDesk data into an empty profile", () => {
  const { api, state } = createHarness({
    platform: "linux",
    persistSettings: false,
    prepareFilesystem({ legacyUserData }) {
      fs.mkdirSync(path.join(legacyUserData, "runtime", "data"), { recursive: true });
      fs.mkdirSync(path.join(legacyUserData, "runtime", ".ssh"), { recursive: true });
      fs.mkdirSync(path.join(legacyUserData, "Cache"), { recursive: true });
      fs.mkdirSync(path.join(legacyUserData, "runtime", "data", "offline-task-old"), { recursive: true });
      createMarkerDatabase(path.join(legacyUserData, "runtime", "data", "tunnels.db"), { legacy:"legacy database" });
      fs.writeFileSync(path.join(legacyUserData, "runtime", "data", "web.pid"), "123", "utf8");
      fs.writeFileSync(path.join(legacyUserData, "runtime", "data", "offline-task-old", "payload.bin"), "temporary", "utf8");
      fs.writeFileSync(path.join(legacyUserData, "runtime", ".ssh", "id_ed25519"), "legacy key", "utf8");
      fs.writeFileSync(path.join(legacyUserData, "desktop-settings.json"), JSON.stringify({ dataMode: "user" }), "utf8");
      fs.writeFileSync(path.join(legacyUserData, "Cache", "cache.bin"), "cache", "utf8");
      fs.writeFileSync(path.join(legacyUserData, "SingletonLock"), "lock", "utf8");
    }
  });

  api.prepareLegacyBrandMigrationAtStartup(api.prepareRuntimeSettings());
  const migration = api.inspectLegacyBrandMigration();
  assert.equal(migration.status, "migrated");
  assert.equal(migration.completed, true);
  assert.equal(migration.last_migration.product, "Terma");
  assert.equal(migration.last_migration.legacy_product, "TunnelDesk");
  assert.equal(migration.last_migration.preserved_legacy_directory, true);
  assert.equal(markerValue(path.join(state.userData, "runtime", "data", "tunnels.db"), "legacy"), "legacy database");
  assert.equal(fs.readFileSync(path.join(state.userData, "runtime", ".ssh", "id_ed25519"), "utf8"), "legacy key");
  assert.equal(fs.existsSync(path.join(state.userData, "runtime", "data", "web.pid")), false);
  assert.equal(fs.existsSync(path.join(state.userData, "runtime", "data", "offline-task-old")), false);
  assert.equal(fs.existsSync(path.join(state.userData, "Cache")), false);
  assert.equal(fs.existsSync(path.join(state.userData, "SingletonLock")), false);
  assert.equal(fs.existsSync(path.join(state.legacyUserData, "runtime", "data", "tunnels.db")), true);
});

check("Confirmed brand migration backs up and merges the active Terma runtime", () => {
  const customRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "terma-brand-custom-runtime-"));
  temporaryRoots.push(customRuntime);
  const { api, state } = createHarness({
    platform: "linux",
    isPackaged: false,
    settings: { dataMode:"custom", customDataDir:customRuntime },
    prepareFilesystem({ legacyUserData }) {
      fs.mkdirSync(path.join(legacyUserData, "runtime", "data"), { recursive: true });
      createMarkerDatabase(path.join(legacyUserData, "runtime", "data", "tunnels.db"), { legacy:"legacy database" });
      createMarkerDatabase(path.join(customRuntime, "data", "tunnels.db"), { current:"current database" });
    }
  });

  const startup = api.prepareLegacyBrandMigrationAtStartup(api.prepareRuntimeSettings());
  assert.equal(startup.status, "available");
  const preview = api.inspectLegacyBrandMigration();
  assert.equal(preview.source_available, true);
  assert.equal(preview.target_has_data, true);
  assert.equal(preview.target_data_dir, path.join(customRuntime, "data"));
  assert.equal(markerValue(path.join(customRuntime, "data", "tunnels.db"), "current"), "current database");

  const migration = api.migrateLegacyBrandUserData({
    manual:true,
    force:true,
    target_data_dir:path.join(customRuntime, "data"),
    target_ssh_dir:path.join(customRuntime, ".ssh")
  });
  assert.equal(migration.status, "migrated");
  assert.match(path.basename(migration.backup), /^\.terma-brand-migration-backup-/);
  assert.equal(markerValue(path.join(customRuntime, "data", "tunnels.db"), "current"), "current database");
  assert.equal(markerValue(path.join(customRuntime, "data", "tunnels.db"), "legacy"), "legacy database");
  assert.equal(markerValue(path.join(migration.backup, "data", "tunnels.db"), "current"), "current database");
  assert.equal(fs.existsSync(path.join(state.legacyUserData, "runtime", "data", "tunnels.db")), true);
});

check("Project and custom runtimes keep legacy data pending until the user confirms", () => {
  const customRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "terma-brand-unpackaged-runtime-"));
  temporaryRoots.push(customRuntime);
  const { api, state } = createHarness({
    platform: "win32",
    isPackaged: false,
    settings: { dataMode:"custom", customDataDir:customRuntime },
    prepareFilesystem({ legacyUserData }) {
      fs.mkdirSync(path.join(legacyUserData, "runtime", "data"), { recursive: true });
      createMarkerDatabase(path.join(legacyUserData, "runtime", "data", "tunnels.db"), { legacy:"legacy database" });
      createMarkerDatabase(path.join(customRuntime, "data", "tunnels.db"), { current:"current database" });
    }
  });

  const startup = api.prepareLegacyBrandMigrationAtStartup(api.prepareRuntimeSettings());
  const migration = api.inspectLegacyBrandMigration();
  assert.equal(startup.status, "available");
  assert.equal(migration.status, "available");
  assert.equal(migration.completed, false);
  assert.equal(markerValue(path.join(customRuntime, "data", "tunnels.db"), "current"), "current database");
  assert.equal(markerValue(path.join(customRuntime, "data", "tunnels.db"), "legacy"), undefined);
  assert.equal(fs.existsSync(path.join(state.legacyUserData, "runtime", "data", "tunnels.db")), true);
});

check("An existing user runtime also requires confirmation before merging legacy data", () => {
  const { api, state } = createHarness({
    platform:"linux",
    persistSettings:false,
    prepareFilesystem({ legacyUserData, userData }) {
      fs.mkdirSync(path.join(legacyUserData, "runtime", "data"), { recursive:true });
      createMarkerDatabase(path.join(legacyUserData, "runtime", "data", "tunnels.db"), { legacy:"legacy database" });
      createMarkerDatabase(path.join(userData, "runtime", "data", "tunnels.db"), { current:"current database" });
    }
  });

  const startup = api.prepareLegacyBrandMigrationAtStartup(api.prepareRuntimeSettings());
  assert.equal(startup.status, "available");
  assert.equal(markerValue(path.join(state.userData, "runtime", "data", "tunnels.db"), "current"), "current database");
  assert.equal(markerValue(path.join(state.userData, "runtime", "data", "tunnels.db"), "legacy"), undefined);
});

check("Failed brand migration restores the existing Terma profile", () => {
  const customRuntime = fs.mkdtempSync(path.join(os.tmpdir(), "terma-brand-failure-runtime-"));
  temporaryRoots.push(customRuntime);
  const { api, state } = createHarness({
    platform: "linux",
    isPackaged: false,
    settings: { dataMode:"custom", customDataDir:customRuntime },
    prepareFilesystem({ legacyUserData }) {
      fs.mkdirSync(path.join(legacyUserData, "runtime", "data"), { recursive: true });
      createMarkerDatabase(path.join(legacyUserData, "runtime", "data", "tunnels.db"), { legacy:"legacy database" });
      createMarkerDatabase(path.join(customRuntime, "data", "tunnels.db"), { current:"current database" });
    }
  });
  const originalRenameSync = fs.renameSync;
  fs.renameSync = (source, destination) => {
    if (String(source).includes(".terma-brand-migration-staging-") && path.resolve(destination) === path.resolve(path.join(customRuntime, "data", "tunnels.db"))) {
      throw new Error("simulated promotion failure");
    }
    return originalRenameSync(source, destination);
  };
  let migration;
  try {
    migration = api.migrateLegacyBrandUserData({
      manual:true,
      force:true,
      target_data_dir:path.join(customRuntime, "data"),
      target_ssh_dir:path.join(customRuntime, ".ssh")
    });
  } finally {
    fs.renameSync = originalRenameSync;
  }
  assert.equal(migration.status, "failed");
  assert.match(path.basename(migration.backup), /^\.terma-brand-migration-backup-/);
  assert.equal(markerValue(path.join(customRuntime, "data", "tunnels.db"), "current"), "current database");
  assert.equal(markerValue(path.join(state.legacyUserData, "runtime", "data", "tunnels.db"), "legacy"), "legacy database");
});

check("Brand migration refuses to run while TunnelDesk is still active", () => {
  const { api, state } = createHarness({
    platform: "win32",
    persistSettings: false,
    legacyRunning: true,
    prepareFilesystem({ legacyUserData }) {
      fs.mkdirSync(path.join(legacyUserData, "runtime", "data"), { recursive: true });
      fs.writeFileSync(path.join(legacyUserData, "runtime", "data", "tunnels.db"), "legacy database", "utf8");
    }
  });

  api.prepareLegacyBrandMigrationAtStartup(api.prepareRuntimeSettings());
  const preview = api.inspectLegacyBrandMigration();
  assert.equal(preview.status, "legacy-running");
  assert.equal(preview.legacy_running, true);
  const requested = api.migrateLegacyBrandData({ replace_current: true });
  assert.equal(requested.ok, false);
  assert.match(requested.error, /旧版程序|legacy application/i);
  assert.equal(fs.existsSync(path.join(state.userData, "runtime", "data", "tunnels.db")), false);
  assert.equal(fs.existsSync(path.join(state.legacyUserData, "runtime", "data", "tunnels.db")), true);
});

check("Windows brand migration detects a legacy source Electron profile", () => {
  const { api } = createHarness({
    platform:"win32",
    persistSettings:false,
    windowsProcesses: state => [{
      ProcessId:8123,
      ParentProcessId:8000,
      Name:"electron.exe",
      ExecutablePath:path.join(root, "node_modules", "electron", "dist", "electron.exe"),
      CommandLine:`electron.exe --type=utility --user-data-dir="${state.legacyUserData}"`
    }],
    prepareFilesystem({ legacyUserData }) {
      fs.mkdirSync(path.join(legacyUserData, "runtime", "data"), { recursive:true });
      fs.writeFileSync(path.join(legacyUserData, "runtime", "data", "tunnels.db"), "legacy database", "utf8");
    }
  });

  api.prepareLegacyBrandMigrationAtStartup(api.prepareRuntimeSettings());
  const preview = api.inspectLegacyBrandMigration();
  assert.equal(preview.status, "legacy-running");
  assert.equal(preview.legacy_running, true);
});

check("Windows legacy Electron detection excludes the current Terma source process", () => {
  const fixtureRoot = path.win32.join("C:\\Temp", "TermaStartupFixture");
  const legacyUserData = path.win32.join(fixtureRoot, "TunnelDesk");
  const currentUserData = path.win32.join(fixtureRoot, "Terma");
  const currentProject = path.win32.join(fixtureRoot, "TermaSource");
  assert.equal(isLegacyBrandWindowsProcess({
    ProcessId:100,
    Name:"electron.exe",
    ExecutablePath:`${currentProject}\\node_modules\\electron\\dist\\electron.exe`,
    CommandLine:`electron.exe ${currentProject}`
  }, {currentPid:100, currentUserData, legacyUserData}), false);
  assert.equal(isLegacyBrandWindowsProcess({
    ProcessId:101,
    Name:"electron.exe",
    ExecutablePath:`${currentProject}\\node_modules\\electron\\dist\\electron.exe`,
    CommandLine:`electron.exe ${currentProject}`
  }, {currentPid:100, currentUserData, legacyUserData}), false);
  assert.equal(isLegacyBrandWindowsProcess({
    ProcessId:102,
    Name:"electron.exe",
    ExecutablePath:`${currentProject}\\node_modules\\electron\\dist\\electron.exe`,
    CommandLine:`electron.exe --type=renderer --user-data-dir="${currentUserData}" --app-user-model-id="${currentProject}\\node_modules\\electron\\dist\\electron.exe" --app-path="${currentProject}"`
  }, {currentPid:100, currentUserData, legacyUserData}), false);
  assert.equal(isLegacyBrandWindowsProcess({
    ProcessId:103,
    Name:"electron.exe",
    CommandLine:"electron.exe --type=renderer --app-user-model-id=com.zmide.terma"
  }, {currentPid:100, currentUserData, legacyUserData}), false);
  assert.equal(isLegacyBrandWindowsProcess({
    ProcessId:104,
    Name:"electron.exe",
    CommandLine:"electron.exe --type=renderer --app-user-model-id=com.zmide.tunneldesk"
  }, {currentPid:100, currentUserData, legacyUserData}), true);
});

check("Packaged desktop preserves an explicitly configured custom runtime directory", () => {
  const customRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-custom-runtime-check-"));
  temporaryRoots.push(customRoot);
  const { api } = createHarness({
    platform: "linux",
    settings: { dataMode: "custom", customDataDir: customRoot }
  });
  const settings = api.prepareRuntimeSettings();
  const paths = api.resolveRuntimePaths(settings);
  assert.equal(settings.dataMode, "custom");
  assert.equal(settings.customDataDir, customRoot);
  assert.equal(paths.dataDir, path.join(customRoot, "data"));
  assert.equal(paths.sshDir, path.join(customRoot, ".ssh"));
});

check("Desktop startup completes an interrupted data path migration before opening the database", () => {
  const { api, state } = createHarness({platform:"win32", settings:{dataMode:"custom", customDataDir:"C:\\placeholder"}});
  const sourceRoot = path.join(state.temporaryRoot, "source-runtime");
  const targetRoot = path.join(state.temporaryRoot, "target-runtime");
  const sourceSettings = {dataMode:"custom", customDataDir:sourceRoot, minimizeToTray:true};
  const targetSettings = {dataMode:"custom", customDataDir:targetRoot, minimizeToTray:true};
  fs.mkdirSync(path.join(sourceRoot, "data"), {recursive:true});
  fs.mkdirSync(path.join(sourceRoot, ".ssh"), {recursive:true});
  fs.writeFileSync(path.join(sourceRoot, "data", "tunnels.db"), "active database", "utf8");
  fs.writeFileSync(path.join(sourceRoot, ".ssh", "id_ed25519"), "active key", "utf8");
  const transition = createDesktopStorageTransition(
    sourceSettings,
    targetSettings,
    api.resolveRuntimePaths(sourceSettings),
    api.resolveRuntimePaths(targetSettings)
  );
  fs.writeFileSync(state.settingsFile, JSON.stringify({...sourceSettings, pendingStorageMigration:transition}, null, 2), "utf8");

  const recovered = api.prepareRuntimeSettings();
  const persisted = JSON.parse(fs.readFileSync(state.settingsFile, "utf8"));
  assert.equal(recovered.dataMode, "custom");
  assert.equal(recovered.customDataDir, targetRoot);
  assert.equal(recovered.lastStorageMigration.status, "migrated");
  assert.equal(Object.hasOwn(recovered, "pendingStorageMigration"), false);
  assert.equal(Object.hasOwn(persisted, "pendingStorageMigration"), false);
  assert.equal(fs.readFileSync(path.join(targetRoot, "data", "tunnels.db"), "utf8"), "active database");
  assert.equal(fs.readFileSync(path.join(targetRoot, ".ssh", "id_ed25519"), "utf8"), "active key");
  assert.equal(fs.readFileSync(path.join(sourceRoot, "data", "tunnels.db"), "utf8"), "active database");
  assert.match(api.getPendingStorageMigrationNotice(), /原目录仍保留|original directory was preserved/i);
});

check("Windows portable uses PORTABLE_EXECUTABLE_DIR instead of its temporary executable", () => {
  const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-portable-check-"));
  temporaryRoots.push(portableRoot);
  const { api, state } = createHarness({
    platform: "win32",
    env: { PORTABLE_EXECUTABLE_DIR: portableRoot },
    settings: { dataMode: "project" }
  });
  const settings = api.prepareRuntimeSettings();
  const paths = api.resolveRuntimePaths(settings);
  assert.equal(api.isWindowsPortable(), true);
  assert.equal(paths.dataDir, path.join(portableRoot, "data"));
  assert.equal(paths.sshDir, path.join(portableRoot, ".ssh"));
  assert.notEqual(path.dirname(state.execPath), portableRoot);
  assert.equal(api.desktopSettingsView().project_mode_available, true);
});

check("Windows portable explains unsupported ACL storage without hiding the safety stop", () => {
  const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-portable-acl-check-"));
  temporaryRoots.push(portableRoot);
  const { api } = createHarness({
    platform:"win32",
    env:{PORTABLE_EXECUTABLE_DIR:portableRoot},
    settings:{dataMode:"project"}
  });
  const dataDir = path.join(portableRoot, "data");
  const presentation = api.desktopStartupFailurePresentation({
    code:"INSECURE_STORAGE_PERMISSIONS",
    path:dataDir,
    detail:"The file system does not support ACLs.",
    failure_kind:"unsupported-acl",
    message:`无法收紧 Terma 数据权限：${dataDir}`
  }, {dataDir});
  assert.match(presentation.title, /数据目录权限不受支持|data-directory permissions are unsupported/i);
  assert.match(presentation.message, /Windows 便携版|Windows portable edition/i);
  assert.match(presentation.message, /NTFS/);
  assert.match(presentation.message, /FAT32(?:、|,\s*)exFAT/);
  assert.match(presentation.message, /没有修改或删除现有连接数据|did not modify or delete existing connection data/i);
  assert.match(presentation.message, new RegExp(dataDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

check("Windows ACL startup errors follow the persisted English interface language", () => {
  const { api } = createHarness({
    platform:"win32",
    settings:{dataMode:"project", interfaceLanguage:"en-US"}
  });
  const presentation = api.desktopStartupFailurePresentation({
    code:"INSECURE_STORAGE_PERMISSIONS",
    detail:"The file system does not support ACLs.",
    failure_kind:"unsupported-acl",
    message:"The data directory permissions could not be restricted"
  }, {dataDir:"C:\\Terma\\data", language:"en-US"});
  assert.match(presentation.title, /permissions are unsupported/);
  assert.match(presentation.message, /Windows desktop edition/);
  assert.match(presentation.message, /Use a local NTFS path/);
  assert.doesNotMatch(presentation.message, /处理方法|便携版/);
});

check("macOS migrates legacy app data before selecting the user runtime", () => {
  const { api, state } = createHarness({ platform: "darwin", settings: { dataMode: "project" } });
  const legacyRoot = api.legacyPackagedRoot();
  const legacyData = path.join(legacyRoot, "data");
  const legacySsh = path.join(legacyRoot, ".ssh");
  fs.mkdirSync(legacyData, { recursive: true });
  fs.mkdirSync(legacySsh, { recursive: true });
  fs.writeFileSync(path.join(legacyData, "tunnels.db"), "legacy database", "utf8");
  fs.writeFileSync(path.join(legacyData, "security.json"), "legacy security", "utf8");
  fs.writeFileSync(path.join(legacyData, "web.pid"), "123", "utf8");
  fs.writeFileSync(path.join(legacyData, "web.url"), "http://old", "utf8");
  fs.writeFileSync(path.join(legacyData, "web.json"), "{}", "utf8");
  fs.writeFileSync(path.join(legacySsh, "id_ed25519"), "legacy key", "utf8");

  const settings = api.prepareRuntimeSettings();
  const targetRoot = path.join(state.userData, "runtime");
  assert.equal(settings.dataMode, "user");
  assert.equal(settings.storageMigrationVersion, 2);
  assert.equal(settings.lastStorageMigration.status, "migrated");
  assert.equal(fs.readFileSync(path.join(targetRoot, "data", "tunnels.db"), "utf8"), "legacy database");
  assert.equal(fs.readFileSync(path.join(targetRoot, "data", "security.json"), "utf8"), "legacy security");
  assert.equal(fs.readFileSync(path.join(targetRoot, ".ssh", "id_ed25519"), "utf8"), "legacy key");
  assert.equal(fs.existsSync(path.join(targetRoot, "data", "web.pid")), false);
  assert.equal(fs.existsSync(path.join(targetRoot, "data", "web.url")), false);
  assert.equal(fs.existsSync(path.join(targetRoot, "data", "web.json")), false);
  assert.equal(fs.existsSync(path.join(legacyData, "tunnels.db")), true);
  assert.equal(JSON.parse(fs.readFileSync(state.settingsFile, "utf8")).dataMode, "user");
  assert.match(api.getPendingStorageMigrationNotice(), /已从旧程序目录迁移|migrated from the old program directory/i);
});

check("Migration conflict keeps user data and backs up the complete legacy runtime", () => {
  const { api, state } = createHarness({ platform: "darwin", settings: { dataMode: "project" } });
  const legacyRoot = api.legacyPackagedRoot();
  const targetRoot = path.join(state.userData, "runtime");
  fs.mkdirSync(path.join(legacyRoot, "data", "logs"), { recursive: true });
  fs.mkdirSync(path.join(legacyRoot, ".ssh"), { recursive: true });
  fs.mkdirSync(path.join(targetRoot, "data"), { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, "data", "tunnels.db"), "legacy database", "utf8");
  fs.writeFileSync(path.join(legacyRoot, "data", "logs", "legacy.log"), "legacy log", "utf8");
  fs.writeFileSync(path.join(legacyRoot, "data", "web.pid"), "456", "utf8");
  fs.writeFileSync(path.join(legacyRoot, ".ssh", "id_rsa"), "legacy key", "utf8");
  fs.writeFileSync(path.join(targetRoot, "data", "tunnels.db"), "current user database", "utf8");

  const settings = api.prepareRuntimeSettings();
  const backupRoot = settings.lastStorageMigration.backupRoot;
  assert.equal(settings.dataMode, "user");
  assert.equal(settings.lastStorageMigration.status, "conflict-backed-up");
  assert.equal(fs.readFileSync(path.join(targetRoot, "data", "tunnels.db"), "utf8"), "current user database");
  assert.equal(fs.readFileSync(path.join(backupRoot, "data", "tunnels.db"), "utf8"), "legacy database");
  assert.equal(fs.readFileSync(path.join(backupRoot, "data", "logs", "legacy.log"), "utf8"), "legacy log");
  assert.equal(fs.readFileSync(path.join(backupRoot, ".ssh", "id_rsa"), "utf8"), "legacy key");
  assert.equal(fs.existsSync(path.join(backupRoot, "data", "web.pid")), false);
  assert.equal(fs.existsSync(path.join(legacyRoot, "data", "tunnels.db")), true);
  assert.match(path.basename(backupRoot), /^migration-conflict-backup-/);
  assert.match(api.getPendingStorageMigrationNotice(), /继续使用用户目录|continue using the user directory/i);
});

check("Desktop background notifications respect global mode and severity switches", () => {
  const { api } = createHarness();
  assert.equal(api.desktopNotificationAllowed({level:"success"}, {mode:"on", success:true}), true);
  assert.equal(api.desktopNotificationAllowed({level:"error"}, {mode:"on", error:false}), false);
  assert.equal(api.desktopNotificationAllowed({level:"info"}, {mode:"muted", info:true}), false);
  assert.equal(api.desktopNotificationAllowed({level:"success"}, {mode:"off", success:true}), false);
});

check("Desktop resource titles remove only structural endpoint and protocol duplication", () => {
  const { api } = createHarness();
  assert.equal(
    api.normalizeMainWindowTitle("Terma · 210.10.1.134:22 · SFTP · 210.10.1.134 · SFTP"),
    "Terma · 210.10.1.134:22 · SFTP"
  );
  assert.equal(
    api.normalizeMainWindowTitle("Terma · server.example:22 · SFTP · Production · SFTP #2"),
    "Terma · server.example:22 · SFTP #2 · Production"
  );
  assert.equal(
    api.normalizeMainWindowTitle("Terma · 210.10.1.134:5900 · VNC · 210.10.1.134"),
    "Terma · 210.10.1.134:5900 · VNC"
  );
  assert.equal(
    api.normalizeMainWindowTitle("Terma · server.example:22 · Terminal · Backup Backup"),
    "Terma · server.example:22 · Terminal · Backup Backup"
  );
});

console.log("Desktop startup semantics passed.");
