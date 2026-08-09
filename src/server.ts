const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { URL } = require("node:url");

function probeTcpEndpoint(host, port, timeoutMs=2200) {
  return new Promise<{ok:boolean, error:string}>(resolve => {
    let settled = false;
    const socket = net.createConnection({host:String(host || ""), port:Number(port || 0)});
    const finish = (ok, error="") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ok, error:String(error || "")});
    };
    socket.setTimeout(timeoutMs, () => finish(false, "连接超时"));
    socket.once("connect", () => finish(true));
    socket.once("error", error => finish(false, error?.message || "连接失败"));
  });
}
const {
  DATA_DIR,
  BASE_DIR,
  RUNTIME_ROOT,
  STORAGE_SETTINGS_FILE,
  DB_PATH,
  LOG_DIR,
  PID_FILE,
  PUBLIC_DIR,
  PROJECT_SSH_DIR,
  USER_SSH_DIR,
  DEFAULT_HOST,
  DEFAULT_HOSTS,
  DEFAULT_PORT,
  DEFAULT_EXTRA_ARGS,
  RUNTIME_SETTINGS_FILE,
  SHUTDOWN_TOKEN_FILE,
  WEB_INFO_FILE,
  WEB_URL_FILE
} = require("./config");
const {
  listConnections,
  listRemoteProfiles,
  getRemoteProfile,
  insertRemoteProfile,
  createRemoteProfileFromConnection,
  createAllRemoteProfilesFromConnection,
  updateRemoteProfile,
  getVncProfileCredential,
  updateVncProfileCredential,
  duplicateRemoteProfile,
  deleteRemoteProfile,
  updateRemoteProfileUsage,
  updateRemoteProfileFlags,
  getConnection,
  getForward,
  insertConnection,
  duplicateConnection,
  updateConnection,
  updateConnectionUsage,
  updateConnectionFlags,
  updateTerminalPreferences,
  updateTerminalStartup,
  updateConnectionX11Mode,
  updateSftpTextEncoding,
  updateSftpFilenameEncoding,
  bulkUpdateConnections,
  renameConnectionGroup,
  reorderConnectionGroups,
  insertForward,
  updateForward,
  deleteConnection,
  deleteForward,
  listCommandSnippets,
  insertCommandSnippet,
  updateCommandSnippet,
  deleteCommandSnippet,
  useCommandSnippet,
  listNamedWorkspaces,
  insertNamedWorkspace,
  updateNamedWorkspace,
  duplicateNamedWorkspace,
  useNamedWorkspace,
  deleteNamedWorkspace,
  listForwardTemplates,
  insertForwardTemplate,
  updateForwardTemplate,
  deleteForwardTemplate,
  applyForwardTemplate,
  encryptStoredConnectionSecrets,
  decryptStoredConnectionSecrets,
  validateSortOrder,
  run,
  all,
  closeDatabase,
  reopenDatabase,
  exportDatabaseFile
} = require("./db");
const {
  listIdentityFiles,
  identityPermissionStatus,
  repairIdentityFile,
  saveUploadedKey,
  startForward,
  stopForward,
  startConnectionForwards,
  stopConnectionForwards,
  stopAllForwards,
  autostartConnections,
  restorePreviousForwards,
  restoreStateSummary,
  configuredPortOwner,
  diagnosePortUsage,
  recommendPort,
  killPortOwner,
  connectionHealth,
  allConnectionsHealth,
  startForwardHealthMonitor,
  stopForwardHealthMonitor,
  testSsh,
  batchRunCommands,
  runSshCommandForConnection,
  runSshCommandForConnectionStreaming,
  clearConnectionHealthCache
} = require("./ssh");
const { discoverRemoteTerminalCapabilities } = require("./ssh-capabilities");
const { diagnoseSshError } = require("./ssh-diagnostics");
const { buildRemotePosixCommand } = require("./remote-posix");
const { deployGeneratedPublicKey, generateSshKey } = require("./ssh-key-wizard");
const { createTerminalStartupTicket } = require("./terminal-startup");
const { buildRemoteX11InstallPlan, discoverRemoteX11Applications, verifyRemoteX11Application, x11RuntimeDiagnostics } = require("./x11");
const { DETECT_SCRIPT: SSH_X11_DETECT_SCRIPT, buildConfigureScript: buildSshX11ConfigureScript, buildInteractiveConfigureCommand: buildInteractiveSshX11ConfigureCommand, parseDetectionOutput: parseSshX11Detection } = require("./x11-sshd-config");
const { configureXdmcpServer, detectXdmcpServer, resolveManagementConnection } = require("./xdmcp-manager");
const { packagePlan: rdpServerPackagePlan } = require("./rdp-server-manager");
const { createRemotePrivilegeGrant, getRemotePrivilegeGrant, revokeRemotePrivilegeGrant, handoffRemotePrivilegeGrant, runRemotePrivilegeCommand, runRemotePrivilegeCommandStreaming } = require("./remote-privilege");
const { DESKTOP_IDS, DESKTOP_META, DETECT_SCRIPT: LINUX_DESKTOP_DETECT_SCRIPT, buildInstallScript: buildLinuxDesktopInstallScript, buildUninstallScript: buildLinuxDesktopUninstallScript, desktopInstallPlan, parseDetectionOutput: parseLinuxDesktopDetection } = require("./linux-desktop-manager");
const { getPart } = require("./multipart");
const { parseConfigText, batchTest, saveImported, exportConfig } = require("./importer");
const { handleTerminalUpgrade, closeAllTerminals } = require("./terminal");
const { closeAllRemoteTerminals, handleRemoteTerminalUpgrade, listSerialPorts, testRemoteTerminalProfile } = require("./remote-terminal");
const { closeAllVncSessions, handleVncUpgrade, testVncProfile } = require("./vnc-proxy");
const { buildVncStartCommand, detectVncServer, validateVncServerComponent, vncServerStartValidation, vncServerStopValidation } = require("./vnc-server-manager");
const { componentInstallCommand } = require("./remote-component-installer");
const { createRemoteOfflineTaskManager } = require("./remote-offline-tasks");
const { clearVncClipboardCapabilityCache, inspectVncClipboardHelper, readVncRemoteClipboard, vncClipboardHelperGuideResult, writeVncRemoteClipboard } = require("./vnc-clipboard");
const { cleanupFtpTemp, deleteFtpPath, downloadFtpFile, listFtpDirectory, makeFtpDirectory, renameFtpPath, testFtpProfile, uploadFtpFile } = require("./ftp");
const { chmodLocalPath, createLocalEntry, deleteLocalPaths, listLocalDirectory, renameLocalPath, uploadLocalPaths } = require("./local-files");
const {
  closeAllSftpSessions,
  connectSftpSession,
  createNativeSftpDragTicket,
  disconnectSftpSession,
  getNativeSftpDragTicket,
  openNativeSftpDragTicketFile,
  planSftpPathDelivery,
  releaseNativeSftpDragTicket,
  sftpSessionStatus,
  stageSftpPaths
} = require("./sftp-session");
const { deleteCommandTemplate, handleBatchCommandUpgrade, listCommandTemplates, saveCommandTemplate, updateCommandTemplate } = require("./commands");
const { clearRemoteRecycleItems, copyRemotePaths, createRemoteFile, deleteRemoteRecycleItem, encodeRemoteText, extractRemoteArchive, invalidateRemoteDirectoryCache, listRemoteDir, listRemoteRecycleItems, makeRemoteDir, moveRemotePaths, normalizeRemotePermissionRequest, planRemoteUploads, readRemoteBinaryFile, readRemoteDirectorySize, readRemoteTextFile, renameRemotePath, resolveRemoteUploadTarget, restoreRemoteRecycleItem, setRemotePermissions, writeRemoteFile, streamRemoteFile } = require("./sftp");
const { beginNativeSftpDragJob, cancelSftpJob, clearFinishedSftpJobs, clearSftpCache, compressJob, copyJob, crossCopyJob, deletePathsJob, deleteSftpJob, extractJob, getSftpJobFile, listSftpJobs, markSftpJobDelivered, moveJob, pauseSftpJob, receiveUploadJobContent, resumeSftpJob, sftpCacheInfo, startArchiveDownloadJob, startDownloadJob, startLocalDeliveryJob, startUploadJob, startUploadReceiveJob, trackNativeSftpDragStream } = require("./sftp-jobs");
const { getExternalEdit, listExternalEdits, resolveExternalEdit, startExternalEdit, stopAllExternalEdits, stopExternalEdit, stopExternalEditsForConnection } = require("./sftp-external-edit");
const { cancelSyncJob, clearFinishedSyncJobs, deleteSyncJob, getSyncJob, listSyncJobs, retrySyncJob, startSyncJob, startSyncPlanningJob } = require("./sftp-sync");
const {
  appendSystemLog,
  deleteLogs,
  enforceConfiguredLogRetention,
  getLogSettings,
  listLogs,
  readLog,
  readLogWindow,
  readRawLog,
  updateLogSettings
} = require("./logs");
const { listNotifications, notifyEvent } = require("./notifications");
const {
  AuthenticationError,
  authRequired,
  createSession,
  hostAllowed,
  isAuthenticated,
  isDirectLoopbackRequest,
  isDesktopRequest,
  isLocalRequest,
  login,
  logout,
  publicAuthStatus,
  publicSecuritySettings,
  readSecuritySettings,
  resetWebAccessSecurity,
  sameOrigin,
  secureHeaders,
  sessionCookie,
  setDesktopAuthToken,
  setPassword,
  setToken,
  updateSecurityOptions,
  webSocketOriginAllowed,
  writeSecuritySettings
} = require("./security");
const { acceptHostTrust, hostTrustErrorResponse, listTrustedHosts, listTrustedHostsPage, removeTrustedHost } = require("./ssh-host-trust");
const { closeJumpConnectionPool, ensureConnectionHostTrusted } = require("./ssh2-client");
const { disableEncryption, enableEncryption, encryptionReady, encryptText, decryptText, isEncryptedText, lockEncryption, requireEncryptionUnlocked, unlockEncryption } = require("./crypto-store");
const { clearConfigSnapshots, createConfigSnapshot, deleteConfigSnapshot, listConfigSnapshots, pruneConfigSnapshotsForCurrentEncryption, restoreConfigSnapshotById } = require("./config-snapshots");
const { ensurePrivateFile } = require("./storage-permissions");
const { ptyRuntimeStatus } = require("./pty-runtime");
const { createUpdateChecker } = require("./update-checker");
const { UpdateInstaller } = require("./update-installer");
const { createDatabaseBundleHeader, DatabaseTransferStore } = require("./database-transfer");
const { handleLogRoutes } = require("./routes/log-routes");
const { handlePublicAuthRoutes, handleSecurityRoutes } = require("./routes/security-routes");
const { handleUpdateRoutes } = require("./routes/update-routes");
const { createStorageRestoreHelpers } = require("./storage-restore");
const {
  MAX_PORT_FALLBACKS,
  availableListenHosts,
  isLoopbackHost,
  normalizeListenHosts,
  normalizeListenPort,
  normalizeRuntimeSettings,
  readRuntimeSettings,
  writeRuntimeSettings
} = require("./runtime-settings");

const PACKAGE_ROOT = path.resolve(PUBLIC_DIR, "..");
const PACKAGE_VERSION = String(JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version || "");
const prunedConfigSnapshots = pruneConfigSnapshotsForCurrentEncryption();
if (prunedConfigSnapshots) appendSystemLog(`配置加密状态已变化，已安全清理 ${prunedConfigSnapshots} 个不兼容的旧快照`);
const STARTUP_STATUS_FILE = path.join(DATA_DIR, "startup-status.json");
let startupStatus: any = { state:"starting", started_at:Date.now(), local_url:"", lan_urls:[], autostart:{ok:0,failed:0,errors:[]}, restore:{ok:0,failed:0,errors:[]} };
const databaseTransferStore = new DatabaseTransferStore(DATA_DIR);
const updateChecker = createUpdateChecker({
  dataDir: DATA_DIR,
  packagePath: path.join(PACKAGE_ROOT, "package.json"),
  onUpdate(result) {
    notifyEvent({
      type: "update",
      level: "info",
      key: `update:${result.latest_version}`,
      title: "发现 Terma 新版本",
      message: `当前版本 ${result.current_version}，最新版本 ${result.latest_version}${result.name ? `（${result.name}）` : ""}。`,
      action: { url: result.release_url }
    }, { cooldown_ms: 0 });
  }
});
const updateInstaller = new UpdateInstaller(DATA_DIR);

function aboutInfo() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
  const resourcesPath = (process as typeof process & { resourcesPath?: string }).resourcesPath;
  const licenseCandidates = [
    resourcesPath ? path.join(resourcesPath, "LICENSE") : "",
    path.join(PACKAGE_ROOT, "LICENSE")
  ].filter(Boolean);
  const licensePath = licenseCandidates.find(candidate => fs.existsSync(candidate));
  const repository = typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url;
  const author = typeof packageJson.author === "string"
    ? packageJson.author.replace(/\s*<[^>]+>\s*$/, "").trim()
    : String(packageJson.author?.name || "").trim();
  return {
    product_name: "Terma",
    version: packageJson.version,
    author,
    license: packageJson.license,
    license_name: "GNU General Public License v3.0 only",
    repository_url: String(packageJson.homepage || repository || "").replace(/^git\+/, "").replace(/\.git$/, ""),
    license_available: Boolean(licensePath),
    license_error: licensePath ? "" : "未找到随程序提供的开源许可正文",
    license_text: licensePath ? fs.readFileSync(licensePath, "utf8") : ""
  };
}

function writeStartupStatus(next: any = {}) {
  startupStatus = {...startupStatus, ...next, updated_at:Date.now()};
  fs.mkdirSync(DATA_DIR, {recursive:true});
  fs.writeFileSync(STARTUP_STATUS_FILE, JSON.stringify(startupStatus, null, 2), "utf8");
  return startupStatus;
}

function vendorFile(packageName, relativePath) {
  const local = path.resolve(__dirname, "../node_modules", packageName, relativePath);
  if (fs.existsSync(local)) return local;
  try {
    return require.resolve(`${packageName}/${relativePath}`);
  } catch {
    return local;
  }
}

const VENDOR_FILES = new Map([
  ["/vendor/lucide/lucide.min.js", vendorFile("lucide", "dist/umd/lucide.min.js")],
  ["/vendor/xterm/xterm.css", vendorFile("@xterm/xterm", "css/xterm.css")],
  ["/vendor/xterm/xterm.js", vendorFile("@xterm/xterm", "lib/xterm.js")],
  ["/vendor/xterm/xterm.mjs", vendorFile("@xterm/xterm", "lib/xterm.mjs")],
  ["/vendor/xterm/addon-fit.js", vendorFile("@xterm/addon-fit", "lib/addon-fit.js")],
  ["/vendor/xterm/addon-fit.mjs", vendorFile("@xterm/addon-fit", "lib/addon-fit.mjs")]
]);
const ACE_VENDOR_DIR = vendorFile("ace-builds", "src-min-noconflict");
const NOVNC_VENDOR_DIR = vendorFile("@novnc/novnc", "core/..");

function readBody(req, maxBytes = 100 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req): Promise<any> {
  const body = await readBody(req, 2 * 1024 * 1024);
  return body.length ? JSON.parse(body.toString("utf8")) : {};
}

