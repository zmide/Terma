const http = require("node:http");
const os = require("node:os");
const { URL } = require("node:url");

const {
  DATA_DIR,
  BASE_DIR,
  RUNTIME_ROOT,
  STORAGE_SETTINGS_FILE,
  DB_PATH,
  PROJECT_SSH_DIR,
  USER_SSH_DIR,
  DEFAULT_EXTRA_ARGS,
  RUNTIME_SETTINGS_FILE,
} = require("./config");
const {
  listConnections,
  listRemoteProfiles,
  getRemoteProfile,
  insertRemoteProfile,
  createRemoteProfileFromConnection,
  createAllRemoteProfilesFromConnection,
  updateRemoteProfile,
  repairRemoteProfileManagementConnection,
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
  reorderConnections,
  insertForward,
  updateForward,
  deleteConnection,
  deleteForward,
  encryptStoredConnectionSecrets,
  decryptStoredConnectionSecrets,
  validateSortOrder,
  all,
  databaseRevision,
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
  reconfigureForwardRuntime,
  startConnectionForwards,
  stopConnectionForwards,
  stopAllForwards,
  restorePreviousForwards,
  restoreStateSummary,
  configuredPortOwner,
  diagnosePortUsage,
  recommendPort,
  killPortOwner,
  connectionHealth,
  allConnectionsHealth,
  testSsh,
  batchRunCommands,
  runPersistentSshCommandForConnection,
  runPersistentSshCommandForConnectionStreaming,
  runSshCommandForConnection,
  runSshCommandForConnectionStreaming,
  clearConnectionHealthCache
} = require("./ssh");
const { diagnoseSshError } = require("./ssh-diagnostics");
const { createForwardReconfigurationService } = require("./services/forward-reconfiguration-service");
const { publicErrorDetails } = require("./public-error");
const { inspectExtraArgs } = require("./ssh-command");
const { deleteManagedKey, deployGeneratedPublicKey, generateSshKey, importManagedKey, listManagedKeys, managedKeyProperties, managedPublicKey, updateManagedKey } = require("./ssh-key-wizard");
const { authorizeQuickConnectionId, createQuickTerminalTicket, revokeQuickTerminalTicket } = require("./quick-terminal");
const { createTerminalStartupTicket } = require("./terminal-startup");
const { reconfigureForward } = createForwardReconfigurationService({getForward, updateForward, reconfigureForwardRuntime});
const { TERMINAL_CLIPBOARD_IMAGE_MAX_BYTES, writeTerminalClipboardImage } = require("./terminal-clipboard");
const { x11RuntimeDiagnostics } = require("./x11");
const { configureXdmcpServer, detectXdmcpServer, resolveManagementConnection } = require("./xdmcp-manager");
const { handoffRemotePrivilegeGrant, runRemotePrivilegeCommand } = require("./remote-privilege");
const { getPart } = require("./multipart");
const { parseConfigText, batchTest, saveImported, exportConfig } = require("./importer");
const {
  handleTerminalUpgrade,
  closeDesktopBrowserGrantTerminals,
  closeQuickConnectionTerminals,
  refreshDesktopBrowserGrantTerminals
} = require("./terminal");
const { handleRemoteTerminalUpgrade, listSerialPorts, testRemoteTerminalProfile } = require("./remote-terminal");
const { handleVncUpgrade, testVncProfile } = require("./vnc-proxy");
const {
  inspectVncRemoteClipboardImage,
  readVncRemoteClipboard,
  readVncRemoteClipboardImage,
  writeVncRemoteClipboard,
  writeVncRemoteClipboardImage
} = require("./vnc-clipboard");
const { deleteFtpPath, downloadFtpFile, listFtpDirectory, makeFtpDirectory, renameFtpPath, testFtpCredentials, testFtpProfile, uploadFtpFile } = require("./ftp");
const {
  connectSftpSession,
  createNativeSftpDragTicket,
  disconnectSftpSession,
  getNativeSftpDragTicket,
  releaseNativeSftpDragTicket,
  sftpSessionStatus,
  stageSftpPaths
} = require("./sftp-session");
const { handleBatchCommandUpgrade } = require("./commands");
const { clearRemoteRecycleItems, copyRemotePaths, createRemoteFile, deleteRemoteRecycleItem, extractRemoteArchive, invalidateRemoteDirectoryCache, listRemoteDir, listRemoteFileVersions, listRemoteRecycleItems, makeRemoteDir, moveRemotePaths, normalizeRemotePermissionRequest, planRemoteUploads, readRemoteBinaryFile, readRemoteDirectorySize, readRemoteTextFile, renameRemotePath, resolveRemoteDirectory, resolveRemoteUploadTarget, restoreRemoteRecycleItem, setRemotePermissions, writeRemoteFile, streamRemoteFile } = require("./sftp");
const { clearSftpCache, compressJob, copyJob, crossCopyJob, deletePathsJob, extractJob, listSftpJobs, moveJob, receiveUploadJobContent, sftpCacheInfo, startArchiveDownloadJob, startDownloadJob, startLocalDeliveryJob, startUploadReceiveJob } = require("./sftp-jobs");
const { getExternalEdit, getExternalEditComparison, listExternalEdits, resolveExternalEdit, startExternalEdit, stopExternalEdit, stopExternalEditsForConnection } = require("./sftp-external-edit");
const { startSyncJob, startSyncPlanningJob } = require("./sftp-sync");
const {
  appendSystemLog,
  deleteLogs,
  deleteLogsOlderThan,
  enforceConfiguredLogRetention,
  getLogSettings,
  listLogs,
  readLog,
  readLogWindow,
  readRawLog,
  searchLogs,
  updateLogSettings
  ,previewLogsOlderThan, resolveLogPath
} = require("./logs");
const { listNotifications } = require("./notifications");
const {
  AuthenticationError,
  authRequired,
  createDesktopBrowserGrant,
  createSession,
  desktopBrowserGrantCookie,
  desktopBrowserGrantStatus,
  hasAuthenticatedWebSession,
  hostAllowed,
  isAuthenticated,
  isDesktopCapabilityRequest,
  localDirectDesktopIntegrationStatus,
  isDirectLoopbackRequest,
  isDesktopRequest,
  login,
  logout,
  publicAuthStatus,
  publicSecuritySettings,
  requestAuthenticationBinding,
  readSecuritySettings,
  revokeDesktopBrowserGrant,
  sameOrigin,
  secureHeaders,
  securityDiagnostics,
  securitySettingsRevision,
  sessionCookie,
  setPassword,
  setToken,
  updateSecurityOptions,
  webSocketOriginAllowed,
  writeSecuritySettings
} = require("./security");
const { acceptHostTrust, hostTrustErrorResponse, listTrustedHostsPage, removeTrustedHost } = require("./ssh-host-trust");
const { ensureConnectionHostTrusted } = require("./ssh2-client");
const {
  beginDisableEncryption,
  completeEncryptionEnable,
  decryptText,
  disableEncryption,
  enableEncryption,
  encryptionReady,
  encryptionState,
  encryptText,
  isEncryptedText,
  lockEncryption,
  prepareEncryptionUpgrade,
  requireEncryptionUnlocked,
  unlockEncryption
} = require("./crypto-store");
const { clearConfigSnapshots, createConfigSnapshot, deleteConfigSnapshot, listConfigSnapshots, pruneConfigSnapshotsForCurrentEncryption, restoreConfigSnapshotById } = require("./config-snapshots");
const { ensurePrivateFile } = require("./storage-permissions");
const { createDatabaseBundleHeader, DatabaseTransferStore } = require("./database-transfer");
const { handleLogRoutes } = require("./routes/log-routes");
const { handleBackupRestoreRoutes } = require("./routes/backup-restore-routes");
const { handleCommandResourceRoutes } = require("./routes/command-resource-routes");
const { handleConnectionRoutes } = require("./routes/connection-routes");
const { handleForwardTemplateRoutes } = require("./routes/forward-template-routes");
const { handleFtpRoutes } = require("./routes/ftp-routes");
const { handleLocalFilesRoutes } = require("./routes/local-files-routes");
const { handleLocalControlRoutes } = require("./routes/local-control-routes");
const { handleConfigTransferRoutes } = require("./routes/config-transfer-routes");
const { handleSftpDesktopDownloadRoutes } = require("./routes/sftp-desktop-download-routes");
const { handleSftpExternalEditRoutes } = require("./routes/sftp-external-edit-routes");
const { handleSftpJobRoutes } = require("./routes/sftp-job-routes");
const { handleSftpTransferRoutes } = require("./routes/sftp-transfer-routes");
const { handlePublicAuthRoutes, handleSecurityRoutes } = require("./routes/security-routes");
const {
  handleDesktopIntegrationRoutes,
  remoteClientDiagnosticsWithoutDesktopIntegration,
  xServerDiagnosticsWithoutDesktopIntegration
} = require("./routes/desktop-integration-routes");
const { handleSshRoutes } = require("./routes/ssh-routes");
const { handleTerminalRoutes } = require("./routes/terminal-routes");
const { handleRemoteCredentialRoutes } = require("./routes/remote-credential-routes");
const { handleRemoteConnectivityRoutes } = require("./routes/remote-connectivity-routes");
const { handleRemoteProfileRoutes } = require("./routes/remote-profile-routes");
const { handleRemoteTaskRoutes } = require("./routes/remote-task-routes");
const { handleSftpOpenRoutes } = require("./routes/sftp-open-routes");
const { handleX11ApplicationRoutes } = require("./routes/x11-application-routes");
const { handleX11ForwardingRoutes } = require("./routes/x11-forwarding-routes");
const { streamRemoteOpenFile } = require("./sftp");
const { inspectRemoteProfileConnectivity, probeTcpEndpoint } = require("./remote-connectivity");
const { formatRemoteEndpoint } = require("./remote-host");
const { handleStorageRoutes } = require("./routes/storage-routes");
const { handleSystemRoutes } = require("./routes/system-routes");
const { handleUpdateRoutes } = require("./routes/update-routes");
const { handleUiStateRoutes } = require("./routes/ui-state-routes");
const { createProgramCacheManager } = require("./program-cache");
const { createStorageRestoreHelpers } = require("./storage-restore");
const {
  normalizeRuntimeSettings,
  readRuntimeSettings,
  writeRuntimeSettings
} = require("./runtime-settings");
const {
  createRemoteAdminGrant,
  issueRemoteAdminGrant,
  releaseRemoteAdminGrant
} = require("./services/remote-admin-service");
const {
  remoteOfflineTasks,
  startRemoteComponentCommandTask,
  xdmcpTaskResourceKey
} = require("./services/remote-component-service");
const {
  configureX11ClipboardHelperForConnection,
  detectSshX11ForConnection,
  installX11ApplicationsForConnection,
  inspectX11ClipboardHelperForConnection,
  startSshX11ConfigurationTask,
  verifyX11ApplicationForConnection,
  x11ApplicationsForConnection,
  x11InstallPlanForConnection
} = require("./services/x11-management-service");
const {
  configureVncClipboardHelperForProfile,
  configureVncServerForProfile,
  inspectVncClipboardHelperForProfile,
  inspectVncServerForProfile
} = require("./services/vnc-management-service");
const {
  clearFinishedLinuxDesktopTasks,
  configureRdpServerForConnection,
  deleteLinuxDesktopTask,
  detectLinuxDesktopForConnection,
  linuxDesktopTaskView,
  linuxDesktopTasks,
  listLinuxDesktopTasks,
  startLinuxDesktopInstall
} = require("./services/linux-desktop-service");
const { aboutInfo } = require("./services/app-metadata-service");
const { forwardLogLabel, inspectServer, terminalCapabilitiesForConnection } = require("./services/connection-inspection-service");
const { nativeDragByteRange, streamNativeSftpDragContent } = require("./services/native-sftp-drag-service");
const { prepareSftpWriteContent } = require("./services/sftp-content-service");
const { createServerRuntime } = require("./server-runtime");
const { readBody, readJson, safeUploadName, send, sendJson } = require("./http-response");
const { serveStatic } = require("./static-content-handler");

