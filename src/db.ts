const {
  decryptText,
  encryptText,
  requireEncryptionUnlocked
} = require("./crypto-store");
const databaseCore = require("./database/core");
const { createConnectionRepository } = require("./database/connection-repository");
const { createForwardRepository } = require("./database/forward-repository");
const { createProductivityRepository } = require("./database/productivity-repository");
const { createRemoteProfileRepository } = require("./database/remote-profile-repository");
const { createConfigSnapshotService } = require("./database/config-snapshot-service");
const { exportDatabaseBuffer, exportDatabaseFile } = require("./database/database-export");
const { decryptStoredConnectionSecrets, encryptStoredConnectionSecrets } = require("./database/secret-rewriter");
const { all, get, now, run } = databaseCore;
const db = {
  exec(sql) { return databaseCore.getDatabase().exec(sql); },
  prepare(sql) { return databaseCore.getDatabase().prepare(sql); }
};

const {
  DEFAULT_TERMINAL_FONT,
  TERMINAL_PROFILE_KINDS,
  TERMINAL_PROGRAM_PLATFORMS,
  TERMINAL_STARTUP_MODES,
  allowedIdentityPath,
  assertAllowedIdentityPath,
  boundedInteger,
  cleanConnection,
  cleanSftpFilenameEncoding,
  cleanSftpTextEncoding,
  cleanTerminalPreferences,
  cleanTerminalStartup,
  ensureConnectionGroup,
  pidRunning,
  validatePort,
  validateSortOrder
} = require("./database/connection-normalizer");

let forwardRepository: any = null;

const connectionRepository = createConnectionRepository({
  all,
  get,
  run,
  now,
  exec:(sql) => db.exec(sql),
  decryptText,
  encryptText,
  requireEncryptionUnlocked,
  cleanConnection,
  cleanTerminalPreferences,
  cleanTerminalStartup,
  cleanSftpTextEncoding,
  cleanSftpFilenameEncoding,
  ensureConnectionGroup,
  insertForward:(connectionId, data) => forwardRepository.insertForward(connectionId, data),
  validatePort,
  assertAllowedIdentityPath,
  allowedIdentityPath,
  pidRunning
});

forwardRepository = createForwardRepository({
  all,
  get,
  run,
  now,
  validatePort,
  getConnection:(id) => connectionRepository.getConnection(id)
});

const remoteProfileRepository = createRemoteProfileRepository({
  all,
  get,
  run,
  now,
  exec:(sql) => db.exec(sql),
  decryptText,
  encryptText,
  requireEncryptionUnlocked,
  ensureConnectionGroup,
  getConnection:(id) => connectionRepository.getConnection(id),
  validatePort,
  boundedInteger
});

const productivityRepository = createProductivityRepository({ all, get, run, now });

function cleanForward(data) { return forwardRepository.cleanForward(data); }
function databaseRevision() { return Number(get("SELECT revision FROM ui_state_revision WHERE id=1")?.revision || 0); }
function listConnections() { return connectionRepository.listConnections(); }
function getConnection(id) { return connectionRepository.getConnection(id); }
function getForward(id) { return forwardRepository.getForward(id); }
function insertConnection(data, defaultExtraArgs) { return connectionRepository.insertConnection(data, defaultExtraArgs); }
function duplicateConnection(id, defaultExtraArgs) { return connectionRepository.duplicateConnection(id, defaultExtraArgs); }
function updateConnection(id, data, defaultExtraArgs) { return connectionRepository.updateConnection(id, data, defaultExtraArgs); }
function updateConnectionUsage(id, action = "open") { return connectionRepository.updateConnectionUsage(id, action); }
function updateConnectionFlags(id, data = {}) { return connectionRepository.updateConnectionFlags(id, data); }
function updateTerminalPreferences(id, data) { return connectionRepository.updateTerminalPreferences(id, data); }
function updateTerminalStartup(id, data) { return connectionRepository.updateTerminalStartup(id, data); }
function updateConnectionX11Mode(id, value) { return connectionRepository.updateConnectionX11Mode(id, value); }
function updateSftpTextEncoding(id, value) { return connectionRepository.updateSftpTextEncoding(id, value); }
function updateSftpFilenameEncoding(id, value) { return connectionRepository.updateSftpFilenameEncoding(id, value); }
function bulkUpdateConnections(connectionIds, changes = {}) { return connectionRepository.bulkUpdateConnections(connectionIds, changes); }
function renameConnectionGroup(currentName, nextName) { return connectionRepository.renameConnectionGroup(currentName, nextName); }
function reorderConnectionGroups(names) { return connectionRepository.reorderConnectionGroups(names); }
function reorderConnections(groupName, ids) { return connectionRepository.reorderConnections(groupName, ids); }
function deleteConnection(id, stopForward) { return connectionRepository.deleteConnection(id, stopForward); }