function safeUploadName(value) {
  return path.basename(String(value || "upload.bin")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "upload.bin";
}

function send(res, status, data, headers = {}) {
  const binary = Buffer.isBuffer(data) || data instanceof Uint8Array;
  const body = Buffer.isBuffer(data)
    ? data
    : data instanceof Uint8Array
      ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
      : Buffer.from(typeof data === "string" ? data : JSON.stringify(data), "utf8");
  res.writeHead(status, {
    "Content-Length": body.length,
    "Content-Type": binary ? "application/octet-stream" : (typeof data === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8"),
    ...secureHeaders(headers)
  });
  res.end(body);
}

function sendJson(res, data, status = 200) {
  send(res, status, data, { "Content-Type": "application/json; charset=utf-8" });
}

function nativeDragByteRange(value, size) {
  const header = String(value || "").trim();
  if (!header) return {start:0, end:Math.max(-1, size - 1), partial:false};
  const match = /^bytes=(\d+)-(\d*)$/i.exec(header);
  if (!match) return null;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= size) return null;
  return {start, end:Math.min(size - 1, requestedEnd), partial:true};
}

async function streamNativeSftpDragContent(req, res, token, index) {
  const ticket = await getNativeSftpDragTicket(token);
  const entry = ticket.entries[Number(index)];
  if (!entry || entry.type !== "file") return sendJson(res, {error:"拖出文件不存在"}, 404);
  const range = nativeDragByteRange(req.headers.range, Number(entry.size || 0));
  if (!range) return send(res, 416, "", {
    "Content-Range":`bytes */${Math.max(0, Number(entry.size || 0))}`,
    "Accept-Ranges":"bytes",
    "Cache-Control":"no-store"
  });
  const opened = await openNativeSftpDragTicketFile(token, index, range);
  const task = beginNativeSftpDragJob(token, ticket);
  if (task.status === "discarded") {
    try { opened.stream.destroy(); } catch {}
    return sendJson(res, {error:"拖出已转为跨主机复制"}, 410);
  }
  trackNativeSftpDragStream(token, index, opened);
  const headers: any = {
    "Content-Type":"application/octet-stream",
    "Content-Length":opened.length,
    "Content-Disposition":`attachment; filename="${encodeURIComponent(entry.name || "download")}"`,
    "Accept-Ranges":"bytes",
    "Cache-Control":"no-store"
  };
  if (range.partial) headers["Content-Range"] = `bytes ${opened.start}-${opened.end}/${opened.total}`;
  res.writeHead(range.partial ? 206 : 200, secureHeaders(headers));
  let completed = false;
  const close = () => {
    if (completed) return;
    completed = true;
    try { opened.stream.destroy(); } catch {}
  };
  req.once("aborted", close);
  res.once("close", close);
  opened.stream.once("error", (error) => {
    if (!res.headersSent) return sendJson(res, {error:error?.message || "远端文件读取失败"}, 500);
    try { res.destroy(error); } catch {}
  });
  opened.stream.pipe(res);
}

function prepareSftpWriteContent(content, encoding = "utf8") {
  const maximumMb = readRuntimeSettings(RUNTIME_SETTINGS_FILE).sftp_max_open_file_size_mb;
  const maximumBytes = maximumMb * 1024 * 1024;
  const encoded = encodeRemoteText(content, encoding);
  if (encoded.length > maximumBytes) throw new Error(`在线编辑内容不能超过 ${maximumMb} MB`);
  return { content:encoded, maximum_bytes:maximumBytes };
}

function programCacheView() {
  const sftp = sftpCacheInfo();
  const updates = updateInstaller.cacheInfo();
  const bytes = Number(sftp.bytes || 0) + Number(updates.bytes || 0);
  const reclaimableBytes = Number(sftp.reclaimable_bytes || 0) + (updates.busy ? 0 : Number(updates.bytes || 0));
  return {
    bytes,
    files:Number(sftp.files || 0) + Number(updates.files || 0),
    reclaimable_bytes:reclaimableBytes,
    retained_bytes:Math.max(0, bytes - reclaimableBytes),
    categories:{sftp_downloads:sftp.downloads, sftp_uploads:sftp.uploads, sftp_drag:sftp.drag, updates}
  };
}

function forwardLogLabel(id) {
  const forwardId = Number(id);
  for (const connection of listConnections()) {
    const forward = (connection.forwards || []).find((item) => item.id === forwardId);
    if (!forward) continue;
    const target = forward.mode === "socks"
      ? `${forward.bind_host}:${forward.bind_port}`
      : `${forward.bind_host}:${forward.bind_port} -> ${forward.target_host}:${forward.target_port}`;
    return `${connection.name} / ${forward.service_name || target}`;
  }
  return `转发规则 ${forwardId}`;
}

async function inspectServer(connectionId) {
  const connection = getConnection(Number(connectionId));
  const script = [
    "printf '## system\\n'",
    "(uname -a 2>/dev/null || true)",
    "printf '\\n## os\\n'",
    "(cat /etc/os-release 2>/dev/null | sed -n '1,6p' || true)",
    "printf '\\n## uptime\\n'",
    "(uptime 2>/dev/null || true)",
    "printf '\\n## memory\\n'",
    "(free -h 2>/dev/null || vm_stat 2>/dev/null || true)",
    "printf '\\n## disk\\n'",
    "(df -h 2>/dev/null | sed -n '1,12p' || true)",
    "printf '\\n## ports\\n'",
    "(ss -tuln 2>/dev/null | sed -n '1,12p' || netstat -tuln 2>/dev/null | sed -n '1,12p' || true)"
  ].join("\n");
  const result: any = await runSshCommandForConnection(connection, buildRemotePosixCommand(script), 20000);
  const output = `${result.stdout || ""}${result.stderr || ""}${result.error ? result.error.message : ""}`.trim();
  return {
    id: connection.id,
    name: connection.name,
    ok: result.status === 0,
    exit_code: result.status,
    checked_at: Date.now(),
    output: output || (result.status === 0 ? "巡检完成，无输出" : `巡检失败，退出码 ${result.status}`)
  };
}

async function terminalCapabilitiesForConnection(connection) {
  return discoverRemoteTerminalCapabilities(
    async (command) => runSshCommandForConnection(connection, command, 10000),
    { timeoutMs: 9000 }
  );
}

async function x11ApplicationsForConnection(connection) {
  return discoverRemoteX11Applications(
    async (command) => runSshCommandForConnection(connection, command, 12000)
  );
}

async function x11InstallPlanForConnection(connection) {
  const discovery = await x11ApplicationsForConnection(connection);
  return {
    discovery,
    install_plan:discovery.install_plan || buildRemoteX11InstallPlan(discovery)
  };
}

function removeKnownSudoWrappers(command) {
  return String(command || "")
    .replace(/\bsudo\s+(?=(?:\/usr\/sbin\/installer|apt-get\b|dnf\b|pacman\b|yum\b|zypper\b))/g, "");
}

async function installX11ApplicationsForConnection(connection, data: any = {}) {
  const planResult = await x11InstallPlanForConnection(connection);
  const plan = planResult.install_plan || planResult.discovery?.install_plan || {};
  const action = String(data?.action || "install").trim().toLowerCase();
  if (!["install", "install-offline", "install-local-offline", "online", "offline", "local-offline", "offline-local", "uninstall"].includes(action)) {
    throw new Error("X11 组件安装操作无效");
  }
  if (["install-local-offline", "local-offline", "offline-local"].includes(action)) {
    const localPlan = plan.local_offline || plan.component_plan?.local_offline || {};
    const packages = localPlan.package_names || plan.local_offline_packages || [];
    if (!localPlan.available || !packages.length || plan.platform !== "linux" || plan.package_manager !== "apt") {
      throw new Error(`本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${plan.package_manager || planResult.discovery?.package_manager || "非 APT 包管理器"}，请返回选择其他可用方式`);
    }
    const grant = createRemoteAdminGrant(connection, data, "x11.remote-install-local-offline");
    if (!planResult.discovery?.privileged && !grant) throw new Error("此操作需要临时管理员授权");
    try {
      const task = remoteOfflineTasks.startAptInstall({
        connection,
        component:"x11",
        component_label:"X11 组件",
        resource_key:`x11-components:${Number(connection.id || 0)}`,
        packages,
        grant,
        elevate:true,
        direct_root:Boolean(planResult.discovery?.privileged),
        scope:"x11.remote-install-local-offline",
        verify:() => x11ApplicationsForConnection(connection),
        validate:after => Boolean(after?.xauth_available) || "X11 离线安装已结束，但远端仍未检测到 xauth",
        release_grant:releaseRemoteAdminGrant
      });
      return {ok:true, action:"install-local-offline", mode:"local-offline", discovery:planResult.discovery, install_plan:plan, task, temporary_authorization:Boolean(grant)};
    } catch (error) {
      releaseRemoteAdminGrant(grant);
      throw error;
    }
  }
  const uninstalling = action === "uninstall";
  const mode = ["install-offline", "offline"].includes(action) ? "offline" : "online";
  const selected = uninstalling ? plan.uninstall : componentInstallCommand(plan.component_plan || plan, mode)
    || (mode === "online" ? componentInstallCommand(plan.component_plan || plan, "install") : null);
  const command = String(selected?.command || (uninstalling ? "" : mode === "online" ? plan.command : plan.offline_command) || "").trim();
  if (!command) {
    if (uninstalling) throw new Error(selected?.reason || "当前远端没有可安全自动执行的 X11 卸载方案，请查看手动说明");
    throw new Error(mode === "offline" ? "远端没有可用的 X11 软件包缓存；请返回安装界面选择仍可用的方式，或查看手动说明" : "当前远端没有可自动执行的 X11 安装命令");
  }
  const grantScope = uninstalling ? "x11.remote-uninstall" : mode === "offline" ? "x11.remote-install-offline" : "x11.remote-install";
  const grant = createRemoteAdminGrant(connection, data, grantScope);
  if ((uninstalling || plan.requires_password) && !planResult.discovery?.privileged && !grant) throw new Error(`${uninstalling ? "卸载" : "安装"}远端 X11 组件需要临时管理员授权`);
  const task = startRemoteComponentCommandTask({
    connection,
    component:"x11",
    componentLabel:"X11 组件",
    resourceKey:`x11-components:${Number(connection.id || 0)}`,
    action:uninstalling ? "uninstall" : mode === "offline" ? "install-offline" : "install",
    actionLabel:uninstalling ? "卸载" : mode === "offline" ? "使用远端缓存安装" : "在线安装",
    mode:uninstalling ? "uninstall" : mode,
    command,
    before:planResult.discovery,
    grant,
    scope:grantScope,
    directRoot:Boolean(planResult.discovery?.privileged),
    normalizeCommand:value => grant ? removeKnownSudoWrappers(value) : value,
    verify:() => x11ApplicationsForConnection(connection),
    validate:after => uninstalling
      ? !after?.xauth_available || "X11 卸载命令已结束，但远端仍检测到 xauth"
      : Boolean(after?.xauth_available) || "X11 安装命令已结束，但远端仍未检测到 xauth"
  });
  return {ok:true, action:task.action, mode:task.mode, discovery:planResult.discovery, install_plan:plan, task, temporary_authorization:Boolean(grant)};
}

function createRemoteAdminGrant(connection, data, scope) {
  const auth = data?.admin_auth || data?.authorization || null;
  const requestedGrant = String(data?.admin_grant_id || auth?.admin_grant_id || auth?.grant_id || "").trim();
  if (requestedGrant) return getRemotePrivilegeGrant(requestedGrant, connection, scope);
  if (!auth || typeof auth !== "object") return null;
  if (auth.identity_file) {
    const requestedPath = path.resolve(String(auth.identity_file));
    const comparablePath = value => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
    const allowed = listIdentityFiles().some(item => comparablePath(item.path) === comparablePath(requestedPath));
    if (!allowed) throw new Error("临时授权只能使用 Terma 已识别的私钥文件");
  }
  return createRemotePrivilegeGrant(connection, auth, String(scope || data?.scope || "host:*").trim() || "host:*");
}

function releaseRemoteAdminGrant(grant) {
  const policy = String(grant?.reuse_policy || grant?.reusePolicy || "once");
  if (grant?.id && policy === "once") revokeRemotePrivilegeGrant(grant.id);
}

function adminGrantView(grant) {
  if (!grant?.id) return null;
  return {
    id:String(grant.id),
    expires_at:Number(grant.expires_at || grant.expiresAt || 0),
    reuse_policy:String(grant.reuse_policy || grant.reusePolicy || "once"),
    reusable:String(grant.reuse_policy || grant.reusePolicy || "once") !== "once",
    ssh_user:String(grant.ssh_user || grant.connection?.ssh_user || ""),
    auth_method:String(grant.auth_method || grant.authorization?.auth_method || ""),
    scope:String(grant.scope || "")
  };
}

function normalizeRemoteAdminAuthorizationError(error) {
  const raw = String(error?.message || error || "").trim();
  const diagnosis = diagnoseSshError(raw);
  const lower = raw.toLowerCase();
  if (/all configured authentication methods failed|no more authentication methods available|permission denied \(publickey|authentication failed/.test(lower)) {
    const normalized: any = new Error(`SSH 认证失败：请检查临时管理员 SSH 用户名、密码、私钥或 Agent。${diagnosis.suggestions?.[0] || "请重新检查认证信息后再试。"}`);
    normalized.code = "REMOTE_ADMIN_AUTH_FAILED";
    return normalized;
  }
  if (/sudo:\s*(?:incorrect password|a password is required|authentication failure|sorry, try again|管理权限验证失败)/i.test(raw)) {
    const normalized: any = new Error("sudo 认证失败：sudo 密码不正确或当前账号没有免密 sudo 权限，请重新授权后再试。");
    normalized.code = "REMOTE_ADMIN_SUDO_FAILED";
    return normalized;
  }
  return error instanceof Error ? error : new Error(raw || "临时管理员授权失败");
}

async function issueRemoteAdminGrant(connection, data: any = {}) {
  const requestedScope = String(data?.scope || "").trim() || "host:*";
  const grant = createRemoteAdminGrant(connection, {admin_auth:data.admin_auth || data.authorization || data}, requestedScope);
  if (!grant) throw new Error("请提供临时管理员 SSH 认证信息");
  try {
    // Validate the SSH/root-or-sudo capability while the authorization dialog
    // is still visible; this keeps later service errors separate from login errors.
    const probe = await runRemotePrivilegeCommand(connection, "true", {grant_id:grant.id, scope:requestedScope, timeout_ms:30000});
    if (probe?.status !== 0) {
      throw new Error(`${probe?.stderr || probe?.stdout || probe?.error?.message || "临时管理员 SSH 验证失败"}`.trim());
    }
    return {ok:true, admin_grant:adminGrantView(grant), admin_grant_id:grant.id};
  } catch (error) {
    // A failed initial probe must never leave reusable credentials in memory.
    revokeRemotePrivilegeGrant(grant.id);
    throw normalizeRemoteAdminAuthorizationError(error);
  }
}

function normalizeVncRemoteCommandResult(result: any = {}) {
  if (result?.status === 0) return result;
  const raw = `${result?.stderr || ""}${result?.stdout || ""}${result?.error ? result.error.message || result.error : ""}`.trim();
  if (!raw) return result;
  const lower = raw.toLowerCase();
  if (/all configured authentication methods failed|no more authentication methods available|permission denied \(publickey|authentication failed/.test(lower)) {
    const diagnosis = diagnoseSshError(raw);
    return {
      ...result,
      stdout:"",
      stderr:`SSH 认证失败：临时管理员 SSH 用户名、密码、私钥或 Agent 不正确。${diagnosis.suggestions?.[0] || "请重新检查认证信息后再试。"}`,
      error:null,
      raw_error:raw
    };
  }
  if (/sudo:\s*(?:incorrect password|a password is required|authentication failure|sorry, try again)/i.test(raw)) {
    return {
      ...result,
      stdout:"",
      stderr:"sudo 认证失败：sudo 密码不正确或当前账号没有免密 sudo 权限，请重新授权后再试。",
      error:null,
      raw_error:raw
    };
  }
  return result;
}

function startRemoteComponentCommandTask({
  connection,
  component,
  componentLabel,
  action,
  actionLabel,
  mode = "online",
  command,
  before = null,
  grant = null,
  scope,
  resourceKey = "",
  timeoutMs = 20 * 60 * 1000,
  directRoot = false,
  normalizeCommand = value => value,
  normalizeResult = value => value,
  verify = null,
  validate = null
}: any) {
  const normalized = String(normalizeCommand(String(command || "")) || "").trim();
  if (!normalized) throw new Error(`${componentLabel || "远端组件"}${actionLabel || "操作"}缺少可执行命令`);
  try {
    return remoteOfflineTasks.startCommand({
      connection,
      component,
      component_label:componentLabel,
      action,
      action_label:actionLabel,
      mode,
      resource_key:resourceKey,
      before,
      run:async onChunk => normalizeResult(await (grant
        ? runRemotePrivilegeCommandStreaming(connection, normalized, {grant_id:grant.id, scope, timeout_ms:timeoutMs}, onChunk)
        : directRoot
          ? runSshCommandForConnectionStreaming(connection, buildRemotePosixCommand(normalized), timeoutMs, onChunk)
          : runRemotePrivilegeCommandStreaming(connection, normalized, {scope, timeout_ms:timeoutMs}, onChunk))),
      verify,
      validate,
      release:() => releaseRemoteAdminGrant(grant)
    });
  } catch (error) {
    releaseRemoteAdminGrant(grant);
    throw error;
  }
}

async function inspectVncServerForProfile(profile) {
  return detectVncServer(profile, {
    getConnection,
    runSshCommandForConnection
  });
}

function selectedVncComponentState(diagnostics: any = {}, targetComponent = "") {
  const component = String(targetComponent || diagnostics.target_component || diagnostics.server_session_selection?.component || "").trim();
  if (!component) return null;
  return diagnostics.selected_component
    || diagnostics.component_states?.[component]
    || null;
}

function vncComponentListening(diagnostics: any = {}, targetComponent = "") {
  const state = selectedVncComponentState(diagnostics, targetComponent);
  return state ? state.listening === true : diagnostics.listening === true;
}

function waitMs(timeoutMs) {
  return new Promise(resolve => setTimeout(resolve, timeoutMs));
}

async function waitForVncServerAction(profile, targetComponent, action, initial = null) {
  const starting = ["start", "restart", "enable"].includes(action);
  let latest = initial;
  const attempts = starting ? 12 : 8;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await inspectVncServerForProfile(profile);
    const state = selectedVncComponentState(latest, targetComponent);
    const ready = state ? state.listening === true : latest?.listening === true;
    const running = state ? state.running === true : latest?.service_state === "active";
    if (starting && ready) return latest;
    if (!starting && !running && !ready) return latest;
    if (starting && state && (state.service_state === "failed" || state.listener_mismatch)) return latest;
    if (attempt + 1 < attempts) await waitMs(starting ? 750 : 500);
  }
  return latest;
}

async function configureVncServerForProfile(profile, data: any = {}) {
  const action = String(data.action || "guide").trim().toLowerCase();
  if (!["guide", "install", "install-offline", "install-local-offline", "uninstall", "start", "stop", "restart", "enable", "disable"].includes(action)) throw new Error("VNC 服务操作无效");
  const before = await inspectVncServerForProfile(profile);
  const targetComponent = String(before.server_session_selection?.component || before.selected_component?.key || "").trim();
  const targetComponentLabel = String(before.selected_component?.label || "VNC 服务");
  if (action === "guide") return {
    ok:true,
    action,
    before,
    after:before,
    guide:before.guide,
    install_plan:before.install_plan || null,
    uninstall_plan:before.uninstall_plan || null,
    service_actions:before.service_actions || {}
  };
  const connectionId = Number(before.ssh_connection?.id || profile.options?.source_ssh_connection_id || profile.options?.ssh_connection_id || 0);
  if (!connectionId) throw new Error("该 VNC 连接没有关联的 SSH 管理连接，无法执行远程操作");
  const connection = getConnection(connectionId);
  let command = "";
  let mode = action;
  if (action === "install-local-offline") {
    const localPlan = before.install_plan?.local_offline || before.package_plan?.local_offline;
    const packages = localPlan?.package_names || before.package_plan?.local_offline_packages || [];
    if (before.platform !== "linux" || before.package_manager !== "apt" || !localPlan?.available || !packages.length) {
      throw new Error(`本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${before.package_manager || before.platform || "非 APT 包管理器"}，请返回选择其他可用方式`);
    }
  } else if (action === "install" || action === "install-offline") {
    mode = action === "install-offline" ? "offline" : "online";
    const selected = componentInstallCommand(before.install_plan, mode)
      || (mode === "online" ? componentInstallCommand(before.install_plan, "install") : null);
    command = String(selected?.command || before.package_plan?.[mode === "offline" ? "offline_command" : "command"] || "").trim();
    if (!command) throw new Error(action === "install-offline" ? "远端没有可用的 VNC 离线缓存包，请改用在线安装或手动说明" : "当前 Linux 发行版没有可用的在线安装方案，请打开手动安装说明");
  } else if (["start", "restart", "enable"].includes(action)) {
    // A password entered for this one start operation is never persisted.
    // It is only used to create the remote VNC password file; saved profile
    // credentials remain the fallback for normal reconnects.
    const savedPassword = String(data.vnc_password || data.password || profile.password || "");
    const startPlan = before.start_plan || null;
    const supportsNoPassword = startPlan?.supports_no_password === true;
    // The no-password mode is intentionally opt-in for each start request.
    // Do not infer it from an empty saved password or from a truthy value.
    const allowNoPassword = data.allow_no_password === true;
    if (allowNoPassword && !supportsNoPassword) {
      throw new Error("当前 VNC 服务方案不支持明确的无密码模式");
    }
    const hasRemotePasswordFile = Boolean(String(before.password_file || "").trim());
    if (!savedPassword && !hasRemotePasswordFile && !allowNoPassword && (supportsNoPassword || startPlan?.requires_vnc_password === true)) {
      throw new Error("请先输入 VNC 密码，再配置并启动服务");
    }
    // Rebuild the command so the per-request password/no-password choice is
    // reflected in the generated x11vnc/TigerVNC service configuration.
    command = startPlan
      ? buildVncStartCommand(before, savedPassword, {allow_no_password:allowNoPassword})
      : "";
    if (!command) throw new Error(before.start_plan?.requires_vnc_password ? "请先在 VNC 连接设置中保存连接密码，再配置并启动服务" : "没有检测到可自动配置/启动的 VNC 服务方案，请打开手动配置说明");
    mode = "service";
  } else if (["stop", "disable"].includes(action)) {
    const selected = before.service_actions?.[action] || before.package_plan?.service_actions?.[action];
    command = String(selected?.command || "").trim();
    if (!selected?.available || !command) throw new Error(selected?.reason || `没有检测到可自动${action === "stop" ? "停止" : "禁用"}的 VNC 服务`);
    mode = "service";
  } else if (action === "uninstall") {
    const selected = before.uninstall_plan || before.package_plan?.uninstall;
    command = String(selected?.command || "").trim();
    if (!selected?.available || !command) throw new Error(selected?.reason || "当前主机没有可安全自动执行的 VNC 卸载方案，请查看手动说明");
    mode = "uninstall";
  }
  const grant = createRemoteAdminGrant(connection, data, `vnc.server.${action}`);
  if (!before.privileged && !grant) throw new Error("此操作需要临时管理员授权");
  if (action === "install-local-offline") {
    const localPlan = before.install_plan?.local_offline || before.package_plan?.local_offline;
    const packages = localPlan?.package_names || before.package_plan?.local_offline_packages || [];
    try {
      const task = remoteOfflineTasks.startAptInstall({
        connection,
        component:"vnc-server",
        component_label:targetComponentLabel,
        resource_key:`vnc-server:${Number(connection.id || 0)}`,
        packages,
        grant,
        elevate:true,
        direct_root:Boolean(before.privileged),
        scope:"vnc.server.install-local-offline",
        verify:() => inspectVncServerForProfile(profile),
        validate:after => targetComponent
          ? validateVncServerComponent(after, targetComponent, true)
          : Boolean(after?.installed) || "VNC 离线安装已结束，但远端仍未检测到 VNC Server",
        release_grant:releaseRemoteAdminGrant
      });
      return {ok:true, action, mode:"local-offline", before, task, temporary_authorization:Boolean(grant)};
    } catch (error) {
      releaseRemoteAdminGrant(grant);
      throw error;
    }
  }
  const actionLabels = {
    install:"在线安装", "install-offline":"使用远端缓存安装", uninstall:"卸载",
    start:"启动", stop:"停止", restart:"重新启动", enable:"启用并启动", disable:"停止并禁用"
  };
  const task = startRemoteComponentCommandTask({
    connection,
    component:"vnc-server",
    componentLabel:targetComponentLabel,
    resourceKey:`vnc-server:${Number(connection.id || 0)}`,
    action,
    actionLabel:actionLabels[action] || action,
    mode,
    command,
    before,
    grant,
    scope:`vnc.server.${action}`,
    timeoutMs:action === "install" || action === "install-offline" || action === "uninstall" ? 20 * 60 * 1000 : 120000,
    directRoot:Boolean(before.root),
    normalizeResult:normalizeVncRemoteCommandResult,
    verify:() => ["start", "restart", "enable", "stop", "disable"].includes(action)
      ? waitForVncServerAction(profile, targetComponent, action)
      : inspectVncServerForProfile(profile),
    validate:after => {
      if (action === "install" || action === "install-offline") return targetComponent
        ? validateVncServerComponent(after, targetComponent, true)
        : Boolean(after?.installed) || "VNC 安装命令已结束，但远端仍未检测到 VNC Server";
      if (action === "uninstall") return targetComponent
        ? validateVncServerComponent(after, targetComponent, false)
        : !after?.installed || "VNC 卸载命令已结束，但远端仍检测到 VNC Server";
      if (["start", "restart", "enable"].includes(action)) return targetComponent
        ? vncServerStartValidation(after, targetComponent)
        : vncComponentListening(after, targetComponent) || "VNC 服务命令已结束，但目标端口仍未监听";
      return targetComponent
        ? vncServerStopValidation(after, targetComponent)
        : !vncComponentListening(after, targetComponent) || "VNC 服务命令已结束，但目标端口仍在监听";
    }
  });
  return {
    ok:true,
    action,
    mode,
    before,
    install_plan:before.install_plan || null,
    uninstall_plan:before.uninstall_plan || null,
    service_actions:before.service_actions || {},
    task,
    temporary_authorization:Boolean(grant),
    guide:before.guide
  };
}

async function inspectVncClipboardHelperForProfile(profile) {
  clearVncClipboardCapabilityCache();
  return inspectVncClipboardHelper(profile, { getConnection, listConnections, runSshCommandForConnection });
}

async function configureVncClipboardHelperForProfile(profile, data: any = {}) {
  const action = String(data.action || "guide").trim().toLowerCase();
  if (!["guide", "install", "install-offline", "install-local-offline", "uninstall"].includes(action)) throw new Error("剪贴板辅助工具操作无效");
  const requestedConnectionId = Number(data.connection_id || 0);
  const inspectionProfile = requestedConnectionId > 0
    ? {...profile, options:{...(profile.options || {}), source_ssh_connection_id:requestedConnectionId}}
    : profile;
  const before = await inspectVncClipboardHelperForProfile(inspectionProfile);
  if (action === "guide") return vncClipboardHelperGuideResult(before);
  const uninstalling = action === "uninstall";
  if (before.platform === "macos") throw new Error(uninstalling
    ? "macOS 的 pbcopy/pbpaste 是系统自带工具，Terma 不提供卸载"
    : "macOS 已自带 pbcopy/pbpaste，无需安装；请按检查说明确认图形登录会话和剪贴板权限");
  if (before.platform !== "linux") throw new Error(`尚未识别到 Linux 远端，无法自动${uninstalling ? "卸载" : "安装"}剪贴板辅助工具`);
  const connectionId = Number(before.connection_id || 0);
  if (!connectionId) throw new Error("VNC 连接没有可用的 SSH 剪贴板辅助连接");
  const connection = getConnection(connectionId);
  const mode = uninstalling ? "uninstall" : action === "install-local-offline" ? "local-offline" : action === "install-offline" ? "offline" : "online";
  const selected = uninstalling
    ? before.uninstall_plan || before.install_plan?.uninstall
    : componentInstallCommand(before.install_plan, mode);
  if (mode === "local-offline" && before.install_plan?.local_offline?.available !== true) {
    throw new Error(`本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${before.package_manager || "非 APT 包管理器"}，请返回选择其他可用方式`);
  }
  if (uninstalling) {
    if (!before.available) throw new Error("当前没有检测到可卸载的 Linux 剪贴板辅助工具");
    if (!selected?.available || !String(selected.command || "").trim()) throw new Error(selected?.reason || "当前系统没有可安全自动执行的剪贴板辅助卸载方案");
  } else if (!selected?.command && !selected?.package_names?.length) {
    throw new Error("当前系统没有可用的此类安装方案，请查看手动安装说明");
  }
  const grant = createRemoteAdminGrant(connection, data, `vnc.clipboard-helper.${action}`);
  if (!before.root && !grant) throw new Error(`${uninstalling ? "卸载" : "安装"}剪贴板辅助工具需要临时管理员授权`);
  if (mode === "local-offline") {
    const packages = selected.package_names || [];
    try {
      const task = remoteOfflineTasks.startAptInstall({
        connection,
        component:"vnc-clipboard-helper",
        component_label:"Unicode 剪贴板辅助工具",
        resource_key:`vnc-clipboard-helper:${Number(connection.id || 0)}`,
        packages,
        package_alternatives:before.install_plan?.package_alternatives || [],
        grant,
        elevate:true,
        direct_root:Boolean(before.root),
        before,
        scope:"vnc.clipboard-helper.install-local-offline",
        verify:async () => {
          clearVncClipboardCapabilityCache();
          return inspectVncClipboardHelperForProfile(inspectionProfile);
        },
        validate:after => Boolean(after?.available) || "剪贴板辅助工具安装命令已结束，但重新探测后仍不可用",
        release_grant:releaseRemoteAdminGrant
      });
      return {ok:true, action, mode, before, install_plan:before.install_plan, uninstall_plan:before.uninstall_plan || null, task, temporary_authorization:Boolean(grant)};
    } catch (error) {
      releaseRemoteAdminGrant(grant);
      throw error;
    }
  }
  const task = startRemoteComponentCommandTask({
    connection,
    component:"vnc-clipboard-helper",
    componentLabel:"Unicode 剪贴板辅助工具",
    resourceKey:`vnc-clipboard-helper:${Number(connection.id || 0)}`,
    action,
    actionLabel:uninstalling ? "卸载" : mode === "offline" ? "使用远端缓存安装" : "在线安装",
    mode,
    command:selected.command,
    before,
    grant,
    scope:`vnc.clipboard-helper.${action}`,
    directRoot:Boolean(before.root),
    verify:async () => {
      clearVncClipboardCapabilityCache();
      return inspectVncClipboardHelperForProfile(inspectionProfile);
    },
    validate:after => uninstalling
      ? !after?.available || "剪贴板辅助工具卸载命令已结束，但重新探测后仍可用"
      : Boolean(after?.available) || "剪贴板辅助工具安装命令已结束，但重新探测后仍不可用"
  });
  return {
    ok:true,
    action,
    mode,
    before,
    install_plan:before.install_plan,
    uninstall_plan:before.uninstall_plan || before.install_plan?.uninstall || null,
    task,
    temporary_authorization:Boolean(grant)
  };
}

async function detectSshX11ForConnection(connection) {
  const probeConnection = { ...connection, x11_mode:"off" };
  const result = await runSshCommandForConnection(probeConnection, buildRemotePosixCommand(SSH_X11_DETECT_SCRIPT), 15000);
  if (result.status !== 0) {
    const output = `${result.stderr || ""}${result.stdout || ""}${result.error ? result.error.message : ""}`.trim();
    throw new Error(output || "SSH X11 转发配置探测失败");
  }
  const diagnostics = parseSshX11Detection(result.stdout);
  return {
    ...diagnostics,
    terminal_commands:diagnostics.can_terminal_manage ? {
      enable:buildInteractiveSshX11ConfigureCommand("enable"),
      disable:buildInteractiveSshX11ConfigureCommand("disable")
    } : {},
    connection:{id:connection.id, name:connection.name, host:connection.ssh_host, user:connection.ssh_user}
  };
}

async function configureSshX11ForConnection(connection, action, grant = null) {
  if (!["enable", "disable"].includes(String(action || ""))) throw new Error("SSH X11 转发操作无效");
  const before = await detectSshX11ForConnection(connection);
  if (!before.sshd_present || !before.config_present) throw new Error("远端没有找到可管理的 sshd_config");
  if (!before.can_manage && !grant) throw new Error("修改 sshd_config 需要 root 或免密 sudo 权限；可以使用临时管理员授权");
  const commandConnection = { ...connection, x11_mode:"off" };
  const result = grant
    ? await runRemotePrivilegeCommand(commandConnection, buildRemotePosixCommand(buildSshX11ConfigureScript(action)), {grant_id:grant.id, scope:"x11.sshd-config", timeout_ms:30000})
    : await runSshCommandForConnection(commandConnection, buildRemotePosixCommand(buildSshX11ConfigureScript(action)), 30000);
  if (result.status !== 0) {
    const output = `${result.stderr || ""}${result.stdout || ""}${result.error ? result.error.message : ""}`.trim();
    throw new Error(output || `SSH X11 转发${action === "enable" ? "开启" : "关闭"}失败`);
  }
  const after = await detectSshX11ForConnection(connection);
  const expected = action === "enable";
  if (after.enabled !== expected) throw new Error(`sshd_config 已修改，但 sshd 的实际 X11 转发状态仍为${after.enabled ? "开启" : "关闭"}`);
  return { before, after, output:`${result.stdout || ""}${result.stderr || ""}`.trim(), temporary_authorization:Boolean(grant) };
}

async function startSshX11ConfigurationTask(connection, action, grant = null) {
  if (!["enable", "disable"].includes(String(action || ""))) throw new Error("SSH X11 转发操作无效");
  const before = await detectSshX11ForConnection(connection);
  if (!before.sshd_present || !before.config_present) throw new Error("远端没有找到可管理的 sshd_config");
  if (!before.can_manage && !grant) throw new Error("修改 sshd_config 需要 root、免密 sudo 或临时管理员授权");
  const expected = action === "enable";
  const task = startRemoteComponentCommandTask({
    connection:{...connection, x11_mode:"off"},
    component:"x11-forwarding",
    componentLabel:"SSH X11 转发",
    resourceKey:`x11-forwarding:${Number(connection.id || 0)}`,
    action,
    actionLabel:expected ? "开启" : "关闭",
    mode:"service",
    command:buildSshX11ConfigureScript(action),
    before,
    grant,
    scope:"x11.sshd-config",
    timeoutMs:30000,
    verify:() => detectSshX11ForConnection(connection),
    validate:after => after?.enabled === expected || `sshd_config 已修改，但 SSH X11 转发仍为${after?.enabled ? "开启" : "关闭"}`
  });
  return {ok:true, action, before, task, temporary_authorization:Boolean(grant)};
}

async function verifyX11ApplicationForConnection(connection, command) {
  return verifyRemoteX11Application(
    async (script) => runSshCommandForConnection(connection, script, 12000),
    command
  );
}

const linuxDesktopTasks = new Map();
let linuxDesktopTaskSequence = 0;
const remoteOfflineTasks = createRemoteOfflineTaskManager({
  data_dir:path.join(DATA_DIR, "remote-components"),
  run_ssh_command:runSshCommandForConnection,
  run_ssh_stream:runSshCommandForConnectionStreaming,
  run_privileged_stream:runRemotePrivilegeCommandStreaming,
  start_upload:startUploadJob,
  list_sftp_jobs:listSftpJobs,
  release_grant:releaseRemoteAdminGrant
});

function linuxDesktopTaskView(task) {
  return {
    id: task.id,
    connection_id: task.connection_id,
    connection_name: task.connection_name,
    desktop_id: task.desktop_id,
    desktop_label: DESKTOP_META[task.desktop_id]?.label || task.desktop_id,
    action: task.action || "install",
    action_label: task.action === "uninstall" ? "卸载" : "安装",
    mode: task.mode || "online",
    status: task.status,
    stage: task.stage,
    progress: Number(task.progress || 0),
    logs: task.logs.slice(-300),
    error: task.error || "",
    created_at: task.created_at,
    updated_at: task.updated_at,
    finished_at: task.finished_at || 0,
    diagnostics: task.diagnostics || null
  };
}

function listLinuxDesktopTasks() {
  return [...linuxDesktopTasks.values()]
    .map(linuxDesktopTaskView)
    .sort((left, right) => Number(right.updated_at || 0) - Number(left.updated_at || 0));
}

function deleteLinuxDesktopTask(taskId) {
  const task = linuxDesktopTasks.get(String(taskId || ""));
  if (!task) return false;
  if (task.status === "running") throw new Error("运行中的桌面任务不能删除");
  return linuxDesktopTasks.delete(task.id);
}

function clearFinishedLinuxDesktopTasks() {
  let removed = 0;
  for (const task of linuxDesktopTasks.values()) {
    if (!['done', 'cancelled'].includes(task.status)) continue;
    linuxDesktopTasks.delete(task.id);
    removed += 1;
  }
  return {removed};
}

function appendLinuxDesktopTaskChunk(task, chunk, stream = "stdout") {
  task.partial = `${task.partial || ""}${Buffer.from(chunk || "").toString("utf8")}`;
  const lines = task.partial.split(/\r?\n/);
  task.partial = lines.pop() || "";
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    const stage = /^(?:TERMA|TD)_DESKTOP_STAGE=(.*)$/.exec(line);
    if (stage) {
      task.stage = stage[1] || task.stage;
      task.progress = {prepare: 12, packages: 30, refresh: 88, verify: 94, done: 100}[task.stage] ?? task.progress;
      task.updated_at = Date.now();
      continue;
    }
    const log = /^(?:TERMA|TD)_DESKTOP_LOG=(.*)$/.exec(line);
    task.logs.push({at:Date.now(), stream, text:log ? log[1] : line});
    if (task.logs.length > 400) task.logs.splice(0, task.logs.length - 400);
    task.updated_at = Date.now();
  }
}

async function detectLinuxDesktopForConnection(connection) {
  const result = await runSshCommandForConnection(connection, buildRemotePosixCommand(LINUX_DESKTOP_DETECT_SCRIPT), 30000);
  if (result.status !== 0) {
    const output = `${result.stderr || ""}${result.stdout || ""}${result.error ? result.error.message : ""}`.trim();
    throw new Error(output || "Linux 桌面探测失败");
  }
  const diagnostics = parseLinuxDesktopDetection(result.stdout);
  diagnostics.connection = {id:connection.id, name:connection.name, host:connection.ssh_host, user:connection.ssh_user};
  diagnostics.installable_desktops = DESKTOP_IDS.filter(id => Boolean(desktopInstallPlan({...diagnostics, requested_desktop:id})));
  diagnostics.desktop_install_plans = Object.fromEntries(DESKTOP_IDS.map(id => [id, desktopInstallPlan({...diagnostics, requested_desktop:id})]).filter(([, plan]) => Boolean(plan)));
  diagnostics.rdp_install_plan = rdpServerPackagePlan(diagnostics);
  diagnostics.desktop_catalog = DESKTOP_IDS.map(id => ({id, ...(DESKTOP_META[id] || {})}));
  return diagnostics;
}

async function configureRdpServerForConnection(connection, data: any = {}) {
  const action = String(data.action || "guide").trim().toLowerCase();
  if (!["guide", "install", "install-offline", "install-local-offline", "uninstall", "start", "stop", "restart", "enable", "disable"].includes(action)) throw new Error("RDP 服务操作无效");
  const before = await detectLinuxDesktopForConnection(connection);
  const plan = before.rdp_install_plan || rdpServerPackagePlan(before);
  if (action === "guide") return {
    ok:true,
    action,
    before,
    after:before,
    install_plan:plan?.install_plan || plan?.component_plan || null,
    uninstall_plan:plan?.uninstall || null,
    service_actions:plan?.service_actions || {},
    package_plan:plan
  };
  if (!before.platform_supported || !plan) throw new Error("当前 SSH 主机不是支持自动管理 RDP 服务的 Linux 系统");
  const grantScope = `rdp.server.${action}`;
  const grant = createRemoteAdminGrant(connection, data, grantScope);
  if (!before.privileged && !grant) throw new Error("此操作需要临时管理员授权");
  if (action === "install-local-offline") {
    const localPlan = plan.local_offline || plan.install_plan?.local_offline || plan.component_plan?.local_offline;
    const packages = localPlan?.package_names || plan.local_offline_packages || [];
    if (!localPlan?.available || before.package_manager !== "apt" || !packages.length) {
      releaseRemoteAdminGrant(grant);
      throw new Error(`本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${before.package_manager || "非 APT 包管理器"}，请返回选择其他可用方式`);
    }
    try {
      const task = remoteOfflineTasks.startAptInstall({
        connection,
        component:"rdp-server",
        component_label:"RDP 服务",
        resource_key:`rdp-server:${Number(connection.id || 0)}`,
        packages,
        grant,
        elevate:true,
        direct_root:Boolean(before.privileged),
        scope:"rdp.server.install-local-offline",
        verify:() => detectLinuxDesktopForConnection(connection),
        validate:after => Boolean(after?.xrdp_installed) || "RDP 离线安装已结束，但远端仍未检测到 xrdp",
        release_grant:releaseRemoteAdminGrant
      });
      return {ok:true, action, mode:"local-offline", before, install_plan:plan.install_plan || plan.component_plan, package_plan:plan, task, temporary_authorization:Boolean(grant)};
    } catch (error) {
      releaseRemoteAdminGrant(grant);
      throw error;
    }
  }
  const installing = action === "install" || action === "install-offline";
  const mode = action === "install-offline" ? "offline" : action === "uninstall" ? "uninstall" : "service";
  const selected = installing
    ? componentInstallCommand(plan.install_plan || plan.component_plan || plan, mode) || componentInstallCommand(plan, mode)
    : action === "uninstall"
      ? plan.uninstall
      : plan.service_actions?.[action];
  const command = String(selected?.command || (installing ? plan[mode === "offline" ? "offline_command" : "online_command"] || plan.command : "") || "").trim();
  if (!command) {
    releaseRemoteAdminGrant(grant);
    if (action === "uninstall") throw new Error("当前发行版没有可安全自动执行的 RDP 卸载方案，请查看手动说明");
    if (!installing) throw new Error(`当前主机没有可执行的 RDP ${action}方案`);
    throw new Error(action === "install-offline" ? "远端没有可用的 RDP 软件包缓存；请返回安装界面选择仍可用的方式，或查看手动说明" : "当前发行版没有可用的 RDP 在线安装方案");
  }
  const actionLabels = {
    install:"在线安装", "install-offline":"使用远端缓存安装", uninstall:"卸载",
    start:"启动", stop:"停止", restart:"重新启动", enable:"启用并启动", disable:"停止并禁用"
  };
  const task = startRemoteComponentCommandTask({
    connection,
    component:"rdp-server",
    componentLabel:"RDP 服务",
    resourceKey:`rdp-server:${Number(connection.id || 0)}`,
    action,
    actionLabel:actionLabels[action] || action,
    mode,
    command,
    before,
    grant,
    scope:grantScope,
    verify:() => detectLinuxDesktopForConnection(connection),
    validate:after => {
      if (installing) return Boolean(after?.xrdp_installed) || "RDP 安装命令已结束，但远端仍未检测到 xrdp";
      if (action === "uninstall") return !after?.xrdp_installed || "RDP 卸载命令已结束，但远端仍检测到 xrdp";
      if (["start", "restart", "enable"].includes(action)) return Boolean(after?.xrdp_active || after?.xrdp_listening) || "RDP 服务命令已结束，但服务仍未运行";
      return !after?.xrdp_active && !after?.xrdp_listening || "RDP 服务命令已结束，但服务仍在运行";
    }
  });
  return {
    ok:true,
    action,
    mode,
    before,
    install_plan:plan.install_plan || plan.component_plan,
    uninstall_plan:plan.uninstall || null,
    service_actions:plan.service_actions || {},
    package_plan:plan,
    task,
    temporary_authorization:Boolean(grant)
  };
}

function startLinuxDesktopInstall(connectionId, desktopId, action = "install", grant = null, mode = "online") {
  const connection = getConnection(Number(connectionId));
  const requested = String(desktopId || "").toLowerCase();
  const operation = action === "uninstall" ? "uninstall" : "install";
  const normalizedMode = operation === "install" && String(mode || "online").toLowerCase() === "offline"
    ? "offline"
    : operation === "install" && ["local-offline", "install-local-offline", "offline-local"].includes(String(mode || "").toLowerCase())
      ? "local-offline"
      : "online";
  const localOffline = normalizedMode === "local-offline";
  if (!DESKTOP_IDS.includes(requested)) throw new Error("Linux 桌面类型无效");
  const runningTask = [...linuxDesktopTasks.values()].find(item => Number(item.connection_id || 0) === Number(connection.id || 0) && item.status === "running");
  if (runningTask) {
    const error: any = new Error("该 SSH 主机已有 Linux 桌面任务正在执行，请等待完成后再试");
    error.code = "REMOTE_TASK_CONFLICT";
    error.statusCode = 409;
    error.task = linuxDesktopTaskView(runningTask);
    throw error;
  }
  const task = {
    id:`linux-desktop-${Date.now()}-${++linuxDesktopTaskSequence}`,
    connection_id:connection.id,
    connection_name:connection.name,
    desktop_id:requested,
    action:operation,
    status:"running",
    stage:"prepare",
    progress:5,
    logs:[{at:Date.now(), stream:"system", text:`开始${operation === "uninstall" ? "卸载" : "安装"} ${DESKTOP_META[requested]?.label || requested}`}],
    error:"",
    created_at:Date.now(),
    updated_at:Date.now(),
    finished_at:0,
    partial:"",
    remote_task_id:"",
    diagnostics:null,
    admin_grant_id:grant?.id || "",
    mode:operation === "uninstall" ? "uninstall" : normalizedMode
  };
  linuxDesktopTasks.set(task.id, task);
  void (async () => {
    let delegatedGrant = false;
    try {
      const before = await detectLinuxDesktopForConnection(connection);
      task.diagnostics = before;
      if (!before.platform_supported) throw new Error("当前连接不是 Linux 主机");
       if (!before.privileged && !grant) throw new Error("操作桌面需要 root 或免密码 sudo 权限；可以使用临时管理员授权");
       if (operation === "uninstall" && !before.desktops.some(item => item.id === requested)) throw new Error("当前没有检测到该桌面环境，无法卸载");
       if (localOffline) {
         const installPlan = before.desktop_install_plans?.[requested] || desktopInstallPlan({...before, requested_desktop:requested});
         const localPlan = installPlan?.local_offline || installPlan?.component_plan?.local_offline;
         const packages = localPlan?.package_names || installPlan?.local_offline_packages || [];
         if (!localPlan?.available || before.package_manager !== "apt" || !packages.length) throw new Error(`本机下载后离线安装仅支持 Debian/Ubuntu 及兼容 APT/.deb 系统；当前检测到 ${before.package_manager || "非 APT 包管理器"}，请返回选择其他可用方式`);
         const remoteTask = remoteOfflineTasks.startAptInstall({
           connection,
           component:`linux-desktop-${requested}`,
           component_label:`Linux 桌面 · ${DESKTOP_META[requested]?.label || requested}`,
           packages,
           grant,
           direct_root:Boolean(before.privileged),
           scope:"linux-desktop.install-local-offline",
           release_grant:releaseRemoteAdminGrant
         });
         delegatedGrant = true;
         task.remote_task_id = remoteTask.id;
         for (;;) {
           const snapshot = remoteOfflineTasks.list().find(item => String(item.id) === String(remoteTask.id));
           if (!snapshot) throw new Error("远端组件离线任务不存在或已过期");
           task.stage = snapshot.stage || task.stage;
           task.progress = Number(snapshot.progress || task.progress);
           task.logs = Array.isArray(snapshot.logs) ? snapshot.logs.slice(-400) : task.logs;
           task.error = snapshot.error || "";
           task.updated_at = Date.now();
           if (snapshot.status === "done") break;
           if (snapshot.status === "failed") throw new Error(snapshot.error || "Linux 桌面本机离线安装失败");
           await new Promise(resolve => setTimeout(resolve, 500));
         }
         task.stage = "verify";
         task.progress = 94;
         task.logs.push({at:Date.now(), stream:"system", text:"软件包安装完成，正在重新探测桌面会话"});
         const afterOffline = await detectLinuxDesktopForConnection(connection);
         task.diagnostics = afterOffline;
         if (!afterOffline.desktops.some(item => item.id === requested)) throw new Error(`${DESKTOP_META[requested]?.label || requested} 离线安装已结束，但未检测到可用桌面会话`);
         task.stage = "done";
         task.progress = 100;
         task.status = "done";
         task.logs.push({at:Date.now(), stream:"system", text:"本机离线安装完成，桌面列表已重新探测"});
         return;
       }
       const privilegedDiagnostics = grant && !before.privileged ? {...before, privileged:true} : before;
       const script = operation === "uninstall" ? buildLinuxDesktopUninstallScript(privilegedDiagnostics, requested) : buildLinuxDesktopInstallScript(privilegedDiagnostics, requested, normalizedMode);
       const installScope = operation === "uninstall" ? "linux-desktop.uninstall" : normalizedMode === "offline" ? "linux-desktop.install-offline" : "linux-desktop.install";
       const result = grant
          ? await runRemotePrivilegeCommandStreaming(connection, buildRemotePosixCommand(script), {grant_id:grant.id, scope:installScope, timeout_ms:20 * 60 * 1000}, (chunk, stream) => appendLinuxDesktopTaskChunk(task, chunk, stream))
         : await runSshCommandForConnectionStreaming(connection, buildRemotePosixCommand(script), 20 * 60 * 1000, (chunk, stream) => appendLinuxDesktopTaskChunk(task, chunk, stream));
      if (task.partial) appendLinuxDesktopTaskChunk(task, "\n", "stdout");
      if (result.status !== 0) throw new Error(`${result.stderr || result.stdout || result.error?.message || `远端${operation === "uninstall" ? "卸载" : "安装"}退出码 ${result.status}`}`.trim());
      task.stage = "verify";
      task.progress = 94;
      task.logs.push({at:Date.now(), stream:"system", text:"正在验证远端桌面会话状态"});
      const after = await detectLinuxDesktopForConnection(connection);
      task.diagnostics = after;
      const stillDetected = after.desktops.some(item => item.id === requested);
      if (operation === "install" && !stillDetected) throw new Error(`${DESKTOP_META[requested]?.label || requested} 安装命令已结束，但未检测到可用桌面会话`);
      if (operation === "uninstall" && stillDetected) throw new Error(`${DESKTOP_META[requested]?.label || requested} 卸载未完成，远端仍存在对应桌面核心程序或会话`);
      task.stage = "done";
      task.progress = 100;
      task.status = "done";
      task.logs.push({at:Date.now(), stream:"system", text:`${operation === "uninstall" ? "卸载" : "安装"}完成，桌面列表已重新探测`});
    } catch (error) {
      task.status = "failed";
      task.error = error.message || String(error);
      task.logs.push({at:Date.now(), stream:"error", text:task.error});
     } finally {
       if (!delegatedGrant) releaseRemoteAdminGrant(grant);
       task.finished_at = Date.now();
      task.updated_at = task.finished_at;
      setTimeout(() => linuxDesktopTasks.delete(task.id), 60 * 60 * 1000).unref?.();
    }
  })();
  return linuxDesktopTaskView(task);
}


function loginPage() {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terma 登录</title><style>
body{margin:0;min-height:100vh;min-height:100dvh;padding:16px;box-sizing:border-box;display:grid;place-items:center;font:14px system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f6f8;color:#1f2933;overflow-x:hidden}.card{width:min(360px,100%);box-sizing:border-box;background:#fff;border:1px solid #d6dde3;border-radius:6px;padding:22px;box-shadow:0 12px 32px rgba(15,23,42,.12)}h1{font-size:22px;margin:0 0 8px}.muted{color:#687782;margin-bottom:18px}label{display:block;font-size:12px;color:#687782;margin-bottom:6px}.password-field{position:relative;min-width:0}.password-field input{width:100%;min-width:0;box-sizing:border-box;padding:10px 44px 10px 10px;border:1px solid #ccd4dc;border-radius:4px;font:inherit}.password-toggle{position:absolute;inset:1px 1px 1px auto;width:40px;min-width:40px;margin:0;padding:0;display:grid;place-items:center;border:0;border-radius:3px;background:transparent;color:#52616b;cursor:pointer}.password-toggle:hover{background:#eef2f6;color:#1f2933}.password-toggle:focus-visible{outline:2px solid #2563eb;outline-offset:-3px}.password-toggle svg{width:18px;height:18px;display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.password-toggle svg[hidden]{display:none}.login-button{width:100%;margin-top:14px;padding:10px;border:0;border-radius:4px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}.err{color:#b42318;min-height:20px;margin-top:10px}</style><div class="card"><h1>Terma</h1><div class="muted">请输入 Web 访问密码；仅配置 Token 时也可直接输入 Token。</div><label for="password">密码或 Token</label><div class="password-field"><input id="password" type="password" autocomplete="current-password" autofocus><button id="passwordToggle" class="password-toggle" type="button" title="显示密码" aria-label="显示密码" aria-pressed="false"><svg id="passwordShowIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg><svg id="passwordHideIcon" viewBox="0 0 24 24" aria-hidden="true" hidden><path d="M3 3l18 18"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c6.5 0 10 8 10 8a18.3 18.3 0 0 1-2.3 3.5"></path><path d="M6.6 6.6C3.7 8.5 2 12 2 12s3.5 8 10 8a10.8 10.8 0 0 0 5.4-1.4"></path></svg></button></div><button class="login-button" type="button" onclick="login()">登录</button><div id="err" class="err"></div></div><script>
const passwordInput=document.getElementById('password');
const passwordToggle=document.getElementById('passwordToggle');
const passwordShowIcon=document.getElementById('passwordShowIcon');
const passwordHideIcon=document.getElementById('passwordHideIcon');
function setPasswordVisible(visible){const selectionStart=passwordInput.selectionStart;const selectionEnd=passwordInput.selectionEnd;passwordInput.type=visible?'text':'password';const actionLabel=visible?'隐藏密码':'显示密码';passwordToggle.title=actionLabel;passwordToggle.setAttribute('aria-label',actionLabel);passwordToggle.setAttribute('aria-pressed',String(visible));passwordShowIcon.hidden=visible;passwordHideIcon.hidden=!visible;passwordInput.focus({preventScroll:true});if(selectionStart!==null&&selectionEnd!==null){try{passwordInput.setSelectionRange(selectionStart,selectionEnd)}catch{}}}
passwordToggle.addEventListener('click',()=>setPasswordVisible(passwordInput.type==='password'));
async function login(){const password=document.getElementById('password').value;const res=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});if(res.ok){location.href='/';return;}let text='登录失败';try{text=(await res.json()).error||text}catch{}document.getElementById('err').textContent=text}
passwordInput.addEventListener('keydown',e=>{if(e.key==='Enter')login()});
</script></html>`;
}

function serveStatic(req, res, pathname) {
  if (pathname === "/favicon.ico") {
    res.writeHead(204, secureHeaders());
    res.end();
    return;
  }
  if (pathname === "/login") return send(res, 200, loginPage(), { "Content-Type": "text/html; charset=utf-8" });
  if (!isAuthenticated(req)) {
    if (authRequired(req)) return send(res, 302, "", { Location: "/login" });
  }
  let file;
  let isVendorFile = VENDOR_FILES.has(pathname);
  if (isVendorFile) {
    file = VENDOR_FILES.get(pathname);
  } else if (pathname.startsWith("/vendor/ace/")) {
    const name = pathname.slice("/vendor/ace/".length);
    if (!/^(?:ace|mode-[a-z0-9_-]+|theme-[a-z0-9_-]+|worker-[a-z0-9_-]+|ext-[a-z0-9_-]+)\.js$/i.test(name)) return sendJson(res, {error:"Not found"}, 404);
    file = path.resolve(ACE_VENDOR_DIR, name);
    isVendorFile = file.startsWith(path.resolve(ACE_VENDOR_DIR) + path.sep);
  } else if (pathname.startsWith("/vendor/novnc/")) {
    const name = pathname.slice("/vendor/novnc/".length);
    if (!/^(?:core|vendor)\/[a-z0-9_./-]+\.js$/i.test(name)) return sendJson(res, {error:"Not found"}, 404);
    file = path.resolve(NOVNC_VENDOR_DIR, name);
    const root = path.resolve(NOVNC_VENDOR_DIR) + path.sep;
    isVendorFile = file.startsWith(root) && (name.startsWith("core/") || name.startsWith("vendor/"));
  } else {
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    file = path.resolve(PUBLIC_DIR, rel);
  }
  if (!isVendorFile && !file.startsWith(PUBLIC_DIR)) {
    sendJson(res, { error: "Not found" }, 404);
    return;
  }
  if (isVendorFile && (!fs.existsSync(file) || fs.statSync(file).isDirectory())) {
    sendJson(res, { error: "Vendor file not found" }, 404);
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(PUBLIC_DIR, "index.html");
  }
  const ext = path.extname(file).toLowerCase();
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
  const body = fs.readFileSync(file);
  res.writeHead(200, secureHeaders({ "Content-Type": types[ext] || "application/octet-stream", "Content-Length": body.length, "Cache-Control":"no-cache" }));
  res.end(body);
}

function remoteClientDiagnosticsWithoutDesktopIntegration(x11: any = {}) {
  const x11Reason = String(x11?.reason || "").trim();
  const integrationReason = "当前请求无法调用 Terma 桌面集成";
  return {
    platform:process.platform,
    desktop:false,
    integration_available:false,
    rdp:{
      available:false,
      client:"",
      executable:"",
      reason:"系统 RDP 客户端只能由本机桌面版调用"
    },
    vnc:{
      available:false,
      client:"",
      executable:"",
      reason:"系统 VNC 客户端只能由本机桌面版调用（内置 VNC 不受此限制）"
    },
    xdmcp:{
      available:false,
      client:"",
      executable:"",
      can_install:false,
      install_label:process.platform === "darwin" ? "安装 XQuartz" : process.platform === "linux" ? "安装 Xephyr" : "",
      reason:x11Reason ? `${x11Reason}；${integrationReason}` : `XDMCP 窗口只能由本机桌面版调用；${integrationReason}`
    },
    x11,
    message:integrationReason
  };
}

function xServerDiagnosticsWithoutDesktopIntegration(serverSide: any = x11RuntimeDiagnostics()) {
  return {
    platform:process.platform,
    desktop:false,
    integration_available:false,
    available:false,
    installed:false,
    running:false,
    managed:false,
    can_start:false,
    can_stop:false,
    can_install:false,
    mode:"unavailable",
    server:"",
    display:"",
    reason:"当前连接的是独立 Web/测试后端，无法读取运行 Terma 桌面设备上的 X Server",
    server_side:serverSide
  };
}

function xdmcpTaskResourceKey(connection: any, request: any = {}, task: any = {}) {
  const hint = [
    request?.action,
    request?.target_action,
    request?.target,
    request?.component,
    task?.action,
    task?.component
  ].map(value => String(value || "").toLowerCase()).join(" ");
  const family = /\bx?rdp\b/.test(hint) ? "rdp-server" : "xdmcp-server";
  return `${family}:${Number(connection?.id || connection || 0)}`;
}

function hasShutdownToken(req) {
  const provided = String(req.headers["x-terma-shutdown-token"] || "").trim();
  if (!provided || !shutdownAuthToken) return false;
  const actual = Buffer.from(provided);
  const expected = Buffer.from(shutdownAuthToken);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function handleApi(req, res, pathname) {
  if (!hostAllowed(req)) return sendJson(res, { error:"Unrecognized Host" }, 421);
  if (!sameOrigin(req)) return sendJson(res, { error: "Forbidden" }, 403);
  if (req.method === "POST" && pathname === "/api/shutdown") {
    const sourceWebRequest = !desktopIntegration && isDirectLoopbackRequest(req) && isAuthenticated(req);
    if (!hasShutdownToken(req) && !isDesktopRequest(req) && !sourceWebRequest) {
      return sendJson(res, { error:"Forbidden" }, 403);
    }
    sendJson(res, { ok:true });
    shutdown();
    return;
  }
  const nativeDragParts = pathname.split("/").filter(Boolean);
  if (
    req.method === "GET"
    && nativeDragParts.length === 6
    && nativeDragParts[0] === "api"
    && nativeDragParts[1] === "sftp"
    && nativeDragParts[2] === "native-drag"
    && nativeDragParts[4] === "content"
  ) {
    if (!isDirectLoopbackRequest(req) || !desktopIntegration) return sendJson(res, {error:"原生拖出内容只能由本机桌面端读取"}, 403);
    return streamNativeSftpDragContent(req, res, nativeDragParts[3], Number(nativeDragParts[5]));
  }
  if (
    req.method === "GET"
    && nativeDragParts.length === 4
    && nativeDragParts[0] === "api"
    && nativeDragParts[1] === "sftp"
    && nativeDragParts[2] === "native-drag"
  ) {
    if (!isDirectLoopbackRequest(req) || !desktopIntegration) return sendJson(res, {error:"原生拖出凭据只能由本机桌面端读取"}, 403);
    return sendJson(res, await getNativeSftpDragTicket(nativeDragParts[3]));
  }
  if (
    req.method === "DELETE"
    && nativeDragParts.length === 4
    && nativeDragParts[0] === "api"
    && nativeDragParts[1] === "sftp"
    && nativeDragParts[2] === "native-drag"
  ) {
    if (!isDirectLoopbackRequest(req) || !desktopIntegration) {
      return sendJson(res, {error:"原生拖出凭据只能由本机桌面端使用"}, 403);
    }
    return sendJson(res, {ok:releaseNativeSftpDragTicket(nativeDragParts[3])});
  }
  const securityRouteDependencies = {
    AuthenticationError, clearConfigSnapshots, createSession, decryptStoredConnectionSecrets, disableEncryption, enableEncryption,
    encryptStoredConnectionSecrets, login, logout, publicSecuritySettings, readJson, readSecuritySettings,
    publicAuthStatus, send, sendJson, sessionCookie, setPassword, setToken, unlockEncryption, updateSecurityOptions
  };
  securityRouteDependencies.publicSecuritySettings = request => ({
    ...publicSecuritySettings(request),
    encryption_unlocked: encryptionReady()
  });
  if (await handlePublicAuthRoutes(req, res, pathname, securityRouteDependencies)) return;
  if (!isAuthenticated(req)) return sendJson(res, { error: "Unauthorized" }, 401);
  if (await handleSecurityRoutes(req, res, pathname, securityRouteDependencies)) return;
  if (req.method === "GET" && pathname === "/api/ssh/trusted-hosts") {
    const query = new URL(req.url || "/api/ssh/trusted-hosts", "http://terma.invalid").searchParams;
    return sendJson(res, listTrustedHostsPage({
      page: Number(query.get("page") || 1),
      page_size: Number(query.get("page_size") || 20)
    }));
  }
  if (req.method === "DELETE" && pathname === "/api/ssh/trusted-hosts") {
    const data = await readJson(req);
    return sendJson(res, removeTrustedHost(data.id));
  }
  if (req.method === "POST" && pathname === "/api/ssh/host-trust") {
    const data = await readJson(req);
    return sendJson(res, acceptHostTrust(data.token, data.mode));
  }
  if (req.method === "POST" && pathname === "/api/ssh/preflight") {
    const data = await readJson(req);
    const connection = data.connection_id ? getConnection(Number(data.connection_id)) : data.connection;
    if (!connection) throw new Error("缺少 SSH 连接配置");
    return sendJson(res, await ensureConnectionHostTrusted(connection));
  }
  if (req.method === "GET" && pathname === "/api/about") return sendJson(res, aboutInfo());
  if (req.method === "GET" && pathname === "/api/legacy-brand-migration") {
    if (!isDesktopRequest(req) || !desktopIntegration?.getLegacyBrandMigration) {
      return sendJson(res, {available:false, message:"旧版数据迁移仅能在运行 Terma 的本机桌面版中执行"});
    }
    return sendJson(res, {available:true, ...await Promise.resolve(desktopIntegration.getLegacyBrandMigration())});
  }
  if (req.method === "POST" && pathname === "/api/legacy-brand-migration") {
    if (!isDesktopRequest(req) || !desktopIntegration?.migrateLegacyBrandData) {
      return sendJson(res, {error:"旧版数据迁移仅能在运行 Terma 的本机桌面版中执行"}, 403);
    }
    const data = await readJson(req);
    const result = await Promise.resolve(desktopIntegration.migrateLegacyBrandData(data || {}));
    return sendJson(res, result, result?.ok ? 202 : 409);
  }
  if (req.method === "GET" && pathname === "/api/desktop-settings") {
    const desktopRequest = isDesktopRequest(req);
    const storageManagementAvailable = desktopRequest
      || (!desktopIntegration && (isDirectLoopbackRequest(req) || authRequired(req)));
    if (!storageManagementAvailable) return sendJson(res, {available:false, storage_management_available:false});
    if (!desktopIntegration?.getSettings) return sendJson(res, {
      available:false,
      storage_management_available:true,
      settings:{
        dataMode:process.env.TERMA_DATA_DIR || process.env.TERMA_SSH_DIR || process.env.TUNNELDESK_DATA_DIR || process.env.TUNNELDESK_SSH_DIR ? "environment" : "project",
        customDataDir:String(process.env.TERMA_DATA_DIR || process.env.TUNNELDESK_DATA_DIR || "")
      },
      paths:{dataDir:DATA_DIR, sshDir:PROJECT_SSH_DIR},
      project_mode_available:true,
      project_mode_label:"项目所在文件夹",
      base_dir:BASE_DIR,
      storage:storageSettingsView()
    });
    return sendJson(res, { available:true, storage_management_available:true, ...(await Promise.resolve(desktopIntegration.getSettings())), storage:storageSettingsView() });
  }
  if (req.method === "PUT" && pathname === "/api/desktop-settings") {
    if (!isDesktopRequest(req) && (desktopIntegration || (!isDirectLoopbackRequest(req) && !authRequired(req)))) {
      return sendJson(res, { error:"远程修改数据路径需要启用 Web 密码并登录" }, 403);
    }
    const data = await readJson(req);
    if (!desktopIntegration?.saveSettings) return sendJson(res, saveWebStorageSettings(data));
    return sendJson(res, await Promise.resolve(desktopIntegration.saveSettings(data)));
  }
  if (req.method === "POST" && pathname === "/api/desktop-settings/choose-data-dir") {
    if (!isDesktopRequest(req) || !desktopIntegration?.chooseDataDir) return sendJson(res, { error:"目录选择仅能在本机桌面版中使用" }, 403);
    return sendJson(res, { path:await Promise.resolve(desktopIntegration.chooseDataDir()) });
  }
  if (req.method === "GET" && pathname === "/api/storage/directories") {
    if (!isDesktopRequest(req) && (desktopIntegration || (!isDirectLoopbackRequest(req) && !authRequired(req)))) {
      return sendJson(res, {error:"远程浏览目录需要启用 Web 密码并登录"}, 403);
    }
    const url = new URL(req.url, "http://terma.invalid");
    return sendJson(res, listLocalDirectories(url.searchParams.get("path") || ""));
  }
  if (req.method === "GET" && pathname === "/api/runtime-settings") return sendJson(res, runtimeSettingsView());
  if (req.method === "GET" && pathname === "/api/cache") return sendJson(res, programCacheView());
  if (req.method === "DELETE" && pathname === "/api/cache") {
    if (updateInstaller.cacheInfo().busy) return sendJson(res, {error:"更新正在下载，暂时不能清理缓存"}, 409);
    clearSftpCache();
    updateInstaller.clearCache();
    return sendJson(res, {ok:true, ...programCacheView()});
  }
  if (req.method === "PUT" && pathname === "/api/runtime-settings") {
    const current = readRuntimeSettings(RUNTIME_SETTINGS_FILE);
    const data = await readJson(req);
    const next = normalizeRuntimeSettings({
      listen_hosts: data.listen_hosts ?? current.listen_hosts,
      listen_port: data.listen_port ?? current.listen_port,
      sftp_recycle_bin_enabled: data.sftp_recycle_bin_enabled ?? current.sftp_recycle_bin_enabled,
      sftp_floating_progress_enabled: data.sftp_floating_progress_enabled ?? current.sftp_floating_progress_enabled,
      sftp_max_open_file_size_mb: data.sftp_max_open_file_size_mb ?? current.sftp_max_open_file_size_mb,
      sftp_download_directory: data.sftp_download_directory ?? current.sftp_download_directory,
      restore_workspace_tabs: data.restore_workspace_tabs ?? current.restore_workspace_tabs,
      workspace_toolbar_placement: data.workspace_toolbar_placement ?? current.workspace_toolbar_placement,
      terminal: data.terminal ?? current.terminal
    });
    if (data.sftp_download_directory !== undefined && desktopIntegration) {
      if (!isDesktopRequest(req) || !desktopIntegration?.validateDownloadDirectory) return sendJson(res, { error:"下载目录只能在本机桌面端中修改" }, 403);
      await Promise.resolve(desktopIntegration.validateDownloadDirectory(next.sftp_download_directory));
    }
    if (data.listen_hosts !== undefined || data.listen_port !== undefined) {
      const availability = await checkRuntimeSettings(next);
      if (!availability.available) return sendJson(res, {
        error: availability.error || "监听地址或端口不可用",
        ...availability
      }, 409);
    }
    writeRuntimeSettings(RUNTIME_SETTINGS_FILE, next);
    return sendJson(res, runtimeSettingsView());
  }
  if (req.method === "POST" && pathname === "/api/runtime-settings/check") {
    const data = await readJson(req);
    return sendJson(res, await checkRuntimeSettings(data), 200);
  }
  if (await handleUpdateRoutes(req, res, pathname, {
    checker:updateChecker,
    installer:updateInstaller,
    sendJson,
    isLocalRequest:isDesktopRequest,
    canOpenPackage:()=>Boolean(desktopIntegration?.openUpdatePackage),
    canOpenDirectory:()=>Boolean(desktopIntegration?.openUpdateDirectory),
    openPackage:(file)=>Promise.resolve(desktopIntegration.openUpdatePackage(file)),
    openDirectory:(file)=>Promise.resolve(desktopIntegration.openUpdateDirectory(file))
  })) return;
  if (req.method === "GET" && pathname === "/api/identity-files") return sendJson(res, listIdentityFiles());
  if (req.method === "GET" && pathname === "/api/identity-files/info") return sendJson(res, { items:listIdentityFiles(), upload_directory:PROJECT_SSH_DIR });
  if (req.method === "POST" && pathname === "/api/identity-files/check") {
    const data = await readJson(req);
    return sendJson(res, identityPermissionStatus(data.path || ""));
  }
  if (req.method === "POST" && pathname === "/api/identity-files/repair") {
    const data = await readJson(req);
    return sendJson(res, repairIdentityFile(data.path || ""));
  }
  if (await handleLogRoutes(req, res, pathname, {
    deleteLogs, enforceConfiguredLogRetention, getLogSettings, listLogs, readJson, readLog, readLogWindow,
    readRawLog, send, sendJson, updateLogSettings
  })) return;
  if (req.method === "GET" && pathname === "/api/diagnostics/runtime") return sendJson(res, runtimeDiagnostics());
  if (req.method === "GET" && pathname === "/api/startup-status") return sendJson(res, startupStatus);
  if (req.method === "GET" && pathname === "/api/config-snapshots") return sendJson(res, listConfigSnapshots());
  if (req.method === "POST" && pathname === "/api/config-snapshots") {
    const data = await readJson(req);
    return sendJson(res, createConfigSnapshot(data.reason || "手动快照"), 201);
  }
  const snapshotRestore = pathname.match(/^\/api\/config-snapshots\/([A-Za-z0-9-]+)\/restore$/);
  if (req.method === "POST" && snapshotRestore) {
    requireEncryptionUnlocked();
    createConfigSnapshot("回滚前自动快照");
    stopAllForwards();
    const result = restoreConfigSnapshotById(snapshotRestore[1]);
    clearConnectionHealthCache();
    return sendJson(res, result);
  }
  const snapshotDelete = pathname.match(/^\/api\/config-snapshots\/([A-Za-z0-9-]+)$/);
  if (req.method === "DELETE" && snapshotDelete) return sendJson(res, deleteConfigSnapshot(snapshotDelete[1]));
  if (req.method === "GET" && pathname === "/api/notifications") {
    const url = new URL(req.url, "http://terma.invalid");
    return sendJson(res, listNotifications(Number(url.searchParams.get("since") || 0)));
  }
  if (req.method === "GET" && pathname === "/api/backup/database") {
    const url = new URL(req.url, "http://terma.invalid");
    const includePasswords = url.searchParams.get("include_passwords") === "1";
    const exported = exportDatabaseFile(includePasswords);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": exported.size,
      "Content-Disposition": `attachment; filename="terma-${Date.now()}${includePasswords ? "-with-passwords" : ""}.db"`,
      "X-Terma-Passwords-Included": includePasswords ? "1" : "0",
      ...secureHeaders()
    });
    const stream = fs.createReadStream(exported.path);
    const cleanup = () => exported.cleanup();
    stream.on("error", error => res.destroy(error));
    stream.on("close", cleanup);
    res.on("close", cleanup);
    stream.pipe(res);
    return;
  }
  if (req.method === "GET" && pathname === "/api/backup/bundle") {
    const security = readSecuritySettings();
    const exported = exportDatabaseFile(true);
    const header = createDatabaseBundleHeader({
      type: "terma-backup-v3",
      created_at: new Date().toISOString(),
      security: {
        encryption_enabled: Boolean(security.encryption_enabled),
        encryption_salt: security.encryption_salt || "",
        encryption_check: security.encryption_check || ""
      }
    });
    res.writeHead(200, secureHeaders({
      "Content-Type": "application/octet-stream",
      "Content-Length": header.length + exported.size,
      "Content-Disposition": `attachment; filename="terma-backup-${Date.now()}.termabackup"`
    }));
    res.write(header);
    const stream = fs.createReadStream(exported.path);
    const cleanup = () => exported.cleanup();
    stream.on("error", error => res.destroy(error));
    stream.on("close", cleanup);
    res.on("close", cleanup);
    stream.pipe(res);
    return;
  }
  if (req.method === "POST" && pathname === "/api/restore/database/check") {
    let stage = null;
    try {
      stage = await databaseTransferStore.stage(req, String(req.headers["x-terma-filename"] || req.headers["x-tunneldesk-filename"] || "backup.db"));
      const inspection = inspectRestoreDatabaseFile(
        stage.database_path,
        stage.security,
        stage.legacy_credential_bindings,
        stage.legacy_identity_bindings
      );
      return sendJson(res, {
        ...inspection,
        restore_token: stage.token,
        restore_format: stage.format,
        upload_expires_at: stage.expires_at
      });
    } catch (error) {
      if (stage) databaseTransferStore.discard(stage);
      throw error;
    }
  }
  if (req.method === "DELETE" && pathname === "/api/restore/database/stage") {
    const data = await readJson(req);
    databaseTransferStore.discard(String(data.restore_token || ""));
    return sendJson(res, { ok: true });
  }
  if (req.method === "POST" && pathname === "/api/restore/database") {
    requireEncryptionUnlocked();
    const data = await readJson(req);
    const stage = databaseTransferStore.take(String(data.restore_token || ""));
    const credentialBindings = Array.isArray(data.credential_bindings) && data.credential_bindings.length
      ? data.credential_bindings
      : stage.legacy_credential_bindings;
    const identityBindings = Array.isArray(data.identity_bindings) && data.identity_bindings.length
      ? data.identity_bindings
      : stage.legacy_identity_bindings;
    const previousSecurity = readSecuritySettings();
    try {
      const identities = normalizeRestoredCredentials(
        stage.database_path,
        identityBindings,
        credentialBindings,
        Boolean(stage.security?.encryption_enabled),
        Boolean(!stage.security && previousSecurity.encryption_enabled)
      );
      createConfigSnapshot("恢复数据库前自动快照");
      stopAllForwards();
      closeDatabase();
      const backup = `${DB_PATH}.bak-${Date.now()}`;
      const clearDatabaseSidecars = () => {
        for (const file of [`${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
          try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
        }
      };
      if (fs.existsSync(DB_PATH)) {
        fs.copyFileSync(DB_PATH, backup);
        ensurePrivateFile(backup);
      }
      try {
        clearDatabaseSidecars();
        fs.copyFileSync(stage.database_path, DB_PATH);
        if (stage.security) {
          writeSecuritySettings({
            encryption_enabled: Boolean(stage.security.encryption_enabled),
            encryption_salt: stage.security.encryption_salt || "",
            encryption_check: stage.security.encryption_check || ""
          });
          lockEncryption();
        }
        reopenDatabase();
        clearConnectionHealthCache();
        return sendJson(res, {
          ok: true,
          backup,
          restart_required: false,
          database_reopened: true,
          restore_format: stage.format,
          encrypted_bundle: Boolean(stage.security?.encryption_enabled),
          missing_identities: identities.missing,
          unresolved_identities: identities.unresolved,
          encrypted_identities: identities.encrypted,
          mapped_identities: identities.mappings,
          encrypted_fields: identities.encrypted_fields || 0
        });
      } catch (error) {
        try {
          closeDatabase();
          clearDatabaseSidecars();
          if (fs.existsSync(backup)) fs.copyFileSync(backup, DB_PATH);
          writeSecuritySettings(previousSecurity);
          lockEncryption();
          reopenDatabase();
        } catch (rollbackError) {
          console.error(`database restore rollback failed: ${rollbackError.message}`);
        }
        throw error;
      }
    } finally {
      databaseTransferStore.discard(stage);
    }
  }
  if (req.method === "GET" && pathname === "/api/connections") return sendJson(res, listConnections());
  if (req.method === "GET" && pathname === "/api/remote-profiles") return sendJson(res, listRemoteProfiles());
  if (req.method === "GET" && pathname === "/api/serial/ports") return sendJson(res, await listSerialPorts());
  if (req.method === "GET" && pathname === "/api/remote-clients/diagnostics") {
    const integrationAvailable = Boolean(isDesktopRequest(req) && desktopIntegration?.remoteClientDiagnostics);
    const x11 = isDesktopRequest(req) && desktopIntegration?.xServerDiagnostics
      ? await Promise.resolve(desktopIntegration.xServerDiagnostics())
      : x11RuntimeDiagnostics();
    if (!integrationAvailable) return sendJson(res, remoteClientDiagnosticsWithoutDesktopIntegration(x11));
    const xdmcp = {
      available:Boolean(x11?.xdmcp_available),
      client:x11?.xdmcp_available
        ? x11.platform === "darwin"
          ? "Terma 内置 XDMCP（XQuartz）"
          : x11.mode === "bundled"
            ? "Terma 内置 X Server"
            : x11.platform === "linux"
              ? "Terma XDMCP（Xephyr）"
              : x11.server || "X Server"
        : "",
      executable:x11?.xdmcp_available ? x11.xdmcp_client || x11.executable || "" : "",
      can_install:Boolean(x11?.can_install),
      install_label:process.platform === "darwin" ? "安装 XQuartz" : process.platform === "linux" ? "安装 Xephyr" : "",
      reason:x11?.xdmcp_available ? "" : String(x11?.reason || "未检测到可用的 XDMCP X Server")
    };
    return sendJson(res, {desktop:true, integration_available:true, ...await Promise.resolve(desktopIntegration.remoteClientDiagnostics()), xdmcp, x11});
  }
  if (req.method === "POST" && pathname === "/api/remote-clients/install") {
    if (!isDesktopRequest(req) || !desktopIntegration?.installRemoteClient) return sendJson(res, {error:"客户端只能由本机桌面版安装"}, 403);
    const body = await readJson(req);
    const protocol = String(body.protocol || "").toLowerCase();
    if (protocol !== "rdp") return sendJson(res, {error:"当前只支持安装 RDP 客户端"}, 400);
    return sendJson(res, await Promise.resolve(desktopIntegration.installRemoteClient(protocol)));
  }
  if (req.method === "POST" && pathname === "/api/xserver/install") {
    if (!isDesktopRequest(req)) return sendJson(res, {error:"图形组件只能由本机桌面版安装"}, 403);
    if (process.platform === "darwin" && desktopIntegration?.installXQuartz) {
      return sendJson(res, await Promise.resolve(desktopIntegration.installXQuartz()));
    }
    if (process.platform === "linux" && desktopIntegration?.installLinuxGraphicsComponents) {
      return sendJson(res, await Promise.resolve(desktopIntegration.installLinuxGraphicsComponents()));
    }
    return sendJson(res, {error:"当前平台没有可自动安装的图形组件"}, 403);
  }
  if (pathname === "/api/xserver") {
    if (req.method === "GET") {
      if (isDesktopRequest(req) && desktopIntegration?.xServerDiagnostics) {
        const diagnostics = await Promise.resolve(desktopIntegration.xServerDiagnostics());
        return sendJson(res, {...diagnostics, desktop:true, integration_available:true});
      }
      return sendJson(res, xServerDiagnosticsWithoutDesktopIntegration());
    }
    if (req.method === "POST") {
      if (!isDesktopRequest(req) || !desktopIntegration?.startXServer) return sendJson(res, {error:"X Server 只能由本机桌面端启动"}, 403);
      return sendJson(res, await Promise.resolve(desktopIntegration.startXServer()));
    }
    if (req.method === "DELETE") {
      if (!isDesktopRequest(req) || !desktopIntegration?.stopXServer) return sendJson(res, {error:"X Server 只能由本机桌面端停止"}, 403);
      return sendJson(res, await Promise.resolve(desktopIntegration.stopXServer()));
    }
  }
  if (req.method === "GET" && pathname === "/api/ssh/config/detect") {
    const configPath = path.join(USER_SSH_DIR, "config");
    if (!fs.existsSync(configPath)) return sendJson(res, {available:false, path:configPath, count:0, conflicts:[], text:""});
    const text = fs.readFileSync(configPath, "utf8");
    const parsed = parseConfigText(text);
    const existing = new Set(listConnections().map(item => String(item.name).toLowerCase()));
    const conflicts = parsed.tunnels.filter(item => existing.has(String(item.name).toLowerCase())).map(item => item.name);
    return sendJson(res, {available:true, path:configPath, count:parsed.count, conflicts, text});
  }
  if (req.method === "GET" && pathname === "/api/command-snippets") return sendJson(res, listCommandSnippets());
  if (req.method === "GET" && pathname === "/api/named-workspaces") return sendJson(res, listNamedWorkspaces());
  if (req.method === "GET" && pathname === "/api/command-templates") return sendJson(res, listCommandTemplates());
  if (req.method === "GET" && pathname === "/api/forward-templates") return sendJson(res, listForwardTemplates());
  if (req.method === "GET" && pathname === "/api/sftp/jobs") return sendJson(res, listSftpJobs());
  if (pathname === "/api/local-files" || pathname.startsWith("/api/local-files/")) {
    if (!isDesktopRequest(req) || !desktopIntegration?.getDesktopDirectory) {
      return sendJson(res, {error:"本地文件只支持在 Terma 桌面端使用"}, 403);
    }
    if (req.method === "GET" && pathname === "/api/local-files") {
      const url = new URL(req.url, "http://terma.invalid");
      const defaultDirectory = await Promise.resolve(desktopIntegration.getDesktopDirectory());
      const location = url.searchParams.get("location") || "directory";
      return sendJson(res, listLocalDirectory(location === "computer" ? "" : url.searchParams.get("path") || defaultDirectory, {
        defaultDirectory,
        location,
        page:url.searchParams.get("page"),
        page_size:url.searchParams.get("page_size"),
        query:url.searchParams.get("query"),
        sort:url.searchParams.get("sort"),
        dir:url.searchParams.get("dir")
      }));
    }
    if (req.method === "GET" && pathname === "/api/local-files/locations") {
      return sendJson(res, {
        desktop:await Promise.resolve(desktopIntegration.getDesktopDirectory()),
        downloads:await Promise.resolve(desktopIntegration.getDownloadDirectory()),
        home:os.homedir()
      });
    }
    if (req.method === "POST" && pathname === "/api/local-files/open") {
      if (!desktopIntegration?.openLocalPath) return sendJson(res, {error:"当前桌面端不能打开本地文件"}, 403);
      const data = await readJson(req);
      return sendJson(res, await Promise.resolve(desktopIntegration.openLocalPath(data.path || "")));
    }
    if (req.method === "POST" && pathname === "/api/local-files/rename") {
      const data = await readJson(req);
      return sendJson(res, renameLocalPath(data.path, data.new_name));
    }
    if (req.method === "POST" && pathname === "/api/local-files/delete") {
      const data = await readJson(req);
      return sendJson(res, deleteLocalPaths(data.paths || []));
    }
    if (req.method === "POST" && pathname === "/api/local-files/create") {
      const data = await readJson(req);
      return sendJson(res, createLocalEntry(data.directory, data.name, data.type));
    }
    if (req.method === "POST" && pathname === "/api/local-files/chmod") {
      const data = await readJson(req);
      return sendJson(res, chmodLocalPath(data.path, data.mode));
    }
    if (req.method === "POST" && pathname === "/api/local-files/upload") {
      const data = await readJson(req);
      const result = await uploadLocalPaths(Number(data.connection_id), data.paths || [], data.target || ".", data.conflict || "error");
      return sendJson(res, result, 202);
    }
    if (req.method === "POST" && pathname === "/api/local-files/receive-plan") {
      const data = await readJson(req);
      return sendJson(res, planSftpPathDelivery(data.paths || [], data.target || ""));
    }
    if (req.method === "POST" && pathname === "/api/local-files/receive") {
      const data = await readJson(req);
      return sendJson(res, startLocalDeliveryJob(Number(data.connection_id), data.paths || [], data.target || "", data.conflict || "rename"), 202);
    }
    if (req.method === "POST" && pathname === "/api/local-files/receive-desktop") {
      const data = await readJson(req);
      const desktopDirectory = await Promise.resolve(desktopIntegration.getDesktopDirectory());
      return sendJson(res, startLocalDeliveryJob(Number(data.connection_id), data.paths || [], desktopDirectory, "rename", {
        label:"发送到桌面",
        deliveryMode:"desktop"
      }), 202);
    }
  }
  if (req.method === "GET" && pathname === "/api/linux-desktop/tasks") return sendJson(res, listLinuxDesktopTasks());
  if (req.method === "POST" && pathname === "/api/linux-desktop/tasks/clear-finished") return sendJson(res, clearFinishedLinuxDesktopTasks());
  if (req.method === "POST" && pathname === "/api/admin-grants") {
    const data = await readJson(req);
    const connectionId = Number(data.connection_id || data.id || 0);
    if (!Number.isInteger(connectionId) || connectionId < 1) throw new Error("SSH 连接 ID 无效");
    const connection = getConnection(connectionId);
    return sendJson(res, await issueRemoteAdminGrant(connection, data), 201);
  }
  if (req.method === "GET" && pathname === "/api/remote-component/tasks") return sendJson(res, remoteOfflineTasks.list());
  if (req.method === "POST" && pathname === "/api/remote-component/tasks/clear-finished") return sendJson(res, remoteOfflineTasks.clearFinished());
  if (req.method === "GET" && pathname === "/api/sftp/external-edits") return sendJson(res, listExternalEdits());
  if (req.method === "GET" && pathname === "/api/sftp/sync/jobs") return sendJson(res, listSyncJobs());
  if (req.method === "POST" && pathname === "/api/sftp/sync/jobs/clear-finished") return sendJson(res, clearFinishedSyncJobs());
  if (req.method === "POST" && pathname === "/api/sftp/sync/choose-directory") {
    if (!isDesktopRequest(req) || !desktopIntegration?.chooseSyncDirectory) return sendJson(res, {error:"本地目录同步只能在本机桌面端中使用"}, 403);
    return sendJson(res, {path:await Promise.resolve(desktopIntegration.chooseSyncDirectory())});
  }
  if (req.method === "GET" && pathname === "/api/sftp/download-settings") {
    const saved = readRuntimeSettings(RUNTIME_SETTINGS_FILE);
    const desktop = Boolean(isDesktopRequest(req) && desktopIntegration?.getDownloadDirectory);
    const defaultDirectory = desktop ? await Promise.resolve(desktopIntegration.getDownloadDirectory()) : "";
    return sendJson(res, {
      delivery_mode: desktop ? "desktop" : "browser",
      configured_directory: desktop ? saved.sftp_download_directory : "",
      default_directory: defaultDirectory,
      effective_directory: desktop ? (saved.sftp_download_directory || defaultDirectory) : "",
      can_choose_directory: Boolean(desktop && desktopIntegration?.chooseDownloadDirectory),
      can_open_directory: Boolean(desktop && desktopIntegration?.openDownloadDirectory)
    });
  }
  if (req.method === "POST" && pathname === "/api/sftp/download-settings/choose") {
    if (!isDesktopRequest(req) || !desktopIntegration?.chooseDownloadDirectory) return sendJson(res, { error:"目录选择仅能在本机桌面端中使用" }, 403);
    return sendJson(res, { path:await Promise.resolve(desktopIntegration.chooseDownloadDirectory()) });
  }
  if (req.method === "POST" && pathname === "/api/sftp/download-settings/open") {
    if (!isDesktopRequest(req) || !desktopIntegration?.openDownloadDirectory) return sendJson(res, { error:"打开目录仅能在本机桌面端中使用" }, 403);
    const saved = readRuntimeSettings(RUNTIME_SETTINGS_FILE);
    const directory = saved.sftp_download_directory || await Promise.resolve(desktopIntegration.getDownloadDirectory());
    return sendJson(res, await Promise.resolve(desktopIntegration.openDownloadDirectory(directory)));
  }
  if (req.method === "GET" && pathname === "/api/export/config") return sendJson(res, { config: exportConfig() });

  if (req.method === "POST" && pathname === "/api/identity-files") {
    const body = await readBody(req);
    const part = getPart(req.headers["content-type"], body, "key");
    return sendJson(res, saveUploadedKey(part.filename, part.data), 201);
  }
  if (req.method === "POST" && pathname === "/api/import/parse") {
    const body = await readBody(req);
    const part = getPart(req.headers["content-type"], body, "config");
    const parsed = parseConfigText(part.data.toString("utf8"));
    parsed.filename = part.filename || "config";
    return sendJson(res, parsed);
  }
  if (req.method === "POST" && pathname === "/api/import/parse-text") {
    const data = await readJson(req);
    const parsed = parseConfigText(data.text || "");
    parsed.filename = data.filename || "pasted-config";
    return sendJson(res, parsed);
  }
  if (req.method === "POST" && pathname === "/api/import/test") {
    const data = await readJson(req);
    return sendJson(res, await batchTest(data.tunnels || []));
  }
  if (req.method === "POST" && pathname === "/api/import/save") {
    const data = await readJson(req);
    createConfigSnapshot("批量导入前自动快照");
    return sendJson(res, saveImported(data.tunnels || [], DEFAULT_EXTRA_ARGS), 201);
  }
  if (req.method === "POST" && pathname === "/api/export/config") {
    const data = await readJson(req);
    return sendJson(res, { config: exportConfig(data.ids || []) });
  }
  if (req.method === "POST" && pathname === "/api/test-ssh") {
    const data = await readJson(req);
    if (data.id && data.auth_type === "password" && !data.ssh_password) {
      try { data.ssh_password = getConnection(Number(data.id)).ssh_password || ""; } catch {}
    }
    const result: any = await testSsh(data);
    if (result.ok && data.discover_terminal === true) {
      try {
        result.capabilities = await terminalCapabilitiesForConnection(data);
      } catch (error) {
        result.capabilities = {
          platform:"unknown",
          platform_label:"未知",
          default_shell:null,
          profiles:[],
          tools:[],
          warnings:[`SSH 已连接，但远端终端环境识别失败：${error.message}`]
        };
      }
    }
    return sendJson(res, result);
  }
  if (req.method === "POST" && pathname === "/api/ssh/keys/generate") {
    return sendJson(res, generateSshKey(await readJson(req)), 201);
  }
  if (req.method === "POST" && pathname === "/api/terminal/startup-tickets") {
    const data = await readJson(req);
    getConnection(Number(data.connection_id));
    return sendJson(res, createTerminalStartupTicket(data.connection_id, data.startup || {}), 201);
  }
  if (req.method === "POST" && pathname === "/api/command-templates") {
    return sendJson(res, saveCommandTemplate(await readJson(req)), 201);
  }
  if (req.method === "POST" && pathname === "/api/forward-templates") {
    const id = insertForwardTemplate(await readJson(req));
    return sendJson(res, { id }, 201);
  }
  if (req.method === "POST" && pathname === "/api/commands/batch") {
    const data = await readJson(req);
    return sendJson(res, await batchRunCommands(data.ids || [], data.command || "", data));
  }
  if (req.method === "GET" && pathname === "/api/health") {
    const url = new URL(req.url, "http://terma.invalid");
    return sendJson(res, await allConnectionsHealth({force:url.searchParams.get("refresh") === "1"}));
  }
  if (req.method === "GET" && pathname === "/api/forwards/restore-state") return sendJson(res, restoreStateSummary());
  if (req.method === "POST" && pathname === "/api/forwards/restore") return sendJson(res, await restorePreviousForwards());
  if (req.method === "POST" && pathname === "/api/ports/diagnose") {
    const data = await readJson(req);
    return sendJson(res, await diagnosePortUsage(data.host || "127.0.0.1", data.port));
  }
  if (req.method === "POST" && pathname === "/api/ports/recommend") {
    const data = await readJson(req);
    const start = data.port ? Number(data.port) : 6000;
    return sendJson(res, await recommendPort(data.host || "127.0.0.1", start, data.exclude_id || 0));
  }
  if (req.method === "POST" && pathname === "/api/ports/check-forward") {
    const data = await readJson(req);
    const configured = configuredPortOwner(data.port, data.exclude_id || 0);
    const usage = await diagnosePortUsage(data.host || "127.0.0.1", data.port);
    const start = data.port ? Number(data.port) : 6000;
    const recommended = await recommendPort(data.host || "127.0.0.1", start, data.exclude_id || 0).catch(() => null);
    return sendJson(res, { configured, usage, recommended });
  }
  if (req.method === "POST" && pathname === "/api/ports/kill") {
    const data = await readJson(req);
    const result = await killPortOwner(data.pid, data.port, data.host);
    appendSystemLog(`已尝试关闭端口占用进程：${result.process?.name || "未知程序"} PID ${data.pid}`);
    return sendJson(res, result);
  }
  if (req.method === "POST" && pathname === "/api/connections") {
    const id = insertConnection(await readJson(req), DEFAULT_EXTRA_ARGS);
    return sendJson(res, { id }, 201);
  }
  if (req.method === "POST" && pathname === "/api/remote-profiles") {
    const id = insertRemoteProfile(await readJson(req));
    return sendJson(res, {id}, 201);
  }
  if (req.method === "POST" && pathname === "/api/command-snippets") {
    return sendJson(res, insertCommandSnippet(await readJson(req)), 201);
  }
  if (req.method === "POST" && pathname === "/api/named-workspaces") {
    return sendJson(res, insertNamedWorkspace(await readJson(req)), 201);
  }
  if (req.method === "POST" && pathname === "/api/connections/bulk-delete") {
    const data = await readJson(req);
    const ids = [...new Set((data.ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (!ids.length) throw new Error("请选择要删除的 SSH 连接");
    if (ids.length > 500) throw new Error("单次最多批量删除 500 个 SSH 连接");
    const existingIds = new Set(listConnections().map((item) => item.id));
    if (ids.some((id) => !existingIds.has(id))) throw new Error("部分 SSH 连接不存在，请刷新后重试");
    createConfigSnapshot("批量删除 SSH 连接前自动快照");
    for (const id of ids) {
      stopExternalEditsForConnection(id);
      deleteConnection(id, stopForward);
    }
    return sendJson(res, { ok: true, deleted: ids.length });
  }
  if (req.method === "POST" && pathname === "/api/connections/bulk-update") {
    const data = await readJson(req);
    const ids = [...new Set((data.ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const changes = data.changes && typeof data.changes === "object" ? {...data.changes} : {};
    if (changes.auth?.type === "key") {
      const requestedPath = path.resolve(String(changes.auth.identity_file || ""));
      const allowed = listIdentityFiles().some((item) => path.resolve(item.path).toLowerCase() === requestedPath.toLowerCase());
      if (!allowed) throw new Error("所选私钥不在允许的密钥目录中");
      changes.auth = {...changes.auth, identity_file:requestedPath};
    }
    const existingIds = new Set(listConnections().map((item) => item.id));
    if (!ids.length || ids.some((id) => !existingIds.has(id))) throw new Error("部分 SSH 连接不存在，请刷新后重试");
    createConfigSnapshot("批量修改 SSH 连接前自动快照");
    if (Object.prototype.hasOwnProperty.call(changes, "ssh_port") || changes.auth) {
      for (const id of ids) stopConnectionForwards(id);
    }
    const result = bulkUpdateConnections(ids, changes);
    ids.forEach(clearConnectionHealthCache);
    return sendJson(res, result);
  }
  if (req.method === "POST" && pathname === "/api/connection-groups/rename") {
    const data = await readJson(req);
    const currentName = String(data.current_name || "").trim();
    const newName = String(data.new_name || "").trim();
    if (!currentName || currentName.length > 100 || !newName || newName.length > 100) {
      throw new Error("分组名称长度必须在 1-100 个字符之间");
    }
    const groupNames = new Set(all("SELECT group_name FROM connections UNION SELECT group_name FROM remote_profiles").map((item) => item.group_name));
    if (!groupNames.has(currentName)) throw new Error("分组不存在，请刷新后重试");
    if (currentName !== newName && groupNames.has(newName)) throw new Error("该分组名称已存在，请使用其他名称");
    if (currentName === newName) return sendJson(res, { ok: true, updated: 0, group_name: newName });
    createConfigSnapshot("重命名 SSH 连接分组前自动快照");
    const result = renameConnectionGroup(currentName, newName);
    return sendJson(res, result);
  }
  if (req.method === "POST" && pathname === "/api/connection-groups/reorder") {
    const data = await readJson(req);
    createConfigSnapshot("调整 SSH 连接分组顺序前自动快照");
    return sendJson(res, reorderConnectionGroups(data.names));
  }
  if (req.method === "POST" && pathname === "/api/forwards/bulk-delete") {
    const data = await readJson(req);
    for (const id of data.ids || []) deleteForward(id, stopForward);
    return sendJson(res, { ok: true });
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 4 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "rdp-server") {
    const connectionId = Number(parts[2]);
    if (!Number.isInteger(connectionId) || connectionId < 1) throw new Error("SSH 连接 ID 无效");
    const connection = getConnection(connectionId);
    if (req.method === "GET") return sendJson(res, await detectLinuxDesktopForConnection(connection));
    if (req.method === "POST") {
      const result = await configureRdpServerForConnection(connection, await readJson(req));
      return sendJson(res, result, result?.task ? 202 : 200);
    }
  }
  if (parts.length === 4 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "linux-desktop") {
    const connectionId = Number(parts[2]);
    if (!Number.isInteger(connectionId) || connectionId < 1) throw new Error("SSH 连接 ID 无效");
    const connection = getConnection(connectionId);
    if (req.method === "GET") return sendJson(res, await detectLinuxDesktopForConnection(connection));
  }
  if (parts.length === 5 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "linux-desktop" && parts[4] === "install") {
    const connectionId = Number(parts[2]);
    if (!Number.isInteger(connectionId) || connectionId < 1) throw new Error("SSH 连接 ID 无效");
    if (req.method === "POST") {
      const data = await readJson(req);
      const connection = getConnection(connectionId);
      const requestedMode = String(data.mode || data.install_mode || data.action || "online").toLowerCase();
      const mode = ["local-offline", "install-local-offline", "offline-local"].includes(requestedMode)
        ? "local-offline"
        : ["offline", "install-offline"].includes(requestedMode)
          ? "offline"
          : ["online", "install", "install-online"].includes(requestedMode)
            ? "online"
            : "";
      if (!mode) throw new Error("Linux 桌面安装方式无效");
      const grantScope = mode === "local-offline" ? "linux-desktop.install-local-offline" : mode === "offline" ? "linux-desktop.install-offline" : "linux-desktop.install";
      const grant = createRemoteAdminGrant(connection, data, grantScope);
      const task = handoffRemotePrivilegeGrant(grant, () => startLinuxDesktopInstall(connectionId, data.desktop_id, "install", grant, mode));
      return sendJson(res, task, 202);
    }
  }
  if (parts.length === 5 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "linux-desktop" && parts[4] === "uninstall") {
    const connectionId = Number(parts[2]);
    if (!Number.isInteger(connectionId) || connectionId < 1) throw new Error("SSH 连接 ID 无效");
    if (req.method === "POST") {
      const data = await readJson(req);
      const connection = getConnection(connectionId);
      const grant = createRemoteAdminGrant(connection, data, "linux-desktop.uninstall");
      const task = handoffRemotePrivilegeGrant(grant, () => startLinuxDesktopInstall(connectionId, data.desktop_id, "uninstall", grant));
      return sendJson(res, task, 202);
    }
  }
  if (parts.length === 4 && parts[0] === "api" && parts[1] === "linux-desktop" && parts[2] === "tasks") {
    const task = linuxDesktopTasks.get(parts[3]);
    if (!task) return sendJson(res, {error:"桌面管理任务不存在或已过期"}, 404);
    if (req.method === "GET") return sendJson(res, linuxDesktopTaskView(task));
    if (req.method === "DELETE") return sendJson(res, {removed:deleteLinuxDesktopTask(parts[3])});
  }
  if (parts.length === 4 && parts[0] === "api" && parts[1] === "remote-component" && parts[2] === "tasks") {
    const task = remoteOfflineTasks.list().find(item => String(item.id) === String(parts[3]));
    if (!task) return sendJson(res, {error:"远端组件任务不存在或已过期"}, 404);
    if (req.method === "GET") return sendJson(res, task);
    if (req.method === "DELETE") return sendJson(res, {removed:remoteOfflineTasks.remove(parts[3])});
  }
  if (parts.length === 4 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "x11-forwarding") {
    const connectionId = Number(parts[2]);
    if (!Number.isInteger(connectionId) || connectionId < 1) throw new Error("SSH 连接 ID 无效");
    const connection = getConnection(connectionId);
    if (req.method === "GET") return sendJson(res, await detectSshX11ForConnection(connection));
    if (req.method === "POST") {
      const data = await readJson(req);
      const grant = createRemoteAdminGrant(connection, data, "x11.sshd-config");
      try {
        const result = await startSshX11ConfigurationTask(connection, data.action, grant);
        return sendJson(res, result, result?.task ? 202 : 200);
      } catch (error) {
        releaseRemoteAdminGrant(grant);
        throw error;
      }
    }
  }
  if (parts.length >= 3 && parts[0] === "api" && parts[1] === "remote-profiles") {
    const id = Number(parts[2]);
    if (!Number.isInteger(id) || id < 1) throw new Error("远程连接 ID 无效");
    if (req.method === "PUT" && parts.length === 3) return sendJson(res, updateRemoteProfile(id, await readJson(req)));
    if (req.method === "DELETE" && parts.length === 3) return sendJson(res, deleteRemoteProfile(id));
    if (req.method === "POST" && parts.length === 4 && parts[3] === "flags") return sendJson(res, updateRemoteProfileFlags(id, await readJson(req)));
    if (req.method === "POST" && parts.length === 4 && parts[3] === "usage") return sendJson(res, updateRemoteProfileUsage(id));
    if (req.method === "POST" && parts.length === 4 && parts[3] === "duplicate") return sendJson(res, duplicateRemoteProfile(id), 201);
    if (parts.length === 4 && parts[3] === "vnc-credential") {
      res.setHeader("Cache-Control", "no-store");
      if (req.method === "POST") return sendJson(res, getVncProfileCredential(id));
      if (req.method === "PUT") return sendJson(res, updateVncProfileCredential(id, (await readJson(req)).password));
    }
    if (parts.length === 4 && parts[3] === "vnc-clipboard") {
      res.setHeader("Cache-Control", "no-store");
      const profile = getRemoteProfile(id);
      const dependencies = { getConnection, listConnections, runSshCommandForConnection };
      if (req.method === "GET") return sendJson(res, await readVncRemoteClipboard(profile, dependencies));
      if (req.method === "POST") return sendJson(res, await writeVncRemoteClipboard(profile, (await readJson(req)).text, dependencies));
    }
    if (parts.length === 5 && parts[3] === "vnc-clipboard" && parts[4] === "helper") {
      res.setHeader("Cache-Control", "no-store");
      const profile = getRemoteProfile(id);
      if (req.method === "GET") return sendJson(res, await inspectVncClipboardHelperForProfile(profile));
      if (req.method === "POST") {
        const result = await configureVncClipboardHelperForProfile(profile, await readJson(req));
        return sendJson(res, result, result?.task ? 202 : 200);
      }
    }
    if (parts.length === 5 && parts[3] === "rdp" && parts[4] === "server") {
      const profile = getRemoteProfile(id);
      if (profile.protocol !== "rdp") throw new Error("该连接不是 RDP 配置");
      const management = resolveManagementConnection(profile, {getConnection, listConnections});
      if (req.method === "GET") return sendJson(res, await detectLinuxDesktopForConnection(management));
      if (req.method === "POST") {
        const result = await configureRdpServerForConnection(management, await readJson(req));
        return sendJson(res, result, result?.task ? 202 : 200);
      }
    }
    if (parts.length === 5 && parts[3] === "vnc" && parts[4] === "server") {
      const profile = getRemoteProfile(id);
      if (profile.protocol !== "vnc") throw new Error("该连接不是 VNC 配置");
      if (req.method === "GET") return sendJson(res, await inspectVncServerForProfile(profile));
      if (req.method === "POST") {
        const result = await configureVncServerForProfile(profile, await readJson(req));
        return sendJson(res, result, result?.task ? 202 : 200);
      }
    }
    if (req.method === "POST" && parts.length === 4 && parts[3] === "test") {
      const profile = getRemoteProfile(id);
      if (profile.protocol === "ftp") return sendJson(res, await testFtpProfile(id));
      if (["telnet", "serial"].includes(profile.protocol)) return sendJson(res, await testRemoteTerminalProfile(id));
      if (profile.protocol === "vnc") return sendJson(res, await testVncProfile(id));
      if (profile.protocol === "xdmcp") {
        if (!isDesktopRequest(req) || !desktopIntegration?.testXdmcp) return sendJson(res, {ok:false, protocol:"xdmcp", message:"XDMCP 只能由本机桌面版检测"});
        return sendJson(res, await Promise.resolve(desktopIntegration.testXdmcp({
          id:profile.id,
          protocol:profile.protocol,
          host:profile.host,
          port:profile.port,
          options:profile.options
        })));
      }
      const diagnostics = isDesktopRequest(req) && desktopIntegration?.remoteClientDiagnostics
        ? await Promise.resolve(desktopIntegration.remoteClientDiagnostics())
        : {desktop:false, [profile.protocol]:{available:false}};
      return sendJson(res, {
        ok:Boolean(diagnostics?.[profile.protocol]?.available),
        protocol:profile.protocol,
        client:diagnostics?.[profile.protocol]?.client || "",
        message:diagnostics?.[profile.protocol]?.available ? "系统客户端可用" : diagnostics?.[profile.protocol]?.reason || "当前设备未检测到可用客户端"
      });
    }
    if (req.method === "GET" && parts.length === 5 && parts[3] === "xdmcp" && parts[4] === "server") {
      const profile = getRemoteProfile(id);
      if (profile.protocol !== "xdmcp") throw new Error("该连接不是 XDMCP 配置");
      return sendJson(res, await detectXdmcpServer(profile, {
        getConnection,
        listConnections,
        runSshCommandForConnection
      }));
    }
    if (req.method === "POST" && parts.length === 5 && parts[3] === "xdmcp" && parts[4] === "server") {
      const profile = getRemoteProfile(id);
      if (profile.protocol !== "xdmcp") throw new Error("该连接不是 XDMCP 配置");
      const data = await readJson(req);
      const management = resolveManagementConnection(profile, {getConnection, listConnections});
      const requestedAction = String(data.action || "enable").toLowerCase();
      const grantScope = requestedAction.includes("local-offline") ? `xdmcp.${requestedAction}` : "xdmcp.configure";
      const grant = createRemoteAdminGrant(management, data, grantScope);
      let deferGrantRelease = false;
      try {
        const dependencies: any = {getConnection, listConnections, runSshCommandForConnection};
        if (grant) dependencies.runPrivilegedSshCommandForConnection = (connection, command, timeoutMs) => runRemotePrivilegeCommand(connection, command, {grant_id:grant.id, scope:grantScope, timeout_ms:timeoutMs});
        dependencies.startRemoteOfflineInstall = options => remoteOfflineTasks.startAptInstall({...options, resource_key:xdmcpTaskResourceKey(management, data, options), grant, elevate:true, scope:grantScope, release_grant:releaseRemoteAdminGrant});
        dependencies.startRemoteCommandTask = options => startRemoteComponentCommandTask({
          connection:options.connection || management,
          component:options.component,
          componentLabel:options.component_label,
          action:options.action,
          actionLabel:options.action_label,
          mode:options.mode,
          resourceKey:xdmcpTaskResourceKey(management, data, options),
          command:options.command,
          before:options.before,
          grant,
          scope:grantScope,
          timeoutMs:options.timeout_ms,
          verify:options.verify,
          validate:options.validate
        });
        const result = await configureXdmcpServer(profile, data, dependencies);
        deferGrantRelease = Boolean(result?.defer_grant_release);
        return sendJson(res, result, result?.task ? 202 : 200);
      } finally {
        if (!deferGrantRelease) releaseRemoteAdminGrant(grant);
      }
    }
    if (req.method === "POST" && parts.length === 4 && parts[3] === "launch") {
      const profile = getRemoteProfile(id);
      if (!isDesktopRequest(req)) return sendJson(res, {error:"图形桌面只能在本机桌面版中打开"}, 403);
      if (!["rdp", "vnc", "xdmcp"].includes(profile.protocol)) throw new Error("该连接不是图形桌面配置");
      const launcher = profile.protocol === "xdmcp" ? desktopIntegration?.openXdmcp : desktopIntegration?.openRemoteClient;
      if (!launcher) return sendJson(res, {error:profile.protocol === "xdmcp" ? "当前桌面版不支持 XDMCP" : "当前桌面版不支持系统远程桌面客户端"}, 403);
      if (profile.protocol === "rdp") {
        const endpoint = await probeTcpEndpoint(profile.host, profile.port || 3389);
        if (!endpoint.ok) throw new Error(`无法从本机连接 RDP 服务 ${profile.host}:${profile.port || 3389}（${endpoint.error || "端口不可达"}）。请检查远端服务、防火墙和网络路由。`);
      }
      const result = await Promise.resolve(launcher({
        id:profile.id,
        protocol:profile.protocol,
        host:profile.host,
        port:profile.port,
        username:profile.username,
        options:profile.options
      }));
      updateRemoteProfileUsage(id);
      return sendJson(res, result);
    }
    if (parts.length >= 4 && parts[3] === "ftp") {
      const profile = getRemoteProfile(id);
      if (profile.protocol !== "ftp") throw new Error("该连接不是 FTP 配置");
      if (req.method === "GET" && parts.length === 4) {
        const url = new URL(req.url, "http://terma.invalid");
        return sendJson(res, await listFtpDirectory(id, url.searchParams.get("path") || ""));
      }
      if (req.method === "POST" && parts.length === 5 && parts[4] === "mkdir") {
        const data = await readJson(req);
        return sendJson(res, await makeFtpDirectory(id, data.path, data.name), 201);
      }
      if (req.method === "POST" && parts.length === 5 && parts[4] === "rename") {
        const data = await readJson(req);
        return sendJson(res, await renameFtpPath(id, data.path, data.name, data.new_name));
      }
      if (req.method === "POST" && parts.length === 5 && parts[4] === "delete") {
        const data = await readJson(req);
        return sendJson(res, await deleteFtpPath(id, data.path, data.name, data.type === "directory"));
      }
      if (req.method === "POST" && parts.length === 5 && parts[4] === "upload") {
        const body = await readBody(req);
        const file = getPart(req.headers["content-type"], body, "file");
        const requestedPath = getPart(req.headers["content-type"], body, "path").data.toString("utf8");
        return sendJson(res, await uploadFtpFile(id, requestedPath, file.filename || "upload.bin", file.data), 201);
      }
      if (req.method === "GET" && parts.length === 5 && parts[4] === "download") {
        const url = new URL(req.url, "http://terma.invalid");
        const item = await downloadFtpFile(id, url.searchParams.get("path") || "/", url.searchParams.get("name") || "");
        res.writeHead(200, secureHeaders({
          "Content-Type":"application/octet-stream",
          "Content-Length":item.size,
          "Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,
          "Cache-Control":"no-store"
        }));
        const stream = fs.createReadStream(item.path);
        const cleanup = () => item.cleanup();
        stream.once("close", cleanup);
        stream.once("error", error => res.destroy(error));
        res.once("close", cleanup);
        stream.pipe(res);
        return;
      }
    }
  }
  if (req.method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "duplicate") {
    const source = getConnection(Number(parts[2]));
    const result = duplicateConnection(source.id, DEFAULT_EXTRA_ARGS);
    appendSystemLog(`已复制 SSH 连接：${source.name} -> ${result.name}`);
    return sendJson(res, result, 201);
  }
  if (req.method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "usage") {
    return sendJson(res, updateConnectionUsage(Number(parts[2]), (await readJson(req)).action));
  }
  if (req.method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "flags") {
    return sendJson(res, updateConnectionFlags(Number(parts[2]), await readJson(req)));
  }
  if (parts.length >= 3 && parts[0] === "api" && parts[1] === "command-snippets") {
    if (req.method === "PUT" && parts.length === 3) return sendJson(res, updateCommandSnippet(parts[2], await readJson(req)));
    if (req.method === "DELETE" && parts.length === 3) return sendJson(res, deleteCommandSnippet(parts[2]));
    if (req.method === "POST" && parts.length === 4 && parts[3] === "use") return sendJson(res, useCommandSnippet(parts[2]));
  }
  if (parts.length >= 3 && parts[0] === "api" && parts[1] === "named-workspaces") {
    if (req.method === "PUT" && parts.length === 3) return sendJson(res, updateNamedWorkspace(parts[2], await readJson(req)));
    if (req.method === "DELETE" && parts.length === 3) return sendJson(res, deleteNamedWorkspace(parts[2]));
    if (req.method === "POST" && parts.length === 4 && parts[3] === "duplicate") return sendJson(res, duplicateNamedWorkspace(parts[2]), 201);
    if (req.method === "POST" && parts.length === 4 && parts[3] === "use") return sendJson(res, useNamedWorkspace(parts[2]));
  }
  if (req.method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "terminal-preferences") {
    const id = Number(parts[2]);
    const result = updateTerminalPreferences(id, await readJson(req));
    return sendJson(res, result);
  }
  if (req.method === "POST" && parts.length === 5 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "ssh-key" && parts[4] === "deploy") {
    const data = await readJson(req);
    return sendJson(res, await deployGeneratedPublicKey(Number(parts[2]), data.public_path));
  }
  if (req.method === "POST" && parts.length === 5 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "external-tools" && parts[4] === "vscode") {
    if (!isDesktopRequest(req) || !desktopIntegration?.openVsCodeRemote) return sendJson(res, {error:"VS Code Remote SSH 只能在本机桌面端中使用"}, 403);
    const connection = getConnection(Number(parts[2]));
    const data = await readJson(req);
    return sendJson(res, await Promise.resolve(desktopIntegration.openVsCodeRemote({
      user:connection.ssh_user,
      host:connection.ssh_host,
      port:connection.ssh_port,
      path:String(data.path || "")
    })));
  }
  if (req.method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "terminal-startup") {
    const id = Number(parts[2]);
    return sendJson(res, { startup:updateTerminalStartup(id, await readJson(req)) });
  }
  if (req.method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "x11-mode") {
    return sendJson(res, updateConnectionX11Mode(Number(parts[2]), (await readJson(req)).mode));
  }
  if (req.method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "remote-profiles") {
    const data = await readJson(req);
    if (String(data.protocol || "").toLowerCase() === "all") {
      const result = createAllRemoteProfilesFromConnection(Number(parts[2]));
      for (const item of result.results.filter(value => value.created)) {
        appendSystemLog(`已从 SSH 连接生成 ${item.protocol.toUpperCase()} 连接：${item.name}`);
      }
      return sendJson(res, result, result.created_count ? 201 : 200);
    }
    const result = createRemoteProfileFromConnection(Number(parts[2]), data.protocol);
    if (result.created) appendSystemLog(`已从 SSH 连接生成 ${result.protocol.toUpperCase()} 连接：${result.name}`);
    return sendJson(res, result, result.created ? 201 : 200);
  }
  if (req.method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "x11-applications") {
    const connection = getConnection(Number(parts[2]));
    return sendJson(res, {discovery:await x11ApplicationsForConnection(connection)});
  }
  if (req.method === "POST" && parts.length === 5 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "x11-applications" && parts[4] === "install-plan") {
    const connection = getConnection(Number(parts[2]));
    return sendJson(res, await x11InstallPlanForConnection(connection));
  }
  if (req.method === "POST" && parts.length === 5 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "x11-applications" && parts[4] === "install") {
    const connection = getConnection(Number(parts[2]));
    return sendJson(res, await installX11ApplicationsForConnection(connection, await readJson(req)));
  }
  if (req.method === "POST" && parts.length === 5 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "x11-applications" && parts[4] === "verify") {
    const connection = getConnection(Number(parts[2]));
    const data = await readJson(req);
    return sendJson(res, {application:await verifyX11ApplicationForConnection(connection, data.command)});
  }
  if (req.method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "terminal-capabilities") {
    const connection = getConnection(Number(parts[2]));
    return sendJson(res, { capabilities:await terminalCapabilitiesForConnection(connection) });
  }
  if (req.method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "sftp-filename-encoding") {
    const id = Number(parts[2]);
    const data = await readJson(req);
    const result = updateSftpFilenameEncoding(id, data.encoding);
    invalidateRemoteDirectoryCache(id);
    return sendJson(res, result);
  }
  if (parts.length >= 3 && parts[0] === "api" && parts[1] === "sftp" && parts[2] === "jobs") {
    if (req.method === "POST" && parts.length === 4 && parts[3] === "clear-finished") return sendJson(res, clearFinishedSftpJobs());
    if (req.method === "PUT" && parts.length === 5 && parts[4] === "content") {
      try {
        return sendJson(res, await receiveUploadJobContent(parts[3], req), 202);
      } catch (error) {
        if (error?.code === "SFTP_UPLOAD_CANCELLED") {
          if (!res.destroyed && !res.writableEnded) return sendJson(res, {ok:true, status:"cancelled"}, 409);
          return;
        }
        throw error;
      }
    }
    if (req.method === "POST" && parts.length === 5 && parts[4] === "cancel") return sendJson(res, cancelSftpJob(parts[3]));
    if (req.method === "POST" && parts.length === 5 && parts[4] === "pause") return sendJson(res, pauseSftpJob(parts[3]));
    if (req.method === "POST" && parts.length === 5 && parts[4] === "resume") return sendJson(res, resumeSftpJob(parts[3]));
    if (req.method === "DELETE" && parts.length === 4) return sendJson(res, deleteSftpJob(parts[3]));
    if (req.method === "GET" && parts.length === 5 && parts[4] === "fetch") {
      const item = getSftpJobFile(parts[3]);
      const stat = fs.statSync(item.path);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": stat.size,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(item.name)}"`,
        "Cache-Control": "no-store"
      });
      const stream = fs.createReadStream(item.path);
      let responseFinished = false;
      let streamClosed = false;
      const markDelivered = () => {
        if (responseFinished && streamClosed) markSftpJobDelivered(parts[3]);
      };
      res.on("finish", () => { responseFinished = true; markDelivered(); });
      stream.on("close", () => { streamClosed = true; markDelivered(); });
      stream.pipe(res);
      return;
    }
  }
  if (parts.length >= 3 && parts[0] === "api" && parts[1] === "sftp" && parts[2] === "external-edits") {
    if (req.method === "GET" && parts.length === 4) return sendJson(res, getExternalEdit(parts[3]));
    if (req.method === "DELETE" && parts.length === 4) return sendJson(res, stopExternalEdit(parts[3]));
    if (req.method === "POST" && parts.length === 5 && parts[4] === "resolve") {
      const data = await readJson(req);
      return sendJson(res, await resolveExternalEdit(parts[3], data.action, data));
    }
  }
  if (parts.length >= 4 && parts[0] === "api" && parts[1] === "sftp" && parts[2] === "sync" && parts[3] === "jobs") {
    if (req.method === "GET" && parts.length === 5) return sendJson(res, getSyncJob(parts[4]));
    if (req.method === "DELETE" && parts.length === 5) return sendJson(res, deleteSyncJob(parts[4]));
    if (req.method === "POST" && parts.length === 6 && parts[5] === "cancel") return sendJson(res, cancelSyncJob(parts[4]));
    if (req.method === "POST" && parts.length === 6 && parts[5] === "retry") return sendJson(res, retrySyncJob(parts[4]), 202);
  }
  if (parts.length >= 3 && parts[0] === "api" && parts[1] === "forward-templates") {
    if (req.method === "PUT" && parts.length === 3) {
      updateForwardTemplate(parts[2], await readJson(req));
      return sendJson(res, { ok: true });
    }
    if (req.method === "DELETE" && parts.length === 3) {
      deleteForwardTemplate(parts[2]);
      return sendJson(res, { ok: true });
    }
    if (req.method === "POST" && parts.length === 4 && parts[3] === "apply") {
      const data = await readJson(req);
      createConfigSnapshot("批量应用转发模板前自动快照");
      return sendJson(res, applyForwardTemplate(parts[2], data.connection_ids || []));
    }
  }
  if (req.method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "forwards") {
    const connectionId = Number(parts[2]);
    const id = insertForward(connectionId, await readJson(req));
    clearConnectionHealthCache(connectionId);
    return sendJson(res, { id }, 201);
  }
  if (parts.length >= 4 && parts[0] === "api" && parts[1] === "connections" && parts[3] === "sftp") {
    const connectionId = Number(parts[2]);
    if (req.method === "POST" && parts.length === 5 && parts[4] === "external-edit") {
      if (!isDesktopRequest(req) || !desktopIntegration?.openExternalFile) return sendJson(res, {error:"外部编辑器只能在本机桌面端中使用"}, 403);
      const data = await readJson(req);
      return sendJson(res, await startExternalEdit(connectionId, data.path, {
        editor:data.editor || {},
        open:(file, editor) => desktopIntegration.openExternalFile(file, editor)
      }), 201);
    }
    if (req.method === "POST" && parts.length === 6 && parts[4] === "sync" && parts[5] === "plan") {
      if (!isDesktopRequest(req) || !desktopIntegration?.chooseSyncDirectory) return sendJson(res, {error:"本地目录同步只能在本机桌面端中使用"}, 403);
      return sendJson(res, startSyncPlanningJob(connectionId, await readJson(req)), 202);
    }
    if (req.method === "POST" && parts.length === 6 && parts[4] === "sync" && parts[5] === "execute") {
      if (!isDesktopRequest(req) || !desktopIntegration?.chooseSyncDirectory) return sendJson(res, {error:"本地目录同步只能在本机桌面端中使用"}, 403);
      const data = await readJson(req);
      return sendJson(res, startSyncJob(data.plan_id, data.selected_indexes, data.overrides), 202);
    }
    if (parts.length === 5 && parts[4] === "session") {
      if (req.method === "GET") return sendJson(res, sftpSessionStatus(connectionId));
      if (req.method === "POST") return sendJson(res, await connectSftpSession(connectionId, { explicit: true }));
      if (req.method === "DELETE") {
        const url = new URL(req.url, "http://terma.invalid");
        stopExternalEditsForConnection(connectionId);
        return sendJson(res, disconnectSftpSession(connectionId, { remember: url.searchParams.get("forget") !== "1" }));
      }
    }
    if (req.method === "GET" && parts.length === 4) {
      const url = new URL(req.url, "http://terma.invalid");
      const result = await listRemoteDir(connectionId, url.searchParams.get("path") || ".", {
        page: url.searchParams.get("page"),
        page_size: url.searchParams.get("page_size"),
        query: url.searchParams.get("query"),
        sort: url.searchParams.get("sort"),
        dir: url.searchParams.get("dir"),
        refresh: url.searchParams.get("refresh")
      });
      return send(res, 200, result, { "Cache-Control": "no-store" });
    }
    if (req.method === "POST" && parts[4] === "download") {
      const data = await readJson(req);
      const saved = readRuntimeSettings(RUNTIME_SETTINGS_FILE);
      const desktop = Boolean(isDesktopRequest(req) && desktopIntegration?.getDownloadDirectory);
      const defaultDirectory = desktop ? await Promise.resolve(desktopIntegration.getDownloadDirectory()) : "";
      return sendJson(res, startDownloadJob(connectionId, data.path || "", {
        deliveryMode: desktop ? "desktop" : "browser",
        autoSaveDirectory: desktop ? (saved.sftp_download_directory || defaultDirectory) : ""
      }), 202);
    }
    if (req.method === "POST" && parts[4] === "download-batch") {
      const data = await readJson(req);
      const paths = Array.isArray(data.paths) ? data.paths : [];
      const saved = readRuntimeSettings(RUNTIME_SETTINGS_FILE);
      const desktop = Boolean(isDesktopRequest(req) && desktopIntegration?.getDownloadDirectory);
      const defaultDirectory = desktop ? await Promise.resolve(desktopIntegration.getDownloadDirectory()) : "";
      const targetDirectory = desktop ? (saved.sftp_download_directory || defaultDirectory) : "";
      if (data.mode === "separate") {
        if (!desktop || !targetDirectory) return sendJson(res, {error:"分别下载文件和目录仅支持本机桌面版；当前设备请使用打包下载"}, 400);
        return sendJson(res, startLocalDeliveryJob(connectionId, paths, targetDirectory, "rename", {
          label:"批量下载到本机",
          deliveryMode:"download-directory"
        }), 202);
      }
      return sendJson(res, startArchiveDownloadJob(connectionId, paths, {
        deliveryMode:desktop ? "desktop" : "browser",
        autoSaveDirectory:targetDirectory
      }), 202);
    }
    if (req.method === "GET" && parts[4] === "download") {
      const url = new URL(req.url, "http://terma.invalid");
      const remotePath = url.searchParams.get("path") || "";
      streamRemoteFile(connectionId, remotePath, res, req);
      return;
    }
    if (req.method === "GET" && parts[4] === "trash" && parts.length === 5) {
      return sendJson(res, {
        enabled: readRuntimeSettings(RUNTIME_SETTINGS_FILE).sftp_recycle_bin_enabled,
        items: await listRemoteRecycleItems(connectionId)
      });
    }
    if (req.method === "GET" && parts[4] === "read") {
      const url = new URL(req.url, "http://terma.invalid");
      const remotePath = url.searchParams.get("path") || "";
      const maximumBytes = readRuntimeSettings(RUNTIME_SETTINGS_FILE).sftp_max_open_file_size_mb * 1024 * 1024;
      const result = await readRemoteTextFile(connectionId, remotePath, url.searchParams.get("encoding") || "", maximumBytes);
      return send(res, 200, { path: remotePath, ...result }, { "Cache-Control": "no-store" });
    }
    if (req.method === "GET" && parts[4] === "preview-image") {
      const url = new URL(req.url, "http://terma.invalid");
      const remotePath = url.searchParams.get("path") || "";
      const extension = path.posix.extname(remotePath).toLowerCase();
      const imageTypes = new Map([[".png","image/png"],[".jpg","image/jpeg"],[".jpeg","image/jpeg"],[".gif","image/gif"],[".webp","image/webp"],[".bmp","image/bmp"],[".ico","image/x-icon"],[".svg","image/svg+xml"]]);
      const contentType = imageTypes.get(extension);
      if (!contentType) return sendJson(res, {error:"该文件不是支持预览的图片格式"}, 415);
      const maximumBytes = readRuntimeSettings(RUNTIME_SETTINGS_FILE).sftp_max_open_file_size_mb * 1024 * 1024;
      const result = await readRemoteBinaryFile(connectionId, remotePath, maximumBytes);
      return send(res, 200, result.content, {
        "Content-Type":contentType,
        "Content-Disposition":`inline; filename="${encodeURIComponent(path.posix.basename(remotePath) || "preview")}"`,
        "Cache-Control":"no-store"
      });
    }
    if (req.method === "POST" && parts[4] === "upload-plan") {
      const data = await readJson(req);
      return sendJson(res, await planRemoteUploads(connectionId, data.path || ".", data.filenames || []));
    }
    if (req.method === "POST" && parts[4] === "native-drag") {
      if (!isDesktopRequest(req) || !desktopIntegration) return sendJson(res, {error:"拖出到本机只能在桌面版中使用"}, 403);
      const data = await readJson(req);
      return sendJson(res, await createNativeSftpDragTicket(connectionId, data.paths || [], {
        platform:String(data.platform || process.platform)
      }));
    }
    if (req.method === "POST" && parts[4] === "stage-drag") {
      if (!isDesktopRequest(req) || !desktopIntegration) return sendJson(res, {error:"拖出到本机仅能在桌面版中使用"}, 403);
      const data = await readJson(req);
      return sendJson(res, await stageSftpPaths(connectionId, data.paths || []));
    }
    if (req.method === "POST" && parts[4] === "upload-job") {
      const data = await readJson(req);
      const dir = String(data.path || ".");
      const filename = safeUploadName(data.filename || "upload.bin");
      const conflict = ["overwrite", "rename"].includes(data.conflict) ? data.conflict : "error";
      const target = await resolveRemoteUploadTarget(connectionId, dir, filename, conflict);
      if (target.exists && conflict === "error") return sendJson(res, {error:"目标目录已存在同名项目", conflict:true, name:target.name}, 409);
      const result = startUploadReceiveJob(connectionId, target.path, filename, Math.max(0, Number(data.size || 0)), {
        conflict,
        sizeKnown:Object.prototype.hasOwnProperty.call(data, "size")
      });
      return sendJson(res, {...result, remote_path:target.path, renamed:target.renamed}, 201);
    }
    if (req.method === "POST" && parts[4] === "upload") {
      const url = new URL(req.url, "http://terma.invalid");
      const dir = url.searchParams.get("path") || ".";
      const filename = decodeURIComponent(String(req.headers["x-file-name"] || url.searchParams.get("filename") || "upload.bin"));
      const conflict = ["overwrite", "rename"].includes(url.searchParams.get("conflict") || "") ? url.searchParams.get("conflict") : "error";
      const target = await resolveRemoteUploadTarget(connectionId, dir, filename, conflict);
      if (target.exists && conflict === "error") return sendJson(res, { error:"目标目录已存在同名项目", conflict:true, name:target.name }, 409);
      const started = startUploadReceiveJob(connectionId, target.path, filename, Math.max(0, Number(req.headers["content-length"] || 0)), {
        conflict,
        sizeKnown:req.headers["content-length"] !== undefined
      });
      try {
        const result = await receiveUploadJobContent(started.id, req);
        invalidateRemoteDirectoryCache(connectionId);
        return sendJson(res, {...result, remote_path:target.path, renamed:target.renamed}, 202);
      } catch (error) {
        if (error?.code === "SFTP_UPLOAD_CANCELLED") {
          if (!res.destroyed && !res.writableEnded) return sendJson(res, {ok:true, status:"cancelled", id:started.id}, 409);
          return;
        }
        throw error;
      }
    }
    const data = await readJson(req);
    if (req.method === "POST" && parts[4] === "directory-size") {
      return send(res, 200, await readRemoteDirectorySize(connectionId, data.path), { "Cache-Control":"no-store" });
    }
    if (req.method === "POST" && parts[4] === "trash" && parts[5] === "restore") {
      const result = await restoreRemoteRecycleItem(connectionId, data.id, data.storage);
      invalidateRemoteDirectoryCache(connectionId);
      return sendJson(res, result);
    }
    if (req.method === "POST" && parts[4] === "trash" && parts[5] === "delete") {
      return sendJson(res, await deleteRemoteRecycleItem(connectionId, data.id, data.storage));
    }
    if (req.method === "POST" && parts[4] === "trash" && parts[5] === "clear") {
      return sendJson(res, await clearRemoteRecycleItems(connectionId));
    }
    if (req.method === "POST" && parts[4] === "mkdir") {
      const result = await makeRemoteDir(connectionId, data.path);
      invalidateRemoteDirectoryCache(connectionId);
      return sendJson(res, result);
    }
    if (req.method === "POST" && parts[4] === "create-file") {
      const result = await createRemoteFile(connectionId, data.path);
      invalidateRemoteDirectoryCache(connectionId);
      return sendJson(res, result);
    }
    if (req.method === "POST" && parts[4] === "delete") {
      const recycleEnabled = readRuntimeSettings(RUNTIME_SETTINGS_FILE).sftp_recycle_bin_enabled;
      const requestedPaths = Array.isArray(data.paths) ? data.paths : [data.path];
      const result = deletePathsJob(connectionId, requestedPaths, recycleEnabled);
      invalidateRemoteDirectoryCache(connectionId);
      return sendJson(res, result, 202);
    }
    if (req.method === "POST" && parts[4] === "rename") {
      const result = await renameRemotePath(connectionId, data.from, data.to);
      invalidateRemoteDirectoryCache(connectionId);
      return sendJson(res, result);
    }
    if (req.method === "POST" && parts[4] === "copy") {
      const result = data.background ? copyJob(connectionId, data.paths || [], data.target) : await copyRemotePaths(connectionId, data.paths || [], data.target);
      invalidateRemoteDirectoryCache(connectionId);
      return sendJson(res, result);
    }
    if (req.method === "POST" && parts[4] === "cross-copy") {
      const targetConnectionId = Number(data.target_connection_id);
      const result = crossCopyJob(connectionId, targetConnectionId, data.paths || [], data.target || ".", data.conflict || "error", data.entries || []);
      invalidateRemoteDirectoryCache(targetConnectionId);
      return sendJson(res, result, 202);
    }
    if (req.method === "POST" && parts[4] === "move") {
      const result = data.background ? moveJob(connectionId, data.paths || [], data.target) : await moveRemotePaths(connectionId, data.paths || [], data.target);
      invalidateRemoteDirectoryCache(connectionId);
      return sendJson(res, result);
    }
    if (req.method === "POST" && parts[4] === "extract") {
      const result = data.background ? extractJob(connectionId, data.path, data.target) : await extractRemoteArchive(connectionId, data.path, data.target);
      invalidateRemoteDirectoryCache(connectionId);
      return sendJson(res, result);
    }
    if (req.method === "POST" && parts[4] === "compress") {
      const paths = Array.isArray(data.paths) ? data.paths : [data.path];
      const result = compressJob(connectionId, paths, data.target, data.filename || data.name || "");
      invalidateRemoteDirectoryCache(connectionId);
      return sendJson(res, result, 202);
    }
    if (req.method === "POST" && ["permissions", "chmod"].includes(parts[4])) {
      const request = normalizeRemotePermissionRequest(data.paths, data.mode, data.recursive, data.owner, data.group);
      const result = await setRemotePermissions(connectionId, request.paths, request.mode, request.recursive, request.owner, request.group);
      return sendJson(res, result);
    }
    if (req.method === "POST" && parts[4] === "write") {
      const { content } = prepareSftpWriteContent(data.content, data.encoding || "utf8");
      const result = await writeRemoteFile(connectionId, data.path, content, { backup: Boolean(data.backup) });
      if (data.persist_default) updateSftpTextEncoding(connectionId, data.encoding || "utf8");
      invalidateRemoteDirectoryCache(connectionId);
      return sendJson(res, { ...result, encoding: data.encoding || "utf8" });
    }
  }
  if (req.method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "connections") {
    if (parts[3] === "health") return sendJson(res, await connectionHealth(Number(parts[2]), {force:true}));
    if (parts[3] === "inspect") return sendJson(res, await inspectServer(Number(parts[2])));
    if (parts[3] === "start-forwards") {
      const connection = getConnection(Number(parts[2]));
      try {
        await startConnectionForwards(connection.id);
        clearConnectionHealthCache(connection.id);
        appendSystemLog(`已启动连接 ${connection.name} 的全部转发`);
      } catch (error) {
        appendSystemLog(`连接 ${connection.name} 启动转发失败：${error.message}`);
        throw error;
      }
    }
    else if (parts[3] === "stop-forwards") {
      const connection = getConnection(Number(parts[2]));
      stopConnectionForwards(connection.id);
      clearConnectionHealthCache(connection.id);
      appendSystemLog(`已停止连接 ${connection.name} 的全部转发`);
    }
    else return sendJson(res, { error: "Not found" }, 404);
    return sendJson(res, { ok: true });
  }
  if (req.method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "forwards") {
    if (parts[3] === "start") {
      const forward = getForward(Number(parts[2]));
      const label = forwardLogLabel(parts[2]);
      try {
        await startForward(Number(parts[2]));
        clearConnectionHealthCache(forward.connection_id);
        appendSystemLog(`已启动转发：${label}`);
      } catch (error) {
        appendSystemLog(`启动转发失败：${label}：${error.message}`);
        throw error;
      }
    }
    else if (parts[3] === "stop") {
      const forward = getForward(Number(parts[2]));
      stopForward(Number(parts[2]));
      clearConnectionHealthCache(forward.connection_id);
      appendSystemLog(`已停止转发：${forwardLogLabel(parts[2])}`);
    }
    else if (parts[3] === "health") {
      const forwardId = Number(parts[2]);
      const connection = listConnections().find((item) => (item.forwards || []).some((forward) => forward.id === forwardId));
      if (!connection) return sendJson(res, { error: "转发不存在" }, 404);
      const health = await connectionHealth(connection.id);
      return sendJson(res, health.forwards.find((forward) => forward.id === forwardId) || {});
    }
    else return sendJson(res, { error: "Not found" }, 404);
    return sendJson(res, { ok: true });
  }
  if (req.method === "PUT" && parts.length === 3 && parts[0] === "api" && parts[1] === "forwards") {
    const before = getForward(Number(parts[2]));
    updateForward(Number(parts[2]), await readJson(req));
    clearConnectionHealthCache(before.connection_id);
    appendSystemLog(`已更新转发：${forwardLogLabel(parts[2])}`);
    return sendJson(res, { ok: true, was_running: Boolean(before.pid) });
  }
  if (req.method === "PUT" && parts.length === 3 && parts[0] === "api" && parts[1] === "connections") {
    updateConnection(Number(parts[2]), await readJson(req), DEFAULT_EXTRA_ARGS);
    clearConnectionHealthCache(Number(parts[2]));
    return sendJson(res, { ok: true });
  }
  if (req.method === "DELETE" && parts.length === 3 && parts[0] === "api" && parts[1] === "connections") {
    stopExternalEditsForConnection(Number(parts[2]));
    deleteConnection(Number(parts[2]), stopForward);
    clearConnectionHealthCache(Number(parts[2]));
    return sendJson(res, { ok: true });
  }
  if (parts.length === 3 && parts[0] === "api" && parts[1] === "command-templates") {
    if (req.method === "PUT") return sendJson(res, updateCommandTemplate(parts[2], await readJson(req)));
    if (req.method === "DELETE") return sendJson(res, deleteCommandTemplate(parts[2]));
  }
  if (req.method === "DELETE" && parts.length === 3 && parts[0] === "api" && parts[1] === "forwards") {
    const forward = getForward(Number(parts[2]));
    deleteForward(Number(parts[2]), stopForward);
    clearConnectionHealthCache(forward.connection_id);
    return sendJson(res, { ok: true });
  }
  return sendJson(res, { error: "Not found" }, 404);
}

function requestHandler(req, res) {
  Promise.resolve().then(async () => {
    if (!hostAllowed(req)) return sendJson(res, { error:"Unrecognized Host" }, 421);
    const { pathname } = new URL(req.url, "http://terma.invalid");
    if (pathname.startsWith("/api/")) await handleApi(req, res, pathname);
    else serveStatic(req, res, pathname);
  }).catch((error) => {
    const hostTrust = hostTrustErrorResponse(error);
    if (!res.headersSent && hostTrust) sendJson(res, hostTrust.body, hostTrust.status);
    else if (!res.headersSent) {
      const status = Number(error?.statusCode || error?.status_code || 400);
      const body: any = {error:error.message || String(error)};
      if (error?.code) body.code = String(error.code);
      if (error?.task) body.task = error.task;
      sendJson(res, body, status >= 400 && status <= 599 ? status : 400);
    }
    else res.destroy();
  });
}

function upgradeHandler(req, socket) {
  try {
    if (!hostAllowed(req) || !webSocketOriginAllowed(req) || !isAuthenticated(req)) return socket.destroy();
    const { pathname } = new URL(req.url, "http://terma.invalid");
    if (pathname === "/ws/terminal") return handleTerminalUpgrade(req, socket);
    if (pathname === "/ws/remote-terminal") return handleRemoteTerminalUpgrade(req, socket);
    if (pathname === "/ws/vnc") return handleVncUpgrade(req, socket);
    if (pathname === "/ws/batch-command") return handleBatchCommandUpgrade(req, socket);
  } catch {}
  socket.destroy();
}

function createHttpListener() {
  const listener = http.createServer(requestHandler);
  listener.on("upgrade", upgradeHandler);
  return listener;
}

function parseArgs(argv = process.argv.slice(2)) {
  const out: any = { listen_hosts: [...DEFAULT_HOSTS], listen_port: DEFAULT_PORT, pidFile: PID_FILE };
  const cliHosts: string[] = [];
  let cliPort;
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--host" || item === "--hosts") {
      const value = argv[++i];
      if (value !== undefined) cliHosts.push(...String(value).split(/[\s,]+/).filter(Boolean));
    } else if (item === "--port") {
      cliPort = argv[++i];
    } else if (item === "--pid-file") {
      out.pidFile = argv[++i];
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
  const listen_hosts = normalizeListenHosts(hostsValue, null);
  const listen_port = normalizeListenPort(portValue, null);
  return {
    ...source,
    listen_hosts,
    listen_port,
    requested_hosts: [...listen_hosts],
    requested_port: listen_port,
    host: listen_hosts.join(","),
    port: listen_port,
    pidFile: source.pidFile || PID_FILE
  };
}

let args: any = normalizeStartArgs();
let activeServers: any[] = [];
let exitOnShutdown = true;
let onShutdown: null | (() => any) = null;
let desktopIntegration: any = null;
let shutdownAuthToken = "";
const {
  connectionRowsFromBackup,
  storageSettingsView,
  saveWebStorageSettings,
  listLocalDirectories,
  inspectRestoreDatabaseFile,
  normalizeRestoredCredentials
} = createStorageRestoreHelpers({
  BASE_DIR,
  DATA_DIR,
  PROJECT_SSH_DIR,
  RUNTIME_ROOT,
  STORAGE_SETTINGS_FILE,
  decryptText,
  encryptionReady,
  encryptText,
  isEncryptedText,
  listIdentityFiles,
  readSecuritySettings,
  validateSortOrder,
  getDesktopIntegration:() => desktopIntegration,
  getArgs:() => args,
  requestShutdown:() => shutdown()
});
let updateCheckTimer = null;
let installedUpdateCleanupTimer = null;
let startupTaskTimer = null;
let startupEffectsStarted = false;
let shutdownPromise: Promise<any> | null = null;

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
    const fail = (error) => {
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
    listener.listen({ host, port });
  });
}

function closeListener(listener) {
  return new Promise<void>((resolve) => {
    if (!listener || !listener.listening) return resolve();
    try { listener.close(() => resolve()); } catch { resolve(); }
  });
}

async function closeListeners(listeners) {
  await Promise.all((listeners || []).map(closeListener));
}

async function bindAll(hosts, port, factory = createHttpListener) {
  const listeners: any[] = [];
  try {
    for (const host of hosts) {
      const listener = factory();
      await listenOne(listener, host, port);
      listeners.push(listener);
      listener.on("error", (error) => {
        appendSystemLog(`Web 监听 ${host}:${port} 运行时错误：${error.message || error}`);
      });
    }
    return listeners;
  } catch (error) {
    await closeListeners(listeners);
    throw error;
  }
}

async function bindWithFallback(hosts, requestedPort, options: any = {}) {
  const factory = options.factory || createHttpListener;
  const maxFallbacks = Number.isInteger(options.maxFallbacks) ? options.maxFallbacks : MAX_PORT_FALLBACKS;
  let lastError;
  for (let offset = 0; offset <= maxFallbacks && requestedPort + offset <= 65535; offset += 1) {
    const port = requestedPort + offset;
    try {
      const listeners = await bindAll(hosts, port, factory);
      return { listeners, port, fallback_count: offset };
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
  const add = (host) => {
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
  const localHost = hosts.find((host) => isLoopbackHost(host)) || (hosts.includes("0.0.0.0") ? "127.0.0.1" : hosts[0]);
  const localUrl = `http://${localHost}:${port}`;
  const lanUrls = lanUrlsForHosts(hosts, port);
  return { localUrl, lanUrls, urls: [...new Set([localUrl, ...lanUrls])] };
}

function sameListenHosts(left, right) {
  return JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
}

function runtimeSources() {
  const hasPersistedSettings = fs.existsSync(RUNTIME_SETTINGS_FILE);
  return {
    listen_hosts: process.env.TUNNEL_WEB_HOSTS || process.env.TUNNEL_WEB_HOST ? "env" : (hasPersistedSettings ? "file" : "default"),
    listen_port: process.env.TUNNEL_WEB_PORT ? "env" : (hasPersistedSettings ? "file" : "default")
  };
}

function runtimeSettingsView() {
  const persisted = readRuntimeSettings(RUNTIME_SETTINGS_FILE);
  const actualHosts = args.actual_hosts || args.listen_hosts;
  const actualPort = args.actual_port || args.port;
  const urls = activeServers.length ? urlsForHosts(actualHosts, actualPort) : { localUrl: "", lanUrls: [], urls: [] };
  const sources = runtimeSources();
  const saved = {
    ...persisted,
    listen_hosts: [...persisted.listen_hosts],
    listen_port: persisted.listen_port
  };
  const effective = {
    listen_hosts: [...(actualHosts || [])],
    listen_port: actualPort,
    sources
  };
  return {
    ...saved,
    saved,
    effective,
    sources,
    requested_hosts: [...(args.requested_hosts || persisted.listen_hosts)],
    requested_port: Number(args.requested_port || persisted.listen_port),
    actual_hosts: [...(actualHosts || [])],
    actual_port: actualPort,
    available_hosts: availableListenHosts(),
    local_url: urls.localUrl,
    lan_urls: urls.lanUrls,
    urls: urls.urls,
    restart_required: Boolean(activeServers.length) && (
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
      listen_hosts: data.listen_hosts ?? persisted.listen_hosts,
      listen_port: data.listen_port ?? persisted.listen_port
    });
  } catch (error) {
    return { available: false, error: error.message || String(error) };
  }
  const resultBase = {
    requested_hosts: [...normalized.listen_hosts],
    requested_port: normalized.listen_port,
    listen_hosts: [...normalized.listen_hosts],
    listen_port: normalized.listen_port
  };
  const currentPort = Number(args.actual_port || args.listen_port);
  if (activeServers.length && normalized.listen_port === currentPort && sameListenHosts(normalized.listen_hosts, args.actual_hosts || args.listen_hosts)) {
    return { available: true, occupied_by_current: true, ...resultBase };
  }
  try {
    const listeners = await bindAll(normalized.listen_hosts, normalized.listen_port, () => net.createServer());
    await closeListeners(listeners);
    return { available: true, occupied_by_current: false, ...resultBase };
  } catch (error) {
    return {
      available: false,
      occupied_by_current: false,
      ...resultBase,
      error: error.message || String(error),
      code: error.code || "",
      suggested_port: error.code === "EADDRINUSE" ? await suggestRuntimePort(normalized.listen_hosts, normalized.listen_port) : null
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
  const readText = (file) => {
    try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
  };
  return {
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cwd: process.cwd(),
    data_dir: DATA_DIR,
    log_dir: LOG_DIR,
    web_pid_file: args.pidFile,
    web_url_file: WEB_URL_FILE,
    web_info_file: WEB_INFO_FILE,
    web_url: readText(WEB_URL_FILE),
    web_info: readText(WEB_INFO_FILE),
    web_log: path.join(DATA_DIR, "web.log"),
    runtime_settings_file: RUNTIME_SETTINGS_FILE,
    requested_hosts: args.requested_hosts,
    requested_port: args.requested_port,
    actual_hosts: args.actual_hosts || args.listen_hosts,
    actual_port: args.actual_port || args.port,
    pty: {
      available: ptyAvailable,
      operational: ptyOperational,
      error: ptyError,
      ...ptyStatus,
      optional_dependency: "node-pty"
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
  const urls = urlsForHosts(actualHosts, actualPort);
  fs.writeFileSync(args.pidFile, String(process.pid));
  fs.writeFileSync(WEB_URL_FILE, urls.localUrl);
  writeRuntimeSettings(RUNTIME_SETTINGS_FILE, {
    ...readRuntimeSettings(RUNTIME_SETTINGS_FILE),
    listen_hosts: args.requested_hosts,
    listen_port: actualPort
  });
  fs.writeFileSync(WEB_INFO_FILE, JSON.stringify({
    pid: process.pid,
    host: args.host,
    port: actualPort,
    requested_hosts: args.requested_hosts,
    requested_port: args.requested_port,
    actual_hosts: actualHosts,
    actual_port: actualPort,
    fallback_count: binding.fallback_count,
    local_url: urls.localUrl,
    lan_urls: urls.lanUrls,
    urls: urls.urls,
    started_at: new Date().toISOString()
  }, null, 2), "utf8");
  writeStartupStatus({ state:"starting", local_url:urls.localUrl, lan_urls:urls.lanUrls, host:args.host, port:actualPort, requested_hosts:args.requested_hosts, requested_port:args.requested_port, actual_hosts:actualHosts, actual_port:actualPort });
  console.log(`Terma listening on http://${args.host}:${actualPort}`);
  if (urls.lanUrls.length) console.log(`Terma LAN URLs:\n${urls.lanUrls.map((url) => `  ${url}`).join("\n")}`);
  appendSystemLog(`Terma 已启动：http://${args.host}:${actualPort}`);
  if (process.env.TERMA_DISABLE_UPDATE_CHECK !== "1" && process.env.TUNNELDESK_DISABLE_UPDATE_CHECK !== "1") {
    clearTimeout(updateCheckTimer);
    updateCheckTimer = setTimeout(() => {
      updateChecker.check().catch(() => {});
    }, 10 * 1000);
    updateCheckTimer.unref?.();
  }
  startupTaskTimer = setTimeout(async () => {
    let autostart = {ok:0,failed:0,errors:[]};
    let restore = {ok:0,failed:0,errors:[]};
    try {
      autostart = await autostartConnections();
    } catch (error) {
      console.error(`autostart failed: ${error.message}`);
      autostart = {ok:0,failed:1,errors:[{error:error.message}]};
    }
    try {
      restore = await restorePreviousForwards();
    } catch (error) {
      console.error(`restore forwards failed: ${error.message}`);
      restore = {ok:0,failed:1,errors:[{error:error.message}]};
    }
    const failures = Number(autostart.failed || 0) + Number(restore.failed || 0);
    writeStartupStatus({state:failures ? "warning" : "ready", completed_at:Date.now(), autostart, restore, failures, log_path:path.join(LOG_DIR, `system-${new Date().toISOString().slice(0,10)}.log`)});
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
      stopAllForwards({ preserveRestoreState: true });
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
    if (onShutdown) await Promise.resolve(onShutdown()).catch((error) => console.error(`shutdown callback failed: ${error.message}`));
  })();
  return shutdownPromise;
}

function startServer(customArgs: any = parseArgs(), options: any = {}) {
  args = normalizeStartArgs(customArgs);
  exitOnShutdown = options.exitOnShutdown !== false;
  onShutdown = typeof options.onShutdown === "function" ? options.onShutdown : null;
  desktopIntegration = options.desktopIntegration || null;
  setDesktopAuthToken(desktopIntegration ? options.desktopAuthToken : "");
  startupEffectsStarted = false;
  shutdownPromise = null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  cleanupFtpTemp();
  scheduleInstalledUpdateCleanup();
  if (process.env.TERMA_RESET_WEB_ACCESS === "1" || process.env.TUNNELDESK_RESET_WEB_ACCESS === "1") {
    resetWebAccessSecurity();
    appendSystemLog("已根据 TERMA_RESET_WEB_ACCESS 重置 Web 访问密码和 Token");
  }
  const ready = bindWithFallback(args.listen_hosts, args.listen_port).then(async (binding) => {
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
      servers: activeServers,
      server: activeServers[0],
      args,
      port: binding.port,
      hosts: args.listen_hosts,
      fallback_count: binding.fallback_count
    };
  }).catch((error) => {
    writeStartupStatus({ state: "error", error: error.message || String(error), code: error.code || "", failed_at: Date.now() });
    appendSystemLog(`Terma 启动失败：${error.message || error}`);
    throw error;
  });
  // Desktop callers may intentionally ignore the promise; keep a rejection handler attached.
  ready.catch(() => {});
  return {
    get server() { return activeServers[0] || null; },
    get servers() { return activeServers; },
    args,
    ready,
    shutdown
  };
}

if (require.main === module) {
  const started = startServer(parseArgs());
  started.ready.catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
  process.on("SIGINT", () => { shutdown(); });
  process.on("SIGTERM", () => { shutdown(); });
  process.on("SIGHUP", () => { shutdown(); });
}

module.exports = {
  __nativeDragByteRange:nativeDragByteRange,
  __remoteClientDiagnosticsWithoutDesktopIntegration:remoteClientDiagnosticsWithoutDesktopIntegration,
  __xServerDiagnosticsWithoutDesktopIntegration:xServerDiagnosticsWithoutDesktopIntegration,
  __xdmcpTaskResourceKey:xdmcpTaskResourceKey,
  startServer,
  shutdown,
  parseArgs,
  runtimeSettingsView,
  checkRuntimeSettings,
  prepareSftpWriteContent
};