const prunedConfigSnapshots = pruneConfigSnapshotsForCurrentEncryption();
if (prunedConfigSnapshots) appendSystemLog(`配置加密状态已变化，已安全清理 ${prunedConfigSnapshots} 个不兼容的旧快照`);
const databaseTransferStore = new DatabaseTransferStore(DATA_DIR);
const runtime = createServerRuntime({createHttpListener:() => createHttpListener()});
const {
  checkRuntimeSettings,
  getDesktopIntegration,
  getArgs,
  getStartupStatus,
  hasShutdownToken,
  parseArgs,
  reconcileEncryptionStateAtStartup,
  runtimeDiagnostics,
  runtimeSettingsView,
  shutdown,
  startServer,
  updateChecker,
  updateInstaller
} = runtime;
const programCacheManager = createProgramCacheManager({
  sftpCacheInfo,
  clearSftpCache,
  updateCacheInfo:() => updateInstaller.cacheInfo(),
  clearUpdateCache:() => updateInstaller.clearCache(),
  remoteComponentCacheInfo:() => remoteOfflineTasks.cacheInfo(),
  clearRemoteComponentCache:() => remoteOfflineTasks.clearCache(),
  desktopCacheInfo:() => getDesktopIntegration()?.programCacheInfo?.() || null,
  clearDesktopCache:category => getDesktopIntegration()?.clearProgramCache?.(category)
});