function insertForward(connectionId, data) { return forwardRepository.insertForward(connectionId, data); }
function updateForward(id, data) { return forwardRepository.updateForward(id, data); }
function deleteForward(id, stopForward) { return forwardRepository.deleteForward(id, stopForward); }
function listForwardTemplates() { return forwardRepository.listForwardTemplates(); }
function insertForwardTemplate(data) { return forwardRepository.insertForwardTemplate(data); }
function updateForwardTemplate(id, data) { return forwardRepository.updateForwardTemplate(id, data); }
function deleteForwardTemplate(id) { return forwardRepository.deleteForwardTemplate(id); }
function getForwardTemplate(id) { return forwardRepository.getForwardTemplate(id); }
function applyForwardTemplate(templateId, connectionIds) { return forwardRepository.applyForwardTemplate(templateId, connectionIds); }
function ensureBuiltinForwardTemplates() { return forwardRepository.ensureBuiltinForwardTemplates(); }

function cleanRemoteProfile(data, existing = null) { return remoteProfileRepository.cleanRemoteProfile(data, existing); }
function listRemoteProfiles() { return remoteProfileRepository.listRemoteProfiles(); }
function getRemoteProfile(id) { return remoteProfileRepository.getRemoteProfile(id); }
function insertRemoteProfile(data) { return remoteProfileRepository.insertRemoteProfile(data); }
function createRemoteProfileFromConnection(connectionId, protocol) { return remoteProfileRepository.createRemoteProfileFromConnection(connectionId, protocol); }
function createAllRemoteProfilesFromConnection(connectionId) { return remoteProfileRepository.createAllRemoteProfilesFromConnection(connectionId); }
function updateRemoteProfile(id, data) { return remoteProfileRepository.updateRemoteProfile(id, data); }
function repairRemoteProfileManagementConnection(id, connectionId) { return remoteProfileRepository.repairRemoteProfileManagementConnection(id, connectionId); }
function getVncProfileCredential(id) { return remoteProfileRepository.getVncProfileCredential(id); }
function updateVncProfileCredential(id, value) { return remoteProfileRepository.updateVncProfileCredential(id, value); }
function duplicateRemoteProfile(id) { return remoteProfileRepository.duplicateRemoteProfile(id); }
function deleteRemoteProfile(id) { return remoteProfileRepository.deleteRemoteProfile(id); }
function updateRemoteProfileUsage(id) { return remoteProfileRepository.updateRemoteProfileUsage(id); }
function updateRemoteProfileFlags(id, data) { return remoteProfileRepository.updateRemoteProfileFlags(id, data); }

function listCommandSnippets() { return productivityRepository.listCommandSnippets(); }
function insertCommandSnippet(data) { return productivityRepository.insertCommandSnippet(data); }
function updateCommandSnippet(id, data) { return productivityRepository.updateCommandSnippet(id, data); }
function deleteCommandSnippet(id) { return productivityRepository.deleteCommandSnippet(id); }
function useCommandSnippet(id) { return productivityRepository.useCommandSnippet(id); }
function listNamedWorkspaces() { return productivityRepository.listNamedWorkspaces(); }
function insertNamedWorkspace(data) { return productivityRepository.insertNamedWorkspace(data); }
function updateNamedWorkspace(id, data) { return productivityRepository.updateNamedWorkspace(id, data); }
function duplicateNamedWorkspace(id) { return productivityRepository.duplicateNamedWorkspace(id); }
function useNamedWorkspace(id) { return productivityRepository.useNamedWorkspace(id); }
function deleteNamedWorkspace(id) { return productivityRepository.deleteNamedWorkspace(id); }

const { exportConfigSnapshot, restoreConfigSnapshot } = createConfigSnapshotService({cleanRemoteProfile, cleanForward});

ensureBuiltinForwardTemplates();

function closeDatabase() {
  databaseCore.closeDatabase();
}

function reopenDatabase() {
  databaseCore.reopenDatabase();
  ensureBuiltinForwardTemplates();
  return databaseCore.getDatabase();
}

module.exports = {
  get db() { return databaseCore.getDatabase(); },
  now,
  run,
  get,
  all,
  validatePort,
  validateSortOrder,
  pidRunning,
  databaseRevision,
  cleanConnection,
  cleanTerminalStartup,
  cleanForward,
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
  encryptStoredConnectionSecrets,
  decryptStoredConnectionSecrets,
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
  getForwardTemplate,
  applyForwardTemplate,
  exportConfigSnapshot,
  restoreConfigSnapshot,
  ensureBuiltinForwardTemplates,
  closeDatabase,
  reopenDatabase,
  exportDatabaseFile,
  exportDatabaseBuffer
};
