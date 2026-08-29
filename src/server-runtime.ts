const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const {
  DATA_DIR,
  DB_PATH,
  LOG_DIR,
  PID_FILE,
  PROJECT_SSH_DIR,
  DEFAULT_HOST,
  DEFAULT_HOSTS,
  DEFAULT_PORT,
  RUNTIME_SETTINGS_FILE,
  SHUTDOWN_TOKEN_FILE,
  WEB_INFO_FILE,
  WEB_URL_FILE
} = require("./config");
const { closeDatabase } = require("./db");
const { cleanupFtpTemp } = require("./ftp");
const { appendSystemLog } = require("./logs");
const { notifyEvent } = require("./notifications");
const { ptyRuntimeStatus } = require("./pty-runtime");
const {
  availableListenHosts,
  isLoopbackHost,
  MAX_PORT_FALLBACKS,
  normalizeListenHosts,
  normalizeListenPort,
  normalizeRuntimeSettings,
  readRuntimeSettings,
  writeRuntimeSettings
} = require("./runtime-settings");
const {
  resetWebAccessSecurity,
  setDesktopAuthToken,
  setDesktopCapabilityRuntimeListenHosts
} = require("./security");
const { closeAllSftpSessions } = require("./sftp-session");
const { stopAllExternalEdits } = require("./sftp-external-edit");
const {
  autostartConnections,
  closePersistentSshCommandSessions,
  restorePreviousForwards,
  startForwardHealthMonitor,
  stopAllForwards,
  stopForwardHealthMonitor
} = require("./ssh");
const { closeJumpConnectionPool } = require("./ssh2-client");
const { closeAllTerminals } = require("./terminal");
const { closeAllRemoteTerminals } = require("./remote-terminal");
const { closeAllVncSessions } = require("./vnc-proxy");
const { encryptionState, lockEncryption } = require("./crypto-store");
const { assertPrivateStorage, ensurePrivateDirectory, ensurePrivateFile } = require("./storage-permissions");
const { createUpdateChecker } = require("./update-checker");
const { UpdateInstaller } = require("./update-installer");
const { PACKAGE_ROOT, PACKAGE_VERSION } = require("./services/app-metadata-service");