function programCacheView() {
  return programCacheManager.view();
}

function authorizedConnectionForRequest(req, value) {
  const connectionId = Number(value);
  if (!Number.isSafeInteger(connectionId) || connectionId === 0) {
    throw new Error("SSH 连接 ID 无效");
  }
  if (connectionId > 0) return getConnection(connectionId);
  const token = String(req.headers["x-terma-quick-connection"] || "").trim();
  try {
    const connection = authorizeQuickConnectionId(connectionId, token, requestAuthenticationBinding(req));
    if (connection.auth_type === "key") requireEncryptionUnlocked();
    return connection;
  } catch (cause) {
    const error: any = new Error(cause?.message || "临时连接已失效，请重新建立快速连接");
    error.statusCode = 403;
    error.code = "QUICK_CONNECTION_AUTH_REQUIRED";
    throw error;
  }
}

function authorizedSftpConnectionId(req, value) {
  return Number(authorizedConnectionForRequest(req, value).id);
}

async function handleApi(req, res, pathname) {
  if (!hostAllowed(req)) return sendJson(res, { error:"Unrecognized Host" }, 421);
  if (!sameOrigin(req)) return sendJson(res, { error: "Forbidden" }, 403);
  if (await handleLocalControlRoutes(req, res, pathname, {
    getDesktopIntegration, getNativeSftpDragTicket, hasShutdownToken,
    isAuthenticated, isDesktopRequest, isDirectLoopbackRequest, releaseNativeSftpDragTicket,
    sendJson, shutdown, streamNativeSftpDragContent
  })) return;
  const securityRouteDependencies: any = {
    AuthenticationError, beginDisableEncryption, clearConfigSnapshots, completeEncryptionEnable, createSession,
    decryptStoredConnectionSecrets, disableEncryption, enableEncryption,
    encryptStoredConnectionSecrets, login, logout, publicSecuritySettings, readJson, readSecuritySettings,
    prepareEncryptionUpgrade, publicAuthStatus, send, sendJson, sessionCookie, setPassword, setToken,
    unlockEncryption, updateSecurityOptions
  };
  securityRouteDependencies.beforeLogout = request => {
    const grant = desktopBrowserGrantStatus(request);
    if (grant.grant_id) closeDesktopBrowserGrantTerminals(grant.grant_id, "Web 会话已退出");
  };
  securityRouteDependencies.publicSecuritySettings = request => {
    const state = encryptionState();
    return {
      ...publicSecuritySettings(request),
      encryption_unlocked:state.unlocked,
      encryption_ready:state.ready,
      encryption_upgrade_required:state.upgrade_required,
      encryption_transition_pending:state.transition_pending
    };
  };
  if (await handlePublicAuthRoutes(req, res, pathname, securityRouteDependencies)) return;
  if (!isAuthenticated(req)) return sendJson(res, { error: "Unauthorized" }, 401);
  if (await handleSecurityRoutes(req, res, pathname, securityRouteDependencies)) return;
  if (await handleUiStateRoutes(req, res, pathname, {
    databaseRevision, securityDiagnostics, securitySettingsRevision, sendJson
  })) return;
  if (await handleDesktopIntegrationRoutes(req, res, pathname, {
    createDesktopBrowserGrant, desktopBrowserGrantCookie, desktopBrowserGrantStatus,
    getDesktopIntegration, hasAuthenticatedWebSession,
    isDesktopCapabilityRequest, isDesktopRequest, isDirectLoopbackRequest, localDirectDesktopIntegrationStatus,
    readJson, revokeDesktopBrowserGrant, send, sendJson, x11RuntimeDiagnostics,
    closeDesktopBrowserGrantSessions:closeDesktopBrowserGrantTerminals,
    refreshDesktopBrowserGrantSessions:refreshDesktopBrowserGrantTerminals
  })) return;
  if (await handleSshRoutes(req, res, pathname, {
    acceptHostTrust, allConnectionsHealth, appendSystemLog, configuredPortOwner, diagnosePortUsage,
    ensureConnectionHostTrusted,
    generateSshKey:data => generateSshKey(data, Boolean(readSecuritySettings().manage_user_ssh_keys_enabled)),
    listManagedKeys:enabled => listManagedKeys(Boolean(enabled)),
    importManagedKey:(filename, data, scope, enabled) => importManagedKey(filename, data, scope, Boolean(enabled)),
    deleteManagedKey:(file, scope, enabled, referenced) => deleteManagedKey(file, scope, Boolean(enabled), referenced),
    managedKeyProperties:(file, scope, enabled) => managedKeyProperties(file, scope, Boolean(enabled)),
    managedPublicKey:(file, scope, enabled) => managedPublicKey(file, scope, Boolean(enabled)),
    updateManagedKey:(file, scope, enabled, data) => updateManagedKey(file, scope, Boolean(enabled), data),
    manageUserSshKeysEnabled:() => Boolean(readSecuritySettings().manage_user_ssh_keys_enabled),
    referencedIdentityPaths:() => listConnections().map(item => String(item.identity_file || "")).filter(Boolean),
    getConnection, getPart, identityPermissionStatus,
    inspectExtraArgs, killPortOwner, listConnections, listIdentityFiles, listTrustedHostsPage,
    parseConfigText, projectSshDir:PROJECT_SSH_DIR, readBody, readJson, recommendPort,
    removeTrustedHost, repairIdentityFile, saveUploadedKey, sendJson, terminalCapabilitiesForConnection,
    testSsh, userSshDir:USER_SSH_DIR
  })) return;
  if (await handleTerminalRoutes(req, res, pathname, {
    authorizeConnection:authorizedConnectionForRequest,
    createQuickTerminalTicket, createTerminalStartupTicket, getConnection,
    closeQuickConnectionTerminals, disconnectSftpSession, isDesktopCapabilityRequest, readBody, readJson, requestAuthenticationBinding,
    requireEncryptionUnlocked, revokeQuickTerminalTicket, sendJson,
    terminalClipboardImageMaxBytes:TERMINAL_CLIPBOARD_IMAGE_MAX_BYTES,
    writeTerminalClipboardImage:(connection, image, options) => writeTerminalClipboardImage(connection, image, {
      ...options,
      runCommand:runSshCommandForConnectionStreaming
    })
  })) return;
  if (await handleRemoteCredentialRoutes(req, res, pathname, {
    getRemoteProfile,
    readJson,
    sendJson,
    testFtpCredentials
  })) return;
  if (await handleRemoteConnectivityRoutes(req, res, pathname, {
    getRemoteProfile,
    inspectRemoteProfileConnectivity,
    sendJson
  })) return;
  if (await handleX11ForwardingRoutes(req, res, pathname, {
    authorizeConnection:authorizedConnectionForRequest,
    configureX11ClipboardHelperForConnection,
    createRemoteAdminGrant,
    detectSshX11ForConnection,
    inspectX11ClipboardHelperForConnection,
    readJson,
    releaseRemoteAdminGrant,
    sendJson,
    startSshX11ConfigurationTask
  })) return;
  if (await handleX11ApplicationRoutes(req, res, pathname, {
    authorizeConnection:authorizedConnectionForRequest,
    installForConnection:installX11ApplicationsForConnection,
    installPlanForConnection:x11InstallPlanForConnection,
    listForConnection:x11ApplicationsForConnection,
    readJson,
    sendJson,
    verifyForConnection:verifyX11ApplicationForConnection
  })) return;
  if (handleSftpOpenRoutes(req, res, pathname, {
    authorizeConnectionId:authorizedSftpConnectionId,
    readRuntimeSettings,
    runtimeSettingsFile:RUNTIME_SETTINGS_FILE,
    secureHeaders,
    streamRemoteOpenFile
  })) return;
  if (await handleStorageRoutes(req, res, pathname, {
    authRequired, baseDir:BASE_DIR, checkRuntimeSettings,
    clearProgramCache:(category) => programCacheManager.clear(category), dataDir:DATA_DIR,
    getDesktopIntegration, isDesktopRequest, isDirectLoopbackRequest,
    listLocalDirectories, normalizeRuntimeSettings, programCacheView, projectSshDir:PROJECT_SSH_DIR,
    readJson, readRuntimeSettings, runtimeSettingsFile:RUNTIME_SETTINGS_FILE, runtimeSettingsView,
    saveWebStorageSettings, sendJson, storageSettingsView, writeRuntimeSettings
  })) return;
  if (await handleUpdateRoutes(req, res, pathname, {
    checker:updateChecker,
    installer:updateInstaller,
    sendJson,
    isLocalRequest:isDesktopRequest,
    canOpenPackage:()=>Boolean(getDesktopIntegration()?.openUpdatePackage),
    canOpenDirectory:()=>Boolean(getDesktopIntegration()?.openUpdateDirectory),
    openPackage:(file)=>Promise.resolve(getDesktopIntegration().openUpdatePackage(file)),
    openDirectory:(file)=>Promise.resolve(getDesktopIntegration().openUpdateDirectory(file))
  })) return;
  if (await handleLogRoutes(req, res, pathname, {
    deleteLogs, deleteLogsOlderThan, enforceConfiguredLogRetention, getLogSettings, getDesktopIntegration, isDesktopRequest, listLogs, previewLogsOlderThan, readJson, readLog, readLogWindow, searchLogs,
    readRawLog, resolveLogPath, send, sendJson, updateLogSettings
  })) return;
  if (await handleSystemRoutes(req, res, pathname, {
    aboutInfo, batchRunCommands, getDesktopIntegration, getStartupStatus, isDesktopRequest, listNotifications,
    listSerialPorts, readJson, runtimeDiagnostics, sendJson
  })) return;
  if (await handleBackupRestoreRoutes(req, res, pathname, {
    clearConnectionHealthCache, closeDatabase, createConfigSnapshot, createDatabaseBundleHeader,
    databaseTransferStore, dbPath:DB_PATH, deleteConfigSnapshot, ensurePrivateFile,
    exportDatabaseFile, inspectRestoreDatabaseFile, listConfigSnapshots, lockEncryption,
    normalizeRestoredCredentials, readJson, readSecuritySettings, reconcileEncryptionStateAtStartup,
    reopenDatabase, requireEncryptionUnlocked, restoreConfigSnapshotById, secureHeaders,
    sendJson, stopAllForwards, writeSecuritySettings
  })) return;
  if (await handleCommandResourceRoutes(req, res, pathname, {readJson, sendJson})) return;
  if (await handleForwardTemplateRoutes(req, res, pathname, {createConfigSnapshot, readJson, sendJson})) return;
  if (await handleSftpJobRoutes(req, res, pathname, {sendJson})) return;
  if (await handleLocalFilesRoutes(req, res, pathname, {
    getDesktopIntegration,
    getHomeDirectory:() => os.homedir(),
    isDesktopRequest,
    readJson,
    sendJson
  })) return;
  if (await handleSftpExternalEditRoutes(req, res, pathname, {
    authorizeConnectionId:authorizedSftpConnectionId, getDesktopIntegration,
    getExternalEdit, getExternalEditComparison, isDesktopRequest, listExternalEdits,
    readJson, readRuntimeSettings, resolveExternalEdit, runtimeSettingsFile:RUNTIME_SETTINGS_FILE,
    sendJson, startExternalEdit, stopExternalEdit
  })) return;
  if (await handleSftpDesktopDownloadRoutes(req, res, pathname, {
    runtimeSettingsFile:RUNTIME_SETTINGS_FILE,
    getDesktopIntegration,
    isDesktopRequest,
    listSftpJobs,
    readJson,
    readRuntimeSettings,
    sendJson
  })) return;
  if (await handleConfigTransferRoutes(req, res, pathname, {
    defaultExtraArgs:DEFAULT_EXTRA_ARGS,
    batchTest,
    createConfigSnapshot,
    exportConfig,
    getPart,
    parseConfigText,
    readBody,
    readJson,
    saveImported,
    sendJson
  })) return;
  if (await handleRemoteTaskRoutes(req, res, pathname, {
    authorizeConnection:authorizedConnectionForRequest, clearFinishedLinuxDesktopTasks,
    configureRdpServerForConnection, createRemoteAdminGrant, deleteLinuxDesktopTask,
    detectLinuxDesktopForConnection, getConnection, handoffRemotePrivilegeGrant,
    issueRemoteAdminGrant, linuxDesktopTaskView, linuxDesktopTasks, listLinuxDesktopTasks,
    readJson, remoteOfflineTasks, sendJson, startLinuxDesktopInstall
  })) return;
  if (await handleFtpRoutes(req, res, pathname, {
    deleteFtpPath, downloadFtpFile, getPart, getRemoteProfile, listFtpDirectory,
    makeFtpDirectory, readBody, readJson, renameFtpPath, secureHeaders, sendJson, uploadFtpFile
  })) return;
  if (await handleRemoteProfileRoutes(req, res, pathname, {
    configureRdpServerForConnection, configureVncClipboardHelperForProfile,
    configureVncServerForProfile, configureXdmcpServer, createRemoteAdminGrant,
    deleteRemoteProfile, detectLinuxDesktopForConnection, detectXdmcpServer,
    duplicateRemoteProfile, formatRemoteEndpoint, getConnection,
    getDesktopIntegration, getRemoteProfile, getVncProfileCredential,
    insertRemoteProfile, inspectVncClipboardHelperForProfile, inspectVncServerForProfile,
    isDesktopCapabilityRequest, listConnections, listRemoteProfiles, probeTcpEndpoint,
    readBody, readJson, readVncRemoteClipboard, readVncRemoteClipboardImage, inspectVncRemoteClipboardImage,
    releaseRemoteAdminGrant, remoteOfflineTasks, resolveManagementConnection,
    repairRemoteProfileManagementConnection,
    runRemotePrivilegeCommand, runPersistentSshCommandForConnection, runPersistentSshCommandForConnectionStreaming,
    runSshCommandForConnection, runSshCommandForConnectionStreaming,
    send, sendJson, startRemoteComponentCommandTask, testFtpProfile, testRemoteTerminalProfile,
    testVncProfile, updateRemoteProfile, updateRemoteProfileFlags, updateRemoteProfileUsage,
    updateVncProfileCredential, writeVncRemoteClipboard, writeVncRemoteClipboardImage,
    xdmcpTaskResourceKey
  })) return;
  if (await handleSftpTransferRoutes(req, res, pathname, {
    authorizeConnectionId:authorizedSftpConnectionId, clearRemoteRecycleItems, compressJob,
    connectSftpSession, copyJob, copyRemotePaths, createNativeSftpDragTicket, createRemoteFile,
    crossCopyJob, deletePathsJob, deleteRemoteRecycleItem, disconnectSftpSession, extractJob,
    extractRemoteArchive, getDesktopIntegration, invalidateRemoteDirectoryCache,
    isDesktopRequest, listRemoteDir, listRemoteFileVersions, listRemoteRecycleItems, makeRemoteDir,
    moveJob, moveRemotePaths, normalizeRemotePermissionRequest, planRemoteUploads,
    prepareSftpWriteContent, readJson, readRemoteBinaryFile, readRemoteDirectorySize,
    readRemoteTextFile, readRuntimeSettings, receiveUploadJobContent, renameRemotePath,
    resolveRemoteDirectory, resolveRemoteUploadTarget, restoreRemoteRecycleItem, runtimeSettingsFile:RUNTIME_SETTINGS_FILE,
    safeUploadName, send, sendJson, setRemotePermissions, sftpSessionStatus, stageSftpPaths,
    startArchiveDownloadJob, startDownloadJob, startLocalDeliveryJob, startSyncJob,
    startSyncPlanningJob, startUploadReceiveJob, stopExternalEditsForConnection, streamRemoteFile,
    updateSftpTextEncoding, writeRemoteFile
  })) return;
  if (await handleConnectionRoutes(req, res, pathname, {
    all, appendSystemLog, bulkUpdateConnections, clearConnectionHealthCache, connectionHealth,
    createAllRemoteProfilesFromConnection, createConfigSnapshot, createRemoteProfileFromConnection,
    defaultExtraArgs:DEFAULT_EXTRA_ARGS, deleteConnection, deleteForward,
    deployGeneratedPublicKey:(id, publicPath) => deployGeneratedPublicKey(id, publicPath, Boolean(readSecuritySettings().manage_user_ssh_keys_enabled)),
    duplicateConnection, forwardLogLabel, getConnection, getDesktopIntegration,
    getForward, insertConnection, insertForward, inspectServer, invalidateRemoteDirectoryCache,
    isDesktopRequest, listConnections, listIdentityFiles, readJson, renameConnectionGroup,
    reorderConnectionGroups, reorderConnections, restorePreviousForwards, restoreStateSummary, sendJson,
    startConnectionForwards, startForward, stopConnectionForwards, stopExternalEditsForConnection,
    stopForward, reconfigureForward, terminalCapabilitiesForConnection, updateConnection, updateConnectionFlags,
    updateConnectionUsage, updateConnectionX11Mode, updateForward, updateSftpFilenameEncoding,
    updateTerminalPreferences, updateTerminalStartup
  })) return;
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
      const diagnosis = diagnoseSshError(body.error);
      const authenticationFailure = diagnosis.reason_code === "ssh_auth";
      if (authenticationFailure) body.code = "SSH_AUTHENTICATION_FAILED";
      else if (error?.code) body.code = String(error.code);
      const publicDetails = publicErrorDetails(error, body.code);
      body.error_code = publicDetails.code;
      if (Object.keys(publicDetails.params).length) body.error_params = publicDetails.params;
      if (publicDetails.preserveMessage) body.preserve_error_message = true;
      const connectionId = Number(error?.connectionId || error?.connection_id || 0);
      if (Number.isSafeInteger(connectionId) && connectionId !== 0) body.connection_id = connectionId;
      if (error?.connectionName) body.connection_name = String(error.connectionName);
      const remoteProfileId = Number(error?.remoteProfileId || error?.remote_profile_id || 0);
      if (Number.isSafeInteger(remoteProfileId) && remoteProfileId > 0) body.remote_profile_id = remoteProfileId;
      if (error?.remoteProfileName) body.remote_profile_name = String(error.remoteProfileName);
      if (error?.task) body.task = error.task;
      if (Array.isArray(error?.issues)) body.issues = error.issues;
      sendJson(res, body, status >= 400 && status <= 599 ? status : 400);
    }
    else res.destroy();
  });
}

function upgradeHandler(req, socket) {
  try {
    if (!hostAllowed(req) || !webSocketOriginAllowed(req) || !isAuthenticated(req)) return socket.destroy();
    const { pathname } = new URL(req.url, "http://terma.invalid");
    if (pathname === "/ws/terminal") {
      const nativeDesktop = isDesktopRequest(req);
      const localDirectAuthorized = !nativeDesktop && localDirectDesktopIntegrationStatus(req, "xserver").authorized;
      const grant = nativeDesktop || localDirectAuthorized ? null : desktopBrowserGrantStatus(req);
      return handleTerminalUpgrade(req, socket, {
        x11Authorized:isDesktopCapabilityRequest(req, "xserver"),
        nativeDesktop,
        grantId:String(grant?.grant_id || ""),
        expiresAt:Number(grant?.expires_at || 0),
        requestBinding:requestAuthenticationBinding(req)
      });
    }
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

const {
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
  getDesktopIntegration,
  getArgs,
  requestShutdown:shutdown
});
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
