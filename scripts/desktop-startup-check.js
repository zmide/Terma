const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const desktopMainPath = path.join(root, "desktop", "main.js");
const desktopMainSource = fs.readFileSync(desktopMainPath, "utf8");
const readyMarker = "app.whenReady().then";
const readyIndex = desktopMainSource.indexOf(readyMarker);

assert.notEqual(readyIndex, -1, "desktop/main.js must contain the app.whenReady startup block");
assert.match(desktopMainSource, /org\.freedesktop\.Notifications/, "Linux notifications must verify the D-Bus service before showing");
assert.match(desktopMainSource, /desktopNotificationsAvailable\(\)/, "desktop notifications must use the availability probe");
assert.match(desktopMainSource, /tunneldeskDisplaySession/, "Linux second launches must report their graphical session");
assert.match(desktopMainSource, /stdio:\s*\["ignore",\s*"ignore",\s*"ignore",\s*"ipc"\]/, "display clients must keep an IPC focus channel");

const testableSource = `${desktopMainSource.slice(0, readyIndex)}
globalThis.__desktopStartupTestApi = {
  START_IN_TRAY_ARG,
  DISPLAY_CLIENT_ARG,
  DISPLAY_CLIENT_URL_ENV,
  displayClientMode,
  applyLoginSetting,
  shouldStartInTray,
  relaunchInForeground,
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
  isWindowsPortable,
  userRuntimeRoot,
  legacyPackagedRoot,
  resolveRuntimePaths,
  prepareRuntimeSettings,
  desktopSettingsView,
  normalizeDesktopSettings,
  setWebUrl: value => { webUrl = String(value || ""); },
  getWebUrl: () => webUrl,
  getPendingDisplayClientKeys: () => [...pendingDisplayClientSessions.keys()],
  getDisplayClientProcessKeys: () => [...displayClientProcesses.keys()],
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
  singleInstanceLock = true
} = {}) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-desktop-check-"));
  temporaryRoots.push(temporaryRoot);
  const userData = path.join(temporaryRoot, "user-data");
  const defaultExecPath = platform === "darwin"
    ? path.join(temporaryRoot, "Applications", "TunnelDesk.app", "Contents", "MacOS", "TunnelDesk")
    : path.join(temporaryRoot, "installed", platform === "win32" ? "TunnelDesk.exe" : "tunneldesk");
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
    appPathOverrides: new Map(),
    spawnCalls: [],
    scheduledTimeouts: [],
    xServerRuntimeCreateCount: 0,
    temporaryRoot,
    userData,
    execPath: processArgv[0],
    settingsFile: path.join(userData, "desktop-settings.json")
  };

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
      this.onceHandlers = new Map();
      this.handlers = new Map();
      this.webContentsOnceHandlers = new Map();
      this.webContents = {
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
    dialog: {},
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
      if (id === "node:fs") return fs;
      if (id === "node:path") return path;
      if (id === "node:child_process") return {
        spawn: (command, args, options) => {
          const handlers = new Map();
          const child = {
            exitCode: null,
            killed: false,
            messages: [],
            once(event, handler) { handlers.set(event, handler); },
            send(message) { this.messages.push(message); },
            emit(event, value) {
              const handler = handlers.get(event);
              if (handler) handler(value);
            }
          };
          state.spawnCalls.push({ command, args, options, child });
          return child;
        },
        spawnSync: () => ({status:1, stdout:"", stderr:""})
      };
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
      throw new Error(`unexpected require in desktop startup check: ${id}`);
    }
  });

  vm.runInContext(testableSource, context, { filename: desktopMainPath });
  if (!context.__desktopStartupTestApi.displayClientMode) context.__desktopStartupTestApi.initializeDesktopSettingsFile();
  if (persistSettings) {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(state.settingsFile, JSON.stringify(settings, null, 2), "utf8");
  }
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

check("Desktop application menu is hidden without changing tray menu setup", () => {
  const { api, state } = createHarness();
  api.buildAppMenu();
  assert.deepEqual(state.applicationMenus, [null]);
});

check("Manual Windows launch remains visible even when login startup is configured for the tray", () => {
  const { api, state } = createHarness({
    argv: ["TunnelDesk.exe"],
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
  assert.equal(window.options.webPreferences.preload, path.join(root, "desktop", "preload.js"));
});

check("Explicit Windows login launch starts in the tray", () => {
  const argv = ["TunnelDesk.exe", "--start-in-tray"];
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
  const { api, state } = createHarness({ argv: ["TunnelDesk.exe"] });
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
  const { api, state } = createHarness({ platform: "linux", argv: ["tunneldesk"] });
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
  const session = state.singleInstanceRequests[0].tunneldeskDisplaySession;
  assert.equal(session.DISPLAY, ":0");
  assert.equal(session.XAUTHORITY, "/run/user/1000/xauth-main");
  assert.equal(session.DBUS_SESSION_BUS_ADDRESS, "unix:path=/run/user/1000/bus");
});

check("A second launch on the same Linux DISPLAY focuses the existing window", () => {
  const { api, state } = createHarness({ platform:"linux", env:{DISPLAY:":0"} });
  api.setWebUrl("http://127.0.0.1:8088");
  api.createWindow();
  const window = state.windows[0];
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
  secondInstance(null, [], "", {tunneldeskDisplaySession:targetSession});
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

  secondInstance(null, [], "", {tunneldeskDisplaySession:targetSession});
  assert.equal(state.spawnCalls.length, 1);
  assert.equal(state.spawnCalls[0].child.messages.length, 1);
  assert.equal(state.spawnCalls[0].child.messages[0].type, "show");
  assert.deepEqual(Array.from(api.getDisplayClientProcessKeys()), ["x11::3"]);
});

check("Linux display-client mode skips the backend profile and handles an early focus request", () => {
  const { api, state } = createHarness({
    platform:"linux",
    argv:["tunneldesk", "--tunneldesk-display-client"],
    env:{
      DISPLAY:":3",
      TUNNELDESK_DISPLAY_CLIENT_URL:"http://127.0.0.1:8088"
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
  assert.equal(api.getWebUrl(), "http://127.0.0.1:8088/");
  assert.equal(state.windows.length, 1);
  assert.equal(state.ipcListeners.has("tunneldesk:capabilities"), true);
  assert.equal(state.ipcListeners.has("tunneldesk:set-theme"), true);
  const window = state.windows[0];
  window.emitWebContentsOnce("did-finish-load");
  const revealTimer = state.scheduledTimeouts.find(timer => timer.delay === 120 && !timer.cancelled);
  assert.ok(revealTimer, "display client must schedule a did-finish-load reveal fallback");
  revealTimer.handler();
  assert.equal(window.visible, true);
  assert.equal(state.appFocusCalls.length, 0);
  assert.equal(fs.existsSync(state.settingsFile), false);
});

check("Second launch before the first window exists waits for ready-to-show", () => {
  const { api, state } = createHarness({ platform: "linux", argv: ["tunneldesk"] });
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
  const { api, state } = createHarness({ platform: "linux", argv: ["tunneldesk"] });
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
    argv: ["TunnelDesk.exe", "app.asar", "--start-in-tray", "--inspect=9229", "--start-in-tray"]
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

check("Packaged desktop preserves an explicitly configured custom runtime directory", () => {
  const customRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-custom-runtime-check-"));
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

check("Windows portable uses PORTABLE_EXECUTABLE_DIR instead of its temporary executable", () => {
  const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tunneldesk-portable-check-"));
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
  assert.equal(settings.storageMigrationVersion, 1);
  assert.equal(settings.lastStorageMigration.status, "migrated");
  assert.equal(fs.readFileSync(path.join(targetRoot, "data", "tunnels.db"), "utf8"), "legacy database");
  assert.equal(fs.readFileSync(path.join(targetRoot, "data", "security.json"), "utf8"), "legacy security");
  assert.equal(fs.readFileSync(path.join(targetRoot, ".ssh", "id_ed25519"), "utf8"), "legacy key");
  assert.equal(fs.existsSync(path.join(targetRoot, "data", "web.pid")), false);
  assert.equal(fs.existsSync(path.join(targetRoot, "data", "web.url")), false);
  assert.equal(fs.existsSync(path.join(targetRoot, "data", "web.json")), false);
  assert.equal(fs.existsSync(path.join(legacyData, "tunnels.db")), true);
  assert.equal(JSON.parse(fs.readFileSync(state.settingsFile, "utf8")).dataMode, "user");
  assert.match(api.getPendingStorageMigrationNotice(), /已从旧程序目录迁移/);
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
  assert.match(api.getPendingStorageMigrationNotice(), /继续使用用户目录/);
});

console.log("Desktop startup semantics passed.");