function createServerRuntime(options: any = {}) {
  if (typeof options.createHttpListener !== "function") throw new Error("createHttpListener is required");
  const startupStatusFile = path.join(DATA_DIR, "startup-status.json");
  let startupStatus: any = {state:"starting", started_at:Date.now(), local_url:"", lan_urls:[], autostart:{ok:0, failed:0, errors:[]}, restore:{ok:0, failed:0, errors:[]}};
  let args: any = normalizeStartArgs();
  let activeServers: any[] = [];
  let exitOnShutdown = true;
  let onShutdown: null | (() => any) = null;
  let desktopIntegration: any = null;
  let shutdownAuthToken = "";
  let updateCheckTimer = null;
  let installedUpdateCleanupTimer = null;
  let startupTaskTimer = null;
  let startupEffectsStarted = false;
  let shutdownPromise: Promise<any> | null = null;

  const updateChecker = createUpdateChecker({
    dataDir:DATA_DIR,
    packagePath:path.join(PACKAGE_ROOT, "package.json"),
    onUpdate(result) {
      notifyEvent({
        type:"update",
        level:"info",
        key:result.republished_available ? `update-republished:${result.latest_version}:${result.release_revision || 0}` : `update:${result.latest_version}`,
        title:result.republished_available ? "Terma 当前版本已重新发布" : "发现 Terma 新版本",
        message:result.republished_available
          ? `Terma ${result.latest_version} 已重新发布，请在更新页面点击“重新下载”。`
          : `当前版本 ${result.current_version}，最新版本 ${result.latest_version}${result.name ? `（${result.name}）` : ""}。`,
        action:{url:result.release_url}
      }, {cooldown_ms:0});
    }
  });
  const updateInstaller = new UpdateInstaller(DATA_DIR);

  function writeStartupStatus(next: any = {}) {
    startupStatus = {...startupStatus, ...next, updated_at:Date.now()};
    fs.mkdirSync(DATA_DIR, {recursive:true});
    fs.writeFileSync(startupStatusFile, JSON.stringify(startupStatus, null, 2), "utf8");
    return startupStatus;
  }

  function parseArgs(argv = process.argv.slice(2)) {
    const out: any = {listen_hosts:[...DEFAULT_HOSTS], listen_port:DEFAULT_PORT, pidFile:PID_FILE};
    const cliHosts: string[] = [];
    let cliPort;
    for (let index = 0; index < argv.length; index += 1) {
      const item = argv[index];
      if (item === "--host" || item === "--hosts") {
        const value = argv[++index];
        if (value !== undefined) cliHosts.push(...String(value).split(/[\s,]+/).filter(Boolean));
      } else if (item === "--port") {
        cliPort = argv[++index];
      } else if (item === "--pid-file") {
        out.pidFile = argv[++index];
      }
    }
    if (cliHosts.length) out.listen_hosts = normalizeListenHosts(cliHosts, null);
    if (cliPort !== undefined) out.listen_port = normalizeListenPort(cliPort, null);
    out.host = out.listen_hosts.join(",");
    out.port = out.listen_port;
    out.requested_hosts = [...out.listen_hosts];
    out.requested_port = out.listen_port;
    return out;
  }

  function normalizeStartArgs(customArgs: any = {}) {
    const source = customArgs || {};
    let hostsValue;
    if (Object.prototype.hasOwnProperty.call(source, "listen_hosts")) hostsValue = source.listen_hosts;
    else if (Object.prototype.hasOwnProperty.call(source, "hosts")) hostsValue = source.hosts;
    else if (Object.prototype.hasOwnProperty.call(source, "host")) {
      const legacyDefault = source.host === DEFAULT_HOST && Number(source.port ?? DEFAULT_PORT) === DEFAULT_PORT && DEFAULT_HOSTS.length > 1;
      hostsValue = legacyDefault ? DEFAULT_HOSTS : source.host;
    } else hostsValue = DEFAULT_HOSTS;
    const portValue = Object.prototype.hasOwnProperty.call(source, "listen_port") ? source.listen_port
      : (Object.prototype.hasOwnProperty.call(source, "port") ? source.port : DEFAULT_PORT);
    const listenHosts = normalizeListenHosts(hostsValue, null);
    const listenPort = normalizeListenPort(portValue, null);
    return {
      ...source,
      listen_hosts:listenHosts,
      listen_port:listenPort,
      requested_hosts:[...listenHosts],
      requested_port:listenPort,
      host:listenHosts.join(","),
      port:listenPort,
      pidFile:source.pidFile || PID_FILE
    };
  }

  function hasShutdownToken(req) {
    const provided = String(req.headers["x-terma-shutdown-token"] || "").trim();
    if (!provided || !shutdownAuthToken) return false;
    const actual = Buffer.from(provided);
    const expected = Buffer.from(shutdownAuthToken);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  function writeShutdownTokenFile(token) {
    fs.writeFileSync(SHUTDOWN_TOKEN_FILE, `${token}\n`, {encoding:"utf8", mode:0o600});
    ensurePrivateFile(SHUTDOWN_TOKEN_FILE);
  }

  function removeShutdownTokenFile(token = shutdownAuthToken) {
    try {
      if (!fs.existsSync(SHUTDOWN_TOKEN_FILE)) return;
      if (token && fs.readFileSync(SHUTDOWN_TOKEN_FILE, "utf8").trim() !== token) return;
      fs.unlinkSync(SHUTDOWN_TOKEN_FILE);
    } catch {}
  }

  function scheduleInstalledUpdateCleanup(attempt = 0) {
    clearTimeout(installedUpdateCleanupTimer);
    installedUpdateCleanupTimer = null;
    if (!desktopIntegration || process.platform !== "win32") return;
    installedUpdateCleanupTimer = setTimeout(() => {
      installedUpdateCleanupTimer = null;
      const result = updateInstaller.cleanupInstalledPackage(PACKAGE_VERSION);
      if (result.removed) {
        appendSystemLog("安装版升级完成，已自动清理下载的更新安装包");
        return;
      }
      if (result.retry && attempt < 11) scheduleInstalledUpdateCleanup(attempt + 1);
    }, attempt === 0 ? 1500 : 5000);
    installedUpdateCleanupTimer.unref?.();
  }

  function listenOne(listener, host, port) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        error.listen_host = host;
        error.listen_port = port;
        listener.removeListener("error", fail);
        listener.removeListener("listening", ready);
        try { listener.close(() => {}); } catch {}
        reject(error);
      };
      const ready = () => {
        if (settled) return;
        settled = true;
        listener.removeListener("error", fail);
        listener.removeListener("listening", ready);
        resolve(listener);
      };
      listener.once("error", fail);
      listener.once("listening", ready);
      listener.listen({host, port});
    });
  }

  function closeListener(listener) {
    return new Promise<void>(resolve => {
      if (!listener || !listener.listening) return resolve();
      try { listener.close(() => resolve()); } catch { resolve(); }
    });
  }

  async function closeListeners(listeners) {
    await Promise.all((listeners || []).map(closeListener));
  }

  async function bindAll(hosts, port, factory = options.createHttpListener) {
    const listeners: any[] = [];
    try {
      for (const host of hosts) {
        const listener = factory();
        await listenOne(listener, host, port);
        listeners.push(listener);
        listener.on("error", error => {
          appendSystemLog(`Web 监听 ${host}:${port} 运行时错误：${error.message || error}`);
        });
      }
      return listeners;
    } catch (error) {
      await closeListeners(listeners);
      throw error;
    }
  }

  async function bindWithFallback(hosts, requestedPort, bindOptions: any = {}) {
    const factory = bindOptions.factory || options.createHttpListener;
    const maxFallbacks = Number.isInteger(bindOptions.maxFallbacks) ? bindOptions.maxFallbacks : MAX_PORT_FALLBACKS;
    let lastError;
    for (let offset = 0; offset <= maxFallbacks && requestedPort + offset <= 65535; offset += 1) {
      const port = requestedPort + offset;
      try {
        const listeners = await bindAll(hosts, port, factory);
        return {listeners, port, fallback_count:offset};
      } catch (error) {
        lastError = error;
        if (error.code !== "EADDRINUSE") throw error;
        if (offset < maxFallbacks) appendSystemLog(`端口 ${port} 已被占用，尝试使用 ${port + 1}`);
      }
    }
    const error: any = lastError || new Error("没有可用的 Web 监听端口");
    error.code = error.code || "EADDRINUSE";
    error.message = `端口 ${requestedPort} 至多尝试 ${maxFallbacks + 1} 个端口后仍不可用`;
    throw error;
  }

  function lanUrlsForHosts(hosts, port) {
    const urls: string[] = [];
    const seen = new Set<string>();
    const add = host => {
      if (!host || isLoopbackHost(host)) return;
      const url = `http://${host}:${port}`;
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    };
    for (const host of hosts) {
      if (host === "0.0.0.0") {
        const interfaces: any = os.networkInterfaces();
        for (const items of Object.values(interfaces) as any[]) {
          for (const item of items || []) if (item.family === "IPv4" && !item.internal) add(item.address);
        }
      } else add(host);
    }
    return urls;
  }

  function urlsForHosts(hosts, port) {
    const localHost = hosts.find(host => isLoopbackHost(host)) || (hosts.includes("0.0.0.0") ? "127.0.0.1" : hosts[0]);
    const localUrl = `http://${localHost}:${port}`;
    const lanUrls = lanUrlsForHosts(hosts, port);
    return {localUrl, lanUrls, urls:[...new Set([localUrl, ...lanUrls])]};
  }

  function sameListenHosts(left, right) {
    return JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
  }

  function runtimeSources() {
    const hasPersistedSettings = fs.existsSync(RUNTIME_SETTINGS_FILE);
    return {
      listen_hosts:process.env.TUNNEL_WEB_HOSTS || process.env.TUNNEL_WEB_HOST ? "env" : (hasPersistedSettings ? "file" : "default"),
      listen_port:process.env.TUNNEL_WEB_PORT ? "env" : (hasPersistedSettings ? "file" : "default")
    };
  }

  function publicAiSettings(value: any = {}) {
    const source = value && typeof value === "object" ? value : {};
    const {api_key: _apiKey, mcp_servers: mcpServers, ...safe} = source;
    return {
      ...safe,
      mcp_servers:Array.isArray(mcpServers) ? mcpServers.map((item: any) => ({
        ...item,
        headers:item?.transport !== "stdio" && item?.headers && typeof item.headers === "object"
          ? Object.fromEntries(Object.keys(item.headers).map(name => [name, ""]))
          : undefined
      })) : [],
      api_key_configured:Boolean(String(_apiKey || ""))
    };
  }

  function runtimeSettingsView() {
    const settingsPersisted = fs.existsSync(RUNTIME_SETTINGS_FILE);
    const persisted = readRuntimeSettings(RUNTIME_SETTINGS_FILE);
    const actualHosts = args.actual_hosts || args.listen_hosts;
    const actualPort = args.actual_port || args.port;
    const urls = activeServers.length ? urlsForHosts(actualHosts, actualPort) : {localUrl:"", lanUrls:[], urls:[]};
    const sources = runtimeSources();
    const saved = {...persisted, ai:publicAiSettings(persisted.ai), listen_hosts:[...persisted.listen_hosts], listen_port:persisted.listen_port};
    const effective = {listen_hosts:[...(actualHosts || [])], listen_port:actualPort, sources};
    return {
      ...saved,
      settings_persisted:settingsPersisted,
      saved,
      effective,
      sources,
      requested_hosts:[...(args.requested_hosts || persisted.listen_hosts)],
      requested_port:Number(args.requested_port || persisted.listen_port),
      actual_hosts:[...(actualHosts || [])],
      actual_port:actualPort,
      available_hosts:availableListenHosts(),
      local_url:urls.localUrl,
      lan_urls:urls.lanUrls,
      urls:urls.urls,
      restart_required:Boolean(activeServers.length) && (
        !sameListenHosts(persisted.listen_hosts, actualHosts)
        || Number(persisted.listen_port) !== Number(actualPort)
      )
    };
  }

  async function suggestRuntimePort(hosts, requestedPort) {
    for (let offset = 1; offset <= MAX_PORT_FALLBACKS && requestedPort + offset <= 65535; offset += 1) {
      const port = requestedPort + offset;
      try {
        const listeners = await bindAll(hosts, port, () => net.createServer());
        await closeListeners(listeners);
        return port;
      } catch {}
    }
    return null;
  }

  async function checkRuntimeSettings(data: any = {}) {
    const persisted = readRuntimeSettings(RUNTIME_SETTINGS_FILE);
    let normalized;
    try {
      normalized = normalizeRuntimeSettings({
        listen_hosts:data.listen_hosts ?? persisted.listen_hosts,
        listen_port:data.listen_port ?? persisted.listen_port
      });
    } catch (error) {
      return {available:false, error:error.message || String(error)};
    }
    const resultBase = {
      requested_hosts:[...normalized.listen_hosts],
      requested_port:normalized.listen_port,
      listen_hosts:[...normalized.listen_hosts],
      listen_port:normalized.listen_port
    };
    const currentPort = Number(args.actual_port || args.listen_port);
    if (activeServers.length && normalized.listen_port === currentPort && sameListenHosts(normalized.listen_hosts, args.actual_hosts || args.listen_hosts)) {
      return {available:true, occupied_by_current:true, ...resultBase};
    }
    try {
      const listeners = await bindAll(normalized.listen_hosts, normalized.listen_port, () => net.createServer());
      await closeListeners(listeners);
      return {available:true, occupied_by_current:false, ...resultBase};
    } catch (error) {
      return {
        available:false,
        occupied_by_current:false,
        ...resultBase,
        error:error.message || String(error),
        code:error.code || "",
        suggested_port:error.code === "EADDRINUSE" ? await suggestRuntimePort(normalized.listen_hosts, normalized.listen_port) : null
      };
    }
  }

  function runtimeDiagnostics() {
    let ptyAvailable = false;
    let ptyError = "";
    const ptyStatus = ptyRuntimeStatus(true);
    try {
      require("node-pty");
      ptyAvailable = true;
    } catch (error) {
      ptyError = error.message || String(error);
    }
    const ptyOperational = ptyAvailable && (process.platform !== "darwin" || (ptyStatus.helper_exists && ptyStatus.helper_executable));
    const readText = file => {
      try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
    };
    return {
      pid:process.pid,
      platform:process.platform,
      arch:process.arch,
      node:process.version,
      cwd:process.cwd(),
      data_dir:DATA_DIR,
      log_dir:LOG_DIR,
      web_pid_file:args.pidFile,
      web_url_file:WEB_URL_FILE,
      web_info_file:WEB_INFO_FILE,
      web_url:readText(WEB_URL_FILE),
      web_info:readText(WEB_INFO_FILE),
      web_log:path.join(DATA_DIR, "web.log"),
      runtime_settings_file:RUNTIME_SETTINGS_FILE,
      requested_hosts:args.requested_hosts,
      requested_port:args.requested_port,
      actual_hosts:args.actual_hosts || args.listen_hosts,
      actual_port:args.actual_port || args.port,
      pty:{
        available:ptyAvailable,
        operational:ptyOperational,
        error:ptyError,
        ...ptyStatus,
        optional_dependency:"node-pty"
      }
    };
  }

  function completeStartup(binding) {
    if (startupEffectsStarted) return;
    startupEffectsStarted = true;
    const actualHosts = [...args.requested_hosts];
    const actualPort = binding.port;
    args.actual_hosts = actualHosts;
    args.actual_port = actualPort;
    args.listen_hosts = actualHosts;
    args.listen_port = actualPort;
    args.host = actualHosts.join(",");
    args.port = actualPort;
    setDesktopCapabilityRuntimeListenHosts(actualHosts);
    const urls = urlsForHosts(actualHosts, actualPort);
    fs.writeFileSync(args.pidFile, String(process.pid));
    fs.writeFileSync(WEB_URL_FILE, urls.localUrl);
    writeRuntimeSettings(RUNTIME_SETTINGS_FILE, {
      ...readRuntimeSettings(RUNTIME_SETTINGS_FILE),
      listen_hosts:args.requested_hosts,
      listen_port:actualPort
    });
    fs.writeFileSync(WEB_INFO_FILE, JSON.stringify({
      pid:process.pid,
      host:args.host,
      port:actualPort,
      requested_hosts:args.requested_hosts,
      requested_port:args.requested_port,
      actual_hosts:actualHosts,
      actual_port:actualPort,
      fallback_count:binding.fallback_count,
      local_url:urls.localUrl,
      lan_urls:urls.lanUrls,
      urls:urls.urls,
      started_at:new Date().toISOString()
    }, null, 2), "utf8");
    writeStartupStatus({state:"starting", local_url:urls.localUrl, lan_urls:urls.lanUrls, host:args.host, port:actualPort, requested_hosts:args.requested_hosts, requested_port:args.requested_port, actual_hosts:actualHosts, actual_port:actualPort});
    console.log(`Terma listening on http://${args.host}:${actualPort}`);
    if (urls.lanUrls.length) console.log(`Terma LAN URLs:\n${urls.lanUrls.map(url => `  ${url}`).join("\n")}`);
    appendSystemLog(`Terma 已启动：http://${args.host}:${actualPort}`);
    if (process.env.TERMA_DISABLE_UPDATE_CHECK !== "1" && process.env.TUNNELDESK_DISABLE_UPDATE_CHECK !== "1") {
      clearTimeout(updateCheckTimer);
      updateCheckTimer = setTimeout(() => {
        updateChecker.check({force:true}).catch(() => {});
      }, 10 * 1000);
      updateCheckTimer.unref?.();
    }
    startupTaskTimer = setTimeout(async () => {
      let autostart = {ok:0, failed:0, errors:[]};
      let restore = {ok:0, failed:0, errors:[]};
      try {
        autostart = await autostartConnections();
      } catch (error) {
        console.error(`autostart failed: ${error.message}`);
        autostart = {ok:0, failed:1, errors:[{error:error.message}]};
      }
      try {
        restore = await restorePreviousForwards();
      } catch (error) {
        console.error(`restore forwards failed: ${error.message}`);
        restore = {ok:0, failed:1, errors:[{error:error.message}]};
      }
      const failures = Number(autostart.failed || 0) + Number(restore.failed || 0);
      writeStartupStatus({state:failures ? "warning" : "ready", completed_at:Date.now(), autostart, restore, failures, log_path:path.join(LOG_DIR, `system-${new Date().toISOString().slice(0, 10)}.log`)});
      appendSystemLog(`启动任务完成：自动转发成功${autostart.ok || 0}、失败${autostart.failed || 0}；恢复转发成功${restore.ok || 0}、失败${restore.failed || 0}`);
      startForwardHealthMonitor();
    }, 1000);
    startupTaskTimer.unref?.();
  }

  async function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      clearTimeout(updateCheckTimer);
      updateCheckTimer = null;
      clearTimeout(installedUpdateCleanupTimer);
      installedUpdateCleanupTimer = null;
      clearTimeout(startupTaskTimer);
      startupTaskTimer = null;
      try {
        appendSystemLog("Terma 正在关闭");
        await stopForwardHealthMonitor();
        closeAllTerminals();
        closeAllRemoteTerminals();
        closeAllVncSessions();
        closeAllSftpSessions();
        stopAllExternalEdits();
        closeJumpConnectionPool();
        closePersistentSshCommandSessions();
        await stopAllForwards({preserveRestoreState:true});
        closeDatabase();
      } catch (error) {
        console.error(`stop forwards failed: ${error.message}`);
      }
      try {
        if (fs.existsSync(args.pidFile) && fs.readFileSync(args.pidFile, "utf8").trim() === String(process.pid)) fs.unlinkSync(args.pidFile);
        if (fs.existsSync(WEB_URL_FILE)) fs.unlinkSync(WEB_URL_FILE);
        if (fs.existsSync(WEB_INFO_FILE)) fs.unlinkSync(WEB_INFO_FILE);
        removeShutdownTokenFile();
      } catch {}
      await closeListeners(activeServers);
      activeServers = [];
      setDesktopAuthToken("");
      shutdownAuthToken = "";
      if (exitOnShutdown) process.exit(0);
      if (onShutdown) await Promise.resolve(onShutdown()).catch(error => console.error(`shutdown callback failed: ${error.message}`));
    })();
    return shutdownPromise;
  }

  function reconcileEncryptionStateAtStartup(_options: any = {}) {
    lockEncryption();
    const state = encryptionState();
    return {
      upgraded:false,
      state:state.state,
      requires_unlock:Boolean(state.enabled && (state.version < 3 || state.transition_pending))
    };
  }

  function startServer(customArgs: any = parseArgs(), startOptions: any = {}) {
    args = normalizeStartArgs(customArgs);
    exitOnShutdown = startOptions.exitOnShutdown !== false;
    onShutdown = typeof startOptions.onShutdown === "function" ? startOptions.onShutdown : null;
    desktopIntegration = startOptions.desktopIntegration || null;
    setDesktopAuthToken(desktopIntegration ? startOptions.desktopAuthToken : "");
    startupEffectsStarted = false;
    shutdownPromise = null;
    fs.mkdirSync(DATA_DIR, {recursive:true});
    ensurePrivateDirectory(path.join(DATA_DIR, "snapshots"));
    ensurePrivateDirectory(path.join(DATA_DIR, "restore-staging"));
    assertPrivateStorage([
      {path:DATA_DIR, directory:true},
      {path:PROJECT_SSH_DIR, directory:true},
      {path:path.join(DATA_DIR, "snapshots"), directory:true},
      {path:path.join(DATA_DIR, "restore-staging"), directory:true},
      {path:DB_PATH, directory:false},
      {path:path.join(DATA_DIR, "security.json"), directory:false},
      {path:path.join(DATA_DIR, "ssh-host-trust.json"), directory:false}
    ]);
    reconcileEncryptionStateAtStartup();
    cleanupFtpTemp();
    scheduleInstalledUpdateCleanup();
    if (process.env.TERMA_RESET_WEB_ACCESS === "1" || process.env.TUNNELDESK_RESET_WEB_ACCESS === "1") {
      resetWebAccessSecurity();
      appendSystemLog("已根据 TERMA_RESET_WEB_ACCESS 重置 Web 访问密码和 Token");
    }
    const ready = bindWithFallback(args.listen_hosts, args.listen_port).then(async binding => {
      activeServers = binding.listeners;
      try {
        shutdownAuthToken = crypto.randomBytes(32).toString("base64url");
        writeShutdownTokenFile(shutdownAuthToken);
        completeStartup(binding);
      } catch (error) {
        removeShutdownTokenFile();
        shutdownAuthToken = "";
        await closeListeners(activeServers);
        activeServers = [];
        throw error;
      }
      return {
        servers:activeServers,
        server:activeServers[0],
        args,
        port:binding.port,
        hosts:args.listen_hosts,
        fallback_count:binding.fallback_count
      };
    }).catch(error => {
      writeStartupStatus({state:"error", error:error.message || String(error), code:error.code || "", failed_at:Date.now()});
      appendSystemLog(`Terma 启动失败：${error.message || error}`);
      throw error;
    });
    ready.catch(() => {});
    return {
      get server() { return activeServers[0] || null; },
      get servers() { return activeServers; },
      args,
      ready,
      shutdown
    };
  }

  return {
    checkRuntimeSettings,
    getArgs:() => args,
    getDesktopIntegration:() => desktopIntegration,
    getStartupStatus:() => startupStatus,
    hasShutdownToken,
    parseArgs,
    reconcileEncryptionStateAtStartup,
    runtimeDiagnostics,
    runtimeSettingsView,
    shutdown,
    startServer,
    updateChecker,
    updateInstaller
  };
}

module.exports = { createServerRuntime };
